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

from contextlib import contextmanager

import pandas as pd
import pytest
from pytest_mock import MockerFixture
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.session import Session

from superset.commands.dataset.refresh import RefreshDatasetCommand
from superset.connectors.sqla.models import SqlaTable, TableColumn
from superset.daos.dataset import DatasetDAO
from superset.exceptions import OAuth2RedirectError
from superset.models.core import Database
from superset.sql.parse import Table
from superset.superset_typing import QueryObjectDict


def test_query_bubbles_errors(mocker: MockerFixture) -> None:
    """
    Test that the `query` method bubbles exceptions correctly.

    When a user needs to authenticate via OAuth2 to access data, a custom exception is
    raised. The exception needs to bubble up all the way to the frontend as a SIP-40
    compliant payload with the error type `DATABASE_OAUTH2_REDIRECT_URI` so that the
    frontend can initiate the OAuth2 authentication.

    This tests verifies that the method does not capture these exceptions; otherwise the
    user will be never be prompted to authenticate via OAuth2.
    """
    database = mocker.MagicMock()
    database.get_df.side_effect = OAuth2RedirectError(
        url="http://example.com",
        tab_id="1234",
        redirect_uri="http://redirect.example.com",
    )

    sqla_table = SqlaTable(
        table_name="my_sqla_table",
        columns=[],
        metrics=[],
        database=database,
    )
    mocker.patch.object(
        sqla_table,
        "get_query_str_extended",
        return_value=mocker.MagicMock(sql="SELECT * FROM my_sqla_table"),
    )
    query_obj: QueryObjectDict = {
        "granularity": None,
        "from_dttm": None,
        "to_dttm": None,
        "groupby": ["id", "username", "email"],
        "metrics": [],
        "is_timeseries": False,
        "filter": [],
    }
    with pytest.raises(OAuth2RedirectError):
        sqla_table.query(query_obj)


