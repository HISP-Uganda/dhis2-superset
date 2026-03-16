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
"""Merge DHIS2 job control branch with Superset main migration head.

Revision ID: 2026_03_16_merge_heads
Revises: merge_migration_heads, dhis2_job_control_v1
Create Date: 2026-03-16

"""

from alembic import op

revision = "2026_03_16_merge_heads"
down_revision = ("merge_migration_heads", "dhis2_job_control_v1")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
