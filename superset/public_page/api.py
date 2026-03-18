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
"""Public Page Configuration API."""
from __future__ import annotations

import logging
import time
from typing import Any

from flask import current_app, request, Response
from flask_appbuilder.api import BaseApi, expose
from sqlalchemy import func, text

from superset.extensions import db, event_logger

logger = logging.getLogger(__name__)

# Simple in-process cache for indicator highlights.
# Avoids hitting the DB on every public page load; 3-minute TTL balances
# freshness with performance for a public read-only endpoint.
_HIGHLIGHTS_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_HIGHLIGHTS_CACHE_TTL = 180  # seconds


# Default configuration for public landing page
DEFAULT_PUBLIC_PAGE_CONFIG: dict = {
    "navbar": {
        "enabled": True,
        "height": 60,
        "backgroundColor": "#ffffff",
        "boxShadow": "0 2px 8px rgba(0, 0, 0, 0.1)",
        "logo": {
            "enabled": True,
            "alt": "Organization Logo",
            "height": 40,
        },
        "title": {
            "enabled": True,
            "text": "Malaria Repository Analytics",
            "fontSize": "18px",
            "fontWeight": 700,
            "color": "#1890ff",
        },
        "loginButton": {
            "enabled": True,
            "text": "Login",
            "url": "/login/",
            "type": "primary",
        },
        "customLinks": [],
    },
    "sidebar": {
        "enabled": True,
        "width": 280,
        "position": "left",
        "backgroundColor": "#ffffff",
        "borderStyle": "1px solid #f0f0f0",
        "title": "Categories",
        "collapsibleOnMobile": True,
        "mobileBreakpoint": 768,
    },
    "content": {
        "backgroundColor": "#f5f5f5",
        "padding": "0",
        "showWelcomeMessage": True,
        "welcomeTitle": "Welcome",
        "welcomeDescription": "Select a category from the sidebar to view dashboards.",
    },
    "footer": {
        "enabled": False,
        "height": 50,
        "backgroundColor": "#fafafa",
        "text": "",
        "textColor": "#666666",
        "links": [],
    },
}


