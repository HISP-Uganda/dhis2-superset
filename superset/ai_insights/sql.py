from __future__ import annotations

import re
from typing import Any

from flask import current_app
from sqlalchemy import and_

from superset import db
from superset.connectors.sqla.models import (
    SqlaTable,
    _resolve_dhis2_staged_local_table_ref,
)
from superset.models.core import Database
from superset.sql.parse import SQLScript, Table

MART_ROLE_MARKERS = {"MART"}
LIMIT_RE = re.compile(r"\blimit\b", re.IGNORECASE)


class AISQLValidationError(Exception):
    pass


def _normalize_schema_name(schema: str | None) -> str | None:
    normalized = str(schema or "").strip()
    return normalized or None


def _resolve_dataset_table_ref(dataset: SqlaTable) -> tuple[str | None, str]:
    schema_name = _normalize_schema_name(getattr(dataset, "schema", None))
    table_name = str(getattr(dataset, "table_name", "") or "").strip()
    if table_ref := _resolve_dhis2_staged_local_table_ref(
        getattr(dataset, "extra_dict", {}),
        getattr(dataset, "sql", None),
    ):
        schema_name, table_name = table_ref
    return schema_name, table_name


def is_mart_table(dataset: SqlaTable) -> bool:
    role = str(getattr(dataset, "dataset_role", "") or "").upper()
    if role in MART_ROLE_MARKERS:
        return True
    table_name = str(getattr(dataset, "table_name", "") or "")
    return table_name.lower().endswith("_mart")


def list_mart_tables(database_id: int, schema: str | None = None) -> list[SqlaTable]:
    requested_schema = _normalize_schema_name(schema)
    tables = (
        db.session.query(SqlaTable)
        .filter(SqlaTable.database_id == database_id)
        .all()
    )
    mart_tables: list[SqlaTable] = []
    for table in tables:
        if not is_mart_table(table):
            continue
        resolved_schema, _ = _resolve_dataset_table_ref(table)
        if requested_schema is None or resolved_schema == requested_schema:
            mart_tables.append(table)
    return mart_tables


def list_all_mart_tables(schema: str | None = None) -> list[SqlaTable]:
    """List ALL MART tables across all databases."""
    requested_schema = _normalize_schema_name(schema)
    all_tables = db.session.query(SqlaTable).all()
    mart_tables: list[SqlaTable] = []
    for table in all_tables:
        if not is_mart_table(table):
            continue
        resolved_schema, _ = _resolve_dataset_table_ref(table)
        if requested_schema is None or resolved_schema == requested_schema:
            mart_tables.append(table)
    return mart_tables


def resolve_mart_execution_database(
    database_id: int | None = None,
) -> "Database | None":
    """Resolve the correct database for executing MART queries.

    MART tables registered against a DHIS2 source database are actually
    served from a local staging database. This function resolves the
    correct execution target:

    1. If a MART dataset has ``dhis2_serving_database_id`` in extra,
       use that staging database.
    2. If the system has a configured staging database, use it.
    3. Otherwise fall back to the provided ``database_id``.
    """
    from superset.daos.database import DatabaseDAO

    # Try to find a MART dataset and check if it has a serving database
    if database_id:
        mart_tables = list_mart_tables(database_id)
    else:
        mart_tables = list_all_mart_tables()

    for table in mart_tables:
        extra = getattr(table, "extra_dict", None) or {}
        serving_db_id = extra.get("dhis2_serving_database_id")
        if serving_db_id:
            serving_db = DatabaseDAO.find_by_id(int(serving_db_id))
            if serving_db:
                return serving_db

    # Try the global staging database
    try:
        from superset.dhis2.staging_database_service import get_staging_database

        staging_db = get_staging_database(always_create=False)
        if staging_db:
            return staging_db
    except Exception:  # pylint: disable=broad-except
        pass

    # Fall back to the provided database
    if database_id:
        return DatabaseDAO.find_by_id(database_id)

    return None


