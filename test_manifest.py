from superset.app import create_app
app = create_app()
with app.app_context():
    from superset.dhis2.models import DHIS2StagedDataset
    from superset.dhis2.analytical_serving import build_serving_manifest
    from superset import db

    dataset = db.session.query(DHIS2StagedDataset).filter_by(id=4).first()
    if dataset:
        manifest = build_serving_manifest(dataset)
        for c in manifest["columns"]:
            if "dhis2_is_ou_hierarchy" in str(c.get("extra")):
                print(c["column_name"], c["extra"])
