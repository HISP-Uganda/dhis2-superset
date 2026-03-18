# Superset specific config
import os
from datetime import timedelta
from celery.schedules import crontab

# ============================================================================
# TIMEOUT CONFIGURATION FOR DHIS2
# ============================================================================
# Increase timeouts for DHIS2 data loading which can take longer than default
SUPERSET_WEBSERVER_TIMEOUT = int(timedelta(minutes=5).total_seconds())  # 5 minutes (was 1 min)
SQLLAB_TIMEOUT = int(timedelta(minutes=5).total_seconds())  # 5 minutes (was 30 sec)
SQLLAB_ASYNC_TIME_LIMIT_SEC = int(timedelta(hours=6).total_seconds())  # Keep 6 hours for async

# The SQLAlchemy connection string to your database backend
# This connection defines the path to the database that stores your
# superset metadata (slices, connections, tables, dashboards, ...).
# Note that the connection information to connect to the datasources
# you want to explore are managed directly in the web UI
_METADATA_DB_PATH = os.path.join(os.path.dirname(__file__), "superset.db")
SQLALCHEMY_DATABASE_URI = (
    f"sqlite:///{_METADATA_DB_PATH}?check_same_thread=false&timeout=60"
)
SQLALCHEMY_ENGINE_OPTIONS = {
    "connect_args": {
        "check_same_thread": False,
        "timeout": 60,
    },
}

# Flask-WTF flag for CSRF
WTF_CSRF_ENABLED = True

# Add endpoints that need to be exempt from CSRF protection
WTF_CSRF_EXEMPT_LIST = [
    'superset.views.core.log',
    'superset.charts.api.data',
    'superset.charts.api.get',
]

# Set this API key to enable Mapbox visualizations
MAPBOX_API_KEY = os.environ.get('MAPBOX_API_KEY', '')

# Secret key for signing cookies.
# Reads SECRET_KEY first (Celery workers need this exact name), then falls back to
# SUPERSET_SECRET_KEY (the name used by the base config), then the hardcoded value.
# Production: set SECRET_KEY in /etc/superset/superset.env — do NOT rely on this fallback.
SECRET_KEY = (
    os.environ.get("SECRET_KEY")
    or os.environ.get("SUPERSET_SECRET_KEY")
    or "222nevYrQia2O5NAfpkFgaD9g7loFW2gqpW6C+lh1t/mj77t8kRQpHwG"
)

# Keep backend startup stable by default; enable debug explicitly when needed.
DEBUG = os.environ.get("SUPERSET_DEBUG", "0") == "1"
WEBPACK_DEV_SERVER_URL = "http://localhost:9001"

# Enable embedding dashboards (for /superset/public/)
EMBEDDED_SUPERSET = True
ENABLE_CORS = True
CORS_OPTIONS = {
    'supports_credentials': True,
    'allow_headers': ['*'],
    'resources': ['*'],
    'origins': ['*']
}

# Enable public role
PUBLIC_ROLE_LIKE = 'Gamma'

# Feature flags
FEATURE_FLAGS = {
    "EMBEDDED_SUPERSET": True,
    "EMBEDDABLE_CHARTS": True,
    "DASHBOARD_RBAC": True,
    "DASHBOARD_NATIVE_FILTERS": True,
    "ENABLE_TEMPLATE_PROCESSING": True,
    # Enable drill-down interactions on charts and dashboards.
    # DrillBy lets users pivot on a different dimension from the context menu.
    # DrillToDetail opens a row-level data modal for any data point.
    "DrillBy": True,
    "DrillToDetail": True,
}

# Guest token configuration for embedded dashboards
GUEST_TOKEN_JWT_SECRET = "cef445fa9e830a1e8f7cfbdd160f5ea01950483c1648aa4a3f30aad1478d4cd1"
GUEST_TOKEN_JWT_ALGO = "HS256"
GUEST_TOKEN_HEADER_NAME = "X-GuestToken"
GUEST_TOKEN_JWT_EXP_SECONDS = 86400  # 24 hours (was 5 minutes)

# Base URL configuration for embedded dashboards
WEBDRIVER_BASEURL = "http://localhost:8088/"
WEBDRIVER_BASEURL_USER_FRIENDLY = "http://localhost:8088/"

# Enable public access
FAB_ADD_SECURITY_VIEWS = True
AUTH_TYPE = 1  # AUTH_DB
AUTH_ROLE_PUBLIC = 'Public'
PUBLIC_DASHBOARD_ENTRY_ENABLED = True

