import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from superset.dhis2.superset_dataset_service import (
    _ensure_dhis2_extra,
    _is_metadata_wrapper_candidate,
    register_serving_table_as_superset_dataset,
)


def test_ensure_dhis2_extra_updates_saved_dataset_display_name() -> None:
    sqla_table = SimpleNamespace(extra=json.dumps({"dhis2_staged_dataset_id": 7}))

    _ensure_dhis2_extra(
        sqla_table,
        7,
        dataset_display_name="MAL - Routine eHMIS Indicators [MART]",
        serving_table_ref="dhis2_serving.sv_7_mal_routine_ehmis_indicators_mart",
    )

    extra = json.loads(sqla_table.extra)
    assert (
        extra["dhis2_dataset_display_name"]
        == "MAL - Routine eHMIS Indicators [MART]"
    )
    assert (
        extra["dhis2_serving_table_ref"]
        == "dhis2_serving.sv_7_mal_routine_ehmis_indicators_mart"
    )


def test_is_metadata_wrapper_candidate_matches_logical_virtual_wrapper() -> None:
    sqla_table = SimpleNamespace(
        database_id=5,
        schema=None,
        sql="SELECT * FROM `dhis2_serving`.`sv_7_mal_routine_ehmis_indicators`",
        extra=json.dumps(
            {
                "dhis2_staged_local": True,
                "dhis2_serving_table_ref": "`dhis2_serving`.`sv_7_mal_routine_ehmis_indicators`",
            }
        ),
    )

    assert _is_metadata_wrapper_candidate(
        sqla_table,
        source_database_id=5,
        serving_table_ref="`dhis2_serving`.`sv_7_mal_routine_ehmis_indicators`",
    )


def test_is_metadata_wrapper_candidate_rejects_physical_source_row() -> None:
    sqla_table = SimpleNamespace(
        database_id=4,
        schema="dhis2_serving",
        sql=None,
        extra=json.dumps(
            {
                "dhis2_staged_local": True,
                "dhis2_serving_table_ref": "`dhis2_serving`.`sv_7_mal_routine_ehmis_indicators`",
            }
        ),
    )

    assert not _is_metadata_wrapper_candidate(
        sqla_table,
        source_database_id=5,
        serving_table_ref="`dhis2_serving`.`sv_7_mal_routine_ehmis_indicators`",
    )


def test_register_serving_table_updates_source_row_not_mart_row() -> None:
    class _FakeQuery:
        def __init__(self, *, all_result=None, first_result=None):
            self._all_result = list(all_result or [])
            self._first_result = first_result

        def filter(self, *_args, **_kwargs):
            return self

        def filter_by(self, **_kwargs):
            return self

        def all(self):
            return list(self._all_result)

        def first(self):
            return self._first_result

    mart_row = SimpleNamespace(
        id=19,
        schema="dhis2_serving",
        table_name="sv_7_mal_routine_ehmis_indicators_mart",
        database_id=4,
        sql=None,
        extra=json.dumps(
            {
                "dhis2_staged_dataset_id": 7,
                "dhis2_serving_table_ref": "dhis2_serving.sv_7_mal_routine_ehmis_indicators_mart",
                "dhis2_dataset_display_name": "MAL - Routine eHMIS Indicators [MART]",
            }
        ),
        dataset_role="MART",
    )
    source_row = SimpleNamespace(
        id=23,
        schema="dhis2_serving",
        table_name="sv_7_mal_routine_ehmis_indicators",
        database_id=4,
        sql=None,
        extra=json.dumps(
            {
                "dhis2_staged_dataset_id": 7,
                "dhis2_serving_table_ref": "`dhis2_serving`.`sv_7_mal_routine_ehmis_indicators`",
                "dhis2_dataset_display_name": "MAL - Routine eHMIS Indicators",
            }
        ),
        dataset_role="DHIS2_SOURCE_DATASET",
    )

    session = SimpleNamespace(
        get=MagicMock(return_value=SimpleNamespace(id=4, database_name="DHIS2 Serving (ClickHouse)")),
        query=MagicMock(
            side_effect=[
                _FakeQuery(all_result=[mart_row, source_row]),
                _FakeQuery(first_result=source_row),
                _FakeQuery(all_result=[]),
            ]
        ),
        no_autoflush=nullcontext(),
        commit=MagicMock(),
    )

    with patch("superset.db.session", session), patch(
        "superset.dhis2.superset_dataset_service._sync_columns",
    ):
        sqla_id = register_serving_table_as_superset_dataset(
            dataset_id=7,
            dataset_name="MAL - Routine eHMIS Indicators",
            serving_table_ref="`dhis2_serving`.`sv_7_mal_routine_ehmis_indicators`",
            serving_columns=[],
            serving_database_id=4,
            source_database_id=5,
        )

    assert sqla_id == 23
    assert source_row.table_name == "sv_7_mal_routine_ehmis_indicators"
    assert source_row.dataset_role == "DHIS2_SOURCE_DATASET"
    assert mart_row.table_name == "sv_7_mal_routine_ehmis_indicators_mart"
    assert mart_row.dataset_role == "MART"
