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
DHIS2 Warehouse Normalization Service

Reads raw payloads from audit tables and normalises them into typed
dimension and fact tables. All DB operations use db.session.execute(text(...))
to match the project pattern.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import text

from superset import db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Period parsing helpers
# ---------------------------------------------------------------------------

_PERIOD_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Annual: 2024
    (re.compile(r"^(\d{4})$"), "YEARLY"),
    # Six-monthly: 2024S1, 2024S2
    (re.compile(r"^(\d{4})S(\d)$"), "SIXMONTHLY"),
    # Six-monthly April: 2024AprilS1
    (re.compile(r"^(\d{4})AprilS(\d)$"), "SIXMONTHLYAPRIL"),
    # Quarterly: 2024Q1
    (re.compile(r"^(\d{4})Q(\d)$"), "QUARTERLY"),
    # BiMonthly: 202401B
    (re.compile(r"^(\d{4})(\d{2})B$"), "BIMONTHLY"),
    # Monthly: 202401
    (re.compile(r"^(\d{4})(\d{2})$"), "MONTHLY"),
    # Weekly: 2024W1
    (re.compile(r"^(\d{4})W(\d{1,2})$"), "WEEKLY"),
    # Financial year: 2024April, 2024July, 2024Oct, 2024Nov
    (re.compile(r"^(\d{4})(April|July|Oct|Nov)$"), "FINANCIAL"),
    # Daily: 20240101
    (re.compile(r"^(\d{4})(\d{2})(\d{2})$"), "DAILY"),
]

_MONTH_STARTS = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12}
_QUARTER_MONTH_START = {1: 1, 2: 4, 3: 7, 4: 10}


def _parse_period(period_id: str) -> dict[str, Any]:
    """Parse a DHIS2 period string into dimension fields.

    Returns a dict with keys: period_type, year, quarter, month, week,
    start_date, end_date, sortable_key.
    """
    result: dict[str, Any] = {
        "period_type": None,
        "year": None,
        "quarter": None,
        "month": None,
        "week": None,
        "start_date": None,
        "end_date": None,
        "sortable_key": period_id,
    }

    # Annual
    m = re.match(r"^(\d{4})$", period_id)
    if m:
        yr = int(m.group(1))
        result.update(
            period_type="YEARLY",
            year=yr,
            start_date=date(yr, 1, 1),
            end_date=date(yr, 12, 31),
            sortable_key=f"{yr}0000",
        )
        return result

    # Quarterly
    m = re.match(r"^(\d{4})Q(\d)$", period_id)
    if m:
        yr, q = int(m.group(1)), int(m.group(2))
        sm = _QUARTER_MONTH_START.get(q, 1)
        em = sm + 2
        try:
            import calendar
            _, last_day = calendar.monthrange(yr, em)
            result.update(
                period_type="QUARTERLY",
                year=yr,
                quarter=q,
                start_date=date(yr, sm, 1),
                end_date=date(yr, em, last_day),
                sortable_key=f"{yr}{q:02d}00",
            )
        except Exception:  # pylint: disable=broad-except
            pass
        return result

    # Monthly
    m = re.match(r"^(\d{4})(\d{2})$", period_id)
    if m:
        yr, mo = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12:
            import calendar
            _, last_day = calendar.monthrange(yr, mo)
            result.update(
                period_type="MONTHLY",
                year=yr,
                month=mo,
                start_date=date(yr, mo, 1),
                end_date=date(yr, mo, last_day),
                sortable_key=f"{yr}{mo:02d}00",
            )
        return result

    # Weekly
    m = re.match(r"^(\d{4})W(\d{1,2})$", period_id)
    if m:
        yr, wk = int(m.group(1)), int(m.group(2))
        try:
            import datetime as dt
            jan4 = dt.date(yr, 1, 4)
            # ISO week 1 Monday
            start = jan4 - dt.timedelta(days=jan4.weekday()) + dt.timedelta(weeks=wk - 1)
            end = start + dt.timedelta(days=6)
            result.update(
                period_type="WEEKLY",
                year=yr,
                week=wk,
                start_date=start,
                end_date=end,
                sortable_key=f"{yr}00{wk:02d}",
            )
        except Exception:  # pylint: disable=broad-except
            pass
        return result

    # Daily
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", period_id)
    if m:
        yr, mo, dy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            d = date(yr, mo, dy)
            result.update(
                period_type="DAILY",
                year=yr,
                month=mo,
                start_date=d,
                end_date=d,
                sortable_key=f"{yr}{mo:02d}{dy:02d}",
            )
        except Exception:  # pylint: disable=broad-except
            pass
        return result

    return result