def test_staged_local_dataset_resolves_serving_database_from_extra(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    serving_database = Database(
        id=7,
        database_name="main",
        sqlalchemy_uri="sqlite://",
    )

    sqla_table = SqlaTable(
        table_name="ds_1_test",
        sql="SELECT * FROM ds_1_test",
        extra='{"dhis2_staged_local": true, "dhis2_serving_database_id": 7}',
        database=source_database,
        database_id=2,
    )

    get_mock = mocker.patch("superset.connectors.sqla.models.db.session.get")
    get_mock.return_value = serving_database

    assert sqla_table.is_dhis2_staged_local is True
    assert sqla_table.get_serving_database() is serving_database
    get_mock.assert_called_once_with(Database, 7)


def test_staged_local_dataset_falls_back_to_staging_database_for_legacy_sql(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )

    serving_database = Database(
        id=7,
        database_name="main",
        sqlalchemy_uri="sqlite://",
    )

    sqla_table = SqlaTable(
        table_name="Test DS",
        sql="SELECT * FROM dhis2_staging.ds_1_test_ds",
        extra=None,
        database=source_database,
        database_id=2,
    )

    get_staging_database = mocker.patch(
        "superset.dhis2.staging_database_service.get_staging_database",
        return_value=serving_database,
    )

    assert sqla_table.is_dhis2_staged_local is True
    assert sqla_table.get_serving_database() is serving_database
    get_staging_database.assert_called_once_with(always_create=True)


def test_staged_local_dataset_detects_quoted_serving_sql(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    serving_database = Database(
        id=7,
        database_name="main",
        sqlalchemy_uri="sqlite://",
    )

    sqla_table = SqlaTable(
        table_name="EP-Malaria",
        sql='SELECT * FROM `dhis2_serving`.`sv_7_ep_malaria`',
        extra=None,
        database=source_database,
        database_id=2,
    )

    get_staging_database = mocker.patch(
        "superset.dhis2.staging_database_service.get_staging_database",
        return_value=serving_database,
    )

    assert sqla_table.is_dhis2_staged_local is True
    assert (
        sqla_table.get_staged_local_serving_table_ref()
        == "dhis2_serving.sv_7_ep_malaria"
    )
    assert sqla_table.get_serving_database() is serving_database
    get_staging_database.assert_called_once_with(always_create=True)


def test_query_uses_serving_database_for_staged_local_dataset(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )

    serving_database = mocker.MagicMock()
    serving_database.get_df.return_value = pd.DataFrame({"value": [1]})
    serving_database.unique_name = "[main]"
    serving_database.get_extra.return_value = {}

    sqla_table = SqlaTable(
        table_name="ds_1_test",
        sql="SELECT * FROM ds_1_test",
        extra='{"dhis2_staged_local": true, "dhis2_serving_database_id": 7}',
        columns=[],
        metrics=[],
        database=source_database,
        database_id=2,
    )
    mocker.patch.object(
        sqla_table,
        "get_query_str_extended",
        return_value=mocker.MagicMock(
            sql="SELECT * FROM ds_1_test",
            labels_expected=["value"],
            applied_template_filters=[],
            applied_filter_columns=[],
            rejected_filter_columns=[],
        ),
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)

    query_obj: QueryObjectDict = {
        "granularity": None,
        "from_dttm": None,
        "to_dttm": None,
        "groupby": ["value"],
        "metrics": [],
        "is_timeseries": False,
        "filter": [],
    }

    result = sqla_table.query(query_obj)

    assert result.status.value == "success"
    serving_database.get_df.assert_called_once()


def test_external_metadata_uses_serving_database_for_staged_local_dataset(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )

    serving_database = mocker.MagicMock()
    serving_database.db_engine_spec.engine = "sqlite"
    serving_database.get_extra.return_value = {}

    sqla_table = SqlaTable(
        table_name="ds_1_test",
        sql="SELECT * FROM ds_1_test",
        extra='{"dhis2_staged_local": true, "dhis2_serving_database_id": 7}',
        database=source_database,
        database_id=2,
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    get_columns_description = mocker.patch(
        "superset.connectors.sqla.utils.get_columns_description",
        return_value=[{"column_name": "value", "type": "INT"}],
    )

    result = sqla_table.external_metadata()

    assert result == [{"column_name": "value", "type": "INT"}]
    get_columns_description.assert_called_once_with(
        serving_database,
        sqla_table.catalog,
        sqla_table.schema,
        "SELECT * FROM sv_1_test",
    )


def test_refresh_repairs_database_binding_for_staged_local_dataset(
    mocker: MockerFixture,
) -> None:
    dataset = mocker.MagicMock()
    repair_binding = mocker.MagicMock()
    dataset.repair_staged_local_database_binding = repair_binding
    dataset.fetch_metadata = mocker.MagicMock()

    mocker.patch(
        "superset.commands.dataset.refresh.DatasetDAO.find_by_id",
        return_value=dataset,
    )
    mocker.patch(
        "superset.commands.dataset.refresh.security_manager.raise_for_ownership",
        return_value=None,
    )

    RefreshDatasetCommand(42).run()

    repair_binding.assert_called_once()
    dataset.fetch_metadata.assert_called_once()


def test_staged_local_repair_updates_legacy_sql_to_serving_table(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )

    sqla_table = SqlaTable(
        table_name="ANC Coverage",
        sql="SELECT * FROM dhis2_staging.ds_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=source_database,
        database_id=2,
    )

    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    ensure_serving_table = mocker.patch(
        "superset.dhis2.staged_dataset_service.ensure_serving_table",
        return_value=("dhis2_staging.sv_4_anc_coverage", []),
    )

    sqla_table.repair_staged_local_database_binding()

    assert sqla_table.database_id == 7
    assert sqla_table.sql == "SELECT * FROM dhis2_staging.sv_4_anc_coverage"
    assert sqla_table.extra_dict["dhis2_serving_table_ref"] == (
        "dhis2_staging.sv_4_anc_coverage"
    )
    assert sqla_table.extra_dict["dhis2_serving_database_id"] == 7
    ensure_serving_table.assert_called_once_with(4)


def test_external_metadata_repairs_legacy_staged_local_sql_before_introspection(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )

    sqla_table = SqlaTable(
        table_name="ANC Coverage",
        sql="SELECT * FROM dhis2_staging.ds_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=source_database,
        database_id=2,
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    mocker.patch(
        "superset.dhis2.staged_dataset_service.ensure_serving_table",
        return_value=("dhis2_staging.sv_4_anc_coverage", []),
    )
    get_columns_description = mocker.patch(
        "superset.connectors.sqla.utils.get_columns_description",
        return_value=[{"column_name": "period", "type": "STRING"}],
    )

    result = sqla_table.external_metadata()

    assert result == [{"column_name": "period", "type": "STRING"}]
    get_columns_description.assert_called_once_with(
        serving_database,
        sqla_table.catalog,
        sqla_table.schema,
        "SELECT * FROM dhis2_staging.sv_4_anc_coverage",
    )


def test_staged_local_columns_payload_uses_serving_metadata_shape(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )

    sqla_table = SqlaTable(
        table_name="ANC Coverage",
        sql="SELECT * FROM dhis2_staging.ds_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=source_database,
        database_id=2,
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    mocker.patch(
        "superset.dhis2.staged_dataset_service.ensure_serving_table",
        return_value=("dhis2_staging.sv_4_anc_coverage", []),
    )
    mocker.patch.object(
        sqla_table,
        "external_metadata",
        return_value=[
            {
                "column_name": "period",
                "verbose_name": "Period",
                "type": "STRING",
                "type_generic": "STRING",
                "is_dttm": False,
                "comment": "Serving period",
            }
        ],
    )

    assert sqla_table.get_staged_local_columns_payload() == [
        {
            "column_name": "period",
            "verbose_name": "Period",
            "type": "STRING",
            "type_generic": "STRING",
            "is_dttm": False,
            "description": "Serving period",
            "groupby": True,
            "filterable": True,
            "is_active": True,
        }
    ]


def test_staged_local_data_uses_serving_columns_for_explore_bootstrap(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )

    sqla_table = SqlaTable(
        table_name="ANC Coverage",
        sql="SELECT * FROM dhis2_staging.ds_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=source_database,
        database_id=2,
        columns=[
            TableColumn(column_name="source_instance_id", type="INT"),
            TableColumn(column_name="dx_uid", type="STRING"),
        ],
        metrics=[],
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    mocker.patch.object(
        sqla_table,
        "get_staged_local_columns_payload",
        return_value=[
            {
                "column_name": "district",
                "verbose_name": "District",
                "type": "STRING",
                "type_generic": "STRING",
                "is_dttm": False,
                "description": None,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
            {
                "column_name": "period",
                "verbose_name": "Period",
                "type": "STRING",
                "type_generic": "STRING",
                "is_dttm": False,
                "description": None,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
            {
                "column_name": "anc_1st_visit",
                "verbose_name": "ANC 1st visit",
                "type": "FLOAT",
                "type_generic": "NUMERIC",
                "is_dttm": False,
                "description": None,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
        ],
    )

    data = sqla_table.data

    assert data["database"]["id"] == 7
    assert [column["column_name"] for column in data["columns"]] == [
        "district",
        "period",
        "anc_1st_visit",
    ]
    assert data["verbose_map"]["district"] == "District"
    assert data["verbose_map"]["anc_1st_visit"] == "ANC 1st visit"
    assert data["order_by_choices"] == [
        ('["district", true]', "district [asc]"),
        ('["district", false]', "district [desc]"),
        ('["period", true]', "period [asc]"),
        ('["period", false]', "period [desc]"),
        ('["anc_1st_visit", true]', "anc_1st_visit [asc]"),
        ('["anc_1st_visit", false]', "anc_1st_visit [desc]"),
    ]


def test_staged_local_runtime_columns_resolve_from_serving_payload(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )

    sqla_table = SqlaTable(
        table_name="ANC Coverage",
        sql="SELECT * FROM dhis2_staging.ds_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=source_database,
        database_id=2,
        columns=[
            TableColumn(column_name="source_instance_id", type="INT"),
            TableColumn(column_name="dx_uid", type="STRING"),
        ],
        metrics=[],
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    mocker.patch.object(
        sqla_table,
        "get_staged_local_columns_payload",
        return_value=[
            {
                "column_name": "district",
                "verbose_name": "District",
                "type": "TEXT",
                "type_generic": "STRING",
                "is_dttm": False,
                "description": None,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
            {
                "column_name": "period",
                "verbose_name": "Period",
                "type": "TEXT",
                "type_generic": "STRING",
                "is_dttm": False,
                "description": None,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
            {
                "column_name": "anc_1st_visit",
                "verbose_name": "ANC 1st visit",
                "type": "FLOAT",
                "type_generic": "NUMERIC",
                "is_dttm": False,
                "description": None,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
        ],
    )

    assert sqla_table.column_names == ["anc_1st_visit", "district", "period"]
    assert sqla_table.filterable_column_names == [
        "anc_1st_visit",
        "district",
        "period",
    ]
    assert sqla_table.get_column("anc_1st_visit") is not None
    assert sqla_table.get_column("anc_1st_visit").column_name == "anc_1st_visit"
    assert sqla_table.get_column("source_instance_id") is None


def test_staged_local_query_applies_terminal_ou_filter_for_selected_hierarchy_level(
    mocker: MockerFixture,
) -> None:
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )
    engine = create_engine("sqlite://")

    @contextmanager
    def mock_get_sqla_engine(catalog=None, schema=None, **kwargs):
        yield engine

    mocker.patch.object(
        serving_database,
        "get_sqla_engine",
        new=mock_get_sqla_engine,
    )

    sqla_table = SqlaTable(
        table_name="sv_4_anc_coverage",
        sql="SELECT * FROM sv_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=serving_database,
        database_id=7,
        columns=[],
        metrics=[],
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    mocker.patch.object(
        sqla_table,
        "get_staged_local_columns_payload",
        return_value=[
            {
                "column_name": "national",
                "verbose_name": "National",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 1}'
                ),
            },
            {
                "column_name": "region",
                "verbose_name": "Region",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 2}'
                ),
            },
            {
                "column_name": "district",
                "verbose_name": "District",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 3}'
                ),
            },
            {
                "column_name": "facility",
                "verbose_name": "Facility",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 4}'
                ),
            },
            {
                "column_name": "period",
                "verbose_name": "Period",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
            {
                "column_name": "cases",
                "verbose_name": "Cases",
                "type": "FLOAT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
        ],
    )

    sql = sqla_table.get_query_str_extended(
        {
            "granularity": None,
            "from_dttm": None,
            "to_dttm": None,
            "groupby": ["region", "district"],
            "metrics": [],
            "is_timeseries": False,
            "filter": [],
        },
        mutate=False,
    ).sql

    where_sql = sql.split("WHERE", 1)[1].split("GROUP BY", 1)[0]
    assert "district" in where_sql
    assert "facility" in where_sql
    assert "region" not in where_sql


def test_staged_local_query_prefers_explicit_selected_hierarchy_level_for_terminal_filter(
    mocker: MockerFixture,
) -> None:
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )
    engine = create_engine("sqlite://")

    @contextmanager
    def mock_get_sqla_engine(catalog=None, schema=None, **kwargs):
        yield engine

    mocker.patch.object(
        serving_database,
        "get_sqla_engine",
        new=mock_get_sqla_engine,
    )

    sqla_table = SqlaTable(
        table_name="sv_4_anc_coverage",
        sql="SELECT * FROM sv_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=serving_database,
        database_id=7,
        columns=[],
        metrics=[],
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    mocker.patch.object(
        sqla_table,
        "get_staged_local_columns_payload",
        return_value=[
            {
                "column_name": "national",
                "verbose_name": "National",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 1}'
                ),
            },
            {
                "column_name": "region",
                "verbose_name": "Region",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 2}'
                ),
            },
            {
                "column_name": "district",
                "verbose_name": "District",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 3}'
                ),
            },
            {
                "column_name": "facility",
                "verbose_name": "Facility",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 4}'
                ),
            },
            {
                "column_name": "cases",
                "verbose_name": "Cases",
                "type": "FLOAT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
        ],
    )

    sql = sqla_table.get_query_str_extended(
        {
            "granularity": None,
            "from_dttm": None,
            "to_dttm": None,
            "groupby": ["national", "region", "district", "facility"],
            "metrics": [],
            "is_timeseries": False,
            "filter": [],
            "extras": {
                "dhis2_selected_org_unit_column": "region",
            },
        },
        mutate=False,
    ).sql

    where_sql = sql.split("WHERE", 1)[1].split("GROUP BY", 1)[0]
    assert "region" in where_sql
    assert "district" in where_sql
    assert "facility" in where_sql