def build_mart_schema_context(
    database_id: int,
    schema: str | None = None,
    *,
    max_tables: int = 20,
    max_columns: int = 25,
) -> list[dict[str, Any]]:
    """Build schema context for MART tables.

    Searches for MART tables registered against ``database_id`` first,
    then falls back to all MART tables across all databases.
    """
    tables = list_mart_tables(database_id, schema)
    if not tables:
        # Fallback: MART datasets may be registered against a different
        # database (e.g., DHIS2 source) but served from staging.
        tables = list_all_mart_tables(schema)

    context: list[dict[str, Any]] = []
    for table in tables[:max_tables]:
        resolved_schema, resolved_table = _resolve_dataset_table_ref(table)
        cols = []
        for column in (table.columns or [])[:max_columns]:
            col_entry: dict[str, Any] = {"name": column.column_name}
            if column.type:
                col_entry["type"] = column.type
            if column.description:
                col_entry["description"] = column.description[:100]
            cols.append(col_entry)

        entry: dict[str, Any] = {
            "table": resolved_table,
            "schema": resolved_schema,
            "columns": cols,
        }
        if table.table_name and table.table_name != resolved_table:
            entry["dataset_name"] = table.table_name
        if table.description:
            entry["description"] = table.description[:200]
        context.append(entry)
    return context


def table_identifier(schema: str | None, table_name: str) -> str:
    normalized_schema = _normalize_schema_name(schema)
    return f"{normalized_schema}.{table_name}" if normalized_schema else table_name


def _allowed_table_maps(
    allowed_tables: list[SqlaTable],
) -> tuple[set[str], dict[str, set[str]]]:
    identifiers: set[str] = set()
    table_to_schemas: dict[str, set[str]] = {}
    for table in allowed_tables:
        schema_name, table_name = _resolve_dataset_table_ref(table)
        identifiers.add(table_identifier(schema_name, table_name))
        table_to_schemas.setdefault(table_name, set()).add(schema_name or "")
    return identifiers, table_to_schemas


def _normalize_table_ref(table: Table, default_schema: str | None) -> str:
    schema = _normalize_schema_name(table.schema) or _normalize_schema_name(default_schema)
    return table_identifier(schema, table.table)


def ensure_select_only_sql(database: Database, sql: str) -> SQLScript:
    script = SQLScript(sql, engine=database.db_engine_spec.engine)
    if script.has_mutation():
        raise AISQLValidationError("Only read-only analytical SQL is allowed")
    if len(script.statements) != 1 or not script.statements[0].is_select():
        raise AISQLValidationError("Only SELECT queries are supported")
    return script


def ensure_mart_only_sql(
    database: Database,
    sql: str,
    *,
    schema: str | None = None,
) -> dict[str, Any]:
    schema = _normalize_schema_name(schema)
    script = ensure_select_only_sql(database, sql)
    mart_tables = list_mart_tables(database.id, schema)
    if not mart_tables:
        raise AISQLValidationError(
            "No MART tables are registered for the selected database/schema"
        )

    allowed_identifiers, allowed_by_name = _allowed_table_maps(mart_tables)
    parsed_tables = [
        table_ref
        for statement in script.statements
        for table_ref in statement.tables
    ]
    if not parsed_tables:
        raise AISQLValidationError("Generated SQL must read from registered MART tables")

    normalized_tables: list[str] = []
    for table in parsed_tables:
        normalized = _normalize_table_ref(table, schema)
        if normalized not in allowed_identifiers:
            candidate_schemas = allowed_by_name.get(table.table)
            if not candidate_schemas:
                raise AISQLValidationError(
                    f"Table {table_identifier(table.schema, table.table)} is not a registered MART table"
                )
            if len(candidate_schemas) > 1 and not table.schema:
                raise AISQLValidationError(
                    f"Table {table.table} is ambiguous across MART schemas"
                )
            normalized = table_identifier(next(iter(candidate_schemas)) or None, table.table)
        normalized_tables.append(normalized)

    safe_sql = sql.strip().rstrip(";")
    if not LIMIT_RE.search(safe_sql):
        safe_limit = int(
            current_app.config.get("AI_INSIGHTS_CONFIG", {}).get(
                "max_generated_sql_rows", 200
            )
            or 200
        )
        safe_sql = f"{safe_sql} LIMIT {safe_limit}"

    return {
        "sql": safe_sql,
        "tables": normalized_tables,
        "validated": True,
    }
