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
"""Tests for org unit hierarchy level filtering.

Covers the bug where levels 7 and 8 leaked into sync planning and serving
table builds when the DHIS2 hierarchy was deeper than the dataset scope.

Also covers:
- _expand_org_units_for_scope level constraint enforcement
- _resolve_level_range max_level and allowed_levels constraints
- bad-slice tracking in _fetch_analytics_batch
- dataset config merging from model columns
"""

from __future__ import annotations

import sys
import types
import tests.dhis2._bootstrap  # noqa: F401 - must be first

from types import SimpleNamespace
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_instance(instance_id: int = 1, database_id: int = 10) -> SimpleNamespace:
    return SimpleNamespace(
        id=instance_id,
        name=f"instance_{instance_id}",
        database_id=database_id,
        _sa_instance_state=None,
    )


def _make_hierarchy_node(
    node_id: str,
    level: int,
    ancestor_ids: list[str],
) -> dict:
    return {
        "id": node_id,
        "level": level,
        "ancestorIds": ancestor_ids,
        "displayName": f"Node {node_id}",
    }


# Build a 5-level hierarchy:
# L1: national (level=1)
#   L2: region_a (level=2, parent=national)
#     L3: district_a1 (level=3, parents=[national, region_a])
#       L4: facility_a1a (level=4, parents=[national, region_a, district_a1])
#         L5: subunit_a1a1 (level=5, parents=[...])
#           L6: deep_a1a1a (level=6, parents=[...])
#             L7: deeper_a1a1a1 (level=7, parents=[...])
#               L8: deepest_a1a1a1a (level=8, parents=[...])

_HIERARCHY_8_LEVELS = [
    _make_hierarchy_node("national", 1, []),
    _make_hierarchy_node("region_a", 2, ["national"]),
    _make_hierarchy_node("district_a1", 3, ["national", "region_a"]),
    _make_hierarchy_node("facility_a1a", 4, ["national", "region_a", "district_a1"]),
    _make_hierarchy_node("subunit_a1a1", 5, ["national", "region_a", "district_a1", "facility_a1a"]),
    _make_hierarchy_node("deep_a1a1a", 6, ["national", "region_a", "district_a1", "facility_a1a", "subunit_a1a1"]),
    _make_hierarchy_node("deeper_a1a1a1", 7, ["national", "region_a", "district_a1", "facility_a1a", "subunit_a1a1", "deep_a1a1a"]),
    _make_hierarchy_node("deepest_a1a1a1a", 8, ["national", "region_a", "district_a1", "facility_a1a", "subunit_a1a1", "deep_a1a1a", "deeper_a1a1a1"]),
]


# ---------------------------------------------------------------------------
# Tests: _expand_org_units_for_scope
# ---------------------------------------------------------------------------


def test_expand_scope_all_levels_no_constraints():
    """Without constraints, all_levels expands to all 8 levels."""
    from superset.dhis2.sync_service import _expand_org_units_for_scope

    instance = _make_instance()
    with patch(
        "superset.dhis2.sync_service._load_org_unit_hierarchy",
        return_value=_HIERARCHY_8_LEVELS,
    ):
        result = _expand_org_units_for_scope(
            instance=instance,
            allowed_units=["national"],
            scope="all_levels",
        )

    assert "national" in result
    assert "region_a" in result
    assert "district_a1" in result
    assert "facility_a1a" in result
    assert "subunit_a1a1" in result
    assert "deep_a1a1a" in result
    assert "deeper_a1a1a1" in result
    assert "deepest_a1a1a1a" in result
    assert len(result) == 8


