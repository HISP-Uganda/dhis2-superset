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

from __future__ import annotations

from contextlib import contextmanager

import pytest
import sqlalchemy as sqla
from marshmallow import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.session import Session

from superset import db, security_manager
from superset.dhis2.database_repository_org_unit_service import (
    DatabaseRepositoryOrgUnitService,
    RepositoryReportingUnitPayload,
)
from superset.dhis2.models import DHIS2Instance
from superset.models.core import (
    Database,
    DatabaseRepositoryOrgUnit,
    DatabaseRepositoryOrgUnitLineage,
)


@pytest.fixture
def session(mocker) -> Session:
    engine = create_engine("sqlite://")
    Session_ = sessionmaker(bind=engine)  # noqa: N806
    in_memory_session = Session_()
    in_memory_session.remove = lambda: None  # type: ignore[attr-defined]

    mocker.patch("superset.db.session", in_memory_session)
    return in_memory_session


@contextmanager
def without_database_security_events():
    removed = False
    if sqla.event.contains(
        Database,
        "after_update",
        security_manager.database_after_update,
    ):
        sqla.event.remove(Database, "after_update", security_manager.database_after_update)
        removed = True
    try:
        yield
    finally:
        if removed and not sqla.event.contains(
            Database,
            "after_update",
            security_manager.database_after_update,
        ):
            sqla.event.listen(
                Database,
                "after_update",
                security_manager.database_after_update,
            )


def build_payload(
    *,
    approach: str,
    lowest_data_level_to_use: int | None = None,
    primary_instance_id: int | None = None,
    repository_data_scope: str | None = None,
    repository_org_unit_config: dict | None = None,
) -> RepositoryReportingUnitPayload:
    present_fields = {
        "repository_reporting_unit_approach",
        "lowest_data_level_to_use",
        "primary_instance_id",
        "repository_data_scope",
        "repository_org_unit_config",
    }
    return RepositoryReportingUnitPayload(
        present_fields=present_fields,
        repository_reporting_unit_approach=approach,
        lowest_data_level_to_use=lowest_data_level_to_use,
        primary_instance_id=primary_instance_id,
        repository_data_scope=repository_data_scope,
        repository_org_unit_config=repository_org_unit_config or {},
    )


def seed_database_with_instances(session: Session) -> Database:
    Database.metadata.create_all(session.get_bind())  # pylint: disable=no-member

    session.execute(
        Database.__table__.insert().values(
            id=900,
            database_name="DHIS2 Repository",
            sqlalchemy_uri="dhis2://",
        )
    )
    session.execute(
        DHIS2Instance.__table__.insert(),
        [
            {
                "id": 101,
                "database_id": 900,
                "name": "National eHMIS",
                "url": "https://a.example.org",
                "auth_type": "basic",
                "is_active": True,
                "display_order": 1,
            },
            {
                "id": 102,
                "database_id": 900,
                "name": "Non Routine",
                "url": "https://b.example.org",
                "auth_type": "basic",
                "is_active": True,
                "display_order": 2,
            },
        ],
    )
    session.commit()
    return session.get(Database, 900)


