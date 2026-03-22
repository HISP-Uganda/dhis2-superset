from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import logging
import re
from typing import Any

from superset.staging import metadata_cache_service

logger = logging.getLogger(__name__)

_ORG_UNIT_HIERARCHY_NAMESPACE = "dhis2_snapshot:orgUnitHierarchy"
_ORG_UNIT_LEVELS_NAMESPACE = "dhis2_snapshot:organisationUnitLevels"
_DHIS2_OU_HIERARCHY_EXTRA_KEY = "dhis2_is_ou_hierarchy"
_DHIS2_OU_LEVEL_EXTRA_KEY = "dhis2_ou_level"


def sanitize_serving_identifier(value: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip())
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        return "column"
    if sanitized[0].isdigit():
        sanitized = f"c_{sanitized}"
    return sanitized.lower()


def dedupe_identifier(value: str, used: set[str]) -> str:
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


@dataclass(frozen=True)
class OrgUnitHierarchyContext:
    hierarchy_columns: list[dict[str, Any]]
    dimension_column_names: list[str]
    hierarchy_lookup: dict[tuple[int, str], dict[str, Any]]
    fallback_org_unit_column: str | None
    diagnostics: dict[str, Any]
    mapping_rows: list[dict[str, Any]] | None
    selected_root_details: list[dict[str, Any]]