# ---------------------------------------------------------------------------
# Warehouse service
# ---------------------------------------------------------------------------


class DHIS2WarehouseService:
    """Normalises raw DHIS2 payloads into typed dimension and fact tables."""

    # ------------------------------------------------------------------
    # Analytics normalization
    # ------------------------------------------------------------------

    def normalize_analytics_to_fact(
        self, batch_id: str, dataset_config_id: int
    ) -> int:
        """Read stg_dhis2_analytics_raw rows for batch_id and normalize to fact_dhis2_analytics.

        Returns the number of fact rows inserted/updated.
        """
        rows_result = db.session.execute(
            text(
                "SELECT id, rows_json, metadata_json, headers_json, extracted_at "
                "FROM stg_dhis2_analytics_raw "
                "WHERE batch_id = :batch_id AND dataset_config_id = :dc_id"
            ),
            {"batch_id": batch_id, "dc_id": dataset_config_id},
        )
        raw_rows = rows_result.fetchall()
        if not raw_rows:
            return 0

        total_inserted = 0
        now = datetime.utcnow()

        for raw_row in raw_rows:
            try:
                rows_data = json.loads(raw_row[1] or "[]")
                headers_data = json.loads(raw_row[3] or "[]")
            except (json.JSONDecodeError, TypeError):
                continue

            # Build column index from headers
            col_index: dict[str, int] = {}
            for i, h in enumerate(headers_data):
                col_name = h.get("name", "") if isinstance(h, dict) else str(h)
                col_index[col_name] = i

            dx_idx = col_index.get("dx", col_index.get("dx_uid", 0))
            pe_idx = col_index.get("pe", col_index.get("period", 1))
            ou_idx = col_index.get("ou", col_index.get("ou_uid", 2))
            val_idx = col_index.get("value", len(col_index) - 1)
            coc_idx = col_index.get("co", None)
            aoc_idx = col_index.get("ao", None)
            num_idx = col_index.get("numerator", None)
            den_idx = col_index.get("denominator", None)

            for data_row in rows_data:
                if not isinstance(data_row, (list, tuple)):
                    continue
                if len(data_row) <= max(dx_idx, pe_idx, ou_idx, val_idx):
                    continue

                dx_val = data_row[dx_idx] if dx_idx < len(data_row) else None
                pe_val = data_row[pe_idx] if pe_idx < len(data_row) else None
                ou_val = data_row[ou_idx] if ou_idx < len(data_row) else None
                value = data_row[val_idx] if val_idx < len(data_row) else None
                coc = data_row[coc_idx] if coc_idx is not None and coc_idx < len(data_row) else None
                aoc = data_row[aoc_idx] if aoc_idx is not None and aoc_idx < len(data_row) else None
                num = data_row[num_idx] if num_idx is not None and num_idx < len(data_row) else None
                den = data_row[den_idx] if den_idx is not None and den_idx < len(data_row) else None

                period_info = _parse_period(pe_val) if pe_val else {}

                db.session.execute(
                    text(
                        "INSERT INTO fact_dhis2_analytics "
                        "(instance_id, dataset_config_id, batch_id, data_item_uid, "
                        " period_id, period_start_date, org_unit_uid, "
                        " category_option_combo_uid, attribute_option_combo_uid, "
                        " value, numerator, denominator, inserted_at) "
                        "VALUES "
                        "(:instance_id, :dc_id, :batch_id, :dx, "
                        " :pe, :pe_start, :ou, "
                        " :coc, :aoc, "
                        " :value, :num, :den, :now) "
                    ),
                    {
                        "instance_id": dataset_config_id,  # proxy; callers may override
                        "dc_id": dataset_config_id,
                        "batch_id": batch_id,
                        "dx": dx_val,
                        "pe": pe_val,
                        "pe_start": period_info.get("start_date"),
                        "ou": ou_val,
                        "coc": coc,
                        "aoc": aoc,
                        "value": str(value) if value is not None else None,
                        "num": str(num) if num is not None else None,
                        "den": str(den) if den is not None else None,
                        "now": now,
                    },
                )
                total_inserted += 1

        db.session.commit()
        return total_inserted

    # ------------------------------------------------------------------
    # DataValueSet normalization
    # ------------------------------------------------------------------

    def normalize_datavalues_to_fact(
        self, batch_id: str, dataset_config_id: int
    ) -> int:
        """Read stg_dhis2_datavalueset_raw rows for batch_id and normalize to fact_dhis2_datavalue.

        Returns the number of fact rows inserted.
        """
        rows_result = db.session.execute(
            text(
                "SELECT id, data_json, extracted_at "
                "FROM stg_dhis2_datavalueset_raw "
                "WHERE batch_id = :batch_id AND dataset_config_id = :dc_id"
            ),
            {"batch_id": batch_id, "dc_id": dataset_config_id},
        )
        raw_rows = rows_result.fetchall()
        if not raw_rows:
            return 0

        total_inserted = 0
        now = datetime.utcnow()

        for raw_row in raw_rows:
            try:
                data_values = json.loads(raw_row[1] or "[]")
                if isinstance(data_values, dict):
                    data_values = data_values.get("dataValues", [])
            except (json.JSONDecodeError, TypeError):
                continue

            for dv in data_values:
                if not isinstance(dv, dict):
                    continue

                pe_val = dv.get("period")
                period_info = _parse_period(pe_val) if pe_val else {}

                db.session.execute(
                    text(
                        "INSERT INTO fact_dhis2_datavalue "
                        "(instance_id, dataset_config_id, batch_id, "
                        " data_element_uid, data_set_uid, "
                        " period_id, period_start_date, org_unit_uid, "
                        " category_option_combo_uid, attribute_option_combo_uid, "
                        " value, stored_by, created, last_updated, "
                        " comment, follow_up, deleted_flag, inserted_at) "
                        "VALUES "
                        "(:instance_id, :dc_id, :batch_id, "
                        " :de, :ds, "
                        " :pe, :pe_start, :ou, "
                        " :coc, :aoc, "
                        " :value, :stored_by, :created, :last_updated, "
                        " :comment, :follow_up, :deleted_flag, :now)"
                    ),
                    {
                        "instance_id": dataset_config_id,
                        "dc_id": dataset_config_id,
                        "batch_id": batch_id,
                        "de": dv.get("dataElement"),
                        "ds": dv.get("dataSet"),
                        "pe": pe_val,
                        "pe_start": period_info.get("start_date"),
                        "ou": dv.get("orgUnit"),
                        "coc": dv.get("categoryOptionCombo"),
                        "aoc": dv.get("attributeOptionCombo"),
                        "value": dv.get("value"),
                        "stored_by": dv.get("storedBy"),
                        "created": dv.get("created"),
                        "last_updated": dv.get("lastUpdated"),
                        "comment": dv.get("comment"),
                        "follow_up": dv.get("followUp", False),
                        "deleted_flag": dv.get("deleted", False),
                        "now": now,
                    },
                )
                total_inserted += 1

        db.session.commit()
        return total_inserted

    # ------------------------------------------------------------------
    # Dimension upserts
    # ------------------------------------------------------------------

    def upsert_dim_org_unit(
        self, instance_id: int, org_units: list[dict[str, Any]]
    ) -> int:
        """Upsert org unit dimension rows.

        Parameters
        ----------
        instance_id:
            The DHIS2 instance PK.
        org_units:
            List of org unit dicts (from metadata snapshot).  Each dict
            should have at minimum: uid, name, level, path.

        Returns the number of rows upserted.
        """
        count = 0
        now = datetime.utcnow()
        for ou in org_units:
            uid = ou.get("id") or ou.get("uid")
            if not uid:
                continue
            db.session.execute(
                text(
                    "INSERT INTO dim_dhis2_org_unit "
                    "(instance_id, org_unit_uid, name, short_name, code, "
                    " level, path, parent_uid, opening_date, closed_date, "
                    " geometry_json, attributes_json, refreshed_at) "
                    "VALUES "
                    "(:inst, :uid, :name, :short_name, :code, "
                    " :level, :path, :parent_uid, :opening_date, :closed_date, "
                    " :geometry, :attrs, :now) "
                    "ON CONFLICT (instance_id, org_unit_uid) DO UPDATE SET "
                    " name = EXCLUDED.name, "
                    " short_name = EXCLUDED.short_name, "
                    " code = EXCLUDED.code, "
                    " level = EXCLUDED.level, "
                    " path = EXCLUDED.path, "
                    " parent_uid = EXCLUDED.parent_uid, "
                    " opening_date = EXCLUDED.opening_date, "
                    " closed_date = EXCLUDED.closed_date, "
                    " geometry_json = EXCLUDED.geometry_json, "
                    " attributes_json = EXCLUDED.attributes_json, "
                    " refreshed_at = EXCLUDED.refreshed_at"
                ),
                {
                    "inst": instance_id,
                    "uid": uid,
                    "name": ou.get("displayName") or ou.get("name"),
                    "short_name": ou.get("displayShortName") or ou.get("shortName"),
                    "code": ou.get("code"),
                    "level": ou.get("level"),
                    "path": ou.get("path"),
                    "parent_uid": (ou.get("parent") or {}).get("id"),
                    "opening_date": ou.get("openingDate"),
                    "closed_date": ou.get("closedDate"),
                    "geometry": json.dumps(ou["geometry"]) if ou.get("geometry") else None,
                    "attrs": json.dumps(ou.get("attributeValues")) if ou.get("attributeValues") else None,
                    "now": now,
                },
            )
            count += 1
        db.session.commit()
        return count

    def upsert_dim_data_item(
        self, instance_id: int, data_items: list[dict[str, Any]]
    ) -> int:
        """Upsert data item dimension rows.

        Parameters
        ----------
        instance_id:
            The DHIS2 instance PK.
        data_items:
            List of data item dicts.  Each dict should have at minimum:
            id/uid, name, valueType, aggregationType.

        Returns the number of rows upserted.
        """
        count = 0
        now = datetime.utcnow()
        for item in data_items:
            uid = item.get("id") or item.get("uid")
            if not uid:
                continue
            db.session.execute(
                text(
                    "INSERT INTO dim_dhis2_data_item "
                    "(instance_id, data_item_uid, data_item_type, name, short_name, "
                    " code, description, value_type, aggregation_type, "
                    " attributes_json, refreshed_at) "
                    "VALUES "
                    "(:inst, :uid, :dtype, :name, :short_name, "
                    " :code, :desc, :vtype, :agg_type, "
                    " :attrs, :now) "
                    "ON CONFLICT (instance_id, data_item_uid) DO UPDATE SET "
                    " data_item_type = EXCLUDED.data_item_type, "
                    " name = EXCLUDED.name, "
                    " short_name = EXCLUDED.short_name, "
                    " code = EXCLUDED.code, "
                    " description = EXCLUDED.description, "
                    " value_type = EXCLUDED.value_type, "
                    " aggregation_type = EXCLUDED.aggregation_type, "
                    " attributes_json = EXCLUDED.attributes_json, "
                    " refreshed_at = EXCLUDED.refreshed_at"
                ),
                {
                    "inst": instance_id,
                    "uid": uid,
                    "dtype": item.get("type") or item.get("itemType"),
                    "name": item.get("displayName") or item.get("name"),
                    "short_name": item.get("displayShortName") or item.get("shortName"),
                    "code": item.get("code"),
                    "desc": item.get("displayDescription") or item.get("description"),
                    "vtype": item.get("valueType"),
                    "agg_type": item.get("aggregationType"),
                    "attrs": json.dumps(item.get("attributeValues")) if item.get("attributeValues") else None,
                    "now": now,
                },
            )
            count += 1
        db.session.commit()
        return count

    def upsert_dim_period(
        self, instance_id: int, periods: list[str]
    ) -> int:
        """Upsert period dimension rows by parsing DHIS2 period strings.

        Parameters
        ----------
        instance_id:
            The DHIS2 instance PK.
        periods:
            List of DHIS2 period ID strings (e.g. "202301", "2023Q1").

        Returns the number of rows upserted.
        """
        count = 0
        now = datetime.utcnow()
        for period_id in periods:
            info = _parse_period(period_id)
            db.session.execute(
                text(
                    "INSERT INTO dim_dhis2_period "
                    "(instance_id, period_id, period_type, start_date, end_date, "
                    " year, quarter, month, week, sortable_key) "
                    "VALUES "
                    "(:inst, :pid, :ptype, :start_date, :end_date, "
                    " :year, :quarter, :month, :week, :sortable_key) "
                    "ON CONFLICT (instance_id, period_id) DO UPDATE SET "
                    " period_type = EXCLUDED.period_type, "
                    " start_date = EXCLUDED.start_date, "
                    " end_date = EXCLUDED.end_date, "
                    " year = EXCLUDED.year, "
                    " quarter = EXCLUDED.quarter, "
                    " month = EXCLUDED.month, "
                    " week = EXCLUDED.week, "
                    " sortable_key = EXCLUDED.sortable_key"
                ),
                {
                    "inst": instance_id,
                    "pid": period_id,
                    "ptype": info.get("period_type"),
                    "start_date": info.get("start_date"),
                    "end_date": info.get("end_date"),
                    "year": info.get("year"),
                    "quarter": info.get("quarter"),
                    "month": info.get("month"),
                    "week": info.get("week"),
                    "sortable_key": info.get("sortable_key"),
                },
            )
            count += 1
        db.session.commit()
        return count
