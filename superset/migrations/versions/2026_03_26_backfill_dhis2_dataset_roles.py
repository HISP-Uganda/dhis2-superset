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
"""Backfill dataset_role for DHIS2 mart and source datasets.

Role assignment rules:
  SERVING_DATASET      — Primary user-facing analytical mart (_mart suffix).
                         Visible in dataset management list AND chart creation.
  MART_DATASET         — Internal sub-table variants ([KPI]/[Map] prefix,
                         _kpi / _map suffix). Visible only in chart creation,
                         hidden from the dataset management list.
  DHIS2_SOURCE_DATASET — Raw DHIS2 serving tables (no mart suffix). Auto-
                         registered for monitoring; hidden from both the
                         management list and chart creation.

Revision ID: 2026_03_26_backfill_dhis2_dataset_roles
Revises: 2026_03_25_database_staging_internal_column
Create Date: 2026-03-26 08:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "2026_03_26_backfill_dhis2_dataset_roles"
down_revision = "2026_03_25_database_staging_internal_column"
branch_labels = None
depends_on = None

_MART_ROLE = "MART_DATASET"
_SOURCE_ROLE = "DHIS2_SOURCE_DATASET"
_SERVING_ROLE = "SERVING_DATASET"


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Tag internal sub-table variants as MART_DATASET.
    #    These are hidden from the dataset management list; visible only via
    #    the chart-creation datasource selector.
    #      - Legacy prefix:  "[KPI] <name>" / "[Map] <name>"
    #      - New-style suffix: _kpi / _map
    bind.execute(
        sa.text(
            "UPDATE tables SET dataset_role = :role "
            "WHERE extra LIKE '%dhis2_staged_dataset_id%' "
            "AND ("
            "    table_name LIKE '[KPI] %' "
            "    OR table_name LIKE '[Map] %' "
            "    OR table_name LIKE '%_kpi' "
            "    OR table_name LIKE '%_map' "
            ")"
        ),
        {"role": _MART_ROLE},
    )

    # 2. Tag the primary analytical mart (_mart suffix) as SERVING_DATASET.
    #    These are the user-facing datasets — visible in the dataset management
    #    list for editing (column descriptions, metrics, etc.) and also available
    #    in chart creation.
    bind.execute(
        sa.text(
            "UPDATE tables SET dataset_role = :role "
            "WHERE extra LIKE '%dhis2_staged_dataset_id%' "
            "AND table_name LIKE '%_mart' "
            "AND table_name NOT LIKE '[KPI] %' "
            "AND table_name NOT LIKE '[Map] %' "
        ),
        {"role": _SERVING_ROLE},
    )

    # 3. Tag raw DHIS2 serving tables as DHIS2_SOURCE_DATASET.
    #    These are the base sv_{id}_{name} tables — auto-registered for
    #    monitoring. Hidden from the management list and chart creation.
    #    Only records not already tagged in steps 1 or 2 are touched.
    bind.execute(
        sa.text(
            "UPDATE tables SET dataset_role = :role "
            "WHERE extra LIKE '%dhis2_staged_dataset_id%' "
            "AND table_name NOT LIKE '[KPI] %' "
            "AND table_name NOT LIKE '[Map] %' "
            "AND table_name NOT LIKE '%_mart' "
            "AND table_name NOT LIKE '%_kpi' "
            "AND table_name NOT LIKE '%_map' "
            "AND (dataset_role = :serving OR dataset_role IS NULL)"
        ),
        {"role": _SOURCE_ROLE, "serving": _SERVING_ROLE},
    )


def downgrade() -> None:
    bind = op.get_bind()

    # Restore all DHIS2-tagged datasets to SERVING_DATASET.
    bind.execute(
        sa.text(
            "UPDATE tables SET dataset_role = :role "
            "WHERE dataset_role IN (:mart, :source)"
        ),
        {"role": _SERVING_ROLE, "mart": _MART_ROLE, "source": _SOURCE_ROLE},
    )
