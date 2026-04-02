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
/* eslint-disable no-param-reassign */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppSection,
  DataMask,
  ensureIsArray,
  ExtraFormData,
  getColumnLabel,
  JsonObject,
  finestTemporalGrainFormatter,
  t,
  tn,
  styled,
} from '@superset-ui/core';
import { GenericDataType } from '@apache-superset/core/api/core';
import { debounce, isUndefined } from 'lodash';
import { useImmerReducer } from 'use-immer';
import {
  Button,
  FormItem,
  LabeledValue,
  Modal,
  Select,
  Space,
  Constants,
} from '@superset-ui/core/components';
import {
  hasOption,
  propertyComparator,
} from '@superset-ui/core/components/Select/utils';
import { FilterBarOrientation } from 'src/dashboard/types';
import { getDataRecordFormatter, getSelectExtraFormData } from '../../utils';
import { FilterPluginStyle, StatusMessage } from '../common';
import { PluginFilterSelectProps, SelectValue } from './types';

const RELATIVE_PERIOD_PREFIX = '__relative_period__:';
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

type PeriodGranularity =
  | 'day'
  | 'week'
  | 'weekWed'
  | 'weekThu'
  | 'weekSat'
  | 'weekSun'
  | 'biWeek'
  | 'month'
  | 'biMonth'
  | 'quarter'
  | 'sixMonth'
  | 'sixMonthApril'
  | 'year'
  | 'financialApril'
  | 'financialJuly'
  | 'financialOct';

type RelativePeriodCategory =
  | 'days'
  | 'weeks'
  | 'biWeeks'
  | 'months'
  | 'biMonths'
  | 'quarters'
  | 'sixMonths'
  | 'financialYears'
  | 'years';

type ParsedPeriod = {
  raw: string;
  granularity: PeriodGranularity;
  label: string;
  sortKey: number;
  year: number;
};

type RelativePeriodOption = {
  key: string;
  label: string;
  values: string[];
};

type PeriodPickerMode = 'relative' | 'fixed';

const isRelativePeriodToken = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(RELATIVE_PERIOD_PREFIX);

const getRelativePeriodToken = (key: string) =>
  `${RELATIVE_PERIOD_PREFIX}${key}`;

const RELATIVE_PERIOD_CATEGORIES: Record<
  RelativePeriodCategory,
  { label: string; options: Array<{ key: string; label: string }> }
> = {
  days: {
    label: t('Days'),
    options: [
      { key: 'TODAY', label: t('Today') },
      { key: 'YESTERDAY', label: t('Yesterday') },
      { key: 'LAST_3_DAYS', label: t('Last 3 days') },
      { key: 'LAST_7_DAYS', label: t('Last 7 days') },
      { key: 'LAST_14_DAYS', label: t('Last 14 days') },
      { key: 'LAST_30_DAYS', label: t('Last 30 days') },
      { key: 'LAST_60_DAYS', label: t('Last 60 days') },
      { key: 'LAST_90_DAYS', label: t('Last 90 days') },
      { key: 'LAST_180_DAYS', label: t('Last 180 days') },
    ],
  },
  weeks: {
    label: t('Weeks'),
    options: [
      { key: 'THIS_WEEK', label: t('This week') },
      { key: 'LAST_WEEK', label: t('Last week') },
      { key: 'LAST_4_WEEKS', label: t('Last 4 weeks') },
      { key: 'LAST_12_WEEKS', label: t('Last 12 weeks') },
      { key: 'LAST_52_WEEKS', label: t('Last 52 weeks') },
      { key: 'WEEKS_THIS_YEAR', label: t('Weeks this year') },
    ],
  },
  biWeeks: {
    label: t('Bi-weeks'),
    options: [
      { key: 'THIS_BIWEEK', label: t('This bi-week') },
      { key: 'LAST_BIWEEK', label: t('Last bi-week') },
      { key: 'LAST_4_BIWEEKS', label: t('Last 4 bi-weeks') },
    ],
  },
  months: {
    label: t('Months'),
    options: [
      { key: 'THIS_MONTH', label: t('This month') },
      { key: 'LAST_MONTH', label: t('Last month') },
      { key: 'LAST_3_MONTHS', label: t('Last 3 months') },
      { key: 'LAST_6_MONTHS', label: t('Last 6 months') },
      { key: 'LAST_12_MONTHS', label: t('Last 12 months') },
      { key: 'MONTHS_THIS_YEAR', label: t('Months this year') },
      { key: 'MONTHS_LAST_YEAR', label: t('Months last year') },
    ],
  },
  biMonths: {
    label: t('Bi-months'),
    options: [
      { key: 'THIS_BIMONTH', label: t('This bi-month') },
      { key: 'LAST_BIMONTH', label: t('Last bi-month') },
      { key: 'LAST_6_BIMONTHS', label: t('Last 6 bi-months') },
      { key: 'BIMONTHS_THIS_YEAR', label: t('Bi-months this year') },
    ],
  },
  quarters: {
    label: t('Quarters'),
    options: [
      { key: 'THIS_QUARTER', label: t('This quarter') },
      { key: 'LAST_QUARTER', label: t('Last quarter') },
      { key: 'LAST_4_QUARTERS', label: t('Last 4 quarters') },
      { key: 'QUARTERS_THIS_YEAR', label: t('Quarters this year') },
      { key: 'QUARTERS_LAST_YEAR', label: t('Quarters last year') },
    ],
  },
  sixMonths: {
    label: t('Six-months'),
    options: [
      { key: 'THIS_SIX_MONTH', label: t('This six-month') },
      { key: 'LAST_SIX_MONTH', label: t('Last six-month') },
      { key: 'LAST_2_SIXMONTHS', label: t('Last 2 six-months') },
    ],
  },
  financialYears: {
    label: t('Financial years'),
    options: [
      { key: 'THIS_FINANCIAL_YEAR', label: t('This financial year') },
      { key: 'LAST_FINANCIAL_YEAR', label: t('Last financial year') },
      {
        key: 'LAST_5_FINANCIAL_YEARS',
        label: t('Last 5 financial years'),
      },
      {
        key: 'LAST_10_FINANCIAL_YEARS',
        label: t('Last 10 financial years'),
      },
    ],
  },
  years: {
    label: t('Years'),
    options: [
      { key: 'THIS_YEAR', label: t('This year') },
      { key: 'LAST_YEAR', label: t('Last year') },
      { key: 'LAST_5_YEARS', label: t('Last 5 years') },
      { key: 'LAST_10_YEARS', label: t('Last 10 years') },
    ],
  },
};

