# DHIS2 Chart Creation Issue: Discovery and Proposed Solutions

## 1. The Problem

When attempting to create a chart from a DHIS2 dataset, the process fails. The application logs show a `409 Conflict` error from the DHIS2 API, with the message: `DHIS2 API 409 for analytics - missing parameters. Returning empty result.`

## 2. The Root Cause

The DHIS2 `analytics` API endpoint requires at least one dimension to be specified in the request. The current implementation of the Superset DHIS2 dialect in `superset/db_engine_specs/dhis2_dialect.py` does not provide a default dimension when no explicit dimensions are specified in the query. This results in an invalid API request and a `409 Conflict` error.

The relevant code block in `_merge_params` method of `DHIS2Cursor` class is:

```python
        if endpoint == "analytics":
            # Check if query has explicit period dimension (pe:)
            has_period_dimension = False
            if "dimension" in query_params:
                dimensions = query_params["dimension"].split(";")
                has_period_dimension = any(d.startswith("pe:") for d in dimensions)

            # Only add startDate/endDate if no explicit period dimension
            if not has_period_dimension:
                from datetime import datetime, timedelta
                end_date = datetime.now()
                start_date = end_date - timedelta(days=365)  # Last year

                merged.update({
                    "startDate": start_date.strftime("%Y-%m-%d"),
                    "endDate": end_date.strftime("%Y-%m-%d"),
                })

            # Always add these defaults
            merged.update({
                "skipMeta": "false",
                "displayProperty": "NAME",
            })
```

This code adds default `startDate` and `endDate` parameters, but it does not add a default dimension, which is causing the issue.

## 3. Proposed Solutions

### Solution A: Quick Fix - Add a Default Dimension

The quickest way to resolve this issue is to add a default dimension to the `analytics` API requests when no other dimensions are specified. This can be done by modifying the `_merge_params` method in `superset/db_engine_specs/dhis2_dialect.py`.

**Proposed Change:**

```python
            # Only add startDate/endDate if no explicit period dimension
            if not has_period_dimension:
                from datetime import datetime, timedelta
                end_date = datetime.now()
                start_date = end_date - timedelta(days=365)  # Last year

                merged.update({
                    "startDate": start_date.strftime("%Y-%m-%d"),
                    "endDate": end_date.strftime("%Y-%m-%d"),
                })
            
            has_dx_dimension = False
            if "dimension" in query_params:
                dimensions = query_params["dimension"].split(";")
                has_dx_dimension = any(d.startswith("dx:") for d in dimensions)

            if not has_dx_dimension:
                merged.update({
                    "dimension": "dx:FTRrcoaog83;FQ2o8UBlcrS;eomLLbWJfcx;QhKQD2wHowC",
                })

            # Always add these defaults
            merged.update({
                "skipMeta": "false",
                "displayProperty": "NAME",
            })
```

This change will add a default `dimension` parameter with a valid value if no `dx` dimension is already present in the query. This will fix the immediate issue and allow charts to be created.

### Solution B: Dynamic Column Discovery

A more robust and long-term solution is to dynamically discover the columns from the DHIS2 API response. This would involve the following steps:

1.  Read the `headers` array from the DHIS2 API response.
2.  Convert the `headers` into Superset column definitions (`Column` objects with `name` and `type`).
3.  Return these column definitions when Superset calls `get_columns()` or `fetch_result()`.

This would make the DHIS2 connector more adaptable to different DHIS2 instances and would eliminate the need for hardcoded column definitions. This is a more involved solution that would require more significant changes to the `dhis2_dialect.py` file.

## 4. Recommendation

I recommend implementing **Solution A** first, as it is a quick and simple fix that will resolve the immediate issue. This will allow you to create charts from DHIS2 datasets without further delay.

Once the immediate issue is resolved, we can then work on implementing **Solution B** as a long-term improvement to the DHIS2 connector.

## 5. Implementation Plan for Dynamic Column Discovery

Here is a detailed plan for implementing the "Dynamic Column Discovery" solution:

### Step 1: Modify `DHIS2Cursor._make_api_request`

In `superset/db_engine_specs/dhis2_dialect.py`, modify the `_make_api_request` method to return the `headers` from the response.

```python
    def _make_api_request(self, endpoint: str, params: dict[str, str]) -> tuple[list[dict], list[dict]]:
        """
        Execute DHIS2 API request with given parameters
        Returns a tuple of (rows, headers)
        """
        url = f"{self.connection.base_url}/{endpoint}"

        # ... (rest of the method is the same)

        try:
            response = requests.get(
                url,
                auth=self.connection.auth,
                headers=self.connection.headers,
                timeout=self.connection.timeout,
            )

            # Handle 409 Conflict - typically means missing required parameters
            if response.status_code == 409:
                # During connection tests or schema introspection, return empty result
                # instead of erroring. This allows the connection to succeed.
                logger.warning(f"DHIS2 API 409 for {endpoint} - missing parameters. Returning empty result.")

                # Return empty dataset with generic columns
                self._set_description(["id", "name", "value"])
                return [], []

            response.raise_for_status()

            data = response.json()

            # Parse response based on endpoint structure
            rows, headers = self._parse_response(endpoint, data)

            logger.info(f"DHIS2 API returned {len(rows)} rows")
            return rows, headers

        except requests.exceptions.HTTPError as e:
            logger.error(f"DHIS2 API HTTP error: {e}")
            raise DHIS2DBAPI.OperationalError(f"DHIS2 API error: {e}")
        except requests.exceptions.Timeout:
            logger.error("DHIS2 API request timeout")
            raise DHIS2DBAPI.OperationalError("Request timeout")
        except Exception as e:
            logger.error(f"DHIS2 API request failed: {e}")
            raise DHIS2DBAPI.OperationalError(f"API request failed: {e}")
```

