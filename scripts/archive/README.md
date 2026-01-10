# Archived Scripts

This folder contains shell scripts that were used during development but are no longer actively needed.

## Active Script

The main active script is in the project root:
- `/superset-manager.sh` - Start, stop, restart, and manage Superset services

## Archived Scripts

All other setup, restart, and maintenance scripts have been moved here for reference but are no longer needed for daily operations.

### Common Operations

Use `superset-manager.sh` for all common operations:
```bash
# Start Superset
./superset-manager.sh start

# Stop Superset
./superset-manager.sh stop

# Restart Superset
./superset-manager.sh restart

# View logs
./superset-manager.sh logs backend
./superset-manager.sh logs backend follow

# Check status
./superset-manager.sh status
```

## Why These Scripts Were Archived

These scripts were created during initial setup and troubleshooting but are now redundant with `superset-manager.sh` which provides a unified interface for all operations.
