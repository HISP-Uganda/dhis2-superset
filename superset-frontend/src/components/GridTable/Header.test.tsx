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
import type { Column, GridApi } from 'ag-grid-community';
import { act, fireEvent, render } from 'spec/helpers/testing-library';
import { Header } from './Header';
import { PIVOT_COL_ID } from './constants';

jest.mock('@superset-ui/core/components/Dropdown', () => ({
  Dropdown: () => <div data-test="mock-dropdown" />,
}));

jest.mock('@superset-ui/core/components/Icons', () => {
  const actualIcons = jest.requireActual('@superset-ui/core/components/Icons');
  return {
    __esModule: true,
    Icons: {
      ...actualIcons.Icons, // retain the real `Icons` export
      Sort: jest.fn(() => <div data-test="mock-sort" />),
      SortAsc: jest.fn(() => <div data-test="mock-sort-asc" />),
      SortDesc: jest.fn(() => <div data-test="mock-sort-desc" />),
    },
  };
});

class MockApi extends EventTarget {
  getAllDisplayedColumns() {
    return [];
  }

  isDestroyed() {
    return false;
  }
}

class MockColumn extends EventTarget {
  private currentSort: string | null;

  constructor(sort: string | null = null) {
    super();
    this.currentSort = sort;
  }

  getColId() {
    return '123';
  }

  isPinnedLeft() {
    return true;
  }

  isPinnedRight() {
    return false;
  }

  getSort() {
    return this.currentSort;
  }

  setSortValue(sort: string | null) {
    this.currentSort = sort;
  }

  getSortIndex() {
    return null;
  }
}

const mockedProps = {
  displayName: 'test column',
  setSort: jest.fn(),
  enableSorting: true,
  column: new MockColumn() as any as Column,
  api: new MockApi() as any as GridApi,
};

test('renders display name for the column', () => {
  const { queryByText } = render(<Header {...mockedProps} />);
  expect(queryByText(mockedProps.displayName)).toBeInTheDocument();
});

test('sorts by clicking a column header', () => {
  const { getByText, queryByTestId } = render(<Header {...mockedProps} />);
  fireEvent.click(getByText(mockedProps.displayName));
  expect(mockedProps.setSort).toHaveBeenCalledWith('asc', false);
  expect(queryByTestId('mock-sort-asc')).toBeInTheDocument();
  fireEvent.click(getByText(mockedProps.displayName));
  expect(mockedProps.setSort).toHaveBeenCalledWith('desc', false);
  expect(queryByTestId('mock-sort-desc')).toBeInTheDocument();
  fireEvent.click(getByText(mockedProps.displayName));
  expect(mockedProps.setSort).toHaveBeenCalledWith(null, false);
  expect(queryByTestId('mock-sort-asc')).not.toBeInTheDocument();
  expect(queryByTestId('mock-sort-desc')).not.toBeInTheDocument();
});

test('synchronizes the current sort when sortChanged event occured', async () => {
  const column = new MockColumn() as any as Column;
  const { findByTestId } = render(
    <Header {...mockedProps} column={column} />,
  );
  act(() => {
    (column as any as MockColumn).setSortValue('asc');
    column.dispatchEvent(new Event('sortChanged'));
  });
  const sortAsc = await findByTestId('mock-sort-asc');
  expect(sortAsc).toBeInTheDocument();
});

test('disable menu when enableFilterButton is false', () => {
  const { queryByText, queryByTestId } = render(
    <Header {...mockedProps} enableFilterButton={false} />,
  );
  expect(queryByText(mockedProps.displayName)).toBeInTheDocument();
  expect(queryByTestId('mock-dropdown')).not.toBeInTheDocument();
});

test('hide display name for PIVOT_COL_ID', () => {
  const pivotColumn = new MockColumn();
  pivotColumn.getColId = () => PIVOT_COL_ID;
  const { queryByText } = render(
    <Header
      {...mockedProps}
      column={pivotColumn as any as Column}
    />,
  );
  expect(queryByText(mockedProps.displayName)).not.toBeInTheDocument();
});
