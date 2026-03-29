from unittest.mock import Mock

import prison

def test_dataset_role_default_filter_applies_metadata_only(app):
    from superset.connectors.sqla.models import SqlaTable
    from superset.datasets.filters import DatasetRoleDefaultFilter
    from superset.datasets.policy import DatasetRole

    datamodel = Mock(obj=SqlaTable)
    query = Mock()
    query.filter.return_value = query

    with app.test_request_context("/api/v1/dataset/"):
        result = DatasetRoleDefaultFilter("dataset_role", datamodel).apply(query, None)

    assert result is query
    filter_expr = query.filter.call_args.args[0]
    assert filter_expr.compare(
        SqlaTable.dataset_role == DatasetRole.METADATA.value
    )


def test_dataset_role_default_filter_skips_when_dataset_role_explicitly_filtered(app):
    from superset.datasets.filters import DatasetRoleDefaultFilter
    from superset.datasets.policy import DatasetRole

    datamodel = Mock(obj=Mock())
    query = Mock()
    query.filter.return_value = query
    request_q = prison.dumps(
        {
            "filters": [
                {
                    "col": "dataset_role",
                    "opr": "eq",
                    "value": DatasetRole.METADATA.value,
                }
            ]
        }
    )

    with app.test_request_context(f"/api/v1/dataset/?q={request_q}"):
        result = DatasetRoleDefaultFilter("dataset_role", datamodel).apply(query, None)

    assert result is query
    query.filter.assert_not_called()


def test_dataset_context_filter_metadata_edit_allows_metadata_only():
    from superset.connectors.sqla.models import SqlaTable
    from superset.datasets.filters import DatasetContextFilter
    from superset.datasets.policy import DatasetContext, DatasetRole

    datamodel = Mock(obj=SqlaTable)
    query = Mock()
    query.filter.return_value = query

    result = DatasetContextFilter("dataset_role", datamodel).apply(
        query,
        DatasetContext.METADATA_EDIT.value,
    )

    assert result is query
    filter_expr = query.filter.call_args.args[0]
    assert filter_expr.compare(
        SqlaTable.dataset_role.in_([DatasetRole.METADATA.value])
    )


def test_dataset_context_filter_chart_excludes_dhis2_staged_local_metadata(app):
    from superset.connectors.sqla.models import SqlaTable
    from superset.datasets.filters import DatasetContextFilter
    from superset.datasets.policy import DatasetContext, DatasetRole

    datamodel = Mock(obj=SqlaTable)
    query = Mock()
    query.filter.return_value = query

    result = DatasetContextFilter("dataset_role", datamodel).apply(
        query,
        DatasetContext.CHART.value,
    )

    assert result is query
    assert query.filter.call_count == 2
    second_expr = query.filter.call_args_list[1].args[0]
    rendered = str(second_expr)
    assert "NOT" in rendered
    assert "tables.dataset_role" in rendered
    assert "tables.extra LIKE" in rendered
