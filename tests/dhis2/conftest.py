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
Conftest for DHIS2 unit tests.

The installed flask_sqlalchemy 2.5.1 uses `module.__all__` iteration
which is not present in SQLAlchemy 2.x. This conftest patches the
compatibility shim before any Superset modules are imported.
"""

import sqlalchemy
import sqlalchemy.orm

if not hasattr(sqlalchemy, "__all__"):
    sqlalchemy.__all__ = []
if not hasattr(sqlalchemy.orm, "__all__"):
    sqlalchemy.orm.__all__ = []
