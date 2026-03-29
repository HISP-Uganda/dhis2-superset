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
from typing import Any
from flask_babel import lazy_gettext as _
from sqlalchemy import and_, not_, or_
from sqlalchemy.orm.query import Query

from superset.connectors.sqla.models import SqlaTable
from superset.datasets.policy import DatasetContext, DatasetEligibilityPolicy, DatasetRole
from superset.views.base import BaseFilter


class DatasetIsNullOrEmptyFilter(BaseFilter):  # pylint: disable=too-few-public-methods
    name = _("Null or Empty")
    arg_name = "dataset_is_null_or_empty"

    def apply(self, query: Query, value: bool) -> Query:
        filter_clause = or_(SqlaTable.sql.is_(None), SqlaTable.sql == "")

        if not value:
            filter_clause = not_(filter_clause)

        return query.filter(filter_clause)


class DatasetCertifiedFilter(BaseFilter):  # pylint: disable=too-few-public-methods
    name = _("Is certified")
    arg_name = "dataset_is_certified"

    def apply(self, query: Query, value: bool) -> Query:
        check_value = '%"certification":%'
        if value is True:
            return query.filter(SqlaTable.extra.ilike(check_value))
        if value is False:
            return query.filter(
                or_(
                    SqlaTable.extra.notlike(check_value),
                    SqlaTable.extra.is_(None),
                )
            )
        return query


class DatasetContextFilter(BaseFilter):  # pylint: disable=too-few-public-methods
    name = _("Dataset Context")
    arg_name = "dataset_context"

    def apply(self, query: Query, value: str) -> Query:
        try:
            context = DatasetContext(value)
        except ValueError:
            return query

        allowed_roles = DatasetEligibilityPolicy.get_allowed_roles(context)
        role_values = [r.value for r in allowed_roles]
        query = query.filter(SqlaTable.dataset_role.in_(role_values))
        if context in {
            DatasetContext.CHART,
            DatasetContext.DASHBOARD,
            DatasetContext.EXPLORE,
            DatasetContext.ANALYSIS,
        }:
            staged_local_metadata_clause = and_(
                SqlaTable.dataset_role == DatasetRole.METADATA.value,
                or_(
                    SqlaTable.extra.like('%"dhis2_staged_local": true%'),
                    SqlaTable.extra.like('%"dhis2_staged_local":true%'),
                ),
            )
            query = query.filter(not_(staged_local_metadata_clause))
        return query


class DatasetRoleDefaultFilter(BaseFilter):
    name = _("Dataset Role Default")
    arg_name = "dataset_role_default"

    def apply(self, query: Query, value: Any) -> Query:
        from flask import request
        import prison

        # Do not apply the default filter to single item GET/PUT/DELETE requests.
        if request.view_args and "pk" in request.view_args:
            return query

        explicit_dataset_role_filter = False
        q = request.args.get("q", "")
        if q:
            try:
                q_dict = prison.loads(q)
                filters = q_dict.get("filters", [])
                for f in filters:
                    if f.get("col") == "dataset_role":
                        explicit_dataset_role_filter = True
                        break
            except Exception:
                pass

        if explicit_dataset_role_filter:
            return query

        # Default dataset management list shows only editable METADATA datasets.
        # Analytical MART/source registrations are hidden unless explicitly
        # requested by role/dataset_context.
        return query.filter(
            SqlaTable.dataset_role == DatasetRole.METADATA.value
        )
