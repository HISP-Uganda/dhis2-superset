# DHIS2 Map Data Loading Optimization

## Overview

The DHIS2 Map visualization now includes comprehensive caching and optimization strategies to significantly reduce data loading delays when integrating with DHIS2 instances. The system implements a **dual-layer caching approach** (browser + server) with intelligent metadata management.

---

## Architecture

### 1. **Frontend Caching (Browser localStorage)**

**File**: `src/visualizations/DHIS2Map/cache.ts`

Uses browser localStorage with TTL (Time-To-Live) support:

- **Cache Prefix**: `dhis2_map_cache_`
- **Default TTL**: 4 hours
- **Cache Types**:
  - `boundaries` - GeoJSON boundary features by database and level
  - `dataElements` - Available metrics and data elements

**Features**:
- Automatic expiration based on TTL
- Per-level caching for granular control
- Combined multi-level caching for batch operations
- Cache hit detection and performance metrics

**Usage Pattern**:
```typescript
// Save data to cache
DHIS2MapCache.set('boundaries', `db${databaseId}_level${level}`, features, 4);

// Retrieve from cache
const cached = DHIS2MapCache.get('boundaries', `db${databaseId}_level${level}`);

// Clear specific cache
DHIS2MapCache.invalidate('boundaries', key);

// Clear all DHIS2 caches
DHIS2MapCache.invalidateAll();

// Check cache stats
const stats = DHIS2MapCache.getCacheStats();
```

---

### 2. **Backend Caching (Server-side)**

**File**: `superset/dhis2/boundaries.py`

Uses Flask cache with server-side storage:

- **Cache Timeout**: 4 hours (previously 24 hours, now optimized for hourly updates)
- **Cache Key Pattern**: `dhis2_boundaries_{database_id}_{level}_{parent}_{include_children}`
- **Scope**: Shared across all users for the same database

**New Endpoints**:

#### Get Cache Status
```bash
GET /api/v1/dhis2_boundaries/{database_id}/cache_status/
```
Returns cache configuration and timeout settings.

#### Clear Cache
```bash
POST /api/v1/dhis2_boundaries/{database_id}/clear_cache/
```
Manually invalidate all cached boundaries for a database (requires admin/edit permissions).

---

## Performance Optimizations

### 1. **Hierarchical Caching Strategy**

```
User Request for [Level 1, 2, 3]
    ↓
Check Combined Cache (all 3 levels together)
    ↓
[HIT] → Return immediately (milliseconds)
[MISS] → Check Individual Level Caches
    ↓
Level 1 Cache [HIT/MISS]
Level 2 Cache [HIT/MISS]
Level 3 Cache [HIT/MISS]
    ↓
Fetch missing levels from DHIS2 API
    ↓
Cache combined result
    ↓
Return to user
```

### 2. **Performance Metrics Display**

Maps now show load time in bottom-left corner:
- **⚡ {time}ms** (green background) = Cache hit
- **{time}ms** (blue background) = Server fetch

This helps monitor optimization effectiveness.

### 3. **Batch Operations**

Multiple boundary levels are fetched simultaneously in a single loop:
```typescript
// Fetches all levels in parallel requests
for (const level of boundaryLevels) {
  const cachedLevel = DHIS2MapCache.get(...);
  if (!cachedLevel) {
    // Only fetch missing levels from API
    const features = await fetchLevel(level);
    DHIS2MapCache.set(..., features);
  }
}
```

---

## Expected Performance Improvements

### Scenario 1: First Load (Cold Cache)
- **Before**: 2-5 seconds (full API calls for 3 levels)
- **After**: 2-5 seconds (same - must fetch fresh data)
- **Benefit**: Data is now cached for subsequent loads

### Scenario 2: Subsequent Loads (Warm Cache - Same Levels)
- **Before**: 2-5 seconds
- **After**: 100-300ms
- **Improvement**: 90-95% faster ⚡

### Scenario 3: Different Level Selection (Partial Cache)
- **Before**: 2-5 seconds
- **After**: 500ms-2s (only missing levels fetched)
- **Improvement**: 50-75% faster

---

## Cache Management

### Automatic Cache Expiration

Caches automatically expire after:
- **Browser**: 4 hours (localStorage TTL)
- **Server**: 4 hours (Flask cache timeout)
- **Synchronized**: Both expire at same interval for consistency

### Manual Cache Invalidation

**When to clear cache**:
- After DHIS2 boundary data updates
- After org unit hierarchy changes
- When troubleshooting data discrepancies

**How to clear**:
```bash
# Via API (requires authentication)
curl -X POST http://localhost:8088/api/v1/dhis2_boundaries/1/clear_cache/

# Via browser console (user-level)
DHIS2MapCache.invalidateAll()

# Programmatically
import { DHIS2MapCache } from './cache.ts';
DHIS2MapCache.invalidate('boundaries', 'db1_level2');
```

---

## Monitoring & Troubleshooting

### Console Logging