def test_expand_scope_all_levels_with_max_level_5():
    """max_level=5 should stop expansion at level 5, excluding levels 6, 7, 8."""
    from superset.dhis2.sync_service import _expand_org_units_for_scope

    instance = _make_instance()
    with patch(
        "superset.dhis2.sync_service._load_org_unit_hierarchy",
        return_value=_HIERARCHY_8_LEVELS,
    ):
        result = _expand_org_units_for_scope(
            instance=instance,
            allowed_units=["national"],
            scope="all_levels",
            max_level=5,
        )

    assert "national" in result
    assert "region_a" in result
    assert "district_a1" in result
    assert "facility_a1a" in result
    assert "subunit_a1a1" in result
    # levels 6, 7, 8 must be excluded
    assert "deep_a1a1a" not in result
    assert "deeper_a1a1a1" not in result
    assert "deepest_a1a1a1a" not in result
    assert len(result) == 5


def test_expand_scope_all_levels_with_allowed_levels():
    """allowed_levels=[1,2,3,4] should allow only those levels."""
    from superset.dhis2.sync_service import _expand_org_units_for_scope

    instance = _make_instance()
    with patch(
        "superset.dhis2.sync_service._load_org_unit_hierarchy",
        return_value=_HIERARCHY_8_LEVELS,
    ):
        result = _expand_org_units_for_scope(
            instance=instance,
            allowed_units=["national"],
            scope="all_levels",
            allowed_levels=frozenset([1, 2, 3, 4]),
        )

    assert "national" in result
    assert "region_a" in result
    assert "district_a1" in result
    assert "facility_a1a" in result
    assert "subunit_a1a1" not in result
    assert "deep_a1a1a" not in result
    assert "deeper_a1a1a1" not in result
    assert "deepest_a1a1a1a" not in result
    assert len(result) == 4


def test_expand_scope_children_respects_max_level():
    """children scope + max_level: children outside max_level excluded."""
    from superset.dhis2.sync_service import _expand_org_units_for_scope

    # root is region_a (level=2), children scope includes level=3 only
    # max_level=2 should prevent level-3 children from being added
    instance = _make_instance()
    with patch(
        "superset.dhis2.sync_service._load_org_unit_hierarchy",
        return_value=_HIERARCHY_8_LEVELS,
    ):
        result = _expand_org_units_for_scope(
            instance=instance,
            allowed_units=["region_a"],
            scope="children",
            max_level=2,
        )

    # region_a is level 2, so it's included; district_a1 is level 3 → excluded
    assert "region_a" in result
    assert "district_a1" not in result


def test_expand_scope_selected_ignores_max_level():
    """scope='selected' should not expand at all, regardless of max_level."""
    from superset.dhis2.sync_service import _expand_org_units_for_scope

    instance = _make_instance()
    result = _expand_org_units_for_scope(
        instance=instance,
        allowed_units=["national", "region_a"],
        scope="selected",
        max_level=1,
    )
    # No expansion; returns exactly what was passed in
    assert result == ["national", "region_a"]


def test_expand_scope_no_hierarchy_returns_original():
    """When no hierarchy snapshot exists, returns the seed units unchanged."""
    from superset.dhis2.sync_service import _expand_org_units_for_scope

    instance = _make_instance()
    with patch(
        "superset.dhis2.sync_service._load_org_unit_hierarchy",
        return_value=[],
    ):
        result = _expand_org_units_for_scope(
            instance=instance,
            allowed_units=["ou1", "ou2"],
            scope="all_levels",
            max_level=3,
        )
    assert result == ["ou1", "ou2"]


# ---------------------------------------------------------------------------
# Tests: OrgUnitHierarchyService._resolve_level_range
# ---------------------------------------------------------------------------


def _make_hierarchy_snapshot(nodes: list[dict]) -> dict:
    return {"status": "success", "result": nodes}


