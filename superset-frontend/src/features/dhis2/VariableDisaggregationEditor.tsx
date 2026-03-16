// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

/**
 * VariableDisaggregationEditor
 *
 * Allows users to configure how a DHIS2 variable's category option combos
 * (disaggregations such as Age/Sex breakdowns) are surfaced in the serving
 * table.
 *
 * Three modes are supported:
 *  - total:    One column per variable — DHIS2 returns the aggregated value.
 *  - all:      One column per category option combo + a Total column.
 *  - selected: User picks specific combos from a dropdown.
 */

import { useCallback, useEffect, useState } from 'react';
import { SupersetClient, t } from '@superset-ui/core';
import { Radio, Select, Space, Spin, Typography } from 'antd';
import type { DHIS2CategoryOptionCombo, DHIS2DisaggregationMode } from './types';

const { Text } = Typography;

export interface DisaggregationConfig {
  disaggregation: DHIS2DisaggregationMode;
  selected_coc_uids?: string[];
}

interface Props {
  /** PK of the DHIS2StagedDataset */
  datasetId: number;
  /** DHIS2 variable UID */
  variableId: string;
  /** DHIS2 instance ID to fetch combos from */
  instanceId: number;
  /** Current saved config (parsed from extra_params) */
  value?: DisaggregationConfig;
  /** Called whenever the user changes the config */
  onChange?: (config: DisaggregationConfig) => void;
}

export default function VariableDisaggregationEditor({
  datasetId,
  variableId,
  instanceId,
  value,
  onChange,
}: Props) {
  const mode: DHIS2DisaggregationMode = value?.disaggregation ?? 'total';
  const selectedUids: string[] = value?.selected_coc_uids ?? [];

  const [combos, setCombos] = useState<DHIS2CategoryOptionCombo[]>([]);
  const [loadingCombos, setLoadingCombos] = useState(false);
  const [comboError, setComboError] = useState<string | null>(null);

  const fetchCombos = useCallback(async () => {
    if (!datasetId || !variableId || !instanceId) return;
    setLoadingCombos(true);
    setComboError(null);
    try {
      const resp = await SupersetClient.get({
        endpoint: `/api/v1/dhis2/staged-datasets/${datasetId}/variables/${variableId}/category-option-combos?instance_id=${instanceId}`,
      });
      setCombos((resp.json.result || []) as DHIS2CategoryOptionCombo[]);
    } catch {
      setComboError(t('Failed to load category option combos'));
    } finally {
      setLoadingCombos(false);
    }
  }, [datasetId, variableId, instanceId]);

  // Load combos when the mode switches to "selected"
  useEffect(() => {
    if (mode === 'selected' || mode === 'all') {
      void fetchCombos();
    }
  }, [mode, fetchCombos]);

  const handleModeChange = (newMode: DHIS2DisaggregationMode) => {
    const next: DisaggregationConfig = {
      disaggregation: newMode,
      ...(newMode === 'selected' ? { selected_coc_uids: selectedUids } : {}),
    };
    onChange?.(next);
  };

  const handleSelectionChange = (uids: string[]) => {
    onChange?.({ disaggregation: 'selected', selected_coc_uids: uids });
  };

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Radio.Group
        value={mode}
        onChange={e => handleModeChange(e.target.value as DHIS2DisaggregationMode)}
      >
        <Space direction="vertical">
          <Radio value="total">
            <Text strong>{t('Total only')}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('One column — DHIS2 returns the aggregated value across all category combos.')}
            </Text>
          </Radio>
          <Radio value="all">
            <Text strong>{t('All disaggregations')}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('One column per category option combo, plus a Total column.')}
            </Text>
          </Radio>
          <Radio value="selected">
            <Text strong>{t('Select specific combos')}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('Choose which category option combos to include as columns.')}
            </Text>
          </Radio>
        </Space>
      </Radio.Group>

      {mode === 'selected' && (
        <div style={{ marginTop: 8 }}>
          {loadingCombos ? (
            <Spin size="small" />
          ) : comboError ? (
            <Text type="danger">{comboError}</Text>
          ) : (
            <Select
              mode="multiple"
              allowClear
              placeholder={t('Select category option combos…')}
              style={{ width: '100%' }}
              value={selectedUids}
              options={combos.map(c => ({ label: c.displayName, value: c.id }))}
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              onChange={handleSelectionChange}
            />
          )}
          {!loadingCombos && !comboError && combos.length === 0 && (
            <Text type="secondary">
              {t('No category option combos found for this variable.')}
            </Text>
          )}
        </div>
      )}
    </Space>
  );
}
