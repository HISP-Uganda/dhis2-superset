#!/bin/bash
# Start Superset Backend Only
# Useful for testing with production frontend build

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
echo -e "${BLUE}   Starting Superset Backend${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Check if port 8088 is in use
if lsof -Pi :8088 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}⚠️  Port 8088 is already in use${NC}"
    echo -e "${YELLOW}   Killing existing process...${NC}"
    lsof -ti:8088 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

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

echo -e "${GREEN}✓ Config: ${SUPERSET_CONFIG_PATH}${NC}"

# Check database
if [ ! -f "superset_home/superset.db" ]; then
    echo -e "\n${YELLOW}⚠️  Database not found. Initializing...${NC}"
    superset db upgrade
    superset init
    echo -e "\n${YELLOW}Creating admin user:${NC}"
    superset fab create-admin
fi

# Start backend
echo -e "\n${GREEN}🚀 Starting backend on http://localhost:8088${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}\n"

# Run in foreground with output
superset run -p 8088 --with-threads --reload --debugger

