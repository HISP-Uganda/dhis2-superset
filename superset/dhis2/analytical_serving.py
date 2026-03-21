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
"""Helpers for projecting DHIS2 staged rows into analytical serving columns."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
import json
import logging
import re
from typing import Any, Mapping, Sequence

import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.sql.elements import ColumnElement

from superset import db
from superset.dhis2.models import DHIS2DatasetVariable, DHIS2StagedDataset
from superset.dhis2.org_unit_hierarchy_service import OrgUnitHierarchyService
from superset.dhis2.period_hierarchy_service import PeriodHierarchyService
from superset.staging import metadata_cache_service

_ORG_UNIT_HIERARCHY_NAMESPACE = "dhis2_snapshot:orgUnitHierarchy"
_ORG_UNIT_LEVELS_NAMESPACE = "dhis2_snapshot:organisationUnitLevels"
_DHIS2_OU_HIERARCHY_EXTRA_KEY = "dhis2_is_ou_hierarchy"
_DHIS2_OU_LEVEL_EXTRA_KEY = "dhis2_ou_level"
_DHIS2_PERIOD_EXTRA_KEY = "dhis2_is_period"
_DHIS2_LEGEND_EXTRA_KEY = "dhis2_legend"
# Category Option Combo dimension columns (opt-in disaggregation-as-dimension)
_DHIS2_COC_EXTRA_KEY = "dhis2_is_coc"
_DHIS2_COC_UID_EXTRA_KEY = "dhis2_is_coc_uid"

logger = logging.getLogger(__name__)

_NUMERIC_VALUE_TYPES = {
    "AGE",
    "BOOLEAN",
    "COORDINATE",
    "INTEGER",
    "INTEGER_NEGATIVE",
    "INTEGER_POSITIVE",
    "INTEGER_ZERO_OR_POSITIVE",
    "NUMBER",
    "PERCENTAGE",
    "UNIT_INTERVAL",
}

_VARIABLE_METADATA_TYPES = {
    "dataelement": "dataElements",
    "dataelements": "dataElements",
    "indicator": "indicators",
    "indicators": "indicators",
    "dataset": "dataSets",
    "datasets": "dataSets",
    "programindicator": "programIndicators",
    "programindicators": "programIndicators",
    "eventdataitem": "eventDataItems",
    "eventdataitems": "eventDataItems",
    "eventdataelement": "eventDataItems",
}


def _normalize_variable_type(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def sanitize_serving_identifier(value: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip())
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        return "column"
    if sanitized[0].isdigit():
        sanitized = f"c_{sanitized}"
    return sanitized.lower()


def _dedupe_identifier(value: str, used: set[str]) -> str:
    candidate = sanitize_serving_identifier(value)
    if candidate not in used:
        used.add(candidate)
        return candidate

    suffix = 2
    while f"{candidate}_{suffix}" in used:
        suffix += 1
    deduped = f"{candidate}_{suffix}"
    used.add(deduped)
    return deduped


def _snapshot_key_parts(instance_id: int | None) -> dict[str, Any]:
    return {"instance_id": instance_id} if instance_id is not None else {}


def _load_snapshot(
    database_id: int,
    namespace: str,
    instance_id: int | None,
) -> dict[str, Any] | None:
    try:
        return metadata_cache_service.get_cached_metadata_payload(
            database_id,
            namespace,
            _snapshot_key_parts(instance_id),
        )
    except Exception:  # pylint: disable=broad-except
        return None


def _dataset_variables(dataset: DHIS2StagedDataset) -> list[DHIS2DatasetVariable]:
    variables = list(getattr(dataset, "variables", []) or [])
    if variables:
        return variables
    return (
        db.session.query(DHIS2DatasetVariable)
        .filter(DHIS2DatasetVariable.staged_dataset_id == dataset.id)
        .order_by(DHIS2DatasetVariable.id.asc())
        .all()
    )


def _config_value(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in item:
            return item[key]
    return None


def _detail_level(detail: dict[str, Any]) -> int | None:
    candidate = _config_value(detail, "level", "repositoryLevel")
    try:
        return int(candidate) if candidate is not None else None
    except (TypeError, ValueError):
        return None


def _detail_instance_ids(detail: dict[str, Any]) -> list[int]:
    raw_ids = _config_value(detail, "source_instance_ids", "sourceInstanceIds") or []
    if not isinstance(raw_ids, list):
        return []
    instance_ids: list[int] = []
    for item in raw_ids:
        try:
            instance_ids.append(int(item))
        except (TypeError, ValueError):
            continue
    return list(dict.fromkeys(instance_ids))


def _detail_source_id(detail: dict[str, Any]) -> str | None:
    candidate = _config_value(detail, "source_org_unit_id", "sourceOrgUnitId", "id")
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()
    return None


def _detail_selection_key(detail: dict[str, Any]) -> str | None:
    candidate = _config_value(detail, "selection_key", "selectionKey", "id")
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()
    return None


def _detail_path(detail: dict[str, Any]) -> str:
    path = _config_value(detail, "path")
    return str(path).strip() if path is not None else ""


def _detail_path_parts(detail: dict[str, Any]) -> list[str]:
    return [part for part in _detail_path(detail).split("/") if part]


def _details_share_instance_scope(
    ancestor_detail: dict[str, Any],
    descendant_detail: dict[str, Any],
) -> bool:
    ancestor_ids = set(_detail_instance_ids(ancestor_detail))
    descendant_ids = set(_detail_instance_ids(descendant_detail))
    if not ancestor_ids or not descendant_ids:
        return True
    return bool(ancestor_ids & descendant_ids)


def _detail_is_descendant_of(
    descendant_detail: dict[str, Any],
    ancestor_detail: dict[str, Any],
) -> bool:
    ancestor_source_id = _detail_source_id(ancestor_detail)
    descendant_source_id = _detail_source_id(descendant_detail)
    if not ancestor_source_id or not descendant_source_id:
        return False
    if ancestor_source_id == descendant_source_id:
        return False
    if not _details_share_instance_scope(ancestor_detail, descendant_detail):
        return False

    path_parts = _detail_path_parts(descendant_detail)
    if path_parts:
        return ancestor_source_id in path_parts[:-1]

    return False


def _selected_root_details(dataset_config: dict[str, Any]) -> list[dict[str, Any]]:
    org_unit_details = dataset_config.get("org_unit_details") or []
    if not isinstance(org_unit_details, list):
        org_unit_details = []

    detail_map: dict[str, dict[str, Any]] = {}
    for detail in org_unit_details:
        if not isinstance(detail, dict):
            continue
        selection_key = _detail_selection_key(detail)
        if selection_key:
            detail_map[selection_key] = detail

    raw_selected_keys = dataset_config.get("org_units") or []
    selected_keys = [
        str(item).strip()
        for item in raw_selected_keys
        if str(item).strip()
    ]
    if not selected_keys:
        selected_keys = list(detail_map.keys())

    selected_details = [
        detail_map[key]
        for key in selected_keys
        if key in detail_map
    ]
    if not selected_details:
        selected_details = list(detail_map.values())

    ordered_details = sorted(
        selected_details,
        key=lambda detail: (
            _detail_level(detail) or 0,
            len(_detail_path_parts(detail)),
            _detail_selection_key(detail) or "",
        ),
    )

    roots: list[dict[str, Any]] = []
    for detail in ordered_details:
        if any(_detail_is_descendant_of(detail, root) for root in roots):
            continue
        roots.append(detail)
    return roots


def _scope_max_level(scope: str, selected_level: int, hierarchy_max_level: int) -> int:
    normalized_scope = str(scope or "selected").strip().lower()
    if normalized_scope == "children":
        return min(selected_level + 1, hierarchy_max_level)
    if normalized_scope == "grandchildren":
        return min(selected_level + 2, hierarchy_max_level)
    if normalized_scope == "all_levels":
        return hierarchy_max_level
    return min(selected_level, hierarchy_max_level)


def _get_level_mapping(dataset_config: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Return mapping rows when ``level_mapping.enabled`` is True, else ``None``.

    A ``None`` return means "use auto-merge logic".  An empty list means the
    user explicitly enabled mapping but defined no rows (no hierarchy columns
    will be generated).
    """
    lm = dataset_config.get("level_mapping")
    if not isinstance(lm, dict):
        return None
    if not lm.get("enabled"):
        return None
    rows = list(lm.get("rows") or [])
    # Validate / filter rows that have a usable merged_level
    valid: list[dict[str, Any]] = []
    for row in rows:
        try:
            merged_level = int(row.get("merged_level"))
        except (TypeError, ValueError):
            continue
        if merged_level > 0:
            valid.append({**row, "merged_level": merged_level})
    return valid


