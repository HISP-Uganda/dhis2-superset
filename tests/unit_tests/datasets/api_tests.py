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
from unittest.mock import Mock, patch

from sqlalchemy.orm.session import Session

from superset import db
from superset.datasets.schemas import DatasetPostSchema


def test_put_invalid_dataset(
    session: Session,
    client: Any,
    full_api_access: None,
) -> None:
    """
    Test invalid payloads.
    """
    from superset.connectors.sqla.models import SqlaTable
    from superset.models.core import Database

    SqlaTable.metadata.create_all(db.session.get_bind())

    database = Database(
        database_name="my_db",
        sqlalchemy_uri="sqlite://",
    )
    dataset = SqlaTable(
        table_name="test_put_invalid_dataset",
        database=database,
    )
    db.session.add(dataset)
    db.session.flush()

    response = client.put(
        "/api/v1/dataset/1",
        json={"invalid": "payload"},
    )
    assert response.status_code == 422
    assert response.json == {
        "errors": [
            {
                "message": "The schema of the submitted payload is invalid.",
                "error_type": "MARSHMALLOW_ERROR",
                "level": "error",
                "extra": {
                    "messages": {"invalid": ["Unknown field."]},
                    "payload": {"invalid": "payload"},
                    "issue_codes": [
                        {
                            "code": 1040,
                            "message": (
                                "Issue 1040 - The submitted payload failed validation."
                            ),
                        }
                    ],
                },
            }
        ]
    }


def test_post_schema_accepts_staged_local_dataset_fields() -> None:
    payload = DatasetPostSchema().load(
        {
            "database": 7,
            "table_name": "ANC Coverage",
            "sql": "SELECT * FROM dhis2_staging.ds_4_anc_coverage",
            "is_sqllab_view": True,
            "extra": '{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}',
        }
    )

    assert payload["database"] == 7
    assert payload["is_sqllab_view"] is True
    assert payload["extra"] == (
        '{"dhis2_staged_local": true, "dhis2_staged_dataset_id": 4}'
    )


def test_put_override_columns_skips_refresh_for_staged_local_dataset(
    client: Any,
    full_api_access: None,
) -> None:
    staged_local_dataset = Mock(id=7, is_dhis2_staged_local=True)

    with patch(
        "superset.datasets.api.UpdateDatasetCommand.run",
        return_value=staged_local_dataset,
    ), patch("superset.datasets.api.RefreshDatasetCommand.run") as refresh_mock:
        response = client.put(
            "/api/v1/dataset/7?override_columns=true",
            json={
                "columns": [
                    {
                        "column_name": "new_col",
                        "description": "description",
                        "expression": "expression",
                        "type": "INTEGER",
                        "advanced_data_type": "ADVANCED_DATA_TYPE",
                        "verbose_name": "New Col",
                    }
                ]
            },
        )

    assert response.status_code == 200
    refresh_mock.assert_not_called()


def test_put_override_columns_refreshes_standard_dataset(
    client: Any,
    full_api_access: None,
) -> None:
    standard_dataset = Mock(id=8, is_dhis2_staged_local=False)

    with patch(
        "superset.datasets.api.UpdateDatasetCommand.run",
        return_value=standard_dataset,
    ), patch("superset.datasets.api.RefreshDatasetCommand.run") as refresh_mock:
        response = client.put(
            "/api/v1/dataset/8?override_columns=true",
            json={
                "columns": [
                    {
                        "column_name": "new_col",
                        "description": "description",
                        "expression": "expression",
                        "type": "INTEGER",
                        "advanced_data_type": "ADVANCED_DATA_TYPE",
                        "verbose_name": "New Col",
                    }
                ]
            },
        )

    assert response.status_code == 200
    refresh_mock.assert_called_once_with()
