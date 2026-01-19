# DHIS2 Performance Optimization: Caching Strategy

## Problem Analysis

### Current Performance Bottlenecks

From log analysis, we identified **multiple slow API calls**:

1. **GeoJSON Data (CRITICAL BOTTLENECK):**
   ```
   GET /hmis/api/organisationUnits.geojson?level=3
   Response: 7.8 MB (7,812,237 bytes)
   Time: ~7-10 seconds
   Frequency: Every dashboard load or filter change
   ```

2. **Org Unit Hierarchy:**
   ```
   GET /hmis/api/organisationUnits?filter=parent.id:in:[...]&level=3
   Response: ~100 KB
   Time: ~1-2 seconds
   Frequency: Every cascade filter dropdown
   ```

3. **Analytics Data:**
   ```
   GET /hmis/api/analytics?dimension=dx:...&dimension=pe:...&dimension=ou:...
   Response: 2-5 MB (4439 rows)
   Time: 3-5 seconds
   Frequency: Every chart/visualization load
   ```

**Total load time without caching:** 15-25 seconds per dashboard load

---

## Caching Strategy Overview

### Three-Tier Caching Approach

```
┌─────────────────────────────────────────────────────────────────┐
│ Tier 1: In-Memory Cache (Hot Data)                              │
│ - Org unit hierarchy (all levels)                               │
│ - GeoJSON data (by level)                                       │
│ - Filter options                                                │
│ - TTL: 1-6 hours                                                │
│ - Storage: Python dict with TTL or Redis                        │
└──────────────────┬──────────────────────────────────────────────┘
                   │ (Cache miss)
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Tier 2: Database Cache (Warm Data)                              │
│ - Pre-computed analytics aggregations                           │
│ - Historical period data                                        │
│ - TTL: 24 hours                                                 │
│ - Storage: Superset metadata DB or separate cache table         │
└──────────────────┬──────────────────────────────────────────────┘
                   │ (Cache miss)
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Tier 3: DHIS2 API (Cold Data)                                   │
│ - Fresh data from DHIS2 server                                  │
│ - Only called on cache miss or TTL expiry                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Strategy

### Option 1: Flask-Caching with Redis (RECOMMENDED)

**Pros:**
- ✅ Production-ready, battle-tested
- ✅ Distributed caching (works with multiple Superset instances)
- ✅ Automatic TTL and eviction
- ✅ Easy integration with Flask
- ✅ Supports cache invalidation

**Cons:**
- Requires Redis server setup
- Additional infrastructure

#### Implementation

**Step 1: Install Redis and Flask-Caching**

```bash
# Install Redis
brew install redis  # macOS
# or
sudo apt-get install redis-server  # Ubuntu

# Start Redis
redis-server

# Install Python package
pip install Flask-Caching redis
```

**Step 2: Configure Flask-Caching in Superset**

**File:** `superset/config.py`

```python
# Add to config
CACHE_CONFIG = {
    'CACHE_TYPE': 'redis',
    'CACHE_DEFAULT_TIMEOUT': 3600,  # 1 hour default
    'CACHE_KEY_PREFIX': 'superset_dhis2_',
    'CACHE_REDIS_URL': 'redis://localhost:6379/1'
}

# DHIS2-specific cache TTLs
DHIS2_CACHE_CONFIG = {
    'geojson_ttl': 21600,      # 6 hours (geo boundaries rarely change)
    'org_hierarchy_ttl': 3600,  # 1 hour (hierarchy changes rarely)
    'analytics_ttl': 1800,      # 30 minutes (data updates periodically)
    'filter_options_ttl': 3600  # 1 hour
}
```

**Step 3: Implement Caching in DHIS2 Dialect**

**File:** `superset/db_engine_specs/dhis2_dialect.py`

```python
from flask_caching import Cache
from flask import current_app

# Initialize cache (add near top of file after imports)
cache = None

