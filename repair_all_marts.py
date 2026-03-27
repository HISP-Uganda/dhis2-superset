"""
Repair mart registration and dataset roles for ALL active staged datasets.

This script:
1. Iterates all DHIS2StagedDataset records that have a main serving table.
2. Builds the consolidated _mart table if it is missing.
3. Removes legacy [KPI] / [Map] Superset dataset records.
4. Registers / updates all Superset dataset records with the correct dataset_role:
   - Main dataset  → DHIS2_SOURCE_DATASET (management list only)
   - <dataset>     → MART_DATASET  (chart creation, same friendly name)
5. Backfills roles on any existing SqlaTable records that have the wrong role.
6. Prints a verification summary.

Usage (from repo root):
    python repair_all_marts.py [--dry-run] [--dataset-id=N]

Options:
    --dry-run       Show what would be done without writing to the DB.
    --dataset-id=N  Repair only the dataset with this ID.
"""

from __future__ import annotations

import argparse
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("repair_all_marts")

parser = argparse.ArgumentParser()
parser.add_argument("--dry-run", action="store_true")
parser.add_argument("--dataset-id", type=int, default=None)
args = parser.parse_args()

DRY_RUN = args.dry_run
TARGET_ID = args.dataset_id

if DRY_RUN:
    logger.info("DRY RUN — no changes will be committed.")

from superset.app import create_app  # noqa: E402

