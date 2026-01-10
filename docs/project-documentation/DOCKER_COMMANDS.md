# Docker Commands - Quick Reference

## Starting Superset

### Start All Services
```bash
docker-compose up -d
```

### Check Container Status
```bash
docker ps
```

### Check Logs
```bash
# Follow all logs
docker logs -f superset_app

# Last 100 lines
docker logs superset_app --tail 100

# Filter for specific terms
docker logs superset_app 2>&1 | grep -i error
docker logs superset_app 2>&1 | grep -i dhis2
```

## Restarting Superset

### Restart After Code Changes
```bash
docker restart superset_app
```

### Full Rebuild (after dependency changes)
```bash
docker-compose down
docker-compose up -d --build
```

## Frontend Development

### Start Frontend Dev Server
```bash
cd superset-frontend
npm run dev
```
Access at: http://localhost:9000

### Backend Only (without frontend rebuild)
```bash
docker-compose up -d superset_app
```
Access at: http://localhost:8088

## Useful Commands

### Access Container Shell
```bash
docker exec -it superset_app bash
```

### Run Python Commands
```bash
docker exec superset_app python3 -c "from superset import app; print(app)"
```

### Check Database
```bash
docker exec superset_app superset db upgrade
```

### Create Admin User
```bash
docker exec superset_app superset fab create-admin
```

### Stop All Services
```bash
docker-compose down
```

### Remove Volumes (clean slate)
```bash
docker-compose down -v
```

## Monitoring DHIS2 Queries

### Watch DHIS2 Logs
```bash
docker logs -f superset_app 2>&1 | grep -E "\[DHIS2\]"
```

### Check for Errors
```bash
docker logs superset_app 2>&1 | grep -i "error" | tail -20
```

### Check Dataset Creation
```bash
docker logs superset_app 2>&1 | grep -E "Stored DHIS2 params|Creating dataset"
```

## Health Checks

### Check Superset Health
```bash
curl -f http://localhost:8088/health
```

### Check Frontend
```bash
curl -f http://localhost:9000
```

## Common Issues

### Port Already in Use
```bash
# Find process using port 8088
lsof -i :8088

# Kill process
kill -9 <PID>
```

### Container Won't Start
```bash
# Check logs
docker logs superset_app

# Remove and recreate
docker-compose down
docker-compose up -d
```

### Frontend Not Updating
```bash
# Clear npm cache and rebuild
cd superset-frontend
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Database Migration Issues
```bash
docker exec superset_app superset db upgrade
docker restart superset_app
```

## Quick Restart Sequence

When you make backend changes:
```bash
docker restart superset_app && sleep 5 && docker logs superset_app --tail 20
```

When you make frontend changes:
```bash
cd superset-frontend && npm run dev
```

When you make both:
```bash
docker restart superset_app &
cd superset-frontend && npm run dev
```
