"""
Rebuild the consolidated _mart table for a staged dataset.

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

    logger.info("Building consolidated _mart table...")
    built = _build_specialized_marts(dataset, engine, serving_name, manifest)

    if built:
        logger.info("Built %d mart(s): %s", len(built), built)
    else:
        logger.warning("No marts were built (no indicator columns or mart build failed)")

    # Register mart in Superset
    logger.info("Registering mart in Superset...")
    from superset.dhis2.analytical_serving import (
        dataset_columns_payload,
    )

    serving_table_ref = engine.get_serving_sql_table_ref(dataset)
    serving_columns = dataset_columns_payload(manifest["columns"])

    # Collect source instance IDs from dataset variables
    from superset.dhis2.models import DHIS2DatasetVariable as _DSVar
    _instance_ids = list(dict.fromkeys(
        v.instance_id
        for v in db.session.query(_DSVar)
            .filter_by(staged_dataset_id=dataset.id)
            .all()
        if v.instance_id is not None
    ))

    # For ClickHouse engines the staging engine's database_id
    # is the DHIS2 *source* database, not the serving database.
    if hasattr(engine, "get_or_create_superset_database"):
        _serving_db = engine.get_or_create_superset_database()
        serving_db_id = getattr(_serving_db, "id", None)
    else:
        serving_db_id = getattr(engine, "database_id", None)

    if serving_db_id is not None:
        from superset.dhis2.superset_dataset_service import (
            register_serving_table_as_superset_dataset,
            register_specialized_marts_as_superset_datasets,
        )
        from superset.datasets.policy import DatasetRole as _DatasetRole

        # Repair main dataset role (MART)
        logger.info("Ensuring main dataset has MART role...")
        register_serving_table_as_superset_dataset(
            dataset_id=dataset.id,
            dataset_name=dataset.name,
            serving_table_ref=serving_table_ref,
            serving_columns=serving_columns,
            serving_database_id=serving_db_id,
            source_database_id=dataset.database_id,
            source_instance_ids=_instance_ids,
            dataset_role=_DatasetRole.MART.value,
        )

        logger.info("Registering consolidated mart dataset (MART_DATASET role)...")
        register_specialized_marts_as_superset_datasets(
            dataset_id=dataset.id,
            dataset_name=dataset.name,
            serving_table_ref=serving_table_ref,
            serving_columns=serving_columns,
            serving_database_id=serving_db_id,
            source_database_id=dataset.database_id,
            source_instance_ids=_instance_ids,
            engine=engine,
            dataset=dataset,
        )

    # Update Superset dataset metadata so columns are visible in Explore
    logger.info("Refreshing Superset dataset metadata...")
    from superset.connectors.sqla.models import SqlaTable
    from superset import db as _db

    # Verify records for this dataset (main + mart share the same friendly name)
    target_names = [dataset.name]
    all_records = _db.session.query(SqlaTable).filter(
        SqlaTable.table_name.in_(target_names)
    ).all()

    refreshed = 0
    for sqla_table in all_records:
        try:
            sqla_table.fetch_metadata()
            _db.session.commit()
            refreshed += 1
            logger.info(
                "  ✓ %s (id=%d, role=%s)",
                sqla_table.table_name, sqla_table.id, sqla_table.dataset_role,
            )
        except Exception as exc:
            logger.warning(
                "  ✗ Could not refresh metadata for %s: %s",
                sqla_table.table_name, exc,
            )

    # Verification summary
    logger.info("")
    logger.info("=== Verification Summary ===")
    for name in target_names:
        rec = next((r for r in all_records if r.table_name == name), None)
        if rec:
            logger.info("  ✓ REGISTERED: %s (id=%d role=%s)", name, rec.id, rec.dataset_role)
        else:
            logger.warning("  ✗ MISSING:    %s", name)

    logger.info("")
    logger.info("Done. Built %d marts, refreshed %d Superset dataset records.", len(built), refreshed)
