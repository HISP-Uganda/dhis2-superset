from superset.app import create_app
from superset import db
from superset.connectors.sqla.models import SqlaTable

app = create_app()
with app.app_context():
    tables = db.session.query(SqlaTable).filter(SqlaTable.dataset_role == "MART").all()
    for t in tables:
        print(t.table_name, t.database_id, t.schema)
