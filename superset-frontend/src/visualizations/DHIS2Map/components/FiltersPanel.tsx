import React, { useMemo } from 'react';
import { styled, t } from '@superset-ui/core';
import { Select, Button } from 'antd';
import { CloseOutlined, FilterOutlined } from '@ant-design/icons';

const PanelWrapper = styled.div`
  position: relative;
  width: 100%;
  max-height: 260px;
  overflow: auto;
  background: #ffffff;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  font-size: 12px;

  .panel-header {
    padding: 10px 12px;
    background: rgba(248, 250, 252, 0.92);
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    font-weight: 600;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-body {
    padding: 12px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px 16px;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .filter-label {
    font-weight: 600;
    color: #444;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.5px;
  }

  .close-btn {
    cursor: pointer;
    font-size: 14px;
    background: none;
    border: none;
    padding: 0;
    color: #666;

    &:hover {
      color: #000;
    }
  }

  .panel-actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-start;
  }
`;

interface FiltersPanelProps {
  data: Record<string, any>[];
  columns: string[];
  filters: Record<string, string[]>;
  onChange: (column: string, values: string[]) => void;
  onClose: () => void;
}

export function FiltersPanel({
  data,
  columns,
  filters,
  onChange,
  onClose,
}: FiltersPanelProps): React.ReactElement | null {
  const columnValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    columns.forEach(col => {
      const values = Array.from(
        new Set(data.map(row => String(row[col] ?? '')).filter(Boolean)),
      ).sort();
      map[col] = values;
    });
    return map;
  }, [data, columns]);

  if (columns.length === 0) {
    return null;
  }

  return (
    <PanelWrapper>
      <div className="panel-header">
        <span>
          <FilterOutlined style={{ marginRight: 8 }} />
          {t('Quick Filters')}
        </span>
        <button className="close-btn" onClick={onClose}>
          <CloseOutlined />
        </button>
      </div>
      <div className="panel-body">
        {columns.map(col => (
          <div key={col} className="filter-group">
            <div className="filter-label">{col.replace(/_/g, ' ')}</div>
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder={t('All values')}
              value={filters[col] || []}
              onChange={values => onChange(col, values)}
              options={(columnValues[col] || []).map(v => ({
                label: v,
                value: v,
              }))}
              maxTagCount="responsive"
            />
          </div>
        ))}
        {Object.keys(filters).length > 0 && (
          <div className="panel-actions">
            <Button
              size="small"
              type="link"
              onClick={() => {
                columns.forEach(col => onChange(col, []));
              }}
              style={{ padding: 0, textAlign: 'left', width: 'fit-content' }}
            >
              {t('Clear all filters')}
            </Button>
          </div>
        )}
      </div>
    </PanelWrapper>
  );
}

export default FiltersPanel;