class TestResolveLeveRange:
    """Tests for OrgUnitHierarchyService._resolve_level_range."""

    def _make_service(self):
        from superset.dhis2.org_unit_hierarchy_service import OrgUnitHierarchyService
        svc = OrgUnitHierarchyService(database_id=10)
        return svc

    def _patch_snapshot(self, nodes):
        return patch(
            "superset.dhis2.org_unit_hierarchy_service.OrgUnitHierarchyService._load_snapshot",
            return_value=_make_hierarchy_snapshot(nodes),
        )

    def test_no_level_info_defaults_to_max_level(self):
        """When selected details have no level info, all levels up to hierarchy max are used."""
        svc = self._make_service()
        # hierarchy has 4 levels
        nodes = [
            {"id": "n1", "level": 1},
            {"id": "n2", "level": 2},
            {"id": "n3", "level": 3},
            {"id": "n4", "level": 4},
        ]
        dataset_config = {
            "org_units": ["ou1"],
            "org_unit_details": [
                {"id": "ou1", "selectionKey": "ou1", "sourceOrgUnitId": "ou1"},
            ],
            "org_unit_scope": "all_levels",
        }
        with self._patch_snapshot(nodes):
            levels = svc._resolve_level_range(dataset_config, [1], None)

        assert levels == [1, 2, 3, 4]

    def test_max_orgunit_level_caps_levels(self):
        """max_orgunit_level in dataset_config caps the resolved levels."""
        svc = self._make_service()
        nodes = [
            {"id": "n1", "level": l} for l in range(1, 9)  # 8 levels in DHIS2
        ]
        dataset_config = {
            "org_units": ["ou1"],
            "org_unit_details": [
                {"id": "ou1", "selectionKey": "ou1", "sourceOrgUnitId": "ou1"},
            ],
            "org_unit_scope": "all_levels",
            "max_orgunit_level": 5,  # cap at level 5
        }
        with self._patch_snapshot(nodes):
            levels = svc._resolve_level_range(dataset_config, [1], None)

        # Must not include levels 6, 7, 8
        assert 6 not in levels
        assert 7 not in levels
        assert 8 not in levels
        assert max(levels) <= 5

    def test_allowed_org_unit_levels_filters_levels(self):
        """allowed_org_unit_levels filters the resolved set to only allowed levels."""
        svc = self._make_service()
        nodes = [
            {"id": "n1", "level": l} for l in range(1, 6)
        ]
        dataset_config = {
            "org_units": ["ou1"],
            "org_unit_details": [
                {"id": "ou1", "selectionKey": "ou1", "sourceOrgUnitId": "ou1"},
            ],
            "org_unit_scope": "all_levels",
            "allowed_org_unit_levels": [1, 2, 3],
        }
        with self._patch_snapshot(nodes):
            levels = svc._resolve_level_range(dataset_config, [1], None)

        assert set(levels) == {1, 2, 3}

    def test_max_level_and_allowed_levels_combined(self):
        """Both constraints applied together: max caps, allowed further filters."""
        svc = self._make_service()
        nodes = [
            {"id": "n1", "level": l} for l in range(1, 9)
        ]
        dataset_config = {
            "org_units": ["ou1"],
            "org_unit_details": [
                {"id": "ou1", "selectionKey": "ou1", "sourceOrgUnitId": "ou1"},
            ],
            "org_unit_scope": "all_levels",
            "max_orgunit_level": 6,          # cap at 6 — removes 7, 8
            "allowed_org_unit_levels": [1, 3, 5],  # allowlist
        }
        with self._patch_snapshot(nodes):
            levels = svc._resolve_level_range(dataset_config, [1], None)

        # After max_level=6, candidate levels are [1,2,3,4,5,6].
        # After allowed=[1,3,5], only [1,3,5] remain.
        assert set(levels) == {1, 3, 5}

    def test_selected_details_with_level_info_scoped_correctly(self):
        """When details have level info, scope max is computed from that level."""
        svc = self._make_service()
        nodes = [
            {"id": "n1", "level": l} for l in range(1, 6)
        ]
        # selected detail at level=3, scope="children" → should resolve [3, 4]
        dataset_config = {
            "org_units": ["ou3"],
            "org_unit_details": [
                {
                    "id": "ou3",
                    "selectionKey": "ou3",
                    "sourceOrgUnitId": "ou3",
                    "level": 3,
                    "sourceInstanceIds": [1],
                },
            ],
            "org_unit_scope": "children",
        }
        with self._patch_snapshot(nodes):
            levels = svc._resolve_level_range(dataset_config, [1], None)

        assert 3 in levels
        assert 4 in levels
        assert 5 not in levels  # grandchildren not in scope

    def test_mapping_rows_bypass_snapshot(self):
        """When mapping_rows is provided, level range is read from mapping."""
        svc = self._make_service()
        mapping_rows = [
            {"merged_level": 1, "label": "National"},
            {"merged_level": 2, "label": "Region"},
            {"merged_level": 3, "label": "District"},
        ]
        levels = svc._resolve_level_range({}, [1], mapping_rows)
        assert levels == [1, 2, 3]

    def test_read_max_orgunit_level_helper(self):
        from superset.dhis2.org_unit_hierarchy_service import OrgUnitHierarchyService
        assert OrgUnitHierarchyService._read_max_orgunit_level({"max_orgunit_level": 5}) == 5
        assert OrgUnitHierarchyService._read_max_orgunit_level({"org_unit_max_level": 3}) == 3
        assert OrgUnitHierarchyService._read_max_orgunit_level({}) is None
        assert OrgUnitHierarchyService._read_max_orgunit_level({"max_orgunit_level": 0}) is None
        assert OrgUnitHierarchyService._read_max_orgunit_level({"max_orgunit_level": "bad"}) is None

    def test_read_allowed_org_unit_levels_helper(self):
        from superset.dhis2.org_unit_hierarchy_service import OrgUnitHierarchyService
        result = OrgUnitHierarchyService._read_allowed_org_unit_levels(
            {"allowed_org_unit_levels": [1, 2, 3]}
        )
        assert result == frozenset([1, 2, 3])
        assert OrgUnitHierarchyService._read_allowed_org_unit_levels({}) is None
        assert OrgUnitHierarchyService._read_allowed_org_unit_levels(
            {"allowed_org_unit_levels": []}
        ) is None


