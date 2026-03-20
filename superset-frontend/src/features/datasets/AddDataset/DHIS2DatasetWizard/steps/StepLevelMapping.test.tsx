import { render, screen } from 'spec/helpers/testing-library';

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
