/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
type BuildStagedDhIS2DatasetPayloadArgs = {
  datasetName: string;
  stagingTableRef: string;
  servingTableRef?: string | null;
  sourceDatabaseId: number;
  sourceDatabaseName?: string | null;
  servingDatabaseId?: number | null;
  servingDatabaseName?: string | null;
  stagedDatasetId?: number | null;
  selectedInstanceIds?: number[];
  selectedInstanceNames?: string[];
};

export default function buildStagedDhIS2DatasetPayload({
  datasetName,
  stagingTableRef,
  servingTableRef = null,
  sourceDatabaseId,
  sourceDatabaseName = null,
  servingDatabaseId = null,
  servingDatabaseName = null,
  stagedDatasetId = null,
  selectedInstanceIds = [],
  selectedInstanceNames = [],
}: BuildStagedDhIS2DatasetPayloadArgs) {
  const resolvedServingDatabaseId = servingDatabaseId || sourceDatabaseId;
  const resolvedServingTableRef = servingTableRef || stagingTableRef;
  const initialQueryTableRef = stagingTableRef || resolvedServingTableRef;

  return {
    database: resolvedServingDatabaseId,
    catalog: null,
    schema: null,
    table_name: datasetName.trim(),
    // Create the Superset dataset against the already-existing staging table.
    // The serving table is materialized asynchronously and later adopted via
    // the staged-local repair path using the metadata persisted in `extra`.
    sql: `SELECT * FROM ${initialQueryTableRef}`,
    is_sqllab_view: true,
    extra: JSON.stringify({
      dhis2_staged_local: true,
      dhis2_staged_dataset_id: stagedDatasetId,
      dhis2_source_database_id: sourceDatabaseId,
      dhis2_source_database_name: sourceDatabaseName,
      dhis2_source_instance_ids: selectedInstanceIds,
      dhis2_source_instance_names: selectedInstanceNames,
      dhis2_serving_database_id: resolvedServingDatabaseId,
      dhis2_serving_database_name: servingDatabaseName,
      dhis2_serving_table_ref: resolvedServingTableRef,
    }),
  };
}