# ---------------------------------------------------------------------------
# Tests: _resolve_org_units_for_instance level constraints
# ---------------------------------------------------------------------------


def test_resolve_org_units_applies_max_level_from_config():
    """max_orgunit_level in dataset_config is applied to expanded descendants."""
    from superset.dhis2.sync_service import DHIS2SyncService

    instance = _make_instance(instance_id=1, database_id=10)

    dataset_config = {
        "org_units": ["national"],
        "org_unit_details": [
            {
                "id": "national",
                "selectionKey": "national",
                "sourceOrgUnitId": "national",
            }
        ],
        "org_unit_scope": "all_levels",
        "org_unit_source_mode": "repository",
        "max_orgunit_level": 4,
    }

    with patch(
        "superset.dhis2.sync_service._load_org_unit_hierarchy",
        return_value=_HIERARCHY_8_LEVELS,
    ):
        result = DHIS2SyncService._resolve_org_units_for_instance(instance, dataset_config)

    # Should contain levels 1-4 but not 5-8
    levels_present = set()
    node_level_map = {n["id"]: n["level"] for n in _HIERARCHY_8_LEVELS}
    for uid in result:
        lvl = node_level_map.get(uid)
        if lvl:
            levels_present.add(lvl)

    assert levels_present <= {1, 2, 3, 4}, f"Unexpected levels: {levels_present - {1,2,3,4}}"
    assert "deeper_a1a1a1" not in result  # level 7
    assert "deepest_a1a1a1a" not in result  # level 8