# Auto-initialize embedded dashboards for all published dashboards
# NOTE: Disabled during initial setup to allow migrations to run first
# Uncomment after database is initialized:
# try:
#     from superset.init_public_dashboards import init_public_dashboards
#     FLASK_APP_MUTATOR = init_public_dashboards
# except ImportError as e:
#     import logging
#     logging.warning(f"Failed to import init_public_dashboards: {e}")
#     pass  # init_public_dashboards.py not found

# ============================================================================
# CONTENT SECURITY POLICY (CSP) FOR DHIS2 MAPS
# ============================================================================
# Override Talisman CSP to allow map tile providers for DHIS2 Map visualization
# This fixes the "blocked resources" issue when loading map tiles

TALISMAN_ENABLED = True

# CSP configuration for both production and development
# This must be defined for BOTH TALISMAN_CONFIG and TALISMAN_DEV_CONFIG
# because Superset uses TALISMAN_DEV_CONFIG when FLASK_DEBUG=true
_CSP_CONFIG = {
    "content_security_policy": {
        "base-uri": ["'self'"],
        "default-src": ["'self'"],
        "img-src": [
            "'self'",
            "blob:",
            "data:",
            # Map tile providers - all subdomains
            "https://a.basemaps.cartocdn.com",
            "https://b.basemaps.cartocdn.com",
            "https://c.basemaps.cartocdn.com",
            "https://tile.openstreetmap.org",
            "https://a.tile.openstreetmap.org",
            "https://b.tile.openstreetmap.org",
            "https://c.tile.openstreetmap.org",
            "https://tile.opentopomap.org",
            "https://a.tile.opentopomap.org",
            "https://b.tile.opentopomap.org",
            "https://c.tile.opentopomap.org",
            "https://server.arcgisonline.com",
            # Superset defaults
            "https://apachesuperset.gateway.scarf.sh",
            "https://static.scarf.sh/",
            "https://cdn.document360.io",
        ],
        "worker-src": ["'self'", "blob:"],
        "connect-src": [
            "'self'",
            # Webpack dev server WebSocket
            "ws://localhost:8081",
            "ws://localhost:8088",
            "ws://localhost:9000",
            # Map tile providers
            "https://a.basemaps.cartocdn.com",
            "https://b.basemaps.cartocdn.com",
            "https://c.basemaps.cartocdn.com",
            "https://tile.openstreetmap.org",
            "https://a.tile.openstreetmap.org",
            "https://b.tile.openstreetmap.org",
            "https://c.tile.openstreetmap.org",
            "https://tile.opentopomap.org",
            "https://a.tile.opentopomap.org",
            "https://b.tile.opentopomap.org",
            "https://c.tile.opentopomap.org",
            "https://server.arcgisonline.com",
            # Mapbox (if needed)
            "https://api.mapbox.com",
            "https://events.mapbox.com",
            # Leaflet CDN (for marker icons fallback)
            "https://unpkg.com",
        ],
        "object-src": "'none'",
        "style-src": [
            "'self'",
            "'unsafe-inline'",  # Required for inline styles in map components
        ],
        "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],  # Required for Superset
    },
    "content_security_policy_nonce_in": ["script-src"],
    "force_https": False,
    "session_cookie_secure": False,
}

# Use same CSP for both production and development
TALISMAN_CONFIG = _CSP_CONFIG
TALISMAN_DEV_CONFIG = _CSP_CONFIG

# ============================================================================
# PUBLIC PAGE CONFIGURATION
# ============================================================================
# Configure the look and feel of the public landing page at /superset/public/
# This allows you to customize navbar, sidebar, footer, and overall branding.

