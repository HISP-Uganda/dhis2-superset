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
"""disable_sqllab_for_dhis2

Revision ID: 87fd02a1b791
Revises: 2026_03_26_backfill_dhis2_dataset_roles
Create Date: 2026-03-27 00:06:07.199492

"""

# revision identifiers, used by Alembic.
revision = '87fd02a1b791'
down_revision = '2026_03_26_backfill_dhis2_dataset_roles'

from alembic import op
import sqlalchemy as sa


def upgrade():
    # Hide DHIS2 database connections from SQL Lab so users are directed to use
    # the DHIS2 Serving (ClickHouse) database which contains the high-performance MART tables.
    op.execute(
        "UPDATE dbs SET expose_in_sqllab = 0 WHERE sqlalchemy_uri LIKE 'dhis2%'"
    )


def downgrade():
    op.execute(
        "UPDATE dbs SET expose_in_sqllab = 1 WHERE sqlalchemy_uri LIKE 'dhis2%'"
    )