def get_cache():
    """Get or initialize cache instance."""
    global cache
    if cache is None and current_app:
        cache = Cache(current_app, config=current_app.config.get('CACHE_CONFIG', {}))
    return cache

# Modify fetch_child_org_units to use cache
def fetch_child_org_units(
    self,
    parent_names: list[str],
    child_level: int | None = None
) -> list[dict[str, Any]]:
    """Fetch child org units with caching."""

    # Create cache key based on parents and level
    cache_key = f"dhis2_children_{'-'.join(sorted(parent_names))}_{child_level}"

    # Try cache first
    cached = get_cache()
    if cached:
        result = cached.get(cache_key)
        if result is not None:
            logger.info(f"[DHIS2 Cache] HIT: {cache_key} ({len(result)} children)")
            return result

    # Cache miss - fetch from DHIS2 API
    logger.info(f"[DHIS2 Cache] MISS: {cache_key} - fetching from API")

    # ... existing fetch logic ...
    all_children = []
    # ... (existing code) ...

    # Store in cache
    if cached and all_children:
        ttl = current_app.config.get('DHIS2_CACHE_CONFIG', {}).get('org_hierarchy_ttl', 3600)
        cached.set(cache_key, all_children, timeout=ttl)
        logger.info(f"[DHIS2 Cache] STORED: {cache_key} (TTL: {ttl}s)")

    return all_children
```

**Step 4: Cache GeoJSON Data**

**File:** `superset/databases/api.py` (around line 2846)

```python
from flask_caching import Cache

def dhis2_geojson(self, pk: int) -> Response:
    """Fetch DHIS2 GeoJSON with caching."""

    # ... existing validation ...

    # Build cache key from params
    level = request.args.get("level", "")
    parent = request.args.get("parent", "")
    cache_key = f"dhis2_geojson_{pk}_{level}_{parent}"

    # Try cache first
    cached = Cache(current_app, config=current_app.config.get('CACHE_CONFIG', {}))
    cached_geojson = cached.get(cache_key)

    if cached_geojson:
        logger.info(f"[DHIS2 GeoJSON Cache] HIT: {cache_key}")
        return self.response(200, result=cached_geojson)

    logger.info(f"[DHIS2 GeoJSON Cache] MISS: {cache_key} - fetching from API")

    # ... existing DHIS2 API call ...

    if response.status_code == 200:
        data = response.json()

        # Cache the GeoJSON (6 hours TTL - geo boundaries rarely change)
        ttl = current_app.config.get('DHIS2_CACHE_CONFIG', {}).get('geojson_ttl', 21600)
        cached.set(cache_key, data, timeout=ttl)
        logger.info(f"[DHIS2 GeoJSON Cache] STORED: {cache_key} (TTL: {ttl}s)")

        return self.response(200, result=data)
```

---

### Option 2: Simple In-Memory Cache (Quick Start)

**Pros:**
- ✅ No external dependencies
- ✅ Fast implementation
- ✅ Good for single-server deployments

**Cons:**
- ❌ Not shared across Superset instances
- ❌ Lost on server restart
- ❌ Memory usage grows unbounded without proper cleanup

#### Implementation

**File:** `superset/db_engine_specs/dhis2_dialect.py`

```python
import time
from threading import Lock

# Simple TTL cache at module level
class SimpleCache:
    def __init__(self):
        self._cache = {}
        self._lock = Lock()

    def get(self, key):
        """Get cached value if not expired."""
        with self._lock:
            if key in self._cache:
                value, expiry = self._cache[key]
                if time.time() < expiry:
                    return value
                else:
                    del self._cache[key]
        return None

    def set(self, key, value, ttl=3600):
        """Set cached value with TTL."""
        with self._lock:
            self._cache[key] = (value, time.time() + ttl)

    def clear(self):
        """Clear all cached values."""
        with self._lock:
            self._cache.clear()

    def stats(self):
        """Get cache statistics."""
        with self._lock:
            total = len(self._cache)
            expired = sum(1 for _, (_, expiry) in self._cache.items() if time.time() >= expiry)
            return {'total': total, 'active': total - expired, 'expired': expired}

