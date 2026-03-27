import pytest
from superset.datasets.policy import DatasetContext, DatasetEligibilityPolicy, DatasetRole
from superset.commands.chart.exceptions import ChartInvalidDatasetRoleError
from marshmallow import ValidationError

def test_dataset_role_model():
    assert DatasetRole.MART == "MART"
    assert DatasetRole.METADATA == "METADATA"

def test_dataset_eligibility_policy():
    # Chart (ONLY MART allowed)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.CHART)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.CHART)
    
    # Dashboard (ONLY MART allowed)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.DASHBOARD)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.DASHBOARD)
    
    # Explore (ONLY MART allowed)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.EXPLORE)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.EXPLORE)
    
    # Analysis (ONLY MART allowed)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.ANALYSIS)
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.ANALYSIS)
    
    # Metadata Edit
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.METADATA_EDIT)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.METADATA_EDIT)
    
    # Metadata Update
    assert not DatasetEligibilityPolicy.is_eligible(DatasetRole.MART, DatasetContext.METADATA_UPDATE)
    assert DatasetEligibilityPolicy.is_eligible(DatasetRole.METADATA, DatasetContext.METADATA_UPDATE)