def test_staged_local_query_filters_explicit_selected_ou_column_even_without_hierarchy_metadata(
    mocker: MockerFixture,
) -> None:
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )
    engine = create_engine("sqlite://")

    @contextmanager
    def mock_get_sqla_engine(catalog=None, schema=None, **kwargs):
        yield engine

    mocker.patch.object(
        serving_database,
        "get_sqla_engine",
        new=mock_get_sqla_engine,
    )

    sqla_table = SqlaTable(
        table_name="sv_7_mal_routine_ehmis_indicators_mart",
        sql="SELECT * FROM sv_7_mal_routine_ehmis_indicators_mart",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 7}',
        database=serving_database,
        database_id=7,
        columns=[],
        metrics=[],
    )
    mocker.patch.object(
        sqla_table,
        "get_serving_database",
        return_value=serving_database,
    )
    mocker.patch.object(
        sqla_table,
        "get_staged_local_columns_payload",
        return_value=[
            {
                "column_name": "district_city",
                "verbose_name": "District City",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
            {
                "column_name": "mal_testing_rate",
                "verbose_name": "Mal Testing Rate",
                "type": "FLOAT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
        ],
    )

    sql = sqla_table.get_query_str_extended(
        {
            "granularity": None,
            "from_dttm": None,
            "to_dttm": None,
            "groupby": ["district_city"],
            "metrics": [],
            "is_timeseries": False,
            "filter": [],
            "extras": {
                "dhis2_selected_org_unit_column": "district_city",
                "dhis2_terminal_hierarchy_filtering": False,
            },
        },
        mutate=False,
    ).sql

    where_sql = sql.split("WHERE", 1)[1].split("GROUP BY", 1)[0]
    assert "district_city" in where_sql
    assert "trim" in where_sql.lower()
    assert "length" in where_sql.lower()


def test_staged_local_query_defaults_to_deepest_ou_and_selected_period_level(
    mocker: MockerFixture,
) -> None:
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )
    engine = create_engine("sqlite://")

    @contextmanager
    def mock_get_sqla_engine(catalog=None, schema=None, **kwargs):
        yield engine

    mocker.patch.object(
        serving_database,
        "get_sqla_engine",
        new=mock_get_sqla_engine,
    )

    sqla_table = SqlaTable(
        table_name="sv_4_anc_coverage",
        sql="SELECT * FROM sv_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=serving_database,
        database_id=7,
        columns=[],
        metrics=[],
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    mocker.patch.object(
        sqla_table,
        "get_staged_local_columns_payload",
        return_value=[
            {
                "column_name": "region",
                "verbose_name": "Region",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 2}'
                ),
            },
            {
                "column_name": "district",
                "verbose_name": "District",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 3}'
                ),
            },
            {
                "column_name": "facility",
                "verbose_name": "Facility",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 4}'
                ),
            },
            {
                "column_name": "period",
                "verbose_name": "Period",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_period": true, "dhis2_is_period_hierarchy": true, "dhis2_period_key": "period"}'
                ),
            },
            {
                "column_name": "period_year",
                "verbose_name": "Period Year",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_period_hierarchy": true, "dhis2_period_key": "period_year"}'
                ),
            },
            {
                "column_name": "period_quarter",
                "verbose_name": "Period Quarter",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_period_hierarchy": true, "dhis2_period_key": "period_quarter"}'
                ),
            },
            {
                "column_name": "period_month",
                "verbose_name": "Period Month",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_period_hierarchy": true, "dhis2_period_key": "period_month"}'
                ),
            },
            {
                "column_name": "cases",
                "verbose_name": "Cases",
                "type": "FLOAT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
        ],
    )

    sql = sqla_table.get_query_str_extended(
        {
            "granularity": None,
            "from_dttm": None,
            "to_dttm": None,
            "groupby": ["period_year"],
            "metrics": [],
            "is_timeseries": False,
            "filter": [],
        },
        mutate=False,
    ).sql

    where_sql = sql.split("WHERE", 1)[1].split("GROUP BY", 1)[0]
    assert "facility" in where_sql
    assert "period_year" in where_sql
    assert "period_quarter" in where_sql
    assert "period_month" in where_sql


