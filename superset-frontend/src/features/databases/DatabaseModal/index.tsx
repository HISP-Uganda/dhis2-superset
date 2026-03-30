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
import {
  t,
  styled,
  SupersetTheme,
  getExtensionsRegistry,
  SupersetClient,
} from '@superset-ui/core';

import {
  FunctionComponent,
  useEffect,
  useRef,
  useState,
  useReducer,
  Reducer,
  useCallback,
  ChangeEvent,
  useMemo,
} from 'react';
import { CheckboxChangeEvent } from '@superset-ui/core/components/Checkbox/types';

import { useHistory } from 'react-router-dom';
import { setItem, LocalStorageKeys } from 'src/utils/localStorageHelpers';
import Tabs from '@superset-ui/core/components/Tabs';
import {
  Alert,
  Button,
  Icons,
  LabeledErrorBoundInput as ValidatedInput,
  Modal,
  Select,
  IconButton,
  InfoTooltip,
  Loading,
  Upload,
  type UploadChangeParam,
  type UploadFile,
  FormLabel,
} from '@superset-ui/core/components';
import { ErrorAlert, ErrorMessageWithStackTrace } from 'src/components';
import withToasts from 'src/components/MessageToasts/withToasts';
import {
  testDatabaseConnection,
  useSingleViewResource,
  useAvailableDatabases,
  useDatabaseValidation,
  getDatabaseImages,
  getConnectionAlert,
  useImportResource,
} from 'src/views/CRUD/hooks';
import { useCommonConf } from 'src/features/databases/state';
import { isEmpty, pick } from 'lodash';
import { OnlyKeyWithType } from 'src/utils/types';
import { ModalTitleWithIcon } from 'src/components/ModalTitleWithIcon';
import {
  DatabaseObject,
  DatabaseForm,
  ConfigurationMethod,
  CatalogObject,
  Engines,
  ExtraJson,
  CustomTextType,
  DatabaseParameters,
} from '../types';
import type { DHIS2Instance } from 'src/features/dhis2/types';
import ExtraOptions from './ExtraOptions';
import SqlAlchemyForm from './SqlAlchemyForm';
import DatabaseConnectionForm from './DatabaseConnectionForm';
import DHIS2ConfiguredConnectionsPanel from './DHIS2ConfiguredConnectionsPanel';
import DHIS2RepositoryReportingUnitsStep, {
  renderRepositorySummaryLines,
  type RepositoryReportingUnitsStepValue,
} from './DHIS2RepositoryReportingUnitsStep';
import {
  antDAlertStyles,
  antdWarningAlertStyles,
  StyledAlertMargin,
  antDModalNoPaddingStyles,
  antDModalStyles,
  antDTabsStyles,
  buttonLinkStyles,
  importDbButtonLinkStyles,
  alchemyButtonLinkStyles,
  TabHeader,
  formHelperStyles,
  formStyles,
  StyledAlignment,
  SelectDatabaseStyles,
  infoTooltip,
  StyledFooterButton,
  StyledStickyHeader,
  formScrollableStyles,
  StyledUploadWrapper,
} from './styles';
import ModalHeader, { DOCUMENTATION_LINK } from './ModalHeader';
import SSHTunnelForm from './SSHTunnelForm';
import SSHTunnelSwitch from './SSHTunnelSwitch';

const extensionsRegistry = getExtensionsRegistry();

const DEFAULT_EXTRA = JSON.stringify({ allows_virtual_table_explore: true });
const DATABASE_LIST_ROUTE = '/databaseview/list/';

const TABS_KEYS = {
  BASIC: 'basic',
  ADVANCED: 'advanced',
  CONNECTIONS: 'dhis2_connections',
};

const DHIS2_SHELL_EXCLUDED_FIELDS = [
  'dhis2_authentication',
  'host',
  'authentication_type',
  'username',
  'password',
  'access_token',
];

const engineSpecificAlertMapping = {
  [Engines.GSheet]: {
    message: 'Why do I need to create a database?',
    description:
      'To begin using your Google Sheets, you need to create a database first. ' +
      'Databases are used as a way to identify ' +
      'your data so that it can be queried and visualized. This ' +
      'database will hold all of your individual Google Sheets ' +
      'you choose to connect here.',
  },
};

const TabsStyled = styled(Tabs)`
  .ant-tabs-content {
    width: 100%;
    overflow: inherit;

    & > .ant-tabs-tabpane {
      position: relative;
    }
  }
`;

const ErrorAlertContainer = styled.div`
  ${({ theme }) => `
    margin: ${theme.sizeUnit * 8}px ${theme.sizeUnit * 4}px;
  `};
`;

type FormStatusType = 'error' | 'success';

interface FormStatusState {
  type: FormStatusType;
  title: string;
  description: string;
  details?: string;
}

type DHIS2CreateStage =
  | 'details'
  | 'connections'
  | 'repository'
  | 'review';

const SSHTunnelContainer = styled.div`
  ${({ theme }) => `
    padding: 0px ${theme.sizeUnit * 4}px;
  `};
`;

const normalizeStatusDetails = (message: string) =>
  message
    .replace(/^ERROR:\s*/i, '')
    .replace(/^\(builtins\.[^)]+\)\s+None\s*/im, '')
    .replace(/^\[SQL:\s*(.*?)\]\s*$/ims, '$1')
    .replace(/^\(Background on this error at:.*?\)\s*$/im, '')
    .trim();

export interface DatabaseModalProps {
  addDangerToast: (msg: string) => void;
  addSuccessToast: (msg: string) => void;
  onDatabaseAdd?: (database?: DatabaseObject) => void;
  onHide: () => void;
  show: boolean;
  databaseId: number | undefined; // If included, will go into edit mode
  dbEngine: string | undefined; // if included goto step 2 with engine already set
}

export enum ActionType {
  AddTableCatalogSheet,
  ConfigMethodChange,
  DbSelected,
  EditorChange,
  ExtraEditorChange,
  ExtraInputChange,
  EncryptedExtraInputChange,
  Fetched,
  InputChange,
  ParametersChange,
  QueryChange,
  RemoveTableCatalogSheet,
  Reset,
  TextChange,
  ParametersSSHTunnelChange,
  SetSSHTunnelLoginMethod,
  RemoveSSHTunnelConfig,
}

export enum AuthType {
  Password,
  PrivateKey,
}

interface DBReducerPayloadType {
  target?: string;
  name: string;
  json?: string;
  type?: string;
  checked?: boolean;
  value?: string;
}

export type DBReducerActionType =
  | {
      type:
        | ActionType.ExtraEditorChange
        | ActionType.ExtraInputChange
        | ActionType.EncryptedExtraInputChange
        | ActionType.TextChange
        | ActionType.QueryChange
        | ActionType.InputChange
        | ActionType.EditorChange
        | ActionType.ParametersChange
        | ActionType.ParametersSSHTunnelChange;
      payload: DBReducerPayloadType;
    }
  | {
      type: ActionType.Fetched;
      payload: Partial<DatabaseObject>;
    }
  | {
      type: ActionType.DbSelected;
      payload: {
        database_name?: string;
        engine?: string;
        configuration_method: ConfigurationMethod;
        engine_information?: {};
        driver?: string;
        sqlalchemy_uri_placeholder?: string;
      };
    }
  | {
      type:
        | ActionType.Reset
        | ActionType.RemoveSSHTunnelConfig
        | ActionType.AddTableCatalogSheet;
    }
  | {
      type: ActionType.RemoveTableCatalogSheet;
      payload: {
        indexToDelete: number;
      };
    }
  | {
      type: ActionType.ConfigMethodChange;
      payload: {
        database_name?: string;
        engine?: string;
        configuration_method: ConfigurationMethod;
      };
    }
  | {
      type: ActionType.SetSSHTunnelLoginMethod;
      payload: {
        login_method: AuthType;
      };
    };

const StyledBtns = styled.div`
  display: flex;
  justify-content: center;
  padding: ${({ theme }) => theme.sizeUnit * 5}px;
`;

