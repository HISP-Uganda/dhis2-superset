#!/usr/bin/env python
"""Repair script: fix broken dataset SQL and chart datasource links.

Run from the repo root inside a flask shell:
    flask shell < scripts/repair_dataset_chart_links.py

Or as a standalone script with the Superset app context:
    FLASK_APP=superset python scripts/repair_dataset_chart_links.py
"""
from __future__ import annotations

import json
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run() -> None:
    from superset import db
    from superset.connectors.sqla.models import SqlaTable
    from superset.models.slice import Slice
    from superset.models.dashboard import Dashboard

    # ------------------------------------------------------------------
    # 1. Find the main DHIS2 serving SqlaTable (MAL - MALARIA CASE
    #    MANAGEMENT or any dataset whose SQL was corrupted with a mart
    #    suffix like `_map_l5`, `_kpi`, etc.)
    # ------------------------------------------------------------------
    serving_datasets = (
        db.session.query(SqlaTable)
        .filter(SqlaTable.extra.like('%"dhis2_staged_local": true%'))
        .all()
    )
    # Also try without space
    if not serving_datasets:
        serving_datasets = (
            db.session.query(SqlaTable)
            .filter(SqlaTable.extra.like('%"dhis2_staged_local":true%'))
            .all()
        )

    logger.info("Found %d DHIS2 serving SqlaTables", len(serving_datasets))

    repaired_main_ids: set[int] = set()

    for ds in serving_datasets:
        try:
            extra = json.loads(ds.extra or "{}")
        except (json.JSONDecodeError, TypeError):
            extra = {}

        staged_dataset_id = extra.get("dhis2_staged_dataset_id")
        serving_table_ref = extra.get("dhis2_serving_table_ref") or ""

        # Detect corrupted SQL: the real serving table ref ends immediately
        # after the closing backtick of the table name, i.e. it has no suffix.
        # Mart refs look like `...`_kpi or `...`_map_l1 etc.
        import re
        corrupt_marker = re.compile(r"`[^`]+`[_a-zA-Z0-9]+$")

        current_sql = ds.sql or ""
        is_corrupted = bool(corrupt_marker.search(current_sql))

        if serving_table_ref and is_corrupted:
            # The extra JSON still has the canonical serving_table_ref;
            # the SQL was overwritten by a mart registration.  Restore it.
            correct_sql = f"SELECT * FROM {serving_table_ref}"
            logger.info(
                "Repairing SqlaTable id=%d name='%s': SQL was '%s', "
                "restoring to '%s'",
                ds.id,
                ds.table_name,
                current_sql.strip(),
                correct_sql.strip(),
            )
            ds.sql = correct_sql
            repaired_main_ids.add(ds.id)
        elif serving_table_ref and not is_corrupted:
            logger.info(
                "SqlaTable id=%d name='%s' SQL looks correct ('%s')",
                ds.id,
                ds.table_name,
                current_sql.strip(),
            )

    # ------------------------------------------------------------------
    # 2. Fix charts with NULL or missing datasource_id (they reference a
    #    dataset that was deleted or never committed).  Re-link them to the
    #    main serving dataset that has the matching staged_dataset_id.
    # ------------------------------------------------------------------
    broken_charts = (
        db.session.query(Slice)
        .filter(Slice.datasource_id.is_(None))
        .all()
    )
    logger.info("Found %d charts with NULL datasource_id", len(broken_charts))

    # Build a lookup: staged_dataset_id → SqlaTable id (main only, not marts)
    main_ds_by_staged_id: dict[int, SqlaTable] = {}
    for ds in serving_datasets:
        try:
            extra = json.loads(ds.extra or "{}")
        except Exception:
            continue
        sid = extra.get("dhis2_staged_dataset_id")
        # Prefer the non-mart dataset (table_name doesn't start with [KPI]/[Map])
        if sid is not None and not ds.table_name.startswith("["):
            main_ds_by_staged_id[sid] = ds

    if not main_ds_by_staged_id and serving_datasets:
        # Fallback: use any serving dataset
        for ds in serving_datasets:
            try:
                extra = json.loads(ds.extra or "{}")
                sid = extra.get("dhis2_staged_dataset_id")
                if sid is not None:
                    main_ds_by_staged_id.setdefault(sid, ds)
            except Exception:
                pass

    for chart in broken_charts:
        # Try to find the right dataset by inspecting the chart's params
        params: dict = {}
        try:
            params = json.loads(chart.params or "{}")
        except (json.JSONDecodeError, TypeError):
            pass

        datasource_str = params.get("datasource") or ""  # e.g. "8__table"
        target_ds = None

        if main_ds_by_staged_id:
            # For now take the first (and likely only) main serving dataset
            target_ds = next(iter(main_ds_by_staged_id.values()))

        if target_ds is None:
            logger.warning(
                "Chart id=%d '%s': no main serving dataset found, skipping",
                chart.id,
                chart.slice_name,
            )
            continue

        logger.info(
            "Re-linking chart id=%d '%s': datasource '%s' → '%d__table' (SqlaTable '%s')",
            chart.id,
            chart.slice_name,
            datasource_str,
            target_ds.id,
            target_ds.table_name,
        )
        chart.datasource_id = target_ds.id
        chart.datasource_type = "table"

        # Patch the params JSON so the frontend reflects the new datasource
        params["datasource"] = f"{target_ds.id}__table"
        chart.params = json.dumps(params)

    # ------------------------------------------------------------------
    # 3. Ensure the published dashboard has an embedded configuration so
    #    the public portal can serve it via guest token.
    # ------------------------------------------------------------------
    from superset.models.embedded_dashboard import EmbeddedDashboard

    published_dashboards = (
        db.session.query(Dashboard)
        .filter(Dashboard.published == True)
        .all()
    )
    for dash in published_dashboards:
        if not dash.embedded:
            import uuid as _uuid
            embed = EmbeddedDashboard(
                dashboard_id=dash.id,
                uuid=_uuid.uuid4(),
                allowed_domains=[],
            )
            db.session.add(embed)
            logger.info(
                "Created embedded config for dashboard id=%d '%s'",
                dash.id,
                dash.dashboard_title,
            )
        else:
            logger.info(
                "Dashboard id=%d '%s' already has embedded config (uuid=%s)",
                dash.id,
                dash.dashboard_title,
                dash.embedded[0].uuid,
            )

    db.session.commit()
    logger.info("Repair complete.")


if __name__ == "__main__":
    # When run as a standalone script, create the Flask app context first.
    try:
        from superset import create_app
        app = create_app()
        with app.app_context():
            run()
    except Exception as exc:
        logger.exception("Repair failed: %s", exc)
        sys.exit(1)
else:
    # When run inside `flask shell`, just call run() directly.
    run()
