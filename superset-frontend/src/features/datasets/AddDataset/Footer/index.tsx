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
import { useHistory } from 'react-router-dom';
import {
  Button,
  DropdownButton,
  Menu,
  Flex,
} from '@superset-ui/core/components';
import { t, useTheme } from '@superset-ui/core';
import { Icons } from '@superset-ui/core/components/Icons';
import { useSingleViewResource } from 'src/views/CRUD/hooks';
import { logEvent } from 'src/logger/actions';
import withToasts from 'src/components/MessageToasts/withToasts';
import {
  LOG_ACTIONS_DATASET_CREATION_EMPTY_CANCELLATION,
  LOG_ACTIONS_DATASET_CREATION_DATABASE_CANCELLATION,
  LOG_ACTIONS_DATASET_CREATION_SCHEMA_CANCELLATION,
  LOG_ACTIONS_DATASET_CREATION_TABLE_CANCELLATION,
  LOG_ACTIONS_DATASET_CREATION_SUCCESS,
} from 'src/logger/LogUtils';
import { DatasetObject } from '../types';
import { parseSourceTable } from '../DHIS2ParameterBuilder';
import refreshDatasetMetadata from '../refreshDatasetMetadata';

interface FooterProps {
  url: string;
  addDangerToast: () => void;
  datasetObject?: Partial<DatasetObject> | null;
  onDatasetAdd?: (dataset: DatasetObject) => void;
  hasColumns?: boolean;
  datasets?: (string | null | undefined)[] | undefined;
}

const INPUT_FIELDS = ['db', 'schema', 'table_name'];
const LOG_ACTIONS = [
  LOG_ACTIONS_DATASET_CREATION_EMPTY_CANCELLATION,
  LOG_ACTIONS_DATASET_CREATION_DATABASE_CANCELLATION,
  LOG_ACTIONS_DATASET_CREATION_SCHEMA_CANCELLATION,
  LOG_ACTIONS_DATASET_CREATION_TABLE_CANCELLATION,
];

function Footer({
  datasetObject,
  addDangerToast,
  hasColumns = false,
  datasets,
}: FooterProps) {
  const history = useHistory();
  const theme = useTheme();
  const { createResource } = useSingleViewResource<Partial<DatasetObject>>(
    'dataset',
    t('dataset'),
    addDangerToast,
  );

  const createLogAction = (dataset: Partial<DatasetObject>) => {
    let totalCount = 0;
    const value = Object.keys(dataset).reduce((total, key) => {
      if (INPUT_FIELDS.includes(key) && dataset[key as keyof DatasetObject]) {
        totalCount += 1;
      }
      return totalCount;
    }, 0);

    return LOG_ACTIONS[value];
  };

  const cancelButtonOnClick = () => {
    if (!datasetObject) {
      logEvent(LOG_ACTIONS_DATASET_CREATION_EMPTY_CANCELLATION, {});
    } else {
      const logAction = createLogAction(datasetObject);
      logEvent(logAction, datasetObject);
    }
    history.goBack();
  };

  const tooltipText = t('Select a database table.');

  const triggerBackgroundDatasetLoad = async (datasetId: number) => {
    try {
      // Trigger background dataset load via refresh endpoint
      // This will load the dataset data without blocking the UI
      await refreshDatasetMetadata(datasetId);
      console.log(
        '[Background Load] Dataset refresh initiated for ID:',
        datasetId,
      );
    } catch (error) {
      console.warn('[Background Load] Failed to trigger refresh:', error);
    }
  };

  const onSave = (createChart: boolean = true) => {
    if (datasetObject) {
      // For DHIS2 datasets: Use dataset_name (custom name like "analytics_version2")
      // Parse the source table from it (e.g., "analytics")
      const datasetIdentifier =
        datasetObject.dataset_name || datasetObject.table_name;

      const data: any = {
        database: datasetObject.db?.id,
        catalog: datasetObject.catalog,
        schema: datasetObject.schema,
        table_name: datasetIdentifier, // User's custom name (e.g., "analytics_malaria_20250110")
      };

      // Include DHIS2 parameters in SQL if present
      if (datasetObject.dhis2_parameters) {
        // Parse the source table from the dataset name
        // Example: "analytics_version2" -> "analytics"
        const sourceTable =
          parseSourceTable(datasetIdentifier) || datasetObject.table_name;

        // Embed both source table and parameters in SQL comment
        const paramsStr = Object.entries(datasetObject.dhis2_parameters)
          .map(([key, value]) => `${key}=${value}`)
          .join('&');

        // SQL includes source table in FROM clause and comment
        data.sql = `SELECT * FROM ${sourceTable}\n/* DHIS2: table=${sourceTable}&${paramsStr} */`;
        console.log(
          '[DHIS2] Creating dataset:',
          datasetIdentifier,
          'from source table:',
          sourceTable,
        );
        console.log('[DHIS2] SQL:', data.sql);
      }

      createResource(data).then(response => {
        if (!response) {
          return;
        }
        if (typeof response === 'number') {
          logEvent(LOG_ACTIONS_DATASET_CREATION_SUCCESS, datasetObject);
          // When a dataset is created the response we get is its ID number
          const datasetId = response;

          // Trigger background loading of the dataset to populate its cache
          // This happens asynchronously in the background without blocking the UI
          triggerBackgroundDatasetLoad(datasetId);

          if (createChart) {
            history.push(`/chart/add/?dataset=${datasetId}`);
          } else {
            history.push('/tablemodelview/list/');
          }
        }
      });
    }
  };

  const onSaveOnly = () => {
    onSave(false);
  };

  const CREATE_DATASET_TEXT = t('Create and explore dataset');
  const CREATE_DATASET_ONLY_TEXT = t('Create dataset');
  const disabledCheck =
    !datasetObject?.table_name ||
    !hasColumns ||
    datasets?.includes(datasetObject?.table_name);

  return (
    <Flex align="center" justify="flex-end" gap="8px">
      <Button buttonStyle="secondary" onClick={cancelButtonOnClick}>
        {t('Cancel')}
      </Button>
      <DropdownButton
        type="primary"
        disabled={disabledCheck}
        tooltip={!datasetObject?.table_name ? tooltipText : undefined}
        onClick={() => onSave(true)}
        popupRender={() => (
          <Menu
            items={[
              {
                key: 'create-only',
                onClick: onSaveOnly,
                label: CREATE_DATASET_ONLY_TEXT,
              },
            ]}
          />
        )}
        icon={
          <Icons.DownOutlined
            iconSize="xs"
            iconColor={theme.colorTextLightSolid}
          />
        }
        trigger={['click']}
      >
        {CREATE_DATASET_TEXT}
      </DropdownButton>
    </Flex>
  );
}

export default withToasts(Footer);
