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
import userEvent from '@testing-library/user-event';
import ColorBreakpointsControl from '.';
import {
  readCachedLegendSets,
  syncDHIS2LegendSchemesForDatabase,
} from 'src/utils/dhis2LegendColorSchemes';
import { readCachedLegendSetEnvelope } from 'src/visualizations/DHIS2Map/controlPanel';
import { ColorBreakpointType, ColorBreakpointsControlProps } from './types';

jest.mock('src/utils/dhis2LegendColorSchemes', () => ({
  readCachedLegendSets: jest.fn(),
  syncDHIS2LegendSchemesForDatabase: jest.fn(() => Promise.resolve()),
}));

jest.mock('src/visualizations/DHIS2Map/controlPanel', () => ({
  readCachedLegendSetEnvelope: jest.fn(),
}));

interface Props extends ColorBreakpointsControlProps {
  name: string;
  label: string;
  value: ColorBreakpointType[];
  onChange: jest.Mock;
  breakpoints: ColorBreakpointType[];
}

const createProps = (): Props => ({
  name: 'ColorBreakpointsControl',
  label: 'Color Breakpoints',
  value: [],
  onChange: jest.fn(),
  breakpoints: [],
  actions: {
    setControlValue: jest.fn(),
  },
  type: 'ColorBreakpointsControl',
});

const renderComponent = (props: Partial<Props> = {}) =>
  render(<ColorBreakpointsControl {...createProps()} {...props} />, {
    useDnd: true,
  });

const readCachedLegendSetsMock = readCachedLegendSets as jest.MockedFunction<
  typeof readCachedLegendSets
>;
const syncDHIS2LegendSchemesForDatabaseMock =
  syncDHIS2LegendSchemesForDatabase as jest.MockedFunction<
    typeof syncDHIS2LegendSchemesForDatabase
  >;
const readCachedLegendSetEnvelopeMock =
  readCachedLegendSetEnvelope as jest.MockedFunction<
    typeof readCachedLegendSetEnvelope
  >;