def test_staged_local_query_skips_default_period_terminal_filter_for_raw_period_filters(
    mocker: MockerFixture,
) -> None:
    serving_database = Database(
        id=7,
        database_name="DHIS2 Local Staging",
        sqlalchemy_uri="sqlite://",
    )
    engine = create_engine("sqlite://")

    @contextmanager
    def mock_get_sqla_engine(catalog=None, schema=None, **kwargs):
        yield engine

    mocker.patch.object(
        serving_database,
        "get_sqla_engine",
        new=mock_get_sqla_engine,
    )

    sqla_table = SqlaTable(
        table_name="sv_4_anc_coverage",
        sql="SELECT * FROM sv_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=serving_database,
        database_id=7,
        columns=[],
        metrics=[],
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)
    mocker.patch.object(
        sqla_table,
        "get_staged_local_columns_payload",
        return_value=[
            {
                "column_name": "region",
                "verbose_name": "Region",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 2}'
                ),
            },
            {
                "column_name": "district",
                "verbose_name": "District",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_ou_hierarchy": true, "dhis2_ou_level": 3}'
                ),
            },
            {
                "column_name": "period",
                "verbose_name": "Period",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_period": true, "dhis2_is_period_hierarchy": true, "dhis2_period_key": "period"}'
                ),
            },
            {
                "column_name": "period_year",
                "verbose_name": "Period Year",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_period_hierarchy": true, "dhis2_period_key": "period_year"}'
                ),
            },
            {
                "column_name": "period_quarter",
                "verbose_name": "Period Quarter",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_period_hierarchy": true, "dhis2_period_key": "period_quarter"}'
                ),
            },
            {
                "column_name": "period_month",
                "verbose_name": "Period Month",
                "type": "TEXT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
                "extra": (
                    '{"dhis2_is_period_hierarchy": true, "dhis2_period_key": "period_month"}'
                ),
            },
            {
                "column_name": "cases",
                "verbose_name": "Cases",
                "type": "FLOAT",
                "is_dttm": False,
                "groupby": True,
                "filterable": True,
                "is_active": True,
            },
        ],
    )

    sql = sqla_table.get_query_str_extended(
        {
            "granularity": None,
            "from_dttm": None,
            "to_dttm": None,
            "groupby": ["region"],
            "metrics": [],
            "is_timeseries": False,
            "filter": [{"col": "period", "op": "==", "val": "2024Q1"}],
        },
        mutate=False,
    ).sql

    where_sql = sql.split("WHERE", 1)[1].split("GROUP BY", 1)[0]
    assert "period" in where_sql
    assert "period_year" not in where_sql
    assert "period_quarter" not in where_sql
    assert "period_month" not in where_sql


def test_query_repairs_staged_local_dataset_before_generating_sql(
    mocker: MockerFixture,
) -> None:
    source_database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    serving_database = mocker.MagicMock()
    serving_database.get_df.return_value = pd.DataFrame({"value": [1]})
    serving_database.unique_name = "[main]"
    serving_database.get_extra.return_value = {}

    sqla_table = SqlaTable(
        table_name="ANC Coverage",
        sql="SELECT * FROM dhis2_staging.ds_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        columns=[],
        metrics=[],
        database=source_database,
        database_id=2,
    )

    call_order: list[str] = []

    def repair_side_effect() -> None:
        call_order.append("repair")
        sqla_table.sql = "SELECT * FROM dhis2_staging.sv_4_anc_coverage"

    def get_query_str_extended_side_effect(*args, **kwargs):
        call_order.append("query")
        assert sqla_table.sql == "SELECT * FROM dhis2_staging.sv_4_anc_coverage"
        return mocker.MagicMock(
            sql=sqla_table.sql,
            labels_expected=["value"],
            applied_template_filters=[],
            applied_filter_columns=[],
            rejected_filter_columns=[],
        )

    mocker.patch.object(
        sqla_table,
        "repair_staged_local_database_binding",
        side_effect=repair_side_effect,
    )
    mocker.patch.object(
        sqla_table,
        "get_query_str_extended",
        side_effect=get_query_str_extended_side_effect,
    )
    mocker.patch.object(sqla_table, "get_serving_database", return_value=serving_database)

    query_obj: QueryObjectDict = {
        "granularity": None,
        "from_dttm": None,
        "to_dttm": None,
        "groupby": ["value"],
        "metrics": [],
        "is_timeseries": False,
        "filter": [],
    }

    result = sqla_table.query(query_obj)

    assert result.status.value == "success"
    assert call_order == ["repair", "query"]
    serving_database.get_df.assert_called_once()


