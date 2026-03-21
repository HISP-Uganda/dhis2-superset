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

import { useState, useEffect } from 'react';
import { styled, t, SupersetClient } from '@superset-ui/core';
import { Tabs, Empty, Spin, Button } from 'antd';
import { Icons } from '@superset-ui/core/components/Icons';
import PublicChartRenderer from './PublicChartRenderer';
import EmbeddedDashboard from './EmbeddedDashboard';
import EmbeddingManager from './EmbeddingManager';

const embeddedDashboardUuidCache = new Map<number, string | null>();

export function clearEmbeddedDashboardUuidCache() {
  embeddedDashboardUuidCache.clear();
}

const ContentContainer = styled.div`
  ${({ theme }) => `
    margin-left: 0;
    padding: 0;
    background: ${theme.colorBgLayout};
    min-height: calc(100vh - 60px);
    max-width: 100%;
    width: 100%;

    @media (max-width: 768px) {
      margin-left: 0;
      padding: 0;
    }
  `}
`;

const EmbeddingSection = styled.div`
  ${({ theme }) => `
    margin-bottom: ${theme.sizeUnit * 6}px;
    padding: ${theme.sizeUnit * 4}px;
    background: ${theme.colorBgContainer};
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadiusLG}px;
  `}
`;

const StyledTabs = styled(Tabs)`
  ${({ theme }) => `
    .ant-tabs-nav {
      margin-bottom: ${theme.sizeUnit * 4}px;

      &::before {
        border-bottom: 2px solid ${theme.colorBorderSecondary};
      }
    }

    .ant-tabs-tab {
      font-size: 15px;
      font-weight: 500;
      padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px;
      color: ${theme.colorTextSecondary};

      &:hover {
        color: ${theme.colorPrimary};
      }

      &.ant-tabs-tab-active .ant-tabs-tab-btn {
        color: ${theme.colorPrimary};
        font-weight: 600;
      }
    }

    .ant-tabs-ink-bar {
      background: ${theme.colorPrimary};
      height: 3px;
    }
  `}
`;

const ChartGrid = styled.div`
  ${({ theme }) => `
    display: grid;
    /* Use 12-column grid like dashboard */
    grid-template-columns: repeat(12, 1fr);
    gap: ${theme.sizeUnit * 4}px;
    margin-bottom: ${theme.sizeUnit * 6}px;
    margin-top: ${theme.sizeUnit * 4}px;

    @media (max-width: 1200px) {
      /* On smaller screens, use 6-column grid */
      grid-template-columns: repeat(6, 1fr);
    }

    @media (max-width: 768px) {
      /* On mobile, single column */
      grid-template-columns: 1fr;
    }
  `}
`;

const EmptyStateContainer = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 12}px 0;
    text-align: center;
  `}
`;

const ViewMoreButton = styled(Button)`
  ${({ theme }) => `
    width: 100%;
    height: 56px;
    font-size: 16px;
    font-weight: 500;
    margin-top: ${theme.sizeUnit * 6}px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${theme.sizeUnit * 2}px;

    .anticon {
      font-size: 20px;
    }
  `}
`;

const ChartPreviewContainer = styled.div<{
  gridWidth?: number;
  gridHeight?: number;
}>`
  ${({ theme, gridWidth = 6, gridHeight = 40 }) => `
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadiusLG}px;
    overflow: hidden;
    background: ${theme.colorBgContainer};

    /* Use dashboard dimensions */
    grid-column: span ${Math.min(12, Math.max(1, gridWidth))};
    height: ${Math.max(300, Math.min(800, gridHeight * 10))}px;

    @media (max-width: 1200px) {
      /* On smaller screens with 6-column grid, scale width proportionally */
      grid-column: span ${Math.min(6, Math.ceil(gridWidth / 2))};
    }

    @media (max-width: 768px) {
      /* On mobile, always full width */
      grid-column: span 1;
      height: ${Math.max(300, Math.min(500, gridHeight * 8))}px;
    }
  `}
`;

interface Dashboard {
  id: number;
  dashboard_title: string;
  slug: string;
  url: string;
  // Prefer UUIDs when available (see UUID Migration guidelines)
  uuid?: string;
}

interface Category {
  key: string;
  label: string;
  chartIds: number[];
}

interface ChartDimensions {
  chartId: number;
  width: number; // Grid units (out of 12)
  height: number; // Pixels
}