# Global cache instance
_dhis2_cache = SimpleCache()

# Use in fetch_child_org_units:
def fetch_child_org_units(self, parent_names, child_level=None):
    cache_key = f"children_{'-'.join(sorted(parent_names))}_{child_level}"

    cached = _dhis2_cache.get(cache_key)
    if cached:
        logger.info(f"[Cache HIT] {cache_key}")
        return cached

    # Fetch from API
    result = # ... existing code ...

    # Cache for 1 hour
    _dhis2_cache.set(cache_key, result, ttl=3600)
    return result
```

---

### Option 3: Background Pre-Loading (Proactive Caching)

**Concept:** Load frequently-accessed data in the background on server startup.

#### Implementation

**File:** `superset/initialization/__init__.py` (or create new module)

```python
import threading
import time
from superset.db_engine_specs.dhis2_dialect import _dhis2_cache

def preload_dhis2_data():
    """Background task to preload DHIS2 hierarchical data."""

    logger.info("[DHIS2 Preload] Starting background data preload")

    try:
        # Get DHIS2 database connections
        from superset.models.core import Database
        dhis2_dbs = Database.query.filter(Database.database_name.like('%dhis2%')).all()

        for db in dhis2_dbs:
            # Preload org unit hierarchy (all levels)
            logger.info(f"[DHIS2 Preload] Loading org unit hierarchy for {db.database_name}")

            # Fetch all levels
            for level in range(1, 6):  # Levels 1-5
                # Make API call to load into cache
                # ... call fetch methods which will populate cache ...

            # Preload GeoJSON for common levels
            for level in [2, 3]:  # Region, District
                # Fetch GeoJSON which will populate cache
                pass

        logger.info("[DHIS2 Preload] Background preload complete")

    except Exception as e:
        logger.error(f"[DHIS2 Preload] Error: {e}")

def start_background_preload():
    """Start background preload thread."""
    thread = threading.Thread(target=preload_dhis2_data, daemon=True)
    thread.start()

    # Schedule periodic refresh (every 6 hours)
    def refresh_loop():
        while True:
            time.sleep(6 * 3600)  # 6 hours
            preload_dhis2_data()

    refresh_thread = threading.Thread(target=refresh_loop, daemon=True)
    refresh_thread.start()

# Call on Superset startup
# Add to superset/__init__.py or app factory
# start_background_preload()
```

---

## Cache Invalidation Strategy

### When to Invalidate Cache

1. **Org Unit Hierarchy Changes:**
   - Manual invalidation via admin endpoint
   - Scheduled refresh (daily)

2. **GeoJSON Updates:**
   - Very rare (boundaries don't change often)
   - Manual invalidation only

3. **Analytics Data:**
   - Automatic TTL expiry (30 minutes)
   - Or invalidate on new data upload to DHIS2

### Invalidation Endpoint

**File:** `superset/databases/api.py`

```python
@expose("/<int:pk>/dhis2_cache/clear/", methods=("POST",))
@protect()
@safe
def dhis2_clear_cache(self, pk: int) -> Response:
    """Clear DHIS2 cache for this database."""

    try:
        # Clear Flask-Caching cache
        cache = Cache(current_app, config=current_app.config.get('CACHE_CONFIG', {}))

        # Clear all keys matching this database
        pattern = f"dhis2_*_{pk}_*"
        # ... implementation depends on cache backend ...

        # Or clear entire DHIS2 cache
        cache.clear()

        return self.response(200, message="DHIS2 cache cleared successfully")
    except Exception as ex:
        return self.response_500(message=str(ex))
