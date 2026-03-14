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
"""Raw-stage lineage persistence for generic staged datasets."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Any

from superset import db
from superset.staging.compat import (
    sync_dhis2_dataset_variable,
    sync_dhis2_staged_dataset,
    sync_dhis2_sync_job,
)
from superset.staging.models import (
    StageLoadBatch,
    StageObservation,
    StagePartition,
    StagedDatasetField,
    SyncJob,
)

logger = logging.getLogger(__name__)


def _hash_row(row: dict[str, Any]) -> str:
    key = "|".join(
        str(row.get(part) or "")
        for part in ("instance_id", "dx_uid", "pe", "ou", "co_uid", "aoc_uid", "value")
    )
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _coerce_boolean(raw_value: Any) -> bool | None:
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, str):
        normalized = raw_value.strip().lower()
        if normalized == "true":
            return True
        if normalized == "false":
            return False
    return None


def record_dhis2_stage_rows(
    *,
    dataset: Any,
    instance: Any,
    rows: list[dict[str, Any]],
    sync_job_id: int | None = None,
) -> int:
    """Persist normalized DHIS2 rows into the generic raw-stage layer.

    This path is intentionally best-effort. If the generic staging tables have
    not been migrated yet, the legacy DHIS2 serving table remains authoritative
    and sync should still succeed.
    """

    now = datetime.utcnow()
    try:
        with db.session.begin_nested():
            generic_dataset = sync_dhis2_staged_dataset(dataset)
            generic_job: SyncJob | None = None

            if sync_job_id is not None:
                from superset.dhis2.models import DHIS2SyncJob

                legacy_job = db.session.get(DHIS2SyncJob, sync_job_id)
                if legacy_job is not None:
                    generic_job = sync_dhis2_sync_job(legacy_job)

            if generic_job is None:
                generic_job = SyncJob(
                    dataset_id=generic_dataset.id,
                    job_type="materialization",
                    status="running",
                    refresh_scope="source_subset",
                    refresh_mode="replace",
                    started_at=now,
                )
                db.session.add(generic_job)
                db.session.flush()

            field_map = {
                field.source_field_id: field
                for field in (
                    db.session.query(StagedDatasetField)
                    .filter(
                        StagedDatasetField.dataset_id == generic_dataset.id,
                        StagedDatasetField.field_kind == "dhis2_variable",
                    )
                    .all()
                )
            }
            if not field_map:
                for variable in getattr(dataset, "variables", []) or []:
                    sync_dhis2_dataset_variable(variable)
                field_map = {
                    field.source_field_id: field
                    for field in (
                        db.session.query(StagedDatasetField)
                        .filter(
                            StagedDatasetField.dataset_id == generic_dataset.id,
                            StagedDatasetField.field_kind == "dhis2_variable",
                        )
                        .all()
                    )
                }

            batch = StageLoadBatch(
                dataset_id=generic_dataset.id,
                sync_job_id=generic_job.id,
                batch_key=f"dataset:{generic_dataset.id}:instance:{instance.id}:job:{generic_job.id}",
                batch_status="completed",
                refresh_scope="source_subset",
                row_count=len(rows),
                inserted_count=len(rows),
                started_at=now,
                completed_at=now,
            )
            db.session.add(batch)
            db.session.flush()

            (
                db.session.query(StageObservation)
                .filter(
                    StageObservation.dataset_id == generic_dataset.id,
                    StageObservation.source_instance_id == instance.id,
                )
                .delete(synchronize_session=False)
            )

            observation_mappings: list[dict[str, Any]] = []
            for row in rows:
                field = field_map.get(row.get("dx_uid"))
                if field is None:
                    continue
                raw_value = row.get("value")
                observation_mappings.append(
                    {
                        "dataset_id": generic_dataset.id,
                        "dataset_field_id": field.id,
                        "source_type": "dhis2",
                        "staged_source_id": generic_dataset.staged_source_id,
                        "source_instance_id": instance.id,
                        "sync_job_id": generic_job.id,
                        "load_batch_id": batch.id,
                        "period_key": row.get("pe"),
                        "org_unit_uid": row.get("ou"),
                        "org_unit_name": row.get("ou_name"),
                        "dimension_key": "dx_uid",
                        "dimension_value": row.get("dx_uid"),
                        "value_text": raw_value,
                        "value_numeric": row.get("value_numeric"),
                        "value_boolean": _coerce_boolean(raw_value),
                        "source_row_hash": _hash_row(row),
                        "ingested_at": now,
                        "last_synced_at": now,
                    }
                )

            if observation_mappings:
                db.session.bulk_insert_mappings(StageObservation, observation_mappings)

            partition = (
                db.session.query(StagePartition)
                .filter(
                    StagePartition.dataset_id == generic_dataset.id,
                    StagePartition.partition_name == f"dataset_{generic_dataset.id}",
                )
                .one_or_none()
            )
            if partition is None:
                partition = StagePartition(
                    dataset_id=generic_dataset.id,
                    partition_name=f"dataset_{generic_dataset.id}",
                    partition_key=str(generic_dataset.id),
                )
                db.session.add(partition)
            partition.row_count = (
                db.session.query(StageObservation)
                .filter(StageObservation.dataset_id == generic_dataset.id)
                .count()
            )
            partition.last_analyzed_at = now

            generic_job.status = "success"
            generic_job.completed_at = now
            generic_job.rows_inserted = len(observation_mappings)
            batch.inserted_count = len(observation_mappings)
            batch.row_count = len(observation_mappings)
            return len(observation_mappings)
    except Exception:  # pylint: disable=broad-except
        logger.debug(
            "Skipping raw-stage persistence for dataset=%s instance=%s; generic stage storage unavailable",
            getattr(dataset, "id", None),
            getattr(instance, "id", None),
            exc_info=True,
        )
        return 0