def _resolve_level_labels(
    database_id: int,
    instance_ids: list[int],
    max_level: int,
    mapping_rows: list[dict[str, Any]] | None = None,
) -> dict[int, str]:
    # When a custom mapping is supplied, use the user-defined labels directly.
    if mapping_rows is not None:
        return {
            row["merged_level"]: str(
                row.get("label") or f"Level {row['merged_level']}"
            ).strip() or f"Level {row['merged_level']}"
            for row in mapping_rows
        }

    labels_by_level: dict[int, Counter[str]] = defaultdict(Counter)

    for instance_id in instance_ids:
        snapshot = _load_snapshot(database_id, _ORG_UNIT_LEVELS_NAMESPACE, instance_id)
        if snapshot is None or snapshot.get("status") != "success":
            continue
        for level_item in list(snapshot.get("result") or []):
            try:
                level_number = int(level_item.get("level"))
            except (TypeError, ValueError):
                continue
            if level_number <= 0:
                continue
            label = str(
                level_item.get("displayName")
                or level_item.get("name")
                or f"Level {level_number}"
            ).strip()
            if label:
                labels_by_level[level_number][label] += 1

    resolved: dict[int, str] = {}
    for level_number in range(1, max_level + 1):
        candidates = labels_by_level.get(level_number)
        if candidates:
            resolved[level_number] = candidates.most_common(1)[0][0]
        else:
            resolved[level_number] = f"Level {level_number}"
    return resolved


