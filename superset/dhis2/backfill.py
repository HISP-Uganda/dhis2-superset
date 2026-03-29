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
"""Backward-compatibility backfill for DHIS2 staging/serving tables.

Runs **once at startup** (inside the Flask app context) to bring existing
datasets created by earlier versions of the code fully up-to-date without
any data loss or table rebuilds.

Three operations per dataset
----------------------------
1. **Add missing serving-table indexes** — uses ``_create_serving_index``
   (silent no-op if the index already exists) so old tables gain the same
   performance indexes that newly-built tables receive.

2. **Refresh query-planner statistics** — calls ``_run_analyze`` so the
   database chooses optimal execution plans immediately after upgrade.

3. **Re-register the serving table as a Superset SqlaTable** — the
   idempotent ``register_serving_table_as_superset_dataset`` call ensures:

   * ``dhis2_staged_dataset_id`` is present in ``SqlaTable.extra`` (required
     for the native-filter routing added in this release).
   * ``TableColumn.extra`` carries all current DHIS2 metadata flags
     (``dhis2_is_period``, ``dhis2_is_ou_hierarchy``, etc.) so the frontend
     can render hierarchy-aware filter controls without waiting for the next
     manual sync.

Idempotency
-----------
Every sub-operation is safe to run multiple times:
* ``CREATE INDEX IF NOT EXISTS`` / per-index try-except → no-op on re-run.
* ``ANALYZE`` → updates statistics, harmless on re-run.
* ``register_serving_table_as_superset_dataset`` checks for an existing
  ``SqlaTable`` record and only patches what is missing.

The backfill is intentionally non-fatal: a failure for one dataset is logged
and skipped; the remaining datasets continue to be processed.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy.exc import OperationalError as _SAOperationalError
from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# Column names that are always indexed regardless of extra metadata
_ALWAYS_INDEX: frozenset[str] = frozenset({"period", "dhis2_instance"})

# Known OU hierarchy column names (used to classify physical columns)
_OU_HIERARCHY_NAMES: frozenset[str] = frozenset({
    "national", "region", "district_city", "dlg_municipality_city_council",
    "sub_county_town_council_division", "health_facility", "ward_department",
    "ou_name", "organisation_unit",
})
_OU_LEVEL_NAMES: frozenset[str] = frozenset({"ou_level", "level"})
_PERIOD_NAMES: frozenset[str] = frozenset({"period"})
_INTERNAL_NAMES: frozenset[str] = frozenset({"dhis2_instance", "_manifest_build_v6"})
_REPOSITORY_SCHEMA_COLUMNS: tuple[tuple[str, str], ...] = (
    ("repository_reporting_unit_approach", "VARCHAR(50)"),
    ("lowest_data_level_to_use", "INTEGER"),
    ("primary_instance_id", "INTEGER"),
    ("repository_data_scope", "VARCHAR(50)"),
    ("repository_org_unit_config_json", "TEXT"),
    ("repository_org_unit_status", "VARCHAR(20)"),
    ("repository_org_unit_status_message", "TEXT"),
    ("repository_org_unit_task_id", "VARCHAR(255)"),
    ("repository_org_unit_last_finalized_at", "TIMESTAMP"),
)


def _legacy_dataset_display_name_from_table_name(table_name: str) -> str:
    fallback_name = re.sub(r"^sv_\d+_", "", table_name, flags=re.IGNORECASE)
    fallback_name = re.sub(r"_mart$", "", fallback_name, flags=re.IGNORECASE)
    return fallback_name.replace("_", " ").title().strip()


def _improved_dataset_display_name_from_table_name(table_name: str) -> str:
    base_name = re.sub(r"^sv_\d+_", "", table_name, flags=re.IGNORECASE)
    base_name = re.sub(r"_mart$", "", base_name, flags=re.IGNORECASE)
    parts = [part for part in base_name.split("_") if part]
    if not parts:
        return ""

    prefix = ""
    if len(parts[0]) <= 3 and parts[0].isalpha():
        prefix = parts.pop(0).upper()

    acronym_map = {
        "dhis2": "DHIS2",
        "ehmis": "eHMIS",
        "hmis": "HMIS",
    }
    words = [
        acronym_map.get(part.lower(), part.capitalize())
        for part in parts
    ]
    label = " ".join(words).strip()
    if prefix and label:
        return f"{prefix} - {label}"
    return prefix or label


def _table_exists(inspector: Any, table_name: str) -> bool:
    return inspector.has_table(table_name)


def _column_names(inspector: Any, table_name: str) -> set[str]:
    if not _table_exists(inspector, table_name):
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def _normalize_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _normalize_dataset_name(value: Any) -> str:
    return str(value or "").strip().casefold()


def _loads_json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _classify_dhis2_dataset_role(dataset: Any, extra: dict[str, Any]) -> str:
    from superset.datasets.policy import DatasetRole  # pylint: disable=import-outside-toplevel

    table_name = str(getattr(dataset, "table_name", "") or "")
    if (
        table_name.startswith("[KPI] ")
        or table_name.startswith("[Map] ")
        or table_name.endswith("_kpi")
        or table_name.endswith("_map")
        or table_name.endswith("_mart")
    ):
        return DatasetRole.MART.value

    if (
        bool(getattr(dataset, "sql", None))
        and getattr(dataset, "schema", None) in (None, "")
        and bool(extra.get("dhis2_staged_local"))
    ):
        return DatasetRole.METADATA.value

    return DatasetRole.SOURCE.value


def _dhis2_repair_sort_key(dataset: Any) -> tuple[int, str, int]:
    extra = _loads_json_dict(getattr(dataset, "extra", None))
    desired_role = _classify_dhis2_dataset_role(dataset, extra)
    role_rank = 0
    if desired_role == "MART":
        role_rank = 1
    elif desired_role == "METADATA":
        role_rank = 2
    return (
        role_rank,
        str(getattr(dataset, "table_name", "") or ""),
        int(getattr(dataset, "id", 0) or 0),
    )


def _build_instance_code_map(instance_rows: list[dict[str, Any]]) -> dict[int, str]:
    ordered = sorted(
        instance_rows,
        key=lambda row: (
            _normalize_optional_int(row.get("display_order")) or 0,
            str(row.get("name") or ""),
            _normalize_optional_int(row.get("id")) or 0,
        ),
    )
    code_map: dict[int, str] = {}
    for index, row in enumerate(ordered):
        instance_id = _normalize_optional_int(row.get("id"))
        if instance_id is None:
            continue
        code_map[instance_id] = (
            chr(ord("A") + index) if index < 26 else f"I{instance_id}"
        )
    return code_map


def _infer_repository_backfill_payload(
    instance_rows: list[dict[str, Any]],
    dataset_rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not instance_rows or not dataset_rows:
        return None

    primary_instance_ids: set[int] = set()
    scopes: set[str] = set()
    dataset_ids: list[int] = []
    selection_details: dict[str, dict[str, Any]] = {}

    for row in dataset_rows:
        dataset_id = _normalize_optional_int(row.get("id"))
        if dataset_id is not None:
            dataset_ids.append(dataset_id)
        dataset_config = _loads_json_dict(row.get("dataset_config"))
        source_mode = _normalize_optional_str(
            dataset_config.get("org_unit_source_mode") or row.get("org_unit_source_mode")
        )
        if source_mode not in (None, "primary"):
            return None
        primary_instance_id = _normalize_optional_int(
            row.get("primary_instance_id") or dataset_config.get("primary_instance_id")
        )
        if primary_instance_id is not None:
            primary_instance_ids.add(primary_instance_id)
        scope = _normalize_optional_str(
            row.get("org_unit_scope") or dataset_config.get("org_unit_scope")
        )
        if scope:
            scopes.add(scope)
        for raw_detail in _normalize_list(dataset_config.get("org_unit_details")):
            if not isinstance(raw_detail, dict):
                continue
            selection_key = _normalize_optional_str(
                raw_detail.get("selectionKey")
                or raw_detail.get("id")
                or raw_detail.get("sourceOrgUnitId")
            )
            if not selection_key:
                continue
            selection_details.setdefault(selection_key, dict(raw_detail))

    if len(primary_instance_ids) != 1 or not selection_details:
        return None
    if len(scopes) > 1:
        return None

    primary_instance_id = next(iter(primary_instance_ids))
    code_map = _build_instance_code_map(instance_rows)
    source_instance_code = code_map.get(primary_instance_id)
    selected_org_unit_details: list[dict[str, Any]] = []
    repository_org_units: list[dict[str, Any]] = []
    for detail in selection_details.values():
        selection_key = _normalize_optional_str(
            detail.get("selectionKey") or detail.get("id") or detail.get("sourceOrgUnitId")
        )
        source_uid = _normalize_optional_str(
            detail.get("sourceOrgUnitId") or detail.get("id")
        )
        display_name = _normalize_optional_str(
            detail.get("displayName") or detail.get("name")
        )
        if not selection_key or not source_uid or not display_name:
            continue
        level = _normalize_optional_int(detail.get("level"))
        repository_level = (
            _normalize_optional_int(detail.get("repositoryLevel")) or level
        )
        path = _normalize_optional_str(detail.get("path")) or f"/{source_uid}"
        selected_org_unit_details.append(
            {
                "id": selection_key,
                "selectionKey": selection_key,
                "sourceOrgUnitId": source_uid,
                "displayName": display_name,
                "level": level,
                "path": path,
                "sourceInstanceIds": [primary_instance_id],
                "repositoryLevel": repository_level,
                "repositoryLevelName": display_name,
            }
        )
        repository_org_units.append(
            {
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
                "lineage": [
                    {
                        "instance_id": primary_instance_id,
                        "source_instance_code": source_instance_code,
                        "source_org_unit_uid": source_uid,
                        "source_org_unit_name": display_name,
                        "source_parent_uid": None,
                        "source_path": path,
                        "source_level": level,
                        "provenance": {
                            "backfilled_from": "dhis2_staged_dataset_configs",
                            "dataset_ids": dataset_ids,
                        },
                    }
                ],
            }
        )

    if not repository_org_units:
        return None

    return {
        "repository_reporting_unit_approach": "primary_instance",
        "lowest_data_level_to_use": None,
        "primary_instance_id": primary_instance_id,
        "repository_data_scope": next(iter(scopes)) if scopes else "selected",
        "repository_org_unit_config": {
            "selected_org_units": sorted(selection_details.keys()),
            "selected_org_unit_details": selected_org_unit_details,
            "repository_org_units": repository_org_units,
            "backfilled_from": "dhis2_staged_dataset_configs",
            "backfilled_dataset_ids": dataset_ids,
        },
    }


def ensure_metadata_schema_compatibility() -> None:
    """Repair local metadata-schema drift for DHIS2 repository features.

    Some local workspaces have drifted SQLite metadata DBs whose Alembic
    revision marker does not match the actual physical schema. Repair the
    small set of DHIS2 repository tables/columns needed by the UI so the app
    can start and load repository-aware database records.
    """
    try:
        from superset.extensions import db  # pylint: disable=import-outside-toplevel

        with db.engine.begin() as connection:
            inspector = inspect(connection)
            if not _table_exists(inspector, "dbs"):
                return

            dbs_columns = _column_names(inspector, "dbs")
            for column_name, column_type in _REPOSITORY_SCHEMA_COLUMNS:
                if column_name not in dbs_columns:
                    connection.execute(
                        text(f"ALTER TABLE dbs ADD COLUMN {column_name} {column_type}")
                    )

            inspector = inspect(connection)
            if not _table_exists(inspector, "dhis2_repository_org_units"):
                connection.execute(
                    text(
                        """
                        CREATE TABLE dhis2_repository_org_units (
                            id INTEGER PRIMARY KEY,
                            database_id INTEGER NOT NULL,
                            repository_key VARCHAR(255) NOT NULL,
                            display_name VARCHAR(255) NOT NULL,
                            parent_repository_key VARCHAR(255),
                            level INTEGER,
                            hierarchy_path TEXT,
                            selection_key VARCHAR(255),
                            strategy VARCHAR(50),
                            source_lineage_label VARCHAR(50),
                            is_conflicted BOOLEAN NOT NULL DEFAULT 0,
                            is_unmatched BOOLEAN NOT NULL DEFAULT 0,
                            provenance_json TEXT,
                            FOREIGN KEY(database_id) REFERENCES dbs(id) ON DELETE CASCADE
                        )
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX uq_dhis2_repository_org_units_db_key
                        ON dhis2_repository_org_units (database_id, repository_key)
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_dhis2_repository_org_units_database_id
                        ON dhis2_repository_org_units (database_id)
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_dhis2_repository_org_units_database_id_level
                        ON dhis2_repository_org_units (database_id, level)
                        """
                    )
                )

            inspector = inspect(connection)
            if not _table_exists(inspector, "dhis2_repository_org_unit_lineage"):
                connection.execute(
                    text(
                        """
                        CREATE TABLE dhis2_repository_org_unit_lineage (
                            id INTEGER PRIMARY KEY,
                            repository_org_unit_id INTEGER NOT NULL,
                            database_id INTEGER NOT NULL,
                            instance_id INTEGER NOT NULL,
                            source_instance_role VARCHAR(50),
                            source_instance_code VARCHAR(20),
                            source_org_unit_uid VARCHAR(255) NOT NULL,
                            source_org_unit_name VARCHAR(255),
                            source_parent_uid VARCHAR(255),
                            source_path TEXT,
                            source_level INTEGER,
                            provenance_json TEXT,
                            FOREIGN KEY(repository_org_unit_id) REFERENCES dhis2_repository_org_units(id) ON DELETE CASCADE,
                            FOREIGN KEY(database_id) REFERENCES dbs(id) ON DELETE CASCADE,
                            FOREIGN KEY(instance_id) REFERENCES dhis2_instances(id) ON DELETE CASCADE
                        )
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX uq_dhis2_repository_org_unit_lineage
                        ON dhis2_repository_org_unit_lineage (
                            repository_org_unit_id,
                            instance_id,
                            source_org_unit_uid
                        )
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_dhis2_repository_org_unit_lineage_database_id
                        ON dhis2_repository_org_unit_lineage (database_id)
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_dhis2_repository_org_unit_lineage_instance_id
                        ON dhis2_repository_org_unit_lineage (instance_id)
                        """
                    )
                )

            database_rows = connection.execute(
                text(
                    """
                    SELECT
                      id,
                      sqlalchemy_uri,
                      repository_reporting_unit_approach,
                      repository_org_unit_config_json
                    FROM dbs
                    """
                )
            ).mappings()
            for database_row in database_rows:
                database_id = _normalize_optional_int(database_row.get("id"))
                if database_id is None:
                    continue
                sqlalchemy_uri = _normalize_optional_str(
                    database_row.get("sqlalchemy_uri")
                ) or ""
                if not sqlalchemy_uri.startswith("dhis2://"):
                    continue
                if _normalize_optional_str(
                    database_row.get("repository_reporting_unit_approach")
                ) or _loads_json_dict(database_row.get("repository_org_unit_config_json")):
                    continue
                existing_repository_units = connection.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM dhis2_repository_org_units
                        WHERE database_id = :database_id
                        """
                    ),
                    {"database_id": database_id},
                ).scalar_one()
                if existing_repository_units:
                    continue

                instance_rows = list(
                    connection.execute(
                        text(
                            """
                            SELECT id, name, display_order
                            FROM dhis2_instances
                            WHERE database_id = :database_id
                            ORDER BY display_order, name, id
                            """
                        ),
                        {"database_id": database_id},
                    ).mappings()
                )
                dataset_rows = list(
                    connection.execute(
                        text(
                            """
                            SELECT
                              id,
                              dataset_config,
                              primary_instance_id,
                              org_unit_source_mode,
                              org_unit_scope
                            FROM dhis2_staged_datasets
                            WHERE database_id = :database_id
                            ORDER BY id
                            """
                        ),
                        {"database_id": database_id},
                    ).mappings()
                )
                inferred = _infer_repository_backfill_payload(
                    instance_rows=instance_rows,
                    dataset_rows=dataset_rows,
                )
                if not inferred:
                    continue

                connection.execute(
                    text(
                        """
                        UPDATE dbs
                        SET
                          repository_reporting_unit_approach = :approach,
                          lowest_data_level_to_use = :lowest_level,
                          primary_instance_id = :primary_instance_id,
                          repository_data_scope = :data_scope,
                          repository_org_unit_config_json = :config_json,
                          repository_org_unit_status = :status,
                          repository_org_unit_status_message = NULL,
                          repository_org_unit_task_id = NULL,
                          repository_org_unit_last_finalized_at = CURRENT_TIMESTAMP
                        WHERE id = :database_id
                        """
                    ),
                    {
                        "database_id": database_id,
                        "approach": inferred["repository_reporting_unit_approach"],
                        "lowest_level": inferred["lowest_data_level_to_use"],
                        "primary_instance_id": inferred["primary_instance_id"],
                        "data_scope": inferred["repository_data_scope"],
                        "config_json": json.dumps(
                            inferred["repository_org_unit_config"],
                            sort_keys=True,
                        ),
                        "status": "ready",
                    },
                )

                instance_code_map = _build_instance_code_map(instance_rows)
                for candidate in _normalize_list(
                    inferred["repository_org_unit_config"].get("repository_org_units")
                ):
                    if not isinstance(candidate, dict):
                        continue
                    lineage_rows = [
                        row
                        for row in _normalize_list(candidate.get("lineage"))
                        if isinstance(row, dict)
                    ]
                    source_codes = sorted(
                        {
                            _normalize_optional_str(lineage_row.get("source_instance_code"))
                            or instance_code_map.get(
                                _normalize_optional_int(lineage_row.get("instance_id")) or -1
                            )
                            for lineage_row in lineage_rows
                        }
                        - {None}
                    )
                    repository_result = connection.execute(
                        text(
                            """
                            INSERT INTO dhis2_repository_org_units (
                              database_id,
                              repository_key,
                              display_name,
                              parent_repository_key,
                              level,
                              hierarchy_path,
                              selection_key,
                              strategy,
                              source_lineage_label,
                              is_conflicted,
                              is_unmatched,
                              provenance_json
                            ) VALUES (
                              :database_id,
                              :repository_key,
                              :display_name,
                              :parent_repository_key,
                              :level,
                              :hierarchy_path,
                              :selection_key,
                              :strategy,
                              :source_lineage_label,
                              :is_conflicted,
                              :is_unmatched,
                              :provenance_json
                            )
                            """
                        ),
                        {
                            "database_id": database_id,
                            "repository_key": candidate.get("repository_key"),
                            "display_name": candidate.get("display_name"),
                            "parent_repository_key": candidate.get("parent_repository_key"),
                            "level": candidate.get("level"),
                            "hierarchy_path": candidate.get("hierarchy_path"),
                            "selection_key": candidate.get("selection_key"),
                            "strategy": candidate.get("strategy"),
                            "source_lineage_label": ",".join(source_codes) or None,
                            "is_conflicted": 1 if candidate.get("is_conflicted") else 0,
                            "is_unmatched": 1 if candidate.get("is_unmatched") else 0,
                            "provenance_json": json.dumps(
                                candidate.get("provenance") or {},
                                sort_keys=True,
                            ),
                        },
                    )
                    repository_org_unit_id = repository_result.lastrowid
                    for lineage_row in lineage_rows:
                        instance_id = _normalize_optional_int(lineage_row.get("instance_id"))
                        source_org_unit_uid = _normalize_optional_str(
                            lineage_row.get("source_org_unit_uid")
                        )
                        if instance_id is None or not source_org_unit_uid:
                            continue
                        connection.execute(
                            text(
                                """
                                INSERT INTO dhis2_repository_org_unit_lineage (
                                  repository_org_unit_id,
                                  database_id,
                                  instance_id,
                                  source_instance_role,
                                  source_instance_code,
                                  source_org_unit_uid,
                                  source_org_unit_name,
                                  source_parent_uid,
                                  source_path,
                                  source_level,
                                  provenance_json
                                ) VALUES (
                                  :repository_org_unit_id,
                                  :database_id,
                                  :instance_id,
                                  :source_instance_role,
                                  :source_instance_code,
                                  :source_org_unit_uid,
                                  :source_org_unit_name,
                                  :source_parent_uid,
                                  :source_path,
                                  :source_level,
                                  :provenance_json
                                )
                                """
                            ),
                            {
                                "repository_org_unit_id": repository_org_unit_id,
                                "database_id": database_id,
                                "instance_id": instance_id,
                                "source_instance_role": _normalize_optional_str(
                                    lineage_row.get("source_instance_role")
                                ),
                                "source_instance_code": _normalize_optional_str(
                                    lineage_row.get("source_instance_code")
                                )
                                or instance_code_map.get(instance_id),
                                "source_org_unit_uid": source_org_unit_uid,
                                "source_org_unit_name": _normalize_optional_str(
                                    lineage_row.get("source_org_unit_name")
                                ),
                                "source_parent_uid": _normalize_optional_str(
                                    lineage_row.get("source_parent_uid")
                                ),
                                "source_path": _normalize_optional_str(
                                    lineage_row.get("source_path")
                                ),
                                "source_level": _normalize_optional_int(
                                    lineage_row.get("source_level")
                                ),
                                "provenance_json": json.dumps(
                                    lineage_row.get("provenance") or {},
                                    sort_keys=True,
                                ),
                            },
                        )
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "compat_backfill: metadata schema repair failed — continuing without repository repair",
            exc_info=True,
        )


