#!/bin/bash

# Superset Restart Script
# This script restarts the Superset server to apply configuration changes

echo "🔄 Restarting Superset..."
echo ""

# Find and kill existing Superset processes
echo "📋 Looking for running Superset processes..."
SUPERSET_PIDS=$(ps aux | grep '[s]uperset run' | awk '{print $2}')

if [ -z "$SUPERSET_PIDS" ]; then
    echo "✅ No running Superset processes found"
else
    echo "🛑 Stopping Superset processes: $SUPERSET_PIDS"
    echo "$SUPERSET_PIDS" | xargs kill -9 2>/dev/null
    sleep 2
fi

# Navigate to Superset directory
cd "$(dirname "$0")"

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    echo "🐍 Activating Python virtual environment..."
    source venv/bin/activate
elif [ -d ".venv" ]; then
    echo "🐍 Activating Python virtual environment..."
    source .venv/bin/activate
else
    echo "⚠️  Warning: No virtual environment found. Using system Python."
fi

echo ""
echo "🚀 Starting Superset server..."
echo "   Server will be available at: http://localhost:8088"
echo "   Press Ctrl+C to stop"
echo ""

# Start Superset
superset run -p 8088 --with-threads --reload --debugger

