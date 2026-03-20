from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

import requests
from flask import current_app, has_app_context
from sqlalchemy import event
from sqlalchemy.engine.url import make_url

from superset import db
from superset.dhis2.geojson_utils import convert_to_geojson
from superset.dhis2.org_unit_level_metadata import merge_org_unit_level_items
from superset.models.core import Database
from superset.staging import metadata_cache_service
from superset.staging.source_service import ensure_source_for_database
from superset.db_engine_specs.dhis2 import DHIS2EngineSpec

logger = logging.getLogger(__name__)

SNAPSHOT_NAMESPACE_PREFIX = "dhis2_snapshot:"
REFRESH_PROGRESS_NAMESPACE = "dhis2_progress:metadata_refresh"
GEOJSON_METADATA_TYPE = "geoJSON"
ORG_UNIT_HIERARCHY_METADATA_TYPE = "orgUnitHierarchy"
LEGEND_SET_METADATA_TYPE = "legendSets"
SUPPORTED_METADATA_TYPES = (
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
    # Disaggregation / category dimension metadata
    "categories",
    "categoryCombos",
    "categoryOptionCombos",
    # Org unit structure
    "organisationUnits",
    "organisationUnitLevels",
    "organisationUnitGroups",
    "organisationUnitGroupSets",
    LEGEND_SET_METADATA_TYPE,
    GEOJSON_METADATA_TYPE,
    ORG_UNIT_HIERARCHY_METADATA_TYPE,
)
VARIABLE_METADATA_TYPES = (
    "dataElements",
    "indicators",
    "dataSets",
    "programIndicators",
    "eventDataItems",
)
VARIABLE_PROGRESS_METADATA_TYPES = (
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
    "categories",
    "categoryCombos",
    "categoryOptionCombos",
)
CATEGORY_METADATA_TYPES = (
    "categories",
    "categoryCombos",
    "categoryOptionCombos",
)
PROGRAM_METADATA_TYPES = (
    "programs",
    "programStages",
    "trackedEntityTypes",
)
# Full variable family used in status/diagnostics (excludes programs and categories)
VARIABLE_STATUS_METADATA_TYPES = (
    "dataElements",
    "indicators",
    "indicatorTypes",
    "dataSets",
    "programIndicators",
    "eventDataItems",
    "dataElementGroups",
    "dataElementGroupSets",
    "indicatorGroups",
    "indicatorGroupSets",
)
LEGEND_SET_PROGRESS_METADATA_TYPES = (LEGEND_SET_METADATA_TYPE,)
ORG_UNIT_METADATA_TYPES = (
    "organisationUnits",
    "organisationUnitLevels",
    "organisationUnitGroups",
    "organisationUnitGroupSets",
    GEOJSON_METADATA_TYPE,
    ORG_UNIT_HIERARCHY_METADATA_TYPE,
)
BACKGROUND_REQUIRED_METADATA_TYPES = (
    *ORG_UNIT_METADATA_TYPES,
    LEGEND_SET_METADATA_TYPE,
)
_SEARCH_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9]{10}$")
_ANALYTICS_NUMERIC_TYPES = {
    "NUMBER",
    "INTEGER",
    "INTEGER_POSITIVE",
    "INTEGER_NEGATIVE",
    "INTEGER_ZERO_OR_POSITIVE",
    "PERCENTAGE",
    "UNIT_INTERVAL",
}
_BACKGROUND_REFRESH_DELAY_SECONDS = 0.25
_ORG_UNIT_SOURCE_MODE_REPOSITORY = "repository"

_CELERY_PING_TIMEOUT = 1.0  # seconds to wait for a worker ping


def _celery_workers_available() -> bool:
    """Return True if at least one Celery worker is reachable (via ping).

    Uses a short timeout so this never blocks the request thread.
    Falls back to False on any error so the caller uses the thread path.
    """
    try:
        from celery import current_app as celery_app  # lazy import

        response = celery_app.control.inspect(timeout=_CELERY_PING_TIMEOUT).ping()
        return bool(response)
    except Exception:  # pylint: disable=broad-except
        return False
_ORG_UNIT_SOURCE_MODE_PRIMARY = "primary"
_ORG_UNIT_SOURCE_MODE_PER_INSTANCE = "per_instance"


class UnsupportedMetadataError(ValueError):
    """Raised when a DHIS2 instance does not expose an optional metadata endpoint."""


@dataclass(frozen=True)
class MetadataContext:
    instance_id: int | None
    instance_name: str
    base_url: str
    auth: Any
    headers: dict[str, str]


def _snapshot_namespace(metadata_type: str) -> str:
    return f"{SNAPSHOT_NAMESPACE_PREFIX}{metadata_type}"


def _snapshot_key_parts(instance_id: int | None) -> dict[str, Any]:
    return {"instance_id": instance_id}


def _refresh_progress_key_parts() -> dict[str, Any]:
    return {"scope": "metadata_refresh"}


def _progress_family_for_metadata_type(metadata_type: str) -> str | None:
    if metadata_type in VARIABLE_PROGRESS_METADATA_TYPES:
        return "variables"
    if metadata_type in LEGEND_SET_PROGRESS_METADATA_TYPES:
        return "legend_sets"
    if metadata_type in ORG_UNIT_METADATA_TYPES:
        return "org_units"
    return None


def _normalize_metadata_types(
    metadata_types: Iterable[str] | None,
) -> list[str]:
    return [
        metadata_type
        for metadata_type in (metadata_types or SUPPORTED_METADATA_TYPES)
        if metadata_type in SUPPORTED_METADATA_TYPES
    ]


def get_background_metadata_types(
    metadata_types: Iterable[str] | None = None,
) -> list[str]:
    normalized_metadata_types = _normalize_metadata_types(metadata_types)
    return list(
        dict.fromkeys(
            [
                *BACKGROUND_REQUIRED_METADATA_TYPES,
                *normalized_metadata_types,
            ]
        )
    )


def _progress_status(
    *,
    completed_units: int,
    total_units: int,
    failed_units: int,
    initial_status: str = "queued",
) -> str:
    if total_units <= 0:
        return "complete"
    if completed_units <= 0:
        return initial_status
    if completed_units < total_units:
        return "partial" if failed_units > 0 else "running"
    if failed_units <= 0:
        return "complete"
    if failed_units >= completed_units:
        return "failed"
    return "partial"


def _percent_complete(completed_units: int, total_units: int) -> int:
    if total_units <= 0:
        return 100
    return min(100, max(0, round((completed_units / total_units) * 100)))


def _snapshot_count_estimate(
    database_id: int,
    *,
    metadata_type: str,
    instance_id: int | None,
) -> int | None:
    try:
        snapshot = metadata_cache_service.get_cached_metadata_payload(
            database_id,
            _snapshot_namespace(metadata_type),
            _snapshot_key_parts(instance_id),
        )
    except RuntimeError:
        # Progress estimation is best-effort; missing app context should not
        # break refresh scheduling or tests that isolate the service logic.
        return None
    if snapshot is None:
        return None
    try:
        return int(snapshot.get("count") or 0)
    except (TypeError, ValueError):
        return 0


def _build_refresh_progress_state(
    *,
    database_id: int,
    contexts: list[MetadataContext],
    metadata_types: list[str],
    reason: str | None,
    status: str,
) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    families: dict[str, dict[str, Any]] = {}

    for family_name, family_types in (
        ("variables", VARIABLE_PROGRESS_METADATA_TYPES),
        ("legend_sets", LEGEND_SET_PROGRESS_METADATA_TYPES),
        ("org_units", ORG_UNIT_METADATA_TYPES),
    ):
        active_family_types = [
            metadata_type
            for metadata_type in metadata_types
            if metadata_type in family_types
        ]
        instances: list[dict[str, Any]] = []
        family_total_count_estimate = 0
        family_has_estimate = False

        for context in contexts:
            estimate_values = [
                _snapshot_count_estimate(
                    database_id,
                    metadata_type=metadata_type,
                    instance_id=context.instance_id,
                )
                for metadata_type in active_family_types
            ]
            known_estimates = [value for value in estimate_values if value is not None]
            has_estimate = len(known_estimates) > 0
            total_count_estimate = sum(known_estimates) if has_estimate else None
            if total_count_estimate is not None:
                family_total_count_estimate += total_count_estimate
                family_has_estimate = True
            instances.append(
                {
                    "id": context.instance_id,
                    "name": context.instance_name,
                    "status": status if active_family_types else "complete",
                    "loaded_count": 0,
                    "total_count_estimate": total_count_estimate,
                    "completed_units": 0,
                    "failed_units": 0,
                    "total_units": len(active_family_types),
                    "percent_complete": 0 if active_family_types else 100,
                    "current_metadata_type": None,
                    "last_error": None,
                }
            )

        total_units = len(active_family_types) * len(contexts)
        families[family_name] = {
            "status": status if total_units > 0 else "complete",
            "loaded_count": 0,
            "total_count_estimate": (
                family_total_count_estimate if family_has_estimate else None
            ),
            "completed_units": 0,
            "failed_units": 0,
            "total_units": total_units,
            "percent_complete": 0 if total_units > 0 else 100,
            "current_metadata_type": None,
            "current_instance_id": None,
            "current_instance_name": None,
            "last_error": None,
            "instances": instances,
        }

    overall_total_units = sum(family["total_units"] for family in families.values())
    return {
        "status": status,
        "reason": reason,
        "started_at": now,
        "updated_at": now,
        "completed_at": None,
        "overall": {
            "completed_units": 0,
            "failed_units": 0,
            "total_units": overall_total_units,
            "percent_complete": 0 if overall_total_units > 0 else 100,
        },
        "variables": families["variables"],
        "legend_sets": families["legend_sets"],
        "org_units": families["org_units"],
    }


def _persist_refresh_progress(database_id: int, progress: dict[str, Any]) -> dict[str, Any]:
    return metadata_cache_service.set_cached_metadata_payload(
        database_id,
        REFRESH_PROGRESS_NAMESPACE,
        _refresh_progress_key_parts(),
        progress,
        ttl_seconds=None,
    )


def queue_metadata_refresh_progress(
    database_id: int,
    *,
    instance_ids: Iterable[int] | None = None,
    metadata_types: Iterable[str] | None = None,
    reason: str | None = None,
) -> dict[str, Any] | None:
    database = db.session.get(Database, database_id)
    if database is None or database.backend != "dhis2":
        return None

    existing = get_metadata_refresh_progress(database_id)
    if existing and existing.get("status") in {"queued", "running", "partial"}:
        return existing

    requested_instance_ids = list(dict.fromkeys(instance_ids or []))
    active_metadata_types = list(dict.fromkeys(metadata_types or SUPPORTED_METADATA_TYPES))
    contexts = _resolve_staged_contexts(
        database,
        requested_instance_ids=requested_instance_ids,
        federated=bool(requested_instance_ids),
    )
    progress = _build_refresh_progress_state(
        database_id=database_id,
        contexts=contexts,
        metadata_types=active_metadata_types,
        reason=reason,
        status="queued",
    )
    return _persist_refresh_progress(database_id, progress)


