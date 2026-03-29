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
  getExtensionsRegistry,
  styled,
  SupersetClient,
  t,
} from '@superset-ui/core';
import { useState, useMemo, useEffect } from 'react';
import rison from 'rison';
import { useSelector } from 'react-redux';
import { useQueryParams, BooleanParam } from 'use-query-params';
import { LocalStorageKeys, setItem } from 'src/utils/localStorageHelpers';
import { useListViewResource } from 'src/views/CRUD/hooks';
import {
  createErrorHandler,
  createFetchRelated,
  uploadUserPerms,
} from 'src/views/CRUD/utils';
import withToasts from 'src/components/MessageToasts/withToasts';
import SubMenu, { SubMenuProps } from 'src/features/home/SubMenu';
import {
  DeleteModal,
  Tooltip,
  List,
  Loading,
  Modal,
  Tag,
} from '@superset-ui/core/components';
import Tree, { TreeDataNode } from '@superset-ui/core/components/Tree';
import {
  ModifiedInfo,
  ListView,
  ListViewFilterOperator as FilterOperator,
  ListViewFilters,
} from 'src/components';
import { Typography } from '@superset-ui/core/components/Typography';
import { getUrlParam } from 'src/utils/urlUtils';
import { URL_PARAMS } from 'src/constants';
import { Icons } from '@superset-ui/core/components/Icons';
import { isUserAdmin } from 'src/dashboard/util/permissionUtils';
import handleResourceExport from 'src/utils/export';
import { ExtensionConfigs } from 'src/features/home/types';
import { UserWithPermissionsAndRoles } from 'src/types/bootstrapTypes';
import type { MenuObjectProps } from 'src/types/bootstrapTypes';
import DatabaseModal from 'src/features/databases/DatabaseModal';
import UploadDataModal from 'src/features/databases/UploadDataModel';
import {
  DatabaseObject,
  DatabaseRepositoryOrgUnitConfig,
  DatabaseRepositoryEnabledDimensions,
  RepositoryDataScope,
  RepositoryLevelMappingRow,
  RepositoryOrgUnitRecord,
  RepositoryReportingUnitApproach,
  RepositorySeparateInstanceConfig,
} from 'src/features/databases/types';
import type { DHIS2Instance } from 'src/features/dhis2/types';
import { QueryObjectColumns } from 'src/views/CRUD/types';
import { WIDER_DROPDOWN_WIDTH } from 'src/components/ListView/utils';
import { ModalTitleWithIcon } from 'src/components/ModalTitleWithIcon';

const extensionsRegistry = getExtensionsRegistry();
const DatabaseDeleteRelatedExtension = extensionsRegistry.get(
  'database.delete.related',
);
const dbConfigExtraExtension = extensionsRegistry.get(
  'databaseconnection.extraOption',
);

const PAGE_SIZE = 25;

interface DatabaseDeleteObject extends DatabaseObject {
  charts: any;
  dashboards: any;
  sqllab_tab_count: number;
}
interface DatabaseListProps {
  addDangerToast: (msg: string) => void;
  addSuccessToast: (msg: string) => void;
  addInfoToast: (msg: string) => void;
  user: {
    userId: string | number;
    firstName: string;
    lastName: string;
  };
}

const Actions = styled.div`
  .action-button {
    display: inline-block;
    height: 100%;
    color: ${({ theme }) => theme.colorIcon};
  }
`;

const RepositoryViewerBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const RepositoryViewerSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const RepositoryViewerCard = styled.div`
  ${({ theme }) => `
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 1.5}px;
    padding: ${theme.sizeUnit * 2}px;
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius * 2}px;
    background: ${theme.colorBgContainer};
  `}
`;

const RepositoryViewerGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

const RepositoryViewerItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

const RepositoryViewerTagRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const RepositoryViewerList = styled.div`
  ${({ theme }) => `
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit}px;
  `}
`;

const RepositoryViewerListItem = styled.div`
  ${({ theme }) => `
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 0.75}px;
    padding: ${theme.sizeUnit * 1.5}px;
    border: 1px solid ${theme.colorBorderSecondary};
    border-radius: ${theme.borderRadius * 1.5}px;
    background: ${theme.colorFillAlter};
  `}
`;

const RepositoryViewerSubtleText = styled(Typography.Text)`
  display: block;
`;

const RepositoryHierarchyList = styled.div`
  ${({ theme }) => `
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius * 2}px;
    background: ${theme.colorBgContainer};
    padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 1.5}px;
    max-height: 520px;
    overflow: auto;
  `}
`;

const RepositoryHierarchyTree = styled(Tree)`
  ${({ theme }) => `
    background: transparent;

    .ant-tree-list-holder-inner {
      gap: 0;
    }

    .ant-tree-switcher {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: stretch;
      width: ${theme.sizeUnit * 3}px;
      min-width: ${theme.sizeUnit * 3}px;
      color: ${theme.colorTextSecondary};
    }

    .ant-tree-indent-unit {
      width: ${theme.sizeUnit * 3}px;
    }

    .ant-tree-node-content-wrapper {
      flex: 1;
      width: calc(100% - ${theme.sizeUnit * 4}px);
      min-height: auto;
      padding: 0;
      border-radius: ${theme.borderRadius * 1.5}px;
    }

    .ant-tree-node-content-wrapper:hover,
    .ant-tree-node-content-wrapper.ant-tree-node-selected {
      background: ${theme.colorFillTertiary};
    }

    .ant-tree-treenode {
      align-items: flex-start;
      width: 100%;
      padding: 0;
    }

    .ant-tree-title {
      display: block;
      width: 100%;
    }

    .ant-tree-show-line .ant-tree-indent-unit::before {
      border-inline-end: 1px solid ${theme.colorBorderSecondary};
    }

    .ant-tree-switcher-line-icon {
      color: ${theme.colorBorder};
    }
  `}
`;

const RepositoryTreeNode = styled.div`
  ${({ theme }) => `
    display: flex;
    align-items: flex-start;
    gap: ${theme.sizeUnit * 1.5}px;
    width: 100%;
    padding: ${theme.sizeUnit * 1.25}px ${theme.sizeUnit * 1.5}px;
    border-radius: ${theme.borderRadius * 1.5}px;
    border: 1px solid transparent;
    background: transparent;
    transition: background-color 0.15s ease, border-color 0.15s ease;

    .ant-tree-node-content-wrapper:hover &,
    .ant-tree-node-content-wrapper.ant-tree-node-selected & {
      background: ${theme.colorBgElevated};
      border-color: ${theme.colorBorderSecondary};
    }
  `}
`;

const RepositoryTreeNodeHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
`;

const RepositoryTreeNodeMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
`;

const RepositoryTreeNodeName = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const RepositoryTreeNodeChips = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const RepositoryTreeCount = styled.span`
  ${({ theme }) => `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: ${theme.sizeUnit * 3}px;
    padding: 0 ${theme.sizeUnit}px;
    height: ${theme.sizeUnit * 3}px;
    border-radius: 999px;
    background: ${theme.colorPrimaryBg};
    color: ${theme.colorPrimary};
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  `}
`;

