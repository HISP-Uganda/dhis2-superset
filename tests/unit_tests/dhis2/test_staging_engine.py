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

from types import SimpleNamespace

from superset.dhis2.staging_engine import DHIS2StagingEngine


class _ExecuteResult:
    rowcount = 0

    def fetchone(self) -> None:
        return None

    def fetchall(self) -> list[object]:
        return []


class _RecordingConnection:
    def __init__(self) -> None:
        self.statements: list[tuple[str, object | None]] = []

    def execute(self, statement: object, params: object | None = None) -> _ExecuteResult:
        self.statements.append((str(statement), params))
        return _ExecuteResult()


class _BeginContext:
    def __init__(self, connection: _RecordingConnection) -> None:
        self.connection = connection

    def __enter__(self) -> _RecordingConnection:
        return self.connection

    def __exit__(self, exc_type: object, exc: object, exc_tb: object) -> bool:
        return False


class _FakeEngine:
    def __init__(self, dialect_name: str, connection: _RecordingConnection) -> None:
        self.dialect = SimpleNamespace(name=dialect_name)
        self._connection = connection
        self.begin_calls = 0

    def begin(self) -> _BeginContext:
        self.begin_calls += 1
        return _BeginContext(self._connection)


def _dataset() -> SimpleNamespace:
    return SimpleNamespace(
        id=7,
        name="Test Multiple Sources",
        staging_table_name=None,
    )


def test_create_staging_table_uses_sqlite_compatible_ddl(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    connection = _RecordingConnection()
    engine = _FakeEngine("sqlite", connection)
    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(
            engine=engine,
            session=SimpleNamespace(connection=lambda: connection),
        ),
        raising=False,
    )

    table_ref = DHIS2StagingEngine(database_id=2).create_staging_table(_dataset())

    statements = "\n".join(statement for statement, _ in connection.statements)

    assert table_ref == "ds_7_test_multiple_sources"
    assert "CREATE SCHEMA IF NOT EXISTS dhis2_staging" not in statements
    assert "CREATE TABLE IF NOT EXISTS ds_7_test_multiple_sources" in statements
    assert "INTEGER PRIMARY KEY AUTOINCREMENT" in statements
    assert "DEFAULT CURRENT_TIMESTAMP" in statements
    assert "CREATE UNIQUE INDEX IF NOT EXISTS ux_ds_7_test_multiple_sources_composite_key" in statements
    assert engine.begin_calls == 0


def test_sqlite_truncate_uses_delete(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    connection = _RecordingConnection()
    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(engine=_FakeEngine("sqlite", connection)),
        raising=False,
    )

    DHIS2StagingEngine(database_id=2).truncate_staging_table(_dataset())

    assert connection.statements[-1] == ("DELETE FROM ds_7_test_multiple_sources", None)


def test_postgres_table_ref_keeps_staging_schema(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(engine=_FakeEngine("postgresql", _RecordingConnection())),
        raising=False,
    )

    assert (
        DHIS2StagingEngine(database_id=2).get_superset_sql_table_ref(_dataset())
        == "dhis2_staging.ds_7_test_multiple_sources"
    )


def test_get_staging_table_stats_handles_string_timestamps(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    class _StatsConnection:
        def execute(self, statement, params=None):
            sql = str(statement)
            if "COUNT(*) AS total_rows" in sql:
                return SimpleNamespace(
                    fetchone=lambda: (4, "2026-03-14 06:10:00", "2026-03-14 06:20:00"),
                )
            if "GROUP BY source_instance_id" in sql:
                return SimpleNamespace(fetchall=lambda: [(1, 4)])
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, exc_tb):
            return False

    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(
            engine=SimpleNamespace(
                dialect=SimpleNamespace(name="sqlite"),
                connect=lambda: _StatsConnection(),
            )
        ),
        raising=False,
    )
    monkeypatch.setattr(
        module.DHIS2StagingEngine,
        "table_exists",
        lambda self, dataset: True,
    )

    stats = DHIS2StagingEngine(database_id=2).get_staging_table_stats(_dataset())

    assert stats == {
        "total_rows": 4,
        "rows_per_instance": {1: 4},
        "min_synced_at": "2026-03-14 06:10:00",
        "max_synced_at": "2026-03-14 06:20:00",
        "table_size_bytes": None,
    }


