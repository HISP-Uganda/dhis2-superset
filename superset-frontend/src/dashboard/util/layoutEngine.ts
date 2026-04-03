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

/**
 * Dashboard Layout Engine
 *
 * Deterministic reflow algorithm for the 12-column dashboard grid.
 * When items overflow a row (total widths > 12), excess items are
 * pushed to the next row. This cascades downward, creating new rows
 * as needed. Empty rows are cleaned up.
 *
 * Guarantees:
 *  - No row ever has total child widths > 12
 *  - Same input always produces same output (deterministic)
 *  - Relative ordering of items is preserved
 *  - At least one item always stays in each non-empty row
 */

import { GRID_COLUMN_COUNT, GRID_MIN_COLUMN_COUNT } from './constants';
import { ROW_TYPE, TABS_TYPE, TAB_TYPE } from './componentTypes';
import newComponentFactory from './newComponentFactory';

type LayoutEntity = {
  id: string;
  type: string;
  children: string[];
  parents?: string[];
  meta?: Record<string, any>;
};

type Layout = Record<string, LayoutEntity>;

/* ── Helpers ──────────────────────────────────────────────── */

/** Get the column width of a layout component (default 4) */
export function getItemWidth(layout: Layout, itemId: string): number {
  const item = layout[itemId];
  if (!item?.meta?.width) return 0;
  return Math.max(
    GRID_MIN_COLUMN_COUNT,
    Math.min(GRID_COLUMN_COUNT, item.meta.width),
  );
}

/** Compute total occupied columns in a row */
export function computeRowOccupancy(
  layout: Layout,
  rowId: string,
): number {
  const row = layout[rowId];
  if (!row?.children) return 0;
  return row.children.reduce(
    (sum: number, childId: string) => sum + getItemWidth(layout, childId),
    0,
  );
}

/** Remaining capacity in a row */
export function computeRowCapacity(
  layout: Layout,
  rowId: string,
): number {
  return GRID_COLUMN_COUNT - computeRowOccupancy(layout, rowId);
}

/** Check whether a row overflows */
export function rowOverflows(layout: Layout, rowId: string): boolean {
  return computeRowOccupancy(layout, rowId) > GRID_COLUMN_COUNT;
}

/* ── Core Reflow ──────────────────────────────────────────── */

/**
 * Reflow a single container (GRID or TAB) so no row exceeds 12 columns.
 *
 * Algorithm:
 *  1. Walk rows top-to-bottom
 *  2. For each row, if total child widths > 12:
 *     - Keep items from left until adding the next would exceed 12
 *       (at least 1 item always stays)
 *     - Overflow items are prepended to the next row
 *     - If no next row exists, create one
 *  3. Remove any rows that ended up empty
 *  4. Return the updated layout (immutable — never mutates input)
 */
export function reflowContainer(
  layout: Layout,
  containerId: string,
): Layout {
  const container = layout[containerId];
  if (!container?.children?.length) return layout;

  let next: Layout = { ...layout };
  const rowIds: string[] = [...container.children];

  // Only process ROW children — skip others (HEADER, DIVIDER, TABS, etc.)
  for (let i = 0; i < rowIds.length; i++) {
    const rowId = rowIds[i];
    const row = next[rowId];
    if (!row || row.type !== ROW_TYPE) continue;

    const children = [...(row.children || [])];
    if (children.length === 0) continue;

    let totalWidth = 0;
    const keep: string[] = [];
    const overflow: string[] = [];

    for (const childId of children) {
      const childWidth = getItemWidth(next, childId);
      // Always keep at least one item in the row
      if (keep.length === 0 || totalWidth + childWidth <= GRID_COLUMN_COUNT) {
        keep.push(childId);
        totalWidth += childWidth;
      } else {
        overflow.push(childId);
      }
    }

    if (overflow.length === 0) continue;

    // Update current row
    next[rowId] = { ...row, children: keep };

    // Find or create the next ROW in this container
    let nextRowId: string | null = null;
    for (let j = i + 1; j < rowIds.length; j++) {
      if (next[rowIds[j]]?.type === ROW_TYPE) {
        nextRowId = rowIds[j];
        break;
      }
    }

    if (nextRowId) {
      // Prepend overflow to the next row (will be reflowed on next iteration)
      const nextRow = next[nextRowId];
      next[nextRowId] = {
        ...nextRow,
        children: [...overflow, ...(nextRow.children || [])],
      };
    } else {
      // Create a new row at the end
      const newRow = newComponentFactory(ROW_TYPE);
      newRow.children = overflow;
      newRow.parents = (container.parents || []).concat(containerId);
      // Update parent references for overflow items
      for (const childId of overflow) {
        if (next[childId]) {
          next[childId] = {
            ...next[childId],
            parents: [...(newRow.parents || []), newRow.id],
          };
        }
      }
      next[newRow.id] = newRow;
      rowIds.push(newRow.id);
    }
  }

  // Clean up empty rows
  const nonEmptyRowIds = rowIds.filter(id => {
    const row = next[id];
    if (!row || row.type !== ROW_TYPE) return true; // keep non-row children
    return row.children && row.children.length > 0;
  });

  // Remove empty row entities
  for (const id of rowIds) {
    if (!nonEmptyRowIds.includes(id)) {
      const row = next[id];
      if (row?.type === ROW_TYPE && (!row.children || row.children.length === 0)) {
        const { [id]: _removed, ...rest } = next;
        next = rest;
      }
    }
  }

  // Update container children
  if (
    nonEmptyRowIds.length !== container.children.length ||
    nonEmptyRowIds.some((id, idx) => container.children[idx] !== id)
  ) {
    next[containerId] = { ...next[containerId], children: nonEmptyRowIds };
  }

  return next;
}

