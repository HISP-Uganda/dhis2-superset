from enum import Enum
from typing import Set

class DatasetRole(str, Enum):
    # System-generated analytical mart (KPI / Map) — shown in chart creation,
    # hidden from the default dataset management list.
    MART = "MART"
    # Original user-created dataset (via /dataset/add/) — shown in
    # the dataset management list for metadata editing.
    METADATA = "METADATA"

class DatasetContext(str, Enum):
    CHART = "chart"
    DASHBOARD = "dashboard"
    EXPLORE = "explore"
    ANALYSIS = "analysis"
    METADATA_EDIT = "dataset_metadata_edit"
    METADATA_UPDATE = "dataset_metadata_update"
    ADMIN_ALL = "admin_all"
    SQL_LAB = "sql_lab"

class DatasetEligibilityPolicy:
    ALLOWED_ROLES = {
        # Chart / explore / sql_lab contexts expose ONLY dedicated analytical marts.
        # Original METADATA definitions are hidden here to ensure users always
        # build against the high-performance staged marts.
        DatasetContext.CHART: {DatasetRole.MART},
        DatasetContext.DASHBOARD: {DatasetRole.MART},
        DatasetContext.EXPLORE: {DatasetRole.MART},
        DatasetContext.ANALYSIS: {DatasetRole.MART},
        DatasetContext.SQL_LAB: {DatasetRole.MART},
        DatasetContext.METADATA_EDIT: {DatasetRole.METADATA},
        DatasetContext.METADATA_UPDATE: {DatasetRole.METADATA},
        DatasetContext.ADMIN_ALL: {
            DatasetRole.MART,
            DatasetRole.METADATA,
        },
    }

    @classmethod
    def get_allowed_roles(cls, context: DatasetContext) -> Set[DatasetRole]:
        return cls.ALLOWED_ROLES.get(context, set())

    @classmethod
    def is_eligible(cls, role: DatasetRole, context: DatasetContext) -> bool:
        allowed = cls.get_allowed_roles(context)
        return role in allowed
