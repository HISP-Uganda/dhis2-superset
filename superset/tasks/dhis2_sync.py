# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""
DHIS2 Background Sync Tasks

These tasks run as Celery workers to keep staging tables fresh.
Background processing is auto-enabled for all staged datasets and cannot be
disabled on a per-dataset basis - this is by design to ensure data freshness.

Usage (manual trigger)::

    from superset.tasks.dhis2_sync import sync_staged_dataset_task
    sync_staged_dataset_task.delay(staged_dataset_id=42)

Or to check all scheduled datasets immediately::

    from superset.tasks.dhis2_sync import sync_all_scheduled_datasets
    sync_all_scheduled_datasets.delay()
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import requests
from celery.exceptions import SoftTimeLimitExceeded

from superset.extensions import celery_app

logger = logging.getLogger(__name__)

# Maximum wall-clock time a single dataset sync task may run.
# A large dataset against a slow DHIS2 server can legitimately take 30–60
# minutes.  The soft limit gives the task a chance to mark the job "failed"
# cleanly; the hard limit kills the process if it ignores the soft signal.
_TASK_SOFT_TIME_LIMIT = 7200   # 2 hours — soft: raises SoftTimeLimitExceeded
_TASK_HARD_TIME_LIMIT = 7260   # 2 h 1 min — hard: SIGKILL


# ---------------------------------------------------------------------------
# Per-dataset sync task
# ---------------------------------------------------------------------------


@celery_app.task(
    name="superset.tasks.dhis2_sync.sync_staged_dataset",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    soft_time_limit=_TASK_SOFT_TIME_LIMIT,
    time_limit=_TASK_HARD_TIME_LIMIT,
)
def sync_staged_dataset_task(
    self,
    staged_dataset_id: int,
    job_type: str = "scheduled",
    job_id: int | None = None,
    incremental: bool = True,
) -> dict[str, Any]:
    """Celery task: synchronise a single staged DHIS2 dataset.

    Creates a :class:`~superset.dhis2.models.DHIS2SyncJob` record before
    starting, transitions it to ``running``, calls
    :class:`~superset.dhis2.sync_service.DHIS2SyncService`, and finally
    marks the job terminal (``success`` / ``partial`` / ``failed``).

    Transient network errors (:class:`requests.RequestException`) trigger an
    automatic retry up to *max_retries* times with *default_retry_delay*
    seconds between attempts.  Permanent failures (dataset not found, staging
    table misconfigured) are not retried.

    Args:
        staged_dataset_id: PK of the
            :class:`~superset.dhis2.models.DHIS2StagedDataset` to sync.
        job_type: Discriminator stored on the job record (``"scheduled"`` or
            ``"manual"``).

    Returns:
        The sync result dict produced by
        :meth:`~superset.dhis2.sync_service.DHIS2SyncService.sync_staged_dataset`.
    """
    from superset import db
    from superset.dhis2.models import DHIS2StagedDataset, DHIS2SyncJob
    from superset.dhis2.sync_service import DHIS2SyncService

    # Guard: dataset may have been deleted between task dispatch and execution.
    dataset_exists = (
        db.session.query(DHIS2StagedDataset.id)
        .filter(DHIS2StagedDataset.id == staged_dataset_id)
        .scalar()
    ) is not None
    if not dataset_exists:
        logger.warning(
            "dhis2_sync: staged dataset id=%d no longer exists — skipping task",
            staged_dataset_id,
        )
        return {"status": "skipped", "reason": "dataset not found"}

    service = DHIS2SyncService()
    if job_id is not None:
        job = db.session.get(DHIS2SyncJob, job_id)
        if job is None:
            job = service.create_sync_job(staged_dataset_id, job_type=job_type)
    else:
        job = service.create_sync_job(staged_dataset_id, job_type=job_type)

    logger.info(
        "dhis2_sync: starting job id=%d dataset=%d type=%s celery_task=%s",
        job.id,
        staged_dataset_id,
        job_type,
        self.request.id,
    )

    # Store the Celery task ID on the job so the UI Cancel button can revoke
    # it and the stale-job detector can identify the Celery task.
    job.task_id = self.request.id
    service.update_job_status(job, status="running")

    try:
        result = service.sync_staged_dataset(
            staged_dataset_id=staged_dataset_id,
            job_id=job.id,
            incremental=incremental,
        )
        logger.info(
            "dhis2_sync: completed job id=%d status=%s rows=%d",
            job.id,
            result.get("status"),
            result.get("total_rows", 0),
        )
        return result

    except SoftTimeLimitExceeded:
        # Celery sent SIGALRM because the task exceeded _TASK_SOFT_TIME_LIMIT.
        # Mark the job failed before the hard kill fires.
        err_msg = (
            f"Sync job exceeded the {_TASK_SOFT_TIME_LIMIT // 60}-minute time limit "
            "and was automatically stopped. Consider reducing the dataset's org-unit "
            "scope or syncing fewer periods at a time."
        )
        logger.warning("dhis2_sync: soft time limit exceeded for job id=%d", job.id)
        service.update_job_status(job, status="failed", error_message=err_msg)
        raise

    except requests.RequestException as exc:
        # Transient network failure – retry up to max_retries times.
        err_msg = str(exc)
        logger.warning(
            "dhis2_sync: network error on job id=%d, will retry: %s",
            job.id,
            err_msg,
        )
        service.update_job_status(job, status="failed", error_message=err_msg)
        raise self.retry(exc=exc)

    except Exception as exc:  # pylint: disable=broad-except
        # Permanent failure – mark failed and do not retry.
        err_msg = str(exc)
        logger.exception(
            "dhis2_sync: permanent failure on job id=%d dataset=%d: %s",
            job.id,
            staged_dataset_id,
            err_msg,
        )
        service.update_job_status(job, status="failed", error_message=err_msg)
        raise


