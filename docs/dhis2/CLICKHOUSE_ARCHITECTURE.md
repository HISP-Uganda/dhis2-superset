# DHIS2 Superset ClickHouse Architecture

## Overview

This integration moves the heavy lifting of analytical data processing from Python (Superset worker) to ClickHouse.
The architecture follows an **ELT (Extract, Load, Transform)** pattern where:
1.  **Extract**: Python fetches data chunks from DHIS2 API.
2.  **Load**: Python streams raw rows into ClickHouse Staging tables (`ds_*`).
3.  **Transform**: ClickHouse performs the transformation to Serving tables (`sv_*`) using native SQL.

## Components

### Staging Engine (`ClickHouseStagingEngine`)
-   **Location**: `superset/local_staging/clickhouse_engine.py`
-   **Responsibility**: Manages connections, creates tables, inserts raw rows, and executes SQL commands.
-   **Key Methods**:
    -   `insert_rows`: Batched insertion into `MergeTree` tables.
    -   `execute_serving_build_sql`: Orchestrates the `INSERT INTO ... SELECT` transformation.
    -   `create_temp_table`: Creates temporary lookup tables for dimensions.

### Build Service (`clickhouse_build_service.py`)
-   **Location**: `superset/dhis2/clickhouse_build_service.py`
-   **Responsibility**: Orchestrates the serving table build process.
-   **Process**:
    1.  **Hierarchy Resolution**: Resolves Org Unit and Period hierarchies in Python (using cached metadata).
    2.  **Map Upload**: Uploads the resolved hierarchies to temporary ClickHouse tables (`tmp_ou_map_*`, `tmp_pe_map_*`).
    3.  **SQL Generation**: Generates a dynamic SQL query that:
        -   Joins the Staging table with the Map tables.
        -   Pivots Data Elements (`dx_uid`) into columns using Conditional Aggregation (`CASE WHEN ...`).
        -   Aggregates data based on dimensions.
    4.  **Execution**: Triggers the SQL execution in ClickHouse.
    5.  **Cleanup**: Drops temporary tables.

### Data Flow

```mermaid
graph TD
    DHIS2[DHIS2 API] -->|Extract| Python[Superset Worker]
    Python -->|Load (Batched)| Staging[ClickHouse Staging Table ds_*]
    Python -->|Upload Maps| Temp[ClickHouse Temp Tables]
    Staging -->|Join & Pivot (SQL)| Serving[ClickHouse Serving Table sv_*]
    Temp -->|Join| Serving
    Superset[Superset UI] -->|Query| Serving
```

## Performance Configuration

### Memory Management
The `ClickHouseStagingEngine` enforces session-level memory limits to protect the server from OOM (Out of Memory) errors during heavy builds or queries.

| Environment | Recommended `max_memory_usage` | Config Key |
| :--- | :--- | :--- |
| **Local (macOS 24GB)** | **4GB** (Default) | `4294967296` |
| **Production** | **10GB** | `10737418240` |

If a build exceeds these limits, ClickHouse is configured to spill to disk using `max_bytes_before_external_group_by` (automatically set to 50% of the memory limit).

### Storage Optimization
All analytical tables use **`ZSTD(3)` compression** for string and numeric columns. This is essential for DHIS2 data which contains many repetitive UIDs, typically resulting in 50% disk savings compared to default LZ4.

### Data Quality Mandates
- **`ou_level`**: This field is mandatory and non-nullable.
- **Filtering**: The transformation logic automatically excludes any rows where `ou_level` is null or 0, ensuring only valid hierarchical data reaches the serving layer.

## Migration
... (rest of file)
