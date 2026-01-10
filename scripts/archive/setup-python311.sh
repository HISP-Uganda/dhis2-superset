#!/bin/bash
# Setup script for Superset with Python 3.11
# This fixes the Python 3.13 compatibility issue with gevent

set -e  # Exit on error

echo "🔧 Setting up Apache Superset with Python 3.11..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Python 3.11 is installed
if ! command -v python3.11 &> /dev/null; then
    echo -e "${YELLOW}Python 3.11 not found. Installing via Homebrew...${NC}"
    brew install python@3.11
else
    echo -e "${GREEN}✓ Python 3.11 found: $(python3.11 --version)${NC}"
fi

# Navigate to project directory
cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

echo -e "\n${YELLOW}Removing old virtual environment...${NC}"
# Deactivate if active
if [[ "$VIRTUAL_ENV" != "" ]]; then
    deactivate 2>/dev/null || true
fi

# Remove old venv
rm -rf .venv

echo -e "\n${YELLOW}Creating new virtual environment with Python 3.11...${NC}"
python3.11 -m venv .venv

echo -e "\n${YELLOW}Activating virtual environment...${NC}"
source .venv/bin/activate

echo -e "${GREEN}✓ Python version in venv: $(python --version)${NC}"

echo -e "\n${YELLOW}Upgrading pip, setuptools, and wheel...${NC}"
pip install --upgrade pip setuptools wheel

echo -e "\n${YELLOW}Installing Superset dependencies...${NC}"
# Install base requirements first to avoid conflicts
pip install -r requirements/base.txt

echo -e "\n${YELLOW}Installing development requirements...${NC}"
pip install -r requirements/development.txt

echo -e "\n${YELLOW}Installing Superset in development mode (editable)...${NC}"
pip install -e . --no-deps

echo -e "\n${YELLOW}Setting up Superset configuration...${NC}"
export SUPERSET_CONFIG_PATH="${PROJECT_DIR}/superset_config.py"

echo -e "\n${YELLOW}Initializing Superset database...${NC}"
superset db upgrade
superset init

echo -e "\n${GREEN}✓ Setup complete!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Activate the virtual environment:"
echo -e "   ${GREEN}source .venv/bin/activate${NC}"
echo -e "\n2. Create an admin user (if not already done):"
echo -e "   ${GREEN}superset fab create-admin${NC}"
echo -e "\n3. Set the config path and run Superset:"
echo -e "   ${GREEN}export SUPERSET_CONFIG_PATH=${PROJECT_DIR}/superset_config.py${NC}"
echo -e "   ${GREEN}export FLASK_APP=superset${NC}"
echo -e "   ${GREEN}superset run -p 8088 --with-threads --reload --debugger${NC}"
echo -e "\n4. Visit ${GREEN}http://localhost:8088${NC} in your browser"
echo -e "\n${YELLOW}Note: Frontend assets will be built on first access, or you can pre-build:${NC}"
echo -e "   ${GREEN}cd superset-frontend && npm ci && npm run build && cd ..${NC}"

