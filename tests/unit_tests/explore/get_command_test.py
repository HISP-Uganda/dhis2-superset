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

from flask import current_app

from superset.commands.explore.get import GetExploreCommand
from superset.commands.explore.parameters import CommandParameters


def test_get_explore_command_keeps_dashboard_page_id_client_side(
    app_context: None,
    mocker,
) -> None:
    datasource = MagicMock()
    datasource.dataset_role = None
    datasource.name = "Admissions"
    datasource.default_endpoint = None
    datasource.data = {"id": 1, "database": {"id": 7, "backend": "sqlite"}}

    mocker.patch(
        "superset.commands.explore.get.get_form_data",
        return_value=({"slice_id": 11, "viz_type": "echarts_timeseries_bar"}, None),
    )
    mocker.patch(
        "superset.commands.explore.get.get_datasource_info",
        return_value=(1, "table"),
    )
    mocker.patch(
        "superset.commands.explore.get.DatasourceDAO.get_datasource",
        return_value=datasource,
    )
    mocker.patch("superset.commands.explore.get.security_manager.raise_for_access")
    ensure_marts = mocker.patch(
        "superset.dhis2.superset_dataset_service.ensure_specialized_marts_for_sqla_table"
    )

    with current_app.test_request_context(
        "/api/v1/explore/?slice_id=11&dashboard_page_id=page-1"
    ):
        result = GetExploreCommand(
            CommandParameters(
                permalink_key=None,
                form_data_key=None,
                datasource_id=None,
                datasource_type=None,
                slice_id=11,
            )
        ).run()

    assert result is not None
    assert result["form_data"]["datasource"] == "1__table"
    assert result["form_data"].get("url_params") == {}
    ensure_marts.assert_not_called()
