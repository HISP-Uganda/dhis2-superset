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
import buildStagedDhIS2DatasetPayload from './buildStagedDhIS2DatasetPayload';

test('uses the local serving database when the staged dataset returns one', () => {
  const payload = buildStagedDhIS2DatasetPayload({
    datasetName: 'ANC Coverage',
    stagingTableRef: 'dhis2_staging.ds_1_anc_coverage',
    sourceDatabaseId: 9,
    sourceDatabaseName: 'HMIS Repository',
    servingDatabaseId: 13,
    servingDatabaseName: 'main',
    stagedDatasetId: 41,
    selectedInstanceIds: [101, 102],
    selectedInstanceNames: ['HMIS-Test', 'Non Routine'],
  });

  expect(payload.database).toBe(13);
  expect(payload.is_sqllab_view).toBe(true);
  expect(payload.sql).toBe('SELECT * FROM dhis2_staging.ds_1_anc_coverage');
  expect(JSON.parse(payload.extra)).toMatchObject({
    dhis2_staged_local: true,
    dhis2_staged_dataset_id: 41,
    dhis2_source_database_id: 9,
    dhis2_serving_database_id: 13,
    dhis2_source_instance_names: ['HMIS-Test', 'Non Routine'],
  });
});

test('falls back to the source database when no local serving database is returned', () => {
  const payload = buildStagedDhIS2DatasetPayload({
    datasetName: 'ANC Coverage',
    stagingTableRef: 'dhis2_staging.ds_1_anc_coverage',
    sourceDatabaseId: 9,
  });

  expect(payload.database).toBe(9);
  expect(payload.is_sqllab_view).toBe(true);
  expect(JSON.parse(payload.extra)).toMatchObject({
    dhis2_source_database_id: 9,
    dhis2_serving_database_id: 9,
  });
});
