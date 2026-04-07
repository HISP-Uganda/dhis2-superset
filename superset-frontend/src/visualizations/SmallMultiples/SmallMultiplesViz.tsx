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
/* eslint-disable theme-colors/no-literal-colors */
import { useRef, useEffect, useMemo, useCallback } from 'react';
import * as echarts from 'echarts';
import { styled, getNumberFormatter } from '@superset-ui/core';
import {
  SmallMultiplesChartProps,
  PanelData,
  MiniChartType,
} from './types';
import { buildOption, MiniPanelConfig } from './chartOptions';
import SharedLegend from './SharedLegend';
import MiniMapPanel from './MiniMapPanel';
import useDHIS2Boundaries, { buildBoundaryLookup } from './useDHIS2Boundaries';

/* ── Styled components ────────────────────────────────── */

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--pro-font-family, Inter, 'Segoe UI', Roboto, sans-serif);
`;

const ScrollArea = styled.div`
  flex: 1;
  overflow: auto;
`;

interface GridContainerProps {
  $columns: number;
  $gap: number;
}

const GridContainer = styled.div<GridContainerProps>`
  display: grid;
  grid-template-columns: repeat(${({ $columns }) => $columns}, 1fr);
  gap: ${({ $gap }) => $gap}px;
  padding: ${({ $gap }) => $gap}px;
  width: 100%;
  align-content: start;
`;

interface PanelCardProps {
  $padding: number;
  $borderRadius: number;
}

const PanelCard = styled.div<PanelCardProps>`
  background: var(--pro-bg-card);
  border: 1px solid var(--pro-border);
  border-radius: ${({ $borderRadius }) => $borderRadius}px;
  padding: ${({ $padding }) => $padding}px;
  overflow: hidden;
  min-height: 80px;
  display: flex;
  flex-direction: column;
`;

const PanelTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: var(--pro-text-secondary);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PanelSubtitle = styled.div`
  font-size: 10px;
  font-weight: 500;
  color: var(--pro-text-muted);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--pro-text-muted);
  font-size: 14px;
`;

/* ── Big Number panel (no ECharts) ────────────────────── */

const BigNumberPanel = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 4px;
`;

const BigNumberValue = styled.div`
  font-size: 28px;
  font-weight: 700;
  color: var(--pro-navy);
  line-height: 1.1;
`;

