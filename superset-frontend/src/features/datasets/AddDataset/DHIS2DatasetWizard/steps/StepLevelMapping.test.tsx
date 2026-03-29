import { fireEvent } from '@testing-library/react';
import { render, screen, waitFor } from 'spec/helpers/testing-library';

import StepLevelMapping from './StepLevelMapping';

const baseWizardState = {
  datasetName: 'Malaria staging dataset',
  description: '',
  selectedInstanceIds: [101, 102],
  variableMappings: [],
  dataElements: [],
  periods: [],
  orgUnits: [],
  includeChildren: false,
  dataLevelScope: 'selected' as const,
  columns: [],
  previewData: [],
  scheduleConfig: {
    preset: 'daily' as const,
    cron: '0 5 * * *',
    timezone: 'UTC',
  },
  levelMapping: {
    enabled: true,
    rows: [
      {
        merged_level: 1,
        label: 'National',
        instance_levels: {
          '101': 1,
          '102': 1,
        },
      },
      {
        merged_level: 2,
        label: 'District',
        instance_levels: {
          '101': 2,
          '102': 2,
        },
      },
    ],
  },
};

test('renders real per-instance org-unit level names in the mapping table', async () => {
  const updateState = jest.fn();

  render(
    <StepLevelMapping
      wizardState={baseWizardState as any}
      updateState={updateState}
      instances={[
        { id: 101, name: 'National eHMIS DHIS2' },
        { id: 102, name: 'Non Routine DHIS2' },
      ]}
      orgUnitLevels={[
        {
          level: 1,
          displayName: 'National',
          sourceInstanceIds: [101, 102],
          instanceLevelNames: {
            101: 'National',
            102: 'Country',
          },
        },
        {
          level: 2,
          displayName: 'District',
          sourceInstanceIds: [101, 102],
          instanceLevelNames: {
            101: 'District',
            102: 'Province',
          },
        },
      ]}
    />,
    { useRedux: true },
  );

  expect(await screen.findByText('1. National')).toBeVisible();
  expect(await screen.findByText('1. Country')).toBeVisible();
  expect(await screen.findByText('2. District')).toBeVisible();
  expect(await screen.findByText('2. Province')).toBeVisible();

  expect(updateState).not.toHaveBeenCalled();
});

test('auto-initializes mapping rows from the selected template instance hierarchy', async () => {
  const updateState = jest.fn();

  render(
    <StepLevelMapping
      wizardState={{
        ...baseWizardState,
        levelMapping: {
          enabled: true,
          rows: [],
        },
      } as any}
      updateState={updateState}
      instances={[
        { id: 101, name: 'National eHMIS DHIS2' },
        { id: 102, name: 'Non Routine DHIS2' },
      ]}
      orgUnitLevels={[
        {
          level: 1,
          displayName: 'National',
          sourceInstanceIds: [101, 102],
          instanceLevelNames: {
            101: 'National',
            102: 'Country',
          },
        },
        {
          level: 2,
          displayName: 'District',
          sourceInstanceIds: [101, 102],
          instanceLevelNames: {
            101: 'District',
            102: 'Province',
          },
        },
        {
          level: 3,
          displayName: 'Facility',
          sourceInstanceIds: [101],
          instanceLevelNames: {
            101: 'Facility',
          },
        },
      ]}
    />,
    { useRedux: true },
  );

  expect(
    await screen.findByText(/Loaded 3 hierarchy level\(s\) from the selected instance/i),
  ).toBeVisible();

  await waitFor(() => {
    expect(updateState).toHaveBeenCalledWith({
      levelMapping: {
        enabled: true,
        rows: [
          {
            merged_level: 1,
            label: 'National',
            instance_levels: {
              '101': 1,
              '102': 1,
            },
          },
          {
            merged_level: 2,
            label: 'District',
            instance_levels: {
              '101': 2,
              '102': 2,
            },
          },
          {
            merged_level: 3,
            label: 'Facility',
            instance_levels: {
              '101': 3,
              '102': null,
            },
          },
        ],
      },
    });
  });
});

test('sorts instance level select options in ascending hierarchy order', async () => {
  const updateState = jest.fn();

  const { container } = render(
    <StepLevelMapping
      wizardState={baseWizardState as any}
      updateState={updateState}
      instances={[
        { id: 101, name: 'National eHMIS DHIS2' },
        { id: 102, name: 'Non Routine DHIS2' },
      ]}
      orgUnitLevels={[
        {
          level: 3,
          displayName: 'Facility',
          sourceInstanceIds: [101, 102],
          instanceLevelNames: {
            101: 'Facility',
            102: 'Site',
          },
        },
        {
          level: 1,
          displayName: 'National',
          sourceInstanceIds: [101, 102],
          instanceLevelNames: {
            101: 'National',
            102: 'Country',
          },
        },
        {
          level: 2,
          displayName: 'District',
          sourceInstanceIds: [101, 102],
          instanceLevelNames: {
            101: 'District',
            102: 'Province',
          },
        },
      ]}
    />,
    { useRedux: true },
  );

  const selects = container.querySelectorAll('.ant-select');
  expect(selects.length).toBeGreaterThan(1);

  fireEvent.mouseDown(
    selects[1].querySelector('.ant-select-selector') as Element,
  );

  const numericOptions = (await screen.findAllByRole('option'))
    .map(option => option.textContent)
    .filter((label): label is string => !!label && /^\d+\./.test(label));
  expect(numericOptions).toEqual([
    '1. National',
    '2. District',
    '3. Facility',
  ]);
});