/**
 * Reflow the entire dashboard layout.
 * Finds all containers (GRID, TAB) and reflows each.
 */
export function reflowLayout(layout: Layout): Layout {
  let next = layout;

  for (const [id, entity] of Object.entries(layout)) {
    if (!entity) continue;
    // Reflow GRID and TAB containers that hold rows
    if (
      entity.type === 'GRID' ||
      entity.type === TAB_TYPE
    ) {
      const hasRows = entity.children?.some(
        (childId: string) => next[childId]?.type === ROW_TYPE,
      );
      if (hasRows) {
        next = reflowContainer(next, id);
      }
    }
  }

  return next;
}

/* ── Shrink-to-fit ────────────────────────────────────────── */

/**
 * When dropping an item into a row that would overflow,
 * try to shrink existing items proportionally to make room.
 *
 * Returns null if shrinking is not possible (items at minimum width).
 */
export function shrinkRowToFit(
  layout: Layout,
  rowId: string,
  newItemWidth: number,
): Layout | null {
  const row = layout[rowId];
  if (!row?.children?.length) return null;

  const needed = computeRowOccupancy(layout, rowId) + newItemWidth - GRID_COLUMN_COUNT;
  if (needed <= 0) return layout; // already fits

  // Try to shrink each existing child proportionally
  const children = row.children;
  const widths = children.map((id: string) => getItemWidth(layout, id));
  const totalShrinkable = widths.reduce(
    (sum: number, w: number) => sum + Math.max(0, w - GRID_MIN_COLUMN_COUNT),
    0,
  );

  if (totalShrinkable < needed) return null; // can't shrink enough

  let remaining = needed;
  const next = { ...layout };
  const newWidths = [...widths];

  // Shrink from right to left (rightmost items shrink first)
  for (let i = children.length - 1; i >= 0 && remaining > 0; i--) {
    const maxShrink = newWidths[i] - GRID_MIN_COLUMN_COUNT;
    const shrink = Math.min(maxShrink, remaining);
    newWidths[i] -= shrink;
    remaining -= shrink;
  }

  // Apply new widths
  for (let i = 0; i < children.length; i++) {
    if (newWidths[i] !== widths[i]) {
      const child = next[children[i]];
      next[children[i]] = {
        ...child,
        meta: { ...child.meta, width: newWidths[i] },
      };
    }
  }

  return next;
}

/* ── Insert with displacement ─────────────────────────────── */

/**
 * Insert an item into a row at a given index, with intelligent displacement.
 *
 * If the row would overflow after insertion:
 *  1. Try to shrink existing items to fit
 *  2. If shrinking fails, let the item be inserted and rely on reflowContainer
 *     to push overflow items to the next row
 *
 * Returns the updated layout.
 */
export function insertWithDisplacement(
  layout: Layout,
  rowId: string,
  itemId: string,
  index: number,
): Layout {
  const row = layout[rowId];
  if (!row) return layout;

  const itemWidth = getItemWidth(layout, itemId);
  const currentOccupancy = computeRowOccupancy(layout, rowId);

  let next = { ...layout };

  // Try shrinking first
  if (currentOccupancy + itemWidth > GRID_COLUMN_COUNT) {
    const shrunk = shrinkRowToFit(next, rowId, itemWidth);
    if (shrunk) {
      next = shrunk;
    }
    // If shrinking wasn't enough, we'll still insert and let reflow handle it
  }

  // Insert the item
  const children = [...(next[rowId].children || [])];
  const safeIndex = Math.min(index, children.length);
  children.splice(safeIndex, 0, itemId);

  next[rowId] = { ...next[rowId], children };

  return next;
}

/* ── Validation ───────────────────────────────────────────── */

/**
 * Validate that no row in the layout exceeds 12 columns.
 * Returns a list of row IDs that overflow.
 */
export function findOverflowingRows(layout: Layout): string[] {
  const overflowing: string[] = [];
  for (const [id, entity] of Object.entries(layout)) {
    if (entity?.type === ROW_TYPE && rowOverflows(layout, id)) {
      overflowing.push(id);
    }
  }
  return overflowing;
}

/**
 * Validate and fix a layout before saving.
 * Runs reflow and ensures no overlaps.
 */
export function validateAndFixLayout(layout: Layout): Layout {
  return reflowLayout(layout);
}