def test_validate_and_persist_writes_repository_org_units_and_lineage(
    session: Session,
) -> None:
    database = seed_database_with_instances(session)
    payload = build_payload(
        approach="map_merge",
        lowest_data_level_to_use=2,
        repository_data_scope="children",
        repository_org_unit_config={
            "selected_org_units": ["OU_A_ROOT", "OU_B_ROOT"],
            "selected_org_unit_details": [
                {
                    "selectionKey": "OU_A_ROOT",
                    "sourceOrgUnitId": "OU_A_ROOT",
                    "displayName": "Uganda",
                    "level": 1,
                    "path": "/OU_A_ROOT",
                    "sourceInstanceIds": [101],
                },
                {
                    "selectionKey": "OU_B_ROOT",
                    "sourceOrgUnitId": "OU_B_ROOT",
                    "displayName": "Uganda",
                    "level": 1,
                    "path": "/OU_B_ROOT",
                    "sourceInstanceIds": [102],
                },
            ],
            "repository_org_units": [
                {
                    "repository_key": "1:uganda",
                    "display_name": "Uganda",
                    "parent_repository_key": None,
                    "level": 1,
                    "hierarchy_path": "1:uganda",
                    "selection_key": "OU_A_ROOT",
                    "strategy": "map_merge",
                    "source_lineage_label": "A,B",
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_instance_code": "A",
                            "source_org_unit_uid": "OU_A_ROOT",
                            "source_org_unit_name": "Uganda",
                            "source_parent_uid": None,
                            "source_path": "/OU_A_ROOT",
                            "source_level": 1,
                            "provenance": {"selectionKey": "OU_A_ROOT"},
                        },
                        {
                            "instance_id": 102,
                            "source_instance_code": "B",
                            "source_org_unit_uid": "OU_B_ROOT",
                            "source_org_unit_name": "Uganda",
                            "source_parent_uid": None,
                            "source_path": "/OU_B_ROOT",
                            "source_level": 1,
                            "provenance": {"selectionKey": "OU_B_ROOT"},
                        },
                    ],
                    "provenance": {"autoMerged": False},
                },
                {
                    "repository_key": "1:uganda/2:kampala",
                    "display_name": "Kampala",
                    "parent_repository_key": "1:uganda",
                    "level": 2,
                    "hierarchy_path": "1:uganda/2:kampala",
                    "selection_key": "OU_A_KLA",
                    "strategy": "map_merge",
                    "source_lineage_label": "A",
                    "is_unmatched": True,
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_instance_code": "A",
                            "source_org_unit_uid": "OU_A_KLA",
                            "source_org_unit_name": "Kampala",
                            "source_parent_uid": "OU_A_ROOT",
                            "source_path": "/OU_A_ROOT/OU_A_KLA",
                            "source_level": 2,
                            "provenance": {
                                "collapsedAncestorKeys": ["OU_A_REGION"],
                                "collapsedAncestors": [
                                    {
                                        "selectionKey": "OU_A_REGION",
                                        "sourceOrgUnitId": "OU_A_REGION",
                                        "displayName": "Central",
                                        "level": 2,
                                    }
                                ],
                                "effectiveParentSourceOrgUnitUid": "OU_A_ROOT",
                            },
                        }
                    ],
                    "provenance": {
                        "collapsedAncestorKeys": ["OU_A_REGION"],
                        "collapsedAncestors": [
                            {
                                "selectionKey": "OU_A_REGION",
                                "sourceOrgUnitId": "OU_A_REGION",
                                "displayName": "Central",
                                "level": 2,
                            }
                        ],
                    },
                },
            ],
            "enabled_dimensions": {
                "levels": [
                    {
                        "key": "level:1",
                        "label": "Country",
                        "repository_level": 1,
                        "source_refs": [
                            {
                                "instance_id": 101,
                                "source_level": 1,
                            },
                            {
                                "instance_id": 102,
                                "source_level": 1,
                            },
                        ],
                    },
                    {
                        "key": "level:2",
                        "label": "District",
                        "repository_level": 2,
                        "source_refs": [
                            {
                                "instance_id": 101,
                                "source_level": 2,
                            }
                        ],
                    },
                ],
                "groups": [
                    {
                        "key": "g_urban",
                        "label": "Urban",
                        "source_refs": [
                            {
                                "instance_id": 101,
                                "source_id": "g_urban",
                            }
                        ],
                    }
                ],
                "group_sets": [
                    {
                        "key": "gs_ownership",
                        "label": "Ownership",
                        "source_refs": [
                            {
                                "instance_id": 101,
                                "source_id": "gs_ownership",
                            }
                        ],
                    }
                ],
            },
        },
    )

    with without_database_security_events():
        DatabaseRepositoryOrgUnitService.validate_and_persist(database, payload)
        db.session.flush()
        db.session.expire_all()

    persisted_database = session.get(Database, 900)
    assert persisted_database is not None
    assert persisted_database.repository_reporting_unit_approach == "map_merge"
    assert persisted_database.lowest_data_level_to_use == 2
    assert persisted_database.repository_data_scope == "children"
    assert persisted_database.repository_org_unit_config["selected_org_units"] == [
        "OU_A_ROOT",
        "OU_B_ROOT",
    ]
    assert (
        persisted_database.repository_org_unit_config["enabled_dimensions"]["groups"][0][
            "label"
        ]
        == "Urban"
    )
    assert len(persisted_database.repository_org_units_data) == 2
    assert (
        persisted_database.repository_org_units_data[0]["lineage"][0][
            "source_org_unit_uid"
        ]
        == "OU_A_ROOT"
    )
    assert persisted_database.repository_org_units_data[1]["provenance"] == {
        "collapsedAncestorKeys": ["OU_A_REGION"],
        "collapsedAncestors": [
            {
                "selectionKey": "OU_A_REGION",
                "sourceOrgUnitId": "OU_A_REGION",
                "displayName": "Central",
                "level": 2,
            }
        ],
    }
    assert persisted_database.repository_org_units_data[1]["lineage"][0][
        "provenance"
    ] == {
        "collapsedAncestorKeys": ["OU_A_REGION"],
        "collapsedAncestors": [
            {
                "selectionKey": "OU_A_REGION",
                "sourceOrgUnitId": "OU_A_REGION",
                "displayName": "Central",
                "level": 2,
            }
        ],
        "effectiveParentSourceOrgUnitUid": "OU_A_ROOT",
    }
    summary = persisted_database.repository_org_unit_summary
    assert summary["last_finalized_at"] is not None
    assert summary == {
        "approach": "map_merge",
        "lowest_data_level_to_use": 2,
        "primary_instance_id": None,
        "data_scope": "children",
        "status": "ready",
        "status_message": None,
        "task_id": None,
        "last_finalized_at": summary["last_finalized_at"],
        "total_repository_org_units": 2,
        "source_lineage_counts": {"A,B": 1, "A": 1},
        "conflicted_count": 0,
        "unmatched_count": 1,
        "enabled_level_dimensions": 2,
        "enabled_group_dimensions": 1,
        "enabled_group_set_dimensions": 1,
    }

    persisted_units = (
        session.query(DatabaseRepositoryOrgUnit)
        .filter(DatabaseRepositoryOrgUnit.database_id == 900)
        .order_by(DatabaseRepositoryOrgUnit.level.asc())
        .all()
    )
    assert [unit.repository_key for unit in persisted_units] == [
        "1:uganda",
        "1:uganda/2:kampala",
    ]

    persisted_lineage = (
        session.query(DatabaseRepositoryOrgUnitLineage)
        .filter(DatabaseRepositoryOrgUnitLineage.database_id == 900)
        .order_by(
            DatabaseRepositoryOrgUnitLineage.instance_id.asc(),
            DatabaseRepositoryOrgUnitLineage.source_org_unit_uid.asc(),
        )
        .all()
    )
    assert [
        (lineage.instance_id, lineage.source_instance_code, lineage.source_org_unit_uid)
        for lineage in persisted_lineage
    ] == [
        (101, "A", "OU_A_KLA"),
        (101, "A", "OU_A_ROOT"),
        (102, "B", "OU_B_ROOT"),
    ]


