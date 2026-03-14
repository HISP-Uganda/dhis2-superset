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
"""Compatibility tests for resolving DHIS2 database connections to instances."""

import tests.dhis2._bootstrap  # noqa: F401 - must be first

from unittest.mock import patch

from superset.dhis2.models import DHIS2Instance


def _inst(**kw) -> DHIS2Instance:
    instance = DHIS2Instance.__new__(DHIS2Instance)
    instance.__dict__.update(
        dict(
            id=1,
            database_id=10,
            name="default",
            url="https://dhis2.example.org",
            auth_type="basic",
            username="admin",
            password="district",
            access_token=None,
            is_active=True,
            description=None,
            display_order=0,
            last_test_status=None,
            last_test_message=None,
            last_test_response_time_ms=None,
            last_tested_on=None,
            created_by_fk=None,
            changed_by_fk=None,
            created_on=None,
            changed_on=None,
        )
    )
    instance.__dict__.update(kw)
    return instance


def test_instance_resolution_prefers_existing_rows():
    from superset.dhis2 import instance_service

    existing = [_inst(id=11, is_active=True), _inst(id=12, is_active=False)]

    with patch(
        "superset.dhis2.instance_service.get_instances",
        return_value=existing,
    ) as get_instances, patch(
        "superset.dhis2.instance_service.get_or_create_legacy_instance",
    ) as legacy:
        result = instance_service.get_instances_with_legacy_fallback(5)

    get_instances.assert_called_once_with(5, include_inactive=True)
    legacy.assert_not_called()
    assert [instance.id for instance in result] == [11]


def test_instance_resolution_can_include_inactive_rows():
    from superset.dhis2 import instance_service

    existing = [_inst(id=11, is_active=True), _inst(id=12, is_active=False)]

    with patch(
        "superset.dhis2.instance_service.get_instances",
        return_value=existing,
    ), patch(
        "superset.dhis2.instance_service.get_or_create_legacy_instance",
    ) as legacy:
        result = instance_service.get_instances_with_legacy_fallback(
            5,
            include_inactive=True,
        )

    legacy.assert_not_called()
    assert [instance.id for instance in result] == [11, 12]


def test_instance_resolution_creates_legacy_default_when_missing():
    from superset.dhis2 import instance_service

    compat = _inst(id=90, name="default", is_active=True)

    with patch(
        "superset.dhis2.instance_service.get_instances",
        return_value=[],
    ), patch(
        "superset.dhis2.instance_service.get_or_create_legacy_instance",
        return_value=compat,
    ) as legacy:
        result = instance_service.get_instances_with_legacy_fallback(7)

    legacy.assert_called_once_with(7)
    assert result == [compat]
