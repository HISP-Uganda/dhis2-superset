from types import SimpleNamespace

from superset.dhis2.backfill import (
    _classify_dhis2_dataset_role,
    _dhis2_repair_sort_key,
)


def test_classify_dhis2_dataset_role_marks_logical_virtual_wrapper_as_metadata() -> None:
    dataset = SimpleNamespace(
        table_name="Malaria Routine Monthly Datasets",
        schema=None,
        sql="SELECT * FROM `dhis2_serving`.`sv_4_malaria_routine_monthly_datasets`",
    )

    role = _classify_dhis2_dataset_role(
        dataset,
        {
            "dhis2_staged_local": True,
            "dhis2_source_database_id": 5,
            "dhis2_serving_database_id": 4,
        },
    )

    assert role == "METADATA"


def test_dhis2_repair_sort_key_prioritizes_source_before_metadata() -> None:
    source_dataset = SimpleNamespace(
        id=25,
        table_name="sv_4_malaria_routine_monthly_datasets",
        schema="dhis2_serving",
        sql=None,
        extra='{"dhis2_staged_local": true}',
    )
    metadata_dataset = SimpleNamespace(
        id=28,
        table_name="Malaria Routine Monthly Datasets",
        schema=None,
        sql="SELECT * FROM `dhis2_serving`.`sv_4_malaria_routine_monthly_datasets`",
        extra='{"dhis2_staged_local": true}',
    )

    assert _dhis2_repair_sort_key(source_dataset) < _dhis2_repair_sort_key(
        metadata_dataset
    )