PUBLIC_PAGE_CONFIG = {
    # Navbar Configuration
    "navbar": {
        "enabled": True,
        "height": 60,  # Height in pixels
        "backgroundColor": "#ffffff",
        "boxShadow": "0 2px 8px rgba(0, 0, 0, 0.1)",

        # Logo Configuration
        "logo": {
            "enabled": True,
            "src": None,  # Set to your logo path, e.g., "/static/assets/images/logo.png"
            "alt": "National Malaria Data Repository",
            "height": 40,  # Logo height in pixels
        },

        # Title Configuration
        "title": {
            "enabled": True,
            "text": "National Malaria Data Repository",  # Customize this to your organization name
            "fontSize": "18px",
            "fontWeight": 700,
            "color": "#1890ff",
        },

        # Login Button
        "loginButton": {
            "enabled": True,
            "text": "Login",
            "url": "/login/",
            "type": "primary",  # "primary" or "default"
        },

        # Custom Navigation Links (optional)
        "customLinks": [
            # Example: {"text": "Help", "url": "/help", "external": False},
            # Example: {"text": "Contact", "url": "mailto:support@example.com", "external": True},
        ],
    },

    # Sidebar Configuration
    "sidebar": {
        "enabled": True,  # Keep sidebar enabled
        "width": 280,  # Width in pixels
        "position": "left",  # Options: "left" or "right"
        "backgroundColor": "#ffffff",
        "borderStyle": "1px solid #f0f0f0",
        "title": "Categories",  # Sidebar header text
        "collapsibleOnMobile": True,  # Auto-collapse on mobile
        "mobileBreakpoint": 768,  # Collapse sidebar below this width (px)
    },

    # Content Area Configuration
    "content": {
        "backgroundColor": "#f5f5f5",
        "padding": "0",  # Keep at "0" for perfect embedded dashboard fit
        "showWelcomeMessage": True,  # Show message when no dashboard selected
        "welcomeTitle": "Welcome",
        "welcomeDescription": "Select a category from the sidebar to view dashboards.",
    },

    # Footer Configuration
    "footer": {
        "enabled": True,  # Set to True to show footer
        "height": 50,  # Footer height in pixels
        "backgroundColor": "#fafafa",
        "text": "© 2026 Your Organization",  # Customize footer text
        "textColor": "#666666",

        # Footer Links (optional)
        "links": [
            {"text": "Privacy Policy"},
            {"text": "Terms of Service"}, 
            # Example external link:
            # {"text": "Support", "url": "https://support.example.com", "external": True},
        ],
    },
}

# ============================================================================
# CUSTOMIZATION TIPS:
# ============================================================================
#
# 1. DISABLE FOOTER: Set footer.enabled = False
#
# 2. CHANGE SIDEBAR POSITION: Set sidebar.position = "right"
#
# 3. DISABLE SIDEBAR: Set sidebar.enabled = False
#
# 4. CUSTOM COLORS:
#    - Use hex colors: "#1890ff" or "#rgb"
#    - Use rgb/rgba: "rgb(24, 144, 255)" or "rgba(24, 144, 255, 0.8)"
#
# 5. CUSTOM LOGO:
#    - Place your logo in: superset/superset-frontend/src/assets/images/
#    - Set: navbar.logo.src = "/static/assets/images/your-logo.png"
#
# 6. PERFECT DASHBOARD FIT:
#    - Keep content.padding = "0"
#    - The embedded dashboard will automatically fill: 100vh - navbar - footer
#
# 7. MOBILE RESPONSIVE:
#    - Sidebar auto-collapses below mobileBreakpoint
#    - All sizing is responsive
#
# After changing this config, restart Superset:
#   ./restart.sh
#
# ============================================================================

# ============================================================================
# DHIS2 CACHE CONFIGURATION (OPTIONAL)
# ============================================================================
# Enable automatic cache warming for DHIS2 to improve performance
# This is especially important for slow DHIS2 servers
#
# NOTE: Redis caching is OPTIONAL. Superset will work fine without Redis.
# To enable Redis caching for 90%+ faster performance:
# 1. Install Redis: brew install redis (macOS) or apt-get install redis-server (Linux)
# 2. Start Redis: redis-server
# 3. Uncomment the configuration below
# 4. Restart Superset

# UNCOMMENT BELOW TO ENABLE REDIS CACHING:
# ============================================================================
CACHE_CONFIG = {
    'CACHE_TYPE': 'RedisCache',
    'CACHE_DEFAULT_TIMEOUT': 86400,  # 24 hours default
    'CACHE_KEY_PREFIX': 'superset_',
    'CACHE_REDIS_URL': 'redis://localhost:6379/0'
}

# Data cache configuration (used for DHIS2 responses)
DATA_CACHE_CONFIG = {
    'CACHE_TYPE': 'RedisCache',
    'CACHE_DEFAULT_TIMEOUT': 86400,  # 24 hours for DHIS2 data
    'CACHE_KEY_PREFIX': 'superset_data_',
    'CACHE_REDIS_URL': 'redis://localhost:6379/1'
}

