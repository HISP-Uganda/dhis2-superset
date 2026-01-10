#!/bin/bash
# Complete Superset initialization - run this manually

set -e

cd /Users/edwinarinda/Projects/Redux/superset

echo "======================================"
echo "Superset Complete Initialization"
echo "======================================"
echo ""

# Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Set environment variables
export SUPERSET_CONFIG_PATH=$(pwd)/superset_config.py
export FLASK_APP=superset

echo "✅ Environment configured"
echo ""

# Database upgrade
echo "Step 1/3: Running database migrations..."
echo "This may take 1-2 minutes..."
superset db upgrade
echo "✅ Database migrations complete"
echo ""

# Initialize Superset
echo "Step 2/3: Initializing roles and permissions..."
superset init
echo "✅ Initialization complete"
echo ""

# Create admin user
echo "Step 3/3: Creating admin user..."
echo "Please provide the following information:"
superset fab create-admin
echo "✅ Admin user created"
echo ""

echo "======================================"
echo "✅ Setup Complete!"
echo "======================================"
echo ""
echo "To start Superset, run:"
echo "  ./run-superset.sh"
echo ""
echo "Or manually:"
echo "  source .venv/bin/activate"
echo "  export SUPERSET_CONFIG_PATH=\$(pwd)/superset_config.py"
echo "  export FLASK_APP=superset"
echo "  superset run -p 8088 --with-threads --reload --debugger"
echo ""
echo "Then visit: http://localhost:8088"
echo ""

