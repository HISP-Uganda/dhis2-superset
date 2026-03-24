from superset.app import create_app
app = create_app()
with app.app_context():
    pass
print("done")
