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
import { render, screen, userEvent, waitFor } from '@superset-ui/core/spec';

import Select from '../../src/components/Select';

test('preserves null-valued options without passing null to AntD', async () => {
  const onChange = jest.fn();

  render(
    <Select
      aria-label="Chart control select"
      onChange={onChange}
      options={[
        [null, 'All values'],
        ['district', 'District'],
      ]}
    />,
  );

  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByText('All values'));

  await waitFor(() => {
    expect(onChange).toHaveBeenCalledWith(null, expect.anything());
  });
});
