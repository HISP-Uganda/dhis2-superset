from __future__ import annotations

from types import SimpleNamespace

import pytest

from superset.ai_insights.sql import (
    AISQLValidationError,
    ensure_mart_only_sql,
    ensure_select_only_sql,
    is_mart_table,
)


def test_is_mart_table_accepts_mart_role() -> None:
    dataset = SimpleNamespace(dataset_role="MART", table_name="foo")
    assert is_mart_table(dataset) is True


def test_is_mart_table_accepts_mart_suffix() -> None:
    dataset = SimpleNamespace(dataset_role="", table_name="admissions_mart")
    assert is_mart_table(dataset) is True


def test_ensure_select_only_sql_rejects_mutations(mocker: pytest.MockFixture) -> None:
    database = SimpleNamespace(
        db_engine_spec=SimpleNamespace(engine="postgresql"),
        backend="postgresql",
    )

    with pytest.raises(AISQLValidationError, match="read-only analytical SQL"):
        ensure_select_only_sql(database, "DELETE FROM admissions_mart")


def test_ensure_mart_only_sql_adds_limit_and_restricts_tables(
    mocker: pytest.MockFixture,
) -> None:
    database = SimpleNamespace(
        id=7,
        db_engine_spec=SimpleNamespace(engine="postgresql"),
        backend="postgresql",
    )
    mocker.patch(
        "superset.ai_insights.sql.list_mart_tables",
        return_value=[
            SimpleNamespace(schema="public", table_name="admissions_mart"),
        ],
    )

    result = ensure_mart_only_sql(
        database,
        "SELECT region, SUM(value) FROM public.admissions_mart GROUP BY region",
        schema="public",
    )

    assert result["validated"] is True
    assert result["tables"] == ["public.admissions_mart"]
    assert result["sql"].endswith("LIMIT 200")


def test_ensure_mart_only_sql_rejects_non_mart_tables(
    mocker: pytest.MockFixture,
) -> None:
    database = SimpleNamespace(
        id=7,
        db_engine_spec=SimpleNamespace(engine="postgresql"),
        backend="postgresql",
    )
    mocker.patch(
        "superset.ai_insights.sql.list_mart_tables",
        return_value=[
            SimpleNamespace(schema="public", table_name="admissions_mart"),
        ],
    )

    with pytest.raises(AISQLValidationError, match="not a registered MART table"):
        ensure_mart_only_sql(database, "SELECT * FROM public.other_table", schema="public")
