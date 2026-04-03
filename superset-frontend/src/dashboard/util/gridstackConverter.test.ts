import {
  layoutToWidgets,
  widgetsToLayout,
  getLeafComponents,
  isLeafType,
} from './gridstackConverter';

const baseLayout: Record<string, any> = {
  ROOT_ID: {
    id: 'ROOT_ID',
    type: 'ROOT',
    children: ['GRID_ID'],
  },
  GRID_ID: {
    id: 'GRID_ID',
    type: 'GRID',
    children: ['ROW_1', 'ROW_2'],
    parents: ['ROOT_ID'],
  },
  ROW_1: {
    id: 'ROW_1',
    type: 'ROW',
    children: ['CHART_A', 'CHART_B'],
    parents: ['ROOT_ID', 'GRID_ID'],
    meta: { background: 'BACKGROUND_TRANSPARENT' },
  },
  ROW_2: {
    id: 'ROW_2',
    type: 'ROW',
    children: ['CHART_C'],
    parents: ['ROOT_ID', 'GRID_ID'],
    meta: { background: 'BACKGROUND_TRANSPARENT' },
  },
  CHART_A: {
    id: 'CHART_A',
    type: 'CHART',
    children: [],
    parents: ['ROOT_ID', 'GRID_ID', 'ROW_1'],
    meta: { width: 6, height: 50, chartId: 1 },
  },
  CHART_B: {
    id: 'CHART_B',
    type: 'CHART',
    children: [],
    parents: ['ROOT_ID', 'GRID_ID', 'ROW_1'],
    meta: { width: 6, height: 50, chartId: 2 },
  },
  CHART_C: {
    id: 'CHART_C',
    type: 'CHART',
    children: [],
    parents: ['ROOT_ID', 'GRID_ID', 'ROW_2'],
    meta: { width: 12, height: 60, chartId: 3 },
  },
};

describe('gridstackConverter', () => {
  describe('layoutToWidgets', () => {
    it('converts tree layout to flat widgets with per-widget heights', () => {
      const widgets = layoutToWidgets(baseLayout);
      expect(widgets).toHaveLength(3);

      const chartA = widgets.find(w => w.id === 'CHART_A')!;
      expect(chartA.x).toBe(0);
      expect(chartA.w).toBe(6);
      // height=50 → ceil(50/6) = 9, min is 4, so 9
      expect(chartA.h).toBe(9);

      const chartB = widgets.find(w => w.id === 'CHART_B')!;
      expect(chartB.x).toBe(6);
      expect(chartB.w).toBe(6);
      // Same row, same y as chartA
      expect(chartB.y).toBe(chartA.y);
    });

    it('places second row below the tallest widget in first row', () => {
      const widgets = layoutToWidgets(baseLayout);
      const chartA = widgets.find(w => w.id === 'CHART_A')!;
      const chartC = widgets.find(w => w.id === 'CHART_C')!;
      // Row 1 max h = 9, so row 2 starts at y = 9
      expect(chartC.y).toBe(chartA.y + chartA.h);
    });

    it('preserves component types and parentRowId', () => {
      const widgets = layoutToWidgets(baseLayout);
      const chartA = widgets.find(w => w.id === 'CHART_A')!;
      expect(chartA.componentType).toBe('CHART');
      expect(chartA.parentRowId).toBe('ROW_1');

      const chartC = widgets.find(w => w.id === 'CHART_C')!;
      expect(chartC.parentRowId).toBe('ROW_2');
    });

    it('returns empty for missing grid', () => {
      expect(layoutToWidgets({}, 'NONEXISTENT')).toEqual([]);
    });

    it('enforces minimum height', () => {
      const layout = {
        ...baseLayout,
        CHART_A: {
          ...baseLayout.CHART_A,
          meta: { width: 6, height: 10, chartId: 1 }, // 10/6=1.67 → ceil=2, but min=4
        },
      };
      const widgets = layoutToWidgets(layout);
      const chartA = widgets.find(w => w.id === 'CHART_A')!;
      expect(chartA.h).toBe(4); // MIN_GS_H
    });
  });

  describe('widgetsToLayout', () => {
    it('round-trips through conversion', () => {
      const widgets = layoutToWidgets(baseLayout);
      const rebuilt = widgetsToLayout(widgets, baseLayout);

      expect(rebuilt.GRID_ID.children.length).toBeGreaterThan(0);
      expect(rebuilt.CHART_A.meta.width).toBe(6);
      expect(rebuilt.CHART_C.meta.width).toBe(12);
    });

    it('groups widgets with overlapping y-ranges into same row', () => {
      // Widget A: y=0,h=8 and Widget B: y=0,h=4 share a row
      // Widget C: y=4,h=4 starts below B but beside A
      // Because C.y(4) < bandBottom(8), C is still in the same band
      const widgets: any[] = [
        { id: 'W1', x: 0, y: 0, w: 6, h: 8, componentType: 'CHART', meta: {}, parentRowId: 'R1' },
        { id: 'W2', x: 6, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {}, parentRowId: 'R1' },
        { id: 'W3', x: 6, y: 4, w: 6, h: 4, componentType: 'CHART', meta: {}, parentRowId: 'R1' },
      ];
      const result = widgetsToLayout(widgets, baseLayout);
      // All three fit in one band (y-range 0..8)
      expect(result.GRID_ID.children.length).toBe(1);
    });

    it('splits into separate rows when y-ranges do not overlap', () => {
      const widgets: any[] = [
        { id: 'W1', x: 0, y: 0, w: 12, h: 4, componentType: 'CHART', meta: {}, parentRowId: 'R1' },
        { id: 'W2', x: 0, y: 4, w: 12, h: 4, componentType: 'CHART', meta: {}, parentRowId: 'R2' },
      ];
      const result = widgetsToLayout(widgets, baseLayout);
      expect(result.GRID_ID.children.length).toBe(2);
    });

    it('persists gsX and gsY in meta for lossless round-trip', () => {
      const widgets: any[] = [
        { id: 'W1', x: 3, y: 2, w: 6, h: 5, componentType: 'CHART', meta: { chartId: 1 }, parentRowId: 'R1' },
      ];
      const result = widgetsToLayout(widgets, baseLayout);
      expect(result.W1.meta.gsX).toBe(3);
      expect(result.W1.meta.gsY).toBe(2);
    });
  });

  describe('getLeafComponents', () => {
    it('returns all leaf component IDs', () => {
      const leaves = getLeafComponents(baseLayout);
      expect(leaves).toEqual(['CHART_A', 'CHART_B', 'CHART_C']);
    });
  });

  describe('isLeafType', () => {
    it('identifies chart as leaf', () => {
      expect(isLeafType('CHART')).toBe(true);
    });
    it('identifies header as leaf', () => {
      expect(isLeafType('HEADER')).toBe(true);
    });
    it('identifies row as non-leaf', () => {
      expect(isLeafType('ROW')).toBe(false);
    });
  });
});
