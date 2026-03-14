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
import { useState, useEffect, useCallback, useMemo } from 'react';
import { styled, t, SupersetClient } from '@superset-ui/core';
import Tabs from '@superset-ui/core/components/Tabs';
import { Loading, Typography, Empty } from '@superset-ui/core/components';
// eslint-disable-next-line no-restricted-imports
import { Tag, Badge, Checkbox, Input, Select } from 'antd';

const { Search } = Input;
const { Text } = Typography;

interface DHIS2Dimension {
  id: string;
  displayName: string;
  type:
    | 'dataElement'
    | 'indicator'
    | 'programIndicator'
    | 'dataSet'
    | 'program'
    | 'trackedEntityType';
  category?: string;
  group?: string;
  groupId?: string;
}

interface DHIS2Group {
  id: string;
  displayName: string;
}

// Endpoints that use tracker-style selectors (programs instead of data elements)
const TRACKER_ENDPOINTS = ['events', 'enrollments', 'trackedEntityInstances'];

interface DxSelectorProps {
  databaseId: number;
  endpoint: string;
  value: string[];
  onChange: (selectedIds: string[]) => void;
  onDimensionsLoad?: (dimensions: DHIS2Dimension[]) => void;
}

const Container = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    background: ${theme.colorBgContainer};
  `}
`;

const TabContent = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 2}px;
    min-height: 350px;
  `}
`;

const FilterSection = styled.div`
  ${({ theme }) => `
    display: flex;
    gap: ${theme.sizeUnit * 2}px;
    margin-bottom: ${theme.sizeUnit * 2}px;
    flex-wrap: wrap;
    align-items: center;
  `}
`;

const ListContainer = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    max-height: 280px;
    overflow-y: auto;
    background: ${theme.colorBgContainer};
  `}
`;

const ListItem = styled.div<{ selected?: boolean }>`
  ${({ theme, selected }) => `
    padding: ${theme.sizeUnit}px ${theme.sizeUnit * 2}px;
    display: flex;
    align-items: center;
    gap: ${theme.sizeUnit}px;
    cursor: pointer;
    border-bottom: 1px solid ${theme.colorBorderSecondary};
    background: ${selected ? theme.colorPrimaryBg : 'transparent'};
    
    &:hover {
      background: ${theme.colorBgTextHover};
    }
    
    &:last-child {
      border-bottom: none;
    }
  `}
`;

const SelectedSection = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 2}px;
    border-top: 1px solid ${theme.colorBorder};
    background: ${theme.colorBgLayout};
    max-height: 150px;
    overflow-y: auto;
  `}
`;

const SelectedHeader = styled.div`
  ${({ theme }) => `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: ${theme.sizeUnit}px;
  `}
`;

const SelectedTags = styled.div`
  ${({ theme }) => `
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.sizeUnit}px;
  `}
`;

const EmptyContainer = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 4}px;
    text-align: center;
  `}
`;

const LoadingContainer = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 4}px;
    text-align: center;
  `}
`;

const ItemDetails = styled.div`
  flex: 1;
  min-width: 0;
`;

const ItemName = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ItemMeta = styled.div`
  ${({ theme }) => `
    font-size: 11px;
    color: ${theme.colorTextSecondary};
  `}
`;

/**
 * DHIS2-style Data Dimension (dx) Selector
 * Provides tabbed interface for selecting:
 * - For aggregate endpoints (analytics, dataValueSets):
 *   - Data Elements (with group filtering)
 *   - Indicators (with group filtering)
 *   - Program Indicators
 *   - Data Sets (Reporting Rates)
 * - For tracker endpoints (events, enrollments, trackedEntityInstances):
 *   - Programs
 *   - Tracked Entity Types
 */
