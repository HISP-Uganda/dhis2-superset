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
 * DHIS2ColumnFilterControl
 *
 * A unified filter control for DHIS2 staged datasets.  Users pick any column
 * from the dataset, and the control immediately fetches its distinct values
 * from the backend — no page-reload required, no free-form typing needed.
 *
 * For period columns (dhis2_is_period: true in column extra) the raw DHIS2
 * period codes are displayed with their human-readable label:
 *   202501  →  "January 2025  (202501)"
 *   2025Q1  →  "January – March 2025  (2025Q1)"
 *
 * Multiple column filters are supported simultaneously.  The value stored in
 * formData is an array of {column, values} objects:
 *
 *   [
 *     { column: "period", values: ["2024Q1", "2024Q2"] },
 *     { column: "ou_level_2", values: ["Uganda/Kampala"] }
 *   ]
 *
 * buildQuery.ts translates each entry to a WHERE col IN (...) SQL filter.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { t, SupersetClient, periodSelectLabel } from '@superset-ui/core';
import { Select, Button, Spin, Tooltip } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import styled from '@emotion/styled';
import {
  detectDHIS2Kind,
  DHIS2ColumnTag,
} from '@superset-ui/chart-controls/components/ColumnTypeLabel/DHIS2ColumnTag';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DHIS2ColumnFilter {
  column: string;
  values: string[];
}

interface DatasourceColumn {
  column_name: string;
  verbose_name?: string;
  is_dttm?: boolean;
  extra?: string | Record<string, unknown>;
}

