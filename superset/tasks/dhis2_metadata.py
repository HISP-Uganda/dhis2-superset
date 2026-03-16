from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="dhis2.refresh_metadata", bind=True)
def refresh_dhis2_metadata(
    self: Any,
    database_id: int,
    instance_ids: list[int] | None = None,
    metadata_types: list[str] | None = None,
    reason: str | None = None,
    job_id: int | None = None,
    continuation_metadata_types: list[str] | None = None,
) -> dict[str, Any]:
    from superset.dhis2.metadata_staging_service import refresh_database_metadata

    try:
        result = refresh_database_metadata(
            database_id,
            instance_ids=instance_ids,
            metadata_types=metadata_types,
            reason=reason or "celery_refresh",
            job_id=job_id,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception(
            "refresh_dhis2_metadata failed for database_id=%s job_id=%s",
            database_id,
            job_id,
        )
        if job_id is not None:
            try:
                from superset.extensions import db
                from superset.dhis2.models import DHIS2MetadataJob
                from datetime import datetime

                _job = db.session.get(DHIS2MetadataJob, job_id)
                if _job is not None and _job.status not in ("cancelled", "failed", "complete"):
                    _job.status = "failed"
                    _job.completed_at = datetime.utcnow()
                    _job.error_message = str(exc)
                    db.session.commit()
            except Exception:  # pylint: disable=broad-except
                logger.exception("Failed to update DHIS2MetadataJob status on error")
        raise

    # If a continuation was requested and phase 1 did not fail/cancel, dispatch phase 2.
    if continuation_metadata_types and result.get("status") not in ("failed", "cancelled"):
        try:
            from superset.dhis2.metadata_staging_service import schedule_database_metadata_refresh

            schedule_database_metadata_refresh(
                database_id,
                instance_ids=instance_ids,
                metadata_types=continuation_metadata_types,
                reason="initial_setup_phase2",
                job_type="scheduled",
            )
            logger.info(
                "Dispatched phase-2 metadata refresh for database_id=%s types=%s",
                database_id,
                continuation_metadata_types,
            )
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Failed to dispatch phase-2 metadata continuation for database_id=%s",
                database_id,
                exc_info=True,
            )

    return result


@shared_task(name="dhis2.refresh_all_metadata")
def refresh_all_dhis2_metadata(
    metadata_types: list[str] | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    from superset.dhis2.metadata_staging_service import refresh_all_dhis2_metadata as refresh_all

    return refresh_all(
        metadata_types=metadata_types,
        reason=reason or "celery_scheduled_refresh",
    )
