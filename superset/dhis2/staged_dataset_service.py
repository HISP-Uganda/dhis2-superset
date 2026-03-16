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
from datetime import datetime
from typing import Any

from superset import db
from superset.dhis2.analytical_serving import (
    build_serving_manifest,
    dataset_columns_payload,
    materialize_serving_rows,
)
from superset.dhis2.models import (
    DHIS2DatasetVariable,
    DHIS2Instance,
    DHIS2StagedDataset,
)
from superset.dhis2.staging_engine import DHIS2StagingEngine
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


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_engine(database_id: int) -> DHIS2StagingEngine:
    """Return a :class:`DHIS2StagingEngine` for *database_id*."""
    return DHIS2StagingEngine(database_id)


def _coerce_json_field(value: Any) -> str | None:
    """Serialise *value* to a JSON string if it is not already a string.

    Returns ``None`` when *value* is ``None``.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value)


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
            value = _coerce_json_field(value)
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
            value = _coerce_json_field(value)
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
        # Drop the physical table first; this is auto-committed inside the engine.
        engine.drop_staging_table(dataset)
    except Exception:
        logger.exception(
            "Failed to drop staging table for DHIS2StagedDataset id=%s – "
            "proceeding to delete metadata row anyway",
            dataset_id,
        )
        # Do not abort: we still want to clean up the metadata record even if
        # the physical table could not be dropped (e.g. it was already gone).

    try:
        if dataset.generic_dataset is not None:
            db.session.delete(dataset.generic_dataset)
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
            value = _coerce_json_field(value)
        setattr(variable, field, value)

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
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset with id={dataset_id} not found")

    ensure_serving_table(dataset.id)
    engine = _get_engine(dataset.database_id)
    return engine.get_staging_table_preview(dataset, limit=limit)


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
) -> dict[str, Any]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset with id={dataset_id} not found")

    ensure_serving_table(dataset.id)
    engine = _get_engine(dataset.database_id)
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
    )


def get_local_filter_options(
    dataset_id: int,
    *,
    filters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset with id={dataset_id} not found")

    _serving_table_ref, serving_columns = ensure_serving_table(dataset.id)
    engine = _get_engine(dataset.database_id)
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
    expected_columns = [
        str(column.get("column_name") or "").strip()
        for column in list(manifest.get("columns") or [])
        if str(column.get("column_name") or "").strip()
    ]
    if not expected_columns:
        return False

    if not engine.serving_table_exists(dataset):
        return True

    current_columns = list(engine.get_serving_table_columns(dataset))
    return current_columns != expected_columns


def ensure_serving_table(dataset_id: int) -> tuple[str, list[dict[str, Any]]]:
    dataset = get_staged_dataset(dataset_id)
    if dataset is None:
        raise ValueError(f"DHIS2StagedDataset with id={dataset_id} not found")

    engine = _get_engine(dataset.database_id)
    manifest = build_serving_manifest(dataset)
    serving_columns = dataset_columns_payload(manifest["columns"])
    if _serving_table_needs_rebuild(engine, dataset, manifest):
        raw_rows = engine.fetch_staging_rows(dataset)
        serving_rows_columns, serving_rows = materialize_serving_rows(
            dataset,
            raw_rows,
            manifest,
        )
        engine.create_or_replace_serving_table(
            dataset,
            columns=serving_rows_columns,
            rows=serving_rows,
        )
    serving_table_ref = engine.get_serving_sql_table_ref(dataset)

    # Auto-register the serving table as a Superset virtual dataset
    try:
        from superset.dhis2.superset_dataset_service import (
            register_serving_table_as_superset_dataset,
        )
        from superset import db as _db

        # The staging engine's database_id IS the serving database id
        serving_db_id = getattr(engine, "database_id", None)
        if serving_db_id is not None:
            sqla_id = register_serving_table_as_superset_dataset(
                dataset_id=dataset.id,
                dataset_name=dataset.name,
                serving_table_ref=serving_table_ref,
                serving_columns=serving_columns,
                serving_database_id=serving_db_id,
            )
            if dataset.serving_superset_dataset_id != sqla_id:
                dataset.serving_superset_dataset_id = sqla_id
                _db.session.commit()
    except Exception:  # pylint: disable=broad-except
        logger.exception(
            "ensure_serving_table: auto-register as Superset dataset failed for dataset_id=%s",
            dataset_id,
        )

    return serving_table_ref, serving_columns
