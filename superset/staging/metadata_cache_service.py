from __future__ import annotations

import json
import logging
import sqlite3
import time
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from superset import db
from superset.staging.models import SourceMetadataCache
from superset.staging.source_service import ensure_source_for_database

DEFAULT_CACHE_TTL_SECONDS = 4 * 60 * 60
SQLITE_LOCK_RETRY_ATTEMPTS = 5
SQLITE_LOCK_RETRY_DELAY_SECONDS = 0.1

logger = logging.getLogger(__name__)


def _normalize_key_parts(key_parts: dict[str, Any]) -> str:
    return json.dumps(key_parts, sort_keys=True, separators=(",", ":"))


def _is_sqlite_lock_error(ex: Exception) -> bool:
    return "database is locked" in str(ex).lower()


def _run_with_sqlite_lock_retry(operation: Any) -> Any:
    for attempt in range(SQLITE_LOCK_RETRY_ATTEMPTS):
        try:
            return operation()
        except (sqlite3.OperationalError, SQLAlchemyError) as ex:
            db.session.rollback()
            if (
                not _is_sqlite_lock_error(ex)
                or attempt >= SQLITE_LOCK_RETRY_ATTEMPTS - 1
            ):
                raise
            logger.debug(
                "Retrying staged metadata cache write after SQLite lock "
                "(attempt %d/%d)",
                attempt + 1,
                SQLITE_LOCK_RETRY_ATTEMPTS,
            )
            time.sleep(SQLITE_LOCK_RETRY_DELAY_SECONDS * (2**attempt))


def get_cached_metadata_payload(
    database_id: int,
    cache_namespace: str,
    key_parts: dict[str, Any],
) -> dict[str, Any] | None:
    source, _ = ensure_source_for_database(database_id)
    cache_key = _normalize_key_parts(key_parts)

    entry = (
        db.session.query(SourceMetadataCache)
        .filter(
            SourceMetadataCache.staged_source_id == source.id,
            SourceMetadataCache.cache_namespace == cache_namespace,
            SourceMetadataCache.cache_key == cache_key,
        )
        .one_or_none()
    )
    if entry is None:
        return None

    now = datetime.utcnow()
    if entry.expires_at and entry.expires_at <= now:
        def _delete_expired_entry() -> None:
            db.session.delete(entry)
            db.session.commit()

        _run_with_sqlite_lock_retry(_delete_expired_entry)
        return None

    payload = entry.get_metadata()
    payload["cached"] = True
    payload["cache_refreshed_at"] = (
        entry.refreshed_at.isoformat() if entry.refreshed_at else None
    )
    return payload


def set_cached_metadata_payload(
    database_id: int,
    cache_namespace: str,
    key_parts: dict[str, Any],
    payload: dict[str, Any],
    *,
    ttl_seconds: int | None = DEFAULT_CACHE_TTL_SECONDS,
) -> dict[str, Any]:
    source, _ = ensure_source_for_database(database_id)
    cache_key = _normalize_key_parts(key_parts)
    now = datetime.utcnow()

    payload_to_store = dict(payload)
    payload_to_store.pop("cached", None)
    payload_to_store.pop("cache_refreshed_at", None)

    def _write_payload() -> None:
        entry = (
            db.session.query(SourceMetadataCache)
            .filter(
                SourceMetadataCache.staged_source_id == source.id,
                SourceMetadataCache.cache_namespace == cache_namespace,
                SourceMetadataCache.cache_key == cache_key,
            )
            .one_or_none()
        )
        if entry is None:
            entry = SourceMetadataCache(
                staged_source_id=source.id,
                cache_namespace=cache_namespace,
                cache_key=cache_key,
                metadata_json="{}",
            )
            db.session.add(entry)

        entry.metadata_json = json.dumps(payload_to_store, sort_keys=True)
        entry.refreshed_at = now
        entry.expires_at = (
            now + timedelta(seconds=ttl_seconds) if ttl_seconds is not None else None
        )
        db.session.commit()

    _run_with_sqlite_lock_retry(_write_payload)

    response_payload = dict(payload_to_store)
    response_payload["cached"] = False
    response_payload["cache_refreshed_at"] = now.isoformat()
    return response_payload


def clear_cached_metadata(
    database_id: int,
    *,
    cache_namespace: str | None = None,
) -> int:
    source, _ = ensure_source_for_database(database_id)
    deleted = 0

    def _clear() -> None:
        nonlocal deleted
        query = db.session.query(SourceMetadataCache).filter(
            SourceMetadataCache.staged_source_id == source.id
        )
        if cache_namespace is not None:
            query = query.filter(SourceMetadataCache.cache_namespace == cache_namespace)

        deleted = query.delete(synchronize_session=False)
        db.session.commit()

    _run_with_sqlite_lock_retry(_clear)
    return int(deleted)


def clear_cached_metadata_prefix(
    database_id: int,
    *,
    namespace_prefix: str,
) -> int:
    source, _ = ensure_source_for_database(database_id)
    deleted = 0

    def _clear() -> None:
        nonlocal deleted
        deleted = (
            db.session.query(SourceMetadataCache)
            .filter(
                SourceMetadataCache.staged_source_id == source.id,
                SourceMetadataCache.cache_namespace.like(f"{namespace_prefix}%"),
            )
            .delete(synchronize_session=False)
        )
        db.session.commit()

    _run_with_sqlite_lock_retry(_clear)
    return int(deleted)


def get_cache_stats(
    database_id: int,
    *,
    namespace_prefix: str | None = None,
) -> dict[str, Any]:
    source, _ = ensure_source_for_database(database_id)
    query = db.session.query(SourceMetadataCache).filter(
        SourceMetadataCache.staged_source_id == source.id
    )
    if namespace_prefix:
        query = query.filter(
            SourceMetadataCache.cache_namespace.like(f"{namespace_prefix}%")
        )

    entries = query.all()
    by_namespace: dict[str, int] = {}
    for entry in entries:
        by_namespace[entry.cache_namespace] = (
            by_namespace.get(entry.cache_namespace, 0) + 1
        )

    return {
        "database_id": database_id,
        "staged_source_id": source.id,
        "total_entries": len(entries),
        "by_namespace": by_namespace,
    }
