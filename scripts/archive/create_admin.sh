#!/bin/bash

# Script to create/reset Superset admin user

cd "$(dirname "$0")"

# Activate virtual environment
if [ -d "venv" ]; then
    echo "🐍 Activating Python virtual environment..."
    source venv/bin/activate
elif [ -d ".venv" ]; then
    echo "🐍 Activating Python virtual environment..."
    source .venv/bin/activate
fi

echo "👤 Creating/Resetting Superset admin user..."
echo ""

# Set environment variable to bypass interactive mode
export FLASK_APP=superset

# Create admin user (this will prompt for details)
superset fab create-admin

echo ""
echo "✅ Admin user created/updated successfully!"
echo ""
echo "You can now log in with the credentials you just provided."
echo "To start Superset, run: ./restart_superset.sh"