app = create_app()
with app.app_context():
    from superset import db
    from superset.dhis2.models import DHIS2StagedDataset, DHIS2DatasetVariable
    from superset.dhis2.analytical_serving import (
        build_serving_manifest,
        dataset_columns_payload,
    )
    from superset.dhis2.clickhouse_build_service import _build_specialized_marts
    from superset.dhis2.superset_dataset_service import (
        register_serving_table_as_superset_dataset,
        register_specialized_marts_as_superset_datasets,
        _cleanup_legacy_mart_datasets,
    )
    from superset.datasets.policy import DatasetRole
    from superset.connectors.sqla.models import SqlaTable
    from superset.local_staging.engine_factory import get_active_staging_engine

    # ── Step 0: backfill dataset_role on existing SqlaTable records ────────────
    logger.info("=== Step 0: Backfill existing SqlaTable dataset_role ===")

    all_dhis2_sqla = db.session.query(SqlaTable).filter(
        SqlaTable.extra.like('%"dhis2_staged_dataset_id":%')
    ).all()

    backfill_count = {"mart": 0, "source": 0, "skip": 0, "legacy_removed": 0}
    legacy_prefixes = ("[KPI] ", "[Map] ", "[Map L")
    for sqla in all_dhis2_sqla:
        name = sqla.table_name or ""
        if any(name.startswith(p) for p in legacy_prefixes):
            # Legacy [KPI]/[Map] record — mark for removal
            logger.info("  Schedule removal of legacy record: %s (id=%d)", name, sqla.id)
            if not DRY_RUN:
                db.session.delete(sqla)
            backfill_count["legacy_removed"] += 1
        elif sqla.dataset_role == DatasetRole.MART.value:
            # Already a mart — keep as-is
            backfill_count["skip"] += 1
        else:
            # Main / source record
            if sqla.dataset_role != DatasetRole.MART.value:
                logger.info("  Backfill MART: %s (id=%d was %s)", name, sqla.id, sqla.dataset_role)
                if not DRY_RUN:
                    sqla.dataset_role = DatasetRole.MART.value
                backfill_count["source"] += 1
            else:
                backfill_count["skip"] += 1

    if not DRY_RUN:
        db.session.commit()
    logger.info(
        "  Legacy removed: %d, mart-backfilled: %d, already-correct: %d",
        backfill_count["legacy_removed"], backfill_count["source"], backfill_count["skip"],
    )

    # ── Step 1: get target datasets ────────────────────────────────────────────
    logger.info("")
    logger.info("=== Step 1: Processing staged datasets ===")

    query = db.session.query(DHIS2StagedDataset).filter(
        DHIS2StagedDataset.is_active == True  # noqa: E712
    )
    if TARGET_ID is not None:
        query = query.filter(DHIS2StagedDataset.id == TARGET_ID)

    datasets = query.order_by(DHIS2StagedDataset.id).all()
    logger.info("Found %d active dataset(s) to process", len(datasets))

    summary: list[dict] = []

    for dataset in datasets:
        logger.info("")
        logger.info("--- Dataset id=%d: %s ---", dataset.id, dataset.name)

        engine = get_active_staging_engine(dataset.database_id)
        if engine is None:
            logger.warning("  No staging engine for database_id=%d — skipping", dataset.database_id)
            summary.append({"id": dataset.id, "name": dataset.name, "status": "no_engine"})
            continue

        if not engine.serving_table_exists(dataset):
            logger.warning("  Main serving table absent — skipping (run a full sync first)")
            summary.append({"id": dataset.id, "name": dataset.name, "status": "no_serving_table"})
            continue

        manifest = build_serving_manifest(dataset)
        serving_columns = dataset_columns_payload(manifest["columns"])
        serving_table_ref = engine.get_serving_sql_table_ref(dataset)
        serving_name = engine.get_serving_table_name(dataset)

        # Get serving database id
        if hasattr(engine, "get_or_create_superset_database"):
            _serving_db = engine.get_or_create_superset_database()
            serving_db_id = getattr(_serving_db, "id", None)
        else:
            serving_db_id = getattr(engine, "database_id", None)

        if serving_db_id is None:
            logger.warning("  Could not resolve serving database id — skipping")
            summary.append({"id": dataset.id, "name": dataset.name, "status": "no_serving_db"})
            continue

        instance_ids = list(dict.fromkeys(
            v.instance_id
            for v in db.session.query(DHIS2DatasetVariable)
                .filter_by(staged_dataset_id=dataset.id)
                .all()
            if v.instance_id is not None
        ))

        # Build _mart if missing
        mart_name = f"{serving_name}_mart"
        mart_exists = engine.named_table_exists_in_serving(mart_name) if hasattr(engine, "named_table_exists_in_serving") else True

        if not mart_exists:
            logger.info("  Consolidated mart missing — building %s...", mart_name)
            if not DRY_RUN:
                try:
                    built = _build_specialized_marts(dataset, engine, serving_name, manifest)
                    logger.info("  Built: %s", built)
                except Exception as exc:
                    logger.error("  Failed to build mart: %s", exc)
        else:
            logger.info("  Consolidated mart exists: %s", mart_name)

        # Register / repair Superset records
        if not DRY_RUN:
            try:
                register_serving_table_as_superset_dataset(
                    dataset_id=dataset.id,
                    dataset_name=dataset.name,
                    serving_table_ref=serving_table_ref,
                    serving_columns=serving_columns,
                    serving_database_id=serving_db_id,
                    source_database_id=dataset.database_id,
                    source_instance_ids=instance_ids,
                    # Register the main source record as MART
                    dataset_role=DatasetRole.MART.value,
                )
                register_specialized_marts_as_superset_datasets(
                    dataset_id=dataset.id,
                    dataset_name=dataset.name,
                    serving_table_ref=serving_table_ref,
                    serving_columns=serving_columns,
                    serving_database_id=serving_db_id,
                    source_database_id=dataset.database_id,
                    source_instance_ids=instance_ids,
                    engine=engine,
                    dataset=dataset,
                )
            except Exception as exc:
                logger.error("  Registration failed: %s", exc)
                summary.append({"id": dataset.id, "name": dataset.name, "status": f"registration_error: {exc}"})
                continue

        # Verify records
        records = db.session.query(SqlaTable).filter(
            SqlaTable.table_name == dataset.name
        ).all()
        rec_map = {r.table_name: r for r in records}

        mart_record = rec_map.get(dataset.name)
        if mart_record:
            logger.info(
                "  ✓ %s (id=%d role=%s)", mart_record.table_name, mart_record.id, mart_record.dataset_role,
            )
            # If there are multiple records with the same name, warn
            dupes = [r for r in records if r.id != mart_record.id]
            for d in dupes:
                logger.warning("  ⚠ Duplicate record: %s (id=%d role=%s)", d.table_name, d.id, d.dataset_role)

        all_present = mart_record is not None
        summary.append({
            "id": dataset.id,
            "name": dataset.name,
            "status": "ok" if all_present else "incomplete",
        })

    # ── Final summary ──────────────────────────────────────────────────────────
    logger.info("")
    logger.info("=== FINAL SUMMARY ===")
    ok = sum(1 for s in summary if s["status"] == "ok")
    incomplete = sum(1 for s in summary if s["status"] == "incomplete")
    errors = sum(1 for s in summary if s["status"] not in ("ok", "incomplete", "no_serving_table", "no_engine", "no_serving_db"))
    logger.info("Total datasets: %d", len(summary))
    logger.info("  OK (mart record present): %d", ok)
    logger.info("  Incomplete (missing):     %d", incomplete)
    logger.info("  Errors:                   %d", errors)
    logger.info("  Skipped (no engine/serving): %d", len(summary) - ok - incomplete - errors)
    if DRY_RUN:
        logger.info("")
        logger.info("DRY RUN — re-run without --dry-run to apply changes.")
