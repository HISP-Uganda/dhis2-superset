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
import { useEffect, SetStateAction, Dispatch, useCallback } from 'react';
import { styled, t } from '@superset-ui/core';
import TableSelector, { TableOption } from 'src/components/TableSelector';
import { EmptyState } from '@superset-ui/core/components';
import { type DatabaseObject } from 'src/components';
import { useToasts } from 'src/components/MessageToasts/withToasts';
import { LocalStorageKeys, getItem } from 'src/utils/localStorageHelpers';
import {
  DatasetActionType,
  DatasetObject,
} from 'src/features/datasets/AddDataset/types';
import { Table } from 'src/hooks/apiResources';
import { Typography } from '@superset-ui/core/components/Typography';
import { useSingleViewResource } from 'src/views/CRUD/hooks';
import DHIS2ParameterBuilder, {
  parseSourceTable,
} from '../DHIS2ParameterBuilder';

interface LeftPanelProps {
  setDataset: Dispatch<SetStateAction<object>>;
  dataset?: Partial<DatasetObject> | null;
  datasetNames?: (string | null | undefined)[] | undefined;
}

const LeftPanelStyle = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 4}px;
    height: 100%;
    background-color: ${theme.colorBgContainer};
    position: relative;
    .emptystate {
      height: auto;
      margin-top: ${theme.sizeUnit * 17.5}px;
    }
    .section-title {
      margin-top: ${theme.sizeUnit * 5.5}px;
      margin-bottom: ${theme.sizeUnit * 11}px;
      font-weight: ${theme.fontWeightStrong};
    }
    .table-title {
      margin-top: ${theme.sizeUnit * 11}px;
      margin-bottom: ${theme.sizeUnit * 6}px;
      font-weight: ${theme.fontWeightStrong};
    }
    .options-list {
      overflow: auto;
      position: absolute;
      bottom: 0;
      top: ${theme.sizeUnit * 92.25}px;
      left: ${theme.sizeUnit * 3.25}px;
      right: 0;

      .no-scrollbar {
        margin-right: ${theme.sizeUnit * 4}px;
      }

      .options {
        cursor: pointer;
        padding: ${theme.sizeUnit * 1.75}px;
        border-radius: ${theme.borderRadius}px;
        :hover {
          background-color: ${theme.colorFillTertiary}
        }
      }

      .options-highlighted {
        cursor: pointer;
        padding: ${theme.sizeUnit * 1.75}px;
        border-radius: ${theme.borderRadius}px;
        background-color: ${theme.colorPrimaryText};
        color: ${theme.colorTextLightSolid};
      }

      .options, .options-highlighted {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
    }
    form > span[aria-label="refresh"] {
      position: absolute;
      top: ${theme.sizeUnit * 69}px;
      left: ${theme.sizeUnit * 42.75}px;
      font-size: ${theme.sizeUnit * 4.25}px;
    }
    .table-form {
      margin-bottom: ${theme.sizeUnit * 8}px;
    }
    .loading-container {
      position: absolute;
      top: ${theme.sizeUnit * 89.75}px;
      left: 0;
      right: 0;
      text-align: center;
      img {
        width: ${theme.sizeUnit * 20}px;
        margin-bottom: ${theme.sizeUnit * 2.5}px;
      }
      p {
        color: ${theme.colorTextSecondary};
      }
    }
    .staging-status {
      margin-top: ${theme.sizeUnit * 4}px;
      padding: ${theme.sizeUnit * 4}px;
      border-radius: ${theme.borderRadiusLG}px;
      border: 1px solid ${theme.colorBorderSecondary};
      background:
        linear-gradient(135deg, ${theme.colorBgElevated}, ${theme.colorBgLayout});
    }
    .staging-status-title {
      font-weight: ${theme.fontWeightStrong};
      margin-bottom: ${theme.sizeUnit * 1.5}px;
    }
    .staging-status-copy {
      color: ${theme.colorTextSecondary};
      margin-bottom: ${theme.sizeUnit * 1}px;
    }
`}
`;

export default function LeftPanel({
  setDataset,
  dataset,
  datasetNames,
}: LeftPanelProps) {
  const { addDangerToast } = useToasts();
  const { createResource } = useSingleViewResource<Partial<DatasetObject>>(
    'dataset',
    t('dataset'),
    addDangerToast,
  );

  const setDatabase = useCallback(
    (db: Partial<DatabaseObject>) => {
      setDataset({ type: DatasetActionType.SelectDatabase, payload: { db } });
    },
    [setDataset],
  );
  const setCatalog = (catalog: string | null) => {
    if (catalog) {
      setDataset({
        type: DatasetActionType.SelectCatalog,
        payload: { name: 'catalog', value: catalog },
      });
    }
  };
  const setSchema = (schema: string) => {
    if (schema) {
      setDataset({
        type: DatasetActionType.SelectSchema,
        payload: { name: 'schema', value: schema },
      });
    }
  };
  const setTable = (tableOrName: any | string) => {
    const tableName = typeof tableOrName === 'string' ? tableOrName : tableOrName?.value;
    setDataset({
      type: DatasetActionType.SelectTable,
      payload: { name: 'table_name', value: tableName },
    });
  };
  useEffect(() => {
    const currentUserSelectedDb = getItem(
      LocalStorageKeys.Database,
      null,
    ) as DatabaseObject;
    if (currentUserSelectedDb) {
      setDatabase(currentUserSelectedDb);
    }
  }, [setDatabase]);

  const customTableOptionLabelRenderer = useCallback(
    (table: Table) => (
      <TableOption
        table={
          datasetNames?.includes(table.value)
            ? {
                ...table,
                extra: {
                  warning_markdown: t('This table already has a dataset'),
                },
              }
            : table
        }
      />
    ),
    [datasetNames],
  );
  const getDatabaseEmptyState = (emptyResultsWithSearch: boolean) => (
    <EmptyState
      image="empty.svg"
      title={
        emptyResultsWithSearch
          ? t('No databases match your search')
          : t('No databases available')
      }
      description={
        <span>
          {t('Manage your databases')}{' '}
          <Typography.Link href="/databaseview/list">
            {t('here')}
          </Typography.Link>
        </span>
      }
      size="small"
    />
  );

  const isDHIS2Database =
    (dataset?.staging_source_type || dataset?.db?.backend) === 'dhis2';
  const showDHIS2QueryBuilder = isDHIS2Database && dataset?.table_name;
  const stagedSourceLabel =
    dataset?.staging_source_type === 'dhis2'
      ? t('DHIS2 federation')
      : dataset?.staging_source_type === 'sql_database'
        ? t('SQL database')
        : dataset?.staging_source_type;

  return (
    <LeftPanelStyle>
      <TableSelector
        database={dataset?.db}
        handleError={addDangerToast}
        emptyState={getDatabaseEmptyState(false)}
        onDbChange={setDatabase}
        onCatalogChange={setCatalog}
        onSchemaChange={setSchema}
        onTableSelectChange={setTable}
        sqlLabMode={false}
        customTableOptionLabelRenderer={customTableOptionLabelRenderer}
        {...(dataset?.catalog && { catalog: dataset.catalog })}
        {...(dataset?.schema && { schema: dataset.schema })}
      />

      {dataset?.staging_supported && dataset?.staging_source_type && (
        <div className="staging-status">
          <div className="staging-status-title">
            {t('Staged analytics available')}
          </div>
          <div className="staging-status-copy">
            {t('Source type: %s', stagedSourceLabel)}
          </div>
          <div className="staging-status-copy">
            {dataset?.staging_requires_instance_selection
              ? t(
                  'This connection uses the federated DHIS2 staging flow with explicit instance lineage.',
                )
              : t(
                  'This connection can use the generic local staging path for fast analytical serving.',
                )}
          </div>
          {dataset?.staging_background_refresh_forced && (
            <div className="staging-status-copy">
              {t(
                'Background refresh is enforced for staged datasets and cannot be disabled per dataset.',
              )}
            </div>
          )}
        </div>
      )}

      {showDHIS2QueryBuilder && (
        <div style={{ marginTop: 20 }}>
          <DHIS2ParameterBuilder
            databaseId={dataset.db?.id}
            endpoint={dataset.table_name}
            initialDatasetName={dataset.table_name || undefined}
            onParametersChange={(parameters: Record<string, string>) => {
              console.log('DHIS2 Parameters generated:', parameters);
              setDataset({
                type: DatasetActionType.SetDHIS2Parameters,
                payload: { parameters },
              });
            }}
            onColumnsChange={(
              columns: Array<{ name: string; type: string }>,
            ) => {
              console.log('DHIS2 Columns generated:', columns);
              setDataset({
                type: DatasetActionType.SetDHIS2Columns,
                payload: { columns },
              });
            }}
            onDatasetNameChange={(name: string) => {
              console.log('DHIS2 Dataset name changed:', name);
              // Store the custom name in dataset_name field
              // DO NOT change table_name - it must remain as the source table (e.g., "analytics")
              setDataset({
                type: DatasetActionType.ChangeDataset,
                payload: { name: 'dataset_name', value: name },
              });
            }}
            onSave={async () => {
              if (!dataset) {
                return;
              }

              const datasetIdentifier =
                dataset.dataset_name || dataset.table_name;

              const data: any = {
                database: dataset.db?.id,
                catalog: dataset.catalog,
                schema: dataset.schema,
                table_name: datasetIdentifier,
              };

              if (dataset.dhis2_parameters) {
                const sourceTable =
                  parseSourceTable(datasetIdentifier) || dataset.table_name;
                const paramsStr = Object.entries(dataset.dhis2_parameters)
                  .map(([key, value]) => `${key}=${value}`)
                  .join('&');

                data.sql = `SELECT * FROM ${sourceTable}\n/* DHIS2: table=${sourceTable}&${paramsStr} */`;
                console.log(
                  '[DHIS2] Creating dataset:',
                  datasetIdentifier,
                  'from source table:',
                  sourceTable,
                );
                console.log('[DHIS2] SQL:', data.sql);
              }

              try {
                const response = await createResource(data);
                if (response && typeof response === 'number') {
                  console.log('[DHIS2] Dataset created with ID:', response);
                }
              } catch (error) {
                console.error('[DHIS2] Failed to create dataset:', error);
              }
            }}
          />
        </div>
      )}
    </LeftPanelStyle>
  );
}
