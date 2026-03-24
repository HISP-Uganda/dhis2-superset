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
DHIS2 Staged Dataset Service Layer

Provides business-logic functions for creating, reading, updating and
deleting :class:`~superset.dhis2.models.DHIS2StagedDataset` records together
with their associated :class:`~superset.dhis2.models.DHIS2DatasetVariable`
child rows and their physical PostgreSQL staging tables.

All functions that perform DDL (create / drop table) call through to
:class:`~superset.dhis2.staging_engine.DHIS2StagingEngine`.  Functions that
only touch ORM rows use the shared ``superset.db.session`` directly.

This module has no Flask request-handling concerns; it is safe to call from
Celery tasks, management commands, and API views alike.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from superset import db
from superset.dhis2.analytical_serving import (
    build_serving_manifest,
    dataset_columns_payload,
)
from superset.dhis2.models import (
    DHIS2DatasetVariable,
    DHIS2Instance,
    DHIS2StagedDataset,
)
from superset.dhis2.serving_build_service import build_serving_table
from superset.dhis2.staging_engine import DHIS2StagingEngine
from superset.local_staging.engine_factory import get_active_staging_engine
from superset.staging.compat import (
    sync_dhis2_dataset_variable,
    sync_dhis2_staged_dataset,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Field allow-lists
# ---------------------------------------------------------------------------

_ALLOWED_DATASET_CREATE_FIELDS = frozenset(
    {
        "name",
        "description",
        "schedule_cron",
        "schedule_timezone",
        "is_active",
        "auto_refresh_enabled",
        "dataset_config",
        # Operational fields promoted from dataset_config blob
        "source_mode",
        "preserve_period_dimension",
        "preserve_orgunit_dimension",
        "preserve_category_dimensions",
        "history_start_date",
        "rolling_window_months",
        "root_orgunits_json",
        "max_orgunit_level",
        "include_descendants",
        "refresh_mode",
        "id_scheme_input",
        "id_scheme_output",
        "display_property",
        "approval_level",
        "error_policy",
        "retry_policy",
        "include_ancestor_levels",
    }
)

_ALLOWED_DATASET_UPDATE_FIELDS = _ALLOWED_DATASET_CREATE_FIELDS

_ALLOWED_VARIABLE_FIELDS = frozenset(
    {
        "instance_id",
        "variable_id",
        "variable_type",
        "variable_name",
        "alias",
        "extra_params",
    }
)


def _sync_compat_dataset(dataset: DHIS2StagedDataset) -> None:
    try:
        sync_dhis2_staged_dataset(dataset)
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to mirror DHIS2StagedDataset id=%s into generic staged-source metadata",
            getattr(dataset, "id", None),
            exc_info=True,
        )


def _sync_compat_variable(variable: DHIS2DatasetVariable) -> None:
    try:
        sync_dhis2_dataset_variable(variable)
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to mirror DHIS2DatasetVariable id=%s into generic staged-source metadata",
            getattr(variable, "id", None),
            exc_info=True,
        )


def _refresh_variable_dimension_availability(variable: DHIS2DatasetVariable) -> None:
    variable_type = str(getattr(variable, "variable_type", "") or "").strip().lower()
    if variable_type not in {"dataelement", "dataelements"}:
        variable.set_dimension_availability([])
        return

    from superset.dhis2.metadata_staging_service import (
        get_dimension_availability_for_variable,
    )

    try:
        availability = get_dimension_availability_for_variable(
            int(variable.instance_id),
            str(variable.variable_id),
            variable_type=str(variable.variable_type or ""),
        )
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to derive dimension availability for variable=%s instance=%s",
            getattr(variable, "variable_id", None),
            getattr(variable, "instance_id", None),
            exc_info=True,
        )
        availability = []

    variable.set_dimension_availability(availability)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_engine(database_id: int) -> DHIS2StagingEngine:
    """Return the active staging engine for *database_id*.

    Delegates to the pluggable engine factory so DuckDB / ClickHouse engines
    are used transparently when configured.  The return type annotation is kept
    as :class:`DHIS2StagingEngine` for backwards-compatibility with callers
    that have typed locals; the actual object satisfies the same interface via
    the :class:`~superset.local_staging.base_engine.LocalStagingEngineBase`
    ABC (and SupersetDBStagingEngine delegates all calls to DHIS2StagingEngine).
    """
    return get_active_staging_engine(database_id)  # type: ignore[return-value]


