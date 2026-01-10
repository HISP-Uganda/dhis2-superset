# Superset Management Script Usage

## Quick Start

The `start-superset.sh` script provides comprehensive management for Superset with multiple commands.

### Basic Commands

```bash
# Start Superset
./start-superset.sh start

# Stop Superset
./start-superset.sh stop

# Restart Superset
./start-superset.sh restart

# Check status
./start-superset.sh status
```

---

## All Available Commands

### 1. Start Superset

```bash
./start-superset.sh start
# or simply
./start-superset.sh
```

**What it does**:
- Checks if Superset is already running
- Activates virtual environment
- Sets configuration path
- Starts Superset on port 8088
- Waits for health check
- Runs in background

**Output**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Starting Superset
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ  Activating virtual environment...
ℹ  Configuration: /Users/edwinarinda/Projects/Redux/superset/superset_config.py
ℹ  Starting server on http://localhost:8088

ℹ  Waiting for Superset to start...
.........
✅ Superset started successfully (PID: 12345)

ℹ  Access Superset at: http://localhost:8088
ℹ  View logs: tail -f superset_backend.log
ℹ  Stop server: ./start-superset.sh stop
```

---

### 2. Stop Superset

```bash
./start-superset.sh stop
```

**What it does**:
- Checks if Superset is running
- Gracefully stops the process (SIGTERM)
- Force kills if needed (SIGKILL)
- Cleans up PID file
- Ensures port 8088 is free

**Output**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛑 Stopping Superset
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ  Stopping Superset (PID: 12345)...
✅ Superset stopped successfully
```

---

### 3. Restart Superset

```bash
./start-superset.sh restart
```

**What it does**:
- Stops Superset (if running)
- Waits 2 seconds
- Starts Superset

**Use when**:
- You've made configuration changes
- You've updated code
- Superset is misbehaving

---

### 4. Check Status

```bash
./start-superset.sh status
```

**What it shows**:
- Whether Superset is running
- Process ID (PID)
- Port status
- Health check result
- Access URL

**Output (when running)**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Superset Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Superset is running (PID: 12345)
ℹ  Port 8088: In use
✅ Health check: OK

ℹ  Access: http://localhost:8088
```

**Output (when stopped)**:
```
⚠️  Superset is not running

ℹ  Start with: ./start-superset.sh start
```

---

### 5. View Logs

#### Last 50 lines

```bash
./start-superset.sh logs
```

Shows the last 50 lines of the log file and exits.

#### Follow logs in real-time

```bash
./start-superset.sh logs follow
```

Continuously shows new log entries as they appear. Press `Ctrl+C` to exit.

**Use when**:
- Debugging issues
- Monitoring requests
- Checking startup errors

---

### 6. Clear Cache

```bash
./start-superset.sh cache
# or
./start-superset.sh clear-cache
```

**What it clears**:
- Superset cache directory (`superset_home/cache/`)
- Python bytecode (`__pycache__/` directories)
- `.pyc` files

**Note**: Superset must be stopped before clearing cache.

**Use when**:
- Charts not updating
- Stale data displayed
- After code changes

---

### 7. Database Upgrade

```bash
./start-superset.sh db-upgrade
# or
./start-superset.sh migrate
```

**What it does**:
- Runs Alembic database migrations
- Applies any pending schema changes
- Updates database to latest version

**Use when**:
- After pulling new code
- After creating custom migrations
- Setting up for the first time

**Output**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 Database Upgrade
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ  Running database migrations...
INFO  [alembic.runtime.migration] Running upgrade abc123 -> def456
✅ Database upgraded
```

---

### 8. Health Check

```bash
./start-superset.sh health
# or
./start-superset.sh check
```

**What it checks**:
- Virtual environment exists
- Configuration file exists
- Process status
- HTTP endpoint responding
- Port availability

**Output**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏥 Health Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Virtual environment: OK
✅ Configuration file: OK
✅ Process: Running
✅ HTTP endpoint: Responding
ℹ  Port 8088: In use
```

**Use when**:
- Verifying setup
- Troubleshooting issues
- Before starting work

---

### 9. Help

```bash
./start-superset.sh help
# or
./start-superset.sh --help
./start-superset.sh -h
```

Shows usage information with all available commands.

---

## Common Workflows

### Daily Development

```bash
# Morning: Start Superset
./start-superset.sh start

