#!/bin/bash
# Force Superset to reload DHIS2 connection UI
# Clears cache and restarts to show form-based parameters interface

set -e

cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   DHIS2 Connection UI - Force Reload                      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}\n"

# Stop all processes
echo -e "${YELLOW}🛑 Stopping all Superset processes...${NC}"
pkill -9 -f "superset run" 2>/dev/null || true
pkill -9 -f "flask run" 2>/dev/null || true
lsof -ti:8088 | xargs kill -9 2>/dev/null || true
sleep 2
echo -e "${GREEN}✓ Stopped${NC}\n"

# Clear Python cache
echo -e "${YELLOW}🧹 Clearing Python cache...${NC}"
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
echo -e "${GREEN}✓ Python cache cleared${NC}\n"

# Clear Superset metadata cache
echo -e "${YELLOW}🧹 Clearing Superset metadata cache...${NC}"
if [ -d "superset_home/cache" ]; then
    rm -rf superset_home/cache/*
    echo -e "${GREEN}✓ Metadata cache cleared${NC}"
fi
echo ""

# Activate venv
if [ ! -d ".venv" ]; then
    echo -e "${RED}✗ Virtual environment not found!${NC}"
    exit 1
fi

source .venv/bin/activate
export SUPERSET_CONFIG_PATH="${PROJECT_DIR}/superset_config.py"
export FLASK_APP=superset

# Force database metadata refresh
echo -e "${YELLOW}🔄 Refreshing database metadata...${NC}"
python -c "
from superset import app, db
from superset.models.core import Database

with app.app_context():
    dhis2_dbs = db.session.query(Database).filter(
        Database.database_name.like('%DHIS2%')
    ).all()

    if dhis2_dbs:
        print(f'Found {len(dhis2_dbs)} DHIS2 database(s)')
        for database in dhis2_dbs:
            print(f'  - {database.database_name}')
            # Clear cache for this database
            if hasattr(database, 'get_cache_timeout'):
                database.get_cache_timeout()
    else:
        print('No DHIS2 databases found yet')
" 2>/dev/null || echo "  (Database not initialized yet - this is OK)"
echo ""

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   What Changed${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

echo -e "${GREEN}✅ Added: parameters_json_schema() method${NC}"
echo -e "   - Converts DHIS2ParametersSchema to OpenAPI format"
echo -e "   - Enables form-based UI in frontend\n"

echo -e "${GREEN}✅ Schema includes:${NC}"
echo -e "   - Server hostname"
echo -e "   - API path"
echo -e "   - Auth method (dropdown: basic/pat)"
echo -e "   - Username (for basic auth)"
echo -e "   - Password (encrypted, for basic auth)"
echo -e "   - Access Token (encrypted, for PAT)"
echo -e "   - Advanced: default_params, endpoint_params, timeout, page_size\n"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Start backend
echo -e "${GREEN}🚀 Starting Superset...${NC}"
echo -e "${YELLOW}   URL: http://localhost:8088${NC}"
echo -e "${YELLOW}   Press Ctrl+C to stop${NC}\n"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Testing Instructions${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}1. Open: http://localhost:8088${NC}\n"

echo -e "${YELLOW}2. Go to: Settings → Database Connections${NC}\n"

echo -e "${YELLOW}3. Click: + Database${NC}\n"

echo -e "${YELLOW}4. Select: DHIS2${NC}\n"

echo -e "${YELLOW}5. You should now see:${NC}"
echo -e "   ${GREEN}✓ Server field (text input)${NC}"
echo -e "   ${GREEN}✓ API Path field (text input, default: /api)${NC}"
echo -e "   ${GREEN}✓ Auth Method dropdown (basic/pat)${NC}"
echo -e "   ${GREEN}✓ Username field (if basic selected)${NC}"
echo -e "   ${GREEN}✓ Password field (if basic selected)${NC}"
echo -e "   ${GREEN}✓ Access Token field (if pat selected)${NC}"
echo -e "   ${GREEN}✓ Advanced options section${NC}\n"

echo -e "${YELLOW}6. If you still see SQLAlchemy URI field:${NC}"
echo -e "   - Clear browser cache (Ctrl+Shift+Delete)"
echo -e "   - Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)"
echo -e "   - Try incognito/private window\n"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}\n"

# Run in foreground
superset run -p 8088 --with-threads --reload --debugger

