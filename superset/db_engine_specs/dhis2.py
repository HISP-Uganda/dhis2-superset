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
DHIS2 Database Engine Specification
Allows connecting to DHIS2 instances via API with dynamic parameter support
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional, TYPE_CHECKING

import requests
from apispec import APISpec
from apispec.ext.marshmallow import MarshmallowPlugin
from flask_babel import gettext as __
from marshmallow import fields, Schema, validate

from superset.databases.schemas import EncryptedString
from superset.db_engine_specs.base import BaseEngineSpec
from superset.errors import ErrorLevel, SupersetError, SupersetErrorType
from sqlalchemy.dialects import registry

logger = logging.getLogger(__name__)

# Register DHIS2 dialect with SQLAlchemy at import time
registry.register("dhis2", "superset.db_engine_specs.dhis2_dialect", "DHIS2Dialect")
registry.register("dhis2.dhis2", "superset.db_engine_specs.dhis2_dialect", "DHIS2Dialect")

if TYPE_CHECKING:
    from superset.models.core import Database


class DHIS2ParametersSchema(Schema):
    """Schema for DHIS2 connection parameters"""

    # Custom authentication component - renders all auth-related fields
    # This triggers the rendering of our DHIS2AuthenticationFields component
    # which includes: host, authentication_type, username, password, access_token
    dhis2_authentication = fields.Str(
        required=False,
        allow_none=True,
        load_default=None,
        metadata={
            "description": __("DHIS2 Authentication"),
            "type": "custom"
        }
    )

    # Hidden fields - stored in backend but not rendered (custom component handles UI)
    # These are needed for the backend to receive the values
    # Note: These are NOT required at the schema level because the custom component handles validation
    host = fields.Str(
        required=False,
        allow_none=True,
        load_default=None,
        metadata={
            "description": __("DHIS2 server URL"),
            "placeholder": "https://play.dhis2.org/40.2.2",
            "x-hidden": True  # Don't render separately
        }
    )

    authentication_type = fields.Str(
        required=False,
        allow_none=True,
        validate=validate.OneOf(["basic", "pat"]),
        load_default="basic",
        metadata={
            "description": __("Authentication method"),
            "x-hidden": True  # Don't render separately
        }
    )

    username = fields.Str(
        required=False,
        allow_none=True,
        load_default=None,
        metadata={
            "description": __("DHIS2 username"),
            "x-hidden": True  # Don't render separately
        }
    )

    password = EncryptedString(
        required=False,
        allow_none=True,
        load_default=None,
        metadata={
            "description": __("DHIS2 password"),
            "x-hidden": True  # Don't render separately
        }
    )

    access_token = EncryptedString(
        required=False,
        allow_none=True,
        load_default=None,
        metadata={
            "description": __("Personal Access Token"),
            "x-hidden": True  # Don't render separately
        }
    )

    # Hide standard database fields that don't apply to DHIS2
    port = fields.Int(
        required=False,
        allow_none=True,
        load_default=None,
        metadata={
            "description": __("Port number"),
            "x-hidden": True  # DHIS2 uses HTTPS (443), not configurable
        }
    )

    database = fields.Str(
        required=False,
        allow_none=True,
        load_default=None,
        metadata={
            "description": __("Database name"),
            "x-hidden": True  # DHIS2 doesn't have database names
        }
    )

    # Dynamic default parameters - applies to ALL endpoints
    default_params = fields.Dict(
        keys=fields.Str(),
        values=fields.Str(),
        missing={},
        metadata={
            "description": __("Default query parameters applied to all API endpoints"),
            "example": {
                "displayProperty": "NAME",
                "orgUnit": "USER_ORGUNIT",
                "period": "LAST_YEAR"
            }
        }
    )

    # Dynamic endpoint-specific parameters
    endpoint_params = fields.Dict(
        keys=fields.Str(),
        values=fields.Dict(keys=fields.Str(), values=fields.Str()),
        missing={},
        metadata={
            "description": __("Endpoint-specific query parameters (key: endpoint name, value: params dict)"),
            "example": {
                "analytics": {
                    "dimension": "dx:fbfJHSPpUQD;pe:LAST_YEAR;ou:USER_ORGUNIT",
                    "skipMeta": "false"
                },
                "dataValueSets": {
                    "dataSet": "rmaYTmNPkVA",
                    "period": "202508",
                    "orgUnit": "FvewOonC8lS"
                },
                "trackedEntityInstances": {
                    "ou": "USER_ORGUNIT",
                    "program": "IpHINAT79UW"
                }
            }
        }
    )

    # API settings
    timeout = fields.Int(
        missing=60,
        validate=validate.Range(min=1, max=300),
        metadata={"description": __("Request timeout in seconds")}
    )
    page_size = fields.Int(
        missing=50,
        validate=validate.Range(min=1, max=10000),
        metadata={"description": __("Default page size for paginated endpoints")}
    )


