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
"""
DHIS2 Tracker Extractor

Fetches Tracker data (events, enrollments, tracked entities) from DHIS2
instances with full version awareness for DHIS2 2.38–2.42:

* DHIS2 ≥ 2.41  → new tracker API  (/api/tracker/events, /api/tracker/enrollments,
                                     /api/tracker/trackedEntities)
* DHIS2 2.38–2.40 → deprecated API (/api/events, /api/enrollments,
                                     /api/trackedEntityInstances)

Key field mapping differences between 2.40 and 2.41+:

| Field                | 2.40                      | 2.41+              |
|----------------------|---------------------------|--------------------|
| Events list key      | ``events``                | ``instances``      |
| Tracked entity UID   | ``trackedEntityInstance`` | ``trackedEntity``  |
| Paging               | ``pager.page`` / total    | ``pager.nextPage`` |
| Events endpoint      | ``/api/events``           | ``/api/tracker/events`` |
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from superset.dhis2.models import DHIS2Instance

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT = (30, 300)
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
_MAX_RETRIES = 3
_RETRY_BACKOFF_BASE = 2.0


def _parse_version(version_str: str | None) -> tuple[int, int]:
    """Parse a DHIS2 version string into (major, minor).

    Accepts formats like "2.40", "2.41.0", "2.42.1.1", or just "2.40".
    Returns (0, 0) if parsing fails.
    """
    if not version_str:
        return (0, 0)
    parts = str(version_str).strip().split(".")
    try:
        major = int(parts[0]) if len(parts) > 0 else 0
        minor = int(parts[1]) if len(parts) > 1 else 0
        return (major, minor)
    except (ValueError, IndexError):
        return (0, 0)


class DHIS2TrackerExtractor:
    """Fetches Tracker data from a single DHIS2 instance.

    Version detection drives endpoint and field-name selection:
    * (2, 41) or later → new ``/api/tracker/*`` endpoints
    * (2, 38) to (2, 40) → deprecated ``/api/events``, ``/api/enrollments``,
      ``/api/trackedEntityInstances`` endpoints
    """

    def __init__(self, instance: DHIS2Instance, dhis2_version: str | None = None) -> None:
        self._instance = instance
        self._base_url = instance.url.rstrip("/")
        self._version = _parse_version(dhis2_version)
        self._use_new_api = self._version >= (2, 41)

    # ------------------------------------------------------------------
    # Public methods
    # ------------------------------------------------------------------

    def fetch_events(
        self,
        *,
        program: str | None = None,
        program_stage: str | None = None,
        org_unit: str | None = None,
        ou_mode: str = "SELECTED",
        start_date: str | None = None,
        end_date: str | None = None,
        last_updated_duration: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """Fetch events with full pagination and version-aware normalisation."""
        if self._use_new_api:
            endpoint = f"{self._base_url}/api/tracker/events"
        else:
            endpoint = f"{self._base_url}/api/events"

        params: list[tuple[str, str]] = [("pageSize", str(page_size))]
        if program:
            params.append(("program", program))
        if program_stage:
            params.append(("programStage", program_stage))
        if org_unit:
            params.append(("orgUnit", org_unit))
        params.append(("ouMode", ou_mode))
        if start_date:
            params.append(("startDate", start_date))
        if end_date:
            params.append(("endDate", end_date))
        if last_updated_duration:
            params.append(("lastUpdatedDuration", last_updated_duration))

        if self._use_new_api:
            raw_rows = self._paginate_2_41(endpoint, params)
        else:
            raw_rows = self._paginate_2_40(endpoint, params, list_key="events")

        return [self._normalise_event_row(r) for r in raw_rows]

    def fetch_enrollments(
        self,
        *,
        program: str | None = None,
        org_unit: str | None = None,
        ou_mode: str = "SELECTED",
        start_date: str | None = None,
        end_date: str | None = None,
        last_updated_duration: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """Fetch enrollments with full pagination."""
        if self._use_new_api:
            endpoint = f"{self._base_url}/api/tracker/enrollments"
            list_key = "instances"
        else:
            endpoint = f"{self._base_url}/api/enrollments"
            list_key = "enrollments"

        params: list[tuple[str, str]] = [("pageSize", str(page_size))]
        if program:
            params.append(("program", program))
        if org_unit:
            params.append(("orgUnit", org_unit))
        params.append(("ouMode", ou_mode))
        if start_date:
            params.append(("startDate", start_date))
        if end_date:
            params.append(("endDate", end_date))
        if last_updated_duration:
            params.append(("lastUpdatedDuration", last_updated_duration))

        if self._use_new_api:
            return self._paginate_2_41(endpoint, params)
        return self._paginate_2_40(endpoint, params, list_key=list_key)

    def fetch_tracked_entities(
        self,
        *,
        tracked_entity_type: str | None = None,
        program: str | None = None,
        org_unit: str | None = None,
        ou_mode: str = "SELECTED",
        last_updated_duration: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """Fetch tracked entities with full pagination."""
        if self._use_new_api:
            endpoint = f"{self._base_url}/api/tracker/trackedEntities"
            list_key = "instances"
        else:
            endpoint = f"{self._base_url}/api/trackedEntityInstances"
            list_key = "trackedEntityInstances"

        params: list[tuple[str, str]] = [("pageSize", str(page_size))]
        if tracked_entity_type:
            params.append(("trackedEntityType", tracked_entity_type))
        if program:
            params.append(("program", program))
        if org_unit:
            params.append(("orgUnit", org_unit))
        params.append(("ouMode", ou_mode))
        if last_updated_duration:
            params.append(("lastUpdatedDuration", last_updated_duration))

        if self._use_new_api:
            return self._paginate_2_41(endpoint, params)
        return self._paginate_2_40(endpoint, params, list_key=list_key)

    # ------------------------------------------------------------------
    # Pagination helpers
    # ------------------------------------------------------------------

    def _paginate_2_40(
        self,
        endpoint: str,
        base_params: list[tuple[str, str]],
        list_key: str,
    ) -> list[dict[str, Any]]:
        """Numeric page-based pagination for DHIS2 ≤ 2.40.

        Uses ``?page=N`` increment until the returned list is shorter than
        ``pageSize`` (i.e., last page).
        """
        all_items: list[dict[str, Any]] = []
        page = 1
        page_size = int(dict(base_params).get("pageSize", 100))

        while True:
            params = list(base_params) + [("page", str(page))]
            data = self._do_request(endpoint, params)
            if data is None:
                break

            items = data.get(list_key, [])
            all_items.extend(items)

            pager = data.get("pager", {})
            total = pager.get("total")
            if total is not None:
                if len(all_items) >= int(total):
                    break
            if len(items) < page_size:
                break
            page += 1

        return all_items

    def _paginate_2_41(
        self,
        endpoint: str,
        base_params: list[tuple[str, str]],
    ) -> list[dict[str, Any]]:
        """Cursor-based pagination for DHIS2 ≥ 2.41.

        Uses ``pager.nextPage`` URL token; stops when absent.
        """
        all_items: list[dict[str, Any]] = []
        current_url: str | None = None
        params = list(base_params)

        while True:
            if current_url:
                # nextPage is the full URL; parse out its params
                data = self._do_request(current_url, [])
            else:
                data = self._do_request(endpoint, params)

            if data is None:
                break

            items = data.get("instances", [])
            all_items.extend(items)

            pager = data.get("pager", {})
            next_page = pager.get("nextPage")
            if not next_page:
                break
            current_url = next_page

        return all_items

    # ------------------------------------------------------------------
    # Row normalisation
    # ------------------------------------------------------------------

    def _normalise_event_row(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Map version-specific field names to a unified event schema.

        Unified fields:
        - ``event_uid``
        - ``tracked_entity_uid``  (harmonised from trackedEntityInstance / trackedEntity)
        - ``program_uid``, ``program_stage_uid``
        - ``org_unit_uid``
        - ``event_date``, ``due_date``
        - ``status``
        - ``created_at``, ``updated_at``
        - ``data_values`` (list of data value dicts)
        - ``coordinates`` (dict or None)
        """
        if self._use_new_api:
            te_uid = raw.get("trackedEntity")
        else:
            te_uid = raw.get("trackedEntityInstance")

        return {
            "event_uid": raw.get("event"),
            "tracked_entity_uid": te_uid,
            "program_uid": raw.get("program"),
            "program_stage_uid": raw.get("programStage"),
            "enrollment_uid": raw.get("enrollment"),
            "org_unit_uid": raw.get("orgUnit"),
            "event_date": raw.get("eventDate") or raw.get("occurredAt"),
            "due_date": raw.get("dueDate") or raw.get("scheduledAt"),
            "status": raw.get("status"),
            "created_at": raw.get("created") or raw.get("createdAt"),
            "updated_at": raw.get("lastUpdated") or raw.get("updatedAt"),
            "data_values": raw.get("dataValues", []),
            "coordinates": raw.get("coordinate") or raw.get("geometry"),
        }

    # ------------------------------------------------------------------
    # HTTP helper
    # ------------------------------------------------------------------

    def _do_request(
        self,
        url: str,
        params: list[tuple[str, str]],
    ) -> dict[str, Any] | None:
        """Execute a GET request with retry on transient errors."""
        headers = self._instance.get_auth_headers()
        headers["Accept"] = "application/json"

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                response = requests.get(
                    url,
                    params=params if params else None,
                    headers=headers,
                    timeout=_REQUEST_TIMEOUT,
                )
            except requests.Timeout:
                logger.warning(
                    "tracker request timed out (attempt %d/%d) url=%s",
                    attempt,
                    _MAX_RETRIES,
                    url,
                )
                if attempt < _MAX_RETRIES:
                    time.sleep(_RETRY_BACKOFF_BASE ** attempt)
                    continue
                return None
            except requests.RequestException as exc:
                logger.error(
                    "tracker request failed (attempt %d/%d) url=%s: %s",
                    attempt,
                    _MAX_RETRIES,
                    url,
                    exc,
                )
                return None

            if response.status_code == 200:
                try:
                    return response.json()
                except ValueError:
                    logger.error("tracker: non-JSON response from %s", url)
                    return None

            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < _MAX_RETRIES:
                logger.warning(
                    "tracker: retryable HTTP %d (attempt %d/%d) url=%s",
                    response.status_code,
                    attempt,
                    _MAX_RETRIES,
                    url,
                )
                time.sleep(_RETRY_BACKOFF_BASE ** attempt)
                continue

            logger.error(
                "tracker: HTTP %d from %s — body: %.500s",
                response.status_code,
                url,
                response.text,
            )
            return None

        return None