def _coerce_json_field(value: Any, field_name: str = "value") -> str | None:
    """Serialise *value* to a JSON string if it is not already a string.

    Returns ``None`` when *value* is ``None``.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"'{field_name}' must be JSON serializable") from exc


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def list_staged_datasets(
    database_id: int,
    include_inactive: bool = False,
) -> list[DHIS2StagedDataset]:
    """Return all staged datasets belonging to *database_id*.

    Args:
        database_id: Primary key of the Superset ``dbs`` row.
        include_inactive: When ``False`` (default) only active datasets are
            returned.

    Returns:
        A list of :class:`~superset.dhis2.models.DHIS2StagedDataset` objects
        ordered by name.
    """
    query = db.session.query(DHIS2StagedDataset).filter(
        DHIS2StagedDataset.database_id == database_id
    )
    if not include_inactive:
        query = query.filter(DHIS2StagedDataset.is_active.is_(True))
    return query.order_by(DHIS2StagedDataset.name).all()


def get_staged_dataset(dataset_id: int) -> DHIS2StagedDataset | None:
    """Return a single staged dataset by primary key, or ``None``.

    Args:
        dataset_id: Primary key of the ``dhis2_staged_datasets`` row.

    Returns:
        The matching :class:`~superset.dhis2.models.DHIS2StagedDataset` or
        ``None`` when not found.
    """
    return db.session.get(DHIS2StagedDataset, dataset_id)


def get_staged_dataset_by_name(
    database_id: int,
    name: str,
) -> DHIS2StagedDataset | None:
    """Return a staged dataset by owning database and dataset name.

    The lookup trims the incoming name so browser retries that send the same
    logical dataset name with incidental whitespace still target the same row.
    """
    normalized_name = (name or "").strip()
    if not normalized_name:
        return None

    return (
        db.session.query(DHIS2StagedDataset)
        .filter(DHIS2StagedDataset.database_id == database_id)
        .filter(DHIS2StagedDataset.name == normalized_name)
        .one_or_none()
    )


def get_dataset_variables(dataset_id: int) -> list[DHIS2DatasetVariable]:
    """Return all variable mappings for a staged dataset.

    Args:
        dataset_id: Primary key of the ``dhis2_staged_datasets`` row.

    Returns:
        A list of :class:`~superset.dhis2.models.DHIS2DatasetVariable` objects
        ordered by ``variable_id``.
    """
    return (
        db.session.query(DHIS2DatasetVariable)
        .filter(DHIS2DatasetVariable.staged_dataset_id == dataset_id)
        .order_by(DHIS2DatasetVariable.variable_id)
        .all()
    )


# ---------------------------------------------------------------------------
# Create / Update / Delete – dataset
# ---------------------------------------------------------------------------


def _validate_dataset_data(
    data: dict[str, Any],
    *,
    require_name: bool = True,
) -> None:
    """Raise :class:`ValueError` when mandatory dataset fields are absent.

    Args:
        data: Raw input dict (from an API request body).
        require_name: Whether ``name`` must be present.

    Raises:
        ValueError: If validation fails.
    """
    if require_name and not data.get("name"):
        raise ValueError("'name' is required")


def create_staged_dataset(database_id: int, data: dict[str, Any]) -> DHIS2StagedDataset:
    """Create a :class:`DHIS2StagedDataset` record and its staging table.

    Workflow:

    1. Validate input.
    2. Persist the ORM record (without staging_table_name) so that an ``id``
       is assigned by the database.
    3. Generate the staging table name using the engine.
    4. Update ``staging_table_name`` on the record.
    5. Call :meth:`~DHIS2StagingEngine.create_staging_table` to create the
       physical table and all indexes.
    6. Commit.

    Args:
        database_id: Primary key of the owning ``dbs`` row.
        data: Field values.  Accepted keys: ``name``, ``description``,
            ``schedule_cron``, ``schedule_timezone``, ``is_active``,
            ``auto_refresh_enabled``, ``dataset_config``.

    Returns:
        The newly created :class:`~superset.dhis2.models.DHIS2StagedDataset`.

    Raises:
        ValueError: If required fields are missing.
        Exception: On database commit or DDL failure.
    """
    _validate_dataset_data(data)

    normalized_data = dict(data)
    if "name" in normalized_data and isinstance(normalized_data["name"], str):
        normalized_data["name"] = normalized_data["name"].strip()

    existing_dataset = get_staged_dataset_by_name(
        database_id,
        str(normalized_data.get("name") or ""),
    )
    if existing_dataset is not None:
        logger.info(
            "Reusing existing DHIS2StagedDataset id=%s name=%r database_id=%s",
            existing_dataset.id,
            existing_dataset.name,
            database_id,
        )
        dataset = update_staged_dataset(existing_dataset.id, normalized_data)
        if not dataset.staging_table_name:
            ensure_staging_table(dataset.id)
        return dataset

    dataset = DHIS2StagedDataset(database_id=database_id)
    for field in _ALLOWED_DATASET_CREATE_FIELDS:
        if field not in normalized_data:
            continue
        value = normalized_data[field]
        if field == "dataset_config":
            value = _coerce_json_field(value, field_name=field)
        setattr(dataset, field, value)

    # Apply safe defaults.
    if dataset.is_active is None:
        dataset.is_active = True
    # Background processing is mandatory for staged datasets.
    dataset.auto_refresh_enabled = True

    try:
        db.session.add(dataset)
        # Flush to get the auto-assigned ``id`` before generating the table name.
        db.session.flush()

        engine = _get_engine(database_id)
        table_name = engine.get_staging_table_name(dataset)
        dataset.staging_table_name = table_name

        # Create the physical PostgreSQL table (DDL is auto-committed by
        # create_staging_table via engine.begin()).
        engine.create_staging_table(dataset)
        _sync_compat_dataset(dataset)

        db.session.commit()
        logger.info(
            "Created DHIS2StagedDataset id=%s name=%r database_id=%s "
            "staging_table=%s",
            dataset.id,
            dataset.name,
            database_id,
            table_name,
        )
    except Exception:
        db.session.rollback()
        logger.exception(
            "Failed to create DHIS2StagedDataset name=%r database_id=%s",
            normalized_data.get("name"),
            database_id,
        )
        raise

    return dataset


def update_staged_dataset(dataset_id: int, data: dict[str, Any]) -> DHIS2StagedDataset:
    """Update an existing :class:`DHIS2StagedDataset` with the supplied fields.

    Only fields present in *data* are modified.

    Args:
        dataset_id: Primary key of the row to update.
        data: Fields to update.

    Returns:
        The updated :class:`~superset.dhis2.models.DHIS2StagedDataset`.

    Raises:
        ValueError: When the dataset is not found or validation fails.
        Exception: On database commit failure.
    """
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"DHIS2StagedDataset with id={dataset_id} not found")

    _validate_dataset_data(data, require_name=False)

    for field in _ALLOWED_DATASET_UPDATE_FIELDS:
        if field not in data:
            continue
        value = data[field]
        if field == "dataset_config":
            value = _coerce_json_field(value, field_name=field)
        setattr(dataset, field, value)

    # Background processing is mandatory for staged datasets.
    dataset.auto_refresh_enabled = True

    try:
        _sync_compat_dataset(dataset)
        db.session.commit()
        logger.info("Updated DHIS2StagedDataset id=%s", dataset_id)
    except Exception:
        db.session.rollback()
        logger.exception("Failed to update DHIS2StagedDataset id=%s", dataset_id)
        raise

    return dataset


def delete_staged_dataset(dataset_id: int) -> bool:
    """Delete a :class:`DHIS2StagedDataset` and its physical staging table.

    Workflow:

    1. Drop the PostgreSQL staging table (DDL committed immediately).
    2. Delete the ORM record; cascade handles child ``DHIS2DatasetVariable``
       and ``DHIS2SyncJob`` rows.

    Args:
        dataset_id: Primary key of the row to delete.

    Returns:
        ``True`` when deleted, ``False`` when the dataset was not found.

    Raises:
        Exception: On DDL or database commit failure.
    """
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        logger.warning("delete_staged_dataset: id=%s not found", dataset_id)
        return False

    engine = _get_engine(dataset.database_id)

    try:
        # Drop physical tables first; these are auto-committed inside the engine.
        engine.drop_staging_table(dataset)
        engine.drop_serving_table(dataset)
    except Exception:
        logger.exception(
            "Failed to drop staging/serving tables for DHIS2StagedDataset id=%s – "
            "proceeding to delete metadata row anyway",
            dataset_id,
        )
        # Do not abort: we still want to clean up the metadata record even if
        # the physical table could not be dropped (e.g. it was already gone).

    try:
        if dataset.generic_dataset is not None:
            db.session.delete(dataset.generic_dataset)
        
        # Delete all associated Superset virtual datasets (Thematic, [KPI], [Map])
        from superset.dhis2.superset_dataset_service import cleanup_staged_dataset_superset_resources
        cleanup_staged_dataset_superset_resources(dataset_id, dataset.database_id)

        db.session.delete(dataset)
        db.session.commit()
        logger.info("Deleted DHIS2StagedDataset id=%s", dataset_id)
        return True
    except Exception:
        db.session.rollback()
        logger.exception("Failed to delete DHIS2StagedDataset id=%s", dataset_id)
        raise


def clear_staged_dataset_data(dataset_id: int) -> dict[str, Any]:
    """Remove all local staged rows while preserving dataset mappings/config.

    This is a non-destructive maintenance action for operators who want to
    clear the local cache and re-run a sync later. Variable mappings, schedule
    configuration, and DHIS2 instance lineage remain untouched.
    """
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"DHIS2StagedDataset with id={dataset_id} not found")

    engine = _get_engine(dataset.database_id)
    manifest = build_serving_manifest(dataset)
    serving_columns = dataset_columns_payload(manifest["columns"])

    try:
        engine.create_staging_table(dataset)
        engine.truncate_staging_table(dataset)
        engine.create_or_replace_serving_table(
            dataset,
            columns=manifest["columns"],
            rows=[],
        )
        dataset.last_sync_at = None
        dataset.last_sync_status = None
        dataset.last_sync_rows = 0
        _sync_compat_dataset(dataset)
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception(
            "Failed to clear local staged data for DHIS2StagedDataset id=%s",
            dataset_id,
        )
        raise

    return {
        "dataset_id": dataset.id,
        "cleared_at": datetime.utcnow().isoformat(),
        "staging_table_ref": engine.get_superset_sql_table_ref(dataset),
        "serving_table_ref": engine.get_serving_sql_table_ref(dataset),
        "serving_columns": serving_columns,
        "total_rows": 0,
    }


# ---------------------------------------------------------------------------
# Create / Delete – variables
# ---------------------------------------------------------------------------


def add_variable(
    dataset_id: int,
    variable_data: dict[str, Any],
) -> DHIS2DatasetVariable:
    """Add a :class:`DHIS2DatasetVariable` to an existing staged dataset.

    Args:
        dataset_id: Primary key of the parent ``dhis2_staged_datasets`` row.
        variable_data: Field values.  Required: ``instance_id``,
            ``variable_id``, ``variable_type``.  Optional: ``variable_name``,
            ``alias``, ``extra_params``.

    Returns:
        The newly created :class:`~superset.dhis2.models.DHIS2DatasetVariable`.

    Raises:
        ValueError: When the dataset is not found or required fields are
            missing.
        Exception: On database commit failure.
    """
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"DHIS2StagedDataset with id={dataset_id} not found")

    for required in ("instance_id", "variable_id", "variable_type"):
        if not variable_data.get(required):
            raise ValueError(f"'{required}' is required for a dataset variable")

    try:
        instance_id = int(variable_data["instance_id"])
    except (TypeError, ValueError) as exc:
        raise ValueError("'instance_id' must be a valid integer") from exc

    instance = db.session.get(DHIS2Instance, instance_id)
    if instance is None:
        raise ValueError(f"DHIS2Instance with id={instance_id} not found")
    if instance.database_id != dataset.database_id:
        raise ValueError(
            "The selected DHIS2 instance does not belong to the dataset database"
        )

    variable = DHIS2DatasetVariable(staged_dataset_id=dataset_id)
    for field in _ALLOWED_VARIABLE_FIELDS:
        if field not in variable_data:
            continue
        value = variable_data[field]
        if field == "instance_id":
            value = instance_id
        if field == "extra_params":
            value = _coerce_json_field(value, field_name=field)
        setattr(variable, field, value)
    _refresh_variable_dimension_availability(variable)

    try:
        db.session.add(variable)
        db.session.flush()
        _sync_compat_variable(variable)
        db.session.commit()
        logger.info(
            "Added DHIS2DatasetVariable id=%s variable_id=%r to dataset id=%s",
            variable.id,
            variable.variable_id,
            dataset_id,
        )
    except Exception:
        db.session.rollback()
        logger.exception(
            "Failed to add variable %r to DHIS2StagedDataset id=%s",
            variable_data.get("variable_id"),
            dataset_id,
        )
        raise

    return variable


def remove_variable(variable_id: int) -> bool:
    """Delete a :class:`DHIS2DatasetVariable` by primary key.

    Args:
        variable_id: Primary key of the ``dhis2_dataset_variables`` row.

    Returns:
        ``True`` when deleted, ``False`` when not found.

    Raises:
        Exception: On database commit failure.
    """
    variable = db.session.get(DHIS2DatasetVariable, variable_id)
    if variable is None:
        logger.warning("remove_variable: id=%s not found", variable_id)
        return False

    try:
        if variable.generic_field is not None:
            db.session.delete(variable.generic_field)
        db.session.delete(variable)
        db.session.commit()
        logger.info("Deleted DHIS2DatasetVariable id=%s", variable_id)
        return True
    except Exception:
        db.session.rollback()
        logger.exception("Failed to delete DHIS2DatasetVariable id=%s", variable_id)
        raise


# ---------------------------------------------------------------------------
# Staging table utilities
# ---------------------------------------------------------------------------


def get_staging_stats(dataset_id: int) -> dict[str, Any]:
    """Return staging-table statistics for a dataset.

    Delegates to :meth:`~DHIS2StagingEngine.get_staging_table_stats`.

    Args:
        dataset_id: Primary key of the ``dhis2_staged_datasets`` row.

    Returns:
        Stats dict as returned by
        :meth:`~DHIS2StagingEngine.get_staging_table_stats`, or an empty dict
        with a ``not_found`` flag when the dataset metadata row does not exist.
    """
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        return {"not_found": True}

    engine = _get_engine(dataset.database_id)
    return engine.get_staging_table_stats(dataset)


def get_staging_preview(
    dataset_id: int,
    *,
    limit: int = 50,
) -> dict[str, Any]:
    """Return a local row preview for a staged dataset."""
    from superset.dhis2.staged_preview_service import StagedPreviewService

    return StagedPreviewService().preview_dataset(dataset_id, limit=limit)


def query_serving_data(
    dataset_id: int,
    *,
    selected_columns: list[str] | None = None,
    filters: list[dict[str, Any]] | None = None,
    limit: int = 100,
    page: int = 1,
    group_by_columns: list[str] | None = None,
    metric_column: str | None = None,
    metric_alias: str | None = None,
    aggregation_method: str | None = None,
    count_rows: bool = True,
) -> dict[str, Any]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset with id={dataset_id} not found")

    ensure_serving_table(dataset.id)
    engine = _get_engine(dataset.database_id)

    # Mart Routing Logic:
    # Use specialized marts only when grouping is active and the columns
    # requested are supported by the mart schema.
    mart_table_name = None
    if group_by_columns and hasattr(engine, "named_table_exists_in_serving"):
        serving_base = engine.get_serving_table_name(dataset)
        
        # 1. Map Mart Logic
        # If we are grouping by exactly one hierarchy level, use the map mart.
        is_map_query = any(
            # Look for indicators or explicit map-like grouping
            aggregation_method in ("sum", "average", "avg", "none")
            for _ in [1]
        )
        if is_map_query:
            map_name = f"{serving_base}_map"
            if engine.named_table_exists_in_serving(map_name):
                mart_table_name = map_name

        # 2. KPI Mart Logic
        # Fallback to KPI mart for general trend/indicator queries if map mart wasn't picked
        if not mart_table_name:
            kpi_name = f"{serving_base}_kpi"
            if engine.named_table_exists_in_serving(kpi_name):
                mart_table_name = kpi_name

    return engine.query_serving_table(
        dataset,
        selected_columns=selected_columns,
        filters=filters,
        limit=limit,
        page=page,
        group_by_columns=group_by_columns,
        metric_column=metric_column,
        metric_alias=metric_alias,
        aggregation_method=aggregation_method,
        count_rows=count_rows,
        table_name_override=mart_table_name,
    )


def get_local_filter_options(
    dataset_id: int,
    *,
    filters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset with id={dataset_id} not found")

    engine = _get_engine(dataset.database_id)

    try:
        _serving_table_ref, serving_columns = ensure_serving_table(dataset.id)
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "get_local_filter_options: serving table build failed for dataset id=%s; "
            "falling back to manifest columns",
            dataset_id,
            exc_info=True,
        )
        # Graceful degradation: use manifest columns if rebuild fails so the
        # filters endpoint still returns a response instead of a 500.
        from superset.dhis2.analytical_serving import (
            build_serving_manifest,
            dataset_columns_payload,
        )
        try:
            manifest = build_serving_manifest(dataset)
            serving_columns = dataset_columns_payload(manifest["columns"])
        except Exception:  # pylint: disable=broad-except
            serving_columns = []

    return engine.get_serving_filter_options(
        dataset,
        columns=serving_columns,
        filters=filters,
    )


def export_serving_data_csv(
    dataset_id: int,
    *,
    selected_columns: list[str] | None = None,
    filters: list[dict[str, Any]] | None = None,
    limit: int | None = None,
) -> tuple[str, str]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset with id={dataset_id} not found")

    ensure_serving_table(dataset.id)
    engine = _get_engine(dataset.database_id)
    return engine.export_serving_table_csv(
        dataset,
        selected_columns=selected_columns,
        filters=filters,
        limit=limit,
    )


def export_serving_data_tsv(
    dataset_id: int,
    *,
    selected_columns: list[str] | None = None,
    filters: list[dict[str, Any]] | None = None,
    limit: int | None = None,
) -> tuple[str, str]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset with id={dataset_id} not found")

    ensure_serving_table(dataset.id)
    engine = _get_engine(dataset.database_id)
    return engine.export_serving_table_tsv(
        dataset,
        selected_columns=selected_columns,
        filters=filters,
        limit=limit,
    )


def export_serving_data_json(
    dataset_id: int,
    *,
    selected_columns: list[str] | None = None,
    filters: list[dict[str, Any]] | None = None,
    limit: int | None = None,
) -> tuple[str, str]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset with id={dataset_id} not found")

    ensure_serving_table(dataset.id)
    engine = _get_engine(dataset.database_id)
    return engine.export_serving_table_json(
        dataset,
        selected_columns=selected_columns,
        filters=filters,
        limit=limit,
    )


def get_staging_table_name(dataset_id: int) -> str | None:
    """Return the stored staging table name for a dataset, or ``None``.

    Returns the value of ``DHIS2StagedDataset.staging_table_name`` as
    recorded in the metadata row.  This may differ from what
    :meth:`~DHIS2StagingEngine.get_staging_table_name` would compute if the
    dataset was renamed after initial creation (table renames are not
    supported).

    Args:
        dataset_id: Primary key of the ``dhis2_staged_datasets`` row.

    Returns:
        The stored table name string, or ``None`` when not found.
    """
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        return None
    return dataset.staging_table_name


def ensure_staging_table(dataset_id: int) -> str:
    """Ensure the staging table exists, creating it if necessary.

    Idempotent: if the table already exists the DDL is a no-op (``IF NOT
    EXISTS``).

    Args:
        dataset_id: Primary key of the ``dhis2_staged_datasets`` row.

    Returns:
        The fully-qualified table reference (``schema.table``).

    Raises:
        ValueError: When no dataset with *dataset_id* exists.
        Exception: On DDL or commit failure.
    """
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"DHIS2StagedDataset with id={dataset_id} not found")

    engine = _get_engine(dataset.database_id)
    full_name = engine.create_staging_table(dataset)

    # Ensure the metadata row's staging_table_name is populated.
    computed_name = engine.get_staging_table_name(dataset)
    if dataset.staging_table_name != computed_name:
        dataset.staging_table_name = computed_name
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            logger.exception(
                "Failed to persist staging_table_name for dataset id=%s",
                dataset_id,
            )
            raise

    return full_name


def get_serving_columns(dataset_id: int) -> list[dict[str, Any]]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"DHIS2StagedDataset with id={dataset_id} not found")
    manifest = build_serving_manifest(dataset)
    return dataset_columns_payload(manifest["columns"])


def _serving_table_needs_rebuild(
    engine: DHIS2StagingEngine,
    dataset: DHIS2StagedDataset,
    manifest: dict[str, Any],
) -> bool:
    """Return True when the serving table must be fully rebuilt.

    The table is rebuilt when:
    * it does not yet exist, OR
    * the set/order of column names has changed since the last build (schema
      drift — new variables added, hierarchy levels changed, etc.).

    Column *metadata* changes (extra flags, verbose names) do NOT trigger a
    rebuild because the startup compatibility backfill
    (``superset.dhis2.backfill.run_compatibility_backfill``) already patches
    indexes and SqlaTable column extra without touching the data.
    """
    import json as _json
    expected_columns = [
        str(column.get("column_name") or "").strip()
        for column in list(manifest.get("columns") or [])
        if str(column.get("column_name") or "").strip()
    ]
    if not expected_columns:
        return False

    if not engine.serving_table_exists(dataset):
        return True

    def _serving_table_is_empty_with_populated_staging() -> bool:
        try:
            staging_total_rows = int(
                (engine.get_staging_table_stats(dataset) or {}).get("total_rows") or 0
            )
        except Exception:  # pylint: disable=broad-except
            staging_total_rows = 0

        if staging_total_rows <= 0:
            return False

        try:
            serving_result = engine.query_serving_table(
                dataset,
                selected_columns=[],
                filters=None,
                limit=1,
                page=1,
                count_rows=True,
            )
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "ensure_serving_table: failed to query serving row count for dataset id=%s",
                dataset.id,
                exc_info=True,
            )
            return True

        try:
            serving_total_rows = int(serving_result.get("total_rows") or 0)
        except (TypeError, ValueError, AttributeError):
            serving_total_rows = 0
        return serving_total_rows == 0

    current_columns = list(engine.get_serving_table_columns(dataset))
    if current_columns == expected_columns:
        return _serving_table_is_empty_with_populated_staging()

    # Additive-column tolerance: do not trigger a rebuild when the only
    # missing columns are system columns that are populated on the next
    # explicit sync.  Currently covers:
    #   * dhis2_is_ou_hierarchy      — pruned when all-blank at materialization
    #   * dhis2_is_ou_level          — new column added in a later code release
    #
    # NOTE: dhis2_manifest_build_version is intentionally NOT additive — its
    # absence (or wrong version name) must trigger a full rebuild because the
    # CASE-predicate logic has changed and existing materialized data is invalid.
    _ADDITIVE_EXTRA_KEYS = {"dhis2_is_ou_hierarchy", "dhis2_is_ou_level"}
    current_set = set(current_columns)
    missing = [c for c in expected_columns if c not in current_set]
    if missing:
        additive_names: set[str] = set()
        for col in list(manifest.get("columns") or []):
            extra = col.get("extra")
            if isinstance(extra, str):
                try:
                    extra = _json.loads(extra)
                except Exception:  # pylint: disable=broad-except
                    extra = {}
            if isinstance(extra, dict) and any(extra.get(k) for k in _ADDITIVE_EXTRA_KEYS):
                name = str(col.get("column_name") or "").strip()
                if name:
                    additive_names.add(name)
        if all(c in additive_names for c in missing):
            # Verify relative order of retained columns is still intact
            expected_without_missing = [c for c in expected_columns if c in current_set]
            if expected_without_missing == current_columns:
                return _serving_table_is_empty_with_populated_staging()
    return True


def _specialized_marts_need_rebuild(
    engine: Any,
    dataset: Any,
    manifest: dict[str, Any],
) -> bool:
    """Return True if any specialized mart (KPI, Map) should exist but is missing.

    Only meaningful for ClickHouse engines (duck-typed via ``kpi_mart_exists``).
    """
    kpi_exists_fn = getattr(engine, "kpi_mart_exists", None)
    map_exists_fn = getattr(engine, "map_mart_exists", None)
    if kpi_exists_fn is None or map_exists_fn is None:
        return False

    has_indicators = any(
        c.get("variable_id") for c in list(manifest.get("columns") or [])
    )
    if not has_indicators:
        return False

    try:
        # Rebuild if either mart is missing
        if not kpi_exists_fn(dataset):
            return True

        has_hierarchy = any(
            c.get("extra") and "dhis2_is_ou_hierarchy" in str(c.get("extra"))
            for c in list(manifest.get("columns") or [])
        )
        if has_hierarchy and not map_exists_fn(dataset):
            return True

        return False
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "_specialized_marts_need_rebuild: could not check mart existence for dataset id=%s",
            getattr(dataset, "id", None),
            exc_info=True,
        )
        return False


def ensure_serving_table(
    dataset_id: int,
    refresh_scope: Iterable[str] | None = None,
    force_rebuild: bool = False,
) -> tuple[str, list[dict[str, Any]]]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"DHIS2StagedDataset with id={dataset_id} not found")

    engine = _get_engine(dataset.database_id)
    manifest = build_serving_manifest(dataset)
    # serving_columns tracks the *actual* columns in the physical table.
    # When a rebuild runs, pruned columns replace the full manifest set.
    serving_columns = dataset_columns_payload(manifest["columns"])
    needs_rebuild = (
        bool(refresh_scope)
        or force_rebuild
        or _serving_table_needs_rebuild(engine, dataset, manifest)
        or _specialized_marts_need_rebuild(engine, dataset, manifest)
    )
    if needs_rebuild:
        build_result = build_serving_table(
            dataset, engine=engine, refresh_scope=refresh_scope
        )
        serving_columns = build_result.serving_columns
        logger.info(
            "ensure_serving_table: rebuilt dataset id=%s source_rows=%s target_rows=%s scope=%s",
            dataset.id,
            build_result.diagnostics.get("source_row_count"),
            build_result.diagnostics.get("live_serving_row_count"),
            refresh_scope,
        )
    serving_table_ref = engine.get_serving_sql_table_ref(dataset)

    # Auto-register the serving table as a Superset virtual dataset
    try:
        from superset.dhis2.superset_dataset_service import (
            register_serving_table_as_superset_dataset,
            register_specialized_marts_as_superset_datasets,
        )
        from superset import db as _db

        # For DuckDB (and ClickHouse) engines the staging engine's database_id
        # is the DHIS2 *source* database, not the serving database.
        # Always ask the engine for the canonical serving Database record.
        if hasattr(engine, "get_or_create_superset_database"):
            _serving_db = engine.get_or_create_superset_database()
            serving_db_id = getattr(_serving_db, "id", None)
        else:
            serving_db_id = getattr(engine, "database_id", None)
        if serving_db_id is not None:
            # Collect source instance IDs from dataset variables so the
            # DHIS2Map can route geo/metadata requests to the right instances.
            from superset.dhis2.models import DHIS2DatasetVariable as _DSVar
            _instance_ids = list(dict.fromkeys(
                v.instance_id
                for v in _db.session.query(_DSVar)
                    .filter_by(staged_dataset_id=dataset.id)
                    .all()
                if v.instance_id is not None
            ))
            sqla_id = register_serving_table_as_superset_dataset(
                dataset_id=dataset.id,
                dataset_name=dataset.name,
                serving_table_ref=serving_table_ref,
                serving_columns=serving_columns,
                serving_database_id=serving_db_id,
                source_database_id=dataset.database_id,
                source_instance_ids=_instance_ids,
            )
            
            # Register specialized marts (KPI, Map)
            register_specialized_marts_as_superset_datasets(
                dataset_id=dataset.id,
                dataset_name=dataset.name,
                serving_table_ref=serving_table_ref,
                serving_columns=serving_columns,
                serving_database_id=serving_db_id,
                source_database_id=dataset.database_id,
                source_instance_ids=_instance_ids,
            )

            if dataset.serving_superset_dataset_id != sqla_id:
                dataset.serving_superset_dataset_id = sqla_id
                _db.session.commit()
    except Exception:  # pylint: disable=broad-except
        logger.exception(
            "ensure_serving_table: auto-register as Superset dataset failed for dataset_id=%s",
            dataset_id,
        )
        # Roll back any partial transaction so the session stays usable for
        # subsequent callers in the same worker thread.
        try:
            from superset import db as _db
            _db.session.rollback()
        except Exception:  # pylint: disable=broad-except
            pass

    return serving_table_ref, serving_columns


def cleanup_stale_dhis2_datasets() -> dict[str, int]:
    """Remove all Superset virtual datasets that reference a missing staged dataset.

    This is a one-time maintenance action to clean up orphans left behind by
    failed deletions or older versions of the code.
    """
    from superset import db
    from superset.connectors.sqla.models import SqlaTable
    from superset.dhis2.models import DHIS2StagedDataset

    all_sqla_datasets = db.session.query(SqlaTable).filter(
        SqlaTable.extra.like('%"dhis2_staged_dataset_id":%')
    ).all()

    staged_dataset_ids = {id_ for (id_,) in db.session.query(DHIS2StagedDataset.id).all()}
    
    deleted_count = 0
    for ds in all_sqla_datasets:
        try:
            extra = json.loads(ds.extra or "{}")
            staged_id = extra.get("dhis2_staged_dataset_id")
            if staged_id and staged_id not in staged_dataset_ids:
                logger.info(
                    "cleanup_stale_dhis2_datasets: deleting orphaned Superset dataset id=%d ('%s') "
                    "referencing missing staged dataset id=%s",
                    ds.id,
                    ds.table_name,
                    staged_id,
                )
                db.session.delete(ds)
                deleted_count += 1
        except Exception:  # pylint: disable=broad-except
            logger.warning("Failed to parse extra for SqlaTable id=%d", ds.id)

    if deleted_count > 0:
        db.session.commit()
        logger.info("cleanup_stale_dhis2_datasets: purged %d orphaned datasets", deleted_count)
    
    return {"purged_orphans": deleted_count}


def full_cleanup_dhis2_resources() -> dict[str, Any]:
    """Remove all orphaned DHIS2 resources (SqlaTables and physical tables).

    This performs a deep cleanup of:
    1. Superset virtual datasets (SqlaTable) referencing missing staged datasets.
    2. Physical tables (sv_*) in staging engines that have no corresponding SqlaTable.
    """
    from superset import db
    from superset.connectors.sqla.models import SqlaTable
    from superset.dhis2.models import DHIS2StagedDataset, DHIS2Instance
    from superset.dhis2.superset_dataset_service import repair_dhis2_chart_references

    # 0. Repair chart references first (migrate charts from deprecated [Map L*] to unified [Map])
    repair_stats = repair_dhis2_chart_references()
    repointed_count = repair_stats.get("repointed_charts", 0)

    # 1. Cleanup orphaned SqlaTables
    purge_stats = cleanup_stale_dhis2_datasets()
    purged_sqla_count = purge_stats.get("purged_orphans", 0)

    # 1b. Aggressively remove [Map L*] datasets — these are now deprecated by the unified mart
    # Note: DHIS2 virtual datasets use the friendly name as 'table_name'.
    deprecated_map_datasets = db.session.query(SqlaTable).filter(
        (SqlaTable.table_name.like("[Map L%"))
    ).all()
    for ds in deprecated_map_datasets:
        logger.info("full_cleanup: removing deprecated level-specific map dataset id=%d ('%s')", ds.id, ds.table_name)
        db.session.delete(ds)
        purged_sqla_count += 1
    db.session.commit()

    # 2. Cleanup physical tables with no SqlaTable reference
    # We need to check all databases that act as staging storage.
    all_sqla_tables = db.session.query(SqlaTable.sql).all()
    # Extract table names from 'SELECT * FROM <ref>' patterns
    known_table_refs: set[str] = set()
    for (sql,) in all_sqla_tables:
        if not sql:
            continue
        match = re.search(r"FROM\s+[`\"]?([a-zA-Z0-9._]+)[`\"]?", sql, re.IGNORECASE)
        if match:
            known_table_refs.add(match.group(1).lower())

    # Also include the main serving table refs for all active staged datasets
    all_staged = db.session.query(DHIS2StagedDataset).all()
    for ds in all_staged:
        try:
            eng = _get_engine(ds.database_id)
            known_table_refs.add(eng.get_serving_table_name(ds).lower())
            # and marts
            serving_base = eng.get_serving_table_name(ds)
            known_table_refs.add(f"{serving_base}_kpi".lower())
            known_table_refs.add(f"{serving_base}_map".lower())
        except Exception:  # pylint: disable=broad-except
            pass

    purged_physical_count = 0
    
    # Scan all databases configured for staging
    # Staging engines are keyed by database_id
    staging_db_ids = {ds.database_id for ds in all_staged}
    # Also check any DB used by DHIS2 instances
    staging_db_ids.update({inst.database_id for inst in db.session.query(DHIS2Instance).all()})

    for db_id in staging_db_ids:
        try:
            eng = _get_engine(db_id)
            # This is engine-specific. For ClickHouse/DuckDB we can list tables.
            if hasattr(eng, "_qry"): # ClickHouse
                tables_result = eng._qry(
                    "SELECT name FROM system.tables WHERE database = {db:String} AND name LIKE 'sv_%'",
                    parameters={"db": eng._serving_database}
                )
                for (tbl_name,) in tables_result.result_rows:
                    if tbl_name.lower() not in known_table_refs:
                        logger.info("full_cleanup: dropping orphaned ClickHouse table %s.%s", eng._serving_database, tbl_name)
                        eng._cmd(f"DROP TABLE IF EXISTS `{eng._serving_database}`.`{tbl_name}`")
                        purged_physical_count += 1
            
            elif eng.engine_name == "duckdb":
                # DuckDB lists tables via PRAGMA or information_schema
                conn = eng._connect()
                tables = conn.execute("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'sv_%'").fetchall()
                for (tbl_name,) in tables:
                    if tbl_name.lower() not in known_table_refs:
                        logger.info("full_cleanup: dropping orphaned DuckDB table %s", tbl_name)
                        conn.execute(f"DROP TABLE IF EXISTS {tbl_name}")
                        purged_physical_count += 1
                eng.close()
        except Exception:  # pylint: disable=broad-except
            logger.warning("full_cleanup: failed to scan tables for database_id=%s", db_id, exc_info=True)

    return {
        "repointed_charts": repointed_count,
        "purged_sqla_datasets": purged_sqla_count,
        "purged_physical_tables": purged_physical_count,
    }

