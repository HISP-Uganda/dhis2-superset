#!/bin/bash
# Simplified setup for Superset with Python 3.11
# Handles dependency conflicts by installing in correct order

set -e

echo "🔧 Simplified Superset Setup with Python 3.11..."

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check Python 3.11
if ! command -v python3.11 &> /dev/null; then
    echo -e "${YELLOW}Installing Python 3.11...${NC}"
    brew install python@3.11
else
    echo -e "${GREEN}✓ Python 3.11 found${NC}"
fi

cd "$(dirname "$0")"

# Clean old environment
echo -e "\n${YELLOW}Cleaning old virtual environment...${NC}"
deactivate 2>/dev/null || true
rm -rf .venv

# Create new venv
echo -e "\n${YELLOW}Creating virtual environment...${NC}"
python3.11 -m venv .venv
source .venv/bin/activate

echo -e "${GREEN}✓ Using Python $(python --version)${NC}"

# Upgrade pip
echo -e "\n${YELLOW}Upgrading pip...${NC}"
pip install --upgrade pip setuptools wheel

# Try installing from requirements first
echo -e "\n${YELLOW}Installing dependencies (this may take 10-15 minutes)...${NC}"

if [ -f "requirements/base.txt" ]; then
    echo -e "${YELLOW}Installing base requirements...${NC}"
    pip install -r requirements/base.txt

    if [ -f "requirements/development.txt" ]; then
        echo -e "${YELLOW}Installing development requirements...${NC}"
        pip install -r requirements/development.txt
    fi

    echo -e "${YELLOW}Installing Superset in editable mode...${NC}"
    pip install -e . --no-deps
else
    # Fallback: install without -e flag first
    echo -e "${YELLOW}Installing Superset (may show dependency warnings)...${NC}"
    pip install --no-cache-dir -e . 2>&1 | tee install.log || {
        echo -e "${RED}Installation had issues. Trying alternative method...${NC}"
        # Try installing just the dependencies
        pip install flask sqlalchemy pandas celery
        pip install -e . --no-deps
    }
fi

# Set config path
export SUPERSET_CONFIG_PATH="$(pwd)/superset_config.py"

# Initialize database
echo -e "\n${YELLOW}Initializing Superset...${NC}"
superset db upgrade
superset init

echo -e "\n${GREEN}✓ Setup complete!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Activate environment: ${GREEN}source .venv/bin/activate${NC}"
echo -e "2. Create admin: ${GREEN}superset fab create-admin${NC}"
echo -e "3. Run Superset: ${GREEN}./run-superset.sh${NC}"

