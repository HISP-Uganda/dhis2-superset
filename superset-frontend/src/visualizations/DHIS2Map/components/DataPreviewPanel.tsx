import React, { useState } from 'react';
import { styled } from '@superset-ui/core';

const PanelWrapper = styled.div`
  position: absolute;
  bottom: 20px;
  left: 20px;
  background: white;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  max-width: 600px;
  max-height: 400px;
  overflow: auto;
  z-index: 4;
  font-size: 12px;

  .panel-header {
    padding: 8px 12px;
    background: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
    font-weight: 600;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-body {
    padding: 8px 12px;
    max-height: 350px;
    overflow-y: auto;
  }

  .close-btn {
    cursor: pointer;
    font-size: 16px;
    background: none;
    border: none;
    padding: 0;
    color: #666;

    &:hover {
      color: #000;
    }
  }

  .data-row {
    padding: 6px 0;
    border-bottom: 1px solid #f0f0f0;
    word-break: break-word;

    &:last-child {
      border-bottom: none;
    }
  }

  .row-index {
    font-weight: 600;
    color: #666;
    margin-bottom: 2px;
  }

  .row-content {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 12px;
  }

  .col-name {
    font-weight: 500;
    color: #444;
  }

  .col-value {
    color: #666;
    font-family: 'Courier New', monospace;

    &.null {
      color: #d9534f;
      font-style: italic;
    }

    &.zero {
      color: #5cb85c;
    }
  }

  .empty-msg {
    padding: 12px;
    text-align: center;
    color: #999;
  }
`;

interface DataPreviewPanelProps {
  data: Record<string, any>[] | null;
  loading: boolean;
  onClose: () => void;
}

export function DataPreviewPanel({
  data,
  loading,
  onClose,
}: DataPreviewPanelProps): React.ReactElement | null {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  if (!data || data.length === 0) {
    return null;
  }

  const toggleRow = (idx: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(idx)) {
      newExpanded.delete(idx);
    } else {
      newExpanded.add(idx);
    }
    setExpandedRows(newExpanded);
  };

  const sampleRows = data.slice(0, 10);

  return (
    <PanelWrapper>
      <div className="panel-header">
        <span>
          Data Preview ({sampleRows.length} rows of {data.length})
        </span>
        <button className="close-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body">
        {sampleRows.length === 0 ? (
          <div className="empty-msg">No data to display</div>
        ) : (
          sampleRows.map((row, idx) => (
            <div key={idx} className="data-row">
              <div className="row-index">
                Row {idx + 1}
                {!expandedRows.has(idx) && (
                  <span style={{ marginLeft: '8px', cursor: 'pointer', color: '#0066cc' }}>
                    [click to expand]
                  </span>
                )}
              </div>
              {expandedRows.has(idx) && (
                <div className="row-content">
                  {Object.entries(row).map(([key, value]) => (
                    <div key={key}>
                      <div className="col-name">{key}:</div>
                      <div
                        className={`col-value ${
                          value === null || value === undefined
                            ? 'null'
                            : value === 0
                              ? 'zero'
                              : ''
                        }`}
                      >
                        {value === null || value === undefined
                          ? 'NULL'
                          : String(value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                style={{
                  padding: '2px 6px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  marginTop: '4px',
                }}
                onClick={() => toggleRow(idx)}
              >
                {expandedRows.has(idx) ? 'Collapse' : 'Expand'}
              </button>
            </div>
          ))
        )}
      </div>
    </PanelWrapper>
  );
};

export default DataPreviewPanel;
