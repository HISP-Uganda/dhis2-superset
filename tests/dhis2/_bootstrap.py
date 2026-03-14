"""
Lightweight Superset module isolation for DHIS2 unit tests.

The installed flask_sqlalchemy 2.5.1 is incompatible with SQLAlchemy 2.x,
which prevents importing any superset.* module in the normal way.
This bootstrap injects minimal stubs into sys.modules so that
superset.dhis2.models (and related modules) can be imported without
starting a Flask app.

Usage:
    import tests.dhis2._bootstrap  # noqa - must be first import in test file
    from superset.dhis2.models import DHIS2Instance, ...
"""

import sys
import types

_SUPERSET_SRC = "/Users/stephocay/projects/hispuganda/ss_latest/superset/superset"

def _setup():
    if "superset.dhis2.models" in sys.modules:
        return  # Already bootstrapped

    # --- superset package stub ---
    sup = sys.modules.get("superset") or types.ModuleType("superset")
    if not hasattr(sup, "__path__"):
        sup.__path__ = [_SUPERSET_SRC]
        sup.__package__ = "superset"
        sys.modules["superset"] = sup

    # --- flask_appbuilder stub ---
    if "flask_appbuilder" not in sys.modules:
        class _Model:
            """Minimal Model base that accepts SQLAlchemy-style keyword arguments."""
            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    object.__setattr__(self, k, v)

        class _BaseView:
            pass

        def _expose(*args, **kwargs):
            def decorator(func):
                return func
            return decorator

        def _has_access(func):
            return func

        fab = types.ModuleType("flask_appbuilder")
        fab.Model = _Model
        fab.BaseView = _BaseView
        fab.expose = _expose
        fab.has_access = _has_access
        sys.modules["flask_appbuilder"] = fab

    if "flask_appbuilder.api" not in sys.modules:
        api_mod = types.ModuleType("flask_appbuilder.api")

        class _BaseApi:
            def response(self, status, **payload):
                return {"status": status, **payload}

            def response_400(self, **payload):
                return self.response(400, **payload)

            def response_404(self, **payload):
                return self.response(404, **payload)

            def response_500(self, **payload):
                return self.response(500, **payload)

        def _safe(func):
            return func

        api_mod.BaseApi = _BaseApi
        api_mod.safe = _safe
        sys.modules["flask_appbuilder.api"] = api_mod

    if "flask_appbuilder.security.decorators" not in sys.modules:
        decorators_mod = types.ModuleType("flask_appbuilder.security.decorators")

        def _identity_decorator(*args, **kwargs):
            def decorator(func):
                return func

            return decorator

        decorators_mod.permission_name = _identity_decorator
        decorators_mod.protect = _identity_decorator
        sys.modules["flask_appbuilder.security.decorators"] = decorators_mod

    if "flask_appbuilder.security" not in sys.modules:
        security_mod = types.ModuleType("flask_appbuilder.security")
        security_mod.__path__ = []
        sys.modules["flask_appbuilder.security"] = security_mod

    if "flask_appbuilder.security.sqla" not in sys.modules:
        security_sqla_mod = types.ModuleType("flask_appbuilder.security.sqla")
        security_sqla_mod.__path__ = []
        sys.modules["flask_appbuilder.security.sqla"] = security_sqla_mod

    if "flask_appbuilder.security.sqla.models" not in sys.modules:
        security_models_mod = types.ModuleType("flask_appbuilder.security.sqla.models")

        class _User:
            pass

        class _Role:
            pass

        security_models_mod.User = _User
        security_models_mod.Role = _Role
        sys.modules["flask_appbuilder.security.sqla.models"] = security_models_mod

    # --- superset.extensions stub ---
    if "superset.extensions" not in sys.modules:
        class _Factory:
            def create(self, t):
                return t
        ext = types.ModuleType("superset.extensions")
        ext.encrypted_field_factory = _Factory()
        sys.modules["superset.extensions"] = ext
        sup.extensions = ext

    # --- superset.security_manager stub ---
    if not hasattr(sup, "security_manager"):
        class _UserModel:
            pass

        sec_mgr = types.SimpleNamespace(user_model=_UserModel)
        sup.security_manager = sec_mgr

    # --- superset.dhis2 package stub ---
    if "superset.dhis2" not in sys.modules:
        dhis2_pkg = types.ModuleType("superset.dhis2")
        dhis2_pkg.__path__ = [f"{_SUPERSET_SRC}/dhis2"]
        dhis2_pkg.__package__ = "superset.dhis2"
        sys.modules["superset.dhis2"] = dhis2_pkg
        sup.dhis2 = dhis2_pkg

    # --- superset.db stub (for service modules) ---
    db_stub = types.ModuleType("_db_stub")
    db_stub.session = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
    db_stub.engine = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
    if not hasattr(sup, "db"):
        sup.db = db_stub
    if not hasattr(sup, "is_feature_enabled"):
        sup.is_feature_enabled = lambda *args, **kwargs: False

    # --- superset.models and superset.db_engine_specs stubs ---
    # Needed when service modules do local imports like `from superset.models.core import Database`
    if "superset.models" not in sys.modules:
        models_pkg = types.ModuleType("superset.models")
        models_pkg.__path__ = [f"{_SUPERSET_SRC}/models"]
        models_pkg.__package__ = "superset.models"
        sys.modules["superset.models"] = models_pkg

    if "superset.models.core" not in sys.modules:
        class _FakeDatabase:
            """Stub for superset.models.core.Database used in migration tests."""
            def __init__(self, **kw):
                self.__dict__.update(kw)
            def get_encrypted_extra(self):
                return {}
        core_mod = types.ModuleType("superset.models.core")
        core_mod.Database = _FakeDatabase
        sys.modules["superset.models.core"] = core_mod

    if "superset.db_engine_specs" not in sys.modules:
        dbs_mod = types.ModuleType("superset.db_engine_specs")
        dbs_mod.__path__ = [f"{_SUPERSET_SRC}/db_engine_specs"]
        dbs_mod.__package__ = "superset.db_engine_specs"
        dbs_mod.BaseEngineSpec = type("BaseEngineSpec", (), {})
        sys.modules["superset.db_engine_specs"] = dbs_mod

    if "superset.utils" not in sys.modules:
        utils_mod = types.ModuleType("superset.utils")
        utils_mod.__path__ = [f"{_SUPERSET_SRC}/utils"]
        sys.modules["superset.utils"] = utils_mod

    if "superset.views" not in sys.modules:
        views_pkg = types.ModuleType("superset.views")
        views_pkg.__path__ = [f"{_SUPERSET_SRC}/views"]
        sys.modules["superset.views"] = views_pkg

    if "superset.views.base" not in sys.modules:
        base_views_mod = types.ModuleType("superset.views.base")

        class _BaseSupersetView(sys.modules["flask_appbuilder"].BaseView):
            def render_app_template(self, *args, **kwargs):
                return None

        base_views_mod.BaseSupersetView = _BaseSupersetView
        base_views_mod.get_spa_template_context = lambda *args, **kwargs: {}
        sys.modules["superset.views.base"] = base_views_mod

_setup()
