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
DHIS2 SQLAlchemy Dialect
Enables DHIS2 API connections with dynamic parameter support
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any
import requests
from sqlalchemy.engine import default
from sqlalchemy import types

logger = logging.getLogger(__name__)


def sanitize_dhis2_column_name(name: str) -> str:
    """
    Sanitize DHIS2 column names for Superset compatibility.
    Replaces all special characters with underscores to prevent layout distortions.
    Must match the sanitization in _normalize_analytics_pivoted to ensure
    column names in metadata match column names in returned DataFrames.
    """
    name = re.sub(r'[^\w]', '_', name)
    name = re.sub(r'_+', '_', name)
    name = name.strip('_')
    return name


class DHIS2MappingDSL:
    """
    Simple JSONPath-like mapping DSL interpreter
    Supports basic path traversal and transforms without external dependencies
    """

    # Safe transform functions (no eval, only whitelisted functions)
    SAFE_TRANSFORMS = {
        "toNumber": lambda x: float(x) if x else None,
        "toInt": lambda x: int(x) if x else None,
        "toString": lambda x: str(x) if x is not None else "",
        "toUpper": lambda x: str(x).upper() if x else "",
        "toLower": lambda x: str(x).lower() if x else "",
        "trim": lambda x: str(x).strip() if x else "",
        "first": lambda x: x[0] if isinstance(x, list) and x else x,
        "last": lambda x: x[-1] if isinstance(x, list) and x else x,
        "length": lambda x: len(x) if x else 0,
        "sum": lambda x: sum(x) if isinstance(x, list) else x,
        "avg": lambda x: sum(x) / len(x) if isinstance(x, list) and x else 0,
        "join": lambda x: ",".join(str(i) for i in x) if isinstance(x, list) else str(x),
    }

    @classmethod
    def evaluate_path(cls, data: Any, path: str) -> list[Any]:
        """
        Evaluate JSONPath-like expression on data

        Supports:
        - Simple keys: "dataValues"
        - Nested keys: "dataValues.value"
        - Array indexing: "rows[0]"
        - Array wildcards: "dataValues[*]"
        - Array filters: "headers[?name='dx']"

        Returns list of matched values
        """
        if not path:
            return [data]

        parts = cls._parse_path(path)
        results = [data]

        for part in parts:
            results = cls._apply_part(results, part)

        return results

    @classmethod
    def _parse_path(cls, path: str) -> list[dict]:
        """Parse path into parts"""
        parts = []
        current = ""
        in_filter = False

        for char in path:
            if char == "[":
                if current:
                    parts.append({"type": "key", "value": current})
                    current = ""
                in_filter = True
                current = "["
            elif char == "]":
                current += "]"
                parts.append(cls._parse_bracket(current))
                current = ""
                in_filter = False
            elif char == "." and not in_filter:
                if current:
                    parts.append({"type": "key", "value": current})
                    current = ""
            else:
                current += char

        if current:
            parts.append({"type": "key", "value": current})

        return parts

    @classmethod
    def _parse_bracket(cls, bracket: str) -> dict:
        """Parse bracket expression like [0], [*], [?key='value']"""
        content = bracket[1:-1]

        if content == "*":
            return {"type": "wildcard"}
        elif content.isdigit():
            return {"type": "index", "value": int(content)}
        elif content.startswith("?"):
            # Simple filter: [?key='value'] or [?key="value"]
            filter_expr = content[1:]
            if "=" in filter_expr:
                key, value = filter_expr.split("=", 1)
                value = value.strip("'\"")
                return {"type": "filter", "key": key.strip(), "value": value}

        return {"type": "index", "value": 0}

    @classmethod
    def _apply_part(cls, results: list[Any], part: dict) -> list[Any]:
        """Apply a path part to current results"""
        new_results = []

        for item in results:
            if part["type"] == "key":
                # Simple key access
                if isinstance(item, dict):
                    value = item.get(part["value"])
                    if value is not None:
                        new_results.append(value)
                elif isinstance(item, list):
                    # Try to get key from each item in list
                    for sub_item in item:
                        if isinstance(sub_item, dict):
                            value = sub_item.get(part["value"])
                            if value is not None:
                                new_results.append(value)

            elif part["type"] == "index":
                # Array indexing
                if isinstance(item, list) and len(item) > part["value"]:
                    new_results.append(item[part["value"]])

            elif part["type"] == "wildcard":
                # Array wildcard
                if isinstance(item, list):
                    new_results.extend(item)
                else:
                    new_results.append(item)

            elif part["type"] == "filter":
                # Array filter
                if isinstance(item, list):
                    for sub_item in item:
                        if isinstance(sub_item, dict):
                            if sub_item.get(part["key"]) == part["value"]:
                                new_results.append(sub_item)

        return new_results

    @classmethod
    def apply_transform(cls, values: list[Any], transform: str) -> list[Any]:
        """Apply a transform function to values"""
        if transform not in cls.SAFE_TRANSFORMS:
            logger.warning(f"Unknown transform: {transform}, skipping")
            return values

        transform_fn = cls.SAFE_TRANSFORMS[transform]

        return [transform_fn(v) for v in values]

    @classmethod
    def apply_mapping(cls, data: dict, mapping: dict) -> Any:
        """
        Apply a mapping definition to data

        Mapping format:
        {
            "path": "dataValues[*].value",
            "transform": "toNumber",  # optional
            "default": None,  # optional
        }

        Returns first matched value or default
        """
        path = mapping.get("path", "")
        transform = mapping.get("transform")
        default = mapping.get("default")

        # Evaluate path
        results = cls.evaluate_path(data, path)

        # Apply transform if specified
        if transform and results:
            results = cls.apply_transform(results, transform)

        # Return first result or default
        return results[0] if results else default


class DHIS2EndpointDiscovery:
    """
    Dynamic endpoint discovery service with caching
    Queries /api/resources to fetch available endpoints
    """

    def __init__(self, base_url: str, auth: tuple | None, headers: dict, cache_ttl: int = 3600):
        """
        Initialize endpoint discovery service

        Args:
            base_url: DHIS2 API base URL (e.g., https://play.dhis2.org/api)
            auth: Authentication tuple (username, password) or None for PAT
            headers: HTTP headers (includes Authorization for PAT)
            cache_ttl: Cache time-to-live in seconds (default 1 hour)
        """
        self.base_url = base_url
        self.auth = auth
        self.headers = headers
        self.cache_ttl = cache_ttl
        self._cache = {}
        self._cache_time = None

    def discover_endpoints(self) -> list[str]:
        """
        Discover available DHIS2 API endpoints dynamically
        Falls back to static list if /api/resources is unavailable
        """
        # Check cache
        if self._is_cache_valid():
            logger.debug("Using cached endpoints")
            return self._cache.get("endpoints", self._get_fallback_endpoints())

        try:
            # Query DHIS2 /api/resources endpoint
            response = requests.get(
                f"{self.base_url}/resources",
                auth=self.auth,
                headers=self.headers,
                timeout=10,
            )

            if response.status_code == 200:
                data = response.json()
                resources = data.get("resources", [])

                # Extract endpoint names from resources
                endpoints = []
                for resource in resources:
                    # Resource structure: {"singular": "dataElement", "plural": "dataElements"}
                    if isinstance(resource, dict):
                        plural = resource.get("plural")
                        if plural:
                            endpoints.append(plural)
                    elif isinstance(resource, str):
                        endpoints.append(resource)

                # Add core analytics endpoints that might not be in resources
                core_endpoints = ["analytics", "dataValueSets"]
                for endpoint in core_endpoints:
                    if endpoint not in endpoints:
                        endpoints.append(endpoint)

                # Update cache
                self._cache["endpoints"] = endpoints
                self._cache_time = datetime.now()

                logger.info(f"Discovered {len(endpoints)} DHIS2 endpoints dynamically")
                return endpoints

        except Exception as e:
            logger.warning(f"Could not discover endpoints from /api/resources: {e}")

        # Fallback to static list
        return self._get_fallback_endpoints()

    def _is_cache_valid(self) -> bool:
        """Check if cache is still valid based on TTL"""
        if not self._cache_time:
            return False
        age = (datetime.now() - self._cache_time).total_seconds()
        return age < self.cache_ttl

    def _get_fallback_endpoints(self) -> list[str]:
        """Static fallback list when dynamic discovery fails"""
        return [
            # Core analytics and data endpoints
            "analytics",
            "dataValueSets",
            "trackedEntityInstances",
            "events",
            "enrollments",
            # Metadata resources
            "dataElements",
            "dataSets",
            "indicators",
            "organisationUnits",
            "programs",
            "programStages",
            "programIndicators",
            # Other useful resources
            "categoryOptionCombos",
            "optionSets",
            "validationRules",
            "predictors",
        ]