def test_resolve_org_units_applies_allowed_levels():
    """allowed_org_unit_levels allowlist is enforced during expansion."""
    from superset.dhis2.sync_service import DHIS2SyncService

    instance = _make_instance(instance_id=1, database_id=10)

    dataset_config = {
        "org_units": ["national"],
        "org_unit_details": [
            {
                "id": "national",
                "selectionKey": "national",
                "sourceOrgUnitId": "national",
            }
        ],
        "org_unit_scope": "all_levels",
        "org_unit_source_mode": "repository",
        "allowed_org_unit_levels": [1, 3],  # only national + district level
    }

    with patch(
        "superset.dhis2.sync_service._load_org_unit_hierarchy",
        return_value=_HIERARCHY_8_LEVELS,
    ):
        result = DHIS2SyncService._resolve_org_units_for_instance(instance, dataset_config)

    # Only levels 1 and 3 should appear
    node_level_map = {n["id"]: n["level"] for n in _HIERARCHY_8_LEVELS}
    for uid in result:
        lvl = node_level_map.get(uid)
        if lvl is not None:
            assert lvl in {1, 3}, f"Unexpected level {lvl} for uid {uid}"


def test_resolve_level_constraints_returns_none_when_unset():
    """_resolve_level_constraints returns (None, None) when config has no constraints."""
    from superset.dhis2.sync_service import DHIS2SyncService

    max_level, allowed = DHIS2SyncService._resolve_level_constraints({})
    assert max_level is None
    assert allowed is None


def test_resolve_level_constraints_reads_both_keys():
    """_resolve_level_constraints reads both max and allowed correctly."""
    from superset.dhis2.sync_service import DHIS2SyncService

    max_level, allowed = DHIS2SyncService._resolve_level_constraints(
        {"max_orgunit_level": 5, "allowed_org_unit_levels": [1, 2, 3]}
    )
    assert max_level == 5
    assert allowed == frozenset([1, 2, 3])


# ---------------------------------------------------------------------------
# Tests: DHIS2StagedDataset model helpers
# ---------------------------------------------------------------------------


def test_model_get_allowed_org_unit_levels():
    import tests.dhis2._bootstrap  # noqa
    from superset.dhis2.models import DHIS2StagedDataset
    import json

    ds = DHIS2StagedDataset()

    # None when not set
    ds.allowed_org_unit_levels_json = None
    assert ds.get_allowed_org_unit_levels() is None

    # Parses list
    ds.allowed_org_unit_levels_json = json.dumps([1, 2, 3, 4, 5])
    result = ds.get_allowed_org_unit_levels()
    assert result == [1, 2, 3, 4, 5]

    # Returns None for empty list
    ds.allowed_org_unit_levels_json = json.dumps([])
    assert ds.get_allowed_org_unit_levels() is None

    # Handles bad JSON gracefully
    ds.allowed_org_unit_levels_json = "not valid json"
    assert ds.get_allowed_org_unit_levels() is None


# ---------------------------------------------------------------------------
# Tests: bad-slice tracking
# ---------------------------------------------------------------------------


def test_skipped_slices_accumulate_on_persistent_500():
    """When a slice hits a dead-end, it is recorded in _skipped_slices."""
    from superset.dhis2.sync_service import DHIS2SyncService
    import requests as req_lib

    # Create a service instance with minimal setup
    svc = DHIS2SyncService.__new__(DHIS2SyncService)
    svc._request_log_collector = []
    svc._skipped_slices = []
    svc._request_seq_offset = 0

    instance = _make_instance(instance_id=1)

    # A 500 error that will never succeed no matter how we split
    def _always_500(*args, **kwargs):
        resp = MagicMock()
        resp.status_code = 500
        resp.ok = False
        resp.reason = "Internal Server Error"
        resp.url = "http://test/api/analytics"
        resp.json.side_effect = ValueError("no json")
        raise req_lib.HTTPError(
            "500 Server Error: Internal Server Error for url: http://test/api/analytics",
            response=resp,
        )

    variable_map = {}

    with patch.object(svc, "_make_analytics_request", side_effect=_always_500), \
         patch.object(svc, "_append_request_log"):
        result = svc._fetch_analytics_batch(
            instance=instance,
            batch=["varX"],
            periods=["202301"],
            org_units=["ouA"],
            variable_map=variable_map,
            page_size=1000,
        )

    # Dead-end: 1 var + 1 ou + persistent 500 → empty result + 1 skipped slice
    assert result == []
    assert len(svc._skipped_slices) == 1
    skipped = svc._skipped_slices[0]
    assert skipped["variable"] == "varX"
    assert skipped["org_unit"] == "ouA"
    assert skipped["reason"] == "persistent_500"
    assert skipped["instance_id"] == 1


