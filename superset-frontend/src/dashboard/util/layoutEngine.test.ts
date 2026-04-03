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
import {
  getItemWidth,
  computeRowOccupancy,
  computeRowCapacity,
  rowOverflows,
  reflowContainer,
  reflowLayout,
  shrinkRowToFit,
  insertWithDisplacement,
  findOverflowingRows,
  validateAndFixLayout,
} from './layoutEngine';

/* ── Helper to build test layouts ──────────────────────── */

function makeItem(id: string, width: number, type = 'CHART') {
  return {
    id,
    type,
    children: [],
    meta: { width },
  };
}

function makeRow(id: string, childIds: string[]) {
  return {
    id,
    type: 'ROW',
    children: childIds,
    parents: ['GRID_ID'],
    meta: { background: 'BACKGROUND_TRANSPARENT' },
  };
}

function makeGrid(id: string, rowIds: string[]) {
  return {
    id,
    type: 'GRID',
    children: rowIds,
    parents: ['ROOT_ID'],
  };
}

/* ── Tests ─────────────────────────────────────────────── */

describe('layoutEngine', () => {
  describe('getItemWidth', () => {
    it('returns item meta.width', () => {
      const layout = { A: makeItem('A', 4) } as any;
      expect(getItemWidth(layout, 'A')).toBe(4);
    });

    it('returns 0 for items with width 0 (e.g. ROW)', () => {
      const layout = { A: { ...makeItem('A', 0), meta: { width: 0 } } } as any;
      expect(getItemWidth(layout, 'A')).toBe(0);
    });

    it('clamps to max 12', () => {
      const layout = { A: makeItem('A', 15) } as any;
      expect(getItemWidth(layout, 'A')).toBe(12);
    });

    it('returns 0 for item without width', () => {
      const layout = { A: { id: 'A', type: 'ROW', children: [], meta: {} } } as any;
      expect(getItemWidth(layout, 'A')).toBe(0);
    });
  });

  describe('computeRowOccupancy', () => {
    it('sums child widths', () => {
      const layout = {
        R1: makeRow('R1', ['A', 'B']),
        A: makeItem('A', 4),
        B: makeItem('B', 6),
      } as any;
      expect(computeRowOccupancy(layout, 'R1')).toBe(10);
    });

    it('returns 0 for empty row', () => {
      const layout = { R1: makeRow('R1', []) } as any;
      expect(computeRowOccupancy(layout, 'R1')).toBe(0);
    });
  });

  describe('computeRowCapacity', () => {
    it('returns remaining columns', () => {
      const layout = {
        R1: makeRow('R1', ['A']),
        A: makeItem('A', 4),
      } as any;
      expect(computeRowCapacity(layout, 'R1')).toBe(8);
    });
  });

  describe('rowOverflows', () => {
    it('returns false when within capacity', () => {
      const layout = {
        R1: makeRow('R1', ['A', 'B']),
        A: makeItem('A', 6),
        B: makeItem('B', 6),
      } as any;
      expect(rowOverflows(layout, 'R1')).toBe(false);
    });

    it('returns true when over capacity', () => {
      const layout = {
        R1: makeRow('R1', ['A', 'B', 'C']),
        A: makeItem('A', 6),
        B: makeItem('B', 4),
        C: makeItem('C', 4),
      } as any;
      expect(rowOverflows(layout, 'R1')).toBe(true);
    });
  });

  describe('reflowContainer', () => {
    it('does nothing when all rows fit', () => {
      const layout = {
        GRID_ID: makeGrid('GRID_ID', ['R1']),
        R1: makeRow('R1', ['A', 'B']),
        A: makeItem('A', 6),
        B: makeItem('B', 6),
      } as any;
      const result = reflowContainer(layout, 'GRID_ID');
      expect(result.R1.children).toEqual(['A', 'B']);
    });

    it('pushes overflow items to next row', () => {
      const layout = {
        GRID_ID: makeGrid('GRID_ID', ['R1', 'R2']),
        R1: makeRow('R1', ['A', 'B', 'C']),
        R2: makeRow('R2', ['D']),
        A: makeItem('A', 6),
        B: makeItem('B', 4),
        C: makeItem('C', 4),
        D: makeItem('D', 3),
      } as any;
      const result = reflowContainer(layout, 'GRID_ID');
      expect(result.R1.children).toEqual(['A', 'B']);
      expect(result.R2.children).toEqual(['C', 'D']);
    });

    it('creates new row when overflow has nowhere to go', () => {
      const layout = {
        GRID_ID: makeGrid('GRID_ID', ['R1']),
        R1: makeRow('R1', ['A', 'B', 'C']),
        A: makeItem('A', 6),
        B: makeItem('B', 4),
        C: makeItem('C', 4),
      } as any;
      const result = reflowContainer(layout, 'GRID_ID');
      expect(result.R1.children).toEqual(['A', 'B']);
      // A new row should be created with C
      const newRowIds = result.GRID_ID.children.filter(
        (id: string) => id !== 'R1',
      );
      expect(newRowIds).toHaveLength(1);
      const newRow = result[newRowIds[0]];
      expect(newRow.type).toBe('ROW');
      expect(newRow.children).toEqual(['C']);
    });

    it('cascades reflow through multiple rows', () => {
      const layout = {
        GRID_ID: makeGrid('GRID_ID', ['R1', 'R2']),
        R1: makeRow('R1', ['A', 'B', 'C']),
        R2: makeRow('R2', ['D', 'E']),
        A: makeItem('A', 6),
        B: makeItem('B', 4),
        C: makeItem('C', 4),
        D: makeItem('D', 6),
        E: makeItem('E', 6),
      } as any;
      const result = reflowContainer(layout, 'GRID_ID');
      // R1: A(6) + B(4) = 10, C overflows
      expect(result.R1.children).toEqual(['A', 'B']);
      // R2: C(4) + D(6) + E(6) = 16, E overflows
      expect(result.R2.children).toEqual(['C', 'D']);
      // New row created for E
      const allRowIds = result.GRID_ID.children;
      expect(allRowIds.length).toBe(3);
    });

    it('keeps at least one item per row even if it exceeds 12', () => {
      const layout = {
        GRID_ID: makeGrid('GRID_ID', ['R1']),
        R1: makeRow('R1', ['A']),
        A: makeItem('A', 12),
      } as any;
      const result = reflowContainer(layout, 'GRID_ID');
      expect(result.R1.children).toEqual(['A']);
    });

    it('removes empty rows', () => {
      const layout = {
        GRID_ID: makeGrid('GRID_ID', ['R1', 'R2']),
        R1: makeRow('R1', ['A', 'B']),
        R2: makeRow('R2', []),
        A: makeItem('A', 6),
        B: makeItem('B', 6),
      } as any;
      const result = reflowContainer(layout, 'GRID_ID');
      expect(result.GRID_ID.children).toEqual(['R1']);
      expect(result.R2).toBeUndefined();
    });

    it('skips non-ROW children (HEADER, DIVIDER)', () => {
      const layout = {
        GRID_ID: makeGrid('GRID_ID', ['H1', 'R1']),
        H1: { id: 'H1', type: 'HEADER', children: [], meta: {} },
        R1: makeRow('R1', ['A']),
        A: makeItem('A', 4),
      } as any;
      const result = reflowContainer(layout, 'GRID_ID');
      expect(result.GRID_ID.children).toContain('H1');
      expect(result.GRID_ID.children).toContain('R1');
    });

    it('is deterministic (same input → same output)', () => {
      const layout = {
        GRID_ID: makeGrid('GRID_ID', ['R1']),
        R1: makeRow('R1', ['A', 'B', 'C']),
        A: makeItem('A', 6),
        B: makeItem('B', 4),
        C: makeItem('C', 4),
      } as any;
      const result1 = reflowContainer(layout, 'GRID_ID');
      const result2 = reflowContainer(layout, 'GRID_ID');
      expect(result1.R1.children).toEqual(result2.R1.children);
      expect(result1.GRID_ID.children.length).toBe(
        result2.GRID_ID.children.length,
      );
    });
  });

  describe('shrinkRowToFit', () => {
    it('returns layout unchanged when item already fits', () => {
      const layout = {
        R1: makeRow('R1', ['A']),
        A: makeItem('A', 4),
      } as any;
      const result = shrinkRowToFit(layout, 'R1', 4);
      expect(result).toBe(layout); // same reference = no change
    });

    it('shrinks rightmost items first', () => {
      const layout = {
        R1: makeRow('R1', ['A', 'B']),
        A: makeItem('A', 6),
        B: makeItem('B', 6),
      } as any;
      const result = shrinkRowToFit(layout, 'R1', 4);
      expect(result).not.toBeNull();
      expect(result!.A.meta.width).toBe(6); // unchanged
      expect(result!.B.meta.width).toBe(2); // shrunk by 4
    });

    it('returns null when shrinking is impossible', () => {
      const layout = {
        R1: makeRow('R1', ['A', 'B']),
        A: makeItem('A', 1),
        B: makeItem('B', 1),
      } as any;
      const result = shrinkRowToFit(layout, 'R1', 12);
      expect(result).toBeNull();
    });
  });

  describe('insertWithDisplacement', () => {
    it('inserts item at specified index', () => {
      const layout = {
        R1: makeRow('R1', ['A']),
        A: makeItem('A', 4),
        B: makeItem('B', 4),
      } as any;
      const result = insertWithDisplacement(layout, 'R1', 'B', 1);
      expect(result.R1.children).toEqual(['A', 'B']);
    });

    it('shrinks siblings when needed to fit', () => {
      const layout = {
        R1: makeRow('R1', ['A', 'B']),
        A: makeItem('A', 6),
        B: makeItem('B', 6),
        C: makeItem('C', 4),
      } as any;
      const result = insertWithDisplacement(layout, 'R1', 'C', 2);
      expect(result.R1.children).toEqual(['A', 'B', 'C']);
      // Siblings should have been shrunk
      const totalWidth =
        result.A.meta.width + result.B.meta.width + result.C.meta.width;
      expect(totalWidth).toBeLessThanOrEqual(12);
    });
  });

  describe('findOverflowingRows', () => {
    it('returns IDs of overflowing rows', () => {
      const layout = {
        R1: makeRow('R1', ['A', 'B']),
        R2: makeRow('R2', ['C', 'D', 'E']),
        A: makeItem('A', 6),
        B: makeItem('B', 6),
        C: makeItem('C', 6),
        D: makeItem('D', 4),
        E: makeItem('E', 4),
      } as any;
      const result = findOverflowingRows(layout);
      expect(result).toEqual(['R2']);
    });

    it('returns empty array when nothing overflows', () => {
      const layout = {
        R1: makeRow('R1', ['A']),
        A: makeItem('A', 6),
      } as any;
      expect(findOverflowingRows(layout)).toEqual([]);
    });
  });

  describe('validateAndFixLayout', () => {
    it('fixes all overflows', () => {
      const layout = {
        ROOT_ID: { id: 'ROOT_ID', type: 'ROOT', children: ['GRID_ID'] },
        GRID_ID: makeGrid('GRID_ID', ['R1']),
        R1: makeRow('R1', ['A', 'B', 'C']),
        A: makeItem('A', 6),
        B: makeItem('B', 4),
        C: makeItem('C', 4),
      } as any;
      const result = validateAndFixLayout(layout);
      expect(findOverflowingRows(result)).toEqual([]);
    });
  });

  describe('reflowLayout', () => {
    it('reflows multiple containers', () => {
      const layout = {
        ROOT_ID: { id: 'ROOT_ID', type: 'ROOT', children: ['TABS_1'] },
        TABS_1: { id: 'TABS_1', type: 'TABS', children: ['TAB_1', 'TAB_2'] },
        TAB_1: {
          id: 'TAB_1',
          type: 'TAB',
          children: ['R1'],
          parents: ['TABS_1'],
        },
        TAB_2: {
          id: 'TAB_2',
          type: 'TAB',
          children: ['R2'],
          parents: ['TABS_1'],
        },
        R1: makeRow('R1', ['A', 'B', 'C']),
        R2: makeRow('R2', ['D', 'E']),
        A: makeItem('A', 6),
        B: makeItem('B', 4),
        C: makeItem('C', 4),
        D: makeItem('D', 6),
        E: makeItem('E', 6),
      } as any;
      const result = reflowLayout(layout);
      // TAB_1's R1 should be reflowed
      expect(result.R1.children).toEqual(['A', 'B']);
      // TAB_2's R2 should be fine
      expect(result.R2.children).toEqual(['D', 'E']);
    });
  });
});
