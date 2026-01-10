#!/bin/bash
# Initialize Superset database and create admin user

set -e

cd "$(dirname "$0")"

echo "=========================================="
echo "Initializing Superset"
echo "=========================================="

# Activate virtual environment
source .venv/bin/activate

# Set environment variables
export SUPERSET_CONFIG_PATH="$(pwd)/superset_config.py"
export FLASK_APP=superset

# Check if superset is available
echo "Checking Superset installation..."
which superset
superset --version

# Upgrade database
echo ""
echo "Running database migrations..."
superset db upgrade

# Initialize Superset (create default roles and permissions)
echo ""
echo "Initializing roles and permissions..."
superset init

echo ""
echo "=========================================="
echo "✅ Database initialized successfully!"
echo "=========================================="
echo ""
echo "Next step: Create an admin user"
echo "Run: superset fab create-admin"
echo ""

