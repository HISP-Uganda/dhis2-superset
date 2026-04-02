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
DHIS2 Instance Service Layer

Provides business logic for managing DHIS2Instance records: CRUD operations,
connectivity tests, and legacy single-instance migration from the Database
encrypted_extra field.

This module intentionally has no Flask request-handling concerns; it only
interacts with the SQLAlchemy session and the DHIS2 HTTP API.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

import requests
from sqlalchemy.orm import defer

from superset import db
from superset.dhis2.metadata_staging_service import schedule_database_metadata_refresh
from superset.dhis2.models import DHIS2Instance
from superset.staging.compat import sync_dhis2_instance

logger = logging.getLogger(__name__)

# Timeout (seconds) for live DHIS2 connectivity tests.
_CONNECTION_TEST_TIMEOUT = 10


def _assign_model_attr(instance: Any, attr_name: str, value: Any) -> None:
    """Assign attributes safely on ORM rows and lightweight test doubles."""
    if getattr(instance, "_sa_instance_state", None) is None:
        instance.__dict__[attr_name] = value
        return
    setattr(instance, attr_name, value)


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def get_instances(
    database_id: int,
    include_inactive: bool = False,
) -> list[DHIS2Instance]:
    """Return all DHIS2 instances belonging to a Superset database.

    Args:
        database_id: Primary key of the ``dbs`` row.
        include_inactive: When ``False`` (default) only active instances are
            returned.  Pass ``True`` to include inactive instances.

    Returns:
        A list of :class:`~superset.dhis2.models.DHIS2Instance` objects,
        ordered by name.
    """
    query = db.session.query(DHIS2Instance).filter(
        DHIS2Instance.database_id == database_id
    ).options(
        defer(DHIS2Instance.password),
        defer(DHIS2Instance.access_token),
    )
    if not include_inactive:
        query = query.filter(DHIS2Instance.is_active.is_(True))
    return query.order_by(
        DHIS2Instance.display_order.asc(),
        DHIS2Instance.name.asc(),
    ).all()


def get_instances_with_legacy_fallback(
    database_id: int,
    include_inactive: bool = False,
) -> list[DHIS2Instance]:
    """Return database instances, creating a legacy default instance when needed.

    The dataset creation flow treats a configured DHIS2 database connection as a
    selectable source. Legacy single-instance connections may not yet have an
    explicit ``DHIS2Instance`` row, so this helper resolves existing rows first
    and falls back to a compatibility migration only when the database has no
    instance records at all.
    """

    all_instances = get_instances(database_id, include_inactive=True)
    if all_instances:
        if include_inactive:
            return all_instances
        return [instance for instance in all_instances if instance.is_active]

    compat_instance = get_or_create_legacy_instance(database_id)
    if compat_instance is None:
        return []
    if not include_inactive and not compat_instance.is_active:
        return []
    return [compat_instance]


def get_instance(instance_id: int) -> DHIS2Instance | None:
    """Return a single DHIS2 instance by primary key, or ``None``.

    Args:
        instance_id: Primary key of the ``dhis2_instances`` row.

    Returns:
        The matching :class:`~superset.dhis2.models.DHIS2Instance` or
        ``None`` when not found.
    """
    return (
        db.session.query(DHIS2Instance)
        .options(
            defer(DHIS2Instance.password),
            defer(DHIS2Instance.access_token),
        )
        .filter(DHIS2Instance.id == instance_id)
        .one_or_none()
    )


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------

_ALLOWED_CREATE_FIELDS = frozenset(
    {
        "name",
        "url",
        "description",
        "is_active",
        "display_order",
        "auth_type",
        "username",
        "password",
        "access_token",
    }
)

_ALLOWED_UPDATE_FIELDS = _ALLOWED_CREATE_FIELDS


def _sync_compat_instance(instance: DHIS2Instance) -> None:
    """Best-effort compatibility sync into the generic staged-source graph."""

    try:
        sync_dhis2_instance(instance)
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to mirror DHIS2Instance id=%s into generic staged-source metadata",
            getattr(instance, "id", None),
            exc_info=True,
        )


_PHASE1_METADATA_TYPES = [
    # Variables – these are needed before datasets can be created
    "dataElements",
    "indicators",
    "indicatorTypes",
    "dataSets",
    "programIndicators",
    "eventDataItems",
    "programs",
    "programStages",
    "trackedEntityTypes",
    "dataElementGroups",
    "dataElementGroupSets",
    "indicatorGroups",
    "indicatorGroupSets",
    # Org units (lightweight, needed for variable selection)
    "organisationUnits",
    "organisationUnitLevels",
    "organisationUnitGroups",
]
_PHASE2_METADATA_TYPES = [
    # Background types – slower, loaded after Phase 1 completes
    "legendSets",
    "geoJSON",
    "orgUnitHierarchy",
]


