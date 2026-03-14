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
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { styled, t, SupersetClient } from '@superset-ui/core';
import Tabs from '@superset-ui/core/components/Tabs';
import { Loading, Typography } from '@superset-ui/core/components';
// eslint-disable-next-line no-restricted-imports
import {
  Tag,
  Checkbox,
  Input,
  Select,
  Badge,
  Radio,
  Alert,
  Tooltip,
  Divider,
} from 'antd';

const { Search } = Input;
const { Text } = Typography;

interface DHIS2OrgUnit {
  id: string;
  displayName: string;
  level?: number;
  path?: string;
  parent?: { id: string };
  children?: DHIS2OrgUnit[];
}

interface OrgUnitLevel {
  level: number;
  displayName: string;
}

/**
 * Hierarchy column mode - which columns to include in output
 * - 'all_levels': All hierarchy columns (National, Region, District, etc.)
 * - 'data_levels_only': Only columns that have data
 */
export type HierarchyColumnMode = 'all_levels' | 'data_levels_only';

/**
 * Selection type - how the org units are being selected
 * - 'relative': User-relative options (USER_ORGUNIT, etc.)
 * - 'specific': Specific org unit IDs with optional level disaggregation
 * - 'level': All org units at specified level(s)
 */
export type OrgUnitSelectionType = 'relative' | 'specific' | 'level';

// Legacy type for backward compatibility
export type OrgUnitSelectionMode = 'selected_only' | 'include_children';
export type OrgUnitInclusionMode = 'selected' | 'children' | 'descendants';

/**
 * Output structure that contains all the information needed
 * to properly construct DHIS2 Analytics API parameters
 *
 * DHIS2 Analytics API format:
 * - dimension=ou:UID1;UID2;LEVEL-n
 * - To get data for an org unit AND its children at a specific level,
 *   include both the UID and LEVEL-n in the dimension
 */
export interface OuSelectionOutput {
  // The selection type being used
  selectionType: OrgUnitSelectionType;
  // Selected org unit IDs (UIDs for specific selection, or special IDs like USER_ORGUNIT)
  selectedOrgUnits: string[];
  // Selected hierarchy levels (e.g., [3, 4, 5] for District, Sub-county, Facility)
  selectedLevels: number[];
  // Which hierarchy columns to include in output
  hierarchyColumnMode: HierarchyColumnMode;
  // The complete OU dimension value for DHIS2 API (e.g., "UID1;UID2;LEVEL-3;LEVEL-4")
  ouDimensionValue: string;
}

