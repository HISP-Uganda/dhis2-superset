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
import importlib
from os import environ
from pathlib import Path
from typing import TYPE_CHECKING

from superset.app import create_app

if TYPE_CHECKING:
    from typing import Any

    from flask.testing import FlaskClient


# DEPRECATED: Creating global app instance - use app fixture from conftest.py instead
superset_config_module = environ.get(
    "SUPERSET_CONFIG", "tests.integration_tests.superset_test_config"
)
if superset_config_module.startswith("tests.integration_tests."):
    config = importlib.import_module(superset_config_module)
    database_uri = getattr(config, "SQLALCHEMY_DATABASE_URI", "")
    if database_uri.startswith("sqlite:///"):
        sqlite_path = Path(database_uri.removeprefix("sqlite:///"))
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        for suffix in ("", "-shm", "-wal"):
            candidate = Path(f"{sqlite_path}{suffix}")
            if candidate.exists():
                candidate.unlink()

app = create_app(superset_config_module=superset_config_module)


def login(
    client: "FlaskClient[Any]",
    username: str = "admin",
    password: str = "general",  # noqa: S107
):
    resp = client.post(
        "/login/",
        data=dict(username=username, password=password),  # noqa: C408
    ).get_data(as_text=True)
    assert "User confirmation needed" not in resp
    return resp
