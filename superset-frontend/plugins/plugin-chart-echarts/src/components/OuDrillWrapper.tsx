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
import { useCallback, useMemo, useState } from 'react';
import {
  styled,
  SupersetClient,
  QueryFormColumn,
  DataRecord,
  getColumnLabel,
  getMetricLabel,
  buildQueryContext,
} from '@superset-ui/core';
import DrillBreadcrumbs from './DrillBreadcrumbs';
import {
  OuLevelDefinition,
  OuDrillState,
  findOuGroupbyColumn,
  getChildLevel,
  buildDrillState,
  drillUp,
  applyDrillToFormData,
} from '../utils/ouDrillDown';

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
`;

const ChartArea = styled.div`
  flex: 1;
  min-height: 0;
  position: relative;
`;

const LoadingOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.6);
  z-index: 1;
  font-size: 13px;
  color: ${({ theme }) => theme.colorTextSecondary};
`;

export interface OuDrillMeta {
  ouLevels: OuLevelDefinition[];
  currentOuLevel?: OuLevelDefinition;
  childOuLevel?: OuLevelDefinition;
  canDrill: boolean;
  /** The original OU column in the chart's groupby (before any drill) */
  originalOuColumn?: string;
}

interface DrillDataItem {
  name: string;
  value: number;
}

const BREADCRUMB_HEIGHT = 28;

interface OuDrillWrapperProps {
  drillMeta: OuDrillMeta;
  formData: Record<string, any>;
  groupby: QueryFormColumn[];
  labelMap: Record<string, string[]>;
  width: number;
  height: number;
  children: (props: {
    width: number;
    height: number;
    /** Drill data to render instead of original. undefined = use original */
    drillData?: DrillDataItem[];
    /** Column name being grouped by in drill view */
    drillGroupby?: string;
    /** Custom click handler for drill; undefined if drill not available */
    onDrillClick?: (name: string) => void;
    isDrilled: boolean;
  }) => React.ReactNode;
}

export default function OuDrillWrapper({
  drillMeta,
  formData,
  groupby,
  labelMap,
  width,
  height,
  children,
}: OuDrillWrapperProps) {
  const { ouLevels, currentOuLevel, originalOuColumn } = drillMeta;

  const [drillState, setDrillState] = useState<OuDrillState | undefined>();
  const [drillData, setDrillData] = useState<DrillDataItem[] | undefined>();
  const [loading, setLoading] = useState(false);

  // Resolve effective levels based on current drill state
  const effectiveCurrentLevel = useMemo(() => {
    if (drillState?.active) {
      return ouLevels.find(l => l.level === drillState.currentLevel);
    }
    return currentOuLevel;
  }, [drillState, ouLevels, currentOuLevel]);

  const effectiveChildLevel = useMemo(() => {
    if (effectiveCurrentLevel) {
      return getChildLevel(effectiveCurrentLevel.level, ouLevels);
    }
    return undefined;
  }, [effectiveCurrentLevel, ouLevels]);

  const fetchDrilledData = useCallback(
    async (drill: OuDrillState) => {
      if (!originalOuColumn) return;

      setLoading(true);
      try {
        // Build a modified formData with the drill column swap + filter
        const drilledFormData = applyDrillToFormData(
          formData,
          drill,
          originalOuColumn,
        );

        // Use the metric from formData
        const metric = formData.metric || (formData.metrics?.[0]);
        const metricLabel = getMetricLabel(metric);

        // Build the query payload
        const payload = buildQueryContext(
          {
            ...drilledFormData,
            result_format: 'json',
            result_type: 'full',
          } as any,
          baseQueryObject => [
            {
              ...baseQueryObject,
              post_processing: [],
            },
          ],
        );

        const response = await SupersetClient.post({
          endpoint: '/api/v1/chart/data',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          parseMethod: 'json',
        });

        const result = (response?.json as any)?.result?.[0];
        const rawData: DataRecord[] = result?.data || [];

        // Extract name (drill column) and value (metric) from each row
        const drillColumn = drill.currentColumn;
        const items: DrillDataItem[] = rawData
          .map(row => ({
            name: String(row[drillColumn] ?? ''),
            value: Number(row[metricLabel] ?? 0),
          }))
          .filter(item => item.name && item.value !== 0)
          .sort((a, b) => b.value - a.value);

        setDrillData(items);
      } catch (err) {
        console.error('OU drill-down fetch failed:', err);
        setDrillData(undefined);
      } finally {
        setLoading(false);
      }
    },
    [formData, originalOuColumn],
  );

  const handleDrillClick = useCallback(
    (name: string) => {
      if (!effectiveCurrentLevel || !effectiveChildLevel) return;

      const newDrill = buildDrillState(
        name,
        effectiveCurrentLevel,
        effectiveChildLevel,
        drillState,
      );

      setDrillState(newDrill);
      fetchDrilledData(newDrill);
    },
    [
      effectiveCurrentLevel,
      effectiveChildLevel,
      drillState,
      fetchDrilledData,
    ],
  );

  const handleNavigate = useCallback(
    (breadcrumbIndex: number) => {
      if (breadcrumbIndex < 0) {
        // Reset to top level
        setDrillState(undefined);
        setDrillData(undefined);
        return;
      }

      if (!drillState) return;
      const newState = drillUp(drillState, breadcrumbIndex, ouLevels);
      if (newState) {
        setDrillState(newState);
        fetchDrilledData(newState);
      } else {
        setDrillState(undefined);
        setDrillData(undefined);
      }
    },
    [drillState, ouLevels, fetchDrilledData],
  );

  const isDrilled = drillState?.active === true;
  const chartHeight = isDrilled ? height - BREADCRUMB_HEIGHT : height;
  const canDrillFurther = !!effectiveChildLevel;

  return (
    <Wrapper>
      {isDrilled && drillState && (
        <DrillBreadcrumbs
          breadcrumbs={drillState.breadcrumbs}
          currentLevelLabel={effectiveCurrentLevel?.label || ''}
          onNavigate={handleNavigate}
          topLevelLabel={currentOuLevel?.label}
        />
      )}
      <ChartArea>
        {loading && <LoadingOverlay>Loading...</LoadingOverlay>}
        {children({
          width,
          height: chartHeight,
          drillData: isDrilled ? drillData : undefined,
          drillGroupby: isDrilled ? drillState?.currentColumn : undefined,
          onDrillClick: canDrillFurther ? handleDrillClick : undefined,
          isDrilled,
        })}
      </ChartArea>
    </Wrapper>
  );
}
