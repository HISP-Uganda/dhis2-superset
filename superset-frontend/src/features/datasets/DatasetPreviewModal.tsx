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
import { Modal, Table, Spin, Empty, Space, Button, Tooltip } from 'antd';
import { styled, t } from '@superset-ui/core';
import { getDatasourceSamples } from 'src/components/Chart/chartAction';
import { DHIS2DataLoader } from 'src/visualizations/DHIS2Map/dhis2DataLoader';

interface Dataset {
  id: number;
  table_name: string;
  kind: string;
  schema: string;
  database: {
    id: number | string;
    database_name: string;
  };
  sql?: string;
}

interface DatasetPreviewModalProps {
  dataset: Dataset | null;
  onClose: () => void;
}

const ModalContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 600px;
`;

const TableContainer = styled.div`
  overflow-y: auto;
  flex: 1;
  border: 1px solid ${({ theme }) => theme.colorBorder};
  border-radius: 4px;
`;

const StatsContainer = styled.div`
  display: flex;
  gap: 24px;
  font-size: 12px;
  color: ${({ theme }) => theme.colorText};
  padding: 8px 0;
`;

const InfoText = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colorTextSecondary};
  margin-bottom: 8px;
`;

const ErrorMessage = styled.div`
  padding: 12px;
  background-color: ${({ theme }) => theme.colorErrorBg};
  color: ${({ theme }) => theme.colorError};
  border-radius: 4px;
  font-size: 12px;
`;

export const DatasetPreviewModal = ({
  dataset,
  onClose,
}: DatasetPreviewModalProps) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState(0);

  const isDHIS2Dataset = useMemo(
    () =>
      dataset?.sql &&
      (dataset.sql.includes('/* DHIS2:') || dataset.sql.includes('-- DHIS2:')),
    [dataset],
  );

  const fetchData = useCallback(async () => {
    if (!dataset) return;

    setLoading(true);
    setError(null);

    try {
      if (isDHIS2Dataset && dataset.database) {
        const result = await DHIS2DataLoader.fetchChartData(
          Number(dataset.database.id),
          dataset.sql || '',
          1000,
        );

        if (result) {
          setData(result.rows);
          setColumns(result.columns);
          setRowCount(result.total);
        }
      } else {
        const result = await getDatasourceSamples(
          'table',
          dataset.id,
          false,
          {},
          100,
          1,
        );

        if (result) {
          const colnames = result.colnames || [];
          const coldata = result.data || [];

          const cols = colnames.map((name: string, idx: number) => ({
            key: name,
            dataIndex: name,
            title: name,
            ellipsis: true,
            render: (value: any) => {
              if (value === null || value === undefined) {
                return '-';
              }
              return String(value).substring(0, 100);
            },
          }));

          const rows = coldata.map((row: any, idx: number) => {
            const rowObject: Record<string, any> = {};

            if (Array.isArray(row)) {
              colnames.forEach((name: string, columnIndex: number) => {
                rowObject[name] = row[columnIndex];
              });
            } else if (row && typeof row === 'object') {
              colnames.forEach((name: string) => {
                rowObject[name] = row[name];
              });
            }

            return {
              ...rowObject,
              key: `row-${idx}`,
            };
          });

          setColumns(cols);
          setData(rows);
          setRowCount(result.rowcount || coldata.length);
        }
      }
    } catch (err: any) {
      setError(err.message || t('Failed to load dataset preview'));
    } finally {
      setLoading(false);
    }
  }, [dataset, isDHIS2Dataset]);

  useEffect(() => {
    if (dataset && dataset.id) {
      fetchData();
    }
  }, [dataset, fetchData]);

  if (!dataset) {
    return null;
  }

  return (
    <Modal
      title={t('Preview: %s', dataset.table_name)}
      open
      onCancel={onClose}
      width="90%"
      style={{ maxWidth: '1400px' }}
      footer={[
        <Button key="close" onClick={onClose}>
          {t('Close')}
        </Button>,
      ]}
    >
      <ModalContent>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <InfoText>
              {t('Database')}: {dataset.database?.database_name} | {t('Schema')}
              : {dataset.schema} | {t('Type')}: {dataset.kind}
            </InfoText>
          </div>

          {error && <ErrorMessage>{error}</ErrorMessage>}

          {loading ? (
            <Spin />
          ) : data.length === 0 ? (
            <Empty description={t('No data available')} />
          ) : (
            <>
              <StatsContainer>
                <div>
                  <Tooltip title={t('Rows shown in preview')}>
                    <span>
                      {t('Showing')}: {data.length} {t('rows')}
                    </span>
                  </Tooltip>
                </div>
                <div>
                  <Tooltip title={t('Total rows available')}>
                    <span>
                      {t('Total')}: {rowCount} {t('rows')}
                    </span>
                  </Tooltip>
                </div>
                <div>
                  <Tooltip title={t('Number of columns')}>
                    <span>
                      {t('Columns')}: {columns.length}
                    </span>
                  </Tooltip>
                </div>
              </StatsContainer>

              <TableContainer>
                <Table
                  columns={columns}
                  dataSource={data}
                  size="small"
                  pagination={false}
                  scroll={{ x: 'max-content', y: 400 }}
                  rowKey="key"
                />
              </TableContainer>
            </>
          )}
        </Space>
      </ModalContent>
    </Modal>
  );
};