def test_cleanup_linked_dhis2_staged_dataset_removes_local_tables_and_metadata(
    mocker: MockerFixture,
) -> None:
    database = Database(
        id=2,
        database_name="dhis2_repo",
        sqlalchemy_uri="dhis2://admin:district@none",
    )
    sqla_table = SqlaTable(
        id=21,
        table_name="ANC Coverage",
        sql="SELECT * FROM dhis2_staging.sv_4_anc_coverage",
        extra='{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        database=database,
        database_id=2,
    )
    connection = mocker.MagicMock()
    select_result = mocker.MagicMock()
    select_result.mappings.return_value.first.return_value = {
        "id": 4,
        "database_id": 2,
        "name": "ANC Coverage",
        "staging_table_name": "ds_4_anc_coverage",
        "generic_dataset_id": 9,
    }
    duckdb_engine = mocker.MagicMock()
    mocker.patch(
        "superset.local_staging.engine_factory.get_active_staging_engine",
        return_value=duckdb_engine,
    )
    connection.execute.side_effect = [
        select_result,
        mocker.MagicMock(),
        mocker.MagicMock(),
    ]

    sqla_table.cleanup_linked_dhis2_staged_dataset(connection)

    executed_sql = [call.args[0].text for call in connection.execute.call_args_list]
    assert any("FROM dhis2_staged_datasets" in sql for sql in executed_sql)
    duckdb_engine.drop_staging_table.assert_called_once()
    staging_dataset_ref = duckdb_engine.drop_staging_table.call_args.args[0]
    assert staging_dataset_ref.id == 4
    assert staging_dataset_ref.name == "ANC Coverage"
    assert staging_dataset_ref.staging_table_name == "ds_4_anc_coverage"
    assert any("DELETE FROM staged_datasets" in sql for sql in executed_sql)
    assert any("DELETE FROM dhis2_staged_datasets" in sql for sql in executed_sql)


def test_permissions_without_catalog() -> None:
    """
    Test permissions when the table has no catalog.
    """
    database = Database(database_name="my_db")
    sqla_table = SqlaTable(
        table_name="my_sqla_table",
        columns=[],
        metrics=[],
        database=database,
        schema="schema1",
        catalog=None,
        id=1,
    )

    assert sqla_table.get_perm() == "[my_db].[my_sqla_table](id:1)"
    assert sqla_table.get_catalog_perm() is None
    assert sqla_table.get_schema_perm() == "[my_db].[schema1]"


def test_permissions_with_catalog() -> None:
    """
    Test permissions when the table with a catalog set.
    """
    database = Database(database_name="my_db")
    sqla_table = SqlaTable(
        table_name="my_sqla_table",
        columns=[],
        metrics=[],
        database=database,
        schema="schema1",
        catalog="db1",
        id=1,
    )

    assert sqla_table.get_perm() == "[my_db].[my_sqla_table](id:1)"
    assert sqla_table.get_catalog_perm() == "[my_db].[db1]"
    assert sqla_table.get_schema_perm() == "[my_db].[db1].[schema1]"


def test_query_datasources_by_name(mocker: MockerFixture) -> None:
    """
    Test the `query_datasources_by_name` method.
    """
    db = mocker.patch("superset.connectors.sqla.models.db")

    database = Database(database_name="my_db", id=1)
    sqla_table = SqlaTable(
        table_name="my_sqla_table",
        columns=[],
        metrics=[],
        database=database,
    )

    sqla_table.query_datasources_by_name(database, "my_table")
    db.session.query().filter_by.assert_called_with(
        database_id=1,
        table_name="my_table",
    )

    sqla_table.query_datasources_by_name(database, "my_table", "db1", "schema1")
    db.session.query().filter_by.assert_called_with(
        database_id=1,
        table_name="my_table",
        catalog="db1",
        schema="schema1",
    )


def test_query_datasources_by_permissions(mocker: MockerFixture) -> None:
    """
    Test the `query_datasources_by_permissions` method.
    """
    db = mocker.patch("superset.connectors.sqla.models.db")

    engine = create_engine("sqlite://")
    database = Database(database_name="my_db", id=1)
    sqla_table = SqlaTable(
        table_name="my_sqla_table",
        columns=[],
        metrics=[],
        database=database,
    )

    sqla_table.query_datasources_by_permissions(database, set(), set(), set())
    db.session.query().filter_by.assert_called_with(database_id=1)
    clause = db.session.query().filter_by().filter.mock_calls[0].args[0]
    assert str(clause.compile(engine, compile_kwargs={"literal_binds": True})) == ""


def test_query_datasources_by_permissions_with_catalog_schema(
    mocker: MockerFixture,
) -> None:
    """
    Test the `query_datasources_by_permissions` method passing a catalog and schema.
    """
    db = mocker.patch("superset.connectors.sqla.models.db")

    engine = create_engine("sqlite://")
    database = Database(database_name="my_db", id=1)
    sqla_table = SqlaTable(
        table_name="my_sqla_table",
        columns=[],
        metrics=[],
        database=database,
    )
    sqla_table.query_datasources_by_permissions(
        database,
        {"[my_db].[table1](id:1)"},
        {"[my_db].[db1]"},
        # pass as list to have deterministic order for test
        ["[my_db].[db1].[schema1]", "[my_other_db].[schema]"],  # type: ignore
    )
    clause = db.session.query().filter_by().filter.mock_calls[0].args[0]
    assert str(clause.compile(engine, compile_kwargs={"literal_binds": True})) == (
        "tables.perm IN ('[my_db].[table1](id:1)') OR "
        "tables.schema_perm IN ('[my_db].[db1].[schema1]', '[my_other_db].[schema]') OR "  # noqa: E501
        "tables.catalog_perm IN ('[my_db].[db1]')"
    )