def test_validate_rejects_descendant_conflicts_when_scope_includes_descendants() -> None:
    database = Database(database_name="DHIS2 Repository", sqlalchemy_uri="dhis2://")
    database.id = 901
    database.dhis2_instances = [
        DHIS2Instance(id=101, database_id=901, name="National", url="https://a.example"),
    ]

    payload = build_payload(
        approach="primary_instance",
        lowest_data_level_to_use=3,
        primary_instance_id=101,
        repository_data_scope="children",
        repository_org_unit_config={
            "selected_org_unit_details": [
                {
                    "selectionKey": "OU_PARENT",
                    "sourceOrgUnitId": "OU_PARENT",
                    "displayName": "Region",
                    "level": 1,
                    "path": "/OU_PARENT",
                    "sourceInstanceIds": [101],
                },
                {
                    "selectionKey": "OU_CHILD",
                    "sourceOrgUnitId": "OU_CHILD",
                    "displayName": "District",
                    "level": 2,
                    "path": "/OU_PARENT/OU_CHILD",
                    "sourceInstanceIds": [101],
                },
            ],
            "repository_org_units": [
                {
                    "repository_key": "OU_PARENT",
                    "display_name": "Region",
                    "level": 1,
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_org_unit_uid": "OU_PARENT",
                            "source_level": 1,
                        }
                    ],
                }
            ],
        },
    )

    with pytest.raises(ValidationError) as exc_info:
        DatabaseRepositoryOrgUnitService.validate_and_persist(database, payload)

    assert exc_info.value.messages == {
        "repository_org_unit_config": [
            "Selected descendants are already covered by the chosen data scope."
        ]
    }


def test_validate_rejects_enabled_dimensions_without_valid_instance_refs() -> None:
    database = Database(database_name="DHIS2 Repository", sqlalchemy_uri="dhis2://")
    database.id = 901
    database.dhis2_instances = [
        DHIS2Instance(id=101, database_id=901, name="National", url="https://a.example"),
    ]

    payload = build_payload(
        approach="primary_instance",
        lowest_data_level_to_use=2,
        primary_instance_id=101,
        repository_data_scope="selected",
        repository_org_unit_config={
            "repository_org_units": [
                {
                    "repository_key": "OU_PARENT",
                    "display_name": "Region",
                    "level": 1,
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_org_unit_uid": "OU_PARENT",
                            "source_level": 1,
                        }
                    ],
                }
            ],
            "enabled_dimensions": {
                "groups": [
                    {
                        "key": "g_urban",
                        "label": "Urban",
                        "source_refs": [{"instance_id": 999, "source_id": "g_urban"}],
                    }
                ]
            },
        },
    )

    with pytest.raises(ValidationError) as exc_info:
        DatabaseRepositoryOrgUnitService.validate_and_persist(database, payload)

    assert exc_info.value.messages == {
        "repository_org_unit_config": [
            "Enabled org unit group source references must point to configured DHIS2 instances."
        ]
    }