def test_skipped_slices_empty_on_success():
    """Successful fetch does not add to _skipped_slices."""
    from superset.dhis2.sync_service import DHIS2SyncService

    svc = DHIS2SyncService.__new__(DHIS2SyncService)
    svc._request_log_collector = []
    svc._skipped_slices = []
    svc._request_seq_offset = 0

    instance = _make_instance(instance_id=1)

    _success_response = {
        "headers": [
            {"name": "dx"}, {"name": "pe"}, {"name": "ou"}, {"name": "value"}
        ],
        "rows": [["varX", "202301", "ouA", "42"]],
        "pager": {"page": 1, "pageCount": 1},
        "metaData": {"items": {}, "dimensions": {}},
    }

    with patch.object(svc, "_make_analytics_request", return_value=_success_response), \
         patch.object(svc, "_append_request_log"):
        result = svc._fetch_analytics_batch(
            instance=instance,
            batch=["varX"],
            periods=["202301"],
            org_units=["ouA"],
            variable_map={},
            page_size=1000,
        )

    assert len(result) == 1
    assert len(svc._skipped_slices) == 0


# ---------------------------------------------------------------------------
# Regression: levels 7 and 8 must not appear with hierarchy of 8 levels
# when max_orgunit_level=5 is configured
# ---------------------------------------------------------------------------


def test_regression_levels_7_8_not_in_resolved_range():
    """Regression: levels 7 and 8 must be excluded when max_orgunit_level=5."""
    from superset.dhis2.org_unit_hierarchy_service import OrgUnitHierarchyService

    # Simulate a DHIS2 with 8 levels
    nodes_8_levels = [{"id": f"n{l}", "level": l} for l in range(1, 9)]
    snapshot = {"status": "success", "result": nodes_8_levels}

    svc = OrgUnitHierarchyService(database_id=10)
    dataset_config = {
        "org_units": ["n1"],
        "org_unit_details": [
            {"id": "n1", "selectionKey": "n1", "sourceOrgUnitId": "n1"},
        ],
        "org_unit_scope": "all_levels",
        "max_orgunit_level": 5,
    }

    with patch.object(svc, "_load_snapshot", return_value=snapshot):
        levels = svc._resolve_level_range(dataset_config, [1], None)

    assert 7 not in levels, f"Level 7 leaked into levels: {levels}"
    assert 8 not in levels, f"Level 8 leaked into levels: {levels}"
    assert max(levels) <= 5, f"Levels exceed max_orgunit_level=5: {levels}"


def test_regression_levels_7_8_with_allowed_levels_only():
    """Regression: allowed_org_unit_levels=[1,2,3,4,5] blocks levels 6/7/8."""
    from superset.dhis2.org_unit_hierarchy_service import OrgUnitHierarchyService

    nodes_8_levels = [{"id": f"n{l}", "level": l} for l in range(1, 9)]
    snapshot = {"status": "success", "result": nodes_8_levels}

    svc = OrgUnitHierarchyService(database_id=10)
    dataset_config = {
        "org_units": ["n1"],
        "org_unit_details": [
            {"id": "n1", "selectionKey": "n1", "sourceOrgUnitId": "n1"},
        ],
        "org_unit_scope": "all_levels",
        "allowed_org_unit_levels": [1, 2, 3, 4, 5],
    }

    with patch.object(svc, "_load_snapshot", return_value=snapshot):
        levels = svc._resolve_level_range(dataset_config, [1], None)

    assert set(levels) <= {1, 2, 3, 4, 5}
    assert 6 not in levels
    assert 7 not in levels
    assert 8 not in levels
