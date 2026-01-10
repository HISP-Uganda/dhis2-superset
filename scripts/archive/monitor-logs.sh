#!/bin/bash
# Monitor Superset logs in real-time

cd "$(dirname "$0")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Superset Log Monitor${NC}"
echo -e "${BLUE}========================================${NC}\n"

if [ ! -f "superset_backend.log" ] && [ ! -f "superset_frontend.log" ]; then
    echo -e "${YELLOW}No log files found. Start Superset first:${NC}"
    echo -e "  ./restart-all.sh"
    exit 1
fi

echo -e "${GREEN}Monitoring logs (Ctrl+C to stop)${NC}\n"
echo -e "${BLUE}Backend (superset_backend.log):${NC}"
echo -e "${YELLOW}-----------------------------------${NC}"

# Show both logs side by side using tail
if [ -f "superset_backend.log" ] && [ -f "superset_frontend.log" ]; then
    # Use multitail if available, otherwise just tail backend
    if command -v multitail &> /dev/null; then
        multitail superset_backend.log superset_frontend.log
    else
        echo -e "${YELLOW}Showing backend log (install 'multitail' to see both)${NC}\n"
        tail -f superset_backend.log
    fi
elif [ -f "superset_backend.log" ]; then
    tail -f superset_backend.log
else
    tail -f superset_frontend.log
fi

