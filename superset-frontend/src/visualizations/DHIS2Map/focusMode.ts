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

import { BoundaryFeature } from './types';

export type FocusedBoundaryRequest = {
  childLevel?: number;
  parentIds: string[];
  selectedParents: BoundaryFeature[];
};

/**
 * Focus mode only advances one level down from the selected thematic boundary.
 * The helper stays conservative: if there is no selected parent with data, or
 * the thematic level is already the deepest known level, it returns no focused
 * request and the caller should fall back to the normal boundary load.
 */
export function resolveFocusedBoundaryRequest(options: {
  enabled: boolean;
  currentLevel: number;
  maxAvailableLevel?: number;
  parentFeatures: BoundaryFeature[];
  getFeatureValue: (feature: BoundaryFeature) => number | undefined;
}): FocusedBoundaryRequest {
  const {
    enabled,
    currentLevel,
    maxAvailableLevel,
    parentFeatures,
    getFeatureValue,
  } = options;

  if (!enabled || !Number.isFinite(currentLevel) || currentLevel <= 0) {
    return {
      parentIds: [],
      selectedParents: [],
    };
  }

  if (
    Number.isFinite(maxAvailableLevel) &&
    Number(maxAvailableLevel) > 0 &&
    currentLevel >= Number(maxAvailableLevel)
  ) {
    return {
      parentIds: [],
      selectedParents: [],
    };
  }

  const selectedParents = parentFeatures.filter(
    feature => getFeatureValue(feature) !== undefined,
  );
  const parentIds = selectedParents
    .map(feature => String(feature.id || '').trim())
    .filter(Boolean);

  if (parentIds.length === 0) {
    return {
      parentIds: [],
      selectedParents: [],
    };
  }

  // Only focus when the user is effectively narrowing the level to a subset.
  // If every parent boundary is selected, keep the normal level rendering to
  // avoid repeating parent totals across all child geometries.
  if (parentIds.length >= parentFeatures.length) {
    return {
      parentIds: [],
      selectedParents: [],
    };
  }

  return {
    childLevel: currentLevel + 1,
    parentIds,
    selectedParents,
  };
}
