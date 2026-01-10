#!/bin/bash

# Start Superset Development Environment
# This script starts both backend and frontend servers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Superset Development Environment..."

# Kill existing processes
echo "⏹️  Stopping any existing servers..."
lsof -ti :8088 | xargs kill -9 2>/dev/null
lsof -ti :9000 | xargs kill -9 2>/dev/null
sleep 2

# Start Backend
echo "🔧 Starting Backend Server (port 8088)..."
source .venv/bin/activate
export SUPERSET_CONFIG_PATH="$SCRIPT_DIR/superset_config.py"
export FLASK_APP=superset
superset run -p 8088 --with-threads --reload &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Wait for backend to start
echo "⏳ Waiting for backend to start..."
sleep 10

# Check if backend is running
if curl -s http://localhost:8088/health > /dev/null 2>&1; then
    echo "✅ Backend is running!"
else
    echo "⚠️  Backend may still be starting..."
fi

# Start Frontend
echo "🎨 Starting Frontend Server (port 9000)..."
cd superset-frontend
npm run dev-server &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

echo ""
echo "============================================"
echo "🎉 Superset Development Environment Started!"
echo "============================================"
echo ""
echo "   Backend:  http://localhost:8088"
echo "   Frontend: http://localhost:9000"
echo ""
echo "   To stop: kill $BACKEND_PID $FRONTEND_PID"
echo ""

# Wait for both processes
wait

