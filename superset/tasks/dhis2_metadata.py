from __future__ import annotations

from typing import Any

from celery import shared_task


@shared_task(name="dhis2.refresh_metadata")
def refresh_dhis2_metadata(
    database_id: int,
    instance_ids: list[int] | None = None,
    metadata_types: list[str] | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    from superset.dhis2.metadata_staging_service import refresh_database_metadata

    return refresh_database_metadata(
        database_id,
        instance_ids=instance_ids,
        metadata_types=metadata_types,
        reason=reason or "celery_refresh",
    )


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
