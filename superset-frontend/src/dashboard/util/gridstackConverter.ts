/**
 * Converts between Superset's tree-based dashboard layout and
 * gridstack's flat widget format (x, y, w, h).
 *
 * Superset layout: ROOT > GRID > ROW > CHART/COLUMN/HEADER/etc
 * GridStack: flat array of { id, x, y, w, h }
 *
 * The converter extracts leaf components and computes their absolute
 * grid positions. On save-back it reconstructs the tree from the
 * flat positions by grouping widgets that share overlapping y-ranges
 * into rows.
 */
import {
  GRID_COLUMN_COUNT,
  GRID_BASE_UNIT,
  DASHBOARD_ROOT_ID,
  DASHBOARD_GRID_ID,
} from './constants';
import {
  ROW_TYPE,
  CHART_TYPE,
  HEADER_TYPE,
  MARKDOWN_TYPE,
  DIVIDER_TYPE,
  DYNAMIC_TYPE,
  BLOCK_TYPE,
} from './componentTypes';

export interface DashboardWidget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  /** The original Superset component type */
  componentType: string;
  /** The original layout component data */
  meta: Record<string, any>;
  /** Original parent row ID for reconstruction */
  parentRowId?: string;
  /** Let gridstack auto-position this widget */
  autoPosition?: boolean;
}

/** Height conversion factor: Superset units → gridstack rows */
const H_FACTOR = 6;
/** Minimum gridstack row height for any widget */
const MIN_GS_H = 4;
/** Default width for new/unspecified charts (columns out of 12) */
const DEFAULT_W = 4;

/**
 * Convert Superset tree layout to flat gridstack widgets.
 * Walks GRID > ROW children, placing each leaf at its computed (x, y).
 * Unlike the old converter that forced row-aligned Y, this preserves
 * per-widget heights so gridstack can pack them into gaps.
 */
export function layoutToWidgets(
  layout: Record<string, any>,
  gridId: string = DASHBOARD_GRID_ID,
): DashboardWidget[] {
  const grid = layout[gridId];
  if (!grid || !grid.children) return [];

  const widgets: DashboardWidget[] = [];
  let currentY = 0;

  for (const rowId of grid.children) {
    const row = layout[rowId];
    if (!row) continue;

    if (row.type !== ROW_TYPE) {
      const h = Math.max(Math.ceil((row.meta?.height || 50) / H_FACTOR), MIN_GS_H);
      widgets.push({
        id: rowId,
        x: 0,
        y: currentY,
        w: GRID_COLUMN_COUNT,
        h,
        minW: 1,
        minH: 2,
        componentType: row.type,
        meta: row.meta || {},
        parentRowId: gridId,
      });
      currentY += h;
      continue;
    }

    let currentX = 0;
    let maxH = MIN_GS_H;

    for (const childId of row.children || []) {
      const child = layout[childId];
      if (!child) continue;

      const w = child.meta?.width || DEFAULT_W;
      const h = Math.max(Math.ceil((child.meta?.height || 50) / H_FACTOR), MIN_GS_H);

      widgets.push({
        id: childId,
        x: currentX,
        y: currentY,
        w,
        h,
        minW: 1,
        minH: 2,
        componentType: child.type,
        meta: child.meta || {},
        parentRowId: rowId,
      });

      currentX += w;
      maxH = Math.max(maxH, h);
    }

    currentY += maxH;
  }

  return widgets;
}

/**
 * Convert gridstack widgets back to Superset tree layout.
 *
 * Strategy: scan top→bottom and group widgets whose y-ranges overlap
 * into the same logical row. This correctly handles the gridstack
 * packing layout where a short widget at y=0 h=4 and a tall widget
 * at y=0 h=8 share a row, while a widget at y=4 that sits *below*
 * the short one (but beside the tall one) starts a new row.
 */
export function widgetsToLayout(
  widgets: DashboardWidget[],
  existingLayout: Record<string, any>,
  gridId: string = DASHBOARD_GRID_ID,
): Record<string, any> {
  const layout = { ...existingLayout };

  // Sort by y then x
  const sorted = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);

  // Group into rows: two widgets share a row if they overlap vertically
  const rows: DashboardWidget[][] = [];
  let currentBand: DashboardWidget[] = [];
  let bandBottom = -1;

  for (const widget of sorted) {
    if (bandBottom === -1 || widget.y < bandBottom) {
      // Widget starts within the current band's y-range
      currentBand.push(widget);
      bandBottom = Math.max(bandBottom, widget.y + widget.h);
    } else {
      // Widget starts at or below the current band → new row
      if (currentBand.length > 0) rows.push(currentBand);
      currentBand = [widget];
      bandBottom = widget.y + widget.h;
    }
  }
  if (currentBand.length > 0) rows.push(currentBand);

  // Reconstruct layout tree
  const gridChildren: string[] = [];
  const gridComponent = layout[gridId];
  // Track which row IDs we've already assigned to avoid duplicates
  // (two bands could both try to claim the same parentRowId)
  const usedRowIds = new Set<string>();

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const rowWidgets = rows[rowIdx];

    // Reuse an existing row ID from any widget in this band, preferring
    // the first match that hasn't been claimed by another band yet.
    let rowId = `ROW-gs-${rowIdx}`;
    for (const w of rowWidgets) {
      const candidate = w.parentRowId;
      if (
        candidate &&
        !usedRowIds.has(candidate) &&
        layout[candidate]?.type === ROW_TYPE
      ) {
        rowId = candidate;
        break;
      }
    }
    usedRowIds.add(rowId);

    const rowChildren: string[] = [];

    for (const widget of rowWidgets) {
      const existing = layout[widget.id] || {};
      layout[widget.id] = {
        ...existing,
        id: widget.id,
        type: widget.componentType || existing.type,
        meta: {
          ...(existing.meta || {}),
          ...widget.meta,
          width: widget.w,
          height: widget.h * H_FACTOR,
          // Persist absolute grid position for lossless round-trip
          gsX: widget.x,
          gsY: widget.y,
        },
        parents: [DASHBOARD_ROOT_ID, gridId, rowId],
        children: existing.children || [],
      };
      rowChildren.push(widget.id);
    }

    layout[rowId] = {
      ...(layout[rowId] || {}),
      id: rowId,
      type: ROW_TYPE,
      children: rowChildren,
      parents: [DASHBOARD_ROOT_ID, gridId],
      meta: layout[rowId]?.meta || { background: 'BACKGROUND_TRANSPARENT' },
    };

    gridChildren.push(rowId);
  }

  layout[gridId] = {
    ...gridComponent,
    children: gridChildren,
  };

  return layout;
}

/**
 * Get the leaf chart/component items from a layout suitable for rendering.
 */
export function getLeafComponents(
  layout: Record<string, any>,
  gridId: string = DASHBOARD_GRID_ID,
): string[] {
  const grid = layout[gridId];
  if (!grid || !grid.children) return [];

  const leaves: string[] = [];

  for (const rowId of grid.children) {
    const row = layout[rowId];
    if (!row) continue;

    if (row.type === ROW_TYPE) {
      for (const childId of row.children || []) {
        leaves.push(childId);
      }
    } else {
      leaves.push(rowId);
    }
  }

  return leaves;
}

/**
 * Determine if a component type is a leaf (renderable widget) or container.
 */
export function isLeafType(type: string): boolean {
  return [CHART_TYPE, HEADER_TYPE, MARKDOWN_TYPE, DIVIDER_TYPE, DYNAMIC_TYPE, BLOCK_TYPE].includes(type);
}
