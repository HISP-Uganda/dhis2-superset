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
"""DHIS2 comprehensive warehouse integration.

Adds operational columns to dhis2_staged_datasets, query profile table,
raw audit tables, dimension/fact tables, tracker staging tables, and
tracker config table.

Revision ID: dhis2_warehouse_v1
Revises: local_staging_settings_v1
Create Date: 2026-03-18
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector

revision = "dhis2_warehouse_v1"
down_revision = "local_staging_settings_v1"


# ---------------------------------------------------------------------------
# Idempotency helpers
# ---------------------------------------------------------------------------


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    insp = Inspector.from_engine(bind)
    return column in {c["name"] for c in insp.get_columns(table)}


def _table_exists(table: str) -> bool:
    bind = op.get_bind()
    insp = Inspector.from_engine(bind)
    return table in insp.get_table_names()


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # A — New operational columns on dhis2_staged_datasets
    # -----------------------------------------------------------------------
    new_cols = [
        ("source_mode", sa.Column("source_mode", sa.String(50), nullable=True, server_default="analytics")),
        ("preserve_period_dimension", sa.Column("preserve_period_dimension", sa.Boolean, nullable=False, server_default=sa.false())),
        ("preserve_orgunit_dimension", sa.Column("preserve_orgunit_dimension", sa.Boolean, nullable=False, server_default=sa.false())),
        ("preserve_category_dimensions", sa.Column("preserve_category_dimensions", sa.Boolean, nullable=False, server_default=sa.false())),
        ("history_start_date", sa.Column("history_start_date", sa.Date, nullable=True)),
        ("rolling_window_months", sa.Column("rolling_window_months", sa.Integer, nullable=True)),
        ("root_orgunits_json", sa.Column("root_orgunits_json", sa.Text, nullable=True)),
        ("max_orgunit_level", sa.Column("max_orgunit_level", sa.Integer, nullable=True)),
        ("include_descendants", sa.Column("include_descendants", sa.Boolean, nullable=False, server_default=sa.false())),
        ("refresh_mode", sa.Column("refresh_mode", sa.String(50), nullable=True)),
        ("id_scheme_input", sa.Column("id_scheme_input", sa.String(50), nullable=True)),
        ("id_scheme_output", sa.Column("id_scheme_output", sa.String(50), nullable=True)),
        ("display_property", sa.Column("display_property", sa.String(50), nullable=True)),
        ("approval_level", sa.Column("approval_level", sa.Integer, nullable=True)),
        ("error_policy", sa.Column("error_policy", sa.String(50), nullable=True)),
        ("retry_policy", sa.Column("retry_policy", sa.Text, nullable=True)),
    ]
    for col_name, col_def in new_cols:
        if not _column_exists("dhis2_staged_datasets", col_name):
            op.add_column("dhis2_staged_datasets", col_def)

    # -----------------------------------------------------------------------
    # B — dhis2_query_profiles
    # -----------------------------------------------------------------------
    if not _table_exists("dhis2_query_profiles"):
        op.create_table(
            "dhis2_query_profiles",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column(
                "staged_dataset_id",
                sa.Integer,
                sa.ForeignKey("dhis2_staged_datasets.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("endpoint", sa.String(255), nullable=True),
            sa.Column("dimensions_json", sa.Text, nullable=True),
            sa.Column("filters_json", sa.Text, nullable=True),
            sa.Column("rows_json", sa.Text, nullable=True),
            sa.Column("columns_json", sa.Text, nullable=True),
            sa.Column("table_layout", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("include_num_den", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("skip_rounding", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("hide_empty_rows", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("hide_empty_columns", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("hierarchy_meta", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("ignore_limit", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("time_window_rule_json", sa.Text, nullable=True),
            sa.Column("orgunit_partition_rule_json", sa.Text, nullable=True),
            sa.Column("selected_dx_types_json", sa.Text, nullable=True),
            sa.Column("category_settings_json", sa.Text, nullable=True),
            sa.Column("created_on", sa.DateTime, nullable=True),
        )
        op.create_index(
            "ix_dhis2_query_profiles_staged_dataset_id",
            "dhis2_query_profiles",
            ["staged_dataset_id"],
        )

    # -----------------------------------------------------------------------
    # C — Raw audit tables
    # -----------------------------------------------------------------------
    if not _table_exists("stg_dhis2_analytics_raw"):
        op.create_table(
            "stg_dhis2_analytics_raw",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("batch_id", sa.String(64), nullable=True),
            sa.Column("dataset_config_id", sa.Integer, nullable=True),
            sa.Column("connection_id", sa.Integer, nullable=True),
            sa.Column("extracted_at", sa.DateTime, nullable=True),
            sa.Column("headers_json", sa.Text, nullable=True),
            sa.Column("metadata_json", sa.Text, nullable=True),
            sa.Column("rows_json", sa.Text, nullable=True),
            sa.Column("format", sa.String(20), nullable=True),
            sa.Column("source_version", sa.String(50), nullable=True),
        )
        op.create_index("ix_stg_dhis2_analytics_raw_batch_id", "stg_dhis2_analytics_raw", ["batch_id"])
        op.create_index("ix_stg_dhis2_analytics_raw_dataset_config_id", "stg_dhis2_analytics_raw", ["dataset_config_id"])
        op.create_index("ix_stg_dhis2_analytics_raw_extracted_at", "stg_dhis2_analytics_raw", ["extracted_at"])

    if not _table_exists("stg_dhis2_datavalueset_raw"):
        op.create_table(
            "stg_dhis2_datavalueset_raw",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("batch_id", sa.String(64), nullable=True),
            sa.Column("dataset_config_id", sa.Integer, nullable=True),
            sa.Column("connection_id", sa.Integer, nullable=True),
            sa.Column("extracted_at", sa.DateTime, nullable=True),
            sa.Column("payload_format", sa.String(20), nullable=True),
            sa.Column("data_json", sa.Text, nullable=True),
            sa.Column("import_summary_json", sa.Text, nullable=True),
            sa.Column("source_version", sa.String(50), nullable=True),
        )
        op.create_index("ix_stg_dhis2_datavalueset_raw_batch_id", "stg_dhis2_datavalueset_raw", ["batch_id"])
        op.create_index("ix_stg_dhis2_datavalueset_raw_dataset_config_id", "stg_dhis2_datavalueset_raw", ["dataset_config_id"])
        op.create_index("ix_stg_dhis2_datavalueset_raw_extracted_at", "stg_dhis2_datavalueset_raw", ["extracted_at"])

    # -----------------------------------------------------------------------
    # D — Dimension tables
    # -----------------------------------------------------------------------
    if not _table_exists("dim_dhis2_org_unit"):
        op.create_table(
            "dim_dhis2_org_unit",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("instance_id", sa.Integer, nullable=False),
            sa.Column("org_unit_uid", sa.String(11), nullable=False),
            sa.Column("name", sa.String(255), nullable=True),
            sa.Column("short_name", sa.String(50), nullable=True),
            sa.Column("code", sa.String(100), nullable=True),
            sa.Column("level", sa.Integer, nullable=True),
            sa.Column("path", sa.Text, nullable=True),
            sa.Column("parent_uid", sa.String(11), nullable=True),
            sa.Column("opening_date", sa.Date, nullable=True),
            sa.Column("closed_date", sa.Date, nullable=True),
            sa.Column("geometry_json", sa.Text, nullable=True),
            sa.Column("attributes_json", sa.Text, nullable=True),
            sa.Column("refreshed_at", sa.DateTime, nullable=True),
            sa.UniqueConstraint("instance_id", "org_unit_uid", name="uq_dim_org_unit_inst_uid"),
        )
        op.create_index("ix_dim_dhis2_org_unit_inst_level", "dim_dhis2_org_unit", ["instance_id", "level"])
        op.create_index("ix_dim_dhis2_org_unit_path", "dim_dhis2_org_unit", ["path"])

    if not _table_exists("dim_dhis2_period"):
        op.create_table(
            "dim_dhis2_period",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("instance_id", sa.Integer, nullable=False),
            sa.Column("period_id", sa.String(20), nullable=False),
            sa.Column("period_type", sa.String(30), nullable=True),
            sa.Column("start_date", sa.Date, nullable=True),
            sa.Column("end_date", sa.Date, nullable=True),
            sa.Column("year", sa.Integer, nullable=True),
            sa.Column("quarter", sa.Integer, nullable=True),
            sa.Column("month", sa.Integer, nullable=True),
            sa.Column("week", sa.Integer, nullable=True),
            sa.Column("sortable_key", sa.String(20), nullable=True),
            sa.UniqueConstraint("instance_id", "period_id", name="uq_dim_period_inst_pid"),
        )
        op.create_index("ix_dim_dhis2_period_sortable_key", "dim_dhis2_period", ["sortable_key"])
        op.create_index("ix_dim_dhis2_period_start_date", "dim_dhis2_period", ["start_date"])

    if not _table_exists("dim_dhis2_data_item"):
        op.create_table(
            "dim_dhis2_data_item",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("instance_id", sa.Integer, nullable=False),
            sa.Column("data_item_uid", sa.String(11), nullable=False),
            sa.Column("data_item_type", sa.String(50), nullable=True),
            sa.Column("name", sa.String(255), nullable=True),
            sa.Column("short_name", sa.String(50), nullable=True),
            sa.Column("code", sa.String(100), nullable=True),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("value_type", sa.String(30), nullable=True),
            sa.Column("aggregation_type", sa.String(30), nullable=True),
            sa.Column("attributes_json", sa.Text, nullable=True),
            sa.Column("refreshed_at", sa.DateTime, nullable=True),
            sa.UniqueConstraint("instance_id", "data_item_uid", name="uq_dim_data_item_inst_uid"),
        )
        op.create_index("ix_dim_dhis2_data_item_type", "dim_dhis2_data_item", ["instance_id", "data_item_type"])

    # -----------------------------------------------------------------------
    # E — Fact tables
    # -----------------------------------------------------------------------
    if not _table_exists("fact_dhis2_analytics"):
        op.create_table(
            "fact_dhis2_analytics",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("instance_id", sa.Integer, nullable=False),
            sa.Column("dataset_config_id", sa.Integer, nullable=True),
            sa.Column("batch_id", sa.String(64), nullable=True),
            sa.Column("data_item_uid", sa.String(11), nullable=True),
            sa.Column("period_id", sa.String(20), nullable=True),
            sa.Column("period_start_date", sa.Date, nullable=True),
            sa.Column("org_unit_uid", sa.String(11), nullable=True),
            sa.Column("org_unit_path", sa.Text, nullable=True),
            sa.Column("category_option_combo_uid", sa.String(11), nullable=True),
            sa.Column("attribute_option_combo_uid", sa.String(11), nullable=True),
            sa.Column("value", sa.Text, nullable=True),
            sa.Column("numerator", sa.Text, nullable=True),
            sa.Column("denominator", sa.Text, nullable=True),
            sa.Column("factor", sa.Text, nullable=True),
            sa.Column("multiplier", sa.Text, nullable=True),
            sa.Column("divisor", sa.Text, nullable=True),
            sa.Column("inserted_at", sa.DateTime, nullable=True),
        )
        op.create_index("ix_fact_analytics_dx_period", "fact_dhis2_analytics", ["instance_id", "data_item_uid", "period_id"])
        op.create_index("ix_fact_analytics_ou_period", "fact_dhis2_analytics", ["instance_id", "org_unit_uid", "period_id"])
        op.create_index("ix_fact_analytics_dataset", "fact_dhis2_analytics", ["dataset_config_id"])
        op.create_index("ix_fact_analytics_period_date", "fact_dhis2_analytics", ["period_start_date"])
        op.create_index("ix_fact_analytics_ou_path", "fact_dhis2_analytics", ["org_unit_path"])
        op.create_index("ix_fact_analytics_batch", "fact_dhis2_analytics", ["batch_id"])

    if not _table_exists("fact_dhis2_datavalue"):
        op.create_table(
            "fact_dhis2_datavalue",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("instance_id", sa.Integer, nullable=False),
            sa.Column("dataset_config_id", sa.Integer, nullable=True),
            sa.Column("batch_id", sa.String(64), nullable=True),
            sa.Column("data_element_uid", sa.String(11), nullable=True),
            sa.Column("data_set_uid", sa.String(11), nullable=True),
            sa.Column("period_id", sa.String(20), nullable=True),
            sa.Column("period_start_date", sa.Date, nullable=True),
            sa.Column("org_unit_uid", sa.String(11), nullable=True),
            sa.Column("org_unit_path", sa.Text, nullable=True),
            sa.Column("category_option_combo_uid", sa.String(11), nullable=True),
            sa.Column("attribute_option_combo_uid", sa.String(11), nullable=True),
            sa.Column("value", sa.Text, nullable=True),
            sa.Column("stored_by", sa.String(255), nullable=True),
            sa.Column("created", sa.DateTime, nullable=True),
            sa.Column("last_updated", sa.DateTime, nullable=True),
            sa.Column("comment", sa.Text, nullable=True),
            sa.Column("follow_up", sa.Boolean, nullable=True),
            sa.Column("deleted_flag", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("inserted_at", sa.DateTime, nullable=True),
        )
        op.create_index("ix_fact_datavalue_dx_period", "fact_dhis2_datavalue", ["instance_id", "data_element_uid", "period_id"])
        op.create_index("ix_fact_datavalue_ou_period", "fact_dhis2_datavalue", ["instance_id", "org_unit_uid", "period_id"])
        op.create_index("ix_fact_datavalue_dataset", "fact_dhis2_datavalue", ["dataset_config_id"])
        op.create_index("ix_fact_datavalue_period_date", "fact_dhis2_datavalue", ["period_start_date"])
        op.create_index("ix_fact_datavalue_ou_path", "fact_dhis2_datavalue", ["org_unit_path"])
        op.create_index("ix_fact_datavalue_batch", "fact_dhis2_datavalue", ["batch_id"])
        op.create_index("ix_fact_datavalue_deleted", "fact_dhis2_datavalue", ["instance_id", "deleted_flag"])

    # -----------------------------------------------------------------------
    # F — Tracker staging tables (DDL only, no ORM)
    # -----------------------------------------------------------------------
    if not _table_exists("stg_dhis2_tracker_events"):
        op.create_table(
            "stg_dhis2_tracker_events",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("instance_id", sa.Integer, nullable=False),
            sa.Column("batch_id", sa.String(64), nullable=True),
            sa.Column("event_uid", sa.String(11), nullable=True),
            sa.Column("program_uid", sa.String(11), nullable=True),
            sa.Column("program_stage_uid", sa.String(11), nullable=True),
            sa.Column("enrollment_uid", sa.String(11), nullable=True),
            sa.Column("tracked_entity_uid", sa.String(11), nullable=True),
            sa.Column("org_unit_uid", sa.String(11), nullable=True),
            sa.Column("event_date", sa.Date, nullable=True),
            sa.Column("due_date", sa.Date, nullable=True),
            sa.Column("status", sa.String(20), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
            sa.Column("data_values_json", sa.Text, nullable=True),
            sa.Column("coordinates_json", sa.Text, nullable=True),
            sa.Column("raw_json", sa.Text, nullable=True),
            sa.Column("inserted_at", sa.DateTime, nullable=True),
        )
        op.create_index("ix_stg_tracker_events_inst_prog", "stg_dhis2_tracker_events", ["instance_id", "program_uid"])
        op.create_index("ix_stg_tracker_events_date", "stg_dhis2_tracker_events", ["event_date"])
        op.create_index("ix_stg_tracker_events_batch", "stg_dhis2_tracker_events", ["batch_id"])

    if not _table_exists("stg_dhis2_enrollments"):
        op.create_table(
            "stg_dhis2_enrollments",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("instance_id", sa.Integer, nullable=False),
            sa.Column("batch_id", sa.String(64), nullable=True),
            sa.Column("enrollment_uid", sa.String(11), nullable=True),
            sa.Column("program_uid", sa.String(11), nullable=True),
            sa.Column("tracked_entity_uid", sa.String(11), nullable=True),
            sa.Column("org_unit_uid", sa.String(11), nullable=True),
            sa.Column("enrollment_date", sa.Date, nullable=True),
            sa.Column("incident_date", sa.Date, nullable=True),
            sa.Column("status", sa.String(20), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
            sa.Column("attributes_json", sa.Text, nullable=True),
            sa.Column("raw_json", sa.Text, nullable=True),
            sa.Column("inserted_at", sa.DateTime, nullable=True),
        )
        op.create_index("ix_stg_enrollments_inst_prog", "stg_dhis2_enrollments", ["instance_id", "program_uid"])
        op.create_index("ix_stg_enrollments_batch", "stg_dhis2_enrollments", ["batch_id"])

    if not _table_exists("stg_dhis2_tracked_entities"):
        op.create_table(
            "stg_dhis2_tracked_entities",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("instance_id", sa.Integer, nullable=False),
            sa.Column("batch_id", sa.String(64), nullable=True),
            sa.Column("tracked_entity_uid", sa.String(11), nullable=True),
            sa.Column("tracked_entity_type_uid", sa.String(11), nullable=True),
            sa.Column("org_unit_uid", sa.String(11), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
            sa.Column("inactive", sa.Boolean, nullable=True),
            sa.Column("deleted_flag", sa.Boolean, nullable=True),
            sa.Column("attributes_json", sa.Text, nullable=True),
            sa.Column("raw_json", sa.Text, nullable=True),
            sa.Column("inserted_at", sa.DateTime, nullable=True),
        )
        op.create_index("ix_stg_tracked_entities_inst_tet", "stg_dhis2_tracked_entities", ["instance_id", "tracked_entity_type_uid"])
        op.create_index("ix_stg_tracked_entities_batch", "stg_dhis2_tracked_entities", ["batch_id"])

    # -----------------------------------------------------------------------
    # G — dhis2_tracker_configs
    # -----------------------------------------------------------------------
    if not _table_exists("dhis2_tracker_configs"):
        op.create_table(
            "dhis2_tracker_configs",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column(
                "staged_dataset_id",
                sa.Integer,
                sa.ForeignKey("dhis2_staged_datasets.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "instance_id",
                sa.Integer,
                sa.ForeignKey("dhis2_instances.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("program_uid", sa.String(11), nullable=True),
            sa.Column("tracked_entity_type_uid", sa.String(11), nullable=True),
            sa.Column("program_stage_uid", sa.String(11), nullable=True),
            sa.Column("extract_scope", sa.String(50), nullable=False, server_default="events"),
            sa.Column("start_date", sa.Date, nullable=True),
            sa.Column("end_date", sa.Date, nullable=True),
            sa.Column("last_updated_duration", sa.String(20), nullable=True),
            sa.Column("org_unit_uid", sa.String(11), nullable=True),
            sa.Column("ou_mode", sa.String(20), nullable=False, server_default="SELECTED"),
            sa.Column("page_size", sa.Integer, nullable=True, server_default="100"),
            sa.Column("extra_params", sa.Text, nullable=True),
            sa.Column("created_on", sa.DateTime, nullable=True),
            sa.Column("changed_on", sa.DateTime, nullable=True),
        )
        op.create_index(
            "ix_dhis2_tracker_configs_staged_dataset_id",
            "dhis2_tracker_configs",
            ["staged_dataset_id"],
        )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------


def downgrade() -> None:
    # Drop in reverse dependency order
    for table in [
        "dhis2_tracker_configs",
        "stg_dhis2_tracked_entities",
        "stg_dhis2_enrollments",
        "stg_dhis2_tracker_events",
        "fact_dhis2_datavalue",
        "fact_dhis2_analytics",
        "dim_dhis2_data_item",
        "dim_dhis2_period",
        "dim_dhis2_org_unit",
        "stg_dhis2_datavalueset_raw",
        "stg_dhis2_analytics_raw",
        "dhis2_query_profiles",
    ]:
        if _table_exists(table):
            op.drop_table(table)

    # Remove added columns from dhis2_staged_datasets
    new_col_names = [
        "source_mode",
        "preserve_period_dimension",
        "preserve_orgunit_dimension",
        "preserve_category_dimensions",
        "history_start_date",
        "rolling_window_months",
        "root_orgunits_json",
        "max_orgunit_level",
        "include_descendants",
        "refresh_mode",
        "id_scheme_input",
        "id_scheme_output",
        "display_property",
        "approval_level",
        "error_policy",
        "retry_policy",
    ]
    for col_name in new_col_names:
        if _column_exists("dhis2_staged_datasets", col_name):
            op.drop_column("dhis2_staged_datasets", col_name)
