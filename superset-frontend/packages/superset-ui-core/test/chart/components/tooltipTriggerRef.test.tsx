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
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { SupersetTheme, ThemeProvider } from '@superset-ui/core';
import { Tooltip } from '../../../src/components/Tooltip';
import { FormLabel } from '../../../src/components/Form/FormLabel';
import { Label } from '../../../src/components/Label';
import { Icons } from '../../../src/components/Icons';

const mockTheme: SupersetTheme = {
  fontSize: 16,
  sizeUnit: 4,
} as SupersetTheme;

describe('tooltip trigger refs', () => {
  let consoleErrorSpy: jest.SpyInstance;

  function expectNoFunctionRefWarning() {
    const hasFunctionRefWarning = consoleErrorSpy.mock.calls.some(call =>
      call.some(
        arg =>
          typeof arg === 'string' &&
          arg.includes('Function components cannot be given refs'),
      ),
    );

    expect(hasFunctionRefWarning).toBe(false);
  }

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not warn when FormLabel is used in a tooltip trigger tree', () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <Tooltip title="test tooltip">
          <FormLabel>Region</FormLabel>
        </Tooltip>
      </ThemeProvider>,
    );

    expectNoFunctionRefWarning();
  });

  it('does not warn when Label is used as a tooltip trigger', () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <Tooltip title="test tooltip">
          <Label type="info">beta</Label>
        </Tooltip>
      </ThemeProvider>,
    );

    expectNoFunctionRefWarning();
  });

  it('does not warn when an icon is used as a tooltip trigger', () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <Tooltip title="test tooltip">
          <Icons.InfoCircleOutlined />
        </Tooltip>
      </ThemeProvider>,
    );

    expectNoFunctionRefWarning();
  });
});
