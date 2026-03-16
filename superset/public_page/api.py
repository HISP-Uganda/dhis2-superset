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

from flask import current_app, Response
from flask_appbuilder.api import BaseApi, expose

from superset.extensions import event_logger

logger = logging.getLogger(__name__)


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

    def _merge_config(self, default: dict, override: dict) -> dict:
        """Deep merge configuration dictionaries."""
        result = default.copy()
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._merge_config(result[key], value)
            else:
                result[key] = value
        return result
