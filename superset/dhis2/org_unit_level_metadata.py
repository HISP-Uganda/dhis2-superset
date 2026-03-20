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
"""Helpers for org-unit-level metadata payloads."""

from __future__ import annotations

from typing import Any


def _coerce_int(value: Any) -> int | None:
    try:
        coerced = int(value)
    except (TypeError, ValueError):
        return None
    return coerced if coerced > 0 else None


def _coerce_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def merge_org_unit_level_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge org-unit levels while preserving per-instance names."""

    merged: dict[int, dict[str, Any]] = {}

    for item in items:
        level = _coerce_int(item.get("level"))
        if level is None:
            continue

        display_name = _coerce_str(item.get("displayName")) or _coerce_str(
            item.get("name")
        )
        instance_id = _coerce_int(item.get("source_instance_id"))
        instance_name = _coerce_str(item.get("source_instance_name"))
        source_instance_ids = item.get("source_instance_ids")
        source_instance_names = item.get("source_instance_names")
        instance_level_names = item.get("instance_level_names")

        current = merged.get(level)
        if current is None:
            current = {
                "level": level,
                "displayName": display_name or f"Level {level}",
                "name": _coerce_str(item.get("name")),
                "source_instance_ids": [],
                "source_instance_names": [],
                "instance_level_names": {},
            }
            merged[level] = current

        if not current.get("displayName") and display_name:
            current["displayName"] = display_name
        if not current.get("name"):
            current_name = _coerce_str(item.get("name"))
            if current_name:
                current["name"] = current_name

        if isinstance(source_instance_ids, list):
            for candidate in source_instance_ids:
                coerced_id = _coerce_int(candidate)
                if (
                    coerced_id is not None
                    and coerced_id not in current["source_instance_ids"]
                ):
                    current["source_instance_ids"].append(coerced_id)
        if instance_id is not None and instance_id not in current["source_instance_ids"]:
            current["source_instance_ids"].append(instance_id)

        if isinstance(source_instance_names, list):
            for candidate in source_instance_names:
                coerced_name = _coerce_str(candidate)
                if (
                    coerced_name is not None
                    and coerced_name not in current["source_instance_names"]
                ):
                    current["source_instance_names"].append(coerced_name)
        if (
            instance_name is not None
            and instance_name not in current["source_instance_names"]
        ):
            current["source_instance_names"].append(instance_name)

        if isinstance(instance_level_names, dict):
            for raw_key, raw_name in instance_level_names.items():
                coerced_id = _coerce_int(raw_key)
                coerced_name = _coerce_str(raw_name)
                if coerced_id is None or coerced_name is None:
                    continue
                current["instance_level_names"][str(coerced_id)] = coerced_name

        if instance_id is not None and display_name:
            current["instance_level_names"][str(instance_id)] = display_name

    result: list[dict[str, Any]] = []
    for level in sorted(merged):
        entry = merged[level]
        source_ids = entry.get("source_instance_ids") or []
        source_names = entry.get("source_instance_names") or []
        payload = {
            "level": level,
            "displayName": entry.get("displayName") or f"Level {level}",
            "name": entry.get("name"),
            "source_instance_ids": source_ids,
            "source_instance_names": source_names,
            "instance_level_names": entry.get("instance_level_names") or {},
        }
        if len(source_ids) == 1:
            payload["source_instance_id"] = source_ids[0]
        if len(source_names) == 1:
            payload["source_instance_name"] = source_names[0]
        result.append(payload)

    return result