const BigNumberLabel = styled.div`
  font-size: 10px;
  font-weight: 500;
  color: var(--pro-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

/* ── Mini EChart panel ────────────────────────────────── */

function MiniPanel({
  panel,
  config,
  chartHeight,
  groupId,
}: {
  panel: PanelData;
  config: MiniPanelConfig;
  chartHeight: number;
  groupId: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const prevChartTypeRef = useRef<MiniChartType | null>(null);

  // Effect 1: create instance on mount, dispose on unmount only
  useEffect(() => {
    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  // Effect 2: update chart options whenever data or config changes
  useEffect(() => {
    if (!chartRef.current) return;

    // When the chart type changes (e.g. line → pie), ECharts cannot always
    // reconfigure the same instance cleanly — dispose and recreate.
    if (
      instanceRef.current &&
      prevChartTypeRef.current !== null &&
      prevChartTypeRef.current !== config.chartType
    ) {
      instanceRef.current.dispose();
      instanceRef.current = null;
    }
    prevChartTypeRef.current = config.chartType;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current);
      if (groupId) {
        echarts.connect(groupId);
      }
    }

    const option = buildOption(panel, config);
    instanceRef.current.setOption(option, {
      notMerge: true,
      replaceMerge: ['series', 'xAxis', 'yAxis', 'visualMap'],
    });
  }, [panel, config, groupId]);

  // Effect 3: resize when dimensions change
  useEffect(() => {
    instanceRef.current?.resize();
  }, [chartHeight]);

  return (
    <div
      ref={chartRef}
      style={{ width: '100%', height: chartHeight, flexShrink: 0 }}
    />
  );
}

/* ── Big Number render ────────────────────────────────── */

function BigNumberMiniPanel({
  panel,
  formatter,
  nullText,
  chartHeight,
}: {
  panel: PanelData;
  formatter: (v: number) => string;
  nullText: string;
  chartHeight: number;
}) {
  const primarySeries = panel.series[0];
  if (!primarySeries) return null;

  const latestVal =
    panel.latestValues[primarySeries.metricLabel];
  const displayVal =
    latestVal != null && Number.isFinite(latestVal)
      ? formatter(latestVal)
      : nullText;

  return (
    <BigNumberPanel style={{ height: chartHeight }}>
      <BigNumberValue style={{ color: primarySeries.color }}>
        {displayVal}
      </BigNumberValue>
      {panel.series.length > 1 &&
        panel.series.slice(1).map(s => {
          const val = panel.latestValues[s.metricLabel];
          return (
            <BigNumberLabel key={s.metricLabel} style={{ color: s.color }}>
              {s.metricLabel}:{' '}
              {val != null && Number.isFinite(val)
                ? formatter(val)
                : nullText}
            </BigNumberLabel>
          );
        })}
      <BigNumberLabel>{primarySeries.metricLabel}</BigNumberLabel>
    </BigNumberPanel>
  );
}

/* ── Main Component ───────────────────────────────────── */

export default function SmallMultiplesViz(props: SmallMultiplesChartProps) {
  const {
    width,
    height,
    panels,
    columns: maxColumns,
    miniChartType,
    syncYAxis,
    showPanelTitle,
    showXAxis,
    showYAxis,
    panelPadding,
    lineWidth,
    globalYMin,
    globalYMax,
    yAxisFormat,
    showReferenceLine,
    referenceValue,
    referenceLineMode,
    referenceColor,
    showPanelSubtitle,
    panelBorderRadius,
    nullValueText,
    showLegend,
    legendPosition,
    syncTooltips,
    responsiveColumns,
    minPanelWidth,
    metricLabels,
    metricColors,
    databaseId,
    boundaryLevel,
    chartId,
    fixedPanelHeight,
    schemeColors,
    linearColors,
  } = props;

  const yFormatter = useMemo(
    () => getNumberFormatter(yAxisFormat),
    [yAxisFormat],
  );

  // mini_map always loads DHIS2 boundaries
  const useDHIS2 = miniChartType === 'mini_map' && !!databaseId;
  // boundaryLevel is now "level:columnName" (e.g. "3:district_city") — extract numeric level
  const blStr = String(boundaryLevel || '');
  const blColonIdx = blStr.indexOf(':');
  const effectiveBoundaryLevel = blColonIdx >= 0
    ? Number(blStr.slice(0, blColonIdx)) || 2
    : Number(boundaryLevel) || 2;
  const {
    features: dhis2Features,
    loading: boundaryLoading,
    error: boundaryError,
  } = useDHIS2Boundaries(
    useDHIS2 ? databaseId : undefined,
    useDHIS2 ? effectiveBoundaryLevel : undefined,
    chartId,
  );

  // Build a name-lookup from DHIS2 boundary features
  const boundaryLookup = useMemo(
    () => (dhis2Features.length > 0 ? buildBoundaryLookup(dhis2Features) : null),
    [dhis2Features],
  );

  // For mini_map: each panel shows ALL boundaries as a full choropleth map.
  // The split dimension creates panels (e.g. by period). Within each panel,
  // xValues are OU names that match boundary names, and series values are the
  // metric values per OU for that split value.
  const enrichedPanels = useMemo(() => {
    if (!boundaryLookup || miniChartType !== 'mini_map') return panels;

    return panels.map(panel => {
      // Build lookup: lowercase OU name → metric value for this panel
      // Use rawXValues (unformatted) for OU name matching against boundaries
      const rawX = panel.rawXValues || panel.xValues;
      const ouValueMap = new Map<string, number>();
      for (let i = 0; i < rawX.length; i++) {
        const ouName = rawX[i].toLowerCase().trim();
        const val = panel.series[0]?.values[i] ?? 0;
        ouValueMap.set(ouName, val);
      }

      // Build GeoJSON with ALL boundaries, colored by this panel's data
      const features: GeoJSON.Feature[] = [];
      for (const [nameKey, feature] of boundaryLookup) {
        const boundaryName = feature.properties?.name || nameKey;
        const val = ouValueMap.get(nameKey) ?? null;
        if (feature.geometry) {
          features.push({
            type: 'Feature' as const,
            geometry: feature.geometry as GeoJSON.Geometry,
            properties: {
              label: boundaryName,
              value: val ?? 0,
              hasData: val !== null,
            },
          });
        }
      }

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features,
      };

      return { ...panel, geojson };
    });
  }, [panels, boundaryLookup, miniChartType]);

  // Stable group ID for tooltip sync
  const groupIdRef = useRef(
    `sm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const groupId = syncTooltips ? groupIdRef.current : '';

  // Responsive columns: auto-reduce based on available width
  const effectiveColumns = useMemo(() => {
    if (!responsiveColumns) return maxColumns;
    const available = width - panelPadding * 2;
    const fitColumns = Math.max(
      1,
      Math.floor(available / minPanelWidth),
    );
    return Math.min(maxColumns, fitColumns);
  }, [width, maxColumns, responsiveColumns, minPanelWidth, panelPadding]);

  // Panel config shared across all mini panels
  const panelConfig: MiniPanelConfig = useMemo(
    () => ({
      chartType: miniChartType,
      syncYMin: syncYAxis ? globalYMin : undefined,
      syncYMax: syncYAxis ? globalYMax : undefined,
      showXAxis,
      showYAxis,
      lineWidth,
      yAxisFormat,
      yFormatter,
      referenceValue: showReferenceLine ? referenceValue : null,
      referenceColor,
      schemeColors: schemeColors || [],
      linearColors: linearColors || [],
    }),
    [
      miniChartType,
      syncYAxis,
      globalYMin,
      globalYMax,
      showXAxis,
      showYAxis,
      lineWidth,
      yAxisFormat,
      yFormatter,
      showReferenceLine,
      referenceValue,
      referenceColor,
      schemeColors,
      linearColors,
    ],
  );

  // Calculate panel chart height
  const legendHeight = showLegend && metricLabels.length > 1 ? 32 : 0;
  const availableHeight = height - legendHeight;
  const rows = Math.ceil(panels.length / effectiveColumns);
  const autoPanelHeight = Math.max(
    60,
    (availableHeight - panelPadding * (rows + 1)) / rows -
      (showPanelTitle ? 18 : 0) -
      (showPanelSubtitle ? 14 : 0) -
      panelPadding * 2,
  );
  const panelHeight = fixedPanelHeight && fixedPanelHeight > 0
    ? fixedPanelHeight
    : autoPanelHeight;

  // Build subtitle text
  const getSubtitle = useCallback(
    (panel: PanelData): string => {
      const parts = metricLabels.map((ml: string) => {
        const val = panel.latestValues[ml];
        if (val == null || !Number.isFinite(val)) return `${ml}: ${nullValueText}`;
        return `${ml}: ${yFormatter(val)}`;
      });
      return parts.join('  ·  ');
    },
    [metricLabels, nullValueText, yFormatter],
  );

  // Legend items
  const legendItems = useMemo(
    () =>
      metricLabels.map((label: string, i: number) => ({
        label,
        color: metricColors[i],
      })),
    [metricLabels, metricColors],
  );

  if (!panels || panels.length === 0) {
    return (
      <Wrapper style={{ width, height }}>
        <EmptyState>No data to display</EmptyState>
      </Wrapper>
    );
  }

  const isBigNumber = miniChartType === 'big_number';
  const isMiniMap = miniChartType === 'mini_map';
  const activePanels = isMiniMap ? enrichedPanels : panels;

  const renderPanelContent = (panel: PanelData) => {
    if (isBigNumber) {
      return (
        <BigNumberMiniPanel
          panel={panel}
          formatter={yFormatter}
          nullText={nullValueText}
          chartHeight={panelHeight}
        />
      );
    }
    if (isMiniMap) {
      if (!databaseId) {
        return (
          <EmptyState style={{ height: panelHeight, fontSize: 11 }}>
            No DHIS2 source database found
          </EmptyState>
        );
      }
      if (boundaryLoading) {
        return (
          <EmptyState style={{ height: panelHeight, fontSize: 11 }}>
            Loading boundaries…
          </EmptyState>
        );
      }
      if (boundaryError && !panel.geojson?.features?.length) {
        return (
          <EmptyState style={{ height: panelHeight, fontSize: 11 }}>
            {boundaryError}
          </EmptyState>
        );
      }
      return (
        <MiniMapPanel
          panel={panel}
          chartHeight={panelHeight}
          linearColors={linearColors}
          formatter={yFormatter}
          nullText={nullValueText}
        />
      );
    }
    return (
      <MiniPanel
        panel={panel}
        config={panelConfig}
        chartHeight={panelHeight}
        groupId={groupId}
      />
    );
  };

  return (
    <Wrapper style={{ width, height }}>
      <ScrollArea>
        <GridContainer $columns={effectiveColumns} $gap={panelPadding}>
          {activePanels.map(panel => (
            <PanelCard
              key={panel.title}
              $padding={panelPadding}
              $borderRadius={panelBorderRadius}
            >
              {showPanelTitle && <PanelTitle>{panel.title}</PanelTitle>}
              {showPanelSubtitle && (
                <PanelSubtitle>{getSubtitle(panel)}</PanelSubtitle>
              )}
              {renderPanelContent(panel)}
            </PanelCard>
          ))}
        </GridContainer>
      </ScrollArea>
      {showLegend && (
        <SharedLegend items={legendItems} position="bottom" />
      )}
    </Wrapper>
  );
}
