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

from pytest_mock import MockerFixture

from superset.db_engine_specs.dhis2 import DHIS2EngineSpec


def test_build_sqlalchemy_uri_preserves_instance_path_and_port() -> None:
    uri = DHIS2EngineSpec.build_sqlalchemy_uri(
        {
            "host": "https://play.im.dhis2.org:8443/stable-2-42-4",
            "authentication_type": "basic",
            "username": "admin",
            "password": "district",
        }
    )

    assert uri == "dhis2://admin:district@play.im.dhis2.org:8443/stable-2-42-4/api"


def test_validate_parameters_accepts_current_dynamic_form_payload() -> None:
    errors = DHIS2EngineSpec.validate_parameters(
        {
            "parameters": {
                "host": "https://play.im.dhis2.org/stable-2-42-4",
                "authentication_type": "basic",
                "username": "admin",
                "password": "district",
            }
        }
    )

    assert errors == []


def test_build_sqlalchemy_uri_accepts_logical_database_shell_payload() -> None:
    uri = DHIS2EngineSpec.build_sqlalchemy_uri(
        {
            "parameters": {
                "host": "",
                "authentication_type": "basic",
                "username": "",
                "password": "",
            }
        }
    )

    assert uri == "dhis2://"


def test_validate_parameters_accepts_logical_database_shell_payload() -> None:
    errors = DHIS2EngineSpec.validate_parameters(
        {
            "parameters": {
                "host": "",
                "authentication_type": "basic",
                "username": "",
                "password": "",
            }
        }
    )

    assert errors == []


def test_validate_parameters_accepts_legacy_payload_keys() -> None:
    errors = DHIS2EngineSpec.validate_parameters(
        {
            "server": "https://play.im.dhis2.org/stable-2-42-4",
            "auth_method": "basic",
            "username": "admin",
            "password": "district",
        }
    )

    assert errors == []


def test_test_connection_uses_me_endpoint_for_basic_auth(
    mocker: MockerFixture,
) -> None:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"username": "admin"}
    response.raise_for_status.return_value = None
    get = mocker.patch("superset.db_engine_specs.dhis2.requests.get", return_value=response)

    database = MagicMock(
        sqlalchemy_uri_decrypted=(
            "dhis2://admin:district@play.im.dhis2.org/stable-2-42-4/api"
        )
    )

    assert DHIS2EngineSpec.test_connection(database) is True
    get.assert_called_once_with(
        "https://play.im.dhis2.org/stable-2-42-4/api/me",
        auth=("admin", "district"),
        headers={},
        timeout=10,
    )
