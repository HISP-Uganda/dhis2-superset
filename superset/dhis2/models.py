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
DHIS2 Multi-Instance Data Models

Provides SQLAlchemy ORM models for managing multiple DHIS2 server instances
per Superset logical database, staged (materialised) datasets, per-variable
source mappings, and background sync job tracking.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from flask_appbuilder import Model
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.types import Text

from superset.extensions import encrypted_field_factory
from superset import security_manager
from superset.staging.models import (
    DHIS2LogicalDatabase,
    StagedDataset as GenericStagedDataset,
    StagedDatasetField as GenericStagedDatasetField,
    SyncJob as GenericSyncJob,
)

# ---------------------------------------------------------------------------
# Sentinel used to redact credentials in serialised output
# ---------------------------------------------------------------------------
_REDACTED = "**REDACTED**"


# ---------------------------------------------------------------------------
# DHIS2Instance
# ---------------------------------------------------------------------------


class DHIS2Instance(Model):
    """Registry of DHIS2 server instances that belong to a logical Superset database.

    A single Superset ``Database`` (row in ``dbs``) may reference many DHIS2
    instances.  Each instance carries its own base URL and authentication
    credentials (either HTTP Basic or a Personal Access Token).  Credentials
    are stored using Superset's ``encrypted_field_factory`` so they are
    transparently encrypted at rest.
    """

    __tablename__ = "dhis2_instances"

    __table_args__ = (
        UniqueConstraint("database_id", "name", name="uq_dhis2_instances_db_name"),
        sa.Index("ix_dhis2_instances_database_id", "database_id"),
        sa.Index("ix_dhis2_instances_database_id_is_active", "database_id", "is_active"),
        sa.Index(
            "ix_dhis2_instances_database_id_display_order",
            "database_id",
            "display_order",
        ),
    )

    # ------------------------------------------------------------------
    # Primary key
    # ------------------------------------------------------------------
    id = sa.Column(sa.Integer, primary_key=True)

    # ------------------------------------------------------------------
    # Foreign keys
    # ------------------------------------------------------------------
    database_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dbs.id", ondelete="CASCADE"),
        nullable=False,
    )
    logical_database_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_logical_databases.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Instance identity
    # ------------------------------------------------------------------
    name = sa.Column(sa.String(255), nullable=False)
    url = sa.Column(sa.String(1024), nullable=False)
    description = sa.Column(Text, nullable=True)
    is_active = sa.Column(sa.Boolean, default=True, nullable=False)
    display_order = sa.Column(sa.Integer, default=0, nullable=False)

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------
    auth_type = sa.Column(sa.String(50), nullable=False, default="basic")
    username = sa.Column(sa.String(255), nullable=True)
    password = sa.Column(encrypted_field_factory.create(Text), nullable=True)
    access_token = sa.Column(encrypted_field_factory.create(Text), nullable=True)

    # ------------------------------------------------------------------
    # Audit timestamps
    # ------------------------------------------------------------------
    last_test_status = sa.Column(sa.String(50), nullable=True)
    last_test_message = sa.Column(Text, nullable=True)
    last_test_response_time_ms = sa.Column(sa.Float, nullable=True)
    last_tested_on = sa.Column(sa.DateTime, nullable=True)
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=True)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    database = relationship(
        "Database",
        foreign_keys=[database_id],
        backref="dhis2_instances",
    )
    logical_database: DHIS2LogicalDatabase = relationship(
        "DHIS2LogicalDatabase",
        back_populates="instances",
        foreign_keys=[logical_database_id],
    )
    created_by = relationship(
        security_manager.user_model,
        foreign_keys=[created_by_fk],
    )
    changed_by = relationship(
        security_manager.user_model,
        foreign_keys=[changed_by_fk],
    )
    dataset_variables: list[DHIS2DatasetVariable] = relationship(
        "DHIS2DatasetVariable",
        back_populates="instance",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def get_auth_headers(self) -> dict[str, str]:
        """Return HTTP request headers for authenticating against this instance.

        Supports two authentication modes:

        * ``basic`` – HTTP Basic Auth encoded as a ``Authorization: Basic …`` header.
        * ``pat``   – Personal Access Token sent as a ``Authorization: ApiToken …``
          header (DHIS2 2.40+ convention).

        Returns an empty dict if the instance has no credentials configured, so
        callers can unconditionally merge the result into their request headers.
        """
        if self.auth_type == "pat" and self.access_token:
            return {"Authorization": f"ApiToken {self.access_token}"}

        if self.auth_type == "basic" and self.username and self.password:
            raw = f"{self.username}:{self.password}"
            encoded = base64.b64encode(raw.encode()).decode()
            return {"Authorization": f"Basic {encoded}"}

        return {}

    @property
    def is_single_instance_compat(self) -> bool:
        """Return ``True`` when this instance was created from a legacy single-instance
        DHIS2 database configuration.

        Legacy databases stored credentials directly on the ``dbs`` row rather than
        on a ``DHIS2Instance`` record.  This property lets callers detect that origin
        and apply any needed backward-compatibility logic without hard-coding table
        inspection.
        """
        # Convention: legacy-migrated instances carry the sentinel name "default".
        return self.name == "default"

    def to_json(self) -> dict[str, Any]:
        """Serialise this instance to a plain dict, redacting all credentials.

        The ``password`` and ``access_token`` fields are never returned in plain
        text; callers should use ``get_auth_headers()`` when they need to
        authenticate a live HTTP request.
        """
        return {
            "id": self.id,
            "database_id": self.database_id,
            "logical_database_id": self.logical_database_id,
            "name": self.name,
            "url": self.url,
            "auth_type": self.auth_type,
            "username": self.username,
            "password": _REDACTED if self.password else None,
            "access_token": _REDACTED if self.access_token else None,
            "is_active": self.is_active,
            "display_order": self.display_order,
            "description": self.description,
            "last_test_status": self.last_test_status,
            "last_test_message": self.last_test_message,
            "last_test_response_time_ms": self.last_test_response_time_ms,
            "last_tested_on": self.last_tested_on.isoformat()
            if self.last_tested_on
            else None,
            "last_test_result": (
                {
                    "status": self.last_test_status,
                    "message": self.last_test_message,
                    "response_time_ms": self.last_test_response_time_ms,
                    "tested_on": self.last_tested_on.isoformat()
                    if self.last_tested_on
                    else None,
                }
                if self.last_test_status or self.last_test_message or self.last_tested_on
                else None
            ),
            "created_by_fk": self.created_by_fk,
            "changed_by_fk": self.changed_by_fk,
            "created_on": self.created_on.isoformat() if self.created_on else None,
            "changed_on": self.changed_on.isoformat() if self.changed_on else None,
        }

    def __repr__(self) -> str:
        return f"<DHIS2Instance id={self.id} name={self.name!r} url={self.url!r}>"


# ---------------------------------------------------------------------------
# DHIS2StagedDataset
# ---------------------------------------------------------------------------


class DHIS2StagedDataset(Model):
    """Metadata for a materialised dataset whose rows may originate from multiple
    DHIS2 instances.

    A staged dataset defines *what* data to fetch and *where* to store it (a
    physical table in the staging schema).  The actual column-to-instance
    mapping is handled by :class:`DHIS2DatasetVariable`.  Scheduling is
    expressed as a cron expression in ``schedule_cron``; the background
    worker interprets this to decide when to trigger a sync job.

    ``auto_refresh_enabled`` is intentionally hardcoded to ``True`` and
    non-nullable to signal that background sync cannot be disabled on a
    per-dataset basis – use ``is_active`` to pause a dataset entirely.
    """

    __tablename__ = "dhis2_staged_datasets"

    __table_args__ = (
        UniqueConstraint(
            "database_id", "name", name="uq_dhis2_staged_datasets_db_name"
        ),
        sa.Index("ix_dhis2_staged_datasets_database_id", "database_id"),
        sa.Index(
            "ix_dhis2_staged_datasets_database_id_is_active", "database_id", "is_active"
        ),
    )

    # ------------------------------------------------------------------
    # Primary key
    # ------------------------------------------------------------------
    id = sa.Column(sa.Integer, primary_key=True)

    # ------------------------------------------------------------------
    # Foreign keys
    # ------------------------------------------------------------------
    database_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dbs.id", ondelete="CASCADE"),
        nullable=False,
    )
    logical_database_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_logical_databases.id", ondelete="SET NULL"),
        nullable=True,
    )
    generic_dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_datasets.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_fk = sa.Column(
        sa.Integer,
        sa.ForeignKey("ab_user.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Dataset identity
    # ------------------------------------------------------------------
    name = sa.Column(sa.String(255), nullable=False)
    description = sa.Column(Text, nullable=True)
    staging_table_name = sa.Column(sa.String(255), nullable=True)

    # ------------------------------------------------------------------
    # Schedule
    # ------------------------------------------------------------------
    schedule_cron = sa.Column(sa.String(100), nullable=True)
    schedule_timezone = sa.Column(sa.String(100), default="UTC", nullable=True)

    # ------------------------------------------------------------------
    # State flags
    # ------------------------------------------------------------------
    is_active = sa.Column(sa.Boolean, default=True, nullable=False)
    auto_refresh_enabled = sa.Column(sa.Boolean, default=True, nullable=False)

    # ------------------------------------------------------------------
    # Sync tracking
    # ------------------------------------------------------------------
    last_sync_at = sa.Column(sa.DateTime, nullable=True)
    last_sync_status = sa.Column(sa.String(50), nullable=True)
    last_sync_rows = sa.Column(sa.Integer, nullable=True)

    # ------------------------------------------------------------------
    # Configuration blob
    # ------------------------------------------------------------------
    dataset_config = sa.Column(Text, nullable=True)

    # ------------------------------------------------------------------
    # Audit timestamps
    # ------------------------------------------------------------------
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=True)
    changed_on = sa.Column(
        sa.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    database = relationship(
        "Database",
        foreign_keys=[database_id],
        backref="dhis2_staged_datasets",
    )
    logical_database: DHIS2LogicalDatabase = relationship(
        "DHIS2LogicalDatabase",
        back_populates="dhis2_staged_datasets",
        foreign_keys=[logical_database_id],
    )
    generic_dataset: GenericStagedDataset = relationship(
        "StagedDataset",
        back_populates="dhis2_dataset",
        foreign_keys=[generic_dataset_id],
    )
    variables: list[DHIS2DatasetVariable] = relationship(
        "DHIS2DatasetVariable",
        back_populates="staged_dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    sync_jobs: list[DHIS2SyncJob] = relationship(
        "DHIS2SyncJob",
        back_populates="staged_dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="desc(DHIS2SyncJob.created_on)",
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def get_dataset_config(self) -> dict[str, Any]:
        """Parse and return ``dataset_config`` as a Python dict.

        Returns an empty dict if the field is ``None`` or not valid JSON.
        """
        raw_config = getattr(self, "dataset_config", None)
        if not raw_config:
            return {}
        if isinstance(raw_config, dict):
            return raw_config
        try:
            return json.loads(raw_config)
        except (json.JSONDecodeError, TypeError):
            return {}

    def to_json(self) -> dict[str, Any]:
        """Serialise this dataset to a plain dict."""
        return {
            "id": self.id,
            "database_id": self.database_id,
            "logical_database_id": self.logical_database_id,
            "generic_dataset_id": self.generic_dataset_id,
            "name": self.name,
            "description": self.description,
            "staging_table_name": self.staging_table_name,
            "schedule_cron": self.schedule_cron,
            "schedule_timezone": self.schedule_timezone,
            "is_active": self.is_active,
            "auto_refresh_enabled": self.auto_refresh_enabled,
            "last_sync_at": (
                self.last_sync_at.isoformat() if self.last_sync_at else None
            ),
            "last_sync_status": self.last_sync_status,
            "last_sync_rows": self.last_sync_rows,
            "dataset_config": self.get_dataset_config(),
            "created_by_fk": self.created_by_fk,
            "changed_by_fk": self.changed_by_fk,
            "created_on": self.created_on.isoformat() if self.created_on else None,
            "changed_on": self.changed_on.isoformat() if self.changed_on else None,
        }

    def __repr__(self) -> str:
        return (
            f"<DHIS2StagedDataset id={self.id} name={self.name!r} "
            f"database_id={self.database_id}>"
        )


# ---------------------------------------------------------------------------
# DHIS2DatasetVariable
# ---------------------------------------------------------------------------


class DHIS2DatasetVariable(Model):
    """Maps a single DHIS2 variable (data element, indicator, etc.) to its source
    DHIS2 instance within a :class:`DHIS2StagedDataset`.

    Each row answers the question "for staged dataset *D*, fetch variable *V*
    from DHIS2 instance *I*, and surface it under alias *A* in the staging
    table".  The composite unique constraint on ``(staged_dataset_id,
    instance_id, variable_id)`` prevents duplicate variable registrations for
    the same source.
    """

    __tablename__ = "dhis2_dataset_variables"

    __table_args__ = (
        UniqueConstraint(
            "staged_dataset_id",
            "instance_id",
            "variable_id",
            name="uq_dhis2_dataset_variables_ds_inst_var",
        ),
        sa.Index(
            "ix_dhis2_dataset_variables_staged_dataset_id", "staged_dataset_id"
        ),
        sa.Index("ix_dhis2_dataset_variables_instance_id", "instance_id"),
        sa.Index(
            "ix_dhis2_dataset_variables_staged_dataset_instance",
            "staged_dataset_id",
            "instance_id",
        ),
    )

    # ------------------------------------------------------------------
    # Primary key
    # ------------------------------------------------------------------
    id = sa.Column(sa.Integer, primary_key=True)

    # ------------------------------------------------------------------
    # Foreign keys
    # ------------------------------------------------------------------
    staged_dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    instance_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    generic_field_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("staged_dataset_fields.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Variable identity
    # ------------------------------------------------------------------
    variable_id = sa.Column(sa.String(255), nullable=False)
    variable_type = sa.Column(sa.String(50), nullable=False)
    variable_name = sa.Column(sa.String(1024), nullable=True)
    alias = sa.Column(sa.String(255), nullable=True)

    # ------------------------------------------------------------------
    # Extra params (JSON blob)
    # ------------------------------------------------------------------
    extra_params = sa.Column(Text, nullable=True)

    # ------------------------------------------------------------------
    # Audit timestamp (create-only; updates are rare and not tracked)
    # ------------------------------------------------------------------
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=True)

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    staged_dataset: DHIS2StagedDataset = relationship(
        "DHIS2StagedDataset",
        back_populates="variables",
    )
    instance: DHIS2Instance = relationship(
        "DHIS2Instance",
        back_populates="dataset_variables",
    )
    generic_field: GenericStagedDatasetField = relationship(
        "StagedDatasetField",
        back_populates="dhis2_variable",
        foreign_keys=[generic_field_id],
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def get_extra_params(self) -> dict[str, Any]:
        """Parse and return ``extra_params`` as a Python dict.

        Returns an empty dict if the field is ``None`` or not valid JSON.
        """
        raw_params = self.__dict__.get("extra_params")
        if not raw_params:
            return {}
        try:
            return json.loads(raw_params)
        except (json.JSONDecodeError, TypeError):
            return {}

    def to_json(self) -> dict[str, Any]:
        """Serialise this variable mapping to a plain dict."""
        return {
            "id": self.id,
            "staged_dataset_id": self.staged_dataset_id,
            "instance_id": self.instance_id,
            "generic_field_id": self.generic_field_id,
            "variable_id": self.variable_id,
            "variable_type": self.variable_type,
            "variable_name": self.variable_name,
            "alias": self.alias,
            "extra_params": self.get_extra_params(),
            "created_on": self.created_on.isoformat() if self.created_on else None,
        }

    def __repr__(self) -> str:
        return (
            f"<DHIS2DatasetVariable id={self.id} variable_id={self.variable_id!r} "
            f"instance_id={self.instance_id} staged_dataset_id={self.staged_dataset_id}>"
        )


# ---------------------------------------------------------------------------
# DHIS2SyncJob
# ---------------------------------------------------------------------------


class DHIS2SyncJob(Model):
    """Tracks a single execution of a background data-sync job for a
    :class:`DHIS2StagedDataset`.

    Jobs are created with ``status='pending'`` and transition through
    ``'running'`` to a terminal state of ``'success'``, ``'partial'``, or
    ``'failed'``.  ``instance_results`` stores a JSON summary of per-instance
    outcomes so operators can diagnose partial failures without inspecting
    application logs.
    """

    __tablename__ = "dhis2_sync_jobs"

    __table_args__ = (
        sa.Index("ix_dhis2_sync_jobs_staged_dataset_id", "staged_dataset_id"),
        sa.Index("ix_dhis2_sync_jobs_status", "status"),
        sa.Index(
            "ix_dhis2_sync_jobs_staged_dataset_id_status", "staged_dataset_id", "status"
        ),
    )

    # ------------------------------------------------------------------
    # Primary key
    # ------------------------------------------------------------------
    id = sa.Column(sa.Integer, primary_key=True)

    # ------------------------------------------------------------------
    # Foreign key
    # ------------------------------------------------------------------
    staged_dataset_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("dhis2_staged_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    generic_sync_job_id = sa.Column(
        sa.Integer,
        sa.ForeignKey("sync_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Job metadata
    # ------------------------------------------------------------------
    job_type = sa.Column(sa.String(50), nullable=False, default="manual")
    status = sa.Column(sa.String(50), nullable=False, default="pending")

    # ------------------------------------------------------------------
    # Timing
    # ------------------------------------------------------------------
    started_at = sa.Column(sa.DateTime, nullable=True)
    completed_at = sa.Column(sa.DateTime, nullable=True)

    # ------------------------------------------------------------------
    # Result counts
    # ------------------------------------------------------------------
    rows_loaded = sa.Column(sa.Integer, nullable=True)
    rows_failed = sa.Column(sa.Integer, nullable=True)

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------
    error_message = sa.Column(Text, nullable=True)
    instance_results = sa.Column(Text, nullable=True)

    # ------------------------------------------------------------------
    # Audit timestamps
    # ------------------------------------------------------------------
    created_on = sa.Column(sa.DateTime, default=datetime.utcnow, nullable=True)
    changed_on = sa.Column(
        sa.DateTime,
        onupdate=datetime.utcnow,
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    staged_dataset: DHIS2StagedDataset = relationship(
        "DHIS2StagedDataset",
        back_populates="sync_jobs",
    )
    generic_sync_job: GenericSyncJob = relationship(
        "SyncJob",
        back_populates="dhis2_sync_job",
        foreign_keys=[generic_sync_job_id],
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def get_instance_results(self) -> dict[str, Any]:
        """Parse and return ``instance_results`` as a Python dict.

        Returns an empty dict if the field is ``None`` or not valid JSON.
        """
        raw_results = self.__dict__.get("instance_results")
        if not raw_results:
            return {}
        try:
            return json.loads(raw_results)
        except (json.JSONDecodeError, TypeError):
            return {}

    @property
    def duration_seconds(self) -> float | None:
        """Return the elapsed seconds between ``started_at`` and ``completed_at``.

        Returns ``None`` if either timestamp is absent (e.g. a job that is
        still running or was never started).
        """
        if self.started_at and self.completed_at:
            delta = self.completed_at - self.started_at
            return delta.total_seconds()
        return None

    def to_json(self) -> dict[str, Any]:
        """Serialise this sync job to a plain dict."""
        return {
            "id": self.id,
            "staged_dataset_id": self.staged_dataset_id,
            "generic_sync_job_id": self.generic_sync_job_id,
            "job_type": self.job_type,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "duration_seconds": self.duration_seconds,
            "rows_loaded": self.rows_loaded,
            "rows_failed": self.rows_failed,
            "error_message": self.error_message,
            "instance_results": self.get_instance_results(),
            "created_on": self.created_on.isoformat() if self.created_on else None,
            "changed_on": self.changed_on.isoformat() if self.changed_on else None,
        }

    def __repr__(self) -> str:
        return (
            f"<DHIS2SyncJob id={self.id} status={self.status!r} "
            f"staged_dataset_id={self.staged_dataset_id}>"
        )
