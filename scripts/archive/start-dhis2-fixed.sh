#!/bin/bash
# Start Superset Backend with DHIS2 Charting Fixes
# All fixes have been applied - ready for testing

set -e

cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Starting Superset with DHIS2 Charting Fixes Applied      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}\n"

# Kill any existing processes
echo -e "${YELLOW}🛑 Stopping any existing Superset processes...${NC}"
pkill -9 -f "superset run" 2>/dev/null || true
lsof -ti:8088 | xargs kill -9 2>/dev/null || true
sleep 2
echo -e "${GREEN}✓ Port 8088 cleared${NC}\n"

# Check venv
if [ ! -d ".venv" ]; then
    echo -e "${RED}✗ Virtual environment not found!${NC}"
    echo -e "${YELLOW}  Please run: ./setup-python311.sh${NC}"
    exit 1
fi

# Activate venv
echo -e "${YELLOW}🔧 Activating virtual environment...${NC}"
source .venv/bin/activate

# Verify Python version
PYTHON_VERSION=$(python --version)
echo -e "${GREEN}✓ Python: ${PYTHON_VERSION}${NC}"

# Set environment
export SUPERSET_CONFIG_PATH="${PROJECT_DIR}/superset_config.py"
export FLASK_APP=superset

echo -e "${GREEN}✓ Config: ${SUPERSET_CONFIG_PATH}${NC}\n"

# Display fixes applied
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   DHIS2 Charting Fixes Status${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"

echo -e "${GREEN}✅ WIDE FORMAT (Horizontal Data View)${NC}"
echo -e "   - dx dimensions as separate columns"
echo -e "   - Format: Period, OrgUnit, Malaria_Cases, TB_Cases, etc.\n"

echo -e "${GREEN}✅ DATETIME COLUMN NOT REQUIRED${NC}"
echo -e "   - requires_time_column = False"
echo -e "   - Period can be dimension or filter\n"

echo -e "${GREEN}✅ DATASET PREVIEW ENABLED${NC}"
echo -e "   - supports_dynamic_schema = True"
echo -e "   - All datasets show preview\n"

echo -e "${GREEN}✅ FLEXIBLE CHARTING${NC}"
echo -e "   - GENERIC_CHART_AXES = True"
echo -e "   - Non-time-series charts supported\n"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"

# Check database
if [ ! -f "superset_home/superset.db" ]; then
    echo -e "${YELLOW}⚠️  Database not found. Initializing...${NC}"
    superset db upgrade
    superset init
    echo -e "${YELLOW}Creating admin user:${NC}"
    superset fab create-admin
    echo ""
fi

# Start backend
echo -e "${GREEN}🚀 Starting Superset backend on http://localhost:8088${NC}"
echo -e "${YELLOW}   Logs: superset_backend.log${NC}"
echo -e "${YELLOW}   Press Ctrl+C to stop${NC}\n"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Quick Testing Guide${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}1. Access Superset:${NC}"
echo -e "   Open: ${GREEN}http://localhost:8088${NC}\n"

echo -e "${YELLOW}2. Verify WIDE Format:${NC}"
echo -e "   a) Go to: Data → Datasets"
echo -e "   b) Select DHIS2 dataset → Edit → Columns tab"
echo -e "   c) Expected: Period, OrgUnit, + data element columns\n"

echo -e "${YELLOW}3. Create Test Chart:${NC}"
echo -e "   a) Charts → Create new chart"
echo -e "   b) Type: Bar Chart (not Time-series)"
echo -e "   c) X-Axis: OrgUnit"
echo -e "   d) Metrics: SUM(data_element_column)"
echo -e "   e) Filter: Period = '202301'"
echo -e "   f) Expected: Regions on X-axis, NO datetime error\n"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"

# Run in foreground
superset run -p 8088 --with-threads --reload --debugger

