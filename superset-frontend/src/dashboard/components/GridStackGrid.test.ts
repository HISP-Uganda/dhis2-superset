/**
 * Tests for GridStackGrid pure functions: calcDropPosition and stableIdKey.
 *
 * The main GridStackGrid component depends heavily on GridStack.js DOM APIs
 * and React portals, so we test its pure logic separately.
 */
import { calcDropPosition, stableIdKey } from './GridStackGrid';
import type { DashboardWidget } from '../util/gridstackConverter';

/* ------------------------------------------------------------------ */
/*  stableIdKey                                                        */
/* ------------------------------------------------------------------ */
describe('stableIdKey', () => {
  it('returns sorted, comma-separated IDs', () => {
    const widgets: DashboardWidget[] = [
      { id: 'C', x: 0, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
      { id: 'A', x: 6, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
      { id: 'B', x: 0, y: 4, w: 12, h: 4, componentType: 'CHART', meta: {} },
    ];
    expect(stableIdKey(widgets)).toBe('A,B,C');
  });

  it('deduplicates IDs', () => {
    const widgets: DashboardWidget[] = [
      { id: 'A', x: 0, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
      { id: 'A', x: 6, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
    ];
    expect(stableIdKey(widgets)).toBe('A');
  });

  it('returns empty string for empty array', () => {
    expect(stableIdKey([])).toBe('');
  });

  it('is order-independent (same IDs, different order → same key)', () => {
    const w1: DashboardWidget[] = [
      { id: 'X', x: 0, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
      { id: 'Y', x: 6, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
    ];
    const w2: DashboardWidget[] = [
      { id: 'Y', x: 6, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
      { id: 'X', x: 0, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
    ];
    expect(stableIdKey(w1)).toBe(stableIdKey(w2));
  });
});

/* ------------------------------------------------------------------ */
/*  calcDropPosition                                                   */
/* ------------------------------------------------------------------ */
describe('calcDropPosition', () => {
  it('returns last index with null indicator when containerEl is null', () => {
    const widgets: DashboardWidget[] = [
      { id: 'A', x: 0, y: 0, w: 12, h: 4, componentType: 'CHART', meta: {} },
    ];
    const result = calcDropPosition(null, null, { x: 100, y: 100 }, widgets);
    expect(result.index).toBe(1);
    expect(result.indicator).toBeNull();
  });

  it('returns last index with null indicator when clientOffset is null', () => {
    const container = document.createElement('div');
    const widgets: DashboardWidget[] = [
      { id: 'A', x: 0, y: 0, w: 12, h: 4, componentType: 'CHART', meta: {} },
    ];
    const result = calcDropPosition(container, null, null, widgets);
    expect(result.index).toBe(1);
    expect(result.indicator).toBeNull();
  });

  it('returns index 0 with horizontal indicator for empty grid', () => {
    const container = document.createElement('div');
    // Mock getBoundingClientRect
    container.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    const result = calcDropPosition(
      container,
      null,
      { x: 400, y: 300 },
      [],
    );
    expect(result.index).toBe(0);
    expect(result.indicator).not.toBeNull();
    expect(result.indicator!.orientation).toBe('horizontal');
    expect(result.indicator!.top).toBe(0);
    expect(result.indicator!.width).toBe(800);
  });

  it('returns last index for populated grid with no gsInstance items', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({
      top: 0, left: 0, bottom: 600, right: 800,
      width: 800, height: 600, x: 0, y: 0, toJSON: () => {},
    });
    const widgets: DashboardWidget[] = [
      { id: 'A', x: 0, y: 0, w: 12, h: 4, componentType: 'CHART', meta: {} },
    ];
    // null gsInstance → getGridItems returns []
    const result = calcDropPosition(
      container,
      null,
      { x: 400, y: 300 },
      widgets,
    );
    // No items from gsInstance, closest is null → falls through to empty result
    expect(result.index).toBe(1);
    expect(result.indicator).toBeNull();
  });

  it('calculates position relative to grid items', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({
      top: 100, left: 50, bottom: 700, right: 850,
      width: 800, height: 600, x: 50, y: 100, toJSON: () => {},
    });
    Object.defineProperty(container, 'scrollTop', { value: 0 });

    // Create a mock grid item
    const gridItem = document.createElement('div');
    gridItem.getBoundingClientRect = () => ({
      top: 100, left: 50, bottom: 300, right: 450,
      width: 400, height: 200, x: 50, y: 100, toJSON: () => {},
    });
    (gridItem as any).gridstackNode = { id: 'A', x: 0, y: 0, w: 6, h: 4 };

    const mockGs = {
      getGridItems: () => [gridItem],
    } as any;

    const widgets: DashboardWidget[] = [
      { id: 'A', x: 0, y: 0, w: 6, h: 4, componentType: 'CHART', meta: {} },
    ];

    // Click below the item → should get index 1 (after item)
    const result = calcDropPosition(
      container,
      mockGs,
      { x: 250, y: 400 }, // well below the item midpoint
      widgets,
    );
    expect(result.index).toBe(1);
    expect(result.indicator).not.toBeNull();
    expect(result.indicator!.orientation).toBe('horizontal');
  });

  it('places before item when cursor is above midpoint', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({
      top: 0, left: 0, bottom: 400, right: 800,
      width: 800, height: 400, x: 0, y: 0, toJSON: () => {},
    });
    Object.defineProperty(container, 'scrollTop', { value: 0 });

    const gridItem = document.createElement('div');
    gridItem.getBoundingClientRect = () => ({
      top: 100, left: 0, bottom: 300, right: 800,
      width: 800, height: 200, x: 0, y: 100, toJSON: () => {},
    });
    (gridItem as any).gridstackNode = { id: 'A', x: 0, y: 0, w: 12, h: 4 };

    const mockGs = { getGridItems: () => [gridItem] } as any;
    const widgets: DashboardWidget[] = [
      { id: 'A', x: 0, y: 0, w: 12, h: 4, componentType: 'CHART', meta: {} },
    ];

    // Click above the midpoint (midY = 100 + 100 = 200 in container coords)
    const result = calcDropPosition(
      container,
      mockGs,
      { x: 400, y: 110 }, // above midpoint
      widgets,
    );
    expect(result.index).toBe(0);
    expect(result.indicator!.orientation).toBe('horizontal');
  });

  it('returns vertical indicator when cursor is beside a narrow item', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({
      top: 0, left: 0, bottom: 400, right: 800,
      width: 800, height: 400, x: 0, y: 0, toJSON: () => {},
    });
    Object.defineProperty(container, 'scrollTop', { value: 0 });

    // A narrow, tall item so horizontal proximity dominates
    const gridItem = document.createElement('div');
    gridItem.getBoundingClientRect = () => ({
      top: 0, left: 0, bottom: 400, right: 200,
      width: 200, height: 400, x: 0, y: 0, toJSON: () => {},
    });
    (gridItem as any).gridstackNode = { id: 'A', x: 0, y: 0, w: 3, h: 8 };

    const mockGs = { getGridItems: () => [gridItem] } as any;
    const widgets: DashboardWidget[] = [
      { id: 'A', x: 0, y: 0, w: 3, h: 8, componentType: 'CHART', meta: {} },
    ];

    // Click to the right of the item (relX=300, relY=200 → midX=100, midY=200)
    // dx/width = 200/200 = 1.0, dy/height = 0/400 = 0 → horizontal wins → vertical indicator
    const result = calcDropPosition(
      container,
      mockGs,
      { x: 300, y: 200 },
      widgets,
    );
    expect(result.indicator!.orientation).toBe('vertical');
    expect(result.index).toBe(1); // right of item → after
  });
});
