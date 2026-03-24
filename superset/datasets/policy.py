from enum import Enum
from typing import Set

class DatasetRole(str, Enum):
    SERVING = "SERVING_DATASET"
    METADATA_UI = "METADATA_UI_DATASET"

class DatasetContext(str, Enum):
    CHART = "chart"
    DASHBOARD = "dashboard"
    EXPLORE = "explore"
    ANALYSIS = "analysis"
    METADATA_EDIT = "dataset_metadata_edit"
    METADATA_UPDATE = "dataset_metadata_update"
    ADMIN_ALL = "admin_all"

class DatasetEligibilityPolicy:
    ALLOWED_ROLES = {
        DatasetContext.CHART: {DatasetRole.SERVING},
        DatasetContext.DASHBOARD: {DatasetRole.SERVING},
        DatasetContext.EXPLORE: {DatasetRole.SERVING},
        DatasetContext.ANALYSIS: {DatasetRole.SERVING},
        DatasetContext.METADATA_EDIT: {DatasetRole.METADATA_UI},
        DatasetContext.METADATA_UPDATE: {DatasetRole.METADATA_UI},
        DatasetContext.ADMIN_ALL: {DatasetRole.SERVING, DatasetRole.METADATA_UI},
    }

    @classmethod
    def get_allowed_roles(cls, context: DatasetContext) -> Set[DatasetRole]:
        return cls.ALLOWED_ROLES.get(context, set())

    @classmethod
    def is_eligible(cls, role: DatasetRole, context: DatasetContext) -> bool:
        allowed = cls.get_allowed_roles(context)
        return role in allowed
