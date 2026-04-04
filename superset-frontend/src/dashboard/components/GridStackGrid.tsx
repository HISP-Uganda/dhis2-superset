/**
 * GridStack-powered dashboard grid.
 *
 * Behaviour:
 *  • float:false  → widgets fall upward into gaps (gravity packing)
 *  • compact('compact') after every change → optimal space usage
 *  • Dropped charts auto-fit width, auto-adjust height
 *  • Drag moves neighbours one step only — minimal reflow
 *  • Accepts new charts via "Add to Dashboard" buttons in sidebar
 *  • Accepts react-dnd drops from SliceAdder sidebar for positional placement
 *  • In-place updates: moving/resizing does NOT rebuild the grid — only
 *    adding/removing widgets triggers a full rebuild.
 */
import {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
  memo,
} from 'react';
import { createPortal } from 'react-dom';
import { useSelector, useDispatch } from 'react-redux';
import { css, styled, t } from '@superset-ui/core';
import { GridStack } from 'gridstack';
import type { GridStackNode } from 'gridstack';
import { useDrop } from 'react-dnd';
import 'gridstack/dist/gridstack.min.css';

import DashboardComponent from '../containers/DashboardComponent';
import {
  GRID_COLUMN_COUNT,
  GRID_BASE_UNIT,
  GRID_GUTTER_SIZE,
  NEW_COMPONENTS_SOURCE_ID,
} from '../util/constants';
import { CHART_TYPE } from '../util/componentTypes';
import {
  layoutToWidgets,
  widgetsToLayout,
  DashboardWidget,
} from '../util/gridstackConverter';
import {
  updateComponents,
  handleComponentDrop,
} from '../actions/dashboardLayout';
import { setUnsavedChanges } from '../actions/dashboardState';

const CELL_HEIGHT = GRID_BASE_UNIT * 6; // 48px

interface GridStackGridProps {
  gridComponent: any;
  width: number;
  editMode: boolean;
  isComponentVisible: boolean;
  depth: number;
  handleComponentDrop: Function;
  resizeComponent: Function;
  setDirectPathToChild: Function;
}