def _sanitize_for_column(value: str) -> str:
    """Replicate analytical_serving.sanitize_serving_identifier logic."""
    sanitized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip())
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        return "column"
    if sanitized[0].isdigit():
        sanitized = f"c_{sanitized}"
    return sanitized.lower()


def _build_variable_type_lookup() -> dict[str, str]:
    """Build column-name → dhis2_variable_type mapping from metadata cache.

    Loads cached DHIS2 metadata snapshots (dataElements, indicators,
    programIndicators, eventDataItems, dataSets) and reverses the
    sanitize_serving_identifier transform to map each item's display name
    to the expected column name.  Returns ``{}`` on any error.
    """
    try:
        from superset import db  # pylint: disable=import-outside-toplevel
        from sqlalchemy import text  # pylint: disable=import-outside-toplevel

        type_map: dict[str, str] = {}
        ns_to_type = {
            "dhis2_snapshot:dataElements": "dataElement",
            "dhis2_snapshot:indicators": "indicator",
            "dhis2_snapshot:programIndicators": "programIndicator",
            "dhis2_snapshot:eventDataItems": "eventDataItem",
            "dhis2_snapshot:dataSets": "dataSet",
        }
        for ns, vtype in ns_to_type.items():
            rows = db.session.execute(
                text("SELECT metadata_json FROM source_metadata_cache "
                     "WHERE cache_namespace = :ns"),
                {"ns": ns},
            ).fetchall()
            for cache_row in rows:
                try:
                    payload = json.loads(cache_row[0])
                    items = payload.get("result") or []
                    for item in items:
                        name = item.get("name") or item.get("displayName") or ""
                        if not name:
                            continue
                        col_name = _sanitize_for_column(name)
                        if col_name and col_name not in type_map:
                            type_map[col_name] = vtype
                        # Also try shortName
                        short = item.get("shortName") or ""
                        if short and short != name:
                            col_short = _sanitize_for_column(short)
                            if col_short and col_short not in type_map:
                                type_map[col_short] = vtype
                except Exception:  # pylint: disable=broad-except
                    continue
        return type_map
    except Exception:  # pylint: disable=broad-except
        return {}


