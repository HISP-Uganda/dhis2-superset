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
"""Introduce generic staged-source metadata and compatibility links.

Revision ID: staged_metadata_arch_v1
Revises: dhis2_multi_instance_v1
Create Date: 2026-01-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "staged_metadata_arch_v1"
down_revision = "dhis2_multi_instance_v1"


def _now() -> sa.sql.elements.TextClause:
    return sa.text("CURRENT_TIMESTAMP")


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def _add_fk_column(
    table_name: str,
    column: sa.Column,
    constraint_name: str,
    referent_table: str,
    local_cols: list[str],
    remote_cols: list[str],
    ondelete: str | None = None,
) -> None:
    if _is_sqlite():
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.add_column(column)
            batch_op.create_foreign_key(
                constraint_name,
                referent_table,
                local_cols,
                remote_cols,
                ondelete=ondelete,
            )
        return

    op.add_column(table_name, column)
    op.create_foreign_key(
        constraint_name,
        table_name,
        referent_table,
        local_cols,
        remote_cols,
        ondelete=ondelete,
    )


def _drop_fk_column(
    table_name: str,
    constraint_name: str,
    column_name: str,
) -> None:
    if _is_sqlite():
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_constraint(constraint_name, type_="foreignkey")
            batch_op.drop_column(column_name)
        return

    op.drop_constraint(constraint_name, table_name, type_="foreignkey")
    op.drop_column(table_name, column_name)


def upgrade() -> None:
    op.create_table(
        "staged_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("source_connection_id", sa.Integer(), nullable=True),
        sa.Column("source_name", sa.String(length=255), nullable=False),
        sa.Column("connection_key", sa.String(length=255), nullable=True),
        sa.Column("config_json", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(
            ["source_connection_id"],
            ["dbs.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_type",
            "source_connection_id",
            "source_name",
            name="uq_staged_sources_type_connection_name",
        ),
    )
    op.create_index(
        "ix_staged_sources_source_type", "staged_sources", ["source_type"], unique=False
    )
    op.create_index(
        "ix_staged_sources_connection_id",
        "staged_sources",
        ["source_connection_id"],
        unique=False,
    )
    op.create_index(
        "ix_staged_sources_is_active", "staged_sources", ["is_active"], unique=False
    )

    op.create_table(
        "dhis2_logical_databases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("database_id", sa.Integer(), nullable=False),
        sa.Column("staged_source_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["database_id"], ["dbs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["staged_source_id"], ["staged_sources.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("database_id", name="uq_dhis2_logical_databases_database_id"),
        sa.UniqueConstraint(
            "staged_source_id", name="uq_dhis2_logical_databases_staged_source_id"
        ),
    )

    op.create_table(
        "schedule_policies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("schedule_type", sa.String(length=32), nullable=False, server_default="cron"),
        sa.Column("cron_expression", sa.String(length=128), nullable=True),
        sa.Column("timezone", sa.String(length=100), nullable=False, server_default="UTC"),
        sa.Column("refresh_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("refresh_scope", sa.String(length=64), nullable=False, server_default="full"),
        sa.Column("max_runtime_seconds", sa.Integer(), nullable=True),
        sa.Column("is_managed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("config_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_schedule_policies_refresh_enabled",
        "schedule_policies",
        ["refresh_enabled"],
        unique=False,
    )

    op.create_table(
        "staged_datasets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("staged_source_id", sa.Integer(), nullable=True),
        sa.Column("dhis2_logical_database_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("dataset_mode", sa.String(length=64), nullable=False, server_default="raw_stage"),
        sa.Column("stage_schema_name", sa.String(length=255), nullable=True),
        sa.Column("primary_serving_object_name", sa.String(length=255), nullable=True),
        sa.Column("refresh_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("schedule_policy_id", sa.Integer(), nullable=True),
        sa.Column("created_by_fk", sa.Integer(), nullable=True),
        sa.Column("changed_by_fk", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("last_successful_sync_at", sa.DateTime(), nullable=True),
        sa.Column("last_partial_sync_at", sa.DateTime(), nullable=True),
        sa.Column("last_failed_sync_at", sa.DateTime(), nullable=True),
        sa.Column("last_sync_status", sa.String(length=32), nullable=True),
        sa.Column("config_json", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["staged_source_id"], ["staged_sources.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["dhis2_logical_database_id"],
            ["dhis2_logical_databases.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["schedule_policy_id"], ["schedule_policies.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["created_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["changed_by_fk"], ["ab_user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_type",
            "staged_source_id",
            "slug",
            name="uq_staged_datasets_source_slug",
        ),
    )
    op.create_index(
        "ix_staged_datasets_source_type", "staged_datasets", ["source_type"], unique=False
    )
    op.create_index(
        "ix_staged_datasets_staged_source_id",
        "staged_datasets",
        ["staged_source_id"],
        unique=False,
    )
    op.create_index(
        "ix_staged_datasets_dhis2_logical_database_id",
        "staged_datasets",
        ["dhis2_logical_database_id"],
        unique=False,
    )
    op.create_index(
        "ix_staged_datasets_last_sync_status",
        "staged_datasets",
        ["last_sync_status"],
        unique=False,
    )

    op.create_table(
        "staged_dataset_fields",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("field_kind", sa.String(length=64), nullable=False),
        sa.Column("source_instance_id", sa.Integer(), nullable=True),
        sa.Column("staged_source_id", sa.Integer(), nullable=True),
        sa.Column("source_object_name", sa.String(length=255), nullable=True),
        sa.Column("source_field_name", sa.String(length=255), nullable=False),
        sa.Column("source_field_id", sa.String(length=255), nullable=True),
        sa.Column("source_field_code", sa.String(length=255), nullable=True),
        sa.Column("source_field_label", sa.String(length=1024), nullable=True),
        sa.Column("dataset_alias", sa.String(length=255), nullable=False),
        sa.Column("canonical_metric_key", sa.String(length=255), nullable=True),
        sa.Column("comparison_group", sa.String(length=255), nullable=True),
        sa.Column("value_type", sa.String(length=64), nullable=True),
        sa.Column("aggregation_type", sa.String(length=64), nullable=True),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("config_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_instance_id"], ["dhis2_instances.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["staged_source_id"], ["staged_sources.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dataset_id",
            "field_kind",
            "source_instance_id",
            "source_field_id",
            name="uq_staged_dataset_fields_source_identity",
        ),
    )
    op.create_index(
        "ix_staged_dataset_fields_dataset_id",
        "staged_dataset_fields",
        ["dataset_id"],
        unique=False,
    )
    op.create_index(
        "ix_staged_dataset_fields_source_instance_id",
        "staged_dataset_fields",
        ["source_instance_id"],
        unique=False,
    )
    op.create_index(
        "ix_staged_dataset_fields_canonical_metric_key",
        "staged_dataset_fields",
        ["canonical_metric_key"],
        unique=False,
    )
    op.create_index(
        "ix_staged_dataset_fields_dataset_alias",
        "staged_dataset_fields",
        ["dataset_alias"],
        unique=False,
    )

    op.create_table(
        "staged_dataset_dimensions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("dimension_key", sa.String(length=255), nullable=False),
        sa.Column("dimension_label", sa.String(length=255), nullable=False),
        sa.Column("dimension_type", sa.String(length=64), nullable=False),
        sa.Column("source_field_name", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("config_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dataset_id",
            "dimension_key",
            name="uq_staged_dataset_dimensions_dataset_key",
        ),
    )

    op.create_table(
        "sync_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("job_type", sa.String(length=64), nullable=False, server_default="manual"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("refresh_scope", sa.String(length=64), nullable=False, server_default="full"),
        sa.Column("refresh_mode", sa.String(length=64), nullable=False, server_default="replace"),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("rows_inserted", sa.Integer(), nullable=True),
        sa.Column("rows_updated", sa.Integer(), nullable=True),
        sa.Column("rows_skipped", sa.Integer(), nullable=True),
        sa.Column("rows_deleted", sa.Integer(), nullable=True),
        sa.Column("rows_failed", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("result_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sync_jobs_dataset_id", "sync_jobs", ["dataset_id"], unique=False)
    op.create_index("ix_sync_jobs_status", "sync_jobs", ["status"], unique=False)

    op.create_table(
        "sync_job_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sync_job_id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("staged_source_id", sa.Integer(), nullable=True),
        sa.Column("source_instance_id", sa.Integer(), nullable=True),
        sa.Column("source_key", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("rows_inserted", sa.Integer(), nullable=True),
        sa.Column("rows_updated", sa.Integer(), nullable=True),
        sa.Column("rows_skipped", sa.Integer(), nullable=True),
        sa.Column("rows_deleted", sa.Integer(), nullable=True),
        sa.Column("rows_failed", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["sync_job_id"], ["sync_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["staged_source_id"], ["staged_sources.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["source_instance_id"], ["dhis2_instances.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_sync_job_sources_sync_job_id",
        "sync_job_sources",
        ["sync_job_id"],
        unique=False,
    )
    op.create_index(
        "ix_sync_job_sources_source_instance_id",
        "sync_job_sources",
        ["source_instance_id"],
        unique=False,
    )

    op.create_table(
        "sync_job_fields",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sync_job_id", sa.Integer(), nullable=False),
        sa.Column("dataset_field_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("rows_inserted", sa.Integer(), nullable=True),
        sa.Column("rows_updated", sa.Integer(), nullable=True),
        sa.Column("rows_skipped", sa.Integer(), nullable=True),
        sa.Column("rows_deleted", sa.Integer(), nullable=True),
        sa.Column("rows_failed", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["sync_job_id"], ["sync_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["dataset_field_id"], ["staged_dataset_fields.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_sync_job_fields_sync_job_id", "sync_job_fields", ["sync_job_id"], unique=False
    )
    op.create_index(
        "ix_sync_job_fields_dataset_field_id",
        "sync_job_fields",
        ["dataset_field_id"],
        unique=False,
    )

    op.create_table(
        "stage_load_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("sync_job_id", sa.Integer(), nullable=False),
        sa.Column("batch_key", sa.String(length=255), nullable=False),
        sa.Column("batch_status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("refresh_scope", sa.String(length=64), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("inserted_count", sa.Integer(), nullable=True),
        sa.Column("updated_count", sa.Integer(), nullable=True),
        sa.Column("deleted_count", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sync_job_id"], ["sync_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stage_load_batches_dataset_id",
        "stage_load_batches",
        ["dataset_id"],
        unique=False,
    )
    op.create_index(
        "ix_stage_load_batches_sync_job_id",
        "stage_load_batches",
        ["sync_job_id"],
        unique=False,
    )

    op.create_table(
        "stage_observations",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("dataset_field_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("staged_source_id", sa.Integer(), nullable=True),
        sa.Column("source_instance_id", sa.Integer(), nullable=True),
        sa.Column("sync_job_id", sa.Integer(), nullable=False),
        sa.Column("load_batch_id", sa.Integer(), nullable=False),
        sa.Column("period_key", sa.String(length=64), nullable=True),
        sa.Column("observation_date", sa.Date(), nullable=True),
        sa.Column("org_unit_uid", sa.String(length=255), nullable=True),
        sa.Column("org_unit_name", sa.String(length=1024), nullable=True),
        sa.Column("dimension_key", sa.String(length=255), nullable=True),
        sa.Column("dimension_value", sa.String(length=1024), nullable=True),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_numeric", sa.Float(), nullable=True),
        sa.Column("value_boolean", sa.Boolean(), nullable=True),
        sa.Column("value_datetime", sa.DateTime(), nullable=True),
        sa.Column("source_row_hash", sa.String(length=128), nullable=False),
        sa.Column("ingested_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["dataset_field_id"], ["staged_dataset_fields.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["staged_source_id"], ["staged_sources.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["source_instance_id"], ["dhis2_instances.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["sync_job_id"], ["sync_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["load_batch_id"], ["stage_load_batches.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stage_observations_dataset_period",
        "stage_observations",
        ["dataset_id", "period_key"],
        unique=False,
    )
    op.create_index(
        "ix_stage_observations_dataset_source",
        "stage_observations",
        ["dataset_id", "source_instance_id"],
        unique=False,
    )
    op.create_index(
        "ix_stage_observations_dataset_field",
        "stage_observations",
        ["dataset_id", "dataset_field_id"],
        unique=False,
    )
    op.create_index(
        "ix_stage_observations_sync_job_id",
        "stage_observations",
        ["sync_job_id"],
        unique=False,
    )
    op.create_index(
        "ix_stage_observations_dataset_source_field_period",
        "stage_observations",
        ["dataset_id", "source_instance_id", "dataset_field_id", "period_key"],
        unique=False,
    )

    op.create_table(
        "stage_partitions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("partition_name", sa.String(length=255), nullable=False),
        sa.Column("partition_key", sa.String(length=255), nullable=False),
        sa.Column("row_count", sa.BigInteger(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("last_analyzed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "dataset_id",
            "partition_name",
            name="uq_stage_partitions_dataset_partition_name",
        ),
    )

    op.create_table(
        "dataset_materializations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=False, server_default="table"),
        sa.Column("object_schema_name", sa.String(length=255), nullable=True),
        sa.Column("object_name", sa.String(length=255), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("refresh_strategy", sa.String(length=64), nullable=False, server_default="replace"),
        sa.Column("index_definition", sa.Text(), nullable=True),
        sa.Column("cluster_definition", sa.Text(), nullable=True),
        sa.Column("last_refreshed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_dataset_materializations_dataset_id",
        "dataset_materializations",
        ["dataset_id"],
        unique=False,
    )
    op.create_index(
        "ix_dataset_materializations_primary_active",
        "dataset_materializations",
        ["dataset_id", "is_primary", "is_active"],
        unique=False,
    )

    op.create_table(
        "dataset_metric_mappings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("dataset_field_id", sa.Integer(), nullable=True),
        sa.Column("canonical_metric_key", sa.String(length=255), nullable=False),
        sa.Column("metric_label", sa.String(length=255), nullable=False),
        sa.Column("expression", sa.Text(), nullable=True),
        sa.Column("aggregation_type", sa.String(length=64), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["dataset_id"], ["staged_datasets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["dataset_field_id"], ["staged_dataset_fields.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_dataset_metric_mappings_dataset_id",
        "dataset_metric_mappings",
        ["dataset_id"],
        unique=False,
    )
    op.create_index(
        "ix_dataset_metric_mappings_canonical_metric_key",
        "dataset_metric_mappings",
        ["canonical_metric_key"],
        unique=False,
    )

    op.create_table(
        "dataset_field_equivalences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("left_field_id", sa.Integer(), nullable=False),
        sa.Column("right_field_id", sa.Integer(), nullable=False),
        sa.Column("equivalence_key", sa.String(length=255), nullable=False),
        sa.Column("relationship_type", sa.String(length=64), nullable=False, server_default="equivalent"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(
            ["left_field_id"], ["staged_dataset_fields.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["right_field_id"], ["staged_dataset_fields.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_dataset_field_equivalences_left_field_id",
        "dataset_field_equivalences",
        ["left_field_id"],
        unique=False,
    )
    op.create_index(
        "ix_dataset_field_equivalences_right_field_id",
        "dataset_field_equivalences",
        ["right_field_id"],
        unique=False,
    )
    op.create_index(
        "ix_dataset_field_equivalences_equivalence_key",
        "dataset_field_equivalences",
        ["equivalence_key"],
        unique=False,
    )

    op.create_table(
        "source_metadata_cache",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("staged_source_id", sa.Integer(), nullable=False),
        sa.Column("cache_namespace", sa.String(length=128), nullable=False),
        sa.Column("cache_key", sa.String(length=255), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("etag", sa.String(length=255), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("refreshed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(
            ["staged_source_id"], ["staged_sources.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "staged_source_id",
            "cache_namespace",
            "cache_key",
            name="uq_source_metadata_cache_entry",
        ),
    )

    _add_fk_column(
        "dhis2_instances",
        sa.Column("logical_database_id", sa.Integer(), nullable=True),
        "fk_dhis2_instances_logical_database_id",
        "dhis2_logical_databases",
        ["logical_database_id"],
        ["id"],
        ondelete="SET NULL",
    )

    _add_fk_column(
        "dhis2_staged_datasets",
        sa.Column("logical_database_id", sa.Integer(), nullable=True),
        "fk_dhis2_staged_datasets_logical_database_id",
        "dhis2_logical_databases",
        ["logical_database_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _add_fk_column(
        "dhis2_staged_datasets",
        sa.Column("generic_dataset_id", sa.Integer(), nullable=True),
        "fk_dhis2_staged_datasets_generic_dataset_id",
        "staged_datasets",
        ["generic_dataset_id"],
        ["id"],
        ondelete="SET NULL",
    )

    _add_fk_column(
        "dhis2_dataset_variables",
        sa.Column("generic_field_id", sa.Integer(), nullable=True),
        "fk_dhis2_dataset_variables_generic_field_id",
        "staged_dataset_fields",
        ["generic_field_id"],
        ["id"],
        ondelete="SET NULL",
    )

    _add_fk_column(
        "dhis2_sync_jobs",
        sa.Column("generic_sync_job_id", sa.Integer(), nullable=True),
        "fk_dhis2_sync_jobs_generic_sync_job_id",
        "sync_jobs",
        ["generic_sync_job_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        sa.text(
            """
            INSERT INTO staged_sources (
                source_type,
                source_connection_id,
                source_name,
                connection_key,
                config_json,
                is_active,
                created_at,
                updated_at
            )
            SELECT
                'dhis2',
                src.database_id,
                'DHIS2 database ' || src.database_id,
                'db:' || src.database_id,
                NULL,
                true,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM (
                SELECT DISTINCT database_id FROM dhis2_instances
                UNION
                SELECT DISTINCT database_id FROM dhis2_staged_datasets
            ) AS src
            LEFT JOIN staged_sources existing
                ON existing.source_type = 'dhis2'
               AND existing.source_connection_id = src.database_id
               AND existing.source_name = 'DHIS2 database ' || src.database_id
            WHERE existing.id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO dhis2_logical_databases (
                database_id,
                staged_source_id,
                name,
                description,
                created_at,
                updated_at
            )
            SELECT
                s.source_connection_id,
                s.id,
                s.source_name,
                'Backfilled from existing DHIS2 metadata',
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM staged_sources s
            LEFT JOIN dhis2_logical_databases d
                ON d.database_id = s.source_connection_id
            WHERE s.source_type = 'dhis2'
              AND d.id IS NULL
            """
        )
    )
    if _is_sqlite():
        op.execute(
            sa.text(
                """
                UPDATE dhis2_instances
                   SET logical_database_id = (
                       SELECT d.id
                         FROM dhis2_logical_databases d
                        WHERE d.database_id = dhis2_instances.database_id
                        LIMIT 1
                   )
                 WHERE logical_database_id IS NULL
                   AND EXISTS (
                       SELECT 1
                         FROM dhis2_logical_databases d
                        WHERE d.database_id = dhis2_instances.database_id
                   )
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE dhis2_staged_datasets
                   SET logical_database_id = (
                       SELECT d.id
                         FROM dhis2_logical_databases d
                        WHERE d.database_id = dhis2_staged_datasets.database_id
                        LIMIT 1
                   )
                 WHERE logical_database_id IS NULL
                   AND EXISTS (
                       SELECT 1
                         FROM dhis2_logical_databases d
                        WHERE d.database_id = dhis2_staged_datasets.database_id
                   )
                """
            )
        )
    else:
        op.execute(
            sa.text(
                """
                UPDATE dhis2_instances i
                   SET logical_database_id = d.id
                  FROM dhis2_logical_databases d
                 WHERE i.database_id = d.database_id
                   AND i.logical_database_id IS NULL
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE dhis2_staged_datasets ds
                   SET logical_database_id = d.id
                  FROM dhis2_logical_databases d
                 WHERE ds.database_id = d.database_id
                   AND ds.logical_database_id IS NULL
                """
            )
        )
    op.execute(
        sa.text(
            """
            INSERT INTO staged_datasets (
                source_type,
                staged_source_id,
                dhis2_logical_database_id,
                name,
                slug,
                description,
                dataset_mode,
                stage_schema_name,
                primary_serving_object_name,
                refresh_enabled,
                created_by_fk,
                changed_by_fk,
                created_at,
                updated_at,
                last_successful_sync_at,
                last_partial_sync_at,
                last_failed_sync_at,
                last_sync_status,
                config_json
            )
            SELECT
                'dhis2',
                ld.staged_source_id,
                ld.id,
                ds.name,
                """
            + (
                "lower(replace(replace(replace(ds.name, ' ', '-'), '/', '-'), '_', '-'))"
                if _is_sqlite()
                else "lower(regexp_replace(ds.name, '[^a-zA-Z0-9]+', '-', 'g'))"
            )
            + """
                ,
                ds.description,
                'dhis2_analytics_stage',
                'dhis2_staging',
                ds.staging_table_name,
                true,
                ds.created_by_fk,
                ds.changed_by_fk,
                COALESCE(ds.created_on, CURRENT_TIMESTAMP),
                COALESCE(ds.changed_on, CURRENT_TIMESTAMP),
                CASE WHEN ds.last_sync_status = 'success' THEN ds.last_sync_at END,
                CASE WHEN ds.last_sync_status = 'partial' THEN ds.last_sync_at END,
                CASE WHEN ds.last_sync_status = 'failed' THEN ds.last_sync_at END,
                ds.last_sync_status,
                ds.dataset_config
            FROM dhis2_staged_datasets ds
            JOIN dhis2_logical_databases ld
              ON ld.id = ds.logical_database_id
            WHERE ds.generic_dataset_id IS NULL
            """
        )
    )
    if _is_sqlite():
        op.execute(
            sa.text(
                """
                UPDATE dhis2_staged_datasets
                   SET generic_dataset_id = (
                       SELECT g.id
                         FROM dhis2_logical_databases ld
                         JOIN staged_datasets g
                           ON g.source_type = 'dhis2'
                          AND g.staged_source_id = ld.staged_source_id
                          AND g.name = dhis2_staged_datasets.name
                        WHERE ld.id = dhis2_staged_datasets.logical_database_id
                        LIMIT 1
                   )
                 WHERE generic_dataset_id IS NULL
                   AND logical_database_id IS NOT NULL
                """
            )
        )
    else:
        op.execute(
            sa.text(
                """
                UPDATE dhis2_staged_datasets ds
                   SET generic_dataset_id = g.id
                  FROM dhis2_logical_databases ld,
                       staged_datasets g
                 WHERE ds.logical_database_id = ld.id
                   AND g.source_type = 'dhis2'
                   AND g.staged_source_id = ld.staged_source_id
                   AND g.name = ds.name
                   AND ds.generic_dataset_id IS NULL
                """
            )
        )
    op.execute(
        sa.text(
            """
            INSERT INTO staged_dataset_dimensions (
                dataset_id,
                dimension_key,
                dimension_label,
                dimension_type,
                source_field_name,
                is_active,
                display_order,
                created_at,
                updated_at
            )
            SELECT
                g.id,
                dims.dimension_key,
                dims.dimension_label,
                dims.dimension_type,
                dims.source_field_name,
                true,
                dims.display_order,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM staged_datasets g
            CROSS JOIN (
                SELECT 'period' AS dimension_key, 'Period' AS dimension_label, 'temporal' AS dimension_type, 'pe' AS source_field_name, 10 AS display_order
                UNION ALL
                SELECT 'org_unit', 'Organisation Unit', 'categorical', 'ou', 20
                UNION ALL
                SELECT 'source_instance', 'Source Instance', 'source', 'source_instance_id', 30
            ) dims
            LEFT JOIN staged_dataset_dimensions existing
                ON existing.dataset_id = g.id
               AND existing.dimension_key = dims.dimension_key
            WHERE g.source_type = 'dhis2'
              AND existing.id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO dataset_materializations (
                dataset_id,
                object_type,
                object_schema_name,
                object_name,
                is_primary,
                is_active,
                refresh_strategy,
                last_refreshed_at,
                created_at,
                updated_at
            )
            SELECT
                g.id,
                'table',
                'dhis2_staging',
                ds.staging_table_name,
                true,
                true,
                'replace',
                ds.last_sync_at,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM staged_datasets g
            JOIN dhis2_staged_datasets ds
              ON ds.generic_dataset_id = g.id
            LEFT JOIN dataset_materializations m
              ON m.dataset_id = g.id
             AND m.object_name = ds.staging_table_name
            WHERE ds.staging_table_name IS NOT NULL
              AND m.id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO staged_dataset_fields (
                dataset_id,
                field_kind,
                source_instance_id,
                staged_source_id,
                source_object_name,
                source_field_name,
                source_field_id,
                source_field_label,
                dataset_alias,
                canonical_metric_key,
                comparison_group,
                aggregation_type,
                is_required,
                is_active,
                display_order,
                config_json,
                created_at,
                updated_at
            )
            SELECT
                ds.generic_dataset_id,
                'dhis2_variable',
                v.instance_id,
                g.staged_source_id,
                v.variable_type,
                COALESCE(v.variable_name, v.variable_id),
                v.variable_id,
                COALESCE(v.variable_name, v.alias, v.variable_id),
                COALESCE(v.alias, v.variable_name, v.variable_id),
                """
            + (
                "lower(replace(replace(replace(COALESCE(v.alias, v.variable_name, v.variable_id), ' ', '_'), '-', '_'), '/', '_'))"
                if _is_sqlite()
                else "lower(regexp_replace(COALESCE(v.alias, v.variable_name, v.variable_id), '[^a-zA-Z0-9]+', '_', 'g'))"
            )
            + """
                ,
                'instance:' || v.instance_id,
                'sum',
                false,
                true,
                COALESCE(v.id, 0),
                v.extra_params,
                COALESCE(v.created_on, CURRENT_TIMESTAMP),
                COALESCE(v.created_on, CURRENT_TIMESTAMP)
            FROM dhis2_dataset_variables v
            JOIN dhis2_staged_datasets ds
              ON ds.id = v.staged_dataset_id
            JOIN staged_datasets g
              ON g.id = ds.generic_dataset_id
            WHERE ds.generic_dataset_id IS NOT NULL
              AND v.generic_field_id IS NULL
            """
        )
    )
    if _is_sqlite():
        op.execute(
            sa.text(
                """
                UPDATE dhis2_dataset_variables
                   SET generic_field_id = (
                       SELECT f.id
                         FROM dhis2_staged_datasets ds
                         JOIN staged_dataset_fields f
                           ON f.dataset_id = ds.generic_dataset_id
                          AND f.source_instance_id = dhis2_dataset_variables.instance_id
                          AND f.source_field_id = dhis2_dataset_variables.variable_id
                        WHERE ds.id = dhis2_dataset_variables.staged_dataset_id
                        LIMIT 1
                   )
                 WHERE generic_field_id IS NULL
                """
            )
        )
    else:
        op.execute(
            sa.text(
                """
                UPDATE dhis2_dataset_variables v
                   SET generic_field_id = f.id
                  FROM dhis2_staged_datasets ds,
                       staged_dataset_fields f
                 WHERE ds.id = v.staged_dataset_id
                   AND f.dataset_id = ds.generic_dataset_id
                   AND f.source_instance_id = v.instance_id
                   AND f.source_field_id = v.variable_id
                   AND v.generic_field_id IS NULL
                """
            )
        )
    op.execute(
        sa.text(
            """
            INSERT INTO dataset_metric_mappings (
                dataset_id,
                dataset_field_id,
                canonical_metric_key,
                metric_label,
                expression,
                aggregation_type,
                is_default,
                created_at,
                updated_at
            )
            SELECT
                f.dataset_id,
                f.id,
                COALESCE(f.canonical_metric_key, f.dataset_alias),
                COALESCE(f.source_field_label, f.dataset_alias),
                f.dataset_alias,
                f.aggregation_type,
                true,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM staged_dataset_fields f
            LEFT JOIN dataset_metric_mappings m
              ON m.dataset_id = f.dataset_id
             AND m.canonical_metric_key = COALESCE(f.canonical_metric_key, f.dataset_alias)
            WHERE f.field_kind = 'dhis2_variable'
              AND m.id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO sync_jobs (
                dataset_id,
                job_type,
                status,
                refresh_scope,
                refresh_mode,
                started_at,
                completed_at,
                rows_inserted,
                rows_failed,
                error_message,
                result_json,
                created_at,
                updated_at
            )
            SELECT
                ds.generic_dataset_id,
                j.job_type,
                j.status,
                'full',
                'replace',
                j.started_at,
                j.completed_at,
                j.rows_loaded,
                j.rows_failed,
                j.error_message,
                j.instance_results,
                COALESCE(j.created_on, CURRENT_TIMESTAMP),
                COALESCE(j.changed_on, CURRENT_TIMESTAMP)
            FROM dhis2_sync_jobs j
            JOIN dhis2_staged_datasets ds
              ON ds.id = j.staged_dataset_id
            WHERE ds.generic_dataset_id IS NOT NULL
              AND j.generic_sync_job_id IS NULL
            """
        )
    )
    if _is_sqlite():
        op.execute(
            sa.text(
                """
                UPDATE dhis2_sync_jobs
                   SET generic_sync_job_id = (
                       SELECT g.id
                         FROM dhis2_staged_datasets ds
                         JOIN sync_jobs g
                           ON g.dataset_id = ds.generic_dataset_id
                          AND g.job_type = dhis2_sync_jobs.job_type
                          AND g.created_at = COALESCE(dhis2_sync_jobs.created_on, g.created_at)
                        WHERE ds.id = dhis2_sync_jobs.staged_dataset_id
                        LIMIT 1
                   )
                 WHERE generic_sync_job_id IS NULL
                """
            )
        )
    else:
        op.execute(
            sa.text(
                """
                UPDATE dhis2_sync_jobs j
                   SET generic_sync_job_id = g.id
                  FROM dhis2_staged_datasets ds,
                       sync_jobs g
                 WHERE ds.id = j.staged_dataset_id
                   AND g.dataset_id = ds.generic_dataset_id
                   AND g.job_type = j.job_type
                   AND g.created_at = COALESCE(j.created_on, g.created_at)
                   AND j.generic_sync_job_id IS NULL
                """
            )
        )


def downgrade() -> None:
    _drop_fk_column(
        "dhis2_sync_jobs",
        "fk_dhis2_sync_jobs_generic_sync_job_id",
        "generic_sync_job_id",
    )

    _drop_fk_column(
        "dhis2_dataset_variables",
        "fk_dhis2_dataset_variables_generic_field_id",
        "generic_field_id",
    )

    _drop_fk_column(
        "dhis2_staged_datasets",
        "fk_dhis2_staged_datasets_generic_dataset_id",
        "generic_dataset_id",
    )
    _drop_fk_column(
        "dhis2_staged_datasets",
        "fk_dhis2_staged_datasets_logical_database_id",
        "logical_database_id",
    )

    _drop_fk_column(
        "dhis2_instances",
        "fk_dhis2_instances_logical_database_id",
        "logical_database_id",
    )

    op.drop_table("source_metadata_cache")
    op.drop_index("ix_dataset_field_equivalences_equivalence_key", table_name="dataset_field_equivalences")
    op.drop_index("ix_dataset_field_equivalences_right_field_id", table_name="dataset_field_equivalences")
    op.drop_index("ix_dataset_field_equivalences_left_field_id", table_name="dataset_field_equivalences")
    op.drop_table("dataset_field_equivalences")
    op.drop_index("ix_dataset_metric_mappings_canonical_metric_key", table_name="dataset_metric_mappings")
    op.drop_index("ix_dataset_metric_mappings_dataset_id", table_name="dataset_metric_mappings")
    op.drop_table("dataset_metric_mappings")
    op.drop_index("ix_dataset_materializations_primary_active", table_name="dataset_materializations")
    op.drop_index("ix_dataset_materializations_dataset_id", table_name="dataset_materializations")
    op.drop_table("dataset_materializations")
    op.drop_table("stage_partitions")
    op.drop_index("ix_stage_observations_dataset_source_field_period", table_name="stage_observations")
    op.drop_index("ix_stage_observations_sync_job_id", table_name="stage_observations")
    op.drop_index("ix_stage_observations_dataset_field", table_name="stage_observations")
    op.drop_index("ix_stage_observations_dataset_source", table_name="stage_observations")
    op.drop_index("ix_stage_observations_dataset_period", table_name="stage_observations")
    op.drop_table("stage_observations")
    op.drop_index("ix_stage_load_batches_sync_job_id", table_name="stage_load_batches")
    op.drop_index("ix_stage_load_batches_dataset_id", table_name="stage_load_batches")
    op.drop_table("stage_load_batches")
    op.drop_index("ix_sync_job_fields_dataset_field_id", table_name="sync_job_fields")
    op.drop_index("ix_sync_job_fields_sync_job_id", table_name="sync_job_fields")
    op.drop_table("sync_job_fields")
    op.drop_index("ix_sync_job_sources_source_instance_id", table_name="sync_job_sources")
    op.drop_index("ix_sync_job_sources_sync_job_id", table_name="sync_job_sources")
    op.drop_table("sync_job_sources")
    op.drop_index("ix_sync_jobs_status", table_name="sync_jobs")
    op.drop_index("ix_sync_jobs_dataset_id", table_name="sync_jobs")
    op.drop_table("sync_jobs")
    op.drop_table("staged_dataset_dimensions")
    op.drop_index("ix_staged_dataset_fields_dataset_alias", table_name="staged_dataset_fields")
    op.drop_index("ix_staged_dataset_fields_canonical_metric_key", table_name="staged_dataset_fields")
    op.drop_index("ix_staged_dataset_fields_source_instance_id", table_name="staged_dataset_fields")
    op.drop_index("ix_staged_dataset_fields_dataset_id", table_name="staged_dataset_fields")
    op.drop_table("staged_dataset_fields")
    op.drop_index("ix_staged_datasets_last_sync_status", table_name="staged_datasets")
    op.drop_index("ix_staged_datasets_dhis2_logical_database_id", table_name="staged_datasets")
    op.drop_index("ix_staged_datasets_staged_source_id", table_name="staged_datasets")
    op.drop_index("ix_staged_datasets_source_type", table_name="staged_datasets")
    op.drop_table("staged_datasets")
    op.drop_index("ix_schedule_policies_refresh_enabled", table_name="schedule_policies")
    op.drop_table("schedule_policies")
    op.drop_table("dhis2_logical_databases")
    op.drop_index("ix_staged_sources_is_active", table_name="staged_sources")
    op.drop_index("ix_staged_sources_connection_id", table_name="staged_sources")
    op.drop_index("ix_staged_sources_source_type", table_name="staged_sources")
    op.drop_table("staged_sources")