def _update_refresh_progress(
    progress: dict[str, Any],
    *,
    context: MetadataContext,
    metadata_type: str,
    count: int,
    success: bool,
    error: str | None = None,
) -> dict[str, Any]:
    family_name = _progress_family_for_metadata_type(metadata_type)
    now = datetime.utcnow().isoformat()

    progress["updated_at"] = now
    overall = progress.setdefault(
        "overall",
        {"completed_units": 0, "failed_units": 0, "total_units": 0, "percent_complete": 0},
    )
    overall["completed_units"] = int(overall.get("completed_units") or 0) + 1
    if not success:
        overall["failed_units"] = int(overall.get("failed_units") or 0) + 1
    overall["percent_complete"] = _percent_complete(
        int(overall.get("completed_units") or 0),
        int(overall.get("total_units") or 0),
    )

    if family_name is not None:
        family = progress.get(family_name) or {}
        family["completed_units"] = int(family.get("completed_units") or 0) + 1
        if success:
            family["loaded_count"] = int(family.get("loaded_count") or 0) + int(count or 0)
            if (
                family.get("total_count_estimate") is not None
                and int(family.get("loaded_count") or 0)
                > int(family.get("total_count_estimate") or 0)
            ):
                family["total_count_estimate"] = int(family.get("loaded_count") or 0)
        else:
            family["failed_units"] = int(family.get("failed_units") or 0) + 1
            family["last_error"] = error

        family["current_metadata_type"] = metadata_type
        family["current_instance_id"] = context.instance_id
        family["current_instance_name"] = context.instance_name
        family["percent_complete"] = _percent_complete(
            int(family.get("completed_units") or 0),
            int(family.get("total_units") or 0),
        )
        family["status"] = _progress_status(
            completed_units=int(family.get("completed_units") or 0),
            total_units=int(family.get("total_units") or 0),
            failed_units=int(family.get("failed_units") or 0),
            initial_status="running",
        )
        if family["status"] == "complete":
            family["current_metadata_type"] = None
            family["current_instance_id"] = None
            family["current_instance_name"] = None
            family["last_error"] = None
            family["total_count_estimate"] = int(family.get("loaded_count") or 0)

        family_instances = family.get("instances") or []
        for instance_progress in family_instances:
            if instance_progress.get("id") != context.instance_id:
                continue
            instance_progress["completed_units"] = int(
                instance_progress.get("completed_units") or 0
            ) + 1
            if success:
                instance_progress["loaded_count"] = int(
                    instance_progress.get("loaded_count") or 0
                ) + int(count or 0)
                if (
                    instance_progress.get("total_count_estimate") is not None
                    and int(instance_progress.get("loaded_count") or 0)
                    > int(instance_progress.get("total_count_estimate") or 0)
                ):
                    instance_progress["total_count_estimate"] = int(
                        instance_progress.get("loaded_count") or 0
                    )
            else:
                instance_progress["failed_units"] = int(
                    instance_progress.get("failed_units") or 0
                ) + 1
                instance_progress["last_error"] = error
            instance_progress["current_metadata_type"] = metadata_type
            instance_progress["percent_complete"] = _percent_complete(
                int(instance_progress.get("completed_units") or 0),
                int(instance_progress.get("total_units") or 0),
            )
            instance_progress["status"] = _progress_status(
                completed_units=int(instance_progress.get("completed_units") or 0),
                total_units=int(instance_progress.get("total_units") or 0),
                failed_units=int(instance_progress.get("failed_units") or 0),
                initial_status="running",
            )
            if instance_progress["status"] == "complete":
                instance_progress["current_metadata_type"] = None
                instance_progress["last_error"] = None
                instance_progress["total_count_estimate"] = int(
                    instance_progress.get("loaded_count") or 0
                )
            break

    progress["status"] = _progress_status(
        completed_units=int(overall.get("completed_units") or 0),
        total_units=int(overall.get("total_units") or 0),
        failed_units=int(overall.get("failed_units") or 0),
        initial_status="running",
    )
    if progress["status"] in {"complete", "partial", "failed"}:
        progress["completed_at"] = now

    return progress


def get_metadata_refresh_progress(database_id: int) -> dict[str, Any] | None:
    return metadata_cache_service.get_cached_metadata_payload(
        database_id,
        REFRESH_PROGRESS_NAMESPACE,
        _refresh_progress_key_parts(),
    )


def _build_database_context(database: Database) -> MetadataContext:
    uri = make_url(database.sqlalchemy_uri_decrypted)
    api_path = uri.database or "/api"
    if not api_path.startswith("/"):
        api_path = f"/{api_path}"

    base_url = f"https://{uri.host}{api_path}"
    auth = None
    headers: dict[str, str] = {}
    if not uri.username and uri.password:
        headers = {"Authorization": f"ApiToken {uri.password}"}
    else:
        auth = (uri.username, uri.password) if uri.username else None

    return MetadataContext(
        instance_id=None,
        instance_name=database.database_name,
        base_url=base_url,
        auth=auth,
        headers=headers,
    )


def resolve_metadata_contexts(
    database: Database,
    *,
    instance_id: int | None = None,
    requested_instance_ids: list[int] | None = None,
    federated: bool = False,
) -> list[MetadataContext]:
    from superset.dhis2 import instance_service as inst_svc

    requested_instance_ids = requested_instance_ids or []

    if instance_id is not None and not federated and not requested_instance_ids:
        dhis2_instance = inst_svc.get_instance(instance_id)
        if dhis2_instance is None:
            raise ValueError("No such DHIS2 instance")
        if dhis2_instance.database_id != database.id:
            raise ValueError("DHIS2 instance does not belong to this database")
        return [
            MetadataContext(
                instance_id=dhis2_instance.id,
                instance_name=dhis2_instance.name,
                base_url=f"{dhis2_instance.url.rstrip('/')}/api",
                auth=None,
                headers=dhis2_instance.get_auth_headers(),
            )
        ]

    if federated or requested_instance_ids:
        instances = inst_svc.get_instances_with_legacy_fallback(
            database.id,
            include_inactive=False,
        )
        if requested_instance_ids:
            requested_ids = set(requested_instance_ids)
            instances = [
                instance for instance in instances if instance.id in requested_ids
            ]
        return [
            MetadataContext(
                instance_id=instance.id,
                instance_name=instance.name,
                base_url=f"{instance.url.rstrip('/')}/api",
                auth=None,
                headers=instance.get_auth_headers(),
            )
            for instance in instances
        ]

    return [_build_database_context(database)]


def _resolve_dhis2_source_database(
    database: Database,
    requested_instance_ids: list[int] | None = None,
) -> Database | None:
    """Return the DHIS2 source database for a DuckDB serving database.

    Metadata snapshots and DHIS2 instance registrations are stored against
    the DHIS2 source database, not the DuckDB serving database.  This helper
    resolves the correct source so lookups find the cached data.

    Resolution order:
    1. If instance IDs are provided, look up the first instance's database_id.
    2. Fall back to scanning SqlaTable.extra for ``dhis2_source_database_id``.
    """
    from superset import db as _db
    from superset.models.core import Database as _Database

    # Prefer instance-based resolution — direct and accurate.
    if requested_instance_ids:
        from superset.dhis2 import instance_service as inst_svc
        try:
            instance = inst_svc.get_instance(requested_instance_ids[0])
            if instance is not None:
                source_db = _db.session.get(_Database, instance.database_id)
                if source_db is not None:
                    return source_db
        except Exception:  # pylint: disable=broad-except
            pass

    # Fallback: scan dataset extras for the source database ID.
    try:
        from superset.connectors.sqla.models import SqlaTable

        sqla_tables = (
            _db.session.query(SqlaTable)
            .filter_by(database_id=database.id)
            .all()
        )
        for sqla in sqla_tables:
            try:
                extra = json.loads(sqla.extra or "{}")
                src_db_id = extra.get("dhis2_source_database_id")
                if src_db_id:
                    source_db = _db.session.get(_Database, int(src_db_id))
                    if source_db is not None:
                        return source_db
            except Exception:  # pylint: disable=broad-except
                pass
    except Exception:  # pylint: disable=broad-except
        pass

    return None


def _resolve_staged_contexts(
    database: Database,
    *,
    instance_id: int | None = None,
    requested_instance_ids: list[int] | None = None,
    federated: bool = False,
) -> list[MetadataContext]:
    requested_instance_ids = list(dict.fromkeys(requested_instance_ids or []))

    # If this is a DuckDB (or other local-staging) serving database, resolve
    # to the originating DHIS2 source database *first* — regardless of whether
    # instance IDs were provided.  DHIS2 instances are registered against the
    # source DHIS2 database, not the DuckDB serving database, so any call to
    # resolve_metadata_contexts with the DuckDB database will return no contexts.
    uri = str(getattr(database, "sqlalchemy_uri_decrypted", None) or "")
    if uri.startswith("duckdb://"):
        source_db = _resolve_dhis2_source_database(database, requested_instance_ids)
        if source_db is not None:
            return _resolve_staged_contexts(
                source_db,
                instance_id=instance_id,
                requested_instance_ids=requested_instance_ids,
                federated=federated or bool(requested_instance_ids),
            )
        return []

    if instance_id is not None or requested_instance_ids or federated:
        return resolve_metadata_contexts(
            database,
            instance_id=instance_id,
            requested_instance_ids=requested_instance_ids,
            federated=federated,
        )

    if DHIS2EngineSpec.is_shell_sqlalchemy_uri(
        getattr(database, "sqlalchemy_uri_decrypted", None)
    ):
        from superset.dhis2 import instance_service as inst_svc

        active_instance_ids = [
            instance.id
            for instance in inst_svc.get_instances_with_legacy_fallback(
                database.id,
                include_inactive=False,
            )
            if getattr(instance, "id", None) is not None
        ]
        if not active_instance_ids:
            return []
        return resolve_metadata_contexts(
            database,
            requested_instance_ids=active_instance_ids,
            federated=True,
        )

    return resolve_metadata_contexts(
        database,
        instance_id=instance_id,
        requested_instance_ids=requested_instance_ids,
        federated=False,
    )


