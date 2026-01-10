#!/bin/bash
# Quick start script for running Superset locally (non-Docker)

set -e

cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if venv exists
if [ ! -d ".venv" ]; then
    echo -e "${RED}Error: Virtual environment not found!${NC}"
    echo -e "Please run: ${GREEN}./setup-python311.sh${NC}"
    exit 1
fi

# Activate virtual environment
echo -e "${YELLOW}Activating virtual environment...${NC}"
source .venv/bin/activate

# Check Python version
PYTHON_VERSION=$(python --version)
if [[ ! "$PYTHON_VERSION" =~ "3.11" ]] && [[ ! "$PYTHON_VERSION" =~ "3.10" ]]; then
    echo -e "${RED}Warning: Using $PYTHON_VERSION${NC}"
    echo -e "${YELLOW}Superset works best with Python 3.11 or 3.10${NC}"
fi

# Set environment variables
export SUPERSET_CONFIG_PATH="${PROJECT_DIR}/superset_config.py"
export FLASK_APP=superset

echo -e "${GREEN}✓ Configuration: ${SUPERSET_CONFIG_PATH}${NC}"
echo -e "${GREEN}✓ Python: ${PYTHON_VERSION}${NC}"

# Check if database is initialized
if [ ! -f "superset_home/superset.db" ]; then
    echo -e "\n${YELLOW}Database not found. Initializing...${NC}"
    superset db upgrade
    superset init

    echo -e "\n${YELLOW}Please create an admin user:${NC}"
    superset fab create-admin
fi

echo -e "\n${GREEN}Starting Superset on http://localhost:8088${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}\n"

# Run Superset
superset run -p 8088 --with-threads --reload --debugger