def _supplement_columns_from_physical(
    manifest_columns: list[dict[str, Any]],
    physical_cols: set[str],
    engine: Any,
    dataset: Any,
) -> list[dict[str, Any]]:
    """Add basic column specs for physical columns absent from the manifest.

    When DHIS2DatasetVariable records are missing, the manifest only contains
    OU hierarchy + period columns.  This function adds minimal specs for all
    other physical columns so SqlaTable registration does not remove them.

    Variable-type tags (DE/IN etc.) are recovered from the metadata cache
    where possible.
    """
    manifest_names = {str(c.get("column_name") or "") for c in manifest_columns}
    missing = [col for col in physical_cols if col not in manifest_names]
    if not missing:
        return manifest_columns

    # Build variable-type lookup lazily
    type_map = _build_variable_type_lookup()

    # Fetch ClickHouse column types for the serving table
    ch_type_map: dict[str, str] = {}
    try:
        serving_name = engine.get_serving_table_name(dataset)
        result = engine._qry(  # pylint: disable=protected-access
            "SELECT name, type FROM system.columns "
            "WHERE database = {db:String} AND table = {tbl:String} "
            "ORDER BY position",
            parameters={"db": engine._serving_database, "tbl": serving_name},  # pylint: disable=protected-access
        )
        ch_type_map = {r[0]: r[1] for r in result.result_rows}
    except Exception:  # pylint: disable=broad-except
        pass

    supplemented = list(manifest_columns)
    for col_name in missing:
        if col_name in _INTERNAL_NAMES:
            continue  # skip internal/marker columns

        ch_type = ch_type_map.get(col_name, "")
        is_numeric = any(t in ch_type for t in ("Float", "Int", "Decimal", "Numeric"))

        col_spec: dict[str, Any] = {
            "column_name": col_name,
            "verbose_name": col_name.replace("_", " ").title(),
            "type": "FLOAT" if is_numeric else "STRING",
            "is_dttm": False,
        }

        if col_name in _PERIOD_NAMES:
            col_spec["type"] = "STRING"
            col_spec["extra"] = {"dhis2_is_period": True}
        elif col_name in _OU_LEVEL_NAMES:
            col_spec["type"] = "INTEGER"
            col_spec["extra"] = {"dhis2_is_ou_level": True}
        elif col_name in _OU_HIERARCHY_NAMES or (
            not is_numeric and col_name not in _PERIOD_NAMES
        ):
            col_spec["type"] = "STRING"
            col_spec["extra"] = {"dhis2_is_ou_hierarchy": True}
        elif is_numeric:
            # Metric column — try to recover variable type from cache
            vtype = type_map.get(col_name)
            if vtype:
                col_spec["extra"] = {"dhis2_variable_type": vtype}

        supplemented.append(col_spec)

    logger.debug(
        "compat_backfill: supplemented %d columns from physical table for dataset id=%s",
        len(supplemented) - len(manifest_columns),
        dataset.id,
    )
    return supplemented