def test_validate_rejects_lineage_deeper_than_lowest_data_level_to_use() -> None:
    database = Database(database_name="DHIS2 Repository", sqlalchemy_uri="dhis2://")
    database.id = 902
    database.dhis2_instances = [
        DHIS2Instance(id=101, database_id=902, name="National", url="https://a.example"),
    ]

    payload = build_payload(
        approach="primary_instance",
        lowest_data_level_to_use=2,
        primary_instance_id=101,
        repository_data_scope="all_levels",
        repository_org_unit_config={
            "repository_org_units": [
                {
                    "repository_key": "OU_FACILITY",
                    "display_name": "Facility",
                    "level": 3,
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_org_unit_uid": "OU_FACILITY",
                            "source_level": 3,
                        }
                    ],
                }
            ],
        },
    )

    with pytest.raises(ValidationError) as exc_info:
        DatabaseRepositoryOrgUnitService.validate_and_persist(database, payload)

    assert exc_info.value.messages == {
        "lowest_data_level_to_use": [
            "Repository org units deeper than the selected lowest data level cannot be saved.",
            "Repository lineage entries deeper than the selected lowest data level cannot be saved.",
        ]
    }


def test_validate_and_stage_marks_database_queued_without_persisting_rows(
    session: Session,
) -> None:
    database = seed_database_with_instances(session)
    payload = build_payload(
        approach="primary_instance",
        lowest_data_level_to_use=2,
        primary_instance_id=101,
        repository_data_scope="children",
        repository_org_unit_config={
            "selected_org_units": ["OU_A_ROOT"],
            "selected_org_unit_details": [
                {
                    "selectionKey": "OU_A_ROOT",
                    "sourceOrgUnitId": "OU_A_ROOT",
                    "displayName": "Uganda",
                    "level": 1,
                    "path": "/OU_A_ROOT",
                    "sourceInstanceIds": [101],
                }
            ],
            "repository_org_units": [
                {
                    "repository_key": "1:uganda",
                    "display_name": "Uganda",
                    "level": 1,
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_org_unit_uid": "OU_A_ROOT",
                            "source_org_unit_name": "Uganda",
                            "source_level": 1,
                        }
                    ],
                }
            ],
        },
    )

    with without_database_security_events():
        DatabaseRepositoryOrgUnitService.validate_and_stage(database, payload)
        db.session.flush()
        db.session.expire_all()

    persisted_database = session.get(Database, 900)
    assert persisted_database is not None
    assert persisted_database.repository_reporting_unit_approach == "primary_instance"
    assert persisted_database.repository_org_unit_effective_status == "queued"
    assert persisted_database.repository_org_units_data[0]["repository_key"] == "1:uganda"
    assert (
        session.query(DatabaseRepositoryOrgUnit)
        .filter(DatabaseRepositoryOrgUnit.database_id == 900)
        .count()
        == 0
    )


def test_finalize_database_persists_staged_repository_org_units_and_marks_ready(
    session: Session,
) -> None:
    database = seed_database_with_instances(session)
    payload = build_payload(
        approach="primary_instance",
        lowest_data_level_to_use=2,
        primary_instance_id=101,
        repository_data_scope="children",
        repository_org_unit_config={
            "selected_org_units": ["OU_A_ROOT"],
            "selected_org_unit_details": [
                {
                    "selectionKey": "OU_A_ROOT",
                    "sourceOrgUnitId": "OU_A_ROOT",
                    "displayName": "Uganda",
                    "level": 1,
                    "path": "/OU_A_ROOT",
                    "sourceInstanceIds": [101],
                }
            ],
            "repository_org_units": [
                {
                    "repository_key": "1:uganda",
                    "display_name": "Uganda",
                    "level": 1,
                    "hierarchy_path": "1:uganda",
                    "lineage": [
                        {
                            "instance_id": 101,
                            "source_org_unit_uid": "OU_A_ROOT",
                            "source_org_unit_name": "Uganda",
                            "source_level": 1,
                        }
                    ],
                }
            ],
        },
    )

    with without_database_security_events():
        DatabaseRepositoryOrgUnitService.validate_and_stage(database, payload)
        db.session.flush()
        DatabaseRepositoryOrgUnitService.finalize_database(900, task_id="celery-1")
        db.session.expire_all()

    persisted_database = session.get(Database, 900)
    assert persisted_database is not None
    assert persisted_database.repository_org_unit_effective_status == "ready"
    assert persisted_database.repository_org_unit_task_id is None
    assert persisted_database.repository_org_unit_last_finalized_at is not None
    assert len(persisted_database.repository_org_units_data) == 1
    assert (
        session.query(DatabaseRepositoryOrgUnit)
        .filter(DatabaseRepositoryOrgUnit.database_id == 900)
        .count()
        == 1
    )
