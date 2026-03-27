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
import { useMemo, useEffect, useRef, RefObject } from 'react';
import { css, styled, t, useTheme } from '@superset-ui/core';
import { Column } from 'react-table';
import { debounce } from 'lodash';
import { Constants, Button, Icons, Input } from '@superset-ui/core/components';
import { CopyToClipboard } from 'src/components/CopyToClipboard';
import { prepareCopyToClipboardTabularData } from 'src/utils/common';

export const CopyButton = styled(Button)`
  font-size: ${({ theme }) => theme.fontSizeSM}px;

  // needed to override button's first-of-type margin: 0
  && {
    margin: 0 ${({ theme }) => theme.sizeUnit * 2}px;
  }

  i {
    padding: 0 ${({ theme }) => theme.sizeUnit}px;
  }
`;

export const CopyToClipboardButton = ({
  data,
  columns,
}: {
  data?: Record<string, any>;
  columns?: string[];
}) => (
  <CopyToClipboard
    text={
      data && columns ? prepareCopyToClipboardTabularData(data, columns) : ''
    }
    wrapped={false}
    copyNode={
      <Icons.CopyOutlined
        iconSize="l"
        aria-label={t('Copy')}
        role="button"
        css={css`
          &.anticon > * {
            line-height: 0;
          }
        `}
      />
    }
  />
);

export const FilterInput = ({
  onChangeHandler,
  shouldFocus = false,
}: {
  onChangeHandler(filterText: string): void;
  shouldFocus?: boolean;
}) => {
  const inputRef: RefObject<any> = useRef(null);

  useEffect(() => {
    // Focus the input element when the component mounts
    if (inputRef.current && shouldFocus) {
      inputRef.current.focus();
    }
  }, [shouldFocus]);

  const theme = useTheme();
  const debouncedChangeHandler = debounce(
    onChangeHandler,
    Constants.SLOW_DEBOUNCE,
  );
  return (
    <Input
      prefix={<Icons.SearchOutlined iconSize="l" />}
      placeholder={t('Search')}
      onChange={(event: any) => {
        const filterText = event.target.value;
        debouncedChangeHandler(filterText);
      }}
      css={css`
        width: 200px;
        margin-right: ${theme.sizeUnit * 2}px;
      `}
      ref={inputRef}
    />
  );
};

// Utility to sanitize column names consistently
// MUST match Python's sanitize_dhis2_column_name in dhis2_dialect.py
function sanitizeColumnName(name: string): string {
  let sanitized = name;
  // Replace dots with underscores
  sanitized = sanitized.replace(/\./g, '_');
  // Replace multiple spaces with single underscore
  sanitized = sanitized.replace(/\s+/g, '_');
  // Remove parentheses
  sanitized = sanitized.replace(/[()]/g, '');
  // Replace dashes with underscores (DHIS2 specific)
  sanitized = sanitized.replace(/-/g, '_');
  // Collapse multiple underscores into one
  sanitized = sanitized.replace(/_+/g, '_');
  // Remove leading/trailing underscores
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  return sanitized;
}

export const useFilteredTableData = (
  filterText: string,
  data?: Record<string, any>[],
) => {
  const rowsAsStrings = useMemo(
    () =>
      data?.map((row: Record<string, any>) =>
        Object.values(row).map(value =>
          value !== null && value !== undefined
            ? value.toString().toLowerCase()
            : t('N/A'),
        ),
      ) ?? [],
    [data],
  );

  return useMemo(() => {
    if (!data?.length || !filterText) {
      return data || [];
    }
    return data.filter((_, index: number) =>
      rowsAsStrings[index].some(value =>
        value?.includes(filterText.toLowerCase()),
      ),
    );
  }, [data, filterText, rowsAsStrings]);
};

export const useTableColumns = (
  colnames?: string[],
  coltypes?: any[],
  data?: Record<string, any>[],
  datasourceId?: string,
  isVisible?: boolean,
  moreConfigs?: { [key: string]: Partial<Column> },
) => {
  const theme = useTheme();

  return useMemo(() => {
    if (!colnames || !data?.length) {
      return [];
    }

    // Build a map of sanitized keys to original keys for faster lookups
    const keyMap = new Map<string, string>();
    colnames.forEach(originalKey => {
      const sanitized = sanitizeColumnName(originalKey);
      keyMap.set(sanitized, originalKey);
    });

    return colnames.map((key, index) => {
      const sanitizedKey = sanitizeColumnName(key);
      return {
        id: sanitizedKey || index,
        // Header is required for react-table to display column headers
        Header: key,
        accessor: (row: Record<string, any> | any[]) => {
          if (Array.isArray(row)) {
            const colIndex = colnames?.findIndex(
              cn => sanitizeColumnName(cn) === sanitizedKey,
            );
            return colIndex !== undefined && colIndex > -1
              ? row[colIndex]
              : undefined;
          }
          // Try original key first (most reliable for DHIS2)
          if (row[key] !== undefined) return row[key];
          // Try sanitized key if data was already sanitized
          if (row[sanitizedKey] !== undefined) return row[sanitizedKey];
          // Try to find by comparing sanitized versions of all keys
          const foundKey = Object.keys(row).find(
            k => sanitizeColumnName(k) === sanitizedKey,
          );
          if (foundKey) return row[foundKey];
          return undefined;
        },
        Cell: ({ value, row }: { value: unknown; row: any }) => {
          let displayValue = value;

          if (displayValue === undefined && row && row.original) {
            // Try to find value in row.original using same strategy as accessor
            if (row.original[key] !== undefined)
              displayValue = row.original[key];
            else if (row.original[sanitizedKey] !== undefined)
              displayValue = row.original[sanitizedKey];
            else {
              const foundKey = Object.keys(row.original).find(
                k => sanitizeColumnName(k) === sanitizedKey,
              );
              if (foundKey) displayValue = row.original[foundKey];
            }
          }

          if (displayValue === true) {
            return Constants.BOOL_TRUE_DISPLAY;
          }
          if (displayValue === false) {
            return Constants.BOOL_FALSE_DISPLAY;
          }
          if (displayValue === null || displayValue === undefined) {
            return (
              <span style={{ color: theme.colorTextTertiary }}>
                {Constants.NULL_DISPLAY}
              </span>
            );
          }
          if (typeof displayValue === 'object') {
            if (displayValue instanceof Response) {
              return `Response: ${displayValue.status} ${displayValue.url || ''}`;
            }
            try {
              return (
                <pre
                  style={{
                    maxWidth: 300,
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    padding: 0,
                  }}
                >
                  {JSON.stringify(displayValue, null, 2)}
                </pre>
              );
            } catch (e) {
              return '[object Object]';
            }
          }
          return String(displayValue);
        },
        ...moreConfigs?.[sanitizedKey],
      };
    });
  }, [colnames, data, moreConfigs, theme]);
};
