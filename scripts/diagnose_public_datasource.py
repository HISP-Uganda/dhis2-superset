"""
Diagnostic Script: Check Datasource Database Field in Public/Embedded Context

This script checks if the datasource.database field is properly populated
when accessed by the Public role (guest/embedded users).

Run this to diagnose the issue:
    cd /Users/edwinarinda/Projects/Redux/superset
    source venv/bin/activate
    python3 diagnose_public_datasource.py
"""
import logging

from superset import create_app

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    app = create_app()

    with app.app_context():
        from superset.extensions import db
        from superset.connectors.sqla.models import SqlaTable
        from superset.models.slice import Slice

        try:
            # Find all DHIS2 Map charts
            dhis2_charts = db.session.query(Slice).filter(
                Slice.viz_type == 'dhis2_map'
            ).all()

            if not dhis2_charts:
                logger.warning("No DHIS2 Map charts found!")
                return

            logger.info(f"Found {len(dhis2_charts)} DHIS2 Map chart(s)")

            for chart in dhis2_charts:
                logger.info(f"\n{'='*60}")
                logger.info(f"Chart: {chart.slice_name} (ID: {chart.id})")
                logger.info(f"Datasource ID: {chart.datasource_id}")
                logger.info(f"Datasource Type: {chart.datasource_type}")

                # Get the datasource
                datasource = chart.datasource
                if not datasource:
                    logger.error(f"  ❌ No datasource found for chart {chart.id}")
                    continue

                logger.info(f"  Datasource: {datasource.datasource_name} (ID: {datasource.id})")

                # Check if database is accessible
                if hasattr(datasource, 'database'):
                    database = datasource.database
                    if database:
                        logger.info(f"  ✅ Database found: {database.database_name} (ID: {database.id})")
                        logger.info(f"  Database backend: {database.backend}")
                    else:
                        logger.error(f"  ❌ datasource.database is None!")
                else:
                    logger.error(f"  ❌ datasource does not have 'database' attribute!")

                # Check datasource.data
                try:
                    datasource_data = datasource.data
                    if 'database' in datasource_data:
                        db_data = datasource_data['database']
                        if db_data and 'id' in db_data:
                            logger.info(f"  ✅ datasource.data['database']['id'] = {db_data['id']}")
                        else:
                            logger.error(f"  ❌ datasource.data['database'] is missing or has no 'id': {db_data}")
                    else:
                        logger.error(f"  ❌ datasource.data does not have 'database' key!")
                        logger.info(f"  Available keys: {list(datasource_data.keys())}")
                except Exception as e:
                    logger.error(f"  ❌ Error accessing datasource.data: {e}", exc_info=True)

                # Check data_for_slices
                try:
                    slices_data = datasource.data_for_slices([chart])
                    if 'database' in slices_data:
                        db_data = slices_data['database']
                        if db_data and 'id' in db_data:
                            logger.info(f"  ✅ data_for_slices()['database']['id'] = {db_data['id']}")
                        else:
                            logger.error(f"  ❌ data_for_slices()['database'] is missing or has no 'id': {db_data}")
                    else:
                        logger.error(f"  ❌ data_for_slices() does not have 'database' key!")
                        logger.info(f"  Available keys: {list(slices_data.keys())}")
                except Exception as e:
                    logger.error(f"  ❌ Error accessing data_for_slices: {e}", exc_info=True)

            logger.info(f"\n{'='*60}")
            logger.info("Diagnosis complete!")

        except Exception as exc:
            logger.error(f"❌ ERROR: {exc}", exc_info=True)


if __name__ == "__main__":
    main()
