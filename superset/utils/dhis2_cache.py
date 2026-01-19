# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""DHIS2 caching utilities with TTL and metrics tracking."""

import logging
import time
from threading import Lock
from typing import Any, Dict, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    """Represents a cached value with expiry time."""
    value: Any
    expiry: float
    created_at: float
    key: str
    size_bytes: int = 0


@dataclass
class CacheMetrics:
    """Cache performance metrics."""
    hits: int = 0
    misses: int = 0
    sets: int = 0
    evictions: int = 0
    total_hit_time_ms: float = 0.0
    total_miss_time_ms: float = 0.0

    @property
    def hit_rate(self) -> float:
        """Calculate cache hit rate percentage."""
        total = self.hits + self.misses
        return (self.hits / total * 100) if total > 0 else 0.0

    @property
    def avg_hit_time_ms(self) -> float:
        """Average time for cache hits."""
        return (self.total_hit_time_ms / self.hits) if self.hits > 0 else 0.0

    @property
    def avg_miss_time_ms(self) -> float:
        """Average time for cache misses."""
        return (self.total_miss_time_ms / self.misses) if self.misses > 0 else 0.0


class DHIS2Cache:
    """Thread-safe TTL cache with metrics tracking for DHIS2 data."""

    def __init__(self, max_size_mb: int = 500, cleanup_interval: int = 300):
        """Initialize DHIS2 cache.

        Args:
            max_size_mb: Maximum cache size in megabytes (default 500 MB)
            cleanup_interval: Cleanup interval in seconds (default 5 minutes)
        """
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = Lock()
        self._max_size_bytes = max_size_mb * 1024 * 1024
        self._current_size_bytes = 0
        self._cleanup_interval = cleanup_interval
        self._last_cleanup = time.time()
        self._metrics = CacheMetrics()

        logger.info(f"[DHIS2 Cache] Initialized with max_size={max_size_mb}MB, cleanup_interval={cleanup_interval}s")

    def get(self, key: str) -> Optional[Any]:
        """Get cached value if not expired.

        Args:
            key: Cache key

        Returns:
            Cached value or None if not found/expired
        """
        start_time = time.time()

        with self._lock:
            if key in self._cache:
                entry = self._cache[key]

                # Check if expired
                if time.time() < entry.expiry:
                    elapsed_ms = (time.time() - start_time) * 1000
                    self._metrics.hits += 1
                    self._metrics.total_hit_time_ms += elapsed_ms

                    logger.debug(f"[DHIS2 Cache] HIT: {key} (age: {time.time() - entry.created_at:.1f}s, size: {entry.size_bytes:,} bytes)")
                    return entry.value
                else:
                    # Expired - remove it
                    self._evict_entry(key)
                    logger.debug(f"[DHIS2 Cache] EXPIRED: {key}")

        elapsed_ms = (time.time() - start_time) * 1000
        self._metrics.misses += 1
        self._metrics.total_miss_time_ms += elapsed_ms

        logger.debug(f"[DHIS2 Cache] MISS: {key}")
        return None

    def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        """Set cached value with TTL.

        Args:
            key: Cache key
            value: Value to cache
            ttl: Time to live in seconds (default 1 hour)
        """
        import sys

        size_bytes = sys.getsizeof(value)
        expiry = time.time() + ttl

        with self._lock:
            # Check if we need to evict old entries to make space
            self._ensure_space(size_bytes)

            # Remove old entry if exists
            if key in self._cache:
                self._evict_entry(key)

            # Add new entry
            entry = CacheEntry(
                value=value,
                expiry=expiry,
                created_at=time.time(),
                key=key,
                size_bytes=size_bytes
            )

            self._cache[key] = entry
            self._current_size_bytes += size_bytes
            self._metrics.sets += 1

            logger.info(f"[DHIS2 Cache] SET: {key} (ttl: {ttl}s, size: {size_bytes:,} bytes, total: {self._current_size_bytes:,}/{self._max_size_bytes:,})")

            # Periodic cleanup
            if time.time() - self._last_cleanup > self._cleanup_interval:
                self._cleanup_expired()

    def _ensure_space(self, needed_bytes: int) -> None:
        """Ensure there's enough space for new entry.

        Args:
            needed_bytes: Bytes needed for new entry
        """
        while self._current_size_bytes + needed_bytes > self._max_size_bytes and self._cache:
            # Evict oldest entry
            oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k].created_at)
            self._evict_entry(oldest_key)
            logger.warning(f"[DHIS2 Cache] EVICTED (size limit): {oldest_key}")

    def _evict_entry(self, key: str) -> None:
        """Remove entry from cache.

        Args:
            key: Cache key to evict
        """
        if key in self._cache:
            entry = self._cache[key]
            self._current_size_bytes -= entry.size_bytes
            del self._cache[key]
            self._metrics.evictions += 1

    def _cleanup_expired(self) -> None:
        """Remove all expired entries."""
        current_time = time.time()
        expired_keys = [
            key for key, entry in self._cache.items()
            if current_time >= entry.expiry
        ]

        for key in expired_keys:
            self._evict_entry(key)

        if expired_keys:
            logger.info(f"[DHIS2 Cache] Cleaned up {len(expired_keys)} expired entries")

        self._last_cleanup = current_time

    def clear(self, pattern: Optional[str] = None) -> int:
        """Clear cache entries.

        Args:
            pattern: Optional pattern to match keys (e.g., "geojson_*")

        Returns:
            Number of entries cleared
        """
        with self._lock:
            if pattern is None:
                # Clear all
                count = len(self._cache)
                self._cache.clear()
                self._current_size_bytes = 0
                logger.info(f"[DHIS2 Cache] CLEARED all {count} entries")
                return count
            else:
                # Clear matching pattern
                import fnmatch
                matching_keys = [k for k in self._cache.keys() if fnmatch.fnmatch(k, pattern)]

                for key in matching_keys:
                    self._evict_entry(key)

                logger.info(f"[DHIS2 Cache] CLEARED {len(matching_keys)} entries matching '{pattern}'")
                return len(matching_keys)

    def stats(self) -> Dict[str, Any]:
        """Get cache statistics.

        Returns:
            Dictionary with cache stats
        """
        with self._lock:
            current_time = time.time()
            active_entries = sum(1 for e in self._cache.values() if current_time < e.expiry)
            expired_entries = len(self._cache) - active_entries

            return {
                'total_entries': len(self._cache),
                'active_entries': active_entries,
                'expired_entries': expired_entries,
                'size_mb': self._current_size_bytes / (1024 * 1024),
                'max_size_mb': self._max_size_bytes / (1024 * 1024),
                'usage_percent': (self._current_size_bytes / self._max_size_bytes * 100) if self._max_size_bytes > 0 else 0,
                'hits': self._metrics.hits,
                'misses': self._metrics.misses,
                'hit_rate': self._metrics.hit_rate,
                'sets': self._metrics.sets,
                'evictions': self._metrics.evictions,
                'avg_hit_time_ms': self._metrics.avg_hit_time_ms,
                'avg_miss_time_ms': self._metrics.avg_miss_time_ms,
            }

    def get_keys(self, pattern: Optional[str] = None) -> list[str]:
        """Get all cache keys or keys matching pattern.

        Args:
            pattern: Optional pattern to match keys

        Returns:
            List of cache keys
        """
        with self._lock:
            if pattern is None:
                return list(self._cache.keys())
            else:
                import fnmatch
                return [k for k in self._cache.keys() if fnmatch.fnmatch(k, pattern)]

    def reset_metrics(self) -> None:
        """Reset cache metrics."""
        with self._lock:
            self._metrics = CacheMetrics()
            logger.info("[DHIS2 Cache] Metrics reset")


# Global cache instance
_global_cache: Optional[DHIS2Cache] = None
_cache_lock = Lock()


def get_dhis2_cache() -> DHIS2Cache:
    """Get or create global DHIS2 cache instance.

    Returns:
        Global DHIS2Cache instance
    """
    global _global_cache

    if _global_cache is None:
        with _cache_lock:
            if _global_cache is None:
                _global_cache = DHIS2Cache(max_size_mb=500, cleanup_interval=300)

    return _global_cache


# Cache TTL configurations (in seconds)
CACHE_TTL = {
    'geojson': 21600,       # 6 hours - geo boundaries rarely change
    'org_hierarchy': 3600,  # 1 hour - hierarchy changes rarely
    'org_levels': 7200,     # 2 hours - levels never change
    'analytics': 1800,      # 30 minutes - data updates periodically
    'filter_options': 3600, # 1 hour - filter options change rarely
    'name_to_uid': 3600,    # 1 hour - org unit names stable
}


def get_ttl(data_type: str) -> int:
    """Get TTL for data type.

    Args:
        data_type: Type of data (geojson, org_hierarchy, etc.)

    Returns:
        TTL in seconds
    """
    return CACHE_TTL.get(data_type, 3600)  # Default 1 hour
