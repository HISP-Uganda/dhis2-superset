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
DHIS2 Unified Job Control REST API

Provides stop / cancel / pause / resume / restart / delete operations for
both dataset sync jobs (DHIS2SyncJob) and metadata refresh jobs
(DHIS2MetadataJob), plus a unified time-ordered list endpoint.

Routes
------
``GET  /jobs/``                          – Unified job list (sync + metadata)
``DELETE /jobs/<type>/<id>``             – Delete a terminal job
``POST /jobs/<type>/<id>/cancel``        – Cancel a running/queued job
``POST /jobs/<type>/<id>/restart``       – Re-run a completed/failed/cancelled job
``POST /jobs/<type>/<id>/pause``         – Cancel + deactivate dataset (sync) or cancel (metadata)
``POST /jobs/<type>/<id>/resume``        – Re-activate a paused (inactive) dataset
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from flask import request, Response
from flask_appbuilder import expose
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name, protect

from superset import db
from superset.dhis2.models import (
    DHIS2MetadataJob,
    DHIS2StagedDataset,
    DHIS2SyncJob,
)

logger = logging.getLogger(__name__)

_TERMINAL_STATUSES = {"success", "partial", "failed", "cancelled"}
_ACTIVE_STATUSES = {"pending", "queued", "running"}


def _load_sync_job(job_id: int) -> DHIS2SyncJob | None:
    return db.session.get(DHIS2SyncJob, job_id)


def _load_meta_job(job_id: int) -> DHIS2MetadataJob | None:
    return db.session.get(DHIS2MetadataJob, job_id)


def _revoke_celery_task(task_id: str | None) -> bool:
    """Attempt to revoke a Celery task. Returns True if revoke was sent."""
    if not task_id:
        return False
    try:
        from superset.extensions import celery_app

        celery_app.control.revoke(task_id, terminate=True, signal="SIGTERM")
        return True
    except Exception:  # pylint: disable=broad-except
        logger.warning("Could not revoke Celery task_id=%s", task_id, exc_info=True)
        return False


