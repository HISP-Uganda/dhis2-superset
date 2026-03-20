#!/usr/bin/env python3
"""
Migrate DuckDB staging/serving tables to ClickHouse.

Tables prefixed ds_ go to dhis2_staging, sv_ go to dhis2_serving.
Empty tables are skipped (only schema migrated).
"""
import sys
import os
import logging
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────────────
DUCKDB_PATH = str(Path(__file__).parent.parent / "var" / "dhis2_staging.duckdb")
CH_HOST     = os.getenv("CLICKHOUSE_HOST", "127.0.0.1")
CH_HTTP_PORT = int(os.getenv("CLICKHOUSE_HTTP_PORT", "8123"))
CH_USER     = os.getenv("CLICKHOUSE_USER", "dhis2_user")
CH_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "change_me_securely")
CH_STAGING_DB = os.getenv("CLICKHOUSE_STAGING_DATABASE", "dhis2_staging")
CH_SERVING_DB = os.getenv("CLICKHOUSE_SERVING_DATABASE", "dhis2_serving")

BATCH_SIZE = 5000
SKIP_EMPTY = False  # set True to skip tables with 0 rows entirely

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("migrate")

# ── DuckDB → ClickHouse type map ────────────────────────────────────────────────
TYPE_MAP = {
    "VARCHAR":    "Nullable(String)",
    "TEXT":       "Nullable(String)",
    "CHAR":       "Nullable(String)",
    "BLOB":       "Nullable(String)",
    "DOUBLE":     "Nullable(Float64)",
    "FLOAT":      "Nullable(Float32)",
    "REAL":       "Nullable(Float64)",
    "DECIMAL":    "Nullable(Float64)",
    "NUMERIC":    "Nullable(Float64)",
    "BIGINT":     "Nullable(Int64)",
    "HUGEINT":    "Nullable(Int64)",
    "INTEGER":    "Nullable(Int32)",
    "INT":        "Nullable(Int32)",
    "SMALLINT":   "Nullable(Int16)",
    "TINYINT":    "Nullable(Int8)",
    "UBIGINT":    "Nullable(UInt64)",
    "UINTEGER":   "Nullable(UInt32)",
    "USMALLINT":  "Nullable(UInt16)",
    "UTINYINT":   "Nullable(UInt8)",
    "BOOLEAN":    "Nullable(UInt8)",
    "BOOL":       "Nullable(UInt8)",
    "DATE":       "Nullable(Date)",
    "TIMESTAMP":  "Nullable(DateTime)",
    "TIMESTAMP WITH TIME ZONE": "Nullable(DateTime)",
    "INTERVAL":   "Nullable(String)",
    "JSON":       "Nullable(String)",
    "MAP":        "Nullable(String)",
    "STRUCT":     "Nullable(String)",
    "LIST":       "Nullable(String)",
}

def map_type(duckdb_type: str) -> str:
    upper = duckdb_type.upper().strip()
    if upper in TYPE_MAP:
        return TYPE_MAP[upper]
    # Handle parameterised types like DECIMAL(10,2), VARCHAR(255)
    base = upper.split("(")[0].strip()
    return TYPE_MAP.get(base, "Nullable(String)")


def duckdb_columns(con, table: str) -> list[tuple[str, str]]:
    rows = con.execute(f'DESCRIBE "{table}"').fetchall()
    return [(r[0], r[1]) for r in rows]


def ch_create_table(ch, db: str, table: str, columns: list[tuple[str, str]]) -> None:
    col_defs = ",\n    ".join(
        f"`{name}` {map_type(dtype)}" for name, dtype in columns
    )
    ddl = (
        f"CREATE TABLE IF NOT EXISTS `{db}`.`{table}` (\n"
        f"    {col_defs}\n"
        f") ENGINE = MergeTree() ORDER BY tuple()"
    )
    log.debug("DDL: %s", ddl)
    ch.command(ddl)


