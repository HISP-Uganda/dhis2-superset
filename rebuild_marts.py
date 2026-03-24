"""
Rebuild KPI and Map mart tables for a staged dataset.

Reads from the existing main serving table — does NOT touch staging data or
re-run a full sync.  Run from the repo root:

    python rebuild_marts.py [staged_dataset_id]

Defaults to staged_dataset_id=1 if not provided.
"""

import sys
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("rebuild_marts")

staged_dataset_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1

from superset.app import create_app  # noqa: E402

app = create_app()
with app.app_context():
    from superset.dhis2.models import DHIS2StagedDataset
    from superset.dhis2.analytical_serving import build_serving_manifest
    from superset.dhis2.clickhouse_build_service import _build_specialized_marts
    from superset.local_staging.engine_factory import get_active_staging_engine
    from superset import db

    dataset = db.session.query(DHIS2StagedDataset).filter_by(id=staged_dataset_id).first()
    if dataset is None:
        logger.error("No staged dataset with id=%s", staged_dataset_id)
        sys.exit(1)

    logger.info("Dataset: id=%s name=%s", dataset.id, dataset.name)

    engine = get_active_staging_engine(dataset.database_id)
    if engine is None:
        logger.error("No active staging engine for database_id=%s", dataset.database_id)
        sys.exit(1)

    # Derive serving table name (must match what the sync service uses)
    serving_name = engine.get_serving_table_name(dataset)
    logger.info("Serving table name: %s", serving_name)

    # Check serving table exists
    if not engine.serving_table_exists(dataset):
        logger.error(
            "Main serving table '%s' does not exist in ClickHouse — run a full sync first",
            serving_name,
        )
        sys.exit(1)

    logger.info("Main serving table exists — building manifest...")
    manifest = build_serving_manifest(dataset)

    logger.info("Building specialized marts...")
    built = _build_specialized_marts(dataset, engine, serving_name, manifest)

    if built:
        logger.info("Built %d mart(s): %s", len(built), built)
    else:
        logger.warning("No marts were built (no indicator columns or all marts failed)")

    # Update Superset dataset metadata so columns are visible in Explore
    logger.info("Refreshing Superset dataset metadata for all marts...")
    from superset.daos.dataset import DatasetDAO
    from superset.connectors.sqla.models import SqlaTable
    from superset import db as _db

    mart_tables = _db.session.query(SqlaTable).filter(
        SqlaTable.table_name.in_(built)
    ).all() if built else []

    refreshed = 0
    for sqla_table in mart_tables:
        try:
            sqla_table.fetch_metadata()
            _db.session.commit()
            refreshed += 1
            logger.info("Refreshed metadata for %s", sqla_table.table_name)
        except Exception as exc:
            logger.warning("Could not refresh metadata for %s: %s", sqla_table.table_name, exc)

    logger.info("Done. Built %d marts, refreshed %d Superset datasets.", len(built), refreshed)
