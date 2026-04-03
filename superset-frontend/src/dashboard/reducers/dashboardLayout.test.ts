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
import layoutReducer from './dashboardLayout';
import {
  UPDATE_COMPONENTS,
  MOVE_COMPONENT,
  REFLOW_LAYOUT,
} from '../actions/dashboardLayout';

describe('dashboardLayout reducer', () => {
  const baseLayout: Record<string, any> = {
    ROOT_ID: {
      id: 'ROOT_ID',
      type: 'ROOT',
      children: ['GRID_ID'],
    },
    GRID_ID: {
      id: 'GRID_ID',
      type: 'GRID',
      children: ['ROW_1'],
      parents: ['ROOT_ID'],
    },
    ROW_1: {
      id: 'ROW_1',
      type: 'ROW',
      children: ['COL_A', 'COL_B'],
      parents: ['ROOT_ID', 'GRID_ID'],
      meta: { background: 'BACKGROUND_TRANSPARENT' },
    },
    COL_A: {
      id: 'COL_A',
      type: 'CHART',
      children: [],
      parents: ['ROOT_ID', 'GRID_ID', 'ROW_1'],
      meta: { width: 6, height: 50 },
    },
    COL_B: {
      id: 'COL_B',
      type: 'CHART',
      children: [],
      parents: ['ROOT_ID', 'GRID_ID', 'ROW_1'],
      meta: { width: 6, height: 50 },
    },
  };

  describe('REFLOW_LAYOUT', () => {
    it('should not change a layout that fits', () => {
      const result = layoutReducer(baseLayout, { type: REFLOW_LAYOUT });
      expect(result.ROW_1.children).toEqual(['COL_A', 'COL_B']);
    });

    it('should push overflow items to a new row', () => {
      const overflowLayout = {
        ...baseLayout,
        ROW_1: {
          ...baseLayout.ROW_1,
          children: ['COL_A', 'COL_B', 'COL_C'],
        },
        COL_C: {
          id: 'COL_C',
          type: 'CHART',
          children: [],
          parents: ['ROOT_ID', 'GRID_ID', 'ROW_1'],
          meta: { width: 4, height: 50 },
        },
      };

      const result = layoutReducer(overflowLayout, { type: REFLOW_LAYOUT });
      // ROW_1 should keep COL_A(6) + COL_B(6) = 12
      expect(result.ROW_1.children).toEqual(['COL_A', 'COL_B']);
      // COL_C should be in a new row
      const newRowIds = result.GRID_ID.children.filter(
        (id: string) => id !== 'ROW_1',
      );
      expect(newRowIds.length).toBe(1);
      const newRow = result[newRowIds[0]];
      expect(newRow.children).toContain('COL_C');
    });
  });

  describe('MOVE_COMPONENT with reflow', () => {
    it('should reflow after moving a component that causes overflow', () => {
      // Layout with two rows: ROW_1 (6+6=12), ROW_2 (4)
      const layout = {
        ...baseLayout,
        GRID_ID: {
          ...baseLayout.GRID_ID,
          children: ['ROW_1', 'ROW_2'],
        },
        ROW_2: {
          id: 'ROW_2',
          type: 'ROW',
          children: ['COL_C'],
          parents: ['ROOT_ID', 'GRID_ID'],
          meta: { background: 'BACKGROUND_TRANSPARENT' },
        },
        COL_C: {
          id: 'COL_C',
          type: 'CHART',
          children: [],
          parents: ['ROOT_ID', 'GRID_ID', 'ROW_2'],
          meta: { width: 4, height: 50 },
        },
      };

      // Move COL_C from ROW_2 to ROW_1 at index 2
      const dropResult = {
        source: { id: 'ROW_2', type: 'ROW', index: 0 },
        destination: { id: 'ROW_1', type: 'ROW', index: 2 },
        dragging: { id: 'COL_C', type: 'CHART', meta: { width: 4 } },
      };

      const result = layoutReducer(layout, {
        type: MOVE_COMPONENT,
        payload: { dropResult },
      });

      // ROW_1 would be 6+6+4=16 which overflows
      // After reflow, it should split
      const row1Occupancy = result.ROW_1.children.reduce(
        (sum: number, id: string) => sum + (result[id]?.meta?.width || 0),
        0,
      );
      expect(row1Occupancy).toBeLessThanOrEqual(12);
    });
  });

  describe('UPDATE_COMPONENTS', () => {
    it('should merge component updates', () => {
      const result = layoutReducer(baseLayout, {
        type: UPDATE_COMPONENTS,
        payload: {
          nextComponents: {
            COL_A: {
              ...baseLayout.COL_A,
              meta: { ...baseLayout.COL_A.meta, width: 4 },
            },
          },
        },
      });
      expect(result.COL_A.meta.width).toBe(4);
      // Other components unchanged
      expect(result.COL_B).toEqual(baseLayout.COL_B);
    });
  });
});
