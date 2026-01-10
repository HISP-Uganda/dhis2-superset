#!/bin/bash
# Quick verification and startup script

cd /Users/edwinarinda/Projects/Redux/superset

echo "=== Superset Quick Start ==="
echo ""

# Activate venv
source .venv/bin/activate

# Set env vars
export SUPERSET_CONFIG_PATH=$(pwd)/superset_config.py
export FLASK_APP=superset

# Check database
if [ -f "superset_home/superset.db" ]; then
    echo "✅ Database exists: superset_home/superset.db"
else
    echo "❌ Database not found - running migrations..."
    superset db upgrade
fi

# Check if admin user exists
echo ""
echo "Checking for admin user..."
ADMIN_CHECK=$(superset fab list-users 2>&1 | grep -i admin || echo "")
if [ -z "$ADMIN_CHECK" ]; then
    echo ""
    echo "⚠️  No admin user found. Please create one:"
    echo "   superset fab create-admin"
    echo ""
    exit 1
fi

echo "✅ Admin user exists"
echo ""
echo "Starting Superset on http://localhost:8088"
echo "Press Ctrl+C to stop"
echo ""

# Run Superset
superset run -p 8088 --with-threads --reload --debugger