def test_delete_rows_for_instance_periods_uses_period_filter(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    connection = _RecordingConnection()
    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(engine=_FakeEngine("sqlite", connection)),
        raising=False,
    )
    monkeypatch.setattr(
        module.DHIS2StagingEngine,
        "table_exists",
        lambda self, dataset: True,
    )

    DHIS2StagingEngine(database_id=2).delete_rows_for_instance_periods(
        _dataset(),
        instance_id=3,
        periods=["202501", "202502"],
    )

    statement, params = connection.statements[-1]
    assert "DELETE FROM ds_7_test_multiple_sources" in statement
    assert "source_instance_id = :instance_id" in statement
    assert "pe IN (:period_0, :period_1)" in statement
    assert params == {
        "instance_id": 3,
        "period_0": "202501",
        "period_1": "202502",
    }


def test_build_serving_query_supports_in_operator(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(engine=SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))),
        raising=False,
    )
    monkeypatch.setattr(
        module.DHIS2StagingEngine,
        "get_serving_table_columns",
        lambda self, dataset: ["period", "region", "anc_1st_visit"],
    )

    (
        select_sql,
        count_sql,
        preview_sql,
        params,
        resolved_columns,
        safe_page,
    ) = DHIS2StagingEngine(database_id=2)._build_serving_query(
        _dataset(),
        selected_columns=["period", "anc_1st_visit"],
        filters=[{"column": "period", "operator": "in", "value": ["2024Q1", "2024Q2"]}],
        limit=100,
        page=1,
    )

    assert 'SELECT "period", "anc_1st_visit" FROM sv_7_test_multiple_sources' in select_sql
    assert '"period" IN (:filter_0_0, :filter_0_1)' in select_sql
    assert '"period" IN (\'2024Q1\', \'2024Q2\')' in preview_sql
    assert count_sql == (
        'SELECT COUNT(*) FROM sv_7_test_multiple_sources WHERE "period" IN (:filter_0_0, :filter_0_1)'
    )
    assert params["filter_0_0"] == "2024Q1"
    assert params["filter_0_1"] == "2024Q2"
    assert params["limit"] == 100
    assert resolved_columns == ["period", "anc_1st_visit"]
    assert safe_page == 1


def test_build_serving_query_supports_empty_operators(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(engine=SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))),
        raising=False,
    )
    monkeypatch.setattr(
        module.DHIS2StagingEngine,
        "get_serving_table_columns",
        lambda self, dataset: ["region", "district_city", "dlg_municipality_city_council"],
    )

    (
        select_sql,
        count_sql,
        preview_sql,
        params,
        resolved_columns,
        safe_page,
    ) = DHIS2StagingEngine(database_id=2)._build_serving_query(
        _dataset(),
        selected_columns=["region", "district_city"],
        filters=[
            {"column": "district_city", "operator": "not_empty"},
            {
                "column": "dlg_municipality_city_council",
                "operator": "is_empty",
            },
        ],
        limit=100,
        page=1,
    )

    empty_expression = (
        "NULLIF(TRIM(COALESCE(CAST(\"district_city\" AS TEXT), '')), '') IS NOT NULL"
    )
    deeper_empty_expression = (
        "NULLIF(TRIM(COALESCE(CAST(\"dlg_municipality_city_council\" AS TEXT), '')), '') IS NULL"
    )

    assert empty_expression in select_sql
    assert deeper_empty_expression in select_sql
    assert empty_expression in count_sql
    assert deeper_empty_expression in preview_sql
    assert params["limit"] == 100
    assert resolved_columns == ["region", "district_city"]
    assert safe_page == 1


def test_build_serving_query_supports_grouped_aggregation(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(engine=SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))),
        raising=False,
    )
    monkeypatch.setattr(
        module.DHIS2StagingEngine,
        "get_serving_table_columns",
        lambda self, dataset: [
            "region",
            "district_city",
            "period",
            "c_105_ep01b_malaria_tested_b_s_rdt",
        ],
    )

    (
        select_sql,
        count_sql,
        preview_sql,
        params,
        resolved_columns,
        safe_page,
    ) = DHIS2StagingEngine(database_id=2)._build_serving_query(
        _dataset(),
        filters=[{"column": "region", "operator": "eq", "value": "Acholi"}],
        limit=250,
        page=2,
        group_by_columns=["district_city"],
        metric_column="c_105_ep01b_malaria_tested_b_s_rdt",
        metric_alias="SUM(c_105_ep01b_malaria_tested_b_s_rdt)",
        aggregation_method="sum",
    )

    assert (
        'SELECT "district_city", SUM(COALESCE("c_105_ep01b_malaria_tested_b_s_rdt", 0)) '
        'AS "SUM(c_105_ep01b_malaria_tested_b_s_rdt)" '
        'FROM sv_7_test_multiple_sources WHERE "region" = :filter_0 GROUP BY "district_city"'
    ) in select_sql
    assert (
        'SELECT COUNT(*) FROM (SELECT "district_city" FROM sv_7_test_multiple_sources '
        'WHERE "region" = :filter_0 GROUP BY "district_city") AS grouped_rows'
    ) == count_sql
    assert (
        'SELECT "district_city", SUM(COALESCE("c_105_ep01b_malaria_tested_b_s_rdt", 0)) '
        'AS "SUM(c_105_ep01b_malaria_tested_b_s_rdt)" '
        'FROM sv_7_test_multiple_sources WHERE "region" = \'Acholi\' GROUP BY "district_city"'
    ) in preview_sql
    assert params["filter_0"] == "Acholi"
    assert params["limit"] == 250
    assert params["offset"] == 250
    assert resolved_columns == [
        "district_city",
        "SUM(c_105_ep01b_malaria_tested_b_s_rdt)",
    ]
    assert safe_page == 2