# ---------------------------------------------------------------------------
# Beat-driven scheduler task
# ---------------------------------------------------------------------------


@celery_app.task(
    name="superset.tasks.dhis2_sync.sync_all_scheduled_datasets",
    soft_time_limit=600,
    time_limit=660,
)
def sync_all_scheduled_datasets() -> dict[str, Any]:
    """Celery beat task: dispatch sync jobs for all datasets that are due.

    Iterates over every active :class:`~superset.dhis2.models.DHIS2StagedDataset`
    that has a ``schedule_cron`` configured.  A dataset is considered *due* if:

    * ``last_sync_at`` is ``None`` (never synced), **or**
    * the most recent scheduled tick according to ``croniter`` is *after*
      ``last_sync_at`` (i.e. a tick has passed since the last successful sync).

    For each due dataset a :func:`sync_staged_dataset_task` is dispatched
    asynchronously so that multiple datasets can sync concurrently.

    Returns:
        A dict with two keys:

        * ``dispatched``: list of ``staged_dataset_id`` values for which a
          task was dispatched.
        * ``skipped``: list of ``staged_dataset_id`` values that were not yet
          due.
    """
    from croniter import croniter

    from superset import db
    from superset.dhis2.models import DHIS2StagedDataset, DHIS2SyncJob
    from superset.dhis2.sync_service import DHIS2SyncService

    now = datetime.utcnow()
    dispatched: list[int] = []
    skipped: list[int] = []

    # Reset any datasets that are stuck in "running" state from a previous
    # crashed thread/worker — jobs older than 30 minutes are considered stale.
    _reset_stuck_running_datasets(db, DHIS2StagedDataset, DHIS2SyncJob, DHIS2SyncService, now)

    datasets = (
        db.session.query(DHIS2StagedDataset)
        .filter(
            DHIS2StagedDataset.is_active.is_(True),
            DHIS2StagedDataset.schedule_cron.isnot(None),
            DHIS2StagedDataset.schedule_cron != "",
        )
        .all()
    )

    logger.info(
        "dhis2_sync_all: evaluating %d active scheduled datasets at %s",
        len(datasets),
        now.isoformat(),
    )

    for dataset in datasets:
        cron_expr: str = dataset.schedule_cron  # type: ignore[assignment]
        last_sync: datetime | None = dataset.last_sync_at

        try:
            is_due = _dataset_is_due(cron_expr, last_sync, now)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "dhis2_sync_all: invalid cron '%s' for dataset=%d: %s",
                cron_expr,
                dataset.id,
                exc,
            )
            skipped.append(dataset.id)
            continue

        if is_due:
            sync_staged_dataset_task.delay(
                staged_dataset_id=dataset.id,
                job_type="scheduled",
            )
            dispatched.append(dataset.id)
            logger.info(
                "dhis2_sync_all: dispatched sync for dataset=%d (cron='%s')",
                dataset.id,
                cron_expr,
            )
        else:
            skipped.append(dataset.id)
            logger.debug(
                "dhis2_sync_all: dataset=%d not due yet (cron='%s', last_sync=%s)",
                dataset.id,
                cron_expr,
                last_sync,
            )

    logger.info(
        "dhis2_sync_all: dispatched=%d skipped=%d",
        len(dispatched),
        len(skipped),
    )
    return {"dispatched": dispatched, "skipped": skipped}


# ---------------------------------------------------------------------------
# Manual trigger task
# ---------------------------------------------------------------------------