/* ------------------------------------------------------------------ */
/*  Styled container                                                   */
/* ------------------------------------------------------------------ */
const GridStackContainer = styled.div<{ $editMode: boolean }>`
  ${({ theme, $editMode }) => css`
    position: relative;
    min-height: 200px;

    .grid-stack {
      min-height: 100px !important;
      ${$editMode &&
      css`
        background: repeating-linear-gradient(
          0deg,
          transparent,
          transparent ${CELL_HEIGHT - 1}px,
          ${theme.colorBorderSecondary}18 ${CELL_HEIGHT - 1}px,
          ${theme.colorBorderSecondary}18 ${CELL_HEIGHT}px
        );
      `}
    }

    .grid-stack-item {
      overflow: visible;
    }

    .grid-stack > .grid-stack-item > .grid-stack-item-content {
      overflow: hidden !important;
      border-radius: ${theme.borderRadiusLG}px;
      background: ${theme.colorBgContainer};
      border: 1px solid rgba(148, 163, 184, 0.22);
      box-shadow: none;
      transition: border-color 0.2s ease;

      &:hover {
        border-color: rgba(148, 163, 184, 0.4);
        box-shadow: none;
      }
    }

    /* ---- Edit mode ---- */
    ${$editMode &&
    css`
      .grid-stack-item {
        cursor: grab;
      }
      .grid-stack-item.ui-draggable-dragging {
        cursor: grabbing;
        z-index: 100 !important;
        opacity: 0.92;
      }
      .grid-stack > .grid-stack-item > .grid-stack-item-content {
        outline: 1px dashed ${theme.colorBorderSecondary};
        outline-offset: -1px;
      }
      .grid-stack > .grid-stack-item:hover > .grid-stack-item-content {
        outline-color: ${theme.colorPrimary};
      }
      .grid-stack-placeholder > .placeholder-content {
        background: ${theme.colorPrimaryBg} !important;
        border: 2px dashed ${theme.colorPrimary} !important;
        border-radius: ${theme.borderRadiusLG}px !important;
        opacity: 0.4;
      }
      .ui-resizable-se {
        width: 14px !important;
        height: 14px !important;
        bottom: 2px !important;
        right: 2px !important;
        border-right: 3px solid ${theme.colorPrimary};
        border-bottom: 3px solid ${theme.colorPrimary};
        border-radius: 0 0 ${theme.borderRadius}px 0;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .grid-stack-item:hover .ui-resizable-se {
        opacity: 0.8;
      }
    `}

    ${!$editMode &&
    css`
      .grid-stack > .grid-stack-item > .grid-stack-item-content {
        outline: none;
      }
    `}

    /* ---- Drop indicators ---- */
    .gs-drop-indicator {
      position: absolute;
      z-index: 50;
      pointer-events: none;
      transition: top 0.1s ease, left 0.1s ease, height 0.1s ease, width 0.1s ease;
    }
    .gs-drop-indicator--horizontal {
      height: 3px;
      left: 0;
      right: 0;
      background: ${theme.colorPrimary};
      border-radius: 2px;
      &::before {
        content: '';
        position: absolute;
        left: 50%;
        top: -8px;
        transform: translateX(-50%);
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: ${theme.colorPrimary};
        opacity: 0.3;
      }
    }
    .gs-drop-indicator--vertical {
      width: 3px;
      background: ${theme.colorPrimary};
      border-radius: 2px;
      &::before {
        content: '';
        position: absolute;
        top: 50%;
        left: -8px;
        transform: translateY(-50%);
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: ${theme.colorPrimary};
        opacity: 0.3;
      }
    }
    .gs-drop-overlay {
      position: absolute;
      inset: 0;
      z-index: 40;
      border: 2px dashed ${theme.colorPrimary};
      border-radius: ${theme.borderRadiusLG}px;
      background: ${theme.colorPrimaryBg};
      opacity: 0.4;
      pointer-events: none;
    }

    /* Empty grid placeholder — visible drop zone when dashboard has no content */
    .gs-empty-placeholder {
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      border: 2px dashed ${theme.colorBorderSecondary};
      border-radius: ${theme.borderRadiusLG}px;
      color: ${theme.colorTextDescription};
      font-size: 14px;
      padding: 32px;
      text-align: center;
      transition: border-color 0.2s ease, background 0.2s ease;
    }
    .gs-empty-placeholder.gs-empty-placeholder--active {
      border-color: ${theme.colorPrimary};
      background: ${theme.colorPrimaryBg};
    }

    /* ---- Widget inner content ---- */
    .gs-widget-inner {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .gs-widget-inner .dashboard-component-chart-holder {
      width: 100% !important;
      height: 100% !important;
      overflow: hidden !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      padding: 4px !important;
      display: flex !important;
      flex-direction: column !important;
    }
    .gs-widget-inner .resizable-container,
    .gs-widget-inner .dragdroppable {
      width: 100% !important;
      height: 100% !important;
    }
    .gs-widget-inner .grid-row {
      flex-wrap: wrap;
      width: 100%;
      height: 100%;
    }
    /* Chart header — flat design aligned with Page Studio */
    .gs-widget-inner .slice-header,
    .gs-widget-inner .chart-header,
    .gs-widget-inner [data-test="slice-header"] {
      min-height: 32px;
      flex-shrink: 0;
      padding: 6px 10px !important;
      border-bottom: 1px solid rgba(148, 163, 184, 0.22) !important;
      background: ${theme.colorBgContainer};
      margin: 0 !important;
    }
    .gs-widget-inner [data-test="slice-header"] .header-title {
      font-size: var(--pro-density-chart-title, 13px);
      font-weight: 600;
      color: var(--pro-navy, ${theme.colorText});
      letter-spacing: -0.01em;
    }
    .gs-widget-inner [data-test="slice-header"] .editable-title input,
    .gs-widget-inner [data-test="slice-header"] .editable-title span {
      font-weight: 600 !important;
      color: var(--pro-navy, ${theme.colorText}) !important;
    }
    .gs-widget-inner .chart-filter-context {
      font-size: 11px;
      color: var(--pro-text-secondary, ${theme.colorTextDescription});
      margin-top: 1px;
      opacity: 0.8;
    }
    .gs-widget-inner .chart-container,
    .gs-widget-inner .slice_container {
      flex: 1 1 0;
      min-height: 0;
      width: 100%;
      max-width: 100%;
      overflow: hidden;
    }
    /* Chart visualization wrapper — fill available space */
    .gs-widget-inner .chart-slice {
      display: flex !important;
      flex-direction: column !important;
      height: 100% !important;
    }
    .gs-widget-inner .dashboard-chart,
    .gs-widget-inner .chart-wrapper {
      flex: 1 1 0 !important;
      min-height: 0 !important;
      max-width: 100% !important;
    }
    /* BigNumber / summary charts — center content and balance spacing */
    .gs-widget-inner .superset-legacy-chart-big-number,
    .gs-widget-inner .superset-legacy-chart-big-number-total,
    .gs-widget-inner [class*="BigNumber"] {
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      align-items: center !important;
      width: 100% !important;
      padding: 0 !important;
    }
    .gs-widget-inner [class*="BigNumber"] .text-container {
      align-items: center !important;
      width: 100% !important;
      text-align: center;
    }
    .gs-widget-inner [class*="BigNumber"] .header-line {
      justify-content: center !important;
      text-align: center !important;
      width: 100% !important;
    }
    .gs-widget-inner [class*="BigNumber"] .subheader-line,
    .gs-widget-inner [class*="BigNumber"] .kicker,
    .gs-widget-inner [class*="BigNumber"] .metric-name,
    .gs-widget-inner [class*="BigNumber"] .subtitle-line {
      text-align: center !important;
      width: 100% !important;
    }
    /* Loading placeholder */
    .gs-widget-loading {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `}
`;

/* ------------------------------------------------------------------ */
/*  Widget content (memo'd)                                            */
/* ------------------------------------------------------------------ */
const WidgetContent = memo(
  ({
    componentId,
    parentId,
    depth,
    columnWidth,
    isComponentVisible,
  }: {
    componentId: string;
    parentId: string;
    depth: number;
    columnWidth: number;
    isComponentVisible: boolean;
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [measuredWidth, setMeasuredWidth] = useState(0);
    const mountedRef = useRef(true);

    useEffect(
      () => () => {
        mountedRef.current = false;
      },
      [],
    );

    // Measure actual container width via ResizeObserver so charts
    // fill the gridstack widget instead of relying on column math
    useEffect(() => {
      const el = containerRef.current;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (mountedRef.current) {
            setMeasuredWidth(entry.contentRect.width);
          }
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    useEffect(() => {
      if (ready) return;
      const raf = requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        const el = containerRef.current;
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          setReady(true);
        } else {
          const timer = setTimeout(() => {
            if (mountedRef.current) setReady(true);
          }, 200);
          return () => clearTimeout(timer);
        }
      });
      return () => cancelAnimationFrame(raf);
    }, [ready]);

    // Check if this component exists in layout
    const layout = useSelector(
      (state: any) => state.dashboardLayout?.present || state.dashboardLayout,
    );
    const component = layout[componentId];
    const chartId = component?.meta?.chartId;
    const chartExists = useSelector(
      (state: any) => !chartId || !!state.charts?.[chartId],
    );
    const sliceExists = useSelector(
      (state: any) => !chartId || !!state.sliceEntities?.slices?.[chartId],
    );

    // Compute a corrected columnWidth that compensates for the GridStack
    // widget's actual size vs the standard grid math in ChartHolder.
    // ChartHolder does: width = widthMultiple * cw + (widthMultiple-1) * gutter - 64
    // We want: width ≈ measuredWidth - 8 (our 4px padding each side)
    // So: measuredWidth - 8 = wm * cw + (wm-1) * gutter - 64
    //     cw = (measuredWidth - 8 + 64 - (wm-1) * gutter) / wm
    // For simplicity, assume widthMultiple = component?.meta?.width || 4
    const effectiveColumnWidth = useMemo(() => {
      if (!measuredWidth || measuredWidth < 50) return columnWidth;
      const wm = component?.meta?.width || 4;
      // Target: chart should fill container minus 8px total padding
      const targetChartWidth = measuredWidth - 8;
      // Reverse ChartHolder's formula: width = wm*cw + (wm-1)*gutter - CHART_MARGIN
      const corrected = (targetChartWidth + 64 - (wm - 1) * GRID_GUTTER_SIZE) / wm;
      return Math.max(corrected, 10);
    }, [measuredWidth, columnWidth, component?.meta?.width]);

    if (!component) return null;

    // If chart ID exists but chart/slice data is missing, show a
    // graceful placeholder instead of the MissingChart error
    if (chartId && (!chartExists || !sliceExists)) {
      return (
        <div className="gs-widget-inner gs-widget-loading" ref={containerRef}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--pro-text-secondary, #6B7280)',
            fontSize: 13,
            padding: 16,
            textAlign: 'center',
          }}>
            {t('Loading chart...')}
          </div>
        </div>
      );
    }

    return (
      <div className="gs-widget-inner" ref={containerRef}>
        {ready && (
          <DashboardComponent
            id={componentId}
            parentId={parentId}
            depth={depth}
            index={0}
            availableColumnCount={GRID_COLUMN_COUNT}
            columnWidth={effectiveColumnWidth}
            isComponentVisible={isComponentVisible}
            onResizeStart={() => {}}
            onResize={() => {}}
            onResizeStop={() => {}}
            onChangeTab={() => {}}
          />
        )}
      </div>
    );
  },
);
WidgetContent.displayName = 'WidgetContent';