```

---

## Performance Comparison

### Without Caching (Current)

```
Dashboard Load Sequence:
1. Fetch org levels:        1-2s
2. Fetch GeoJSON:          7-10s
3. Fetch analytics:         3-5s
4. Fetch filter options:    2-3s
─────────────────────────────────
Total:                    13-20s
```

### With Tier 1 Caching (After First Load)

```
Dashboard Load Sequence:
1. Fetch org levels:       <0.01s (cached)
2. Fetch GeoJSON:          <0.05s (cached)
3. Fetch analytics:         0.5-1s (partial cache)
4. Fetch filter options:   <0.01s (cached)
─────────────────────────────────
Total:                      0.5-1s

Improvement: 20-40x faster! 🚀
```

### With Background Preload

```
Dashboard Load Sequence:
1. Fetch org levels:       <0.01s (preloaded)
2. Fetch GeoJSON:          <0.01s (preloaded)
3. Fetch analytics:         0.5-1s (partial cache)
4. Fetch filter options:   <0.01s (preloaded)
─────────────────────────────────
Total:                      0.5-1s

First-time user experience: Same as returning user!
```

---

## Recommended Implementation Plan

### Phase 1: Quick Wins (1-2 hours)

1. ✅ Implement simple in-memory cache for org hierarchy
2. ✅ Cache GeoJSON responses (biggest bottleneck)
3. ✅ Add cache stats logging

**Expected improvement:** 5-10x faster after first load

### Phase 2: Production-Ready (Half day)

1. ✅ Set up Redis server
2. ✅ Integrate Flask-Caching
3. ✅ Add cache invalidation endpoints
4. ✅ Configure appropriate TTLs per data type

**Expected improvement:** 10-20x faster, cache shared across instances

### Phase 3: Advanced Optimization (1-2 days)

1. ✅ Implement background preloading
2. ✅ Add cache warming on server startup
3. ✅ Implement cache metrics dashboard
4. ✅ Add automatic cache refresh scheduling

**Expected improvement:** Near-instant load times even for first-time users

---

## Cache Key Design

### Best Practices

```python
# ✅ GOOD: Deterministic, sorted, includes all params
cache_key = f"dhis2_children_{db_id}_{'-'.join(sorted(parent_uids))}_{level}"

# ❌ BAD: Non-deterministic order
cache_key = f"dhis2_children_{'-'.join(parent_uids)}_{level}"

# ✅ GOOD: Include version for cache busting
cache_key = f"dhis2_v2_geojson_{level}_{parent}"

# ✅ GOOD: Hash long keys
import hashlib
params_hash = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()
cache_key = f"dhis2_analytics_{params_hash}"
```

---

## Monitoring Cache Performance

### Add Cache Metrics

```python
from flask import g

def track_cache_hit(key):
    if not hasattr(g, 'cache_hits'):
        g.cache_hits = []
    g.cache_hits.append(key)

def track_cache_miss(key):
    if not hasattr(g, 'cache_misses'):
        g.cache_misses = []
    g.cache_misses.append(key)

# Log at end of request
@app.after_request
def log_cache_stats(response):
    hits = len(getattr(g, 'cache_hits', []))
    misses = len(getattr(g, 'cache_misses', []))

    if hits or misses:
        hit_rate = hits / (hits + misses) * 100 if (hits + misses) > 0 else 0
        logger.info(f"[Cache Stats] Hits: {hits}, Misses: {misses}, Hit Rate: {hit_rate:.1f}%")

    return response
```

---

## Next Steps

1. **Choose caching approach:**
   - Quick start: Simple in-memory cache (Option 2)
   - Production: Redis + Flask-Caching (Option 1)

2. **Implement GeoJSON caching first** (biggest impact)

3. **Test and measure:**
   - Before: Dashboard load time
   - After: Dashboard load time
   - Cache hit rate

4. **Iterate:**
   - Tune TTLs based on data update frequency
   - Add more cached endpoints
   - Implement background preload

**Want me to implement any of these caching strategies?**