const RELATIVE_PERIOD_LABELS = Object.fromEntries(
  Object.values(RELATIVE_PERIOD_CATEGORIES)
    .flatMap(category => category.options)
    .map(option => [option.key, option.label]),
) as Record<string, string>;

const parsePeriodValue = (value: unknown): ParsedPeriod | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const dailyMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dailyMatch) {
    const year = Number(dailyMatch[1]);
    const month = Number(dailyMatch[2]);
    const day = Number(dailyMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        raw: trimmed,
        granularity: 'day',
        label: `${MONTH_LABELS[month - 1]} ${day}, ${year}`,
        sortKey: year * 10000 + month * 100 + day,
        year,
      };
    }
  }

  const weeklyMatch = trimmed.match(/^(\d{4})W(\d{1,2})$/);
  if (weeklyMatch) {
    const year = Number(weeklyMatch[1]);
    const week = Number(weeklyMatch[2]);
    return {
      raw: trimmed,
      granularity: 'week',
      label: `Week ${week} ${year}`,
      sortKey: year * 100 + week,
      year,
    };
  }

  const weeklyVariantMatch = trimmed.match(/^(\d{4})(Wed|Thu|Sat|Sun)W(\d{1,2})$/);
  if (weeklyVariantMatch) {
    const year = Number(weeklyVariantMatch[1]);
    const day = weeklyVariantMatch[2];
    const week = Number(weeklyVariantMatch[3]);
    const granularity =
      day === 'Wed'
        ? 'weekWed'
        : day === 'Thu'
        ? 'weekThu'
        : day === 'Sat'
        ? 'weekSat'
        : 'weekSun';
    return {
      raw: trimmed,
      granularity,
      label: `Week ${week} ${year} (${day} start)`,
      sortKey: year * 100 + week,
      year,
    };
  }

  const biWeeklyMatch = trimmed.match(/^(\d{4})BiW(\d{1,2})$/);
  if (biWeeklyMatch) {
    const year = Number(biWeeklyMatch[1]);
    const biWeek = Number(biWeeklyMatch[2]);
    return {
      raw: trimmed,
      granularity: 'biWeek',
      label: `Bi-week ${biWeek} ${year}`,
      sortKey: year * 100 + biWeek,
      year,
    };
  }
  const monthlyMatch = trimmed.match(/^(\d{4})(\d{2})$/);
  if (monthlyMatch) {
    const year = Number(monthlyMatch[1]);
    const month = Number(monthlyMatch[2]);
    if (month >= 1 && month <= 12) {
      return {
        raw: trimmed,
        granularity: 'month',
        label: `${MONTH_LABELS[month - 1]} ${year}`,
        sortKey: year * 100 + month,
        year,
      };
    }
  }

  const quarterlyMatch = trimmed.match(/^(\d{4})Q([1-4])$/i);
  if (quarterlyMatch) {
    const year = Number(quarterlyMatch[1]);
    const quarter = Number(quarterlyMatch[2]);
    return {
      raw: trimmed,
      granularity: 'quarter',
      label: `Q${quarter} ${year}`,
      sortKey: year * 10 + quarter,
      year,
    };
  }

  const biMonthlyMatch = trimmed.match(/^(\d{4})(0[1-9]|1[0-2])B$/);
  if (biMonthlyMatch) {
    const year = Number(biMonthlyMatch[1]);
    const startMonth = Number(biMonthlyMatch[2]);
    const endMonth = Math.min(startMonth + 1, 12);
    const monthLabel = `${MONTH_LABELS[startMonth - 1]}-${
      MONTH_LABELS[endMonth - 1]
    }`;
    return {
      raw: trimmed,
      granularity: 'biMonth',
      label: `${monthLabel} ${year}`,
      sortKey: year * 100 + startMonth,
      year,
    };
  }

  const sixMonthlyMatch = trimmed.match(/^(\d{4})S([1-2])$/i);
  if (sixMonthlyMatch) {
    const year = Number(sixMonthlyMatch[1]);
    const half = Number(sixMonthlyMatch[2]);
    const label =
      half === 1 ? `Jan-Jun ${year}` : `Jul-Dec ${year}`;
    return {
      raw: trimmed,
      granularity: 'sixMonth',
      label,
      sortKey: year * 10 + half,
      year,
    };
  }

  const sixMonthlyAprilMatch = trimmed.match(/^(\d{4})AprilS([1-2])$/i);
  if (sixMonthlyAprilMatch) {
    const year = Number(sixMonthlyAprilMatch[1]);
    const half = Number(sixMonthlyAprilMatch[2]);
    const label =
      half === 1
        ? `Apr-Sep ${year}`
        : `Oct ${year} - Mar ${year + 1}`;
    return {
      raw: trimmed,
      granularity: 'sixMonthApril',
      label,
      sortKey: year * 10 + half,
      year,
    };
  }

  const financialAprilMatch = trimmed.match(/^(\d{4})April$/);
  if (financialAprilMatch) {
    const year = Number(financialAprilMatch[1]);
    return {
      raw: trimmed,
      granularity: 'financialApril',
      label: `Apr ${year} - Mar ${year + 1}`,
      sortKey: year,
      year,
    };
  }

  const financialJulyMatch = trimmed.match(/^(\d{4})July$/);
  if (financialJulyMatch) {
    const year = Number(financialJulyMatch[1]);
    return {
      raw: trimmed,
      granularity: 'financialJuly',
      label: `Jul ${year} - Jun ${year + 1}`,
      sortKey: year,
      year,
    };
  }

  const financialOctMatch = trimmed.match(/^(\d{4})Oct$/);
  if (financialOctMatch) {
    const year = Number(financialOctMatch[1]);
    return {
      raw: trimmed,
      granularity: 'financialOct',
      label: `Oct ${year} - Sep ${year + 1}`,
      sortKey: year,
      year,
    };
  }

  const yearlyMatch = trimmed.match(/^(\d{4})$/);
  if (yearlyMatch) {
    const year = Number(yearlyMatch[1]);
    return {
      raw: trimmed,
      granularity: 'year',
      label: trimmed,
      sortKey: year,
      year,
    };
  }

  return null;
};

