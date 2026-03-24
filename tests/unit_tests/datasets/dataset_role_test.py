import pytest
from superset.datasets.policy import DatasetContext, DatasetEligibilityPolicy, DatasetRole
from superset.commands.chart.exceptions import ChartInvalidDatasetRoleError
from superset.explore.exceptions import DatasetAccessDeniedError
from superset.commands.dataset.exceptions import DatasetInvalidError
from marshmallow import ValidationError

def test_dataset_role_model():
    assert DatasetRole.SERVING == "SERVING_DATASET"
    assert DatasetRole.METADATA_UI == "METADATA_UI_DATASET"

def test_dataset_eligibility_policy():
    # Chart
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.SERVING, DatasetContext.CHART)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA_UI, DatasetContext.CHART)
    
    # Dashboard
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.SERVING, DatasetContext.DASHBOARD)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA_UI, DatasetContext.DASHBOARD)
    
    # Explore
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.SERVING, DatasetContext.EXPLORE)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA_UI, DatasetContext.EXPLORE)
    
    # Analysis
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.SERVING, DatasetContext.ANALYSIS)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA_UI, DatasetContext.ANALYSIS)
    
    # Metadata Edit
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.SERVING, DatasetContext.METADATA_EDIT)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA_UI, DatasetContext.METADATA_EDIT)
    
    # Metadata Update
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.SERVING, DatasetContext.METADATA_UPDATE)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA_UI, DatasetContext.METADATA_UPDATE)
