import { useState, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { t, styled, SupersetClient, logging } from '@superset-ui/core';
import {
  Button,
  Steps,
  Typography,
  Space,
  Divider,
  Loading,
} from '@superset-ui/core/components';
import { useToasts } from 'src/components/MessageToasts/withToasts';
import {
  DatasetObject,
  DSReducerActionType,
  DatasetActionType,
} from '../types';
import { sanitizeDHIS2ColumnName } from '../DHIS2ParameterBuilder/sanitize';
import WizardStepInfo from './steps/StepInfo';
import WizardStepInstances from './steps/StepInstances';
import WizardStepDataElements from './steps/StepDataElements';
import WizardStepVariableMapping from './steps/StepVariableMapping';
import WizardStepPeriods from './steps/StepPeriods';
import WizardStepOrgUnits from './steps/StepOrgUnits';
import WizardStepLevelMapping from './steps/StepLevelMapping';
import WizardStepDataPreview from './steps/StepDataPreview';
import WizardStepSchedule from './steps/StepSchedule';
import WizardStepSave from './steps/StepSave';
import type { VariableMapping } from './steps/StepVariableMapping';
import type { ScheduleConfig } from './steps/StepSchedule';

export type LevelMappingRow = {
  /** 1-based sequential level number in the merged/serving dataset */
  merged_level: number;
  /** Display name for this hierarchy level column */
  label: string;
  /** Maps instance ID (as string) to raw level number in that instance, or null to skip */
  instance_levels: Record<string, number | null>;
};

export type LevelMappingConfig = {
  enabled: boolean;
  rows: LevelMappingRow[];
};
import buildStagedDhIS2DatasetPayload from '../buildStagedDhIS2DatasetPayload';
import refreshDatasetMetadata from '../refreshDatasetMetadata';
import type { RepositoryOrgUnitLineage } from 'src/features/databases/types';

const { Title, Text, Paragraph } = Typography;

const WizardContainer = styled.div`
  ${({ theme }) => `
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${theme.colorBgBase};
  `}
`;

const StepsWrapper = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 3}px;
    background: ${theme.colorBgElevated};
    border-bottom: 1px solid ${theme.colorBorder};
  `}
`;

const ContentWrapper = styled.div`
  ${({ theme }) => `
    flex: 1;
    padding: ${theme.sizeUnit * 4}px;
    overflow-y: auto;
    background: ${theme.colorBgBase};
  `}
`;

const FooterWrapper = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 3}px;
    background: ${theme.colorBgElevated};
    border-top: 1px solid ${theme.colorBorder};
    display: flex;
    justify-content: space-between;
    align-items: center;
  `}
`;

const ButtonGroup = styled(Space)`
  display: flex;
  gap: 12px;
`;

const StepContent = styled.div`
  min-height: 400px;
`;

const ProgressBar = styled.div`
  ${({ theme }) => `
    margin-bottom: ${theme.sizeUnit * 2}px;
    font-size: 14px;
    color: ${theme.colorTextSecondary};
  `}
`;

const DEFAULT_SCHEDULE: ScheduleConfig = {
  preset: 'daily',
  cron: '0 5 * * *',
  timezone: 'UTC',
};

