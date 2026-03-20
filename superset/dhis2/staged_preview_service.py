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
"""Central staged-preview service."""

from __future__ import annotations

import logging
from typing import Any

from superset.dhis2.staged_dataset_service import get_staged_dataset
from superset.local_staging.engine_factory import get_active_staging_engine

logger = logging.getLogger(__name__)


class StagedPreviewService:
    """Resolve and execute staged dataset previews against the physical ds_* table."""

    def preview_dataset(
        self,
        dataset_id: int,
        *,
        limit: int = 50,
    ) -> dict[str, Any]:
        dataset = get_staged_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"Dataset with id={dataset_id} not found")

        engine = get_active_staging_engine(dataset.database_id)
        preview = engine.get_staging_table_preview(dataset, limit=limit)
        diagnostics = dict(preview.get("diagnostics") or {})
        diagnostics.setdefault("dataset_id", dataset.id)
        diagnostics.setdefault("dataset_name", dataset.name)
        diagnostics.setdefault("backend", getattr(engine, "engine_name", None))
        diagnostics.setdefault(
            "staging_table_ref",
            getattr(engine, "get_superset_sql_table_ref", lambda _dataset: None)(dataset),
        )
        logger.info(
            "staged_preview_service: dataset_id=%s backend=%s table=%s rows=%s",
            dataset.id,
            diagnostics.get("backend"),
            diagnostics.get("staging_table_ref"),
            preview.get("rowcount"),
        )
        return {
            **preview,
            "diagnostics": diagnostics,
        }