function BooleanDisplay({ value }: { value: Boolean }) {
  return value ? (
    <Icons.CheckOutlined iconSize="s" />
  ) : (
    <Icons.CloseOutlined iconSize="s" />
  );
}

function getEnabledDimensions(
  database: DatabaseObject | null,
): DatabaseRepositoryEnabledDimensions | null {
  const enabledDimensions =
    database?.repository_org_unit_config &&
    typeof database.repository_org_unit_config === 'object'
      ? database.repository_org_unit_config.enabled_dimensions
      : null;
  return enabledDimensions && typeof enabledDimensions === 'object'
    ? enabledDimensions
    : null;
}

function getRepositoryConfig(
  database: DatabaseObject | null,
): DatabaseRepositoryOrgUnitConfig | null {
  const repositoryConfig =
    database?.repository_org_unit_config &&
    typeof database.repository_org_unit_config === 'object'
      ? database.repository_org_unit_config
      : null;
  return repositoryConfig && typeof repositoryConfig === 'object'
    ? repositoryConfig
    : null;
}

function sortRepositoryOrgUnits(
  repositoryOrgUnits: RepositoryOrgUnitRecord[] = [],
): RepositoryOrgUnitRecord[] {
  return repositoryOrgUnits.slice().sort((left, right) => {
    const leftPath = left.hierarchy_path || left.repository_key;
    const rightPath = right.hierarchy_path || right.repository_key;
    if (leftPath !== rightPath) {
      return leftPath.localeCompare(rightPath);
    }
    return left.display_name.localeCompare(right.display_name);
  });
}

function getRepositoryHierarchyParentKey(
  record: RepositoryOrgUnitRecord,
  knownKeys: Set<string>,
): string | null {
  if (
    record.parent_repository_key &&
    knownKeys.has(record.parent_repository_key)
  ) {
    return record.parent_repository_key;
  }

  const hierarchyPath = record.hierarchy_path || record.repository_key;
  if (!hierarchyPath.includes('/')) {
    return null;
  }

  const fallbackParentKey = hierarchyPath.split('/').slice(0, -1).join('/');
  return knownKeys.has(fallbackParentKey) ? fallbackParentKey : null;
}

function buildRepositoryTreeTitle(
  record: RepositoryOrgUnitRecord,
  childCount: number,
) {
  return (
    <RepositoryTreeNode>
      <RepositoryTreeNodeHeader>
        <RepositoryTreeNodeMeta>
          <RepositoryTreeNodeName>
            <Icons.ApartmentOutlined iconSize="s" />
            <Typography.Text strong>{record.display_name}</Typography.Text>
            {childCount > 0 ? (
              <RepositoryTreeCount title={t('%s direct children', childCount)}>
                #{childCount}
              </RepositoryTreeCount>
            ) : null}
          </RepositoryTreeNodeName>
          <RepositoryTreeNodeChips>
            {record.level != null ? (
              <Tag color="default">{t('Level %s', record.level)}</Tag>
            ) : null}
            {record.source_lineage_label ? (
              <Tag color="purple">{record.source_lineage_label}</Tag>
            ) : null}
            {record.is_conflicted ? (
              <Tag color="red">{t('Conflict')}</Tag>
            ) : null}
            {record.is_unmatched ? (
              <Tag color="gold">{t('Unmatched')}</Tag>
            ) : null}
          </RepositoryTreeNodeChips>
          <Typography.Text type="secondary">
            {record.hierarchy_path || record.repository_key}
          </Typography.Text>
          {record.lineage?.length ? (
            <Typography.Text type="secondary">
              {t(
                'Source references: %s',
                record.lineage
                  .map(
                    lineage =>
                      lineage.source_org_unit_name || lineage.source_org_unit_uid,
                  )
                  .join(', '),
              )}
            </Typography.Text>
          ) : null}
        </RepositoryTreeNodeMeta>
      </RepositoryTreeNodeHeader>
    </RepositoryTreeNode>
  );
}