def _col_should_be_indexed(col_spec: dict[str, Any]) -> bool:
    """Return True if this column deserves a serving-table index."""
    col_name: str = str(col_spec.get("column_name") or "")
    if col_name in _ALWAYS_INDEX:
        return True

    raw_extra = col_spec.get("extra") or {}
    if isinstance(raw_extra, str):
        try:
            raw_extra = json.loads(raw_extra)
        except Exception:  # pylint: disable=broad-except
            raw_extra = {}

    return bool(
        raw_extra.get("dhis2_is_period")
        or raw_extra.get("dhis2_is_ou_hierarchy")
        or raw_extra.get("dhis2_is_dimension")
    )


def _backfill_one_dataset(
    dataset: Any,
    engine: Any,
    manifest_columns: list[dict[str, Any]],
) -> None:
    """Backfill indexes, statistics, and SqlaTable registration for one dataset."""
    from superset import db  # pylint: disable=import-outside-toplevel
    from superset.dhis2.analytical_serving import (  # pylint: disable=import-outside-toplevel
        dataset_columns_payload,
    )
    from superset.datasets.policy import DatasetRole  # pylint: disable=import-outside-toplevel
    from superset.dhis2.superset_dataset_service import (  # pylint: disable=import-outside-toplevel
        register_serving_table_as_superset_dataset,
    )

    full_name = engine.get_serving_sql_table_ref(dataset)
    table_name = engine.get_serving_table_name(dataset)

    # ------------------------------------------------------------------
    # 1 + 2. Indexes + ANALYZE — Postgres/DHIS2StagingEngine only
    # DuckDB and ClickHouse engines do not expose these private helpers.
    # ------------------------------------------------------------------
    if hasattr(engine, "_dialect_name"):
        try:
            dialect = engine._dialect_name  # pylint: disable=protected-access
            with db.engine.connect() as conn:
                engine.apply_connection_optimizations(conn, dialect)

                for col_spec in manifest_columns:
                    col_name = str(col_spec.get("column_name") or "")
                    if not col_name:
                        continue
                    if _col_should_be_indexed(col_spec):
                        engine._create_serving_index(  # pylint: disable=protected-access
                            conn, table_name, full_name, col_name
                        )

                engine._run_analyze(conn, full_name)  # pylint: disable=protected-access
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "compat_backfill: index/analyze step failed for dataset id=%s",
                dataset.id,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # 3. Re-register SqlaTable (idempotent — patches missing fields only)
    # ------------------------------------------------------------------
    # Use the engine's canonical serving Database (DuckDB/ClickHouse) not the
    # DHIS2 source database stored in engine.database_id.
    if hasattr(engine, "get_or_create_superset_database"):
        try:
            _sdb = engine.get_or_create_superset_database()
            serving_db_id = getattr(_sdb, "id", None)
        except Exception:  # pylint: disable=broad-except
            serving_db_id = getattr(engine, "database_id", None)
    else:
        serving_db_id = getattr(engine, "database_id", None)
    if serving_db_id is None:
        return

    try:
        from superset.dhis2.superset_dataset_service import (  # pylint: disable=import-outside-toplevel
            register_specialized_marts_as_superset_datasets,
        )
        serving_cols = dataset_columns_payload(manifest_columns)

        # Always repair the base `sv_*` source dataset as the hidden physical
        # DHIS2 source dataset, even when a consolidated `_mart` table also exists.
        register_serving_table_as_superset_dataset(
            dataset_id=dataset.id,
            dataset_name=dataset.name,
            serving_table_ref=full_name,
            serving_columns=serving_cols,
            serving_database_id=serving_db_id,
            source_database_id=dataset.database_id,
            dataset_role=DatasetRole.SOURCE.value,
        )

        # Derive mart table ref for this dataset
        mart_table_name = f"{table_name}_mart"
        has_mart = (
            hasattr(engine, "named_table_exists_in_serving")
            and engine.named_table_exists_in_serving(mart_table_name)
        )
        if has_mart:
            register_specialized_marts_as_superset_datasets(
                dataset_id=dataset.id,
                dataset_name=dataset.name,
                serving_table_ref=full_name,
                serving_columns=serving_cols,
                serving_database_id=serving_db_id,
                engine=engine,
                dataset=dataset,
            )
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "compat_backfill: SqlaTable re-registration failed for dataset id=%s",
            dataset.id,
            exc_info=True,
        )