export interface DHIS2WizardState {
  datasetName: string;
  description: string;
  // Multi-instance
  selectedInstanceIds: number[];
  orgUnitSourceMode?: 'primary' | 'repository' | 'per_instance' | 'federated';
  primaryOrgUnitInstanceId?: number | null;
  variableMappings: VariableMapping[];
  // Legacy / single-instance data elements list (kept for DataPreview compatibility)
  dataElements: string[];
  periods: string[];
  periodsAutoDetect?: boolean;
  /** 'relative' = single DHIS2 relative period; 'fixed_range' = start–end date range */
  defaultPeriodRangeType?: 'relative' | 'fixed_range';
  /** DHIS2 relative period identifier used as default when auto-detect is on */
  defaultRelativePeriod?: string;
  /** ISO date strings for fixed date-range default (inclusive) */
  defaultPeriodStart?: string | null;
  defaultPeriodEnd?: string | null;
  orgUnits: string[];
  orgUnitsAutoDetect?: boolean;
  selectedOrgUnitDetails?: Array<{
    id: string;
    selectionKey?: string;
    sourceOrgUnitId?: string;
    displayName: string;
    parentId?: string;
    level?: number;
    path?: string;
    sourceInstanceIds?: number[];
    sourceInstanceNames?: string[];
    repositoryLevel?: number;
    repositoryLevelName?: string;
    repositoryKey?: string;
    sourceLineageLabel?: string | null;
    strategy?: string | null;
    lineage?: RepositoryOrgUnitLineage[];
    provenance?: Record<string, unknown> | null;
  }>;
  includeChildren: boolean;
  dataLevelScope?:
    | 'selected'
    | 'children'
    | 'grandchildren'
    | 'ancestors'
    | 'all_levels';
  /**
   * Lowest hierarchy level to include (1 = national, N = facility).
   * Extraction stops at this level — org units deeper than this are excluded.
   * Corresponds to DHIS2StagedDataset.max_orgunit_level on the backend.
   */
  maxOrgUnitLevel?: number | null;
  repositoryDimensionKeys?: {
    levels?: string[];
    groups?: string[];
    group_sets?: string[];
  };
  columns: Array<{
    name: string;
    type: string;
    verbose_name?: string;
    is_dttm?: boolean;
  }>;
  previewData: any[];
  // Level mapping (optional — if undefined/disabled, backend uses auto-merge)
  levelMapping?: LevelMappingConfig;
  /**
   * When true, `co_uid` and `co_name` from the staging table are promoted to
   * first-class dimension columns in the serving dataset so users can group and
   * filter charts by Category Option Combo (disaggregation).
   */
  includeDisaggregationDimension?: boolean;
  // Schedule
  scheduleConfig: ScheduleConfig;
}

interface DHIS2DatasetWizardProps {
  dataset: Partial<DatasetObject> | null;
  setDataset: (action: DSReducerActionType) => void;
  hasColumns: boolean;
  setHasColumns: (value: boolean) => void;
  datasets: string[] | undefined;
  onSaveSuccess?: () => void;
}

// Step index constants — update these if you reorder steps.
const STEP_INFO = 0;
const STEP_INSTANCES = 1;
const STEP_DATA_ELEMENTS = 2;
const STEP_VARIABLE_MAPPING = 3;
const STEP_PERIODS = 4;
const STEP_ORG_UNITS = 5;
const STEP_LEVEL_MAPPING = 6;
const STEP_DATA_PREVIEW = 7;
const STEP_SCHEDULE = 8;
const STEP_SAVE = 9;

const WIZARD_STEPS = [
  {
    key: 'info',
    title: t('Dataset Info'),
    description: t('Basic information'),
  },
  {
    key: 'instances',
    title: t('DHIS2 Instances'),
    description: t('Select instances'),
  },
  {
    key: 'data_elements',
    title: t('Data Elements'),
    description: t('Select DE'),
  },
  {
    key: 'variable_mapping',
    title: t('Variable Mapping'),
    description: t('Aliases & sources'),
  },
  { key: 'periods', title: t('Time Periods'), description: t('Select PE') },
  {
    key: 'org_units',
    title: t('Organization Units'),
    description: t('Select OU'),
  },
  {
    key: 'level_mapping',
    title: t('Level Mapping'),
    description: t('Map hierarchy'),
  },
  {
    key: 'data_preview',
    title: t('Data Preview'),
    description: t('Preview data'),
  },
  {
    key: 'schedule',
    title: t('Schedule'),
    description: t('Sync schedule'),
  },
  { key: 'save', title: t('Save Dataset'), description: t('Complete setup') },
];

const generateUniqueDatasetName = (
  tableName: string | null | undefined,
): string => {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomNum = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  const base = tableName || 'DHIS2 Dataset';
  return `${base} ${timestamp}-${randomNum}`;
};

