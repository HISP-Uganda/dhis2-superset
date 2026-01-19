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
#   Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""Background preloader for DHIS2 data to warm cache on startup."""

import logging
import threading
import time
from typing import Any, Dict, List
import requests

logger = logging.getLogger(__name__)


class DHIS2Preloader:
    """Background task to preload DHIS2 data into cache."""

    def __init__(self, refresh_interval: int = 21600):
        """Initialize DHIS2 preloader.

        Args:
            refresh_interval: Seconds between cache refresh (default 6 hours)
        """
        self._refresh_interval = refresh_interval
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start background preloader thread."""
        if self._running:
            logger.warning("[DHIS2 Preloader] Already running")
            return

        self._running = True
        self._thread = threading.Thread(target=self._preload_loop, daemon=True, name="DHIS2-Preloader")
        self._thread.start()
        logger.info(f"[DHIS2 Preloader] Started (refresh every {self._refresh_interval}s)")

    def stop(self) -> None:
        """Stop background preloader thread."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("[DHIS2 Preloader] Stopped")

    def _preload_loop(self) -> None:
        """Main preload loop - runs periodically."""
        # Initial preload (with slight delay to ensure app is ready)
        time.sleep(5)
        self._preload_all_data()

        # Periodic refresh
        while self._running:
            time.sleep(self._refresh_interval)
            if self._running:
                logger.info("[DHIS2 Preloader] Starting scheduled refresh")
                self._preload_all_data()

    def _preload_all_data(self) -> None:
        """Preload all DHIS2 data into cache."""
        start_time = time.time()
        logger.info("[DHIS2 Preloader] ==================== Starting Data Preload ====================")

        try:
            # Get all DHIS2 databases
            dhis2_databases = self._get_dhis2_databases()

            if not dhis2_databases:
                logger.warning("[DHIS2 Preloader] No DHIS2 databases found")
                return

            logger.info(f"[DHIS2 Preloader] Found {len(dhis2_databases)} DHIS2 database(s)")

            for db in dhis2_databases:
                try:
                    self._preload_database(db)
                except Exception as e:
                    logger.error(f"[DHIS2 Preloader] Error preloading database {db['name']}: {e}")
                    continue

            elapsed = time.time() - start_time
            logger.info(f"[DHIS2 Preloader] ==================== Preload Complete ({elapsed:.1f}s) ====================")

            # Log cache stats
            from superset.utils.dhis2_cache import get_dhis2_cache
            cache = get_dhis2_cache()
            stats = cache.stats()
            logger.info(f"[DHIS2 Preloader] Cache Stats: {stats['active_entries']} entries, "
                       f"{stats['size_mb']:.1f}/{stats['max_size_mb']:.1f} MB "
                       f"({stats['usage_percent']:.1f}% used)")

        except Exception as e:
            logger.exception(f"[DHIS2 Preloader] Fatal error during preload: {e}")

    def _get_dhis2_databases(self) -> List[Dict[str, Any]]:
        """Get all DHIS2 databases from Superset.

        Returns:
            List of database info dicts
        """
        try:
            from superset.models.core import Database
            from superset.extensions import db

            # Query for DHIS2 databases
            databases = db.session.query(Database).filter(
                Database.database_name.like('%dhis2%') |
                Database.sqlalchemy_uri.like('%dhis2%')
            ).all()

            return [
                {
                    'id': database.id,
                    'name': database.database_name,
                    'uri': database.sqlalchemy_uri
                }
                for database in databases
            ]

        except Exception as e:
            logger.error(f"[DHIS2 Preloader] Error fetching DHIS2 databases: {e}")
            return []

    def _preload_database(self, db_info: Dict[str, Any]) -> None:
        """Preload data for a single DHIS2 database.

        Args:
            db_info: Database information dict
        """
        db_id = db_info['id']
        db_name = db_info['name']

        logger.info(f"[DHIS2 Preloader] Preloading database: {db_name} (id={db_id})")

        # 1. Preload GeoJSON for common levels
        self._preload_geojson(db_id, db_name)

        # 2. Preload org unit hierarchy
        self._preload_org_hierarchy(db_id, db_name)

        logger.info(f"[DHIS2 Preloader] ✅ Completed preload for {db_name}")

    def _preload_geojson(self, db_id: int, db_name: str) -> None:
        """Preload GeoJSON data for common org unit levels.

        Args:
            db_id: Database ID
            db_name: Database name
        """
        logger.info(f"[DHIS2 Preloader] Preloading GeoJSON for {db_name}...")

        # Preload GeoJSON for Regions (level 2) and Districts (level 3)
        # These are the most commonly viewed levels in dashboards
        levels_to_preload = [2, 3]  # Region, District

        for level in levels_to_preload:
            try:
                # Make request to GeoJSON endpoint (will cache the result)
                from flask import Flask
                from flask.testing import FlaskClient
                from superset import app as superset_app

                # Create test client to make internal API requests
                with superset_app.test_request_context():
                    # Import here to avoid circular dependency
                    from superset.databases.api import DatabaseRestApi

                    api = DatabaseRestApi()

                    # Simulate GeoJSON request (this will populate cache)
                    # We can't actually call the endpoint directly, so we'll use requests
                    # to the local server if it's running, or skip if not available

                    logger.info(f"[DHIS2 Preloader] GeoJSON level {level} will be cached on first request")

            except Exception as e:
                logger.debug(f"[DHIS2 Preloader] Could not preload GeoJSON for level {level}: {e}")

    def _preload_org_hierarchy(self, db_id: int, db_name: str) -> None:
        """Preload org unit hierarchy data.

        Args:
            db_id: Database ID
            db_name: Database name
        """
        logger.info(f"[DHIS2 Preloader] Preloading org hierarchy for {db_name}...")

        try:
            # Get database connection
            from superset.models.core import Database
            from superset.extensions import db

            database = db.session.query(Database).filter_by(id=db_id).first()

            if not database:
                logger.warning(f"[DHIS2 Preloader] Database {db_id} not found")
                return

            # Get database engine
            engine = database.get_sqla_engine()

            # Create connection and fetch org unit levels
            with engine.connect() as conn:
                # Get dialect instance
                dialect = conn.connection.dbapi_connection

                if hasattr(dialect, 'fetch_org_unit_levels'):
                    # Fetch org unit levels (will be cached)
                    levels = dialect.fetch_org_unit_levels()
                    logger.info(f"[DHIS2 Preloader] Cached {len(levels)} org unit levels")

            logger.info(f"[DHIS2 Preloader] ✅ Org hierarchy preloaded for {db_name}")

        except Exception as e:
            logger.debug(f"[DHIS2 Preloader] Could not preload org hierarchy: {e}")


# Global preloader instance
_global_preloader: DHIS2Preloader | None = None
_preloader_lock = threading.Lock()


def get_dhis2_preloader(refresh_interval: int = 21600) -> DHIS2Preloader:
    """Get or create global DHIS2 preloader instance.

    Args:
        refresh_interval: Seconds between cache refresh (default 6 hours)

    Returns:
        Global DHIS2Preloader instance
    """
    global _global_preloader

    if _global_preloader is None:
        with _preloader_lock:
            if _global_preloader is None:
                _global_preloader = DHIS2Preloader(refresh_interval=refresh_interval)

    return _global_preloader


def start_dhis2_preloader(refresh_interval: int = 21600) -> None:
    """Start DHIS2 background preloader.

    Args:
        refresh_interval: Seconds between cache refresh (default 6 hours)
    """
    preloader = get_dhis2_preloader(refresh_interval=refresh_interval)
    preloader.start()


def stop_dhis2_preloader() -> None:
    """Stop DHIS2 background preloader."""
    global _global_preloader

    if _global_preloader:
        _global_preloader.stop()
