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
import { keyBy } from 'lodash';
import { DatasourcesState } from 'src/dashboard/types';
import {
  DatasourcesActionPayload,
  DatasourcesAction,
} from '../actions/datasources';
import { HYDRATE_DASHBOARD } from '../actions/hydrate';

export default function datasourcesReducer(
  datasources: DatasourcesState | undefined,
  action: DatasourcesActionPayload | { type: string; data?: any },
) {
  if (action.type === HYDRATE_DASHBOARD && action.data?.datasources) {
    return {
      ...datasources,
      ...action.data.datasources,
    };
  }
  if (action.type === DatasourcesAction.SetDatasources) {
    return {
      ...datasources,
      ...keyBy((action as any).datasources, 'uid'),
    };
  }
  if (action.type === DatasourcesAction.SetDatasource) {
    return {
      ...datasources,
      [(action as any).key]: (action as any).datasource,
    };
  }
  return datasources || {};
}
