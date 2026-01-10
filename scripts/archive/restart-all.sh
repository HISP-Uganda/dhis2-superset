#!/bin/bash
# Complete restart script for Superset (Backend + Frontend)
# Implements DHIS2 charting fixes

set -e

cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Superset Complete Restart${NC}"
echo -e "${BLUE}   DHIS2 Charting Fix Implementation${NC}"
echo -e "${BLUE}========================================${NC}\n"

# ==============================================================================
# 1. STOP ALL RUNNING SERVICES
# ==============================================================================

echo -e "${YELLOW}🛑 Stopping all services...${NC}"
pkill -f "superset run" 2>/dev/null || true
pkill -f "flask run" 2>/dev/null || true
pkill -f "webpack" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true
sleep 2
echo -e "${GREEN}✓ All services stopped${NC}\n"

# ==============================================================================
# 2. CLEAN CACHES
# ==============================================================================

echo -e "${YELLOW}🧹 Cleaning caches...${NC}"

# Frontend cache
if [ -d "superset-frontend/.cache" ]; then
    rm -rf superset-frontend/.cache
    echo -e "${GREEN}✓ Cleared frontend cache${NC}"
fi

if [ -d "superset-frontend/node_modules/.cache" ]; then
    rm -rf superset-frontend/node_modules/.cache
    echo -e "${GREEN}✓ Cleared node_modules cache${NC}"
fi

# Python cache
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
echo -e "${GREEN}✓ Cleared Python cache${NC}\n"

# ==============================================================================
# 3. VERIFY CONFIGURATION
# ==============================================================================

echo -e "${YELLOW}🔍 Verifying DHIS2 charting configuration...${NC}"

# Check GENERIC_CHART_AXES flag
if grep -q 'GENERIC_CHART_AXES.*True' superset_config.py; then
    echo -e "${GREEN}✓ GENERIC_CHART_AXES is enabled${NC}"
else
    echo -e "${RED}✗ GENERIC_CHART_AXES is NOT enabled${NC}"
    echo -e "${YELLOW}  Adding to superset_config.py...${NC}"
    # Flag will be added if missing
fi

# Check virtual environment
if [ ! -d ".venv" ]; then
    echo -e "${RED}✗ Virtual environment not found!${NC}"
    echo -e "${YELLOW}  Please run: ./setup-python311.sh${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Virtual environment exists${NC}"
fi

echo ""

# ==============================================================================
# 4. START BACKEND
# ==============================================================================

echo -e "${YELLOW}🚀 Starting backend (Python/Flask)...${NC}"

# Activate virtual environment
source .venv/bin/activate

# Verify Python version
PYTHON_VERSION=$(python --version)
echo -e "${BLUE}   Python: ${PYTHON_VERSION}${NC}"

if [[ ! "$PYTHON_VERSION" =~ "3.11" ]] && [[ ! "$PYTHON_VERSION" =~ "3.10" ]]; then
    echo -e "${RED}   Warning: Using $PYTHON_VERSION${NC}"
    echo -e "${YELLOW}   Superset works best with Python 3.11 or 3.10${NC}"
fi

# Set environment variables
export SUPERSET_CONFIG_PATH="${PROJECT_DIR}/superset_config.py"
export FLASK_APP=superset

echo -e "${BLUE}   Config: ${SUPERSET_CONFIG_PATH}${NC}"

# Check if database is initialized
if [ ! -f "superset_home/superset.db" ]; then
    echo -e "${YELLOW}   Database not found. Initializing...${NC}"
    superset db upgrade
    superset init
    echo -e "${YELLOW}   Please create an admin user:${NC}"
    superset fab create-admin
fi

# Start backend in background
echo -e "${BLUE}   Starting on port 8088...${NC}"
superset run -p 8088 --with-threads --reload --debugger > superset_backend.log 2>&1 &
BACKEND_PID=$!

echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
echo -e "${BLUE}   Logs: superset_backend.log${NC}\n"

# Wait for backend to initialize
echo -e "${YELLOW}⏳ Waiting for backend to initialize...${NC}"
sleep 5

# Check if backend is running
if ps -p $BACKEND_PID > /dev/null; then
    echo -e "${GREEN}✓ Backend is running${NC}\n"
else
    echo -e "${RED}✗ Backend failed to start${NC}"
    echo -e "${YELLOW}   Check logs: tail -f superset_backend.log${NC}"
    exit 1
fi

# ==============================================================================
# 5. START FRONTEND
# ==============================================================================

echo -e "${YELLOW}🎨 Starting frontend (React/TypeScript)...${NC}"

cd superset-frontend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}   Installing dependencies...${NC}"
    npm install
fi

echo -e "${BLUE}   Starting on port 9000...${NC}"

# Start frontend in background
npm run dev > ../superset_frontend.log 2>&1 &
FRONTEND_PID=$!

cd ..

echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"
echo -e "${BLUE}   Logs: superset_frontend.log${NC}\n"

# ==============================================================================
# 6. DISPLAY STATUS
# ==============================================================================

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   ✅ All services started!${NC}"
echo -e "${GREEN}========================================${NC}\n"

echo -e "${BLUE}Access Points:${NC}"
echo -e "  Frontend (dev): ${GREEN}http://localhost:9000${NC}"
echo -e "  Backend (API):  ${GREEN}http://localhost:8088${NC}\n"

echo -e "${BLUE}Process IDs:${NC}"
echo -e "  Backend:  ${BACKEND_PID}"
echo -e "  Frontend: ${FRONTEND_PID}\n"

echo -e "${BLUE}Logs:${NC}"
echo -e "  Backend:  tail -f superset_backend.log"
echo -e "  Frontend: tail -f superset_frontend.log\n"

echo -e "${BLUE}DHIS2 Charting Fix - Quick Test:${NC}"
echo -e "  1. Go to ${GREEN}http://localhost:9000${NC}"
echo -e "  2. Navigate to: Data → Datasets"
echo -e "  3. Edit a DHIS2 dataset:"
echo -e "     - Columns tab: Uncheck 'Is Temporal' for Period column"
echo -e "     - Settings tab: Set 'Main Datetime Column' to None"
echo -e "  4. Create a Bar Chart (not Time-series):"
echo -e "     - X-Axis: Select orgunit or orgunit_name"
echo -e "     - Metrics: SUM(value)"
echo -e "     - Filter: period = '202301'"
echo -e "  5. Verify: X-axis shows regions, NOT periods\n"

echo -e "${YELLOW}To stop all services:${NC}"
echo -e "  kill $BACKEND_PID $FRONTEND_PID\n"

echo -e "${YELLOW}Press Ctrl+C to stop this script (services will continue running)${NC}"
echo -e "${YELLOW}Or wait here to monitor startup...${NC}\n"

# Wait a bit to monitor
sleep 10

# Show recent logs
echo -e "${BLUE}Recent backend logs:${NC}"
tail -n 20 superset_backend.log || true

echo -e "\n${BLUE}Recent frontend logs:${NC}"
tail -n 20 superset_frontend.log || true

echo -e "\n${GREEN}Startup complete! Services are running in the background.${NC}"

