import json
from types import SimpleNamespace

from superset.datasets.policy import (
    DatasetContext,
    DatasetEligibilityPolicy,
    DatasetRole,
)

def test_dataset_role_model():
    assert DatasetRole.METADATA == "METADATA"
    assert DatasetRole.MART == "MART"
    assert DatasetRole.SOURCE == "DHIS2_SOURCE_DATASET"

def test_dataset_eligibility_policy():
    # Chart allows user datasets and analytical DHIS2 datasets, but not raw sources.
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.CHART)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.CHART)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.SOURCE, DatasetContext.CHART)

    # Dashboard
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.DASHBOARD)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.DASHBOARD)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.SOURCE, DatasetContext.DASHBOARD)

    # Explore
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.EXPLORE)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.EXPLORE)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.SOURCE, DatasetContext.EXPLORE)

    # Analysis
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.ANALYSIS)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.ANALYSIS)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.SOURCE, DatasetContext.ANALYSIS)

    # Metadata Edit shows only user-managed METADATA datasets.
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.METADATA_EDIT)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.SOURCE, DatasetContext.METADATA_EDIT)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.METADATA_EDIT)

    # Metadata Update
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.METADATA_UPDATE)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.SOURCE, DatasetContext.METADATA_UPDATE)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.METADATA_UPDATE)


def test_dataset_eligibility_policy_rejects_dhis2_metadata_wrapper_for_chart_contexts():
    dataset = SimpleNamespace(
        dataset_role=DatasetRole.METADATA.value,
        extra=json.dumps({"dhis2_staged_local": True}),
    )

    assert not DatasetEligibilityPolicy.is_dataset_eligible(dataset, DatasetContext.CHART)
    assert not DatasetEligibilityPolicy.is_dataset_eligible(dataset, DatasetContext.EXPLORE)
    assert not DatasetEligibilityPolicy.is_dataset_eligible(dataset, DatasetContext.ANALYSIS)


def test_dataset_eligibility_policy_allows_standard_metadata_dataset_for_chart_contexts():
    dataset = SimpleNamespace(
        dataset_role=DatasetRole.METADATA.value,
        extra=json.dumps({"certification": {"details": "ok"}}),
    )

    assert DatasetEligibilityPolicy.is_dataset_eligible(dataset, DatasetContext.CHART)
    assert DatasetEligibilityPolicy.is_dataset_eligible(dataset, DatasetContext.EXPLORE)


def test_dataset_eligibility_policy_rejects_legacy_runtime_roles():
    mart_dataset = SimpleNamespace(dataset_role="MART_DATASET", extra=None)
    serving_dataset = SimpleNamespace(dataset_role="SERVING_DATASET", extra=None)

    assert not DatasetEligibilityPolicy.is_dataset_eligible(
        mart_dataset,
        DatasetContext.CHART,
    )
    assert not DatasetEligibilityPolicy.is_dataset_eligible(
        serving_dataset,
        DatasetContext.CHART,
    )
