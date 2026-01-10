# Frontend Build Issue Fix

## Problem

The frontend build is failing with a webpack error when using Node.js v22.x:

```
TypeError: Cannot read properties of undefined (reading 'buildMeta')
```

## Root Cause

Apache Superset's webpack configuration is not fully compatible with Node.js 22.x. The project recommends Node.js 18.x or 20.x (LTS versions).

## Solutions

### Option 1: Use Node.js 20 (Recommended)

Install Node.js 20 using Homebrew:

```bash
# Install Node.js 20
brew install node@20

# Link it
brew link --force node@20

# Verify version
node --version  # Should show v20.x.x

# Restart frontend
cd /Users/edwinarinda/Projects/Redux/superset
pkill -f webpack
cd superset-frontend
npm run dev
```

### Option 2: Use nvm (Node Version Manager)

Install and use nvm to manage multiple Node versions:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Restart your terminal or run:
source ~/.zshrc

# Install Node.js 20
nvm install 20

# Use Node.js 20
nvm use 20

# Set as default
nvm alias default 20

# Restart frontend
cd /Users/edwinarinda/Projects/Redux/superset
pkill -f webpack
cd superset-frontend
npm run dev
```

### Option 3: Use Backend Only (Temporary)

If you just need to test the DHIS2 charting fix and don't need to edit frontend code, you can use the backend directly:

```bash
# Backend is already running on http://localhost:8088
# Access it directly (no frontend dev server needed)
open http://localhost:8088
```

The backend serves a production build of the frontend, so you can still:
- View and edit datasets
- Create and edit charts
- Test the DHIS2 charting fixes
- Configure dataset temporal settings

**Note**: You won't have hot-reload during development, but all features will work.

## Verification After Fix

Once Node.js 20 is installed:

```bash
# Verify Node version
node --version

# Should show: v20.x.x

# Restart all services
cd /Users/edwinarinda/Projects/Redux/superset
./restart-all.sh
```

You should see both services start successfully:
- Backend: http://localhost:8088
- Frontend (dev): http://localhost:9000

## Current Status

✅ **Backend is running successfully** on http://localhost:8088
   - All API endpoints working
   - Dataset management available
   - Chart creation working
   - DHIS2 fixes applied

❌ **Frontend dev server** needs Node.js 20 to run
   - Not required for testing
   - Only needed for frontend development

## Next Steps for Testing DHIS2 Charting

You can proceed with testing right now using the backend:

1. **Access Superset**: Open http://localhost:8088
2. **Login** with your admin credentials
3. **Fix DHIS2 datasets** (automated):
   ```bash
   source .venv/bin/activate
   python scripts/fix_dhis2_dataset_temporal.py
   ```
4. **Create test chart**:
   - Go to Charts → Create new chart
   - Select DHIS2 dataset
   - Choose "Bar Chart" (not Time-series)
   - X-Axis: orgunit_name
   - Metrics: SUM(value)
   - Filter: period = '202301'
5. **Verify**: X-axis shows regions, not periods

## Recommended: Install Node.js 20

For the best development experience, install Node.js 20:

```bash
brew install node@20
brew link --force node@20
node --version  # Verify it shows v20.x.x
```

Then restart:

```bash
./restart-all.sh
```