def test_dataset_uniqueness(session: Session) -> None:
    """
    Test dataset uniqueness constraints.
    """
    Database.metadata.create_all(session.bind)

    database = Database(database_name="my_db", sqlalchemy_uri="sqlite://")

    # add prod.schema.table
    dataset = SqlaTable(
        database=database,
        catalog="prod",
        schema="schema",
        table_name="table",
    )
    session.add(dataset)
    session.commit()

    # add dev.schema.table
    dataset = SqlaTable(
        database=database,
        catalog="dev",
        schema="schema",
        table_name="table",
    )
    session.add(dataset)
    session.commit()

    # try to add dev.schema.table again, fails
    dataset = SqlaTable(
        database=database,
        catalog="dev",
        schema="schema",
        table_name="table",
    )
    session.add(dataset)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()

    # add schema.table
    dataset = SqlaTable(
        database=database,
        catalog=None,
        schema="schema",
        table_name="table",
    )
    session.add(dataset)
    session.commit()

    # add schema.table again, works because in SQL `NULlL != NULL`
    dataset = SqlaTable(
        database=database,
        catalog=None,
        schema="schema",
        table_name="table",
    )
    session.add(dataset)
    session.commit()

    # but the DAO enforces application logic for uniqueness
    assert not DatasetDAO.validate_uniqueness(
        database,
        Table("table", "schema", None),
    )

    assert DatasetDAO.validate_uniqueness(
        database,
        Table("table", "schema", "some_catalog"),
    )


def test_normalize_prequery_result_type_custom_sql() -> None:
    """
    Test that the `_normalize_prequery_result_type` can hanndle custom SQL.
    """
    sqla_table = SqlaTable(
        table_name="my_sqla_table",
        columns=[],
        metrics=[],
        database=Database(database_name="my_db", sqlalchemy_uri="sqlite://"),
    )
    row: pd.Series = {
        "custom_sql": "Car",
    }
    dimension: str = "custom_sql"
    columns_by_name: dict[str, TableColumn] = {
        "product_line": TableColumn(column_name="product_line"),
    }
    assert (
        sqla_table._normalize_prequery_result_type(row, dimension, columns_by_name)
        == "Car"
    )


def test_fetch_metadata_with_comment_field_new_columns(mocker: MockerFixture) -> None:
    """Test that fetch_metadata correctly assigns comment field to description
    for new columns
    """
    # Mock database
    database = mocker.MagicMock()
    database.get_metrics.return_value = []

    # Mock db_engine_spec
    mock_db_engine_spec = mocker.MagicMock()
    mock_db_engine_spec.alter_new_orm_column = mocker.MagicMock()
    database.db_engine_spec = mock_db_engine_spec

    # Create table
    table = SqlaTable(
        table_name="test_table",
        database=database,
    )

    # Mock external_metadata to return columns with comment fields
    mock_columns = [
        {
            "column_name": "id",
            "type": "INTEGER",
            "comment": "Primary key identifier",
        },
        {
            "column_name": "name",
            "type": "VARCHAR",
            "comment": "Full name of the user",
        },
        {
            "column_name": "status",
            "type": "VARCHAR",
            # No comment field for this column
        },
    ]

    # Mock dependencies
    mocker.patch.object(table, "external_metadata", return_value=mock_columns)
    mocker.patch("superset.connectors.sqla.models.db.session")
    mocker.patch(
        "superset.connectors.sqla.models.config", {"SQLA_TABLE_MUTATOR": lambda x: None}
    )

    # Execute fetch_metadata
    result = table.fetch_metadata()

    # Verify results
    assert len(result.added) == 3
    assert set(result.added) == {"id", "name", "status"}

    # Check that descriptions were set correctly from comments
    columns_by_name = {col.column_name: col for col in table.columns}

    assert columns_by_name["id"].description == "Primary key identifier"
    assert columns_by_name["name"].description == "Full name of the user"
    # Column without comment should have None description
    assert columns_by_name["status"].description is None


def test_fetch_metadata_with_comment_field_existing_columns(
    mocker: MockerFixture,
) -> None:
    """Test that fetch_metadata correctly updates description for existing columns"""
    # Mock database
    database = mocker.MagicMock()
    database.get_metrics.return_value = []

    # Mock db_engine_spec
    mock_db_engine_spec = mocker.MagicMock()
    mock_db_engine_spec.alter_new_orm_column = mocker.MagicMock()
    database.db_engine_spec = mock_db_engine_spec

    # Create table with existing columns
    table = SqlaTable(
        table_name="test_table_existing",
        database=database,
    )
    table.id = 1  # Set ID so it's treated as existing table

    # Create existing columns
    existing_col1 = TableColumn(
        column_name="id",
        type="INTEGER",
        table=table,
        description="Old description",
    )
    existing_col2 = TableColumn(
        column_name="name",
        type="VARCHAR",
        table=table,
    )
    table.columns = [existing_col1, existing_col2]

    # Mock external_metadata to return updated columns with comments
    mock_columns = [
        {
            "column_name": "id",
            "type": "INTEGER",
            "comment": "Updated primary key description",
        },
        {
            "column_name": "name",
            "type": "VARCHAR",
            "comment": "Updated name description",
        },
    ]

    # Mock dependencies
    mock_session = mocker.patch("superset.connectors.sqla.models.db.session")
    mock_session.query.return_value.filter.return_value.all.return_value = [
        existing_col1,
        existing_col2,
    ]
    mocker.patch.object(table, "external_metadata", return_value=mock_columns)
    mocker.patch(
        "superset.connectors.sqla.models.config", {"SQLA_TABLE_MUTATOR": lambda x: None}
    )

    # Execute fetch_metadata
    result = table.fetch_metadata()

    # Verify no new columns were added
    assert len(result.added) == 0

    # Check that descriptions were updated from comments
    columns_by_name = {col.column_name: col for col in table.columns}

    assert columns_by_name["id"].description == "Updated primary key description"
    assert columns_by_name["name"].description == "Updated name description"


