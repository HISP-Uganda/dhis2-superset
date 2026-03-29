import json
from enum import Enum
from typing import Any, Set


class DatasetRole(str, Enum):
    # Original user-created dataset (via /dataset/add/) — shown in the
    # dataset management list for metadata editing and available for charts.
    METADATA = "METADATA"
    # User-facing analytical dataset backed by the consolidated DHIS2 `_mart`
    # physical table. Available in chart/explore flows, hidden from the
    # dataset-management list.
    MART = "MART"
    # Raw DHIS2 source registrations (`sv_*`). Hidden from dataset management
    # and chart contexts.
    SOURCE = "DHIS2_SOURCE_DATASET"


LEGACY_DATASET_ROLE_VALUES = frozenset({"MART_DATASET", "SERVING_DATASET", "SERVING"})

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
        # Standard Superset datasets and user-facing DHIS2 serving datasets are
        # available for analytical contexts. Raw DHIS2 source registrations are not.
        DatasetContext.CHART: {
            DatasetRole.METADATA,
            DatasetRole.MART,
        },
        DatasetContext.DASHBOARD: {
            DatasetRole.METADATA,
            DatasetRole.MART,
        },
        DatasetContext.EXPLORE: {
            DatasetRole.METADATA,
            DatasetRole.MART,
        },
        DatasetContext.ANALYSIS: {
            DatasetRole.METADATA,
            DatasetRole.MART,
        },
        DatasetContext.SQL_LAB: {
            DatasetRole.METADATA,
            DatasetRole.MART,
        },
        DatasetContext.METADATA_EDIT: {DatasetRole.METADATA},
        DatasetContext.METADATA_UPDATE: {DatasetRole.METADATA},
        DatasetContext.ADMIN_ALL: {
            DatasetRole.METADATA,
            DatasetRole.MART,
            DatasetRole.SOURCE,
        },
    }

    @classmethod
    def get_allowed_roles(cls, context: DatasetContext) -> Set[DatasetRole]:
        return cls.ALLOWED_ROLES.get(context, set())

    @classmethod
    def is_eligible(cls, role: DatasetRole, context: DatasetContext) -> bool:
        allowed = cls.get_allowed_roles(context)
        return role in allowed

    @classmethod
    def is_dataset_eligible(cls, dataset: Any, context: DatasetContext) -> bool:
        role_value = str(getattr(dataset, "dataset_role", "") or "").strip()
        if role_value in LEGACY_DATASET_ROLE_VALUES:
            return False
        if not role_value:
            return True
        try:
            role = DatasetRole(role_value)
        except ValueError:
            return True
        if not cls.is_eligible(role, context):
            return False
        if (
            context
            in {
                DatasetContext.CHART,
                DatasetContext.DASHBOARD,
                DatasetContext.EXPLORE,
                DatasetContext.ANALYSIS,
            }
            and role == DatasetRole.METADATA
        ):
            raw_extra = getattr(dataset, "extra", None)
            try:
                extra = (
                    json.loads(raw_extra)
                    if isinstance(raw_extra, str)
                    else dict(raw_extra or {})
                )
            except Exception:
                extra = {}
            if extra.get("dhis2_staged_local") is True:
                return False
        return True
