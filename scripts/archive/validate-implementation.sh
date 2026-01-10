#!/bin/bash
# Validate DHIS2 Charting Implementation
# Checks that all fixes have been properly applied

set -e

cd "$(dirname "$0")"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   DHIS2 Charting Fixes - Implementation Validator      ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}\n"

PASS=0
FAIL=0

# Check 1: WIDE format pivot setting
echo -e "${YELLOW}Checking Fix 1: WIDE Format (pivot=True)...${NC}"
if grep -q "should_pivot = True" superset/db_engine_specs/dhis2_dialect.py; then
    echo -e "${GREEN}✓ PASS:${NC} WIDE/PIVOTED format enabled"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} WIDE format not found"
    ((FAIL++))
fi
echo ""

# Check 2: requires_time_column setting
echo -e "${YELLOW}Checking Fix 2: Datetime Not Required...${NC}"
if grep -q "requires_time_column = False" superset/db_engine_specs/dhis2.py; then
    echo -e "${GREEN}✓ PASS:${NC} Datetime column not required"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} requires_time_column setting not found"
    ((FAIL++))
fi
echo ""

# Check 3: supports_dynamic_schema setting
echo -e "${YELLOW}Checking Fix 3: Dataset Preview Enabled...${NC}"
if grep -q "supports_dynamic_schema = True" superset/db_engine_specs/dhis2.py; then
    echo -e "${GREEN}✓ PASS:${NC} Dataset preview enabled"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} supports_dynamic_schema not found"
    ((FAIL++))
fi
echo ""

# Check 4: GENERIC_CHART_AXES feature flag
echo -e "${YELLOW}Checking Fix 4: GENERIC_CHART_AXES Feature Flag...${NC}"
if grep -q "\"GENERIC_CHART_AXES\".*True" superset_config.py; then
    echo -e "${GREEN}✓ PASS:${NC} GENERIC_CHART_AXES enabled"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} GENERIC_CHART_AXES not enabled"
    ((FAIL++))
fi
echo ""

# Check 5: Default columns updated
echo -e "${YELLOW}Checking Fix 5: Default Columns Updated...${NC}"
if grep -q "\"analytics\": \[\"Period\", \"OrgUnit\"\]" superset/db_engine_specs/dhis2_dialect.py; then
    echo -e "${GREEN}✓ PASS:${NC} Analytics default columns updated for WIDE format"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} Default columns not updated"
    ((FAIL++))
fi
echo ""

# Check 6: is_dttm = False in column definitions
echo -e "${YELLOW}Checking Fix 6: Column datetime flags...${NC}"
if grep -q "\"is_dttm\": False.*# Not a required datetime column" superset/db_engine_specs/dhis2_dialect.py; then
    echo -e "${GREEN}✓ PASS:${NC} Column datetime flags set correctly"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} Column datetime flags not found"
    ((FAIL++))
fi
echo ""

# Check 7: Virtual environment
echo -e "${YELLOW}Checking Environment: Virtual Environment...${NC}"
if [ -d ".venv" ]; then
    echo -e "${GREEN}✓ PASS:${NC} Virtual environment exists"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} Virtual environment not found"
    ((FAIL++))
fi
echo ""

# Check 8: Startup script
echo -e "${YELLOW}Checking Tools: Startup Script...${NC}"
if [ -f "start-dhis2-fixed.sh" ] && [ -x "start-dhis2-fixed.sh" ]; then
    echo -e "${GREEN}✓ PASS:${NC} Startup script exists and is executable"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} Startup script not found or not executable"
    ((FAIL++))
fi
echo ""

# Check 9: DHIS2 Connection UI (Parameters Schema)
echo -e "${YELLOW}Checking DHIS2 UI: Connection Parameters Schema...${NC}"
if grep -q "class DHIS2ParametersSchema" superset/db_engine_specs/dhis2.py && \
   grep -q "auth_method.*basic.*pat" superset/db_engine_specs/dhis2.py && \
   grep -q "build_sqlalchemy_uri" superset/db_engine_specs/dhis2.py; then
    echo -e "${GREEN}✓ PASS:${NC} DHIS2 connection UI with Basic/PAT auth"
    ((PASS++))
else
    echo -e "${RED}✗ FAIL:${NC} DHIS2 connection UI not properly configured"
    ((FAIL++))
fi
echo ""

# Summary
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Validation Summary${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}\n"

echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   ✅ ALL CHECKS PASSED - READY FOR TESTING!             ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}\n"

    echo -e "${BLUE}Next Steps:${NC}"
    echo -e "  1. Start Superset: ${GREEN}./start-dhis2-fixed.sh${NC}"
    echo -e "  2. Open: ${GREEN}http://localhost:8088${NC}"
    echo -e "  3. Test WIDE format: Data → Datasets → Edit → Columns"
    echo -e "  4. Create test chart: Charts → Create → Bar Chart"
    echo -e "  5. Verify: X-Axis = OrgUnit, no datetime errors\n"

    exit 0
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║   ⚠️  SOME CHECKS FAILED - REVIEW REQUIRED              ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}\n"

    echo -e "${YELLOW}Please review failed checks above and fix before testing.${NC}\n"

    exit 1
fi