const buildFixedPeriodsForYear = (
  granularity: PeriodGranularity,
  year: number,
): ParsedPeriod[] => {
  switch (granularity) {
    case 'day': {
      const periods: ParsedPeriod[] = [];
      const date = new Date(year, 0, 1);
      while (date.getFullYear() === year) {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        periods.push({
          raw: `${year}${String(month).padStart(2, '0')}${String(day).padStart(
            2,
            '0',
          )}`,
          granularity: 'day',
          label: `${MONTH_LABELS[month - 1]} ${day}, ${year}`,
          sortKey: year * 10000 + month * 100 + day,
          year,
        });
        date.setDate(day + 1);
      }
      return periods;
    }
    case 'week':
      return Array.from({ length: 52 }, (_, index) => {
        const week = index + 1;
        return {
          raw: `${year}W${week}`,
          granularity: 'week',
          label: `Week ${week} ${year}`,
          sortKey: year * 100 + week,
          year,
        };
      });
    case 'weekWed':
    case 'weekThu':
    case 'weekSat':
    case 'weekSun': {
      const suffix =
        granularity === 'weekWed'
          ? 'Wed'
          : granularity === 'weekThu'
          ? 'Thu'
          : granularity === 'weekSat'
          ? 'Sat'
          : 'Sun';
      return Array.from({ length: 52 }, (_, index) => {
        const week = index + 1;
        return {
          raw: `${year}${suffix}W${week}`,
          granularity,
          label: `Week ${week} ${year} (${suffix} start)`,
          sortKey: year * 100 + week,
          year,
        };
      });
    }
    case 'biWeek':
      return Array.from({ length: 26 }, (_, index) => {
        const biWeek = index + 1;
        return {
          raw: `${year}BiW${biWeek}`,
          granularity: 'biWeek',
          label: `Bi-week ${biWeek} ${year}`,
          sortKey: year * 100 + biWeek,
          year,
        };
      });
    case 'month':
      return MONTH_LABELS.map((label, index) => {
        const month = index + 1;
        return {
          raw: `${year}${String(month).padStart(2, '0')}`,
          granularity: 'month',
          label: `${label} ${year}`,
          sortKey: year * 100 + month,
          year,
        };
      });
    case 'biMonth': {
      const startMonths = [1, 3, 5, 7, 9, 11];
      return startMonths.map(startMonth => {
        const endMonth = Math.min(startMonth + 1, 12);
        const monthLabel = `${MONTH_LABELS[startMonth - 1]}-${
          MONTH_LABELS[endMonth - 1]
        }`;
        return {
          raw: `${year}${String(startMonth).padStart(2, '0')}B`,
          granularity: 'biMonth',
          label: `${monthLabel} ${year}`,
          sortKey: year * 100 + startMonth,
          year,
        };
      });
    }
    case 'quarter':
      return [1, 2, 3, 4].map(quarter => ({
        raw: `${year}Q${quarter}`,
        granularity: 'quarter',
        label: `Q${quarter} ${year}`,
        sortKey: year * 10 + quarter,
        year,
      }));
    case 'sixMonth':
      return [1, 2].map(half => ({
        raw: `${year}S${half}`,
        granularity: 'sixMonth',
        label: half === 1 ? `Jan-Jun ${year}` : `Jul-Dec ${year}`,
        sortKey: year * 10 + half,
        year,
      }));
    case 'sixMonthApril':
      return [1, 2].map(half => ({
        raw: `${year}AprilS${half}`,
        granularity: 'sixMonthApril',
        label:
          half === 1 ? `Apr-Sep ${year}` : `Oct ${year} - Mar ${year + 1}`,
        sortKey: year * 10 + half,
        year,
      }));
    case 'year':
      return [
        {
          raw: String(year),
          granularity: 'year',
          label: String(year),
          sortKey: year,
          year,
        },
      ];
    case 'financialApril':
      return [
        {
          raw: `${year}April`,
          granularity: 'financialApril',
          label: `Apr ${year} - Mar ${year + 1}`,
          sortKey: year,
          year,
        },
      ];
    case 'financialJuly':
      return [
        {
          raw: `${year}July`,
          granularity: 'financialJuly',
          label: `Jul ${year} - Jun ${year + 1}`,
          sortKey: year,
          year,
        },
      ];
    case 'financialOct':
      return [
        {
          raw: `${year}Oct`,
          granularity: 'financialOct',
          label: `Oct ${year} - Sep ${year + 1}`,
          sortKey: year,
          year,
        },
      ];
    default:
      return [];
  }
};

const buildRelativePeriodOptions = (
  categories: RelativePeriodCategory[],
): RelativePeriodOption[] => {
  return categories.flatMap(category =>
    RELATIVE_PERIOD_CATEGORIES[category].options.map(option => ({
      key: option.key,
      label: option.label,
      values: [option.key],
    })),
  );
};

type DataMaskAction =
  | { type: 'ownState'; ownState: JsonObject }
  | {
      type: 'filterState';
      extraFormData: ExtraFormData;
      filterState: {
        value: SelectValue;
        label?: string;
        excludeFilterValues?: boolean;
      };
    };

function reducer(draft: DataMask, action: DataMaskAction) {
  switch (action.type) {
    case 'ownState':
      draft.ownState = {
        ...draft.ownState,
        ...action.ownState,
      };
      return draft;
    case 'filterState':
      if (
        JSON.stringify(draft.extraFormData) !==
        JSON.stringify(action.extraFormData)
      ) {
        draft.extraFormData = action.extraFormData;
      }
      if (
        JSON.stringify(draft.filterState) !== JSON.stringify(action.filterState)
      ) {
        draft.filterState = { ...draft.filterState, ...action.filterState };
      }

      return draft;
    default:
      return draft;
  }
}

const StyledSpace = styled(Space)<{
  $inverseSelection: boolean;
  $appSection: AppSection;
}>`
  display: flex;
  align-items: center;
  width: 100%;

  .exclude-select {
    width: 80px;
    flex-shrink: 0;
  }

  &.ant-space {
    .ant-space-item {
      width: ${({ $inverseSelection }) => (!$inverseSelection ? '100%' : 'auto')};
    }
  }
`;

const PeriodPickerTrigger = styled(Button)`
  margin-top: ${({ theme }) => theme.sizeUnit * 2}px;
  width: 100%;
  justify-content: flex-start;
`;

const PeriodPickerLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.9fr);
  gap: ${({ theme }) => theme.sizeUnit * 4}px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const PeriodPickerPanel = styled.div`
  border: 1px solid ${({ theme }) => theme.colorBorder};
  border-radius: ${({ theme }) => theme.borderRadius}px;
  background: ${({ theme }) => theme.colorBgContainer};
  overflow: hidden;
`;

const PeriodPickerSection = styled.div`
  padding: ${({ theme }) => theme.sizeUnit * 3}px;
  border-bottom: 1px solid ${({ theme }) => theme.colorBorderSecondary};
`;

const PeriodPickerHeading = styled.div`
  font-size: ${({ theme }) => theme.fontSizeLG}px;
  font-weight: ${({ theme }) => theme.fontWeightStrong};
  margin-bottom: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const PickerButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const PeriodTypeSelect = styled(Select)`
  width: 240px;
`;

const YearStepper = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const YearStepperValue = styled.div`
  min-width: 88px;
  text-align: center;
  font-weight: ${({ theme }) => theme.fontWeightStrong};
  color: ${({ theme }) => theme.colorText};
  font-size: ${({ theme }) => theme.fontSizeLG}px;
`;

const PickerList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
  max-height: 320px;
  overflow: auto;
`;

const PickerListItem = styled(Button)<{ $active?: boolean }>`
  ${({ theme, $active }) => `
    border-color: ${$active ? theme.colorPrimary : theme.colorBorder};
    background: ${$active ? theme.colorPrimaryBg : theme.colorBgContainer};
    color: ${$active ? theme.colorPrimary : theme.colorText};
  `}
`;

// Keep track of orientation changes outside component with filter ID
const orientationMap = new Map<string, FilterBarOrientation>();

