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
"""Generic metadata models for staged-source ingestion and local serving."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from flask_appbuilder import Model
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.types import Text

from superset import security_manager


def _json_loads(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}


def _slugify(value: str | None) -> str | None:
    if not value:
        return None
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or None


class StagedSource(Model):
    """Generic source registry used by staged datasets."""

    __tablename__ = "staged_sources"

    __table_args__ = (
        UniqueConstraint(
            "source_type",
            "source_connection_id",
            "source_name",
            name="uq_staged_sources_type_connection_name",
        ),
        sa.Index("ix_staged_sources_source_type", "source_type"),
        sa.Index("ix_staged_sources_connection_id", "source_connection_id"),
        sa.Index("ix_staged_sources_is_active", "is_active"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    source_type = sa.Column(sa.String(64), nullable=False)
    source_connection_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dbs.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_name = sa.Column(sa.String(255), nullable=False)
    connection_key = sa.Column(sa.String(255), nullable=True)
    config_json = sa.Column(Text, nullable=True)
    is_active = sa.Column(sa.Boolean, default=True, nullable=False)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    database = relationship("Database", foreign_keys=[source_connection_id])
    logical_databases: list[DHIS2LogicalDatabase] = relationship(
        "DHIS2LogicalDatabase",
        back_populates="staged_source",
        passive_deletes=True,
    )
    datasets: list[StagedDataset] = relationship(
        "StagedDataset",
        back_populates="staged_source",
        passive_deletes=True,
    )
    fields: list[StagedDatasetField] = relationship(
        "StagedDatasetField",
        back_populates="staged_source",
        passive_deletes=True,
    )
    metadata_cache_entries: list[SourceMetadataCache] = relationship(
        "SourceMetadataCache",
        back_populates="staged_source",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def get_config(self) -> dict[str, Any]:
        return _json_loads(self.config_json)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source_type": self.source_type,
            "source_connection_id": self.source_connection_id,
            "source_name": self.source_name,
            "connection_key": self.connection_key,
            "is_active": self.is_active,
            "config": self.get_config(),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class DHIS2LogicalDatabase(Model):
    """DHIS2 federation root anchored to one Superset database connection."""

    __tablename__ = "dhis2_logical_databases"

    __table_args__ = (
        UniqueConstraint("database_id", name="uq_dhis2_logical_databases_database_id"),
        UniqueConstraint(
            "staged_source_id", name="uq_dhis2_logical_databases_staged_source_id"
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    database_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dbs.id", ondelete="CASCADE"),
        nullable=False,
    )
    staged_source_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    database = relationship("Database", foreign_keys=[database_id])
    staged_source: StagedSource = relationship(
        "StagedSource",
        back_populates="logical_databases",
        foreign_keys=[staged_source_id],
    )
    instances: list[Any] = relationship(
        "DHIS2Instance",
        back_populates="logical_database",
        passive_deletes=True,
    )
    staged_datasets: list[StagedDataset] = relationship(
        "StagedDataset",
        back_populates="dhis2_logical_database",
        passive_deletes=True,
    )
    dhis2_staged_datasets: list[Any] = relationship(
        "DHIS2StagedDataset",
        back_populates="logical_database",
        passive_deletes=True,
    )

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "database_id": self.database_id,
            "staged_source_id": self.staged_source_id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class SchedulePolicy(Model):
    """Managed schedule policy for a staged dataset."""

    __tablename__ = "schedule_policies"

    __table_args__ = (
        sa.Index("ix_schedule_policies_refresh_enabled", "refresh_enabled"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    schedule_type = sa.Column(sa.String(32), nullable=False, default="cron")
    cron_expression = sa.Column(sa.String(128), nullable=True)
    timezone = sa.Column(sa.String(100), nullable=False, default="UTC")
    refresh_enabled = sa.Column(sa.Boolean, nullable=False, default=True)
    refresh_scope = sa.Column(sa.String(64), nullable=False, default="full")
    max_runtime_seconds = sa.Column(sa.Integer, nullable=True)
    is_managed = sa.Column(sa.Boolean, nullable=False, default=True)
    config_json = sa.Column(Text, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    datasets: list[StagedDataset] = relationship(
        "StagedDataset",
        back_populates="schedule_policy",
        passive_deletes=True,
    )

    def get_config(self) -> dict[str, Any]:
        return _json_loads(self.config_json)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "schedule_type": self.schedule_type,
            "cron_expression": self.cron_expression,
            "timezone": self.timezone,
            "refresh_enabled": self.refresh_enabled,
            "refresh_scope": self.refresh_scope,
            "max_runtime_seconds": self.max_runtime_seconds,
            "is_managed": self.is_managed,
            "config": self.get_config(),
        }


class StagedDataset(Model):
    """Generic staged dataset metadata."""

    __tablename__ = "staged_datasets"

    __table_args__ = (
        UniqueConstraint(
            "source_type",
            "staged_source_id",
            "slug",
            name="uq_staged_datasets_source_slug",
        ),
        sa.Index("ix_staged_datasets_source_type", "source_type"),
        sa.Index("ix_staged_datasets_staged_source_id", "staged_source_id"),
        sa.Index("ix_staged_datasets_dhis2_logical_database_id", "dhis2_logical_database_id"),
        sa.Index("ix_staged_datasets_last_sync_status", "last_sync_status"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    source_type = sa.Column(sa.String(64), nullable=False)
    staged_source_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_sources.id", ondelete="SET NULL"),
        nullable=True,
    )
    dhis2_logical_database_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_logical_databases.id", ondelete="SET NULL"),
        nullable=True,
    )
    name = sa.Column(sa.String(255), nullable=False)
    slug = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    dataset_mode = sa.Column(sa.String(64), nullable=False, default="raw_stage")
    stage_schema_name = sa.Column(sa.String(255), nullable=True)
    primary_serving_object_name = sa.Column(sa.String(255), nullable=True)
    refresh_enabled = sa.Column(sa.Boolean, nullable=False, default=True)
    schedule_policy_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("schedule_policies.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
    last_successful_sync_at = sa.Column(sa.DateTime, nullable=True)
    last_partial_sync_at = sa.Column(sa.DateTime, nullable=True)
    last_failed_sync_at = sa.Column(sa.DateTime, nullable=True)
    last_sync_status = sa.Column(sa.String(32), nullable=True)
    config_json = sa.Column(Text, nullable=True)

    staged_source: StagedSource = relationship(
        "StagedSource",
        back_populates="datasets",
        foreign_keys=[staged_source_id],
    )
    dhis2_logical_database: DHIS2LogicalDatabase = relationship(
        "DHIS2LogicalDatabase",
        back_populates="staged_datasets",
        foreign_keys=[dhis2_logical_database_id],
    )
    schedule_policy: SchedulePolicy = relationship(
        "SchedulePolicy",
        back_populates="datasets",
        foreign_keys=[schedule_policy_id],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )
    fields: list[StagedDatasetField] = relationship(
        "StagedDatasetField",
        back_populates="dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    dimensions: list[StagedDatasetDimension] = relationship(
        "StagedDatasetDimension",
        back_populates="dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    sync_jobs: list[SyncJob] = relationship(
        "SyncJob",
        back_populates="dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    load_batches: list[StageLoadBatch] = relationship(
        "StageLoadBatch",
        back_populates="dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    materializations: list[DatasetMaterialization] = relationship(
        "DatasetMaterialization",
        back_populates="dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    metric_mappings: list[DatasetMetricMapping] = relationship(
        "DatasetMetricMapping",
        back_populates="dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    dhis2_dataset: Any = relationship(
        "DHIS2StagedDataset",
        back_populates="generic_dataset",
        uselist=False,
    )

    def get_config(self) -> dict[str, Any]:
        return _json_loads(self.config_json)

    def sync_slug(self) -> None:
        self.slug = _slugify(self.name) or f"dataset-{self.id or 'new'}"

    def mark_sync(self, status: str, timestamp: datetime | None = None) -> None:
        when = timestamp or datetime.utcnow()
        self.last_sync_status = status
        if status == "success":
            self.last_successful_sync_at = when
        elif status == "partial":
            self.last_partial_sync_at = when
        elif status == "failed":
            self.last_failed_sync_at = when

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source_type": self.source_type,
            "staged_source_id": self.staged_source_id,
            "dhis2_logical_database_id": self.dhis2_logical_database_id,
            "name": self.name,
            "slug": self.slug,
            "description": self.description,
            "dataset_mode": self.dataset_mode,
            "stage_schema_name": self.stage_schema_name,
            "primary_serving_object_name": self.primary_serving_object_name,
            "refresh_enabled": self.refresh_enabled,
            "schedule_policy_id": self.schedule_policy_id,
            "last_successful_sync_at": (
                self.last_successful_sync_at.isoformat()
                if self.last_successful_sync_at
                else None
            ),
            "last_partial_sync_at": (
                self.last_partial_sync_at.isoformat()
                if self.last_partial_sync_at
                else None
            ),
            "last_failed_sync_at": (
                self.last_failed_sync_at.isoformat()
                if self.last_failed_sync_at
                else None
            ),
            "last_sync_status": self.last_sync_status,
            "config": self.get_config(),
        }


class StagedDatasetField(Model):
    """Generic field lineage for a staged dataset."""

    __tablename__ = "staged_dataset_fields"

    __table_args__ = (
        UniqueConstraint(
            "dataset_id",
            "field_kind",
            "source_instance_id",
            "source_field_id",
            name="uq_staged_dataset_fields_source_identity",
        ),
        sa.Index("ix_staged_dataset_fields_dataset_id", "dataset_id"),
        sa.Index("ix_staged_dataset_fields_source_instance_id", "source_instance_id"),
        sa.Index("ix_staged_dataset_fields_canonical_metric_key", "canonical_metric_key"),
        sa.Index("ix_staged_dataset_fields_dataset_alias", "dataset_alias"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_kind = sa.Column(sa.String(64), nullable=False)
    source_instance_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_instances.id", ondelete="SET NULL"),
        nullable=True,
    )
    staged_source_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_sources.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_object_name = sa.Column(sa.String(255), nullable=True)
    source_field_name = sa.Column(sa.String(255), nullable=False)
    source_field_id = sa.Column(sa.String(255), nullable=True)
    source_field_code = sa.Column(sa.String(255), nullable=True)
    source_field_label = sa.Column(sa.String(1024), nullable=True)
    dataset_alias = sa.Column(sa.String(255), nullable=False)
    canonical_metric_key = sa.Column(sa.String(255), nullable=True)
    comparison_group = sa.Column(sa.String(255), nullable=True)
    value_type = sa.Column(sa.String(64), nullable=True)
    aggregation_type = sa.Column(sa.String(64), nullable=True)
    is_required = sa.Column(sa.Boolean, nullable=False, default=False)
    is_active = sa.Column(sa.Boolean, nullable=False, default=True)
    display_order = sa.Column(sa.Integer, nullable=False, default=0)
    config_json = sa.Column(Text, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dataset: StagedDataset = relationship(
        "StagedDataset",
        back_populates="fields",
        foreign_keys=[dataset_id],
    )
    staged_source: StagedSource = relationship(
        "StagedSource",
        back_populates="fields",
        foreign_keys=[staged_source_id],
    )
    source_instance = relationship("DHIS2Instance", foreign_keys=[source_instance_id])
    sync_job_fields: list[SyncJobField] = relationship(
        "SyncJobField",
        back_populates="dataset_field",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    observations: list[StageObservation] = relationship(
        "StageObservation",
        back_populates="dataset_field",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    metric_mappings: list[DatasetMetricMapping] = relationship(
        "DatasetMetricMapping",
        back_populates="dataset_field",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    field_equivalences_left: list[DatasetFieldEquivalence] = relationship(
        "DatasetFieldEquivalence",
        foreign_keys="DatasetFieldEquivalence.left_field_id",
        back_populates="left_field",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    field_equivalences_right: list[DatasetFieldEquivalence] = relationship(
        "DatasetFieldEquivalence",
        foreign_keys="DatasetFieldEquivalence.right_field_id",
        back_populates="right_field",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    dhis2_variable: Any = relationship(
        "DHIS2DatasetVariable",
        back_populates="generic_field",
        uselist=False,
    )

    def get_config(self) -> dict[str, Any]:
        return _json_loads(self.config_json)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "dataset_id": self.dataset_id,
            "field_kind": self.field_kind,
            "source_instance_id": self.source_instance_id,
            "staged_source_id": self.staged_source_id,
            "source_object_name": self.source_object_name,
            "source_field_name": self.source_field_name,
            "source_field_id": self.source_field_id,
            "source_field_code": self.source_field_code,
            "source_field_label": self.source_field_label,
            "dataset_alias": self.dataset_alias,
            "canonical_metric_key": self.canonical_metric_key,
            "comparison_group": self.comparison_group,
            "value_type": self.value_type,
            "aggregation_type": self.aggregation_type,
            "is_required": self.is_required,
            "is_active": self.is_active,
            "display_order": self.display_order,
            "config": self.get_config(),
        }


class StagedDatasetDimension(Model):
    """Dimension metadata for staged datasets."""

    __tablename__ = "staged_dataset_dimensions"

    __table_args__ = (
        UniqueConstraint(
            "dataset_id",
            "dimension_key",
            name="uq_staged_dataset_dimensions_dataset_key",
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    dimension_key = sa.Column(sa.String(255), nullable=False)
    dimension_label = sa.Column(sa.String(255), nullable=False)
    dimension_type = sa.Column(sa.String(64), nullable=False)
    source_field_name = sa.Column(sa.String(255), nullable=True)
    is_active = sa.Column(sa.Boolean, nullable=False, default=True)
    display_order = sa.Column(sa.Integer, nullable=False, default=0)
    config_json = sa.Column(Text, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dataset: StagedDataset = relationship(
        "StagedDataset",
        back_populates="dimensions",
        foreign_keys=[dataset_id],
    )

    def get_config(self) -> dict[str, Any]:
        return _json_loads(self.config_json)


class SyncJob(Model):
    """Generic staged-dataset refresh execution."""

    __tablename__ = "sync_jobs"

    __table_args__ = (
        sa.Index("ix_sync_jobs_dataset_id", "dataset_id"),
        sa.Index("ix_sync_jobs_status", "status"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_type = sa.Column(sa.String(64), nullable=False, default="manual")
    status = sa.Column(sa.String(32), nullable=False, default="pending")
    refresh_scope = sa.Column(sa.String(64), nullable=False, default="full")
    refresh_mode = sa.Column(sa.String(64), nullable=False, default="replace")
    started_at = sa.Column(sa.DateTime, nullable=True)
    completed_at = sa.Column(sa.DateTime, nullable=True)
    rows_inserted = sa.Column(sa.Integer, nullable=True)
    rows_updated = sa.Column(sa.Integer, nullable=True)
    rows_skipped = sa.Column(sa.Integer, nullable=True)
    rows_deleted = sa.Column(sa.Integer, nullable=True)
    rows_failed = sa.Column(sa.Integer, nullable=True)
    error_message = sa.Column(Text, nullable=True)
    result_json = sa.Column(Text, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dataset: StagedDataset = relationship(
        "StagedDataset",
        back_populates="sync_jobs",
        foreign_keys=[dataset_id],
    )
    sources: list[SyncJobSource] = relationship(
        "SyncJobSource",
        back_populates="sync_job",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    fields: list[SyncJobField] = relationship(
        "SyncJobField",
        back_populates="sync_job",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    load_batches: list[StageLoadBatch] = relationship(
        "StageLoadBatch",
        back_populates="sync_job",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    observations: list[StageObservation] = relationship(
        "StageObservation",
        back_populates="sync_job",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    dhis2_sync_job: Any = relationship(
        "DHIS2SyncJob",
        back_populates="generic_sync_job",
        uselist=False,
    )

    def get_result(self) -> dict[str, Any]:
        return _json_loads(self.result_json)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "dataset_id": self.dataset_id,
            "job_type": self.job_type,
            "status": self.status,
            "refresh_scope": self.refresh_scope,
            "refresh_mode": self.refresh_mode,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_skipped": self.rows_skipped,
            "rows_deleted": self.rows_deleted,
            "rows_failed": self.rows_failed,
            "error_message": self.error_message,
            "result": self.get_result(),
        }


class SyncJobSource(Model):
    """Source-level execution detail for a sync job."""

    __tablename__ = "sync_job_sources"

    __table_args__ = (
        sa.Index("ix_sync_job_sources_sync_job_id", "sync_job_id"),
        sa.Index("ix_sync_job_sources_source_instance_id", "source_instance_id"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    sync_job_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("sync_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    staged_source_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_sources.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_instance_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_instances.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_key = sa.Column(sa.String(255), nullable=False)
    status = sa.Column(sa.String(32), nullable=False, default="pending")
    rows_inserted = sa.Column(sa.Integer, nullable=True)
    rows_updated = sa.Column(sa.Integer, nullable=True)
    rows_skipped = sa.Column(sa.Integer, nullable=True)
    rows_deleted = sa.Column(sa.Integer, nullable=True)
    rows_failed = sa.Column(sa.Integer, nullable=True)
    error_message = sa.Column(Text, nullable=True)
    started_at = sa.Column(sa.DateTime, nullable=True)
    completed_at = sa.Column(sa.DateTime, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    sync_job: SyncJob = relationship(
        "SyncJob",
        back_populates="sources",
        foreign_keys=[sync_job_id],
    )
    dataset = relationship("StagedDataset", foreign_keys=[dataset_id])
    staged_source = relationship("StagedSource", foreign_keys=[staged_source_id])
    source_instance = relationship("DHIS2Instance", foreign_keys=[source_instance_id])


class SyncJobField(Model):
    """Field-level execution detail for a sync job."""

    __tablename__ = "sync_job_fields"

    __table_args__ = (
        sa.Index("ix_sync_job_fields_sync_job_id", "sync_job_id"),
        sa.Index("ix_sync_job_fields_dataset_field_id", "dataset_field_id"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    sync_job_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("sync_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    dataset_field_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_dataset_fields.id", ondelete="CASCADE"),
        nullable=False,
    )
    status = sa.Column(sa.String(32), nullable=False, default="pending")
    rows_inserted = sa.Column(sa.Integer, nullable=True)
    rows_updated = sa.Column(sa.Integer, nullable=True)
    rows_skipped = sa.Column(sa.Integer, nullable=True)
    rows_deleted = sa.Column(sa.Integer, nullable=True)
    rows_failed = sa.Column(sa.Integer, nullable=True)
    error_message = sa.Column(Text, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    sync_job: SyncJob = relationship(
        "SyncJob",
        back_populates="fields",
        foreign_keys=[sync_job_id],
    )
    dataset_field: StagedDatasetField = relationship(
        "StagedDatasetField",
        back_populates="sync_job_fields",
        foreign_keys=[dataset_field_id],
    )


class StageLoadBatch(Model):
    """Batch-level ingestion tracking."""

    __tablename__ = "stage_load_batches"

    __table_args__ = (
        sa.Index("ix_stage_load_batches_dataset_id", "dataset_id"),
        sa.Index("ix_stage_load_batches_sync_job_id", "sync_job_id"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    sync_job_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("sync_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    batch_key = sa.Column(sa.String(255), nullable=False)
    batch_status = sa.Column(sa.String(32), nullable=False, default="pending")
    refresh_scope = sa.Column(sa.String(64), nullable=True)
    row_count = sa.Column(sa.Integer, nullable=True)
    inserted_count = sa.Column(sa.Integer, nullable=True)
    updated_count = sa.Column(sa.Integer, nullable=True)
    deleted_count = sa.Column(sa.Integer, nullable=True)
    started_at = sa.Column(sa.DateTime, nullable=True)
    completed_at = sa.Column(sa.DateTime, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dataset: StagedDataset = relationship(
        "StagedDataset",
        back_populates="load_batches",
        foreign_keys=[dataset_id],
    )
    sync_job: SyncJob = relationship(
        "SyncJob",
        back_populates="load_batches",
        foreign_keys=[sync_job_id],
    )
    observations: list[StageObservation] = relationship(
        "StageObservation",
        back_populates="load_batch",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class StageObservation(Model):
    """Raw normalized staged observation with typed value columns."""

    __tablename__ = "stage_observations"

    __table_args__ = (
        sa.Index("ix_stage_observations_dataset_period", "dataset_id", "period_key"),
        sa.Index("ix_stage_observations_dataset_source", "dataset_id", "source_instance_id"),
        sa.Index("ix_stage_observations_dataset_field", "dataset_id", "dataset_field_id"),
        sa.Index("ix_stage_observations_sync_job_id", "sync_job_id"),
        sa.Index(
            "ix_stage_observations_dataset_source_field_period",
            "dataset_id",
            "source_instance_id",
            "dataset_field_id",
            "period_key",
        ),
    )

    id = sa.Column(sa.BigInteger, primary_key=True)
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    dataset_field_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_dataset_fields.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_type = sa.Column(sa.String(64), nullable=False)
    staged_source_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_sources.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_instance_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_instances.id", ondelete="SET NULL"),
        nullable=True,
    )
    sync_job_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("sync_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    load_batch_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("stage_load_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    period_key = sa.Column(sa.String(64), nullable=True)
    observation_date = sa.Column(sa.Date, nullable=True)
    org_unit_uid = sa.Column(sa.String(255), nullable=True)
    org_unit_name = sa.Column(sa.String(1024), nullable=True)
    dimension_key = sa.Column(sa.String(255), nullable=True)
    dimension_value = sa.Column(sa.String(1024), nullable=True)
    value_text = sa.Column(Text, nullable=True)
    value_numeric = sa.Column(sa.Float, nullable=True)
    value_boolean = sa.Column(sa.Boolean, nullable=True)
    value_datetime = sa.Column(sa.DateTime, nullable=True)
    source_row_hash = sa.Column(sa.String(128), nullable=False)
    ingested_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    last_synced_at = sa.Column(sa.DateTime, nullable=False, default=datetime.utcnow)

    dataset = relationship("StagedDataset", foreign_keys=[dataset_id])
    dataset_field: StagedDatasetField = relationship(
        "StagedDatasetField",
        back_populates="observations",
        foreign_keys=[dataset_field_id],
    )
    staged_source = relationship("StagedSource", foreign_keys=[staged_source_id])
    source_instance = relationship("DHIS2Instance", foreign_keys=[source_instance_id])
    sync_job: SyncJob = relationship(
        "SyncJob",
        back_populates="observations",
        foreign_keys=[sync_job_id],
    )
    load_batch: StageLoadBatch = relationship(
        "StageLoadBatch",
        back_populates="observations",
        foreign_keys=[load_batch_id],
    )


class StagePartition(Model):
    """Partition metadata for the raw stage layer."""

    __tablename__ = "stage_partitions"

    __table_args__ = (
        UniqueConstraint(
            "dataset_id",
            "partition_name",
            name="uq_stage_partitions_dataset_partition_name",
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    partition_name = sa.Column(sa.String(255), nullable=False)
    partition_key = sa.Column(sa.String(255), nullable=False)
    row_count = sa.Column(sa.BigInteger, nullable=True)
    size_bytes = sa.Column(sa.BigInteger, nullable=True)
    last_analyzed_at = sa.Column(sa.DateTime, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dataset = relationship("StagedDataset", foreign_keys=[dataset_id])


class DatasetMaterialization(Model):
    """Serving object metadata for local staged analytics."""

    __tablename__ = "dataset_materializations"

    __table_args__ = (
        sa.Index("ix_dataset_materializations_dataset_id", "dataset_id"),
        sa.Index(
            "ix_dataset_materializations_primary_active",
            "dataset_id",
            "is_primary",
            "is_active",
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    object_type = sa.Column(sa.String(64), nullable=False, default="table")
    object_schema_name = sa.Column(sa.String(255), nullable=True)
    object_name = sa.Column(sa.String(255), nullable=False)
    is_primary = sa.Column(sa.Boolean, nullable=False, default=False)
    is_active = sa.Column(sa.Boolean, nullable=False, default=True)
    refresh_strategy = sa.Column(sa.String(64), nullable=False, default="replace")
    index_definition = sa.Column(Text, nullable=True)
    cluster_definition = sa.Column(Text, nullable=True)
    last_refreshed_at = sa.Column(sa.DateTime, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dataset: StagedDataset = relationship(
        "StagedDataset",
        back_populates="materializations",
        foreign_keys=[dataset_id],
    )


class DatasetMetricMapping(Model):
    """Canonical metric mappings exposed by a staged dataset."""

    __tablename__ = "dataset_metric_mappings"

    __table_args__ = (
        sa.Index("ix_dataset_metric_mappings_dataset_id", "dataset_id"),
        sa.Index(
            "ix_dataset_metric_mappings_canonical_metric_key", "canonical_metric_key"
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    dataset_field_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_dataset_fields.id", ondelete="SET NULL"),
        nullable=True,
    )
    canonical_metric_key = sa.Column(sa.String(255), nullable=False)
    metric_label = sa.Column(sa.String(255), nullable=False)
    expression = sa.Column(Text, nullable=True)
    aggregation_type = sa.Column(sa.String(64), nullable=True)
    is_default = sa.Column(sa.Boolean, nullable=False, default=False)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dataset: StagedDataset = relationship(
        "StagedDataset",
        back_populates="metric_mappings",
        foreign_keys=[dataset_id],
    )
    dataset_field: StagedDatasetField = relationship(
        "StagedDatasetField",
        back_populates="metric_mappings",
        foreign_keys=[dataset_field_id],
    )


class DatasetFieldEquivalence(Model):
    """Semantic mapping between two staged dataset fields."""

    __tablename__ = "dataset_field_equivalences"

    __table_args__ = (
        sa.Index("ix_dataset_field_equivalences_left_field_id", "left_field_id"),
        sa.Index("ix_dataset_field_equivalences_right_field_id", "right_field_id"),
        sa.Index("ix_dataset_field_equivalences_equivalence_key", "equivalence_key"),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    left_field_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_dataset_fields.id", ondelete="CASCADE"),
        nullable=False,
    )
    right_field_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_dataset_fields.id", ondelete="CASCADE"),
        nullable=False,
    )
    equivalence_key = sa.Column(sa.String(255), nullable=False)
    relationship_type = sa.Column(sa.String(64), nullable=False, default="equivalent")
    notes = sa.Column(Text, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    left_field: StagedDatasetField = relationship(
        "StagedDatasetField",
        foreign_keys=[left_field_id],
        back_populates="field_equivalences_left",
    )
    right_field: StagedDatasetField = relationship(
        "StagedDatasetField",
        foreign_keys=[right_field_id],
        back_populates="field_equivalences_right",
    )


class SourceMetadataCache(Model):
    """Cached source metadata for fast source browsing in the UI."""

    __tablename__ = "source_metadata_cache"

    __table_args__ = (
        UniqueConstraint(
            "staged_source_id",
            "cache_namespace",
            "cache_key",
            name="uq_source_metadata_cache_entry",
        ),
    )

    id = sa.Column(sa.Integer, primary_key=True)
    staged_source_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    cache_namespace = sa.Column(sa.String(128), nullable=False)
    cache_key = sa.Column(sa.String(255), nullable=False)
    metadata_json = sa.Column(Text, nullable=False)
    etag = sa.Column(sa.String(255), nullable=True)
    expires_at = sa.Column(sa.DateTime, nullable=True)
    refreshed_at = sa.Column(sa.DateTime, nullable=True)
    created_at = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    staged_source: StagedSource = relationship(
        "StagedSource",
        back_populates="metadata_cache_entries",
        foreign_keys=[staged_source_id],
    )

    def get_metadata(self) -> dict[str, Any]:
        return _json_loads(self.metadata_json)