def _resolve_level_range(
    dataset: DHIS2StagedDataset,
    instance_ids: list[int],
    mapping_rows: list[dict[str, Any]] | None = None,
) -> list[int]:
    # When a custom mapping is supplied, use its merged_level values directly.
    if mapping_rows is not None:
        levels = sorted({row["merged_level"] for row in mapping_rows})
        return levels

    dataset_config = dataset.get_dataset_config()
    selected_root_details = _selected_root_details(dataset_config)

    normalized_scope = str(dataset_config.get("org_unit_scope") or "selected").strip().lower()
    max_level = 0

    for instance_id in instance_ids:
        snapshot = _load_snapshot(dataset.database_id, _ORG_UNIT_HIERARCHY_NAMESPACE, instance_id)
        if snapshot is None or snapshot.get("status") != "success":
            continue
        nodes = list(snapshot.get("result") or [])
        hierarchy_max_level = 0
        for node in nodes:
            try:
                hierarchy_max_level = max(hierarchy_max_level, int(node.get("level") or 0))
            except (TypeError, ValueError):
                continue

        selected_levels = [
            level
            for detail in selected_root_details
            if isinstance(detail, dict)
            and (
                not _detail_instance_ids(detail)
                or instance_id in _detail_instance_ids(detail)
            )
            for level in [_detail_level(detail)]
            if level is not None
        ]

        if selected_levels:
            instance_max = max(
                _scope_max_level(normalized_scope, level, hierarchy_max_level)
                for level in selected_levels
            )
        else:
            instance_max = hierarchy_max_level

        max_level = max(max_level, instance_max)

    return list(range(1, max_level + 1)) if max_level > 0 else []


def _build_instance_level_map(
    instance_id: int,
    hierarchy_columns: list[dict[str, Any]],
    mapping_rows: list[dict[str, Any]] | None,
) -> dict[int, str]:
    """Return ``{raw_level: column_name}`` for a single DHIS2 instance.

    When *mapping_rows* is ``None`` (auto-merge), every merged level maps to the
    same raw level (1:1).  When a custom mapping is provided, the raw level for
    ``instance_id`` is read from ``row["instance_levels"][str(instance_id)]``
    and then mapped to the column that was built for ``row["merged_level"]``.
    """
    if mapping_rows is None:
        return {
            int(col["level"]): col["column_name"] for col in hierarchy_columns
        }

    result: dict[int, str] = {}
    merged_level_to_column = {
        int(col["level"]): col["column_name"] for col in hierarchy_columns
    }
    instance_key = str(instance_id)
    for row in mapping_rows:
        merged_level = row["merged_level"]
        column_name = merged_level_to_column.get(merged_level)
        if column_name is None:
            continue
        raw_level = (row.get("instance_levels") or {}).get(instance_key)
        if raw_level is None:
            continue
        try:
            result[int(raw_level)] = column_name
        except (TypeError, ValueError):
            continue
    return result


def _build_hierarchy_lookup(
    dataset: DHIS2StagedDataset,
    instance_ids: list[int],
    hierarchy_columns: list[dict[str, Any]],
    mapping_rows: list[dict[str, Any]] | None = None,
) -> dict[tuple[int, str], dict[str, Any]]:
    if not hierarchy_columns:
        return {}

    hierarchy_lookup: dict[tuple[int, str], dict[str, Any]] = {}

    for instance_id in instance_ids:
        relevant_levels = _build_instance_level_map(
            instance_id, hierarchy_columns, mapping_rows
        )
        snapshot = _load_snapshot(dataset.database_id, _ORG_UNIT_HIERARCHY_NAMESPACE, instance_id)
        if snapshot is None or snapshot.get("status") != "success":
            continue
        nodes = [
            node
            for node in list(snapshot.get("result") or [])
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        ]
        node_lookup = {
            str(node.get("id") or "").strip(): node
            for node in nodes
            if str(node.get("id") or "").strip()
        }

        for node in nodes:
            node_id = str(node.get("id") or "").strip()
            path = str(node.get("path") or "").strip()
            path_parts = [part for part in path.split("/") if part]
            if not path_parts:
                ancestor_ids = node.get("ancestorIds")
                if isinstance(ancestor_ids, list):
                    path_parts = [str(item).strip() for item in ancestor_ids if str(item).strip()]
                path_parts.append(node_id)

            level_values: dict[str, Any] = {}
            for ancestor_id in path_parts:
                ancestor = node_lookup.get(ancestor_id)
                if ancestor is None:
                    continue
                try:
                    level_number = int(ancestor.get("level") or 0)
                except (TypeError, ValueError):
                    continue
                column_name = relevant_levels.get(level_number)
                if not column_name:
                    continue
                level_values[column_name] = (
                    ancestor.get("displayName")
                    or ancestor.get("name")
                    or ancestor_id
                )

            hierarchy_lookup[(instance_id, node_id)] = level_values

    return hierarchy_lookup