def repair_dhis2_dataset_roles() -> int:
    """Restore the intended DHIS2 dataset role split on existing SqlaTable rows."""
    from superset import db  # pylint: disable=import-outside-toplevel
    from superset.connectors.sqla.models import SqlaTable  # pylint: disable=import-outside-toplevel
    from superset.datasets.policy import DatasetRole  # pylint: disable=import-outside-toplevel
    from superset.dhis2.models import DHIS2StagedDataset  # pylint: disable=import-outside-toplevel
    from superset.dhis2.superset_dataset_service import (  # pylint: disable=import-outside-toplevel
        register_metadata_dataset_as_superset_dataset,
    )

    candidates = (
        db.session.query(SqlaTable)
        .filter(
            SqlaTable.extra.like('%"dhis2_staged_dataset_id":%')
            | SqlaTable.extra.like('%"dhis2_staged_dataset_id": %')
        )
        .all()
    )

    repaired = 0
    source_display_by_base_name: dict[str, str] = {}
    metadata_registrations: list[dict[str, Any]] = []
    candidates.sort(key=_dhis2_repair_sort_key)

    for dataset in candidates:
        table_name = str(getattr(dataset, "table_name", "") or "")
        try:
            extra = json.loads(getattr(dataset, "extra", None) or "{}")
        except Exception:  # pylint: disable=broad-except
            extra = {}
        base_table_name = re.sub(r"_mart$", "", table_name, flags=re.IGNORECASE)
        desired_role = _classify_dhis2_dataset_role(dataset, extra)

        if getattr(dataset, "dataset_role", None) != desired_role:
            dataset.dataset_role = desired_role
            repaired += 1

        staged_dataset_id = extra.get("dhis2_staged_dataset_id")
        staged_dataset = (
            db.session.get(DHIS2StagedDataset, staged_dataset_id)
            if isinstance(staged_dataset_id, int)
            else None
        )
        base_display_name = _normalize_optional_str(
            getattr(staged_dataset, "name", None),
        )
        current_display_name = _normalize_optional_str(
            extra.get("dhis2_dataset_display_name"),
        )
        legacy_display_name = _legacy_dataset_display_name_from_table_name(table_name)
        sibling_source_display_name = _normalize_optional_str(
            source_display_by_base_name.get(base_table_name),
        )
        if not base_display_name and sibling_source_display_name:
            base_display_name = sibling_source_display_name
        if not base_display_name and current_display_name:
            normalized_current_display_name = re.sub(
                r"\s+\[MART\]$",
                "",
                current_display_name,
                flags=re.IGNORECASE,
            )
            if normalized_current_display_name != legacy_display_name:
                base_display_name = normalized_current_display_name
        if not base_display_name:
            base_display_name = _improved_dataset_display_name_from_table_name(
                table_name,
            ) or None

        if base_display_name:
            desired_display_name = (
                f"{base_display_name} [MART]"
                if desired_role == DatasetRole.MART.value
                else base_display_name
            )
            if extra.get("dhis2_dataset_display_name") != desired_display_name:
                extra["dhis2_dataset_display_name"] = desired_display_name
                dataset.extra = json.dumps(extra)
                repaired += 1
            if desired_role == DatasetRole.SOURCE.value:
                source_display_by_base_name[base_table_name] = base_display_name
                source_database_id = _normalize_optional_int(
                    extra.get("dhis2_source_database_id"),
                )
                serving_database_id = _normalize_optional_int(
                    extra.get("dhis2_serving_database_id"),
                )
                source_instance_ids = _normalize_list(
                    extra.get("dhis2_source_instance_ids"),
                )
                if (
                    isinstance(staged_dataset_id, int)
                    and source_database_id is not None
                    and serving_database_id is not None
                    and extra.get("dhis2_serving_table_ref")
                    and not getattr(dataset, "sql", None)
                ):
                    metadata_registrations.append(
                        {
                            "dataset_id": staged_dataset_id,
                            "dataset_name": base_display_name,
                            "serving_table_ref": str(
                                extra.get("dhis2_serving_table_ref"),
                            ),
                            "source_database_id": source_database_id,
                            "serving_database_id": serving_database_id,
                            "source_instance_ids": source_instance_ids,
                            "serving_columns": [
                                {
                                    "column_name": column.column_name,
                                    "type": column.type,
                                    "is_dttm": column.is_dttm,
                                    "filterable": column.filterable,
                                    "groupby": column.groupby,
                                    "is_active": column.is_active,
                                    "description": column.description,
                                    "verbose_name": column.verbose_name,
                                    "extra": column.extra,
                                }
                                for column in getattr(dataset, "columns", []) or []
                            ],
                        }
                    )

    if repaired:
        db.session.commit()
        logger.info("compat_backfill: repaired role/display metadata on %d DHIS2 datasets", repaired)

    metadata_repaired = 0
    for registration in metadata_registrations:
        try:
            register_metadata_dataset_as_superset_dataset(**registration)
            metadata_repaired += 1
        except Exception:  # pylint: disable=broad-except
            db.session.rollback()
            logger.warning(
                "compat_backfill: metadata dataset repair failed for staged dataset id=%s",
                registration.get("dataset_id"),
                exc_info=True,
            )

    if metadata_repaired:
        logger.info(
            "compat_backfill: ensured %d DHIS2 metadata datasets",
            metadata_repaired,
        )

    return repaired


