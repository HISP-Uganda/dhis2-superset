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
import { render, screen } from 'spec/helpers/testing-library';

import DashboardGrid from 'src/dashboard/components/DashboardGrid';
import newComponentFactory from 'src/dashboard/util/newComponentFactory';

import { DASHBOARD_GRID_TYPE } from 'src/dashboard/util/componentTypes';

jest.mock(
  'src/dashboard/containers/DashboardComponent',
  () =>
    ({ onResizeStart, onResizeStop }) => (
      <button
        type="button"
        data-test="mock-dashboard-component"
        onClick={() => onResizeStart()}
        onBlur={() =>
          onResizeStop(null, null, null, { width: 1, height: 3 }, 'id')
        }
      >
        Mock
      </button>
    ),
);

const props = {
  depth: 1,
  editMode: false,
  gridComponent: {
    ...newComponentFactory(DASHBOARD_GRID_TYPE),
    children: ['a'],
  },
  handleComponentDrop() {},
  resizeComponent() {},
  width: 500,
  isComponentVisible: true,
  setDirectPathToChild() {},
};

function setup(overrideProps) {
  return render(<DashboardGrid {...props} {...overrideProps} />, {
    useRedux: true,
    useDnd: true,
  });
}

test('should render a div with class "dashboard-grid"', () => {
  const { container } = setup();
  expect(container.querySelector('.dashboard-grid')).toBeInTheDocument();
});

test('should render GridStackGrid with grid-stack container for non-empty grid', () => {
  const { container } = setup({
    gridComponent: { ...props.gridComponent, children: ['a', 'b'] },
  });
  expect(container.querySelector('.grid-stack')).toBeInTheDocument();
});

test('should render GridStackGrid as drop target in edit mode even when empty', () => {
  const { container } = setup({
    editMode: true,
    gridComponent: { ...props.gridComponent, children: [] },
  });
  // GridStackGrid is now rendered in edit mode even for empty dashboards
  // so it can act as a drop target
  expect(container.querySelector('.grid-stack')).toBeInTheDocument();
});

test('should show empty state placeholder in edit mode for empty grid', () => {
  setup({
    editMode: true,
    gridComponent: { ...props.gridComponent, children: [] },
  });
  expect(
    screen.getByText('Drag charts or components here'),
  ).toBeInTheDocument();
});

test('should not render GridStackGrid in view mode for empty grid', () => {
  const { container } = setup({
    editMode: false,
    gridComponent: { ...props.gridComponent, children: [] },
  });
  expect(container.querySelector('.grid-stack')).not.toBeInTheDocument();
});
