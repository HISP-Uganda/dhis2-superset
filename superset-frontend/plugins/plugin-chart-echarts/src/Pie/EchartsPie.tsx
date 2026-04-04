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
import { useMemo } from 'react';
import {
  CategoricalColorNamespace,
  getNumberFormatter,
  NumberFormats,
  tooltipHtml,
  getMetricLabel,
  getValueFormatter,
} from '@superset-ui/core';
import { PieChartTransformedProps } from './types';
import Echart from '../components/Echart';
import OuDrillWrapper from '../components/OuDrillWrapper';
import { allEventHandlers } from '../utils/eventHandlers';
import { EventHandlers } from '../types';
import { getDefaultTooltip } from '../utils/tooltip';

export default function EchartsPie(props: PieChartTransformedProps) {
  const {
    height,
    width,
    echartOptions,
    selectedValues,
    refs,
    formData,
    drillMeta,
    setDataMask,
    labelMap,
    groupby,
  } = props;

  const hasDrill = drillMeta?.canDrill === true;

  if (!hasDrill) {
    const eventHandlers = allEventHandlers(props);
    return (
      <Echart
        refs={refs}
        height={height}
        width={width}
        echartOptions={echartOptions}
        eventHandlers={eventHandlers}
        selectedValues={selectedValues}
        vizType={formData.vizType}
      />
    );
  }

  return (
    <OuDrillWrapper
      drillMeta={drillMeta}
      formData={formData}
      groupby={groupby}
      labelMap={labelMap}
      width={width}
      height={height}
    >
      {({
        width: innerWidth,
        height: innerHeight,
        drillData,
        drillGroupby,
        onDrillClick,
        isDrilled,
      }) => (
        <DrillablePieEchart
          {...props}
          width={innerWidth}
          height={innerHeight}
          drillData={drillData}
          drillGroupby={drillGroupby}
          onDrillClick={onDrillClick}
          isDrilled={isDrilled}
        />
      )}
    </OuDrillWrapper>
  );
}

interface DrillDataItem {
  name: string;
  value: number;
}

function DrillablePieEchart(
  props: PieChartTransformedProps & {
    onDrillClick?: (name: string) => void;
    drillData?: DrillDataItem[];
    drillGroupby?: string;
    isDrilled: boolean;
  },
) {
  const {
    height,
    width,
    echartOptions: originalOptions,
    selectedValues,
    refs,
    formData,
    onDrillClick,
    drillData,
    isDrilled,
  } = props;

  const baseHandlers = allEventHandlers(props);

  const eventHandlers: EventHandlers = useMemo(() => {
    if (!onDrillClick) return baseHandlers;

    return {
      ...baseHandlers,
      click: (params: { name: string; data?: { isOther?: boolean } }) => {
        // Don't drill into "Other" aggregated slice
        if (params.data?.isOther) return;
        if (params.name) {
          onDrillClick(params.name);
        }
      },
    };
  }, [baseHandlers, onDrillClick]);

  // Build drill-specific ECharts options when drilled
  const echartOptions = useMemo(() => {
    if (!isDrilled || !drillData?.length) return originalOptions;

    const colorScheme = formData.colorScheme;
    const colorFn = CategoricalColorNamespace.getScale(colorScheme as string);
    const metric = formData.metric || formData.metrics?.[0];
    const metricLabel = getMetricLabel(metric);
    const { datasource } = formData;

    const numberFormatter = getValueFormatter(
      metric,
      {},
      {},
      formData.numberFormat,
      formData.currencyFormat,
    );

    const percentFormatter = getNumberFormatter(
      NumberFormats.PERCENT_2_POINT,
    );

    const totalValue = drillData.reduce((sum, d) => sum + d.value, 0);

    const data = drillData.map(item => ({
      value: item.value,
      name: item.name,
      itemStyle: {
        color: colorFn(item.name, formData.sliceId),
        opacity: 1,
      },
    }));

    // Copy the original options but replace the data
    const series = Array.isArray((originalOptions as any).series)
      ? (originalOptions as any).series.map((s: any) => ({
          ...s,
          data,
        }))
      : [{ ...(originalOptions as any).series, data }];

    return {
      ...originalOptions,
      tooltip: {
        ...(originalOptions as any).tooltip,
        formatter: (params: any) => {
          const val = params.value as number;
          const pct = totalValue > 0 ? val / totalValue : 0;
          return tooltipHtml(
            [[metricLabel, numberFormatter(val), percentFormatter(pct)]],
            params.name,
          );
        },
      },
      legend: {
        ...(originalOptions as any).legend,
        data: data.map(d => d.name),
      },
      graphic: formData.showTotal
        ? {
            ...(originalOptions as any).graphic,
            style: {
              ...((originalOptions as any).graphic?.style || {}),
              text: `Total: ${numberFormatter(totalValue)}`,
            },
          }
        : null,
      series,
    };
  }, [isDrilled, drillData, originalOptions, formData]);

  return (
    <Echart
      refs={refs}
      height={height}
      width={width}
      echartOptions={echartOptions}
      eventHandlers={eventHandlers}
      selectedValues={isDrilled ? {} : selectedValues}
      vizType={formData.vizType}
    />
  );
}
