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

import { resolveFocusedBoundaryRequest } from './focusMode';
import { BoundaryFeature } from './types';

const buildFeature = (
  id: string,
  name: string,
  level: number,
): BoundaryFeature => ({
  type: 'Feature',
  id,
  properties: {
    id,
    name,
    level,
    parentId: '',
    parentName: '',
    hasChildrenWithCoordinates: true,
    hasParentWithCoordinates: true,
  },
  geometry: {
    type: 'Polygon',
    coordinates: [],
  },
});

describe('resolveFocusedBoundaryRequest', () => {
  it('returns selected parents and one-level-down child level', () => {
    const features = [
      buildFeature('a1', 'Acholi', 2),
      buildFeature('w1', 'West Nile', 2),
    ];

    const result = resolveFocusedBoundaryRequest({
      enabled: true,
      currentLevel: 2,
      maxAvailableLevel: 4,
      parentFeatures: features,
      getFeatureValue: feature => (feature.id === 'a1' ? 100 : undefined),
    });

    expect(result.childLevel).toBe(3);
    expect(result.parentIds).toEqual(['a1']);
    expect(result.selectedParents.map(feature => feature.id)).toEqual(['a1']);
  });

  it('falls back when there are no selected parents', () => {
    const result = resolveFocusedBoundaryRequest({
      enabled: true,
      currentLevel: 2,
      maxAvailableLevel: 4,
      parentFeatures: [buildFeature('a1', 'Acholi', 2)],
      getFeatureValue: () => undefined,
    });

    expect(result.childLevel).toBeUndefined();
    expect(result.parentIds).toEqual([]);
  });

  it('does not focus when the whole level is selected', () => {
    const features = [
      buildFeature('a1', 'Acholi', 2),
      buildFeature('w1', 'West Nile', 2),
    ];

    const result = resolveFocusedBoundaryRequest({
      enabled: true,
      currentLevel: 2,
      maxAvailableLevel: 4,
      parentFeatures: features,
      getFeatureValue: () => 100,
    });

    expect(result.childLevel).toBeUndefined();
    expect(result.parentIds).toEqual([]);
    expect(result.selectedParents).toEqual([]);
  });

  it('does not advance past the deepest known level', () => {
    const result = resolveFocusedBoundaryRequest({
      enabled: true,
      currentLevel: 4,
      maxAvailableLevel: 4,
      parentFeatures: [buildFeature('d1', 'District', 4)],
      getFeatureValue: () => 50,
    });

    expect(result.childLevel).toBeUndefined();
    expect(result.parentIds).toEqual([]);
  });
});