def _schedule_metadata_refresh(database_id: int) -> None:
    try:
        schedule_database_metadata_refresh(
            database_id,
            metadata_types=_PHASE1_METADATA_TYPES,
            reason="initial_setup_phase1",
            job_type="scheduled",
            continuation_metadata_types=_PHASE2_METADATA_TYPES,
        )
    except Exception:  # pylint: disable=broad-except
        logger.warning(
            "Failed to schedule DHIS2 metadata refresh for database id=%s",
            database_id,
            exc_info=True,
        )


def _validate_instance_data(
    data: dict[str, Any],
    *,
    require_url: bool = True,
    require_name: bool = True,
) -> None:
    """Raise :class:`ValueError` when mandatory fields are missing or invalid.

    Args:
        data: Raw input dict (from an API request body).
        require_url: Whether the ``url`` field is mandatory.

    Raises:
        ValueError: If validation fails.
    """
    if require_url and not data.get("url"):
        raise ValueError("'url' is required")
    if require_name and not data.get("name"):
        raise ValueError("'name' is required")
    if "name" in data and not data.get("name"):
        raise ValueError("'name' cannot be empty")
    if "url" in data and not data.get("url"):
        raise ValueError("'url' cannot be empty")

    auth_type = data.get("auth_type", "basic")
    if auth_type not in ("basic", "pat"):
        raise ValueError("'auth_type' must be 'basic' or 'pat'")


def create_instance(database_id: int, data: dict[str, Any]) -> DHIS2Instance:
    """Create and persist a new DHIS2Instance.

    Args:
        database_id: Primary key of the owning ``dbs`` row.
        data: Field values for the new instance.  Accepted keys:
            ``name``, ``url``, ``description``, ``is_active``,
            ``auth_type``, ``username``, ``password``, ``access_token``.

    Returns:
        The newly created :class:`~superset.dhis2.models.DHIS2Instance`.

    Raises:
        ValueError: If required fields are missing or invalid.
        Exception: On database commit failure.
    """
    _validate_instance_data(data)

    instance = DHIS2Instance(database_id=database_id)
    for field in _ALLOWED_CREATE_FIELDS:
        if field in data:
            _assign_model_attr(instance, field, data[field])

    # Apply safe defaults for optional fields not supplied by the caller.
    if instance.auth_type is None:
        _assign_model_attr(instance, "auth_type", "basic")
    if instance.is_active is None:
        _assign_model_attr(instance, "is_active", True)
    if "display_order" not in data:
        _assign_model_attr(instance, "display_order", 0)

    try:
        db.session.add(instance)
        _sync_compat_instance(instance)
        db.session.commit()
        logger.info(
            "Created DHIS2Instance id=%s name=%r database_id=%s",
            instance.id,
            instance.name,
            database_id,
        )
        _schedule_metadata_refresh(database_id)
    except Exception:
        db.session.rollback()
        logger.exception(
            "Failed to create DHIS2Instance name=%r database_id=%s",
            data.get("name"),
            database_id,
        )
        raise

    return instance


def update_instance(instance_id: int, data: dict[str, Any]) -> DHIS2Instance:
    """Update an existing DHIS2Instance with the supplied field values.

    Only the fields present in *data* are modified; absent fields are left
    unchanged.  Credential fields (``password``, ``access_token``) are
    updated only when the caller explicitly passes a non-``None`` value – a
    ``None`` value is interpreted as "do not change the stored credential".

    Args:
        instance_id: Primary key of the row to update.
        data: Fields to update.

    Returns:
        The updated :class:`~superset.dhis2.models.DHIS2Instance`.

    Raises:
        ValueError: If validation of the provided fields fails or the
            instance is not found.
        Exception: On database commit failure.
    """
    instance = get_instance(instance_id)
    if instance is None:
        raise ValueError(f"DHIS2Instance with id={instance_id} not found")

    _validate_instance_data(data, require_url=False, require_name=False)

    for field in _ALLOWED_UPDATE_FIELDS:
        if field not in data:
            continue
        # Skip credential fields when the caller passes None (sentinel: leave unchanged).
        if field in ("password", "access_token") and data[field] is None:
            continue
        _assign_model_attr(instance, field, data[field])

    try:
        _sync_compat_instance(instance)
        db.session.commit()
        logger.info("Updated DHIS2Instance id=%s", instance_id)
        _schedule_metadata_refresh(instance.database_id)
    except Exception:
        db.session.rollback()
        logger.exception("Failed to update DHIS2Instance id=%s", instance_id)
        raise

    return instance


