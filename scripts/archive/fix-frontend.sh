#!/bin/bash
# Fix Superset Frontend Build Issues
# This script installs compatible Node.js version and rebuilds the frontend

set -e

echo "🔧 Fixing Superset Frontend Build..."
echo ""

# Setup nvm directory
export NVM_DIR="$HOME/.nvm"

# Always load nvm if it exists
if [ -s "$NVM_DIR/nvm.sh" ]; then
    \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
else
    # Install nvm if not present
    echo "📦 Installing nvm (Node Version Manager)..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    
    # Load nvm after installation
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
    
    echo "✅ nvm installed"
    echo ""
fi

echo "📥 Installing Node.js v20 (LTS)..."
nvm install 20
nvm use 20

echo "✅ Node.js version:"
node --version
npm --version
echo ""

echo "🧹 Cleaning frontend dependencies..."
cd /Users/edwinarinda/Projects/Redux/superset/superset-frontend
rm -rf node_modules package-lock.json
echo "✅ Cleaned"
echo ""

echo "📦 Installing frontend dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

echo "🎨 Starting frontend development server..."
echo "This will run in the background. Access at http://localhost:9000"
echo ""

# Run dev server in background
nohup npm run dev > /tmp/superset-frontend.log 2>&1 &
DEV_SERVER_PID=$!
echo "Frontend dev server started (PID: $DEV_SERVER_PID)"
echo ""

echo "✅ Frontend build initialized!"
echo ""
echo "🌐 Access Superset at: http://localhost:8088"
echo "🔧 Frontend dev server: http://localhost:9000"
echo ""
echo "📝 Dev server logs: tail -f /tmp/superset-frontend.log"
echo ""

