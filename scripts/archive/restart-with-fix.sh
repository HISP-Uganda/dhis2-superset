#!/bin/bash

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  DHIS2 COLUMN SANITIZATION FIX - RESTART SCRIPT               ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

SUPERSET_DIR="/Users/edwinarinda/Projects/Redux/superset"
cd "$SUPERSET_DIR" || exit 1

echo "📋 STEP 1: Killing existing Superset processes..."
pkill -f "superset" || true
pkill -f "python.*8088" || true
sleep 2
echo "✅ Killed existing processes"
echo ""

echo "📋 STEP 2: Clearing Python cache..."
echo "  Removing __pycache__ directories..."
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
echo "  Removing .pyc files..."
find . -name "*.pyc" -delete 2>/dev/null
echo "✅ Python cache cleared"
echo ""

echo "📋 STEP 3: Restarting Superset backend..."
echo "  Starting on port 8088..."
echo "  Access at: http://localhost:8088"
echo ""

python -m superset.cli.cli run -p 8088 --with-threads