def delete_instance(instance_id: int) -> bool:
    """Delete a DHIS2Instance by primary key.

    Args:
        instance_id: Primary key of the row to delete.

    Returns:
        ``True`` when the row was deleted, ``False`` when not found.

    Raises:
        Exception: On database commit failure.
    """
    instance = get_instance(instance_id)
    if instance is None:
        logger.warning("delete_instance: id=%s not found", instance_id)
        return False

    try:
        db.session.delete(instance)
        db.session.commit()
        logger.info("Deleted DHIS2Instance id=%s", instance_id)
        _schedule_metadata_refresh(instance.database_id)
        return True
    except Exception:
        db.session.rollback()
        logger.exception("Failed to delete DHIS2Instance id=%s", instance_id)
        raise


# ---------------------------------------------------------------------------
# Connection testing
# ---------------------------------------------------------------------------


def _perform_connection_test(
    url: str,
    auth_headers: dict[str, str],
) -> dict[str, Any]:
    """Make a GET request to ``{url}/api/me`` and return a result dict.

    Args:
        url: DHIS2 base URL (trailing slash stripped internally).
        auth_headers: HTTP headers to include for authentication.

    Returns:
        A dict with keys ``success`` (bool), ``message`` (str), and
        ``response_time_ms`` (float | None).
    """
    test_url = f"{url.rstrip('/')}/api/me"
    start = time.monotonic()
    try:
        response = requests.get(
            test_url,
            headers=auth_headers,
            timeout=_CONNECTION_TEST_TIMEOUT,
        )
        elapsed_ms = (time.monotonic() - start) * 1000

        if response.ok:
            return {
                "success": True,
                "message": f"Connected successfully (HTTP {response.status_code})",
                "response_time_ms": round(elapsed_ms, 1),
            }

        return {
            "success": False,
            "message": f"Server returned HTTP {response.status_code}: {response.reason}",
            "response_time_ms": round(elapsed_ms, 1),
        }

    except requests.exceptions.Timeout:
        return {
            "success": False,
            "message": f"Connection timed out after {_CONNECTION_TEST_TIMEOUT}s",
            "response_time_ms": None,
        }
    except requests.exceptions.ConnectionError as exc:
        return {
            "success": False,
            "message": f"Connection error: {exc}",
            "response_time_ms": None,
        }
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Unexpected error during DHIS2 connection test to %s", url)
        return {
            "success": False,
            "message": f"Unexpected error: {exc}",
            "response_time_ms": None,
        }


def test_instance_connection(instance_id: int) -> dict[str, Any]:
    """Test connectivity for an existing DHIS2Instance.

    Retrieves the instance by *instance_id*, derives auth headers via
    :meth:`~superset.dhis2.models.DHIS2Instance.get_auth_headers`, and
    issues a GET request to ``/api/me``.

    Args:
        instance_id: Primary key of the instance to test.

    Returns:
        A dict with keys:
        - ``success`` – whether the request succeeded.
        - ``message`` – human-readable result description.
        - ``response_time_ms`` – round-trip time in milliseconds, or
          ``None`` when the request did not complete.

    Raises:
        ValueError: When no instance with *instance_id* exists.
    """
    instance = get_instance(instance_id)
    if instance is None:
        raise ValueError(f"DHIS2Instance with id={instance_id} not found")

    logger.info(
        "Testing connection for DHIS2Instance id=%s url=%r",
        instance_id,
        instance.url,
    )
    result = _perform_connection_test(instance.url, instance.get_auth_headers())

    try:
        _assign_model_attr(
            instance,
            "last_test_status",
            "success" if result.get("success") else "failed",
        )
        _assign_model_attr(instance, "last_test_message", result.get("message"))
        _assign_model_attr(
            instance,
            "last_test_response_time_ms",
            result.get("response_time_ms"),
        )
        _assign_model_attr(instance, "last_tested_on", datetime.utcnow())
        db.session.commit()
    except Exception:  # pylint: disable=broad-except
        db.session.rollback()
        logger.warning(
            "Failed to persist DHIS2 connection test result for instance id=%s",
            instance_id,
            exc_info=True,
        )

    return result


