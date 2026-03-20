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
"""Dataset-creation source database eligibility helpers."""

from __future__ import annotations

import json
import logging
from typing import Any

from superset import db, security_manager
from superset.models.core import Database

logger = logging.getLogger(__name__)

_INTERNAL_DATABASE_FLAGS = (
    "dhis2_staging_internal",
    "dhis2_serving_internal",
    "dhis2_is_internal",
    "staging_internal",
    "serving_internal",
)
_INTERNAL_DATABASE_NAME_MARKERS = (
    "dhis2 staging",
    "dhis2 serving",
    "dhis2 local staging",
)


def _database_extra(database: Database) -> dict[str, Any]:
    raw = getattr(database, "extra", None) or "{}"
    if isinstance(raw, dict):
        return dict(raw)
    if not isinstance(raw, str):
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning(
            "dataset_source_service: failed to parse extra for database id=%s",
            getattr(database, "id", None),
        )
        return {}
    return parsed if isinstance(parsed, dict) else {}


def get_dataset_source_eligibility(database: Database) -> tuple[bool, str]:
    """Return whether a Superset Database should appear in dataset creation."""

    extra = _database_extra(database)
    explicit_flag = extra.get("is_dataset_source")
    if explicit_flag is True:
        return True, "explicit_opt_in"
    if explicit_flag is False:
        return False, "explicit_opt_out"

    for flag in _INTERNAL_DATABASE_FLAGS:
        if extra.get(flag) is True:
            return False, f"internal_flag:{flag}"

    database_name = str(getattr(database, "database_name", "") or "").strip().lower()
    for marker in _INTERNAL_DATABASE_NAME_MARKERS:
        if marker in database_name:
            logger.info(
                "dataset_source_service: excluding database id=%s by legacy name marker=%s",
                getattr(database, "id", None),
                marker,
            )
            return False, f"legacy_name:{marker}"

    return True, "default"


def serialize_dataset_source_database(database: Database) -> dict[str, Any]:
    extra = _database_extra(database)
    eligible, reason = get_dataset_source_eligibility(database)
    return {
        "id": database.id,
        "database_name": database.database_name,
        "backend": database.backend,
        "allow_multi_catalog": database.allow_multi_catalog,
        "expose_in_sqllab": database.expose_in_sqllab,
        "extra": json.dumps(extra),
        "dataset_source_eligible": eligible,
        "dataset_source_reason": reason,
    }


def list_dataset_source_databases() -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    databases = (
        db.session.query(Database)
        .order_by(Database.database_name.asc())
        .all()
    )

    for database in databases:
        if not security_manager.can_access_database(database):
            continue

        eligible, reason = get_dataset_source_eligibility(database)
        logger.info(
            "dataset_source_service: database id=%s name=%r eligible=%s reason=%s",
            database.id,
            database.database_name,
            eligible,
            reason,
        )
        if not eligible:
            continue
        result.append(serialize_dataset_source_database(database))

    return result
