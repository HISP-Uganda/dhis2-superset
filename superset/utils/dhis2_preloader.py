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
"""Background preloader for scheduled DHIS2 metadata staging."""

from collections import defaultdict
import logging
import threading
import time
from typing import Any

from flask import Flask

logger = logging.getLogger(__name__)


class DHIS2Preloader:
    """Background task to stage DHIS2 metadata on startup and on schedule."""

    def __init__(self, refresh_interval: int = 21600, app: Flask | None = None):
        """Initialize DHIS2 preloader.

        Args:
            refresh_interval: Seconds between cache refresh (default 6 hours)
        """
        self._refresh_interval = refresh_interval
        self._app = app
        self._running = False
        self._thread: threading.Thread | None = None
        self._wake_event = threading.Event()
        self._request_lock = threading.Lock()
        self._requested_database_ids: set[int] = set()
        self._requested_instance_ids: dict[int, set[int]] = defaultdict(set)
        self._requested_metadata_types: dict[int, set[str]] = defaultdict(set)
        self._request_reasons: dict[int, str] = {}

    def configure(self, refresh_interval: int | None = None, app: Flask | None = None) -> None:
        """Update runtime configuration for the singleton preloader."""
        if refresh_interval is not None:
            self._refresh_interval = refresh_interval
        if app is not None:
            self._app = app

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
        self._wake_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("[DHIS2 Preloader] Stopped")

    def request_refresh(
        self,
        *,
        database_id: int,
        instance_ids: list[int] | None = None,
        metadata_types: list[str] | None = None,
        reason: str | None = None,
    ) -> None:
        """Queue an immediate metadata refresh for a database."""
        with self._request_lock:
            self._requested_database_ids.add(database_id)
            if instance_ids:
                self._requested_instance_ids[database_id].update(instance_ids)
            if metadata_types:
                self._requested_metadata_types[database_id].update(metadata_types)
            if reason:
                self._request_reasons[database_id] = reason
        self._wake_event.set()

    def _preload_loop(self) -> None:
        """Main preload loop - runs periodically."""
        time.sleep(5)
        self._preload_all_data()

        while self._running:
            triggered = self._wake_event.wait(timeout=self._refresh_interval)
            if not self._running:
                break
            if triggered:
                self._wake_event.clear()
                self._process_requested_refreshes()
            else:
                logger.info("[DHIS2 Preloader] Starting scheduled metadata refresh")
                self._preload_all_data()

    def _preload_all_data(self) -> None:
        """Refresh staged metadata for all DHIS2 databases."""
        start_time = time.time()
        logger.info(
            "[DHIS2 Preloader] ==================== Starting Metadata Refresh ===================="
        )

        try:
            if self._app is None:
                logger.warning("[DHIS2 Preloader] No Flask app configured; skipping preload")
                return

            with self._app.app_context():
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
                logger.info(
                    f"[DHIS2 Preloader] ==================== Metadata Refresh Complete ({elapsed:.1f}s) ===================="
                )

        except Exception as e:
            logger.exception(f"[DHIS2 Preloader] Fatal error during preload: {e}")

    def _process_requested_refreshes(self) -> None:
        if self._app is None:
            logger.warning("[DHIS2 Preloader] No Flask app configured; skipping requested refresh")
            return

        with self._request_lock:
            database_ids = list(self._requested_database_ids)
            requested_instance_ids = {
                database_id: sorted(instance_ids)
                for database_id, instance_ids in self._requested_instance_ids.items()
            }
            requested_metadata_types = {
                database_id: sorted(metadata_types)
                for database_id, metadata_types in self._requested_metadata_types.items()
            }
            request_reasons = dict(self._request_reasons)
            self._requested_database_ids.clear()
            self._requested_instance_ids.clear()
            self._requested_metadata_types.clear()
            self._request_reasons.clear()

        if not database_ids:
            return

        with self._app.app_context():
            for database_id in database_ids:
                try:
                    self._preload_database(
                        {
                            "id": database_id,
                            "name": f"DHIS2 database {database_id}",
                        },
                        instance_ids=requested_instance_ids.get(database_id),
                        metadata_types=requested_metadata_types.get(database_id),
                        reason=request_reasons.get(database_id) or "requested_refresh",
                    )
                except Exception:
                    logger.warning(
                        "[DHIS2 Preloader] Requested refresh failed for database id=%s",
                        database_id,
                        exc_info=True,
                    )

    def _get_dhis2_databases(self) -> list[dict[str, Any]]:
        """Get all DHIS2 databases from Superset.

        Returns:
            List of database info dicts
        """
        try:
            from superset.models.core import Database
            from superset.extensions import db

            databases = [
                database
                for database in db.session.query(Database).all()
                if database.backend == "dhis2"
            ]

            return [
                {
                    "id": database.id,
                    "name": database.database_name,
                    "uri": database.sqlalchemy_uri,
                }
                for database in databases
            ]

        except Exception as e:
            logger.error(f"[DHIS2 Preloader] Error fetching DHIS2 databases: {e}")
            return []

    def _preload_database(
        self,
        db_info: dict[str, Any],
        *,
        instance_ids: list[int] | None = None,
        metadata_types: list[str] | None = None,
        reason: str | None = None,
    ) -> None:
        """Refresh staged metadata for a single DHIS2 database.

        Args:
            db_info: Database information dict
        """
        from superset.dhis2.metadata_staging_service import (
            get_background_metadata_types,
            refresh_database_metadata,
        )

        db_id = db_info["id"]
        db_name = db_info["name"]
        background_metadata_types = get_background_metadata_types(metadata_types)

        logger.info(
            "[DHIS2 Preloader] Refreshing staged metadata for %s (id=%s)",
            db_name,
            db_id,
        )
        refresh_database_metadata(
            db_id,
            instance_ids=instance_ids,
            metadata_types=background_metadata_types,
            reason=reason or "preloader_refresh",
        )
        logger.info("[DHIS2 Preloader] Completed staged metadata refresh for %s", db_name)


# Global preloader instance
_global_preloader: DHIS2Preloader | None = None
_preloader_lock = threading.Lock()


def get_dhis2_preloader(
    refresh_interval: int = 21600,
    app: Flask | None = None,
) -> DHIS2Preloader:
    """Get or create global DHIS2 preloader instance.

    Args:
        refresh_interval: Seconds between cache refresh (default 6 hours)
        app: Flask application used for background app contexts

    Returns:
        Global DHIS2Preloader instance
    """
    global _global_preloader

    if _global_preloader is None:
        with _preloader_lock:
            if _global_preloader is None:
                _global_preloader = DHIS2Preloader(
                    refresh_interval=refresh_interval,
                    app=app,
                )

    if _global_preloader is not None:
        _global_preloader.configure(
            refresh_interval=refresh_interval,
            app=app,
        )

    return _global_preloader


def start_dhis2_preloader(
    refresh_interval: int = 21600,
    app: Flask | None = None,
) -> None:
    """Start DHIS2 background preloader.

    Args:
        refresh_interval: Seconds between cache refresh (default 6 hours)
        app: Flask application used for background app contexts
    """
    preloader = get_dhis2_preloader(refresh_interval=refresh_interval, app=app)
    preloader.start()


def stop_dhis2_preloader() -> None:
    """Stop DHIS2 background preloader."""
    global _global_preloader

    if _global_preloader:
        _global_preloader.stop()
