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
import { JsonValue, QueryFormData } from '@superset-ui/core';
import { ControlStateMapping } from '@superset-ui/chart-controls';
import { omit } from 'lodash';
import { RESERVED_CHART_URL_PARAMS } from 'src/constants';

export function sanitizeFormDataUrlParams(
  formData: QueryFormData = {},
): QueryFormData {
  if (!formData.url_params) {
    return formData;
  }

  const sanitizedUrlParams = Object.fromEntries(
    Object.entries(formData.url_params || {}).filter(
      ([key]) => !RESERVED_CHART_URL_PARAMS.includes(key),
    ),
  );

  if (!Object.keys(sanitizedUrlParams).length) {
    const { url_params, ...sanitizedFormData } = formData;
    return sanitizedFormData as QueryFormData;
  }

  return {
    ...formData,
    url_params: sanitizedUrlParams,
  };
}

export function getFormDataFromControls(
  controlsState: ControlStateMapping,
): QueryFormData {
  const formData: Record<string, JsonValue | undefined> = {};
  Object.keys(controlsState).forEach(controlName => {
    const control = controlsState[controlName];
    formData[controlName] = control.value;
  });
  return sanitizeFormDataUrlParams(formData as QueryFormData);
}

export function getMergedFormDataWithControls(
  controlsState: ControlStateMapping,
  baseFormData: QueryFormData = {},
  keysToOmit: string[] = [],
): QueryFormData {
  return sanitizeFormDataUrlParams(
    omit(
      {
        ...baseFormData,
        ...getFormDataFromControls(controlsState),
      },
      keysToOmit,
    ) as QueryFormData,
  );
}
