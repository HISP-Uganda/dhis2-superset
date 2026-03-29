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

from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from marshmallow import ValidationError

from superset.commands.database.create import CreateDatabaseCommand
from superset.commands.database.exceptions import DatabaseCreateFailedError
from superset.exceptions import OAuth2RedirectError
from superset.extensions import security_manager


@pytest.fixture
def database_with_catalog(mocker: MockerFixture) -> MagicMock:
    """
    Mock a database with catalogs and schemas.
    """
    mocker.patch("superset.commands.database.create.TestConnectionDatabaseCommand")

    database = mocker.MagicMock()
    database.database_name = "test_database"
    database.db_engine_spec.__name__ = "test_engine"
    database.db_engine_spec.supports_catalog = True
    database.get_all_catalog_names.return_value = ["catalog1", "catalog2"]
    database.get_all_schema_names.side_effect = [
        {"schema1", "schema2"},
        {"schema3", "schema4"},
    ]
    database.repository_reporting_unit_approach = None

    DatabaseDAO = mocker.patch("superset.commands.database.create.DatabaseDAO")  # noqa: N806
    DatabaseDAO.create.return_value = database

    return database


@pytest.fixture
def database_without_catalog(mocker: MockerFixture) -> MagicMock:
    """
    Mock a database without catalogs.
    """
    mocker.patch("superset.commands.database.create.TestConnectionDatabaseCommand")

    database = mocker.MagicMock()
    database.database_name = "test_database"
    database.db_engine_spec.__name__ = "test_engine"
    database.db_engine_spec.supports_catalog = False
    database.get_all_schema_names.return_value = ["schema1", "schema2"]
    database.repository_reporting_unit_approach = None

    DatabaseDAO = mocker.patch("superset.commands.database.create.DatabaseDAO")  # noqa: N806
    DatabaseDAO.create.return_value = database

    return database


def test_create_permissions_with_catalog(
    mocker: MockerFixture,
    database_with_catalog: MockerFixture,
) -> None:
    """
    Test that permissions are created when a database with a catalog is created.
    """
    add_permission_view_menu = mocker.patch.object(
        security_manager,
        "add_permission_view_menu",
    )

    CreateDatabaseCommand(
        {
            "database_name": "test_database",
            "sqlalchemy_uri": "sqlite://",
        }
    ).run()

    add_permission_view_menu.assert_has_calls(
        [
            mocker.call("catalog_access", "[test_database].[catalog1]"),
            mocker.call("catalog_access", "[test_database].[catalog2]"),
            mocker.call("schema_access", "[test_database].[catalog1].[schema1]"),
            mocker.call("schema_access", "[test_database].[catalog1].[schema2]"),
            mocker.call("schema_access", "[test_database].[catalog2].[schema3]"),
            mocker.call("schema_access", "[test_database].[catalog2].[schema4]"),
        ],
        any_order=True,
    )


def test_create_permissions_without_catalog(
    mocker: MockerFixture,
    database_without_catalog: MockerFixture,
) -> None:
    """
    Test that permissions are created when a database without a catalog is created.
    """
    add_permission_view_menu = mocker.patch.object(
        security_manager,
        "add_permission_view_menu",
    )

    CreateDatabaseCommand(
        {
            "database_name": "test_database",
            "sqlalchemy_uri": "sqlite://",
        }
    ).run()

    add_permission_view_menu.assert_has_calls(
        [
            mocker.call("schema_access", "[test_database].[schema1]"),
            mocker.call("schema_access", "[test_database].[schema2]"),
        ],
        any_order=True,
    )


def test_create_with_oauth2(
    mocker: MockerFixture,
    database_without_catalog: MockerFixture,
) -> None:
    """
    Test that the database can be created even if OAuth2 is needed to connect.
    """
    TestConnectionDatabaseCommand = mocker.patch(  # noqa: N806
        "superset.commands.database.create.TestConnectionDatabaseCommand"
    )
    TestConnectionDatabaseCommand().run.side_effect = OAuth2RedirectError(
        "url",
        "tab_id",
        "redirect_uri",
    )
    add_permission_view_menu = mocker.patch.object(
        security_manager,
        "add_permission_view_menu",
    )

    CreateDatabaseCommand(
        {
            "database_name": "test_database",
            "sqlalchemy_uri": "sqlite://",
        }
    ).run()

    add_permission_view_menu.assert_not_called()