class DHIS2ResponseNormalizer:
    """
    Endpoint-aware response normalizer
    Converts DHIS2 API responses into tabular format
    """

    @staticmethod
    def extract_source_table_from_sql(sql: str) -> str | None:
        """
        Extract the DHIS2 source table from SQL comment or table name pattern

        Supports:
        1. SQL comment format: /* DHIS2: table=analytics&... */
        2. Table name pattern: analytics_version2 -> analytics

        Args:
            sql: SQL query string

        Returns:
            Source table name (e.g., "analytics") or None
        """
        # First try to extract from SQL comment
        table_match = re.search(r'/\*\s*DHIS2:.*table=([^&\s]+)', sql, re.IGNORECASE)
        if table_match:
            return table_match.group(1).strip()

        # Fallback: Parse from table name in FROM clause
        from_match = re.search(r'FROM\s+(\w+)', sql, re.IGNORECASE)
        if from_match:
            table_name = from_match.group(1)
            # If it contains underscore, take first part (e.g., analytics_version2 -> analytics)
            if '_' in table_name:
                return table_name.split('_')[0]
            return table_name

        return None

    @staticmethod
    def _normalize_analytics_long_format(headers: list, rows_data: list, get_name_func, org_unit_hierarchy: dict | None = None, selected_levels: list[int] | None = None) -> tuple[list[str], list[tuple]]:
        """
        Return analytics data in LONG/UNPIVOTED format

        Format: Period, OrgUnit, DataElement, Value

        This format prevents string concatenation issues when Pandas does aggregation.
        Each row represents one data point.
        """
        # Find column indices
        col_map = {}
        for idx, h in enumerate(headers):
            col_map[h.get("name", h.get("column"))] = idx

        dx_idx = col_map.get("dx")
        pe_idx = col_map.get("pe")
        ou_idx = col_map.get("ou")
        value_idx = col_map.get("value")

        # Column names for long format - ALL columns MUST be SANITIZED
        col_names = [sanitize_dhis2_column_name(col) for col in ["Period", "OrgUnit", "DataElement", "Value"]]

        # Build rows in long format
        long_rows = []
        for row in rows_data:
            pe_name = get_name_func(row[pe_idx]) if pe_idx is not None else None
            ou_name = get_name_func(row[ou_idx]) if ou_idx is not None else None
            dx_name = get_name_func(row[dx_idx]) if dx_idx is not None else None
            value = row[value_idx] if value_idx is not None else None

            # Convert value to appropriate type
            if value is not None:
                try:
                    value = float(value)
                    if value.is_integer():
                        value = int(value)
                except (ValueError, AttributeError):
                    pass  # Keep as string

            long_rows.append((pe_name, ou_name, dx_name, value))

        logger.info(f"Returned LONG format: {len(long_rows)} rows (Period, OrgUnit, DataElement, Value)")
        return col_names, long_rows

    @staticmethod
    def normalize_analytics(data: dict, pivot: bool = True, org_unit_hierarchy: dict | None = None, selected_levels: list[int] | None = None, org_unit_level_names: dict | None = None) -> tuple[list[str], list[tuple]]:
        """
        Normalize analytics endpoint response with hierarchical org unit enrichment

        Args:
            data: DHIS2 analytics API response
            pivot: If True, return WIDE format (pivoted). If False, return LONG/TIDY format (unpivoted)
            org_unit_hierarchy: Dict mapping org unit IDs to their hierarchy info
            selected_levels: List of org unit levels (always uses [1,2,3,4,5,6] for complete hierarchy)

        Formats:
        - WIDE (pivoted): Period, OrgUnit, Level_1_Name, Level_2_Name, DataElement_A, DataElement_B, ...
          Traditional format for browsing with hierarchy
        - LONG/TIDY (unpivoted): Period, OrgUnit, DataElement, Value
          Better for Superset - enables filters, metrics, cross-filters
          This is used by default for analytics endpoint

        Returns:
            Tuple of (column_names, rows)
        """
        headers = data.get("headers", [])
        rows_data = data.get("rows", [])
        metadata = data.get("metaData", {})

        if not rows_data:
            return ["Period", "OrgUnit"], []

        # Map UIDs to readable names from metadata
        items = metadata.get("items", {})

        def get_name(uid: str) -> str:
            """Get human-readable name for UID"""
            item = items.get(uid, {})
            return item.get("name", uid)

        # If not pivoting, return long format immediately
        if not pivot:
            print(f"[DHIS2] normalize_analytics: pivot={pivot}, using LONG format")
            logger.info(f"normalize_analytics called with pivot={pivot}, returning LONG format")
            return DHIS2ResponseNormalizer._normalize_analytics_long_format(headers, rows_data, get_name)

        print(f"[DHIS2] normalize_analytics: pivot={pivot}, using WIDE/PIVOTED format")
        logger.info(f"normalize_analytics called with pivot={pivot}, returning WIDE format")

        # Ensure columns for analytics/dataValueSets endpoints are always wide format
        # Each dx (data element) is a separate column, not a single 'dataElement' column
        # Update normalization logic to pivot data and map values to columns
        # Fix undefined values by mapping backend columns to frontend fields

        # Find column indices - handle missing dimensions
        col_map = {}
        for idx, h in enumerate(headers):
            col_map[h.get("name", h.get("column"))] = idx

        dx_idx = col_map.get("dx")
        pe_idx = col_map.get("pe")
        ou_idx = col_map.get("ou")
        value_idx = col_map.get("value")

        # Check if we have all required dimensions for pivoting
        has_full_dimensions = dx_idx is not None and pe_idx is not None and ou_idx is not None

        if not has_full_dimensions:
            # Simplified format - just return as-is with readable column names
            # ALL columns MUST be SANITIZED
            col_names = []
            for h in headers:
                name = h.get("name", h.get("column", "value"))
                if name == "dx":
                    col_names.append(sanitize_dhis2_column_name("Data"))
                elif name == "value":
                    col_names.append(sanitize_dhis2_column_name("Value"))
                else:
                    col_names.append(sanitize_dhis2_column_name(name))

            # Convert rows, mapping dx UIDs to names
            converted_rows = []
            for row in rows_data:
                converted_row = []
                for idx, val in enumerate(row):
                    if idx == dx_idx and val:
                        converted_row.append(get_name(val))
                    else:
                        converted_row.append(val)
                converted_rows.append(tuple(converted_row))

            return col_names, converted_rows

        # Full pivot logic - we have dx, pe, ou, value
        # Collect all unique data elements, periods, org units
        data_elements = set()
        periods = set()
        org_units = set()

        for row in rows_data:
            if len(row) > max(dx_idx, pe_idx, ou_idx):
                data_elements.add(row[dx_idx])
                periods.add(row[pe_idx])
                org_units.add(row[ou_idx])

        # Build pivot structure: {(period, orgUnit): {dataElement: value}}
        pivot_data = {}
        for row in rows_data:
            if len(row) > max(dx_idx, pe_idx, ou_idx, value_idx):
                dx = row[dx_idx]
                pe = row[pe_idx]
                ou = row[ou_idx]
                val = row[value_idx]

                # Convert string values to numbers for numeric data
                if val is not None and val != '':
                    try:
                        # Try float first (handles both int and float)
                        val = float(val)
                        # Convert to int if it's a whole number
                        if val.is_integer():
                            val = int(val)
                    except (ValueError, AttributeError):
                        # Keep as string if conversion fails
                        pass

                key = (pe, ou)
                if key not in pivot_data:
                    pivot_data[key] = {}
                pivot_data[key][dx] = val

        # Build column names: Period, Level_1_Name, Level_2_Name, ..., DataElement_1, DataElement_2, ...
        # IMPORTANT: ALL columns MUST be SANITIZED to match column metadata from get_columns()!
        # This ensures consistency between:
        # 1. Dataset metadata (stored in DB) - uses sanitize_dhis2_column_name()
        # 2. Chart formData (user selections) - references sanitized names
        # 3. Query results (this function) - must return sanitized names
        # Note: OrgUnit column removed - hierarchy levels provide the granular context
        data_element_list = sorted(data_elements)
        col_names = [sanitize_dhis2_column_name("Period")]
        
        if org_unit_level_names is None:
            org_unit_level_names = {}
        
        # Only include levels that are actually available in DHIS2
        if org_unit_level_names:
            for level in sorted(org_unit_level_names.keys()):
                level_name = org_unit_level_names.get(level)
                col_names.append(sanitize_dhis2_column_name(level_name))
        else:
            # Fallback to 6 levels if not specified
            for level in range(1, 7):
                level_name = f"Level_{level}_Name"
                col_names.append(sanitize_dhis2_column_name(level_name))
        
        col_names.extend([sanitize_dhis2_column_name(get_name(de)) for de in data_element_list])

        print(f"[DHIS2] PIVOT CONSTRUCTION:")
        print(f"[DHIS2]   data_elements (UIDs): {sorted(data_elements)}")
        print(f"[DHIS2]   data_element_list (sorted UIDs): {data_element_list}")
        print(f"[DHIS2]   col_names (SANITIZED): {col_names}")
        logger.info(f"[DHIS2] Column construction - data_elements: {sorted(data_elements)}")
        logger.info(f"[DHIS2] Column names constructed (SANITIZED): {col_names}")

        # Build rows
        pivoted_rows = []
        for (pe, ou) in sorted(pivot_data.keys()):
            pe_name = get_name(pe)

            # Debug logging to identify concatenation
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug(f"Pivoting row - PE UID: {pe}, PE name: {pe_name}, OU UID: {ou}")

            row = [pe_name]
            
            # Append hierarchy values for available levels only
            if org_unit_level_names:
                levels_to_append = sorted(org_unit_level_names.keys())
            else:
                levels_to_append = list(range(1, 7))
            
            if org_unit_hierarchy and ou:
                try:
                    hierarchy_info = org_unit_hierarchy.get(ou, {})
                    # Debug: Log hierarchy info for first few rows
                    if len(pivoted_rows) < 3:
                        print(f"[DHIS2] Row {len(pivoted_rows)}: OU={ou}, hierarchy_info={hierarchy_info}")
                    for level in levels_to_append:
                        level_name = hierarchy_info.get(f"level_{level}", None)
                        row.append(level_name)
                except Exception as e:
                    logger.warning(f"Error appending hierarchy for {ou}: {e}")
                    row.extend([None] * len(levels_to_append))
            else:
                if len(pivoted_rows) < 3:
                    print(f"[DHIS2] Row {len(pivoted_rows)}: OU={ou}, NO HIERARCHY (org_unit_hierarchy={bool(org_unit_hierarchy)})")
                row.extend([None] * len(levels_to_append))
            
            for de in data_element_list:
                value = pivot_data[(pe, ou)].get(de, None)
                row.append(value)
            
            pivoted_rows.append(tuple(row))
            
            if len(pivoted_rows) == 1:
                logger.info(f"[DHIS2] FIRST ROW CONSTRUCTION:")
                logger.info(f"[DHIS2]   Period (index 0): {row[0]}")
                data_element_start_idx = 1 + len(levels_to_append)
                for i, de in enumerate(data_element_list):
                    de_idx = data_element_start_idx + i
                    logger.info(f"[DHIS2]   {get_name(de)} (index {de_idx}): {row[de_idx]}")

        # Log first few rows for debugging
        if pivoted_rows and logger.isEnabledFor(logging.INFO):
            logger.info(f"First pivoted row - Period: '{pivoted_rows[0][0]}'")
            logger.info(f"[DHIS2] Total pivoted rows: {len(pivoted_rows)}, columns: {len(col_names)}")

        return col_names, pivoted_rows

    @staticmethod
    def normalize_data_value_sets(data: dict, org_unit_hierarchy: dict | None = None, selected_levels: list[int] | None = None, org_unit_level_names: dict | None = None) -> tuple[list[str], list[tuple]]:
        """
        Normalize dataValueSets endpoint response with hierarchical org unit enrichment

        Args:
            data: DHIS2 dataValueSets API response
            org_unit_hierarchy: Dict mapping org unit IDs to their parent hierarchy info
            selected_levels: List of org unit levels to include as columns (e.g., [1, 2, 3])

        Returns:
            Tuple of (column_names, rows)
        """
        data_values = data.get("dataValues", [])

        if org_unit_level_names is None:
            org_unit_level_names = {}

        if not data_values:
            col_names = [sanitize_dhis2_column_name(col) for col in ["dataElement", "period", "value"]]
            if org_unit_level_names:
                for level in sorted(org_unit_level_names.keys()):
                    level_name = org_unit_level_names.get(level)
                    col_names.append(sanitize_dhis2_column_name(level_name))
            else:
                for level in range(1, 7):
                    col_names.append(sanitize_dhis2_column_name(f"Level_{level}_Name"))
            return col_names, []

        col_names = [sanitize_dhis2_column_name(col) for col in ["dataElement", "period", "value"]]
        
        if org_unit_level_names:
            for level in sorted(org_unit_level_names.keys()):
                level_name = org_unit_level_names.get(level)
                col_names.append(sanitize_dhis2_column_name(level_name))
        else:
            for level in range(1, 7):
                col_names.append(sanitize_dhis2_column_name(f"Level_{level}_Name"))

        rows = []
        
        # Determine which levels to append
        if org_unit_level_names:
            levels_to_append = sorted(org_unit_level_names.keys())
        else:
            levels_to_append = list(range(1, 7))
        
        for dv in data_values:
            row = [
                dv.get("dataElement"),
                dv.get("period"),
                dv.get("value"),
            ]
            
            if org_unit_hierarchy and dv.get("orgUnit"):
                try:
                    org_unit_id = dv.get("orgUnit")
                    hierarchy_info = org_unit_hierarchy.get(org_unit_id, {})
                    for level in levels_to_append:
                        level_name = hierarchy_info.get(f"level_{level}", None)
                        row.append(level_name)
                except Exception as e:
                    logger.warning(f"Error appending hierarchy for {dv.get('orgUnit')}: {e}")
                    row.extend([None] * len(levels_to_append))
            else:
                row.extend([None] * len(levels_to_append))
            
            rows.append(tuple(row))

        return col_names, rows

    @staticmethod
    def normalize_events(
        data: dict,
        org_unit_hierarchy: dict | None = None,
        org_unit_level_names: dict | None = None,
    ) -> tuple[list[str], list[tuple]]:
        """
        Normalize events endpoint response
        Flattens nested dataValues structure and enriches with org unit hierarchy

        Args:
            data: DHIS2 events API response
            org_unit_hierarchy: Dict mapping org unit IDs to their hierarchy info
            org_unit_level_names: Dict mapping level numbers to level names

        Returns:
            Tuple of (column_names, rows)
        """
        events = data.get("events", [])

        if not events:
            # ALL columns MUST be SANITIZED
            base_cols = ["event", "program", "orgUnit", "eventDate"]
            return [sanitize_dhis2_column_name(col) for col in base_cols], []

        # Extract base columns - ALL MUST be SANITIZED
        base_cols = ["event", "program", "programStage", "enrollment", "trackedEntityInstance"]

        # Build column names with hierarchy levels
        col_names = [sanitize_dhis2_column_name(col) for col in base_cols]

        # Add org unit hierarchy level columns
        if org_unit_level_names:
            for level in sorted(org_unit_level_names.keys()):
                level_name = org_unit_level_names.get(level)
                col_names.append(sanitize_dhis2_column_name(level_name))
        else:
            # Fallback to 6 levels if not specified
            for level in range(1, 7):
                level_name = f"Level_{level}_Name"
                col_names.append(sanitize_dhis2_column_name(level_name))

        # Add date and status columns
        col_names.extend([sanitize_dhis2_column_name(col) for col in ["eventDate", "dueDate", "status", "created", "lastUpdated"]])

        # Collect all unique dataElement IDs from all events
        data_element_ids = set()
        for event in events:
            for dv in event.get("dataValues", []):
                data_element_ids.add(dv.get("dataElement"))

        # Add data element columns
        col_names.extend([sanitize_dhis2_column_name(de_id) for de_id in sorted(data_element_ids)])

        rows = []
        for event in events:
            ou_id = event.get("orgUnit")

            row = [
                event.get("event"),
                event.get("program"),
                event.get("programStage"),
                event.get("enrollment"),
                event.get("trackedEntityInstance"),
            ]

            # Add hierarchy values
            if org_unit_level_names:
                levels_to_append = sorted(org_unit_level_names.keys())
            else:
                levels_to_append = list(range(1, 7))

            if org_unit_hierarchy and ou_id:
                hierarchy_info = org_unit_hierarchy.get(ou_id, {})
                for level in levels_to_append:
                    level_value = hierarchy_info.get(f"level_{level}", None)
                    row.append(level_value)
            else:
                for _ in levels_to_append:
                    row.append(None)

            # Add date and status values
            row.extend([
                event.get("eventDate"),
                event.get("dueDate"),
                event.get("status"),
                event.get("created"),
                event.get("lastUpdated"),
            ])

            # Build dict of dataElement -> value
            dv_dict = {
                dv.get("dataElement"): dv.get("value")
                for dv in event.get("dataValues", [])
            }

            # Append values for each dataElement column
            for de_id in sorted(data_element_ids):
                row.append(dv_dict.get(de_id))

            rows.append(tuple(row))

        return col_names, rows

    @staticmethod
    def normalize_tracked_entity_instances(
        data: dict,
        org_unit_hierarchy: dict | None = None,
        org_unit_level_names: dict | None = None,
    ) -> tuple[list[str], list[tuple]]:
        """
        Normalize trackedEntityInstances endpoint response
        Flattens nested attributes structure and enriches with org unit hierarchy

        Args:
            data: DHIS2 trackedEntityInstances API response
            org_unit_hierarchy: Dict mapping org unit IDs to their hierarchy info
            org_unit_level_names: Dict mapping level numbers to level names

        Returns:
            Tuple of (column_names, rows)
        """
        teis = data.get("trackedEntityInstances", [])

        if not teis:
            # ALL columns MUST be SANITIZED
            return [sanitize_dhis2_column_name(col) for col in ["trackedEntityInstance", "orgUnit", "trackedEntityType"]], []

        # Extract base columns - ALL MUST be SANITIZED
        base_cols = ["trackedEntityInstance", "trackedEntityType"]

        # Build column names
        col_names = [sanitize_dhis2_column_name(col) for col in base_cols]

        # Add org unit hierarchy level columns
        if org_unit_level_names:
            for level in sorted(org_unit_level_names.keys()):
                level_name = org_unit_level_names.get(level)
                col_names.append(sanitize_dhis2_column_name(level_name))
        else:
            # Fallback to 6 levels if not specified
            for level in range(1, 7):
                level_name = f"Level_{level}_Name"
                col_names.append(sanitize_dhis2_column_name(level_name))

        # Add timestamp columns
        col_names.extend([sanitize_dhis2_column_name(col) for col in ["created", "lastUpdated", "inactive"]])

        # Collect all unique attribute IDs
        attribute_ids = set()
        for tei in teis:
            for attr in tei.get("attributes", []):
                attribute_ids.add(attr.get("attribute"))

        # Add attribute columns
        col_names.extend([sanitize_dhis2_column_name(attr_id) for attr_id in sorted(attribute_ids)])

        rows = []
        for tei in teis:
            ou_id = tei.get("orgUnit")

            row = [
                tei.get("trackedEntityInstance"),
                tei.get("trackedEntityType"),
            ]

            # Add hierarchy values
            if org_unit_level_names:
                levels_to_append = sorted(org_unit_level_names.keys())
            else:
                levels_to_append = list(range(1, 7))

            if org_unit_hierarchy and ou_id:
                hierarchy_info = org_unit_hierarchy.get(ou_id, {})
                for level in levels_to_append:
                    level_value = hierarchy_info.get(f"level_{level}", None)
                    row.append(level_value)
            else:
                for _ in levels_to_append:
                    row.append(None)

            # Add timestamp and status values
            row.extend([
                tei.get("created"),
                tei.get("lastUpdated"),
                tei.get("inactive"),
            ])

            # Build dict of attribute -> value
            attr_dict = {
                attr.get("attribute"): attr.get("value")
                for attr in tei.get("attributes", [])
            }

            # Append values for each attribute column
            for attr_id in sorted(attribute_ids):
                row.append(attr_dict.get(attr_id))

            rows.append(tuple(row))

        return col_names, rows

    @staticmethod
    def normalize_enrollments(
        data: dict,
        org_unit_hierarchy: dict | None = None,
        org_unit_level_names: dict | None = None,
    ) -> tuple[list[str], list[tuple]]:
        """
        Normalize enrollments endpoint response
        Flattens nested attributes structure and enriches with org unit hierarchy

        Args:
            data: DHIS2 enrollments API response
            org_unit_hierarchy: Dict mapping org unit IDs to their hierarchy info
            org_unit_level_names: Dict mapping level numbers to level names

        Returns:
            Tuple of (column_names, rows)
        """
        enrollments = data.get("enrollments", [])

        if not enrollments:
            # ALL columns MUST be SANITIZED
            return [sanitize_dhis2_column_name(col) for col in ["enrollment", "program", "orgUnit", "enrollmentDate"]], []

        # Extract base columns - ALL MUST be SANITIZED
        base_cols = ["enrollment", "trackedEntityInstance", "program"]

        # Build column names
        col_names = [sanitize_dhis2_column_name(col) for col in base_cols]

        # Add org unit hierarchy level columns
        if org_unit_level_names:
            for level in sorted(org_unit_level_names.keys()):
                level_name = org_unit_level_names.get(level)
                col_names.append(sanitize_dhis2_column_name(level_name))
        else:
            # Fallback to 6 levels if not specified
            for level in range(1, 7):
                level_name = f"Level_{level}_Name"
                col_names.append(sanitize_dhis2_column_name(level_name))

        # Add date and status columns
        col_names.extend([sanitize_dhis2_column_name(col) for col in ["enrollmentDate", "incidentDate", "status", "created", "lastUpdated"]])

        # Collect all unique attribute IDs from all enrollments
        attribute_ids = set()
        for enrollment in enrollments:
            for attr in enrollment.get("attributes", []):
                attribute_ids.add(attr.get("attribute"))

        # Add attribute columns
        col_names.extend([sanitize_dhis2_column_name(attr_id) for attr_id in sorted(attribute_ids)])

        rows = []
        for enrollment in enrollments:
            ou_id = enrollment.get("orgUnit")

            row = [
                enrollment.get("enrollment"),
                enrollment.get("trackedEntityInstance"),
                enrollment.get("program"),
            ]

            # Add hierarchy values
            if org_unit_level_names:
                levels_to_append = sorted(org_unit_level_names.keys())
            else:
                levels_to_append = list(range(1, 7))

            if org_unit_hierarchy and ou_id:
                hierarchy_info = org_unit_hierarchy.get(ou_id, {})
                for level in levels_to_append:
                    level_value = hierarchy_info.get(f"level_{level}", None)
                    row.append(level_value)
            else:
                for _ in levels_to_append:
                    row.append(None)

            # Add date and status values
            row.extend([
                enrollment.get("enrollmentDate"),
                enrollment.get("incidentDate"),
                enrollment.get("status"),
                enrollment.get("created"),
                enrollment.get("lastUpdated"),
            ])

            # Build dict of attribute -> value
            attr_dict = {
                attr.get("attribute"): attr.get("value")
                for attr in enrollment.get("attributes", [])
            }

            # Append values for each attribute column
            for attr_id in sorted(attribute_ids):
                row.append(attr_dict.get(attr_id))

            rows.append(tuple(row))

        return col_names, rows

    @staticmethod
    def normalize_metadata_list(data: dict, endpoint: str) -> tuple[list[str], list[tuple]]:
        """
        Normalize metadata endpoint responses (dataElements, dataSets, etc.)

        Returns:
            Tuple of (column_names, rows)
        """
        # Try plural form first
        items = data.get(endpoint, [])

        # Common metadata columns - ALL MUST be SANITIZED
        if not items:
            return [sanitize_dhis2_column_name(col) for col in ["id", "name", "displayName"]], []

        # Detect columns from first item - ALL MUST be SANITIZED
        if isinstance(items[0], dict):
            col_names = [sanitize_dhis2_column_name(col) for col in items[0].keys()]
        else:
            col_names = [sanitize_dhis2_column_name("value")]

        rows = []
        for item in items:
            if isinstance(item, dict):
                rows.append(tuple(item.get(col, None) for col in items[0].keys()))
            else:
                rows.append((item,))

        return col_names, rows

    @staticmethod
    def normalize_generic(data: dict) -> tuple[list[str], list[tuple]]:
        """
        Generic fallback normalizer for unknown endpoints
        Tries common DHIS2 response patterns

        Returns:
            Tuple of (column_names, rows)
        """
        # Try common DHIS2 response patterns
        for key in ["rows", "data", "results"]:
            if key in data and isinstance(data[key], list) and data[key]:
                items = data[key]

                # ALL columns MUST be SANITIZED
                if isinstance(items[0], dict):
                    col_names = [sanitize_dhis2_column_name(col) for col in items[0].keys()]
                    rows = [tuple(item.get(col, None) for col in items[0].keys()) for item in items]
                else:
                    col_names = [sanitize_dhis2_column_name("value")]
                    rows = [(item,) for item in items]

                return col_names, rows

        # Last resort: return raw JSON as single column - SANITIZED
        return [sanitize_dhis2_column_name("data")], [(json.dumps(data),)]

    @classmethod
    def normalize(cls, endpoint: str, data: dict, pivot: bool = True, org_unit_hierarchy: dict | None = None, selected_levels: list[int] | None = None, org_unit_level_names: dict | None = None) -> tuple[list[str], list[tuple]]:
        """
        Normalize DHIS2 API response based on endpoint type

        Args:
            endpoint: DHIS2 API endpoint name
            data: Raw JSON response from DHIS2
            pivot: Whether to pivot analytics data (wide format) or keep long format
            org_unit_hierarchy: Dict mapping org unit IDs to their hierarchy info
            selected_levels: List of org unit levels to include as columns
            org_unit_level_names: Dict mapping level numbers to their display names

        Returns:
            Tuple of (column_names, rows)
        """
        if endpoint == "analytics":
            return cls.normalize_analytics(data, pivot=pivot, org_unit_hierarchy=org_unit_hierarchy, selected_levels=selected_levels, org_unit_level_names=org_unit_level_names)
        elif endpoint == "dataValueSets":
            return cls.normalize_data_value_sets(data, org_unit_hierarchy=org_unit_hierarchy, selected_levels=selected_levels, org_unit_level_names=org_unit_level_names)
        elif endpoint == "events":
            return cls.normalize_events(data, org_unit_hierarchy=org_unit_hierarchy, org_unit_level_names=org_unit_level_names)
        elif endpoint == "enrollments":
            return cls.normalize_enrollments(data, org_unit_hierarchy=org_unit_hierarchy, org_unit_level_names=org_unit_level_names)
        elif endpoint == "trackedEntityInstances":
            return cls.normalize_tracked_entity_instances(data, org_unit_hierarchy=org_unit_hierarchy, org_unit_level_names=org_unit_level_names)
        elif endpoint in ["dataElements", "dataSets", "indicators", "organisationUnits",
                          "programs", "programStages", "programIndicators"]:
            return cls.normalize_metadata_list(data, endpoint)
        else:
            return cls.normalize_generic(data)


