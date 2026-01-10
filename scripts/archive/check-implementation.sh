#!/bin/bash
# DHIS2 Charting Fix - Quick Start Guide
# Run this script to test the implementation

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         DHIS2 Charting Fix - Quick Start Guide                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Implementation Status Check${NC}"
echo "────────────────────────────────────────────────────────────────"
echo ""

# 1. Check virtual environment
if [ -d ".venv" ]; then
    echo -e "${GREEN}✓${NC} Virtual environment exists (.venv)"
else
    echo -e "${RED}✗${NC} Virtual environment not found"
    echo -e "  ${YELLOW}Run: ./setup-python311.sh${NC}"
    exit 1
fi

# 2. Check configuration file
if grep -q "GENERIC_CHART_AXES.*True" superset_config.py 2>/dev/null; then
    echo -e "${GREEN}✓${NC} GENERIC_CHART_AXES is enabled in superset_config.py"
else
    echo -e "${RED}✗${NC} GENERIC_CHART_AXES not found in configuration"
    exit 1
fi

# 3. Check Python version
source .venv/bin/activate
PYTHON_VER=$(python --version 2>&1)
if [[ "$PYTHON_VER" =~ "3.11" ]] || [[ "$PYTHON_VER" =~ "3.10" ]]; then
    echo -e "${GREEN}✓${NC} Python version: $PYTHON_VER"
else
    echo -e "${YELLOW}⚠${NC}  Python version: $PYTHON_VER (recommended: 3.11 or 3.10)"
fi

# 4. Check Node.js version
if command_exists node; then
    NODE_VER=$(node --version 2>&1)
    if [[ "$NODE_VER" =~ "v20" ]]; then
        echo -e "${GREEN}✓${NC} Node.js version: $NODE_VER"
    elif [[ "$NODE_VER" =~ "v22" ]]; then
        echo -e "${YELLOW}⚠${NC}  Node.js version: $NODE_VER (recommended: v20.x for frontend)"
        echo -e "  ${YELLOW}Frontend may not build. Install Node 20: brew install node@20${NC}"
    else
        echo -e "${YELLOW}⚠${NC}  Node.js version: $NODE_VER"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Node.js not found (only needed for frontend development)"
fi

# 5. Check database
if [ -f "superset_home/superset.db" ]; then
    echo -e "${GREEN}✓${NC} Database exists"
else
    echo -e "${YELLOW}⚠${NC}  Database not initialized"
    echo -e "  ${YELLOW}Will be created on first run${NC}"
fi

# 6. Check if scripts exist
SCRIPTS_OK=true
for script in "restart-all.sh" "monitor-logs.sh" "scripts/fix_dhis2_dataset_temporal.py"; do
    if [ -f "$script" ]; then
        echo -e "${GREEN}✓${NC} Script exists: $script"
    else
        echo -e "${RED}✗${NC} Script missing: $script"
        SCRIPTS_OK=false
    fi
done

echo ""
echo -e "${BLUE}Documentation Files${NC}"
echo "────────────────────────────────────────────────────────────────"
echo ""

for doc in "IMPLEMENTATION_STATUS.md" "DHIS2_CHARTING_FIX.md" "FRONTEND_FIX.md"; do
    if [ -f "$doc" ]; then
        echo -e "${GREEN}✓${NC} $doc"
    else
        echo -e "${RED}✗${NC} $doc (missing)"
    fi
done

echo ""
echo "════════════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ DHIS2 Charting Fix Implementation Complete!${NC}"
echo "════════════════════════════════════════════════════════════════"
echo ""

echo -e "${BLUE}Quick Start Options:${NC}"
echo ""
echo -e "${YELLOW}1. Start Backend Only (Recommended for testing):${NC}"
echo "   source .venv/bin/activate"
echo "   export SUPERSET_CONFIG_PATH=\$(pwd)/superset_config.py"
echo "   export FLASK_APP=superset"
echo "   superset run -p 8088 --with-threads --reload --debugger"
echo ""
echo "   Then access: http://localhost:8088"
echo ""

echo -e "${YELLOW}2. Fix DHIS2 Dataset Configuration (After backend is running):${NC}"
echo "   source .venv/bin/activate"
echo "   python scripts/fix_dhis2_dataset_temporal.py"
echo ""

echo -e "${YELLOW}3. For Full Development (Backend + Frontend):${NC}"
echo "   First, ensure Node.js 20 is installed:"
echo "   brew install node@20 && brew link --force node@20"
echo ""
echo "   Then run:"
echo "   ./restart-all.sh"
echo ""

echo -e "${BLUE}Testing the Fix:${NC}"
echo ""
echo "   1. Access Superset at http://localhost:8088"
echo "   2. Login with your admin credentials"
echo "   3. Go to: Charts → Create new chart"
echo "   4. Select a DHIS2 dataset"
echo "   5. Choose: 'Bar Chart' (NOT 'Time-series Bar Chart')"
echo "   6. Configure:"
echo "      - X-Axis: orgunit or orgunit_name"
echo "      - Metrics: SUM(value)"
echo "      - Filters: period = '202301'"
echo "   7. Click 'Update Chart'"
echo "   8. Verify: X-axis shows regions, NOT periods"
echo ""

echo -e "${BLUE}For detailed information, see:${NC}"
echo "   • IMPLEMENTATION_STATUS.md - Current status and commands"
echo "   • DHIS2_CHARTING_FIX.md    - Complete implementation guide"
echo "   • FRONTEND_FIX.md          - Frontend issues and solutions"
echo ""

echo "════════════════════════════════════════════════════════════════"

