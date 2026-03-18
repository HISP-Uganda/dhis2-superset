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
DHIS2 DataValueSets Extractor

Fetches raw aggregate data from the DHIS2 /api/dataValueSets endpoint.
The DHIS2 dataValueSets API requires repeated query parameters
(orgUnit=X&orgUnit=Y) rather than comma-separated values, so all parameter
construction uses list[tuple] rather than dict.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from superset.dhis2.models import DHIS2Instance

logger = logging.getLogger(__name__)

# Caller must chunk to stay within these limits before calling fetch().
_MAX_PERIODS_PER_REQUEST = 12
_MAX_OUS_PER_REQUEST = 50

# Timeout tuple: (connect_timeout_s, read_timeout_s).
# dataValueSets responses can be large and slow; allow 300 s read.
_REQUEST_TIMEOUT = (30, 300)

# HTTP status codes that are transient and worth retrying.
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
_MAX_RETRIES = 3
_RETRY_BACKOFF_BASE = 2.0  # seconds


class DHIS2DataValueExtractor:
    """Fetches data from the DHIS2 dataValueSets API for a single instance.

    Parameters
    ----------
    instance:
        The :class:`~superset.dhis2.models.DHIS2Instance` to query.
    """

    def __init__(self, instance: DHIS2Instance) -> None:
        self._instance = instance
        self._base_url = instance.url.rstrip("/")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fetch(
        self,
        *,
        data_sets: list[str] | None = None,
        data_element_groups: list[str] | None = None,
        periods: list[str] | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        last_updated: str | None = None,
        last_updated_duration: str | None = None,
        org_units: list[str] | None = None,
        org_unit_groups: list[str] | None = None,
        children: bool = False,
        id_scheme: str | None = None,
        response_format: str = "json",
    ) -> list[dict[str, Any]]:
        """Fetch data values from the DHIS2 dataValueSets endpoint.

        Callers are responsible for chunking ``periods`` and ``org_units``
        to ``_MAX_PERIODS_PER_REQUEST`` and ``_MAX_OUS_PER_REQUEST``
        respectively before calling this method.

        Returns a list of dataValue dicts as returned by the DHIS2 API.
        Returns an empty list on non-retryable failure (errors are logged).
        """
        params = self._build_params(
            data_sets=data_sets,
            data_element_groups=data_element_groups,
            periods=periods,
            start_date=start_date,
            end_date=end_date,
            last_updated=last_updated,
            last_updated_duration=last_updated_duration,
            org_units=org_units,
            org_unit_groups=org_unit_groups,
            children=children,
            id_scheme=id_scheme,
        )
        raw = self._do_request(params)
        if raw is None:
            return []
        return raw.get("dataValues", [])

    def fetch_incremental(
        self,
        *,
        data_sets: list[str],
        org_units: list[str],
        last_updated_duration: str,
    ) -> list[dict[str, Any]]:
        """Convenience wrapper for incremental/delta fetches.

        Fetches only records modified within ``last_updated_duration``
        (e.g. ``"7d"`` for last 7 days) for the given data sets and org units.
        Org units are automatically chunked to ``_MAX_OUS_PER_REQUEST``.
        """
        results: list[dict[str, Any]] = []
        for i in range(0, max(len(org_units), 1), _MAX_OUS_PER_REQUEST):
            chunk_ous = org_units[i : i + _MAX_OUS_PER_REQUEST]
            chunk = self.fetch(
                data_sets=data_sets,
                org_units=chunk_ous,
                last_updated_duration=last_updated_duration,
            )
            results.extend(chunk)
        return results

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_params(
        self,
        *,
        data_sets: list[str] | None,
        data_element_groups: list[str] | None,
        periods: list[str] | None,
        start_date: str | None,
        end_date: str | None,
        last_updated: str | None,
        last_updated_duration: str | None,
        org_units: list[str] | None,
        org_unit_groups: list[str] | None,
        children: bool,
        id_scheme: str | None,
    ) -> list[tuple[str, str]]:
        """Build the request parameter list.

        Uses ``list[tuple]`` (NOT a dict) because the dataValueSets API
        requires repeated parameters: ``orgUnit=X&orgUnit=Y``.  Using a dict
        would collapse duplicates and silently drop all but the last value.
        """
        params: list[tuple[str, str]] = []

        for ds in data_sets or []:
            params.append(("dataSet", ds))
        for deg in data_element_groups or []:
            params.append(("dataElementGroup", deg))
        for p in periods or []:
            params.append(("period", p))
        for ou in org_units or []:
            params.append(("orgUnit", ou))
        for oug in org_unit_groups or []:
            params.append(("orgUnitGroup", oug))

        if start_date:
            params.append(("startDate", start_date))
        if end_date:
            params.append(("endDate", end_date))
        if last_updated:
            params.append(("lastUpdated", last_updated))
        if last_updated_duration:
            params.append(("lastUpdatedDuration", last_updated_duration))
        if children:
            params.append(("children", "true"))
        if id_scheme:
            params.append(("idScheme", id_scheme))

        return params

    def _do_request(
        self, params: list[tuple[str, str]]
    ) -> dict[str, Any] | None:
        """Execute a GET request with retry on transient errors.

        Returns the parsed JSON response dict or ``None`` on terminal failure.
        """
        url = f"{self._base_url}/api/dataValueSets"
        headers = self._instance.get_auth_headers()
        headers["Accept"] = "application/json"

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                response = requests.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=_REQUEST_TIMEOUT,
                )
            except requests.Timeout:
                logger.warning(
                    "dataValueSets request timed out (attempt %d/%d) url=%s",
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
                    "dataValueSets request failed (attempt %d/%d) url=%s: %s",
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
                    logger.error(
                        "dataValueSets: non-JSON response from %s", url
                    )
                    return None

            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < _MAX_RETRIES:
                logger.warning(
                    "dataValueSets: retryable HTTP %d (attempt %d/%d) url=%s",
                    response.status_code,
                    attempt,
                    _MAX_RETRIES,
                    url,
                )
                time.sleep(_RETRY_BACKOFF_BASE ** attempt)
                continue

            logger.error(
                "dataValueSets: HTTP %d from %s — body: %.500s",
                response.status_code,
                url,
                response.text,
            )
            return None

        return None
