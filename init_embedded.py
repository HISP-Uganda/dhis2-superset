"""Manually initialize embedded dashboards

This utility scans all published dashboards and ensures each has an
associated embedded configuration. Run this once after migrations:

    superset fab create-admin  # if needed
    superset db upgrade
    superset init
    python init_embedded.py
"""
import logging

from superset import create_app

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    app = create_app()

    with app.app_context():
        from superset.models.dashboard import Dashboard
        from superset.daos.dashboard import EmbeddedDashboardDAO
        from superset.extensions import db

        try:
            # Only consider published dashboards to avoid noise during development
            all_dashboards = db.session.query(Dashboard).filter(
                Dashboard.published.is_(True),
            ).all()
            logger.info("Found %d published dashboards", len(all_dashboards))

            for dash in all_dashboards:
                logger.info(
                    "Processing dashboard: %s (ID: %s)",
                    dash.dashboard_title,
                    dash.id,
                )
                logger.info("  Current embedded status: %s", bool(dash.embedded))

                if not dash.embedded:
                    embedded = EmbeddedDashboardDAO.upsert(dash, [])
                    logger.info(
                        "  + Created embedded config with UUID: %s", embedded.uuid
                    )
                else:
                    logger.info(
                        "  - Existing embedded config UUID: %s",
                        dash.embedded[0].uuid,
                    )

            db.session.commit()
            logger.info("Successfully initialized embedded dashboards")

        except Exception as exc:  # pylint: disable=broad-except
            logger.error(
                "Failed to initialize embedded dashboards: %s", exc, exc_info=True
            )
            db.session.rollback()


if __name__ == "__main__":
    main()