export function dbReducer(
  state: Partial<DatabaseObject> | null,
  action: DBReducerActionType,
): Partial<DatabaseObject> | null {
  const trimmedState = {
    ...(state || {}),
  };
  let query = {};
  let query_input = '';
  let parametersCatalog;
  let actionPayloadJson;
  const extraJson: ExtraJson = JSON.parse(trimmedState.extra || '{}');

  switch (action.type) {
    case ActionType.ExtraEditorChange:
      // "extra" payload in state is a string
      try {
        // we don't want to stringify encoded strings twice
        actionPayloadJson = JSON.parse(action.payload.json || '{}');
      } catch (e) {
        actionPayloadJson = action.payload.json;
      }
      return {
        ...trimmedState,
        extra: JSON.stringify({
          ...extraJson,
          [action.payload.name]: actionPayloadJson,
        }),
      };
    case ActionType.EncryptedExtraInputChange:
      return {
        ...trimmedState,
        masked_encrypted_extra: JSON.stringify({
          ...JSON.parse(trimmedState.masked_encrypted_extra || '{}'),
          [action.payload.name]: action.payload.value,
        }),
      };
    case ActionType.ExtraInputChange:
      if (
        action.payload.name === 'schema_cache_timeout' ||
        action.payload.name === 'table_cache_timeout'
      ) {
        return {
          ...trimmedState,
          extra: JSON.stringify({
            ...extraJson,
            metadata_cache_timeout: {
              ...extraJson?.metadata_cache_timeout,
              [action.payload.name]: Number(action.payload.value),
            },
          }),
        };
      }
      if (action.payload.name === 'schemas_allowed_for_file_upload') {
        return {
          ...trimmedState,
          extra: JSON.stringify({
            ...extraJson,
            schemas_allowed_for_file_upload: (action.payload.value || '')
              .split(',')
              .filter(schema => schema !== ''),
          }),
        };
      }
      if (action.payload.name === 'http_path') {
        return {
          ...trimmedState,
          extra: JSON.stringify({
            ...extraJson,
            engine_params: {
              connect_args: {
                [action.payload.name]: action.payload.value?.trim(),
              },
            },
          }),
        };
      }
      if (action.payload.name === 'expand_rows') {
        return {
          ...trimmedState,
          extra: JSON.stringify({
            ...extraJson,
            schema_options: {
              ...extraJson?.schema_options,
              [action.payload.name]:
                'checked' in action.payload
                  ? !!action.payload.checked
                  : !!action.payload.value,
            },
          }),
        };
      }
      return {
        ...trimmedState,
        extra: JSON.stringify({
          ...extraJson,
          [action.payload.name]:
            action.payload.type === 'checkbox'
              ? action.payload.checked
              : action.payload.value,
        }),
      };
    case ActionType.InputChange:
      if (action.payload.type === 'checkbox') {
        return {
          ...trimmedState,
          [action.payload.name]: action.payload.checked,
        };
      }
      return {
        ...trimmedState,
        [action.payload.name]: action.payload.value,
      };
    case ActionType.ParametersChange:
      // catalog params will always have a catalog state for
      // dbs that use a catalog, i.e., gsheets, even if the
      // fields are empty strings
      if (
        action.payload.type?.startsWith('catalog') &&
        trimmedState.catalog !== undefined
      ) {
        // Formatting wrapping google sheets table catalog
        const catalogCopy: CatalogObject[] = [...trimmedState.catalog];
        const idx = action.payload.type?.split('-')[1];
        const catalogToUpdate: CatalogObject =
          catalogCopy[parseInt(idx, 10)] || {};
        if (action.payload.value !== undefined) {
          catalogToUpdate[action.payload.name as keyof CatalogObject] =
            action.payload.value;
        }

        // insert updated catalog to existing state
        catalogCopy.splice(parseInt(idx, 10), 1, catalogToUpdate);

        // format catalog for state
        // eslint-disable-next-line array-callback-return
        parametersCatalog = catalogCopy.reduce<Record<string, string>>(
          (obj, item: CatalogObject) => {
            const catalog = { ...obj };
            catalog[item.name as keyof CatalogObject] = item.value;
            return catalog;
          },
          {},
        );

        return {
          ...trimmedState,
          catalog: catalogCopy,
          parameters: {
            ...trimmedState.parameters,
            catalog: parametersCatalog,
          },
        };
      }
      return {
        ...trimmedState,
        parameters: {
          ...trimmedState.parameters,
          [action.payload.name]: action.payload.value,
        },
      };

    case ActionType.ParametersSSHTunnelChange:
      return {
        ...trimmedState,
        ssh_tunnel: {
          ...trimmedState.ssh_tunnel,
          [action.payload.name]: action.payload.value,
        },
      };
    case ActionType.SetSSHTunnelLoginMethod: {
      let ssh_tunnel = {};
      if (trimmedState?.ssh_tunnel) {
        // remove any attributes that are considered sensitive
        ssh_tunnel = pick(trimmedState.ssh_tunnel, [
          'id',
          'server_address',
          'server_port',
          'username',
        ]);
      }
      if (action.payload.login_method === AuthType.PrivateKey) {
        return {
          ...trimmedState,
          ssh_tunnel: {
            private_key: trimmedState?.ssh_tunnel?.private_key,
            private_key_password:
              trimmedState?.ssh_tunnel?.private_key_password,
            ...ssh_tunnel,
          },
        };
      }
      if (action.payload.login_method === AuthType.Password) {
        return {
          ...trimmedState,
          ssh_tunnel: {
            password: trimmedState?.ssh_tunnel?.password,
            ...ssh_tunnel,
          },
        };
      }
      return {
        ...trimmedState,
      };
    }
    case ActionType.RemoveSSHTunnelConfig:
      return {
        ...trimmedState,
        ssh_tunnel: undefined,
      };
    case ActionType.AddTableCatalogSheet:
      if (trimmedState.catalog !== undefined) {
        return {
          ...trimmedState,
          catalog: [...trimmedState.catalog, { name: '', value: '' }],
        };
      }
      return {
        ...trimmedState,
        catalog: [{ name: '', value: '' }],
      };
    case ActionType.RemoveTableCatalogSheet:
      trimmedState.catalog?.splice(action.payload.indexToDelete, 1);
      return {
        ...trimmedState,
      };
    case ActionType.EditorChange:
      return {
        ...trimmedState,
        [action.payload.name]: action.payload.json,
      };
    case ActionType.QueryChange:
      return {
        ...trimmedState,
        parameters: {
          ...trimmedState.parameters,
          query: Object.fromEntries(new URLSearchParams(action.payload.value)),
        },
        query_input: action.payload.value,
      };
    case ActionType.TextChange:
      return {
        ...trimmedState,
        [action.payload.name]: action.payload.value,
      };
    case ActionType.Fetched:
      // convert query to a string and store in query_input
      query = action.payload?.parameters?.query || {};
      query_input = Object.entries(query)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

      if (
        action.payload.masked_encrypted_extra &&
        action.payload.configuration_method === ConfigurationMethod.DynamicForm
      ) {
        // "extra" payload from the api is a string
        const extraJsonPayload: ExtraJson = {
          ...JSON.parse((action.payload.extra as string) || '{}'),
        };

        const payloadCatalog = extraJsonPayload.engine_params?.catalog;

        const engineRootCatalog = Object.entries(payloadCatalog || {}).map(
          ([name, value]: string[]) => ({ name, value }),
        );

        return {
          ...action.payload,
          engine: action.payload.backend || trimmedState.engine,
          configuration_method: action.payload.configuration_method,
          catalog: engineRootCatalog,
          parameters: {
            ...(action.payload.parameters || trimmedState.parameters),
            catalog: payloadCatalog,
          },
          query_input,
        };
      }
      return {
        ...action.payload,
        masked_encrypted_extra: action.payload.masked_encrypted_extra || '',
        engine: action.payload.backend || trimmedState.engine,
        configuration_method: action.payload.configuration_method,
        parameters: action.payload.parameters || trimmedState.parameters,
        ssh_tunnel: action.payload.ssh_tunnel || trimmedState.ssh_tunnel,
        query_input,
      };

    case ActionType.DbSelected:
      // set initial state for blank form
      return {
        ...action.payload,
        extra: DEFAULT_EXTRA,
        expose_in_sqllab: true,
      };
    case ActionType.ConfigMethodChange:
      return {
        ...action.payload,
      };

    case ActionType.Reset:
    default:
      return null;
  }
}

const DEFAULT_TAB_KEY = TABS_KEYS.BASIC;

