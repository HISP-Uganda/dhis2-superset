#!/usr/bin/env python3
"""Rebuild staged DHIS2 analytical serving tables against the live app config.

Usage examples:

    env SUPERSET_CONFIG_PATH=./superset_config.py FLASK_APP=superset \
      ./venv/bin/python scripts/repair_dhis2_serving_tables.py --database-id 2

    env SUPERSET_CONFIG_PATH=./superset_config.py FLASK_APP=superset \
      ./venv/bin/python scripts/repair_dhis2_serving_tables.py --dataset-id 4 --refresh-metadata
"""

from __future__ import annotations

import argparse
import json
from typing import Any

from superset.app import create_app


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild local DHIS2 serving tables for staged datasets.",
    )
    parser.add_argument(
        "--database-id",
        type=int,
        help="Limit the repair to staged datasets owned by this DHIS2 database.",
    )
    parser.add_argument(
        "--dataset-id",
        action="append",
        dest="dataset_ids",
        type=int,
        default=[],
        help="Repair only the specified staged dataset id. May be passed multiple times.",
    )
    parser.add_argument(
        "--refresh-metadata",
        action="store_true",
        help="Refresh staged organisation-unit metadata for the target database(s) before rebuilding.",
    )
    parser.add_argument(
        "--sync-data",
        action="store_true",
        help="Run an immediate staged-data refresh for each target dataset before rebuilding the serving table.",
    )
    return parser.parse_args()


def _repair() -> list[dict[str, Any]]:
    args = _parse_args()
    app = create_app()

    with app.app_context():
        from superset import db
        from superset.dhis2.metadata_staging_service import refresh_database_metadata
        from superset.dhis2.models import DHIS2StagedDataset
        from superset.dhis2.staged_dataset_service import ensure_serving_table
        from superset.dhis2.sync_service import DHIS2SyncService

        dataset_query = db.session.query(DHIS2StagedDataset)
        if args.dataset_ids:
            dataset_query = dataset_query.filter(
                DHIS2StagedDataset.id.in_(list(dict.fromkeys(args.dataset_ids)))
            )
        elif args.database_id is not None:
            dataset_query = dataset_query.filter(
                DHIS2StagedDataset.database_id == args.database_id
            )

        datasets = dataset_query.order_by(DHIS2StagedDataset.id.asc()).all()

        if args.refresh_metadata:
            database_ids = sorted(
                {
                    int(dataset.database_id)
                    for dataset in datasets
                    if getattr(dataset, "database_id", None) is not None
                }
            )
            if args.database_id is not None and args.database_id not in database_ids:
                database_ids.append(args.database_id)
                database_ids.sort()
            for database_id in database_ids:
                refresh_database_metadata(
                    database_id,
                    metadata_types=[
                        "organisationUnits",
                        "organisationUnitLevels",
                        "organisationUnitGroups",
                        "orgUnitHierarchy",
                    ],
                    reason="manual_serving_table_repair",
                )

        results: list[dict[str, Any]] = []
        sync_service = DHIS2SyncService() if args.sync_data else None
        for dataset in datasets:
            sync_result = None
            if sync_service is not None:
                sync_result = sync_service.sync_staged_dataset(dataset.id)
            serving_table_ref, columns = ensure_serving_table(dataset.id)
            results.append(
                {
                    "dataset_id": dataset.id,
                    "dataset_name": dataset.name,
                    "database_id": dataset.database_id,
                    "serving_table_ref": serving_table_ref,
                    "columns": [column.get("column_name") for column in columns],
                    "sync_result": sync_result,
                }
            )

        return results


def main() -> None:
    results = _repair()
    print(json.dumps({"repaired": results, "count": len(results)}, indent=2))


if __name__ == "__main__":
    main()
