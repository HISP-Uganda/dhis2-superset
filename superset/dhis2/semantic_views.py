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
DHIS2 Semantic SQL Views

Creates/replaces seven analytical views over the warehouse fact and dimension
tables.  Call ``create_semantic_views(db.engine)`` after warehouse normalization
completes to keep views in sync with any schema changes.
"""

from __future__ import annotations

import logging

import sqlalchemy as sa

logger = logging.getLogger(__name__)

# Each entry: (view_name, CREATE OR REPLACE VIEW ... SQL)
_VIEW_DEFINITIONS: list[tuple[str, str]] = [
    # -----------------------------------------------------------------------
    # 1. Indicator time series
    # -----------------------------------------------------------------------
    (
        "vw_dhis2_indicator_timeseries",
        """
        CREATE OR REPLACE VIEW vw_dhis2_indicator_timeseries AS
        SELECT
            fa.instance_id,
            fa.dataset_config_id,
            fa.data_item_uid,
            di.name                        AS data_item_name,
            di.data_item_type,
            di.value_type,
            fa.period_id,
            dp.period_type,
            dp.year,
            dp.quarter,
            dp.month,
            dp.start_date                  AS period_start_date,
            dp.end_date                    AS period_end_date,
            dp.sortable_key,
            fa.org_unit_uid,
            fa.category_option_combo_uid,
            fa.value,
            fa.numerator,
            fa.denominator,
            fa.inserted_at
        FROM fact_dhis2_analytics fa
        LEFT JOIN dim_dhis2_data_item di
            ON di.instance_id = fa.instance_id
           AND di.data_item_uid = fa.data_item_uid
        LEFT JOIN dim_dhis2_period dp
            ON dp.instance_id = fa.instance_id
           AND dp.period_id = fa.period_id
        WHERE di.data_item_type IN ('indicator', 'programIndicator')
           OR di.data_item_type IS NULL
        """,
    ),
    # -----------------------------------------------------------------------
    # 2. Data element by org unit and period
    # -----------------------------------------------------------------------
    (
        "vw_dhis2_dataelement_by_org_period",
        """
        CREATE OR REPLACE VIEW vw_dhis2_dataelement_by_org_period AS
        SELECT
            fa.instance_id,
            fa.dataset_config_id,
            fa.data_item_uid,
            di.name                        AS data_item_name,
            di.data_item_type,
            di.value_type,
            di.aggregation_type,
            fa.period_id,
            dp.period_type,
            dp.year,
            dp.quarter,
            dp.month,
            dp.start_date                  AS period_start_date,
            dp.sortable_key,
            fa.org_unit_uid,
            ou.name                        AS org_unit_name,
            ou.level                       AS org_unit_level,
            ou.path                        AS org_unit_path,
            fa.category_option_combo_uid,
            fa.attribute_option_combo_uid,
            fa.value,
            fa.inserted_at
        FROM fact_dhis2_analytics fa
        LEFT JOIN dim_dhis2_data_item di
            ON di.instance_id = fa.instance_id
           AND di.data_item_uid = fa.data_item_uid
        LEFT JOIN dim_dhis2_period dp
            ON dp.instance_id = fa.instance_id
           AND dp.period_id = fa.period_id
        LEFT JOIN dim_dhis2_org_unit ou
            ON ou.instance_id = fa.instance_id
           AND ou.org_unit_uid = fa.org_unit_uid
        """,
    ),
    # -----------------------------------------------------------------------
    # 3. Reporting rates
    # -----------------------------------------------------------------------
    (
        "vw_dhis2_reporting_rates",
        """
        CREATE OR REPLACE VIEW vw_dhis2_reporting_rates AS
        SELECT
            dv.instance_id,
            dv.dataset_config_id,
            dv.data_set_uid,
            dv.period_id,
            dp.year,
            dp.quarter,
            dp.month,
            dp.start_date                  AS period_start_date,
            dv.org_unit_uid,
            ou.name                        AS org_unit_name,
            ou.level                       AS org_unit_level,
            COUNT(*)                        AS submission_count,
            COUNT(DISTINCT dv.data_element_uid) AS distinct_data_elements,
            MAX(dv.last_updated)            AS last_submission_at
        FROM fact_dhis2_datavalue dv
        LEFT JOIN dim_dhis2_period dp
            ON dp.instance_id = dv.instance_id
           AND dp.period_id = dv.period_id
        LEFT JOIN dim_dhis2_org_unit ou
            ON ou.instance_id = dv.instance_id
           AND ou.org_unit_uid = dv.org_unit_uid
        WHERE dv.deleted_flag = FALSE
        GROUP BY
            dv.instance_id,
            dv.dataset_config_id,
            dv.data_set_uid,
            dv.period_id,
            dp.year, dp.quarter, dp.month, dp.start_date,
            dv.org_unit_uid,
            ou.name, ou.level
        """,
    ),
    # -----------------------------------------------------------------------
    # 4. Dataset completeness
    # -----------------------------------------------------------------------
    (
        "vw_dhis2_dataset_completeness",
        """
        CREATE OR REPLACE VIEW vw_dhis2_dataset_completeness AS
        SELECT
            rr.instance_id,
            rr.dataset_config_id,
            rr.data_set_uid,
            rr.period_id,
            rr.year,
            rr.quarter,
            rr.month,
            rr.period_start_date,
            rr.org_unit_uid,
            rr.org_unit_name,
            rr.org_unit_level,
            rr.submission_count,
            rr.distinct_data_elements,
            expected.expected_org_units,
            CASE
                WHEN expected.expected_org_units > 0
                THEN ROUND(
                    100.0 * COUNT(DISTINCT rr.org_unit_uid) OVER (
                        PARTITION BY rr.instance_id, rr.data_set_uid, rr.period_id
                    ) / expected.expected_org_units, 2
                )
                ELSE NULL
            END AS completeness_pct
        FROM vw_dhis2_reporting_rates rr
        LEFT JOIN (
            SELECT instance_id, COUNT(*) AS expected_org_units
            FROM dim_dhis2_org_unit
            GROUP BY instance_id
        ) expected ON expected.instance_id = rr.instance_id
        """,
    ),
    # -----------------------------------------------------------------------
    # 5. Raw data values flat view
    # -----------------------------------------------------------------------
    (
        "vw_dhis2_raw_datavalues",
        """
        CREATE OR REPLACE VIEW vw_dhis2_raw_datavalues AS
        SELECT
            dv.id,
            dv.instance_id,
            dv.dataset_config_id,
            dv.batch_id,
            dv.data_element_uid,
            di.name                        AS data_element_name,
            di.value_type,
            di.aggregation_type,
            dv.data_set_uid,
            dv.period_id,
            dp.period_type,
            dp.year,
            dp.quarter,
            dp.month,
            dp.start_date                  AS period_start_date,
            dv.org_unit_uid,
            ou.name                        AS org_unit_name,
            ou.level                       AS org_unit_level,
            ou.path                        AS org_unit_path,
            dv.category_option_combo_uid,
            dv.attribute_option_combo_uid,
            dv.value,
            dv.stored_by,
            dv.created,
            dv.last_updated,
            dv.comment,
            dv.follow_up,
            dv.deleted_flag,
            dv.inserted_at
        FROM fact_dhis2_datavalue dv
        LEFT JOIN dim_dhis2_data_item di
            ON di.instance_id = dv.instance_id
           AND di.data_item_uid = dv.data_element_uid
        LEFT JOIN dim_dhis2_period dp
            ON dp.instance_id = dv.instance_id
           AND dp.period_id = dv.period_id
        LEFT JOIN dim_dhis2_org_unit ou
            ON ou.instance_id = dv.instance_id
           AND ou.org_unit_uid = dv.org_unit_uid
        """,
    ),
    # -----------------------------------------------------------------------
    # 6. Category breakdowns
    # -----------------------------------------------------------------------
    (
        "vw_dhis2_category_breakdowns",
        """
        CREATE OR REPLACE VIEW vw_dhis2_category_breakdowns AS
        SELECT
            fa.instance_id,
            fa.dataset_config_id,
            fa.data_item_uid,
            di.name                        AS data_item_name,
            di.data_item_type,
            fa.period_id,
            dp.year,
            dp.quarter,
            dp.month,
            dp.start_date                  AS period_start_date,
            fa.org_unit_uid,
            ou.name                        AS org_unit_name,
            fa.category_option_combo_uid,
            fa.attribute_option_combo_uid,
            fa.value,
            fa.inserted_at
        FROM fact_dhis2_analytics fa
        LEFT JOIN dim_dhis2_data_item di
            ON di.instance_id = fa.instance_id
           AND di.data_item_uid = fa.data_item_uid
        LEFT JOIN dim_dhis2_period dp
            ON dp.instance_id = fa.instance_id
           AND dp.period_id = fa.period_id
        LEFT JOIN dim_dhis2_org_unit ou
            ON ou.instance_id = fa.instance_id
           AND ou.org_unit_uid = fa.org_unit_uid
        WHERE fa.category_option_combo_uid IS NOT NULL
        """,
    ),
    # -----------------------------------------------------------------------
    # 7. Org unit performance rollup (path-based hierarchy)
    # -----------------------------------------------------------------------
    (
        "vw_dhis2_orgunit_performance",
        """
        CREATE OR REPLACE VIEW vw_dhis2_orgunit_performance AS
        SELECT
            fa.instance_id,
            fa.dataset_config_id,
            ou.org_unit_uid,
            ou.name                        AS org_unit_name,
            ou.level                       AS org_unit_level,
            ou.path                        AS org_unit_path,
            fa.period_id,
            dp.year,
            dp.quarter,
            dp.month,
            dp.start_date                  AS period_start_date,
            fa.data_item_uid,
            di.name                        AS data_item_name,
            di.data_item_type,
            COUNT(*)                        AS row_count,
            AVG(
                CASE WHEN fa.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
                     THEN fa.value::NUMERIC
                     ELSE NULL
                END
            )                               AS avg_value,
            SUM(
                CASE WHEN fa.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
                     THEN fa.value::NUMERIC
                     ELSE NULL
                END
            )                               AS sum_value
        FROM fact_dhis2_analytics fa
        JOIN dim_dhis2_org_unit ou
            ON ou.instance_id = fa.instance_id
           AND ou.org_unit_uid = fa.org_unit_uid
        LEFT JOIN dim_dhis2_period dp
            ON dp.instance_id = fa.instance_id
           AND dp.period_id = fa.period_id
        LEFT JOIN dim_dhis2_data_item di
            ON di.instance_id = fa.instance_id
           AND di.data_item_uid = fa.data_item_uid
        GROUP BY
            fa.instance_id,
            fa.dataset_config_id,
            ou.org_unit_uid,
            ou.name,
            ou.level,
            ou.path,
            fa.period_id,
            dp.year, dp.quarter, dp.month, dp.start_date,
            fa.data_item_uid,
            di.name, di.data_item_type
        """,
    ),
]


def create_semantic_views(bind: sa.engine.Engine) -> None:
    """Create or replace all seven DHIS2 semantic views.

    Safe to call repeatedly; uses ``CREATE OR REPLACE VIEW`` so existing
    view definitions are updated in place.

    Parameters
    ----------
    bind:
        SQLAlchemy engine bound to the Superset metadata database.
    """
    with bind.connect() as conn:
        for view_name, ddl in _VIEW_DEFINITIONS:
            try:
                conn.execute(sa.text(ddl.strip()))
                logger.info("semantic_views: created/replaced %s", view_name)
            except Exception:  # pylint: disable=broad-except
                logger.warning(
                    "semantic_views: failed to create %s — "
                    "warehouse tables may not exist yet",
                    view_name,
                    exc_info=True,
                )
