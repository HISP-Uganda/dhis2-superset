from __future__ import annotations

import re
from typing import Any

from flask import current_app
from sqlalchemy import and_

from superset import db
from superset.connectors.sqla.models import SqlaTable
from superset.models.core import Database
from superset.sql.parse import SQLScript, Table

MART_ROLE_MARKERS = {"MART", "SERVING_DATASET", "MART_DATASET", "SERVING"}
LIMIT_RE = re.compile(r"\blimit\b", re.IGNORECASE)


class AISQLValidationError(Exception):
    pass


def is_mart_table(dataset: SqlaTable) -> bool:
    role = str(getattr(dataset, "dataset_role", "") or "").upper()
    if role in MART_ROLE_MARKERS or "MART" in role or "SERVING" in role:
        return True
    table_name = str(getattr(dataset, "table_name", "") or "")
    return table_name.lower().endswith("_mart")


def list_mart_tables(database_id: int, schema: str | None = None) -> list[SqlaTable]:
    query = db.session.query(SqlaTable).filter(SqlaTable.database_id == database_id)
    if schema is not None:
        query = query.filter(SqlaTable.schema == schema)
    tables = query.all()
    return [table for table in tables if is_mart_table(table)]


def build_mart_schema_context(
    database_id: int,
    schema: str | None = None,
    *,
    max_tables: int = 40,
    max_columns: int = 30,
) -> list[dict[str, Any]]:
    context: list[dict[str, Any]] = []
    for table in list_mart_tables(database_id, schema)[:max_tables]:
        context.append(
            {
                "table": table.table_name,
                "schema": table.schema,
                "description": table.description,
                "columns": [
                    {
                        "name": column.column_name,
                        "type": column.type,
                        "description": column.description,
                    }
                    for column in (table.columns or [])[:max_columns]
                ],
            }
        )
    return context


def table_identifier(schema: str | None, table_name: str) -> str:
    return f"{schema}.{table_name}" if schema else table_name


def _allowed_table_maps(
    allowed_tables: list[SqlaTable],
) -> tuple[set[str], dict[str, set[str]]]:
    identifiers: set[str] = set()
    table_to_schemas: dict[str, set[str]] = {}
    for table in allowed_tables:
        identifiers.add(table_identifier(table.schema, table.table_name))
        table_to_schemas.setdefault(table.table_name, set()).add(table.schema or "")
    return identifiers, table_to_schemas


def _normalize_table_ref(table: Table, default_schema: str | None) -> str:
    schema = table.schema or default_schema
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