# Celery configuration for background tasks
class CeleryConfig:
    broker_url = 'redis://localhost:6379/2'
    result_backend = 'redis://localhost:6379/2'
    task_serializer = 'json'
    accept_content = ['json']
    result_serializer = 'json'
    timezone = 'Africa/Kampala'  # UTC+3 — local time for Uganda deployments
    enable_utc = True

    # Task routing — route DHIS2 sync tasks to the 'dhis2' queue so the
    # worker can be targeted with -Q dhis2 independently if needed.
    task_routes = {
        'superset.tasks.dhis2_sync.*': {'queue': 'dhis2'},
        'superset.tasks.dhis2_cache.*': {'queue': 'dhis2'},
        'superset.tasks.dhis2_metadata.*': {'queue': 'dhis2'},
    }

    # Beat schedule — must use celery.schedules.crontab objects, not raw dicts.
    beat_schedule = {
        # Every 15 minutes: check which staged datasets are due for a sync
        # and dispatch individual sync_staged_dataset tasks for each one.
        'dhis2-sync-scheduled': {
            'task': 'superset.tasks.dhis2_sync.sync_all_scheduled_datasets',
            'schedule': crontab(minute='*/15'),
        },
        # Standard Superset report scheduler (required for alerts/reports).
        'reports.scheduler': {
            'task': 'reports.scheduler',
            'schedule': crontab(minute='*', hour='*'),
        },
        'reports.prune_log': {
            'task': 'reports.prune_log',
            'schedule': crontab(minute=0, hour=0),
        },
    }

CELERY_CONFIG = CeleryConfig

# Allow admins to create and manage custom themes via Settings → Themes.
# Admins can set a dark-mode default by clicking the moon icon on the theme list.
ENABLE_UI_THEME_ADMINISTRATION = True

# ============================================================================
# DARK THEME — softer dark navy palette
# ============================================================================
# The base config.py THEME_DARK uses `**THEME_DEFAULT, "algorithm": "dark"` which
# lets Ant Design's dark algorithm generate all background/text tokens from
# colorBgBase = #000000 (pure black).  Users find the result too harsh.
#
# Fix: override colorBgBase to a dark navy-grey (#111827).  The dark algorithm
# then derives all colorBg* tokens from that seed, producing softer surfaces
# (containers ≈ #1a2332, layout ≈ #111827) instead of near-black ones.
#
# All other design tokens (brand colors, fonts, border-radius) are inherited
# from THEME_DEFAULT via the spread in config.py — only the bg seed is changed.
THEME_DARK = {
    "algorithm": "dark",
    "token": {
        # ── Brand identity (same as light theme) ─────────────────────────────
        "colorPrimary": "#2893B3",
        "colorLink": "#2893B3",
        "colorError": "#e04355",
        "colorWarning": "#fcc700",
        "colorSuccess": "#5ac189",
        "colorInfo": "#66bcfe",
        # ── Typography ───────────────────────────────────────────────────────
        "fontFamily": "Inter, Helvetica, Arial",
        "fontFamilyCode": "'Fira Code', 'Courier New', monospace",
        "transitionTiming": 0.3,
        "brandIconMaxWidth": 37,
        "fontSizeXS": "8",
        "fontSizeXXL": "28",
        "fontWeightNormal": "400",
        "fontWeightLight": "300",
        "fontWeightStrong": "500",
        # ── Softer dark backgrounds ───────────────────────────────────────────
        # Ant Design's dark algorithm seeds ALL colorBg* tokens from colorBgBase.
        # Using dark navy (#111827) instead of pure black (#000000) shifts the
        # entire background palette ~12 lightness points softer.
        "colorBgBase": "#111827",
    },
}

# ============================================================================
# NOTES ON CACHE WARMING:
# ============================================================================
# 1. UPDATE DATABASE ID: Change database_id = 1 to your actual DHIS2 database ID
#    You can find this in Superset UI: Data > Databases > (your DHIS2 connection)
#
# 2. REDIS REQUIREMENT: This configuration requires Redis to be installed
#    Install: brew install redis (macOS) or apt-get install redis (Linux)
#    Start: redis-server
#
# 3. CELERY WORKERS: You need to run Celery workers for background tasks
#    Start worker: celery -A superset.tasks.celery_app worker --loglevel=info
#    Start beat: celery -A superset.tasks.celery_app beat --loglevel=info
#
# 4. CACHE SCHEDULE: The cache warms every 6 hours + daily at 5 AM
#    Adjust based on when your DHIS2 analytics run
#
# 5. FOR SLOW DHIS2 SERVERS: This is critical! Cache warming means:
#    - Users get instant responses (< 100ms) from cache
#    - DHIS2 server only queried during off-peak hours
#    - 95%+ reduction in direct DHIS2 hits
#
# ============================================================================