// eslint-disable-next-line no-restricted-globals -- TODO: Migrate from describe blocks
describe('ColorBreakpointsControl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readCachedLegendSetsMock.mockReturnValue([]);
    syncDHIS2LegendSchemesForDatabaseMock.mockResolvedValue();
    readCachedLegendSetEnvelopeMock.mockReturnValue(null);
  });

  test('should render with default props', () => {
    renderComponent();
    expect(screen.getByText('Click to add new breakpoint')).toBeInTheDocument();
  });

  test('should render existing breakpoints', () => {
    const existingBreakpoint: ColorBreakpointType = {
      id: 0,
      color: { r: 255, g: 0, b: 0, a: 1 },
      minValue: 0,
      maxValue: 100,
    };

    renderComponent({ value: [existingBreakpoint] });
    expect(screen.getByText('≥0 – <100')).toBeInTheDocument();
  });

  test('should handle empty breakpoints array', () => {
    renderComponent({ value: [] });
    expect(screen.getByText('Click to add new breakpoint')).toBeInTheDocument();
  });

  test('should handle multiple breakpoints', () => {
    const breakpoints: ColorBreakpointType[] = [
      {
        id: 0,
        color: { r: 255, g: 0, b: 0, a: 1 },
        minValue: 0,
        maxValue: 50,
      },
      {
        id: 1,
        color: { r: 0, g: 255, b: 0, a: 1 },
        minValue: 50,
        maxValue: 100,
      },
    ];

    renderComponent({ value: breakpoints });
    expect(screen.getByText('≥0 – <50')).toBeInTheDocument();
    expect(screen.getByText('≥50 – <100')).toBeInTheDocument();
  });

  test('should call onChange when component state updates', () => {
    const onChange = jest.fn();
    renderComponent({ onChange });

    expect(onChange).toHaveBeenCalledWith([]);
  });

  test('should show new breakpoint button when no breakpoints exist', () => {
    renderComponent();
    const ghostButton = screen.getByText('Click to add new breakpoint');
    expect(ghostButton).toBeInTheDocument();
  });

  test('should handle new breakpoint button click and popover visibility state', async () => {
    renderComponent();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const addButton = screen.getByText('Click to add new breakpoint');
    userEvent.click(addButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('should save new breakpoint and update state', async () => {
    const onChange = jest.fn();
    renderComponent({ onChange });

    const addButton = screen.getByText('Click to add new breakpoint');
    userEvent.click(addButton);

    const minInput = screen.getByTestId('min-value-input');
    const maxInput = screen.getByTestId('max-value-input');

    userEvent.type(minInput, '10');
    userEvent.type(maxInput, '90');

    await waitFor(() => {
      const saveButton = screen.getByTestId('save-button');
      expect(saveButton).toBeEnabled();
    });

    const saveButton = screen.getByTestId('save-button');
    userEvent.click(saveButton);

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          minValue: 10,
          maxValue: 90,
          id: 0,
        }),
      ]),
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('should remove breakpoint when delete is triggered', async () => {
    const existingBreakpoint: ColorBreakpointType = {
      id: 0,
      color: { r: 255, g: 0, b: 0, a: 1 },
      minValue: 0,
      maxValue: 100,
    };
    const onChange = jest.fn();

    renderComponent({ value: [existingBreakpoint], onChange });

    const removeButton = screen.getByTestId('remove-control-button');
    userEvent.click(removeButton);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  test('should edit existing breakpoint when clicked', async () => {
    const existingBreakpoint: ColorBreakpointType = {
      id: 0,
      color: { r: 255, g: 0, b: 0, a: 1 },
      minValue: 0,
      maxValue: 100,
    };
    const onChange = jest.fn();

    renderComponent({ value: [existingBreakpoint], onChange });

    const breakpointOption = screen.getByText('≥0 – <100');
    userEvent.click(breakpointOption);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0')).toBeInTheDocument();
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });

  test('should handle DndSelectLabel props correctly', () => {
    renderComponent();

    const dndSelectLabel = screen
      .getByText('Click to add new breakpoint')
      .closest('div');
    expect(dndSelectLabel).toBeInTheDocument();
  });

  test('should assign incremental IDs to new breakpoints', async () => {
    const onChange = jest.fn();
    renderComponent({ onChange });

    const addButton = screen.getByText('Click to add new breakpoint');
    userEvent.click(addButton);

    const minInput = screen.getByTestId('min-value-input');
    const maxInput = screen.getByTestId('max-value-input');

    userEvent.type(minInput, '0');
    userEvent.type(maxInput, '50');

    await waitFor(() => {
      const saveButton = screen.getByTestId('save-button');
      expect(saveButton).toBeEnabled();
    });

    const saveButton = screen.getByTestId('save-button');
    userEvent.click(saveButton);

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 0 })]);
  });

  // ── Auto-generate panel ───────────────────────────────────────────────────

  test('auto-generate panel is hidden by default', () => {
    renderComponent();
    expect(screen.queryByTestId('auto-generate-panel')).not.toBeInTheDocument();
  });

  test('toggle button shows and hides auto-generate panel', async () => {
    renderComponent();
    const toggle = screen.getByTestId('toggle-auto-generate');
    userEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByTestId('auto-generate-panel')).toBeInTheDocument(),
    );
    userEvent.click(toggle);
    await waitFor(() =>
      expect(screen.queryByTestId('auto-generate-panel')).not.toBeInTheDocument(),
    );
  });

  test('toggle button label changes when panel is open', async () => {
    renderComponent();
    const toggle = screen.getByTestId('toggle-auto-generate');
    expect(toggle).toHaveTextContent('Generate ranges');
    userEvent.click(toggle);
    await waitFor(() =>
      expect(toggle).toHaveTextContent('Hide range generator'),
    );
  });

  test('generate button shows error when min/max are missing', async () => {
    renderComponent();
    userEvent.click(screen.getByTestId('toggle-auto-generate'));
    await waitFor(() =>
      expect(screen.getByTestId('auto-generate-panel')).toBeInTheDocument(),
    );
    userEvent.click(screen.getByTestId('auto-generate-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('auto-error')).toBeInTheDocument(),
    );
  });

  // ── DHIS2 legend import ───────────────────────────────────────────────────

  test('DHIS2 import button is hidden when no legend definition is provided', () => {
    renderComponent();
    expect(screen.queryByTestId('import-dhis2-legend')).not.toBeInTheDocument();
  });

  test('DHIS2 import button is visible when dhis2LegendDefinition is provided', () => {
    renderComponent({
      dhis2LegendDefinition: {
        items: [
          { startValue: 0, endValue: 10, color: '#fee5d9' },
          { startValue: 10, endValue: 50, color: '#de2d26' },
        ],
      },
    });
    expect(screen.getByTestId('import-dhis2-legend')).toBeInTheDocument();
  });

  test('clicking import DHIS2 legend replaces breakpoints', async () => {
    const onChange = jest.fn();
    renderComponent({
      onChange,
      dhis2LegendDefinition: {
        items: [
          { startValue: 0, endValue: 10, color: '#fee5d9' },
          { startValue: 10, endValue: 50, color: '#de2d26' },
        ],
      },
    });
    onChange.mockClear();
    userEvent.click(screen.getByTestId('import-dhis2-legend'));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ minValue: 0, maxValue: 10 }),
          expect.objectContaining({ minValue: 10, maxValue: 50 }),
        ]),
      ),
    );
  });

  test('loads staged DHIS2 legend sets automatically into the selector', async () => {
    readCachedLegendSetEnvelopeMock.mockReturnValue({
      data: [
        {
          id: 'legend-a',
          displayName: 'IRS Coverage',
          legendDefinition: {
            setName: 'IRS Coverage',
            items: [
              { startValue: 0, endValue: 90, color: '#FF0000' },
              { startValue: 90, endValue: 95, color: '#FDCE0F' },
              { startValue: 95, endValue: 100, color: '#008000' },
            ],
          },
        },
      ],
      timestamp: Date.now(),
      status: 'success',
    });

    renderComponent({ databaseId: 5 });

    expect(screen.getByTestId('dhis2-legendset-panel')).toBeInTheDocument();
    await waitFor(() =>
      expect(syncDHIS2LegendSchemesForDatabaseMock).toHaveBeenCalledWith(5),
    );
    expect(screen.getByTestId('dhis2-legendset-select')).toBeInTheDocument();
  });

  test('shows legend set preview swatches inside the selector options', async () => {
    readCachedLegendSetEnvelopeMock.mockReturnValue({
      data: [
        {
          id: 'legend-a',
          displayName: 'IRS Coverage',
          legendDefinition: {
            setName: 'IRS Coverage',
            items: [
              { startValue: 0, endValue: 90, color: '#FF0000' },
              { startValue: 90, endValue: 95, color: '#FDCE0F' },
              { startValue: 95, endValue: 100, color: '#008000' },
            ],
          },
        },
      ],
      timestamp: Date.now(),
      status: 'success',
    });

    renderComponent({ databaseId: 5 });

    await waitFor(() =>
      expect(syncDHIS2LegendSchemesForDatabaseMock).toHaveBeenCalledWith(5),
    );
    userEvent.click(
      screen.getByRole('combobox', { name: 'DHIS2 legend set' }),
    );
    await waitFor(() =>
      expect(screen.getByText('IRS Coverage')).toBeInTheDocument(),
    );
    expect(screen.getAllByTestId('dhis2-legendset-swatch')).toHaveLength(3);
  });

  test('shows inline DHIS2 legend-set error when no staged legend sets exist', async () => {
    readCachedLegendSetEnvelopeMock.mockReturnValue({
      data: [],
      timestamp: Date.now(),
      status: 'success',
    });

    renderComponent({ databaseId: 5 });

    await waitFor(() =>
      expect(
        screen.getByTestId('dhis2-legendset-error'),
      ).toHaveTextContent(
        'No DHIS2 legend sets found. Ensure the metadata has been synced.',
      ),
    );
  });
});