interface OuSelectorProps {
  databaseId: number;
  value: string[];
  onChange: (selectedIds: string[]) => void;
  availableLevels?: OrgUnitLevel[];
  onLevelsLoad?: (levels: OrgUnitLevel[]) => void;
  // Enhanced output callback with full selection info
  onSelectionChange?: (output: OuSelectionOutput) => void;
  // Hierarchy column mode
  hierarchyColumnMode?: HierarchyColumnMode;
  onHierarchyColumnModeChange?: (mode: HierarchyColumnMode) => void;
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
    min-height: 400px;
  `}
`;

const SectionBox = styled.div`
  ${({ theme }) => `
    margin-bottom: ${theme.sizeUnit * 2}px;
    padding: ${theme.sizeUnit * 2}px;
    background: ${theme.colorBgLayout};
    border-radius: ${theme.borderRadius}px;
    border: 1px solid ${theme.colorBorder};
  `}
`;

const SectionTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SectionDescription = styled.div`
  ${({ theme }) => `
    font-size: 12px;
    color: ${theme.colorTextSecondary};
    margin-bottom: 12px;
  `}
`;

const OptionGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const OptionItem = styled.div<{ selected?: boolean }>`
  ${({ theme, selected }) => `
    padding: 16px;
    border: 2px solid ${selected ? theme.colorPrimary : theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    background: ${selected ? theme.colorPrimaryBg : theme.colorBgContainer};
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
    
    &:hover {
      border-color: ${theme.colorPrimary};
      box-shadow: ${theme.boxShadowSecondary};
    }
  `}
`;

const OptionTitle = styled.div`
  font-weight: 600;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
`;

const OptionDescription = styled.div`
  ${({ theme }) => `
    font-size: 12px;
    color: ${theme.colorTextSecondary};
    margin-bottom: 8px;
    line-height: 1.5;
  `}
`;

const OptionScope = styled.div`
  ${({ theme }) => `
    font-size: 11px;
    padding: 6px 8px;
    background: ${theme.colorBgLayout};
    border-radius: 4px;
    color: ${theme.colorTextTertiary};
    border-left: 3px solid ${theme.colorPrimary};
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

const SelectedSection = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 2}px;
    border-top: 1px solid ${theme.colorBorder};
    background: ${theme.colorBgLayout};
  `}
`;

const SelectedHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const SelectedTags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
`;

const LoadingContainer = styled.div`
  padding: 32px;
  text-align: center;
`;

const SelectionTypeIndicator = styled.div<{ type: OrgUnitSelectionType }>`
  ${({ theme, type }) => {
    let bgColor = theme.colorBgLayout;
    let borderColor = theme.colorBorder;
    let textColor = theme.colorText;

    if (type === 'relative') {
      bgColor = theme.colorInfoBg;
      borderColor = theme.colorInfo;
      textColor = theme.colorInfoText;
    } else if (type === 'specific') {
      bgColor = theme.colorSuccessBg;
      borderColor = theme.colorSuccess;
      textColor = theme.colorSuccessText;
    } else if (type === 'level') {
      bgColor = theme.colorWarningBg;
      borderColor = theme.colorWarning;
      textColor = theme.colorWarningText;
    }

    return `
      padding: 12px 16px;
      border-left: 4px solid ${borderColor};
      background-color: ${bgColor};
      border-radius: ${theme.borderRadius}px;
      margin-bottom: 16px;
      color: ${textColor};
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
  }}
`;

const ListContainer = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    max-height: 200px;
    overflow-y: auto;
    background: ${theme.colorBgContainer};
  `}
`;

const ListItem = styled.div<{ selected?: boolean }>`
  ${({ theme, selected }) => `
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
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

const LevelCheckbox = styled.div<{ selected?: boolean }>`
  ${({ theme, selected }) => `
    padding: 8px 12px;
    border: 1px solid ${selected ? theme.colorPrimary : theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    background: ${selected ? theme.colorPrimaryBg : theme.colorBgContainer};
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    
    &:hover {
      border-color: ${theme.colorPrimary};
    }
  `}
`;

const OutputPreview = styled.div`
  ${({ theme }) => `
    padding: 12px;
    background: ${theme.colorInfoBg};
    border: 1px solid ${theme.colorInfoBorder};
    border-radius: ${theme.borderRadius}px;
    font-family: monospace;
    font-size: 11px;
    word-break: break-all;
  `}
`;

interface RelativeOrgUnit {
  id: string;
  displayName: string;
  description: string;
  detailedDescription: string;
  scope: string;
  icon: string;
}

const RELATIVE_ORG_UNITS: RelativeOrgUnit[] = [
  {
    id: 'USER_ORGUNIT',
    displayName: 'User Organisation Unit',
    description: 'Show data for the org unit assigned to the current user',
    detailedDescription:
      'Each user sees data from their own organization unit. Perfect for role-based dashboards where each user manages their specific facility or district.',
    scope: "Single level: Only the user's assigned org unit",
    icon: '👤',
  },
  {
    id: 'USER_ORGUNIT_CHILDREN',
    displayName: 'User Org Unit Children',
    description: 'Show data for the org unit and its immediate children',
    detailedDescription:
      'If a user is assigned to a Region, they see data for that Region and all Districts directly under it. Useful for supervisory dashboards.',
    scope: "Two levels: User's org unit + immediate children",
    icon: '👥',
  },
  {
    id: 'USER_ORGUNIT_GRANDCHILDREN',
    displayName: 'User Org Unit Grandchildren',
    description: 'Show data for the org unit, its children, and grandchildren',
    detailedDescription:
      'If a user is assigned to a Region, they see data for that Region, all Districts, and all Facilities. Comprehensive view for higher-level managers.',
    scope: "Three levels: User's org unit + children + grandchildren",
    icon: '👨‍👩‍👧‍👦',
  },
];

// Hierarchy column mode options
const HIERARCHY_MODES: Array<{
  value: HierarchyColumnMode;
  label: string;
  description: string;
}> = [
  {
    value: 'all_levels',
    label: '📊 All Hierarchy Columns',
    description: 'Include National, Region, District, etc. columns',
  },
  {
    value: 'data_levels_only',
    label: '✂️ Data Levels Only',
    description: 'Only columns with actual data',
  },
];

/**
 * DHIS2 Organization Unit Selector
 *
 * Based on DHIS2 Analytics API format:
 * dimension=ou:UID1;UID2;LEVEL-n
 *
 * Selection modes:
 * 1. Relative - USER_ORGUNIT, USER_ORGUNIT_CHILDREN, etc.
 * 2. Specific - Select org units + optionally add LEVEL-n for disaggregation
 * 3. Level - Select all org units at specific level(s)
 */
export const OuSelector: React.FC<OuSelectorProps> = ({
  databaseId,
  value = [],
  onChange,
  availableLevels: propLevels,
  onLevelsLoad,
  onSelectionChange,
  hierarchyColumnMode: propHierarchyMode = 'all_levels',
  onHierarchyColumnModeChange,
}) => {
  const [activeTab, setActiveTab] = useState<string>('relative');
  const [hierarchyColumnMode, setHierarchyColumnMode] =
    useState<HierarchyColumnMode>(propHierarchyMode);

  // Org unit data
  const [orgUnits, setOrgUnits] = useState<DHIS2OrgUnit[]>([]);
  const [orgUnitLevels, setOrgUnitLevels] = useState<OrgUnitLevel[]>(
    propLevels || [],
  );
  const [loading, setLoading] = useState(false);

  // Cache of selected org unit names
  const [selectedOrgUnitNames, setSelectedOrgUnitNames] = useState<
    Record<string, string>
  >({});

  // Filter states for specific selection
  const [filterLevel, setFilterLevel] = useState<number | undefined>();
  const [searchQuery, setSearchQuery] = useState('');

  // Parse current value to extract org units and levels
  const parsedSelection = useMemo(() => {
    const orgUnitIds: string[] = [];
    const levelNumbers: number[] = [];
    const relativeIds: string[] = [];

    value.forEach(id => {
      if (id.startsWith('USER_ORGUNIT')) {
        relativeIds.push(id);
      } else if (id.startsWith('LEVEL-')) {
        const levelNum = parseInt(id.replace('LEVEL-', ''), 10);
        if (!Number.isNaN(levelNum)) {
          levelNumbers.push(levelNum);
        }
      } else {
        orgUnitIds.push(id);
      }
    });

    return { orgUnitIds, levelNumbers, relativeIds };
  }, [value]);

  // Determine selection type
  const selectionType = useMemo((): OrgUnitSelectionType => {
    if (parsedSelection.relativeIds.length > 0) return 'relative';
    if (
      parsedSelection.orgUnitIds.length === 0 &&
      parsedSelection.levelNumbers.length > 0
    ) {
      return 'level';
    }
    return 'specific';
  }, [parsedSelection]);

  // Build DHIS2 OU dimension value
  const ouDimensionValue = useMemo(() => {
    const parts: string[] = [];

    // Add org unit IDs
    parts.push(...parsedSelection.orgUnitIds);

    // Add relative options
    parts.push(...parsedSelection.relativeIds);

    // Add level selections
    parsedSelection.levelNumbers.forEach(level => {
      parts.push(`LEVEL-${level}`);
    });

    return parts.join(';');
  }, [parsedSelection]);

  // Use refs for callbacks to avoid infinite loops
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onHierarchyColumnModeChangeRef = useRef(onHierarchyColumnModeChange);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
    onHierarchyColumnModeChangeRef.current = onHierarchyColumnModeChange;
  });

  // Notify parent of selection changes
  useEffect(() => {
    const output: OuSelectionOutput = {
      selectionType,
      selectedOrgUnits: [
        ...parsedSelection.orgUnitIds,
        ...parsedSelection.relativeIds,
      ],
      selectedLevels: parsedSelection.levelNumbers,
      hierarchyColumnMode,
      ouDimensionValue,
    };

    // Use queueMicrotask to defer state updates to avoid "Cannot update component while rendering" warning
    queueMicrotask(() => {
      onSelectionChangeRef.current?.(output);
      onHierarchyColumnModeChangeRef.current?.(hierarchyColumnMode);
    });
  }, [selectionType, parsedSelection, hierarchyColumnMode, ouDimensionValue]);

  // Fetch org unit levels
  useEffect(() => {
    const fetchLevels = async () => {
      if (!databaseId || propLevels) return;

      try {
        const response = await SupersetClient.get({
          endpoint: `/api/v1/database/${databaseId}/dhis2_metadata/?type=organisationUnitLevels&staged=true`,
        });
        if (response.json?.result) {
          const levels = response.json.result
            .sort((a: OrgUnitLevel, b: OrgUnitLevel) => a.level - b.level)
            .map((item: OrgUnitLevel) => ({
              level: item.level,
              displayName: item.displayName,
            }));
          setOrgUnitLevels(levels);
          onLevelsLoad?.(levels);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to fetch org unit levels:', error);
      }
    };

    fetchLevels();
  }, [databaseId, propLevels, onLevelsLoad]);

  // Fetch org units
  const fetchOrgUnits = useCallback(
    async (level?: number, search?: string) => {
      if (!databaseId) return;

      setLoading(true);
      try {
        let url = `/api/v1/database/${databaseId}/dhis2_metadata/?type=organisationUnits&staged=true`;
        if (level) {
          url += `&level=${level}`;
        }
        if (search && search.length >= 2) {
          url += `&search=${encodeURIComponent(search)}`;
        }

        const response = await SupersetClient.get({ endpoint: url });
        if (response.json?.result) {
          setOrgUnits(response.json.result);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to fetch org units:', error);
        setOrgUnits([]);
      } finally {
        setLoading(false);
      }
    },
    [databaseId],
  );

  // Fetch org units when tab changes or filter changes
  useEffect(() => {
    if (activeTab === 'specific') {
      fetchOrgUnits(filterLevel, searchQuery);
    }
  }, [activeTab, filterLevel, fetchOrgUnits]);

  // Handle search with debounce
  const handleSearch = useCallback(
    (searchValue: string) => {
      setSearchQuery(searchValue);
      if (searchValue.length >= 2 || searchValue.length === 0) {
        fetchOrgUnits(filterLevel, searchValue);
      }
    },
    [filterLevel, fetchOrgUnits],
  );

  // Handle relative option selection
  const handleRelativeSelect = (optionId: string) => {
    // Clear everything and set just this relative option
    onChange([optionId]);
  };

  // Handle specific org unit selection
  const handleOrgUnitToggle = (orgUnitId: string, orgUnitName?: string) => {
    const currentOrgUnits = parsedSelection.orgUnitIds;
    const currentLevels = parsedSelection.levelNumbers;

    let newOrgUnits: string[];
    if (currentOrgUnits.includes(orgUnitId)) {
      newOrgUnits = currentOrgUnits.filter(id => id !== orgUnitId);
      setSelectedOrgUnitNames(prev => {
        const updated = { ...prev };
        delete updated[orgUnitId];
        return updated;
      });
    } else {
      newOrgUnits = [...currentOrgUnits, orgUnitId];
      if (orgUnitName) {
        setSelectedOrgUnitNames(prev => ({
          ...prev,
          [orgUnitId]: orgUnitName,
        }));
      }
    }

    // Build new value array
    const newValue = [...newOrgUnits, ...currentLevels.map(l => `LEVEL-${l}`)];
    onChange(newValue);
  };

  // Handle level toggle for specific selection (disaggregation levels)
  const handleDisaggregationLevelToggle = (level: number) => {
    const currentOrgUnits = parsedSelection.orgUnitIds;
    const currentLevels = parsedSelection.levelNumbers;

    let newLevels: number[];
    if (currentLevels.includes(level)) {
      newLevels = currentLevels.filter(l => l !== level);
    } else {
      newLevels = [...currentLevels, level].sort((a, b) => a - b);
    }

    // Build new value array
    const newValue = [...currentOrgUnits, ...newLevels.map(l => `LEVEL-${l}`)];
    onChange(newValue);
  };

  // Handle pure level selection (no specific org units)
  const handlePureLevelToggle = (level: number) => {
    const levelId = `LEVEL-${level}`;
    const currentLevelIds = value.filter(id => id.startsWith('LEVEL-'));

    let newValue: string[];
    if (currentLevelIds.includes(levelId)) {
      newValue = currentLevelIds.filter(id => id !== levelId);
    } else {
      newValue = [...currentLevelIds, levelId];
    }
    onChange(newValue);
  };

  // Clear all selections
  const handleClearAll = () => {
    onChange([]);
    setSelectedOrgUnitNames({});
  };

  const getDisplayName = (id: string): string => {
    const relativeOption = RELATIVE_ORG_UNITS.find(opt => opt.id === id);
    if (relativeOption) return relativeOption.displayName;

    if (id.startsWith('LEVEL-')) {
      const levelNum = parseInt(id.replace('LEVEL-', ''), 10);
      const level = orgUnitLevels.find(l => l.level === levelNum);
      return level ? `Level ${levelNum}: ${level.displayName}` : id;
    }

    if (selectedOrgUnitNames[id]) return selectedOrgUnitNames[id];

    const orgUnit = orgUnits.find(ou => ou.id === id);
    return orgUnit?.displayName || id;
  };

  const getRelativeKeywordDescription = (id: string): string => {
    const option = RELATIVE_ORG_UNITS.find(opt => opt.id === id);
    return option ? option.scope : '';
  };

  // Tab counts
  const getRelativeCount = () => parsedSelection.relativeIds.length;
  const getSpecificCount = () =>
    parsedSelection.orgUnitIds.length + parsedSelection.levelNumbers.length;
  const getLevelCount = () =>
    selectionType === 'level' ? parsedSelection.levelNumbers.length : 0;

  const tabItems = [
    {
      key: 'relative',
      label: (
        <Badge count={getRelativeCount()} size="small" offset={[8, 0]}>
          <span style={{ paddingRight: 12 }}>👤 {t('Relative')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <SelectionTypeIndicator type="relative">
            👤 User-Relative Selection: Data adjusts per user's org unit
          </SelectionTypeIndicator>

          <Alert
            type="info"
            message={t('Dynamic User-Based Filtering')}
            description={t(
              'Each user will see data filtered to their assigned organization unit. Perfect for role-based dashboards where different users manage different regions or facilities.',
            )}
            showIcon
            style={{ marginBottom: 16 }}
          />

          <SectionBox>
            <SectionTitle>
              🎯 {t('Select Option')}
              <Tooltip title="User-relative selections automatically adjust based on each user's assigned organization unit. This is ideal for role-based filtering.">
                <span style={{ cursor: 'help', fontSize: '12px' }}>ℹ️</span>
              </Tooltip>
            </SectionTitle>
            <OptionGroup>
              {RELATIVE_ORG_UNITS.map(option => (
                <Tooltip
                  key={option.id}
                  title={option.detailedDescription}
                  placement="right"
                >
                  <OptionItem
                    selected={value.includes(option.id)}
                    onClick={() => handleRelativeSelect(option.id)}
                  >
                    <OptionTitle>
                      {option.icon} {option.displayName}
                      {value.includes(option.id) && (
                        <span
                          style={{
                            marginLeft: 'auto',
                            color: 'var(--superset-color-success)',
                            fontSize: '16px',
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </OptionTitle>
                    <OptionDescription>{option.description}</OptionDescription>
                    <OptionScope>{option.scope}</OptionScope>
                  </OptionItem>
                </Tooltip>
              ))}
            </OptionGroup>
          </SectionBox>

          <SectionBox>
            <SectionTitle>
              📊 {t('Output Columns')}
              <Tooltip title="Control which hierarchy columns appear in your dataset. Choose based on your reporting needs.">
                <span style={{ cursor: 'help', fontSize: '12px' }}>ℹ️</span>
              </Tooltip>
            </SectionTitle>
            <Radio.Group
              value={hierarchyColumnMode}
              onChange={e => setHierarchyColumnMode(e.target.value)}
            >
              {HIERARCHY_MODES.map(mode => (
                <Radio
                  key={mode.value}
                  value={mode.value}
                  style={{ display: 'block', marginBottom: 12 }}
                >
                  <span style={{ fontWeight: 500 }}>{mode.label}</span>
                  <div style={{ fontSize: 11, marginLeft: 22, color: '#666' }}>
                    {mode.description}
                  </div>
                </Radio>
              ))}
            </Radio.Group>
          </SectionBox>
        </TabContent>
      ),
    },
    {
      key: 'specific',
      label: (
        <Badge count={getSpecificCount()} size="small" offset={[8, 0]}>
          <span style={{ paddingRight: 12 }}>🏢 {t('Specific')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <SelectionTypeIndicator type="specific">
            🏢 Specific Selection: Fixed org units + optional disaggregation
          </SelectionTypeIndicator>

          <Alert
            type="info"
            message={t('Static Org Unit Selection')}
            description={t(
              'Select specific org units and optionally add hierarchy levels to disaggregate data. For example, select a Region and add District and Facility levels to see data broken down by facility.',
            )}
            showIcon
            style={{ marginBottom: 16 }}
          />

          {/* Org Unit Selection */}
          <SectionBox>
            <SectionTitle>
              🏢 {t('Select Organisation Units')}
              <Tooltip title="Search or filter by level to find and select specific organization units like facilities, districts, or regions.">
                <span style={{ cursor: 'help', fontSize: '12px' }}>ℹ️</span>
              </Tooltip>
            </SectionTitle>
            <SectionDescription>
              {t(
                'Use the search box or level filter to find specific org units.',
              )}
            </SectionDescription>
            <FilterSection>
              <Search
                placeholder={t('Search org units...')}
                style={{ width: 250 }}
                allowClear
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                size="middle"
              />
              <Select
                style={{ width: 180 }}
                placeholder={t('Filter by level')}
                allowClear
                value={filterLevel}
                onChange={setFilterLevel}
                options={orgUnitLevels.map(l => ({
                  value: l.level,
                  label: `${l.level}. ${l.displayName}`,
                }))}
                size="middle"
              />
            </FilterSection>

            {loading ? (
              <LoadingContainer>
                <Loading />
              </LoadingContainer>
            ) : (
              <ListContainer>
                {orgUnits.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center' }}>
                    {searchQuery
                      ? t('No org units found')
                      : t('Select a level or search')}
                  </div>
                ) : (
                  orgUnits.map(ou => (
                    <ListItem
                      key={ou.id}
                      selected={parsedSelection.orgUnitIds.includes(ou.id)}
                      onClick={() => handleOrgUnitToggle(ou.id, ou.displayName)}
                    >
                      <Checkbox
                        checked={parsedSelection.orgUnitIds.includes(ou.id)}
                      />
                      <div style={{ flex: 1 }}>
                        <div>{ou.displayName}</div>
                        {ou.level && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Level {ou.level}
                          </Text>
                        )}
                      </div>
                    </ListItem>
                  ))
                )}
              </ListContainer>
            )}
          </SectionBox>

          {/* Disaggregation Levels */}
          {parsedSelection.orgUnitIds.length > 0 && (
            <SectionBox>
              <SectionTitle>
                📊 {t('Disaggregation Levels')}
                <Tooltip title="Add hierarchy levels to break down data. Selecting additional levels creates row groups for each level value.">
                  <span style={{ cursor: 'help', fontSize: '12px' }}>ℹ️</span>
                </Tooltip>
              </SectionTitle>
              <SectionDescription>
                {t(
                  'Add levels to show detailed data. For example, if you selected a Region, add "District" and "Facility" to see data broken down by each facility.',
                )}
              </SectionDescription>
              <div style={{ marginBottom: 12 }}>
                {orgUnitLevels.map(level => (
                  <LevelCheckbox
                    key={level.level}
                    selected={parsedSelection.levelNumbers.includes(
                      level.level,
                    )}
                    onClick={() => handleDisaggregationLevelToggle(level.level)}
                  >
                    <Checkbox
                      checked={parsedSelection.levelNumbers.includes(
                        level.level,
                      )}
                    />
                    <div style={{ flex: 1 }}>
                      <strong>Level {level.level}:</strong> {level.displayName}
                    </div>
                  </LevelCheckbox>
                ))}
              </div>
            </SectionBox>
          )}

          <SectionBox>
            <SectionTitle>📊 {t('Output Columns')}</SectionTitle>
            <Radio.Group
              value={hierarchyColumnMode}
              onChange={e => setHierarchyColumnMode(e.target.value)}
              size="small"
            >
              {HIERARCHY_MODES.map(mode => (
                <Radio key={mode.value} value={mode.value}>
                  {mode.label}
                </Radio>
              ))}
            </Radio.Group>
          </SectionBox>
        </TabContent>
      ),
    },
    {
      key: 'level',
      label: (
        <Badge count={getLevelCount()} size="small" offset={[8, 0]}>
          <span style={{ paddingRight: 12 }}>📶 {t('By Level')}</span>
        </Badge>
      ),
      children: (
        <TabContent>
          <SelectionTypeIndicator type="level">
            📊 Level-Based Selection: All org units at selected level(s)
          </SelectionTypeIndicator>

          <Alert
            type="info"
            message={t('Comprehensive Level Selection')}
            description={t(
              'Select ALL organization units at one or more levels. Useful for comprehensive reports across all districts, all facilities, etc. No need to select individual org units.',
            )}
            showIcon
            style={{ marginBottom: 16 }}
          />

          <SectionBox>
            <SectionTitle>
              📊 {t('Select Levels')}
              <Tooltip title="Select one or more levels to include ALL organization units at those levels. Useful for comprehensive reports.">
                <span style={{ cursor: 'help', fontSize: '12px' }}>ℹ️</span>
              </Tooltip>
            </SectionTitle>
            <SectionDescription>
              {t(
                'Select levels to include all org units at those levels. For example, selecting Level 4 (Facilities) will include data from every facility in the system.',
              )}
            </SectionDescription>
            {orgUnitLevels.length === 0 ? (
              <LoadingContainer>
                <Loading />
              </LoadingContainer>
            ) : (
              <div style={{ marginBottom: 12 }}>
                {orgUnitLevels.map(level => (
                  <LevelCheckbox
                    key={level.level}
                    selected={
                      selectionType === 'level' &&
                      parsedSelection.levelNumbers.includes(level.level)
                    }
                    onClick={() => handlePureLevelToggle(level.level)}
                  >
                    <Checkbox
                      checked={
                        selectionType === 'level' &&
                        parsedSelection.levelNumbers.includes(level.level)
                      }
                    />
                    <div style={{ flex: 1 }}>
                      <strong>Level {level.level}:</strong> {level.displayName}
                      <div style={{ fontSize: 11, color: '#666' }}>
                        {t('Includes all org units at this level')}
                      </div>
                    </div>
                  </LevelCheckbox>
                ))}
              </div>
            )}
          </SectionBox>

          <SectionBox>
            <SectionTitle>📊 {t('Output Columns')}</SectionTitle>
            <Radio.Group
              value={hierarchyColumnMode}
              onChange={e => setHierarchyColumnMode(e.target.value)}
              size="small"
            >
              {HIERARCHY_MODES.map(mode => (
                <Radio key={mode.value} value={mode.value}>
                  {mode.label}
                </Radio>
              ))}
            </Radio.Group>
          </SectionBox>
        </TabContent>
      ),
    },
  ];

  return (
    <Container>
      <Alert
        type="warning"
        message="Selection Type Guide"
        description={
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <strong>👤 Relative:</strong> Data filters by each user's assigned
            org unit (USER_ORGUNIT, USER_ORGUNIT_CHILDREN,
            USER_ORGUNIT_GRANDCHILDREN).
            <br />
            <strong>🏢 Specific:</strong> Choose exact org units. Optionally add
            hierarchy levels to disaggregate data by region/district/facility.
            <br />
            <strong>📊 By Level:</strong> Include ALL org units at selected
            level(s) - useful for comprehensive reports.
          </div>
        }
        showIcon
        closable
        style={{ marginBottom: 16 }}
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        size="small"
      />

      {/* Selected items and preview */}
      {value.length > 0 && (
        <SelectedSection>
          <SelectedHeader>
            <div>
              <Text strong style={{ fontSize: 14 }}>
                {t('Selection Summary')}
              </Text>
              <Text
                type="secondary"
                style={{ fontSize: 11, display: 'block', marginTop: 2 }}
              >
                {value.length} item(s) selected
              </Text>
            </div>
            <Tag
              style={{ cursor: 'pointer', marginLeft: 'auto' }}
              onClick={handleClearAll}
              color="error"
            >
              {t('Clear All')}
            </Tag>
          </SelectedHeader>

          <Divider style={{ margin: '12px 0' }} />

          <div>
            {parsedSelection.relativeIds.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  👤 User-Relative Options:
                </Text>
                <SelectedTags>
                  {parsedSelection.relativeIds.map(id => (
                    <Tooltip
                      key={id}
                      title={getRelativeKeywordDescription(id)}
                      placement="top"
                    >
                      <Tag
                        color="blue"
                        style={{ marginTop: 4, cursor: 'help' }}
                      >
                        {getDisplayName(id)}
                      </Tag>
                    </Tooltip>
                  ))}
                </SelectedTags>
              </div>
            )}

            {parsedSelection.orgUnitIds.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  🏢 Specific Organisations:
                </Text>
                <SelectedTags>
                  {parsedSelection.orgUnitIds.map(id => (
                    <Tag
                      key={id}
                      closable
                      onClose={() => handleOrgUnitToggle(id)}
                      color="green"
                      style={{ marginTop: 4 }}
                    >
                      {getDisplayName(id)}
                    </Tag>
                  ))}
                </SelectedTags>
              </div>
            )}

            {parsedSelection.levelNumbers.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  📊 Hierarchy Levels:
                </Text>
                <SelectedTags>
                  {parsedSelection.levelNumbers.map(level => (
                    <Tag
                      key={`LEVEL-${level}`}
                      closable
                      onClose={() =>
                        selectionType === 'level'
                          ? handlePureLevelToggle(level)
                          : handleDisaggregationLevelToggle(level)
                      }
                      color="purple"
                      style={{ marginTop: 4 }}
                    >
                      Level {level}:{' '}
                      {orgUnitLevels.find(l => l.level === level)?.displayName}
                    </Tag>
                  ))}
                </SelectedTags>
              </div>
            )}
          </div>

          <Divider style={{ margin: '12px 0' }} />

          <div>
            <Text
              type="secondary"
              style={{
                fontSize: 12,
                display: 'block',
                marginBottom: 8,
                fontWeight: 500,
              }}
            >
              🔗 {t('DHIS2 API Parameter')}:
            </Text>
            <OutputPreview>dimension=ou:{ouDimensionValue}</OutputPreview>
            <Text
              type="secondary"
              style={{
                fontSize: 10,
                display: 'block',
                marginTop: 8,
                lineHeight: 1.6,
              }}
            >
              This parameter will be included in your DHIS2 API request. The
              organization unit values will be filtered based on each user's
              assigned org unit if using relative keywords.
            </Text>
          </div>
        </SelectedSection>
      )}
    </Container>
  );
};

export default OuSelector;