def run_compatibility_backfill() -> None:
    """Entry point called once at application startup.

    Iterates every ``DHIS2StagedDataset`` that already has a serving table and
    runs the three backfill steps described in the module docstring.  Datasets
    whose serving tables do not yet exist are skipped — they will be built
    correctly when the next sync runs.
    """
    ensure_metadata_schema_compatibility()
    try:
        repair_dhis2_dataset_roles()
    except Exception:  # pylint: disable=broad-except
        logger.warning("compat_backfill: dataset_role repair failed", exc_info=True)
    try:
        from superset import db  # pylint: disable=import-outside-toplevel
        from superset.dhis2.analytical_serving import (  # pylint: disable=import-outside-toplevel
            build_serving_manifest,
        )
        from superset.dhis2.staged_dataset_service import (  # pylint: disable=import-outside-toplevel
            repair_staged_dataset_definition,
            recover_missing_staged_datasets_from_sqla_tables,
        )
        from superset.dhis2.models import DHIS2StagedDataset  # pylint: disable=import-outside-toplevel
        from superset.local_staging.engine_factory import (  # pylint: disable=import-outside-toplevel
            get_active_staging_engine,
        )

        # Clear any dirty session state left by alembic DDL operations so the
        # query below gets a clean transaction.
        try:
            db.session.rollback()
        except Exception:  # pylint: disable=broad-except
            pass

        recover_missing_staged_datasets_from_sqla_tables()
        datasets = db.session.query(DHIS2StagedDataset).all()
    except _SAOperationalError as _oe:
        # ORM model references columns not yet added by a pending migration
        # (e.g. warehouse extension columns).  Skip silently — the next
        # 'superset db upgrade' run will apply those columns and this
        # backfill will succeed on the following startup.
        logger.debug(
            "compat_backfill: schema not fully migrated yet — skipping. "
            "Run 'superset db upgrade' to apply pending migrations. "
            "Detail: %s",
            _oe,
            exc_info=True,
        )
        return
    except Exception:  # pylint: disable=broad-except
        logger.warning("compat_backfill: could not load datasets — skipping", exc_info=True)
        return

    processed = skipped = errors = 0

    # Suppress noisy urllib3/clickhouse_connect WARNING logs that fire when the
    # staging engine (e.g. ClickHouse) is not yet reachable during db upgrade/init.
    # We handle those cases gracefully below; the library warnings are redundant.
    import logging as _logging  # pylint: disable=import-outside-toplevel
    _urllib3_logger = _logging.getLogger("urllib3.connectionpool")
    _ch_logger = _logging.getLogger("clickhouse_connect.driver.httpclient")
    _urllib3_prev = _urllib3_logger.level
    _ch_prev = _ch_logger.level
    _urllib3_logger.setLevel(_logging.ERROR)
    _ch_logger.setLevel(_logging.ERROR)

    for dataset in datasets:
        try:
            repair_staged_dataset_definition(dataset.id)
            dataset = db.session.get(DHIS2StagedDataset, dataset.id) or dataset
            engine = get_active_staging_engine(dataset.database_id)

            if not engine.serving_table_exists(dataset):
                skipped += 1
                continue

            manifest = build_serving_manifest(dataset)
            all_columns: list[dict[str, Any]] = manifest.get("columns") or []

            # Filter to only columns that physically exist in the serving table.
            # Empty OU hierarchy columns may have been pruned at sync time;
            # registering them would add non-existent columns to the SqlaTable.
            physical_cols = set(engine.get_serving_table_columns(dataset))
            columns = (
                [c for c in all_columns if str(c.get("column_name") or "") in physical_cols]
                if physical_cols
                else all_columns
            )

            # When DHIS2DatasetVariable records are absent, the manifest only
            # has OU hierarchy + period columns.  Supplement with all remaining
            # physical columns so SqlaTable registration does not strip metric
            # columns — recovering dhis2_variable_type from metadata cache.
            has_variable_columns = any(c.get("variable_id") for c in columns)
            if not has_variable_columns and physical_cols:
                columns = _supplement_columns_from_physical(
                    columns, physical_cols, engine, dataset
                )

            _backfill_one_dataset(dataset, engine, columns)
            processed += 1

        except Exception as exc:  # pylint: disable=broad-except
            # Connection-refused means the staging engine (e.g. ClickHouse) is not
            # yet running when backfill executes during `db upgrade` / `init`.
            # This is expected — log at INFO only and do not count as an error.
            exc_str = str(exc)
            
            # Handle both network connectivity errors and partial database migrations
            # (where the model has columns not yet added to the actual database table).
            is_unreachable = "Connection refused" in exc_str or "NewConnectionError" in exc_str or "Max retries exceeded" in exc_str
            is_not_migrated = "UndefinedColumn" in exc_str or "ProgrammingError" in exc_str
            
            if is_unreachable or is_not_migrated:
                skipped += 1
                if is_unreachable:
                    logger.info(
                        "compat_backfill: staging engine not reachable for dataset id=%s — will retry on next startup",
                        dataset.id,
                    )
                else:
                    logger.info(
                        "compat_backfill: database schema not fully migrated for dataset id=%s — skipping for now",
                        dataset.id,
                    )
            else:
                errors += 1
                logger.warning(
                    "compat_backfill: unexpected error for dataset id=%s — skipping",
                    dataset.id,
                    exc_info=True,
                )

    # Restore log levels after the dataset loop
    _urllib3_logger.setLevel(_urllib3_prev)
    _ch_logger.setLevel(_ch_prev)

    # Ensure the DuckDB Superset Database record has read_only=True connect args
    # so chart queries don't compete for the write lock with the staging engine.
    try:
        from superset.local_staging.engine_factory import (  # pylint: disable=import-outside-toplevel
            get_active_staging_engine,
        )
        _probe_engine = get_active_staging_engine(0)
        if hasattr(_probe_engine, "get_or_create_superset_database"):
            _probe_engine.get_or_create_superset_database()
    except Exception:  # pylint: disable=broad-except
        logger.debug("compat_backfill: could not patch DuckDB database read_only — skipping", exc_info=True)

    # Commit any pending SqlaTable changes accumulated during registration
    try:
        from superset import db as _db  # pylint: disable=import-outside-toplevel
        _db.session.commit()
    except Exception:  # pylint: disable=broad-except
        logger.warning("compat_backfill: final commit failed", exc_info=True)

    logger.info(
        "compat_backfill: complete — processed=%d skipped=%d errors=%d",
        processed,
        skipped,
        errors,
    )