class DHIS2EngineSpec(BaseEngineSpec):
    """Engine specification for DHIS2 API connections with dynamic parameter support"""

    engine = "dhis2"
    engine_name = "DHIS2"
    drivers = {"dhis2": "DHIS2 API driver"}

    # DHIS2 specific settings
    allows_joins = False
    allows_subqueries = False
    allows_sql_comments = True  # Allow comments for parameter injection
    allows_alias_in_select = False
    allows_alias_in_orderby = False
    allows_hidden_orderby_agg = True  # Allow ordering by aggregated columns in categorical charts
    disable_sql_parsing = True  # DHIS2 doesn't use real SQL - skip parsing validation

    # Dataset configuration - DHIS2 data is multi-dimensional, not strictly time-based
    # Allow datasets without datetime columns for categorical analysis
    requires_time_column = False  # Period is optional, can be used as filter or dimension
    time_groupby_inline = False  # Don't require time grouping
    supports_dynamic_schema = True  # Enable dataset preview and exploration

    # Disable automatic temporal rewriting while still advertising a valid raw-column
    # grain entry for shared engine-spec invariants.
    _time_grain_expressions = {None: "{col}"}

    # Enable dynamic parameter-based UI (form fields instead of SQLAlchemy URI)
    supports_dynamic_catalog = True  # Show form-based UI for connections

    # Display settings
    default_driver = "dhis2"
    parameters_schema = DHIS2ParametersSchema()
    sqlalchemy_uri_placeholder = (
        "dhis2://username:password@play.dhis2.org/api or "
        "dhis2://username:password@play.dhis2.org/instance/api"
    )

    # Encryption parameters for credentials
    encrypted_extra_sensitive_fields = frozenset([
        "password",
        "access_token",
        "$.auth_params.access_token",
    ])
    _dbapi_wrapper_patterns = (
        re.compile(r"^\(builtins\.[^)]+\)\s+None\s*", re.IGNORECASE | re.MULTILINE),
        re.compile(r"^\[SQL:\s*(.*?)\]\s*$", re.IGNORECASE | re.MULTILINE | re.DOTALL),
        re.compile(
            r"^\(Background on this error at:.*?\)\s*$",
            re.IGNORECASE | re.MULTILINE,
        ),
    )

    @classmethod
    def is_configured_connection_shell(
        cls,
        parameters: dict[str, Any] | None,
    ) -> bool:
        """
        Return ``True`` when the payload represents a logical DHIS2 database shell.

        In the multi-instance model the Superset ``Database`` acts as a logical
        container, while the actual DHIS2 endpoints and credentials live in child
        configured-connection records. In that mode the top-level DHIS2 database may
        intentionally omit ``host`` and credentials.
        """
        normalized = cls._extract_connection_settings(parameters or {})
        return (
            not normalized["host"]
            and not normalized["username"]
            and not normalized["password"]
            and not normalized["access_token"]
        )

    @classmethod
    def is_shell_sqlalchemy_uri(cls, uri: str | None) -> bool:
        """Return ``True`` when the URI represents a logical DHIS2 shell only."""
        return (uri or "").strip().lower() == "dhis2://"

    @classmethod
    def _extract_error_message(cls, ex: Exception) -> str:
        raw_message = super()._extract_error_message(ex)
        cleaned = raw_message.strip()
        for pattern in cls._dbapi_wrapper_patterns:
            cleaned = pattern.sub(
                lambda match: match.group(1) if match.lastindex else "",
                cleaned,
            ).strip()
        return cleaned or raw_message

    @classmethod
    def get_dbapi(cls):
        """
        Return the DBAPI module for DHIS2
        This allows connection creation without SQLAlchemy dialect registration
        """
        from superset.db_engine_specs.dhis2_dialect import DHIS2DBAPI
        return DHIS2DBAPI()

    @classmethod
    def parameters_json_schema(cls) -> Any:
        """
        Return configuration parameters as OpenAPI schema for frontend form rendering.
        This enables the dynamic form-based UI instead of SQLAlchemy URI text input.
        """
        if not cls.parameters_schema:
            return None

        spec = APISpec(
            title="Database Parameters",
            version="1.0.0",
            openapi_version="3.0.0",
            plugins=[MarshmallowPlugin()],
        )

        ma_plugin = MarshmallowPlugin()
        ma_plugin.init_spec(spec)

        # Add encrypted field properties helper if available
        try:
            from superset.databases.schemas import encrypted_field_properties
            ma_plugin.converter.add_attribute_function(encrypted_field_properties)
        except ImportError:
            pass

        spec.components.schema(cls.__name__, schema=cls.parameters_schema)
        return spec.to_dict()["components"]["schemas"][cls.__name__]

    @classmethod
    def build_sqlalchemy_uri(
        cls,
        parameters: dict[str, Any],
        encrypted_extra: dict[str, Any] | None = None,
    ) -> str:
        """
        Build SQLAlchemy URI from parameters

        This is called during:
        - Test connection
        - Connection creation/update
        - Parameter validation

        Args:
            parameters: Dict with host, authentication_type, username, password, access_token
            encrypted_extra: Encrypted parameters (not used for DHIS2)

        Returns:
            SQLAlchemy URI string in format:
            - Basic auth: dhis2://username:password@hostname/path/to/api
            - PAT: dhis2://:access_token@hostname/path/to/api
        """
        from urllib.parse import quote_plus, urlparse

        logger.info(f"[DHIS2] build_sqlalchemy_uri called with parameters: {list(parameters.keys())}")

        normalized = cls._extract_connection_settings(parameters)

        # Extract parameters
        host = normalized["host"]
        auth_type = normalized["authentication_type"]
        username = normalized["username"]
        password = normalized["password"]
        access_token = normalized["access_token"]

        logger.info(f"[DHIS2] host={host}, auth_type={auth_type}, has_username={bool(username)}, has_password={bool(password)}, has_token={bool(access_token)}")

        if cls.is_configured_connection_shell(parameters):
            logger.info("[DHIS2] Building logical database shell URI for configured child connections")
            return "dhis2://"

        if not host:
            logger.error("[DHIS2] No host provided in parameters")
            raise ValueError("DHIS2 server URL is required")

        # Parse the URL to extract hostname and path
        try:
            # Ensure URL has a scheme
            if not host.startswith(("http://", "https://")):
                host = f"https://{host}"

            parsed = urlparse(host)
            hostname = parsed.hostname
            netloc = hostname
            if parsed.port:
                netloc = f"{hostname}:{parsed.port}"
            path = parsed.path or ""

            if not hostname:
                logger.error(f"[DHIS2] Invalid hostname parsed from: {host}")
                raise ValueError("Invalid DHIS2 server URL")

            # Ensure path ends with /api
            if not path.endswith("/api"):
                path = path.rstrip("/") + "/api"

            # Build credentials part
            credentials = ""
            if auth_type == "basic":
                if not username:
                    logger.error("[DHIS2] Username is required for Basic Authentication")
                    raise ValueError("Username is required for Basic Authentication")
                if password:
                    credentials = f"{quote_plus(username)}:{quote_plus(password)}"
                else:
                    credentials = quote_plus(username)
            elif auth_type == "pat":
                if not access_token:
                    logger.error("[DHIS2] Access token is required for PAT authentication")
                    raise ValueError("Access token is required for PAT authentication")
                credentials = f":{quote_plus(access_token)}"

            # Build URI
            credentials_part = f"{credentials}@" if credentials else ""
            uri = f"dhis2://{credentials_part}{netloc}{path}"

            logger.info(f"[DHIS2] Built URI: dhis2://{credentials_part[:10]}...@{netloc}{path}")
            return uri

        except Exception as e:
            logger.error(f"[DHIS2] Failed to build URI: {str(e)}", exc_info=True)
            raise ValueError(f"Failed to build DHIS2 connection URI: {str(e)}") from e

    @classmethod
    def get_parameters_from_uri(
        cls,
        uri: str,
        encrypted_extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Extract parameters from a DHIS2 SQLAlchemy URI

        This is called when editing an existing DHIS2 connection to populate
        the form fields from the stored URI.

        Args:
            uri: SQLAlchemy URI (dhis2://username:password@hostname/path/to/api)
            encrypted_extra: Encrypted parameters (may contain password/token)

        Returns:
            Dict with host, authentication_type, username, password, access_token
        """
        from urllib.parse import unquote_plus, urlparse

        logger.info(f"[DHIS2] get_parameters_from_uri called")

        try:
            # Handle both string URI and URL objects (from make_url_safe)
            uri_str = str(uri) if not isinstance(uri, str) else uri
            parsed = urlparse(uri_str)

            # Extract hostname and path
            hostname = parsed.hostname
            netloc = hostname
            if parsed.port:
                netloc = f"{hostname}:{parsed.port}"
            path = parsed.path or "/api"

            # Remove /api suffix from path for display
            if path.endswith("/api"):
                path = path[:-4]

            # Build host URL
            host = f"https://{netloc}{path}" if netloc else ""

            # Extract credentials
            username = unquote_plus(parsed.username) if parsed.username else ""
            password = unquote_plus(parsed.password) if parsed.password else ""

            # Determine auth type
            # PAT format: dhis2://:token@hostname
            # Basic format: dhis2://username:password@hostname
            auth_type = "pat" if not username and password else "basic"

            parameters = {
                "host": host,
                "authentication_type": auth_type,
            }

            if auth_type == "basic":
                parameters["username"] = username
                parameters["password"] = password
            else:
                # For PAT, the password field contains the token
                parameters["access_token"] = password

            logger.info(f"[DHIS2] Extracted parameters: host={host}, auth_type={auth_type}")
            return parameters

        except Exception as e:
            logger.error(f"[DHIS2] Failed to extract parameters from URI: {str(e)}", exc_info=True)
            # Return empty parameters if extraction fails
            return {
                "host": "",
                "authentication_type": "basic",
                "username": "",
                "password": "",
                "access_token": "",
            }

    @classmethod
    def fetch_data(cls, cursor: Any, limit: int | None = None) -> list[tuple[Any, ...]]:
        """
        Fetch data with EXPLICIT dtype hints for Pandas DataFrame creation.

        Problem: Even though our cursor returns correct types, when Superset calls
        pd.read_sql(), Pandas RE-INFERS dtypes from the data values, causing:
        - DataElement "105- ..." to be treated as numeric
        - Pandas nanmean() trying to aggregate string columns

        Solution: Return data with dtype metadata that Pandas will respect.
        """
        import logging
        logger = logging.getLogger(__name__)

        # Call parent fetch_data to get rows
        data = super().fetch_data(cursor, limit)

        # Log what we're getting from the cursor
        if data:
            logger.info(f"[DHIS2] fetch_data: Got {len(data)} rows from cursor")
            logger.info(f"[DHIS2] fetch_data: First row: {data[0]}")

            # Get column names from cursor description
            if hasattr(cursor, 'description') and cursor.description:
                col_names = [desc[0] for desc in cursor.description]
                col_types = [desc[1] for desc in cursor.description]
                logger.info(f"[DHIS2] fetch_data: Columns: {col_names}")
                logger.info(f"[DHIS2] fetch_data: Types from cursor: {[t.__name__ if hasattr(t, '__name__') else str(t) for t in col_types]}")

        return data

    @staticmethod
    def convert_table_to_df(table: Any) -> "pd.DataFrame":
        """
        Override DataFrame conversion to FORCE correct dtypes after PyArrow conversion.

        Problem: PyArrow infers types from data values, causing:
        - "105- Total..." DataElement strings to be treated as numeric
        - "MOH - Uganda" OrgUnit strings causing "Could not convert string to numeric" errors
        - Pandas nanmean() trying to aggregate dimension columns

        Solution: After PyArrow creates the DataFrame, explicitly cast ALL dimension columns
        to object (string) dtype. This prevents ANY string column from being aggregated.

        This is THE FIX that prevents "Could not convert string to numeric" errors.
        """
        import pandas as pd
        import logging
        import pyarrow as pa

        logger = logging.getLogger(__name__)

        # Let PyArrow create the DataFrame (it will infer wrong types)
        try:
            df = table.to_pandas(integer_object_nulls=True)
        except pa.lib.ArrowInvalid:
            df = table.to_pandas(integer_object_nulls=True, timestamp_as_object=True)

        logger.info(f"[DHIS2] convert_table_to_df: DataFrame created with {len(df)} rows, {len(df.columns)} columns")
        logger.info(f"[DHIS2] convert_table_to_df: Columns: {df.columns.tolist()}")
        logger.info(f"[DHIS2] convert_table_to_df: Dtypes BEFORE fix: {df.dtypes.to_dict()}")

        # FORCE correct dtypes for DHIS2 columns
        # DIMENSION columns (categorical data) - MUST be object/string type to prevent aggregation errors
        # These should NEVER be treated as numeric, even if they contain numbers
        dimension_columns = [
            'Period', 'OrgUnit', 'DataElement',  # Standard DHIS2 dimensions
            'period', 'orgUnit', 'dataElement',  # Lowercase variants
            'pe', 'ou', 'dx',  # DHIS2 abbreviations
        ]

        for col in df.columns:
            col_lower = col.lower() if isinstance(col, str) else str(col).lower()

            # Check if this is a known dimension column
            is_dimension = col in dimension_columns or col_lower in [d.lower() for d in dimension_columns]

            # Also check if column contains string values that look like dimension data
            # (organization names, period names, etc.)
            if not is_dimension and not df.empty:
                try:
                    # Sample first non-null value
                    sample_val = df[col].dropna().iloc[0] if len(df[col].dropna()) > 0 else None
                    if sample_val is not None:
                        # If it's a string, treat as dimension, unless it's the 'value' column
                        if isinstance(sample_val, str):
                            if col.lower() != 'value':
                                is_dimension = True
                                logger.info(f"[DHIS2] Detected '{col}' as dimension (contains string and not named 'value')")
                except Exception:
                    pass  # Keep original type if detection fails

            if is_dimension:
                # Force to object dtype - this prevents aggregation errors
                df[col] = df[col].astype('object')
                logger.info(f"[DHIS2] convert_table_to_df: Forced column '{col}' to object dtype (dimension)")

        logger.info(f"[DHIS2] convert_table_to_df: Dtypes AFTER fix: {df.dtypes.to_dict()}")
        if not df.empty:
            logger.info(f"[DHIS2] convert_table_to_df: First row: {df.iloc[0].to_dict()}")

        return df

    @classmethod
    def get_dbapi_exception_mapping(cls) -> Dict[type[Exception], type[Exception]]:
        """Map DHIS2 API exceptions to database exceptions"""
        return {
            requests.exceptions.ConnectionError: Exception,
            requests.exceptions.Timeout: Exception,
            requests.exceptions.HTTPError: Exception,
        }

    @classmethod
    def _extract_connection_settings(cls, payload: Dict[str, Any]) -> Dict[str, str]:
        """Normalize legacy and current DHIS2 configuration keys."""

        raw_parameters = payload.get("parameters")
        config = raw_parameters if isinstance(raw_parameters, dict) else payload

        return {
            "host": str(config.get("host") or config.get("server") or "").strip(),
            "authentication_type": str(
                config.get("authentication_type") or config.get("auth_method") or "basic"
            ).strip()
            or "basic",
            "username": str(config.get("username") or "").strip(),
            "password": str(config.get("password") or ""),
            "access_token": str(config.get("access_token") or ""),
        }

    @classmethod
    def _build_request_target(cls, host_url: str) -> tuple[str, str]:
        """Return ``(netloc, base_url)`` for a DHIS2 API endpoint."""
        from urllib.parse import urlparse

        if not host_url:
            raise ValueError("DHIS2 URL is required")

        # Ensure URL has scheme
        if not host_url.startswith(("http://", "https://")):
            host_url = f"https://{host_url}"

        parsed_url = urlparse(host_url)
        hostname = parsed_url.hostname
        path = parsed_url.path or ""
        netloc = hostname
        if parsed_url.port:
            netloc = f"{hostname}:{parsed_url.port}"

        # Build API URL
        if not path.endswith("/api"):
            if path and not path.endswith("/"):
                path = f"{path}/api"
            elif path.endswith("/"):
                path = f"{path}api"
            else:
                path = "/api"

        if not netloc:
            raise ValueError("Invalid DHIS2 server URL")

        base_url = f"{parsed_url.scheme or 'https'}://{netloc}{path}"
        return netloc, base_url

    @classmethod
    def _build_auth(cls, config: Dict[str, str]) -> tuple[tuple[str, str] | None, Dict[str, str]]:
        """Translate normalized settings into ``requests`` auth and headers."""
        auth_type = config.get("authentication_type", "basic")

        if auth_type == "pat":
            # PAT authentication
            token = config.get("access_token", "")
            if not token:
                raise ValueError("Personal Access Token is required for PAT authentication")
            return None, {"Authorization": f"ApiToken {token}"}

        username = config.get("username", "")
        password = config.get("password", "")
        if not username or not password:
            raise ValueError("Username and password are required for Basic authentication")
        return (username, password), {}

    @classmethod
    def _probe_connection(cls, base_url: str, config: Dict[str, str]) -> bool:
        """Call ``/api/me`` and validate the response."""
        auth, headers = cls._build_auth(config)

        # Test connection by calling /api/me endpoint
        try:
            test_url = f"{base_url}/me"
            logger.info(f"Testing DHIS2 connection to: {test_url}")

            response = requests.get(
                test_url,
                auth=auth,
                headers=headers,
                timeout=10,
            )

            # Check response
            if response.status_code == 401:
                raise ValueError("Authentication failed. Please check your credentials.")
            elif response.status_code == 404:
                raise ValueError(f"DHIS2 API not found at {base_url}. Please check the URL.")
            elif response.status_code >= 400:
                reason = response.reason or response.text[:200]
                raise ValueError(
                    f"DHIS2 API returned HTTP {response.status_code}: {reason}"
                )

            response.raise_for_status()

            # Parse response to verify it's valid DHIS2
            data = response.json()
            if "userCredentials" not in data and "username" not in data:
                raise ValueError("Connected, but response doesn't look like DHIS2 API. Please check the URL.")

            # Success!
            logger.info(f"DHIS2 connection test successful: {data.get('displayName', 'User authenticated')}")
            return True

        except requests.exceptions.ConnectionError as e:
            raise ValueError(f"Cannot connect to {base_url}. Please check the URL and network connection.") from e
        except requests.exceptions.Timeout:
            raise ValueError(
                f"Connection to {base_url} timed out. The server may be slow or unreachable."
            )
        except requests.exceptions.RequestException as e:
            raise ValueError(f"Connection test failed: {str(e)}") from e

    @classmethod
    def parse_uri(cls, uri: str) -> Dict[str, Any]:
        """
        Parse DHIS2 connection URI with support for instance paths

        Format: dhis2://username:password@server.dhis2.org/api
        Or with instance: dhis2://username:password@server.dhis2.org/instance/api

        Examples:
        - dhis2://admin:district@tests.dhis2.hispuganda.org/hmis/api
        - dhis2://admin:district@play.dhis2.org/40.2.2/api
        """
        from urllib.parse import urlparse

        parsed = urlparse(uri)

        # For DHIS2 instances like play.dhis2.org/40.2.2/api
        # We need to extract the full path and determine the API endpoint
        # The path could be /40.2.2/api or just /api
        path = parsed.path or "/api"

        # If path doesn't end with /api, append it
        if not path.endswith("/api"):
            if not path.endswith("/"):
                path = f"{path}/api"
            else:
                path = f"{path}api"

        return {
            "username": parsed.username,
            "password": parsed.password,
            "host": parsed.hostname,
            "port": parsed.port or 443,
            "path": path,
        }


    @classmethod
    def validate_parameters(
        cls, parameters: Dict[str, Any]
    ) -> list[SupersetError]:
        """
        Validate connection parameters before saving - supports multiple auth methods
        """
        errors: list[SupersetError] = []
        config = cls._extract_connection_settings(parameters)

        if cls.is_configured_connection_shell(parameters):
            return errors

        # Server is always required
        if not config.get("host"):
            errors.append(
                SupersetError(
                    message=__("DHIS2 server URL is required"),
                    error_type=SupersetErrorType.CONNECTION_MISSING_PARAMETERS_ERROR,
                    level=ErrorLevel.ERROR,
                    extra={"missing": ["host"]},
                )
            )

        # Validate auth-specific parameters
        auth_method = config.get("authentication_type", "basic")

        if auth_method == "basic":
            # Basic auth requires username and password
            if not config.get("username"):
                errors.append(
                    SupersetError(
                        message=__("Username is required for basic authentication"),
                        error_type=SupersetErrorType.CONNECTION_MISSING_PARAMETERS_ERROR,
                        level=ErrorLevel.ERROR,
                        extra={"missing": ["username"]},
                    )
                )
            if not config.get("password"):
                errors.append(
                    SupersetError(
                        message=__("Password is required for basic authentication"),
                        error_type=SupersetErrorType.CONNECTION_MISSING_PARAMETERS_ERROR,
                        level=ErrorLevel.ERROR,
                        extra={"missing": ["password"]},
                    )
                )
        elif auth_method == "pat":
            # PAT requires access token
            if not config.get("access_token"):
                errors.append(
                    SupersetError(
                        message=__("Access token is required for PAT authentication"),
                        error_type=SupersetErrorType.CONNECTION_MISSING_PARAMETERS_ERROR,
                        level=ErrorLevel.ERROR,
                        extra={"missing": ["access_token"]},
                    )
                )

        return errors

    @classmethod
    def test_connection(
        cls,
        database: Database,
        ssh_tunnel: Any | None = None,
    ) -> bool:
        """
        Test DHIS2 connection by calling /api/me endpoint
        Supports both basic auth and PAT authentication

        This method is called BEFORE Superset tries to query tables,
        so we just verify authentication works.
        """
        try:
            parsed = cls.parse_uri(database.sqlalchemy_uri_decrypted)
            netloc = parsed["host"]
            if parsed.get("port") and parsed["port"] != 443:
                netloc = f"{netloc}:{parsed['port']}"
            base_url = f"https://{netloc}{parsed['path']}"

            # Determine auth method based on credentials
            username = parsed.get("username", "")
            password = parsed.get("password", "")

            config = {
                "authentication_type": "pat" if not username and password else "basic",
                "username": username or "",
                "password": password or "",
                "access_token": password or "",
            }
            return cls._probe_connection(base_url, config)
        except Exception as e:
            raise Exception(f"Connection test failed: {e}") from e

    @classmethod
    def get_schema_names(cls, database: Database) -> list[str]:
        """
        Return list of schema names (DHIS2 only has one default schema)
        """
        return ["dhis2"]

    @classmethod
    def get_table_names(
        cls, database: Database, inspector, schema: Optional[str]
    ) -> set[str]:
        """
        Return ONLY data query endpoints for DHIS2
        Excludes metadata endpoints (used by Query Builder) and configuration endpoints

        Note: This is called during connection test and dataset creation.
        Returns only the 5 core data query endpoints.
        """
        # Return ONLY data query endpoints (same as dialect)
        return {
            "analytics",              # Aggregated analytical data (MOST COMMON)
            "dataValueSets",          # Raw data entry values
            "events",                 # Tracker program events
            "trackedEntityInstances", # Tracked entities (people, assets)
            "enrollments",            # Program enrollments
        }

    @classmethod
    def get_extra_params(cls, database: Database, source=None) -> Dict[str, Any]:
        """
        Extra parameters to include in database metadata
        Includes dynamic DHIS2-specific configuration
        
        Timeout: DHIS2 queries can be slow due to large datasets
        - Default: 300 seconds (5 minutes) for analytics queries
        - Can be overridden per database in "extra" config
        """
        extra_params = {
            "engine_params": {
                "connect_args": {
                    # DHIS2 queries timeout at 60s by default, but many queries need more time
                    # Increased to 300s (5 minutes) for large dataset analysis
                    # Can be further customized per database
                    "timeout": 300,
                }
            }
        }

        # Add DHIS2-specific parameters from database configuration
        try:
            import json
            extra = json.loads(database.extra) if database.extra else {}
            
            # Allow overriding timeout per database
            if "timeout" in extra:
                extra_params["engine_params"]["connect_args"]["timeout"] = extra["timeout"]
            
            if "default_params" in extra:
                extra_params["default_params"] = extra["default_params"]
            if "endpoint_params" in extra:
                extra_params["endpoint_params"] = extra["endpoint_params"]
            if "page_size" in extra:
                extra_params["page_size"] = extra["page_size"]
        except Exception as e:
            logger.warning(f"Could not load DHIS2 extra params: {e}")

        return extra_params

    @classmethod
    def fetch_geo_features(
        cls,
        database: "Database",
        ou_params: str,
        display_property: str = "NAME",
        include_group_sets: bool = False,
    ) -> list[dict[str, Any]]:
        """
        Fetch geographic features from DHIS2 geoFeatures API.

        Args:
            database: Superset database instance
            ou_params: Organisation unit parameter (e.g., 'ou:LEVEL-2' or 'uid')
            display_property: Property to display (NAME or SHORTNAME)
            include_group_sets: Include org unit group information

        Returns:
            List of geoFeature objects from DHIS2
        """
        try:
            from superset.db_engine_specs.dhis2_dialect import DHIS2Dialect

            engine = database.get_sqla_engine()
            dialect = engine.dialect

            if not isinstance(dialect, DHIS2Dialect):
                raise ValueError("Database is not a DHIS2 instance")

            connection = engine.raw_connection()
            if hasattr(connection, "fetch_geo_features"):
                return connection.fetch_geo_features(
                    ou_params=ou_params,
                    display_property=display_property,
                    include_group_sets=include_group_sets,
                )
            else:
                raise ValueError("DHIS2 connection does not support geoFeatures API")
        except Exception as e:
            logger.exception(f"Failed to fetch geoFeatures: {e}")
            raise

    @classmethod
    def fetch_org_unit_levels(
        cls,
        database: "Database",
    ) -> list[dict[str, Any]]:
        """
        Fetch organisation unit level definitions from DHIS2.

        Args:
            database: Superset database instance

        Returns:
            List of organisationUnitLevel objects
        """
        try:
            from superset.db_engine_specs.dhis2_dialect import DHIS2Dialect

            engine = database.get_sqla_engine()
            dialect = engine.dialect

            if not isinstance(dialect, DHIS2Dialect):
                raise ValueError("Database is not a DHIS2 instance")

            connection = engine.raw_connection()
            if hasattr(connection, "fetch_org_unit_levels"):
                return connection.fetch_org_unit_levels()
            else:
                raise ValueError("DHIS2 connection does not support organisationUnitLevels API")
        except Exception as e:
            logger.exception(f"Failed to fetch organisation unit levels: {e}")
            raise

    @classmethod
    def fetch_data_values(
        cls,
        database: "Database",
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Fetch data values from DHIS2 dataValueSets API.

        Args:
            database: Superset database instance
            params: Dictionary of dataValueSets API parameters:
                - dataSet: Dataset UID (required)
                - orgUnit: Comma-separated org unit UIDs (required)
                - period: Comma-separated period codes (required)
                - dataElement: Comma-separated data element UIDs (optional)
                - children: 'true' to include child org units (optional)

        Returns:
            Dictionary with dataValues and metadata from DHIS2

        Note:
            Use concrete org unit UIDs and fixed period codes, not relative keywords.
            Relative periods (e.g., LAST_5_YEARS) and org unit keywords
            (e.g., USER_ORGUNIT_GRANDCHILDREN) are only supported in /api/analytics endpoints.
        """
        try:
            from superset.db_engine_specs.dhis2_dialect import DHIS2Dialect

            engine = database.get_sqla_engine()
            dialect = engine.dialect

            if not isinstance(dialect, DHIS2Dialect):
                raise ValueError("Database is not a DHIS2 instance")

            connection = engine.raw_connection()
            if hasattr(connection, "fetch_data_values"):
                return connection.fetch_data_values(params=params)
            else:
                raise ValueError("DHIS2 connection does not support dataValueSets API")
        except Exception as e:
            logger.exception(f"Failed to fetch data values: {e}")
            raise

    @classmethod
    def parse_sql(cls, sql: str, **kwargs: Any) -> list[str]:
        """
        DHIS2 doesn't use real SQL - it translates to API calls.
        Skip SQL parsing validation to avoid parse errors.
        Return the SQL as-is without parsing.
        """
        return [sql]

    @classmethod
    def select_star(  # pylint: disable=too-many-arguments
        cls,
        database: "Database",
        table: "Table",
        engine: "Engine",
        limit: int = 100,
        show_cols: bool = False,
        indent: bool = True,
        latest_partition: bool = True,
        cols: list | None = None,
    ) -> str:
        """
        Generate a SELECT query for DHIS2 data preview.

        For DHIS2, we generate a SQL-like query that the DHIS2 dialect can interpret
        and convert to an API call. The format is:

        SELECT * FROM table_name LIMIT 100

        The DHIS2 cursor will handle this and fetch data from the API.

        Args:
            database: Database instance
            table: Table instance (table.table is the endpoint name like 'analytics')
            engine: SQLAlchemy engine
            limit: Number of rows to return (default 100)
            show_cols: Whether to show specific columns
            indent: Whether to indent the query
            latest_partition: Not used for DHIS2
            cols: Specific columns to select

        Returns:
            SQL query string that DHIS2 dialect can interpret
        """
        table_name = table.table if hasattr(table, 'table') else str(table)

        # Generate a simple SELECT query that the DHIS2 cursor can parse
        # The cursor extracts the table name from FROM clause and makes API call
        if cols and show_cols:
            col_names = [col.get("column_name", col.get("name", "")) for col in cols if isinstance(col, dict)]
            if col_names:
                columns_str = ", ".join(col_names)
                sql = f"SELECT {columns_str} FROM {table_name}"
            else:
                sql = f"SELECT * FROM {table_name}"
        else:
            sql = f"SELECT * FROM {table_name}"

        if limit:
            sql += f" LIMIT {limit}"

        if indent:
            # Simple indentation
            sql = sql.replace("SELECT", "SELECT\n  ").replace("FROM", "\nFROM").replace("LIMIT", "\nLIMIT")

        return sql