def _lookup_variable_metadata_item(
    dataset: DHIS2StagedDataset,
    variable: DHIS2DatasetVariable,
) -> dict[str, Any] | None:
    metadata_type = _VARIABLE_METADATA_TYPES.get(
        _normalize_variable_type(variable.variable_type)
    )
    if metadata_type is None:
        return None

    snapshot = _load_snapshot(
        dataset.database_id,
        f"dhis2_snapshot:{metadata_type}",
        variable.instance_id,
    )
    if snapshot is None or snapshot.get("status") != "success":
        return None

    for item in list(snapshot.get("result") or []):
        if str(item.get("id") or "") == str(variable.variable_id):
            return item
    return None


def _column_python_type(
    dataset: DHIS2StagedDataset,
    variable: DHIS2DatasetVariable,
    metadata_item: dict[str, Any] | None = None,
) -> str:
    normalized_type = _normalize_variable_type(variable.variable_type)
    if normalized_type in {"indicator", "indicators", "programindicator", "programindicators"}:
        return "FLOAT"

    metadata_item = metadata_item or _lookup_variable_metadata_item(dataset, variable)
    if not metadata_item:
        return "FLOAT"

    value_type = str(metadata_item.get("valueType") or "").strip().upper()
    if value_type in _NUMERIC_VALUE_TYPES:
        return "FLOAT"
    return "STRING"


def _build_variable_column_extra(
    variable: DHIS2DatasetVariable,
    metadata_item: dict[str, Any] | None,
) -> dict[str, Any] | None:
    extra: dict[str, Any] = {
        "dhis2_variable_id": str(variable.variable_id or "").strip(),
        "dhis2_variable_type": str(variable.variable_type or "").strip(),
        "dhis2_source_instance_id": getattr(variable, "instance_id", None),
    }

    if getattr(variable, "instance", None) is not None:
        instance_name = str(getattr(variable.instance, "name", "") or "").strip()
        if instance_name:
            extra["dhis2_source_instance_name"] = instance_name

    if isinstance(metadata_item, dict):
        value_type = str(metadata_item.get("valueType") or "").strip()
        if value_type:
            extra["dhis2_value_type"] = value_type

        legend_definition = metadata_item.get("legendDefinition")
        if isinstance(legend_definition, dict) and list(
            legend_definition.get("items") or []
        ):
            extra[_DHIS2_LEGEND_EXTRA_KEY] = legend_definition

    cleaned_extra = {
        key: value for key, value in extra.items() if value not in (None, "", [])
    }
    return cleaned_extra or None


def _load_distinct_cocs_for_variable(
    dataset: DHIS2StagedDataset,
    variable_id: str,
) -> list[dict[str, str]]:
    """Return distinct ``(co_uid, co_name)`` pairs present in the staging table.

    Queries the staging table for all distinct category option combo UIDs and
    names for a given ``dx_uid``.  Results are sorted by ``co_name`` so column
    ordering is deterministic across re-materializations.

    Returns a list of ``{"co_uid": str, "co_name": str}`` dicts, excluding rows
    where ``co_uid`` is NULL or empty.
    """
    from superset.dhis2.staging_engine import DHIS2StagingEngine

    engine = DHIS2StagingEngine(dataset.database_id)
    if not engine.table_exists(dataset):
        return []

    full_name = engine.get_superset_sql_table_ref(dataset)
    sql = (
        f"SELECT DISTINCT co_uid, co_name "  # noqa: S608
        f"FROM {full_name} "
        f"WHERE dx_uid = :dx_uid AND co_uid IS NOT NULL AND co_uid != '' "
        f"ORDER BY co_name"
    )
    try:
        with db.engine.connect() as conn:
            rows = conn.execute(text(sql), {"dx_uid": variable_id})
            return [
                {"co_uid": str(row._mapping["co_uid"]), "co_name": str(row._mapping["co_name"] or "")}
                for row in rows
            ]
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "_load_distinct_cocs_for_variable: query failed for variable_id=%s", variable_id
        )
        return []