def test_create_dhis2_database_queues_metadata_refresh(
    mocker: MockerFixture,
    database_without_catalog: MockerFixture,
) -> None:
    database_without_catalog.id = 42
    database_without_catalog.backend = "dhis2"
    schedule_refresh = mocker.patch(
        "superset.commands.database.create.schedule_database_metadata_refresh_after_commit"
    )
    schedule_repository_finalization = mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.schedule_finalization_after_commit"
    )

    CreateDatabaseCommand(
        {
            "database_name": "dhis2_db",
            "sqlalchemy_uri": "dhis2://admin:district@example.org/api",
        }
    ).run()

    schedule_refresh.assert_called_once_with(42, reason="database_created")
    schedule_repository_finalization.assert_not_called()


def test_create_dhis2_shell_database_skips_live_connection_test(
    mocker: MockerFixture,
    database_without_catalog: MockerFixture,
) -> None:
    database_without_catalog.id = 44
    database_without_catalog.backend = "dhis2"
    test_connection_command = mocker.patch(
        "superset.commands.database.create.TestConnectionDatabaseCommand"
    )
    mocker.patch(
        "superset.commands.database.create.schedule_database_metadata_refresh_after_commit"
    )
    mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.schedule_finalization_after_commit"
    )

    CreateDatabaseCommand(
        {
            "database_name": "dhis2_shell_db",
            "sqlalchemy_uri": "dhis2://",
        }
    ).run()

    test_connection_command.return_value.run.assert_not_called()


def test_create_non_dhis2_database_does_not_queue_metadata_refresh(
    mocker: MockerFixture,
    database_without_catalog: MockerFixture,
) -> None:
    database_without_catalog.id = 43
    database_without_catalog.backend = "sqlite"
    schedule_refresh = mocker.patch(
        "superset.commands.database.create.schedule_database_metadata_refresh_after_commit"
    )
    schedule_repository_finalization = mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.schedule_finalization_after_commit"
    )

    CreateDatabaseCommand(
        {
            "database_name": "sqlite_db",
            "sqlalchemy_uri": "sqlite://",
        }
    ).run()

    schedule_refresh.assert_not_called()
    schedule_repository_finalization.assert_not_called()


def test_create_dhis2_database_persists_primary_instance_repository_reporting_units(
    mocker: MockerFixture,
    database_without_catalog: MagicMock,
) -> None:
    database_without_catalog.id = 46
    database_without_catalog.backend = "dhis2"
    database_without_catalog.repository_reporting_unit_approach = "primary_instance"
    repository_service = mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.validate_and_stage"
    )
    mocker.patch(
        "superset.commands.database.create.schedule_database_metadata_refresh_after_commit"
    )
    schedule_repository_finalization = mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.schedule_finalization_after_commit"
    )

    CreateDatabaseCommand(
        {
            "database_name": "dhis2_repository",
            "sqlalchemy_uri": "dhis2://",
            "repository_reporting_unit_approach": "primary_instance",
            "lowest_data_level_to_use": 2,
            "primary_instance_id": 101,
            "repository_data_scope": "children",
            "repository_org_unit_config": {
                "selected_org_units": ["OU_ROOT"],
                "selected_org_unit_details": [
                    {
                        "id": "OU_ROOT",
                        "selectionKey": "OU_ROOT",
                        "sourceOrgUnitId": "OU_ROOT",
                        "displayName": "Uganda",
                        "level": 1,
                        "path": "/OU_ROOT",
                        "sourceInstanceIds": [101],
                    }
                ],
            },
            "repository_org_units": [
                {
                    "repository_key": "OU_ROOT",
                    "display_name": "Uganda",
                    "level": 1,
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_instance_code": "A",
                            "source_org_unit_uid": "OU_ROOT",
                            "source_org_unit_name": "Uganda",
                            "source_level": 1,
                        }
                    ],
                }
            ],
        }
    ).run()

    _, payload = repository_service.call_args[0]
    assert payload.repository_reporting_unit_approach == "primary_instance"
    assert payload.lowest_data_level_to_use == 2
    assert payload.primary_instance_id == 101
    assert payload.repository_data_scope == "children"
    assert payload.repository_org_unit_config["selected_org_units"] == ["OU_ROOT"]
    assert payload.repository_org_unit_config["repository_org_units"][0]["lineage"][0][
        "source_org_unit_uid"
    ] == "OU_ROOT"
    schedule_repository_finalization.assert_called_once_with(46)


