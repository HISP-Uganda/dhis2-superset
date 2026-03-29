from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from flask import current_app, has_app_context
from marshmallow import ValidationError
from sqlalchemy import event

from superset import db
from superset.models.core import (
    Database,
    DatabaseRepositoryOrgUnit,
    DatabaseRepositoryOrgUnitLineage,
)
from superset.utils import json

REPOSITORY_REPORTING_UNIT_APPROACHES = {
    "primary_instance",
    "map_merge",
    "auto_merge",
    "separate",
}
REPOSITORY_DATA_SCOPES = {
    "selected",
    "children",
    "grandchildren",
    "ancestors",
    "all_levels",
}
REPOSITORY_FINALIZATION_STATUSES = {
    "not_configured",
    "queued",
    "running",
    "ready",
    "failed",
}
_REPOSITORY_FIELDS = {
    "repository_reporting_unit_approach",
    "lowest_data_level_to_use",
    "primary_instance_id",
    "repository_data_scope",
    "repository_org_unit_config",
    "repository_org_units",
}
_BACKGROUND_FINALIZATION_DELAY_SECONDS = 0.25

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RepositoryReportingUnitPayload:
    present_fields: set[str]
    repository_reporting_unit_approach: Any
    lowest_data_level_to_use: Any
    primary_instance_id: Any
    repository_data_scope: Any
    repository_org_unit_config: dict[str, Any]


def extract_repository_reporting_unit_payload(
    properties: dict[str, Any],
) -> RepositoryReportingUnitPayload | None:
    present_fields = {field for field in _REPOSITORY_FIELDS if field in properties}
    if not present_fields:
        return None

    config = properties.pop("repository_org_unit_config", None)
    repository_org_unit_config = (
        dict(config) if isinstance(config, dict) else {}
    )
    if "repository_org_units" in properties:
        repository_org_unit_config["repository_org_units"] = properties.pop(
            "repository_org_units"
        )

    return RepositoryReportingUnitPayload(
        present_fields=present_fields,
        repository_reporting_unit_approach=properties.get(
            "repository_reporting_unit_approach"
        ),
        lowest_data_level_to_use=properties.get("lowest_data_level_to_use"),
        primary_instance_id=properties.get("primary_instance_id"),
        repository_data_scope=properties.get("repository_data_scope"),
        repository_org_unit_config=repository_org_unit_config,
    )