def test_get_serving_filter_options_uses_scoped_filters(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    statements: list[tuple[str, object | None]] = []

    class _FilterConnection:
        def execute(self, statement, params=None):
            sql = str(statement)
            statements.append((sql, params))
            if 'SELECT "district" AS option_value' in sql:
                rows = [SimpleNamespace(_mapping={"option_value": "Gulu", "row_count": 5})]
            elif 'SELECT "region" AS option_value' in sql:
                rows = [SimpleNamespace(_mapping={"option_value": "Acholi", "row_count": 8})]
            elif 'SELECT "period" AS option_value' in sql:
                rows = [SimpleNamespace(_mapping={"option_value": "2024Q1", "row_count": 5})]
            else:
                rows = []
            return rows

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, exc_tb):
            return False

    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(
            engine=SimpleNamespace(
                dialect=SimpleNamespace(name="sqlite"),
                connect=lambda: _FilterConnection(),
            )
        ),
        raising=False,
    )
    monkeypatch.setattr(
        module.DHIS2StagingEngine,
        "get_serving_table_columns",
        lambda self, dataset: ["region", "district", "period", "anc_1st_visit"],
    )

    result = DHIS2StagingEngine(database_id=2).get_serving_filter_options(
        _dataset(),
        columns=[
            {
                "column_name": "region",
                "verbose_name": "Region",
                "extra": '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 2}',
            },
            {
                "column_name": "district",
                "verbose_name": "District",
                "extra": '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 3}',
            },
            {
                "column_name": "period",
                "verbose_name": "Period",
                "extra": '{"dhis2_is_period": true}',
            },
        ],
        filters=[
            {"column": "region", "operator": "eq", "value": "Acholi"},
            {"column": "period", "operator": "in", "value": ["2024Q1", "2024Q2"]},
        ],
    )

    assert result["org_unit_filters"][0]["column_name"] == "region"
    assert result["org_unit_filters"][0]["options"][0]["value"] == "Acholi"
    assert result["org_unit_filters"][1]["column_name"] == "district"
    assert result["org_unit_filters"][1]["options"][0]["value"] == "Gulu"
    assert result["period_filter"]["column_name"] == "period"
    assert result["period_filter"]["options"][0]["value"] == "2024Q1"
    assert any(
        'SELECT "district" AS option_value' in sql
        and '"region" = :filter_0' in sql
        and '"period" IN (:filter_1_0, :filter_1_1)' in sql
        for sql, _params in statements
    )


def test_upsert_rows_for_instance_uses_conflict_update(monkeypatch) -> None:
    from superset.dhis2 import staging_engine as module

    connection = _RecordingConnection()
    monkeypatch.setattr(
        module,
        "db",
        SimpleNamespace(
            engine=_FakeEngine("sqlite", connection),
            session=SimpleNamespace(connection=lambda: connection),
        ),
        raising=False,
    )

    engine = DHIS2StagingEngine(database_id=2)
    rows = [
        {
            "dx_uid": "de_1",
            "dx_name": "ANC 1",
            "dx_type": "dataElement",
            "pe": "202501",
            "ou": "ou_1",
            "ou_name": "Kampala",
            "ou_level": 3,
            "value": "12",
            "value_numeric": 12.0,
            "co_uid": None,
            "co_name": None,
            "aoc_uid": None,
        }
    ]

    engine.upsert_rows_for_instance(
        _dataset(),
        instance_id=2,
        instance_name="HMIS-Test",
        rows=rows,
        sync_job_id=7,
    )

    statements = "\n".join(statement for statement, _ in connection.statements)
    assert "ON CONFLICT (source_instance_id, dx_uid, pe, ou)" in statements
    assert "DO UPDATE SET" in statements
    assert "synced_at = CURRENT_TIMESTAMP" in statements