### Step 2: Modify `DHIS2Cursor._parse_response`

Modify `_parse_response` to return the `headers` from the response.

```python
    def _parse_response(self, endpoint: str, data: dict) -> tuple[list[tuple], list[dict]]:
        """
        Parse DHIS2 API response using endpoint-aware normalizers
        Returns a tuple of (rows, headers)
        """
        print(f"[DHIS2] Parsing response for endpoint: {endpoint}")
        print(f"[DHIS2] Response keys: {list(data.keys())}")
        print(f"[DHIS2] Response sample: {str(data)[:500]}")

        # Use the normalizer to parse response
        col_names, rows = DHIS2ResponseNormalizer.normalize(endpoint, data)

        print(f"[DHIS2] Normalized columns: {col_names}")
        print(f"[DHIS2] Normalized row count: {len(rows)}")
        if rows:
            print(f"[DHIS2] First row: {rows[0]}")

        # Set cursor description
        self._set_description(col_names)

        logger.info(f"Normalized {len(rows)} rows with {len(col_names)} columns for endpoint {endpoint}")
        headers = data.get("headers", [])
        return rows, headers
```

### Step 3: Modify `DHIS2Cursor.execute`

Modify the `execute` method to store the `headers` on the `DHIS2Connection` object.

```python
    def execute(self, query: str, parameters=None):
        """
        Execute SQL query by translating to DHIS2 API call with dynamic parameters
        """
        print(f"[DHIS2] Executing query: {query}")
        logger.info(f"Executing DHIS2 query: {query}")

        # Parse query to get endpoint and parameters
        endpoint = self._parse_endpoint_from_query(query)
        print(f"[DHIS2] Parsed endpoint: {endpoint}")
        logger.info(f"Parsed endpoint: {endpoint}")

        query_params = self._extract_query_params(query)
        print(f"[DHIS2] Query params: {query_params}")
        logger.info(f"Query params: {query_params}")

        # Merge all parameter sources
        api_params = self._merge_params(endpoint, query_params)
        print(f"[DHIS2] Merged params: {api_params}")
        logger.info(f"Merged params: {api_params}")

        # Execute API request
        self._rows, headers = self._make_api_request(endpoint, api_params)
        self.rowcount = len(self._rows)
        print(f"[DHIS2] Fetched {self.rowcount} rows")

        # Store the headers on the connection so that get_columns can access them
        if headers:
            if not hasattr(self.connection, 'info'):
                self.connection.info = {}
            if 'endpoint_columns' not in self.connection.info:
                self.connection.info['endpoint_columns'] = {}
            self.connection.info['endpoint_columns'][endpoint] = headers
```

### Step 4: Modify `DHIS2Dialect.get_columns`

Modify the `get_columns` method to read the `headers` from the `DHIS2Connection` object and generate the column definitions.

```python
    def get_columns(self, connection, table_name, schema=None, **kw):
        """
        Return column information dynamically from stored metadata or DHIS2 API
        For datasets, fetches actual dataElements from the dataset
        """
        # Try to get custom columns from connection metadata
        try:
            if hasattr(connection, 'info') and 'endpoint_columns' in connection.info:
                endpoint_columns = connection.info['endpoint_columns']
                if table_name in endpoint_columns:
                    headers = endpoint_columns[table_name]
                    return [
                        {
                            "name": header.get("name"),
                            "type": self._map_dhis2_type_to_sqla(header.get("valueType")),
                            "nullable": True,
                        }
                        for header in headers
                    ]
        except Exception as e:
            logger.debug(f"Could not load custom columns: {e}")

        # ... (rest of the method is the same)
```

### Step 5: Create `_map_dhis2_type_to_sqla` method

Add a new method to the `DHIS2Dialect` class to map DHIS2 data types to SQLAlchemy data types.

```python
    def _map_dhis2_type_to_sqla(self, dhis2_type: str | None) -> types.TypeEngine:
        """
        Map DHIS2 data types to SQLAlchemy data types.
        """
        if dhis2_type in ("TEXT", "LONG_TEXT"):
            return types.String()
        if dhis2_type in ("NUMBER", "INTEGER", "INTEGER_POSITIVE", "INTEGER_NEGATIVE", "INTEGER_ZERO_OR_POSITIVE"):
            return types.Numeric()
        if dhis2_type in ("DATE", "DATETIME"):
            return types.Date()
        if dhis2_type == "BOOLEAN":
            return types.Boolean()
        return types.String()
```

Please let me know if you would like me to proceed with this implementation.