def build_serving_manifest(dataset: DHIS2StagedDataset) -> dict[str, Any]:
    variables = _dataset_variables(dataset)
    dataset_config = dataset.get_dataset_config()
    selected_instance_ids = [
        int(instance_id)
        for instance_id in list(dataset_config.get("configured_connection_ids") or [])
        if str(instance_id).strip().isdigit()
    ]
    if not selected_instance_ids:
        selected_instance_ids = list(
            dict.fromkeys(variable.instance_id for variable in variables if variable.instance_id)
        )

    include_instance_name = len(selected_instance_ids) > 1
    used_identifiers: set[str] = set()
    columns: list[dict[str, Any]] = []
    dimension_column_names: list[str] = []
    org_unit_service = OrgUnitHierarchyService(dataset.database_id)
    period_service = PeriodHierarchyService()

    if include_instance_name:
        instance_column_name = _dedupe_identifier("dhis2_instance", used_identifiers)
        columns.append(
            {
                "column_name": instance_column_name,
                "verbose_name": "DHIS2 Instance",
                "type": "STRING",
                "sql_type": "TEXT",
                "is_dttm": False,
                "is_dimension": True,
                # Internal routing column — exists in the serving table for
                # multi-instance deduplication but must NOT appear in chart
                # control panels or the Explore sidebar.
                "extra": {"dhis2_is_internal": True},
            }
        )
        dimension_column_names.append(instance_column_name)

    org_unit_context = org_unit_service.augment_serving_schema(
        dataset_config,
        selected_instance_ids,
        used_identifiers,
    )
    hierarchy_columns = list(org_unit_context.hierarchy_columns)
    if hierarchy_columns:
        columns.extend(hierarchy_columns)
        dimension_column_names.extend(org_unit_context.dimension_column_names)
    elif org_unit_context.fallback_org_unit_column:
        columns.append(
            {
                "column_name": org_unit_context.fallback_org_unit_column,
                "verbose_name": "Organisation Unit",
                "type": "STRING",
                "sql_type": "TEXT",
                "is_dttm": False,
                "is_dimension": True,
                "is_org_unit_fallback": True,
            }
        )
        dimension_column_names.extend(org_unit_context.dimension_column_names)

    period_context = period_service.augment_serving_schema(
        dataset_config,
        used_identifiers,
    )
    primary_period_column = next(
        (
            column
            for column in period_context.columns
            if column["column_name"] == period_context.primary_period_column
        ),
        None,
    )
    if primary_period_column is None:
        raise ValueError("Serving manifest must define a primary period column")
    columns.append(primary_period_column)
    dimension_column_names.append(period_context.primary_period_column)

    # ou_level column — allows buildQuery to filter rows to a specific OU level
    # and prevents double-counting when data is loaded at multiple levels.
    ou_level_column_name = _dedupe_identifier("ou_level", used_identifiers)
    columns.append(
        {
            "column_name": ou_level_column_name,
            "verbose_name": "OU Level",
            "type": "INTEGER",
            "sql_type": "INTEGER",
            "is_dttm": False,
            "is_dimension": True,
            "extra": {
                "dhis2_is_ou_level": True,
            },
        }
    )
    dimension_column_names.append(ou_level_column_name)
    columns.extend(
        column
        for column in period_context.columns
        if column["column_name"] != period_context.primary_period_column
    )

    # ── Disaggregation dimension (opt-in) ─────────────────────────────────────
    # When ``include_disaggregation_dimension`` is true the staging co_uid / co_name
    # fields are promoted to first-class dimension columns so users can group and
    # filter charts by Category Option Combo without pivoting variables.
    include_coc_dimension = bool(dataset_config.get("include_disaggregation_dimension"))
    coc_uid_column_name: str | None = None
    coc_name_column_name: str | None = None
    if include_coc_dimension:
        coc_uid_column_name = _dedupe_identifier("co_uid", used_identifiers)
        columns.append(
            {
                "column_name": coc_uid_column_name,
                "verbose_name": "Category Option Combo (UID)",
                "type": "STRING",
                "sql_type": "TEXT",
                "is_dttm": False,
                "is_dimension": True,
                "extra": {_DHIS2_COC_UID_EXTRA_KEY: True},
            }
        )
        dimension_column_names.append(coc_uid_column_name)

        coc_name_column_name = _dedupe_identifier("disaggregation", used_identifiers)
        columns.append(
            {
                "column_name": coc_name_column_name,
                "verbose_name": "Disaggregation",
                "type": "STRING",
                "sql_type": "TEXT",
                "is_dttm": False,
                "is_dimension": True,
                "extra": {_DHIS2_COC_EXTRA_KEY: True},
            }
        )
        dimension_column_names.append(coc_name_column_name)

    label_counts = Counter(
        (
            variable.alias
            or variable.variable_name
            or variable.variable_id
            or "Variable"
        ).strip().lower()
        for variable in variables
    )

    variable_columns: list[dict[str, Any]] = []
    # New: key is (dx_uid, coc_uid | None) so COC-expanded columns can be looked up.
    variable_lookup: dict[tuple[str, str | None], dict[str, Any]] = {}

    for variable in variables:
        base_label = (
            variable.alias or variable.variable_name or variable.variable_id or "Variable"
        ).strip()
        if label_counts[base_label.lower()] > 1 and variable.instance is not None:
            base_label = f"{base_label} ({variable.instance.name})"

        metadata_item = _lookup_variable_metadata_item(dataset, variable)
        column_type = _column_python_type(dataset, variable, metadata_item)
        column_extra = _build_variable_column_extra(variable, metadata_item)

        # Determine disaggregation mode from extra_params
        extra_params = variable.get_extra_params()
        disagg_mode: str = extra_params.get("disaggregation") or "total"
        selected_coc_uids: list[str] = extra_params.get("selected_coc_uids") or []

        def _make_variable_column(
            col_label: str,
            coc_uid: str | None,
            var_id: str,
        ) -> dict[str, Any]:
            col_name = _dedupe_identifier(col_label, used_identifiers)
            col: dict[str, Any] = {
                "column_name": col_name,
                "verbose_name": col_label,
                "type": column_type,
                "sql_type": "REAL" if column_type == "FLOAT" else "TEXT",
                "is_dttm": False,
                "is_dimension": False,
                "variable_id": var_id,
                "coc_uid": coc_uid,
            }
            if column_extra:
                col["extra"] = column_extra
            return col

        if disagg_mode == "all":
            # One column per distinct COC in staging + a Total column
            coc_list = _load_distinct_cocs_for_variable(dataset, variable.variable_id)
            for coc in coc_list:
                col_label = f"{base_label} ({coc['co_name']})" if coc["co_name"] else base_label
                col = _make_variable_column(col_label, coc["co_uid"], variable.variable_id)
                variable_columns.append(col)
                columns.append(col)
                variable_lookup[(str(variable.variable_id), coc["co_uid"])] = col
            # Always add a Total column (aggregated; no COC filter)
            total_label = f"{base_label} (Total)"
            total_col = _make_variable_column(total_label, None, variable.variable_id)
            variable_columns.append(total_col)
            columns.append(total_col)
            variable_lookup[(str(variable.variable_id), None)] = total_col

        elif disagg_mode == "selected" and selected_coc_uids:
            # One column per selected COC UID; look up names from staging
            coc_list = _load_distinct_cocs_for_variable(dataset, variable.variable_id)
            coc_name_map = {c["co_uid"]: c["co_name"] for c in coc_list}
            for coc_uid in selected_coc_uids:
                co_name = coc_name_map.get(coc_uid, coc_uid)
                col_label = f"{base_label} ({co_name})" if co_name else base_label
                col = _make_variable_column(col_label, coc_uid, variable.variable_id)
                variable_columns.append(col)
                columns.append(col)
                variable_lookup[(str(variable.variable_id), coc_uid)] = col

        else:
            # "total" (default) — one column, no COC filter
            col = _make_variable_column(base_label, None, variable.variable_id)
            variable_columns.append(col)
            columns.append(col)
            variable_lookup[(str(variable.variable_id), None)] = col

    return {
        "columns": columns,
        "dimension_column_names": dimension_column_names,
        "variable_columns": variable_columns,
        "variable_lookup": variable_lookup,
        "hierarchy_lookup": org_unit_context.hierarchy_lookup,
        "include_instance_name": include_instance_name,
        "fallback_org_unit_column": org_unit_context.fallback_org_unit_column,
        "period_column_name": period_context.primary_period_column,
        "period_column_names_by_key": period_context.column_names_by_key,
        "ou_level_column_name": ou_level_column_name,
        "coc_uid_column_name": coc_uid_column_name,
        "coc_name_column_name": coc_name_column_name,
        "org_unit_hierarchy_diagnostics": org_unit_context.diagnostics,
        "period_hierarchy_diagnostics": period_context.diagnostics,
    }


