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
  ChartProps,
  DataRecord,
  extractTimegrain,
  getMetricLabel,
  getTimeFormatter,
  getTimeFormatterForGranularity,
  QueryFormData,
  SMART_DATE_ID,
  TimeFormats,
  formatDHIS2Period,
  getDHIS2PeriodColumnNames,
} from '@superset-ui/core';
import { GenericDataType } from '@apache-superset/core/api/core';
import { ColorFormatters, getColorFormatters } from '@superset-ui/chart-controls';
import { matchesBreakpoint } from 'src/explore/components/controls/ColorBreakpointsControl/colorBreakpointUtils';
import { DateFormatter } from '../types';

const { DATABASE_DATETIME } = TimeFormats;

function isNumeric(key: string, data: DataRecord[] = []) {
  return data.every(
    record =>
      record[key] === null ||
      record[key] === undefined ||
      typeof record[key] === 'number',
  );
}

export default function transformProps(chartProps: ChartProps<QueryFormData>) {
  /**
   * This function is called after a successful response has been
   * received from the chart data endpoint, and is used to transform
   * the incoming data prior to being sent to the Visualization.
   *
   * The transformProps function is also quite useful to return
   * additional/modified props to your data viz component. The formData
   * can also be accessed from your PivotTableChart.tsx file, but
   * doing supplying custom props here is often handy for integrating third
   * party libraries that rely on specific props.
   *
   * A description of properties in `chartProps`:
   * - `height`, `width`: the height/width of the DOM element in which
   *   the chart is located
   * - `formData`: the chart data request payload that was sent to the
   *   backend.
   * - `queriesData`: the chart data response payload that was received
   *   from the backend. Some notable properties of `queriesData`:
   *   - `data`: an array with data, each row with an object mapping
   *     the column/alias to its value. Example:
   *     `[{ col1: 'abc', metric1: 10 }, { col1: 'xyz', metric1: 20 }]`
   *   - `rowcount`: the number of rows in `data`
   *   - `query`: the query that was issued.
   *
   * Please note: the transformProps function gets cached when the
   * application loads. When making changes to the `transformProps`
   * function during development with hot reloading, changes won't
   * be seen until restarting the development server.
   */
  const {
    width,
    height,
    queriesData,
    formData,
    rawFormData,
    hooks: { setDataMask = () => {}, onContextMenu },
    filterState,
    datasource: {
      verboseMap = {},
      columnFormats = {},
      currencyFormats = {},
      columns = [],
    },
    emitCrossFilters,
    theme,
  } = chartProps;
  const { data, colnames, coltypes } = queriesData[0];
  const {
    groupbyRows,
    groupbyColumns,
    metrics,
    tableRenderer,
    colOrder,
    rowOrder,
    aggregateFunction,
    transposePivot,
    combineMetric,
    rowSubtotalPosition,
    colSubtotalPosition,
    colTotals,
    colSubTotals,
    rowTotals,
    rowSubTotals,
    valueFormat,
    dateFormat,
    metricsLayout,
    conditionalFormatting,
    timeGrainSqla,
    currencyFormat,
    allowRenderHtml,
  } = formData;
  const { selectedFilters } = filterState;
  const granularity = extractTimegrain(rawFormData);
  const dhis2PeriodColumns = getDHIS2PeriodColumnNames(columns as any[]);

  const dateFormatters = colnames
    .filter(
      (colname: string, index: number) =>
        coltypes[index] === GenericDataType.Temporal ||
        dhis2PeriodColumns.has(colname),
    )
    .reduce(
      (
        acc: Record<string, DateFormatter | undefined>,
        temporalColname: string,
      ) => {
        let formatter: DateFormatter | undefined;
        if (dhis2PeriodColumns.has(temporalColname)) {
          formatter = (value: unknown) =>
            formatDHIS2Period(String(value ?? ''));
        } else if (dateFormat === SMART_DATE_ID) {
          if (granularity) {
            // time column use formats based on granularity
            formatter = getTimeFormatterForGranularity(granularity);
          } else if (isNumeric(temporalColname, data)) {
            formatter = getTimeFormatter(DATABASE_DATETIME);
          } else {
            // if no column-specific format, print cell as is
            formatter = String;
          }
        } else if (dateFormat) {
          formatter = getTimeFormatter(dateFormat);
        }
        if (formatter) {
          acc[temporalColname] = formatter;
        }
        return acc;
      },
      {},
    );
  // Conditional formatting from the Pivot Table control panel (baseline).
  const conditionalColorFormatters = getColorFormatters(
    conditionalFormatting,
    data,
    theme,
  );

  // ── Custom colour overrides from color_mode / color_breakpoints / metric_colors ──
  //
  // `color_mode` is injected by ControlPanelsContainer into every chart's
  // Customize tab (snake_case in raw formData):
  //   'breakpoints' — value-range colours (ColorBreakpointsControl)
  //   'metric'      — fixed colour per metric series (MetricColorControl)
  //   'default'     — no custom colours; use conditional formatting only
  //   undefined     — legacy: apply breakpoints if present, else metric_colors
  //
  // Each custom formatter has column = metric label (matching the pivot key)
  // and getColorFromValue returning a CSS colour or undefined.
  const colorMode: string | undefined = (formData as any).color_mode;
  const breakpointsRaw: any[] | undefined = (formData as any).color_breakpoints;
  const metricColorsMap: Record<string, string> | undefined = (formData as any).metric_colors;
  const defaultBreakpointColor: any = (formData as any).default_breakpoint_color;

  const hasBreakpoints = Array.isArray(breakpointsRaw) && breakpointsRaw.length > 0;
  const hasMetricColors =
    metricColorsMap != null && Object.keys(metricColorsMap).length > 0;

  // Resolve metric display labels — these match the pivot table's dimension keys.
  const metricLabels: string[] = (formData.metrics ?? []).map((m: any) => {
    try {
      return getMetricLabel(m);
    } catch {
      return String(m);
    }
  });

  let customColorFormatters: ColorFormatters = [];

  const applyBreakpoints =
    colorMode === 'breakpoints' ||
    (colorMode == null && hasBreakpoints);

  const applyMetricColors =
    !applyBreakpoints &&
    (colorMode === 'metric' ||
      (colorMode == null && hasMetricColors));

  if (applyBreakpoints && hasBreakpoints) {
    const hasDefault =
      defaultBreakpointColor != null &&
      typeof defaultBreakpointColor.a === 'number' &&
      defaultBreakpointColor.a > 0;

    customColorFormatters = metricLabels.map(label => ({
      column: label,
      getColorFromValue: (value: number | string) => {
        if (typeof value !== 'number') return undefined;
        const bp = breakpointsRaw!.find(b => matchesBreakpoint(value, b));
        if (bp?.color) {
          return `rgba(${bp.color.r},${bp.color.g},${bp.color.b},1)`;
        }
        if (hasDefault) {
          return `rgba(${defaultBreakpointColor.r},${defaultBreakpointColor.g},${defaultBreakpointColor.b},1)`;
        }
        return undefined;
      },
    }));
  } else if (applyMetricColors && hasMetricColors) {
    customColorFormatters = metricLabels
      .filter(label => metricColorsMap![label])
      .map(label => ({
        column: label,
        // Metric colour is fixed regardless of cell value.
        getColorFromValue: () => metricColorsMap![label],
      }));
  }

  // Merge: custom formatters take priority; conditional formatting fills the rest.
  // When an explicit colorMode is set, suppress conditional formatting so only
  // the selected mode applies. For legacy / default mode, both coexist.
  const metricColorFormatters: ColorFormatters =
    colorMode === 'breakpoints' || colorMode === 'metric'
      ? customColorFormatters
      : [...customColorFormatters, ...conditionalColorFormatters];

  return {
    width,
    height,
    data,
    groupbyRows,
    groupbyColumns,
    metrics,
    tableRenderer,
    colOrder,
    rowOrder,
    aggregateFunction,
    transposePivot,
    combineMetric,
    rowSubtotalPosition,
    colSubtotalPosition,
    colTotals,
    colSubTotals,
    rowTotals,
    rowSubTotals,
    valueFormat,
    currencyFormat,
    emitCrossFilters,
    setDataMask,
    selectedFilters,
    verboseMap,
    columnFormats,
    currencyFormats,
    metricsLayout,
    metricColorFormatters,
    dateFormatters,
    onContextMenu,
    timeGrainSqla,
    allowRenderHtml,
  };
}
