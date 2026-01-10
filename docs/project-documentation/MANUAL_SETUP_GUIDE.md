# Manual Setup Guide for Superset (Python 3.11)

## Problem

The automated setup is failing due to a dependency conflict between `apache-superset` (dev version) and `apache-superset-core`. This is because you're installing from source (development mode).

## Solution: Manual Step-by-Step Setup

### Step 1: Install Python 3.11

```bash
brew install python@3.11
python3.11 --version  # Should show Python 3.11.x
```

### Step 2: Clean and Create Virtual Environment

```bash
cd /Users/edwinarinda/Projects/Redux/superset

# Deactivate current venv if active
deactivate 2>/dev/null || true

# Remove old venv
rm -rf .venv

# Create new venv with Python 3.11
python3.11 -m venv .venv

# Activate it
source .venv/bin/activate

# Verify
python --version  # Should show 3.11.x
```

### Step 3: Upgrade pip

```bash
pip install --upgrade pip setuptools wheel
```

### Step 4: Install Dependencies (Choose ONE method)

#### Method A: Install from requirements files (Recommended)

```bash
# Install base requirements
pip install -r requirements/base.txt

# Install development requirements
pip install -r requirements/development.txt

# Install Superset in editable mode without dependencies
pip install -e . --no-deps
```

#### Method B: If requirements files don't exist or fail

```bash
# Install core dependencies manually
pip install flask==2.3.2 sqlalchemy==1.4.53 pandas==2.1.3 celery==5.3.6
pip install flask-appbuilder==5.0.0 wtforms==3.2.0

# Then install Superset without deps
pip install -e . --no-deps
```

#### Method C: Ignore the conflict (last resort)

```bash
# This will install everything but may have conflicts
pip install -e . --use-pep517 2>&1 | tee install.log

# Check for critical errors
tail -50 install.log
```

### Step 5: Set Configuration Path

```bash
export SUPERSET_CONFIG_PATH=/Users/edwinarinda/Projects/Redux/superset/superset_config.py
export FLASK_APP=superset
```

### Step 6: Initialize Superset Database

```bash
# Upgrade database schema
superset db upgrade

# Initialize Superset (create roles, permissions)
superset init
```

### Step 7: Create Admin User

```bash
superset fab create-admin
# Follow prompts to set username, email, password
```

### Step 8: Run Superset

```bash
superset run -p 8088 --with-threads --reload --debugger
```

Visit: **http://localhost:8088**

---

## Quick Reference Script (Run these commands one by one)

```bash
# 1. Navigate to project
cd /Users/edwinarinda/Projects/Redux/superset

# 2. Setup venv
rm -rf .venv
python3.11 -m venv .venv
source .venv/bin/activate

# 3. Upgrade pip
pip install --upgrade pip setuptools wheel

# 4. Try installing (choose one line):
# Option A:
pip install -r requirements/base.txt && pip install -r requirements/development.txt && pip install -e . --no-deps

# Option B (if A fails):
pip install flask==2.3.2 sqlalchemy==1.4.53 pandas flask-appbuilder wtforms && pip install -e . --no-deps

# 5. Initialize
export SUPERSET_CONFIG_PATH=$(pwd)/superset_config.py
export FLASK_APP=superset
superset db upgrade
superset init
superset fab create-admin

# 6. Run
superset run -p 8088 --with-threads --reload --debugger
```

---

## Troubleshooting

### If `superset` command not found

```bash
# Make sure venv is activated
source .venv/bin/activate

# Check if superset is installed
pip show apache-superset

# If not, reinstall
pip install -e . --no-deps
```

### If database errors occur

```bash
# Reset database
rm -rf superset_home/superset.db
superset db upgrade
superset init
superset fab create-admin
```

### If Python version errors

```bash
# Verify you're using Python 3.11
python --version

# If not, recreate venv
deactivate
rm -rf .venv
python3.11 -m venv .venv
source .venv/bin/activate
```

---

## After Successful Setup

Once Superset is running:

1. **Login** at http://localhost:8088
2. **Connect to DHIS2 database** (Data > Databases)
3. **Create datasets** from DHIS2 tables
4. **Fix dataset configuration**:
   - Edit dataset → Columns → Uncheck "Is Temporal" for Period
   - Settings → Main Datetime Column → Set to None
5. **Create charts** following the guide in `DHIS2_CHARTING_FIX.md`

---

## Environment Activation for Future Sessions

When you come back later:

```bash
cd /Users/edwinarinda/Projects/Redux/superset
source .venv/bin/activate
export SUPERSET_CONFIG_PATH=$(pwd)/superset_config.py
export FLASK_APP=superset
superset run -p 8088 --with-threads --reload --debugger
```

Or simply:

```bash
./run-superset.sh
```

