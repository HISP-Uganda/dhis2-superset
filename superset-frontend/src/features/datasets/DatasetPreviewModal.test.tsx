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
import { render, screen, waitFor } from 'spec/helpers/testing-library';

import { getDatasourceSamples } from 'src/components/Chart/chartAction';
import { DatasetPreviewModal } from './DatasetPreviewModal';

jest.mock('src/components/Chart/chartAction', () => ({
  getDatasourceSamples: jest.fn(),
}));

jest.mock('src/visualizations/DHIS2Map/dhis2DataLoader', () => ({
  DHIS2DataLoader: {
    fetchChartData: jest.fn(),
  },
}));

const defaultDataset = {
  id: 7,
  table_name: 'anc_coverage',
  kind: 'physical',
  schema: 'public',
  database: {
    id: 3,
    database_name: 'main',
  },
};

test('loads preview samples from the first page and maps row values by column', async () => {
  (getDatasourceSamples as jest.Mock).mockResolvedValue({
    colnames: ['org_unit', 'value'],
    data: [['Kampala', 42]],
    rowcount: 1,
  });

  render(
    <DatasetPreviewModal dataset={defaultDataset} onClose={jest.fn()} />,
    { useRedux: true },
  );

  await waitFor(() => {
    expect(getDatasourceSamples).toHaveBeenCalledWith(
      'table',
      7,
      false,
      {},
      100,
      1,
    );
  });

  expect(await screen.findByText('Kampala')).toBeInTheDocument();
  expect(screen.getByText('42')).toBeInTheDocument();
});