class PublicPageRestApi(BaseApi):
    """API for public page configuration."""

    resource_name = "public_page"
    allow_browser_login = True

    @expose("/config", methods=("GET",))
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.get_config",
        log_to_statsd=False,
    )
    def get_config(self) -> Response:
        """Get public page layout configuration.
        ---
        get:
          summary: Get public page configuration
          description: >-
            Returns the configuration for the public landing page including
            navbar, sidebar, content area, and footer settings.
          responses:
            200:
              description: Public page configuration
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        description: The public page configuration
            500:
              $ref: '#/components/responses/500'
        """
        try:
            # Get configuration from app config, fall back to defaults
            config = current_app.config.get(
                "PUBLIC_PAGE_CONFIG", DEFAULT_PUBLIC_PAGE_CONFIG
            )

            # Deep merge with defaults to ensure all required fields exist
            merged_config = self._merge_config(DEFAULT_PUBLIC_PAGE_CONFIG, config)

            return self.response(200, result=merged_config)
        except Exception as ex:
            logger.error(f"Error fetching public page config: {ex}")
            return self.response_500(message=str(ex))

    @expose("/indicator_highlights", methods=("GET",))
    def indicator_highlights(self) -> Response:
        """Return latest indicator values from staged datasets for public display.
        ---
        get:
          summary: Get public indicator highlights
          description: >-
            Returns the most recent indicator observation per field per source
            instance from all active staged datasets. Used to populate the
            public landing page KPI band and live highlights section.
            No authentication required.
          parameters:
            - in: query
              name: limit
              schema:
                type: integer
                default: 20
              description: Maximum number of highlights to return
          responses:
            200:
              description: Indicator highlights
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: array
                      count:
                        type: integer
            500:
              $ref: '#/components/responses/500'
        """
        try:
            limit = min(int(request.args.get("limit", 20)), 100)
            now = time.monotonic()
            cached = _HIGHLIGHTS_CACHE
            if cached["data"] is not None and (now - cached["ts"]) < _HIGHLIGHTS_CACHE_TTL:
                highlights = cached["data"]
            else:
                highlights = self._fetch_indicator_highlights(limit)
                cached["data"] = highlights
                cached["ts"] = now
            return self.response(200, result=highlights, count=len(highlights))
        except Exception as ex:
            logger.warning("indicator_highlights error: %s", ex)
            return self.response(200, result=[], count=0)

    def _fetch_indicator_highlights(self, limit: int = 20) -> list[dict[str, Any]]:
        """Query latest staged observations per (field, instance)."""
        # Import here to avoid circular imports at module load
        from superset.staging.models import StagedDataset, StagedDatasetField, StageObservation
        from superset.dhis2.models import DHIS2Instance

        # Subquery: latest period_key per (dataset_field_id, source_instance_id)
        latest_sub = (
            db.session.query(
                StageObservation.dataset_field_id,
                StageObservation.source_instance_id,
                func.max(StageObservation.period_key).label("max_period"),
            )
            .filter(
                (StageObservation.value_numeric.isnot(None))
                | (StageObservation.value_text.isnot(None))
            )
            .group_by(
                StageObservation.dataset_field_id,
                StageObservation.source_instance_id,
            )
            .subquery()
        )

        rows = (
            db.session.query(
                StagedDatasetField.source_field_label,
                StagedDatasetField.dataset_alias,
                StagedDatasetField.canonical_metric_key,
                StagedDataset.name.label("dataset_name"),
                DHIS2Instance.name.label("instance_name"),
                StageObservation.period_key,
                StageObservation.value_numeric,
                StageObservation.value_text,
                StageObservation.ingested_at,
            )
            .join(
                StageObservation,
                (StageObservation.dataset_field_id == StagedDatasetField.id)
                & (
                    StageObservation.source_instance_id
                    == latest_sub.c.source_instance_id
                )
                & (StageObservation.period_key == latest_sub.c.max_period),
            )
            .join(latest_sub, (
                latest_sub.c.dataset_field_id == StagedDatasetField.id
            ))
            .join(StagedDataset, StagedDataset.id == StagedDatasetField.dataset_id)
            .outerjoin(
                DHIS2Instance,
                DHIS2Instance.id == StageObservation.source_instance_id,
            )
            .filter(
                StagedDataset.last_sync_status.in_(["success", "partial"]),
                (StageObservation.value_numeric.isnot(None))
                | (StageObservation.value_text.isnot(None)),
            )
            .order_by(StageObservation.ingested_at.desc())
            .limit(limit)
            .all()
        )

        results = []
        for row in rows:
            value = row.value_numeric
            display_value: str
            if value is not None:
                # Format: large numbers abbreviated, decimals to 1 dp
                if value >= 1_000_000:
                    display_value = f"{value / 1_000_000:.1f}M"
                elif value >= 1_000:
                    display_value = f"{value / 1_000:.1f}K"
                elif value == int(value):
                    display_value = f"{int(value):,}"
                else:
                    display_value = f"{value:.1f}"
            else:
                display_value = str(row.value_text or "—")

            results.append({
                "indicator_name": row.source_field_label or row.dataset_alias or "Indicator",
                "canonical_metric_key": row.canonical_metric_key,
                "dataset_name": row.dataset_name,
                "instance_name": row.instance_name or "National",
                "period": row.period_key or "—",
                "value_raw": value,
                "value": display_value,
                "ingested_at": row.ingested_at.isoformat() if row.ingested_at else None,
            })

        return results

    def _merge_config(self, default: dict, override: dict) -> dict:
        """Deep merge configuration dictionaries."""
        result = default.copy()
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._merge_config(result[key], value)
            else:
                result[key] = value
        return result
