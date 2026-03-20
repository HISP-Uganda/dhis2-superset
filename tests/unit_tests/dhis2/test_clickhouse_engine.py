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
from __future__ import annotations

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from types import SimpleNamespace


def _dataset() -> SimpleNamespace:
    return SimpleNamespace(
        id=7,
        name="EP Malaria",
        staging_table_name="ds_7_ep_malaria",
    )


def test_clickhouse_fetch_staging_rows_limit_zero_fetches_all(monkeypatch) -> None:
    from superset.local_staging.clickhouse_engine import ClickHouseStagingEngine

    engine = ClickHouseStagingEngine(
        database_id=10,
        config={"host": "localhost", "database": "dhis2_staging"},
    )
    executed_sql: list[str] = []

    def _fake_qry(sql: str, **_kwargs):
        executed_sql.append(sql)
        return SimpleNamespace(
            column_names=["dx_uid", "pe"],
            result_rows=[("de_1", "2024Q1")],
        )

    monkeypatch.setattr(engine, "_qry", _fake_qry)

    rows = list(engine.fetch_staging_rows(_dataset(), limit=0))

    assert rows == [{"dx_uid": "de_1", "pe": "2024Q1"}]
    assert executed_sql
    assert "LIMIT 0" not in executed_sql[0]


def test_clickhouse_staging_preview_targets_ds_table(monkeypatch) -> None:
    from superset.local_staging.clickhouse_engine import ClickHouseStagingEngine

    engine = ClickHouseStagingEngine(
        database_id=10,
        config={
            "host": "localhost",
            "database": "dhis2_staging",
            "serving_database": "dhis2_serving",
        },
    )

    monkeypatch.setattr(engine, "table_exists", lambda _dataset: True)

    def _fake_qry(sql: str, **_kwargs):
        if sql.startswith("SELECT count() FROM `dhis2_staging`.`ds_7_ep_malaria`"):
            return SimpleNamespace(result_rows=[(3,)])
        if sql.startswith("SELECT * FROM `dhis2_staging`.`ds_7_ep_malaria`"):
            return SimpleNamespace(
                column_names=["dx_uid", "pe", "ou"],
                result_rows=[("de_1", "2024Q1", "ou_1")],
            )
        raise AssertionError(sql)

    monkeypatch.setattr(engine, "_qry", _fake_qry)

    preview = engine.get_staging_table_preview(_dataset(), limit=25)

    assert preview["staging_table_ref"] == "`dhis2_staging`.`ds_7_ep_malaria`"
    assert preview["serving_table_ref"] == "`dhis2_serving`.`sv_7_ep_malaria`"
    assert preview["rows"] == [{"dx_uid": "de_1", "pe": "2024Q1", "ou": "ou_1"}]
    assert preview["diagnostics"]["row_count"] == 3
    assert "`dhis2_staging`.`ds_7_ep_malaria`" in preview["diagnostics"]["sql_preview"]
