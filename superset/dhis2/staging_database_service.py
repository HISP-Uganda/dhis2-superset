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
"""Helpers for resolving the local SQL database used to serve staged DHIS2 data."""

from __future__ import annotations

from flask import current_app

from superset import db
from superset.utils.database import get_or_create_db

DEFAULT_STAGING_DATABASE_NAME = "DHIS2 Local Staging"


def get_staging_database(always_create: bool = True):
    """Return the Superset ``Database`` used to serve staged DHIS2 tables."""

    metadata_uri = current_app.config["SQLALCHEMY_DATABASE_URI"]
    configured_uri = str(
        current_app.config.get("DHIS2_STAGING_DATABASE_URI") or ""
    ).strip()
    configured_name = str(
        current_app.config.get("DHIS2_STAGING_DATABASE_NAME") or ""
    ).strip()

    database_name = configured_name or (
        DEFAULT_STAGING_DATABASE_NAME if configured_uri else "main"
    )
    sqlalchemy_uri = configured_uri or metadata_uri

    database = get_or_create_db(
        database_name,
        sqlalchemy_uri,
        always_create=always_create,
    )
    if database is None:
        return None

    if configured_uri or configured_name:
        desired_expose_in_sqllab = bool(
            current_app.config.get("DHIS2_STAGING_DATABASE_EXPOSE_IN_SQLLAB", False)
        )
        changed = False
        if database.expose_in_sqllab != desired_expose_in_sqllab:
            database.expose_in_sqllab = desired_expose_in_sqllab
            changed = True
        if database.allow_ctas:
            database.allow_ctas = False
            changed = True
        if database.allow_cvas:
            database.allow_cvas = False
            changed = True
        if database.allow_dml:
            database.allow_dml = False
            changed = True
        if changed:
            db.session.flush()

    return database