interface Props {
  /** Current value stored in formData. */
  value: DHIS2ColumnFilter[];
  /** Called when the user changes filters — updates formData. */
  onChange: (value: DHIS2ColumnFilter[]) => void;
  /** Datasource object injected via mapStateToProps. */
  datasource?: {
    columns?: DatasourceColumn[];
    extra?: string | Record<string, unknown>;
  };
  label?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDatasourceExtra(
  extra: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!extra) return {};
  if (typeof extra === 'string') {
    try {
      return JSON.parse(extra) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return extra as Record<string, unknown>;
}

function parseColumnExtra(
  extra: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  return parseDatasourceExtra(extra);
}

function getStagedDatasetId(datasource: Props['datasource']): number | null {
  const extra = parseDatasourceExtra(datasource?.extra);
  const raw =
    (extra as any)?.dhis2_staged_dataset_id ??
    (extra as any)?.dhis2StagedDatasetId ??
    null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isPeriodColumn(col: DatasourceColumn): boolean {
  const extra = parseColumnExtra(col.extra);
  return (
    (extra as any)?.dhis2_is_period === true ||
    (extra as any)?.dhis2IsPeriod === true
  );
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function colCacheKey(datasetId: number, column: string): string {
  return `dhis2_colvals_sds${datasetId}_col_${column}`;
}

function readCache(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: string[]; ts: number };
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return Array.isArray(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FilterRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  background: #fafafa;
`;

const FilterRowHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const ColumnLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;

const AddButton = styled(Button)`
  width: 100%;
  border-style: dashed;
`;

const EmptyHint = styled.div`
  font-size: 12px;
  color: #aaa;
  text-align: center;
  padding: 4px 0;
`;

// ---------------------------------------------------------------------------
// Sub-component: one active filter row
// ---------------------------------------------------------------------------

interface FilterEntryProps {
  filter: DHIS2ColumnFilter;
  stagedDatasetId: number | null;
  /** When true, values are formatted using DHIS2 period labels. */
  isPeriod: boolean;
  onValuesChange: (values: string[]) => void;
  onRemove: () => void;
  /** Full column metadata for badge + verbose name display. */
  columnMeta?: DatasourceColumn;
}

const FilterEntry: React.FC<FilterEntryProps> = ({
  filter,
  stagedDatasetId,
  isPeriod,
  onValuesChange,
  onRemove,
  columnMeta,
}) => {
  const [rawOptions, setRawOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!filter.column || !stagedDatasetId) return;
    if (fetchedRef.current) return;

    const key = colCacheKey(stagedDatasetId, filter.column);
    const cached = readCache(key);
    if (cached) {
      setRawOptions(cached);
      fetchedRef.current = true;
      return;
    }

    fetchedRef.current = true;
    setLoading(true);
    SupersetClient.get({
      endpoint: `/api/v1/dhis2/staged-datasets/${stagedDatasetId}/column-values?column=${encodeURIComponent(filter.column)}`,
    })
      .then(resp => {
        const vals: string[] = resp.json?.result || [];
        setRawOptions(vals);
        writeCache(key, vals);
      })
      .catch(() => {
        // User can still type values if fetch fails
      })
      .finally(() => setLoading(false));
  }, [filter.column, stagedDatasetId]);

  // Build Ant Design Select options — for period columns show human-readable
  // label alongside the raw code so users recognise both forms.
  const options = rawOptions.map(v => ({
    value: v,
    label: isPeriod ? periodSelectLabel(v) : v,
    // Keep the raw code searchable even when the label differs
    title: v,
  }));

  const dhis2Kind = detectDHIS2Kind(columnMeta?.extra);
  const displayLabel =
    columnMeta?.verbose_name || columnMeta?.column_name || filter.column;

  return (
    <FilterRow>
      <FilterRowHeader>
        <ColumnLabel
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {dhis2Kind && <DHIS2ColumnTag kind={dhis2Kind} />}
          {displayLabel}
        </ColumnLabel>
        <Tooltip title={t('Remove filter')}>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onRemove}
          />
        </Tooltip>
      </FilterRowHeader>
      <Spin spinning={loading} size="small">
        <Select
          mode="multiple"
          allowClear
          showSearch
          style={{ width: '100%' }}
          placeholder={
            loading ? t('Loading values…') : t('Select values to filter by')
          }
          value={filter.values}
          onChange={onValuesChange}
          options={options}
          // Search against both the formatted label and the raw code
          filterOption={(input, option) => {
            const q = input.toLowerCase();
            return (
              String(option?.value || '').toLowerCase().includes(q) ||
              String(option?.label || '').toLowerCase().includes(q)
            );
          }}
          // Render currently-selected tags with the formatted label too
          tagRender={
            isPeriod
              ? ({ value: v, closable, onClose }) => (
                  <span
                    className="ant-select-selection-item"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      marginRight: 4,
                    }}
                  >
                    {periodSelectLabel(String(v))}
                    {closable && (
                      <CloseOutlined
                        style={{ fontSize: 10, cursor: 'pointer' }}
                        onClick={onClose}
                      />
                    )}
                  </span>
                )
              : undefined
          }
          notFoundContent={
            loading ? null : (
              <span style={{ fontSize: 12, color: '#aaa' }}>
                {stagedDatasetId
                  ? t('No values found')
                  : t('No staged dataset linked')}
              </span>
            )
          }
        />
      </Spin>
    </FilterRow>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: column picker for adding a new filter
// ---------------------------------------------------------------------------

interface ColumnPickerProps {
  columns: DatasourceColumn[];
  existingColumns: Set<string>;
  onSelect: (column: string) => void;
  onCancel: () => void;
}

const ColumnPicker: React.FC<ColumnPickerProps> = ({
  columns,
  existingColumns,
  onSelect,
  onCancel,
}) => {
  const available = columns.filter(
    c => c.column_name && !existingColumns.has(c.column_name),
  );
  return (
    <FilterRow>
      <FilterRowHeader>
        <ColumnLabel>{t('Select a column to filter')}</ColumnLabel>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onCancel}
        />
      </FilterRowHeader>
      <Select
        autoFocus
        showSearch
        style={{ width: '100%' }}
        placeholder={t('Choose column…')}
        options={available.map(c => ({
          label: c.verbose_name || c.column_name,
          value: c.column_name,
          extra: c.extra,
        }))}
        onSelect={(val: string) => onSelect(val)}
        filterOption={(input, option) =>
          String(option?.label || '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }
        optionRender={option => {
          const kind = detectDHIS2Kind(
            (option.data as { extra?: unknown }).extra,
          );
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {kind && <DHIS2ColumnTag kind={kind} />}
              {option.label}
            </span>
          );
        }}
        notFoundContent={
          <span style={{ fontSize: 12, color: '#aaa' }}>
            {t('All columns already filtered')}
          </span>
        }
      />
    </FilterRow>
  );
};

// ---------------------------------------------------------------------------
// Main control
// ---------------------------------------------------------------------------

const DHIS2ColumnFilterControl: React.FC<Props> = ({
  value,
  onChange,
  datasource,
}) => {
  const [addingFilter, setAddingFilter] = useState(false);

  const safeValue: DHIS2ColumnFilter[] = Array.isArray(value) ? value : [];
  const stagedDatasetId = getStagedDatasetId(datasource);
  const columns: DatasourceColumn[] = Array.isArray(datasource?.columns)
    ? (datasource.columns as DatasourceColumn[])
    : [];

  // Pre-build a lookup of column name → isPeriod flag
  const periodColumnSet = new Set(
    columns.filter(isPeriodColumn).map(c => c.column_name),
  );

  const existingColumns = new Set(safeValue.map(f => f.column));

  const handleAddColumn = useCallback(
    (column: string) => {
      setAddingFilter(false);
      onChange([...safeValue, { column, values: [] }]);
    },
    [safeValue, onChange],
  );

  const handleValuesChange = useCallback(
    (idx: number, values: string[]) => {
      const updated = safeValue.map((f, i) =>
        i === idx ? { ...f, values } : f,
      );
      onChange(updated);
    },
    [safeValue, onChange],
  );

  const handleRemove = useCallback(
    (idx: number) => {
      onChange(safeValue.filter((_, i) => i !== idx));
    },
    [safeValue, onChange],
  );

  const columnByName = React.useMemo(
    () =>
      Object.fromEntries(columns.map(c => [c.column_name, c])) as Record<
        string,
        DatasourceColumn
      >,
    [columns],
  );

  return (
    <Root>
      {safeValue.map((filter, idx) => (
        <FilterEntry
          // eslint-disable-next-line react/no-array-index-key
          key={`${filter.column}-${idx}`}
          filter={filter}
          stagedDatasetId={stagedDatasetId}
          isPeriod={periodColumnSet.has(filter.column)}
          onValuesChange={values => handleValuesChange(idx, values)}
          onRemove={() => handleRemove(idx)}
          columnMeta={columnByName[filter.column]}
        />
      ))}

      {addingFilter ? (
        <ColumnPicker
          columns={columns}
          existingColumns={existingColumns}
          onSelect={handleAddColumn}
          onCancel={() => setAddingFilter(false)}
        />
      ) : (
        <AddButton
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => setAddingFilter(true)}
          disabled={columns.length === 0}
        >
          {t('Add Column Filter')}
        </AddButton>
      )}

      {safeValue.length === 0 && !addingFilter && (
        <EmptyHint>{t('No filters applied — all data shown')}</EmptyHint>
      )}
    </Root>
  );
};

export default DHIS2ColumnFilterControl;