function buildRepositoryHierarchyTree(
  repositoryOrgUnits: RepositoryOrgUnitRecord[] = [],
): TreeDataNode[] {
  const sortedRecords = sortRepositoryOrgUnits(repositoryOrgUnits);
  const knownKeys = new Set(sortedRecords.map(record => record.repository_key));
  const nodeMap = new Map<
    string,
    TreeDataNode & { children: TreeDataNode[]; record: RepositoryOrgUnitRecord }
  >();
  const roots: Array<
    TreeDataNode & { children: TreeDataNode[]; record: RepositoryOrgUnitRecord }
  > = [];

  sortedRecords.forEach(record => {
    nodeMap.set(record.repository_key, {
      key: record.repository_key,
      title: null,
      children: [],
      selectable: false,
      record,
    });
  });

  sortedRecords.forEach(record => {
    const node = nodeMap.get(record.repository_key);
    if (!node) {
      return;
    }

    const parentKey = getRepositoryHierarchyParentKey(record, knownKeys);
    if (parentKey) {
      const parentNode = nodeMap.get(parentKey);
      if (parentNode) {
        parentNode.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const finalizeNode = (
    node: TreeDataNode & { children: TreeDataNode[]; record: RepositoryOrgUnitRecord },
  ): TreeDataNode => ({
    ...node,
    title: buildRepositoryTreeTitle(node.record, node.children.length),
    children: node.children.map(child =>
      finalizeNode(
        child as TreeDataNode & {
          children: TreeDataNode[];
          record: RepositoryOrgUnitRecord;
        },
      ),
    ),
  });

  return roots.map(finalizeNode);
}

function formatRepositoryStatusLabel(status?: string | null): string {
  switch (status) {
    case 'queued':
      return t('Queued');
    case 'running':
      return t('Finalizing');
    case 'ready':
      return t('Ready');
    case 'failed':
      return t('Failed');
    default:
      return t('Not configured');
  }
}

function formatRepositoryApproachLabel(
  approach?: RepositoryReportingUnitApproach | null,
): string {
  switch (approach) {
    case 'primary_instance':
      return t('Use a primary instance');
    case 'map_merge':
      return t('Map and merge reporting units');
    case 'auto_merge':
      return t('Auto merge reporting units');
    case 'separate':
      return t('Keep reporting units separate');
    default:
      return t('Not configured');
  }
}

function formatRepositoryDataScopeLabel(
  scope?: RepositoryDataScope | null,
): string {
  switch (scope) {
    case 'children':
      return t('Include children');
    case 'grandchildren':
      return t('Include grandchildren');
    case 'ancestors':
      return t('Include ancestors');
    case 'all_levels':
      return t('All levels');
    case 'selected':
      return t('Selected units only');
    default:
      return t('Not configured');
  }
}

function formatAutoMergeFallbackLabel(
  value?: 'preserve_unmatched' | 'drop_unmatched' | null,
): string {
  switch (value) {
    case 'preserve_unmatched':
      return t('Preserve unmatched units');
    case 'drop_unmatched':
      return t('Drop unmatched units');
    default:
      return t('Not configured');
  }
}

function formatAutoMergeConflictLabel(
  value?: 'preserve_for_review' | 'drop' | null,
): string {
  switch (value) {
    case 'preserve_for_review':
      return t('Preserve for review');
    case 'drop':
      return t('Drop unresolved conflicts');
    default:
      return t('Not configured');
  }
}

function formatRepositoryLevelLabel(
  level: number,
  repositoryConfig: DatabaseRepositoryOrgUnitConfig | null,
  repositoryOrgUnits: RepositoryOrgUnitRecord[],
): string {
  const mappedRow = repositoryConfig?.level_mapping?.rows?.find(
    row => row.merged_level === level,
  );
  if (mappedRow?.label?.trim()) {
    return `${mappedRow.label.trim()} (${t('Repository level %s', level)})`;
  }
  const enabledLevel = repositoryConfig?.enabled_dimensions?.levels?.find(
    item => item.repository_level === level,
  );
  if (enabledLevel?.label?.trim()) {
    return `${enabledLevel.label.trim()} (${t('Repository level %s', level)})`;
  }
  const repositoryUnit = repositoryOrgUnits.find(
    unit => unit.level === level && unit.provenance?.repositoryLevelName,
  );
  if (
    typeof repositoryUnit?.provenance?.repositoryLevelName === 'string' &&
    repositoryUnit.provenance.repositoryLevelName.trim()
  ) {
    return `${repositoryUnit.provenance.repositoryLevelName.trim()} (${t(
      'Repository level %s',
      level,
    )})`;
  }
  return t('Repository level %s', level);
}

function formatLowestDataLevelLabel(
  level: number | null | undefined,
  repositoryConfig: DatabaseRepositoryOrgUnitConfig | null,
  repositoryOrgUnits: RepositoryOrgUnitRecord[],
  approach?: RepositoryReportingUnitApproach | null,
): string {
  if (level == null) {
    return approach === 'separate'
      ? t('Configured per instance')
      : t('All available levels');
  }
  return formatRepositoryLevelLabel(level, repositoryConfig, repositoryOrgUnits);
}

function getInstanceName(
  instanceId: number | null | undefined,
  instanceMap: Map<number, DHIS2Instance>,
): string {
  if (instanceId == null) {
    return t('Not configured');
  }
  return (
    instanceMap.get(instanceId)?.name ||
    t('Configured connection %s', instanceId)
  );
}

function getSelectedOrgUnitLabels(
  selectedOrgUnitDetails: Array<{ displayName?: string; id?: string }> = [],
  selectedOrgUnits: string[] = [],
): string[] {
  const detailLabels = selectedOrgUnitDetails
    .map(detail => detail.displayName?.trim() || detail.id?.trim() || '')
    .filter(Boolean);
  if (detailLabels.length > 0) {
    return Array.from(new Set(detailLabels));
  }
  return Array.from(new Set(selectedOrgUnits.filter(Boolean)));
}

function formatInstanceLevelLabel(level: number | null): string {
  return level == null ? t('Not mapped') : t('Level %s', level);
}

function DatabaseList({
  addDangerToast,
  addInfoToast,
  addSuccessToast,
  user,
}: DatabaseListProps) {
  const {
    state: {
      loading,
      resourceCount: databaseCount,
      resourceCollection: databases,
    },
    hasPerm,
    fetchData,
    refreshData,
  } = useListViewResource<DatabaseObject>(
    'database',
    t('database'),
    addDangerToast,
  );
  const fullUser = useSelector<any, UserWithPermissionsAndRoles>(
    state => state.user,
  );
  const shouldSyncPermsInAsyncMode = useSelector<any, boolean>(
    state => state.common?.conf.SYNC_DB_PERMISSIONS_IN_ASYNC_MODE,
  );
  const showDatabaseModal = getUrlParam(URL_PARAMS.showDatabaseModal);

  const [query, setQuery] = useQueryParams({
    databaseAdded: BooleanParam,
  });

  const [databaseModalOpen, setDatabaseModalOpen] = useState<boolean>(
    showDatabaseModal || false,
  );
  const [databaseCurrentlyDeleting, setDatabaseCurrentlyDeleting] =
    useState<DatabaseDeleteObject | null>(null);
  const [currentDatabase, setCurrentDatabase] = useState<DatabaseObject | null>(
    null,
  );
  const [repositoryViewerOpen, setRepositoryViewerOpen] =
    useState<boolean>(false);
  const [repositoryViewerLoading, setRepositoryViewerLoading] =
    useState<boolean>(false);
  const [repositoryViewerDatabase, setRepositoryViewerDatabase] =
    useState<DatabaseObject | null>(null);
  const [repositoryViewerInstances, setRepositoryViewerInstances] = useState<
    DHIS2Instance[]
  >([]);
  const [repositoryViewerExpandedKeys, setRepositoryViewerExpandedKeys] =
    useState<string[]>([]);
  const [csvUploadDataModalOpen, setCsvUploadDataModalOpen] =
    useState<boolean>(false);
  const [excelUploadDataModalOpen, setExcelUploadDataModalOpen] =
    useState<boolean>(false);
  const [columnarUploadDataModalOpen, setColumnarUploadDataModalOpen] =
    useState<boolean>(false);

  const [allowUploads, setAllowUploads] = useState<boolean>(false);
  const isAdmin = isUserAdmin(fullUser);
  const showUploads = allowUploads || isAdmin;

  const [preparingExport, setPreparingExport] = useState<boolean>(false);
  const { roles } = fullUser;
  const {
    CSV_EXTENSIONS,
    COLUMNAR_EXTENSIONS,
    EXCEL_EXTENSIONS,
    ALLOWED_EXTENSIONS,
  } = useSelector<any, ExtensionConfigs>(state => state.common.conf);

  useEffect(() => {
    if (query?.databaseAdded) {
      setQuery({ databaseAdded: undefined });
      refreshData();
    }
  }, [query, setQuery, refreshData]);

  const openDatabaseDeleteModal = (database: DatabaseObject) =>
    SupersetClient.get({
      endpoint: `/api/v1/database/${database.id}/related_objects/`,
    })
      .then(({ json = {} }) => {
        setDatabaseCurrentlyDeleting({
          ...database,
          charts: json.charts,
          dashboards: json.dashboards,
          sqllab_tab_count: json.sqllab_tab_states.count,
        });
      })
      .catch(
        createErrorHandler(errMsg =>
          t(
            'An error occurred while fetching database related data: %s',
            errMsg,
          ),
        ),
      );

  function handleDatabaseDelete(database: DatabaseObject) {
    const { id, database_name: dbName } = database;
    SupersetClient.delete({
      endpoint: `/api/v1/database/${id}`,
    }).then(
      () => {
        refreshData();
        addSuccessToast(t('Deleted: %s', dbName));

        // Remove any extension-related data
        if (dbConfigExtraExtension?.onDelete) {
          dbConfigExtraExtension.onDelete(database);
        }

        // Delete user-selected db from local storage
        setItem(LocalStorageKeys.Database, null);

        // Close delete modal
        setDatabaseCurrentlyDeleting(null);
      },
      createErrorHandler(errMsg =>
        addDangerToast(t('There was an issue deleting %s: %s', dbName, errMsg)),
      ),
    );
  }

  function handleDatabaseEditModal({
    database = null,
    modalOpen = false,
  }: { database?: DatabaseObject | null; modalOpen?: boolean } = {}) {
    // Set database and modal
    setCurrentDatabase(database);
    setDatabaseModalOpen(modalOpen);
  }

  function handleRepositoryViewerClose() {
    setRepositoryViewerOpen(false);
    setRepositoryViewerLoading(false);
    setRepositoryViewerDatabase(null);
    setRepositoryViewerInstances([]);
    setRepositoryViewerExpandedKeys([]);
  }

  function handleRepositoryViewerOpen(database: DatabaseObject) {
    setRepositoryViewerOpen(true);
    setRepositoryViewerLoading(true);
    setRepositoryViewerDatabase(null);
    setRepositoryViewerInstances([]);
    Promise.allSettled([
      SupersetClient.get({
        endpoint: `/api/v1/database/${database.id}`,
      }),
      SupersetClient.get({
        endpoint: `/api/v1/dhis2/instances/?database_id=${database.id}&include_inactive=true`,
      }),
    ]).then(results => {
      const [databaseResult, instancesResult] = results;

      if (databaseResult.status === 'fulfilled') {
        setRepositoryViewerDatabase(
          (databaseResult.value.json as { result?: DatabaseObject }).result ||
            null,
        );
      } else {
        createErrorHandler(errMsg => {
          addDangerToast(
            t(
              'An error occurred while loading repository organisation units for %s: %s',
              database.database_name,
              errMsg,
            ),
          );
        })(databaseResult.reason);
      }

      if (instancesResult.status === 'fulfilled') {
        setRepositoryViewerInstances(
          ((instancesResult.value.json as { result?: DHIS2Instance[] }).result ||
            []) as DHIS2Instance[],
        );
      }

      setRepositoryViewerLoading(false);
    });
  }

  const canCreate = hasPerm('can_write');
  const canEdit = hasPerm('can_write');
  const canDelete = hasPerm('can_write');
  const canExport = hasPerm('can_export');
  const canViewRepository = hasPerm('can_read');

  const { canUploadCSV, canUploadColumnar, canUploadExcel } = uploadUserPerms(
    roles,
    CSV_EXTENSIONS,
    COLUMNAR_EXTENSIONS,
    EXCEL_EXTENSIONS,
    ALLOWED_EXTENSIONS,
  );

  const isDisabled = isAdmin && !allowUploads;

  const uploadDropdownMenu = [
    {
      label: t('Upload file to database'),
      childs: [
        {
          label: t('Upload CSV'),
          name: 'Upload CSV file',
          url: '#',
          onClick: () => {
            setCsvUploadDataModalOpen(true);
          },
          perm: canUploadCSV && showUploads,
          disable: isDisabled,
        },
        {
          label: t('Upload Excel'),
          name: 'Upload Excel file',
          url: '#',
          onClick: () => {
            setExcelUploadDataModalOpen(true);
          },
          perm: canUploadExcel && showUploads,
          disable: isDisabled,
        },
        {
          label: t('Upload Columnar'),
          name: 'Upload columnar file',
          url: '#',
          onClick: () => {
            setColumnarUploadDataModalOpen(true);
          },
          perm: canUploadColumnar && showUploads,
          disable: isDisabled,
        },
      ],
    },
  ];

  const hasFileUploadEnabled = () => {
    const payload = {
      filters: [
        { col: 'allow_file_upload', opr: 'upload_is_enabled', value: true },
      ],
    };
    SupersetClient.get({
      endpoint: `/api/v1/database/?q=${rison.encode(payload)}`,
    }).then(({ json }: Record<string, any>) => {
      // There might be some existing Gsheets and Clickhouse DBs
      // with allow_file_upload set as True which is not possible from now on
      const allowedDatabasesWithFileUpload =
        json?.result?.filter(
          (database: any) => database?.engine_information?.supports_file_upload,
        ) || [];
      setAllowUploads(allowedDatabasesWithFileUpload?.length >= 1);
    });
  };

  useEffect(() => hasFileUploadEnabled(), [databaseModalOpen]);

  const filteredDropDown = uploadDropdownMenu.reduce((prev, cur) => {
    // eslint-disable-next-line no-param-reassign
    cur.childs = cur.childs.filter(item => item.perm);
    if (!cur.childs.length) return prev;
    prev.push(cur);
    return prev;
  }, [] as MenuObjectProps[]);

  const menuData: SubMenuProps = {
    activeChild: 'Databases',
    dropDownLinks: filteredDropDown,
    name: t('Databases'),
  };

  if (canCreate) {
    menuData.buttons = [
      {
        'data-test': 'btn-create-database',
        icon: <Icons.PlusOutlined iconSize="m" />,
        name: t('Database'),
        buttonStyle: 'primary',
        onClick: () => {
          // Ensure modal will be opened in add mode
          handleDatabaseEditModal({ modalOpen: true });
        },
      },
    ];
  }

  async function handleDatabaseExport(database: DatabaseObject) {
    if (database.id === undefined) {
      return;
    }

    setPreparingExport(true);
    try {
      await handleResourceExport('database', [database.id], () => {
        setPreparingExport(false);
      });
    } catch (error) {
      setPreparingExport(false);
      addDangerToast(t('There was an issue exporting the database'));
    }
  }

  function handleDatabasePermSync(database: DatabaseObject) {
    if (shouldSyncPermsInAsyncMode) {
      addInfoToast(t('Validating connectivity for %s', database.database_name));
    } else {
      addInfoToast(t('Syncing permissions for %s', database.database_name));
    }
    SupersetClient.post({
      endpoint: `/api/v1/database/${database.id}/sync_permissions/`,
    }).then(
      ({ response }) => {
        // Sync request
        if (response.status === 200) {
          addSuccessToast(
            t('Permissions successfully synced for %s', database.database_name),
          );
        }
        // Async request
        else {
          addInfoToast(
            t(
              'Syncing permissions for %s in the background',
              database.database_name,
            ),
          );
        }
      },
      createErrorHandler(errMsg =>
        addDangerToast(
          t(
            'An error occurred while syncing permissions for %s: %s',
            database.database_name,
            errMsg,
          ),
        ),
      ),
    );
  }

  const initialSort = [{ id: 'changed_on_delta_humanized', desc: true }];

  const columns = useMemo(
    () => [
      {
        accessor: 'database_name',
        Header: t('Name'),
        size: 'xxl',
        id: 'database_name',
      },
      {
        accessor: 'backend',
        Header: t('Backend'),
        size: 'xl',
        disableSortBy: true, // TODO: api support for sorting by 'backend'
        id: 'backend',
      },
      {
        accessor: 'allow_run_async',
        Header: (
          <Tooltip
            id="allow-run-async-header-tooltip"
            title={t('Asynchronous query execution')}
            placement="top"
          >
            <span>{t('AQE')}</span>
          </Tooltip>
        ),
        Cell: ({
          row: {
            original: { allow_run_async: allowRunAsync },
          },
        }: {
          row: { original: { allow_run_async: boolean } };
        }) => <BooleanDisplay value={allowRunAsync} />,
        size: 'sm',
        id: 'allow_run_async',
      },
      {
        accessor: 'allow_dml',
        Header: (
          <Tooltip
            id="allow-dml-header-tooltip"
            title={t('Allow data manipulation language')}
            placement="top"
          >
            <span>{t('DML')}</span>
          </Tooltip>
        ),
        Cell: ({
          row: {
            original: { allow_dml: allowDML },
          },
        }: any) => <BooleanDisplay value={allowDML} />,
        size: 'sm',
        id: 'allow_dml',
      },
      {
        accessor: 'allow_file_upload',
        Header: t('File upload'),
        Cell: ({
          row: {
            original: { allow_file_upload: allowFileUpload },
          },
        }: any) => <BooleanDisplay value={allowFileUpload} />,
        size: 'md',
        id: 'allow_file_upload',
      },
      {
        accessor: 'expose_in_sqllab',
        Header: t('Expose in SQL Lab'),
        Cell: ({
          row: {
            original: { expose_in_sqllab: exposeInSqllab },
          },
        }: any) => <BooleanDisplay value={exposeInSqllab} />,
        size: 'md',
        id: 'expose_in_sqllab',
      },
      {
        Cell: ({
          row: {
            original: {
              changed_by: changedBy,
              changed_on_delta_humanized: changedOn,
            },
          },
        }: any) => <ModifiedInfo date={changedOn} user={changedBy} />,
        Header: t('Last modified'),
        accessor: 'changed_on_delta_humanized',
        size: 'xl',
        id: 'changed_on_delta_humanized',
      },
      {
        Cell: ({ row: { original } }: any) => {
          const handleEdit = () =>
            handleDatabaseEditModal({ database: original, modalOpen: true });
          const handleDelete = () => openDatabaseDeleteModal(original);
          const handleExport = () => handleDatabaseExport(original);
          const handleSync = () => handleDatabasePermSync(original);
          const handleViewRepository = () => handleRepositoryViewerOpen(original);
          if (
            !canEdit &&
            !canDelete &&
            !canExport &&
            !(canViewRepository && original.backend === 'dhis2')
          ) {
            return null;
          }
          return (
            <Actions className="actions">
              {canDelete && (
                <span
                  role="button"
                  tabIndex={0}
                  className="action-button"
                  data-test="database-delete"
                  onClick={handleDelete}
                >
                  <Tooltip
                    id="delete-action-tooltip"
                    title={t('Delete database')}
                    placement="bottom"
                  >
                    <Icons.DeleteOutlined iconSize="l" />
                  </Tooltip>
                </span>
              )}
              {canExport && (
                <Tooltip
                  id="export-action-tooltip"
                  title={t('Export')}
                  placement="bottom"
                >
                  <span
                    role="button"
                    tabIndex={0}
                    className="action-button"
                    onClick={handleExport}
                  >
                    <Icons.UploadOutlined iconSize="l" />
                  </span>
                </Tooltip>
              )}
              {canViewRepository && original.backend === 'dhis2' && (
                <Tooltip
                  id="view-repository-action-tooltip"
                  title={t('View repository organisation units')}
                  placement="bottom"
                >
                  <span
                    role="button"
                    data-test="database-view-repository"
                    tabIndex={0}
                    className="action-button"
                    onClick={handleViewRepository}
                  >
                    <Icons.ApartmentOutlined iconSize="l" />
                  </span>
                </Tooltip>
              )}
              {canEdit && (
                <Tooltip
                  id="edit-action-tooltip"
                  title={t('Edit')}
                  placement="bottom"
                >
                  <span
                    role="button"
                    data-test="database-edit"
                    tabIndex={0}
                    className="action-button"
                    onClick={handleEdit}
                  >
                    <Icons.EditOutlined data-test="edit-alt" iconSize="l" />
                  </span>
                </Tooltip>
              )}
              {canEdit && (
                <Tooltip
                  id="sync-action-tooltip"
                  title={t('Sync Permissions')}
                  placement="bottom"
                >
                  <span
                    role="button"
                    data-test="database-sync-perm"
                    tabIndex={0}
                    className="action-button"
                    onClick={handleSync}
                  >
                    <Icons.SyncOutlined iconSize="l" />
                  </span>
                </Tooltip>
              )}
            </Actions>
          );
        },
        Header: t('Actions'),
        id: 'actions',
        hidden: !canEdit && !canDelete && !canViewRepository,
        disableSortBy: true,
      },
      {
        accessor: QueryObjectColumns.ChangedBy,
        hidden: true,
        id: QueryObjectColumns.ChangedBy,
      },
    ],
    [canDelete, canEdit, canExport, canViewRepository],
  );

  const filters: ListViewFilters = useMemo(
    () => [
      {
        Header: t('Name'),
        key: 'search',
        id: 'database_name',
        input: 'search',
        operator: FilterOperator.Contains,
      },
      {
        Header: t('Expose in SQL Lab'),
        key: 'expose_in_sql_lab',
        id: 'expose_in_sqllab',
        input: 'select',
        operator: FilterOperator.Equals,
        unfilteredLabel: t('All'),
        selects: [
          { label: t('Yes'), value: true },
          { label: t('No'), value: false },
        ],
      },
      {
        Header: (
          <Tooltip
            id="allow-run-async-filter-header-tooltip"
            title={t('Asynchronous query execution')}
            placement="top"
          >
            <span>{t('AQE')}</span>
          </Tooltip>
        ),
        key: 'allow_run_async',
        id: 'allow_run_async',
        input: 'select',
        operator: FilterOperator.Equals,
        unfilteredLabel: t('All'),
        selects: [
          { label: t('Yes'), value: true },
          { label: t('No'), value: false },
        ],
      },
      {
        Header: t('Modified by'),
        key: 'changed_by',
        id: 'changed_by',
        input: 'select',
        operator: FilterOperator.RelationOneMany,
        unfilteredLabel: t('All'),
        fetchSelects: createFetchRelated(
          'database',
          'changed_by',
          createErrorHandler(errMsg =>
            t(
              'An error occurred while fetching dataset datasource values: %s',
              errMsg,
            ),
          ),
          user,
        ),
        paginate: true,
        dropdownStyle: { minWidth: WIDER_DROPDOWN_WIDTH },
      },
    ],
    [],
  );
  const repositoryViewerEnabledDimensions = useMemo(
    () => getEnabledDimensions(repositoryViewerDatabase),
    [repositoryViewerDatabase],
  );
  const repositoryViewerConfig = useMemo(
    () => getRepositoryConfig(repositoryViewerDatabase),
    [repositoryViewerDatabase],
  );
  const repositoryViewerOrgUnits = useMemo(
    () => sortRepositoryOrgUnits(repositoryViewerDatabase?.repository_org_units || []),
    [repositoryViewerDatabase],
  );
  const repositoryViewerTreeData = useMemo(
    () =>
      buildRepositoryHierarchyTree(
        repositoryViewerDatabase?.repository_org_units || [],
      ),
    [repositoryViewerDatabase],
  );
  const repositoryViewerRootKeys = useMemo(
    () => repositoryViewerTreeData.map(node => String(node.key)),
    [repositoryViewerTreeData],
  );
  const repositoryViewerApproach =
    repositoryViewerDatabase?.repository_org_unit_summary?.approach ||
    repositoryViewerDatabase?.repository_reporting_unit_approach ||
    null;
  const repositoryViewerUnitCount =
    repositoryViewerDatabase?.repository_org_unit_summary
      ?.total_repository_org_units ||
    repositoryViewerDatabase?.repository_org_units?.length ||
    0;
  const repositoryViewerStatus =
    repositoryViewerDatabase?.repository_org_unit_summary?.status ||
    repositoryViewerDatabase?.repository_org_unit_status ||
    null;
  const repositoryViewerStatusMessage =
    repositoryViewerDatabase?.repository_org_unit_summary?.status_message ||
    repositoryViewerDatabase?.repository_org_unit_status_message ||
    null;
  const repositoryViewerInstanceMap = useMemo(
    () =>
      new Map(repositoryViewerInstances.map(instance => [instance.id, instance])),
    [repositoryViewerInstances],
  );
  const repositoryViewerActiveInstanceIds = useMemo(() => {
    const configuredIds =
      repositoryViewerConfig?.filters?.active_instance_ids || [];
    if (Array.isArray(configuredIds) && configuredIds.length > 0) {
      return configuredIds
        .map(value => Number(value))
        .filter(value => Number.isFinite(value));
    }
    return repositoryViewerInstances
      .filter(instance => instance.is_active)
      .map(instance => instance.id);
  }, [repositoryViewerConfig, repositoryViewerInstances]);
  const repositoryViewerSelectedOrgUnitLabels = useMemo(
    () =>
      getSelectedOrgUnitLabels(
        repositoryViewerConfig?.selected_org_unit_details || [],
        repositoryViewerConfig?.selected_org_units || [],
      ),
    [repositoryViewerConfig],
  );
  const repositoryViewerLevelMappingRows = useMemo(
    () => repositoryViewerConfig?.level_mapping?.rows || [],
    [repositoryViewerConfig],
  );
  const repositoryViewerSeparateConfigs = useMemo(
    () => repositoryViewerConfig?.separate_instance_configs || [],
    [repositoryViewerConfig],
  );
  const repositoryViewerLowestLevel =
    repositoryViewerDatabase?.repository_org_unit_summary
      ?.lowest_data_level_to_use ??
    repositoryViewerDatabase?.lowest_data_level_to_use ??
    null;
  const repositoryViewerDataScope =
    repositoryViewerDatabase?.repository_org_unit_summary?.data_scope ||
    repositoryViewerDatabase?.repository_data_scope ||
    null;
  const repositoryViewerPrimaryInstanceId =
    repositoryViewerDatabase?.repository_org_unit_summary?.primary_instance_id ??
    repositoryViewerDatabase?.primary_instance_id ??
    null;
  const repositoryViewerLastFinalizedAt =
    repositoryViewerDatabase?.repository_org_unit_summary?.last_finalized_at ||
    repositoryViewerDatabase?.repository_org_unit_last_finalized_at ||
    null;

  useEffect(() => {
    if (!repositoryViewerOpen) {
      return;
    }
    setRepositoryViewerExpandedKeys(repositoryViewerRootKeys);
  }, [repositoryViewerOpen, repositoryViewerRootKeys]);

  return (
    <>
      <SubMenu {...menuData} />
      <DatabaseModal
        databaseId={currentDatabase?.id}
        show={databaseModalOpen}
        onHide={handleDatabaseEditModal}
        onDatabaseAdd={() => {
          refreshData();
        }}
      />
      <Modal
        open={repositoryViewerOpen}
        onCancel={handleRepositoryViewerClose}
        onOk={handleRepositoryViewerClose}
        okText={t('Close')}
        cancelButtonProps={{ style: { display: 'none' } }}
        width={900}
        title={
          <ModalTitleWithIcon
            title={t('Repository Organisation Units')}
            subtitle={repositoryViewerDatabase?.database_name || t('Loading...')}
          />
        }
      >
        {repositoryViewerLoading ? (
          <Loading position="normal" />
        ) : (
          <RepositoryViewerBody>
            <RepositoryViewerSection>
              <RepositoryViewerCard>
                <Typography.Text strong>
                  {t('Repository configuration summary')}
                </Typography.Text>
                <RepositoryViewerGrid>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Approach')}
                    </Typography.Text>
                    <Typography.Text strong>
                      {formatRepositoryApproachLabel(repositoryViewerApproach)}
                    </Typography.Text>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Total repository units')}
                    </Typography.Text>
                    <Typography.Text strong>
                      {repositoryViewerUnitCount}
                    </Typography.Text>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Primary DHIS2 instance')}
                    </Typography.Text>
                    <Typography.Text strong>
                      {repositoryViewerApproach === 'primary_instance'
                        ? getInstanceName(
                            repositoryViewerPrimaryInstanceId,
                            repositoryViewerInstanceMap,
                          )
                        : t('Not applicable')}
                    </Typography.Text>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Lowest data level to use')}
                    </Typography.Text>
                    <Typography.Text strong>
                      {formatLowestDataLevelLabel(
                        repositoryViewerLowestLevel,
                        repositoryViewerConfig,
                        repositoryViewerOrgUnits,
                        repositoryViewerApproach,
                      )}
                    </Typography.Text>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Selected data scope')}
                    </Typography.Text>
                    <Typography.Text strong>
                      {repositoryViewerApproach === 'separate'
                        ? t('Configured per instance')
                        : repositoryViewerApproach === 'map_merge'
                          ? t('Automatic from mapped hierarchy')
                          : formatRepositoryDataScopeLabel(
                              repositoryViewerDataScope,
                            )}
                    </Typography.Text>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Finalization status')}
                    </Typography.Text>
                    <div>
                      <Tag
                        color={
                          repositoryViewerStatus === 'failed'
                            ? 'red'
                            : repositoryViewerStatus === 'ready'
                              ? 'green'
                              : repositoryViewerStatus === 'queued' ||
                                  repositoryViewerStatus === 'running'
                                ? 'blue'
                                : 'default'
                        }
                      >
                        {formatRepositoryStatusLabel(repositoryViewerStatus)}
                      </Tag>
                    </div>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Finalization message')}
                    </Typography.Text>
                    <Typography.Text strong>
                      {repositoryViewerStatusMessage || t('None')}
                    </Typography.Text>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Last finalized')}
                    </Typography.Text>
                    <Typography.Text strong>
                      {repositoryViewerLastFinalizedAt || t('Not available')}
                    </Typography.Text>
                  </RepositoryViewerItem>
                </RepositoryViewerGrid>
              </RepositoryViewerCard>
            </RepositoryViewerSection>

            <RepositoryViewerSection>
              <RepositoryViewerCard>
                <Typography.Text strong>
                  {t('Step 4 configuration applied')}
                </Typography.Text>
                <RepositoryViewerGrid>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Selected child instances')}
                    </Typography.Text>
                    <RepositoryViewerTagRow>
                      {repositoryViewerActiveInstanceIds.length > 0 ? (
                        repositoryViewerActiveInstanceIds.map(instanceId => (
                          <Tag key={instanceId} color="default">
                            {getInstanceName(
                              instanceId,
                              repositoryViewerInstanceMap,
                            )}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">
                          {t('None saved')}
                        </Typography.Text>
                      )}
                    </RepositoryViewerTagRow>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Selected repository roots')}
                    </Typography.Text>
                    <RepositoryViewerTagRow>
                      {repositoryViewerSelectedOrgUnitLabels.length > 0 ? (
                        repositoryViewerSelectedOrgUnitLabels.map(label => (
                          <Tag key={label} color="processing">
                            {label}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">
                          {t('None saved')}
                        </Typography.Text>
                      )}
                    </RepositoryViewerTagRow>
                  </RepositoryViewerItem>
                </RepositoryViewerGrid>

                {repositoryViewerLevelMappingRows.length > 0 ? (
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Mapped repository levels')}
                    </Typography.Text>
                    <RepositoryViewerList>
                      {repositoryViewerLevelMappingRows.map(
                        (row: RepositoryLevelMappingRow) => (
                          <RepositoryViewerListItem
                            key={`${row.merged_level}-${row.label}`}
                          >
                            <Typography.Text strong>
                              {row.label || t('Repository level %s', row.merged_level)}
                            </Typography.Text>
                            <RepositoryViewerSubtleText type="secondary">
                              {t('Repository level %s', row.merged_level)}
                            </RepositoryViewerSubtleText>
                            <RepositoryViewerTagRow>
                              {Object.entries(row.instance_levels || {}).map(
                                ([instanceId, sourceLevel]) => (
                                  <Tag
                                    key={`${row.merged_level}-${instanceId}`}
                                    color="default"
                                  >
                                    {`${getInstanceName(
                                      Number(instanceId),
                                      repositoryViewerInstanceMap,
                                    )}: ${formatInstanceLevelLabel(
                                      sourceLevel,
                                    )}`}
                                  </Tag>
                                ),
                              )}
                            </RepositoryViewerTagRow>
                          </RepositoryViewerListItem>
                        ),
                      )}
                    </RepositoryViewerList>
                  </RepositoryViewerItem>
                ) : null}

                {repositoryViewerApproach === 'auto_merge' ? (
                  <RepositoryViewerGrid>
                    <RepositoryViewerItem>
                      <Typography.Text type="secondary">
                        {t('Fallback behavior for unmatched units')}
                      </Typography.Text>
                      <Typography.Text strong>
                        {formatAutoMergeFallbackLabel(
                          repositoryViewerConfig?.auto_merge?.fallback_behavior ||
                            null,
                        )}
                      </Typography.Text>
                    </RepositoryViewerItem>
                    <RepositoryViewerItem>
                      <Typography.Text type="secondary">
                        {t('Fallback behavior for unresolved conflicts')}
                      </Typography.Text>
                      <Typography.Text strong>
                        {formatAutoMergeConflictLabel(
                          repositoryViewerConfig?.auto_merge
                            ?.unresolved_conflicts || null,
                        )}
                      </Typography.Text>
                    </RepositoryViewerItem>
                  </RepositoryViewerGrid>
                ) : null}

                {repositoryViewerApproach === 'separate' &&
                repositoryViewerSeparateConfigs.length > 0 ? (
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Per-instance repository settings')}
                    </Typography.Text>
                    <RepositoryViewerList>
                      {repositoryViewerSeparateConfigs.map(
                        (config: RepositorySeparateInstanceConfig) => (
                          <RepositoryViewerListItem key={config.instance_id}>
                            <Typography.Text strong>
                              {getInstanceName(
                                config.instance_id,
                                repositoryViewerInstanceMap,
                              )}
                            </Typography.Text>
                            <RepositoryViewerSubtleText type="secondary">
                              {`${t('Data scope')}: ${formatRepositoryDataScopeLabel(
                                config.data_scope,
                              )}`}
                            </RepositoryViewerSubtleText>
                            <RepositoryViewerSubtleText type="secondary">
                              {`${t('Lowest data level to use')}: ${formatLowestDataLevelLabel(
                                config.lowest_data_level_to_use,
                                repositoryViewerConfig,
                                repositoryViewerOrgUnits,
                                repositoryViewerApproach,
                              )}`}
                            </RepositoryViewerSubtleText>
                            <RepositoryViewerTagRow>
                              {getSelectedOrgUnitLabels(
                                config.selected_org_unit_details || [],
                                config.selected_org_units || [],
                              ).map(label => (
                                <Tag key={`${config.instance_id}-${label}`}>
                                  {label}
                                </Tag>
                              ))}
                            </RepositoryViewerTagRow>
                          </RepositoryViewerListItem>
                        ),
                      )}
                    </RepositoryViewerList>
                  </RepositoryViewerItem>
                ) : null}
              </RepositoryViewerCard>
            </RepositoryViewerSection>

            <RepositoryViewerSection>
              <RepositoryViewerCard>
                <Typography.Text strong>
                  {t('Enabled analysis dimensions')}
                </Typography.Text>
                <RepositoryViewerList>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Levels')}
                    </Typography.Text>
                    <RepositoryViewerTagRow>
                      {(repositoryViewerEnabledDimensions?.levels || []).length >
                      0 ? (
                        repositoryViewerEnabledDimensions?.levels?.map(item => (
                          <Tag key={item.key} color="blue">
                            {item.label}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">
                          {t('None enabled')}
                        </Typography.Text>
                      )}
                    </RepositoryViewerTagRow>
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Group sets')}
                    </Typography.Text>
                    {(repositoryViewerEnabledDimensions?.group_sets || []).length >
                    0 ? (
                      <RepositoryViewerList>
                        {repositoryViewerEnabledDimensions?.group_sets?.map(item => (
                          <RepositoryViewerListItem key={item.key}>
                            <Typography.Text strong>{item.label}</Typography.Text>
                            <RepositoryViewerSubtleText type="secondary">
                              {item.member_group_labels?.length
                                ? t(
                                    'Member groups: %s',
                                    item.member_group_labels.join(', '),
                                  )
                                : t('No saved member groups')}
                            </RepositoryViewerSubtleText>
                          </RepositoryViewerListItem>
                        ))}
                      </RepositoryViewerList>
                    ) : (
                      <Typography.Text type="secondary">
                        {t('None enabled')}
                      </Typography.Text>
                    )}
                  </RepositoryViewerItem>
                  <RepositoryViewerItem>
                    <Typography.Text type="secondary">
                      {t('Groups')}
                    </Typography.Text>
                    <RepositoryViewerTagRow>
                      {(repositoryViewerEnabledDimensions?.groups || []).length >
                      0 ? (
                        repositoryViewerEnabledDimensions?.groups?.map(item => (
                          <Tag key={item.key} color="green">
                            {item.label}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">
                          {t('None enabled')}
                        </Typography.Text>
                      )}
                    </RepositoryViewerTagRow>
                  </RepositoryViewerItem>
                </RepositoryViewerList>
              </RepositoryViewerCard>
            </RepositoryViewerSection>

            <RepositoryViewerSection>
              <RepositoryViewerCard>
                <Typography.Text strong>
                  {t('Repository hierarchy')}
                </Typography.Text>
                <RepositoryHierarchyList>
                  {repositoryViewerOrgUnits.length > 0 ? (
                    <RepositoryHierarchyTree
                      blockNode
                      showIcon={false}
                      showLine={{ showLeafIcon: false }}
                      selectable={false}
                      expandedKeys={repositoryViewerExpandedKeys}
                      onExpand={keys =>
                        setRepositoryViewerExpandedKeys(keys as string[])
                      }
                      switcherIcon={({ expanded, isLeaf }: any) =>
                        isLeaf ? null : expanded ? (
                          <Icons.DownOutlined iconSize="s" />
                        ) : (
                          <Icons.RightOutlined iconSize="s" />
                        )
                      }
                      treeData={repositoryViewerTreeData}
                    />
                  ) : (
                    <div style={{ padding: '16px 20px' }}>
                      <Typography.Text type="secondary">
                        {t(
                          'No repository organisation units have been saved on this database yet.',
                        )}
                      </Typography.Text>
                    </div>
                  )}
                </RepositoryHierarchyList>
              </RepositoryViewerCard>
            </RepositoryViewerSection>
          </RepositoryViewerBody>
        )}
      </Modal>
      <UploadDataModal
        addDangerToast={addDangerToast}
        addSuccessToast={addSuccessToast}
        onHide={() => {
          setCsvUploadDataModalOpen(false);
        }}
        show={csvUploadDataModalOpen}
        allowedExtensions={CSV_EXTENSIONS}
        type="csv"
      />
      <UploadDataModal
        addDangerToast={addDangerToast}
        addSuccessToast={addSuccessToast}
        onHide={() => {
          setExcelUploadDataModalOpen(false);
        }}
        show={excelUploadDataModalOpen}
        allowedExtensions={EXCEL_EXTENSIONS}
        type="excel"
      />
      <UploadDataModal
        addDangerToast={addDangerToast}
        addSuccessToast={addSuccessToast}
        onHide={() => {
          setColumnarUploadDataModalOpen(false);
        }}
        show={columnarUploadDataModalOpen}
        allowedExtensions={COLUMNAR_EXTENSIONS}
        type="columnar"
      />
      {databaseCurrentlyDeleting && (
        <DeleteModal
          description={
            <>
              <p>
                {t('The database')}{' '}
                <b>{databaseCurrentlyDeleting.database_name}</b>{' '}
                {t(
                  'is linked to %s charts that appear on %s dashboards and users have %s SQL Lab tabs using this database open. Are you sure you want to continue? Deleting the database will break those objects.',
                  databaseCurrentlyDeleting.charts.count,
                  databaseCurrentlyDeleting.dashboards.count,
                  databaseCurrentlyDeleting.sqllab_tab_count,
                )}
              </p>
              {databaseCurrentlyDeleting.dashboards.count >= 1 && (
                <>
                  <h4>{t('Affected Dashboards')}</h4>
                  <List
                    split={false}
                    size="small"
                    dataSource={databaseCurrentlyDeleting.dashboards.result.slice(
                      0,
                      10,
                    )}
                    renderItem={(result: { id: number; title: string }) => (
                      <List.Item key={result.id} compact>
                        <List.Item.Meta
                          avatar={<span>•</span>}
                          title={
                            <Typography.Link
                              href={`/superset/dashboard/${result.id}`}
                              target="_atRiskItem"
                            >
                              {result.title}
                            </Typography.Link>
                          }
                        />
                      </List.Item>
                    )}
                    footer={
                      databaseCurrentlyDeleting.dashboards.result.length >
                        10 && (
                        <div>
                          {t(
                            '... and %s others',
                            databaseCurrentlyDeleting.dashboards.result.length -
                              10,
                          )}
                        </div>
                      )
                    }
                  />
                </>
              )}
              {databaseCurrentlyDeleting.charts.count >= 1 && (
                <>
                  <h4>{t('Affected Charts')}</h4>
                  <List
                    split={false}
                    size="small"
                    dataSource={databaseCurrentlyDeleting.charts.result.slice(
                      0,
                      10,
                    )}
                    renderItem={(result: {
                      id: number;
                      slice_name: string;
                    }) => (
                      <List.Item key={result.id} compact>
                        <List.Item.Meta
                          avatar={<span>•</span>}
                          title={
                            <Typography.Link
                              href={`/explore/?slice_id=${result.id}`}
                              target="_atRiskItem"
                            >
                              {result.slice_name}
                            </Typography.Link>
                          }
                        />
                      </List.Item>
                    )}
                    footer={
                      databaseCurrentlyDeleting.charts.result.length > 10 && (
                        <div>
                          {t(
                            '... and %s others',
                            databaseCurrentlyDeleting.charts.result.length - 10,
                          )}
                        </div>
                      )
                    }
                  />
                </>
              )}

              {DatabaseDeleteRelatedExtension && (
                <DatabaseDeleteRelatedExtension
                  database={databaseCurrentlyDeleting}
                />
              )}
            </>
          }
          onConfirm={() => {
            if (databaseCurrentlyDeleting) {
              handleDatabaseDelete(databaseCurrentlyDeleting);
            }
          }}
          onHide={() => setDatabaseCurrentlyDeleting(null)}
          open
          title={
            <ModalTitleWithIcon
              icon={<Icons.DeleteOutlined />}
              title={t('Delete Database?')}
            />
          }
        />
      )}

      <ListView<DatabaseObject>
        className="database-list-view"
        columns={columns}
        count={databaseCount}
        data={databases}
        fetchData={fetchData}
        filters={filters}
        initialSort={initialSort}
        loading={loading}
        addDangerToast={addDangerToast}
        addSuccessToast={addSuccessToast}
        refreshData={() => {}}
        pageSize={PAGE_SIZE}
      />

      {preparingExport && <Loading />}
    </>
  );
}

export default withToasts(DatabaseList);
