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
from unittest.mock import MagicMock, patch

from superset.dhis2.clickhouse_build_service import _generate_serving_sql


def test_generate_serving_sql_basic():
    engine = MagicMock()
    engine.get_superset_sql_table_ref.return_value = "`staging`.`ds_1`"
    
    manifest = {
        "columns": [
            {"column_name": "instance", "type": "VARCHAR"},
            {"column_name": "dx_col", "type": "FLOAT", "variable_id": "var1"},
            {"column_name": "dx_col_male", "type": "FLOAT", "variable_id": "var1", "coc_uid": "male"},
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
    assert "sumOrNull(CASE WHEN dx_uid = 'var1' THEN value_numeric ELSE NULL END) AS `dx_col`" in sql
    assert "sumOrNull(CASE WHEN dx_uid = 'var1' AND co_uid = 'male' THEN value_numeric ELSE NULL END) AS `dx_col_male`" in sql
    assert "ou_map.`ou_region` AS `ou_region`" in sql
    assert "pe_map.`pe_year` AS `pe_year`" in sql
    assert "GROUP BY" in sql
    assert "s.source_instance_name" in sql


def test_generate_serving_sql_incremental():
    engine = MagicMock()
    engine.get_superset_sql_table_ref.return_value = "`staging`.`ds_1`"
    
    manifest = {
        "columns": [
            {"column_name": "dx_col", "type": "FLOAT", "variable_id": "var1"},
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