def materialize_serving_rows(
    dataset: DHIS2StagedDataset,
    raw_rows: Iterable[dict[str, Any]],
    manifest: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    manifest = manifest or build_serving_manifest(dataset)
    columns = list(manifest["columns"])
    variable_lookup = dict(manifest["variable_lookup"])
    dimension_column_names = list(manifest["dimension_column_names"])
    hierarchy_lookup = dict(manifest["hierarchy_lookup"])
    include_instance_name = bool(manifest["include_instance_name"])
    fallback_org_unit_column = manifest.get("fallback_org_unit_column")
    period_column_name = str(manifest["period_column_name"])
    period_column_names_by_key = dict(manifest.get("period_column_names_by_key") or {})
    period_service = PeriodHierarchyService()

    grouped_rows: dict[tuple[Any, ...], dict[str, Any]] = {}
    for raw_row in raw_rows:
        row_values: dict[str, Any] = {}

        if include_instance_name:
            instance_column_name = dimension_column_names[0]
            row_values[instance_column_name] = raw_row.get("source_instance_name")

        hierarchy_values = hierarchy_lookup.get(
            (
                int(raw_row.get("source_instance_id") or 0),
                str(raw_row.get("ou") or "").strip(),
            ),
            {},
        )
        for column_name, value in hierarchy_values.items():
            row_values[column_name] = value

        if fallback_org_unit_column:
            row_values[fallback_org_unit_column] = raw_row.get("ou_name") or raw_row.get("ou")

        normalized_period = period_service.normalize_period(raw_row.get("pe"))
        for period_key, column_name in period_column_names_by_key.items():
            row_values[column_name] = normalized_period.get(period_key)
        if period_column_name not in row_values:
            row_values[period_column_name] = raw_row.get("pe")

        ou_level_column_name = str(manifest.get("ou_level_column_name") or "ou_level")
        try:
            ou_level_val = int(raw_row.get("ou_level") or 0)
        except (TypeError, ValueError):
            ou_level_val = 0
        row_values[ou_level_column_name] = ou_level_val or None

        # Category Option Combo dimension values (only present when enabled)
        coc_uid_col = manifest.get("coc_uid_column_name")
        coc_name_col = manifest.get("coc_name_column_name")
        if coc_uid_col:
            row_values[coc_uid_col] = raw_row.get("co_uid") or None
        if coc_name_col:
            row_values[coc_name_col] = raw_row.get("co_name") or None

        key = tuple(row_values.get(column_name) for column_name in dimension_column_names)
        current = grouped_rows.setdefault(
            key,
            {
                column["column_name"]: None
                for column in columns
            },
        )
        current.update(row_values)

        dx_uid_key = str(raw_row.get("dx_uid") or "")
        co_uid_key = raw_row.get("co_uid") or None
        # Try exact (dx_uid, co_uid) first; fall back to (dx_uid, None) for total/aggregated rows
        variable_spec = variable_lookup.get((dx_uid_key, co_uid_key)) or variable_lookup.get(
            (dx_uid_key, None)
        )
        if not variable_spec:
            continue

        if variable_spec["type"] == "FLOAT":
            value = raw_row.get("value_numeric")
            if value is None and raw_row.get("value") not in (None, ""):
                try:
                    value = float(raw_row.get("value"))
                except (TypeError, ValueError):
                    value = None
        else:
            value = raw_row.get("value")

        if value is not None:
            current[variable_spec["column_name"]] = value

    rows = list(grouped_rows.values())
    return columns, rows


def prune_empty_hierarchy_columns(
    columns: list[dict[str, Any]],
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Remove OU hierarchy columns that are completely blank in the materialized rows.

    When data only covers a subset of OU levels (e.g. National → District),
    deeper hierarchy levels (Health Facility, Ward, etc.) will be NULL in
    every row.  Including them bloats GROUP BY clauses, slows queries, and
    confuses users — the map sees extra groupby columns that never contain
    data for any boundary polygon match.

    Returns:
        Tuple of (pruned_columns, pruned_rows).
    """
    # Collect OU hierarchy column names from the manifest
    ou_hierarchy_cols: set[str] = set()
    for col in columns:
        extra = col.get("extra")
        if isinstance(extra, str):
            try:
                extra = json.loads(extra)
            except Exception:  # pylint: disable=broad-except
                extra = {}
        if isinstance(extra, dict) and extra.get(_DHIS2_OU_HIERARCHY_EXTRA_KEY):
            ou_hierarchy_cols.add(col["column_name"])

    if not ou_hierarchy_cols or not rows:
        return columns, rows

    # Find which OU hierarchy columns have at least one non-empty value
    populated: set[str] = set()
    for row in rows:
        for col_name in ou_hierarchy_cols - populated:
            val = row.get(col_name)
            if val is not None and str(val).strip():
                populated.add(col_name)
        if populated == ou_hierarchy_cols:
            break  # All populated — nothing to prune

    empty_cols = ou_hierarchy_cols - populated
    if not empty_cols:
        return columns, rows

    logger.info(
        "prune_empty_hierarchy_columns: removing %d all-blank OU hierarchy column(s): %s",
        len(empty_cols),
        sorted(empty_cols),
    )

    pruned_columns = [c for c in columns if c["column_name"] not in empty_cols]
    pruned_rows = [{k: v for k, v in row.items() if k not in empty_cols} for row in rows]
    return pruned_columns, pruned_rows


def dataset_columns_payload(columns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "column_name": column["column_name"],
            "verbose_name": column["verbose_name"],
            "type": column["type"],
            "is_dttm": bool(column.get("is_dttm")),
            "filterable": True,
            "groupby": True,
            "is_active": True,
            **(
                {
                    "extra": json.dumps(column["extra"])
                    if not isinstance(column["extra"], str)
                    else column["extra"]
                }
                if column.get("extra")
                else {}
            ),
        }
        for column in columns
    ]


def _load_column_extra(column: Any) -> dict[str, Any]:
    raw_extra: Any = None
    if isinstance(column, Mapping):
        raw_extra = column.get("extra")
    else:
        raw_extra = getattr(column, "extra", None)

    if isinstance(raw_extra, dict):
        return raw_extra
    if isinstance(raw_extra, str) and raw_extra.strip():
        try:
            loaded = json.loads(raw_extra)
            return loaded if isinstance(loaded, dict) else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}
    return {}


def get_dhis2_hierarchy_column_names(columns: Sequence[Any]) -> list[str]:
    hierarchy_columns: list[tuple[int, str]] = []
    for column in columns:
        if isinstance(column, Mapping):
            column_name = str(column.get("column_name") or "").strip()
            fallback_level = column.get("level")
        else:
            column_name = str(getattr(column, "column_name", "") or "").strip()
            fallback_level = None
        if not column_name:
            continue

        extra = _load_column_extra(column)
        if extra.get(_DHIS2_OU_HIERARCHY_EXTRA_KEY) is not True:
            continue

        level = extra.get(_DHIS2_OU_LEVEL_EXTRA_KEY, fallback_level)
        try:
            hierarchy_columns.append((int(level), column_name))
        except (TypeError, ValueError):
            continue

    return [column_name for _, column_name in sorted(hierarchy_columns)]


def get_dhis2_period_column_name(columns: Sequence[Any]) -> str | None:
    fallback_column_name: str | None = None
    for column in columns:
        if isinstance(column, Mapping):
            column_name = str(column.get("column_name") or "").strip()
        else:
            column_name = str(getattr(column, "column_name", "") or "").strip()
        if not column_name:
            continue

        if fallback_column_name is None and column_name == "period":
            fallback_column_name = column_name

        extra = _load_column_extra(column)
        if extra.get(_DHIS2_PERIOD_EXTRA_KEY) is True:
            return column_name
    return fallback_column_name


def resolve_terminal_hierarchy_column(
    selected_columns: Sequence[str],
    hierarchy_column_names: Sequence[str],
    preferred_selected_column: str | None = None,
) -> str | None:
    normalized_preferred = str(preferred_selected_column or "").strip()
    if normalized_preferred and normalized_preferred in hierarchy_column_names:
        return normalized_preferred

    hierarchy_positions = {
        column_name: index for index, column_name in enumerate(hierarchy_column_names)
    }
    deepest_selected: tuple[int, str] | None = None
    for column_name in selected_columns:
        normalized = str(column_name or "").strip()
        if normalized not in hierarchy_positions:
            continue
        position = hierarchy_positions[normalized]
        if deepest_selected is None or position > deepest_selected[0]:
            deepest_selected = (position, normalized)
    return deepest_selected[1] if deepest_selected is not None else None


def has_populated_ou_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def is_terminal_at_selected_level(
    row: Mapping[str, Any],
    hierarchy_column_names: Sequence[str],
    selected_column_name: str,
) -> bool:
    normalized_selected = str(selected_column_name or "").strip()
    if normalized_selected not in hierarchy_column_names:
        return False

    selected_index = list(hierarchy_column_names).index(normalized_selected)
    if not has_populated_ou_value(row.get(normalized_selected)):
        return False

    return all(
        not has_populated_ou_value(row.get(column_name))
        for column_name in hierarchy_column_names[selected_index + 1 :]
    )


def _has_populated_sql_value(column_name: str) -> ColumnElement:
    # OU hierarchy serving columns are string dimensions already. Casting a
    # nullable ClickHouse column to a non-nullable String before coalescing
    # raises Code 349 (`Cannot convert NULL value to non-Nullable type`).
    # Coalesce first and avoid the cast entirely so terminal-level predicates
    # work for sparse/deeper hierarchy columns like `ward_department`.
    normalized_value = sa.func.trim(sa.func.coalesce(sa.column(column_name), ""))
    return sa.func.length(normalized_value) > 0


def build_terminal_hierarchy_sqla_predicate(
    selected_column_name: str,
    hierarchy_column_names: Sequence[str],
) -> ColumnElement | None:
    normalized_selected = str(selected_column_name or "").strip()
    if normalized_selected not in hierarchy_column_names:
        return None

    selected_index = list(hierarchy_column_names).index(normalized_selected)
    # The selected OU level must be populated and every deeper OU level must
    # stay empty, so charts/maps only use rows where the chosen level is terminal.
    conditions: list[ColumnElement] = [
        _has_populated_sql_value(normalized_selected)
    ]
    for column_name in hierarchy_column_names[selected_index + 1 :]:
        conditions.append(sa.not_(_has_populated_sql_value(column_name)))
    return sa.and_(*conditions)