def test_fetch_metadata_mixed_comment_scenarios(mocker: MockerFixture) -> None:
    """Test fetch_metadata with mix of new/existing columns and with/without
    comments
    """
    # Mock database
    database = mocker.MagicMock()
    database.get_metrics.return_value = []

    # Mock db_engine_spec
    mock_db_engine_spec = mocker.MagicMock()
    mock_db_engine_spec.alter_new_orm_column = mocker.MagicMock()
    database.db_engine_spec = mock_db_engine_spec

    # Create table with one existing column
    table = SqlaTable(
        table_name="test_table_mixed",
        database=database,
    )
    table.id = 1

    existing_col = TableColumn(
        column_name="existing_col",
        type="INTEGER",
        table=table,
        description="Existing description",
    )
    table.columns = [existing_col]

    # Mock external_metadata with mixed scenarios
    mock_columns = [
        {
            "column_name": "existing_col",
            "type": "INTEGER",
            "comment": "Updated existing column comment",
        },
        {
            "column_name": "new_with_comment",
            "type": "VARCHAR",
            "comment": "New column with comment",
        },
        {
            "column_name": "new_without_comment",
            "type": "VARCHAR",
            # No comment field
        },
    ]

    # Mock dependencies
    mock_session = mocker.patch("superset.connectors.sqla.models.db.session")
    mock_session.query.return_value.filter.return_value.all.return_value = [
        existing_col
    ]
    mocker.patch.object(table, "external_metadata", return_value=mock_columns)
    mocker.patch(
        "superset.connectors.sqla.models.config", {"SQLA_TABLE_MUTATOR": lambda x: None}
    )

    # Execute fetch_metadata
    result = table.fetch_metadata()

    # Check added columns
    assert len(result.added) == 2
    assert set(result.added) == {"new_with_comment", "new_without_comment"}

    # Check all column descriptions
    columns_by_name = {col.column_name: col for col in table.columns}

    # Existing column should have updated description
    assert (
        columns_by_name["existing_col"].description == "Updated existing column comment"
    )

    # New column with comment should have description set
    assert columns_by_name["new_with_comment"].description == "New column with comment"

    # New column without comment should have None description
    assert columns_by_name["new_without_comment"].description is None


def test_fetch_metadata_no_comment_field_safe_handling(
    mocker: MockerFixture,
) -> None:
    """Test that fetch_metadata safely handles columns with no comment field"""
    # Mock database
    database = mocker.MagicMock()
    database.get_metrics.return_value = []

    # Mock db_engine_spec
    mock_db_engine_spec = mocker.MagicMock()
    mock_db_engine_spec.alter_new_orm_column = mocker.MagicMock()
    database.db_engine_spec = mock_db_engine_spec

    # Create table
    table = SqlaTable(
        table_name="test_table_no_comments",
        database=database,
    )

    # Mock external_metadata with columns that have no comment fields
    mock_columns = [
        {"column_name": "col1", "type": "INTEGER"},
        {"column_name": "col2", "type": "VARCHAR"},
    ]

    # Mock dependencies
    mocker.patch.object(table, "external_metadata", return_value=mock_columns)
    mocker.patch("superset.connectors.sqla.models.db.session")
    mocker.patch(
        "superset.connectors.sqla.models.config", {"SQLA_TABLE_MUTATOR": lambda x: None}
    )

    # Execute fetch_metadata - should not raise any exceptions
    result = table.fetch_metadata()

    # Check that columns were added successfully
    assert len(result.added) == 2
    assert set(result.added) == {"col1", "col2"}

    # Check that descriptions are None (not set)
    columns_by_name = {col.column_name: col for col in table.columns}
    assert columns_by_name["col1"].description is None
    assert columns_by_name["col2"].description is None


def test_fetch_metadata_empty_comment_field_handling(mocker: MockerFixture) -> None:
    """Test that fetch_metadata handles empty comment fields correctly"""
    # Mock database
    database = mocker.MagicMock()
    database.get_metrics.return_value = []

    # Mock db_engine_spec
    mock_db_engine_spec = mocker.MagicMock()
    mock_db_engine_spec.alter_new_orm_column = mocker.MagicMock()
    database.db_engine_spec = mock_db_engine_spec

    # Create table
    table = SqlaTable(
        table_name="test_table_empty_comments",
        database=database,
    )

    # Mock external_metadata with empty comment fields
    mock_columns = [
        {
            "column_name": "col_with_empty_comment",
            "type": "INTEGER",
            "comment": "",  # Empty string comment
        },
        {
            "column_name": "col_with_none_comment",
            "type": "VARCHAR",
            "comment": None,  # None comment
        },
        {
            "column_name": "col_with_valid_comment",
            "type": "VARCHAR",
            "comment": "Valid comment",
        },
    ]

    # Mock dependencies
    mocker.patch.object(table, "external_metadata", return_value=mock_columns)
    mocker.patch("superset.connectors.sqla.models.db.session")
    mocker.patch(
        "superset.connectors.sqla.models.config", {"SQLA_TABLE_MUTATOR": lambda x: None}
    )

    # Execute fetch_metadata
    result = table.fetch_metadata()

    # Check that all columns were added
    assert len(result.added) == 3

    columns_by_name = {col.column_name: col for col in table.columns}

    # Empty string comment should not be set (falsy)
    assert columns_by_name["col_with_empty_comment"].description is None

    # None comment should not be set
    assert columns_by_name["col_with_none_comment"].description is None

    # Valid comment should be set
    assert columns_by_name["col_with_valid_comment"].description == "Valid comment"


