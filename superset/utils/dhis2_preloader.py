# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file to You under
# the Apache License, Version 2.0 (the "License"); you may not use this
# file except in compliance with the License.  You may obtain a copy of the
# License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Background helper for DHIS2 metadata preloading and refresh requests."""

from __future__ import annotations

from collections import deque
from contextlib import nullcontext
import logging
from threading import Lock
from typing import Any

from flask import has_app_context

logger = logging.getLogger(__name__)

_REQUIRED_METADATA_TYPES = (
    "organisationUnitLevels",
    "organisationUnits",
    "legendSets",
    "geoJSON",
    "orgUnitHierarchy",
)

_global_preloader: DHIS2Preloader | None = None


def _merge_metadata_types(metadata_types: list[str] | None) -> list[str]:
    merged: list[str] = []
    for metadata_type in list(metadata_types or []) + list(_REQUIRED_METADATA_TYPES):
        candidate = str(metadata_type or "").strip()
        if candidate and candidate not in merged:
            merged.append(candidate)
    return merged


class DHIS2Preloader:
    """Coordinate background metadata preload and targeted refresh requests."""

    def __init__(
        self,
        *,
        refresh_interval: int = 300,
        app: Any | None = None,
    ) -> None:
        self._app = app
        self._refresh_interval = refresh_interval
        self._requested_refreshes: deque[dict[str, Any]] = deque()
        self._lock = Lock()

    def _app_context(self):
        if self._app is None or has_app_context():
            return nullcontext()
        return self._app.app_context()

    def _get_dhis2_databases(self) -> list[Any]:
        from superset import db
        from superset.models.core import Database

        with self._app_context():
            return (
                db.session.query(Database)
                .filter(Database.backend == "dhis2")
                .all()
            )

    def _preload_all_data(self) -> None:
        from superset.dhis2.metadata_staging_service import refresh_database_metadata

        with self._app_context():
            for database in self._get_dhis2_databases():
                try:
                    refresh_database_metadata(
                        database.id,
                        metadata_types=list(_REQUIRED_METADATA_TYPES),
                        reason="preload",
                    )
                except Exception:  # pylint: disable=broad-except
                    logger.warning(
                        "Failed to preload DHIS2 metadata for database id=%s",
                        getattr(database, "id", None),
                        exc_info=True,
                    )

    def request_refresh(
        self,
        *,
        database_id: int,
        instance_ids: list[int] | None = None,
        metadata_types: list[str] | None = None,
        reason: str = "manual",
    ) -> None:
        request_payload = {
            "database_id": database_id,
            "instance_ids": list(instance_ids or []),
            "metadata_types": _merge_metadata_types(metadata_types),
            "reason": reason,
        }
        with self._lock:
            self._requested_refreshes.append(request_payload)

    def _process_requested_refreshes(self) -> None:
        from superset.dhis2.metadata_staging_service import refresh_database_metadata

        while True:
            with self._lock:
                if not self._requested_refreshes:
                    return
                request_payload = self._requested_refreshes.popleft()

            with self._app_context():
                refresh_database_metadata(
                    request_payload["database_id"],
                    instance_ids=request_payload["instance_ids"],
                    metadata_types=request_payload["metadata_types"],
                    reason=request_payload["reason"],
                )


def get_dhis2_preloader(
    *,
    refresh_interval: int = 300,
    app: Any | None = None,
) -> DHIS2Preloader:
    """Return the process-wide DHIS2 preloader singleton."""
    global _global_preloader

    if _global_preloader is None:
        _global_preloader = DHIS2Preloader(
            refresh_interval=refresh_interval,
            app=app,
        )
        return _global_preloader

    _global_preloader._refresh_interval = refresh_interval
    if app is not None:
        _global_preloader._app = app
    return _global_preloader