/* ------------------------------------------------------------------ */
/*  Drop position calculator — supports both horizontal & vertical     */
/* ------------------------------------------------------------------ */
type DropIndicatorState = {
  orientation: 'horizontal' | 'vertical';
  top: number;
  left: number;
  width?: number;
  height?: number;
} | null;

type DropPositionResult = {
  /** Index in the grid's children array where the new item goes */
  index: number;
  indicator: DropIndicatorState;
};

export function calcDropPosition(
  containerEl: HTMLDivElement | null,
  gsInstance: GridStack | null,
  clientOffset: { x: number; y: number } | null,
  widgets: DashboardWidget[],
): DropPositionResult {
  const empty: DropPositionResult = {
    index: widgets.length,
    indicator: null,
  };
  if (!containerEl || !clientOffset) return empty;

  // Empty grid: place at the top
  if (widgets.length === 0) {
    const rect = containerEl.getBoundingClientRect();
    return {
      index: 0,
      indicator: {
        orientation: 'horizontal',
        top: 0,
        left: 0,
        width: rect.width,
      },
    };
  }

  const rect = containerEl.getBoundingClientRect();
  const relX = clientOffset.x - rect.left;
  const relY = clientOffset.y - rect.top + containerEl.scrollTop;

  // Gather the rendered positions of every gridstack item
  const items = gsInstance?.getGridItems() || [];
  type ItemPos = {
    idx: number;
    top: number;
    left: number;
    width: number;
    height: number;
    midX: number;
    midY: number;
  };
  const positions: ItemPos[] = [];

  items.forEach((el, idx) => {
    const r = el.getBoundingClientRect();
    const top = r.top - rect.top + containerEl.scrollTop;
    const left = r.left - rect.left;
    positions.push({
      idx,
      top,
      left,
      width: r.width,
      height: r.height,
      midX: left + r.width / 2,
      midY: top + r.height / 2,
    });
  });

  // Find the closest widget to the cursor
  let closest: ItemPos | null = null;
  let minDist = Infinity;
  for (const p of positions) {
    const dx = relX - p.midX;
    const dy = relY - p.midY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) {
      minDist = dist;
      closest = p;
    }
  }

  if (!closest) return empty;

  // Determine if the cursor is to the left/right or above/below
  const dx = relX - closest.midX;
  const dy = relY - closest.midY;
  // Normalise by item dimensions to treat tall and wide items equally
  const normDx = Math.abs(dx) / (closest.width || 1);
  const normDy = Math.abs(dy) / (closest.height || 1);

  if (normDx > normDy) {
    // Horizontal proximity wins → vertical indicator (left or right of item)
    const isRight = dx > 0;
    return {
      index: isRight ? closest.idx + 1 : closest.idx,
      indicator: {
        orientation: 'vertical',
        top: closest.top,
        left: isRight
          ? closest.left + closest.width
          : closest.left,
        height: closest.height,
      },
    };
  }
  // Vertical proximity wins → horizontal indicator (above or below item)
  const isBelow = dy > 0;
  return {
    index: isBelow ? closest.idx + 1 : closest.idx,
    indicator: {
      orientation: 'horizontal',
      top: isBelow ? closest.top + closest.height : closest.top,
      left: 0,
      width: rect.width,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Sorted, deduplicated set of widget IDs — order-independent key */
export function stableIdKey(widgets: DashboardWidget[]): string {
  return Array.from(new Set(widgets.map(w => w.id))).sort().join(',');
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
const GridStackGrid = ({
  gridComponent,
  width,
  editMode,
  isComponentVisible,
  depth,
  handleComponentDrop: onComponentDrop,
}: GridStackGridProps) => {
  const dispatch = useDispatch();
  const gridRef = useRef<HTMLDivElement>(null);
  const gsRef = useRef<GridStack | null>(null);
  const portalTargets = useRef<Map<string, HTMLDivElement>>(new Map());
  const suppressSync = useRef(false);
  const isDraggingRef = useRef(false);
  // Tracks the last known-good set of widget IDs.  syncToRedux() must
  // never dispatch an update that shrinks this set — that would cause
  // the idSetKey to change mid-drag and trigger a full grid rebuild
  // (destroying portal targets and charts).
  const knownWidgetIdsRef = useRef<Set<string>>(new Set());
  const [portalVersion, setPortalVersion] = useState(0);
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState>(null);

  const layout = useSelector(
    (state: any) => state.dashboardLayout?.present || state.dashboardLayout,
  );

  const columnWidth = useMemo(
    () => (width + GRID_GUTTER_SIZE) / GRID_COLUMN_COUNT - GRID_GUTTER_SIZE,
    [width],
  );

  const widgets = useMemo(
    () => layoutToWidgets(layout, gridComponent?.id),
    [layout, gridComponent?.id],
  );

  /**
   * KEY INSIGHT: Use a **sorted** set of IDs so that reordering /
   * repositioning widgets does NOT trigger a full grid rebuild.
   * Only actual add/remove of widgets changes this key.
   */
  const idSetKey = useMemo(() => stableIdKey(widgets), [widgets]);

  // Keep knownWidgetIdsRef in sync with the canonical widget list
  useEffect(() => {
    knownWidgetIdsRef.current = new Set(widgets.map(w => w.id));
  }, [widgets]);

  /* ---- Add component programmatically (called from sidebar button) ---- */
  const addComponentToGrid = useCallback(
    (componentType: string, componentId: string, meta: Record<string, any>) => {
      const dropResult = {
        source: {
          id: NEW_COMPONENTS_SOURCE_ID,
          type: 'NEW_COMPONENT_SOURCE',
          index: 0,
        },
        destination: {
          id: gridComponent?.id,
          type: gridComponent?.type,
          index: gridComponent?.children?.length || 0,
        },
        dragging: {
          id: componentId,
          type: componentType,
          meta,
        },
      };
      dispatch(handleComponentDrop(dropResult) as any);
    },
    [dispatch, gridComponent],
  );

  // Backward-compat wrapper for chart-specific adds
  const addChartToGrid = useCallback(
    (chartId: number, sliceName: string) => {
      addComponentToGrid(CHART_TYPE, 'NEW_CHART_ID', { chartId, sliceName });
    },
    [addComponentToGrid],
  );

  useEffect(() => {
    (window as any).__gridstack_addChart = addChartToGrid;
    (window as any).__gridstack_addComponent = addComponentToGrid;
    return () => {
      delete (window as any).__gridstack_addChart;
      delete (window as any).__gridstack_addComponent;
    };
  }, [addChartToGrid, addComponentToGrid]);

  /* ---- React-DND drop target (sidebar → grid) ---- */
  const [{ isOver, canDrop }, dropRef] = useDrop({
    accept: 'DRAG_DROPPABLE',
    canDrop: () => editMode,
    hover: (_item: any, monitor: any) => {
      if (!editMode || !monitor.isOver({ shallow: true })) {
        setDropIndicator(null);
        return;
      }
      const offset = monitor.getClientOffset();
      const pos = calcDropPosition(
        gridRef.current,
        gsRef.current,
        offset,
        widgets,
      );
      setDropIndicator(pos.indicator);
    },
    drop: (item: any, monitor: any) => {
      setDropIndicator(null);
      if (!editMode || !monitor.isOver({ shallow: true })) return undefined;

      const meta = item.meta || {};
      const dragType = item.type || CHART_TYPE;
      const dragId = item.id || 'NEW_CHART_ID';

      // Accept any component type from the sidebar (charts, headers,
      // markdown, dividers, blocks, etc.)
      const offset = monitor.getClientOffset();
      const pos = calcDropPosition(
        gridRef.current,
        gsRef.current,
        offset,
        widgets,
      );

      const dropResult = {
        source: {
          id: NEW_COMPONENTS_SOURCE_ID,
          type: 'NEW_COMPONENT_SOURCE' as const,
          index: 0,
        },
        destination: {
          id: gridComponent?.id,
          type: gridComponent?.type,
          index: pos.index,
        },
        dragging: {
          id: dragId,
          type: dragType,
          meta,
        },
      };
      dispatch(handleComponentDrop(dropResult) as any);
      return undefined;
    },
    collect: (monitor: any) => ({
      isOver: monitor.isOver({ shallow: true }),
      canDrop: monitor.canDrop(),
    }),
  });

  useEffect(() => {
    if (!isOver) setDropIndicator(null);
  }, [isOver]);

  /* ---- Safely call methods on the GridStack instance ---- */
  const safeGs = useCallback(
    (fn: (gs: GridStack) => void) => {
      const gs = gsRef.current;
      if (!gs) return;
      try {
        // Ensure GridStack's internal engine is still alive.
        // After gs.destroy() the engine is nulled; calling any
        // method on that instance would throw.
        if (!(gs as any).engine) return;
        fn(gs);
      } catch {
        // Instance already torn down — ignore.
      }
    },
    [],
  );

  /* ---- Sync gridstack → Redux (position / size only) ---- */
  const syncToRedux = useCallback(() => {
    const gs = gsRef.current;
    if (!gs || suppressSync.current) return;

    try {
      // Ensure the GridStack engine is still alive
      if (!(gs as any).engine) return;

      const items = gs.getGridItems();
      const currentWidgets: DashboardWidget[] = items
        .map(el => {
          const n = el.gridstackNode;
          const id = n?.id || el.getAttribute('gs-id') || '';
          if (!id) return null;
          const orig = widgets.find(w => w.id === id);
          return {
            id,
            x: n?.x ?? 0,
            y: n?.y ?? 0,
            w: n?.w ?? 4,
            h: n?.h ?? 4,
            componentType: orig?.componentType || 'CHART',
            meta: orig?.meta || {},
            parentRowId: orig?.parentRowId,
          };
        })
        .filter(Boolean) as DashboardWidget[];

      if (currentWidgets.length === 0) return;

      // CRITICAL GUARD: never dispatch a sync that loses widgets.
      // During a drag, some gridstackNodes may temporarily lack an ID
      // or not appear in getGridItems().  If any known widget is
      // missing from currentWidgets, skip this sync entirely — the
      // next dragstop/change will retry with the complete set.
      const currentIds = new Set(currentWidgets.map(w => w.id));
      const knownIds = Array.from(knownWidgetIdsRef.current);
      for (let i = 0; i < knownIds.length; i++) {
        if (!currentIds.has(knownIds[i])) {
          // A widget we know about is missing from GridStack's items.
          // This is transient — do NOT dispatch or we'll lose it.
          return;
        }
      }

      const newLayout = widgetsToLayout(
        currentWidgets,
        layout,
        gridComponent?.id,
      );

      const diff: Record<string, any> = {};
      for (const [key, value] of Object.entries(newLayout)) {
        if (JSON.stringify(value) !== JSON.stringify(layout[key])) {
          diff[key] = value;
        }
      }

      if (Object.keys(diff).length > 0) {
        suppressSync.current = true;
        dispatch(updateComponents(diff));
        dispatch(setUnsavedChanges(true));
        // Double-rAF: let React commit the Redux update so the
        // layout selector re-runs *before* we allow the next sync.
        // This prevents a feedback loop where Redux → widgets →
        // widgetKey change → full rebuild during a drag.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            suppressSync.current = false;
          });
        });
      }
    } catch (e) {
      console.warn('GridStack sync error (safe to ignore):', e);
    }
  }, [dispatch, layout, widgets, gridComponent?.id]);

  /* ---- Build / rebuild GridStack ---- */
  useEffect(() => {
    if (!gridRef.current) return;

    // NEVER rebuild while the user is actively dragging — GridStack's
    // internal DDDraggable still holds mouse listeners.  Destroying the
    // grid mid-drag leaves those listeners dangling, and the subsequent
    // mouseup fires _triggerChangeEvent on a destroyed engine (the
    // "Cannot read properties of undefined (reading 'batchMode')" crash).
    if (isDraggingRef.current) return;

    // --- Tear down any existing grid ---
    if (gsRef.current) {
      try {
        const gs = gsRef.current;
        gs.off('change');
        gs.off('dragstart');
        gs.off('dragstop');
        gs.off('resizestart');
        gs.off('resizestop');
        gs.setStatic(true);
        gs.destroy(false);
      } catch {
        // already torn down
      }
      gsRef.current = null;
    }

    const container = gridRef.current;
    container.innerHTML = '';
    portalTargets.current.clear();

    // --- Create DOM items ---
    for (const w of widgets) {
      const item = document.createElement('div');
      item.className = 'grid-stack-item';
      item.setAttribute('gs-id', w.id);
      item.setAttribute('gs-x', String(w.x));
      item.setAttribute('gs-y', String(w.y));
      item.setAttribute('gs-w', String(w.w));
      item.setAttribute('gs-h', String(w.h));
      item.setAttribute('gs-min-w', '1');
      item.setAttribute('gs-min-h', '2');

      const content = document.createElement('div');
      content.className = 'grid-stack-item-content';

      const portal = document.createElement('div');
      portal.style.cssText = 'width:100%;height:100%';
      content.appendChild(portal);
      portalTargets.current.set(w.id, portal);

      item.appendChild(content);
      container.appendChild(item);
    }

    // --- Initialise GridStack ---
    const gs = GridStack.init(
      {
        column: GRID_COLUMN_COUNT,
        cellHeight: CELL_HEIGHT,
        margin: GRID_GUTTER_SIZE / 2,
        float: false,
        animate: true,
        staticGrid: !editMode,
        acceptWidgets: false,
        removable: false,
        resizable: { handles: 'e, se, s' },
        draggable: { handle: '.grid-stack-item-content' },
      },
      container,
    );

    try {
      gs.compact('compact');
    } catch {
      // ok
    }

    gsRef.current = gs;
    isDraggingRef.current = false;
    setPortalVersion(n => n + 1);

    return () => {
      if (gsRef.current) {
        try {
          gsRef.current.off('change');
          gsRef.current.off('dragstart');
          gsRef.current.off('dragstop');
          gsRef.current.off('resizestart');
          gsRef.current.off('resizestop');
          gsRef.current.setStatic(true);
          gsRef.current.destroy(false);
        } catch {
          // ok
        }
        gsRef.current = null;
      }
    };
    // ONLY rebuild when the set of widget IDs changes (add / remove),
    // NOT when positions change (drag / resize).
  }, [idSetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Toggle static / interactive ---- */
  useEffect(() => {
    safeGs(gs => {
      gs.setStatic(!editMode);
      gs.enableMove(editMode);
      gs.enableResize(editMode);
    });
  }, [editMode, safeGs]);

  /* ---- Attach event listeners (re-attach when syncToRedux changes) ---- */
  useEffect(() => {
    const gs = gsRef.current;
    if (!gs) return;

    const onDragResizeStart = () => {
      isDraggingRef.current = true;
    };

    const onDragResizeStop = () => {
      isDraggingRef.current = false;
      // Guard: gsRef may have been cleared if a rebuild happened
      safeGs(g => {
        try { g.compact('compact'); } catch { /* ignore */ }
      });
      syncToRedux();
    };

    const onChange = () => {
      // Skip sync during active drag/resize — we sync on stop
      if (isDraggingRef.current) return;
      safeGs(g => {
        try { g.compact('compact'); } catch { /* ignore */ }
      });
      syncToRedux();
    };

    gs.on('change', onChange);
    gs.on('dragstart', onDragResizeStart);
    gs.on('resizestart', onDragResizeStart);
    gs.on('dragstop', onDragResizeStop);
    gs.on('resizestop', onDragResizeStop);

    return () => {
      try {
        gs.off('change');
        gs.off('dragstart');
        gs.off('resizestart');
        gs.off('dragstop');
        gs.off('resizestop');
      } catch {
        // ignore
      }
    };
  }, [syncToRedux, safeGs]);

  if (!gridComponent || !gridComponent.children) return null;

  const isEmpty = widgets.length === 0;

  return (
    <GridStackContainer $editMode={editMode} ref={dropRef}>
      <div ref={gridRef} className="grid-stack" />

      {/* Empty-state drop zone when dashboard has no content yet */}
      {editMode && isEmpty && (
        <div
          className={`gs-empty-placeholder${
            isOver && canDrop ? ' gs-empty-placeholder--active' : ''
          }`}
        >
          {isOver && canDrop
            ? t('Release to add to dashboard')
            : t('Drag charts or components here')}
        </div>
      )}

      {/* Drop overlay when dragging from sidebar over populated grid */}
      {editMode && isOver && canDrop && !isEmpty && (
        <div className="gs-drop-overlay" />
      )}

      {/* Drop position indicator (horizontal or vertical) */}
      {editMode && isOver && canDrop && dropIndicator && (
        dropIndicator.orientation === 'horizontal' ? (
          <div
            className="gs-drop-indicator gs-drop-indicator--horizontal"
            style={{ top: dropIndicator.top }}
          />
        ) : (
          <div
            className="gs-drop-indicator gs-drop-indicator--vertical"
            style={{
              top: dropIndicator.top,
              left: dropIndicator.left,
              height: dropIndicator.height,
            }}
          />
        )
      )}

      {/* React portals into gridstack DOM */}
      {widgets.map(w => {
        const target = portalTargets.current.get(w.id);
        if (!target) return null;
        return createPortal(
          <WidgetContent
            key={w.id}
            componentId={w.id}
            parentId={w.parentRowId || gridComponent.id}
            depth={depth + 2}
            columnWidth={columnWidth}
            isComponentVisible={isComponentVisible}
          />,
          target,
        );
      })}
    </GridStackContainer>
  );
};

export default memo(GridStackGrid);