@pytest.mark.parametrize(
    "supports_cross_catalog,table_name,catalog,schema,expected_name,expected_schema",
    [
        # Database supports cross-catalog queries (like BigQuery)
        (
            True,
            "test_table",
            "test_project",
            "test_dataset",
            '"test_project"."test_dataset"."test_table"',
            None,
        ),
        # Database supports cross-catalog queries, catalog only (no schema)
        (
            True,
            "test_table",
            "test_project",
            None,
            '"test_project"."test_table"',
            None,
        ),
        # Database supports cross-catalog queries, schema only (no catalog)
        (
            True,
            "test_table",
            None,
            "test_schema",
            "test_table",
            "test_schema",
        ),
        # Database supports cross-catalog queries, no catalog or schema
        (
            True,
            "test_table",
            None,
            None,
            "test_table",
            None,
        ),
        # Database doesn't support cross-catalog queries, catalog ignored
        (
            False,
            "test_table",
            "test_catalog",
            "test_schema",
            "test_table",
            "test_schema",
        ),
        # Database doesn't support cross-catalog queries, no schema
        (
            False,
            "test_table",
            "test_catalog",
            None,
            "test_table",
            None,
        ),
    ],
)
def test_get_sqla_table_with_catalog(
    mocker: MockerFixture,
    supports_cross_catalog: bool,
    table_name: str,
    catalog: str | None,
    schema: str | None,
    expected_name: str,
    expected_schema: str | None,
) -> None:
    """
    Test that `get_sqla_table` handles catalog inclusion correctly.
    """
    # Mock database with specified cross-catalog support
    database = mocker.MagicMock()
    database.db_engine_spec.supports_cross_catalog_queries = supports_cross_catalog
    # Provide a simple quote_identifier
    database.quote_identifier = lambda x: f'"{x}"'

    # Create table with specified parameters
    table = SqlaTable(
        table_name=table_name,
        database=database,
        schema=schema,
        catalog=catalog,
    )

    # Get the SQLAlchemy table representation
    sqla_table = table.get_sqla_table()

    # Verify expected table name and schema
    assert sqla_table.name == expected_name
    assert sqla_table.schema == expected_schema


@pytest.mark.parametrize(
    "table_name, catalog, schema, expected_in_sql, not_expected_in_sql",
    [
        (
            "My-Table",
            "My-DB",
            "My-Schema",
            '"My-DB"."My-Schema"."My-Table"',
            '"My-DB.My-Schema.My-Table"',  # Should NOT be one quoted string
        ),
        (
            "ORDERS",
            "PROD_DB",
            "SALES",
            '"PROD_DB"."SALES"."ORDERS"',
            '"PROD_DB.SALES.ORDERS"',  # Should NOT be one quoted string
        ),
        (
            "My Table",
            "My DB",
            "My Schema",
            '"My DB"."My Schema"."My Table"',
            '"My DB.My Schema.My Table"',  # Should NOT be one quoted string
        ),
    ],
)
def test_get_sqla_table_quoting_for_cross_catalog(
    mocker: MockerFixture,
    table_name: str,
    catalog: str | None,
    schema: str | None,
    expected_in_sql: str,
    not_expected_in_sql: str,
) -> None:
    """
    Test that `get_sqla_table` properly quotes each component of the identifier.
    """
    from sqlalchemy import create_engine, select

    # Create a Postgres-like engine to test proper quoting
    engine = create_engine("postgresql://user:pass@host/db")

    # Mock database with cross-catalog support and proper quote_identifier
    database = mocker.MagicMock()
    database.db_engine_spec.supports_cross_catalog_queries = True
    database.quote_identifier = engine.dialect.identifier_preparer.quote

    # Create table
    table = SqlaTable(
        table_name=table_name,
        database=database,
        schema=schema,
        catalog=catalog,
    )

    # Get the SQLAlchemy table representation
    sqla_table = table.get_sqla_table()
    query = select(sqla_table)
    compiled = str(query.compile(engine, compile_kwargs={"literal_binds": True}))

    # The compiled SQL should contain each part quoted separately
    assert expected_in_sql in compiled, f"Expected {expected_in_sql} in SQL: {compiled}"
    # Should NOT have the entire identifier quoted as one string
    assert not_expected_in_sql not in compiled, (
        f"Should not have {not_expected_in_sql} in SQL: {compiled}"
    )


def test_get_sqla_table_without_cross_catalog_ignores_catalog(
    mocker: MockerFixture,
) -> None:
    """
    Test that databases without cross-catalog support ignore the catalog field.
    """
    from sqlalchemy import create_engine, select

    # Create a PostgreSQL engine (doesn't support cross-catalog queries)
    engine = create_engine("postgresql://user:pass@localhost/db")

    # Mock database without cross-catalog support
    database = mocker.MagicMock()
    database.db_engine_spec.supports_cross_catalog_queries = False
    database.quote_identifier = engine.dialect.identifier_preparer.quote

    # Create table with catalog - should be ignored
    table = SqlaTable(
        table_name="my_table",
        database=database,
        schema="my_schema",
        catalog="my_catalog",
    )

    # Get the SQLAlchemy table representation
    sqla_table = table.get_sqla_table()

    # Compile to SQL
    query = select(sqla_table)
    compiled = str(query.compile(engine, compile_kwargs={"literal_binds": True}))

    # Should only have schema.table, not catalog.schema.table
    assert "my_schema" in compiled
    assert "my_table" in compiled
    assert "my_catalog" not in compiled


def test_quoted_name_prevents_double_quoting(mocker: MockerFixture) -> None:
    """
    Test that `quoted_name(..., quote=False)` does not cause double quoting.
    """
    from sqlalchemy import create_engine, select

    engine = create_engine("postgresql://user:pass@host/db")

    # Mock database
    database = mocker.MagicMock()
    database.db_engine_spec.supports_cross_catalog_queries = True
    database.quote_identifier = engine.dialect.identifier_preparer.quote

    # Use uppercase table name to force quoting
    table = SqlaTable(
        table_name="MY_TABLE",
        database=database,
        schema="MY_SCHEMA",
        catalog="MY_DB",
    )

    # Get the SQLAlchemy table representation
    sqla_table = table.get_sqla_table()

    # Compile to SQL
    query = select(sqla_table)
    compiled = str(query.compile(engine, compile_kwargs={"literal_binds": True}))

    # Should NOT have the entire identifier quoted as one:
    # BAD:  '"MY_DB.MY_SCHEMA.MY_TABLE"'
    # This would cause: SQL compilation error: Object '"MY_DB.MY_SCHEMA.MY_TABLE"'
    # does not exist
    assert '"MY_DB.MY_SCHEMA.MY_TABLE"' not in compiled

    # Should have each part quoted separately:
    # GOOD: "MY_DB"."MY_SCHEMA"."MY_TABLE"
    assert '"MY_DB"."MY_SCHEMA"."MY_TABLE"' in compiled