class DHIS2Dialect(default.DefaultDialect):
    """Minimal SQLAlchemy dialect for DHIS2 API connections"""

    name = "dhis2"
    driver = "dhis2"
    supports_alter = False
    supports_pk_autoincrement = False
    supports_default_values = False
    supports_empty_insert = False
    supports_unicode_statements = True
    supports_unicode_binds = True
    supports_native_decimal = True
    supports_native_boolean = True
    supports_native_enum = False

    @classmethod
    def dbapi(cls):
        """Return a fake DBAPI module"""
        return DHIS2DBAPI()

    def create_connect_args(self, url):
        """
        Parse URL and return connection arguments for DHIS2Connection
        This is called by SQLAlchemy to convert the URL into connection parameters
        """
        logger.debug(f"create_connect_args called with URL: {url}")

        # Extract connection details from URL
        opts = {
            "host": url.host,
            "username": url.username,
            "password": url.password,
            "database": url.database,  # This will be the path like /stable-2-42-2/api
        }

        logger.debug(f"Parsed connection opts: {opts}")

        # Return (args, kwargs) tuple for DHIS2Connection.__init__()
        return ([], opts)

    def get_schema_names(self, connection, **kw):
        """Return list of schema names"""
        return ["dhis2"]

    def get_table_names(self, connection, schema=None, **kw):
        """
        Return ONLY data query endpoints for DHIS2
        Excludes metadata endpoints (used by Query Builder) and configuration endpoints
        """
        # Data query endpoints - these return actual health/program data
        data_query_endpoints = [
            "analytics",              # Aggregated analytical data (MOST COMMON)
            "dataValueSets",          # Raw data entry values
            "events",                 # Tracker program events
            "trackedEntityInstances", # Tracked entities (people, assets)
            "enrollments",            # Program enrollments
        ]

        # These are always returned - no dynamic discovery needed for simplicity
        return data_query_endpoints

    def get_view_names(self, connection, schema=None, **kw):
        """Return list of view names (none for DHIS2)"""
        return []

    def has_table(self, connection, table_name, schema=None, **kw):
        """Check if table/endpoint exists in DHIS2"""
        # Get all available tables
        available_tables = self.get_table_names(connection, schema, **kw)
        return table_name in available_tables

    def get_columns(self, connection, table_name, schema=None, **kw):
        """
        Return column information dynamically from stored metadata or DHIS2 API
        For datasets, fetches actual dataElements from the dataset

        For custom named datasets (e.g., "analytics_version2"), extracts the source table
        and returns appropriate columns based on it.
        """
        # Parse source table from custom dataset name
        # Example: "analytics_version2" -> "analytics"
        source_table = table_name
        if '_' in table_name:
            parsed = table_name.split('_')[0]
            logger.debug(f"Parsed source table '{parsed}' from dataset name '{table_name}'")
            source_table = parsed

        # Try to get custom columns from connection metadata
        try:
            if hasattr(connection, 'info') and 'endpoint_columns' in connection.info:
                endpoint_columns = connection.info['endpoint_columns']
                # Check both original table_name and source_table
                for name in [table_name, source_table]:
                    if name in endpoint_columns:
                        return [
                            {"name": col, "type": types.String(), "nullable": True}
                            for col in endpoint_columns[name]
                        ]
        except Exception as e:
            logger.debug(f"Could not load custom columns: {e}")

        # Default columns for common DHIS2 endpoints - ALL columns MUST be SANITIZED
        # Note: analytics endpoint uses WIDE format (pe, ou, dx1, dx2, ...) for horizontal data view
        # This will be expanded with actual data elements when available
        default_columns = {
            "analytics": [sanitize_dhis2_column_name(col) for col in ["Period", "OrgUnit"]],  # Base dimensions - data elements added dynamically
            "dataValueSets": [sanitize_dhis2_column_name(col) for col in ["dataElement", "period", "orgUnit", "value", "storedBy", "created"]],
            "trackedEntityInstances": [sanitize_dhis2_column_name(col) for col in ["trackedEntityInstance", "orgUnit", "trackedEntityType", "attributes"]],
            "events": [sanitize_dhis2_column_name(col) for col in ["event", "program", "orgUnit", "eventDate", "dataValues"]],
            "enrollments": [sanitize_dhis2_column_name(col) for col in ["enrollment", "trackedEntityInstance", "program", "orgUnit", "enrollmentDate"]],
        }

        # Use source_table (not table_name) for lookup
        if source_table in default_columns:
            columns = []
            for col in default_columns[source_table]:
                # Define column metadata based on role in tidy data format
                col_def = {
                    "name": col,
                    "nullable": True,
                    "is_dttm": False,  # Not a datetime column
                }

                # DIMENSIONS (categorical/groupable columns)
                # Compare with sanitized versions of known dimension columns
                dimension_cols = [sanitize_dhis2_column_name(c) for c in ["Period", "OrgUnit", "DataElement", "period", "orgUnit", "dataElement"]]
                if col in dimension_cols:
                    col_def.update({
                        "type": types.String(),  # Always String to prevent numeric conversion
                        "groupby": True,  # Can be used for grouping
                        "filterable": True,  # Can be filtered
                        "verbose_name": col,  # Display name
                        "is_numeric": False,  # Explicitly NOT numeric - prevents aggregation
                        "python_date_format": None,  # Not a date
                        "is_dttm": False,  # Not a required datetime column
                    })
                # MEASURES (numeric columns that can be aggregated)
                elif col in [sanitize_dhis2_column_name(c) for c in ["Value", "value"]]:
                    col_def.update({
                        "type": types.Float(),  # Numeric type for aggregation
                        "is_numeric": True,  # Can be aggregated (SUM, AVG, etc.)
                        "filterable": True,  # Can be filtered
                        "is_dttm": False,  # Not a datetime column
                        "verbose_name": col,
                    })
                else:
                    # Default for other columns
                    col_def.update({
                        "type": types.String(),
                        "is_numeric": False,
                        "filterable": True,
                    })

                columns.append(col_def)
                logger.debug(f"Column '{col}': type={col_def['type']}, groupby={col_def.get('groupby')}, is_numeric={col_def.get('is_numeric')}")
            
            # Cache column mapping for query translation (sanitized -> display name)
            try:
                from flask import g as flask_g
                if not hasattr(flask_g, 'dhis2_column_map'):
                    flask_g.dhis2_column_map = {}
                flask_g.dhis2_column_map[source_table] = {
                    col_def['name']: col_def.get('verbose_name', col_def['name']) for col_def in columns
                }
                logger.info(f"[DHIS2] Cached {len(columns)} column mappings for {source_table}")
            except Exception as e:
                logger.warning(f"[DHIS2] Could not cache column mappings: {e}")
            
            return columns

        # For analytics, try to fetch ALL available indicators and data elements from DHIS2
        # and show them as individual columns
        if source_table == "analytics" or table_name == "analytics":
            try:
                from sqlalchemy.engine.url import make_url
                url = make_url(str(connection.url))

                base_url = f"https://{url.host}{url.database or '/api'}"
                auth = (url.username, url.password) if url.username else None

                logger.info(f"[DHIS2] Fetching data elements and indicators from {base_url} (limited to first 500 each for performance)")

                # Base dimension columns - ALL columns MUST be SANITIZED
                columns = [
                    {
                        "name": sanitize_dhis2_column_name("Period"),
                        "type": types.String(),
                        "nullable": True,
                        "groupby": True,  # Enable grouping for period dimension
                        "filterable": True,
                        "is_numeric": False,
                        "is_dttm": False,
                    },
                    {
                        "name": sanitize_dhis2_column_name("OrgUnit"),
                        "type": types.String(),
                        "nullable": True,
                        "groupby": True,
                        "filterable": True,
                        "is_numeric": False,
                        "is_dttm": False,
                    },
                ]

                # Fetch ALL data elements and indicators
                metadata_endpoints = {
                    'dataElements': '/dataElements',
                    'indicators': '/indicators',
                    'programIndicators': '/programIndicators',
                }

                total_items = 0
                for meta_type, endpoint in metadata_endpoints.items():
                    try:
                        logger.info(f"[DHIS2] Fetching {meta_type} from {base_url}{endpoint}")

                        # Fetch items with pagination for better performance
                        # Limit to first 500 items per endpoint to avoid slowness
                        response = requests.get(
                            f"{base_url}{endpoint}",
                            params={
                                "fields": "id,name,displayName,shortName,code,valueType",
                                "paging": "true",
                                "pageSize": 500,
                                "page": 1,
                            },
                            auth=auth,
                            timeout=30,  # Timeout after 30 seconds
                        )

                        if response.status_code == 200:
                            data = response.json()
                            items = data.get(meta_type, [])

                            logger.info(f"[DHIS2] Found {len(items)} {meta_type}")

                            # Add each data element/indicator as a column
                            for item in items:
                                item_name = item.get('displayName') or item.get('name', '')
                                item_id = item.get('id', '')
                                value_type = item.get('valueType', 'NUMBER')

                                # IMPORTANT: Sanitize column names to match what the analytics endpoint returns!
                                # This ensures consistent names across:
                                # 1. Dataset metadata (stored in DB)
                                # 2. Chart formData (user selections)
                                # 3. Query results (from DHIS2 API)
                                column_name = sanitize_dhis2_column_name(item_name)

                                # Determine SQL type based on DHIS2 valueType
                                if value_type in ['NUMBER', 'INTEGER', 'PERCENTAGE', 'UNIT_INTERVAL']:
                                    sql_type = types.Float()
                                    is_numeric = True
                                elif value_type in ['DATE', 'DATETIME']:
                                    sql_type = types.Date()
                                    is_numeric = False
                                elif value_type == 'BOOLEAN':
                                    sql_type = types.Boolean()
                                    is_numeric = False
                                else:
                                    sql_type = types.String()
                                    is_numeric = False

                                # Add column for this data element with SANITIZED name
                                # Store original displayName in verbose_name for chart display
                                columns.append({
                                    "name": column_name,
                                    "type": sql_type,
                                    "nullable": True,
                                    "is_numeric": is_numeric,
                                    "filterable": True,
                                    "description": f"{meta_type[:-1]} - {item_id} ({item_name})",
                                    "dhis2_id": item_id,
                                    "is_dttm": False,
                                    "verbose_name": item_name,  # Original displayName for human-readable display in charts
                                })
                                total_items += 1

                        else:
                            logger.warning(f"[DHIS2] Failed to fetch {meta_type}: HTTP {response.status_code}")

                    except Exception as e:
                        logger.error(f"[DHIS2] Error fetching {meta_type}: {e}")

                logger.info(f"[DHIS2] Total columns discovered: {len(columns)} (2 dimensions + {total_items} data elements)")
                logger.info(f"[DHIS2] Limited to first 500 items per endpoint for performance")

                if total_items > 0:
                    logger.info(f"[DHIS2] Sample columns: {[c['name'] for c in columns[:10]]}")

                # Cache column mapping for query translation (sanitized -> display name)
                try:
                    from flask import g as flask_g
                    if not hasattr(flask_g, 'dhis2_column_map'):
                        flask_g.dhis2_column_map = {}
                    # Build mapping: {sanitized_name: display_name}
                    flask_g.dhis2_column_map[source_table or table_name] = {
                        col['name']: col.get('verbose_name', col['name']) for col in columns
                    }
                    logger.info(f"[DHIS2] Cached {len(columns)} column mappings for {source_table or table_name}")
                except Exception as e:
                    logger.warning(f"[DHIS2] Could not cache column mappings: {e}")

                return columns

            except Exception as e:
                logger.error(f"[DHIS2] Failed to fetch metadata: {e}")
                # Fall through to default columns

        # For dataSets tables, try to fetch specific dataElements
        elif "dataset" in table_name.lower() or source_table == "dataValueSets":
            try:
                from sqlalchemy.engine.url import make_url
                url = make_url(str(connection.url))

                base_url = f"https://{url.host}{url.database or '/api'}"
                auth = (url.username, url.password) if url.username else None

                # Search for dataset by name
                response = requests.get(
                    f"{base_url}/dataSets",
                    params={
                        "filter": f"displayName:ilike:{table_name.replace('_', ' ')}",
                        "fields": "id,displayName,dataSetElements[dataElement[id,displayName,valueType]]",
                        "paging": "false"
                    },
                    auth=auth,
                    timeout=5,
                )

                if response.status_code == 200:
                    datasets = response.json().get("dataSets", [])
                    if datasets:
                        dataset = datasets[0]
                        columns = [
                            {"name": "period", "type": types.String(), "nullable": True},
                            {"name": "orgUnit", "type": types.String(), "nullable": True},
                        ]

                        # Add columns for each dataElement
                        for dse in dataset.get("dataSetElements", []):
                            de = dse.get("dataElement", {})
                            col_name = de.get("displayName", de.get("id", ""))
                            columns.append({
                                "name": col_name,
                                "type": types.String(),
                                "nullable": True
                            })

                        logger.info(f"Discovered {len(columns)} columns for dataset {table_name}")
                        return columns
            except Exception as e:
                logger.debug(f"Could not fetch dataElements for {table_name}: {e}")

        # Fallback: generic columns
        return [
            {"name": "id", "type": types.String(), "nullable": True},
            {"name": "period", "type": types.String(), "nullable": True},
            {"name": "orgUnit", "type": types.String(), "nullable": True},
            {"name": "value", "type": types.String(), "nullable": True},
        ]

    def get_pk_constraint(self, connection, table_name, schema=None, **kw):
        """Return primary key constraint (none for DHIS2)"""
        return {"constrained_columns": [], "name": None}

    def get_foreign_keys(self, connection, table_name, schema=None, **kw):
        """Return foreign keys (none for DHIS2)"""
        return []

    def get_indexes(self, connection, table_name, schema=None, **kw):
        """Return indexes (none for DHIS2)"""
        return []


class DHIS2DBAPI:
    """Fake DBAPI module for DHIS2"""

    paramstyle = "named"
    threadsafety = 2
    apilevel = "2.0"

    class Error(Exception):
        pass

    class DatabaseError(Error):
        pass

    class OperationalError(DatabaseError):
        pass

    class ProgrammingError(DatabaseError):
        pass

    def connect(self, *args, **kwargs):
        """Return a fake connection"""
        return DHIS2Connection(*args, **kwargs)


