from superset.app import create_app
app = create_app()
with app.app_context():
    from superset.dhis2.sync_service import DHIS2SyncService
