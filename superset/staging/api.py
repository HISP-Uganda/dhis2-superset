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
"""REST API for generic staged-source registry and capability lookup."""

from __future__ import annotations

from flask import Response, request
from flask_appbuilder.api import BaseApi, safe
from flask_appbuilder.security.decorators import permission_name, protect
from flask_appbuilder import expose

from superset.staging import source_service


class StagedSourceApi(BaseApi):
    """Expose generic staged-source registration and capability metadata."""

    resource_name = "staging/sources"
    csrf_exempt = False
    allow_browser_login = True
    openapi_spec_tag = "Staged Sources"

    @expose("/", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def list_sources(self) -> Response:
        database_id = request.args.get("database_id", type=int)
        ensure = request.args.get("ensure", "false").lower() in ("1", "true", "yes")
        include_inactive = request.args.get("include_inactive", "false").lower() in (
            "1",
            "true",
            "yes",
        )

        if database_id is not None:
            if ensure:
                source, capabilities = source_service.ensure_source_for_database(database_id)
            else:
                source = source_service.get_source_for_database(database_id)
                capabilities = source_service.get_database_staging_capabilities(database_id)
            return self.response(
                200,
                result={
                    "source": source.to_json() if source is not None else None,
                    "capabilities": capabilities,
                },
            )

        sources = source_service.list_sources(include_inactive=include_inactive)
        return self.response(
            200,
            result=[source.to_json() for source in sources],
            count=len(sources),
        )

    @expose("/capabilities/<int:database_id>", methods=["GET"])
    @protect()
    @safe
    @permission_name("read")
    def get_capabilities(self, database_id: int) -> Response:
        capabilities = source_service.get_database_staging_capabilities(database_id)
        return self.response(200, result=capabilities)

    @expose("/ensure/<int:database_id>", methods=["POST"])
    @protect()
    @safe
    @permission_name("write")
    def ensure_source(self, database_id: int) -> Response:
        source, capabilities = source_service.ensure_source_for_database(database_id)
        return self.response(
            200,
            result={
                "source": source.to_json(),
                "capabilities": capabilities,
            },
        )
