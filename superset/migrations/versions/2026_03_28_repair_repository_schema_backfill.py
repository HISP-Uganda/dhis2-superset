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
"""Repair missing repository schema on drifted metadata DBs.

Revision ID: 2026_03_28_repair_repository_schema_backfill
Revises: 2026_03_28_merge_repository_org_unit_heads
Create Date: 2026-03-28 17:50:00.000000
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "2026_03_28_repair_repository_schema_backfill"
down_revision = "2026_03_28_merge_repository_org_unit_heads"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = inspect(op.get_bind())
    return column_name in [column["name"] for column in inspector.get_columns(table_name)]


def _ensure_repository_schema() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if not _column_exists("dbs", "repository_reporting_unit_approach"):
        op.add_column(
            "dbs",
            sa.Column("repository_reporting_unit_approach", sa.String(length=50), nullable=True),
        )
    if not _column_exists("dbs", "lowest_data_level_to_use"):
        op.add_column(
            "dbs",
            sa.Column("lowest_data_level_to_use", sa.Integer(), nullable=True),
        )
    if not _column_exists("dbs", "primary_instance_id"):
        op.add_column(
            "dbs",
            sa.Column("primary_instance_id", sa.Integer(), nullable=True),
        )
        if dialect != "sqlite":
            op.create_foreign_key(
                "fk_dbs_primary_instance_id_dhis2_instances",
                "dbs",
                "dhis2_instances",
                ["primary_instance_id"],
                ["id"],
                ondelete="SET NULL",
            )
    if not _column_exists("dbs", "repository_data_scope"):
        op.add_column(
            "dbs",
            sa.Column("repository_data_scope", sa.String(length=50), nullable=True),
        )
    if not _column_exists("dbs", "repository_org_unit_config_json"):
        op.add_column(
            "dbs",
            sa.Column("repository_org_unit_config_json", sa.Text(), nullable=True),
        )

    if not _table_exists("dhis2_repository_org_units"):
        op.create_table(
            "dhis2_repository_org_units",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("database_id", sa.Integer(), nullable=False),
            sa.Column("repository_key", sa.String(length=255), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column("parent_repository_key", sa.String(length=255), nullable=True),
            sa.Column("level", sa.Integer(), nullable=True),
            sa.Column("hierarchy_path", sa.Text(), nullable=True),
            sa.Column("selection_key", sa.String(length=255), nullable=True),
            sa.Column("strategy", sa.String(length=50), nullable=True),
            sa.Column("source_lineage_label", sa.String(length=50), nullable=True),
            sa.Column(
                "is_conflicted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "is_unmatched",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("provenance_json", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["database_id"], ["dbs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "database_id",
                "repository_key",
                name="uq_dhis2_repository_org_units_db_key",
            ),
        )
        op.create_index(
            "ix_dhis2_repository_org_units_database_id",
            "dhis2_repository_org_units",
            ["database_id"],
            unique=False,
        )
        op.create_index(
            "ix_dhis2_repository_org_units_database_id_level",
            "dhis2_repository_org_units",
            ["database_id", "level"],
            unique=False,
        )

    if not _table_exists("dhis2_repository_org_unit_lineage"):
        op.create_table(
            "dhis2_repository_org_unit_lineage",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("repository_org_unit_id", sa.Integer(), nullable=False),
            sa.Column("database_id", sa.Integer(), nullable=False),
            sa.Column("instance_id", sa.Integer(), nullable=False),
            sa.Column("source_instance_role", sa.String(length=50), nullable=True),
            sa.Column("source_instance_code", sa.String(length=20), nullable=True),
            sa.Column("source_org_unit_uid", sa.String(length=255), nullable=False),
            sa.Column("source_org_unit_name", sa.String(length=255), nullable=True),
            sa.Column("source_parent_uid", sa.String(length=255), nullable=True),
            sa.Column("source_path", sa.Text(), nullable=True),
            sa.Column("source_level", sa.Integer(), nullable=True),
            sa.Column("provenance_json", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(
                ["repository_org_unit_id"],
                ["dhis2_repository_org_units.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["database_id"], ["dbs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["instance_id"],
                ["dhis2_instances.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "repository_org_unit_id",
                "instance_id",
                "source_org_unit_uid",
                name="uq_dhis2_repository_org_unit_lineage",
            ),
        )
        op.create_index(
            "ix_dhis2_repository_org_unit_lineage_database_id",
            "dhis2_repository_org_unit_lineage",
            ["database_id"],
            unique=False,
        )
        op.create_index(
            "ix_dhis2_repository_org_unit_lineage_instance_id",
            "dhis2_repository_org_unit_lineage",
            ["instance_id"],
            unique=False,
        )


def _json_loads(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _normalize_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_str(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _build_instance_code_map(instance_rows: Iterable[dict[str, Any]]) -> dict[int, str]:
    ordered = sorted(
        instance_rows,
        key=lambda row: (
            _normalize_int(row.get("display_order")) or 0,
            str(row.get("name") or ""),
            _normalize_int(row.get("id")) or 0,
        ),
    )
    instance_code_map: dict[int, str] = {}
    for index, row in enumerate(ordered):
        instance_id = _normalize_int(row.get("id"))
        if instance_id is None:
            continue
        instance_code_map[instance_id] = (
            chr(ord("A") + index) if index < 26 else f"I{instance_id}"
        )
    return instance_code_map


def _build_repository_candidate(
    detail: dict[str, Any],
    primary_instance_id: int,
    source_instance_code: str | None,
    dataset_ids: list[int],
) -> dict[str, Any] | None:
    selection_key = _normalize_str(
        detail.get("selectionKey") or detail.get("id") or detail.get("sourceOrgUnitId")
    )
    source_uid = _normalize_str(detail.get("sourceOrgUnitId") or detail.get("id"))
    display_name = _normalize_str(detail.get("displayName") or detail.get("name"))
    if not selection_key or not source_uid or not display_name:
        return None

    source_level = _normalize_int(detail.get("level"))
    repository_level = _normalize_int(detail.get("repositoryLevel")) or source_level
    path = _normalize_str(detail.get("path")) or f"/{source_uid}"
    lineage = {
        "instance_id": primary_instance_id,
        "source_instance_code": source_instance_code,
        "source_org_unit_uid": source_uid,
        "source_org_unit_name": display_name,
        "source_parent_uid": None,
        "source_path": path,
        "source_level": source_level,
        "provenance": {
            "backfilled_from": "dhis2_staged_dataset_configs",
            "dataset_ids": dataset_ids,
        },
    }

    return {
        "repository_key": selection_key,
        "display_name": display_name,
        "parent_repository_key": None,
        "level": repository_level,
        "hierarchy_path": selection_key,
        "selection_key": selection_key,
        "strategy": "primary_instance",
        "is_conflicted": False,
        "is_unmatched": False,
        "provenance": {
            "inferred": True,
            "backfilled_from": "dhis2_staged_dataset_configs",
            "dataset_ids": dataset_ids,
        },
        "lineage": [lineage],
    }


def _infer_backfill_payload(
    instance_rows: list[dict[str, Any]],
    dataset_rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not instance_rows or not dataset_rows:
        return None

    dataset_ids: list[int] = []
    primary_instance_ids: set[int] = set()
    scopes: set[str] = set()
    selection_details: dict[str, dict[str, Any]] = {}

    for row in dataset_rows:
        dataset_id = _normalize_int(row.get("id"))
        if dataset_id is not None:
            dataset_ids.append(dataset_id)
        dataset_config = _json_loads(row.get("dataset_config"))
        source_mode = _normalize_str(
            dataset_config.get("org_unit_source_mode") or row.get("org_unit_source_mode")
        )
        if source_mode not in (None, "primary"):
            return None

        primary_instance_id = _normalize_int(
            row.get("primary_instance_id") or dataset_config.get("primary_instance_id")
        )
        if primary_instance_id is not None:
            primary_instance_ids.add(primary_instance_id)

        scope = _normalize_str(
            row.get("org_unit_scope") or dataset_config.get("org_unit_scope")
        )
        if scope:
            scopes.add(scope)

        for raw_detail in _normalize_list(dataset_config.get("org_unit_details")):
            if not isinstance(raw_detail, dict):
                continue
            selection_key = _normalize_str(
                raw_detail.get("selectionKey")
                or raw_detail.get("id")
                or raw_detail.get("sourceOrgUnitId")
            )
            if not selection_key:
                continue
            existing = selection_details.get(selection_key)
            if existing is None:
                selection_details[selection_key] = dict(raw_detail)
                continue
            if not existing.get("displayName") and raw_detail.get("displayName"):
                existing["displayName"] = raw_detail.get("displayName")
            if not existing.get("path") and raw_detail.get("path"):
                existing["path"] = raw_detail.get("path")
            if existing.get("level") in (None, "") and raw_detail.get("level") not in (
                None,
                "",
            ):
                existing["level"] = raw_detail.get("level")

    if len(primary_instance_ids) != 1 or not selection_details:
        return None
    if len(scopes) > 1:
        return None

    primary_instance_id = next(iter(primary_instance_ids))
    instance_code_map = _build_instance_code_map(instance_rows)
    source_instance_code = instance_code_map.get(primary_instance_id)
    candidate_units = [
        candidate
        for candidate in (
            _build_repository_candidate(
                detail=detail,
                primary_instance_id=primary_instance_id,
                source_instance_code=source_instance_code,
                dataset_ids=dataset_ids,
            )
            for detail in selection_details.values()
        )
        if candidate is not None
    ]
    if not candidate_units:
        return None

    selected_org_unit_details = []
    for detail in selection_details.values():
        selection_key = _normalize_str(
            detail.get("selectionKey") or detail.get("id") or detail.get("sourceOrgUnitId")
        )
        source_uid = _normalize_str(detail.get("sourceOrgUnitId") or detail.get("id"))
        display_name = _normalize_str(detail.get("displayName") or detail.get("name"))
        if not selection_key or not source_uid or not display_name:
            continue
        selected_org_unit_details.append(
            {
                "id": selection_key,
                "selectionKey": selection_key,
                "sourceOrgUnitId": source_uid,
                "displayName": display_name,
                "level": _normalize_int(detail.get("level")),
                "path": _normalize_str(detail.get("path")) or f"/{source_uid}",
                "sourceInstanceIds": [primary_instance_id],
                "repositoryLevel": _normalize_int(detail.get("repositoryLevel"))
                or _normalize_int(detail.get("level")),
                "repositoryLevelName": display_name,
            }
        )

    return {
        "repository_reporting_unit_approach": "primary_instance",
        "lowest_data_level_to_use": None,
        "primary_instance_id": primary_instance_id,
        "repository_data_scope": next(iter(scopes)) if scopes else "selected",
        "repository_org_unit_config": {
            "selected_org_units": sorted(selection_details.keys()),
            "selected_org_unit_details": selected_org_unit_details,
            "repository_org_units": candidate_units,
            "backfilled_from": "dhis2_staged_dataset_configs",
            "backfilled_dataset_ids": dataset_ids,
        },
    }


def _backfill_repository_config() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()

    dbs = sa.Table("dbs", metadata, autoload_with=bind)
    instances = sa.Table("dhis2_instances", metadata, autoload_with=bind)
    datasets = sa.Table("dhis2_staged_datasets", metadata, autoload_with=bind)
    repository_units = sa.Table(
        "dhis2_repository_org_units",
        metadata,
        autoload_with=bind,
    )
    lineage = sa.Table(
        "dhis2_repository_org_unit_lineage",
        metadata,
        autoload_with=bind,
    )

    db_rows = bind.execute(
        sa.select(
            dbs.c.id,
            dbs.c.database_name,
            dbs.c.sqlalchemy_uri,
            dbs.c.repository_reporting_unit_approach,
            dbs.c.lowest_data_level_to_use,
            dbs.c.primary_instance_id,
            dbs.c.repository_data_scope,
            dbs.c.repository_org_unit_config_json,
        )
    ).mappings()

    for db_row in db_rows:
        database_id = _normalize_int(db_row.get("id"))
        if database_id is None:
            continue
        sqlalchemy_uri = _normalize_str(db_row.get("sqlalchemy_uri")) or ""
        if not sqlalchemy_uri.startswith("dhis2://"):
            continue

        if (
            _normalize_str(db_row.get("repository_reporting_unit_approach"))
            or _json_loads(db_row.get("repository_org_unit_config_json"))
            or bind.execute(
                sa.select(sa.func.count())
                .select_from(repository_units)
                .where(repository_units.c.database_id == database_id)
            ).scalar()
        ):
            continue

        instance_rows = list(
            bind.execute(
                sa.select(
                    instances.c.id,
                    instances.c.name,
                    instances.c.display_order,
                ).where(instances.c.database_id == database_id)
            ).mappings()
        )
        dataset_rows = list(
            bind.execute(
                sa.select(
                    datasets.c.id,
                    datasets.c.database_id,
                    datasets.c.dataset_config,
                    datasets.c.primary_instance_id,
                    datasets.c.org_unit_source_mode,
                    datasets.c.org_unit_scope,
                ).where(datasets.c.database_id == database_id)
            ).mappings()
        )
        inferred = _infer_backfill_payload(instance_rows, dataset_rows)
        if not inferred:
            continue

        bind.execute(
            dbs.update()
            .where(dbs.c.id == database_id)
            .values(
                repository_reporting_unit_approach=inferred[
                    "repository_reporting_unit_approach"
                ],
                lowest_data_level_to_use=inferred["lowest_data_level_to_use"],
                primary_instance_id=inferred["primary_instance_id"],
                repository_data_scope=inferred["repository_data_scope"],
                repository_org_unit_config_json=json.dumps(
                    inferred["repository_org_unit_config"],
                    sort_keys=True,
                ),
            )
        )

        bind.execute(
            lineage.delete().where(lineage.c.database_id == database_id)
        )
        bind.execute(
            repository_units.delete().where(repository_units.c.database_id == database_id)
        )

        instance_code_map = _build_instance_code_map(instance_rows)
        for candidate in _normalize_list(
            inferred["repository_org_unit_config"].get("repository_org_units")
        ):
            insert_result = bind.execute(
                repository_units.insert().values(
                    database_id=database_id,
                    repository_key=candidate.get("repository_key"),
                    display_name=candidate.get("display_name"),
                    parent_repository_key=candidate.get("parent_repository_key"),
                    level=candidate.get("level"),
                    hierarchy_path=candidate.get("hierarchy_path"),
                    selection_key=candidate.get("selection_key"),
                    strategy=candidate.get("strategy"),
                    source_lineage_label=",".join(
                        sorted(
                            {
                                _normalize_str(
                                    lineage_row.get("source_instance_code")
                                )
                                or instance_code_map.get(
                                    _normalize_int(lineage_row.get("instance_id")) or -1
                                )
                                for lineage_row in _normalize_list(candidate.get("lineage"))
                                if isinstance(lineage_row, dict)
                            }
                            - {None}
                        )
                    )
                    or None,
                    is_conflicted=bool(candidate.get("is_conflicted")),
                    is_unmatched=bool(candidate.get("is_unmatched")),
                    provenance_json=json.dumps(
                        candidate.get("provenance") or {},
                        sort_keys=True,
                    ),
                )
            )
            repository_org_unit_id = insert_result.inserted_primary_key[0]
            for lineage_row in _normalize_list(candidate.get("lineage")):
                if not isinstance(lineage_row, dict):
                    continue
                instance_id = _normalize_int(lineage_row.get("instance_id"))
                source_org_unit_uid = _normalize_str(
                    lineage_row.get("source_org_unit_uid")
                )
                if instance_id is None or not source_org_unit_uid:
                    continue
                bind.execute(
                    lineage.insert().values(
                        repository_org_unit_id=repository_org_unit_id,
                        database_id=database_id,
                        instance_id=instance_id,
                        source_instance_role=_normalize_str(
                            lineage_row.get("source_instance_role")
                        ),
                        source_instance_code=_normalize_str(
                            lineage_row.get("source_instance_code")
                        )
                        or instance_code_map.get(instance_id),
                        source_org_unit_uid=source_org_unit_uid,
                        source_org_unit_name=_normalize_str(
                            lineage_row.get("source_org_unit_name")
                        ),
                        source_parent_uid=_normalize_str(
                            lineage_row.get("source_parent_uid")
                        ),
                        source_path=_normalize_str(lineage_row.get("source_path")),
                        source_level=_normalize_int(lineage_row.get("source_level")),
                        provenance_json=json.dumps(
                            lineage_row.get("provenance") or {},
                            sort_keys=True,
                        ),
                    )
                )


def upgrade() -> None:
    _ensure_repository_schema()
    _backfill_repository_config()


def downgrade() -> None:
    # This repair migration is intentionally non-destructive on downgrade. The
    # previous repository migration owns the schema lifecycle.
    pass