def test_instance_connection_with_config(config: dict[str, Any]) -> dict[str, Any]:
    """Test DHIS2 connectivity from raw configuration without persisting.

    Constructs a transient :class:`~superset.dhis2.models.DHIS2Instance` to
    derive auth headers, then calls ``/api/me``.  No credentials are logged.

    Args:
        config: Must contain at least ``url``.  Optional keys:
            ``auth_type`` (``"basic"`` | ``"pat"``), ``username``,
            ``password``, ``access_token``.

    Returns:
        Same shape as :func:`test_instance_connection`.

    Raises:
        ValueError: When ``url`` is missing from *config*.
    """
    url = config.get("url")
    if not url:
        raise ValueError("'url' is required for connection test")

    # Build a transient instance to leverage its get_auth_headers() logic.
    transient = DHIS2Instance(
        database_id=0,  # sentinel – not persisted
        name="_test_",
        url=url,
        auth_type=config.get("auth_type", "basic"),
        username=config.get("username"),
        password=config.get("password"),
        access_token=config.get("access_token"),
    )

    logger.info("Testing transient DHIS2 connection to url=%r", url)
    return _perform_connection_test(url, transient.get_auth_headers())


# ---------------------------------------------------------------------------
# Legacy migration
# ---------------------------------------------------------------------------


def migrate_legacy_instance(database_id: int) -> DHIS2Instance | None:
    """Create a ``default`` DHIS2Instance from a legacy Database.encrypted_extra.

    Legacy DHIS2 databases stored connection params directly on the ``dbs``
    row in ``encrypted_extra`` (fields: ``host``, ``username``, ``password``,
    ``access_token``, ``authentication_type``).  This function reads those
    fields and creates a ``DHIS2Instance`` named ``"default"`` for the same
    database.

    Args:
        database_id: Primary key of the ``dbs`` row to migrate.

    Returns:
        The newly created :class:`~superset.dhis2.models.DHIS2Instance`, or
        ``None`` when no recognisable DHIS2 configuration is found in
        ``encrypted_extra``.

    Raises:
        ValueError: When the database is not found.
        Exception: On database commit failure.
    """
    from superset.models.core import Database  # local import to avoid circular deps

    database = db.session.get(Database, database_id)
    if database is None:
        raise ValueError(f"Database with id={database_id} not found")

    encrypted = database.get_encrypted_extra()
    host = encrypted.get("host") or encrypted.get("url")
    if not host:
        logger.info(
            "migrate_legacy_instance: no DHIS2 host found in encrypted_extra "
            "for database_id=%s – skipping",
            database_id,
        )
        return None

    # Normalise host to a full URL.
    if not host.startswith(("http://", "https://")):
        host = f"https://{host}"

    auth_type_raw = encrypted.get("authentication_type", "basic")
    # Accept both 'token' and 'pat' as synonyms for PAT auth.
    auth_type = "pat" if auth_type_raw in ("token", "pat") else "basic"

    instance = DHIS2Instance(
        database_id=database_id,
        name="default",
        url=host,
        description="Migrated from legacy single-instance configuration",
        is_active=True,
        auth_type=auth_type,
        username=encrypted.get("username"),
        password=encrypted.get("password"),
        access_token=encrypted.get("access_token"),
    )

    try:
        db.session.add(instance)
        _sync_compat_instance(instance)
        db.session.commit()
        logger.info(
            "Migrated legacy DHIS2 config to DHIS2Instance id=%s database_id=%s",
            instance.id,
            database_id,
        )
    except Exception:
        db.session.rollback()
        logger.exception(
            "Failed to migrate legacy DHIS2 config for database_id=%s",
            database_id,
        )
        raise

    return instance


def get_or_create_legacy_instance(database_id: int) -> DHIS2Instance | None:
    """Return any existing instance for *database_id*, or attempt a migration.

    When at least one :class:`~superset.dhis2.models.DHIS2Instance` already
    exists for *database_id* the first active one is returned immediately.
    Otherwise :func:`migrate_legacy_instance` is called to create a
    ``"default"`` instance from the database's ``encrypted_extra``.

    Args:
        database_id: Primary key of the ``dbs`` row.

    Returns:
        A :class:`~superset.dhis2.models.DHIS2Instance`, or ``None`` when no
        configuration is available.
    """
    existing = (
        db.session.query(DHIS2Instance)
        .filter(
            DHIS2Instance.database_id == database_id,
            DHIS2Instance.is_active.is_(True),
        )
        .order_by(DHIS2Instance.id)
        .first()
    )
    if existing is not None:
        return existing

    logger.info(
        "get_or_create_legacy_instance: no instances for database_id=%s; "
        "attempting migration",
        database_id,
    )
    try:
        return migrate_legacy_instance(database_id)
    except Exception:
        logger.exception(
            "get_or_create_legacy_instance: migration failed for database_id=%s",
            database_id,
        )
        return None
