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
_ORG_UNIT_GROUPS_NAMESPACE = "dhis2_snapshot:organisationUnitGroups"
_ORG_UNIT_GROUPSETS_NAMESPACE = "dhis2_snapshot:organisationUnitGroupSets"
_DHIS2_OU_HIERARCHY_EXTRA_KEY = "dhis2_is_ou_hierarchy"
_DHIS2_OU_LEVEL_EXTRA_KEY = "dhis2_ou_level"
_DHIS2_OU_GROUP_EXTRA_KEY = "dhis2_is_ou_group"
_DHIS2_OU_GROUP_ID_EXTRA_KEY = "dhis2_ou_group_id"
_DHIS2_OU_GROUPSET_EXTRA_KEY = "dhis2_is_ou_group_set"
_DHIS2_OU_GROUPSET_ID_EXTRA_KEY = "dhis2_ou_group_set_id"


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
    attribute_columns: list[dict[str, Any]]
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

    @staticmethod
    def _normalize_optional_int(value: Any) -> int | None:
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
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

    def _detail_structure_id(self, detail: dict[str, Any]) -> str | None:
        has_lineage = isinstance(self._config_value(detail, "lineage"), list)
        if has_lineage:
            candidate = self._config_value(
                detail,
                "selection_key",
                "selectionKey",
                "repository_key",
                "id",
            )
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return self._detail_source_id(detail) or self._detail_selection_key(detail)

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
        ancestor_structure_id = self._detail_structure_id(ancestor_detail)
        descendant_structure_id = self._detail_structure_id(descendant_detail)
        if not ancestor_structure_id or not descendant_structure_id:
            return False
        if ancestor_structure_id == descendant_structure_id:
            return False
        if not self._details_share_instance_scope(ancestor_detail, descendant_detail):
            return False

        path_parts = self._detail_path_parts(descendant_detail)
        if path_parts:
            return ancestor_structure_id in path_parts[:-1]

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
    def get_level_mapping(
        dataset_config: dict[str, Any],
        repository_config: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]] | None:
        level_mapping = dataset_config.get("level_mapping")
        if not isinstance(level_mapping, dict) and isinstance(repository_config, dict):
            level_mapping = repository_config.get("level_mapping")
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

    def _default_enabled_attribute_dimension_items(
        self,
        field_name: str,
        instance_ids: list[int] | None = None,
    ) -> list[dict[str, Any]]:
        if field_name not in {"groups", "group_sets"}:
            return []

        normalized_instance_ids = [
            instance_id
            for instance_id in list(instance_ids or [])
            if isinstance(instance_id, int)
        ]
        if not normalized_instance_ids:
            return []

        items_by_key: dict[str, dict[str, Any]] = {}
        for instance_id in normalized_instance_ids:
            namespace = (
                _ORG_UNIT_GROUPS_NAMESPACE
                if field_name == "groups"
                else _ORG_UNIT_GROUPSETS_NAMESPACE
            )
            snapshot = self._load_snapshot(namespace, instance_id)
            if snapshot is None or snapshot.get("status") != "success":
                continue

            for raw_item in list(snapshot.get("result") or []):
                if not isinstance(raw_item, dict):
                    continue
                item_key = str(raw_item.get("id") or "").strip()
                if not item_key:
                    continue
                label = str(
                    raw_item.get("displayName")
                    or raw_item.get("name")
                    or item_key
                ).strip() or item_key
                item = items_by_key.setdefault(
                    item_key,
                    {
                        "key": item_key,
                        "label": label,
                        "source_refs": [],
                    },
                )
                source_ref: dict[str, Any] = {
                    "instance_id": instance_id,
                    "source_id": item_key,
                    "source_label": label,
                }
                if field_name == "group_sets":
                    source_ref["source_group_ids"] = [
                        str(group.get("id") or "").strip()
                        for group in list(raw_item.get("organisationUnitGroups") or [])
                        if isinstance(group, dict)
                        and str(group.get("id") or "").strip()
                    ]
                    source_ref["source_group_labels"] = [
                        str(
                            group.get("displayName")
                            or group.get("name")
                            or group.get("id")
                            or ""
                        ).strip()
                        for group in list(raw_item.get("organisationUnitGroups") or [])
                        if isinstance(group, dict)
                        and str(
                            group.get("displayName")
                            or group.get("name")
                            or group.get("id")
                            or ""
                        ).strip()
                    ]
                    item["member_group_keys"] = sorted(
                        {
                            *list(item.get("member_group_keys") or []),
                            *list(source_ref["source_group_ids"] or []),
                        }
                    )
                    item["member_group_labels"] = sorted(
                        {
                            *list(item.get("member_group_labels") or []),
                            *list(source_ref["source_group_labels"] or []),
                        }
                    )
                item["source_refs"] = [
                    *list(item.get("source_refs") or []),
                    source_ref,
                ]

        return list(items_by_key.values())

    def _enabled_dimension_items(
        self,
        repository_config: dict[str, Any] | None,
        field_name: str,
        instance_ids: list[int] | None = None,
        dataset_config: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        dataset_dimension_keys: set[str] | None = None
        if isinstance(dataset_config, dict):
            dataset_dimensions = dataset_config.get("repository_enabled_dimensions")
            if isinstance(dataset_dimensions, dict):
                raw_keys = dataset_dimensions.get(field_name)
                if raw_keys is not None:
                    dataset_dimension_keys = {
                        str(item).strip()
                        for item in (list(raw_keys) if isinstance(raw_keys, list) else [])
                        if str(item).strip()
                    }

        if not isinstance(repository_config, dict):
            items = self._default_enabled_attribute_dimension_items(
                field_name,
                instance_ids,
            )
        else:
            enabled_dimensions = repository_config.get("enabled_dimensions")
            if not isinstance(enabled_dimensions, dict):
                items = self._default_enabled_attribute_dimension_items(
                    field_name,
                    instance_ids,
                )
            else:
                items = enabled_dimensions.get(field_name)
                if items is None:
                    items = self._default_enabled_attribute_dimension_items(
                        field_name,
                        instance_ids,
                    )
                elif not isinstance(items, list):
                    items = []

        normalized_items = [item for item in items if isinstance(item, dict)]
        if dataset_dimension_keys is None:
            return normalized_items
        if not dataset_dimension_keys:
            return []
        return [
            item
            for item in normalized_items
            if str(item.get("key") or "").strip() in dataset_dimension_keys
        ]

    def _enabled_level_numbers(
        self,
        repository_config: dict[str, Any] | None,
        dataset_config: dict[str, Any] | None = None,
    ) -> set[int] | None:
        dataset_levels_configured = False
        dataset_level_keys: list[str] = []
        if isinstance(dataset_config, dict):
            dataset_dimensions = dataset_config.get("repository_enabled_dimensions")
            if isinstance(dataset_dimensions, dict) and "levels" in dataset_dimensions:
                dataset_levels_configured = True
                raw_level_keys = dataset_dimensions.get("levels")
                if isinstance(raw_level_keys, list):
                    dataset_level_keys = [
                        str(item).strip()
                        for item in raw_level_keys
                        if str(item).strip()
                    ]
        items = self._enabled_dimension_items(
            repository_config,
            "levels",
            dataset_config=dataset_config,
        )
        if not items:
            if not dataset_levels_configured:
                return None
            parsed_levels = {
                int(key.split(":", 1)[1])
                for key in dataset_level_keys
                if key.startswith("level:")
                and key.split(":", 1)[1].isdigit()
            }
            return parsed_levels if parsed_levels else set()
        enabled_levels = {
            int(item["repository_level"])
            for item in items
            if item.get("repository_level") is not None
        }
        return enabled_levels if enabled_levels else set()

    def _build_attribute_columns(
        self,
        repository_config: dict[str, Any] | None,
        instance_ids: list[int],
        used_identifiers: set[str],
        dataset_config: dict[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, str], dict[str, str]]:
        attribute_columns: list[dict[str, Any]] = []
        group_column_names: dict[str, str] = {}
        group_set_column_names: dict[str, str] = {}

        for item in self._enabled_dimension_items(
            repository_config,
            "groups",
            instance_ids,
            dataset_config=dataset_config,
        ):
            key = str(item.get("key") or "").strip()
            label = str(item.get("label") or key).strip()
            if not key or not label:
                continue
            column_name = dedupe_identifier(label, used_identifiers)
            group_column_names[key] = column_name
            attribute_columns.append(
                {
                    "column_name": column_name,
                    "verbose_name": label,
                    "type": "STRING",
                    "sql_type": "TEXT",
                    "is_dttm": False,
                    "is_dimension": True,
                    "extra": {
                        _DHIS2_OU_GROUP_EXTRA_KEY: True,
                        _DHIS2_OU_GROUP_ID_EXTRA_KEY: key,
                    },
                }
            )

        for item in self._enabled_dimension_items(
            repository_config,
            "group_sets",
            instance_ids,
            dataset_config=dataset_config,
        ):
            key = str(item.get("key") or "").strip()
            label = str(item.get("label") or key).strip()
            if not key or not label:
                continue
            column_name = dedupe_identifier(label, used_identifiers)
            group_set_column_names[key] = column_name
            attribute_columns.append(
                {
                    "column_name": column_name,
                    "verbose_name": label,
                    "type": "STRING",
                    "sql_type": "TEXT",
                    "is_dttm": False,
                    "is_dimension": True,
                    "extra": {
                        _DHIS2_OU_GROUPSET_EXTRA_KEY: True,
                        _DHIS2_OU_GROUPSET_ID_EXTRA_KEY: key,
                    },
                }
            )

        return attribute_columns, group_column_names, group_set_column_names

    @staticmethod
    def _normalized_source_refs(item: dict[str, Any]) -> list[dict[str, Any]]:
        source_refs = item.get("source_refs")
        if not isinstance(source_refs, list):
            return []
        return [source_ref for source_ref in source_refs if isinstance(source_ref, dict)]

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

    @staticmethod
    def _read_max_orgunit_level(dataset_config: dict[str, Any]) -> int | None:
        """Return the configured max org unit level, or ``None`` if not set."""
        raw = dataset_config.get("max_orgunit_level") or dataset_config.get(
            "org_unit_max_level"
        )
        if raw is None:
            return None
        try:
            val = int(raw)
            return val if val > 0 else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _read_allowed_org_unit_levels(
        dataset_config: dict[str, Any],
    ) -> frozenset[int] | None:
        """Return the configured allowed-levels allowlist, or ``None`` if not set."""
        raw = dataset_config.get("allowed_org_unit_levels")
        if not isinstance(raw, list) or not raw:
            return None
        try:
            levels = frozenset(int(x) for x in raw if x is not None)
            return levels if levels else None
        except (TypeError, ValueError):
            return None

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

        # Read level constraints from dataset_config.  These act as hard caps
        # that prevent irrelevant generated levels (e.g. 7, 8) from leaking
        # into the serving table when the hierarchy has more levels than the
        # dataset actually needs.
        configured_max_level = self._read_max_orgunit_level(dataset_config)
        allowed_org_unit_levels = self._read_allowed_org_unit_levels(dataset_config)

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

            # Apply the configured max level cap so we never exceed it even
            # if the raw DHIS2 hierarchy is deeper.
            effective_max_level = hierarchy_max_level
            if configured_max_level is not None:
                effective_max_level = min(hierarchy_max_level, configured_max_level)

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
                        effective_max_level,
                    )
                    for selected_level in selected_levels
                )
                if max_scoped_level >= min_selected_level:
                    resolved_levels.update(
                        range(min_selected_level, max_scoped_level + 1)
                    )
                continue

            # No level info from selected details — fall back to the full
            # effective range, but capped by effective_max_level.
            # This prevents levels 7/8 from leaking in when the hierarchy is
            # deeper than the dataset's actual data scope.
            if applicable_details and effective_max_level > 0:
                resolved_levels.update(range(1, effective_max_level + 1))

        # Apply the allowed_levels allowlist as a post-filter.  Any level not
        # in the allowlist is removed from the resolved set.
        result_levels = sorted(level for level in resolved_levels if level > 0)
        if allowed_org_unit_levels is not None:
            result_levels = [lvl for lvl in result_levels if lvl in allowed_org_unit_levels]

        return result_levels

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

    def _build_attribute_lookup(
        self,
        instance_ids: list[int],
        repository_config: dict[str, Any] | None,
        group_column_names: dict[str, str],
        group_set_column_names: dict[str, str],
        dataset_config: dict[str, Any] | None = None,
    ) -> dict[tuple[int, str], dict[str, Any]]:
        if not group_column_names and not group_set_column_names:
            return {}

        enabled_groups = self._enabled_dimension_items(
            repository_config,
            "groups",
            instance_ids,
            dataset_config=dataset_config,
        )
        enabled_group_sets = self._enabled_dimension_items(
            repository_config,
            "group_sets",
            instance_ids,
            dataset_config=dataset_config,
        )
        attribute_lookup: dict[tuple[int, str], dict[str, Any]] = defaultdict(dict)

        for instance_id in instance_ids:
            group_snapshot = self._load_snapshot(_ORG_UNIT_GROUPS_NAMESPACE, instance_id)
            group_set_snapshot = self._load_snapshot(
                _ORG_UNIT_GROUPSETS_NAMESPACE,
                instance_id,
            )

            group_membership: dict[str, set[str]] = defaultdict(set)
            for group in list((group_snapshot or {}).get("result") or []):
                if not isinstance(group, dict):
                    continue
                group_id = str(group.get("id") or "").strip()
                if not group_id:
                    continue
                for member in list(group.get("organisationUnits") or []):
                    member_id = (
                        str(member.get("id") or "").strip()
                        if isinstance(member, dict)
                        else ""
                    )
                    if member_id:
                        group_membership[group_id].add(member_id)

            group_set_membership: dict[str, dict[str, str]] = {}
            for group_set in list((group_set_snapshot or {}).get("result") or []):
                if not isinstance(group_set, dict):
                    continue
                group_set_id = str(group_set.get("id") or "").strip()
                if not group_set_id:
                    continue
                group_set_membership[group_set_id] = {}
                for group in list(group_set.get("organisationUnitGroups") or []):
                    if not isinstance(group, dict):
                        continue
                    group_id = str(group.get("id") or "").strip()
                    if not group_id:
                        continue
                    group_set_membership[group_set_id][group_id] = str(
                        group.get("displayName") or group.get("name") or group_id
                    ).strip()

            for item in enabled_groups:
                item_key = str(item.get("key") or "").strip()
                column_name = group_column_names.get(item_key)
                if not item_key or not column_name:
                    continue
                matched_group_ids = {
                    str(source_ref.get("source_id") or "").strip()
                    for source_ref in self._normalized_source_refs(item)
                    if self._normalize_optional_int(source_ref.get("instance_id"))
                    == instance_id
                }
                if not matched_group_ids:
                    matched_group_ids = {item_key}
                for group_id in matched_group_ids:
                    for org_unit_id in group_membership.get(group_id, set()):
                        attribute_lookup[(instance_id, org_unit_id)][column_name] = (
                            str(item.get("label") or item_key).strip() or item_key
                        )

            for item in enabled_group_sets:
                item_key = str(item.get("key") or "").strip()
                column_name = group_set_column_names.get(item_key)
                if not item_key or not column_name:
                    continue
                matched_group_set_ids = {
                    str(source_ref.get("source_id") or "").strip()
                    for source_ref in self._normalized_source_refs(item)
                    if self._normalize_optional_int(source_ref.get("instance_id"))
                    == instance_id
                }
                if not matched_group_set_ids:
                    matched_group_set_ids = {item_key}
                for group_set_id in matched_group_set_ids:
                    for group_id, group_label in group_set_membership.get(
                        group_set_id, {}
                    ).items():
                        for org_unit_id in group_membership.get(group_id, set()):
                            attribute_lookup[(instance_id, org_unit_id)][column_name] = (
                                group_label or item_key
                            )

        return dict(attribute_lookup)

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
        repository_config: dict[str, Any] | None = None,
    ) -> OrgUnitHierarchyContext:
        mapping_rows = self.get_level_mapping(dataset_config, repository_config)
        selected_root_details = self._selected_root_details(
            dataset_config,
            selected_instance_ids,
        )
        resolved_level_range = self._resolve_level_range(
            dataset_config,
            selected_instance_ids,
            mapping_rows,
        )
        enabled_level_numbers = self._enabled_level_numbers(
            repository_config,
            dataset_config,
        )
        level_range = (
            [
                level
                for level in resolved_level_range
                if enabled_level_numbers is None or level in enabled_level_numbers
            ]
            if resolved_level_range
            else []
        )

        hierarchy_columns: list[dict[str, Any]] = []
        attribute_columns: list[dict[str, Any]] = []
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
        elif not resolved_level_range:
            fallback_org_unit_column = dedupe_identifier("organisation_unit", used_identifiers)
            dimension_column_names.append(fallback_org_unit_column)

        hierarchy_lookup = self._build_hierarchy_lookup(
            selected_instance_ids,
            hierarchy_columns,
            mapping_rows,
        )
        (
            attribute_columns,
            group_column_names,
            group_set_column_names,
        ) = self._build_attribute_columns(
            repository_config,
            selected_instance_ids,
            used_identifiers,
            dataset_config,
        )
        attribute_lookup = self._build_attribute_lookup(
            selected_instance_ids,
            repository_config,
            group_column_names,
            group_set_column_names,
            dataset_config,
        )
        for column in attribute_columns:
            dimension_column_names.append(column["column_name"])
        for lookup_key, attribute_values in attribute_lookup.items():
            current_values = hierarchy_lookup.setdefault(lookup_key, {})
            current_values.update(attribute_values)
        diagnostics = {
            "selected_instance_ids": selected_instance_ids,
            "level_range": level_range,
            "selected_levels": level_range,
            "selected_root_details_count": len(selected_root_details),
            "mapping_enabled": mapping_rows is not None,
            "hierarchy_nodes_resolved": len(hierarchy_lookup),
            "enabled_group_dimensions": len(group_column_names),
            "enabled_group_set_dimensions": len(group_set_column_names),
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
            attribute_columns=attribute_columns,
            dimension_column_names=dimension_column_names,
            hierarchy_lookup=hierarchy_lookup,
            fallback_org_unit_column=fallback_org_unit_column,
            diagnostics=diagnostics,
            mapping_rows=mapping_rows,
            selected_root_details=selected_root_details,
        )