interface ChartItem {
  id: number;
  slice_name: string;
  description: string;
  thumbnail_url?: string;
  url: string;
  viz_type: string;
  is_public?: boolean; // FR-2.1: Chart-level public access flag
  tags?: Array<{ id: number; name: string; type: string }>;
}

interface DashboardContentAreaProps {
  selectedDashboard: Dashboard;
  isPublic?: boolean;
  useEmbeddedSDK?: boolean;
  showEmbeddingManager?: boolean;
}

interface DashboardLayout {
  [key: string]: {
    id: string;
    type: string;
    meta?: {
      text?: string;
    };
    children?: string[];
  };
}

// Default fallback categories if dashboard has no tabs
const DEFAULT_CATEGORIES: Category[] = [
  { key: 'all', label: 'All Charts', chartIds: [] },
];

function parseDashboardLayout(positionData: unknown): DashboardLayout {
  if (!positionData) {
    return {};
  }

  if (typeof positionData === 'string') {
    try {
      return JSON.parse(positionData) as DashboardLayout;
    } catch {
      return {};
    }
  }

  return positionData as DashboardLayout;
}

// Extract tabs and their chart IDs from dashboard layout
function extractTabsFromLayout(positionData: DashboardLayout): Category[] {
  const categories: Category[] = [];

  // Find TABS components in the layout
  Object.entries(positionData).forEach(([, component]) => {
    if (component.type === 'TABS') {
      const tabChildren = component.children || [];

      tabChildren.forEach(tabId => {
        const tabComponent = positionData[tabId];

        if (tabComponent && tabComponent.type === 'TAB') {
          const tabName = tabComponent.meta?.text || 'Untitled Tab';
          const chartIds = extractChartIdsFromComponent(
            tabComponent,
            positionData,
          );

          categories.push({
            key: tabId,
            label: tabName,
            chartIds,
          });
        }
      });
    }
  });
  return categories;
}

// Extract chart dimensions from position_json
function extractChartDimensions(
  positionData: DashboardLayout,
): Map<number, ChartDimensions> {
  const dimensions = new Map<number, ChartDimensions>();

  Object.entries(positionData).forEach(([key, component]) => {
    if (component.type === 'CHART') {
      const meta = component.meta as any;
      const chartId = meta?.chartId || meta?.sliceId || meta?.slice_id;

      if (chartId) {
        // Dashboard uses a grid system:
        // - width: grid columns (out of 12)
        // - height: grid rows (each row is ~GRID_BASE_UNIT pixels, typically 10px)
        dimensions.set(chartId, {
          chartId,
          width: meta?.width || 6, // Default to half width
          height: meta?.height || 50, // Default to 500px (50 * 10)
        });
      }
    }
  });

  return dimensions;
}

// Recursively extract chart IDs from a component and its children
function extractChartIdsFromComponent(
  component: DashboardLayout[string],
  layout: DashboardLayout,
): number[] {
  const chartIds: number[] = [];

  if (component.type === 'CHART') {
    // Try different possible fields for chart ID
    const meta = component.meta as any;
    const sliceId = meta?.chartId || meta?.sliceId || meta?.slice_id;

    if (sliceId) {
      chartIds.push(sliceId);
    }
  }

  // Recursively check children
  if (component.children) {
    component.children.forEach(childId => {
      const childComponent = layout[childId];
      if (childComponent) {
        chartIds.push(...extractChartIdsFromComponent(childComponent, layout));
      }
    });
  }

  return chartIds;
}