class DHIS2Connection:
    """Connection object for DHIS2 API with dynamic parameter support"""

    def __init__(self, host=None, username=None, password=None, database=None, **kwargs):
        """
        Initialize DHIS2 connection

        Args:
            host: DHIS2 server hostname
            username: Username or empty for PAT auth
            password: Password or access token
            database: API path (e.g., /api or /hmis/api)
            **kwargs: Additional connection parameters including:
                - default_params: Global default query parameters
                - endpoint_params: Endpoint-specific parameters
                - timeout: Request timeout
                - page_size: Default page size
        """
        logger.debug(f"DHIS2Connection init - host: {host}, database: {database}, kwargs: {kwargs}")

        self.host = host
        self.username = username or ""
        self.password = password or ""

        # Ensure api_path has leading slash
        self.api_path = database or "/api"
        if self.api_path and not self.api_path.startswith("/"):
            self.api_path = f"/{self.api_path}"

        # Store dynamic configuration
        self.default_params = kwargs.get("default_params", {})
        self.endpoint_params = kwargs.get("endpoint_params", {})
        self.timeout = kwargs.get("timeout", 300)  # Increased to 5 minutes for slow DHIS2 servers
        self.page_size = kwargs.get("page_size", 50)

        # Build base URL
        self.base_url = f"https://{self.host}{self.api_path}"

        # Determine auth method
        if not self.username and self.password:
            # PAT authentication
            self.auth = None
            self.headers = {"Authorization": f"ApiToken {self.password}"}
        else:
            # Basic authentication
            self.auth = (self.username, self.password)
            self.headers = {}

        logger.info(f"DHIS2 connection initialized: {self.base_url}")

    def cursor(self):
        """Return a cursor for executing queries"""
        return DHIS2Cursor(self)

    def commit(self):
        """No-op commit (DHIS2 is read-only via this connector)"""
        pass

    def rollback(self):
        """No-op rollback"""
        pass

    def fetch_user_root_org_units(self) -> list[dict[str, Any]]:
        """
        Fetch the current user's assigned organisation units.

        Returns:
            List of organisation unit objects with id, displayName, level
        """
        try:
            url = f"{self.base_url}/me"
            params = "fields=organisationUnits[id,displayName,level,path]"

            logger.info(f"Fetching user org units from {url}?{params}")

            response = requests.get(
                f"{url}?{params}",
                auth=self.auth,
                headers=self.headers,
                timeout=self.timeout,
            )
            response.raise_for_status()

            data = response.json()
            return data.get("organisationUnits", [])

        except Exception as e:
            logger.exception(f"Failed to fetch user org units: {e}")
            return []

    def fetch_geo_features(
        self,
        ou_params: str,
        display_property: str = "NAME",
        include_group_sets: bool = False,
    ) -> list[dict[str, Any]]:
        """
        Fetch geographic features from DHIS2 geoFeatures API.

        Args:
            ou_params: Organisation unit parameter in format 'ou:LEVEL-2' or 'ou:UID'
            display_property: Property to display (NAME or SHORTNAME)
            include_group_sets: Include org unit group information

        Returns:
            List of geoFeature objects from DHIS2
        """
        try:
            # Build URL - the ou_params already contains the 'ou:' prefix
            # DHIS2 expects format: /geoFeatures?ou=ou:LEVEL-2
            url = f"{self.base_url}/geoFeatures?ou={ou_params}"
            if include_group_sets:
                url += "&includeGroupSets=true"

            logger.info(f"Fetching geoFeatures from {url}")

            response = requests.get(
                url,
                auth=self.auth,
                headers=self.headers,
                timeout=self.timeout,
            )

            # If 409 Conflict, try alternative approach
            if response.status_code == 409:
                logger.warning(f"409 Conflict with {ou_params}, trying fallback approach")
                return self._fetch_org_units_with_coordinates(ou_params)

            response.raise_for_status()

            data = response.json()

            # DHIS2 geoFeatures API returns array directly or nested under key
            if isinstance(data, list):
                return data
            elif isinstance(data, dict):
                return data.get("geoFeatures", data.get("organisationUnits", []))
            else:
                logger.warning(f"Unexpected geoFeatures response type: {type(data)}")
                return []

        except Exception as e:
            logger.exception(f"Failed to fetch geoFeatures: {e}")
            raise

    def _fetch_org_units_with_coordinates(self, ou_params: str) -> list[dict[str, Any]]:
        """
        Fallback method to fetch org units with coordinates from organisationUnits API.
        Converts the response to geoFeatures format.

        Args:
            ou_params: OU parameter string (may contain LEVEL-n, UID, etc.)

        Returns:
            List of geoFeature-like objects
        """
        try:
            # Parse the ou_params to determine the query
            level = None
            parent_uid = None

            parts = ou_params.split(';')
            for part in parts:
                if part.startswith('LEVEL-'):
                    level = int(part.replace('LEVEL-', ''))
                elif part and not part.startswith('LEVEL'):
                    parent_uid = part

            # Build the organisationUnits query
            fields = "id,displayName,level,parent[id,displayName],coordinates,geometry,featureType"
            filter_params = []

            if level:
                filter_params.append(f"level:eq:{level}")
            if parent_uid:
                filter_params.append(f"path:like:{parent_uid}")

            url = f"{self.base_url}/organisationUnits?fields={fields}&paging=false"
            if filter_params:
                url += "&filter=" + "&filter=".join(filter_params)

            logger.info(f"Fallback: Fetching org units from {url}")

            response = requests.get(
                url,
                auth=self.auth,
                headers=self.headers,
                timeout=self.timeout,
            )
            response.raise_for_status()

            data = response.json()
            org_units = data.get("organisationUnits", [])

            # Convert to geoFeatures format
            geo_features = []
            for ou in org_units:
                coordinates = ou.get("coordinates") or ou.get("geometry", {}).get("coordinates")
                if not coordinates:
                    continue

                feature_type = ou.get("featureType", "POLYGON")
                geo_type = {
                    "POINT": 1,
                    "POLYGON": 2,
                    "MULTI_POLYGON": 3,
                }.get(feature_type, 2)

                geo_features.append({
                    "id": ou.get("id"),
                    "na": ou.get("displayName"),
                    "le": ou.get("level"),
                    "pi": ou.get("parent", {}).get("id"),
                    "pn": ou.get("parent", {}).get("displayName"),
                    "ty": geo_type,
                    "co": coordinates if isinstance(coordinates, str) else json.dumps(coordinates),
                    "hcd": False,
                    "hcu": bool(ou.get("parent")),
                })

            logger.info(f"Fallback returned {len(geo_features)} org units with coordinates")
            return geo_features

        except Exception as e:
            logger.exception(f"Fallback org unit fetch failed: {e}")
            return []


    def fetch_org_unit_levels(self) -> list[dict[str, Any]]:
        """
        Fetch organisation unit level definitions from DHIS2.

        Returns:
            List of organisationUnitLevel objects with id, level, displayName
        """
        try:
            fields = "id,level,displayName,created,lastUpdated"
            url = f"{self.base_url}/organisationUnitLevels"
            params = f"fields={fields}&paging=false"

            logger.info(f"Fetching org unit levels from {url}?{params}")

            response = requests.get(
                f"{url}?{params}",
                auth=self.auth,
                headers=self.headers,
                timeout=self.timeout,
            )
            response.raise_for_status()

            data = response.json()
            levels = data.get("organisationUnitLevels", [])
            
            if not levels:
                logger.warning("organisationUnitLevels endpoint returned empty list, trying alternative endpoint")
                levels = self._fetch_org_unit_levels_alternative()
            else:
                logger.info(f"Successfully fetched {len(levels)} org unit levels: {[(l.get('level'), l.get('displayName')) for l in levels]}")
            
            return levels

        except Exception as e:
            logger.warning(f"Failed to fetch org unit levels from primary endpoint: {e}, trying alternative")
            try:
                return self._fetch_org_unit_levels_alternative()
            except Exception as alt_e:
                logger.exception(f"Alternative fetch also failed: {alt_e}")
                raise

    def _fetch_org_unit_levels_alternative(self) -> list[dict[str, Any]]:
        """
        Alternative method to fetch org unit levels.
        Tries multiple approaches: basic endpoint, with paging, and building from org units.
        """
        try:
            url = f"{self.base_url}/organisationUnitLevels"
            
            logger.info(f"Trying alternative level fetch from {url}")
            
            response = requests.get(
                url,
                auth=self.auth,
                headers=self.headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
            
            data = response.json()
            levels = data.get("organisationUnitLevels", [])
            
            if levels:
                logger.info(f"Successfully fetched {len(levels)} levels via alternative method: {[(l.get('level'), l.get('displayName'), l.get('name')) for l in levels]}")
                return levels
            else:
                logger.warning("Alternative endpoint returned empty list, response keys: " + str(list(data.keys())))
                
                logger.info("Attempting to build level names from organisation units...")
                return self._build_levels_from_org_units()
            
        except Exception as e:
            logger.warning(f"Alternative level fetch failed: {e}, building from org units")
            return self._build_levels_from_org_units()

    def _build_levels_from_org_units(self) -> list[dict[str, Any]]:
        """
        Attempt to fetch organisation unit levels with alternate field parameters.
        """
        try:
            url = f"{self.base_url}/organisationUnitLevels"
            
            fields_variants = [
                "id,level,displayName,name",
                "id,level,displayName",
                "*",
                ""
            ]
            
            for fields in fields_variants:
                try:
                    if fields:
                        params = f"fields={fields}&paging=false"
                    else:
                        params = "paging=false"
                    
                    logger.info(f"Trying organisationUnitLevels with fields={fields}")
                    
                    response = requests.get(
                        f"{url}?{params}",
                        auth=self.auth,
                        headers=self.headers,
                        timeout=self.timeout,
                    )
                    response.raise_for_status()
                    
                    data = response.json()
                    levels = data.get("organisationUnitLevels", [])
                    
                    if levels:
                        logger.info(f"Success with fields={fields}, got {len(levels)} levels: {[(l.get('level'), l.get('displayName'), l.get('name')) for l in levels]}")
                        return levels
                    else:
                        logger.info(f"No levels with fields={fields}")
                        
                except Exception as e:
                    logger.debug(f"Failed with fields={fields}: {e}")
                    continue
            
            logger.warning("All field variants exhausted, returning empty list")
            return []
            
        except Exception as e:
            logger.warning(f"Failed to build levels: {e}")
            return []

    def fetch_org_units_with_descendants(self, ou_ids: list[str]) -> list[dict[str, Any]]:
        """
        Fetch organisation units and their descendants from DHIS2.

        Args:
            ou_ids: List of organisation unit IDs to fetch with descendants

        Returns:
            List of organisation unit objects including all descendants
        """
        try:
            all_ous = []
            fields = "id,displayName,level,path,parent[id,displayName]"

            for ou_id in ou_ids:
                url = f"{self.base_url}/organisationUnits/{ou_id}"
                params = f"fields={fields}&paging=false"

                logger.info(f"Fetching org unit {ou_id} with descendants from {url}")

                response = requests.get(
                    f"{url}?{params}",
                    auth=self.auth,
                    headers=self.headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()

                data = response.json()
                ou = data
                if ou:
                    all_ous.append(ou)

                ou_id_val = ou.get("id")
                if ou_id_val:
                    descendants_url = f"{self.base_url}/organisationUnits?filter=path:like:{ou_id_val}&fields={fields}&paging=false"

                    logger.info(f"Fetching descendants of {ou_id}")

                    descendants_response = requests.get(
                        descendants_url,
                        auth=self.auth,
                        headers=self.headers,
                        timeout=self.timeout,
                    )
                    descendants_response.raise_for_status()

                    descendants_data = descendants_response.json()
                    descendants = descendants_data.get("organisationUnits", [])

                    existing_ids = {o.get("id") for o in all_ous}
                    for desc in descendants:
                        if desc.get("id") not in existing_ids:
                            all_ous.append(desc)
                            existing_ids.add(desc.get("id"))

            return all_ous

        except Exception as e:
            logger.exception(f"Failed to fetch org units with descendants: {e}")
            raise

    def resolve_orgunit_names_to_uids(
        self,
        org_unit_names: list[str],
        level: int | None = None
    ) -> dict[str, str]:
        """
        Resolve organization unit display names to UIDs using DHIS2 API.

        This is used when dashboard filters pass org unit names (e.g., "Ibanda District")
        but DHIS2 API requires UIDs (e.g., "jNb63DIHuwU").

        Args:
            org_unit_names: List of org unit display names to resolve
            level: Optional org unit level filter (1=National, 2=Region, 3=District, etc.)

        Returns:
            Dictionary mapping display name to UID: {"Ibanda District": "jNb63DIHuwU", ...}

        Example:
            >>> conn.resolve_orgunit_names_to_uids(["Ibanda District", "Mbarara City"])
            {"Ibanda District": "jNb63DIHuwU", "Mbarara City": "QywkxFudXrC"}
        """
        if not org_unit_names:
            return {}

        try:
            name_to_uid = {}
            BATCH_SIZE = 50  # Process in batches to avoid URL length limits

            logger.info(f"[DHIS2 Filter Resolution] Resolving {len(org_unit_names)} org unit names to UIDs")
            print(f"[DHIS2 Filter Resolution] Resolving org unit names: {org_unit_names[:5]}...")

            for batch_start in range(0, len(org_unit_names), BATCH_SIZE):
                batch_names = org_unit_names[batch_start:batch_start + BATCH_SIZE]

                # Try multiple resolution strategies
                # Strategy 1: Use displayName:in filter (most efficient)
                name_list = ",".join(batch_names)
                url = f"{self.base_url}/organisationUnits.json"

                filters = [f"displayName:in:[{name_list}]"]
                if level is not None:
                    filters.append(f"level:eq:{level}")

                params = {
                    "filter": filters,
                    "fields": "id,displayName,name,level",
                    "paging": "false"
                }

                logger.info(f"[DHIS2 Filter Resolution] Batch {batch_start}-{batch_start + len(batch_names)}, level={level}")

                response = requests.get(
                    url,
                    params=params,
                    auth=self.auth,
                    headers=self.headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()

                data = response.json()
                org_units = data.get("organisationUnits", [])

                # Map display names to UIDs
                for ou in org_units:
                    display_name = ou.get("displayName") or ou.get("name")
                    uid = ou.get("id")
                    if display_name and uid:
                        name_to_uid[display_name] = uid
                        logger.debug(f"[DHIS2 Filter Resolution] '{display_name}' -> {uid}")

                # Strategy 2: Also try exact name match (fallback for names without displayName)
                for ou in org_units:
                    name = ou.get("name")
                    uid = ou.get("id")
                    if name and uid and name not in name_to_uid:
                        # Check if this name is in our search list
                        if name in batch_names:
                            name_to_uid[name] = uid
                            logger.debug(f"[DHIS2 Filter Resolution] '{name}' -> {uid} (via name field)")

            # Strategy 3: For unresolved names, try individual lookups with LIKE
            unresolved = [n for n in org_unit_names if n not in name_to_uid]
            if unresolved and len(unresolved) <= 10:  # Only for small number of unresolved
                logger.info(f"[DHIS2 Filter Resolution] Trying individual lookups for {len(unresolved)} unresolved names")
                for name in unresolved:
                    try:
                        params = {
                            "filter": f"displayName:ilike:{name}",
                            "fields": "id,displayName,name",
                            "paging": "false"
                        }
                        response = requests.get(
                            f"{self.base_url}/organisationUnits.json",
                            params=params,
                            auth=self.auth,
                            headers=self.headers,
                            timeout=self.timeout,
                        )
                        response.raise_for_status()
                        data = response.json()
                        ous = data.get("organisationUnits", [])

                        # Find exact match
                        for ou in ous:
                            if ou.get("displayName") == name or ou.get("name") == name:
                                name_to_uid[name] = ou.get("id")
                                logger.info(f"[DHIS2 Filter Resolution] Resolved '{name}' via LIKE search")
                                break
                    except Exception as e:
                        logger.warning(f"[DHIS2 Filter Resolution] Failed individual lookup for '{name}': {e}")

            # Check for unresolved names
            final_unresolved = set(org_unit_names) - set(name_to_uid.keys())
            if final_unresolved:
                logger.warning(f"[DHIS2 Filter Resolution] Could not resolve {len(final_unresolved)} org unit names: {list(final_unresolved)[:10]}")
                print(f"[DHIS2 Filter Resolution] ⚠️  Unresolved names: {list(final_unresolved)[:5]}")

            logger.info(f"[DHIS2 Filter Resolution] ✅ Successfully resolved {len(name_to_uid)}/{len(org_unit_names)} org unit names")
            print(f"[DHIS2 Filter Resolution] ✅ Resolved {len(name_to_uid)}/{len(org_unit_names)} names to UIDs")
            if name_to_uid:
                print(f"[DHIS2 Filter Resolution] Sample mappings: {dict(list(name_to_uid.items())[:3])}")

            return name_to_uid

        except Exception as e:
            logger.exception(f"[DHIS2 Filter Resolution] Error resolving org unit names to UIDs: {e}")
            print(f"[DHIS2 Filter Resolution] ❌ Error: {e}")
            # Return empty dict - will use names as-is (may fail but won't crash)
            return {}

    def fetch_child_org_units(
        self,
        parent_names: list[str],
        child_level: int | None = None
    ) -> list[dict[str, Any]]:
        """
        Fetch child org units for given parent org units (for cascading filters).

        This enables hierarchical filtering:
        - User selects "Bunyoro" (Region)
        - This method fetches all Districts under Bunyoro
        - District filter dropdown shows only Bunyoro districts

        Args:
            parent_names: List of parent org unit names (e.g., ["Bunyoro", "Western"])
            child_level: Optional child level to fetch (3=District, 4=Sub-County, etc.)

        Returns:
            List of child org units with id, displayName, and parent info:
            [
                {"id": "uid1", "displayName": "Kibaale District", "parent": {"id": "...", "displayName": "Bunyoro"}},
                {"id": "uid2", "displayName": "Hoima District", "parent": {"id": "...", "displayName": "Bunyoro"}},
                ...
            ]

        Example:
            >>> conn.fetch_child_org_units(["Bunyoro"], child_level=3)
            [{"id": "abc", "displayName": "Kibaale District", "parent": {"displayName": "Bunyoro"}}, ...]
        """
        if not parent_names:
            return []

        # Build cache key
        from superset.utils.dhis2_cache import get_dhis2_cache, get_ttl
        cache_key = f"org_children_{'-'.join(sorted(parent_names))}_{child_level}"

        # Try cache first
        cache = get_dhis2_cache()
        cached_result = cache.get(cache_key)

        if cached_result is not None:
            logger.info(f"[DHIS2 Cache] HIT: {cache_key} ({len(cached_result)} children)")
            return cached_result

        logger.info(f"[DHIS2 Cache] MISS: {cache_key} - fetching from API")

        try:
            # Step 1: Resolve parent names to UIDs
            parent_name_to_uid = self.resolve_orgunit_names_to_uids(parent_names)
            if not parent_name_to_uid:
                logger.warning(f"[DHIS2 Cascade] Could not resolve parent names: {parent_names}")
                return []

            parent_uids = list(parent_name_to_uid.values())
            logger.info(f"[DHIS2 Cascade] Fetching children for {len(parent_uids)} parent org units")
            print(f"[DHIS2 Cascade] Parent UIDs: {parent_uids[:5]}...")

            # Step 2: Fetch all child org units
            all_children = []
            BATCH_SIZE = 50

            for batch_start in range(0, len(parent_uids), BATCH_SIZE):
                batch_uids = parent_uids[batch_start:batch_start + BATCH_SIZE]
                uid_list = ",".join(batch_uids)

                url = f"{self.base_url}/organisationUnits.json"
                filters = [f"parent.id:in:[{uid_list}]"]

                if child_level is not None:
                    filters.append(f"level:eq:{child_level}")

                params = {
                    "filter": filters,
                    "fields": "id,displayName,name,level,parent[id,displayName]",
                    "paging": "false"
                }

                logger.info(f"[DHIS2 Cascade] Fetching batch {batch_start}-{batch_start + len(batch_uids)}")

                response = requests.get(
                    url,
                    params=params,
                    auth=self.auth,
                    headers=self.headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()

                data = response.json()
                children = data.get("organisationUnits", [])
                all_children.extend(children)

                logger.info(f"[DHIS2 Cascade] Batch returned {len(children)} children")

            logger.info(f"[DHIS2 Cascade] ✅ Found {len(all_children)} child org units")
            print(f"[DHIS2 Cascade] ✅ Fetched {len(all_children)} children for cascade filter")

            if all_children:
                # Show sample for debugging
                sample = all_children[:3]
                sample_names = [ou.get("displayName") for ou in sample]
                print(f"[DHIS2 Cascade] Sample children: {sample_names}")

            # Cache the results
            ttl = get_ttl('org_hierarchy')
            cache.set(cache_key, all_children, ttl=ttl)
            logger.info(f"[DHIS2 Cache] STORED: {cache_key} ({len(all_children)} children, ttl: {ttl}s)")

            return all_children

        except Exception as e:
            logger.exception(f"[DHIS2 Cascade] Error fetching child org units: {e}")
            print(f"[DHIS2 Cascade] ❌ Error: {e}")
            return []

    def fetch_data_elements(self, de_ids: list[str]) -> list[dict[str, Any]]:
        """
        Fetch data element metadata from DHIS2.

        Args:
            de_ids: List of data element IDs to fetch

        Returns:
            List of data element objects with id and displayName
        """
        try:
            all_des = []
            fields = "id,displayName"

            for de_id in de_ids:
                url = f"{self.base_url}/dataElements/{de_id}"
                params = f"fields={fields}"
                
                logger.info(f"Fetching data element {de_id}")
                
                response = requests.get(
                    f"{url}?{params}",
                    auth=self.auth,
                    headers=self.headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                
                data = response.json()
                if data and data.get("id"):
                    all_des.append(data)

            return all_des

        except Exception as e:
            logger.exception(f"Failed to fetch data elements: {e}")
            raise

    def fetch_analytics_data(
        self,
        de_ids: list[str],
        period_ids: list[str],
        ou_ids: list[str],
        include_children: bool = False,
        ou_dimension: str | None = None,
        ou_mode: str | None = None,
    ) -> dict[str, Any]:
        """
        Fetch analytics data from DHIS2.

        Args:
            de_ids: List of data element IDs
            period_ids: List of period codes
            ou_ids: List of organization unit IDs
            include_children: If True, include data from descendant org units (legacy, use ou_mode instead)
            ou_dimension: Custom org unit dimension string (e.g., "ou_id1;ou_id2;LEVEL-3")
            ou_mode: DHIS2 ouMode parameter - SELECTED, CHILDREN, DESCENDANTS, ALL

        Returns:
            Dictionary with rows containing {ou, pe, and data element values}
        """
        try:
            dx_param = ";".join(de_ids)
            pe_param = ";".join(period_ids)

            # Use custom ou_dimension if provided, otherwise build from ou_ids
            if ou_dimension:
                ou_param = ou_dimension
                logger.info(f"[Analytics API] Using custom ou dimension: {ou_param}")
            else:
                ou_param = ";".join(ou_ids)

            url = f"{self.base_url}/analytics"

            # Determine ouMode - use explicit ou_mode if provided, else legacy include_children
            # ouMode options: SELECTED (default), CHILDREN, DESCENDANTS, ALL
            effective_ou_mode = ou_mode.upper() if ou_mode else ("DESCENDANTS" if include_children else None)

            if effective_ou_mode:
                params = (
                    f"dimension=dx:{dx_param}"
                    f"&dimension=pe:{pe_param}"
                    f"&dimension=ou:{ou_param}"
                    f"&ouMode={effective_ou_mode}"
                    f"&tableLayout=true"
                    f"&paging=false"
                )
                logger.info(f"[Analytics API] Using ouMode={effective_ou_mode}")
            else:
                params = (
                    f"dimension=dx:{dx_param}"
                    f"&dimension=pe:{pe_param}"
                    f"&dimension=ou:{ou_param}"
                    f"&tableLayout=true"
                    f"&paging=false"
                )

            logger.info(f"[Analytics API] Fetching from {url} with de_ids={de_ids}, period_ids={period_ids}, ou_ids={ou_ids}, ou_mode={effective_ou_mode}")

            response = requests.get(
                f"{url}?{params}",
                auth=self.auth,
                headers=self.headers,
                timeout=self.timeout,
            )
            response.raise_for_status()

            data = response.json()
            logger.info(f"[Analytics API] Response status: success, keys: {list(data.keys())}")
            
            rows = []

            if "rows" in data:
                raw_rows = data.get("rows", [])
                logger.info(f"[Analytics API] Found {len(raw_rows)} raw rows from analytics")
                
                headers = data.get("headers", [])
                dx_idx = next(
                    (i for i, h in enumerate(headers) if h.get("name") == "dx"),
                    -1,
                )
                pe_idx = next(
                    (i for i, h in enumerate(headers) if h.get("name") == "pe"),
                    -1,
                )
                ou_idx = next(
                    (i for i, h in enumerate(headers) if h.get("name") == "ou"),
                    -1,
                )
                value_idx = next(
                    (i for i, h in enumerate(headers)
                     if h.get("name") == "value"),
                    -1,
                )

                logger.info(f"[Analytics API] Column indices: dx={dx_idx}, pe={pe_idx}, ou={ou_idx}, value={value_idx}")

                row_map = {}

                for row in raw_rows:
                    dx_val = row[dx_idx] if dx_idx >= 0 else ""
                    pe_val = row[pe_idx] if pe_idx >= 0 else ""
                    ou_val = row[ou_idx] if ou_idx >= 0 else ""
                    val = row[value_idx] if value_idx >= 0 else ""

                    key = (ou_val, pe_val)

                    if key not in row_map:
                        row_map[key] = {
                            "ou": ou_val,
                            "pe": pe_val,
                        }

                    if dx_val:
                        row_map[key][dx_val] = val

                rows = list(row_map.values())
                logger.info(f"[Analytics API] Pivoted {len(raw_rows)} rows into {len(rows)} unique ou/period combinations")
            else:
                logger.warning(f"[Analytics API] No 'rows' key in response. Available keys: {list(data.keys())}")

            return {"rows": rows}

        except Exception as e:
            logger.exception(f"[Analytics API] Failed to fetch analytics data: {e}")
            return {"rows": []}

    def fetch_data_values(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Fetch data values from DHIS2 dataValueSets API.

        Args:
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
            url = f"{self.base_url}/dataValueSets"
            query_string = "&".join(f"{k}={v}" for k, v in params.items())
            if query_string:
                url = f"{url}?{query_string}"

            logger.info(f"Fetching data values from {url}")

            response = requests.get(
                url,
                auth=self.auth,
                headers=self.headers,
                timeout=self.timeout,
            )
            response.raise_for_status()

            data = response.json()
            return data

        except Exception as e:
            logger.exception(f"Failed to fetch data values: {e}")
            raise

    def close(self):
        """Close connection"""
        logger.debug("DHIS2 connection closed")


class DHIS2Cursor:
    """Cursor object for executing DHIS2 API queries with dynamic parameters"""

    def __init__(self, connection: DHIS2Connection):
        self.connection = connection
        self._description = None
        self.rowcount = -1
        self._rows = []

    def _parse_endpoint_from_query(self, query: str) -> str:
        """Extract endpoint name from SQL query (FROM clause)"""
        # Simple regex to extract table name from SELECT ... FROM table_name
        match = re.search(r'FROM\s+(\w+)', query, re.IGNORECASE)
        if match:
            endpoint = match.group(1)
            # Don't use schema name as endpoint
            if endpoint.lower() == 'dhis2':
                logger.warning("Ignoring 'dhis2' as endpoint - using default 'analytics'")
                return "analytics"
            return endpoint
        return "analytics"  # Default fallback

    def _extract_select_columns(self, query: str) -> list[str]:
        """
        Extract column names from the SELECT clause of a SQL query.
        Returns a list of column names in the order they appear.
        """
        # Match SELECT clause - handles SELECT col1, col2 FROM ...
        select_match = re.search(r'SELECT\s+(.+?)\s+FROM', query, re.IGNORECASE | re.DOTALL)
        if not select_match:
            return []
        
        select_clause = select_match.group(1).strip()
        
        # Split by comma and clean up
        columns = []
        for col in select_clause.split(','):
            col = col.strip()
            # Handle aliases: "column AS alias" -> use "alias"
            if ' AS ' in col.upper():
                col = col.split()[-1]
            # Handle function calls: "FUNC(column)" -> skip
            if '(' in col:
                continue
            # Clean quotes if any
            col = col.strip('"\'`')
            if col and col != '*':
                columns.append(col)
        
        return columns

    def _map_columns_to_dhis2_dimensions(self, columns: list[str], query: str) -> list[str]:
        """
        Map Superset column names to DHIS2 dimension specifications.
        Returns a list of dimension specs like ['ou:OrgUnit', 'pe:Period', 'dx:Value']
        
        IMPORTANT: In DHIS2 analytics:
        - Dimensions: ou (organisation unit), pe (period), dx (data element), etc.
        - Data values: the numeric values being aggregated (sum, count, etc.)
        
        We need to identify which columns are dimensions vs data values.
        """
        dimension_specs = []
        
        # DHIS2 dimension column patterns
        # Maps column name patterns to DHIS2 dimension prefixes
        dimension_patterns = {
            # Organisation/Location dimensions
            ('orgunit', 'ou'): ['orgunit', 'organisation_unit', 'ou', 'organisationunit'],
            
            # Time dimensions
            ('period', 'pe'): ['period', 'pe', 'time', 'date', 'year', 'month', 'quarter'],
            
            # Data element dimensions
            ('dataelement', 'dx'): ['dataelement', 'data_element', 'dx', 'element', 'indicator'],
            
            # Category/Category Option dimensions
            ('category', 'ca'): ['category', 'ca'],
            ('categoryoption', 'co'): ['categoryoption', 'category_option', 'co'],
            
            # Program Stage
            ('programstage', 'ps'): ['programstage', 'program_stage', 'ps'],
            
            # Tracked Entity
            ('trackedentity', 'te'): ['trackedentity', 'tracked_entity', 'te'],
            
            # Organisation Unit Group
            ('organisationunitgroup', 'oug'): ['organisationunitgroup', 'organisation_unit_group', 'oug'],
        }
        
        # Known metric/value column names that should NOT be dimensions
        metric_patterns = [
            'value', 'values', 'count', 'sum', 'avg', 'average', 'min', 'maximum', 'max', 
            'stddev', 'variance', 'total', 'data', 'result',
            # Aggregation functions
            'ccount', 'countnnon', 'stddev', 'variance', 'sum_sq',
        ]
        
        for col in columns:
            col_sanitized = sanitize_dhis2_column_name(col.lower())
            col_lower = col.lower()
            original_col = col
            
            # Skip if it's a known metric/value column
            is_metric = False
            for metric_pat in metric_patterns:
                if metric_pat in col_lower:
                    is_metric = True
                    break
            
            if is_metric:
                logger.debug(f"[DHIS2] Skipping metric/value column: {col}")
                continue
            
            # Try to match to a DHIS2 dimension
            matched = False
            for (pattern_key, dimension_prefix), patterns in dimension_patterns.items():
                for pattern in patterns:
                    pattern_sanitized = sanitize_dhis2_column_name(pattern.lower())
                    if pattern_sanitized in col_sanitized or col_sanitized.endswith(pattern_sanitized):
                        # Format the dimension spec
                        # Use the original column name as the value
                        dimension_specs.append(f"{dimension_prefix}:{original_col}")
                        logger.debug(f"[DHIS2] Mapped column '{col}' to dimension '{dimension_prefix}'")
                        matched = True
                        break
                if matched:
                    break
            
            if not matched:
                # If no pattern matched, still try to treat as dimension
                # (fallback for unknown dimension types)
                logger.debug(f"[DHIS2] Column '{col}' didn't match known patterns, will try as generic dimension")
        
        return dimension_specs

    def _extract_query_params(self, query: str) -> dict[str, str]:
        """
        Extract query parameters from SQL WHERE clause or comments OR cached params

        Priority Order (with special WHERE clause override):
        1. SQL comments (/* DHIS2: ... */ or -- DHIS2: ...) - Base parameters
        2. Flask g.dhis2_dataset_params (same-request access)
        3. Application cache (persists across requests) - Fallback only
        4. SELECT columns (extract user-selected dimensions from query)
        5. WHERE clause - OVERRIDES 'ou' parameter from SQL comments/cache
           (enables dashboard native filters to work correctly)

        IMPORTANT: WHERE clause org unit filters (e.g., WHERE "Region" IN ('Bunyoro'))
        will OVERRIDE the 'ou' parameter from SQL comments, enabling dashboard filtering
        to work correctly with name-to-UID resolution.
        """
        from urllib.parse import unquote

        params = {}
        from_match = re.search(r'FROM\s+(\w+)', query, re.IGNORECASE)
        table_name = from_match.group(1) if from_match else "analytics"

        # FIRST: Check SQL comments (highest priority - always current/live)
        # Extract from SQL block comments (/* DHIS2: key=value&key2=value2 */)
        block_comment_match = re.search(r'/\*\s*DHIS2:\s*(.+?)\s*\*/', query, re.IGNORECASE | re.DOTALL)
        if block_comment_match:
            param_str = block_comment_match.group(1).strip()
            # URL decode the parameter string first
            param_str = unquote(param_str)
            # Split by & or , to support both URL format and comma-separated
            separator = '&' if '&' in param_str else ','
            for param in param_str.split(separator):
                if '=' in param:
                    key, value = param.split('=', 1)
                    key = key.strip()
                    value = value.strip()

                    # Handle dimension parameter specially - can appear multiple times
                    if key == 'dimension':
                        if key in params:
                            # Append to existing dimension with semicolon separator for _make_api_request
                            params[key] = f"{params[key]};{value}"
                        else:
                            params[key] = value
                    else:
                        params[key] = value

        # Extract from SQL line comments (-- DHIS2: key=value, key2=value2)
        # Support both comma and ampersand separators (URL format)
        comment_match = re.search(r'--\s*DHIS2:\s*(.+?)(?:\n|$)', query, re.IGNORECASE)
        if comment_match:
            param_str = comment_match.group(1)
            # URL decode the parameter string first
            param_str = unquote(param_str)
            # Split by & or , to support both URL format and comma-separated
            separator = '&' if '&' in param_str else ','
            for param in param_str.split(separator):
                if '=' in param:
                    key, value = param.split('=', 1)
                    key = key.strip()
                    value = value.strip()

                    # Handle dimension parameter specially - can appear multiple times
                    if key == 'dimension':
                        if key in params:
                            # Append to existing dimension with semicolon separator for _make_api_request
                            params[key] = f"{params[key]};{value}"
                        else:
                            params[key] = value
                    else:
                        params[key] = value

        # Store params from SQL comments (will be used as base, but WHERE clause can override)
        base_params_from_comments = params.copy() if params else {}

        # DON'T return early - continue to check WHERE clause for org unit filters
        # WHERE clause filters should OVERRIDE SQL comment 'ou' parameter for dashboard filtering

        # SECOND: Check Flask g context for parameters (same-request access)
        # Only use Flask g if we didn't find SQL comments
        if not base_params_from_comments:
            try:
                from flask import g as flask_g
                if hasattr(flask_g, 'dhis2_dataset_params'):
                    if table_name in flask_g.dhis2_dataset_params:
                        param_str = flask_g.dhis2_dataset_params[table_name]
                        print(f"[DHIS2] Found params in Flask g for {table_name}: {param_str[:100]}")
                        logger.info(f"Using stored parameters from Flask g for table: {table_name}")
                        separator = '&' if '&' in param_str else ','
                        for param in param_str.split(separator):
                            if '=' in param:
                                key, value = param.split('=', 1)
                                key = key.strip()
                                value = value.strip()
                                if key == 'dimension':
                                    params[key] = f"{params[key]};{value}" if key in params else value
                                else:
                                    params[key] = value
            except ImportError:
                pass
            except Exception:
                pass

        # THIRD: Check application cache (persists across requests) - Fallback only
        # Only use cache if we didn't find SQL comments or Flask g params
        if not base_params_from_comments and not params:
            cache_param_str = None
            try:
                from superset.extensions import cache_manager
                # Try to find cached params by table name (we cache with dataset ID pattern)
                # Search for any cache key matching this table
                cache_keys = [f"dhis2_params_{i}_{table_name}" for i in range(1, 200)]  # Check dataset IDs 1-200
                for cache_key in cache_keys:
                    cached = cache_manager.data_cache.get(cache_key)
                    if cached:
                        cache_param_str = cached
                        print(f"[DHIS2] Found params in cache for {table_name}: {cache_param_str[:100]}")
                        logger.info(f"Using cached parameters for table: {table_name} (fallback)")
                        break
            except Exception as e:
                logger.warning(f"[DHIS2] Could not check cache: {e}")

            if cache_param_str:
                separator = '&' if '&' in cache_param_str else ','
                for param in cache_param_str.split(separator):
                    if '=' in param:
                        key, value = param.split('=', 1)
                        key = key.strip()
                        value = value.strip()
                        if key == 'dimension':
                            params[key] = f"{params[key]};{value}" if key in params else value
                        else:
                            params[key] = value

        # FOURTH: Extract from SELECT columns (respects user's dimension selection)
        # This is CRITICAL for DHIS2: users select which dimensions they want to see (e.g., OrgUnit)
        # We need to translate these selected columns into DHIS2 dimension parameters
        try:
            select_columns = self._extract_select_columns(query)
            if select_columns:
                print(f"[DHIS2] Extracted SELECT columns: {select_columns}")
                logger.info(f"Extracted SELECT columns from query: {select_columns}")
                
                dimension_specs = self._map_columns_to_dhis2_dimensions(select_columns, query)
                if dimension_specs:
                    print(f"[DHIS2] Mapped to DHIS2 dimensions: {dimension_specs}")
                    logger.info(f"Mapped to DHIS2 dimensions: {dimension_specs}")
                    
                    # Merge with existing dimensions
                    for spec in dimension_specs:
                        if 'dimension' in params:
                            # Check if this dimension type already exists
                            prefix = spec.split(':')[0]
                            existing_specs = params['dimension'].split(';')
                            # Remove old specs with same prefix if any
                            filtered_specs = [s for s in existing_specs if not s.startswith(prefix + ':')]
                            filtered_specs.append(spec)
                            params['dimension'] = ';'.join(filtered_specs)
                        else:
                            params['dimension'] = spec
        except Exception as e:
            logger.warning(f"[DHIS2] Error extracting SELECT columns: {e}")
            print(f"[DHIS2] Error extracting SELECT columns: {e}")

        # FIFTH: Extract from WHERE clause
        # This extracts org unit filters that should OVERRIDE base params from SQL comments
        where_ou_filters = []
        where_ou_level = None
        where_match = re.search(r'WHERE\s+(.+?)(?:ORDER BY|GROUP BY|LIMIT|$)', query, re.IGNORECASE | re.DOTALL)
        if where_match:
            conditions = where_match.group(1)

            # Define org unit hierarchy columns that need UID resolution
            org_unit_columns = [
                'National', 'Region', 'District', 'Sub_County', 'Sub_County_Town_Council_Div',
                'Health_Facility', 'orgUnit', 'ou', 'OrganisationUnit'
            ]
            level_mapping = {
                'National': 1,
                'Region': 2,
                'District': 3,
                'Sub_County': 4,
                'Sub_County_Town_Council_Div': 4,
                'Health_Facility': 5
            }
            # Parse simple conditions: field='value' or field="value"
            # Pattern handles both quoted ("Region") and unquoted (Region) column names
            for match in re.finditer(r'(?:"(\w+)"|(\w+))\s*=\s*[\'"]([^\'"]+)[\'"]', conditions):
                field = match.group(1) or match.group(2)  # Get whichever group matched
                value = match.group(3)
                if field in org_unit_columns:
                    where_ou_filters.append(value)
                    if field in level_mapping:
                        where_ou_level = level_mapping[field]
                    logger.info(f"[DHIS2 Filter Detection] Detected org unit filter: {field} = {value}")
                else:
                    if field not in params:  # Don't override existing params
                        params[field] = value
            # Handle IN clauses: field IN ('val1', 'val2', ...)
            # Pattern handles both quoted ("Region") and unquoted (Region) column names
            for match in re.finditer(r'(?:"(\w+)"|(\w+))\s+IN\s*\(([^)]+)\)', conditions, re.IGNORECASE):
                field = match.group(1) or match.group(2)  # Get whichever group matched
                values_str = match.group(3)
                values = re.findall(r'[\'"]([^\'"]+)[\'"]', values_str)
                if field in org_unit_columns:
                    where_ou_filters.extend(values)
                    if field in level_mapping:
                        where_ou_level = level_mapping[field]
                    logger.info(f"[DHIS2 Filter Detection] Detected org unit IN filter: {field} IN {values}")
                else:
                    if field not in params:  # Don't override existing params
                        params[field] = ";".join(values)

        # FINAL: Merge all parameter sources with correct precedence
        # Priority: base_params_from_comments < params < WHERE clause org unit filters
        final_params = {}

        # Start with SQL comments (base params)
        if base_params_from_comments:
            final_params.update(base_params_from_comments)
            print(f"[DHIS2] Base params from SQL comments: {list(base_params_from_comments.keys())}")
            logger.info(f"Using base parameters from SQL comments")

        # Override with params from Flask g/cache/SELECT
        final_params.update(params)

        # CRITICAL: If WHERE clause has org unit filters, they OVERRIDE the 'ou' parameter
        # This enables dashboard filters to work correctly
        if where_ou_filters:
            final_params['ou_name_filters'] = where_ou_filters
            if where_ou_level:
                final_params['ou_filter_level'] = where_ou_level
            print(f"[DHIS2] WHERE clause org unit filters will OVERRIDE base 'ou' param: {where_ou_filters[:3]}")
            logger.info(f"WHERE clause org unit filters detected: {where_ou_filters[:5]} - will override base ou param")

        return final_params

    def _merge_params(self, endpoint: str, query_params: dict[str, str]) -> dict[str, str]:
        """
        Merge parameters with precedence: query > endpoint-specific > global defaults
        Adds sensible DHIS2 defaults for common endpoints
        """
        merged = {}

        # Layer 0: DHIS2 smart defaults based on endpoint
        # Only add defaults if not overridden by query params
        if endpoint == "analytics":
            # Check if query has explicit period (DHIS2 API rule: can't use both period AND startDate/endDate)
            has_period = False
            
            # Check for pe parameter directly (before conversion to dimension)
            if "pe" in query_params and query_params["pe"]:
                has_period = True
            
            # Or check for period in dimension parameter
            if "dimension" in query_params:
                dimensions = query_params["dimension"].split(";")
                has_period = has_period or any(d.startswith("pe:") for d in dimensions)

            # Only add startDate/endDate if NO period specified
            # (DHIS2 API rule: cannot use period AND startDate/endDate simultaneously)
            if not has_period:
                from datetime import datetime, timedelta
                end_date = datetime.now()
                start_date = end_date - timedelta(days=365)  # Last year

                merged.update({
                    "startDate": start_date.strftime("%Y-%m-%d"),
                    "endDate": end_date.strftime("%Y-%m-%d"),
                })
            else:
                logger.info("Period dimension detected - omitting startDate/endDate (DHIS2 API rule)")

            # Always add these defaults
            merged.update({
                "skipMeta": "false",
                "displayProperty": "NAME",
            })

        elif endpoint == "dataValueSets":
            # Default dataValueSets parameters
            from datetime import datetime, timedelta
            end_date = datetime.now()
            start_date = end_date - timedelta(days=365)

            merged.update({
                "startDate": start_date.strftime("%Y-%m-%d"),
                "endDate": end_date.strftime("%Y-%m-%d"),
            })

        # Layer 1: Global defaults
        merged.update(self.connection.default_params)

        # Layer 2: Endpoint-specific parameters
        endpoint_config = self.connection.endpoint_params.get(endpoint, {})
        merged.update(endpoint_config)

        # Layer 3: Query-time parameters (highest priority)
        merged.update(query_params)

        return merged

    def _make_api_request(self, endpoint: str, params: dict[str, str], query: str = "") -> list[dict]:
        """
        Execute DHIS2 API request with given parameters
        Returns list of result rows

        Args:
            endpoint: DHIS2 endpoint name
            params: Query parameters
            query: Original SQL query (for pivot detection)

        Caching:
            This method integrates with DHIS2CacheService to cache API responses.
            Cache hits return instantly, cache misses fetch from DHIS2 and store.

        Loading Strategies:
            Uses intelligent batching and retry logic to avoid timeouts:
            - DIRECT: Single request for small queries
            - BATCHED: Split data elements into batches
            - PAGINATED: Add pagination for large result sets
            - ASYNC_QUEUE: Background processing for very large queries
        """
        import time
        start_time = time.time()

        # ============================================================
        # CACHING LAYER - Check cache before making API request
        # ============================================================
        try:
            from superset.db_engine_specs.dhis2_cache import get_dhis2_cache
            from superset.db_engine_specs.dhis2_cache import get_dhis2_cache
            cache = get_dhis2_cache()

            # Check cache first
            cached_data = cache.get(endpoint, params, self.connection.base_url)
            if cached_data is not None:
                cache_time = time.time() - start_time
                print(f"[DHIS2] ⚡ CACHE HIT for {endpoint} ({cache_time*1000:.1f}ms)")
                logger.info(f"[DHIS2 Cache] HIT for {endpoint} - returning cached data instantly")

                # Parse the cached response
                rows = self._parse_response(endpoint, cached_data, query)
                return rows
        except ImportError:
            logger.debug("[DHIS2] Cache module not available, proceeding without cache")
            cache = None
        except Exception as e:
            logger.warning(f"[DHIS2] Cache check failed: {e}, proceeding without cache")
            cache = None

        # ============================================================
        # LOADING STRATEGY SELECTION - Intelligently choose how to load
        # ============================================================
        try:
            from superset.db_engine_specs.dhis2_loading_strategies import (
                DHIS2LoadingStrategy,
                TimeoutConfig,
                LoadStrategy,
            )
            from superset.config import get_app

            # Get DHIS2 loading configuration from Superset config
            try:
                app = get_app()
                loading_config = app.config.get("DHIS2_LOADING_CONFIG", {})
            except Exception:
                loading_config = {}

            # Create loading strategy instance
            timeout_config = TimeoutConfig(
                base_timeout=loading_config.get("base_timeout", 30),
                preview_timeout=loading_config.get("preview_timeout", 10),
                large_query_timeout=loading_config.get("large_query_timeout", 300),
                timeout_per_data_element=loading_config.get("timeout_per_data_element", 5),
                timeout_per_org_unit=loading_config.get("timeout_per_org_unit", 2),
            )
            loading_strategy = DHIS2LoadingStrategy(timeout_config)

            # Extract data elements and org units for complexity calculation
            dimension_str = params.get("dimension", "")
            data_elements = self._extract_dimension_values(dimension_str, "dx")
            org_units = self._extract_dimension_values(dimension_str, "ou")

            # Calculate adaptive timeout
            is_preview = "queryLimit" in params or len(data_elements) <= 1
            adaptive_timeout = loading_strategy.calculate_adaptive_timeout(
                len(data_elements),
                len(org_units),
                is_preview,
            )
            # Use adaptive timeout for this request
            self.connection.timeout = adaptive_timeout

        except ImportError:
            logger.debug("[DHIS2] Loading strategy module not available, using default timeout")
            loading_strategy = None

        # ============================================================
        # CACHE MISS - Make API request
        # ============================================================
        url = f"{self.connection.base_url}/{endpoint}"

        # Convert separate dx, pe, ou parameters to DHIS2 dimension format
        # BEFORE: {dx: 'id1;id2', pe: 'LAST_YEAR', ou: 'ouId', ouMode: 'DESCENDANTS'}
        # AFTER: {dimension: 'dx:id1;id2;pe:LAST_YEAR;ou:ouId;LEVEL-3;LEVEL-4;...'}

        # Check if we need to add dx/pe to existing dimension parameter
        dimension_parts = []
        existing_dimension = params.get("dimension", "")

        if existing_dimension:
            # Parse existing dimension to see what's already there
            dimension_parts = [d.strip() for d in existing_dimension.split(";") if d.strip()]

        # Add data elements if not already in dimension
        if "dx" in params and params["dx"]:
            has_dx = any(d.startswith("dx:") for d in dimension_parts)
            if not has_dx:
                dimension_parts.append(f"dx:{params['dx']}")
                params.pop("dx", None)

        # Add periods if not already in dimension
        if "pe" in params and params["pe"]:
            has_pe = any(d.startswith("pe:") for d in dimension_parts)
            if not has_pe:
                dimension_parts.append(f"pe:{params['pe']}")
                params.pop("pe", None)

        # Handle org units (only if dimension doesn't already have ou:)
        has_ou_dimension = any(d.startswith("ou:") for d in dimension_parts)
        if not has_ou_dimension and "ou" in params and params["ou"]:
            ou_value = params["ou"]
            ou_mode = params.get("ouMode", "").upper()
            data_level_scope = params.get("dataLevelScope", "all_levels").lower()

            # When DESCENDANTS mode is used, we need to add LEVEL-X syntax
            # to get data at each descendant level instead of just aggregated data
            # dataLevelScope options:
            # - all_levels (default): Data at all levels from selected to deepest
            # - lowest_level: Data ONLY at the lowest/deepest level (leaf nodes)
            # - children: Data at one level below selected
            # - selected: Data only at selected org units (no LEVEL syntax)
            if ou_mode == "DESCENDANTS" or data_level_scope in ["all_levels", "lowest_level", "children"]:
                try:
                    # Fetch org unit levels to know what levels exist
                    org_unit_level_names = self._fetch_org_unit_levels()
                    max_level = max(org_unit_level_names.keys()) if org_unit_level_names else 6

                    # Get the levels of selected org units to know starting level
                    ou_ids = [o.strip() for o in ou_value.split(";") if o.strip() and not o.startswith("LEVEL-")]
                    if ou_ids:
                        # Fetch org unit details to get their levels
                        BATCH_SIZE = 50
                        selected_levels = []
                        for batch_start in range(0, len(ou_ids), BATCH_SIZE):
                            batch_ids = ou_ids[batch_start:batch_start + BATCH_SIZE]
                            ou_filter = ",".join(batch_ids)
                            ou_url = f"{self.connection.base_url}/organisationUnits.json?filter=id:in:[{ou_filter}]&fields=id,level&paging=false"
                            try:
                                ou_resp = requests.get(
                                    ou_url,
                                    auth=self.connection.auth,
                                    headers=self.connection.headers,
                                    timeout=60,
                                )
                                if ou_resp.status_code == 200:
                                    for ou in ou_resp.json().get("organisationUnits", []):
                                        if ou.get("level"):
                                            selected_levels.append(ou.get("level"))
                            except Exception as e:
                                logger.warning(f"[DHIS2] Could not fetch org unit levels: {e}")

                        if selected_levels:
                            min_selected_level = min(selected_levels)
                            level_parts = []

                            if data_level_scope == "lowest_level":
                                # Only add the deepest/lowest level
                                level_parts.append(f"LEVEL-{max_level}")
                                logger.info(f"[DHIS2] Using lowest_level scope: LEVEL-{max_level}")
                                print(f"[DHIS2] Using lowest_level scope: LEVEL-{max_level}")
                            elif data_level_scope == "children":
                                # Only add one level below selected
                                next_level = min_selected_level + 1
                                if next_level <= max_level:
                                    level_parts.append(f"LEVEL-{next_level}")
                                    logger.info(f"[DHIS2] Using children scope: LEVEL-{next_level}")
                                    print(f"[DHIS2] Using children scope: LEVEL-{next_level}")
                            else:
                                # all_levels (default with DESCENDANTS): Add all levels below selected
                                for level in range(min_selected_level + 1, max_level + 1):
                                    level_parts.append(f"LEVEL-{level}")
                                logger.info(f"[DHIS2] Using all_levels scope: {level_parts}")
                                print(f"[DHIS2] Using all_levels scope: {level_parts}")

                            if level_parts:
                                # Combine org unit IDs with LEVEL syntax
                                ou_value = f"{ou_value};{';'.join(level_parts)}"

                    # Remove ouMode and dataLevelScope since we're using LEVEL syntax
                    params.pop("ouMode", None)
                    params.pop("dataLevelScope", None)
                except Exception as e:
                    logger.warning(f"[DHIS2] Error building LEVEL syntax: {e}")
                    # Fall back to using ouMode without LEVEL syntax

            dimension_parts.append(f"ou:{ou_value}")
            params.pop("ou", None)

        # Update params with the final dimension string
        if dimension_parts:
            params["dimension"] = ";".join(dimension_parts)
            logger.info(f"Final dimension parameter: {params['dimension']}")

        # Handle dimension parameter specially - DHIS2 requires multiple dimension parameters
        # Format: dimension=dx:id1;id2;id3;pe:LAST_YEAR;ou:OrgUnit
        # Split into: dimension=dx:id1;id2;id3&dimension=pe:LAST_YEAR&dimension=ou:OrgUnit
        query_params = []
        for key, value in params.items():
            if key == "dimension" and ";" in value:
                # Split on dimension prefixes (dx:, pe:, ou:), not all semicolons
                # Use regex to split only before dimension prefixes
                import re
                # Split before dx:, pe:, ou: while keeping the prefix with the value
                dimension_parts = re.split(r';(?=(?:dx|pe|ou):)', value)
                for dim in dimension_parts:
                    if dim:  # Skip empty strings
                        query_params.append(f"dimension={dim}")
            else:
                query_params.append(f"{key}={value}")

        # Build URL with properly formatted parameters
        if query_params:
            url = f"{url}?{'&'.join(query_params)}"

        print(f"[DHIS2] 🔄 CACHE MISS - API request URL: {url}")
        logger.info(f"DHIS2 API request (cache miss): {url}")

        try:
            response = requests.get(
                url,
                auth=self.connection.auth,
                headers=self.connection.headers,
                timeout=self.connection.timeout,
            )

            # Handle 409 Conflict - typically means missing required parameters
            if response.status_code == 409:
                # Log the actual error message from DHIS2
                try:
                    error_data = response.json()
                    error_msg = error_data.get("message", "Unknown error")
                    print(f"[DHIS2] 409 Error from API: {error_msg}")
                    logger.warning(f"DHIS2 API 409 for {endpoint} - {error_msg}")
                except:
                    print(f"[DHIS2] 409 Error (could not parse response)")
                    logger.warning(f"DHIS2 API 409 for {endpoint} - missing parameters")

                # Return empty dataset with generic columns
                self._set_description(["id", "name", "value"])
                return []

            response.raise_for_status()

            data = response.json()

            # Debug: Log raw DHIS2 response structure
            print(f"[DHIS2] Raw API response keys: {list(data.keys())}")
            if "rows" in data:
                print(f"[DHIS2] Raw DHIS2 rows count: {len(data.get('rows', []))}")
                if data.get('rows'):
                    print(f"[DHIS2] First raw row: {data['rows'][0]}")

            # ============================================================
            # CACHE STORAGE - Store successful response in cache
            # ============================================================
            api_time = time.time() - start_time
            if cache is not None:
                try:
                    cache.set(endpoint, params, data, self.connection.base_url)
                    print(f"[DHIS2] ✅ Cached response for {endpoint} (API took {api_time*1000:.1f}ms)")
                    logger.info(f"[DHIS2 Cache] Stored response for {endpoint}")
                except Exception as e:
                    logger.warning(f"[DHIS2 Cache] Failed to store response: {e}")
            else:
                print(f"[DHIS2] API response received (no cache, took {api_time*1000:.1f}ms)")

            # Parse response based on endpoint structure - pass query for pivot detection
            rows = self._parse_response(endpoint, data, query)

            print(f"[DHIS2] Transformed rows count: {len(rows)}")
            if rows:
                print(f"[DHIS2] First transformed row: {rows[0]}")
            logger.info(f"DHIS2 API returned {len(rows)} rows")
            return rows

        except requests.exceptions.HTTPError as e:
            logger.error(f"DHIS2 API HTTP error: {e}")
            raise DHIS2DBAPI.OperationalError(f"DHIS2 API error: {e}")
        except requests.exceptions.Timeout:
            logger.error("DHIS2 API request timeout")
            raise DHIS2DBAPI.OperationalError("Request timeout")
        except Exception as e:
            logger.error(f"DHIS2 API request failed: {e}")
            raise DHIS2DBAPI.OperationalError(f"API request failed: {e}")

    def _extract_dimension_values(self, dimension_str: str, dimension_type: str) -> list[str]:
        """
        Extract specific dimension values from DHIS2 dimension string

        Args:
            dimension_str: Dimension string like "dx:id1;id2;pe:LAST_YEAR;ou:OU1;OU2"
            dimension_type: Dimension type to extract ("dx", "pe", or "ou")

        Returns:
            List of values for the specified dimension type
        """
        if not dimension_str:
            return []

        values = []
        parts = dimension_str.split(";")

        for part in parts:
            if part.startswith(f"{dimension_type}:"):
                # Extract the value after the dimension prefix
                value_part = part[len(f"{dimension_type}:") :]
                if value_part:
                    values.append(value_part)

        return values

    def _extract_hierarchy_info_from_query(self, query: str) -> tuple[list[int], list[str]]:
        """
        Extract hierarchy configuration from query
        
        Always returns all 6 levels since we always include complete hierarchy

        Returns:
            Tuple of ([1,2,3,4,5,6], []) - always return all levels
        """
        return list(range(1, 7)), []

    def _fetch_org_unit_hierarchy(self, org_unit_ids: list[str]) -> dict:
        """
        Fetch complete hierarchy information for given org units from DHIS2 API.
        Uses parent-walking approach (same as dhis2_preview_utils.build_ou_hierarchy)
        to correctly resolve all ancestors by level.

        Returns:
            Dict mapping org unit ID to hierarchy info: {ou_id: {level_1: name, level_2: name, ..., level_6: name}}
        """
        if not org_unit_ids:
            logger.warning("[DHIS2] _fetch_org_unit_hierarchy called with empty org_unit_ids")
            return {}

        try:
            # Step 1: Fetch all org units with parent info using batch queries
            ou_names: dict[str, str] = {}
            ou_levels: dict[str, int] = {}
            ou_parents: dict[str, str | None] = {}
            all_parent_ids: set[str] = set()

            BATCH_SIZE = 50
            unique_ou_ids = list(set(org_unit_ids))
            logger.info(f"[DHIS2] _fetch_org_unit_hierarchy: Fetching {len(unique_ou_ids)} unique org units in batches...")
            print(f"[DHIS2] _fetch_org_unit_hierarchy: Fetching {len(unique_ou_ids)} unique org units")

            for batch_start in range(0, len(unique_ou_ids), BATCH_SIZE):
                batch_ids = unique_ou_ids[batch_start:batch_start + BATCH_SIZE]
                ou_filter = ",".join(batch_ids)
                url = f"{self.connection.base_url}/organisationUnits.json?filter=id:in:[{ou_filter}]&fields=id,name,displayName,level,parent[id]&paging=false"

                try:
                    response = requests.get(
                        url,
                        auth=self.connection.auth,
                        headers=self.connection.headers,
                        timeout=300,
                    )

                    if response.status_code == 200:
                        ou_data = response.json().get("organisationUnits", [])
                        print(f"[DHIS2] Batch {batch_start//BATCH_SIZE + 1}: Got {len(ou_data)} org units from DHIS2")
                        for ou in ou_data:
                            ou_id = ou.get("id")
                            if not ou_id:
                                continue
                            ou_names[ou_id] = ou.get("displayName") or ou.get("name") or ou_id
                            ou_levels[ou_id] = ou.get("level", 0)
                            parent_obj = ou.get("parent")
                            parent_id = parent_obj.get("id") if isinstance(parent_obj, dict) else None
                            ou_parents[ou_id] = parent_id

                            # Collect parent IDs for fetching
                            if parent_id:
                                all_parent_ids.add(parent_id)

                            # Debug: Log first few org units
                            if len(ou_names) <= 3:
                                print(f"[DHIS2]   OU: {ou_id}, name={ou_names[ou_id]}, level={ou_levels[ou_id]}, parent={parent_id}")
                    else:
                        logger.warning(f"[DHIS2] Failed to fetch org units batch: HTTP {response.status_code}")
                        print(f"[DHIS2] ERROR: Batch fetch failed with HTTP {response.status_code}")
                except Exception as e:
                    logger.warning(f"[DHIS2] Error fetching org units batch: {e}")

            logger.info(f"[DHIS2] Fetched {len(ou_names)} org units, found {len(all_parent_ids)} parent IDs")

            # Step 2: Fetch all ancestors by walking up the parent chain
            # Keep fetching parents until we've resolved all of them
            max_iterations = 10  # Safety limit for hierarchy depth
            iteration = 0

            while all_parent_ids and iteration < max_iterations:
                iteration += 1
                missing_parents = [p for p in all_parent_ids if p not in ou_names]

                if not missing_parents:
                    break

                logger.info(f"[DHIS2] Iteration {iteration}: Fetching {len(missing_parents)} missing parent org units...")
                new_parent_ids: set[str] = set()

                for batch_start in range(0, len(missing_parents), BATCH_SIZE):
                    batch_ids = missing_parents[batch_start:batch_start + BATCH_SIZE]
                    anc_filter = ",".join(batch_ids)
                    anc_url = f"{self.connection.base_url}/organisationUnits.json?filter=id:in:[{anc_filter}]&fields=id,name,displayName,level,parent[id]&paging=false"

                    try:
                        anc_response = requests.get(
                            anc_url,
                            auth=self.connection.auth,
                            headers=self.connection.headers,
                            timeout=300,
                        )
                        if anc_response.status_code == 200:
                            ancestors = anc_response.json().get("organisationUnits", [])
                            for anc in ancestors:
                                anc_id = anc.get("id")
                                if not anc_id:
                                    continue
                                ou_names[anc_id] = anc.get("displayName") or anc.get("name") or anc_id
                                ou_levels[anc_id] = anc.get("level", 0)
                                parent_obj = anc.get("parent")
                                parent_id = parent_obj.get("id") if isinstance(parent_obj, dict) else None
                                ou_parents[anc_id] = parent_id

                                if parent_id:
                                    new_parent_ids.add(parent_id)
                    except Exception as e:
                        logger.warning(f"[DHIS2] Error fetching ancestors batch: {e}")

                all_parent_ids = new_parent_ids

            logger.info(f"[DHIS2] Total org unit names available: {len(ou_names)}")
            print(f"[DHIS2] Total org unit names available: {len(ou_names)} after {iteration} iterations")

            # Step 3: Build hierarchy dict for each org unit by walking up parent chain
            hierarchy_data = {}
            for ou_id in unique_ou_ids:
                hierarchy_info = {f'level_{i}': None for i in range(1, 7)}

                # Walk up the parent chain to build ancestors_by_level
                current_id: str | None = ou_id
                visited: set[str] = set()
                depth = 0
                max_depth = 10

                while current_id and current_id not in visited and depth < max_depth:
                    visited.add(current_id)
                    depth += 1

                    current_level = ou_levels.get(current_id, 0)
                    current_name = ou_names.get(current_id, current_id)

                    # Add to hierarchy if valid level
                    if current_level and 1 <= current_level <= 6:
                        hierarchy_info[f'level_{current_level}'] = current_name

                    # Move to parent
                    parent_id = ou_parents.get(current_id)
                    if parent_id:
                        current_id = parent_id
                    else:
                        break

                hierarchy_data[ou_id] = hierarchy_info

            # Log sample for debugging
            if hierarchy_data:
                sample_ou = list(hierarchy_data.keys())[0]
                print(f"[DHIS2] Sample hierarchy for {sample_ou}: {hierarchy_data[sample_ou]}")
                # Log a few more samples
                for i, (ou_id, h) in enumerate(hierarchy_data.items()):
                    if i >= 3:
                        break
                    filled_levels = [k for k, v in h.items() if v is not None]
                    print(f"[DHIS2]   {ou_id}: filled levels = {filled_levels}")
                logger.info(f"[DHIS2] Sample hierarchy for {sample_ou}: {hierarchy_data[sample_ou]}")

            logger.info(f"[DHIS2] _fetch_org_unit_hierarchy completed: {len(hierarchy_data)} org units with hierarchy")
            return hierarchy_data

        except Exception as e:
            logger.error(f"[DHIS2] Error in _fetch_org_unit_hierarchy: {str(e)}", exc_info=True)
            return {}

    def _fetch_org_unit_levels(self) -> dict[int, str]:
        """
        Fetch org unit level names from DHIS2 metadata API
        
        Returns:
            Dict mapping level number to level name: {1: "Country", 2: "Region", ...}
        """
        try:
            url = f"{self.connection.base_url}/organisationUnitLevels"
            params = {'fields': 'level,displayName', 'paging': 'false'}
            
            response = requests.get(
                url,
                auth=self.connection.auth,
                headers=self.connection.headers,
                timeout=self.connection.timeout,
                params=params,
            )
            
            if response.status_code == 200:
                data = response.json()
                levels_map = {}
                for level in data.get('organisationUnitLevels', []):
                    level_num = level.get('level')
                    level_name = level.get('displayName', f'Level_{level_num}')
                    if level_num:
                        levels_map[level_num] = level_name
                
                logger.info(f"Fetched org unit levels: {levels_map}")
                return levels_map
            else:
                logger.warning(f"Failed to fetch org unit levels: {response.status_code}")
                return {}
        except Exception as e:
            logger.warning(f"Error fetching org unit levels: {str(e)}")
            return {}

    def _parse_response(self, endpoint: str, data: dict, query: str = "") -> list[tuple]:
        """
        Parse DHIS2 API response using endpoint-aware normalizers

        Args:
            endpoint: DHIS2 endpoint name
            data: JSON response from DHIS2 API
            query: Original SQL query (for pivot detection)
        """
        print(f"[DHIS2] Parsing response for endpoint: {endpoint}")
        print(f"[DHIS2] Response keys: {list(data.keys())}")
        print(f"[DHIS2] Response sample: {str(data)[:500]}")

        # Use WIDE/PIVOTED format for analytics data - Period + Hierarchy levels + Data elements as columns
        # Wide format enables:
        # - Hierarchy levels as separate columns for cascade filtering
        # - Direct column selection for org unit levels
        # - Better for geospatial charts like DHIS2Map
        # - Compatible with boundary matching by org unit level
        #
        # WIDE format provides hierarchy context needed for cascade-filtered maps
        should_pivot = True  # Use WIDE format for hierarchy level columns

        format_msg = "WIDE/PIVOTED format (Period, Level_1_Name, Level_2_Name, ..., DX1, DX2, ...)" if should_pivot else "LONG format"
        print(f"[DHIS2] Using {format_msg} for {endpoint}")
        logger.info(f"Using {'wide/pivoted' if should_pivot else 'long'} format for {endpoint}")

        # Fetch org unit level names for column naming
        org_unit_level_names = self._fetch_org_unit_levels()
        
        # ALWAYS fetch hierarchy for analytics data to ensure complete hierarchy in chart data
        # This matches the behavior of dhis2_chart_data endpoint which returns full hierarchy
        org_unit_hierarchy = None

        # Extract all org unit IDs from the response data
        try:
            org_units = set()
            if endpoint == "analytics" and "rows" in data:
                # Find the ou column index from headers
                headers = data.get("headers", [])
                print(f"[DHIS2] Analytics headers: {headers}")
                ou_idx = None
                for idx, h in enumerate(headers):
                    header_name = h.get("name") if isinstance(h, dict) else h
                    header_col = h.get("column") if isinstance(h, dict) else None
                    if header_name == "ou" or header_col == "ou":
                        ou_idx = idx
                        print(f"[DHIS2] Found 'ou' column at index {ou_idx}")
                        break

                if ou_idx is not None:
                    rows_data = data.get("rows", [])
                    print(f"[DHIS2] Processing {len(rows_data)} rows to extract org unit IDs")
                    for row in rows_data:
                        if len(row) > ou_idx and row[ou_idx]:
                            org_units.add(row[ou_idx])
                    print(f"[DHIS2] Extracted {len(org_units)} unique org unit IDs from rows")
                    print(f"[DHIS2] Found {len(org_units)} unique org units in analytics response")
                else:
                    print(f"[DHIS2] Warning: Could not find 'ou' column in headers: {headers}")

            elif endpoint == "dataValueSets" and "dataValues" in data:
                for dv in data.get("dataValues", []):
                    if dv.get("orgUnit"):
                        org_units.add(dv["orgUnit"])
                print(f"[DHIS2] Found {len(org_units)} unique org units in dataValueSets response")

            if org_units:
                print(f"[DHIS2] Fetching hierarchy for {len(org_units)} org units...")
                org_unit_hierarchy = self._fetch_org_unit_hierarchy(list(org_units))
                print(f"[DHIS2] Fetched hierarchy for {len(org_unit_hierarchy)} org units")
                if org_unit_hierarchy:
                    # Log sample hierarchy
                    sample_ou = list(org_unit_hierarchy.keys())[0] if org_unit_hierarchy else None
                    if sample_ou:
                        print(f"[DHIS2] Sample hierarchy for {sample_ou}: {org_unit_hierarchy[sample_ou]}")
            else:
                print(f"[DHIS2] No org units found in response data")
        except Exception as e:
            print(f"[DHIS2] Warning: Could not fetch org unit hierarchy: {e}")
            logger.warning(f"Could not fetch org unit hierarchy: {e}")
            org_unit_hierarchy = None

        print(f"[DHIS2] Calling DHIS2ResponseNormalizer.normalize with:")
        print(f"[DHIS2]   - endpoint: {endpoint}")
        print(f"[DHIS2]   - pivot: {should_pivot}")
        print(f"[DHIS2]   - org_unit_hierarchy: {len(org_unit_hierarchy) if org_unit_hierarchy else 'None'} entries")
        print(f"[DHIS2]   - org_unit_level_names: {org_unit_level_names}")

        col_names, rows = DHIS2ResponseNormalizer.normalize(
            endpoint,
            data,
            pivot=should_pivot,
            org_unit_hierarchy=org_unit_hierarchy,
            selected_levels=list(range(1, 7)),
            org_unit_level_names=org_unit_level_names,
        )

        print(f"[DHIS2] Normalized columns: {col_names}")
        print(f"[DHIS2] Normalized row count: {len(rows)}")
        if rows:
            print(f"[DHIS2] First row: {rows[0]}")

        # Set cursor description
        self._set_description(col_names)

        logger.info(f"Normalized {len(rows)} rows with {len(col_names)} columns for endpoint {endpoint}")
        return rows

    def _set_description(self, col_names: list[str]):
        """Set cursor description from column names with proper types

        IMPORTANT: All column names must be sanitized to match the dataset columns
        that were saved during dataset creation. The sanitization ensures:
        - Special characters like '.', '-', '/', '(' are replaced with '_'
        - Spaces are replaced with '_'
        - Column names match exactly between dataset metadata and query results
        """
        self._description = []
        for name in col_names:
            # Ensure column name is sanitized to match dataset columns
            sanitized_name = sanitize_dhis2_column_name(name)

            # Set proper type based on column name
            if sanitized_name in ["Value", "value"]:
                # Value column is numeric (can be aggregated)
                col_type = types.Float
            else:
                # All other columns are strings (dimensions)
                col_type = types.String

            self._description.append((sanitized_name, col_type, None, None, None, None, True))

        sanitized_cols = [desc[0] for desc in self._description]
        print(f"[DHIS2] _set_description: original={col_names}, sanitized={sanitized_cols}, types={[desc[1].__name__ for desc in self._description]}")

    def _translate_query_column_names(self, query: str, table_name: str) -> str:
        """
        Translate unsanitized column names in GROUP BY and ORDER BY clauses to sanitized names.
        
        The chart builder sends queries with display names (unsanitized), but the database
        has sanitized column names. This method translates them.
        
        Example:
            IN:  GROUP BY "105-EP01a. Suspected fever", "Period"
            OUT: GROUP BY "105_EP01a_Suspected_fever", "Period"
        """
        try:
            # Try to get column metadata to build translation map
            # This is best-effort - if we can't get metadata, we'll still try regex-based approach
            from flask import g as flask_g
            
            # Check if we have cached column metadata
            if hasattr(flask_g, 'dhis2_column_map') and table_name in flask_g.dhis2_column_map:
                column_map = flask_g.dhis2_column_map[table_name]
                # column_map is {sanitized: original} - we need reverse: {original: sanitized}
                reverse_map = {v: k for k, v in column_map.items()}
                
                # Replace unsanitized names with sanitized ones in GROUP BY and ORDER BY
                # Match quoted and unquoted column names
                for original, sanitized in reverse_map.items():
                    # Match quoted versions: "105-EP01a. Suspected fever"
                    query = query.replace(f'"{original}"', f'"{sanitized}"')
                    # Also handle without quotes
                    query = query.replace(f"'{original}'", f"'{sanitized}'")
            
            return query
        except Exception as e:
            logger.warning(f"[DHIS2] Could not translate column names: {e}")
            # Return original query if translation fails
            return query

    def execute(self, query: str, parameters=None):
        """
        Execute SQL query by translating to DHIS2 API call with dynamic parameters
        """
        print(f"[DHIS2] Executing query: {query}")
        logger.info(f"Executing DHIS2 query: {query}")
        
        # Extract table name and translate column references
        from_match = re.search(r'FROM\s+(\w+)', query, re.IGNORECASE)
        table_name = from_match.group(1) if from_match else "analytics"
        query = self._translate_query_column_names(query, table_name)

        # Parse query to get endpoint and parameters
        endpoint = self._parse_endpoint_from_query(query)
        print(f"[DHIS2] Parsed endpoint: {endpoint}")
        logger.info(f"Parsed endpoint: {endpoint}")

        query_params = self._extract_query_params(query)
        print(f"[DHIS2] Query params: {query_params}")
        logger.info(f"Query params: {query_params}")

        # NEW: Handle cascading filter requests
        # Check if Flask g object contains cascade parent parameters (set by datasource API)
        try:
            from flask import g as flask_g

            # Check if cascade parameters were stored in Flask g by the datasource API
            cascade_parent_column = getattr(flask_g, 'dhis2_cascade_parent_column', None)
            cascade_parent_value = getattr(flask_g, 'dhis2_cascade_parent_value', None)

            if cascade_parent_column and cascade_parent_value:
                logger.info(f"[DHIS2 Cascade] Detected cascade request: parent_column={cascade_parent_column}, parent_value={cascade_parent_value}")
                print(f"[DHIS2 Cascade] 🔗 Cascade filter detected: {cascade_parent_column} = {cascade_parent_value}")

                # Parse parent values (may be list or comma-separated string)
                if isinstance(cascade_parent_value, list):
                    parent_values = cascade_parent_value
                else:
                    parent_values = [v.strip() for v in str(cascade_parent_value).split(',') if v.strip()]

                # Determine child level from query context
                # Look for column name in SELECT to infer level
                child_level = None
                if 'District' in query or 'district' in query.lower():
                    child_level = 3  # District level
                elif 'Sub_County' in query or 'subcounty' in query.lower() or 'Sub_County_Town_Council_Div' in query:
                    child_level = 4  # Sub-County level
                elif 'Health_Facility' in query or 'facility' in query.lower():
                    child_level = 5  # Health Facility level

                # Fetch child org units based on parent selection
                child_org_units = self.connection.fetch_child_org_units(parent_values, child_level)

                if child_org_units:
                    # Override the query to return child org units directly
                    # This bypasses the normal analytics query and returns hierarchy data
                    logger.info(f"[DHIS2 Cascade] Returning {len(child_org_units)} filtered options")
                    print(f"[DHIS2 Cascade] ✅ Returning {len(child_org_units)} cascade options")

                    # Store results directly - format as (displayName,) tuples for Superset
                    self._rows = [(ou.get('displayName'),) for ou in child_org_units]
                    self.rowcount = len(self._rows)

                    # Clear cascade parameters from Flask g
                    if hasattr(flask_g, 'dhis2_cascade_parent_column'):
                        delattr(flask_g, 'dhis2_cascade_parent_column')
                    if hasattr(flask_g, 'dhis2_cascade_parent_value'):
                        delattr(flask_g, 'dhis2_cascade_parent_value')

                    return

        except Exception as e:
            # Cascade filtering is optional - if it fails, continue with normal query
            logger.debug(f"[DHIS2 Cascade] Not a cascade request or cascade failed: {e}")

        # NEW: Resolve org unit name filters to UIDs before API call
        # This handles dashboard native filters that pass display names instead of UIDs
        if 'ou_name_filters' in query_params and query_params['ou_name_filters']:
            ou_names = query_params['ou_name_filters']
            ou_level = query_params.get('ou_filter_level')

            logger.info(f"[DHIS2 Filter Resolution] Detected {len(ou_names)} org unit name filters: {ou_names[:5]}")
            print(f"[DHIS2 Filter Resolution] 🔍 Resolving {len(ou_names)} org unit names to UIDs...")

            # Resolve names to UIDs using DHIS2 API
            name_to_uid = self.connection.resolve_orgunit_names_to_uids(ou_names, ou_level)

            if name_to_uid:
                # Convert names to UIDs
                resolved_uids = []
                for name in ou_names:
                    uid = name_to_uid.get(name)
                    if uid:
                        resolved_uids.append(uid)
                    else:
                        logger.warning(f"[DHIS2 Filter Resolution] Could not resolve '{name}', will try using name as-is")
                        resolved_uids.append(name)  # Fallback to name

                # Build ou dimension parameter
                ou_param = ";".join(resolved_uids)

                # Update the dimension parameter with resolved UIDs
                if 'dimension' in query_params:
                    # Parse existing dimensions
                    existing_dims = query_params['dimension'].split(';')
                    # Remove any existing ou dimension
                    existing_dims = [d for d in existing_dims if not d.startswith('ou:')]
                    # Add new ou dimension with UIDs
                    query_params['dimension'] = ';'.join(existing_dims + [f"ou:{ou_param}"])
                    logger.info(f"[DHIS2 Filter Resolution] Updated existing dimension parameter with ou UIDs")
                else:
                    # Add as new dimension
                    query_params['dimension'] = f"ou:{ou_param}"
                    logger.info(f"[DHIS2 Filter Resolution] Added new dimension parameter: ou:{ou_param}")

                # CRITICAL: Remove the old 'ou' parameter to avoid conflicts
                # When dimension=ou: is set, the standalone 'ou' parameter should not be used
                if 'ou' in query_params:
                    old_ou = query_params['ou']
                    del query_params['ou']
                    logger.info(f"[DHIS2 Filter Resolution] Removed old 'ou' parameter (was: {old_ou}) to avoid conflict with dimension=ou:")
                    print(f"[DHIS2 Filter Resolution] Removed old 'ou' param (was: {old_ou[:50]}...)")

                # Also remove ouMode when using explicit dimension=ou: (DHIS2 API rule)
                if 'ouMode' in query_params:
                    old_ouMode = query_params['ouMode']
                    del query_params['ouMode']
                    logger.info(f"[DHIS2 Filter Resolution] Removed 'ouMode' parameter (was: {old_ouMode}) - not needed with dimension=ou:")

                logger.info(f"[DHIS2 Filter Resolution] ✅ Resolved {len(name_to_uid)}/{len(ou_names)} names to UIDs")
                print(f"[DHIS2 Filter Resolution] ✅ Resolved UIDs: {resolved_uids[:3]}{'...' if len(resolved_uids) > 3 else ''}")

                # Show sample mappings for debugging
                sample_mappings = dict(list(name_to_uid.items())[:3])
                print(f"[DHIS2 Filter Resolution] 📋 Sample mappings: {sample_mappings}")
            else:
                logger.warning(f"[DHIS2 Filter Resolution] ⚠️  Could not resolve any org unit names to UIDs")
                print(f"[DHIS2 Filter Resolution] ⚠️  No names could be resolved - filters may not work")

            # Remove the temporary filter tracking params
            del query_params['ou_name_filters']
            if 'ou_filter_level' in query_params:
                del query_params['ou_filter_level']

        # Merge all parameter sources
        api_params = self._merge_params(endpoint, query_params)
        print(f"[DHIS2] Merged params: {api_params}")
        logger.info(f"Merged params: {api_params}")

        # Execute API request - pass query for pivot detection
        self._rows = self._make_api_request(endpoint, api_params, query)
        self.rowcount = len(self._rows)
        print(f"[DHIS2] Fetched {self.rowcount} rows")

    def fetchall(self):
        """
        Fetch all rows with STRICT type enforcement to prevent Pandas numeric inference.

        Problem: Pandas sees "105- Total Linked to HIV care" and tries to convert to numeric
        Solution: Force dimensions to STRING, measures to FLOAT at cursor level

        This prevents:
        - Superset from treating dimensions as metrics
        - Pandas from inferring wrong types
        - Chart code from accidentally aggregating dimension columns
        """
        print(f"[DHIS2] fetchall() called - returning {len(self._rows)} rows")
        logger.info(f"[DHIS2] fetchall() - Row count: {len(self._rows)}")

        if not self._rows:
            return self._rows

        print(f"[DHIS2] fetchall() - First row type: {type(self._rows[0])}")
        print(f"[DHIS2] fetchall() - First row (original): {self._rows[0]}")
        print(f"[DHIS2] fetchall() - Column count from description: {len(self._description)}")

        # Extract column names from cursor description
        column_names = [desc[0] for desc in self._description]
        logger.info(f"[DHIS2] fetchall() column_names: {column_names}")
        logger.info(f"[DHIS2] fetchall() column_names length: {len(column_names)}")

        if self._rows:
            row_0 = self._rows[0]
            logger.info(f"[DHIS2] First row values count: {len(row_0) if hasattr(row_0, '__len__') else 1}")
            logger.info(f"[DHIS2] First row values: {row_0}")

        # Process each row with strict type enforcement
        fixed_rows = []
        for row_idx, row in enumerate(self._rows):
            fixed_row = []
            for col_idx, (col_name, value) in enumerate(zip(column_names, row)):
                # DIMENSION columns: ALWAYS string (never aggregate)
                if col_name in ['Period', 'OrgUnit', 'DataElement', 'period', 'orgUnit', 'dataElement']:
                    # Force to string to prevent Pandas from treating "105-..." as numeric
                    fixed_value = str(value) if value is not None else None
                    fixed_row.append(fixed_value)
                    if row_idx == 0 and col_idx < 3:
                        logger.info(f"[DHIS2] Row 0 col {col_idx} ({col_name}): {value} -> {fixed_value} (STRING)")

                # MEASURE columns: ALWAYS float (can aggregate)
                elif col_name in ['Value', 'value']:
                    # Safe numeric conversion
                    try:
                        fixed_value = float(value) if value is not None else None
                        fixed_row.append(fixed_value)
                        if row_idx == 0:
                            logger.info(f"[DHIS2] Row 0 col {col_idx} ({col_name}): {value} -> {fixed_value} (FLOAT)")
                    except (ValueError, TypeError):
                        fixed_row.append(None)
                        logger.warning(f"[DHIS2] Could not convert {col_name}={value} to float")

                # Other columns: keep as-is
                else:
                    # Check if value looks like a dimension (non-numeric string)
                    # This catches dimension columns that aren't in the known list
                    if value is not None and isinstance(value, str):
                        try:
                            float(value)
                            # It's a numeric string - could be a value column, keep as-is
                            fixed_row.append(value)
                        except ValueError:
                            # It's a non-numeric string - treat as dimension (force to string)
                            fixed_row.append(str(value))
                            if row_idx == 0:
                                logger.info(f"[DHIS2] Row 0 col {col_idx} ({col_name}): '{value[:30]}...' -> STRING (non-numeric detected)")
                    else:
                        fixed_row.append(value)

                    if row_idx == 0 and col_idx < 5:
                        logger.info(f"[DHIS2] Row 0 col {col_idx} ({col_name}): {value} (PROCESSED)")

            fixed_rows.append(tuple(fixed_row))

        if fixed_rows:
            print(f"[DHIS2] fetchall() - First row (fixed types): {fixed_rows[0]}")
            print(f"[DHIS2] fetchall() - Type enforcement: dimensions=STRING, measures=FLOAT")
            logger.info(f"[DHIS2] fetchall() returning {len(fixed_rows)} rows with {len(column_names)} columns each")

        return fixed_rows

    def fetchone(self):
        """Fetch one row"""
        if self._rows:
            return self._rows.pop(0)
        return None

    def fetchmany(self, size=None):
        """Fetch many rows"""
        if size is None:
            size = 1
        result = self._rows[:size]
        self._rows = self._rows[size:]
        return result

    def close(self):
        """Close cursor"""
        pass

    @property
    def description(self):
        """Return column descriptions"""
        return self._description

    @description.setter
    def description(self, value):
        """Set column descriptions"""
        self._description = value
