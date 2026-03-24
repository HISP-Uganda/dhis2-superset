import os
import sys
import json
from superset.app import create_app

app = create_app()

def run_repair_script():
    with app.app_context():
        from superset.extensions import db
        from superset.connectors.sqla.models import SqlaTable
        from superset.models.slice import Slice
        from superset.models.dashboard import Dashboard
        
        print("--- AUDITING DATASETS ---")
        datasets = db.session.query(SqlaTable).all()
        for ds in datasets:
            if not ds.dataset_role:
                ds.dataset_role = 'SERVING_DATASET'
        
        db.session.commit()
        print(f"Set default dataset_role = SERVING_DATASET for {len(datasets)} datasets.")

        print("--- AUDITING CHARTS ---")
        charts = db.session.query(Slice).all()
        invalid_charts = []
        for chart in charts:
            ds = chart.datasource
            if ds and hasattr(ds, 'dataset_role') and ds.dataset_role == 'METADATA_UI_DATASET':
                invalid_charts.append((chart.id, chart.slice_name, ds.id, ds.table_name))
                
        if invalid_charts:
            print("FOUND CHARTS USING METADATA_UI_DATASET (Must be repaired manually):")
            for c in invalid_charts:
                print(f"Chart ID: {c[0]}, Name: '{c[1]}' -> Dataset ID: {c[2]}, Table: '{c[3]}'")
        else:
            print("No charts using METADATA_UI_DATASET found.")

        print("--- AUDITING DASHBOARDS ---")
        dashboards = db.session.query(Dashboard).all()
        invalid_dashboards = []
        for dash in dashboards:
            if dash.json_metadata:
                try:
                    meta = json.loads(dash.json_metadata)
                    native_filters = meta.get("native_filter_configuration", [])
                    has_invalid = False
                    for fltr in native_filters:
                        for target in fltr.get("targets", []):
                            ds_id = target.get("datasetId")
                            if ds_id:
                                ds = db.session.query(SqlaTable).get(ds_id)
                                if ds and ds.dataset_role == 'METADATA_UI_DATASET':
                                    has_invalid = True
                    if has_invalid:
                        invalid_dashboards.append((dash.id, dash.dashboard_title))
                except Exception as e:
                    pass
                    
        if invalid_dashboards:
            print("FOUND DASHBOARDS USING METADATA_UI_DATASET IN NATIVE FILTERS (Must be repaired manually):")
            for d in invalid_dashboards:
                print(f"Dashboard ID: {d[0]}, Title: '{d[1]}'")
        else:
            print("No dashboards using METADATA_UI_DATASET in native filters found.")

        print("--- REPAIR REPORT COMPLETE ---")

if __name__ == '__main__':
    run_repair_script()
