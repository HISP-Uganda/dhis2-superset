# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""
DHIS2 Sync REST API

Provides endpoints to trigger background syncs, inspect job history,
and check the freshness of staged datasets.

All endpoints are mounted under ``/api/v1/dhis2/sync/``.
"""

from __future__ import annotations

import logging
from typing import Any

from flask import request, Response
from flask_appbuilder import expose
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name, protect

from superset import db
from superset.dhis2.models import DHIS2StagedDataset, DHIS2SyncJob
from superset.dhis2.sync_service import DHIS2SyncService, schedule_staged_dataset_sync

logger = logging.getLogger(__name__)

_service = DHIS2SyncService()


class DHIS2SyncApi(BaseApi):
    """REST API for triggering and monitoring DHIS2 staged-dataset sync jobs.

    Resource name ``dhis2/sync`` means all routes are reachable under
    ``/api/v1/dhis2/sync/``.
    """

    resource_name = "dhis2/sync"
    allow_browser_login = True
    openapi_spec_tag = "DHIS2 Sync"

    # ------------------------------------------------------------------
    # POST /trigger/<dataset_id>
    # ------------------------------------------------------------------

    @expose("/trigger/<int:dataset_id>", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def trigger_sync(self, dataset_id: int) -> Response:
        """Trigger a manual background sync for a staged dataset.

        Dispatches a Celery task immediately and returns the sync job ID so
        the caller can poll ``/job/<job_id>`` for progress.

        ---
        post:
          summary: Trigger a manual dataset sync
          parameters:
            - in: path
              name: dataset_id
              required: true
              schema:
                type: integer
              description: PK of the DHIS2StagedDataset to sync
          responses:
            202:
              description: Sync task dispatched
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      job_id:
                        type: integer
                      task_id:
                        type: string
                      status:
                        type: string
            404:
              description: Dataset not found
            500:
              description: Internal server error
        """
        dataset = (
            db.session.query(DHIS2StagedDataset).filter_by(id=dataset_id).first()
        )
        if dataset is None:
            return self.response_404()

        schedule = schedule_staged_dataset_sync(
            dataset_id,
            job_type="manual",
            prefer_immediate=True,
        )

        logger.info(
            "dhis2_sync_api: triggered manual sync dataset=%d job=%s mode=%s",
            dataset_id,
            schedule.get("job_id"),
            schedule.get("mode"),
        )

        return self.response(
            202,
            result={
                "job_id": schedule.get("job_id"),
                "task_id": schedule.get("task_id"),
                "status": schedule.get("status", "running"),
                "mode": schedule.get("mode"),
                "dataset_id": dataset_id,
            },
        )

    # ------------------------------------------------------------------
    # GET /jobs/<dataset_id>
    # ------------------------------------------------------------------

    @expose("/jobs/<int:dataset_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def list_jobs(self, dataset_id: int) -> Response:
        """List recent sync jobs for a staged dataset.

        ---
        get:
          summary: List sync jobs for a dataset
          parameters:
            - in: path
              name: dataset_id
              required: true
              schema:
                type: integer
            - in: query
              name: limit
              schema:
                type: integer
                default: 20
              description: Maximum number of jobs to return (newest first)
          responses:
            200:
              description: List of sync jobs
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: array
                        items:
                          type: object
                      count:
                        type: integer
            404:
              description: Dataset not found
        """
        dataset = (
            db.session.query(DHIS2StagedDataset).filter_by(id=dataset_id).first()
        )
        if dataset is None:
            return self.response_404()

        limit = request.args.get("limit", 20, type=int)
        jobs = _service.get_sync_jobs(dataset_id, limit=limit)

        return self.response(
            200,
            result=[j.to_json() for j in jobs],
            count=len(jobs),
        )

    # ------------------------------------------------------------------
    # GET /job/<job_id>
    # ------------------------------------------------------------------

    @expose("/job/<int:job_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_job(self, job_id: int) -> Response:
        """Return full details for a single sync job.

        ---
        get:
          summary: Get a single sync job
          parameters:
            - in: path
              name: job_id
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Sync job details
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
            404:
              description: Job not found
        """
        job: DHIS2SyncJob | None = db.session.query(DHIS2SyncJob).get(job_id)
        if job is None:
            return self.response_404()

        return self.response(200, result=job.to_json())

    # ------------------------------------------------------------------
    # GET /status/<dataset_id>
    # ------------------------------------------------------------------

    @expose("/status/<int:dataset_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_status(self, dataset_id: int) -> Response:
        """Return the current sync status and data freshness for a dataset.

        Combines the dataset's own ``last_sync_at`` / ``last_sync_status``
        tracking columns with the most recent sync job record so the caller
        gets a unified freshness view without a separate ``/jobs`` call.

        ---
        get:
          summary: Get current sync status and freshness for a dataset
          parameters:
            - in: path
              name: dataset_id
              required: true
              schema:
                type: integer
          responses:
            200:
              description: Sync status
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        properties:
                          dataset_id:
                            type: integer
                          is_active:
                            type: boolean
                          schedule_cron:
                            type: string
                            nullable: true
                          last_sync_at:
                            type: string
                            format: date-time
                            nullable: true
                          last_sync_status:
                            type: string
                            nullable: true
                          last_sync_rows:
                            type: integer
                            nullable: true
                          latest_job:
                            type: object
                            nullable: true
            404:
              description: Dataset not found
        """
        dataset: DHIS2StagedDataset | None = (
            db.session.query(DHIS2StagedDataset).filter_by(id=dataset_id).first()
        )
        if dataset is None:
            return self.response_404()

        # Fetch the single most recent job record.
        latest_job: DHIS2SyncJob | None = (
            db.session.query(DHIS2SyncJob)
            .filter_by(staged_dataset_id=dataset_id)
            .order_by(DHIS2SyncJob.created_on.desc())
            .first()
        )

        return self.response(
            200,
            result={
                "dataset_id": dataset.id,
                "dataset_name": dataset.name,
                "is_active": dataset.is_active,
                "schedule_cron": dataset.schedule_cron,
                "last_sync_at": (
                    dataset.last_sync_at.isoformat() if dataset.last_sync_at else None
                ),
                "last_sync_status": dataset.last_sync_status,
                "last_sync_rows": dataset.last_sync_rows,
                "latest_job": latest_job.to_json() if latest_job else None,
            },
        )
