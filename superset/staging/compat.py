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
"""Compatibility helpers that mirror DHIS2-specific rows into generic staging metadata."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from superset import db
from superset.staging.models import (
    DHIS2LogicalDatabase,
    DatasetMaterialization,
    DatasetMetricMapping,
    SchedulePolicy,
    StagedDataset,
    StagedDatasetDimension,
    StagedDatasetField,
    StagedSource,
    SyncJob,
    SyncJobSource,
)

logger = logging.getLogger(__name__)


def _slugify(value: str | None, fallback: str) -> str:
    if not value:
        return fallback
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or fallback


def _json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value)


def _model_value(obj: Any, field: str, default: Any = None) -> Any:
    """Read mapped attributes without forcing descriptor evaluation."""

    data = getattr(obj, "__dict__", None)
    if isinstance(data, dict) and field in data:
        return data[field]
    return default


def ensure_staged_source(
    *,
    source_type: str,
    source_connection_id: int | None,
    source_name: str,
    connection_key: str | None = None,
    config: dict[str, Any] | None = None,
) -> StagedSource:
    """Get or create a generic staged-source record."""

    query = db.session.query(StagedSource).filter(
        StagedSource.source_type == source_type,
        StagedSource.source_connection_id == source_connection_id,
        StagedSource.source_name == source_name,
    )
    source = query.one_or_none()
    if source is None:
        source = StagedSource(
            source_type=source_type,
            source_connection_id=source_connection_id,
            source_name=source_name,
            connection_key=connection_key,
            config_json=_json_dumps(config),
            is_active=True,
        )
        db.session.add(source)
        db.session.flush()
    else:
        source.connection_key = connection_key
        if config is not None:
            source.config_json = _json_dumps(config)
        source.is_active = True
    return source


def ensure_dhis2_logical_database(
    database_id: int,
    *,
    source_name: str | None = None,
    description: str | None = None,
) -> DHIS2LogicalDatabase:
    """Ensure the generic DHIS2 logical database row exists."""

    logical_database = (
        db.session.query(DHIS2LogicalDatabase)
        .filter(DHIS2LogicalDatabase.database_id == database_id)
        .one_or_none()
    )
    if logical_database is not None:
        if source_name:
            logical_database.name = source_name
        if description is not None:
            logical_database.description = description
        return logical_database

    source = ensure_staged_source(
        source_type="dhis2",
        source_connection_id=database_id,
        source_name=source_name or f"DHIS2 database {database_id}",
        connection_key=f"db:{database_id}",
        config={"database_id": database_id},
    )
    logical_database = DHIS2LogicalDatabase(
        database_id=database_id,
        staged_source_id=source.id,
        name=source.source_name,
        description=description,
    )
    db.session.add(logical_database)
    db.session.flush()
    return logical_database


def sync_dhis2_instance(instance: Any) -> DHIS2LogicalDatabase:
    """Mirror a DHIS2 instance into the generic logical-database model."""

    database_id = _model_value(instance, "database_id")
    if database_id is None:
        logger.debug("Skipping DHIS2 instance compatibility sync with no database_id")
        return DHIS2LogicalDatabase()

    logical_database = ensure_dhis2_logical_database(
        database_id,
        source_name=f"DHIS2 logical database {database_id}",
    )
    instance.logical_database_id = logical_database.id
    return logical_database


def _ensure_schedule_policy(dataset: Any) -> SchedulePolicy:
    generic_dataset = _model_value(dataset, "generic_dataset")
    policy = _model_value(generic_dataset, "schedule_policy") if generic_dataset is not None else None
    if policy is not None:
        pass
    else:
        policy = SchedulePolicy(
            schedule_type="cron",
            refresh_enabled=True,
            refresh_scope="full",
            is_managed=True,
        )
        db.session.add(policy)
        db.session.flush()
    policy.cron_expression = _model_value(dataset, "schedule_cron")
    policy.timezone = _model_value(dataset, "schedule_timezone") or "UTC"
    policy.refresh_enabled = True
    policy.config_json = _json_dumps(
        {
            "source_type": "dhis2",
            "dataset_id": _model_value(dataset, "id"),
            "auto_enabled": True,
        }
    )
    return policy


def _upsert_dataset_dimensions(generic_dataset: StagedDataset, dataset_config: dict[str, Any]) -> None:
    definitions = [
        ("period", "Period", "temporal", "pe", 10),
        ("org_unit", "Organisation Unit", "categorical", "ou", 20),
        ("source_instance", "Source Instance", "source", "source_instance_id", 30),
    ]
    for dimension_key, label, dimension_type, source_field_name, display_order in definitions:
        dimension = (
            db.session.query(StagedDatasetDimension)
            .filter(
                StagedDatasetDimension.dataset_id == generic_dataset.id,
                StagedDatasetDimension.dimension_key == dimension_key,
            )
            .one_or_none()
        )
        if dimension is None:
            dimension = StagedDatasetDimension(
                dataset_id=generic_dataset.id,
                dimension_key=dimension_key,
            )
            db.session.add(dimension)
        dimension.dimension_label = label
        dimension.dimension_type = dimension_type
        dimension.source_field_name = source_field_name
        dimension.display_order = display_order
        dimension.is_active = True
        dimension.config_json = _json_dumps(dataset_config)


def _ensure_dataset_materialization(
    generic_dataset: StagedDataset,
    *,
    schema_name: str | None,
    object_name: str | None,
    last_refreshed_at: datetime | None,
) -> None:
    if not object_name:
        return
    materialization = (
        db.session.query(DatasetMaterialization)
        .filter(
            DatasetMaterialization.dataset_id == generic_dataset.id,
            DatasetMaterialization.object_name == object_name,
        )
        .one_or_none()
    )
    if materialization is None:
        materialization = DatasetMaterialization(
            dataset_id=generic_dataset.id,
            object_name=object_name,
        )
        db.session.add(materialization)
    materialization.object_type = "table"
    materialization.object_schema_name = schema_name
    materialization.is_primary = True
    materialization.is_active = True
    materialization.refresh_strategy = "replace"
    materialization.last_refreshed_at = last_refreshed_at


def sync_dhis2_staged_dataset(dataset: Any) -> StagedDataset:
    """Mirror a DHIS2 staged dataset into the generic staged-dataset model."""

    database_id = _model_value(dataset, "database_id")
    if database_id is None:
        logger.debug("Skipping DHIS2 staged dataset compatibility sync with no database_id")
        return StagedDataset()

    logical_database = ensure_dhis2_logical_database(database_id)
    dataset.logical_database_id = logical_database.id

    dataset_id = _model_value(dataset, "id", "new")
    dataset_name = _model_value(dataset, "name")
    generic_dataset = None
    generic_dataset_id = _model_value(dataset, "generic_dataset_id")
    if generic_dataset_id is not None:
        generic_dataset = db.session.get(StagedDataset, generic_dataset_id)
    if generic_dataset is None:
        generic_dataset = (
            db.session.query(StagedDataset)
            .filter(
                StagedDataset.source_type == "dhis2",
                StagedDataset.staged_source_id == logical_database.staged_source_id,
                StagedDataset.slug == _slugify(dataset_name, f"dhis2-dataset-{dataset_id}"),
            )
            .one_or_none()
        )
    if generic_dataset is None:
        generic_dataset = StagedDataset(
            source_type="dhis2",
            staged_source_id=logical_database.staged_source_id,
            dhis2_logical_database_id=logical_database.id,
            name=dataset_name,
            slug=_slugify(dataset_name, f"dhis2-dataset-{dataset_id}"),
        )
        db.session.add(generic_dataset)
        db.session.flush()

    generic_dataset.source_type = "dhis2"
    generic_dataset.staged_source_id = logical_database.staged_source_id
    generic_dataset.dhis2_logical_database_id = logical_database.id
    generic_dataset.name = dataset_name
    generic_dataset.slug = _slugify(dataset_name, f"dhis2-dataset-{dataset_id}")
    generic_dataset.description = _model_value(dataset, "description")
    generic_dataset.dataset_mode = "dhis2_analytics_stage"
    generic_dataset.stage_schema_name = "dhis2_staging"
    generic_dataset.primary_serving_object_name = _model_value(dataset, "staging_table_name")
    generic_dataset.refresh_enabled = True
    generic_dataset.created_by_fk = _model_value(dataset, "created_by_fk")
    generic_dataset.changed_by_fk = _model_value(dataset, "changed_by_fk")
    generic_dataset.config_json = _json_dumps(dataset.get_dataset_config())
    last_sync_status = _model_value(dataset, "last_sync_status")
    last_sync_at = _model_value(dataset, "last_sync_at")
    if last_sync_status and last_sync_at:
        generic_dataset.mark_sync(last_sync_status, last_sync_at)
    else:
        generic_dataset.last_sync_status = last_sync_status
    policy = _ensure_schedule_policy(dataset)
    generic_dataset.schedule_policy_id = policy.id

    dataset.generic_dataset_id = generic_dataset.id

    _upsert_dataset_dimensions(generic_dataset, dataset.get_dataset_config())
    _ensure_dataset_materialization(
        generic_dataset,
        schema_name="dhis2_staging",
        object_name=_model_value(dataset, "staging_table_name"),
        last_refreshed_at=last_sync_at,
    )
    return generic_dataset


def _upsert_metric_mapping(field: StagedDatasetField) -> None:
    metric_key = field.canonical_metric_key or field.dataset_alias
    mapping = (
        db.session.query(DatasetMetricMapping)
        .filter(
            DatasetMetricMapping.dataset_id == field.dataset_id,
            DatasetMetricMapping.canonical_metric_key == metric_key,
        )
        .one_or_none()
    )
    if mapping is None:
        mapping = DatasetMetricMapping(
            dataset_id=field.dataset_id,
            canonical_metric_key=metric_key,
        )
        db.session.add(mapping)
    mapping.dataset_field_id = field.id
    mapping.metric_label = field.source_field_label or field.dataset_alias
    mapping.aggregation_type = field.aggregation_type
    mapping.expression = field.dataset_alias
    mapping.is_default = True


def sync_dhis2_dataset_variable(variable: Any) -> StagedDatasetField:
    """Mirror a DHIS2 dataset variable into the generic staged-field model."""

    dataset = _model_value(variable, "staged_dataset")
    if dataset is None:
        staged_dataset_id = _model_value(variable, "staged_dataset_id")
        if staged_dataset_id is not None:
            from superset.dhis2.models import DHIS2StagedDataset

            dataset = db.session.get(DHIS2StagedDataset, staged_dataset_id)
    if dataset is None:
        logger.debug("Skipping DHIS2 variable compatibility sync with no dataset")
        return StagedDatasetField()

    generic_dataset = sync_dhis2_staged_dataset(dataset)
    field = None
    generic_field_id = _model_value(variable, "generic_field_id")
    if generic_field_id is not None:
        field = db.session.get(StagedDatasetField, generic_field_id)
    if field is None:
        field = (
            db.session.query(StagedDatasetField)
            .filter(
                StagedDatasetField.dataset_id == generic_dataset.id,
                StagedDatasetField.field_kind == "dhis2_variable",
                StagedDatasetField.source_instance_id == _model_value(variable, "instance_id"),
                StagedDatasetField.source_field_id == _model_value(variable, "variable_id"),
            )
            .one_or_none()
        )
    if field is None:
        field = StagedDatasetField(
            dataset_id=generic_dataset.id,
            field_kind="dhis2_variable",
            source_instance_id=_model_value(variable, "instance_id"),
            staged_source_id=generic_dataset.staged_source_id,
            source_field_id=_model_value(variable, "variable_id"),
            source_field_name=_model_value(variable, "variable_name")
            or _model_value(variable, "variable_id"),
            dataset_alias=_model_value(variable, "alias")
            or _model_value(variable, "variable_name")
            or _model_value(variable, "variable_id"),
        )
        db.session.add(field)
        db.session.flush()

    field.dataset_id = generic_dataset.id
    field.field_kind = "dhis2_variable"
    field.source_instance_id = _model_value(variable, "instance_id")
    field.staged_source_id = generic_dataset.staged_source_id
    field.source_object_name = _model_value(variable, "variable_type")
    field.source_field_name = _model_value(variable, "variable_name") or _model_value(
        variable, "variable_id"
    )
    field.source_field_id = _model_value(variable, "variable_id")
    field.source_field_code = variable.get_extra_params().get("code")
    field.source_field_label = (
        _model_value(variable, "variable_name")
        or _model_value(variable, "alias")
        or _model_value(variable, "variable_id")
    )
    field.dataset_alias = (
        _model_value(variable, "alias")
        or _model_value(variable, "variable_name")
        or _model_value(variable, "variable_id")
    )
    field.canonical_metric_key = _slugify(
        _model_value(variable, "alias")
        or _model_value(variable, "variable_name")
        or _model_value(variable, "variable_id"),
        _model_value(variable, "variable_id"),
    ).replace("-", "_")
    field.comparison_group = f"instance:{_model_value(variable, 'instance_id')}"
    field.value_type = variable.get_extra_params().get("value_type")
    field.aggregation_type = variable.get_extra_params().get("aggregation_type", "sum")
    field.is_required = bool(variable.get_extra_params().get("required", False))
    field.is_active = True
    field.display_order = _model_value(variable, "id", 0) or 0
    field.config_json = _json_dumps(variable.get_extra_params())

    variable.generic_field_id = field.id
    _upsert_metric_mapping(field)
    return field


def _sync_job_sources(generic_job: SyncJob, result_payload: dict[str, Any] | None) -> None:
    instances = (result_payload or {}).get("instances", {})
    for source_key, source_result in instances.items():
        try:
            source_instance_id = int(source_key)
        except (TypeError, ValueError):
            source_instance_id = None
        source_row = (
            db.session.query(SyncJobSource)
            .filter(
                SyncJobSource.sync_job_id == generic_job.id,
                SyncJobSource.source_key == str(source_key),
            )
            .one_or_none()
        )
        if source_row is None:
            source_row = SyncJobSource(
                sync_job_id=generic_job.id,
                dataset_id=generic_job.dataset_id,
                source_key=str(source_key),
            )
            db.session.add(source_row)
        source_row.source_instance_id = source_instance_id
        source_row.status = source_result.get("status", "unknown")
        source_row.rows_inserted = source_result.get("rows")
        source_row.rows_failed = 1 if source_result.get("status") == "failed" else 0
        source_row.error_message = source_result.get("error")
        if source_row.started_at is None and generic_job.started_at is not None:
            source_row.started_at = generic_job.started_at
        if generic_job.completed_at is not None:
            source_row.completed_at = generic_job.completed_at


def sync_dhis2_sync_job(job: Any, result_payload: dict[str, Any] | None = None) -> SyncJob:
    """Mirror a DHIS2 sync job into the generic sync-job model."""

    dataset = _model_value(job, "staged_dataset")
    if dataset is None:
        staged_dataset_id = _model_value(job, "staged_dataset_id")
        if staged_dataset_id is not None:
            from superset.dhis2.models import DHIS2StagedDataset

            dataset = db.session.get(DHIS2StagedDataset, staged_dataset_id)
    if dataset is None or _model_value(dataset, "database_id") is None:
        logger.debug("Skipping DHIS2 sync-job compatibility sync with no dataset")
        return SyncJob()

    generic_dataset = sync_dhis2_staged_dataset(dataset)
    generic_job = None
    generic_sync_job_id = _model_value(job, "generic_sync_job_id")
    if generic_sync_job_id is not None:
        generic_job = db.session.get(SyncJob, generic_sync_job_id)
    if generic_job is None:
        generic_job = SyncJob(
            dataset_id=generic_dataset.id,
            job_type=_model_value(job, "job_type"),
            status=_model_value(job, "status"),
        )
        db.session.add(generic_job)
        db.session.flush()

    generic_job.dataset_id = generic_dataset.id
    generic_job.job_type = _model_value(job, "job_type")
    generic_job.status = _model_value(job, "status")
    generic_job.refresh_scope = "full"
    generic_job.refresh_mode = "replace"
    generic_job.started_at = _model_value(job, "started_at")
    generic_job.completed_at = _model_value(job, "completed_at")
    generic_job.rows_inserted = _model_value(job, "rows_loaded")
    generic_job.rows_failed = _model_value(job, "rows_failed")
    generic_job.error_message = _model_value(job, "error_message")
    generic_job.result_json = _json_dumps(result_payload or job.get_instance_results())
    job.generic_sync_job_id = generic_job.id

    _sync_job_sources(generic_job, result_payload or job.get_instance_results())
    return generic_job
