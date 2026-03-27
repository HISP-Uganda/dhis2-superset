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
import { render, waitFor } from 'spec/helpers/testing-library';
import Echart from '../src/components/Echart';
import { EchartsProps } from '../src/types';

const mockResize = jest.fn();
const mockSetOption = jest.fn();
const mockOff = jest.fn();
const mockOn = jest.fn();
const mockDispatchAction = jest.fn();
const mockDispose = jest.fn();
const mockZrOff = jest.fn();
const mockZrOn = jest.fn();
const mockInit = jest.fn(() => ({
  resize: mockResize,
  setOption: mockSetOption,
  off: mockOff,
  on: mockOn,
  dispatchAction: mockDispatchAction,
  dispose: mockDispose,
  getZr: () => ({
    off: mockZrOff,
    on: mockZrOn,
  }),
}));
const mockRegisterLocale = jest.fn();

jest.mock('echarts/core', () => ({
  use: jest.fn(),
  init: (...args: unknown[]) => mockInit(...args),
  registerLocale: (...args: unknown[]) => mockRegisterLocale(...args),
}));

jest.mock('echarts/charts', () => ({
  SankeyChart: {},
  PieChart: {},
  BarChart: {},
  FunnelChart: {},
  GaugeChart: {},
  GraphChart: {},
  LineChart: {},
  ScatterChart: {},
  RadarChart: {},
  BoxplotChart: {},
  TreeChart: {},
  TreemapChart: {},
  HeatmapChart: {},
  SunburstChart: {},
  CustomChart: {},
}));

jest.mock('echarts/renderers', () => ({
  CanvasRenderer: {},
}));

jest.mock('echarts/components', () => ({
  TooltipComponent: {},
  TitleComponent: {},
  GridComponent: {},
  VisualMapComponent: {},
  LegendComponent: {},
  DataZoomComponent: {},
  ToolboxComponent: {},
  GraphicComponent: {},
  AriaComponent: {},
  MarkAreaComponent: {},
  MarkLineComponent: {},
}));

jest.mock('echarts/features', () => ({
  LabelLayout: {},
}));

jest.mock('echarts/lib/i18n/langEN', () => ({
  default: { locale: 'en' },
}));

let mockClientWidth = 0;
let mockClientHeight = 0;
let originalClientWidthDescriptor: PropertyDescriptor | undefined;
let originalClientHeightDescriptor: PropertyDescriptor | undefined;

const baseProps: EchartsProps = {
  width: 400,
  height: 300,
  echartOptions: {},
  refs: {},
};

beforeAll(() => {
  originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth',
  );
  originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  );

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return mockClientWidth;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return mockClientHeight;
    },
  });
});

afterAll(() => {
  if (originalClientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientWidth',
      originalClientWidthDescriptor,
    );
  }
  if (originalClientHeightDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'clientHeight',
      originalClientHeightDescriptor,
    );
  }
});

beforeEach(() => {
  mockClientWidth = 0;
  mockClientHeight = 0;
  mockResize.mockClear();
  mockSetOption.mockClear();
  mockOff.mockClear();
  mockOn.mockClear();
  mockDispatchAction.mockClear();
  mockDispose.mockClear();
  mockZrOff.mockClear();
  mockZrOn.mockClear();
  mockInit.mockClear();
  mockRegisterLocale.mockClear();
});

test('initializes ECharts with explicit chart dimensions', async () => {
  render(<Echart {...baseProps} />, {
    useRedux: true,
    initialState: { common: { locale: 'en' } },
  });

  await waitFor(() => expect(mockInit).toHaveBeenCalledTimes(1));
  expect(mockInit).toHaveBeenCalledWith(
    expect.any(HTMLDivElement),
    null,
    expect.objectContaining({
      locale: 'EN',
      width: 400,
      height: 300,
    }),
  );
  expect(mockResize).toHaveBeenCalledWith({ width: 400, height: 300 });
});

test('disposes the chart instance on unmount', async () => {
  const { unmount } = render(<Echart {...baseProps} />, {
    useRedux: true,
    initialState: { common: { locale: 'en' } },
  });

  await waitFor(() => expect(mockInit).toHaveBeenCalledTimes(1));
  unmount();

  expect(mockDispose).toHaveBeenCalledTimes(1);
});