class OrgUnitHierarchyService:
    def __init__(self, database_id: int) -> None:
        self.database_id = database_id

    def resolve_hierarchy(
        self,
        dataset_config: dict[str, Any],
        selected_instance_ids: list[int],
        used_identifiers: set[str] | None = None,
    ) -> OrgUnitHierarchyContext:
        return self.augment_serving_schema(
            dataset_config,
            selected_instance_ids,
            used_identifiers or set(),
        )

    @staticmethod
    def _snapshot_key_parts(instance_id: int | None) -> dict[str, Any]:
        return {"instance_id": instance_id} if instance_id is not None else {}

    def _load_snapshot(
        self,
        namespace: str,
        instance_id: int | None,
    ) -> dict[str, Any] | None:
        try:
            return metadata_cache_service.get_cached_metadata_payload(
                self.database_id,
                namespace,
                self._snapshot_key_parts(instance_id),
            )
        except Exception:  # pylint: disable=broad-except
            return None

    @staticmethod
    def _config_value(item: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in item:
                return item[key]
        return None

    def _detail_level(self, detail: dict[str, Any]) -> int | None:
        candidate = self._config_value(detail, "level", "repositoryLevel")
        try:
            return int(candidate) if candidate is not None else None
        except (TypeError, ValueError):
            return None

    def _detail_instance_ids(self, detail: dict[str, Any]) -> list[int]:
        raw_ids = (
            self._config_value(detail, "source_instance_ids", "sourceInstanceIds")
            or []
        )
        if not isinstance(raw_ids, list):
            return []
        instance_ids: list[int] = []
        for item in raw_ids:
            try:
                instance_ids.append(int(item))
            except (TypeError, ValueError):
                continue
        return list(dict.fromkeys(instance_ids))

    def _detail_source_id(self, detail: dict[str, Any]) -> str | None:
        candidate = self._config_value(
            detail,
            "source_org_unit_id",
            "sourceOrgUnitId",
            "id",
        )
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        return None

    def _detail_selection_key(self, detail: dict[str, Any]) -> str | None:
        candidate = self._config_value(detail, "selection_key", "selectionKey", "id")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        return None

    def _detail_path(self, detail: dict[str, Any]) -> str:
        path = self._config_value(detail, "path")
        return str(path).strip() if path is not None else ""

    def _detail_path_parts(self, detail: dict[str, Any]) -> list[str]:
        return [part for part in self._detail_path(detail).split("/") if part]

    def _details_share_instance_scope(
        self,
        ancestor_detail: dict[str, Any],
        descendant_detail: dict[str, Any],
    ) -> bool:
        ancestor_ids = set(self._detail_instance_ids(ancestor_detail))
        descendant_ids = set(self._detail_instance_ids(descendant_detail))
        if not ancestor_ids or not descendant_ids:
            return True
        return bool(ancestor_ids & descendant_ids)

    def _detail_is_descendant_of(
        self,
        descendant_detail: dict[str, Any],
        ancestor_detail: dict[str, Any],
    ) -> bool:
        ancestor_source_id = self._detail_source_id(ancestor_detail)
        descendant_source_id = self._detail_source_id(descendant_detail)
        if not ancestor_source_id or not descendant_source_id:
            return False
        if ancestor_source_id == descendant_source_id:
            return False
        if not self._details_share_instance_scope(ancestor_detail, descendant_detail):
            return False

        path_parts = self._detail_path_parts(descendant_detail)
        if path_parts:
            return ancestor_source_id in path_parts[:-1]

        return False

    def infer_missing_structure(
        self,
        dataset_config: dict[str, Any],
        selected_instance_ids: list[int],
    ) -> list[dict[str, Any]]:
        org_unit_details = dataset_config.get("org_unit_details") or []
        if isinstance(org_unit_details, list) and org_unit_details:
            return [detail for detail in org_unit_details if isinstance(detail, dict)]

        inferred: list[dict[str, Any]] = []
        raw_selected_keys = dataset_config.get("org_units") or []
        for index, raw_key in enumerate(raw_selected_keys):
            normalized_key = str(raw_key or "").strip()
            if not normalized_key:
                continue
            inferred.append(
                {
                    "id": normalized_key,
                    "selectionKey": normalized_key,
                    "sourceOrgUnitId": normalized_key,
                    "level": None,
                    "path": "",
                    "sourceInstanceIds": list(selected_instance_ids),
                    "inferred": True,
                    "selection_order": index,
                }
            )
        return inferred

    def _selected_root_details(
        self,
        dataset_config: dict[str, Any],
        selected_instance_ids: list[int],
    ) -> list[dict[str, Any]]:
        ordered_details = self._selected_details(dataset_config, selected_instance_ids)

        roots: list[dict[str, Any]] = []
        for detail in ordered_details:
            if any(self._detail_is_descendant_of(detail, root) for root in roots):
                continue
            roots.append(detail)
        return roots

    def _selected_details(
        self,
        dataset_config: dict[str, Any],
        selected_instance_ids: list[int],
    ) -> list[dict[str, Any]]:
        org_unit_details = self.infer_missing_structure(
            dataset_config,
            selected_instance_ids,
        )

        detail_map: dict[str, dict[str, Any]] = {}
        for detail in org_unit_details:
            selection_key = self._detail_selection_key(detail)
            if selection_key:
                detail_map[selection_key] = detail

        raw_selected_keys = dataset_config.get("org_units") or []
        selected_keys = [str(item).strip() for item in raw_selected_keys if str(item).strip()]
        if not selected_keys:
            selected_keys = list(detail_map.keys())

        selected_details = [detail_map[key] for key in selected_keys if key in detail_map]
        if not selected_details:
            selected_details = list(detail_map.values())

        ordered_details = sorted(
            selected_details,
            key=lambda detail: (
                self._detail_level(detail) or 0,
                len(self._detail_path_parts(detail)),
                self._detail_selection_key(detail) or "",
            ),
        )
        return ordered_details

    @staticmethod
    def _scope_max_level(scope: str, selected_level: int, hierarchy_max_level: int) -> int:
        normalized_scope = str(scope or "selected").strip().lower()
        if normalized_scope == "children":
            return min(selected_level + 1, hierarchy_max_level)
        if normalized_scope == "grandchildren":
            return min(selected_level + 2, hierarchy_max_level)
        if normalized_scope == "all_levels":
            return hierarchy_max_level
        return min(selected_level, hierarchy_max_level)

    @classmethod
    def _scope_levels(
        cls,
        scope: str,
        selected_level: int,
        hierarchy_max_level: int,
    ) -> list[int]:
        start_level = max(1, int(selected_level or 0))
        if start_level <= 0 or hierarchy_max_level <= 0:
            return []

        max_level = cls._scope_max_level(scope, start_level, hierarchy_max_level)
        if max_level < start_level:
            return []
        return list(range(start_level, max_level + 1))

    @staticmethod
    def get_level_mapping(dataset_config: dict[str, Any]) -> list[dict[str, Any]] | None:
        level_mapping = dataset_config.get("level_mapping")
        if not isinstance(level_mapping, dict) or not level_mapping.get("enabled"):
            return None

        rows = list(level_mapping.get("rows") or [])
        valid_rows: list[dict[str, Any]] = []
        for row in rows:
            try:
                merged_level = int(row.get("merged_level"))
            except (TypeError, ValueError):
                continue
            if merged_level > 0:
                valid_rows.append({**row, "merged_level": merged_level})
        return valid_rows

    def _resolve_level_labels(
        self,
        instance_ids: list[int],
        max_level: int,
        mapping_rows: list[dict[str, Any]] | None = None,
    ) -> dict[int, str]:
        if mapping_rows is not None:
            return {
                row["merged_level"]: str(
                    row.get("label") or f"Level {row['merged_level']}"
                ).strip()
                or f"Level {row['merged_level']}"
                for row in mapping_rows
            }

        labels_by_level: dict[int, Counter[str]] = defaultdict(Counter)
        for instance_id in instance_ids:
            snapshot = self._load_snapshot(_ORG_UNIT_LEVELS_NAMESPACE, instance_id)
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
        self,
        dataset_config: dict[str, Any],
        selected_instance_ids: list[int],
        mapping_rows: list[dict[str, Any]] | None,
    ) -> list[int]:
        if mapping_rows is not None:
            return sorted({row["merged_level"] for row in mapping_rows})

        normalized_scope = str(
            dataset_config.get("org_unit_scope") or "selected"
        ).strip().lower()
        resolved_levels: set[int] = set()
        selected_details = self._selected_details(
            dataset_config,
            selected_instance_ids,
        )

        for instance_id in selected_instance_ids:
            snapshot = self._load_snapshot(_ORG_UNIT_HIERARCHY_NAMESPACE, instance_id)
            if snapshot is None or snapshot.get("status") != "success":
                continue
            nodes = list(snapshot.get("result") or [])
            hierarchy_max_level = 0
            for node in nodes:
                try:
                    hierarchy_max_level = max(hierarchy_max_level, int(node.get("level") or 0))
                except (TypeError, ValueError):
                    continue

            applicable_details = [
                detail
                for detail in selected_details
                if isinstance(detail, dict)
                and (
                    not self._detail_instance_ids(detail)
                    or instance_id in self._detail_instance_ids(detail)
                )
            ]
            selected_levels = [
                level
                for detail in applicable_details
                for level in [self._detail_level(detail)]
                if level is not None
            ]

            if selected_levels:
                min_selected_level = min(selected_levels)
                max_scoped_level = max(
                    self._scope_max_level(
                        normalized_scope,
                        selected_level,
                        hierarchy_max_level,
                    )
                    for selected_level in selected_levels
                )
                if max_scoped_level >= min_selected_level:
                    resolved_levels.update(
                        range(min_selected_level, max_scoped_level + 1)
                    )
                continue

            if applicable_details and hierarchy_max_level > 0:
                resolved_levels.update(range(1, hierarchy_max_level + 1))

        return sorted(level for level in resolved_levels if level > 0)

    def _build_instance_level_map(
        self,
        instance_id: int,
        hierarchy_columns: list[dict[str, Any]],
        mapping_rows: list[dict[str, Any]] | None,
    ) -> dict[int, str]:
        if mapping_rows is None:
            return {int(col["level"]): col["column_name"] for col in hierarchy_columns}

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
        self,
        instance_ids: list[int],
        hierarchy_columns: list[dict[str, Any]],
        mapping_rows: list[dict[str, Any]] | None,
    ) -> dict[tuple[int, str], dict[str, Any]]:
        if not hierarchy_columns:
            return {}

        hierarchy_lookup: dict[tuple[int, str], dict[str, Any]] = {}
        for instance_id in instance_ids:
            relevant_levels = self._build_instance_level_map(
                instance_id,
                hierarchy_columns,
                mapping_rows,
            )
            snapshot = self._load_snapshot(_ORG_UNIT_HIERARCHY_NAMESPACE, instance_id)
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

    def get_ancestor_chain(
        self,
        instance_id: int,
        org_unit_id: str,
    ) -> list[dict[str, Any]]:
        snapshot = self._load_snapshot(_ORG_UNIT_HIERARCHY_NAMESPACE, instance_id)
        if snapshot is None or snapshot.get("status") != "success":
            return []

        nodes = {
            str(node.get("id") or "").strip(): node
            for node in list(snapshot.get("result") or [])
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        current = nodes.get(str(org_unit_id or "").strip())
        if current is None:
            return []

        path = str(current.get("path") or "").strip()
        path_parts = [part for part in path.split("/") if part]
        return [nodes[path_part] for path_part in path_parts if path_part in nodes]

    def get_level_columns(
        self,
        context: OrgUnitHierarchyContext,
    ) -> list[dict[str, Any]]:
        return list(context.hierarchy_columns)

    def build_level_specific_query_context(
        self,
        dataset_config: dict[str, Any],
        selected_root_details: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "scope": str(dataset_config.get("org_unit_scope") or "selected").strip().lower(),
            "selected_org_units": list(dataset_config.get("org_units") or []),
            "selected_root_details": selected_root_details,
            "include_descendants": bool(dataset_config.get("include_descendants")),
        }

    def augment_serving_schema(
        self,
        dataset_config: dict[str, Any],
        selected_instance_ids: list[int],
        used_identifiers: set[str],
    ) -> OrgUnitHierarchyContext:
        mapping_rows = self.get_level_mapping(dataset_config)
        selected_root_details = self._selected_root_details(
            dataset_config,
            selected_instance_ids,
        )
        level_range = self._resolve_level_range(
            dataset_config,
            selected_instance_ids,
            mapping_rows,
        )

        hierarchy_columns: list[dict[str, Any]] = []
        dimension_column_names: list[str] = []
        fallback_org_unit_column: str | None = None

        if level_range:
            level_labels = self._resolve_level_labels(
                selected_instance_ids,
                max(level_range),
                mapping_rows,
            )
            for level_number in level_range:
                label = level_labels.get(level_number, f"Level {level_number}")
                column_name = dedupe_identifier(label, used_identifiers)
                hierarchy_columns.append(
                    {
                        "column_name": column_name,
                        "verbose_name": label,
                        "type": "STRING",
                        "sql_type": "TEXT",
                        "is_dttm": False,
                        "is_dimension": True,
                        "level": level_number,
                        "extra": {
                            _DHIS2_OU_HIERARCHY_EXTRA_KEY: True,
                            _DHIS2_OU_LEVEL_EXTRA_KEY: level_number,
                        },
                    }
                )
                dimension_column_names.append(column_name)
        else:
            fallback_org_unit_column = dedupe_identifier("organisation_unit", used_identifiers)
            dimension_column_names.append(fallback_org_unit_column)

        hierarchy_lookup = self._build_hierarchy_lookup(
            selected_instance_ids,
            hierarchy_columns,
            mapping_rows,
        )
        diagnostics = {
            "selected_instance_ids": selected_instance_ids,
            "level_range": level_range,
            "selected_levels": level_range,
            "selected_root_details_count": len(selected_root_details),
            "mapping_enabled": mapping_rows is not None,
            "hierarchy_nodes_resolved": len(hierarchy_lookup),
            "query_context": self.build_level_specific_query_context(
                dataset_config,
                selected_root_details,
            ),
        }
        logger.info(
            "Org unit hierarchy resolved: instances=%s levels=%s nodes=%s",
            selected_instance_ids,
            level_range,
            len(hierarchy_lookup),
        )
        return OrgUnitHierarchyContext(
            hierarchy_columns=hierarchy_columns,
            dimension_column_names=dimension_column_names,
            hierarchy_lookup=hierarchy_lookup,
            fallback_org_unit_column=fallback_org_unit_column,
            diagnostics=diagnostics,
            mapping_rows=mapping_rows,
            selected_root_details=selected_root_details,
        )
