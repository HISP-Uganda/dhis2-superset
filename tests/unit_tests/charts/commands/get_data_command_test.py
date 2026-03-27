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

from superset.commands.chart.data.get_data_command import ChartDataCommand


def test_validate_does_not_ensure_dhis2_marts(mocker) -> None:
    datasource = MagicMock()
    datasource.dataset_role = None
    query_context = MagicMock()
    query_context.datasource = datasource

    ensure_marts = mocker.patch(
        "superset.dhis2.superset_dataset_service.ensure_specialized_marts_for_sqla_table"
    )

    ChartDataCommand(query_context).validate()

    query_context.raise_for_access.assert_called_once_with()
    ensure_marts.assert_not_called()