class DHIS2JobsApi(BaseApi):
    """REST API for unified DHIS2 job management (sync + metadata)."""

    resource_name = "dhis2/jobs"
    allow_browser_login = True
    openapi_spec_tag = "DHIS2 Jobs"

    # ------------------------------------------------------------------
    # Unified list
    # ------------------------------------------------------------------

    @expose("/", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def list_jobs(self) -> Response:
        """Return a time-ordered list of sync and/or metadata jobs for a database.

        Query params
        ------------
        database_id : int  (required)
        limit       : int  (default 50)
        type        : str  ``"sync"`` | ``"metadata"`` | ``"both"`` (default ``"both"``)
        """
        database_id = request.args.get("database_id", type=int)
        if not database_id:
            return self.response_400(message="database_id is required")

        limit = min(int(request.args.get("limit", 50)), 200)
        job_type_filter = request.args.get("type", "both")

        results: list[dict[str, Any]] = []

        if job_type_filter in ("sync", "both"):
            sync_jobs = (
                db.session.query(DHIS2SyncJob)
                .join(
                    DHIS2StagedDataset,
                    DHIS2SyncJob.staged_dataset_id == DHIS2StagedDataset.id,
                )
                .filter(DHIS2StagedDataset.database_id == database_id)
                .order_by(DHIS2SyncJob.created_on.desc())
                .limit(limit)
                .all()
            )
            for job in sync_jobs:
                row = job.to_json()
                # Include dataset name for context
                if job.staged_dataset:
                    row["staged_dataset_name"] = job.staged_dataset.name
                results.append(row)

        if job_type_filter in ("metadata", "both"):
            meta_jobs = (
                db.session.query(DHIS2MetadataJob)
                .filter(DHIS2MetadataJob.database_id == database_id)
                .order_by(DHIS2MetadataJob.created_on.desc())
                .limit(limit)
                .all()
            )
            results.extend(job.to_json() for job in meta_jobs)

        # Sort combined list newest-first
        results.sort(
            key=lambda r: r.get("created_on") or "",
            reverse=True,
        )
        results = results[:limit]

        return self.response(200, result=results, count=len(results))

    # ------------------------------------------------------------------
    # Cancel
    # ------------------------------------------------------------------

    @expose("/<string:job_type>/<int:job_id>/cancel", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def cancel_job(self, job_type: str, job_id: int) -> Response:
        """Cancel a running or queued job.

        Sets ``cancel_requested=True`` on the job record so the worker loop
        can detect it and abort.  Also sends a Celery ``revoke`` signal if a
        ``task_id`` is stored on the job.
        """
        job = self._get_job(job_type, job_id)
        if job is None:
            return self.response_404()

        if job.status in _TERMINAL_STATUSES:
            return self.response(
                409,
                message=f"Job is already in terminal state '{job.status}'. Cannot cancel.",
            )

        job.cancel_requested = True
        task_revoked = _revoke_celery_task(job.task_id)

        # Optimistically mark cancelled (worker loop will also detect this)
        job.status = "cancelled"
        job.completed_at = datetime.utcnow()
        job.error_message = "Cancelled by user"
        db.session.commit()

        return self.response(
            200,
            result={"cancelled": True, "task_revoked": task_revoked, "job_id": job_id},
        )

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    @expose("/<string:job_type>/<int:job_id>", methods=["DELETE"])
    @protect()
    @safe
    @permission_name("read")
    def delete_job(self, job_type: str, job_id: int) -> Response:
        """Permanently delete a job record.

        Only terminal jobs (success, partial, failed, cancelled) may be
        deleted.  Attempting to delete an active job returns HTTP 409.
        """
        job = self._get_job(job_type, job_id)
        if job is None:
            return self.response_404()

        if job.status in _ACTIVE_STATUSES:
            return self.response(
                409,
                message=(
                    f"Cannot delete an active job with status '{job.status}'. "
                    "Cancel it first."
                ),
            )

        db.session.delete(job)
        db.session.commit()
        return self.response(200, result={"deleted": True, "job_id": job_id})

    # ------------------------------------------------------------------
    # Restart
    # ------------------------------------------------------------------

    @expose("/<string:job_type>/<int:job_id>/restart", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def restart_job(self, job_type: str, job_id: int) -> Response:
        """Create and dispatch a new job based on the parameters of an existing one."""
        job = self._get_job(job_type, job_id)
        if job is None:
            return self.response_404()

        try:
            if job_type == "sync" and isinstance(job, DHIS2SyncJob):
                from superset.dhis2.sync_service import schedule_staged_dataset_sync

                result = schedule_staged_dataset_sync(
                    job.staged_dataset_id,
                    job_type="manual",
                    incremental=True,
                )
                return self.response(202, result=result)

            elif job_type == "metadata" and isinstance(job, DHIS2MetadataJob):
                from superset.dhis2.metadata_staging_service import (
                    schedule_database_metadata_refresh,
                )

                result = schedule_database_metadata_refresh(
                    job.database_id,
                    instance_ids=job.get_instance_ids() or None,
                    metadata_types=job.get_metadata_types() or None,
                    reason="restart",
                    job_type="manual",
                )
                return self.response(202, result=result)

            return self.response_400(
                message=f"Unknown job_type '{job_type}'. Expected 'sync' or 'metadata'."
            )

        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("jobs_api: restart failed for %s job_id=%d", job_type, job_id)
            return self.response_500(message=str(exc))

    # ------------------------------------------------------------------
    # Pause (cancel + deactivate dataset for sync jobs)
    # ------------------------------------------------------------------

    @expose("/<string:job_type>/<int:job_id>/pause", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def pause_job(self, job_type: str, job_id: int) -> Response:
        """Pause a job: cancel it and (for sync jobs) deactivate the dataset.

        Deactivating the dataset prevents future scheduled syncs from firing
        until the user explicitly calls ``/resume``.
        """
        job = self._get_job(job_type, job_id)
        if job is None:
            return self.response_404()

        dataset_deactivated = False

        if job.status not in _TERMINAL_STATUSES:
            job.cancel_requested = True
            _revoke_celery_task(job.task_id)
            job.status = "cancelled"
            job.completed_at = datetime.utcnow()
            job.error_message = "Paused by user"

        if job_type == "sync" and isinstance(job, DHIS2SyncJob):
            dataset = db.session.get(DHIS2StagedDataset, job.staged_dataset_id)
            if dataset is not None:
                dataset.is_active = False
                dataset_deactivated = True

        db.session.commit()
        return self.response(
            200,
            result={
                "paused": True,
                "dataset_deactivated": dataset_deactivated,
                "job_id": job_id,
            },
        )

    # ------------------------------------------------------------------
    # Resume (re-activate a paused dataset)
    # ------------------------------------------------------------------

    @expose("/<string:job_type>/<int:job_id>/resume", methods=["POST"])
    @protect()
    @safe
    @permission_name("read")
    def resume_job(self, job_type: str, job_id: int) -> Response:
        """Re-activate a paused dataset so scheduled syncs can fire again.

        For sync jobs only — sets ``DHIS2StagedDataset.is_active = True``.
        Does NOT automatically trigger a new sync run; use ``/restart`` for that.
        """
        job = self._get_job(job_type, job_id)
        if job is None:
            return self.response_404()

        dataset_activated = False
        if job_type == "sync" and isinstance(job, DHIS2SyncJob):
            dataset = db.session.get(DHIS2StagedDataset, job.staged_dataset_id)
            if dataset is not None:
                dataset.is_active = True
                dataset_activated = True
                db.session.commit()

        return self.response(
            200,
            result={"resumed": True, "dataset_activated": dataset_activated, "job_id": job_id},
        )

    # ------------------------------------------------------------------
    # Helper
    # ------------------------------------------------------------------

    def _get_job(
        self, job_type: str, job_id: int
    ) -> DHIS2SyncJob | DHIS2MetadataJob | None:
        if job_type == "sync":
            return _load_sync_job(job_id)
        if job_type == "metadata":
            return _load_meta_job(job_id)
        return None
