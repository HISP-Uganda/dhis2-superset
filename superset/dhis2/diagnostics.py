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
DHIS2 Multi-Instance Diagnostics

Provides health checks, freshness status, and admin troubleshooting
capabilities for the multi-instance DHIS2 integration.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from superset import db
from superset.dhis2 import instance_service
from superset.dhis2.metadata_staging_service import (
    CATEGORY_METADATA_TYPES,
    LEGEND_SET_METADATA_TYPE,
    ORG_UNIT_METADATA_TYPES,
    PROGRAM_METADATA_TYPES,
    SUPPORTED_METADATA_TYPES,
    VARIABLE_STATUS_METADATA_TYPES,
    get_metadata_refresh_progress,
    schedule_database_metadata_refresh,
)
from superset.dhis2.models import (
    DHIS2DatasetVariable,
    DHIS2Instance,
    DHIS2StagedDataset,
    DHIS2SyncJob,
)
from superset.models.core import Database
from superset.staging import metadata_cache_service

logger = logging.getLogger(__name__)

LEGEND_SET_METADATA_TYPES = (LEGEND_SET_METADATA_TYPE,)


class DHIS2DiagnosticsService:
    """Health checks, freshness status and admin troubleshooting for DHIS2 federation."""

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _staging_table_info(self, dataset: DHIS2StagedDataset) -> tuple[bool, int | None]:
        """Return (table_exists, row_count) for a staged dataset's physical table.

        Catches all exceptions so a missing or inaccessible table never raises.
        """
        if not dataset.staging_table_name:
            return False, None

        try:
            from sqlalchemy import text as sa_text
            from superset.dhis2.staging_engine import DHIS2StagingEngine

            engine = DHIS2StagingEngine(dataset.database_id)
            if not engine.table_exists(dataset):
                return False, None

            table_ref = engine.get_superset_sql_table_ref(dataset)
            count_result = db.session.execute(
                sa_text(f"SELECT COUNT(*) FROM {table_ref}")  # noqa: S608
            )
            row_count = count_result.scalar()
            return True, int(row_count) if row_count is not None else 0

        except Exception:  # pylint: disable=broad-except
            logger.debug(
                "diagnostics: could not stat staging table %r for dataset_id=%s",
                dataset.staging_table_name,
                dataset.id,
                exc_info=True,
            )
            return False, None

    def _freshness_minutes(self, dataset: DHIS2StagedDataset) -> float | None:
        """Return minutes since last successful sync, or ``None`` if never synced."""
        if dataset.last_sync_at is None:
            return None
        delta = datetime.utcnow() - dataset.last_sync_at
        return delta.total_seconds() / 60.0

    def _variable_count_for_instance(self, instance_id: int) -> int:
        """Count dataset variables referencing *instance_id*."""
        return (
            db.session.query(DHIS2DatasetVariable)
            .filter(DHIS2DatasetVariable.instance_id == instance_id)
            .count()
        )

    def _recent_jobs(self, staged_dataset_id: int, limit: int = 3) -> list[dict[str, Any]]:
        """Return the *limit* most-recent sync jobs for a staged dataset."""
        jobs = (
            db.session.query(DHIS2SyncJob)
            .filter_by(staged_dataset_id=staged_dataset_id)
            .order_by(DHIS2SyncJob.created_on.desc())
            .limit(limit)
            .all()
        )
        return [j.to_json() for j in jobs]

    @staticmethod
    def _normalize_metadata_snapshot_status(status: str | None) -> str:
        if status in {"success", "unsupported"}:
            return "ready"
        if status in {"pending", "failed"}:
            return status
        return "missing"

    def _summarize_metadata_statuses(self, statuses: list[str]) -> str:
        if not statuses:
            return "missing"

        unique = set(statuses)
        if unique == {"ready"}:
            return "ready"
        if unique == {"missing"}:
            return "missing"
        if "ready" in unique and len(unique) > 1:
            return "partial"
        if "failed" in unique:
            return "failed" if unique.issubset({"failed", "missing"}) else "partial"
        if "pending" in unique or "missing" in unique:
            return "pending"
        return "missing"

    @staticmethod
    def _parse_datetime(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    def _get_metadata_family_status(
        self,
        *,
        database_id: int,
        metadata_types: list[str],
        instances: list[DHIS2Instance],
    ) -> dict[str, Any]:
        instance_results = []
        total_count = 0
        refreshed_candidates: list[datetime] = []

        for instance in instances:
            type_results: dict[str, Any] = {}
            type_statuses: list[str] = []
            instance_total_count = 0

            for metadata_type in metadata_types:
                snapshot = metadata_cache_service.get_cached_metadata_payload(
                    database_id,
                    f"dhis2_snapshot:{metadata_type}",
                    {"instance_id": instance.id},
                )
                status = self._normalize_metadata_snapshot_status(
                    None if snapshot is None else snapshot.get("status")
                )
                count = int(snapshot.get("count") or 0) if snapshot else 0
                refreshed_at = snapshot.get("cache_refreshed_at") if snapshot else None
                refreshed_dt = self._parse_datetime(refreshed_at)
                if refreshed_dt is not None:
                    refreshed_candidates.append(refreshed_dt)
                instance_total_count += count
                type_statuses.append(status)
                type_results[metadata_type] = {
                    "status": status,
                    "count": count,
                    "message": snapshot.get("message") if snapshot else None,
                    "cache_refreshed_at": refreshed_at,
                }

            instance_status = self._summarize_metadata_statuses(type_statuses)
            total_count += instance_total_count
            instance_results.append(
                {
                    "id": instance.id,
                    "name": instance.name,
                    "status": instance_status,
                    "count": instance_total_count,
                    "types": type_results,
                }
            )

        summary_status = self._summarize_metadata_statuses(
            [result["status"] for result in instance_results]
        )
        last_refreshed_at = (
            max(refreshed_candidates).isoformat() if refreshed_candidates else None
        )

        return {
            "status": summary_status,
            "count": total_count,
            "last_refreshed_at": last_refreshed_at,
            "ready_instances": sum(
                1 for result in instance_results if result["status"] == "ready"
            ),
            "pending_instances": sum(
                1 for result in instance_results if result["status"] == "pending"
            ),
            "failed_instances": sum(
                1 for result in instance_results if result["status"] == "failed"
            ),
            "partial_instances": sum(
                1 for result in instance_results if result["status"] == "partial"
            ),
            "missing_instances": sum(
                1 for result in instance_results if result["status"] == "missing"
            ),
            "instances": instance_results,
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_metadata_status(self, database_id: int) -> dict[str, Any]:
        database = db.session.get(Database, database_id)
        if database is None:
            raise ValueError(f"Database with id={database_id} not found")
        if database.backend != "dhis2":
            raise ValueError(f"Database id={database_id} is not a DHIS2 database")

        instances = instance_service.get_instances_with_legacy_fallback(
            database_id,
            include_inactive=False,
        )
        variables = self._get_metadata_family_status(
            database_id=database_id,
            metadata_types=list(VARIABLE_STATUS_METADATA_TYPES),
            instances=instances,
        )
        programs = self._get_metadata_family_status(
            database_id=database_id,
            metadata_types=list(PROGRAM_METADATA_TYPES),
            instances=instances,
        )
        categories = self._get_metadata_family_status(
            database_id=database_id,
            metadata_types=list(CATEGORY_METADATA_TYPES),
            instances=instances,
        )
        legend_sets = self._get_metadata_family_status(
            database_id=database_id,
            metadata_types=list(LEGEND_SET_METADATA_TYPES),
            instances=instances,
        )
        org_units = self._get_metadata_family_status(
            database_id=database_id,
            metadata_types=list(ORG_UNIT_METADATA_TYPES),
            instances=instances,
        )

        overall_status = self._summarize_metadata_statuses(
            [
                variables["status"],
                programs["status"],
                categories["status"],
                legend_sets["status"],
                org_units["status"],
            ]
        )

        refreshed_candidates = [
            candidate
            for candidate in (
                self._parse_datetime(variables.get("last_refreshed_at")),
                self._parse_datetime(programs.get("last_refreshed_at")),
                self._parse_datetime(categories.get("last_refreshed_at")),
                self._parse_datetime(legend_sets.get("last_refreshed_at")),
                self._parse_datetime(org_units.get("last_refreshed_at")),
            )
            if candidate is not None
        ]

        return {
            "database_id": database_id,
            "database_name": database.database_name,
            "active_instance_count": len(instances),
            "overall_status": overall_status,
            "last_refreshed_at": (
                max(refreshed_candidates).isoformat() if refreshed_candidates else None
            ),
            "variables": variables,
            "programs": programs,
            "categories": categories,
            "legend_sets": legend_sets,
            "org_units": org_units,
            "refresh_progress": get_metadata_refresh_progress(database_id),
        }

    def request_metadata_refresh(
        self,
        database_id: int,
        *,
        metadata_types: list[str] | None = None,
    ) -> dict[str, Any]:
        database = db.session.get(Database, database_id)
        if database is None:
            raise ValueError(f"Database with id={database_id} not found")
        if database.backend != "dhis2":
            raise ValueError(f"Database id={database_id} is not a DHIS2 database")

        instances = instance_service.get_instances_with_legacy_fallback(
            database_id,
            include_inactive=False,
        )
        instance_ids = [instance.id for instance in instances if getattr(instance, "id", None)]
        active_metadata_types = list(
            dict.fromkeys(metadata_types or list(SUPPORTED_METADATA_TYPES))
        )
        refresh = schedule_database_metadata_refresh(
            database_id,
            instance_ids=instance_ids or None,
            metadata_types=active_metadata_types,
            reason="manual_metadata_refresh",
        )
        return {
            "database_id": database_id,
            "database_name": database.database_name,
            "instance_ids": instance_ids,
            "metadata_types": active_metadata_types,
            "refresh": refresh,
        }

    def get_federation_health(self, database_id: int) -> dict[str, Any]:
        """Return a full health snapshot for all instances and staged datasets
        under a logical database.

        Returns a dict with keys ``database_id``, ``instances``,
        ``staged_datasets``, and ``summary``.
        """
        instances: list[DHIS2Instance] = (
            db.session.query(DHIS2Instance)
            .filter(DHIS2Instance.database_id == database_id)
            .order_by(DHIS2Instance.display_order, DHIS2Instance.name)
            .all()
        )

        datasets: list[DHIS2StagedDataset] = (
            db.session.query(DHIS2StagedDataset)
            .filter(DHIS2StagedDataset.database_id == database_id)
            .order_by(DHIS2StagedDataset.name)
            .all()
        )

        instance_list = []
        for inst in instances:
            staged_count = (
                db.session.query(DHIS2DatasetVariable)
                .filter(DHIS2DatasetVariable.instance_id == inst.id)
                .distinct(DHIS2DatasetVariable.staged_dataset_id)
                .count()
            )
            instance_list.append(
                {
                    "id": inst.id,
                    "name": inst.name,
                    "url": inst.url,
                    "is_active": inst.is_active,
                    "display_order": inst.display_order,
                    "last_test_result": (
                        {
                            "status": inst.last_test_status,
                            "message": inst.last_test_message,
                            "response_time_ms": inst.last_test_response_time_ms,
                            "tested_on": inst.last_tested_on.isoformat()
                            if inst.last_tested_on
                            else None,
                        }
                        if inst.last_test_status
                        or inst.last_test_message
                        or inst.last_tested_on
                        else None
                    ),
                    "staged_dataset_count": staged_count,
                }
            )

        dataset_list = []
        now = datetime.utcnow()
        synced_in_24h = 0
        never_synced = 0

        for ds in datasets:
            table_exists, row_count = self._staging_table_info(ds)
            freshness = self._freshness_minutes(ds)

            if ds.last_sync_at is None:
                never_synced += 1
            elif (now - ds.last_sync_at) <= timedelta(hours=24):
                synced_in_24h += 1

            dataset_list.append(
                {
                    "id": ds.id,
                    "name": ds.name,
                    "is_active": ds.is_active,
                    "last_sync_at": ds.last_sync_at.isoformat() if ds.last_sync_at else None,
                    "last_sync_status": ds.last_sync_status,
                    "last_sync_rows": ds.last_sync_rows,
                    "freshness_minutes": round(freshness, 2) if freshness is not None else None,
                    "staging_table_exists": table_exists,
                    "staging_row_count": row_count,
                    "serving_superset_dataset_id": ds.serving_superset_dataset_id,
                    "recent_jobs": self._recent_jobs(ds.id, limit=3),
                }
            )

        active_instances = sum(1 for i in instances if i.is_active)
        active_datasets = sum(1 for d in datasets if d.is_active)

        summary = {
            "total_instances": len(instances),
            "active_instances": active_instances,
            "total_staged_datasets": len(datasets),
            "active_staged_datasets": active_datasets,
            "datasets_synced_in_24h": synced_in_24h,
            "datasets_never_synced": never_synced,
        }

        return {
            "database_id": database_id,
            "instances": instance_list,
            "staged_datasets": dataset_list,
            "summary": summary,
        }

    def get_instance_diagnostic(self, instance_id: int) -> dict[str, Any]:
        """Detailed diagnostic for one instance.

        Includes connection test (live), dataset variables count, and last sync info
        across all datasets that reference this instance.
        """
        from superset.dhis2.instance_service import (
            get_instance,
            test_instance_connection,
        )

        instance = get_instance(instance_id)
        if instance is None:
            raise ValueError(f"DHIS2Instance with id={instance_id} not found")

        # Live connection test.
        try:
            connection_test = test_instance_connection(instance_id)
        except Exception as exc:  # pylint: disable=broad-except
            connection_test = {
                "success": False,
                "message": str(exc),
                "response_time_ms": None,
            }

        variable_count = self._variable_count_for_instance(instance_id)

        # Gather unique staged datasets that reference this instance.
        dataset_ids = [
            row[0]
            for row in db.session.query(DHIS2DatasetVariable.staged_dataset_id)
            .filter(DHIS2DatasetVariable.instance_id == instance_id)
            .distinct()
            .all()
        ]

        referenced_datasets = []
        for ds_id in dataset_ids:
            ds = db.session.get(DHIS2StagedDataset, ds_id)
            if ds is None:
                continue
            # Last sync job for this instance-dataset pair – most recent job.
            last_job = (
                db.session.query(DHIS2SyncJob)
                .filter_by(staged_dataset_id=ds_id)
                .order_by(DHIS2SyncJob.created_on.desc())
                .first()
            )
            referenced_datasets.append(
                {
                    "staged_dataset_id": ds.id,
                    "staged_dataset_name": ds.name,
                    "last_sync_at": ds.last_sync_at.isoformat() if ds.last_sync_at else None,
                    "last_sync_status": ds.last_sync_status,
                    "last_job_id": last_job.id if last_job else None,
                }
            )

        return {
            "instance": instance.to_json(),
            "connection_test": connection_test,
            "variable_count": variable_count,
            "referenced_datasets": referenced_datasets,
        }

    def get_sync_history(
        self,
        database_id: int,
        limit: int = 50,
        dataset_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """Return recent sync job history across staged datasets for a database.

        Args:
            database_id: Filter to staged datasets owned by this Superset DB.
            limit: Maximum number of jobs to return.
            dataset_id: When provided, restrict to a single staged dataset.
        """
        dataset_rows = (
            db.session.query(DHIS2StagedDataset.id, DHIS2StagedDataset.name)
            .filter(DHIS2StagedDataset.database_id == database_id)
            .all()
        )
        dataset_lookup = {ds_id: name for ds_id, name in dataset_rows}
        dataset_ids = list(dataset_lookup)

        if not dataset_ids:
            return []

        q = db.session.query(DHIS2SyncJob).filter(
            DHIS2SyncJob.staged_dataset_id.in_(dataset_ids)
        )
        if dataset_id is not None:
            q = q.filter(DHIS2SyncJob.staged_dataset_id == dataset_id)

        jobs = q.order_by(DHIS2SyncJob.created_on.desc()).limit(limit).all()
        return [
            {
                **j.to_json(),
                "staged_dataset_name": dataset_lookup.get(j.staged_dataset_id),
            }
            for j in jobs
        ]

    def get_active_sync_jobs(self, database_id: int) -> list[dict[str, Any]]:
        """Return all currently running or queued sync jobs for a database."""
        dataset_rows = (
            db.session.query(DHIS2StagedDataset.id, DHIS2StagedDataset.name)
            .filter(DHIS2StagedDataset.database_id == database_id)
            .all()
        )
        dataset_lookup = {ds_id: name for ds_id, name in dataset_rows}
        dataset_ids = list(dataset_lookup)
        if not dataset_ids:
            return []

        jobs = (
            db.session.query(DHIS2SyncJob)
            .filter(
                DHIS2SyncJob.staged_dataset_id.in_(dataset_ids),
                DHIS2SyncJob.status.in_(["running", "queued", "pending"]),
            )
            .order_by(DHIS2SyncJob.created_on.desc())
            .all()
        )
        return [
            {
                **j.to_json(),
                "staged_dataset_name": dataset_lookup.get(j.staged_dataset_id),
            }
            for j in jobs
        ]

    def get_stale_datasets(
        self,
        database_id: int,
        threshold_hours: int = 25,
    ) -> list[dict[str, Any]]:
        """Return datasets whose data is older than *threshold_hours* or never synced."""
        datasets: list[DHIS2StagedDataset] = (
            db.session.query(DHIS2StagedDataset)
            .filter(
                DHIS2StagedDataset.database_id == database_id,
                DHIS2StagedDataset.is_active.is_(True),
            )
            .all()
        )

        cutoff = datetime.utcnow() - timedelta(hours=threshold_hours)
        stale = []

        for ds in datasets:
            if ds.last_sync_at is None or ds.last_sync_at < cutoff:
                freshness = self._freshness_minutes(ds)
                stale.append(
                    {
                        "id": ds.id,
                        "name": ds.name,
                        "last_sync_at": ds.last_sync_at.isoformat() if ds.last_sync_at else None,
                        "last_sync_status": ds.last_sync_status,
                        "freshness_minutes": (
                            round(freshness, 2) if freshness is not None else None
                        ),
                        "threshold_hours": threshold_hours,
                    }
                )

        return stale

    def get_admin_summary(self) -> dict[str, Any]:
        """System-wide summary for admin dashboard.

        Returns aggregate counts across all databases.
        """
        total_instances = db.session.query(DHIS2Instance).count()
        active_instances = (
            db.session.query(DHIS2Instance)
            .filter(DHIS2Instance.is_active.is_(True))
            .count()
        )
        total_datasets = db.session.query(DHIS2StagedDataset).count()
        active_datasets = (
            db.session.query(DHIS2StagedDataset)
            .filter(DHIS2StagedDataset.is_active.is_(True))
            .count()
        )

        cutoff_24h = datetime.utcnow() - timedelta(hours=24)
        synced_24h = (
            db.session.query(DHIS2StagedDataset)
            .filter(DHIS2StagedDataset.last_sync_at >= cutoff_24h)
            .count()
        )
        never_synced = (
            db.session.query(DHIS2StagedDataset)
            .filter(DHIS2StagedDataset.last_sync_at.is_(None))
            .count()
        )

        total_jobs = db.session.query(DHIS2SyncJob).count()
        failed_jobs_24h = (
            db.session.query(DHIS2SyncJob)
            .filter(
                DHIS2SyncJob.status == "failed",
                DHIS2SyncJob.created_on >= cutoff_24h,
            )
            .count()
        )

        return {
            "total_instances": total_instances,
            "active_instances": active_instances,
            "total_staged_datasets": total_datasets,
            "active_staged_datasets": active_datasets,
            "datasets_synced_in_24h": synced_24h,
            "datasets_never_synced": never_synced,
            "total_sync_jobs": total_jobs,
            "failed_sync_jobs_in_24h": failed_jobs_24h,
        }
