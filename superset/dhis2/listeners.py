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
import json
import logging
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Mapper

from superset import db
from superset.connectors.sqla.models import SqlaTable
from superset.dhis2.models import DHIS2StagedDataset
from superset.dhis2.staged_dataset_service import _get_engine

logger = logging.getLogger(__name__)


def setup_listeners() -> None:
    """Register DHIS2-specific model event listeners."""
    # 1. When a SqlaTable is deleted, check if it's a DHIS2 staged-local dataset
    # and clean up the associated DHIS2StagedDataset and physical tables.
    event.listen(SqlaTable, "after_delete", _after_sqla_table_delete)

    # 2. When a DHIS2StagedDataset is deleted (e.g. via Database cascade),
    # ensure physical tables are dropped.
    # Note: delete_staged_dataset already does this when called directly,
    # but cascade deletion bypasses the service layer.
    event.listen(DHIS2StagedDataset, "before_delete", _before_dhis2_staged_dataset_delete)


def _after_sqla_table_delete(mapper: Mapper, connection: Any, target: Any) -> None:
    """Clean up DHIS2 staged dataset when the Superset virtual dataset is deleted."""
    try:
        extra_raw = getattr(target, "extra", None)
        if not extra_raw:
            return

        extra = json.loads(extra_raw) if isinstance(extra_raw, str) else extra_raw
        if not extra.get("dhis2_staged_local"):
            return

        staged_dataset_id = extra.get("dhis2_staged_dataset_id")
        if not staged_dataset_id:
            return

        # Avoid circular deletion if we are already in delete_staged_dataset
        # We use a thread-local or similar if needed, but here we can just
        # check if the record still exists.
        
        logger.info(
            "DHIS2 listener: SqlaTable id=%s ('%s') deleted; cleaning up DHIS2StagedDataset id=%s",
            target.id,
            target.table_name,
            staged_dataset_id,
        )
        
        # We'll use a session from the connection if possible, or just use db.session
        # but we must be careful.
        staged_dataset = db.session.query(DHIS2StagedDataset).get(staged_dataset_id)
        if staged_dataset:
            # We don't call svc.delete_staged_dataset because it tries to delete
            # the SqlaTable (which is currently being deleted).
            # The before_delete listener on DHIS2StagedDataset will handle physical tables.
            db.session.delete(staged_dataset)
            # We don't commit here; the parent transaction will commit.
    except Exception:
        logger.exception("DHIS2 listener: failed to clean up staged dataset after SqlaTable delete")


def _before_dhis2_staged_dataset_delete(mapper: Mapper, connection: Any, target: Any) -> None:
    """Drop physical tables and clean up generic metadata before the DHIS2StagedDataset is removed."""
    try:
        logger.info(
            "DHIS2 listener: DHIS2StagedDataset id=%s ('%s') being deleted; dropping physical tables",
            target.id,
            target.name,
        )
        
        # 1. Drop physical tables
        engine = _get_engine(target.database_id)
        engine.drop_staging_table(target)
        
        # 2. Delete generic StagedDataset record if it exists
        if target.generic_dataset:
            logger.info("DHIS2 listener: also deleting generic StagedDataset record id=%s", target.generic_dataset.id)
            db.session.delete(target.generic_dataset)
    except Exception:
        logger.exception("DHIS2 listener: failed to clean up physical state for staged dataset id=%s", target.id)