export default function DHIS2DatasetWizard({
  dataset,
  setDataset,
  setHasColumns,
  datasets,
  onSaveSuccess,
}: DHIS2DatasetWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const { addSuccessToast, addDangerToast } = useToasts();
  const [wizardState, setWizardState] = useState<DHIS2WizardState>({
    datasetName: generateUniqueDatasetName(dataset?.table_name),
    description: '',
    selectedInstanceIds: [],
    orgUnitSourceMode: 'repository',
    primaryOrgUnitInstanceId: null,
    variableMappings: [],
    dataElements: [],
    periods: [],
    periodsAutoDetect: true,
    defaultPeriodRangeType: 'relative',
    defaultRelativePeriod: 'LAST_12_MONTHS',
    defaultPeriodStart: null,
    defaultPeriodEnd: null,
    orgUnits: [],
    orgUnitsAutoDetect: false,
    selectedOrgUnitDetails: [],
    includeChildren: false,
    columns: dataset?.dhis2_columns || [],
    previewData: [],
    repositoryDimensionKeys: {
      levels: [],
      groups: [],
      group_sets: [],
    },
    scheduleConfig: DEFAULT_SCHEDULE,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep = useCallback(
    (step: number): boolean => {
      const newErrors: Record<string, string> = {};

      switch (step) {
        case STEP_INFO:
          if (!wizardState.datasetName.trim()) {
            newErrors.datasetName = t('Dataset name is required');
          }
          if (datasets?.includes(wizardState.datasetName)) {
            newErrors.datasetName = t('Dataset name already exists');
          }
          break;
        case STEP_INSTANCES:
          if (wizardState.selectedInstanceIds.length === 0) {
            newErrors.instances = t(
              'At least one DHIS2 instance must be selected',
            );
          }
          break;
        case STEP_DATA_ELEMENTS:
          if (wizardState.variableMappings.length === 0) {
            newErrors.dataElements = t(
              'At least one DHIS2 variable must be selected',
            );
          }
          break;
        case STEP_PERIODS:
          // Periods are optional warehouse dimensions — no required validation
          break;
        case STEP_ORG_UNITS:
          // Org units are optional warehouse dimensions — no required validation
          break;
        default:
          break;
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [wizardState, datasets],
  );

  const handleNextStep = useCallback(() => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, WIZARD_STEPS.length - 1));
    }
  }, [currentStep, validateStep]);

  const handlePrevStep = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, []);

  const handleStepChange = (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
    }
  };

  const history = useHistory();

  const updateWizardState = useCallback(
    (updates: Partial<DHIS2WizardState>) => {
      setWizardState(prev => ({ ...prev, ...updates }));
    },
    [],
  );

  const parseSourceTable = (datasetName: string | null | undefined): string => {
    if (!datasetName) return 'analytics';
    const match = datasetName.match(/^([a-zA-Z]+)/);
    return match ? match[1] : 'analytics';
  };

  const handleSave = useCallback(async () => {
    if (!dataset?.db?.id) {
      addDangerToast(t('Database not selected'));
      return;
    }

    setLoading(true);
    try {
      const dataLevelScope = wizardState.dataLevelScope || 'selected';
      const dhis2Params: Record<string, string> = {
        dx: wizardState.dataElements.join(';'),
        pe: wizardState.periods.join(';'),
        ou: wizardState.orgUnits.join(';'),
      };

      if (dataLevelScope !== 'selected') {
        dhis2Params.dataLevelScope = dataLevelScope;
        dhis2Params.ouMode = 'DESCENDANTS';
      }

      const sourceTable = parseSourceTable(wizardState.datasetName);

      const paramsStr = Object.entries(dhis2Params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

      let sql = `SELECT * FROM ${sourceTable}\n/* DHIS2: table=${sourceTable}&${paramsStr} */`;
      let shouldRefreshColumnsFromSource = false;
      let createdFromStaging = false;
      let stagedDatasetResult: any = null;

      logging.info('[DHIS2 Wizard] Creating dataset:', wizardState.datasetName);
      logging.info('[DHIS2 Wizard] SQL:', sql);

      // Build variables payload from variableMappings for staged-datasets API
      const variablesPayload = wizardState.variableMappings.map(m => ({
        instance_id: m.instanceId,
        variable_id: m.variableId,
        variable_type: m.variableType,
        variable_name: m.variableName,
        alias: m.alias || undefined,
      }));

      // Attempt staged-dataset creation first (multi-instance path)
      if (wizardState.selectedInstanceIds.length > 0) {
        try {
          const stagedPayload = {
            database_id: dataset.db.id,
            name: wizardState.datasetName,
            description: wizardState.description || undefined,
            schedule_cron: wizardState.scheduleConfig.cron,
            schedule_timezone: wizardState.scheduleConfig.timezone,
            dataset_config: {
              configured_connection_ids: wizardState.selectedInstanceIds,
              periods: wizardState.periods,
              periods_auto_detect: wizardState.periodsAutoDetect ?? true,
              default_period_range_type: wizardState.defaultPeriodRangeType ?? 'relative',
              default_relative_period: wizardState.defaultRelativePeriod ?? 'LAST_12_MONTHS',
              default_period_start: wizardState.defaultPeriodStart ?? null,
              default_period_end: wizardState.defaultPeriodEnd ?? null,
              org_units: wizardState.orgUnits,
              org_units_auto_detect: wizardState.orgUnitsAutoDetect ?? false,
              org_unit_details: wizardState.selectedOrgUnitDetails || [],
              org_unit_scope: dataLevelScope,
              repository_enabled_dimensions: wizardState.repositoryDimensionKeys || {
                levels: [],
                groups: [],
                group_sets: [],
              },
              org_unit_source_mode:
                wizardState.orgUnitSourceMode === 'federated'
                  ? 'repository'
                  : wizardState.orgUnitSourceMode || 'repository',
              primary_org_unit_instance_id:
                wizardState.orgUnitSourceMode === 'primary'
                  ? wizardState.primaryOrgUnitInstanceId
                  : null,
              ...(wizardState.levelMapping?.enabled
                ? { level_mapping: wizardState.levelMapping }
                : {}),
              include_disaggregation_dimension:
                wizardState.includeDisaggregationDimension ?? false,
            },
            // max_orgunit_level is a top-level field on DHIS2StagedDataset
            // (not nested inside dataset_config). It sets the lowest hierarchy
            // level to include — OU nodes deeper than this are excluded from
            // extraction.
            ...(wizardState.maxOrgUnitLevel != null
              ? { max_orgunit_level: wizardState.maxOrgUnitLevel }
              : {}),
            variables:
              variablesPayload.length > 0 ? variablesPayload : undefined,
          };

          logging.info(
            '[DHIS2 Wizard] Creating staged dataset:',
            stagedPayload,
          );

          const stagedResponse = await SupersetClient.post({
            endpoint: '/api/v1/dhis2/staged-datasets/',
            jsonPayload: stagedPayload,
          });

          const stagedJson = stagedResponse.json as any;
          stagedDatasetResult = stagedJson?.result;
          const servingTableRef = stagedDatasetResult?.serving_table_ref || null;
          const stagingTableRef =
            stagedDatasetResult?.staging_table_ref ||
            stagedDatasetResult?.staging_table_name ||
            null;

          if (servingTableRef || stagingTableRef) {
            sql = `SELECT * FROM ${servingTableRef || stagingTableRef}`;
            shouldRefreshColumnsFromSource = true;
            createdFromStaging = true;
          }

          // Warn if sync is running in thread mode (no Celery workers)
          const syncMode = stagedJson?.sync_schedule?.mode;
          if (syncMode === 'thread') {
            addDangerToast(
              t(
                'No background job processors (Celery workers) are running. ' +
                  'The initial sync is running in-process — restart workers for ' +
                  'scheduled and background syncs to function properly.',
              ),
            );
          }

          logging.info('[DHIS2 Wizard] Staged dataset created successfully');
        } catch (stagedErr) {
          // Log but continue — fall through to legacy creation
          logging.warn(
            '[DHIS2 Wizard] Staged dataset creation failed, falling back to legacy:',
            stagedErr,
          );
        }
      }

      // When the staged-dataset path succeeded the backend already registered
      // the serving table as a Superset dataset (friendly-named, virtual).
      // Re-using that record avoids a duplicate entry in the chart selector.
      // Fall back to creating a standard dataset only for the legacy path.
      let result: any;
      if (createdFromStaging && stagedDatasetResult?.serving_superset_dataset_id) {
        result = { id: stagedDatasetResult.serving_superset_dataset_id };
        logging.info(
          '[DHIS2 Wizard] Reusing backend-registered dataset id:',
          result.id,
        );
      } else {
        const response = await SupersetClient.post({
          endpoint: '/api/v1/dataset/',
          jsonPayload: createdFromStaging
            ? buildStagedDhIS2DatasetPayload({
                datasetName: wizardState.datasetName,
                stagingTableRef: sql.replace(/^SELECT \* FROM\s+/i, ''),
                servingTableRef: stagedDatasetResult?.serving_table_ref || null,
                sourceDatabaseId: dataset.db.id,
                sourceDatabaseName: dataset.db.database_name,
                servingDatabaseId:
                  typeof stagedDatasetResult?.serving_database_id === 'number'
                    ? stagedDatasetResult.serving_database_id
                    : null,
                servingDatabaseName:
                  typeof stagedDatasetResult?.serving_database_name === 'string'
                    ? stagedDatasetResult.serving_database_name
                    : null,
                stagedDatasetId:
                  typeof stagedDatasetResult?.id === 'number'
                    ? stagedDatasetResult.id
                    : null,
                selectedInstanceIds: wizardState.selectedInstanceIds,
                selectedInstanceNames: Array.from(
                  new Set(
                    wizardState.variableMappings
                      .map(mapping => mapping.instanceName)
                      .filter(Boolean),
                  ),
                ),
              })
            : {
                database: dataset.db.id,
                catalog: dataset.catalog || null,
                schema: dataset.schema || null,
                table_name: wizardState.datasetName,
                sql,
              },
        });
        result = response.json;
        logging.info('[DHIS2 Wizard] Dataset created:', result);
      }

      if (result?.id) {
        try {
          if (createdFromStaging) {
            logging.info(
              '[DHIS2 Wizard] Skipping dataset refresh for staged-local dataset',
            );
          } else if (shouldRefreshColumnsFromSource) {
            await refreshDatasetMetadata(result.id);
            logging.info(
              '[DHIS2 Wizard] Refreshed staged dataset columns from source',
            );
          } else {
            logging.info('[DHIS2 Wizard] Saving columns to dataset:', {
              datasetId: result.id,
              columnCount: wizardState.columns.length,
              columns: wizardState.columns,
            });

            const datasetColumns = wizardState.columns.map(col => {
              const displayName = col.verbose_name || col.name;
              const sanitizedColumnName = sanitizeDHIS2ColumnName(displayName);

              return {
                column_name: sanitizedColumnName,
                type: col.type || 'STRING',
                verbose_name: displayName,
                is_dttm: col.is_dttm || false,
                filterable: true,
                groupby: true,
                is_active: true,
              };
            });

            logging.info(
              '[DHIS2 Wizard] Transformed columns for API:',
              datasetColumns,
            );

            await SupersetClient.put({
              endpoint: `/api/v1/dataset/${result.id}`,
              jsonPayload: {
                columns: datasetColumns,
              },
            });
            logging.info('[DHIS2 Wizard] Columns saved successfully');
          }
        } catch (columnError) {
          logging.error('[DHIS2 Wizard] Failed to save columns:', columnError);
          // Continue anyway - the dataset was created
        }

        addSuccessToast(t('Dataset created successfully!'));

        setDataset({
          type: DatasetActionType.ChangeDataset,
          payload: { name: 'table_name', value: wizardState.datasetName },
        });

        if (!createdFromStaging) {
          setDataset({
            type: DatasetActionType.SetDHIS2Parameters,
            payload: { parameters: dhis2Params },
          });
        }

        setDataset({
          type: DatasetActionType.SetDHIS2Columns,
          payload: { columns: wizardState.columns },
        });

        setHasColumns(true);

        if (onSaveSuccess) {
          onSaveSuccess();
        } else {
          history.push(`/chart/add/?dataset=${result.id}`);
        }
      } else {
        addDangerToast(t('Failed to create dataset - no ID returned'));
      }
    } catch (error: any) {
      logging.error('[DHIS2 Wizard] Save error:', error);
      const errorMessage =
        error?.message || error?.body?.message || t('Failed to create dataset');
      addDangerToast(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [
    wizardState,
    dataset,
    setDataset,
    setHasColumns,
    onSaveSuccess,
    history,
    addSuccessToast,
    addDangerToast,
  ]);

  const currentStepConfig = WIZARD_STEPS[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;

  const renderStepContent = () => {
    switch (currentStep) {
      case STEP_INFO:
        return (
          <WizardStepInfo
            wizardState={wizardState}
            updateState={updateWizardState}
            errors={errors}
            dataset={dataset}
          />
        );
      case STEP_INSTANCES:
        return (
          <WizardStepInstances
            databaseId={dataset?.db?.id ?? 0}
            selectedInstanceIds={wizardState.selectedInstanceIds}
            onChange={selectedInstanceIds =>
              updateWizardState({ selectedInstanceIds })
            }
          />
        );
      case STEP_DATA_ELEMENTS:
        return (
          <WizardStepDataElements
            wizardState={wizardState}
            updateState={updateWizardState}
            errors={errors}
            databaseId={dataset?.db?.id}
          />
        );
      case STEP_VARIABLE_MAPPING:
        return (
          <WizardStepVariableMapping
            variableMappings={wizardState.variableMappings}
            onChange={variableMappings =>
              updateWizardState({ variableMappings })
            }
          />
        );
      case STEP_PERIODS:
        return (
          <WizardStepPeriods
            wizardState={wizardState}
            updateState={updateWizardState}
            errors={errors}
            databaseId={dataset?.db?.id}
          />
        );
      case STEP_ORG_UNITS:
        return (
          <WizardStepOrgUnits
            wizardState={wizardState}
            updateState={updateWizardState}
            errors={errors}
            databaseId={dataset?.db?.id}
          />
        );
      case STEP_LEVEL_MAPPING:
        return (
          <WizardStepLevelMapping
            wizardState={wizardState}
            updateState={updateWizardState}
          />
        );
      case STEP_DATA_PREVIEW:
        console.log(
          '[DHIS2Wizard] Rendering DataPreview step with includeChildren:',
          wizardState.includeChildren,
        );
        return (
          <WizardStepDataPreview
            wizardState={wizardState}
            updateState={updateWizardState}
            databaseId={dataset?.db?.id}
            endpoint={dataset?.table_name}
            dataElements={wizardState.dataElements}
            periods={wizardState.periods}
            orgUnits={wizardState.orgUnits}
            includeChildren={wizardState.includeChildren}
          />
        );
      case STEP_SCHEDULE:
        return (
          <WizardStepSchedule
            scheduleConfig={wizardState.scheduleConfig}
            onChange={scheduleConfig => updateWizardState({ scheduleConfig })}
          />
        );
      case STEP_SAVE:
        return (
          <WizardStepSave
            wizardState={wizardState}
            dataset={dataset}
            handleSave={handleSave}
            loading={loading}
          />
        );
      default:
        return null;
    }
  };

  return (
    <WizardContainer>
      <StepsWrapper>
        <Title level={3} style={{ marginBottom: 0 }}>
          {t('DHIS2 Dataset Creator')}
        </Title>
        <Paragraph style={{ marginBottom: 16, marginTop: 8, opacity: 0.7 }}>
          {t('Follow the steps below to create a new DHIS2 dataset')}
        </Paragraph>
        <Steps
          current={currentStep}
          onChange={handleStepChange}
          responsive
          items={WIZARD_STEPS.map((step, index) => ({
            ...step,
            status:
              index < currentStep
                ? 'finish'
                : index === currentStep
                  ? 'process'
                  : 'wait',
          }))}
        />
      </StepsWrapper>

      <ContentWrapper>
        <ProgressBar>
          {t('Step %d of %d', currentStep + 1, WIZARD_STEPS.length)}:{' '}
          {currentStepConfig?.title}
        </ProgressBar>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Loading />
          </div>
        ) : (
          <StepContent>{renderStepContent()}</StepContent>
        )}
      </ContentWrapper>

      <Divider style={{ margin: 0 }} />

      <FooterWrapper>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('Step %d of %d', currentStep + 1, WIZARD_STEPS.length)}
        </Text>

        <ButtonGroup align="center">
          <Button onClick={handlePrevStep} disabled={isFirstStep} size="large">
            {t('Previous')}
          </Button>

          {!isLastStep ? (
            <Button
              type="primary"
              onClick={handleNextStep}
              size="large"
              loading={loading}
            >
              {t('Next')}
            </Button>
          ) : (
            <Button
              type="primary"
              onClick={handleSave}
              size="large"
              loading={loading}
              danger={false}
            >
              {t('Complete Setup')}
            </Button>
          )}
        </ButtonGroup>
      </FooterWrapper>
    </WizardContainer>
  );
}
