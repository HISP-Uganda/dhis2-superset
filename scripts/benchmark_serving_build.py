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
import time
import logging
import sys
import os

# Add the project root to sys.path
sys.path.append(os.getcwd())

from superset import db, create_app
app = create_app()
app.app_context().push()

from superset.dhis2.models import DHIS2StagedDataset
from superset.dhis2.serving_build_service import build_serving_table

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("benchmark")

def benchmark(dataset_id: int):
    dataset = db.session.query(DHIS2StagedDataset).get(dataset_id)
    if not dataset:
        logger.error(f"Dataset {dataset_id} not found")
        return

    logger.info(f"Starting benchmark for dataset {dataset_id} ({dataset.name})")
    
    start_time = time.time()
    try:
        result = build_serving_table(dataset)
        duration = time.time() - start_time

        print(f"\n--- Benchmark Results for Dataset {dataset_id} ---")
        print(f"Build Duration: {duration:.2f} seconds")
        print(f"Source Rows:    {result.diagnostics.get('source_row_count')}")
        print(f"Serving Rows:   {result.diagnostics.get('live_serving_row_count')}")
        print(f"Build Mode:     {result.diagnostics.get('mode', 'legacy_python')}")
        print(f"Serving Table:  {result.serving_table_ref}")
        print("-------------------------------------------\n")
    except Exception as e:
        logger.exception(f"Build failed: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        benchmark(int(sys.argv[1]))
    else:
        print("Usage: python scripts/benchmark_serving_build.py <dataset_id>")