const DatabaseModal: FunctionComponent<DatabaseModalProps> = ({
  addDangerToast: _addDangerToast,
  addSuccessToast,
  onDatabaseAdd,
  onHide,
  show,
  databaseId,
  dbEngine,
}) => {
  const ignoreResourceToast = useCallback(() => undefined, []);
  const [db, setDB] = useReducer<
    Reducer<Partial<DatabaseObject> | null, DBReducerActionType>
  >(dbReducer, null);
  // Database fetch logic
  const {
    state: { loading: dbLoading, resource: dbFetched, error: dbErrors },
    fetchResource,
    createResource,
    updateResource,
    clearError,
  } = useSingleViewResource<DatabaseObject>(
    'database',
    t('database'),
    ignoreResourceToast,
    'connection',
  );

  const [tabKey, setTabKey] = useState<string>(DEFAULT_TAB_KEY);
  const [availableDbs, getAvailableDbs] = useAvailableDatabases();
  const [
    validationErrors,
    getValidation,
    setValidationErrors,
    isValidating,
    hasValidated,
    setHasValidated,
  ] = useDatabaseValidation();
  const [hasConnectedDb, setHasConnectedDb] = useState<boolean>(false);
  const [showCTAbtns, setShowCTAbtns] = useState(false);
  const [dhis2CreateStage, setDhis2CreateStage] =
    useState<DHIS2CreateStage>('details');
  const [dhis2ConfiguredConnections, setDhis2ConfiguredConnections] = useState<
    DHIS2Instance[]
  >([]);
  const [
    repositoryReportingUnitsValue,
    setRepositoryReportingUnitsValue,
  ] = useState<RepositoryReportingUnitsStepValue | null>(null);
  const [dbName, setDbName] = useState('');
  const [editNewDb, setEditNewDb] = useState<boolean>(false);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [testInProgress, setTestInProgress] = useState<boolean>(false);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [sshTunnelPasswords, setSSHTunnelPasswords] = useState<
    Record<string, string>
  >({});
  const [sshTunnelPrivateKeys, setSSHTunnelPrivateKeys] = useState<
    Record<string, string>
  >({});
  const [sshTunnelPrivateKeyPasswords, setSSHTunnelPrivateKeyPasswords] =
    useState<Record<string, string>>({});
  const [confirmedOverwrite, setConfirmedOverwrite] = useState<boolean>(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [importingModal, setImportingModal] = useState<boolean>(false);
  const [importingErrorMessage, setImportingErrorMessage] = useState<string>();
  const [formStatus, setFormStatus] = useState<FormStatusState | null>(null);
  const [passwordFields, setPasswordFields] = useState<string[]>([]);
  const [sshTunnelPasswordFields, setSSHTunnelPasswordFields] = useState<
    string[]
  >([]);
  const [sshTunnelPrivateKeyFields, setSSHTunnelPrivateKeyFields] = useState<
    string[]
  >([]);
  const [
    sshTunnelPrivateKeyPasswordFields,
    setSSHTunnelPrivateKeyPasswordFields,
  ] = useState<string[]>([]);
  const [extraExtensionComponentState, setExtraExtensionComponentState] =
    useState<object>({});

  const SSHTunnelSwitchComponent =
    extensionsRegistry.get('ssh_tunnel.form.switch') ?? SSHTunnelSwitch;

  const [useSSHTunneling, setUseSSHTunneling] = useState<boolean | undefined>(
    undefined,
  );

  let dbConfigExtraExtension = extensionsRegistry.get(
    'databaseconnection.extraOption',
  );

  if (dbConfigExtraExtension) {
    // add method for db modal to store data
    dbConfigExtraExtension = {
      ...dbConfigExtraExtension,
      onEdit: componentState => {
        setExtraExtensionComponentState({
          ...extraExtensionComponentState,
          ...componentState,
        });
      },
    };
  }

  const conf = useCommonConf();
  const dbImages = getDatabaseImages();
  const connectionAlert = getConnectionAlert();
  const isEditMode = !!databaseId;
  const hasAlert =
    connectionAlert ||
    !!(
      db?.engine &&
      engineSpecificAlertMapping[
        db.engine as keyof typeof engineSpecificAlertMapping
      ]
    );
  const useSqlAlchemyForm =
    db?.configuration_method === ConfigurationMethod.SqlalchemyUri;
  const isDynamic = (engine: string | undefined) =>
    availableDbs?.databases?.find(
      (DB: DatabaseObject) => DB.backend === engine || DB.engine === engine,
    )?.parameters !== undefined;
  const history = useHistory();
  const isDHIS2Database = (db?.backend || db?.engine) === 'dhis2';
  const isDHIS2GuidedFlow = isDHIS2Database;
  const useTabLayout =
    (isEditMode || useSqlAlchemyForm) && !isDHIS2GuidedFlow;
  const isDHIS2ShellConfigurationStep =
    isDHIS2GuidedFlow && dhis2CreateStage === 'details';
  const effectiveValidationErrors = isDHIS2ShellConfigurationStep
    ? null
    : validationErrors;
  const activeDHIS2ConfiguredConnections = dhis2ConfiguredConnections.filter(
    instance => instance.is_active,
  );
  const repositoryStepInitialValueFromDb = useMemo(
    () => {
      if (!db) {
        return null;
      }
      return {
        repository_reporting_unit_approach:
          db.repository_reporting_unit_approach || null,
        lowest_data_level_to_use: db.lowest_data_level_to_use ?? null,
        primary_instance_id: db.primary_instance_id ?? null,
        repository_data_scope: db.repository_data_scope || null,
        repository_org_unit_config: db.repository_org_unit_config || null,
        repository_org_units: db.repository_org_units || [],
        repository_org_unit_summary:
          db.repository_org_unit_summary || undefined,
      };
    },
    [db],
  );
  const repositoryStepInitialValue = useMemo(() => {
    // Only derive initialValue from the persisted DB state.
    // Never feed repositoryReportingUnitsValue (the child's own output) back
    // as initialValue — that creates a parent↔child reinitialization loop
    // where onChange triggers a new initialValue, which resets the child,
    // which emits onChange again.
    return repositoryStepInitialValueFromDb;
  }, [repositoryStepInitialValueFromDb]);
  const effectiveRepositoryReportingUnitsValue = useMemo(() => {
    if (!repositoryReportingUnitsValue) {
      return repositoryStepInitialValueFromDb
        ? ({
            ...repositoryStepInitialValueFromDb,
            validationError: null,
          } as RepositoryReportingUnitsStepValue)
        : null;
    }

    if (
      repositoryReportingUnitsValue.repository_reporting_unit_approach ===
        'primary_instance' &&
      repositoryReportingUnitsValue.primary_instance_id == null &&
      repositoryStepInitialValueFromDb?.primary_instance_id != null
    ) {
      const hasResolvedRepositoryOrgUnits =
        (repositoryReportingUnitsValue.repository_org_units || []).length > 0 ||
        Boolean(
          repositoryReportingUnitsValue.repository_org_unit_config
            ?.selected_org_unit_details?.length,
        ) ||
        Boolean(
          repositoryReportingUnitsValue.repository_org_unit_config
            ?.separate_instance_configs?.some(
              config => config.selected_org_units.length > 0,
            ),
        );
      return {
        ...repositoryReportingUnitsValue,
        primary_instance_id: repositoryStepInitialValueFromDb.primary_instance_id,
        validationError: hasResolvedRepositoryOrgUnits
          ? null
          : repositoryReportingUnitsValue.validationError,
      };
    }

    return repositoryReportingUnitsValue;
  }, [repositoryReportingUnitsValue, repositoryStepInitialValueFromDb]);

  const loadDhis2ConfiguredConnections = useCallback(
    async (nextDatabaseId: number) => {
      try {
        const response = await SupersetClient.get({
          endpoint: `/api/v1/dhis2/instances/?database_id=${nextDatabaseId}&include_inactive=true`,
        });
        const nextInstances = ((response.json.result || []) as DHIS2Instance[]).sort(
          (left, right) => {
            if (left.is_active !== right.is_active) {
              return left.is_active ? -1 : 1;
            }
            if ((left.display_order || 0) !== (right.display_order || 0)) {
              return (left.display_order || 0) - (right.display_order || 0);
            }
            return left.name.localeCompare(right.name);
          },
        );
        setDhis2ConfiguredConnections(nextInstances);
      } catch {
        setDhis2ConfiguredConnections([]);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      !isDHIS2GuidedFlow ||
      !db?.id ||
      repositoryReportingUnitsValue ||
      !repositoryStepInitialValue
    ) {
      return;
    }

    setRepositoryReportingUnitsValue({
      ...repositoryStepInitialValue,
      validationError: null,
    } as RepositoryReportingUnitsStepValue);
  }, [
    db?.id,
    isDHIS2GuidedFlow,
    repositoryReportingUnitsValue,
    repositoryStepInitialValue,
  ]);

  useEffect(() => {
    if (!isDHIS2GuidedFlow || !repositoryStepInitialValueFromDb) {
      return;
    }

    const dbHasRepositoryConfig = Boolean(
      repositoryStepInitialValueFromDb.repository_reporting_unit_approach ||
        repositoryStepInitialValueFromDb.repository_org_unit_config ||
        (repositoryStepInitialValueFromDb.repository_org_units || []).length,
    );

    if (!dbHasRepositoryConfig) {
      return;
    }

    const shouldRepairPrimaryInstance =
      repositoryReportingUnitsValue?.repository_reporting_unit_approach ===
        'primary_instance' &&
      repositoryReportingUnitsValue.primary_instance_id == null &&
      repositoryStepInitialValueFromDb.primary_instance_id != null;

    if (!repositoryReportingUnitsValue || shouldRepairPrimaryInstance) {
      setRepositoryReportingUnitsValue({
        ...repositoryStepInitialValueFromDb,
        validationError: null,
      } as RepositoryReportingUnitsStepValue);
    }
  }, [
    isDHIS2GuidedFlow,
    repositoryReportingUnitsValue,
    repositoryStepInitialValueFromDb,
  ]);

  useEffect(() => {
    if (!isDHIS2GuidedFlow || !dbFetched?.id) {
      return;
    }
    void loadDhis2ConfiguredConnections(dbFetched.id as number);
  }, [dbFetched?.id, isDHIS2GuidedFlow, loadDhis2ConfiguredConnections]);

  const modalWidth = isDHIS2Database ? '960px' : '500px';

  const dbModel: DatabaseForm =
    // TODO: we need a centralized engine in one place

    // first try to match both engine and driver
    availableDbs?.databases?.find(
      (available: {
        engine: string | undefined;
        default_driver: string | undefined;
      }) =>
        available.engine === (isEditMode ? db?.backend : db?.engine) &&
        available.default_driver === db?.driver,
    ) ||
    // alternatively try to match only engine
    availableDbs?.databases?.find(
      (available: { engine: string | undefined }) =>
        available.engine === (isEditMode ? db?.backend : db?.engine),
    ) ||
    {};

  const clearFormStatus = useCallback(() => {
    setFormStatus(null);
  }, []);

  const showFormError = useCallback(
    (title: string, description: string, details?: string) => {
      setFormStatus({
        type: 'error',
        title,
        description,
        details: details ? normalizeStatusDetails(details) : undefined,
      });
    },
    [],
  );

  const showFormSuccess = useCallback((title: string, description: string) => {
    setFormStatus({
      type: 'success',
      title,
      description,
    });
  }, []);

  // Test Connection logic
  const testConnection = () => {
    handleClearValidationErrors();

    // For parameter-based databases (dynamic form), send parameters and engine
    // Backend will call build_sqlalchemy_uri() to generate the URI
    const isParameterBased =
      db?.configuration_method === ConfigurationMethod.DynamicForm &&
      !!db?.engine;

    if (!isParameterBased && !db?.sqlalchemy_uri) {
      showFormError(
        t('SQLAlchemy URI required'),
        t('Enter a SQLAlchemy URI before testing the connection.'),
      );
      setHasValidated(false);
      return;
    }

    const connection: Partial<DatabaseObject> = {
      sqlalchemy_uri: db?.sqlalchemy_uri || '',
      database_name: db?.database_name?.trim() || undefined,
      impersonate_user: db?.impersonate_user || undefined,
      extra: db?.extra,
      masked_encrypted_extra: db?.masked_encrypted_extra || '',
      server_cert: db?.server_cert || undefined,
      // For parameter-based databases, include parameters and engine
      ...(isParameterBased && {
        parameters: db.parameters,
        engine: db.engine,
        driver: db?.driver,
        configuration_method:
          db?.configuration_method || ConfigurationMethod.DynamicForm,
      }),
      ssh_tunnel:
        !isEmpty(db?.ssh_tunnel) && useSSHTunneling
          ? {
              ...db.ssh_tunnel,
              server_port: Number(db.ssh_tunnel!.server_port),
            }
          : undefined,
    };
    setTestInProgress(true);
    testDatabaseConnection(
      connection,
      (errorMsg: string) => {
        setTestInProgress(false);
        showFormError(
          t('Connection test failed'),
          t('Superset could not connect using the current settings.'),
          errorMsg,
        );
        setHasValidated(false);
      },
      () => {
        setTestInProgress(false);
        showFormSuccess(
          t('Connection looks good'),
          t('Superset can reach this database with the current settings.'),
        );
        setHasValidated(true);
      },
    );
  };

  const getPlaceholder = (field: string) => {
    if (field === 'database') {
      return t('e.g. world_population');
    }
    return undefined;
  };

  const removeFile = (removedFile: UploadFile) => {
    setFileList(fileList.filter(file => file.uid !== removedFile.uid));
    return false;
  };

  const onChange = useCallback(
    (
      type: DBReducerActionType['type'],
      payload: CustomTextType | DBReducerPayloadType,
    ) => {
      clearFormStatus();
      clearError();
      setDB({ type, payload } as DBReducerActionType);
    },
    [clearError, clearFormStatus],
  );

  const handleClearValidationErrors = useCallback(() => {
    setValidationErrors(null);
    setHasValidated(false);
    clearFormStatus();
    clearError();
  }, [clearError, clearFormStatus, setValidationErrors, setHasValidated]);

  const handleParametersChange = useCallback(
    ({ target }: { target: HTMLInputElement }) => {
      onChange(ActionType.ParametersChange, {
        type: target.type,
        name: target.name,
        checked: target.checked,
        value: target.value,
      });
    },
    [onChange],
  );

  useEffect(() => {
    if (isDHIS2ShellConfigurationStep && validationErrors) {
      setValidationErrors(null);
    }
  }, [
    isDHIS2ShellConfigurationStep,
    setValidationErrors,
    validationErrors,
  ]);

  const onClose = () => {
    setDB({ type: ActionType.Reset });
    setHasConnectedDb(false);
    handleClearValidationErrors(); // reset validation errors on close
    clearError();
    clearFormStatus();
    setEditNewDb(false);
    setDhis2CreateStage('details');
    setDhis2ConfiguredConnections([]);
    setRepositoryReportingUnitsValue(null);
    setFileList([]);
    setImportingModal(false);
    setImportingErrorMessage('');
    setPasswordFields([]);
    setSSHTunnelPasswordFields([]);
    setSSHTunnelPrivateKeyFields([]);
    setSSHTunnelPrivateKeyPasswordFields([]);
    setPasswords({});
    setSSHTunnelPasswords({});
    setSSHTunnelPrivateKeys({});
    setSSHTunnelPrivateKeyPasswords({});
    setConfirmedOverwrite(false);
    setUseSSHTunneling(undefined);
    onHide();
  };

  const runExtraExtensionSave = useCallback(
    async (databaseModel: Partial<DatabaseObject> | null) => {
      if (!dbConfigExtraExtension?.onSave) {
        return false;
      }

      try {
        const result = await Promise.resolve(
          dbConfigExtraExtension.onSave(
            extraExtensionComponentState,
            databaseModel,
          ),
        );
        const error =
          result && typeof result === 'object' && 'error' in result
            ? String(result.error || '')
            : '';

        if (error) {
          showFormError(
            t('Additional settings need attention'),
            t('Review the additional database options before continuing.'),
            error,
          );
          return true;
        }
      } catch (error) {
        showFormError(
          t('Additional settings need attention'),
          t('Review the additional database options before continuing.'),
          error instanceof Error ? error.message : String(error),
        );
        return true;
      }

      return false;
    },
    [dbConfigExtraExtension, extraExtensionComponentState, showFormError],
  );

  const redirectURL = (url: string) => {
    history.push(url);
  };

  // Database import logic
  const {
    state: {
      alreadyExists,
      passwordsNeeded,
      sshPasswordNeeded,
      sshPrivateKeyNeeded,
      sshPrivateKeyPasswordNeeded,
      loading: importLoading,
      failed: importErrored,
    },
    importResource,
  } = useImportResource('database', t('database'), msg => {
    setImportingErrorMessage(msg);
  });

  const onSave = async () => {
    setLoading(true);
    setHasValidated(false);
    clearFormStatus();
    // Clone DB object
    const dbToUpdate = { ...(db || {}) };

    delete dbToUpdate.repository_org_unit_status;
    delete dbToUpdate.repository_org_unit_status_message;
    delete dbToUpdate.repository_org_unit_task_id;
    delete dbToUpdate.repository_org_unit_last_finalized_at;
    delete dbToUpdate.repository_org_unit_summary;

    if (isDHIS2GuidedFlow && dhis2CreateStage === 'review') {
      if (
        !effectiveRepositoryReportingUnitsValue ||
        effectiveRepositoryReportingUnitsValue.validationError
      ) {
        showFormError(
          t('Repository reporting unit setup needs attention'),
          t(
            'Review the repository reporting unit configuration before saving this DHIS2 Database.',
          ),
          effectiveRepositoryReportingUnitsValue?.validationError || undefined,
        );
        setLoading(false);
        return;
      }

      delete dbToUpdate.repository_org_units;
      dbToUpdate.repository_reporting_unit_approach =
        effectiveRepositoryReportingUnitsValue.repository_reporting_unit_approach;
      dbToUpdate.lowest_data_level_to_use =
        effectiveRepositoryReportingUnitsValue.lowest_data_level_to_use;
      dbToUpdate.primary_instance_id =
        effectiveRepositoryReportingUnitsValue.primary_instance_id;
      dbToUpdate.repository_data_scope =
        effectiveRepositoryReportingUnitsValue.repository_data_scope;
      dbToUpdate.repository_org_unit_config =
        effectiveRepositoryReportingUnitsValue.repository_org_unit_config;
    } else if (isDHIS2GuidedFlow) {
      delete dbToUpdate.repository_reporting_unit_approach;
      delete dbToUpdate.lowest_data_level_to_use;
      delete dbToUpdate.primary_instance_id;
      delete dbToUpdate.repository_data_scope;
      delete dbToUpdate.repository_org_unit_config;
      delete dbToUpdate.repository_org_units;
    }

    if (await runExtraExtensionSave(dbToUpdate)) {
      setLoading(false);
      return;
    }

    if (dbToUpdate.configuration_method === ConfigurationMethod.DynamicForm) {
      // Strip blank numeric parameters (e.g. port='') before save/test so the
      // backend schema validator does not reject them with "Not a valid integer".
      const schemaProps = isEditMode
        ? dbToUpdate.parameters_schema?.properties
        : dbModel?.parameters?.properties;
      if (schemaProps && dbToUpdate.parameters) {
        Object.keys(schemaProps).forEach(key => {
          const schemaType = schemaProps[key]?.type;
          if (
            (schemaType === 'integer' || schemaType === 'number') &&
            dbToUpdate.parameters?.[key as keyof DatabaseParameters] === ''
          ) {
            delete dbToUpdate.parameters[key as keyof DatabaseParameters];
          }
        });
      }

      // Validate DB before saving
      if (dbToUpdate?.parameters?.catalog) {
        // need to stringify gsheets catalog to allow it to be serialized
        dbToUpdate.extra = JSON.stringify({
          ...JSON.parse(dbToUpdate.extra || '{}'),
          engine_params: {
            catalog: dbToUpdate.parameters.catalog,
          },
        });
      }

      if (!isDHIS2ShellConfigurationStep) {
        const errors = await getValidation(dbToUpdate, true);
        if (!isEmpty(errors)) {
          showFormError(
            t('Review the highlighted connection settings'),
            t(
              'Some database settings need attention before this connection can be saved.',
            ),
            typeof errors.description === 'string'
              ? errors.description
              : undefined,
          );
          setLoading(false);
          return;
        }
      }

      const parameters_schema = isEditMode
        ? dbToUpdate.parameters_schema?.properties
        : dbModel?.parameters.properties;
      const additionalEncryptedExtra = JSON.parse(
        dbToUpdate.masked_encrypted_extra || '{}',
      );
      const paramConfigArray = Object.keys(parameters_schema || {});

      paramConfigArray.forEach(paramConfig => {
        /*
         * Parameters that are annotated with the `x-encrypted-extra` properties should be
         * moved to `masked_encrypted_extra`, so that they are stored encrypted in the
         * backend when the database is created or edited.
         */
        if (
          parameters_schema[paramConfig]['x-encrypted-extra'] &&
          dbToUpdate.parameters?.[paramConfig as keyof DatabaseParameters]
        ) {
          if (
            typeof dbToUpdate.parameters?.[
              paramConfig as keyof DatabaseParameters
            ] === 'object'
          ) {
            // add new encrypted extra to masked_encrypted_extra object
            additionalEncryptedExtra[paramConfig] =
              dbToUpdate.parameters?.[paramConfig as keyof DatabaseParameters];
            // The backend expects `masked_encrypted_extra` as a string for historical
            // reasons.
            dbToUpdate.parameters[
              paramConfig as OnlyKeyWithType<DatabaseParameters, string>
            ] = JSON.stringify(
              dbToUpdate.parameters[paramConfig as keyof DatabaseParameters],
            );
          } else {
            additionalEncryptedExtra[paramConfig] = JSON.parse(
              dbToUpdate.parameters?.[
                paramConfig as OnlyKeyWithType<DatabaseParameters, string>
              ] || '{}',
            );
          }
        }
      });
      // cast the new encrypted extra object into a string
      dbToUpdate.masked_encrypted_extra = JSON.stringify(
        additionalEncryptedExtra,
      );
      // this needs to be added by default to gsheets
      if (dbToUpdate.engine === Engines.GSheet) {
        dbToUpdate.impersonate_user = true;
      }
    }

    if (dbToUpdate?.parameters?.catalog) {
      // need to stringify gsheets catalog to allow it to be serialized
      dbToUpdate.extra = JSON.stringify({
        ...JSON.parse(dbToUpdate.extra || '{}'),
        engine_params: {
          catalog: dbToUpdate.parameters.catalog,
        },
      });
    }

    // strictly checking for false as an indication that the toggle got unchecked
    if (useSSHTunneling === false) {
      // remove ssh tunnel
      dbToUpdate.ssh_tunnel = null;
    }

    if (db?.id) {
      const result = await updateResource(
        db.id as number,
        dbToUpdate as DatabaseObject,
        true,
      );
      // Explicitly verify the update returned a valid database object.
      // A 422 or other error can produce a truthy-but-invalid result
      // (e.g. an error message string or an object without an id).
      // Without this check the modal could advance on failure.
      const isSuccessfulUpdate =
        result &&
        typeof result === 'object' &&
        !('error' in result) &&
        !('message' in result);
      if (isSuccessfulUpdate) {
        if (onDatabaseAdd) onDatabaseAdd();
        if (await runExtraExtensionSave(dbToUpdate)) {
          setLoading(false);
          return;
        }
        if (isDHIS2GuidedFlow) {
          if (dhis2CreateStage === 'review') {
            onClose();
            addSuccessToast(t('DHIS2 Database saved'));
            redirectURL(DATABASE_LIST_ROUTE);
          } else {
            await fetchResource(db.id as number);
            setEditNewDb(false);
            setHasConnectedDb(true);
            setDhis2CreateStage('connections');
          }
          setShowCTAbtns(false);
          setLoading(false);
          return;
        }
        if (!editNewDb) {
          onClose();
          addSuccessToast(t('Database settings updated'));
        }
      }
    } else if (db) {
      // Create
      const dbId = await createResource(
        dbToUpdate as DatabaseObject,
        true,
      );
      if (dbId) {
        setHasConnectedDb(true);
        if (onDatabaseAdd) onDatabaseAdd();
        if (await runExtraExtensionSave(dbToUpdate)) {
          setLoading(false);
          return;
        }

        if (isDHIS2GuidedFlow) {
          setDhis2CreateStage('connections');
          setShowCTAbtns(false);
          setLoading(false);
          return;
        }

        if (useTabLayout) {
          // tab layout only has one step
          // so it should close immediately on save
          onClose();
          addSuccessToast(t('Database connected'));
        }
      }
    } else {
      // Import - doesn't use db state
      setImportingModal(true);

      if (!(fileList[0].originFileObj instanceof File)) {
        return;
      }

      const dbId = await importResource(
        fileList[0].originFileObj,
        passwords,
        sshTunnelPasswords,
        sshTunnelPrivateKeys,
        sshTunnelPrivateKeyPasswords,
        confirmedOverwrite,
      );
      if (dbId) {
        if (onDatabaseAdd) onDatabaseAdd();
        onClose();
        addSuccessToast(t('Database connected'));
      }
    }

    setShowCTAbtns(true);
    setEditNewDb(false);
    setLoading(false);
  };

  // Initialize
  const fetchDB = () => {
    if (isEditMode && databaseId) {
      if (!dbLoading) {
        fetchResource(databaseId);
      }
    }
  };

  const setDatabaseModel = (database_name: string) => {
    if (database_name === 'Other') {
      // Allow users to connect to DB via legacy SQLA form
      setDB({
        type: ActionType.DbSelected,
        payload: {
          database_name,
          configuration_method: ConfigurationMethod.SqlalchemyUri,
          engine: undefined,
          engine_information: {
            supports_file_upload: true,
          },
        },
      });
    } else {
      const selectedDbModel = availableDbs?.databases.filter(
        (db: DatabaseObject) => db.name === database_name,
      )[0];
      const {
        engine,
        parameters,
        engine_information,
        default_driver,
        sqlalchemy_uri_placeholder,
      } = selectedDbModel;
      const isDynamic = parameters !== undefined;
      setDB({
        type: ActionType.DbSelected,
        payload: {
          database_name,
          engine,
          configuration_method: isDynamic
            ? ConfigurationMethod.DynamicForm
            : ConfigurationMethod.SqlalchemyUri,
          engine_information,
          driver: default_driver,
          sqlalchemy_uri_placeholder,
        },
      });

      if (engine === Engines.GSheet) {
        // only create a catalog if the DB is Google Sheets
        setDB({ type: ActionType.AddTableCatalogSheet });
      }
    }
  };

  const renderAvailableSelector = () => (
    <div className="available">
      <h4 className="available-label">
        {t('Or choose from a list of other databases we support:')}
      </h4>
      <FormLabel className="control-label">
        {t('Supported databases')}
      </FormLabel>
      <Select
        className="available-select"
        onChange={setDatabaseModel}
        placeholder={t('Choose a database...')}
        options={[
          ...(availableDbs?.databases || []).map(
            (database: DatabaseForm, index: number) => ({
              value: database.name,
              label: database.name,
              key: `database-${index}`,
            }),
          ),
          { value: 'Other', label: t('Other'), key: 'Other' },
        ]}
        showSearch
        sortComparator={(a, b) => {
          // Always put "Other" at the end
          if (a.value === 'Other') return 1;
          if (b.value === 'Other') return -1;
          // For all other options, sort alphabetically
          return String(a.label).localeCompare(String(b.label));
        }}
        getPopupContainer={triggerNode =>
          triggerNode.parentElement || document.body
        }
        dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
      />
      <Alert
        showIcon
        closable={false}
        css={(theme: SupersetTheme) => antDAlertStyles(theme)}
        type="info"
        message={
          connectionAlert?.ADD_DATABASE?.message ||
          t('Want to add a new database?')
        }
        description={
          connectionAlert?.ADD_DATABASE ? (
            <>
              {t(
                'Any databases that allow connections via SQL Alchemy URIs can be added. ',
              )}
              <a
                href={connectionAlert?.ADD_DATABASE.contact_link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {connectionAlert?.ADD_DATABASE.contact_description_link}
              </a>{' '}
              {connectionAlert?.ADD_DATABASE.description}
            </>
          ) : (
            <>
              {t(
                'Any databases that allow connections via SQL Alchemy URIs can be added. Learn about how to connect a database driver ',
              )}
              <a
                href={DOCUMENTATION_LINK}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('here')}
              </a>
              .
            </>
          )
        }
      />
    </div>
  );

  const renderPreferredSelector = () => (
    <div className="preferred">
      {availableDbs?.databases
        ?.filter((db: DatabaseForm) => db.preferred)
        .map((database: DatabaseForm) => (
          <IconButton
            className="preferred-item"
            onClick={() => setDatabaseModel(database.name)}
            buttonText={database.name}
            icon={dbImages?.[database.engine]}
            key={`${database.name}`}
          />
        ))}
    </div>
  );

  const handleBackButtonOnFinish = () => {
    if (dbFetched) {
      fetchResource(dbFetched.id as number);
    }
    setShowCTAbtns(false);
    setEditNewDb(true);
  };

  const handleBackButtonOnConnect = () => {
    handleClearValidationErrors();
    setDhis2CreateStage('details');
    if (editNewDb) setHasConnectedDb(false);
    if (importingModal) setImportingModal(false);
    if (importErrored) {
      setImportingModal(false);
      setImportingErrorMessage('');
      setPasswordFields([]);
      setSSHTunnelPasswordFields([]);
      setSSHTunnelPrivateKeyFields([]);
      setSSHTunnelPrivateKeyPasswordFields([]);
      setPasswords({});
      setSSHTunnelPasswords({});
      setSSHTunnelPrivateKeys({});
      setSSHTunnelPrivateKeyPasswords({});
    }
    setDB({ type: ActionType.Reset });
    setFileList([]);
  };

  const handleDisableOnImport = () => {
    if (
      importLoading ||
      (alreadyExists.length && !confirmedOverwrite) ||
      (passwordsNeeded.length && JSON.stringify(passwords) === '{}') ||
      (sshPasswordNeeded.length &&
        JSON.stringify(sshTunnelPasswords) === '{}') ||
      (sshPrivateKeyNeeded.length &&
        JSON.stringify(sshTunnelPrivateKeys) === '{}') ||
      (sshPrivateKeyPasswordNeeded.length &&
        JSON.stringify(sshTunnelPrivateKeyPasswords) === '{}')
    )
      return true;
    return false;
  };

  const renderModalFooter = () => {
    if (db) {
      if (isDHIS2GuidedFlow && hasConnectedDb && !editNewDb) {
        if (dhis2CreateStage === 'connections') {
          return (
            <>
              <StyledFooterButton
                key="back"
                onClick={() => {
                  setEditNewDb(true);
                  setDhis2CreateStage('details');
                }}
                buttonStyle="secondary"
              >
                {t('Back')}
              </StyledFooterButton>
              <StyledFooterButton
                key="submit"
                buttonStyle="primary"
                onClick={() => setDhis2CreateStage('repository')}
                disabled={activeDHIS2ConfiguredConnections.length === 0}
              >
                {t('Continue')}
              </StyledFooterButton>
            </>
          );
        }

        if (dhis2CreateStage === 'repository') {
          return (
            <>
              <StyledFooterButton
                key="back"
                onClick={() => setDhis2CreateStage('connections')}
                buttonStyle="secondary"
              >
                {t('Back')}
              </StyledFooterButton>
              <StyledFooterButton
                key="submit"
                buttonStyle="primary"
                onClick={() => setDhis2CreateStage('review')}
                disabled={
                  !repositoryReportingUnitsValue ||
                  !!repositoryReportingUnitsValue.validationError
                }
              >
                {t('Continue')}
              </StyledFooterButton>
            </>
          );
        }

        if (dhis2CreateStage === 'review') {
          return (
            <>
              <StyledFooterButton
                key="back"
                onClick={() => setDhis2CreateStage('repository')}
                buttonStyle="secondary"
              >
                {t('Back')}
              </StyledFooterButton>
              <StyledFooterButton
                key="submit"
                buttonStyle="primary"
                onClick={onSave}
                loading={isLoading}
                disabled={
                  !effectiveRepositoryReportingUnitsValue ||
                  !!effectiveRepositoryReportingUnitsValue.validationError
                }
              >
                {t('Save Database')}
              </StyledFooterButton>
            </>
          );
        }
      }

      // if db show back + connect
      if (!hasConnectedDb || editNewDb) {
        return (
          <>
            <StyledFooterButton
              key="back"
              onClick={handleBackButtonOnConnect}
              buttonStyle="secondary"
            >
              {t('Back')}
            </StyledFooterButton>
            <StyledFooterButton
              data-test="btn-submit-connection"
              key="submit"
              buttonStyle="primary"
              onClick={onSave}
              loading={isLoading}
              disabled={
                !!(
                  (!hasValidated && !isDHIS2ShellConfigurationStep) ||
                  isValidating ||
                  (effectiveValidationErrors &&
                    Object.keys(effectiveValidationErrors).length > 0)
                )
              }
            >
              {isDHIS2ShellConfigurationStep ? t('Continue') : t('Connect')}
            </StyledFooterButton>
          </>
        );
      }

      return (
        <>
          <StyledFooterButton key="back" onClick={handleBackButtonOnFinish}>
            {t('Back')}
          </StyledFooterButton>
          <StyledFooterButton
            key="submit"
            buttonStyle="primary"
            onClick={onSave}
            data-test="modal-confirm-button"
            loading={isLoading}
          >
            {t('Finish')}
          </StyledFooterButton>
        </>
      );
    }

    // Import doesn't use db state, so footer will not render in the if statement above
    if (importingModal) {
      return (
        <>
          <StyledFooterButton key="back" onClick={handleBackButtonOnConnect}>
            {t('Back')}
          </StyledFooterButton>
          <StyledFooterButton
            key="submit"
            buttonStyle="primary"
            onClick={onSave}
            disabled={handleDisableOnImport()}
            loading={isLoading}
          >
            {t('Connect')}
          </StyledFooterButton>
        </>
      );
    }

    return <></>;
  };

  const renderEditModalFooter = (db: Partial<DatabaseObject> | null) => (
    <>
      <StyledFooterButton key="close" onClick={onClose} buttonStyle="secondary">
        {t('Close')}
      </StyledFooterButton>
      <StyledFooterButton
        key="submit"
        buttonStyle="primary"
        onClick={onSave}
        disabled={db?.is_managed_externally}
        loading={isLoading}
        tooltip={
          db?.is_managed_externally
            ? t(
                "This database is managed externally, and can't be edited in Superset",
              )
            : ''
        }
      >
        {t('Finish')}
      </StyledFooterButton>
    </>
  );

  const firstUpdate = useRef(true); // Captures first render
  // Only runs when importing files don't need user input
  useEffect(() => {
    // Will not run on first render
    if (firstUpdate.current) {
      firstUpdate.current = false;
      return;
    }

    if (
      !importLoading &&
      !alreadyExists.length &&
      !passwordsNeeded.length &&
      !sshPasswordNeeded.length &&
      !sshPrivateKeyNeeded.length &&
      !sshPrivateKeyPasswordNeeded.length &&
      !isLoading && // This prevents a double toast for non-related imports
      !importErrored // This prevents a success toast on error
    ) {
      onClose();
      addSuccessToast(t('Database connected'));
    }
  }, [
    alreadyExists,
    passwordsNeeded,
    importLoading,
    importErrored,
    sshPasswordNeeded,
    sshPrivateKeyNeeded,
    sshPrivateKeyPasswordNeeded,
  ]);

  useEffect(() => {
    if (show) {
      setTabKey(DEFAULT_TAB_KEY);
      setLoading(true);
      getAvailableDbs();
    }
    if (databaseId && show) {
      fetchDB();
    }
  }, [show, databaseId]);

  useEffect(() => {
    if (dbFetched) {
      setDB({
        type: ActionType.Fetched,
        payload: dbFetched,
      });
      // keep a copy of the name separate for display purposes
      // because it shouldn't change when the form is updated
      setDbName(dbFetched.database_name);
    }
  }, [dbFetched]);

  useEffect(() => {
    if (isLoading) {
      setLoading(false);
    }

    if (availableDbs && dbEngine) {
      // set model if passed into props
      setDatabaseModel(dbEngine);
    }
  }, [availableDbs]);

  // This forces the modal to scroll until the importing filename is in view
  useEffect(() => {
    if (importingModal) {
      document
        ?.getElementsByClassName('ant-upload-list-item-name')[0]
        .scrollIntoView();
    }
  }, [importingModal]);

  useEffect(() => {
    setPasswordFields([...passwordsNeeded]);
  }, [passwordsNeeded]);

  useEffect(() => {
    setSSHTunnelPasswordFields([...sshPasswordNeeded]);
  }, [sshPasswordNeeded]);

  useEffect(() => {
    setSSHTunnelPrivateKeyFields([...sshPrivateKeyNeeded]);
  }, [sshPrivateKeyNeeded]);

  useEffect(() => {
    setSSHTunnelPrivateKeyPasswordFields([...sshPrivateKeyPasswordNeeded]);
  }, [sshPrivateKeyPasswordNeeded]);

  useEffect(() => {
    if (db?.parameters?.ssh !== undefined) {
      setUseSSHTunneling(db.parameters.ssh);
    }
  }, [db?.parameters?.ssh]);

  const onDbImport = async (info: UploadChangeParam) => {
    setImportingErrorMessage('');
    setPasswordFields([]);
    setSSHTunnelPasswordFields([]);
    setSSHTunnelPrivateKeyFields([]);
    setSSHTunnelPrivateKeyPasswordFields([]);
    setPasswords({});
    setSSHTunnelPasswords({});
    setSSHTunnelPrivateKeys({});
    setSSHTunnelPrivateKeyPasswords({});
    setImportingModal(true);
    setFileList([
      {
        ...info.file,
        status: 'done',
      },
    ]);

    if (!(info.file.originFileObj instanceof File)) return;
    const dbId = await importResource(
      info.file.originFileObj,
      passwords,
      sshTunnelPasswords,
      sshTunnelPrivateKeys,
      sshTunnelPrivateKeyPasswords,
      confirmedOverwrite,
    );
    if (dbId) onDatabaseAdd?.();
  };

  const passwordNeededField = () => {
    if (
      !passwordFields.length &&
      !sshTunnelPasswordFields.length &&
      !sshTunnelPrivateKeyFields.length &&
      !sshTunnelPrivateKeyPasswordFields.length
    )
      return null;

    const files = [
      ...new Set([
        ...passwordFields,
        ...sshTunnelPasswordFields,
        ...sshTunnelPrivateKeyFields,
        ...sshTunnelPrivateKeyPasswordFields,
      ]),
    ];

    return files.map(database => (
      <>
        <StyledAlertMargin>
          <Alert
            closable={false}
            css={(theme: SupersetTheme) => antDAlertStyles(theme)}
            type="info"
            showIcon
            message="Database passwords"
            description={t(
              `The passwords for the databases below are needed in order to import them. Please note that the "Secure Extra" and "Certificate" sections of the database configuration are not present in explore files and should be added manually after the import if they are needed.`,
            )}
          />
        </StyledAlertMargin>
        {passwordFields?.indexOf(database) >= 0 && (
          <ValidatedInput
            id="password_needed"
            name="password_needed"
            required
            value={passwords[database]}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setPasswords({ ...passwords, [database]: event.target.value })
            }
            isValidating={isValidating}
            validationMethods={{ onBlur: () => {} }}
            errorMessage={validationErrors?.password_needed}
            label={t('%s PASSWORD', database.slice(10))}
            css={formScrollableStyles}
          />
        )}
        {sshTunnelPasswordFields?.indexOf(database) >= 0 && (
          <ValidatedInput
            isValidating={isValidating}
            id="ssh_tunnel_password_needed"
            name="ssh_tunnel_password_needed"
            required
            value={sshTunnelPasswords[database]}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setSSHTunnelPasswords({
                ...sshTunnelPasswords,
                [database]: event.target.value,
              })
            }
            validationMethods={{ onBlur: () => {} }}
            errorMessage={validationErrors?.ssh_tunnel_password_needed}
            label={t('%s SSH TUNNEL PASSWORD', database.slice(10))}
            css={formScrollableStyles}
          />
        )}
        {sshTunnelPrivateKeyFields?.indexOf(database) >= 0 && (
          <ValidatedInput
            id="ssh_tunnel_private_key_needed"
            name="ssh_tunnel_private_key_needed"
            isValidating={isValidating}
            required
            value={sshTunnelPrivateKeys[database]}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setSSHTunnelPrivateKeys({
                ...sshTunnelPrivateKeys,
                [database]: event.target.value,
              })
            }
            validationMethods={{ onBlur: () => {} }}
            errorMessage={validationErrors?.ssh_tunnel_private_key_needed}
            label={t('%s SSH TUNNEL PRIVATE KEY', database.slice(10))}
            css={formScrollableStyles}
          />
        )}
        {sshTunnelPrivateKeyPasswordFields?.indexOf(database) >= 0 && (
          <ValidatedInput
            id="ssh_tunnel_private_key_password_needed"
            name="ssh_tunnel_private_key_password_needed"
            isValidating={isValidating}
            required
            value={sshTunnelPrivateKeyPasswords[database]}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setSSHTunnelPrivateKeyPasswords({
                ...sshTunnelPrivateKeyPasswords,
                [database]: event.target.value,
              })
            }
            validationMethods={{ onBlur: () => {} }}
            errorMessage={
              validationErrors?.ssh_tunnel_private_key_password_needed
            }
            label={t('%s SSH TUNNEL PRIVATE KEY PASSWORD', database.slice(10))}
            css={formScrollableStyles}
          />
        )}
      </>
    ));
  };

  const importingErrorAlert = () => {
    if (!importingErrorMessage) return null;

    return (
      <StyledAlertMargin>
        <ErrorAlert message={importingErrorMessage} />
      </StyledAlertMargin>
    );
  };

  const confirmOverwrite = (event: ChangeEvent<HTMLInputElement>) => {
    const targetValue = (event.currentTarget?.value as string) ?? '';
    setConfirmedOverwrite(targetValue.toUpperCase() === t('OVERWRITE'));
  };

  const confirmOverwriteField = () => {
    if (!alreadyExists.length) return null;

    return (
      <>
        <StyledAlertMargin>
          <Alert
            closable={false}
            css={(theme: SupersetTheme) => antdWarningAlertStyles(theme)}
            type="warning"
            showIcon
            message=""
            description={t(
              'You are importing one or more databases that already exist. Overwriting might cause you to lose some of your work. Are you sure you want to overwrite?',
            )}
          />
        </StyledAlertMargin>
        <ValidatedInput
          id="confirm_overwrite"
          name="confirm_overwrite"
          isValidating={isValidating}
          required
          validationMethods={{ onBlur: () => {} }}
          errorMessage={validationErrors?.confirm_overwrite}
          label={t('Type "%s" to confirm', t('OVERWRITE'))}
          onChange={confirmOverwrite}
          css={formScrollableStyles}
        />
      </>
    );
  };

  const tabChange = (key: string) => setTabKey(key);

  const renderStepTwoAlert = () => {
    const { hostname } = window.location;
    let ipAlert = connectionAlert?.REGIONAL_IPS?.default || '';
    const regionalIPs = connectionAlert?.REGIONAL_IPS || {};
    Object.entries(regionalIPs).forEach(([ipRegion, ipRange]) => {
      const regex = new RegExp(ipRegion);
      if (hostname.match(regex)) ipAlert = ipRange;
    });
    return (
      db?.engine && (
        <StyledAlertMargin>
          <Alert
            closable={false}
            css={(theme: SupersetTheme) => antDAlertStyles(theme)}
            type="info"
            showIcon
            message={
              engineSpecificAlertMapping[
                db.engine as keyof typeof engineSpecificAlertMapping
              ]?.message || connectionAlert?.DEFAULT?.message
            }
            description={
              engineSpecificAlertMapping[
                db.engine as keyof typeof engineSpecificAlertMapping
              ]?.description || connectionAlert?.DEFAULT?.description + ipAlert
            }
          />
        </StyledAlertMargin>
      )
    );
  };

  const getDatabaseAlertErrors = () => {
    let alertErrors: string[] = [];
    if (!isEmpty(dbErrors)) {
      alertErrors =
        typeof dbErrors === 'object'
          ? Object.values(dbErrors).flatMap(value =>
              Array.isArray(value)
                ? value.map(item => String(item))
                : typeof value === 'string'
                  ? [value]
                  : [JSON.stringify(value)],
            )
          : typeof dbErrors === 'string'
            ? [dbErrors]
            : [];
    } else if (
      !isEmpty(effectiveValidationErrors) &&
      effectiveValidationErrors?.error_type === 'GENERIC_DB_ENGINE_ERROR'
    ) {
      alertErrors = [
        effectiveValidationErrors?.description ||
          effectiveValidationErrors?.message,
      ];
    }

    return alertErrors.filter(Boolean);
  };

  const renderFormStatusAlert = () => {
    if (!formStatus) {
      return null;
    }

    return (
      <StyledAlertMargin>
        <Alert
          data-test="database-modal-status-alert"
          closable
          onClose={clearFormStatus}
          css={(theme: SupersetTheme) => antDAlertStyles(theme)}
          type={formStatus.type}
          showIcon
          message={formStatus.title}
          description={
            <>
              <div>{formStatus.description}</div>
              {formStatus.details && (
                <div
                  style={{
                    marginTop: 8,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {formStatus.details}
                </div>
              )}
            </>
          }
        />
      </StyledAlertMargin>
    );
  };

  const errorAlert = () => {
    const alertErrors = getDatabaseAlertErrors();
    if (!alertErrors.length) {
      return null;
    }

    return (
      <ErrorAlertContainer>
        <ErrorMessageWithStackTrace
          title={t('Database connection issue')}
          subtitle={t(
            'Review the details below, update the settings, and try again.',
          )}
          descriptionDetails={alertErrors[0]}
          copyText={alertErrors[0]}
        />
      </ErrorAlertContainer>
    );
  };

  const hasInlineDatabaseError = getDatabaseAlertErrors().length > 0;
  const shouldShowDatabaseErrorAlert = hasInlineDatabaseError && !formStatus;

  const fetchAndSetDB = () => {
    setLoading(true);
    fetchResource(dbFetched?.id as number).then(r => {
      setItem(LocalStorageKeys.Database, r);
    });
  };

  const renderSSHTunnelForm = () => (
    <SSHTunnelForm
      db={db as DatabaseObject}
      onSSHTunnelParametersChange={({ target }) => {
        onChange(ActionType.ParametersSSHTunnelChange, {
          type: target.type,
          name: target.name,
          value: target.value,
        });
        handleClearValidationErrors();
      }}
      setSSHTunnelLoginMethod={(method: AuthType) =>
        setDB({
          type: ActionType.SetSSHTunnelLoginMethod,
          payload: { login_method: method },
        })
      }
    />
  );

  const renderCTABtns = () => (
    <StyledBtns>
      <Button
        buttonStyle="secondary"
        onClick={() => {
          setLoading(true);
          fetchAndSetDB();
          redirectURL('/dataset/add/');
        }}
      >
        {t('Create dataset')}
      </Button>
      <Button
        buttonStyle="secondary"
        onClick={() => {
          setLoading(true);
          fetchAndSetDB();
          redirectURL(`/sqllab?db=true`);
        }}
      >
        {t('Query data in SQL Lab')}
      </Button>
    </StyledBtns>
  );

  const renderDatabaseConnectionForm = () => (
    <>
      <DatabaseConnectionForm
        isValidating={isValidating}
        isEditMode={isEditMode}
        excludedFields={
          isDHIS2ShellConfigurationStep ? DHIS2_SHELL_EXCLUDED_FIELDS : []
        }
        db={db as DatabaseObject}
        sslForced={false}
        dbModel={dbModel}
        testConnection={
          isDHIS2ShellConfigurationStep ? undefined : testConnection
        }
        testInProgress={testInProgress}
        hideTestConnection={isDHIS2ShellConfigurationStep}
        onAddTableCatalog={() => {
          setDB({ type: ActionType.AddTableCatalogSheet });
        }}
        onQueryChange={({ target }: { target: HTMLInputElement }) =>
          onChange(ActionType.QueryChange, {
            name: target.name,
            value: target.value,
          })
        }
        onExtraInputChange={({ target }: { target: HTMLInputElement }) =>
          onChange(ActionType.ExtraInputChange, {
            name: target.name,
            value: target.value,
          })
        }
        onEncryptedExtraInputChange={({
          target,
        }: {
          target: HTMLInputElement;
        }) =>
          onChange(ActionType.EncryptedExtraInputChange, {
            name: target.name,
            value: target.value,
          })
        }
        onRemoveTableCatalog={(idx: number) => {
          setDB({
            type: ActionType.RemoveTableCatalogSheet,
            payload: { indexToDelete: idx },
          });
        }}
        onParametersChange={handleParametersChange}
        onChange={({ target }: { target: HTMLInputElement }) =>
          onChange(ActionType.TextChange, {
            name: target.name,
            value: target.value,
          })
        }
        getValidation={() =>
          isDHIS2ShellConfigurationStep ? Promise.resolve([]) : getValidation(db)
        }
        validationErrors={effectiveValidationErrors}
        getPlaceholder={getPlaceholder}
        clearValidationErrors={handleClearValidationErrors}
      />
      {useSSHTunneling && (
        <SSHTunnelContainer>{renderSSHTunnelForm()}</SSHTunnelContainer>
      )}
      {isDHIS2ShellConfigurationStep && (
        <StyledAlertMargin>
          <Alert
            closable={false}
            css={(theme: SupersetTheme) => antDAlertStyles(theme)}
            message={t('This DHIS2 Database is a logical container')}
            showIcon
            description={t(
              'Define the Superset-facing database name here. In the next step you will add one or more configured DHIS2 instances, each with its own URL and authentication details. Dataset creation then loads those saved child connections automatically.',
            )}
            type="info"
          />
        </StyledAlertMargin>
      )}
    </>
  );

  const renderDHIS2ConnectionsPanel = () => (
    <div css={formScrollableStyles}>
      <DHIS2ConfiguredConnectionsPanel
        databaseId={db?.id}
        databaseName={db?.database_name}
        onInstancesChange={setDhis2ConfiguredConnections}
      />
    </div>
  );

  const renderDHIS2RepositoryReportingUnitsStep = () => (
    <div css={formScrollableStyles}>
      <DHIS2RepositoryReportingUnitsStep
        databaseId={db?.id}
        instances={dhis2ConfiguredConnections}
        initialValue={repositoryStepInitialValue}
        onChange={setRepositoryReportingUnitsValue}
      />
    </div>
  );

  const renderDHIS2CreateReview = () => {
    const repositoryValue =
      effectiveRepositoryReportingUnitsValue || repositoryReportingUnitsValue;
    const selectedRepositoryOrgUnitCount = repositoryValue
      ? repositoryValue.repository_org_unit_config
          ?.selected_org_unit_details?.length ||
        repositoryValue.repository_org_unit_config?.separate_instance_configs?.reduce(
          (sum, item) => sum + item.selected_org_units.length,
          0,
        ) ||
        0
      : 0;

    return (
      <>
      <StyledAlertMargin>
        <Alert
          closable={false}
          css={(theme: SupersetTheme) => antDAlertStyles(theme)}
          message={t('Review the DHIS2 Database before saving')}
          showIcon
          description={t(
            'This database will expose the configured DHIS2 instances below as a single logical Superset Database. Dataset creation uses these saved connections directly and loads metadata from local staging, while repository reporting units persist the lineage needed to route future extraction back to the correct DHIS2 source instances.',
          )}
          type="info"
        />
      </StyledAlertMargin>
      <div css={formScrollableStyles}>
        <div className="control-label">{t('Database name')}</div>
        <div style={{ marginBottom: 16 }}>{db?.database_name || t('Unnamed')}</div>
        <div className="control-label">{t('Configured DHIS2 instances')}</div>
        <div style={{ marginBottom: 16 }}>
          {activeDHIS2ConfiguredConnections.length === 0
            ? t('No active instances configured yet')
            : t(
                '%s active instance(s) will be available for dataset creation.',
                activeDHIS2ConfiguredConnections.length,
              )}
        </div>
        {dhis2ConfiguredConnections.length > 0 && (
          <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
            {dhis2ConfiguredConnections.map(instance => (
              <div
                key={instance.id}
                style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ fontWeight: 600 }}>{instance.name}</div>
                <div style={{ color: 'rgba(0, 0, 0, 0.45)' }}>{instance.url}</div>
                <div style={{ marginTop: 6, color: 'rgba(0, 0, 0, 0.65)' }}>
                  {instance.is_active ? t('Active') : t('Inactive')} ·{' '}
                  {instance.auth_type === 'pat'
                    ? t('Personal Access Token')
                    : t('Basic authentication')}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="control-label">
          {t('Repository reporting unit configuration')}
        </div>
        {repositoryValue ? (
          <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
            {renderRepositorySummaryLines(
              repositoryValue,
              activeDHIS2ConfiguredConnections,
            ).map(item => (
              <div key={item.label}>
                <div style={{ fontWeight: 600 }}>{item.label}</div>
                <div style={{ color: 'rgba(0, 0, 0, 0.65)' }}>{item.value}</div>
              </div>
            ))}
            <div>
              <div style={{ fontWeight: 600 }}>
                {t('Selected child instances')}
              </div>
              <div style={{ color: 'rgba(0, 0, 0, 0.65)' }}>
                {activeDHIS2ConfiguredConnections.length === 0
                  ? t('No active instances configured yet')
                  : activeDHIS2ConfiguredConnections
                      .map(instance => instance.name)
                      .join(', ')}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>{t('Selected org units')}</div>
              <div style={{ color: 'rgba(0, 0, 0, 0.65)' }}>
                {selectedRepositoryOrgUnitCount > 0
                  ? t(
                      '%s item(s) selected for repository persistence.',
                      selectedRepositoryOrgUnitCount,
                    )
                  : t('No repository org units selected yet')}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>
                {t('Enabled analysis dimensions')}
              </div>
              <div style={{ color: 'rgba(0, 0, 0, 0.65)' }}>
                {t(
                  '%s level(s), %s group set(s), %s group(s).',
                  repositoryValue.repository_org_unit_summary
                    .enabled_level_dimensions || 0,
                  repositoryValue.repository_org_unit_summary
                    .enabled_group_set_dimensions || 0,
                  repositoryValue.repository_org_unit_summary
                    .enabled_group_dimensions || 0,
                )}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>
                {t('Mapping / merge summary')}
              </div>
              <div style={{ color: 'rgba(0, 0, 0, 0.65)' }}>
                {repositoryValue.repository_reporting_unit_approach ===
                'map_merge'
                  ? t(
                      'Repository level mappings are persisted alongside the resolved merged repository hierarchy.',
                    )
                  : repositoryValue.repository_reporting_unit_approach ===
                      'auto_merge'
                    ? t(
                        'Auto-merge settings, resolved repository units, unmatched units, and conflicted units are persisted for reviewable lineage.',
                      )
                    : repositoryValue.repository_reporting_unit_approach ===
                        'separate'
                      ? t(
                          'Each instance keeps its own source-specific repository reporting units and data scope configuration.',
                        )
                      : t(
                          'The selected primary instance defines the repository hierarchy and stored source lineage.',
                        )}
              </div>
            </div>
            {repositoryValue.validationError ? (
              <Alert
                type="warning"
                showIcon
                message={t('Repository reporting unit setup needs attention')}
                description={repositoryValue.validationError}
              />
            ) : null}
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {t('Repository reporting units have not been reviewed yet.')}
          </div>
        )}
      </div>
      <ExtraOptions
        extraExtension={dbConfigExtraExtension}
        db={db as DatabaseObject}
        onInputChange={(
          e: CheckboxChangeEvent | React.ChangeEvent<HTMLInputElement>,
        ) => {
          const { target } = e;
          onChange(ActionType.InputChange, {
            type: target.type,
            name: target.name,
            checked: 'checked' in target ? target.checked : false,
            value: target.value,
          });
        }}
        onTextChange={({ target }: { target: HTMLTextAreaElement }) =>
          onChange(ActionType.TextChange, {
            name: target.name,
            value: target.value,
          })
        }
        onEditorChange={(payload: { name: string; json: any }) =>
          onChange(ActionType.EditorChange, payload)
        }
        onExtraInputChange={(
          e: CheckboxChangeEvent | React.ChangeEvent<HTMLInputElement>,
        ) => {
          const { target } = e;
          onChange(ActionType.ExtraInputChange, {
            type: target.type,
            name: target.name,
            checked: 'checked' in target ? target.checked : false,
            value: target.value,
          });
        }}
        onExtraEditorChange={(payload: { name: string; json: any }) =>
          onChange(ActionType.ExtraEditorChange, payload)
        }
      />
    </>
    );
  };

  const renderFinishState = () => {
    if (isDHIS2GuidedFlow) {
      if (dhis2CreateStage === 'connections') {
        return renderDHIS2ConnectionsPanel();
      }
      if (dhis2CreateStage === 'repository') {
        return renderDHIS2RepositoryReportingUnitsStep();
      }
      if (dhis2CreateStage === 'review') {
        return renderDHIS2CreateReview();
      }
    }
    if (!editNewDb) {
      return (
        <>
          {isDHIS2Database && renderDHIS2ConnectionsPanel()}
          <ExtraOptions
            extraExtension={dbConfigExtraExtension}
            db={db as DatabaseObject}
            onInputChange={(
              e: CheckboxChangeEvent | React.ChangeEvent<HTMLInputElement>,
            ) => {
              const { target } = e;
              onChange(ActionType.InputChange, {
                type: target.type,
                name: target.name,
                checked: 'checked' in target ? target.checked : false,
                value: target.value,
              });
            }}
            onTextChange={({ target }: { target: HTMLTextAreaElement }) =>
              onChange(ActionType.TextChange, {
                name: target.name,
                value: target.value,
              })
            }
            onEditorChange={(payload: { name: string; json: any }) =>
              onChange(ActionType.EditorChange, payload)
            }
            onExtraInputChange={(
              e: CheckboxChangeEvent | React.ChangeEvent<HTMLInputElement>,
            ) => {
              const { target } = e;
              onChange(ActionType.ExtraInputChange, {
                type: target.type,
                name: target.name,
                checked: 'checked' in target ? target.checked : false,
                value: target.value,
              });
            }}
            onExtraEditorChange={(payload: { name: string; json: any }) =>
              onChange(ActionType.ExtraEditorChange, payload)
            }
          />
        </>
      );
    }
    return renderDatabaseConnectionForm();
  };

  const modalTabs = [
    {
      key: TABS_KEYS.BASIC,
      label: <span>{t('Basic')}</span>,
      children: (
        <>
          {useSqlAlchemyForm ? (
            <StyledAlignment>
              <SqlAlchemyForm
                db={db as DatabaseObject}
                onInputChange={({
                  target,
                }: {
                  target: HTMLInputElement;
                }) => {
                  setHasValidated(false);
                  onChange(ActionType.InputChange, {
                    type: target.type,
                    name: target.name,
                    checked: target.checked,
                    value: target.value,
                  });
                }}
                conf={conf}
                testConnection={testConnection}
                testInProgress={testInProgress}
              >
                <SSHTunnelSwitchComponent
                  dbModel={dbModel}
                  db={db as DatabaseObject}
                  changeMethods={{
                    onParametersChange: handleParametersChange,
                  }}
                  clearValidationErrors={handleClearValidationErrors}
                />
                {useSSHTunneling && renderSSHTunnelForm()}
              </SqlAlchemyForm>
              {isDynamic(db?.backend || db?.engine) && !isEditMode && (
                <div css={(theme: SupersetTheme) => infoTooltip(theme)}>
                  <Button
                    buttonStyle="link"
                    onClick={() =>
                      setDB({
                        type: ActionType.ConfigMethodChange,
                        payload: {
                          database_name: db?.database_name,
                          configuration_method:
                            ConfigurationMethod.DynamicForm,
                          engine: db?.engine,
                        },
                      })
                    }
                    css={theme => alchemyButtonLinkStyles(theme)}
                  >
                    {t('Connect this database using the dynamic form instead')}
                  </Button>
                  <InfoTooltip
                    tooltip={t(
                      'Click this link to switch to an alternate form that exposes only the required fields needed to connect this database.',
                    )}
                  />
                </div>
              )}
            </StyledAlignment>
          ) : (
            renderDatabaseConnectionForm()
          )}
          {!isEditMode && (
            <StyledAlertMargin>
              <Alert
                closable={false}
                css={(theme: SupersetTheme) => antDAlertStyles(theme)}
                message={t('Additional fields may be required')}
                showIcon
                description={
                  <>
                    {t(
                      'Select databases require additional fields to be completed in the Advanced tab to successfully connect the database. Learn what requirements your databases has ',
                    )}
                    <a
                      href={DOCUMENTATION_LINK}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="additional-fields-alert-description"
                    >
                      {t('here')}
                    </a>
                    .
                  </>
                }
                type="info"
              />
            </StyledAlertMargin>
          )}
        </>
      ),
    },
    {
      key: TABS_KEYS.ADVANCED,
      label: <span>{t('Advanced')}</span>,
      children: (
        <ExtraOptions
          extraExtension={dbConfigExtraExtension}
          db={db as DatabaseObject}
          onInputChange={(e: CheckboxChangeEvent) => {
            const { target } = e;
            onChange(ActionType.InputChange, {
              type: target.type,
              name: target.name,
              checked: target.checked,
              value: target.value,
            });
          }}
          onTextChange={({ target }: { target: HTMLTextAreaElement }) => {
            onChange(ActionType.TextChange, {
              name: target.name,
              value: target.value,
            });
          }}
          onEditorChange={(payload: { name: string; json: any }) => {
            onChange(ActionType.EditorChange, payload);
          }}
          onExtraInputChange={(
            e: React.ChangeEvent<HTMLInputElement> | CheckboxChangeEvent,
          ) => {
            const { target } = e;
            onChange(ActionType.ExtraInputChange, {
              type: target.type,
              name: target.name,
              checked: target.checked,
              value: target.value,
            });
          }}
          onExtraEditorChange={(payload: { name: string; json: any }) => {
            onChange(ActionType.ExtraEditorChange, payload);
          }}
        />
      ),
    },
    ...(isDHIS2Database && db?.id
      ? [
          {
            key: TABS_KEYS.CONNECTIONS,
            label: <span>{t('Configured Connections')}</span>,
            children: renderDHIS2ConnectionsPanel(),
          },
        ]
      : []),
  ];

  if (
    fileList.length > 0 &&
    (alreadyExists.length ||
      passwordFields.length ||
      sshTunnelPasswordFields.length ||
      sshTunnelPrivateKeyFields.length ||
      sshTunnelPrivateKeyPasswordFields.length)
  ) {
    return (
      <Modal
        centered
        css={(theme: SupersetTheme) => [
          antDModalNoPaddingStyles,
          antDModalStyles(theme),
          formHelperStyles(theme),
          formStyles(theme),
        ]}
        footer={renderModalFooter()}
        maskClosable={false}
        name="database"
        onHide={onClose}
        onHandledPrimaryAction={onSave}
        primaryButtonName={t('Connect')}
        show={show}
        title={
          <ModalTitleWithIcon
            title={t('Connect a database')}
            icon={<Icons.InsertRowAboveOutlined />}
          />
        }
        width={modalWidth}
      >
        <ModalHeader
          db={db}
          dbName={dbName}
          dbModel={dbModel}
          dhis2CreateStage={dhis2CreateStage}
          fileList={fileList}
          hasConnectedDb={hasConnectedDb}
          isDHIS2GuidedFlow={isDHIS2GuidedFlow}
          isEditMode={isEditMode}
          isLoading={isLoading}
          useSqlAlchemyForm={useSqlAlchemyForm}
        />
        {confirmOverwriteField()}
        {importingErrorAlert()}
        {passwordNeededField()}
      </Modal>
    );
  }
  const modalFooter =
    isEditMode && !isDHIS2GuidedFlow
      ? renderEditModalFooter(db)
      : renderModalFooter();
  return useTabLayout ? (
    <Modal
      css={(theme: SupersetTheme) => [
        antDTabsStyles,
        antDModalNoPaddingStyles,
        antDModalStyles(theme),
        formHelperStyles(theme),
        formStyles(theme),
      ]}
      name="database"
      data-test="database-modal"
      onHandledPrimaryAction={onSave}
      onHide={onClose}
      primaryButtonName={isEditMode ? t('Save') : t('Connect')}
      width={modalWidth}
      centered
      show={show}
      title={
        <ModalTitleWithIcon
          isEditMode={isEditMode}
          title={isEditMode ? t('Edit database') : t('Connect a database')}
          icon={
            isEditMode ? (
              <Icons.EditOutlined iconSize="l" />
            ) : (
              <Icons.InsertRowAboveOutlined iconSize="l" />
            )
          }
        />
      }
      footer={modalFooter}
      maskClosable={false}
    >
      <StyledStickyHeader>
        <TabHeader>
          <ModalHeader
            isLoading={isLoading}
            isEditMode={isEditMode}
            useSqlAlchemyForm={useSqlAlchemyForm}
            hasConnectedDb={hasConnectedDb}
            db={db}
            dbName={dbName}
            dbModel={dbModel}
            dhis2CreateStage={dhis2CreateStage}
            isDHIS2GuidedFlow={isDHIS2GuidedFlow}
          />
        </TabHeader>
      </StyledStickyHeader>
      {renderFormStatusAlert()}
      {shouldShowDatabaseErrorAlert && errorAlert()}
      <TabsStyled
        defaultActiveKey={DEFAULT_TAB_KEY}
        activeKey={tabKey}
        onTabClick={tabChange}
        animated={{ inkBar: true, tabPane: true }}
        items={modalTabs}
      />
    </Modal>
  ) : (
    <Modal
      css={(theme: SupersetTheme) => [
        antDModalNoPaddingStyles,
        antDModalStyles(theme),
        formHelperStyles(theme),
        formStyles(theme),
      ]}
      name="database"
      onHandledPrimaryAction={onSave}
      onHide={onClose}
      primaryButtonName={
        isDHIS2GuidedFlow
          ? dhis2CreateStage === 'review'
            ? t('Save Database')
            : t('Continue')
          : hasConnectedDb
            ? t('Finish')
            : t('Connect')
      }
      width={modalWidth}
      centered
      show={show}
      title={
        <ModalTitleWithIcon
          isEditMode={isEditMode}
          title={isEditMode ? t('Edit database') : t('Connect a database')}
          icon={
            isEditMode ? (
              <Icons.EditOutlined iconSize="l" />
            ) : (
              <Icons.InsertRowAboveOutlined iconSize="l" />
            )
          }
        />
      }
      footer={renderModalFooter()}
      maskClosable={false}
    >
      {!isLoading && hasConnectedDb ? (
        <>
          <ModalHeader
            isLoading={isLoading}
            isEditMode={isEditMode}
            useSqlAlchemyForm={useSqlAlchemyForm}
            hasConnectedDb={hasConnectedDb}
            db={db}
            dbName={dbName}
            dbModel={dbModel}
            dhis2CreateStage={dhis2CreateStage}
            editNewDb={editNewDb}
            isDHIS2GuidedFlow={isDHIS2GuidedFlow}
          />
          {showCTAbtns && renderCTABtns()}
          {renderFinishState()}
        </>
      ) : (
        <>
          {/* Dynamic Form Step 1 */}
          {!isLoading &&
            (!db ? (
              <SelectDatabaseStyles>
                <ModalHeader
                  isLoading={isLoading}
                  isEditMode={isEditMode}
                  useSqlAlchemyForm={useSqlAlchemyForm}
                  hasConnectedDb={hasConnectedDb}
                  db={db}
                  dbName={dbName}
                  dbModel={dbModel}
                  dhis2CreateStage={dhis2CreateStage}
                  isDHIS2GuidedFlow={isDHIS2GuidedFlow}
                />
                {renderPreferredSelector()}
                {renderAvailableSelector()}
                <StyledUploadWrapper>
                  <Upload
                    name="databaseFile"
                    id="databaseFile"
                    data-test="database-file-input"
                    accept=".yaml,.json,.yml,.zip"
                    customRequest={() => {}}
                    onChange={onDbImport}
                    onRemove={removeFile}
                  >
                    <Button
                      data-test="import-database-btn"
                      buttonStyle="link"
                      css={importDbButtonLinkStyles}
                    >
                      {t('Import database from file')}
                    </Button>
                  </Upload>
                </StyledUploadWrapper>
                {importingErrorAlert()}
              </SelectDatabaseStyles>
            ) : (
              <>
                <ModalHeader
                  isLoading={isLoading}
                  isEditMode={isEditMode}
                  useSqlAlchemyForm={useSqlAlchemyForm}
                  hasConnectedDb={hasConnectedDb}
                  db={db}
                  dbName={dbName}
                  dbModel={dbModel}
                  dhis2CreateStage={dhis2CreateStage}
                  isDHIS2GuidedFlow={isDHIS2GuidedFlow}
                />
                {hasAlert && renderStepTwoAlert()}
                {renderDatabaseConnectionForm()}
                <div css={(theme: SupersetTheme) => infoTooltip(theme)}>
                  {dbModel.engine !== Engines.GSheet && !isDHIS2GuidedFlow && (
                    <>
                      <Button
                        data-test="sqla-connect-btn"
                        buttonStyle="link"
                        onClick={() => {
                          handleClearValidationErrors();
                          setDB({
                            type: ActionType.ConfigMethodChange,
                            payload: {
                              engine: db.engine,
                              configuration_method:
                                ConfigurationMethod.SqlalchemyUri,
                              database_name: db.database_name,
                            },
                          });
                        }}
                        css={buttonLinkStyles}
                      >
                        {t(
                          'Connect this database with a SQLAlchemy URI string instead',
                        )}
                      </Button>
                      <InfoTooltip
                        tooltip={t(
                          'Click this link to switch to an alternate form that allows you to input the SQLAlchemy URL for this database manually.',
                        )}
                      />
                    </>
                  )}
                </div>
                {/* Step 2 */}
                {renderFormStatusAlert()}
                {shouldShowDatabaseErrorAlert && errorAlert()}
              </>
            ))}
        </>
      )}
      {isLoading && <Loading />}
    </Modal>
  );
};

export default withToasts(DatabaseModal);