# Work on features...

# Evening: Stop Superset
./start-superset.sh stop
```

### After Code Changes

```bash
# Restart to apply changes
./start-superset.sh restart

# Or if that doesn't work, clear cache first
./start-superset.sh stop
./start-superset.sh cache
./start-superset.sh start
```

### Troubleshooting

```bash
# Check if it's running
./start-superset.sh status

# View recent logs
./start-superset.sh logs

# Follow logs in real-time
./start-superset.sh logs follow

# Run health check
./start-superset.sh health
```

### After Git Pull

```bash
# Stop if running
./start-superset.sh stop

# Upgrade database
./start-superset.sh db-upgrade

# Clear cache
./start-superset.sh cache

# Start fresh
./start-superset.sh start
```

### Fresh Start

```bash
# Complete reset
./start-superset.sh stop
./start-superset.sh cache
./start-superset.sh db-upgrade
./start-superset.sh start
```

---

## Configuration

The script uses these paths (configured at the top of the script):

```bash
PROJECT_DIR="/Users/edwinarinda/Projects/Redux/superset"
VENV_DIR="$PROJECT_DIR/venv"
CONFIG_PATH="$PROJECT_DIR/superset_config.py"
LOG_FILE="$PROJECT_DIR/superset_backend.log"
PID_FILE="$PROJECT_DIR/superset.pid"
CACHE_DIR="$PROJECT_DIR/superset_home/cache"
```

You can modify these if your setup is different.

---

## Features

### PID Management
- Saves process ID to `superset.pid`
- Uses PID for clean shutdowns
- Removes stale PID files

### Health Monitoring
- Checks `/health` endpoint
- Waits up to 30 seconds for startup
- Validates port availability

### Graceful Shutdown
- Tries SIGTERM first (graceful)
- Falls back to SIGKILL if needed
- Ensures port is freed

### Log Management
- Logs to `superset_backend.log`
- Can view last N lines or follow
- Rotates automatically

### Color Output
- ✅ Green for success
- ℹ️  Blue for info
- ⚠️  Yellow for warnings
- ❌ Red for errors

---

## Troubleshooting

### "Superset is already running"

```bash
# Check what's running
./start-superset.sh status

# Stop it
./start-superset.sh stop

# Then start
./start-superset.sh start
```

### "Port 8088 is in use"

```bash
# Stop Superset
./start-superset.sh stop

# If that doesn't work, kill manually
lsof -ti:8088 | xargs kill -9

# Then start
./start-superset.sh start
```

### "Failed to start"

```bash
# Check logs for errors
./start-superset.sh logs

# Run health check
./start-superset.sh health

# Try fresh start
./start-superset.sh stop
./start-superset.sh cache
./start-superset.sh start
```

### Database errors

```bash
# Run migrations
./start-superset.sh db-upgrade

# Then restart
./start-superset.sh restart
```

---

## Advanced Usage

### Run in foreground (for debugging)

Edit the script and change the start_superset function to run without `nohup` and `&`:

```bash
superset run -p 8088 --with-threads --reload --debugger
```

### Change port

Edit the script and replace `8088` with your desired port.

### Custom configuration

Edit `CONFIG_PATH` in the script to point to a different config file.

---

## Script Location

The script should be in your project root:
```
/Users/edwinarinda/Projects/Redux/superset/start-superset.sh
```

Make sure it's executable:
```bash
chmod +x start-superset.sh
```

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `start` | Start Superset |
| `stop` | Stop Superset |
| `restart` | Restart Superset |
| `status` | Show status |
| `logs` | View last 50 log lines |
| `logs follow` | Follow logs in real-time |
| `cache` | Clear cache |
| `db-upgrade` | Run migrations |
| `health` | Health check |
| `help` | Show help |

---

**Pro Tip**: Create an alias in your shell:

```bash
# Add to ~/.zshrc or ~/.bashrc
alias ss='cd /Users/edwinarinda/Projects/Redux/superset && ./start-superset.sh'

# Then you can use:
ss start
ss stop
ss status
ss logs follow
```