class DatabaseRepositoryOrgUnitService:
    @classmethod
    def validate_and_persist(
        cls,
        database: Database,
        payload: RepositoryReportingUnitPayload,
    ) -> None:
        config = cls._normalize_config(database, payload)
        cls._validate(database, config, require_candidate_units=True)
        cls._persist_database_config(database, config)
        cls._replace_repository_org_units(database, config)
        cls._set_status(database, status="ready")

    @classmethod
    def validate_and_stage(
        cls,
        database: Database,
        payload: RepositoryReportingUnitPayload,
    ) -> None:
        config = cls._normalize_config(database, payload)
        cls._validate(database, config, require_candidate_units=False)
        cls._persist_database_config(database, config)
        if cls._has_repository_configuration(config):
            cls._set_status(database, status="queued")
            return

        cls._clear_repository_org_units(database)
        cls._set_status(database, status="not_configured")

    @classmethod
    def finalize_database(
        cls,
        database_id: int,
        *,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        database = db.session.get(Database, database_id)
        if database is None:
            return {"status": "skipped", "reason": "database not found"}

        config = {
            "repository_reporting_unit_approach": database.repository_reporting_unit_approach,
            "lowest_data_level_to_use": database.lowest_data_level_to_use,
            "primary_instance_id": database.primary_instance_id,
            "repository_data_scope": database.repository_data_scope,
            "repository_org_unit_config": database.repository_org_unit_config,
        }

        if not cls._has_repository_configuration(config):
            cls._clear_repository_org_units(database)
            cls._set_status(database, status="not_configured")
            db.session.commit()
            return {"status": "not_configured", "database_id": database_id}

        cls._set_status(database, status="running", task_id=task_id)
        db.session.commit()

        try:
            cls._validate(database, config, require_candidate_units=True)
            cls._replace_repository_org_units(database, config)
            cls._set_status(database, status="ready", task_id=None)
            db.session.commit()
            return {
                "status": "ready",
                "database_id": database_id,
                "total_repository_org_units": len(database.repository_org_units_data),
            }
        except ValidationError as ex:
            db.session.rollback()
            database = db.session.get(Database, database_id)
            if database is not None:
                cls._set_status(
                    database,
                    status="failed",
                    message=cls._format_validation_error(ex.messages),
                    task_id=None,
                )
                db.session.commit()
            raise
        except Exception as ex:  # pylint: disable=broad-except
            db.session.rollback()
            database = db.session.get(Database, database_id)
            if database is not None:
                cls._set_status(
                    database,
                    status="failed",
                    message=str(ex),
                    task_id=None,
                )
                db.session.commit()
            logger.exception(
                "Repository org unit finalization failed for database id=%s",
                database_id,
            )
            raise

    @classmethod
    def schedule_finalization_after_commit(
        cls,
        database_id: int,
    ) -> None:
        session = db.session()

        def _fire() -> None:
            cls.schedule_finalization(database_id)

        def _remove_listener(event_name: str, callback: Any) -> None:
            try:
                event.remove(session, event_name, callback)
            except Exception:  # pylint: disable=broad-except
                pass

        def _after_commit(_session: Any) -> None:
            try:
                _fire()
            except Exception:  # pylint: disable=broad-except
                logger.warning(
                    "Deferred repository finalization scheduling failed for database id=%s",
                    database_id,
                    exc_info=True,
                )
            finally:
                _remove_listener("after_rollback", _after_rollback)

        def _after_rollback(_session: Any) -> None:
            _remove_listener("after_commit", _after_commit)

        event.listen(session, "after_commit", _after_commit, once=True)
        event.listen(session, "after_rollback", _after_rollback, once=True)

    @classmethod
    def schedule_finalization(cls, database_id: int) -> dict[str, Any]:
        from superset.dhis2.metadata_staging_service import _celery_workers_available

        if _celery_workers_available():
            try:
                from superset.tasks.dhis2_metadata import (
                    finalize_database_repository_org_units,
                )

                task = finalize_database_repository_org_units.apply_async(
                    kwargs={"database_id": database_id}
                )
                task_id = getattr(task, "id", None)
                database = db.session.get(Database, database_id)
                if database is not None:
                    cls._set_status(database, status="queued", task_id=task_id)
                    db.session.commit()
                return {
                    "scheduled": True,
                    "mode": "celery",
                    "database_id": database_id,
                    "task_id": task_id,
                }
            except Exception:  # pylint: disable=broad-except
                logger.info(
                    "Celery repository finalization dispatch failed for database id=%s, falling back to thread",
                    database_id,
                    exc_info=True,
                )

        _flask_app = current_app._get_current_object() if has_app_context() else None

        def _run() -> None:
            def _do_run() -> None:
                try:
                    cls.finalize_database(database_id)
                except Exception:  # pylint: disable=broad-except
                    logger.warning(
                        "Thread fallback repository finalization failed for database id=%s",
                        database_id,
                        exc_info=True,
                    )

            if _flask_app is not None:
                with _flask_app.app_context():
                    _do_run()
            else:
                _do_run()

        thread = threading.Timer(_BACKGROUND_FINALIZATION_DELAY_SECONDS, _run)
        thread.daemon = True
        thread.start()
        return {
            "scheduled": True,
            "mode": "thread",
            "database_id": database_id,
            "task_id": None,
        }

    @classmethod
    def _normalize_config(
        cls,
        database: Database,
        payload: RepositoryReportingUnitPayload,
    ) -> dict[str, Any]:
        current_config = database.repository_org_unit_config
        approach = (
            payload.repository_reporting_unit_approach
            if "repository_reporting_unit_approach" in payload.present_fields
            else database.repository_reporting_unit_approach
        )
        lowest_level = (
            payload.lowest_data_level_to_use
            if "lowest_data_level_to_use" in payload.present_fields
            else database.lowest_data_level_to_use
        )
        primary_instance_id = (
            payload.primary_instance_id
            if "primary_instance_id" in payload.present_fields
            else database.primary_instance_id
        )
        data_scope = (
            payload.repository_data_scope
            if "repository_data_scope" in payload.present_fields
            else database.repository_data_scope
        )
        config = (
            payload.repository_org_unit_config
            if "repository_org_unit_config" in payload.present_fields
            or "repository_org_units" in payload.present_fields
            else current_config
        )

        return {
            "repository_reporting_unit_approach": approach,
            "lowest_data_level_to_use": lowest_level,
            "primary_instance_id": primary_instance_id,
            "repository_data_scope": data_scope,
            "repository_org_unit_config": dict(config) if isinstance(config, dict) else {},
        }

    @classmethod
    def _validate(
        cls,
        database: Database,
        config: dict[str, Any],
        *,
        require_candidate_units: bool,
    ) -> None:
        errors: dict[str, list[str]] = {}

        approach = cls._normalize_optional_string(
            config.get("repository_reporting_unit_approach")
        )
        data_scope = cls._normalize_optional_string(config.get("repository_data_scope"))
        lowest_level = cls._normalize_optional_int(config.get("lowest_data_level_to_use"))
        primary_instance_id = cls._normalize_optional_int(config.get("primary_instance_id"))
        config_payload = config.get("repository_org_unit_config") or {}
        candidate_units = cls._normalize_list(config_payload.get("repository_org_units"))
        separate_configs = cls._normalize_list(config_payload.get("separate_instance_configs"))

        if approach and database.backend != "dhis2":
            cls._add_error(
                errors,
                "repository_reporting_unit_approach",
                "Repository reporting units can only be configured on DHIS2 databases.",
            )

        if approach and approach not in REPOSITORY_REPORTING_UNIT_APPROACHES:
            cls._add_error(
                errors,
                "repository_reporting_unit_approach",
                "Unsupported repository reporting unit approach.",
            )

        if data_scope and data_scope not in REPOSITORY_DATA_SCOPES:
            cls._add_error(
                errors,
                "repository_data_scope",
                "Unsupported repository data scope.",
            )

        if lowest_level is not None and lowest_level <= 0:
            cls._add_error(
                errors,
                "lowest_data_level_to_use",
                "Lowest data level to use must be greater than zero.",
            )

        instance_ids = {
            int(instance.id)
            for instance in getattr(database, "dhis2_instances", []) or []
            if getattr(instance, "id", None) is not None
        }
        if approach == "primary_instance":
            if primary_instance_id is None:
                cls._add_error(
                    errors,
                    "primary_instance_id",
                    "A primary instance is required for the primary-instance approach.",
                )
            elif primary_instance_id not in instance_ids:
                cls._add_error(
                    errors,
                    "primary_instance_id",
                    "Primary instance must belong to this database.",
                )

        if approach == "separate" and not separate_configs:
            cls._add_error(
                errors,
                "repository_org_unit_config",
                "Separate mode requires per-instance repository org unit configuration.",
            )

        if approach and not cls._has_selected_org_unit_configuration(
            config_payload=config_payload,
            separate_configs=separate_configs,
        ):
            cls._add_error(
                errors,
                "repository_org_unit_config",
                "Select repository reporting units before saving.",
            )

        cls._validate_selected_org_unit_conflicts(errors, config_payload, data_scope)
        cls._validate_enabled_dimensions(errors, config_payload, instance_ids)
        if require_candidate_units:
            if not candidate_units and approach:
                cls._add_error(
                    errors,
                    "repository_org_unit_config",
                    "At least one repository org unit must be resolved before finalization.",
                )
            cls._validate_candidate_units(
                errors=errors,
                candidate_units=candidate_units,
                instance_ids=instance_ids,
                approach=approach,
                lowest_level=lowest_level,
                primary_instance_id=primary_instance_id,
            )

        if errors:
            raise ValidationError(errors)

        config["repository_reporting_unit_approach"] = approach
        config["repository_data_scope"] = data_scope
        config["lowest_data_level_to_use"] = lowest_level
        config["primary_instance_id"] = primary_instance_id
        config["repository_org_unit_config"] = config_payload

    @classmethod
    def _validate_enabled_dimensions(
        cls,
        errors: dict[str, list[str]],
        config_payload: dict[str, Any],
        instance_ids: set[int],
    ) -> None:
        enabled_dimensions = config_payload.get("enabled_dimensions")
        if enabled_dimensions in (None, {}):
            return
        if not isinstance(enabled_dimensions, dict):
            cls._add_error(
                errors,
                "repository_org_unit_config",
                "Enabled repository dimensions must be stored as an object.",
            )
            return

        dimension_specs = {
            "levels": "repository level",
            "groups": "org unit group",
            "group_sets": "org unit group set",
        }
        for field_name, label in dimension_specs.items():
            items = enabled_dimensions.get(field_name)
            if items is None:
                continue
            if not isinstance(items, list):
                cls._add_error(
                    errors,
                    "repository_org_unit_config",
                    f"Enabled {label}s must be provided as a list.",
                )
                continue

            seen_keys: set[str] = set()
            for item in items:
                if not isinstance(item, dict):
                    cls._add_error(
                        errors,
                        "repository_org_unit_config",
                        f"Each enabled {label} must be an object.",
                    )
                    continue
                key = cls._normalize_optional_string(item.get("key"))
                if not key:
                    cls._add_error(
                        errors,
                        "repository_org_unit_config",
                        f"Each enabled {label} must include a key.",
                    )
                    continue
                if key in seen_keys:
                    cls._add_error(
                        errors,
                        "repository_org_unit_config",
                        f"Enabled {label} keys must be unique.",
                    )
                    continue
                seen_keys.add(key)

                if field_name == "levels":
                    repository_level = cls._normalize_optional_int(
                        item.get("repository_level")
                    )
                    if repository_level is None or repository_level <= 0:
                        cls._add_error(
                            errors,
                            "repository_org_unit_config",
                            "Enabled repository levels must include a positive repository_level.",
                        )

                source_refs = cls._normalize_list(item.get("source_refs"))
                if not source_refs:
                    cls._add_error(
                        errors,
                        "repository_org_unit_config",
                        f"Enabled {label}s must retain source-instance references.",
                    )
                    continue

                for source_ref in source_refs:
                    if not isinstance(source_ref, dict):
                        cls._add_error(
                            errors,
                            "repository_org_unit_config",
                            f"Enabled {label} source references must be objects.",
                        )
                        continue
                    instance_id = cls._normalize_optional_int(
                        source_ref.get("instance_id")
                    )
                    if instance_id is None or instance_id not in instance_ids:
                        cls._add_error(
                            errors,
                            "repository_org_unit_config",
                            f"Enabled {label} source references must point to configured DHIS2 instances.",
                        )

    @classmethod
    def _validate_selected_org_unit_conflicts(
        cls,
        errors: dict[str, list[str]],
        config_payload: dict[str, Any],
        data_scope: str | None,
    ) -> None:
        scopes_with_descendants = {"children", "grandchildren", "all_levels"}
        if data_scope not in scopes_with_descendants:
            return

        details = [
            detail
            for detail in cls._normalize_list(config_payload.get("selected_org_unit_details"))
            if isinstance(detail, dict)
        ]
        if not details:
            for separate_config in cls._normalize_list(
                config_payload.get("separate_instance_configs")
            ):
                if not isinstance(separate_config, dict):
                    continue
                details.extend(
                    detail
                    for detail in cls._normalize_list(
                        separate_config.get("selected_org_unit_details")
                    )
                    if isinstance(detail, dict)
                )

        normalized_details = [
            {
                "selection_key": str(
                    detail.get("selectionKey")
                    or detail.get("selection_key")
                    or detail.get("id")
                    or ""
                ).strip(),
                "source_org_unit_id": str(
                    detail.get("sourceOrgUnitId")
                    or detail.get("source_org_unit_id")
                    or detail.get("id")
                    or ""
                ).strip(),
                "path": str(detail.get("path") or "").strip(),
                "source_instance_ids": {
                    int(item)
                    for item in cls._normalize_list(
                        detail.get("sourceInstanceIds")
                        or detail.get("source_instance_ids")
                    )
                    if cls._normalize_optional_int(item) is not None
                },
            }
            for detail in details
        ]
        normalized_details = [
            detail
            for detail in normalized_details
            if detail["selection_key"] and detail["source_org_unit_id"]
        ]

        for ancestor in normalized_details:
            for descendant in normalized_details:
                if ancestor["selection_key"] == descendant["selection_key"]:
                    continue
                if ancestor["source_instance_ids"] and descendant["source_instance_ids"]:
                    if not ancestor["source_instance_ids"] & descendant["source_instance_ids"]:
                        continue
                path = descendant["path"]
                if not path:
                    continue
                path_parts = [part for part in path.split("/") if part]
                if ancestor["source_org_unit_id"] in path_parts[:-1]:
                    cls._add_error(
                        errors,
                        "repository_org_unit_config",
                        "Selected descendants are already covered by the chosen data scope.",
                    )
                    return

    @classmethod
    def _validate_candidate_units(
        cls,
        *,
        errors: dict[str, list[str]],
        candidate_units: list[Any],
        instance_ids: set[int],
        approach: str | None,
        lowest_level: int | None,
        primary_instance_id: int | None,
    ) -> None:
        seen_repository_keys: set[str] = set()
        for candidate in candidate_units:
            if not isinstance(candidate, dict):
                cls._add_error(
                    errors,
                    "repository_org_unit_config",
                    "Repository org units must be objects.",
                )
                continue

            repository_key = str(candidate.get("repository_key") or "").strip()
            display_name = str(candidate.get("display_name") or "").strip()
            if not repository_key:
                cls._add_error(
                    errors,
                    "repository_org_unit_config",
                    "Each repository org unit must include a repository key.",
                )
                continue
            if repository_key in seen_repository_keys:
                cls._add_error(
                    errors,
                    "repository_org_unit_config",
                    "Repository org unit keys must be unique per database.",
                )
                continue
            seen_repository_keys.add(repository_key)

            if not display_name:
                cls._add_error(
                    errors,
                    "repository_org_unit_config",
                    "Each repository org unit must include a display name.",
                )

            level = cls._normalize_optional_int(candidate.get("level"))
            if lowest_level is not None and level is not None and level > lowest_level:
                cls._add_error(
                    errors,
                    "lowest_data_level_to_use",
                    "Repository org units deeper than the selected lowest data level cannot be saved.",
                )

            lineages = cls._normalize_list(candidate.get("lineage"))
            if not lineages:
                cls._add_error(
                    errors,
                    "repository_org_unit_config",
                    "Each repository org unit must retain at least one lineage record.",
                )
                continue

            lineage_instance_ids: set[int] = set()
            for lineage in lineages:
                if not isinstance(lineage, dict):
                    cls._add_error(
                        errors,
                        "repository_org_unit_config",
                        "Repository lineage entries must be objects.",
                    )
                    continue
                instance_id = cls._normalize_optional_int(lineage.get("instance_id"))
                source_org_unit_uid = str(
                    lineage.get("source_org_unit_uid")
                    or lineage.get("sourceOrgUnitUid")
                    or ""
                ).strip()
                source_level = cls._normalize_optional_int(lineage.get("source_level"))

                if instance_id is None or instance_id not in instance_ids:
                    cls._add_error(
                        errors,
                        "repository_org_unit_config",
                        "Repository lineage must reference configured DHIS2 instances.",
                    )
                    continue
                lineage_instance_ids.add(instance_id)

                if not source_org_unit_uid:
                    cls._add_error(
                        errors,
                        "repository_org_unit_config",
                        "Repository lineage must retain the source DHIS2 org unit UID.",
                    )
                if (
                    lowest_level is not None
                    and source_level is not None
                    and source_level > lowest_level
                ):
                    cls._add_error(
                        errors,
                        "lowest_data_level_to_use",
                        "Repository lineage entries deeper than the selected lowest data level cannot be saved.",
                    )

            if approach == "primary_instance" and lineage_instance_ids:
                if primary_instance_id is None or lineage_instance_ids != {
                    primary_instance_id
                }:
                    cls._add_error(
                        errors,
                        "primary_instance_id",
                        "Primary-instance mode can only store lineage from the selected primary instance.",
                    )

            if approach == "separate" and len(lineage_instance_ids) > 1:
                cls._add_error(
                    errors,
                    "repository_org_unit_config",
                    "Separate mode must keep repository org units source-specific.",
                )

    @classmethod
    def _persist_database_config(cls, database: Database, config: dict[str, Any]) -> None:
        database.repository_reporting_unit_approach = config.get(
            "repository_reporting_unit_approach"
        )
        database.lowest_data_level_to_use = config.get("lowest_data_level_to_use")
        database.primary_instance_id = config.get("primary_instance_id")
        database.repository_data_scope = config.get("repository_data_scope")
        database.repository_org_unit_config_json = json.dumps(
            config.get("repository_org_unit_config") or {},
            sort_keys=True,
        )

    @classmethod
    def _clear_repository_org_units(cls, database: Database) -> None:
        db.session.query(DatabaseRepositoryOrgUnitLineage).filter(
            DatabaseRepositoryOrgUnitLineage.database_id == database.id
        ).delete(synchronize_session=False)
        db.session.query(DatabaseRepositoryOrgUnit).filter(
            DatabaseRepositoryOrgUnit.database_id == database.id
        ).delete(synchronize_session=False)

    @classmethod
    def _replace_repository_org_units(cls, database: Database, config: dict[str, Any]) -> None:
        cls._clear_repository_org_units(database)

        candidate_units = cls._normalize_list(
            (config.get("repository_org_unit_config") or {}).get("repository_org_units")
        )
        instance_code_map = cls._build_instance_code_map(database)
        for candidate in candidate_units:
            if not isinstance(candidate, dict):
                continue
            lineages = [
                lineage
                for lineage in cls._normalize_list(candidate.get("lineage"))
                if isinstance(lineage, dict)
            ]
            lineage_label = cls._build_lineage_label(lineages, instance_code_map)
            org_unit = DatabaseRepositoryOrgUnit(
                database_id=database.id,
                repository_key=str(candidate.get("repository_key") or "").strip(),
                display_name=str(candidate.get("display_name") or "").strip(),
                parent_repository_key=cls._normalize_optional_string(
                    candidate.get("parent_repository_key")
                ),
                level=cls._normalize_optional_int(candidate.get("level")),
                hierarchy_path=cls._normalize_optional_string(
                    candidate.get("hierarchy_path")
                ),
                selection_key=cls._normalize_optional_string(candidate.get("selection_key")),
                strategy=cls._normalize_optional_string(candidate.get("strategy"))
                or config.get("repository_reporting_unit_approach"),
                source_lineage_label=lineage_label,
                is_conflicted=bool(candidate.get("is_conflicted")),
                is_unmatched=bool(candidate.get("is_unmatched")),
                provenance_json=json.dumps(candidate.get("provenance") or {}, sort_keys=True),
            )
            db.session.add(org_unit)
            db.session.flush()

            for lineage in lineages:
                instance_id = cls._normalize_optional_int(lineage.get("instance_id"))
                if instance_id is None:
                    continue
                db.session.add(
                    DatabaseRepositoryOrgUnitLineage(
                        repository_org_unit_id=org_unit.id,
                        database_id=database.id,
                        instance_id=instance_id,
                        source_instance_role=cls._normalize_optional_string(
                            lineage.get("source_instance_role")
                        ),
                        source_instance_code=cls._normalize_optional_string(
                            lineage.get("source_instance_code")
                        )
                        or instance_code_map.get(instance_id),
                        source_org_unit_uid=str(
                            lineage.get("source_org_unit_uid")
                            or lineage.get("sourceOrgUnitUid")
                            or ""
                        ).strip(),
                        source_org_unit_name=cls._normalize_optional_string(
                            lineage.get("source_org_unit_name")
                        ),
                        source_parent_uid=cls._normalize_optional_string(
                            lineage.get("source_parent_uid")
                        ),
                        source_path=cls._normalize_optional_string(
                            lineage.get("source_path")
                        ),
                        source_level=cls._normalize_optional_int(
                            lineage.get("source_level")
                        ),
                        provenance_json=json.dumps(
                            lineage.get("provenance") or {},
                            sort_keys=True,
                        ),
                    )
                )

        db.session.flush()

    @classmethod
    def _set_status(
        cls,
        database: Database,
        *,
        status: str,
        message: str | None = None,
        task_id: str | None | object = ...,
    ) -> None:
        if status not in REPOSITORY_FINALIZATION_STATUSES:
            raise ValueError(f"Unsupported repository org unit status: {status}")
        database.repository_org_unit_status = status
        database.repository_org_unit_status_message = message
        if task_id is not ...:
            database.repository_org_unit_task_id = task_id
        if status == "ready":
            database.repository_org_unit_last_finalized_at = datetime.utcnow()
        elif status == "not_configured":
            database.repository_org_unit_last_finalized_at = None
            if task_id is ...:
                database.repository_org_unit_task_id = None

    @classmethod
    def _has_repository_configuration(cls, config: dict[str, Any]) -> bool:
        approach = cls._normalize_optional_string(
            config.get("repository_reporting_unit_approach")
        )
        return bool(approach)

    @classmethod
    def _has_selected_org_unit_configuration(
        cls,
        *,
        config_payload: dict[str, Any],
        separate_configs: list[Any],
    ) -> bool:
        if cls._normalize_list(config_payload.get("repository_org_units")):
            return True
        shared_selected = cls._normalize_list(config_payload.get("selected_org_units"))
        shared_details = cls._normalize_list(
            config_payload.get("selected_org_unit_details")
        )
        if shared_selected or shared_details:
            return True
        for separate_config in separate_configs:
            if not isinstance(separate_config, dict):
                continue
            if cls._normalize_list(separate_config.get("selected_org_units")):
                return True
            if cls._normalize_list(separate_config.get("selected_org_unit_details")):
                return True
        return False

    @classmethod
    def _format_validation_error(cls, messages: dict[str, Any]) -> str:
        flattened: list[str] = []
        for value in messages.values():
            if isinstance(value, list):
                flattened.extend(str(item) for item in value if item)
            elif value:
                flattened.append(str(value))
        return "; ".join(flattened) or "Repository finalization failed."

    @staticmethod
    def _build_instance_code_map(database: Database) -> dict[int, str]:
        instances = sorted(
            getattr(database, "dhis2_instances", []) or [],
            key=lambda instance: (
                getattr(instance, "display_order", 0),
                str(getattr(instance, "name", "")),
                int(getattr(instance, "id", 0)),
            ),
        )
        code_map: dict[int, str] = {}
        for index, instance in enumerate(instances):
            instance_id = getattr(instance, "id", None)
            if instance_id is None:
                continue
            if index < 26:
                code_map[int(instance_id)] = chr(ord("A") + index)
            else:
                code_map[int(instance_id)] = f"I{instance_id}"
        return code_map

    @classmethod
    def _build_lineage_label(
        cls,
        lineages: list[dict[str, Any]],
        instance_code_map: dict[int, str],
    ) -> str | None:
        labels = []
        for lineage in lineages:
            if not isinstance(lineage, dict):
                continue
            explicit_code = cls._normalize_optional_string(
                lineage.get("source_instance_code")
            )
            if explicit_code:
                labels.append(explicit_code)
                continue
            instance_id = cls._normalize_optional_int(lineage.get("instance_id"))
            if instance_id is not None and instance_id in instance_code_map:
                labels.append(instance_code_map[instance_id])
        unique_labels = sorted({label for label in labels if label})
        return ",".join(unique_labels) if unique_labels else None

    @staticmethod
    def _add_error(
        errors: dict[str, list[str]],
        field_name: str,
        message: str,
    ) -> None:
        errors.setdefault(field_name, [])
        if message not in errors[field_name]:
            errors[field_name].append(message)

    @staticmethod
    def _normalize_list(value: Any) -> list[Any]:
        return list(value) if isinstance(value, list) else []

    @staticmethod
    def _normalize_optional_string(value: Any) -> str | None:
        if value is None:
            return None
        candidate = str(value).strip()
        return candidate or None

    @staticmethod
    def _normalize_optional_int(value: Any) -> int | None:
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