export default function PluginFilterSelect(props: PluginFilterSelectProps) {
  const {
    coltypeMap,
    data,
    filterState,
    formData,
    height,
    isRefreshing,
    width,
    setDataMask,
    setHoveredFilter,
    unsetHoveredFilter,
    setFocusedFilter,
    unsetFocusedFilter,
    setFilterActive,
    appSection,
    showOverflow,
    parentRef,
    inputRef,
    filterBarOrientation,
    clearAllTrigger,
    onClearAllComplete,
  } = props;
  const {
    enableEmptyFilter,
    creatable,
    multiSelect,
    showSearch,
    inverseSelection,
    defaultToFirstItem,
    searchAllOptions,
  } = formData;

  const groupby = useMemo(
    () => ensureIsArray(formData.groupby).map(getColumnLabel),
    [formData.groupby],
  );
  const [col] = groupby;
  const [initialColtypeMap] = useState(coltypeMap);
  const [search, setSearch] = useState('');
  const isChangedByUser = useRef(false);
  const prevDataRef = useRef(data);
  const [dataMask, dispatchDataMask] = useImmerReducer(reducer, {
    extraFormData: {},
    filterState,
  });
  const datatype: GenericDataType = coltypeMap[col];
  const labelFormatter = useMemo(
    () =>
      getDataRecordFormatter({
        timeFormatter: finestTemporalGrainFormatter(data.map(el => el[col])),
      }),
    [data, col],
  );
  const isPeriodColumn = useMemo(
    () => col?.toLowerCase() === 'period' || col?.toLowerCase() === 'pe',
    [col],
  );
  const effectiveData = useMemo(() => {
    if (data.length > 0) {
      return data;
    }
    if (!isPeriodColumn || !col) {
      return data;
    }
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) =>
      String(currentYear - 4 + i),
    );
    return years.map(y => ({ [col]: y })) as typeof data;
  }, [data, isPeriodColumn, col]);
  const parsedPeriodOptions = useMemo(
    () =>
      isPeriodColumn
        ? effectiveData
            .map(row => parsePeriodValue(row[col]))
            .filter((item): item is ParsedPeriod => item !== null)
            .sort((a, b) => a.sortKey - b.sortKey)
        : [],
    [col, effectiveData, isPeriodColumn],
  );
  const relativePeriodOptions = useMemo(
    () => buildRelativePeriodOptions(Object.keys(RELATIVE_PERIOD_CATEGORIES) as RelativePeriodCategory[]),
    [],
  );
  const relativePeriodMap = useMemo(
    () =>
      Object.fromEntries(
        relativePeriodOptions.map(option => [
          getRelativePeriodToken(option.key),
          [option.key],
        ]),
      ) as Record<string, string[]>,
    [relativePeriodOptions],
  );
  const defaultPeriodGranularity = useMemo<PeriodGranularity>(
    () =>
      parsedPeriodOptions[parsedPeriodOptions.length - 1]?.granularity ||
      'year',
    [parsedPeriodOptions],
  );
  const [isPeriodPickerOpen, setIsPeriodPickerOpen] = useState(false);
  const [periodPickerMode, setPeriodPickerMode] =
    useState<PeriodPickerMode>('fixed');
  const [periodPickerGranularity, setPeriodPickerGranularity] =
    useState<PeriodGranularity>(defaultPeriodGranularity);
  const [relativePeriodCategory, setRelativePeriodCategory] =
    useState<RelativePeriodCategory>('months');
  const [draftPeriodValues, setDraftPeriodValues] = useState<string[]>([]);
  const [selectedPeriodYear, setSelectedPeriodYear] = useState<string>();
  const yearRange = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 20;
    const endYear = currentYear + 5;
    const years = Array.from(
      { length: endYear - startYear + 1 },
      (_, index) => String(startYear + index),
    );
    if (selectedPeriodYear && !years.includes(selectedPeriodYear)) {
      years.push(selectedPeriodYear);
      years.sort((a, b) => Number(a) - Number(b));
    }
    return years;
  }, [selectedPeriodYear]);
  const currentPeriodValues = useMemo(
    () =>
      ensureIsArray(filterState.value).filter(
        (value): value is string => typeof value === 'string',
      ),
    [filterState.value],
  );
  const formatFilterValueLabel = useCallback(
    (value: string | number | null) => {
      if (value === null) {
        return labelFormatter(value, datatype);
      }
      if (isPeriodColumn) {
        if (
          typeof value === 'string' &&
          isRelativePeriodToken(value) &&
          RELATIVE_PERIOD_LABELS[value.slice(RELATIVE_PERIOD_PREFIX.length)]
        ) {
          return RELATIVE_PERIOD_LABELS[value.slice(RELATIVE_PERIOD_PREFIX.length)];
        }
        if (typeof value === 'string' && RELATIVE_PERIOD_LABELS[value]) {
          return RELATIVE_PERIOD_LABELS[value];
        }
        const parsed = parsePeriodValue(String(value));
        if (parsed) {
          return parsed.label;
        }
      }
      return labelFormatter(value, datatype);
    },
    [datatype, isPeriodColumn, labelFormatter],
  );
  const [excludeFilterValues, setExcludeFilterValues] = useState(
    isUndefined(filterState?.excludeFilterValues)
      ? true
      : filterState?.excludeFilterValues,
  );

  const prevExcludeFilterValues = useRef(excludeFilterValues);

  const hasOnlyOrientationChanged = useRef(false);

  useEffect(() => {
    setPeriodPickerGranularity(defaultPeriodGranularity);
  }, [defaultPeriodGranularity]);

  useEffect(() => {
    const currentValueYear = currentPeriodValues
      .map(value => parsePeriodValue(value))
      .find((item): item is ParsedPeriod => item !== null)?.year;
    if (currentValueYear) {
      setSelectedPeriodYear(String(currentValueYear));
      return;
    }
    setSelectedPeriodYear(String(new Date().getFullYear()));
  }, [currentPeriodValues]);

  useEffect(() => {
    // Get previous orientation for this specific filter
    const previousOrientation = orientationMap.get(formData.nativeFilterId);

    // Check if only orientation changed for this filter
    if (
      previousOrientation !== undefined &&
      previousOrientation !== filterBarOrientation
    ) {
      hasOnlyOrientationChanged.current = true;
    } else {
      hasOnlyOrientationChanged.current = false;
    }

    // Update orientation for this filter
    if (filterBarOrientation) {
      orientationMap.set(formData.nativeFilterId, filterBarOrientation);
    }
  }, [filterBarOrientation]);

  useEffect(() => {
    if (isPeriodPickerOpen) {
      setDraftPeriodValues(currentPeriodValues);
    }
  }, [currentPeriodValues, isPeriodPickerOpen]);

  const updateDataMask = useCallback(
    (values: SelectValue) => {
      const emptyFilter =
        enableEmptyFilter && !inverseSelection && !values?.length;

      const suffix = inverseSelection && values?.length ? t(' (excluded)') : '';
      dispatchDataMask({
        type: 'filterState',
        extraFormData: getSelectExtraFormData(
          col,
          values,
          emptyFilter,
          excludeFilterValues && inverseSelection,
        ),
        filterState: {
          ...filterState,
          label: values?.length
            ? `${(values || [])
                .map(value => formatFilterValueLabel(value))
                .join(', ')}${suffix}`
            : undefined,
          value:
            appSection === AppSection.FilterConfigModal && defaultToFirstItem
              ? undefined
              : values,
          excludeFilterValues,
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      appSection,
      col,
      datatype,
      defaultToFirstItem,
      dispatchDataMask,
      enableEmptyFilter,
      inverseSelection,
      excludeFilterValues,
      JSON.stringify(filterState),
      formatFilterValueLabel,
    ],
  );

  const isDisabled =
    appSection === AppSection.FilterConfigModal && defaultToFirstItem;

  const onSearch = useMemo(
    () =>
      debounce((search: string) => {
        setSearch(search);
        if (searchAllOptions) {
          dispatchDataMask({
            type: 'ownState',
            ownState: {
              coltypeMap: initialColtypeMap,
              search,
            },
          });
        }
      }, Constants.SLOW_DEBOUNCE),
    [dispatchDataMask, initialColtypeMap, searchAllOptions],
  );

  const handleBlur = useCallback(() => {
    unsetFocusedFilter();
    onSearch('');
  }, [onSearch, unsetFocusedFilter]);

  const handleChange = useCallback(
    (value?: SelectValue | number | string) => {
      const rawValues = value === null ? [null] : ensureIsArray(value);
      const values = rawValues.reduce<(number | string | null)[]>(
        (acc, selectedValue) => {
          if (isRelativePeriodToken(selectedValue)) {
            const mappedValues = relativePeriodMap[selectedValue] || [];
            mappedValues.forEach(mappedValue => {
              if (!acc.includes(mappedValue)) {
                acc.push(mappedValue);
              }
            });
          } else if (!acc.includes(selectedValue)) {
            acc.push(selectedValue);
          }
          return acc;
        },
        [],
      );

      if (values.length === 0) {
        updateDataMask(null);
      } else {
        updateDataMask(values);
      }

      isChangedByUser.current = true;
    },
    [
      clearAllTrigger,
      formData.nativeFilterId,
      relativePeriodMap,
      updateDataMask,
    ],
  );

  const placeholderText =
    effectiveData.length === 0
      ? t('No data')
      : tn(
          '%s option',
          '%s options',
          effectiveData.length,
          effectiveData.length,
        );

  const fixedPeriodsForPicker = useMemo(
    () => {
      if (!selectedPeriodYear) {
        return [];
      }
      return buildFixedPeriodsForYear(
        periodPickerGranularity,
        Number(selectedPeriodYear),
      );
    },
    [periodPickerGranularity, selectedPeriodYear],
  );
  const relativePeriodsForPicker = useMemo(
    () =>
      buildRelativePeriodOptions([relativePeriodCategory]),
    [relativePeriodCategory],
  );
  const periodTypeOptions = useMemo(
    () => [
      { label: t('Daily'), value: 'day', isNewOption: false },
      { label: t('Weekly'), value: 'week', isNewOption: false },
      {
        label: t('Weekly (Start Wednesday)'),
        value: 'weekWed',
        isNewOption: false,
      },
      {
        label: t('Weekly (Start Thursday)'),
        value: 'weekThu',
        isNewOption: false,
      },
      {
        label: t('Weekly (Start Saturday)'),
        value: 'weekSat',
        isNewOption: false,
      },
      {
        label: t('Weekly (Start Sunday)'),
        value: 'weekSun',
        isNewOption: false,
      },
      { label: t('Bi-weekly'), value: 'biWeek', isNewOption: false },
      { label: t('Monthly'), value: 'month', isNewOption: false },
      { label: t('Bi-months'), value: 'biMonth', isNewOption: false },
      { label: t('Quarterly'), value: 'quarter', isNewOption: false },
      { label: t('Six-monthly'), value: 'sixMonth', isNewOption: false },
      {
        label: t('Six-monthly April'),
        value: 'sixMonthApril',
        isNewOption: false,
      },
      { label: t('Yearly'), value: 'year', isNewOption: false },
      {
        label: t('Financial April'),
        value: 'financialApril',
        isNewOption: false,
      },
      {
        label: t('Financial July'),
        value: 'financialJuly',
        isNewOption: false,
      },
      {
        label: t('Financial October'),
        value: 'financialOct',
        isNewOption: false,
      },
    ],
    [],
  );
  const relativeTypeOptions = useMemo(
    () =>
      (Object.keys(RELATIVE_PERIOD_CATEGORIES) as RelativePeriodCategory[]).map(
        category => ({
          label: RELATIVE_PERIOD_CATEGORIES[category].label,
          value: category,
          isNewOption: false,
        }),
      ),
    [],
  );
  const canMovePeriodYearPrev = useMemo(() => {
    if (!selectedPeriodYear || yearRange.length === 0) {
      return false;
    }
    return yearRange.indexOf(selectedPeriodYear) > 0;
  }, [selectedPeriodYear, yearRange]);
  const canMovePeriodYearNext = useMemo(() => {
    if (!selectedPeriodYear || yearRange.length === 0) {
      return false;
    }
    return yearRange.indexOf(selectedPeriodYear) < yearRange.length - 1;
  }, [selectedPeriodYear, yearRange]);
  const movePeriodYear = useCallback(
    (direction: -1 | 1) => {
      setSelectedPeriodYear(currentYear => {
        if (!currentYear || yearRange.length === 0) {
          return currentYear;
        }
        const index = yearRange.indexOf(currentYear);
        if (index === -1) {
          return currentYear;
        }
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= yearRange.length) {
          return currentYear;
        }
        return yearRange[nextIndex];
      });
    },
    [yearRange],
  );

  const toggleDraftPeriodValue = useCallback(
    (periodValue: string) => {
      setDraftPeriodValues(currentValues =>
        currentValues.includes(periodValue)
          ? currentValues.filter(value => value !== periodValue)
          : [...currentValues, periodValue],
      );
    },
    [setDraftPeriodValues],
  );

  const applyRelativeSelection = useCallback(
    (values: string[]) => {
      setDraftPeriodValues(currentValues => {
        const nextValues = [...currentValues];
        values.forEach(value => {
          if (!nextValues.includes(value)) {
            nextValues.push(value);
          }
        });
        return nextValues;
      });
    },
    [setDraftPeriodValues],
  );

  const handleOpenPeriodPicker = useCallback(() => {
    setDraftPeriodValues(currentPeriodValues);
    setIsPeriodPickerOpen(true);
  }, [currentPeriodValues]);

  const handleRemoveDraftPeriodValue = useCallback((periodValue: string) => {
    setDraftPeriodValues(currentValues =>
      currentValues.filter(value => value !== periodValue),
    );
  }, []);

  const handleApplyPeriodPicker = useCallback(() => {
    const nextValues = [...draftPeriodValues].sort((a, b) => {
      const parsedA = parsePeriodValue(a);
      const parsedB = parsePeriodValue(b);
      if (parsedA && parsedB) {
        return parsedA.sortKey - parsedB.sortKey;
      }
      return a.localeCompare(b);
    });
    updateDataMask(nextValues.length ? nextValues : null);
    isChangedByUser.current = true;
    setIsPeriodPickerOpen(false);
  }, [draftPeriodValues, updateDataMask]);

  const formItemExtra = useMemo(() => {
    if (filterState.validateMessage) {
      return (
        <StatusMessage status={filterState.validateStatus}>
          {filterState.validateMessage}
        </StatusMessage>
      );
    }
    return undefined;
  }, [filterState.validateMessage, filterState.validateStatus]);

  const uniqueOptions = useMemo(() => {
    const actualOptions = isPeriodColumn
      ? parsedPeriodOptions.map(period => ({
          label: period.label,
          value: period.raw,
          isNewOption: false,
          sortKey: period.sortKey,
        }))
      : [...new Set([...effectiveData.map(el => el[col])])].map(
          (value: string) => ({
            label: labelFormatter(value, datatype),
            value,
            isNewOption: false,
          }),
        );

    const presetOptions = isPeriodColumn
      ? relativePeriodOptions.map((option, index) => ({
          label: `${t('Relative')}: ${option.label}`,
          value: option.key,
          isNewOption: false,
          presetOrder: index,
        }))
      : [];

    return [...presetOptions, ...actualOptions];
  }, [
    col,
    datatype,
    effectiveData,
    isPeriodColumn,
    labelFormatter,
    parsedPeriodOptions,
    relativePeriodOptions,
  ]);

  const options = useMemo(() => {
    if (search && !multiSelect && !hasOption(search, uniqueOptions, true)) {
      uniqueOptions.unshift({
        label: search,
        value: search,
        isNewOption: true,
      });
    }
    return uniqueOptions;
  }, [multiSelect, search, uniqueOptions]);

  const sortComparator = useCallback(
    (
      a: LabeledValue & { sortKey?: number; presetOrder?: number },
      b: LabeledValue & { sortKey?: number; presetOrder?: number },
    ) => {
      if (!isUndefined(a.presetOrder) || !isUndefined(b.presetOrder)) {
        if (isUndefined(a.presetOrder)) {
          return 1;
        }
        if (isUndefined(b.presetOrder)) {
          return -1;
        }
        return a.presetOrder - b.presetOrder;
      }
      if (
        isPeriodColumn &&
        !isUndefined(a.sortKey) &&
        !isUndefined(b.sortKey)
      ) {
        return formData.sortAscending
          ? a.sortKey - b.sortKey
          : b.sortKey - a.sortKey;
      }
      const labelComparator = propertyComparator('label');
      if (formData.sortAscending) {
        return labelComparator(a, b);
      }
      return labelComparator(b, a);
    },
    [formData.sortAscending, isPeriodColumn],
  );

  // Use effect for initialisation for filter plugin
  // this should run only once when filter is configured & saved
  // & shouldnt run when the component is remounted on change of
  // orientation of filter bar
  useEffect(() => {
    // Skip if only orientation changed
    if (hasOnlyOrientationChanged.current) {
      return;
    }

    // Case 1: Handle disabled state first
    if (isDisabled) {
      updateDataMask(null);
      return;
    }

    if (filterState.value !== undefined) {
      // Set the filter state value if it is defined
      updateDataMask(filterState.value);
      return;
    }

    // Handle the default to first Value case
    if (defaultToFirstItem) {
      // Set to first item if defaultToFirstItem is true
      const firstItem: SelectValue = effectiveData[0]
        ? (groupby.map(col => effectiveData[0][col]) as string[])
        : null;
      if (firstItem?.[0] !== undefined) {
        updateDataMask(firstItem);
      }
    } else if (formData?.defaultValue) {
      // Handle defalut value case
      updateDataMask(formData.defaultValue);
    }
  }, [
    isDisabled,
    enableEmptyFilter,
    defaultToFirstItem,
    formData?.defaultValue,
    data,
    groupby,
    col,
    inverseSelection,
  ]);

  useEffect(() => {
    const prev = prevDataRef.current;
    const curr = data;

    const hasDataChanged =
      prev?.length !== curr?.length ||
      prev?.some((row, i) => {
        const prevVal = row[col];
        const currVal = curr[i][col];
        return typeof prevVal === 'bigint' || typeof currVal === 'bigint'
          ? prevVal?.toString() !== currVal?.toString()
          : prevVal !== currVal;
      });

    // If data actually changed (e.g., due to parent filter), reset flag
    if (hasDataChanged) {
      isChangedByUser.current = false;
      prevDataRef.current = data;
    }
  }, [data, col]);

  useEffect(() => {
    if (
      isChangedByUser.current &&
      filterState.value &&
      filterState.value.every((value?: any) =>
        data.some(row => row[col] === value),
      )
    )
      return;

    const firstItem: SelectValue = data[0]
      ? (groupby.map(col => data[0][col]) as string[])
      : null;

    if (
      defaultToFirstItem &&
      Object.keys(formData?.extraFormData || {}).length &&
      filterState.value !== undefined &&
      firstItem !== null &&
      filterState.value !== firstItem
    ) {
      if (firstItem?.[0] !== undefined) {
        updateDataMask(firstItem);
      }
    }
  }, [
    defaultToFirstItem,
    updateDataMask,
    formData,
    data,
    JSON.stringify(filterState.value),
    isChangedByUser.current,
  ]);

  useEffect(() => {
    setDataMask(dataMask);
  }, [JSON.stringify(dataMask)]);

  useEffect(() => {
    if (clearAllTrigger) {
      dispatchDataMask({
        type: 'filterState',
        extraFormData: {},
        filterState: {
          value: undefined,
          label: undefined,
        },
      });

      updateDataMask(null);
      setSearch('');
      onClearAllComplete?.(formData.nativeFilterId);
    }
  }, [clearAllTrigger, onClearAllComplete, updateDataMask]);

  useEffect(() => {
    if (prevExcludeFilterValues.current !== excludeFilterValues) {
      dispatchDataMask({
        type: 'filterState',
        extraFormData: getSelectExtraFormData(
          col,
          filterState.value,
          !filterState.value?.length,
          excludeFilterValues && inverseSelection,
        ),
        filterState: {
          ...(filterState as {
            value: SelectValue;
            label?: string;
            excludeFilterValues?: boolean;
          }),
          excludeFilterValues,
        },
      });
      prevExcludeFilterValues.current = excludeFilterValues;
    }
  }, [excludeFilterValues]);

  const handleExclusionToggle = (value: string) => {
    setExcludeFilterValues(value === 'true');
  };

  return (
    <FilterPluginStyle height={height} width={width}>
      <FormItem
        validateStatus={filterState.validateStatus}
        extra={formItemExtra}
      >
        <StyledSpace
          $appSection={appSection}
          $inverseSelection={inverseSelection}
        >
          {appSection !== AppSection.FilterConfigModal && inverseSelection && (
            <Select
              className="exclude-select"
              value={`${excludeFilterValues}`}
              options={[
                { value: 'true', label: t('is not') },
                { value: 'false', label: t('is') },
              ]}
              onChange={handleExclusionToggle}
            />
          )}
          <Select
            name={formData.nativeFilterId}
            allowClear
            allowNewOptions={!searchAllOptions && creatable !== false}
            allowSelectAll={!searchAllOptions}
            value={filterState.value || []}
            disabled={isDisabled}
            getPopupContainer={
              showOverflow
                ? () => (parentRef?.current as HTMLElement) || document.body
                : (trigger: HTMLElement) =>
                    (trigger?.parentNode as HTMLElement) || document.body
            }
            showSearch={showSearch}
            mode={multiSelect ? 'multiple' : 'single'}
            placeholder={placeholderText}
            onClear={() => onSearch('')}
            onSearch={onSearch}
            onBlur={handleBlur}
            onFocus={setFocusedFilter}
            onMouseEnter={setHoveredFilter}
            onMouseLeave={unsetHoveredFilter}
            // @ts-ignore
            onChange={handleChange}
            ref={inputRef}
            loading={isRefreshing}
            oneLine={filterBarOrientation === FilterBarOrientation.Horizontal}
            invertSelection={inverseSelection && excludeFilterValues}
            options={options}
            sortComparator={sortComparator}
            onOpenChange={setFilterActive}
            className="select-container"
          />
        </StyledSpace>
        {isPeriodColumn && (
          <>
            <PeriodPickerTrigger
              buttonStyle="secondary"
              onClick={handleOpenPeriodPicker}
            >
              {t('Open period picker')}
            </PeriodPickerTrigger>
            <Modal
              show={isPeriodPickerOpen}
              onHide={() => setIsPeriodPickerOpen(false)}
              title={t('Period')}
              responsive
              maxWidth="960px"
              footer={
                <>
                  <Button
                    buttonStyle="secondary"
                    onClick={() => setIsPeriodPickerOpen(false)}
                  >
                    {t('Hide')}
                  </Button>
                  <Button
                    buttonStyle="primary"
                    onClick={handleApplyPeriodPicker}
                  >
                    {t('Update')}
                  </Button>
                </>
              }
            >
              <PeriodPickerLayout>
                <PeriodPickerPanel>
                  <PeriodPickerSection>
                    <PickerButtonRow>
                      <PickerListItem
                        buttonStyle="secondary"
                        $active={periodPickerMode === 'relative'}
                        onClick={() => setPeriodPickerMode('relative')}
                      >
                        {t('Relative periods')}
                      </PickerListItem>
                      <PickerListItem
                        buttonStyle="secondary"
                        $active={periodPickerMode === 'fixed'}
                        onClick={() => setPeriodPickerMode('fixed')}
                      >
                        {t('Fixed periods')}
                      </PickerListItem>
                    </PickerButtonRow>
                  </PeriodPickerSection>
                  <PeriodPickerSection>
                    <PeriodPickerHeading>
                      {t('Period type')}
                    </PeriodPickerHeading>
                    {periodPickerMode === 'fixed' ? (
                      <PeriodTypeSelect
                        name={`${formData.nativeFilterId}-period-type`}
                        mode="single"
                        allowClear={false}
                        showSearch={false}
                        value={periodPickerGranularity}
                        options={periodTypeOptions}
                        onChange={(value: unknown) => {
                          const [firstValue] = ensureIsArray(value);
                          if (firstValue === 'day') {
                            setPeriodPickerGranularity('day');
                          } else if (firstValue === 'week') {
                            setPeriodPickerGranularity('week');
                          } else if (firstValue === 'weekWed') {
                            setPeriodPickerGranularity('weekWed');
                          } else if (firstValue === 'weekThu') {
                            setPeriodPickerGranularity('weekThu');
                          } else if (firstValue === 'weekSat') {
                            setPeriodPickerGranularity('weekSat');
                          } else if (firstValue === 'weekSun') {
                            setPeriodPickerGranularity('weekSun');
                          } else if (firstValue === 'biWeek') {
                            setPeriodPickerGranularity('biWeek');
                          } else if (firstValue === 'month') {
                            setPeriodPickerGranularity('month');
                          } else if (firstValue === 'biMonth') {
                            setPeriodPickerGranularity('biMonth');
                          } else if (firstValue === 'quarter') {
                            setPeriodPickerGranularity('quarter');
                          } else if (firstValue === 'sixMonth') {
                            setPeriodPickerGranularity('sixMonth');
                          } else if (firstValue === 'sixMonthApril') {
                            setPeriodPickerGranularity('sixMonthApril');
                          } else if (firstValue === 'year') {
                            setPeriodPickerGranularity('year');
                          } else if (firstValue === 'financialApril') {
                            setPeriodPickerGranularity('financialApril');
                          } else if (firstValue === 'financialJuly') {
                            setPeriodPickerGranularity('financialJuly');
                          } else if (firstValue === 'financialOct') {
                            setPeriodPickerGranularity('financialOct');
                          }
                        }}
                      />
                    ) : (
                      <PeriodTypeSelect
                        name={`${formData.nativeFilterId}-relative-period-type`}
                        mode="single"
                        allowClear={false}
                        showSearch={false}
                        value={relativePeriodCategory}
                        options={relativeTypeOptions}
                        onChange={(value: unknown) => {
                          const [firstValue] = ensureIsArray(value);
                          if (firstValue) {
                            setRelativePeriodCategory(
                              firstValue as RelativePeriodCategory,
                            );
                          }
                        }}
                      />
                    )}
                  </PeriodPickerSection>
                  {periodPickerMode === 'fixed' && (
                    <PeriodPickerSection>
                      <PeriodPickerHeading>{t('Year')}</PeriodPickerHeading>
                      <YearStepper>
                        <Button
                          buttonStyle="secondary"
                          onClick={() => movePeriodYear(-1)}
                          disabled={!canMovePeriodYearPrev}
                        >
                          ← {t('Prev')}
                        </Button>
                        <YearStepperValue>
                          {selectedPeriodYear || t('No year')}
                        </YearStepperValue>
                        <Button
                          buttonStyle="secondary"
                          onClick={() => movePeriodYear(1)}
                          disabled={!canMovePeriodYearNext}
                        >
                          {t('Next')} →
                        </Button>
                      </YearStepper>
                    </PeriodPickerSection>
                  )}
                  <PeriodPickerSection>
                    <PickerList>
                      {periodPickerMode === 'relative'
                        ? relativePeriodsForPicker.map(option => (
                            <PickerListItem
                              key={option.key}
                              buttonStyle="secondary"
                              onClick={() =>
                                applyRelativeSelection(option.values)
                              }
                            >
                              {option.label}
                            </PickerListItem>
                          ))
                        : fixedPeriodsForPicker.map(period => (
                            <PickerListItem
                              key={period.raw}
                              buttonStyle="secondary"
                              $active={draftPeriodValues.includes(period.raw)}
                              onClick={() => toggleDraftPeriodValue(period.raw)}
                            >
                              {period.label}
                            </PickerListItem>
                          ))}
                    </PickerList>
                  </PeriodPickerSection>
                </PeriodPickerPanel>
                <PeriodPickerPanel>
                  <PeriodPickerSection>
                    <PeriodPickerHeading>
                      {t('Selected Periods')}
                    </PeriodPickerHeading>
                    {!!draftPeriodValues.length && (
                      <PickerButtonRow>
                        <PickerListItem
                          buttonStyle="secondary"
                          onClick={() => setDraftPeriodValues([])}
                        >
                          {t('Clear selected')}
                        </PickerListItem>
                      </PickerButtonRow>
                    )}
                    <PickerList>
                      {draftPeriodValues.length ? (
                        draftPeriodValues
                          .slice()
                          .sort((a, b) => {
                            const parsedA = parsePeriodValue(a);
                            const parsedB = parsePeriodValue(b);
                            if (parsedA && parsedB) {
                              return parsedA.sortKey - parsedB.sortKey;
                            }
                            return a.localeCompare(b);
                          })
                          .map(periodValue => (
                            <PickerListItem
                              key={periodValue}
                              buttonStyle="secondary"
                              $active
                              onClick={() =>
                                handleRemoveDraftPeriodValue(periodValue)
                              }
                            >
                              {`${formatFilterValueLabel(periodValue)} x`}
                            </PickerListItem>
                          ))
                      ) : (
                        <div>{t('No periods selected')}</div>
                      )}
                    </PickerList>
                  </PeriodPickerSection>
                </PeriodPickerPanel>
              </PeriodPickerLayout>
            </Modal>
          </>
        )}
      </FormItem>
    </FilterPluginStyle>
  );
}
