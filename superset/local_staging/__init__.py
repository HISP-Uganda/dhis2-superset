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
Local Staging Engine

Pluggable analytical storage layer for DHIS2 staged datasets.

Supported engines
-----------------
* ``superset_db`` – default; stores data in Superset's own metadata DB using
  the existing :class:`~superset.dhis2.staging_engine.DHIS2StagingEngine`.
* ``duckdb`` – embedded file-based DuckDB database; zero-dependency analytical
  performance for mid-scale datasets.
* ``clickhouse`` – external ClickHouse service; high-throughput columnar store
  for large-scale deployments.

Usage
-----
All call sites that previously instantiated :class:`DHIS2StagingEngine`
directly should use :func:`~superset.local_staging.engine_factory.get_active_staging_engine`
instead::

    from superset.local_staging.engine_factory import get_active_staging_engine

    engine = get_active_staging_engine(database_id)
    engine.replace_rows_for_instance(...)

Configuration is stored in the ``local_staging_settings`` table managed by
:class:`~superset.local_staging.platform_settings.LocalStagingSettings`.
"""

from superset.local_staging.engine_factory import get_active_staging_engine
from superset.local_staging.platform_settings import LocalStagingSettings

__all__ = [
    "LocalStagingSettings",
    "get_active_staging_engine",
]
