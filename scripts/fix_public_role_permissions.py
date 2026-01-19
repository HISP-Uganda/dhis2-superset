"""
Fix Public Role Permissions for Embedded Dashboards

This script grants the Public role the necessary permissions to access
DHIS2 databases in embedded/public dashboards.

Run this script ONCE after Superset is initialized:
    cd /Users/edwinarinda/Projects/Redux/superset
    python3 fix_public_role_permissions.py

What this does:
1. Finds or creates the "Public" role
2. Grants "all_database_access" permission to Public role
3. Grants "all_datasource_access" permission to Public role
4. This allows guest users (embedded dashboards) to access all databases

Alternative: Instead of granting all_database_access, you can grant
specific database permissions for each DHIS2 database.
"""
import logging

from superset import create_app

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    app = create_app()

    with app.app_context():
        from superset.extensions import db
        from superset.security.manager import SupersetSecurityManager

        security_manager = app.appbuilder.sm

        try:
            # Get or create Public role
            public_role = security_manager.find_role("Public")
            if not public_role:
                logger.error("Public role not found! Creating it...")
                public_role = security_manager.add_role("Public")

            logger.info(f"Found Public role: {public_role.name} (ID: {public_role.id})")

            # Grant all_database_access permission
            logger.info("Granting 'all_database_access' permission to Public role...")
            security_manager.add_permission_role(
                public_role,
                security_manager.find_permission_view_menu(
                    "all_database_access", "all_database_access"
                )
            )

            # Grant all_datasource_access permission
            logger.info("Granting 'all_datasource_access' permission to Public role...")
            security_manager.add_permission_role(
                public_role,
                security_manager.find_permission_view_menu(
                    "all_datasource_access", "all_datasource_access"
                )
            )

            # Commit changes
            db.session.commit()

            logger.info("✅ SUCCESS! Public role now has database access permissions")
            logger.info("Guest users (embedded dashboards) can now access DHIS2 databases")

            # List current permissions
            logger.info("\nCurrent Public role permissions:")
            for perm in public_role.permissions:
                logger.info(f"  - {perm.permission.name} on {perm.view_menu.name}")

        except Exception as exc:
            logger.error(f"❌ ERROR: Failed to update Public role permissions: {exc}", exc_info=True)
            db.session.rollback()
            raise


if __name__ == "__main__":
    main()