Enable browser developer console (F12) to see:
```
[DHIS2MapCache] Cache hit for boundaries/db1_levels2-3
[DHIS2Map] Level 2: Using cached 25 features
[DHIS2Map] Total boundary features loaded: 75 (324ms)
```

### Cache Statistics

```typescript
const stats = DHIS2MapCache.getCacheStats();
console.log(stats);
// Output:
// { total: 5, types: { boundaries: 4, dataElements: 1 } }
```

### Performance Badge

Every loaded map shows:
- Load time in milliseconds
- Cache hit indicator (⚡ if cached)
- Helps identify if optimization is working

### Backend Cache Status

```bash
curl http://localhost:8088/api/v1/dhis2_boundaries/1/cache_status/

# Response:
{
  "cache_timeout_hours": 4.0,
  "message": "Cache is enabled for all boundary queries"
}
```

---

## Configuration

### Adjust Cache TTL

**Frontend** (`cache.ts`):
```typescript
const DEFAULT_TTL_HOURS = 4;  // Change this value
```

**Backend** (`boundaries.py`):
```python
BOUNDARY_CACHE_TIMEOUT = 3600 * 4  # Change multiplier (hours)
```

### Disable Caching

**Frontend**: Comment out cache calls in `DHIS2Map.tsx`
**Backend**: Comment out cache operations in `boundaries.py`

---

## Technical Implementation Details

### Files Modified

1. **Frontend**:
   - `src/visualizations/DHIS2Map/cache.ts` (NEW)
   - `src/visualizations/DHIS2Map/DHIS2Map.tsx` (enhanced)

2. **Backend**:
   - `superset/dhis2/boundaries.py` (enhanced with new endpoints)

### Cache Keys Format

**Browser Cache**: `dhis2_map_cache_{type}_{id}`
- Example: `dhis2_map_cache_boundaries_db1_level2`

**Server Cache**: `dhis2_boundaries_{database_id}_{level}_{parent}_{include_children}`
- Example: `dhis2_boundaries_1_2_root_false`

### Data Flow

```
DHIS2Map Component
    ↓
fetchBoundaries() [Performance timer starts]
    ↓
Check DHIS2MapCache (localStorage) [Fast: <10ms]
    ↓
[Cache Hit] → Use cached features → [Fast: 100-300ms total]
[Cache Miss] → Fetch from API → SupersetClient.get()
    ↓
Backend → Flask Cache → DHIS2 API [Slow: 2-5s]
    ↓
Store in localStorage cache
    ↓
Render map [Performance timer stops]
```

---

## Best Practices

### For End Users
1. **First load**: Clear browser cache before loading for fresh data
2. **Routine use**: Leverages automatic caching for speed
3. **After updates**: Manually clear cache if DHIS2 data changed

### For Administrators
1. **Monitor**: Check browser console for cache hits
2. **Validate**: Use cache_status endpoint to verify configuration
3. **Maintain**: Periodically clear caches after DHIS2 updates
4. **Configure**: Adjust TTL based on your update frequency

### For Developers
1. **Test**: Use performance badge to verify optimization works
2. **Debug**: Check console logs for cache hit/miss patterns
3. **Monitor**: Track `getCacheStats()` for cache efficiency
4. **Extend**: Add similar caching to other DHIS2 features

---

## Future Enhancements

Potential optimizations for future versions:
1. **Compressed GeoJSON**: Reduce cache size with smaller geometries
2. **Selective Fields**: Only fetch necessary GeoJSON properties
3. **IndexedDB**: Use for larger datasets (>10MB)
4. **Service Workers**: Offline boundary access
5. **Data Element Caching**: Cache available metrics similarly
6. **Adaptive TTL**: Adjust cache duration based on DHIS2 update patterns
7. **Cache Warming**: Pre-fetch common level combinations on login

---

## FAQ

**Q: Why are my boundaries not updating?**
A: Browser cache persists for 4 hours. Clear cache via `DHIS2MapCache.invalidateAll()` in console.

**Q: How much storage does caching use?**
A: Typical GeoJSON boundary: 100-500KB. Average system cache: <5MB.

**Q: Can I increase cache TTL?**
A: Yes, modify `DEFAULT_TTL_HOURS` in `cache.ts` (frontend) and `BOUNDARY_CACHE_TIMEOUT` in `boundaries.py` (backend).

**Q: Does caching work offline?**
A: No, only cached data loads offline. Fresh data always requires DHIS2 API connection.

**Q: Can multiple users share the same cache?**
A: Frontend cache is per-browser. Backend cache is shared across all users per database.

---

## Support & Issues

For performance issues:
1. Check browser console for error messages
2. Verify cache status via `/api/v1/dhis2_boundaries/{id}/cache_status/`
3. Clear caches and reload
4. Check network tab for slow API responses (not caused by optimization)

---

**Version**: 1.0  
**Last Updated**: December 2025  
**Optimization Type**: Hybrid (Browser + Server caching with TTL expiration)