def _build_org_unit_lookup(
    org_unit_items: list[dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for item in org_unit_items or []:
        org_unit_id = str(item.get("id") or "").strip()
        if org_unit_id:
            lookup[org_unit_id] = dict(item)
    return lookup


def _normalize_geojson_feature(
    feature: dict[str, Any],
    *,
    org_unit_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    feature_id = str(feature.get("id") or "").strip()
    if not feature_id:
        properties = feature.get("properties")
        if isinstance(properties, dict):
            feature_id = str(properties.get("id") or "").strip()
    if not feature_id:
        return None

    geometry = feature.get("geometry")
    if not isinstance(geometry, dict) or not geometry.get("coordinates"):
        return None

    lookup_item = (org_unit_lookup or {}).get(feature_id, {})
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    display_name = (
        properties.get("displayName")
        or properties.get("name")
        or lookup_item.get("displayName")
        or lookup_item.get("name")
        or feature_id
    )
    parent_id = (
        properties.get("parentId")
        or properties.get("parent")
        or lookup_item.get("parentId")
        or _extract_id(lookup_item.get("parent"), "id")
    )
    level = properties.get("level") or lookup_item.get("level")
    path = properties.get("path") or lookup_item.get("path")

    normalized_properties = dict(properties)
    normalized_properties["id"] = feature_id
    normalized_properties["name"] = display_name
    normalized_properties.setdefault("displayName", display_name)
    normalized_properties["level"] = level
    normalized_properties["parentId"] = parent_id
    normalized_properties["parent"] = parent_id
    if path:
        normalized_properties["path"] = path
    if "parentName" not in normalized_properties and lookup_item.get("parentName"):
        normalized_properties["parentName"] = lookup_item["parentName"]

    return {
        "type": "Feature",
        "id": feature_id,
        "geometry": geometry,
        "properties": normalized_properties,
    }


def _normalize_geo_features_to_feature_collection(
    geo_features: list[dict[str, Any]],
    *,
    org_unit_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    geojson = convert_to_geojson(geo_features)
    normalized_features = [
        normalized
        for feature in list(geojson.get("features") or [])
        if isinstance(feature, dict)
        for normalized in [
            _normalize_geojson_feature(
                feature,
                org_unit_lookup=org_unit_lookup,
            )
        ]
        if normalized is not None
    ]
    return {
        "type": "FeatureCollection",
        "features": normalized_features,
    }


def _get_highest_geojson_feature_level(feature_collection: dict[str, Any]) -> int:
    highest_level = 0
    for feature in list(feature_collection.get("features") or []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue
        try:
            highest_level = max(
                highest_level,
                int(properties.get("level") or 0),
            )
        except (TypeError, ValueError):
            continue
    return highest_level


def _get_highest_org_unit_level(org_unit_items: list[dict[str, Any]] | None) -> int:
    highest_level = 0
    for item in org_unit_items or []:
        try:
            highest_level = max(highest_level, int(item.get("level") or 0))
        except (TypeError, ValueError):
            continue
    return highest_level


def _should_fallback_to_geo_features(
    feature_collection: dict[str, Any],
    *,
    org_unit_items: list[dict[str, Any]] | None = None,
) -> bool:
    features = [
        feature
        for feature in list(feature_collection.get("features") or [])
        if isinstance(feature, dict)
    ]
    if not features:
        return True

    org_units = list(org_unit_items or [])
    if len(org_units) <= len(features):
        return False

    highest_feature_level = _get_highest_geojson_feature_level(feature_collection)
    highest_org_unit_level = _get_highest_org_unit_level(org_units)
    if highest_org_unit_level > highest_feature_level:
        return True

    if len(features) <= 1 and len(org_units) > 1:
        return True

    return False


def _geojson_feature_collection_supports_levels(
    feature_collection: dict[str, Any],
    levels: list[str] | None,
) -> bool:
    requested_levels = {str(level).strip() for level in levels or [] if str(level).strip()}
    if not requested_levels:
        return bool(list(feature_collection.get("features") or []))

    for feature in list(feature_collection.get("features") or []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue
        if str(properties.get("level") or "").strip() in requested_levels:
            return True
    return False


def _extract_geo_feature_levels(
    org_unit_items: list[dict[str, Any]] | None,
) -> list[int]:
    levels: set[int] = set()
    for item in org_unit_items or []:
        try:
            level = int(item.get("level") or 0)
        except (TypeError, ValueError):
            continue
        if level > 0:
            levels.add(level)
    return sorted(levels)


def _parse_geo_features_response(response: requests.Response) -> list[dict[str, Any]]:
    if response.status_code == 200:
        data = response.json()
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict):
            return [
                item
                for item in list(data.get("geoFeatures") or [])
                if isinstance(item, dict)
            ]
        return []

    if response.status_code == 401:
        raise ValueError(
            "DHIS2 API authentication failed. Please check database credentials."
        )

    raise ValueError(f"DHIS2 API error: {response.status_code} {response.text[:200]}")


def _fetch_context_geo_features(
    context: MetadataContext,
    *,
    org_unit_items: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    requested_levels = _extract_geo_feature_levels(org_unit_items) or [1]
    all_features: list[dict[str, Any]] = []
    seen_feature_ids: set[str] = set()

    for level in requested_levels:
        response = requests.get(
            f"{context.base_url}/geoFeatures",
            params={"ou": f"ou:LEVEL-{level}"},
            auth=context.auth,
            headers=context.headers,
            timeout=60,
        )
        level_features = _parse_geo_features_response(response)
        for feature in level_features:
            feature_id = str(feature.get("id") or "").strip()
            if feature_id and feature_id in seen_feature_ids:
                continue
            if feature_id:
                seen_feature_ids.add(feature_id)
            all_features.append(feature)

    return all_features


def _fetch_context_geojson_feature_collection(
    *,
    context: MetadataContext,
    org_unit_items: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    org_unit_lookup = _build_org_unit_lookup(org_unit_items)
    headers = {
        **context.headers,
        "Accept": "application/json+geojson,application/json",
    }
    response = requests.get(
        f"{context.base_url}/organisationUnits.geojson",
        auth=context.auth,
        headers=headers,
        timeout=60,
    )

    if response.status_code == 200:
        payload = response.json()
        features = payload.get("features") if isinstance(payload, dict) else None
        if isinstance(features, list):
            feature_collection = {
                "type": "FeatureCollection",
                "features": [
                    normalized
                    for feature in features
                    if isinstance(feature, dict)
                    for normalized in [
                        _normalize_geojson_feature(
                            feature,
                            org_unit_lookup=org_unit_lookup,
                        )
                    ]
                    if normalized is not None
                ],
            }
            if not _should_fallback_to_geo_features(
                feature_collection,
                org_unit_items=org_unit_items,
            ):
                return feature_collection

            logger.info(
                "DHIS2 organisationUnits.geojson returned incomplete boundaries for "
                "instance=%s; retrying with geoFeatures",
                context.instance_id,
            )
    elif response.status_code != 404:
        if response.status_code == 401:
            raise ValueError(
                "DHIS2 API authentication failed. Please check database credentials."
            )
        raise ValueError(
            f"DHIS2 API error: {response.status_code} {response.text[:200]}"
        )

    geo_features = _fetch_context_geo_features(
        context,
        org_unit_items=org_unit_items,
    )
    return _normalize_geo_features_to_feature_collection(
        geo_features,
        org_unit_lookup=org_unit_lookup,
    )


def _build_org_unit_hierarchy_items(
    org_unit_items: list[dict[str, Any]] | None,
    *,
    geojson_feature_collection: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    geo_feature_lookup: dict[str, dict[str, Any]] = {}
    for feature in list((geojson_feature_collection or {}).get("features") or []):
        if not isinstance(feature, dict):
            continue
        feature_id = str(feature.get("id") or "").strip()
        if feature_id:
            geo_feature_lookup[feature_id] = feature

    nodes: dict[str, dict[str, Any]] = {}
    for item in org_unit_items or []:
        org_unit_id = str(item.get("id") or "").strip()
        if not org_unit_id:
            continue
        path = str(item.get("path") or "").strip()
        path_parts = [part for part in path.split("/") if part]
        feature = geo_feature_lookup.get(org_unit_id)
        node = {
            "id": org_unit_id,
            "displayName": item.get("displayName") or item.get("name") or org_unit_id,
            "name": item.get("name") or item.get("displayName") or org_unit_id,
            "level": item.get("level"),
            "parentId": item.get("parentId") or _extract_id(item.get("parent"), "id"),
            "path": path or None,
            "ancestorIds": path_parts[:-1] if path_parts else [],
            "childrenIds": [],
            "hasGeometry": feature is not None,
            "geometryType": (
                feature.get("geometry", {}).get("type")
                if isinstance(feature, dict)
                else None
            ),
        }
        nodes[org_unit_id] = node

    for node in nodes.values():
        parent_id = node.get("parentId")
        if parent_id and parent_id in nodes:
            nodes[parent_id]["childrenIds"].append(node["id"])

    for node in nodes.values():
        node["childrenIds"] = sorted(node["childrenIds"])

    return sorted(
        nodes.values(),
        key=lambda item: (
            int(item.get("level") or 999),
            str(item.get("displayName") or item.get("name") or item.get("id") or ""),
        ),
    )


def _metadata_item_count(metadata_type: str, result_payload: Any) -> int:
    if metadata_type == GEOJSON_METADATA_TYPE:
        if isinstance(result_payload, dict):
            return len(list(result_payload.get("features") or []))
        return 0
    if isinstance(result_payload, list):
        return len(result_payload)
    return 0


def _build_snapshot_payload(
    *,
    context: MetadataContext,
    metadata_type: str,
    status: str,
    result_payload: Any,
    message: str | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "result": result_payload,
        "message": message,
        "instance_id": context.instance_id,
        "instance_name": context.instance_name,
        "metadata_type": metadata_type,
        "count": _metadata_item_count(metadata_type, result_payload),
    }


def _persist_snapshot_payload(
    database_id: int,
    *,
    metadata_type: str,
    context: MetadataContext,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return metadata_cache_service.set_cached_metadata_payload(
        database_id,
        _snapshot_namespace(metadata_type),
        _snapshot_key_parts(context.instance_id),
        payload,
        ttl_seconds=None,
    )


def _load_snapshot_result(
    database_id: int,
    *,
    metadata_type: str,
    context: MetadataContext,
) -> dict[str, Any] | None:
    return metadata_cache_service.get_cached_metadata_payload(
        database_id,
        _snapshot_namespace(metadata_type),
        _snapshot_key_parts(context.instance_id),
    )


def _load_or_fetch_metadata_snapshot_for_context(
    *,
    database_id: int,
    metadata_type: str,
    context: MetadataContext,
) -> tuple[dict[str, Any] | None, bool]:
    snapshot = _load_snapshot_result(
        database_id,
        metadata_type=metadata_type,
        context=context,
    )
    snapshot_status = (
        snapshot.get("status") if isinstance(snapshot, dict) else None
    ) or ("pending" if snapshot is None else "success")
    if snapshot_status == "success":
        return snapshot, False

    result_payload = _fetch_context_metadata_items(
        context=context,
        metadata_type=metadata_type,
    )
    payload = _build_snapshot_payload(
        context=context,
        metadata_type=metadata_type,
        status="success",
        result_payload=result_payload,
    )
    _persist_snapshot_payload(
        database_id,
        metadata_type=metadata_type,
        context=context,
        payload=payload,
    )
    return payload, True


def _load_or_fetch_org_units_for_context(
    *,
    database: Database,
    context: MetadataContext,
) -> list[dict[str, Any]]:
    snapshot = _load_snapshot_result(
        database.id,
        metadata_type="organisationUnits",
        context=context,
    )
    if snapshot and snapshot.get("status") == "success":
        result = snapshot.get("result")
        if isinstance(result, list):
            return result

    result_payload = _fetch_context_metadata_items(
        context=context,
        metadata_type="organisationUnits",
    )
    _persist_snapshot_payload(
        database.id,
        metadata_type="organisationUnits",
        context=context,
        payload=_build_snapshot_payload(
            context=context,
            metadata_type="organisationUnits",
            status="success",
            result_payload=result_payload,
        ),
    )
    return result_payload


def _hydrate_geo_snapshots_from_live(
    *,
    database: Database,
    context: MetadataContext,
) -> dict[str, Any]:
    org_unit_items = _load_or_fetch_org_units_for_context(
        database=database,
        context=context,
    )
    geojson_feature_collection = _fetch_context_geojson_feature_collection(
        context=context,
        org_unit_items=org_unit_items,
    )
    hierarchy_items = _build_org_unit_hierarchy_items(
        org_unit_items,
        geojson_feature_collection=geojson_feature_collection,
    )

    _persist_snapshot_payload(
        database.id,
        metadata_type=GEOJSON_METADATA_TYPE,
        context=context,
        payload=_build_snapshot_payload(
            context=context,
            metadata_type=GEOJSON_METADATA_TYPE,
            status="success",
            result_payload=geojson_feature_collection,
        ),
    )
    _persist_snapshot_payload(
        database.id,
        metadata_type=ORG_UNIT_HIERARCHY_METADATA_TYPE,
        context=context,
        payload=_build_snapshot_payload(
            context=context,
            metadata_type=ORG_UNIT_HIERARCHY_METADATA_TYPE,
            status="success",
            result_payload=hierarchy_items,
        ),
    )
    return geojson_feature_collection


def _feature_matches_parent_scope(
    feature: dict[str, Any],
    parent_ids: set[str],
) -> bool:
    if not parent_ids:
        return True
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        return False
    parent_id = str(properties.get("parentId") or properties.get("parent") or "").strip()
    if parent_id in parent_ids:
        return True
    feature_id = str(feature.get("id") or properties.get("id") or "").strip()
    if feature_id in parent_ids:
        return True
    path = str(properties.get("path") or "").strip()
    path_parts = {part for part in path.split("/") if part}
    return bool(path_parts.intersection(parent_ids))


def _filter_geojson_feature_collection(
    feature_collection: dict[str, Any],
    *,
    levels: list[str] | None = None,
    parent_ids: list[str] | None = None,
) -> dict[str, Any]:
    requested_levels = {str(level).strip() for level in levels or [] if str(level).strip()}
    requested_parents = {
        str(parent_id).strip() for parent_id in parent_ids or [] if str(parent_id).strip()
    }

    features = []
    for feature in list(feature_collection.get("features") or []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue
        if requested_levels and str(properties.get("level") or "").strip() not in requested_levels:
            continue
        if not _feature_matches_parent_scope(feature, requested_parents):
            continue
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def _tag_geojson_feature_collection(
    feature_collection: dict[str, Any],
    *,
    context: MetadataContext,
    database: Database,
) -> dict[str, Any]:
    tagged_features = []
    for feature in list(feature_collection.get("features") or []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            properties = {}
        tagged_features.append(
            {
                **feature,
                "properties": {
                    **properties,
                    "source_instance_id": context.instance_id,
                    "source_instance_name": context.instance_name,
                    "source_database_id": database.id,
                    "source_database_name": database.database_name,
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": tagged_features,
    }


def _geometry_type_to_geo_feature_type(geometry_type: str | None) -> int:
    if geometry_type == "Point":
        return 1
    if geometry_type == "MultiPolygon":
        return 3
    return 2


def _convert_geojson_to_geo_features(
    feature_collection: dict[str, Any],
) -> list[dict[str, Any]]:
    geo_features: list[dict[str, Any]] = []
    for feature in list(feature_collection.get("features") or []):
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue
        coordinates = geometry.get("coordinates")
        if not coordinates:
            continue
        geo_features.append(
            {
                "id": feature.get("id") or properties.get("id"),
                "na": properties.get("name") or properties.get("displayName"),
                "le": properties.get("level"),
                "ty": _geometry_type_to_geo_feature_type(geometry.get("type")),
                "co": json.dumps(coordinates, separators=(",", ":")),
                "pi": properties.get("parentId") or properties.get("parent"),
                "pn": properties.get("parentName"),
                "hcd": properties.get("hasChildrenWithCoordinates", False),
                "hcu": properties.get("hasParentWithCoordinates", False),
                "path": properties.get("path"),
                "source_instance_id": properties.get("source_instance_id"),
                "source_instance_name": properties.get("source_instance_name"),
                "source_database_id": properties.get("source_database_id"),
                "source_database_name": properties.get("source_database_name"),
            }
        )
    return geo_features


def _parse_geo_ou_parameter(ou_param: str | None) -> tuple[list[str], list[str]]:
    levels: list[str] = []
    parent_ids: list[str] = []
    for candidate in str(ou_param or "").split(";"):
        candidate = candidate.strip()
        if not candidate:
            continue
        upper_candidate = candidate.upper()
        if upper_candidate.startswith("OU:"):
            upper_candidate = upper_candidate[3:]
            candidate = candidate[3:]
        if upper_candidate.startswith("LEVEL-"):
            level_value = candidate.split("-", 1)[1].strip()
            if level_value:
                levels.append(level_value)
        else:
            parent_ids.append(candidate)
    return list(dict.fromkeys(levels)), list(dict.fromkeys(parent_ids))

def _get_fetch_spec(metadata_type: str) -> tuple[str, str, dict[str, Any]]:
    if metadata_type == "dataElements":
        return (
            "dataElements",
            "dataElements",
            {
                "fields": (
                    "id,displayName,name,aggregationType,valueType,domainType,"
                    "groups[id,displayName,name],"
                    "legendSet[id,displayName,name,legends[id,displayName,name,startValue,endValue,color]]"
                ),
                "paging": "false",
            },
        )
    if metadata_type == "indicators":
        return (
            "indicators",
            "indicators",
            {
                "fields": (
                    "id,displayName,name,valueType,"
                    "indicatorType[id,displayName,name],groups[id,displayName,name],"
                    "legendSet[id,displayName,name,legends[id,displayName,name,startValue,endValue,color]]"
                ),
                "paging": "false",
            },
        )
    if metadata_type == "indicatorTypes":
        return (
            "indicatorTypes",
            "indicatorTypes",
            {
                "fields": "id,displayName,name",
                "paging": "false",
            },
        )
    if metadata_type == "dataSets":
        return (
            "dataSets",
            "dataSets",
            {
                "fields": "id,displayName,formType,dataSetElements",
                "paging": "false",
            },
        )
    if metadata_type == "programIndicators":
        return (
            "programIndicators",
            "programIndicators",
            {
                "fields": (
                    "id,displayName,name,program[id,displayName,name],analyticsType"
                ),
                "paging": "false",
            },
        )
    if metadata_type == "eventDataItems":
        return (
            "eventDataItems",
            "eventDataItems",
            {
                "fields": (
                    "id,displayName,name,"
                    "programStage[id,displayName,name,program[id,displayName,name]],"
                    "dataElement[id,displayName,name,valueType,domainType,"
                    "aggregationType,groups[id,displayName,name],"
                    "legendSet[id,displayName,name,legends[id,displayName,name,startValue,endValue,color]]]"
                ),
                "paging": "false",
            },
        )
    if metadata_type == "programs":
        return (
            "programs",
            "programs",
            {
                "fields": "id,displayName,name,programType",
                "paging": "false",
            },
        )
    if metadata_type == "programStages":
        return (
            "programStages",
            "programStages",
            {
                "fields": "id,displayName,name,program[id,displayName,name]",
                "paging": "false",
            },
        )
    if metadata_type == "trackedEntityTypes":
        return (
            "trackedEntityTypes",
            "trackedEntityTypes",
            {
                "fields": "id,displayName,name",
                "paging": "false",
            },
        )
    if metadata_type in {"dataElementGroups", "indicatorGroups"}:
        return (
            metadata_type,
            metadata_type,
            {
                "fields": "id,displayName,name,members",
                "paging": "false",
            },
        )
    if metadata_type == "dataElementGroupSets":
        return (
            "dataElementGroupSets",
            "dataElementGroupSets",
            {
                "fields": "id,displayName,name,dataElementGroups[id,displayName,name]",
                "paging": "false",
            },
        )
    if metadata_type == "indicatorGroupSets":
        return (
            "indicatorGroupSets",
            "indicatorGroupSets",
            {
                "fields": "id,displayName,name,indicatorGroups[id,displayName,name]",
                "paging": "false",
            },
        )
    if metadata_type == "organisationUnits":
        # Paginated fetch — handled separately in _fetch_context_metadata_items
        return (
            "organisationUnits",
            "organisationUnits",
            {
                "fields": "id,displayName,name,level,parent[id],path",
                "pageSize": "1000",
                "order": "level:asc",
            },
        )
    if metadata_type == "organisationUnitLevels":
        return (
            "organisationUnitLevels",
            "organisationUnitLevels",
            {
                "fields": "level,displayName,name",
                "paging": "false",
            },
        )
    if metadata_type == "organisationUnitGroups":
        return (
            "organisationUnitGroups",
            "organisationUnitGroups",
            {
                # Only fetch the OU id references — full OU data comes from the
                # organisationUnits fetch. Including the full nested OU tree here
                # causes massive payloads and timeouts on large instances.
                "fields": "id,displayName,name,organisationUnits[id]",
                "paging": "false",
            },
        )
    if metadata_type == "organisationUnitGroupSets":
        return (
            "organisationUnitGroupSets",
            "organisationUnitGroupSets",
            {
                "fields": "id,displayName,name,organisationUnitGroups[id,displayName,name]",
                "paging": "false",
            },
        )
    if metadata_type == "categories":
        return (
            "categories",
            "categories",
            {
                "fields": "id,displayName,name,dataDimensionType,categoryOptions[id,displayName,name]",
                "paging": "false",
            },
        )
    if metadata_type == "categoryCombos":
        return (
            "categoryCombos",
            "categoryCombos",
            {
                "fields": "id,displayName,name,dataDimensionType,categories[id,displayName,name]",
                "paging": "false",
            },
        )
    if metadata_type == "categoryOptionCombos":
        return (
            "categoryOptionCombos",
            "categoryOptionCombos",
            {
                "fields": "id,displayName,name,categoryCombo[id,displayName,name]",
                "paging": "false",
            },
        )
    if metadata_type == LEGEND_SET_METADATA_TYPE:
        return (
            LEGEND_SET_METADATA_TYPE,
            LEGEND_SET_METADATA_TYPE,
            {
                "fields": (
                    "id,displayName,name,"
                    "legends[id,displayName,name,startValue,endValue,color]"
                ),
                "paging": "false",
            },
        )

    raise ValueError(f"Unsupported DHIS2 metadata type: {metadata_type}")


# Metadata types that can have very large record counts and need longer timeouts.
_LARGE_METADATA_TYPES = {"organisationUnits", "organisationUnitGroups", "legendSets"}
# Metadata types fetched page-by-page to avoid single-request timeouts.
_PAGINATED_METADATA_TYPES = {"organisationUnits"}
_METADATA_PAGE_SIZE = 1000


def _fetch_one_metadata_page(
    *,
    url: str,
    params: dict[str, Any],
    context: MetadataContext,
    timeout: int,
    metadata_type: str = "",
) -> dict[str, Any]:
    response = requests.get(
        url,
        params=params,
        auth=context.auth,
        headers=context.headers,
        timeout=timeout,
    )
    if response.status_code == 401:
        raise ValueError(
            "DHIS2 API authentication failed. Please check database credentials."
        )
    if response.status_code == 404 and metadata_type == "eventDataItems":
        raise UnsupportedMetadataError(
            "This DHIS2 instance does not expose event data items."
        )
    if response.status_code != 200:
        raise ValueError(
            f"DHIS2 API error: {response.status_code} {response.text[:200]}"
        )
    return response.json()


def _fetch_context_metadata_items(
    *,
    context: MetadataContext,
    metadata_type: str,
) -> list[dict[str, Any]]:
    collection_path, collection_key, params = _get_fetch_spec(metadata_type)
    url = f"{context.base_url}/{collection_path}"
    # Give large/slow metadata types a generous timeout; others keep 60s.
    timeout = 120 if metadata_type in _LARGE_METADATA_TYPES else 60

    if metadata_type in _PAGINATED_METADATA_TYPES:
        # Paginated fetch: loop through pages until no nextPage link.
        all_items: list[dict[str, Any]] = []
        page = 1
        while True:
            page_params = {**params, "page": str(page)}
            data = _fetch_one_metadata_page(
                url=url, params=page_params, context=context, timeout=timeout,
                metadata_type=metadata_type,
            )
            page_items = data.get(collection_key, [])
            all_items.extend(
                _prepare_metadata_item(metadata_type, item) for item in page_items
            )
            # Stop if we got fewer items than the page size or no pager info.
            pager = data.get("pager") or {}
            total = pager.get("total") or 0
            page_count = pager.get("pageCount") or 1
            if page >= page_count or len(page_items) < _METADATA_PAGE_SIZE or not total:
                break
            page += 1
            logger.debug(
                "_fetch_context_metadata_items: %s page %d/%d (%d items so far)",
                metadata_type,
                page - 1,
                page_count,
                len(all_items),
            )

        return sorted(
            all_items,
            key=lambda item: (
                item.get("level", 999),
                item.get("displayName", "") or item.get("name", ""),
            ),
        )

    # Non-paginated fetch (paging=false or small result sets).
    data = _fetch_one_metadata_page(
        url=url, params=params, context=context, timeout=timeout,
        metadata_type=metadata_type,
    )
    items = data.get(collection_key, [])
    return [_prepare_metadata_item(metadata_type, item) for item in items]


def _extract_id(value: Any, *path: str) -> str | None:
    current = value
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    if isinstance(current, str):
        return current
    return None


def _normalize_org_unit_source_mode(mode: str | None) -> str:
    candidate = (mode or _ORG_UNIT_SOURCE_MODE_REPOSITORY).strip().lower()
    if candidate == "federated":
        return _ORG_UNIT_SOURCE_MODE_REPOSITORY
    if candidate == _ORG_UNIT_SOURCE_MODE_PRIMARY:
        return _ORG_UNIT_SOURCE_MODE_PRIMARY
    if candidate == _ORG_UNIT_SOURCE_MODE_PER_INSTANCE:
        return _ORG_UNIT_SOURCE_MODE_PER_INSTANCE
    return _ORG_UNIT_SOURCE_MODE_REPOSITORY


def _extract_label_values(value: Any) -> list[str]:
    values: list[str] = []
    if isinstance(value, dict):
        for key in ("displayName", "name", "id"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                values.append(candidate.strip())
                break
        return values
    if isinstance(value, list):
        for item in value:
            values.extend(_extract_label_values(item))
        return values
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return values


def _coerce_float_value(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_legend_definition(item: dict[str, Any]) -> dict[str, Any] | None:
    legend_set = item.get("legendSet")
    if not isinstance(legend_set, dict):
        data_element = item.get("dataElement")
        if isinstance(data_element, dict):
            legend_set = data_element.get("legendSet")

    legend_items_raw: list[Any] = []
    if isinstance(legend_set, dict):
        legend_items_raw = list(legend_set.get("legends") or [])
    elif isinstance(item.get("legends"), list):
        legend_items_raw = list(item.get("legends") or [])

    legend_items: list[dict[str, Any]] = []
    for raw_item in legend_items_raw:
        if not isinstance(raw_item, dict):
            continue
        color = str(raw_item.get("color") or "").strip()
        if not color:
            continue

        start_value = _coerce_float_value(raw_item.get("startValue"))
        end_value = _coerce_float_value(raw_item.get("endValue"))
        if start_value is None and end_value is None:
            continue

        label = str(
            raw_item.get("displayName") or raw_item.get("name") or ""
        ).strip()
        legend_items.append(
            {
                "id": str(raw_item.get("id") or "").strip() or None,
                "label": label or None,
                "startValue": start_value,
                "endValue": end_value,
                "color": color,
            }
        )

    if not legend_items:
        return None

    legend_items.sort(
        key=lambda legend_item: (
            float("-inf")
            if legend_item.get("startValue") is None
            else float(legend_item["startValue"]),
            float("inf")
            if legend_item.get("endValue") is None
            else float(legend_item["endValue"]),
        )
    )

    min_value = next(
        (
            legend_item.get("startValue")
            for legend_item in legend_items
            if legend_item.get("startValue") is not None
        ),
        None,
    )
    max_value = next(
        (
            legend_item.get("endValue")
            for legend_item in reversed(legend_items)
            if legend_item.get("endValue") is not None
        ),
        None,
    )

    legend_set_id = None
    legend_set_name = None
    if isinstance(legend_set, dict):
        legend_set_id = str(legend_set.get("id") or "").strip() or None
        legend_set_name = str(
            legend_set.get("displayName") or legend_set.get("name") or ""
        ).strip() or None
    elif isinstance(item.get("legends"), list):
        legend_set_id = str(item.get("id") or "").strip() or None
        legend_set_name = str(
            item.get("displayName") or item.get("name") or ""
        ).strip() or None

    return {
        "source": "dhis2",
        "setId": legend_set_id,
        "setName": legend_set_name,
        "min": min_value,
        "max": max_value,
        "items": legend_items,
    }


def _dedupe_labels(labels: list[str]) -> list[str]:
    return list(dict.fromkeys(label for label in labels if label))


def _extract_group_labels(metadata_type: str, item: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    labels.extend(_extract_label_values(item.get("groupLabels")))

    if metadata_type in {"dataElements", "indicators", "dataSets"}:
        labels.extend(_extract_label_values(item.get("groups")))
    elif metadata_type == "programIndicators":
        labels.extend(_extract_label_values(item.get("program")))
        labels.extend(_extract_label_values(item.get("groups")))
    elif metadata_type == "eventDataItems":
        program_stage = item.get("programStage")
        labels.extend(_extract_label_values(program_stage))
        if isinstance(program_stage, dict):
            labels.extend(_extract_label_values(program_stage.get("program")))
        data_element = item.get("dataElement")
        if isinstance(data_element, dict):
            labels.extend(_extract_label_values(data_element.get("groups")))

    display_name = item.get("displayName") or item.get("name")
    return [
        label
        for label in _dedupe_labels(labels)
        if label and label != display_name
    ]


def _prepare_metadata_item(
    metadata_type: str,
    item: dict[str, Any],
) -> dict[str, Any]:
    prepared = dict(item)
    if metadata_type == "indicators":
        indicator_type_id = _extract_id(prepared.get("indicatorType"), "id")
        if indicator_type_id:
            prepared["indicatorTypeId"] = indicator_type_id
    elif metadata_type == "programIndicators":
        program_id = _extract_id(prepared.get("program"), "id")
        if program_id:
            prepared["programId"] = program_id
    elif metadata_type == "programStages":
        program_id = _extract_id(prepared.get("program"), "id")
        if program_id:
            prepared["programId"] = program_id
    elif metadata_type == "eventDataItems":
        program_stage_id = _extract_id(prepared.get("programStage"), "id")
        if program_stage_id:
            prepared["programStageId"] = program_stage_id
        program_id = _extract_id(prepared.get("programStage"), "program", "id")
        if program_id:
            prepared["programId"] = program_id
        data_element = prepared.get("dataElement")
        if isinstance(data_element, dict):
            for attribute in ("valueType", "domainType", "aggregationType"):
                if attribute not in prepared and data_element.get(attribute):
                    prepared[attribute] = data_element.get(attribute)
    group_labels = _extract_group_labels(metadata_type, prepared)
    if group_labels:
        prepared["groupLabels"] = group_labels
    parent_id = prepared.get("parentId") or _extract_id(prepared.get("parent"), "id")
    if parent_id:
        prepared["parentId"] = parent_id
    legend_definition = _normalize_legend_definition(prepared)
    if legend_definition is not None:
        prepared["legendDefinition"] = legend_definition
    return prepared


def _extract_group_ids(value: Any) -> set[str]:
    group_ids: set[str] = set()
    if isinstance(value, dict):
        candidate = value.get("id")
        if isinstance(candidate, str) and candidate.strip():
            group_ids.add(candidate.strip())
        return group_ids
    if isinstance(value, list):
        for item in value:
            group_ids.update(_extract_group_ids(item))
    return group_ids


def _candidate_group_ids(item: dict[str, Any], metadata_type: str) -> set[str]:
    if metadata_type in {"dataElements", "indicators", "dataSets", "programIndicators"}:
        return _extract_group_ids(item.get("groups"))
    if metadata_type == "eventDataItems":
        data_element = item.get("dataElement")
        if isinstance(data_element, dict):
            return _extract_group_ids(data_element.get("groups"))
    return set()


def _group_set_metadata_type(metadata_type: str) -> str | None:
    if metadata_type in {"dataElements", "eventDataItems"}:
        return "dataElementGroupSets"
    if metadata_type == "indicators":
        return "indicatorGroupSets"
    return None


def _group_metadata_type(metadata_type: str) -> str | None:
    if metadata_type in {"dataElements", "eventDataItems"}:
        return "dataElementGroups"
    if metadata_type == "indicators":
        return "indicatorGroups"
    return None


def _group_set_members_key(metadata_type: str) -> str | None:
    if metadata_type in {"dataElements", "eventDataItems"}:
        return "dataElementGroups"
    if metadata_type == "indicators":
        return "indicatorGroups"
    return None


def _resolve_group_set_group_ids(
    *,
    database: Database,
    context: MetadataContext,
    metadata_type: str,
    group_set_id: str,
) -> set[str] | None:
    group_set_metadata_type = _group_set_metadata_type(metadata_type)
    members_key = _group_set_members_key(metadata_type)
    if group_set_metadata_type is None or members_key is None:
        return None

    snapshot = metadata_cache_service.get_cached_metadata_payload(
        database.id,
        _snapshot_namespace(group_set_metadata_type),
        _snapshot_key_parts(context.instance_id),
    )
    if snapshot is None or snapshot.get("status") != "success":
        return None

    for group_set in list(snapshot.get("result") or []):
        if str(group_set.get("id") or "") != group_set_id:
            continue
        return _extract_group_ids(group_set.get(members_key))
    return set()


def _resolve_group_filter_labels(
    *,
    database: Database,
    context: MetadataContext,
    metadata_type: str,
    group_id: str,
) -> set[str] | None:
    group_metadata_type = _group_metadata_type(metadata_type)
    if group_metadata_type is None:
        return None

    snapshot = metadata_cache_service.get_cached_metadata_payload(
        database.id,
        _snapshot_namespace(group_metadata_type),
        _snapshot_key_parts(context.instance_id),
    )
    if snapshot is None or snapshot.get("status") != "success":
        return None

    for group in list(snapshot.get("result") or []):
        if str(group.get("id") or "") != group_id:
            continue
        return {
            label.strip().lower()
            for label in _extract_label_values(group)
            if isinstance(label, str) and label.strip()
        }
    return set()


def _matches_group_filter(
    item: dict[str, Any],
    metadata_type: str,
    group_id: str,
    group_filter_labels: set[str] | None,
) -> bool:
    candidate_group_ids = _candidate_group_ids(item, metadata_type)
    if group_id in candidate_group_ids:
        return True
    if not group_filter_labels:
        return False
    candidate_group_labels = {
        label.strip().lower()
        for label in _extract_group_labels(metadata_type, item)
        if isinstance(label, str) and label.strip()
    }
    return bool(candidate_group_labels.intersection(group_filter_labels))


def _matches_search(item: dict[str, Any], search_term: str) -> bool:
    if not search_term:
        return True

    if _SEARCH_ID_RE.match(search_term):
        return item.get("id") == search_term

    haystacks = [
        str(item.get("displayName") or ""),
        str(item.get("name") or ""),
        str(item.get("id") or ""),
    ]
    search_lower = search_term.lower()
    return any(search_lower in haystack.lower() for haystack in haystacks)


def _matches_group_search(
    item: dict[str, Any],
    metadata_type: str,
    group_search: str,
) -> bool:
    if not group_search:
        return True

    search_lower = group_search.lower()
    haystacks = _extract_label_values(item.get("groupLabels"))
    if metadata_type == "programIndicators":
        haystacks.extend(_extract_label_values(item.get("program")))
    elif metadata_type == "eventDataItems":
        program_stage = item.get("programStage")
        haystacks.extend(_extract_label_values(program_stage))
        if isinstance(program_stage, dict):
            haystacks.extend(_extract_label_values(program_stage.get("program")))
        data_element = item.get("dataElement")
        if isinstance(data_element, dict):
            haystacks.extend(_extract_label_values(data_element.get("groups")))

    return any(search_lower in haystack.lower() for haystack in haystacks)


def filter_metadata_items(
    *,
    metadata_type: str,
    items: list[dict[str, Any]],
    table_name: str | None = None,
    search_term: str = "",
    level: str | None = None,
    parent_ids: list[str] | None = None,
    domain_type: str | None = None,
    value_type: str | None = None,
    aggregation_type: str | None = None,
    form_type: str | None = None,
    program_id: str | None = None,
    program_stage_id: str | None = None,
    indicator_type_id: str | None = None,
    analytics_type: str | None = None,
    group_id: str | None = None,
    group_filter_labels: set[str] | None = None,
    group_set_group_ids: set[str] | None = None,
    group_search: str = "",
) -> list[dict[str, Any]]:
    parent_ids = parent_ids or []
    filtered: list[dict[str, Any]] = []

    for item in items:
        candidate = _prepare_metadata_item(metadata_type, item)

        if metadata_type == "dataElements":
            if domain_type and candidate.get("domainType") != domain_type:
                continue
            if value_type and candidate.get("valueType") != value_type:
                continue
            if aggregation_type and candidate.get("aggregationType") != aggregation_type:
                continue
            if group_id and not _matches_group_filter(
                candidate,
                metadata_type,
                group_id,
                group_filter_labels,
            ):
                continue
            if group_set_group_ids is not None and not (
                _candidate_group_ids(candidate, metadata_type) & group_set_group_ids
            ):
                continue
            if (
                table_name == "analytics"
                and candidate.get("valueType") not in _ANALYTICS_NUMERIC_TYPES
            ):
                continue
            if table_name == "events" and candidate.get("domainType") != "TRACKER":
                continue
        elif metadata_type == "indicators":
            if value_type and candidate.get("valueType") != value_type:
                continue
            if indicator_type_id and candidate.get("indicatorTypeId") != indicator_type_id:
                continue
            if group_id and not _matches_group_filter(
                candidate,
                metadata_type,
                group_id,
                group_filter_labels,
            ):
                continue
            if group_set_group_ids is not None and not (
                _candidate_group_ids(candidate, metadata_type) & group_set_group_ids
            ):
                continue
        elif metadata_type == "dataSets":
            if form_type and candidate.get("formType") != form_type:
                continue
        elif metadata_type == "programIndicators":
            if program_id and _extract_id(candidate.get("program"), "id") != program_id:
                continue
            if analytics_type and candidate.get("analyticsType") != analytics_type:
                continue
        elif metadata_type == "eventDataItems":
            if (
                program_id
                and _extract_id(candidate.get("programStage"), "program", "id")
                != program_id
            ):
                continue
            if program_stage_id and candidate.get("programStageId") != program_stage_id:
                continue
            if value_type and candidate.get("valueType") != value_type:
                continue
            if domain_type and candidate.get("domainType") != domain_type:
                continue
            if group_id and not _matches_group_filter(
                candidate,
                metadata_type,
                group_id,
                group_filter_labels,
            ):
                continue
            if group_set_group_ids is not None and not (
                _candidate_group_ids(candidate, metadata_type) & group_set_group_ids
            ):
                continue
        elif metadata_type == "organisationUnits":
            if level and str(candidate.get("level")) != str(level):
                continue
            parent_id = candidate.get("parentId") or _extract_id(
                candidate.get("parent"), "id"
            )
            if parent_ids and parent_id not in set(parent_ids):
                continue

        if not _matches_search(candidate, search_term):
            continue

        if not _matches_group_search(candidate, metadata_type, group_search):
            continue

        filtered.append(candidate)

    if metadata_type == "organisationUnits":
        filtered.sort(
            key=lambda item: (
                item.get("level", 999),
                item.get("displayName", "") or item.get("name", ""),
            ),
        )

    if metadata_type == "dataElements" and table_name == "analytics":
        for item in filtered:
            agg_type = item.get("aggregationType", "NONE")
            value = item.get("valueType", "TEXT")
            item["category"] = "Aggregatable Data Elements"
            item["typeInfo"] = f"{value} ({agg_type})"

    max_items = len(filtered) if search_term else 5000
    return filtered[:max_items]


def _tag_items(
    items: list[dict[str, Any]],
    *,
    context: MetadataContext,
    database: Database,
) -> list[dict[str, Any]]:
    return [
        {
            **item,
            "source_instance_id": context.instance_id,
            "source_instance_name": context.instance_name,
            "source_database_id": database.id,
            "source_database_name": database.database_name,
        }
        for item in items
    ]


def _merge_org_unit_level_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return merge_org_unit_level_items(items)


def _merge_org_unit_group_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for item in items:
        key = str(item.get("id") or item.get("displayName") or item.get("name") or "")
        if not key:
            continue

        current = merged.get(key)
        if current is None:
            current = dict(item)
            current["organisationUnits"] = []
            merged[key] = current

        if not current.get("displayName") and item.get("displayName"):
            current["displayName"] = item["displayName"]
        if not current.get("name") and item.get("name"):
            current["name"] = item["name"]

        existing_units = {
            str(unit.get("id") or unit.get("displayName") or unit.get("name") or ""): unit
            for unit in current.get("organisationUnits", [])
            if isinstance(unit, dict)
        }
        for unit in item.get("organisationUnits", []) or []:
            if not isinstance(unit, dict):
                continue
            unit_key = str(unit.get("id") or unit.get("displayName") or unit.get("name") or "")
            if unit_key and unit_key not in existing_units:
                existing_units[unit_key] = unit
        current["organisationUnits"] = list(existing_units.values())

    return sorted(
        merged.values(),
        key=lambda item: (
            item.get("displayName", "") or item.get("name", ""),
            str(item.get("id", "")),
        ),
    )


def _merge_payload_items(
    metadata_type: str,
    items: list[dict[str, Any]],
    *,
    org_unit_source_mode: str | None = None,
) -> list[dict[str, Any]]:
    normalized_mode = _normalize_org_unit_source_mode(org_unit_source_mode)
    if normalized_mode == _ORG_UNIT_SOURCE_MODE_PER_INSTANCE:
        return items
    if metadata_type == "organisationUnitLevels":
        return _merge_org_unit_level_items(items)
    if metadata_type == "organisationUnitGroups":
        return _merge_org_unit_group_items(items)
    return items


def refresh_database_metadata(
    database_id: int,
    *,
    instance_ids: Iterable[int] | None = None,
    metadata_types: Iterable[str] | None = None,
    reason: str | None = None,
    job_id: int | None = None,
) -> dict[str, Any]:
    from superset.dhis2.models import DHIS2MetadataJob

    database = db.session.get(Database, database_id)
    if database is None:
        raise ValueError(f"Database with id={database_id} not found")
    if database.backend != "dhis2":
        raise ValueError(f"Database id={database_id} is not a DHIS2 database")

    ensure_source_for_database(database_id)

    requested_instance_ids = list(dict.fromkeys(instance_ids or []))
    if not requested_instance_ids:
        from superset.dhis2 import instance_service as inst_svc

        requested_instance_ids = [
            instance.id
            for instance in inst_svc.get_instances_with_legacy_fallback(
                database_id,
                include_inactive=False,
            )
            if getattr(instance, "id", None) is not None
        ]
    contexts = _resolve_staged_contexts(
        database,
        requested_instance_ids=requested_instance_ids,
        federated=bool(requested_instance_ids),
    )
    active_metadata_types = _normalize_metadata_types(metadata_types)

    # Update persistent job record to running state
    _meta_job: DHIS2MetadataJob | None = None
    if job_id is not None:
        _meta_job = db.session.get(DHIS2MetadataJob, job_id)
        if _meta_job is not None:
            _meta_job.status = "running"
            _meta_job.started_at = datetime.utcnow()
            db.session.commit()

    summary: dict[str, Any] = {
        "database_id": database_id,
        "reason": reason,
        "metadata_types": active_metadata_types,
        "instance_results": [],
    }
    progress_state = _build_refresh_progress_state(
        database_id=database_id,
        contexts=contexts,
        metadata_types=active_metadata_types,
        reason=reason,
        status="running",
    )
    _persist_refresh_progress(database_id, progress_state)

    total_loaded = 0
    total_failed = 0

    for context in contexts:
        # Check for cancellation before processing each instance
        if _meta_job is not None:
            db.session.refresh(_meta_job)
            if _meta_job.cancel_requested:
                logger.info(
                    "metadata_refresh: cancel requested for job_id=%s, aborting.", job_id
                )
                progress_state["status"] = "cancelled"
                progress_state["updated_at"] = datetime.utcnow().isoformat()
                _persist_refresh_progress(database_id, progress_state)
                _meta_job.status = "cancelled"
                _meta_job.completed_at = datetime.utcnow()
                _meta_job.error_message = "Cancelled by user"
                _meta_job.rows_loaded = total_loaded
                _meta_job.rows_failed = total_failed
                db.session.commit()
                return summary
        context_results: dict[str, list[dict[str, Any]] | dict[str, Any]] = {}
        instance_result = {
            "instance_id": context.instance_id,
            "instance_name": context.instance_name,
            "metadata": {},
        }
        for metadata_type in active_metadata_types:
            try:
                if metadata_type == GEOJSON_METADATA_TYPE:
                    org_unit_items = context_results.get("organisationUnits")
                    if not isinstance(org_unit_items, list):
                        # Fetch org units so _should_fallback_to_geo_features can
                        # detect incomplete geojson and trigger per-level fallback.
                        org_unit_items = _fetch_context_metadata_items(
                            context=context,
                            metadata_type="organisationUnits",
                        )
                        context_results["organisationUnits"] = org_unit_items
                    result_payload = _fetch_context_geojson_feature_collection(
                        context=context,
                        org_unit_items=org_unit_items,
                    )
                    count = len(list(result_payload.get("features") or []))
                elif metadata_type == ORG_UNIT_HIERARCHY_METADATA_TYPE:
                    org_unit_items = context_results.get("organisationUnits")
                    if not isinstance(org_unit_items, list):
                        org_unit_items = _fetch_context_metadata_items(
                            context=context,
                            metadata_type="organisationUnits",
                        )
                        context_results["organisationUnits"] = org_unit_items
                    geojson_feature_collection = context_results.get(GEOJSON_METADATA_TYPE)
                    if not isinstance(geojson_feature_collection, dict):
                        geojson_feature_collection = _fetch_context_geojson_feature_collection(
                            context=context,
                            org_unit_items=org_unit_items,
                        )
                        context_results[GEOJSON_METADATA_TYPE] = geojson_feature_collection
                    result_payload = _build_org_unit_hierarchy_items(
                        org_unit_items,
                        geojson_feature_collection=geojson_feature_collection,
                    )
                    count = len(result_payload)
                else:
                    result_payload = _fetch_context_metadata_items(
                        context=context,
                        metadata_type=metadata_type,
                    )
                    count = len(result_payload)

                context_results[metadata_type] = result_payload
                payload = {
                    "status": "success",
                    "result": result_payload,
                    "message": None,
                    "instance_id": context.instance_id,
                    "instance_name": context.instance_name,
                    "metadata_type": metadata_type,
                    "count": count,
                }
                instance_result["metadata"][metadata_type] = {
                    "status": "success",
                    "count": count,
                }
                progress_state = _update_refresh_progress(
                    progress_state,
                    context=context,
                    metadata_type=metadata_type,
                    count=count,
                    success=True,
                )
            except UnsupportedMetadataError as ex:
                logger.info(
                    "Skipping unsupported DHIS2 metadata type=%s for database id=%s instance=%s: %s",
                    metadata_type,
                    database_id,
                    context.instance_id,
                    ex,
                )
                payload = {
                    "status": "unsupported",
                    "result": [],
                    "message": str(ex),
                    "instance_id": context.instance_id,
                    "instance_name": context.instance_name,
                    "metadata_type": metadata_type,
                    "count": 0,
                }
                instance_result["metadata"][metadata_type] = {
                    "status": "unsupported",
                    "count": 0,
                    "message": str(ex),
                }
                progress_state = _update_refresh_progress(
                    progress_state,
                    context=context,
                    metadata_type=metadata_type,
                    count=0,
                    success=True,
                )
            except Exception as ex:  # pylint: disable=broad-except
                logger.warning(
                    "Failed to stage DHIS2 metadata type=%s for database id=%s instance=%s",
                    metadata_type,
                    database_id,
                    context.instance_id,
                    exc_info=True,
                )
                payload = {
                    "status": "failed",
                    "result": [],
                    "message": str(ex),
                    "instance_id": context.instance_id,
                    "instance_name": context.instance_name,
                    "metadata_type": metadata_type,
                    "count": 0,
                }
                instance_result["metadata"][metadata_type] = {
                    "status": "failed",
                    "count": 0,
                    "error": str(ex),
                }
                progress_state = _update_refresh_progress(
                    progress_state,
                    context=context,
                    metadata_type=metadata_type,
                    count=0,
                    success=False,
                    error=str(ex),
                )

            metadata_cache_service.set_cached_metadata_payload(
                database_id,
                _snapshot_namespace(metadata_type),
                _snapshot_key_parts(context.instance_id),
                payload,
                ttl_seconds=None,
            )
            # Accumulate counts
            _type_result = instance_result["metadata"].get(metadata_type, {})
            if _type_result.get("status") == "failed":
                total_failed += 1
            else:
                total_loaded += _type_result.get("count", 0)

            _persist_refresh_progress(database_id, progress_state)

            # Update DB job with latest counts while running (for UI polling)
            if _meta_job is not None:
                _meta_job.rows_loaded = total_loaded
                _meta_job.rows_failed = total_failed
                db.session.commit()

        summary["instance_results"].append(instance_result)

    metadata_cache_service.clear_cached_metadata_prefix(
        database_id,
        namespace_prefix="dhis2_metadata:",
    )

    # Determine final status
    if progress_state.get("status") == "running":
        if total_failed > 0 and total_loaded == 0:
            final_status = "failed"
        elif total_failed > 0:
            final_status = "partial"
        else:
            final_status = "complete"
        progress_state["status"] = final_status
        progress_state["completed_at"] = datetime.utcnow().isoformat()
        progress_state["updated_at"] = progress_state["completed_at"]
        _persist_refresh_progress(database_id, progress_state)

    # Finalize persistent job record
    if _meta_job is not None:
        _meta_job.status = progress_state.get("status", "complete")
        _meta_job.completed_at = datetime.utcnow()
        _meta_job.rows_loaded = total_loaded
        _meta_job.rows_failed = total_failed
        _meta_job.instance_results = json.dumps(
            {
                str(r["instance_id"]): r.get("metadata", {})
                for r in summary["instance_results"]
            }
        )
        db.session.commit()

    return summary


def refresh_all_dhis2_metadata(
    *,
    metadata_types: Iterable[str] | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    background_metadata_types = get_background_metadata_types(metadata_types)
    databases = [
        database
        for database in db.session.query(Database).all()
        if database.backend == "dhis2"
    ]

    results = []
    for database in databases:
        try:
            results.append(
                refresh_database_metadata(
                    database.id,
                    metadata_types=background_metadata_types,
                    reason=reason or "scheduled_refresh",
                )
            )
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Failed scheduled DHIS2 metadata refresh for database id=%s",
                database.id,
                exc_info=True,
            )

    return {
        "database_count": len(databases),
        "results": results,
    }


def schedule_database_metadata_refresh(
    database_id: int,
    *,
    instance_ids: Iterable[int] | None = None,
    metadata_types: Iterable[str] | None = None,
    reason: str | None = None,
    job_type: str = "manual",
    continuation_metadata_types: Iterable[str] | None = None,
) -> dict[str, Any]:
    from superset.dhis2.models import DHIS2MetadataJob

    requested_instance_ids = list(dict.fromkeys(instance_ids or []))
    active_metadata_types = list(dict.fromkeys(metadata_types or SUPPORTED_METADATA_TYPES))
    active_continuation_types = (
        [t for t in continuation_metadata_types if t in SUPPORTED_METADATA_TYPES]
        if continuation_metadata_types
        else []
    )
    queue_metadata_refresh_progress(
        database_id,
        instance_ids=requested_instance_ids,
        metadata_types=active_metadata_types,
        reason=reason,
    )

    # Create persistent job record
    meta_job = DHIS2MetadataJob(
        database_id=database_id,
        job_type=job_type,
        status="queued",
        instance_ids=json.dumps(requested_instance_ids) if requested_instance_ids else None,
        metadata_types=json.dumps(active_metadata_types),
        reason=reason,
    )
    db.session.add(meta_job)
    db.session.flush()  # get id before dispatch
    job_id = meta_job.id

    if _celery_workers_available():
        try:
            from superset.tasks.dhis2_metadata import refresh_dhis2_metadata

            task = refresh_dhis2_metadata.apply_async(
                kwargs=dict(
                    database_id=database_id,
                    instance_ids=requested_instance_ids,
                    metadata_types=active_metadata_types,
                    reason=reason,
                    job_id=job_id,
                    continuation_metadata_types=active_continuation_types or None,
                )
            )
            task_id = getattr(task, "id", None)
            meta_job.task_id = task_id
            db.session.commit()
            return {
                "scheduled": True,
                "mode": "celery",
                "task_id": task_id,
                "job_id": job_id,
            }
        except Exception:  # pylint: disable=broad-except
            logger.info(
                "Celery metadata refresh dispatch failed for database id=%s, falling back to thread",
                database_id,
                exc_info=True,
            )
    else:
        logger.info(
            "No Celery workers available for database id=%s, using thread fallback",
            database_id,
        )

    _flask_app = current_app._get_current_object() if has_app_context() else None

    def _run() -> None:
        def _do_run() -> None:
            try:
                result = refresh_database_metadata(
                    database_id,
                    instance_ids=requested_instance_ids,
                    metadata_types=active_metadata_types,
                    reason=reason or "thread_fallback",
                    job_id=job_id,
                )
                if active_continuation_types and result.get("status") not in (
                    "failed",
                    "cancelled",
                ):
                    try:
                        schedule_database_metadata_refresh(
                            database_id,
                            instance_ids=requested_instance_ids,
                            metadata_types=active_continuation_types,
                            reason="initial_setup_phase2",
                            job_type="scheduled",
                        )
                    except Exception:  # pylint: disable=broad-except
                        logger.warning(
                            "Failed to dispatch thread phase-2 continuation for database_id=%s",
                            database_id,
                            exc_info=True,
                        )
            except Exception:  # pylint: disable=broad-except
                logger.warning(
                    "Thread fallback metadata refresh failed for database id=%s",
                    database_id,
                    exc_info=True,
                )

        if _flask_app is not None:
            with _flask_app.app_context():
                _do_run()
        else:
            _do_run()

    meta_job.status = "running"
    db.session.commit()

    thread = threading.Timer(_BACKGROUND_REFRESH_DELAY_SECONDS, _run)
    thread.daemon = True
    thread.start()
    return {
        "scheduled": True,
        "mode": "thread",
        "task_id": None,
        "job_id": job_id,
    }


def schedule_database_metadata_refresh_after_commit(
    database_id: int,
    *,
    instance_ids: Iterable[int] | None = None,
    metadata_types: Iterable[str] | None = None,
    reason: str | None = None,
) -> None:
    requested_instance_ids = list(dict.fromkeys(instance_ids or []))
    active_metadata_types = list(dict.fromkeys(metadata_types or SUPPORTED_METADATA_TYPES))
    session = db.session()

    def _fire() -> None:
        schedule_database_metadata_refresh(
            database_id,
            instance_ids=requested_instance_ids,
            metadata_types=active_metadata_types,
            reason=reason,
        )

    def _remove_listener(event_name: str, callback: Any) -> None:
        try:
            event.remove(session, event_name, callback)
        except Exception:  # pylint: disable=broad-except
            pass

    def _after_commit(_session: Any) -> None:
        try:
            _fire()
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Deferred DHIS2 metadata scheduling failed for database id=%s",
                database_id,
                exc_info=True,
            )
        finally:
            _remove_listener("after_rollback", _after_rollback)

    def _after_rollback(_session: Any) -> None:
        _remove_listener("after_commit", _after_commit)

    event.listen(session, "after_commit", _after_commit, once=True)
    event.listen(session, "after_rollback", _after_rollback, once=True)


def get_staged_geo_payload(
    *,
    database: Database,
    metadata_type: str,
    instance_id: int | None = None,
    requested_instance_ids: list[int] | None = None,
    federated: bool = False,
    levels: list[str] | None = None,
    parent_ids: list[str] | None = None,
    allow_live_fallback: bool = False,
) -> dict[str, Any]:
    requested_instance_ids = requested_instance_ids or []
    parent_ids = parent_ids or []

    # Snapshots are stored against the DHIS2 source database, not the DuckDB
    # serving database.  Resolve the effective database for both context
    # resolution and snapshot/schedule lookups.
    uri = str(getattr(database, "sqlalchemy_uri_decrypted", None) or "")
    if uri.startswith("duckdb://"):
        source_db = _resolve_dhis2_source_database(database, requested_instance_ids)
        if source_db is not None:
            database = source_db

    contexts = _resolve_staged_contexts(
        database,
        instance_id=instance_id,
        requested_instance_ids=requested_instance_ids,
        federated=federated,
    )

    if not contexts:
        schedule_database_metadata_refresh(
            database.id,
            instance_ids=requested_instance_ids,
            metadata_types=[GEOJSON_METADATA_TYPE, ORG_UNIT_HIERARCHY_METADATA_TYPE],
            reason=f"staged_request:{metadata_type}",
        )
        empty_result: Any = [] if metadata_type == "geoFeatures" else {
            "type": "FeatureCollection",
            "features": [],
        }
        return {
            "status": "pending",
            "result": empty_result,
            "instance_results": [],
            "message": "DHIS2 boundaries are being prepared in local staging.",
            "staged": True,
            "retry_after_ms": 8000,
        }

    merged_collection = {"type": "FeatureCollection", "features": []}
    instance_results: list[dict[str, Any]] = []
    success_count = 0
    pending_count = 0
    failed_count = 0
    refresh_instance_ids: list[int] = []

    for context in contexts:
        loaded_via_live_fallback = False
        snapshot = _load_snapshot_result(
            database.id,
            metadata_type=GEOJSON_METADATA_TYPE,
            context=context,
        )
        snapshot_status = (
            snapshot.get("status") if isinstance(snapshot, dict) else None
        ) or ("pending" if snapshot is None else "success")
        if snapshot_status == "unsupported":
            success_count += 1
            instance_results.append(
                {
                    "id": context.instance_id,
                    "name": context.instance_name,
                    "status": "success",
                    "count": 0,
                    "warning": snapshot.get("message"),
                    "load_source": "staged",
                }
            )
            continue
        if snapshot_status != "success":
            # Schedule async background refresh and return pending immediately.
            # Do NOT call _hydrate_geo_snapshots_from_live synchronously — it
            # hits the live DHIS2 API and can take 2-3 minutes, blocking the
            # HTTP request and making the map appear hung.
            response_status = "failed" if snapshot_status == "failed" else "pending"
            if response_status == "pending":
                pending_count += 1
            else:
                failed_count += 1
            if context.instance_id is not None:
                refresh_instance_ids.append(context.instance_id)
            instance_results.append(
                {
                    "id": context.instance_id,
                    "name": context.instance_name,
                    "status": response_status,
                    "count": int((snapshot or {}).get("count") or 0)
                    if isinstance(snapshot, dict)
                    else 0,
                    "error": (
                        (snapshot or {}).get("message")
                        if isinstance(snapshot, dict)
                        else None
                    )
                    or "Boundary snapshot not ready yet.",
                    "retry_after_ms": 8000,
                }
            )
            continue

        raw_collection = snapshot.get("result")
        if not isinstance(raw_collection, dict):
            raw_collection = {"type": "FeatureCollection", "features": []}
        if not _geojson_feature_collection_supports_levels(raw_collection, levels):
            # Snapshot exists but doesn't cover the requested levels — schedule
            # an async refresh and serve what we have rather than blocking on a
            # live DHIS2 fetch.
            if context.instance_id is not None:
                refresh_instance_ids.append(context.instance_id)
            logger.info(
                "Boundary snapshot for database id=%s instance=%s does not cover "
                "requested levels %s; serving existing snapshot and queuing refresh.",
                database.id,
                context.instance_id,
                levels,
            )
        filtered_collection = _filter_geojson_feature_collection(
            raw_collection,
            levels=levels,
            parent_ids=parent_ids,
        )
        tagged_collection = _tag_geojson_feature_collection(
            filtered_collection,
            context=context,
            database=database,
        )
        feature_count = len(list(tagged_collection.get("features") or []))
        success_count += 1
        instance_results.append(
            {
                "id": context.instance_id,
                "name": context.instance_name,
                "status": "success",
                "count": feature_count,
                "load_source": (
                    "live_fallback" if loaded_via_live_fallback else "staged"
                ),
            }
        )
        merged_collection["features"].extend(list(tagged_collection.get("features") or []))

    if refresh_instance_ids:
        schedule_database_metadata_refresh(
            database.id,
            instance_ids=list(dict.fromkeys(refresh_instance_ids)),
            metadata_types=[GEOJSON_METADATA_TYPE, ORG_UNIT_HIERARCHY_METADATA_TYPE],
            reason=f"staged_request:{metadata_type}",
        )

    status = "failed"
    if success_count == len(contexts):
        status = "success"
    elif success_count > 0:
        status = "partial"
    elif pending_count > 0:
        status = "pending"

    message = None
    if status == "pending":
        message = (
            "DHIS2 boundaries are being prepared in local staging. Retry shortly or "
            "inspect the DHIS2 admin pages for connection diagnostics."
        )
    elif status == "partial":
        if failed_count:
            message = (
                "Some configured DHIS2 connections are unavailable in local staging. "
                "Available staged boundaries are shown below."
            )
        else:
            message = (
                "Some configured DHIS2 connections are still being staged. Available "
                "staged boundaries are shown below."
            )
    elif status == "failed":
        message = (
            "Failed to load staged DHIS2 boundaries. Retry here or inspect the DHIS2 "
            "admin pages for more diagnostics."
        )

    result: Any
    if metadata_type == "geoFeatures":
        result = _convert_geojson_to_geo_features(merged_collection)
    else:
        result = merged_collection

    return {
        "status": status,
        "result": result,
        "instance_results": instance_results,
        "message": message,
        "staged": True,
        "retry_after_ms": 8000 if status in ("pending", "partial") else None,
        "count": (
            len(result)
            if isinstance(result, list)
            else len(list(merged_collection.get("features") or []))
        ),
    }


def get_staged_metadata_payload(
    *,
    database: Database,
    metadata_type: str,
    instance_id: int | None = None,
    requested_instance_ids: list[int] | None = None,
    federated: bool = False,
    table_name: str | None = None,
    search_term: str = "",
    level: str | None = None,
    parent_ids: list[str] | None = None,
    domain_type: str | None = None,
    value_type: str | None = None,
    aggregation_type: str | None = None,
    form_type: str | None = None,
    program_id: str | None = None,
    program_stage_id: str | None = None,
    indicator_type_id: str | None = None,
    analytics_type: str | None = None,
    group_id: str | None = None,
    group_set_id: str | None = None,
    group_search: str = "",
    org_unit_source_mode: str | None = None,
    page: int | None = None,
    page_size: int | None = None,
) -> dict[str, Any]:
    requested_instance_ids = requested_instance_ids or []
    parent_ids = parent_ids or []
    normalized_org_unit_source_mode = _normalize_org_unit_source_mode(
        org_unit_source_mode
    )
    refresh_progress = get_metadata_refresh_progress(database.id)
    progress_family = _progress_family_for_metadata_type(metadata_type)
    contexts = _resolve_staged_contexts(
        database,
        instance_id=instance_id,
        requested_instance_ids=requested_instance_ids,
        federated=federated,
    )

    if not contexts:
        schedule_database_metadata_refresh(
            database.id,
            instance_ids=requested_instance_ids,
            metadata_types=[metadata_type],
            reason=f"staged_request:{metadata_type}",
        )
        return {
            "status": "pending",
            "result": [],
            "instance_results": [],
            "message": "DHIS2 metadata is being prepared in local staging.",
            "staged": True,
            "progress": (
                refresh_progress.get(progress_family)
                if refresh_progress and progress_family
                else None
            ),
        }

    aggregated_items: list[dict[str, Any]] = []
    instance_results: list[dict[str, Any]] = []
    success_count = 0
    pending_count = 0
    failed_count = 0
    refresh_needed = False

    for context in contexts:
        loaded_via_live_fallback = False
        fallback_error: str | None = None
        snapshot = metadata_cache_service.get_cached_metadata_payload(
            database.id,
            _snapshot_namespace(metadata_type),
            _snapshot_key_parts(context.instance_id),
        )
        snapshot_status = (
            snapshot.get("status") if isinstance(snapshot, dict) else None
        ) or ("pending" if snapshot is None else "success")

        # Legend sets back map/chart styling controls. If staged cache is
        # missing or stale-failed, rehydrate directly from DHIS2 once and
        # persist the snapshot so subsequent chart editing stays local.
        if metadata_type == LEGEND_SET_METADATA_TYPE and snapshot_status in {
            None,
            "pending",
            "failed",
        }:
            try:
                snapshot, loaded_via_live_fallback = (
                    _load_or_fetch_metadata_snapshot_for_context(
                        database_id=database.id,
                        metadata_type=metadata_type,
                        context=context,
                    )
                )
                snapshot_status = (
                    snapshot.get("status") if isinstance(snapshot, dict) else None
                ) or "success"
            except Exception as ex:  # pylint: disable=broad-except
                fallback_error = str(ex)
                logger.warning(
                    "Failed staged legend-set rehydrate for database id=%s instance=%s",
                    database.id,
                    context.instance_id,
                    exc_info=True,
                )

        if snapshot is None:
            pending_count += 1
            refresh_needed = True
            instance_results.append(
                {
                    "id": context.instance_id,
                    "name": context.instance_name,
                    "status": "pending",
                    "count": 0,
                    "error": "Metadata snapshot not ready yet.",
                }
            )
            continue

        if snapshot_status == "unsupported":
            success_count += 1
            instance_results.append(
                {
                    "id": context.instance_id,
                    "name": context.instance_name,
                    "status": "success",
                    "count": 0,
                    "warning": snapshot.get("message"),
                }
            )
            continue
        if snapshot_status != "success":
            if snapshot_status == "pending":
                pending_count += 1
            else:
                failed_count += 1
            refresh_needed = True
            instance_results.append(
                {
                    "id": context.instance_id,
                    "name": context.instance_name,
                    "status": "failed" if snapshot_status == "failed" else "pending",
                    "count": int(snapshot.get("count") or 0),
                    "error": fallback_error or snapshot.get("message"),
                }
            )
            continue

        group_set_group_ids = None
        if group_set_id:
            group_set_group_ids = _resolve_group_set_group_ids(
                database=database,
                context=context,
                metadata_type=metadata_type,
                group_set_id=group_set_id,
            )
        group_filter_labels = None
        if group_id:
            group_filter_labels = _resolve_group_filter_labels(
                database=database,
                context=context,
                metadata_type=metadata_type,
                group_id=group_id,
            )

        items = filter_metadata_items(
            metadata_type=metadata_type,
            items=list(snapshot.get("result") or []),
            table_name=table_name,
            search_term=search_term,
            level=level,
            parent_ids=parent_ids,
            domain_type=domain_type,
            value_type=value_type,
            aggregation_type=aggregation_type,
            form_type=form_type,
            program_id=program_id,
            program_stage_id=program_stage_id,
            indicator_type_id=indicator_type_id,
            analytics_type=analytics_type,
            group_id=group_id,
            group_filter_labels=group_filter_labels,
            group_set_group_ids=group_set_group_ids,
            group_search=group_search,
        )
        success_count += 1
        instance_results.append(
            {
                "id": context.instance_id,
                "name": context.instance_name,
                "status": "success",
                "count": len(items),
                **(
                    {"load_source": "live_fallback"}
                    if loaded_via_live_fallback
                    else {}
                ),
            }
        )
        if federated or requested_instance_ids:
            aggregated_items.extend(
                _tag_items(items, context=context, database=database)
            )
        else:
            aggregated_items.extend(items)

    if refresh_needed:
        schedule_database_metadata_refresh(
            database.id,
            instance_ids=[result["id"] for result in instance_results if result["id"] is not None],
            metadata_types=[metadata_type],
            reason=f"staged_request:{metadata_type}",
        )

    status = "failed"
    if success_count == len(contexts):
        status = "success"
    elif success_count > 0:
        status = "partial"
    elif pending_count > 0:
        status = "pending"

    message = None
    if status == "pending":
        message = (
            "DHIS2 metadata is being prepared in local staging. Retry shortly or inspect "
            "the DHIS2 admin pages for connection diagnostics."
        )
    elif status == "partial":
        if failed_count:
            message = (
                "Some configured DHIS2 connections are unavailable in local staging. "
                "Available staged metadata is shown below."
            )
        else:
            message = (
                "Some configured DHIS2 connections are still being staged. "
                "Available staged metadata is shown below."
            )
    elif status == "failed":
        message = (
            "Failed to load staged DHIS2 metadata. Retry here or inspect the DHIS2 admin "
            "pages for more diagnostics."
        )

    merged_items = _merge_payload_items(
        metadata_type,
        aggregated_items,
        org_unit_source_mode=normalized_org_unit_source_mode,
    )
    total = len(merged_items)
    normalized_page_size = max(1, min(int(page_size or 25), 250))
    normalized_page = max(1, int(page or 1))
    total_pages = max(1, (total + normalized_page_size - 1) // normalized_page_size)
    if normalized_page > total_pages:
        normalized_page = total_pages

    paginated_items = merged_items
    pagination = None
    if metadata_type in VARIABLE_METADATA_TYPES:
        start_index = (normalized_page - 1) * normalized_page_size
        end_index = start_index + normalized_page_size
        paginated_items = merged_items[start_index:end_index]
        pagination = {
            "page": normalized_page,
            "page_size": normalized_page_size,
            "total": total,
            "total_pages": total_pages,
            "has_next": normalized_page < total_pages,
            "has_previous": normalized_page > 1,
        }

    return {
        "status": status,
        "result": paginated_items,
        "instance_results": instance_results,
        "message": message,
        "staged": True,
        "pagination": pagination,
        "progress": (
            refresh_progress.get(progress_family)
            if refresh_progress and progress_family
            else None
        ),
    }


# ---------------------------------------------------------------------------
# Category option combos for a DHIS2 variable (data element)
# ---------------------------------------------------------------------------


def get_category_option_combos_for_element(
    instance_id: int,
    variable_id: str,
) -> list[dict[str, Any]]:
    """Fetch category option combos for a data element from a DHIS2 instance.

    Queries ``/api/dataElements/<uid>.json?fields=categoryCombo[categoryOptionCombos[id,displayName]]``
    and returns a flat list of ``{"id": str, "displayName": str}`` dicts.

    Results are cached in the metadata cache so repeat calls are fast.

    Parameters
    ----------
    instance_id:
        The ``DHIS2Instance.id`` to query.
    variable_id:
        The DHIS2 UID of the data element (e.g. ``"fbfJHSPpUQD"``).
    """
    from superset.dhis2.models import DHIS2Instance

    instance = db.session.get(DHIS2Instance, instance_id)
    if instance is None:
        raise ValueError(f"DHIS2Instance with id={instance_id} not found")

    api_url = f"{instance.url.rstrip('/')}/api/dataElements/{variable_id}.json"
    params = {
        "fields": "categoryCombo[categoryOptionCombos[id,displayName]]",
    }
    try:
        response = requests.get(
            api_url,
            params=params,
            headers=instance.get_auth_headers(),
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning(
            "get_category_option_combos_for_element: request failed for instance=%s variable=%s: %s",
            instance_id, variable_id, exc,
        )
        return []

    combos: list[dict[str, Any]] = []
    category_combo = data.get("categoryCombo") or {}
    for coc in category_combo.get("categoryOptionCombos") or []:
        if coc.get("id"):
            combos.append(
                {
                    "id": coc["id"],
                    "displayName": coc.get("displayName") or coc["id"],
                }
            )

    return combos