def test_create_dhis2_database_persists_map_merge_repository_reporting_units(
    mocker: MockerFixture,
    database_without_catalog: MagicMock,
) -> None:
    database_without_catalog.id = 47
    database_without_catalog.backend = "dhis2"
    database_without_catalog.repository_reporting_unit_approach = "map_merge"
    repository_service = mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.validate_and_stage"
    )
    mocker.patch(
        "superset.commands.database.create.schedule_database_metadata_refresh_after_commit"
    )
    schedule_repository_finalization = mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.schedule_finalization_after_commit"
    )

    CreateDatabaseCommand(
        {
            "database_name": "dhis2_repository",
            "sqlalchemy_uri": "dhis2://",
            "repository_reporting_unit_approach": "map_merge",
            "lowest_data_level_to_use": 2,
            "repository_data_scope": "ancestors",
            "repository_org_unit_config": {
                "selected_org_units": ["OU_A", "OU_B"],
                "level_mapping": {
                    "enabled": True,
                    "rows": [
                        {
                            "merged_level": 1,
                            "label": "Region",
                            "instance_levels": {"101": 1, "102": 1},
                        }
                    ],
                },
            },
            "repository_org_units": [
                {
                    "repository_key": "1:uganda",
                    "display_name": "Uganda",
                    "level": 1,
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_instance_code": "A",
                            "source_org_unit_uid": "OU_A",
                            "source_org_unit_name": "Uganda",
                            "source_level": 1,
                        },
                        {
                            "instance_id": 102,
                            "source_instance_code": "B",
                            "source_org_unit_uid": "OU_B",
                            "source_org_unit_name": "Uganda",
                            "source_level": 1,
                        },
                    ],
                }
            ],
        }
    ).run()

    _, payload = repository_service.call_args[0]
    assert payload.repository_reporting_unit_approach == "map_merge"
    assert payload.repository_data_scope == "ancestors"
    assert payload.repository_org_unit_config["level_mapping"]["enabled"] is True
    assert {
        lineage["source_instance_code"]
        for lineage in payload.repository_org_unit_config["repository_org_units"][0][
            "lineage"
        ]
    } == {"A", "B"}
    schedule_repository_finalization.assert_called_once_with(47)


def test_create_database_raises_invalid_error_on_repository_validation_failure(
    mocker: MockerFixture,
    database_without_catalog: MagicMock,
) -> None:
    database_without_catalog.id = 48
    database_without_catalog.backend = "dhis2"
    mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.validate_and_stage",
        side_effect=ValidationError(
            {"repository_org_unit_config": ["invalid repository org unit payload"]}
        ),
    )
    mocker.patch(
        "superset.commands.database.create.schedule_database_metadata_refresh_after_commit"
    )
    mocker.patch(
        "superset.commands.database.create.DatabaseRepositoryOrgUnitService.schedule_finalization_after_commit"
    )

    with pytest.raises(DatabaseCreateFailedError):
        CreateDatabaseCommand(
            {
                "database_name": "dhis2_repository",
                "sqlalchemy_uri": "dhis2://",
                "repository_reporting_unit_approach": "primary_instance",
                "repository_org_units": [
                    {
                        "repository_key": "OU_ROOT",
                        "display_name": "Uganda",
                        "lineage": [
                            {
                                "instance_id": 101,
                                "source_org_unit_uid": "OU_ROOT",
                            }
                        ],
                    }
                ],
            }
        ).run()
