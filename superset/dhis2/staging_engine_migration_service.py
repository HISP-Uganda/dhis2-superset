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
"""Migration service for staging-engine backend changes."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import logging
from typing import Any, Iterable

from superset import db
from superset.dhis2.models import DHIS2DatasetVariable, DHIS2StagedDataset
from superset.dhis2.serving_build_service import build_serving_table
from superset.dhis2.superset_dataset_service import (
    register_serving_table_as_superset_dataset,
)
from superset.local_staging.platform_settings import (
    ENGINE_CLICKHOUSE,
    ENGINE_DUCKDB,
    ENGINE_SUPERSET_DB,
    LocalStagingSettings,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MigrationAssetRepairResult:
    dataset_id: int
    previous_superset_dataset_id: int | None
    current_superset_dataset_id: int | None
    repaired_charts: int


class StagingEngineMigrationService:
    """Plan and execute staging-engine migrations without ad hoc scripts."""

    def _resolve_engine(self, engine_name: str, database_id: int) -> Any:
        normalized = str(engine_name or "").strip().lower()
        settings = LocalStagingSettings.get()

        if normalized == ENGINE_SUPERSET_DB:
            from superset.local_staging.superset_db_engine import (
                SupersetDBStagingEngine,
            )

            return SupersetDBStagingEngine(database_id)

        if normalized == ENGINE_DUCKDB:
            from superset.local_staging.duckdb_engine import DuckDBStagingEngine

            return DuckDBStagingEngine(database_id, settings.get_duckdb_config())

        if normalized == ENGINE_CLICKHOUSE:
            from superset.local_staging.clickhouse_engine import ClickHouseStagingEngine

            return ClickHouseStagingEngine(database_id, settings.get_clickhouse_config())

        raise ValueError(f"Unsupported staging backend: {engine_name!r}")

    def _load_datasets(
        self,
        dataset_ids: Iterable[int] | None = None,
    ) -> list[DHIS2StagedDataset]:
        query = db.session.query(DHIS2StagedDataset).order_by(DHIS2StagedDataset.id.asc())
        if dataset_ids is not None:
            normalized_ids = [int(dataset_id) for dataset_id in dataset_ids]
            if not normalized_ids:
                return []
            query = query.filter(DHIS2StagedDataset.id.in_(normalized_ids))
        return query.all()

    @staticmethod
    def _row_count(engine: Any, dataset: DHIS2StagedDataset) -> int:
        try:
            stats = engine.get_staging_table_stats(dataset)
        except Exception:  # pylint: disable=broad-except
            return -1
        return int(stats.get("row_count") or 0)

    @staticmethod
    def _group_rows_by_instance(
        rows: list[dict[str, Any]],
    ) -> dict[tuple[int, str], list[dict[str, Any]]]:
        grouped: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            try:
                instance_id = int(row.get("source_instance_id"))
            except (TypeError, ValueError):
                continue
            instance_name = str(row.get("source_instance_name") or "").strip()
            grouped[(instance_id, instance_name)].append(row)
        return grouped

    @staticmethod
    def _source_instance_ids(dataset: DHIS2StagedDataset) -> list[int]:
        instance_ids = (
            db.session.query(DHIS2DatasetVariable.instance_id)
            .filter(DHIS2DatasetVariable.staged_dataset_id == dataset.id)
            .order_by(DHIS2DatasetVariable.instance_id.asc())
            .all()
        )
        return list(
            dict.fromkeys(
                instance_id
                for (instance_id,) in instance_ids
                if instance_id is not None
            )
        )

    def plan_migration(
        self,
        source_backend: str,
        target_backend: str,
        *,
        dataset_ids: Iterable[int] | None = None,
    ) -> dict[str, Any]:
        datasets = self._load_datasets(dataset_ids)
        result: list[dict[str, Any]] = []

        for dataset in datasets:
            source_engine = self._resolve_engine(source_backend, dataset.database_id)
            target_engine = self._resolve_engine(target_backend, dataset.database_id)
            source_exists = bool(source_engine.table_exists(dataset))
            target_exists = bool(target_engine.table_exists(dataset))
            source_rows = self._row_count(source_engine, dataset) if source_exists else 0
            target_rows = self._row_count(target_engine, dataset) if target_exists else 0
            result.append(
                {
                    "dataset_id": dataset.id,
                    "dataset_name": dataset.name,
                    "source_backend": source_backend,
                    "target_backend": target_backend,
                    "source_table": source_engine.get_superset_sql_table_ref(dataset),
                    "target_table": target_engine.get_superset_sql_table_ref(dataset),
                    "source_exists": source_exists,
                    "target_exists": target_exists,
                    "source_rows": source_rows,
                    "target_rows": target_rows,
                    "needs_migration": bool(
                        source_exists and source_rows > 0 and (not target_exists or target_rows <= 0)
                    ),
                    "serving_target": target_engine.get_serving_sql_table_ref(dataset),
                    "serving_superset_dataset_id": dataset.serving_superset_dataset_id,
                }
            )

        logger.info(
            "staging_engine_migration_service: planned migration source=%s target=%s datasets=%s",
            source_backend,
            target_backend,
            len(result),
        )
        return {
            "source_backend": source_backend,
            "target_backend": target_backend,
            "count": len(result),
            "result": result,
        }

    def repair_superset_dataset_references(
        self,
        *,
        target_backend: str,
        dataset_ids: Iterable[int] | None = None,
    ) -> dict[str, Any]:
        from superset.models.slice import Slice

        datasets = self._load_datasets(dataset_ids)
        repairs: list[MigrationAssetRepairResult] = []

        for dataset in datasets:
            target_engine = self._resolve_engine(target_backend, dataset.database_id)
            if not target_engine.serving_table_exists(dataset):
                continue

            serving_db = target_engine.get_or_create_superset_database()
            current_columns = target_engine.get_serving_table_columns(dataset)
            previous_sqla_id = dataset.serving_superset_dataset_id
            current_sqla_id = register_serving_table_as_superset_dataset(
                dataset_id=dataset.id,
                dataset_name=dataset.name,
                serving_table_ref=target_engine.get_serving_sql_table_ref(dataset),
                serving_columns=current_columns,
                serving_database_id=getattr(serving_db, "id", None),
                source_database_id=dataset.database_id,
                source_instance_ids=self._source_instance_ids(dataset),
            )

            repaired_charts = 0
            if previous_sqla_id and previous_sqla_id != current_sqla_id:
                repaired_charts = (
                    db.session.query(Slice)
                    .filter(
                        Slice.datasource_type == "table",
                        Slice.datasource_id == previous_sqla_id,
                    )
                    .update({"datasource_id": current_sqla_id}, synchronize_session=False)
                )

            if dataset.serving_superset_dataset_id != current_sqla_id:
                dataset.serving_superset_dataset_id = current_sqla_id

            repairs.append(
                MigrationAssetRepairResult(
                    dataset_id=dataset.id,
                    previous_superset_dataset_id=previous_sqla_id,
                    current_superset_dataset_id=current_sqla_id,
                    repaired_charts=repaired_charts,
                )
            )

        db.session.commit()
        return {
            "target_backend": target_backend,
            "result": [
                {
                    "dataset_id": item.dataset_id,
                    "previous_superset_dataset_id": item.previous_superset_dataset_id,
                    "current_superset_dataset_id": item.current_superset_dataset_id,
                    "repaired_charts": item.repaired_charts,
                }
                for item in repairs
            ],
        }

    def repair_chart_dashboard_sqllab_references(
        self,
        *,
        target_backend: str,
        dataset_ids: Iterable[int] | None = None,
    ) -> dict[str, Any]:
        return self.repair_superset_dataset_references(
            target_backend=target_backend,
            dataset_ids=dataset_ids,
        )

    def rebuild_serving_from_staging(
        self,
        *,
        target_backend: str,
        dataset_ids: Iterable[int] | None = None,
    ) -> dict[str, Any]:
        datasets = self._load_datasets(dataset_ids)
        result: list[dict[str, Any]] = []

        for dataset in datasets:
            target_engine = self._resolve_engine(target_backend, dataset.database_id)
            if not target_engine.table_exists(dataset):
                result.append(
                    {
                        "dataset_id": dataset.id,
                        "dataset_name": dataset.name,
                        "status": "skipped",
                        "reason": "Target staging table does not exist",
                    }
                )
                continue

            build_result = build_serving_table(dataset, engine=target_engine)
            result.append(
                {
                    "dataset_id": dataset.id,
                    "dataset_name": dataset.name,
                    "status": "ok",
                    "source_rows": build_result.diagnostics.get("source_row_count"),
                    "target_rows": build_result.diagnostics.get("live_serving_row_count"),
                    "serving_table": build_result.serving_table_ref,
                }
            )

        repair_summary = self.repair_superset_dataset_references(
            target_backend=target_backend,
            dataset_ids=[item["dataset_id"] for item in result if item["status"] == "ok"],
        )
        return {
            "target_backend": target_backend,
            "result": result,
            "asset_repairs": repair_summary["result"],
        }

    def migrate_staging_objects(
        self,
        *,
        source_backend: str,
        target_backend: str,
        dataset_ids: Iterable[int] | None = None,
        batch_size: int = 5000,
        replace_existing: bool = False,
    ) -> dict[str, Any]:
        datasets = self._load_datasets(dataset_ids)
        results: list[dict[str, Any]] = []

        for dataset in datasets:
            source_engine = self._resolve_engine(source_backend, dataset.database_id)
            target_engine = self._resolve_engine(target_backend, dataset.database_id)
            if source_backend == target_backend:
                results.append(
                    {
                        "dataset_id": dataset.id,
                        "dataset_name": dataset.name,
                        "status": "skipped",
                        "reason": "Source and target backends are identical",
                    }
                )
                continue

            if not source_engine.table_exists(dataset):
                results.append(
                    {
                        "dataset_id": dataset.id,
                        "dataset_name": dataset.name,
                        "status": "skipped",
                        "reason": "Source staging table does not exist",
                    }
                )
                continue

            source_rows = self._row_count(source_engine, dataset)
            target_rows = self._row_count(target_engine, dataset) if target_engine.table_exists(dataset) else 0
            if source_rows <= 0:
                results.append(
                    {
                        "dataset_id": dataset.id,
                        "dataset_name": dataset.name,
                        "status": "skipped",
                        "reason": "Source staging table is empty",
                    }
                )
                continue

            if target_rows > 0 and not replace_existing:
                results.append(
                    {
                        "dataset_id": dataset.id,
                        "dataset_name": dataset.name,
                        "status": "skipped",
                        "reason": "Target staging table already has rows",
                        "source_rows": source_rows,
                        "target_rows": target_rows,
                    }
                )
                continue

            target_engine.create_staging_table(dataset)
            if replace_existing and target_engine.table_exists(dataset):
                target_engine.truncate_staging_table(dataset)

            imported = 0
            offset = 0
            while True:
                batch = list(
                    source_engine.fetch_staging_rows(
                        dataset,
                        limit=batch_size,
                        offset=offset,
                    )
                )
                if not batch:
                    break

                grouped_rows = self._group_rows_by_instance(batch)
                for (instance_id, instance_name), rows in grouped_rows.items():
                    imported += int(
                        target_engine.insert_rows(
                            dataset,
                            instance_id,
                            instance_name,
                            rows,
                        )
                    )
                offset += len(batch)

            build_result = build_serving_table(dataset, engine=target_engine)
            results.append(
                {
                    "dataset_id": dataset.id,
                    "dataset_name": dataset.name,
                    "status": "ok",
                    "source_rows": source_rows,
                    "imported": imported,
                    "target_rows": self._row_count(target_engine, dataset),
                    "serving_rows": build_result.diagnostics.get("live_serving_row_count"),
                    "serving_table": build_result.serving_table_ref,
                }
            )

        repair_summary = self.repair_superset_dataset_references(
            target_backend=target_backend,
            dataset_ids=[item["dataset_id"] for item in results if item["status"] == "ok"],
        )
        return {
            "source_backend": source_backend,
            "target_backend": target_backend,
            "result": results,
            "asset_repairs": repair_summary["result"],
        }

    def migrate_serving_objects(
        self,
        *,
        source_backend: str,
        target_backend: str,
        dataset_ids: Iterable[int] | None = None,
        batch_size: int = 5000,
        replace_existing: bool = False,
    ) -> dict[str, Any]:
        return self.migrate_staging_objects(
            source_backend=source_backend,
            target_backend=target_backend,
            dataset_ids=dataset_ids,
            batch_size=batch_size,
            replace_existing=replace_existing,
        )

    def verify_migration(
        self,
        *,
        source_backend: str,
        target_backend: str,
        dataset_ids: Iterable[int] | None = None,
    ) -> dict[str, Any]:
        plan = self.plan_migration(
            source_backend=source_backend,
            target_backend=target_backend,
            dataset_ids=dataset_ids,
        )
        verification: list[dict[str, Any]] = []
        for item in plan["result"]:
            verification.append(
                {
                    **item,
                    "verified": bool(item["source_rows"] <= 0 or item["target_rows"] >= item["source_rows"]),
                }
            )
        return {
            **plan,
            "result": verification,
        }

    def rollback_migration(
        self,
        *,
        target_backend: str,
        dataset_ids: Iterable[int] | None = None,
        drop_serving_tables: bool = False,
    ) -> dict[str, Any]:
        datasets = self._load_datasets(dataset_ids)
        result: list[dict[str, Any]] = []

        for dataset in datasets:
            target_engine = self._resolve_engine(target_backend, dataset.database_id)
            if not target_engine.table_exists(dataset):
                result.append(
                    {
                        "dataset_id": dataset.id,
                        "dataset_name": dataset.name,
                        "status": "skipped",
                        "reason": "Target staging table does not exist",
                    }
                )
                continue

            target_engine.truncate_staging_table(dataset)
            if drop_serving_tables and target_engine.serving_table_exists(dataset):
                try:
                    target_engine.drop_serving_table(dataset)
                except AttributeError:
                    logger.info(
                        "staging_engine_migration_service: engine=%s does not support serving drop for dataset=%s",
                        target_backend,
                        dataset.id,
                    )

            result.append(
                {
                    "dataset_id": dataset.id,
                    "dataset_name": dataset.name,
                    "status": "rolled_back",
                    "target_backend": target_backend,
                }
            )

        return {
            "target_backend": target_backend,
            "result": result,
        }
