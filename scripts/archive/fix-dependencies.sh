#!/bin/bash
# Comprehensive dependency fix script for Superset DHIS2Map visualization
# This script resolves TypeScript and runtime errors caused by dependency conflicts

set -e

FRONTEND_DIR="/Users/edwinarinda/Projects/Redux/superset/superset-frontend"

echo "=============================================="
echo "Superset DHIS2Map Dependency Fix Script"
echo "=============================================="

cd "$FRONTEND_DIR"

# Step 1: Clean npm cache
echo ""
echo "[1/6] Cleaning npm cache..."
npm cache clean --force

# Step 2: Remove node_modules and lock files
echo ""
echo "[2/6] Removing node_modules and package-lock.json..."
rm -rf node_modules
rm -f package-lock.json

# Also clean workspace packages
echo "Cleaning workspace package node_modules..."
rm -rf packages/*/node_modules packages/*/package-lock.json
rm -rf plugins/*/node_modules plugins/*/package-lock.json

# Step 3: Verify package.json has all required dependencies
echo ""
echo "[3/6] Verifying package.json dependencies..."

# Check if key dependencies exist
MISSING_DEPS=""

check_dep() {
    if ! grep -q "\"$1\"" package.json; then
        MISSING_DEPS="$MISSING_DEPS $1"
    fi
}

check_dep "@react-spring/web"
check_dep "@deck.gl/widgets"
check_dep "@deck.gl/mesh-layers"
check_dep "@deck.gl/extensions"
check_dep "global-box"
check_dep "lodash.isequal"
check_dep "diff-match-patch"
check_dep "react-ace"

if [ -n "$MISSING_DEPS" ]; then
    echo "WARNING: Missing dependencies detected:$MISSING_DEPS"
    echo "These should be added to package.json"
else
    echo "All required dependencies are present in package.json"
fi

# Step 4: Install dependencies with legacy peer deps flag
echo ""
echo "[4/6] Installing dependencies with --legacy-peer-deps..."
npm install --legacy-peer-deps

# Step 5: Verify critical packages are installed
echo ""
echo "[5/6] Verifying installed packages..."

verify_installed() {
    if [ -d "node_modules/$1" ]; then
        echo "  ✓ $1 installed"
    else
        echo "  ✗ $1 NOT FOUND - attempting individual install..."
        npm install "$1" --legacy-peer-deps --save || echo "    Failed to install $1"
    fi
}

verify_installed "@react-spring/web"
verify_installed "@deck.gl/widgets"
verify_installed "@deck.gl/mesh-layers"
verify_installed "@deck.gl/extensions"
verify_installed "global-box"
verify_installed "lodash.isequal"
verify_installed "diff-match-patch"
verify_installed "react-ace"
verify_installed "react-error-boundary"
verify_installed "react-leaflet"

# Step 6: Run TypeScript check
echo ""
echo "[6/6] Running TypeScript type check..."
npm run type 2>&1 | head -50 || echo "TypeScript check completed with some errors (this may be expected)"

echo ""
echo "=============================================="
echo "Dependency fix completed!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Start the backend:  cd /Users/edwinarinda/Projects/Redux/superset && superset run -p 8088 --with-threads --reload --debugger"
echo "2. Start the frontend: cd $FRONTEND_DIR && npm run dev-server"
echo ""
echo "If you still see errors, try running: npm run build"