@celery_app.task(
    name="superset.tasks.dhis2_sync.trigger_sync_for_dataset",
    soft_time_limit=60,
)
def trigger_sync_for_dataset(staged_dataset_id: int) -> dict[str, Any]:
    """Celery task: immediately trigger a manual sync for a specific dataset.

    This thin wrapper is used by the REST API when a user clicks
    *Refresh Now* in the UI.  It dispatches :func:`sync_staged_dataset_task`
    and returns the Celery task ID so the caller can poll for progress.

    Args:
        staged_dataset_id: PK of the staged dataset to sync.

    Returns:
        A dict with keys ``task_id`` and ``staged_dataset_id``.
    """
    task = sync_staged_dataset_task.delay(
        staged_dataset_id=staged_dataset_id,
        job_type="manual",
    )
    logger.info(
        "dhis2_sync: triggered manual sync for dataset=%d task_id=%s",
        staged_dataset_id,
        task.id,
    )
    return {
        "task_id": task.id,
        "staged_dataset_id": staged_dataset_id,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _dataset_is_due(
    cron_expr: str,
    last_sync_at: datetime | None,
    now: datetime,
) -> bool:
    """Determine whether a dataset's cron schedule is due for another sync.

    A dataset is due if:

    * ``last_sync_at`` is ``None`` (has never been synced), **or**
    * the most recent past tick of *cron_expr* (as computed by ``croniter``)
      occurred *after* ``last_sync_at``, meaning at least one scheduled
      interval has elapsed without a sync.

    Args:
        cron_expr: Standard 5-field cron expression (e.g. ``"0 */6 * * *"``).
        last_sync_at: UTC timestamp of the last successful sync, or ``None``.
        now: Reference "current" UTC datetime.

    Returns:
        ``True`` if the dataset should be synced, ``False`` otherwise.
    """
    from croniter import croniter

    if last_sync_at is None:
        return True

    cron = croniter(cron_expr, now)
    last_scheduled_tick: datetime = cron.get_prev(datetime)
    return last_scheduled_tick > last_sync_at


def _reset_stuck_running_datasets(
    db: Any,
    DHIS2StagedDataset: Any,
    DHIS2SyncJob: Any,
    DHIS2SyncService: Any,
    now: datetime,
    stale_after_minutes: int = 30,
) -> None:
    """Reset datasets and jobs that are stuck in 'running' state.

    A 'running' state that is older than *stale_after_minutes* is assumed to
    have been abandoned by a crashed worker or thread (e.g. after a server
    restart) and is reset to 'pending' / 'failed' so that the scheduler can
    dispatch a fresh sync.

    Args:
        stale_after_minutes: How many minutes a 'running' job may remain
            before it is considered stale.  Defaults to 30.
    """
    from datetime import timedelta

    stale_cutoff = now - timedelta(minutes=stale_after_minutes)
    service = DHIS2SyncService()

    # Find sync jobs that have been running too long.
    stuck_jobs = (
        db.session.query(DHIS2SyncJob)
        .filter(
            DHIS2SyncJob.status == "running",
            DHIS2SyncJob.created_on < stale_cutoff,
        )
        .all()
    )
    for job in stuck_jobs:
        logger.warning(
            "dhis2_sync_all: resetting stale running job id=%d dataset=%d",
            job.id,
            job.staged_dataset_id,
        )
        service.update_job_status(
            job,
            status="failed",
            error_message="Auto-reset: job was stuck in running state (server restart?)",
        )

    # Reset dataset-level sync_status for any that are still flagged running
    # but have no active job.
    stuck_datasets = (
        db.session.query(DHIS2StagedDataset)
        .filter(DHIS2StagedDataset.last_sync_status == "running")
        .all()
    )
    for dataset in stuck_datasets:
        active_job = (
            db.session.query(DHIS2SyncJob)
            .filter_by(staged_dataset_id=dataset.id, status="running")
            .first()
        )
        if active_job is None:
            logger.warning(
                "dhis2_sync_all: resetting orphaned running status for dataset id=%d",
                dataset.id,
            )
            service.update_dataset_sync_state(dataset.id, status="pending")

    if stuck_jobs or stuck_datasets:
        db.session.commit()

    # Also reset stale DHIS2MetadataJob records stuck in running state
    try:
        from superset.dhis2.models import DHIS2MetadataJob

        stuck_meta_jobs = (
            db.session.query(DHIS2MetadataJob)
            .filter(
                DHIS2MetadataJob.status == "running",
                DHIS2MetadataJob.created_on < stale_cutoff,
            )
            .all()
        )
        for meta_job in stuck_meta_jobs:
            logger.warning(
                "dhis2_sync_all: resetting stale metadata job id=%d database_id=%d",
                meta_job.id,
                meta_job.database_id,
            )
            meta_job.status = "failed"
            meta_job.completed_at = now
            meta_job.error_message = "Auto-reset: metadata job stuck in running state (server restart?)"
        if stuck_meta_jobs:
            db.session.commit()
    except Exception:  # pylint: disable=broad-except
        logger.warning("Failed to reset stale metadata jobs", exc_info=True)
