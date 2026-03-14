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
import { SupersetClient } from '@superset-ui/core';

function getStatus(error: unknown): number | undefined {
  if (error instanceof Response) {
    return error.status;
  }
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

export default async function refreshDatasetMetadata(datasetId: number) {
  const endpoints = [
    `/api/v1/dataset/${datasetId}/refresh`,
    `/api/v1/dataset/${datasetId}/refresh/`,
  ];

  let lastError: unknown;

  for (const endpoint of endpoints) {
    try {
      await SupersetClient.put({ endpoint });
      return;
    } catch (error) {
      lastError = error;
      if (getStatus(error) !== 405) {
        throw error;
      }
    }

    try {
      await SupersetClient.post({ endpoint });
      return;
    } catch (error) {
      lastError = error;
      if (getStatus(error) !== 405) {
        throw error;
      }
    }
  }

  throw lastError;
}