export default function DashboardContentArea({
  selectedDashboard,
  isPublic = false,
  useEmbeddedSDK = true,
  showEmbeddingManager = false,
}: DashboardContentAreaProps) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [allCharts, setAllCharts] = useState<ChartItem[]>([]);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [chartsToDisplay, setChartsToDisplay] = useState(10); // Load 10 initially for all users
  const [chartDimensions, setChartDimensions] = useState<
    Map<number, ChartDimensions>
  >(new Map());
  // Fetched embedded dashboard UUID to use with Embedded SDK
  const [embeddedUuid, setEmbeddedUuid] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedDashboard) {
      setAllCharts([]);
      setCategories(DEFAULT_CATEGORIES);
      setActiveCategory('all');
      setChartDimensions(new Map());
      setEmbeddedUuid(null);
      setLoading(false);
      return undefined;
    }

    let isActive = true;
    const controller = new AbortController();

    const resetDashboardState = () => {
      setLoading(true);
      setChartsToDisplay(10);
      setAllCharts([]);
      setCategories(DEFAULT_CATEGORIES);
      setActiveCategory('all');
      setChartDimensions(new Map());
      setEmbeddedUuid(null);
    };

    const fetchEmbeddedDashboard = async () => {
      resetDashboardState();
      const cachedEmbeddedUuid = embeddedDashboardUuidCache.get(
        selectedDashboard.id,
      );
      if (cachedEmbeddedUuid !== undefined) {
        setEmbeddedUuid(cachedEmbeddedUuid);
        setLoading(false);
        return;
      }
      try {
        const embeddedResponse = await SupersetClient.get({
          endpoint: `/api/v1/dashboard/${selectedDashboard.id}/embedded`,
          signal: controller.signal,
        });

        if (!isActive || controller.signal.aborted) {
          return;
        }

        const embeddedConfig = embeddedResponse.json.result;
        const nextEmbeddedUuid = embeddedConfig?.uuid || null;
        embeddedDashboardUuidCache.set(selectedDashboard.id, nextEmbeddedUuid);
        setEmbeddedUuid(nextEmbeddedUuid);
      } catch {
        if (!isActive || controller.signal.aborted) {
          return;
        }
        embeddedDashboardUuidCache.set(selectedDashboard.id, null);
        setEmbeddedUuid(null);
      } finally {
        if (isActive && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    const fetchChartPreviewData = async () => {
      resetDashboardState();
      try {
        const dashboardEndpoint = isPublic
          ? `/api/v1/dashboard/public/${selectedDashboard.id}`
          : `/api/v1/dashboard/${selectedDashboard.id}`;
        const chartsEndpoint = isPublic
          ? `/api/v1/chart/public/?dashboard_id=${selectedDashboard.id}`
          : `/api/v1/chart/dashboard/${selectedDashboard.id}/charts`;

        const [dashboardResponse, chartsResponse] = await Promise.all([
          SupersetClient.get({
            endpoint: dashboardEndpoint,
            signal: controller.signal,
          }),
          SupersetClient.get({
            endpoint: chartsEndpoint,
            signal: controller.signal,
          }),
        ]);

        if (!isActive || controller.signal.aborted) {
          return;
        }

        const layout = parseDashboardLayout(
          dashboardResponse.json.result?.position_json,
        );
        const extractedCategories = extractTabsFromLayout(layout);
        const dimensions = extractChartDimensions(layout);
        const nextCategories =
          extractedCategories.length > 0
            ? extractedCategories
            : DEFAULT_CATEGORIES;

        setChartDimensions(dimensions);
        setCategories(nextCategories);
        setActiveCategory(nextCategories[0]?.key || 'all');
        setAllCharts(chartsResponse.json.result || []);
      } catch (error) {
        if (!isActive || controller.signal.aborted) {
          return;
        }
        console.error('Error fetching dashboard data:', error);
        setAllCharts([]);
        setCategories(DEFAULT_CATEGORIES);
        setActiveCategory('all');
        setChartDimensions(new Map());
      } finally {
        if (isActive && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    if (useEmbeddedSDK) {
      fetchEmbeddedDashboard();
    } else {
      fetchChartPreviewData();
    }

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [isPublic, selectedDashboard?.id, useEmbeddedSDK]);

  // Filter charts by active category
  const getChartsForCategory = (categoryKey: string): ChartItem[] => {
    const currentCategory = categories.find(cat => cat.key === categoryKey);

    // If no current category found, return all charts as fallback
    if (!currentCategory) {
      return allCharts;
    }

    // If it's the default "all" category
    if (categoryKey === 'all') {
      // If we have chart IDs from position_json, use them
      if (currentCategory.chartIds.length > 0) {
        return allCharts.filter(chart =>
          currentCategory.chartIds.includes(chart.id),
        );
      }
      // Otherwise collect all chart IDs from all categories (tabs)
      const allChartIds = new Set<number>();
      categories.forEach(cat => {
        cat.chartIds.forEach(id => allChartIds.add(id));
      });
      // If we found chart IDs in tabs, use them; otherwise show all charts
      if (allChartIds.size > 0) {
        return allCharts.filter(chart => allChartIds.has(chart.id));
      }
      return allCharts;
    }

    // Filter charts based on the category's chart IDs from position_json
    // If no chart IDs specified for this category, return all charts as fallback
    if (currentCategory.chartIds.length === 0) {
      return allCharts;
    }
    return allCharts.filter(chart =>
      currentCategory.chartIds.includes(chart.id),
    );
  };

  const allChartsForCategory = getChartsForCategory(activeCategory);
  const charts = allChartsForCategory.slice(0, chartsToDisplay);
  const hasMoreCharts = allChartsForCategory.length > chartsToDisplay;

  const handleLoadMore = () => {
    // Load 5 more charts at a time for all users
    setChartsToDisplay(prev => prev + 5);
  };

  const handleEmbeddingEnabled = (uuid: string) => {
    embeddedDashboardUuidCache.set(selectedDashboard.id, uuid);
    setEmbeddedUuid(uuid);
  };

  const handleEmbeddingDisabled = () => {
    embeddedDashboardUuidCache.set(selectedDashboard.id, null);
    setEmbeddedUuid(null);
  };

  const renderTabContent = () => {
    if (loading) {
      return (
        <EmptyStateContainer>
          <Spin size="large" />
        </EmptyStateContainer>
      );
    }

    if (charts.length === 0) {
      return (
        <EmptyStateContainer>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span>{t('No charts in this category yet.')}</span>}
          />
        </EmptyStateContainer>
      );
    }

    return (
      <>
        <ChartGrid>
          {charts.map((chart: ChartItem) => {
            // Get dimensions for this chart from dashboard layout
            const dimensions = chartDimensions.get(chart.id);
            const gridWidth = dimensions?.width || 6;
            const gridHeight = dimensions?.height || 40;

            return (
              <ChartPreviewContainer
                key={chart.id}
                gridWidth={gridWidth}
                gridHeight={gridHeight}
              >
                <PublicChartRenderer
                  chartId={chart.id}
                  chartName={chart.slice_name}
                  isPublic={chart.is_public || false}
                />
              </ChartPreviewContainer>
            );
          })}
        </ChartGrid>

        {hasMoreCharts && (
          <ViewMoreButton
            type="primary"
            size="large"
            icon={<Icons.PlusOutlined />}
            onClick={handleLoadMore}
          >
            {t('Load 5 More Charts')} (
            {allChartsForCategory.length - chartsToDisplay} {t('remaining')})
          </ViewMoreButton>
        )}
      </>
    );
  };

  const tabItems = categories.map(category => ({
    key: category.key,
    label: category.label,
    children: renderTabContent(),
  }));

  if (!selectedDashboard) {
    return (
      <ContentContainer>
        <EmptyStateContainer>
          <Spin size="large" tip={t('Loading dashboard...')} />
        </EmptyStateContainer>
      </ContentContainer>
    );
  }

  // Use embedded SDK for full dashboard with native filters
  if (useEmbeddedSDK) {
    return (
      <ContentContainer>
        {showEmbeddingManager && (
          <EmbeddingSection>
            <EmbeddingManager
              dashboardId={selectedDashboard.id}
              dashboardTitle={selectedDashboard.dashboard_title}
              embeddedUuid={embeddedUuid}
              onEmbeddingEnabled={handleEmbeddingEnabled}
              onEmbeddingDisabled={handleEmbeddingDisabled}
            />
          </EmbeddingSection>
        )}

        {loading ? (
          <EmptyStateContainer>
            <Spin size="large" tip={t('Loading dashboard...')} />
          </EmptyStateContainer>
        ) : !embeddedUuid ? (
          <EmptyStateContainer>
            <Empty
              description={
                showEmbeddingManager
                  ? t(
                      'This dashboard is not configured for embedding. Please enable embedding using the controls above.',
                    )
                  : t(
                      'This dashboard is not available for public viewing. Please contact your administrator.',
                    )
              }
            />
          </EmptyStateContainer>
        ) : (
          <EmbeddedDashboard dashboardId={embeddedUuid} />
        )}
      </ContentContainer>
    );
  }

  // Legacy mode: individual chart rendering with tabs
  return (
    <ContentContainer>
      <StyledTabs
        activeKey={activeCategory}
        onChange={setActiveCategory}
        items={tabItems}
      />
    </ContentContainer>
  );
}
