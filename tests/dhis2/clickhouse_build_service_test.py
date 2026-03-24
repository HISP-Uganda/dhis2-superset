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
import tests.dhis2._bootstrap  # noqa: F401 - must be first import
from unittest.mock import MagicMock, patch

from superset.dhis2.clickhouse_build_service import _generate_serving_sql, _build_specialized_marts


def test_generate_serving_sql_basic():
    engine = MagicMock()
    engine.get_superset_sql_table_ref.return_value = "`staging`.`ds_1`"

    manifest = {
        "columns": [
            {"column_name": "instance", "type": "VARCHAR"},
            # staged_dataset_id + instance_id scope the CASE predicate fully
            {
                "column_name": "dx_col",
                "type": "FLOAT",
                "variable_id": "var1",
                "instance_id": 1,
                "staged_dataset_id": 10,
            },
            {
                "column_name": "dx_col_male",
                "type": "FLOAT",
                "variable_id": "var1",
                "coc_uid": "male",
                "instance_id": 1,
                "staged_dataset_id": 10,
            },
            {"column_name": "ou_region", "type": "VARCHAR"},
            {"column_name": "pe_year", "type": "VARCHAR"},
        ],
        "dimension_column_names": ["instance"],
        "include_instance_name": True,
    }

    ou_map_table = "`serving`.`tmp_ou`"
    ou_cols = {"ou_region"}
    pe_map_table = "`serving`.`tmp_pe`"
    pe_cols = {"pe_year"}

    sql = _generate_serving_sql(
        MagicMock(),
        engine,
        manifest,
        ou_map_table,
        ou_cols,
        pe_map_table,
        pe_cols,
    )

    assert "FROM `staging`.`ds_1` s" in sql
    assert "LEFT JOIN `serving`.`tmp_ou` ou_map" in sql
    assert "LEFT JOIN `serving`.`tmp_pe` pe_map" in sql
    assert "s.source_instance_name AS `instance`" in sql
    # Both dataset_id and instance_id must appear in CASE predicates
    assert "s.staged_dataset_id = 10" in sql
    assert "s.source_instance_id = 1" in sql
    assert (
        "sumOrNull(CASE WHEN s.dx_uid = 'var1' AND s.staged_dataset_id = 10"
        " AND s.source_instance_id = 1 THEN s.value_numeric ELSE NULL END) AS `dx_col`"
    ) in sql
    assert (
        "sumOrNull(CASE WHEN s.dx_uid = 'var1' AND s.staged_dataset_id = 10"
        " AND s.source_instance_id = 1 AND s.co_uid = 'male' THEN s.value_numeric ELSE NULL END)"
        " AS `dx_col_male`"
    ) in sql
    assert "ou_map.`ou_region` AS `ou_region`" in sql
    assert "pe_map.`pe_year` AS `pe_year`" in sql
    assert "GROUP BY" in sql
    assert "s.source_instance_name" in sql


def test_generate_serving_sql_incremental():
    engine = MagicMock()
    engine.get_superset_sql_table_ref.return_value = "`staging`.`ds_1`"

    manifest = {
        "columns": [
            {
                "column_name": "dx_col",
                "type": "FLOAT",
                "variable_id": "var1",
                "instance_id": 5,
                "staged_dataset_id": 7,
            },
        ],
        "dimension_column_names": [],
    }

    sql = _generate_serving_sql(
        MagicMock(),
        engine,
        manifest,
        "", set(), "", set(),
        refresh_scope=["202301", "202302"]
    )

    assert "s.pe IN ('202301', '202302')" in sql
    assert "s.staged_dataset_id = 7" in sql
    assert "s.source_instance_id = 5" in sql


def test_generate_serving_sql_cross_instance_isolation():
    """Same dx_uid from two different source instances must produce separate
    CASE predicates scoped by staged_dataset_id + source_instance_id.
    Neither instance's values should bleed into the other's column.
    """
    engine = MagicMock()
    engine.get_superset_sql_table_ref.return_value = "`staging`.`ds_multi`"

    manifest = {
        "columns": [
            {
                "column_name": "malaria_cases_inst_1",
                "type": "FLOAT",
                "variable_id": "malaria_cases",
                "instance_id": 1,
                "staged_dataset_id": 99,
            },
            {
                "column_name": "malaria_cases_inst_2",
                "type": "FLOAT",
                "variable_id": "malaria_cases",
                "instance_id": 2,
                "staged_dataset_id": 99,
            },
        ],
        "dimension_column_names": [],
    }

    sql = _generate_serving_sql(
        MagicMock(), engine, manifest, "", set(), "", set()
    )

    # Both columns must carry the same dataset guard
    assert sql.count("s.staged_dataset_id = 99") == 2
    # Each column must be gated to its own instance
    assert "s.source_instance_id = 1" in sql
    assert "s.source_instance_id = 2" in sql

    assert (
        "CASE WHEN s.dx_uid = 'malaria_cases' AND s.staged_dataset_id = 99"
        " AND s.source_instance_id = 1 THEN s.value_numeric ELSE NULL END)"
        " AS `malaria_cases_inst_1`"
    ) in sql
    assert (
        "CASE WHEN s.dx_uid = 'malaria_cases' AND s.staged_dataset_id = 99"
        " AND s.source_instance_id = 2 THEN s.value_numeric ELSE NULL END)"
        " AS `malaria_cases_inst_2`"
    ) in sql


def test_generate_serving_sql_manifest_build_version_sentinel():
    """The manifest build version sentinel column is emitted as a literal int."""
    from superset.dhis2.analytical_serving import _MANIFEST_BUILD_VERSION

    engine = MagicMock()
    engine.get_superset_sql_table_ref.return_value = "`staging`.`ds_1`"

    manifest = {
        "columns": [
            {
                "column_name": f"_manifest_build_v{_MANIFEST_BUILD_VERSION}",
                "type": "INTEGER",
                "extra": {
                    "dhis2_is_internal": True,
                    "dhis2_manifest_build_version": _MANIFEST_BUILD_VERSION,
                },
            },
        ],
        "dimension_column_names": [],
    }

    sql = _generate_serving_sql(
        MagicMock(), engine, manifest, "", set(), "", set()
    )

    assert f"`_manifest_build_v{_MANIFEST_BUILD_VERSION}`" in sql
    assert f"toUInt8({_MANIFEST_BUILD_VERSION})" in sql