export const DxSelector: React.FC<DxSelectorProps> = ({
  databaseId,
  endpoint,
  value = [],
  onChange,
  onDimensionsLoad,
}) => {
  // Determine if this is a tracker endpoint
  const isTrackerEndpoint = TRACKER_ENDPOINTS.includes(endpoint);

  const [activeTab, setActiveTab] = useState<string>(
    isTrackerEndpoint ? 'programs' : 'dataElements',
  );
  const [loading, setLoading] = useState(false);

  // Data stores for each dimension type - Aggregate
  const [dataElements, setDataElements] = useState<DHIS2Dimension[]>([]);
  const [indicators, setIndicators] = useState<DHIS2Dimension[]>([]);
  const [programIndicators, setProgramIndicators] = useState<DHIS2Dimension[]>(
    [],
  );
  const [dataSets, setDataSets] = useState<DHIS2Dimension[]>([]);

  // Data stores for Tracker
  const [programs, setPrograms] = useState<DHIS2Dimension[]>([]);
  const [trackedEntityTypes, setTrackedEntityTypes] = useState<
    DHIS2Dimension[]
  >([]);

  // Groups for filtering
  const [dataElementGroups, setDataElementGroups] = useState<DHIS2Group[]>([]);
  const [indicatorGroups, setIndicatorGroups] = useState<DHIS2Group[]>([]);

  // Filter states
  const [selectedDataElementGroup, setSelectedDataElementGroup] = useState<
    string | undefined
  >(undefined);
  const [selectedIndicatorGroup, setSelectedIndicatorGroup] = useState<
    string | undefined
  >(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(
    null,
  );

  // All loaded dimensions for reference
  const allDimensions = useMemo(
    () => [
      ...dataElements,
      ...indicators,
      ...programIndicators,
      ...dataSets,
      ...programs,
      ...trackedEntityTypes,
    ],
    [
      dataElements,
      indicators,
      programIndicators,
      dataSets,
      programs,
      trackedEntityTypes,
    ],
  );

  // Notify parent when dimensions load
  useEffect(() => {
    if (onDimensionsLoad && allDimensions.length > 0) {
      // Use queueMicrotask to defer state updates to avoid "Cannot update component while rendering" warning
      queueMicrotask(() => {
        onDimensionsLoad(allDimensions);
      });
    }
  }, [allDimensions, onDimensionsLoad]);

  // Fetch groups on mount
  useEffect(() => {
    const fetchGroups = async () => {
      if (!databaseId) return;

      try {
        // Fetch data element groups
        const deGroupsResponse = await SupersetClient.get({
          endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=dataElementGroups&staged=true`,
        });
        if (deGroupsResponse.json?.result) {
          setDataElementGroups(deGroupsResponse.json.result);
        }
      } catch (error) {
        // Groups endpoint may not exist, continue without groups
      }

      try {
        // Fetch indicator groups
        const indGroupsResponse = await SupersetClient.get({
          endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=indicatorGroups&staged=true`,
        });
        if (indGroupsResponse.json?.result) {
          setIndicatorGroups(indGroupsResponse.json.result);
        }
      } catch (error) {
        // Groups endpoint may not exist, continue without groups
      }
    };

    fetchGroups();
  }, [databaseId]);

  // Fetch data elements
  const fetchDataElements = useCallback(
    async (search?: string, groupId?: string) => {
      if (!databaseId) return;

      setLoading(true);
      try {
        let url = `/api/v1/database/${databaseId}/dhis2_metadata/?type=dataElements&table=${endpoint}&staged=true`;
        if (groupId) {
          url += `&group=${groupId}`;
        }
        if (search && search.length >= 2) {
          url += `&search=${encodeURIComponent(search)}`;
        }

        const response = await SupersetClient.get({ endpoint: url });
        if (response.json?.result) {
          setDataElements(
            response.json.result.map((item: DHIS2Dimension) => ({
              ...item,
              type: 'dataElement' as const,
            })),
          );
        }
      } catch (error) {
        setDataElements([]);
      } finally {
        setLoading(false);
      }
    },
    [databaseId, endpoint],
  );

  // Fetch indicators
  const fetchIndicators = useCallback(
    async (search?: string, groupId?: string) => {
      if (!databaseId) return;

      setLoading(true);
      try {
        let url = `/api/v1/database/${databaseId}/dhis2_metadata/?type=indicators&staged=true`;
        if (groupId) {
          url += `&group=${groupId}`;
        }
        if (search && search.length >= 2) {
          url += `&search=${encodeURIComponent(search)}`;
        }

        const response = await SupersetClient.get({ endpoint: url });
        if (response.json?.result) {
          setIndicators(
            response.json.result.map((item: DHIS2Dimension) => ({
              ...item,
              type: 'indicator' as const,
            })),
          );
        }
      } catch (error) {
        setIndicators([]);
      } finally {
        setLoading(false);
      }
    },
    [databaseId],
  );

  // Fetch program indicators
  const fetchProgramIndicators = useCallback(
    async (search?: string) => {
      if (!databaseId) return;

      setLoading(true);
      try {
        let url = `/api/v1/database/${databaseId}/dhis2_metadata/?type=programIndicators&staged=true`;
        if (search && search.length >= 2) {
          url += `&search=${encodeURIComponent(search)}`;
        }

        const response = await SupersetClient.get({ endpoint: url });
        if (response.json?.result) {
          setProgramIndicators(
            response.json.result.map((item: DHIS2Dimension) => ({
              ...item,
              type: 'programIndicator' as const,
            })),
          );
        }
      } catch (error) {
        setProgramIndicators([]);
      } finally {
        setLoading(false);
      }
    },
    [databaseId],
  );

  // Fetch data sets
  const fetchDataSets = useCallback(
    async (search?: string) => {
      if (!databaseId) return;

      setLoading(true);
      try {
        let url = `/api/v1/database/${databaseId}/dhis2_metadata/?type=dataSets&staged=true`;
        if (search && search.length >= 2) {
          url += `&search=${encodeURIComponent(search)}`;
        }

        const response = await SupersetClient.get({ endpoint: url });
        if (response.json?.result) {
          setDataSets(
            response.json.result.map((item: DHIS2Dimension) => ({
              ...item,
              type: 'dataSet' as const,
            })),
          );
        }
      } catch (error) {
        setDataSets([]);
      } finally {
        setLoading(false);
      }
    },
    [databaseId],
  );

  // Fetch programs (for tracker endpoints)
  const fetchPrograms = useCallback(
    async (search?: string) => {
      if (!databaseId) return;

      setLoading(true);
      try {
        let url = `/api/v1/database/${databaseId}/dhis2_metadata/?type=programs&staged=true`;
        if (search && search.length >= 2) {
          url += `&search=${encodeURIComponent(search)}`;
        }

        const response = await SupersetClient.get({ endpoint: url });
        if (response.json?.result) {
          setPrograms(
            response.json.result.map((item: DHIS2Dimension) => ({
              ...item,
              type: 'program' as const,
            })),
          );
        }
      } catch (error) {
        setPrograms([]);
      } finally {
        setLoading(false);
      }
    },
    [databaseId],
  );

  // Fetch tracked entity types (for tracker endpoints)
  const fetchTrackedEntityTypes = useCallback(
    async (search?: string) => {
      if (!databaseId) return;

      setLoading(true);
      try {
        let url = `/api/v1/database/${databaseId}/dhis2_metadata/?type=trackedEntityTypes&staged=true`;
        if (search && search.length >= 2) {
          url += `&search=${encodeURIComponent(search)}`;
        }

        const response = await SupersetClient.get({ endpoint: url });
        if (response.json?.result) {
          setTrackedEntityTypes(
            response.json.result.map((item: DHIS2Dimension) => ({
              ...item,
              type: 'trackedEntityType' as const,
            })),
          );
        }
      } catch (error) {
        setTrackedEntityTypes([]);
      } finally {
        setLoading(false);
      }
    },
    [databaseId],
  );

  // Load initial data based on active tab and endpoint type
  useEffect(() => {
    if (isTrackerEndpoint && activeTab === 'programs') {
      fetchPrograms(searchQuery);
    } else if (isTrackerEndpoint && activeTab === 'trackedEntityTypes') {
      fetchTrackedEntityTypes(searchQuery);
    } else if (!isTrackerEndpoint && activeTab === 'dataElements') {
      fetchDataElements(searchQuery, selectedDataElementGroup);
    } else if (!isTrackerEndpoint && activeTab === 'indicators') {
      fetchIndicators(searchQuery, selectedIndicatorGroup);
    } else if (!isTrackerEndpoint && activeTab === 'programIndicators') {
      fetchProgramIndicators(searchQuery);
    } else if (!isTrackerEndpoint && activeTab === 'dataSets') {
      fetchDataSets(searchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    selectedDataElementGroup,
    selectedIndicatorGroup,
    isTrackerEndpoint,
  ]);

  // Handle search with debounce
  const handleSearch = useCallback(
    (searchValue: string) => {
      setSearchQuery(searchValue);

      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }

      if (searchValue.length >= 2 || searchValue.length === 0) {
        const timeout = setTimeout(() => {
          if (isTrackerEndpoint) {
            if (activeTab === 'programs') {
              fetchPrograms(searchValue);
            } else if (activeTab === 'trackedEntityTypes') {
              fetchTrackedEntityTypes(searchValue);
            }
          } else if (activeTab === 'dataElements') {
            fetchDataElements(searchValue, selectedDataElementGroup);
          } else if (activeTab === 'indicators') {
            fetchIndicators(searchValue, selectedIndicatorGroup);
          } else if (activeTab === 'programIndicators') {
            fetchProgramIndicators(searchValue);
          } else if (activeTab === 'dataSets') {
            fetchDataSets(searchValue);
          }
        }, 300);
        setSearchTimeout(timeout);
      }
    },
    [
      activeTab,
      isTrackerEndpoint,
      selectedDataElementGroup,
      selectedIndicatorGroup,
      fetchDataElements,
      fetchIndicators,
      fetchProgramIndicators,
      fetchDataSets,
      fetchPrograms,
      fetchTrackedEntityTypes,
      searchTimeout,
    ],
  );

  // Handle group filter change
  const handleDataElementGroupChange = (groupId: string | undefined) => {
    setSelectedDataElementGroup(groupId);
    fetchDataElements(searchQuery, groupId);
  };

  const handleIndicatorGroupChange = (groupId: string | undefined) => {
    setSelectedIndicatorGroup(groupId);
    fetchIndicators(searchQuery, groupId);
  };

  // Handle item selection
  const handleItemToggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  // Handle removing a selected item
  const handleRemoveSelected = (id: string) => {
    onChange(value.filter(v => v !== id));
  };

  // Clear all selections
  const handleClearAll = () => {
    onChange([]);
  };

  // Get display name for a selected ID
  const getDisplayName = (id: string): string => {
    const dimension = allDimensions.find(d => d.id === id);
    return dimension?.displayName || id;
  };

  // Get type icon for dimension
  const getTypeIcon = (type: string): string => {
    switch (type) {
      case 'dataElement':
        return '📈';
      case 'indicator':
        return '📊';
      case 'programIndicator':
        return '📋';
      case 'dataSet':
        return '📁';
      case 'program':
        return '🏥';
      case 'trackedEntityType':
        return '👤';
      default:
        return '📌';
    }
  };

  // Count selections per tab
  const getSelectionCount = (items: DHIS2Dimension[]): number =>
    value.filter(id => items.some(item => item.id === id)).length;

  // Render list of items
  const renderItemList = (items: DHIS2Dimension[]) => {
    if (loading) {
      return (
        <LoadingContainer>
          <Loading />
          <div style={{ marginTop: 8 }}>{t('Loading...')}</div>
        </LoadingContainer>
      );
    }

    if (items.length === 0) {
      return (
        <EmptyContainer>
          <Empty
            description={
              searchQuery
                ? t('No results found for "%s"', searchQuery)
                : t('Type at least 2 characters to search')
            }
          />
        </EmptyContainer>
      );
    }

    return (
      <ListContainer>
        {items.map(item => (
          <ListItem
            key={item.id}
            selected={value.includes(item.id)}
            onClick={() => handleItemToggle(item.id)}
          >
            <Checkbox checked={value.includes(item.id)} />
            <span>{getTypeIcon(item.type)}</span>
            <ItemDetails>
              <ItemName title={item.displayName}>{item.displayName}</ItemName>
              {item.category && <ItemMeta>{item.category}</ItemMeta>}
            </ItemDetails>
          </ListItem>
        ))}
      </ListContainer>
    );
  };

  const tabItems = [
    {
      key: 'dataElements',
      label: (
        <Badge
          count={getSelectionCount(dataElements)}
          size="small"
          offset={[8, 0]}
        >
          <span style={{ paddingRight: 12 }}>{t('Data Elements')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <FilterSection>
            {dataElementGroups.length > 0 && (
              <Select
                style={{ width: 250 }}
                placeholder={t('Filter by Data Element Group')}
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedDataElementGroup}
                onChange={handleDataElementGroupChange}
                options={dataElementGroups.map(g => ({
                  value: g.id,
                  label: g.displayName,
                }))}
              />
            )}
            <Search
              placeholder={t('Search data elements (min 2 chars)...')}
              style={{ width: 300 }}
              allowClear
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
          </FilterSection>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {endpoint === 'analytics'
              ? t('Showing numeric data elements compatible with analytics')
              : t('Showing all data elements')}
          </Text>
          {renderItemList(dataElements)}
        </TabContent>
      ),
    },
    {
      key: 'indicators',
      label: (
        <Badge
          count={getSelectionCount(indicators)}
          size="small"
          offset={[8, 0]}
        >
          <span style={{ paddingRight: 12 }}>{t('Indicators')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <FilterSection>
            {indicatorGroups.length > 0 && (
              <Select
                style={{ width: 250 }}
                placeholder={t('Filter by Indicator Group')}
                allowClear
                showSearch
                optionFilterProp="label"
                value={selectedIndicatorGroup}
                onChange={handleIndicatorGroupChange}
                options={indicatorGroups.map(g => ({
                  value: g.id,
                  label: g.displayName,
                }))}
              />
            )}
            <Search
              placeholder={t('Search indicators (min 2 chars)...')}
              style={{ width: 300 }}
              allowClear
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
          </FilterSection>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {t('Calculated indicators based on data element formulas')}
          </Text>
          {renderItemList(indicators)}
        </TabContent>
      ),
    },
    {
      key: 'programIndicators',
      label: (
        <Badge
          count={getSelectionCount(programIndicators)}
          size="small"
          offset={[8, 0]}
        >
          <span style={{ paddingRight: 12 }}>{t('Program Indicators')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <FilterSection>
            <Search
              placeholder={t('Search program indicators (min 2 chars)...')}
              style={{ width: 300 }}
              allowClear
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
          </FilterSection>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {t('Indicators calculated from tracker program data')}
          </Text>
          {renderItemList(programIndicators)}
        </TabContent>
      ),
    },
    {
      key: 'dataSets',
      label: (
        <Badge count={getSelectionCount(dataSets)} size="small" offset={[8, 0]}>
          <span style={{ paddingRight: 12 }}>{t('Reporting Rates')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <FilterSection>
            <Search
              placeholder={t('Search data sets (min 2 chars)...')}
              style={{ width: 300 }}
              allowClear
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
          </FilterSection>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {t('Data set reporting rates and completeness')}
          </Text>
          {renderItemList(dataSets)}
        </TabContent>
      ),
    },
  ];

  // Tracker endpoint tabs (Programs, Tracked Entity Types)
  const trackerTabItems = [
    {
      key: 'programs',
      label: (
        <Badge count={getSelectionCount(programs)} size="small" offset={[8, 0]}>
          <span style={{ paddingRight: 12 }}>{t('Programs')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <FilterSection>
            <Search
              placeholder={t('Search programs (min 2 chars)...')}
              style={{ width: 300 }}
              allowClear
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
          </FilterSection>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {endpoint === 'events'
              ? t('Select a program to fetch events from')
              : endpoint === 'enrollments'
                ? t('Select a program to fetch enrollments from')
                : t('Select a program to fetch tracked entities from')}
          </Text>
          {renderItemList(programs)}
        </TabContent>
      ),
    },
    {
      key: 'trackedEntityTypes',
      label: (
        <Badge
          count={getSelectionCount(trackedEntityTypes)}
          size="small"
          offset={[8, 0]}
        >
          <span style={{ paddingRight: 12 }}>{t('Tracked Entity Types')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <FilterSection>
            <Search
              placeholder={t('Search tracked entity types (min 2 chars)...')}
              style={{ width: 300 }}
              allowClear
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
          </FilterSection>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {t('Entity types like Person, Commodity, etc.')}
          </Text>
          {renderItemList(trackedEntityTypes)}
        </TabContent>
      ),
    },
  ];

  // Use appropriate tabs based on endpoint type
  const displayTabItems = isTrackerEndpoint ? trackerTabItems : tabItems;

  return (
    <Container>
      <Tabs
        activeKey={activeTab}
        onChange={key => {
          setActiveTab(key);
          setSearchQuery('');
        }}
        items={displayTabItems}
      />

      {/* Selected items section */}
      {value.length > 0 && (
        <SelectedSection>
          <SelectedHeader>
            <Text strong>
              {t('Selected')} ({value.length})
            </Text>
            <Tag
              style={{ cursor: 'pointer' }}
              onClick={handleClearAll}
              color="error"
            >
              {t('Clear All')}
            </Tag>
          </SelectedHeader>
          <SelectedTags>
            {value.map(id => {
              const dimension = allDimensions.find(d => d.id === id);
              return (
                <Tag key={id} closable onClose={() => handleRemoveSelected(id)}>
                  {dimension ? getTypeIcon(dimension.type) : '📌'}{' '}
                  {getDisplayName(id)}
                </Tag>
              );
            })}
          </SelectedTags>
        </SelectedSection>
      )}
    </Container>
  );
};

export default DxSelector;