def migrate_table(con, ch, table: str, db: str) -> int:
    columns = duckdb_columns(con, table)
    ch_create_table(ch, db, table, columns)

    total = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    if total == 0:
        log.info("  %-45s  → %-20s  (empty, schema only)", table, db)
        return 0

    col_names = [c[0] for c in columns]
    col_list  = ", ".join(f'"{c}"' for c in col_names)

    rows_written = 0
    offset = 0
    while True:
        batch = con.execute(
            f'SELECT {col_list} FROM "{table}" LIMIT {BATCH_SIZE} OFFSET {offset}'
        ).fetchall()
        if not batch:
            break
        ch.insert(f"`{db}`.`{table}`", batch, column_names=col_names)
        rows_written += len(batch)
        offset += len(batch)
        if rows_written % 10000 == 0:
            log.info("    … %d / %d rows", rows_written, total)

    return rows_written


def main() -> int:
    try:
        import duckdb
    except ImportError:
        log.error("duckdb not installed — run: pip install duckdb")
        return 1

    try:
        import clickhouse_connect
    except ImportError:
        log.error("clickhouse-connect not installed — run: pip install clickhouse-connect")
        return 1

    if not Path(DUCKDB_PATH).exists():
        log.error("DuckDB file not found: %s", DUCKDB_PATH)
        return 1

    log.info("Connecting to DuckDB: %s", DUCKDB_PATH)
    duck = duckdb.connect(DUCKDB_PATH, read_only=True)

    log.info("Connecting to ClickHouse: %s:%d as %s", CH_HOST, CH_HTTP_PORT, CH_USER)
    ch = clickhouse_connect.get_client(
        host=CH_HOST,
        port=CH_HTTP_PORT,
        username=CH_USER,
        password=CH_PASSWORD,
    )
    log.info("ClickHouse version: %s", ch.server_version)

    # Ensure databases exist
    for db in (CH_STAGING_DB, CH_SERVING_DB):
        ch.command(f"CREATE DATABASE IF NOT EXISTS `{db}`")
        log.info("Database ready: %s", db)

    # Enumerate all tables in main schema
    all_tables = duck.execute(
        "SELECT table_name FROM duckdb_tables() WHERE schema_name='main' ORDER BY table_name"
    ).fetchall()
    all_tables = [r[0] for r in all_tables]

    log.info("Found %d tables in DuckDB main schema", len(all_tables))

    staging_tables = [t for t in all_tables if t.startswith("ds_")]
    serving_tables = [t for t in all_tables if t.startswith("sv_")]
    other_tables   = [t for t in all_tables if not t.startswith("ds_") and not t.startswith("sv_")]

    if other_tables:
        log.warning("Skipping unrecognised tables: %s", other_tables)

    total_rows = 0
    errors = []

    log.info("\n── Migrating STAGING tables → %s ──────────────────────", CH_STAGING_DB)
    for table in staging_tables:
        try:
            n = migrate_table(duck, ch, table, CH_STAGING_DB)
            total_rows += n
            log.info("  %-45s  → %-20s  (%d rows)", table, CH_STAGING_DB, n)
        except Exception as exc:
            log.error("  FAILED %-40s: %s", table, exc)
            errors.append((table, str(exc)))

    log.info("\n── Migrating SERVING tables → %s ───────────────────────", CH_SERVING_DB)
    for table in serving_tables:
        try:
            n = migrate_table(duck, ch, table, CH_SERVING_DB)
            total_rows += n
            log.info("  %-45s  → %-20s  (%d rows)", table, CH_SERVING_DB, n)
        except Exception as exc:
            log.error("  FAILED %-40s: %s", table, exc)
            errors.append((table, str(exc)))

    duck.close()

    log.info("\n══ Migration complete ══")
    log.info("  Total rows written : %d", total_rows)
    log.info("  Tables migrated    : %d / %d", len(staging_tables + serving_tables) - len(errors), len(staging_tables + serving_tables))
    if errors:
        log.error("  Failures:")
        for t, e in errors:
            log.error("    %s: %s", t, e)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
