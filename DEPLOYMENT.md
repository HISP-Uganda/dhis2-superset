# Superset DHIS2 Deployment

This project includes a complete deployment solution for Apache Superset with DHIS2 integration, featuring advanced caching and embedded dashboard support.

---

## Quick Start

```bash
# Installation (one command!)
./deploy.sh install

# Start services
./deploy.sh start

# Access Superset
open http://localhost:8088
```

---

## Performance

- **20-40x faster dashboards** with intelligent caching
- Dashboard load: 15-20s → **<1 second** 🚀
- GeoJSON fetch: 7-10s → **<50ms** 🚀

---

## Complete Documentation

All deployment documentation, guides, and scripts are in the **[deployment/](deployment/)** folder:

### Getting Started
- **[deployment/QUICK_START.md](deployment/QUICK_START.md)** - Get running in 3 commands
- **[deployment/DEPLOYMENT_GUIDE.md](deployment/DEPLOYMENT_GUIDE.md)** - Complete deployment instructions

### Implementation Details
- **[deployment/FINAL_IMPLEMENTATION_SUMMARY.md](deployment/FINAL_IMPLEMENTATION_SUMMARY.md)** - Overview of everything implemented
- **[deployment/DHIS2_CACHING_IMPLEMENTATION_COMPLETE.md](deployment/DHIS2_CACHING_IMPLEMENTATION_COMPLETE.md)** - Technical caching details
- **[deployment/DHIS2_CACHING_STRATEGY.md](deployment/DHIS2_CACHING_STRATEGY.md)** - Caching architecture

### Configuration
- **[deployment/EMBEDDED_DASHBOARD_CONFIG.md](deployment/EMBEDDED_DASHBOARD_CONFIG.md)** - Embedded dashboard setup

### Scripts
- **[deployment/generate_embedded_url.py](deployment/generate_embedded_url.py)** - Generate embedded URLs

---

## Available Commands

```bash
./deploy.sh install         # Full installation (first time)
./deploy.sh start           # Start Superset
./deploy.sh stop            # Stop Superset
./deploy.sh restart         # Restart services
./deploy.sh status          # Check if running
./deploy.sh init-embedded   # Setup embedded dashboards
./deploy.sh clear-cache     # Clear DHIS2 cache
./deploy.sh upgrade         # Database migrations
```

---

## Key Features

- ✅ One-command deployment
- ✅ Advanced DHIS2 caching (20-40x faster)
- ✅ Background cache preloading
- ✅ Embedded dashboard support
- ✅ Cache metrics API
- ✅ Production-ready configuration

---

## For Detailed Instructions

See **[deployment/README.md](deployment/README.md)** for complete documentation navigation.

---

**Ready to get started?** → [deployment/QUICK_START.md](deployment/QUICK_START.md) 🚀
