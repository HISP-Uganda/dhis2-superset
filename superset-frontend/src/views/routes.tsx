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
import { FeatureFlag, isFeatureEnabled } from '@superset-ui/core';
import {
  lazy,
  ComponentType,
  ComponentProps,
  LazyExoticComponent,
} from 'react';
import { isUserAdmin } from 'src/dashboard/util/permissionUtils';
import getBootstrapData from 'src/utils/getBootstrapData';

// not lazy loaded since this is the home page.
import Welcome from 'src/pages/Home';
// Public landing page for unauthenticated users
import PublicLandingPage from 'src/pages/PublicLandingPage';

const CMSAdminPage = lazy(
  () => import(/* webpackChunkName: "CMSAdminPage" */ 'src/pages/CMSAdminPage'),
);

const ChartCreation = lazy(
  () =>
    import(/* webpackChunkName: "ChartCreation" */ 'src/pages/ChartCreation'),
);

const AnnotationLayerList = lazy(
  () =>
    import(
      /* webpackChunkName: "AnnotationLayerList" */ 'src/pages/AnnotationLayerList'
    ),
);

const AlertReportList = lazy(
  () =>
    import(
      /* webpackChunkName: "AlertReportList" */ 'src/pages/AlertReportList'
    ),
);

const AnnotationList = lazy(
  () =>
    import(/* webpackChunkName: "AnnotationList" */ 'src/pages/AnnotationList'),
);

const ChartList = lazy(
  () => import(/* webpackChunkName: "ChartList" */ 'src/pages/ChartList'),
);

const CssTemplateList = lazy(
  () =>
    import(
      /* webpackChunkName: "CssTemplateList" */ 'src/pages/CssTemplateList'
    ),
);

const ThemeList = lazy(
  () => import(/* webpackChunkName: "ThemeList" */ 'src/pages/ThemeList'),
);

const DashboardList = lazy(
  () =>
    import(/* webpackChunkName: "DashboardList" */ 'src/pages/DashboardList'),
);

const Dashboard = lazy(
  () => import(/* webpackChunkName: "Dashboard" */ 'src/pages/Dashboard'),
);

const DatabaseList = lazy(
  () => import(/* webpackChunkName: "DatabaseList" */ 'src/pages/DatabaseList'),
);

const DatasetList = lazy(
  () => import(/* webpackChunkName: "DatasetList" */ 'src/pages/DatasetList'),
);

const DatasetCreation = lazy(
  () =>
    import(
      /* webpackChunkName: "DatasetCreation" */ 'src/pages/DatasetCreation'
    ),
);

const ExecutionLogList = lazy(
  () =>
    import(
      /* webpackChunkName: "ExecutionLogList" */ 'src/pages/ExecutionLogList'
    ),
);

const DHIS2Instances = lazy(
  () =>
    import(/* webpackChunkName: "DHIS2Instances" */ 'src/pages/DHIS2Instances'),
);

const DHIS2Health = lazy(
  () => import(/* webpackChunkName: "DHIS2Health" */ 'src/pages/DHIS2Health'),
);

const DHIS2SyncHistory = lazy(
  () =>
    import(
      /* webpackChunkName: "DHIS2SyncHistory" */ 'src/pages/DHIS2SyncHistory'
    ),
);

const DHIS2LocalMetadata = lazy(
  () =>
    import(
      /* webpackChunkName: "DHIS2LocalMetadata" */ 'src/pages/DHIS2LocalMetadata'
    ),
);

const DHIS2LocalData = lazy(
  () =>
    import(/* webpackChunkName: "DHIS2LocalData" */ 'src/pages/DHIS2LocalData'),
);

const DHIS2Downloads = lazy(
  () =>
    import(/* webpackChunkName: "DHIS2Downloads" */ 'src/pages/DHIS2Downloads'),
);

const LocalStagingSettings = lazy(
  () =>
    import(
      /* webpackChunkName: "LocalStagingSettings" */ 'src/pages/LocalStagingSettings'
    ),
);

const Chart = lazy(
  () => import(/* webpackChunkName: "Chart" */ 'src/pages/Chart'),
);

const QueryHistoryList = lazy(
  () =>
    import(
      /* webpackChunkName: "QueryHistoryList" */ 'src/pages/QueryHistoryList'
    ),
);

const SavedQueryList = lazy(
  () =>
    import(/* webpackChunkName: "SavedQueryList" */ 'src/pages/SavedQueryList'),
);

const SqlLab = lazy(
  () => import(/* webpackChunkName: "SqlLab" */ 'src/pages/SqlLab'),
);

const AllEntities = lazy(
  () => import(/* webpackChunkName: "AllEntities" */ 'src/pages/AllEntities'),
);

const Tags = lazy(
  () => import(/* webpackChunkName: "Tags" */ 'src/pages/Tags'),
);

const Extensions = lazy(
  () => import(/* webpackChunkName: "Tags" */ 'src/extensions/ExtensionsList'),
);

const RowLevelSecurityList = lazy(
  () =>
    import(
      /* webpackChunkName: "RowLevelSecurityList" */ 'src/pages/RowLevelSecurityList'
    ),
);

const RolesList = lazy(
  () => import(/* webpackChunkName: "RolesList" */ 'src/pages/RolesList'),
);

const UsersList: LazyExoticComponent<any> = lazy(
  () => import(/* webpackChunkName: "UsersList" */ 'src/pages/UsersList'),
);

const UserInfo = lazy(
  () => import(/* webpackChunkName: "UserInfo" */ 'src/pages/UserInfo'),
);
const ActionLogList: LazyExoticComponent<any> = lazy(
  () => import(/* webpackChunkName: "ActionLogList" */ 'src/pages/ActionLog'),
);

const Login = lazy(
  () => import(/* webpackChunkName: "Login" */ 'src/pages/Login'),
);

const Register = lazy(
  () => import(/* webpackChunkName: "Register" */ 'src/pages/Register'),
);

const GroupsList: LazyExoticComponent<any> = lazy(
  () => import(/* webpackChunkName: "GroupsList" */ 'src/pages/GroupsList'),
);
const UserRegistrations = lazy(
  () =>
    import(
      /* webpackChunkName: "UserRegistrations" */ 'src/pages/UserRegistrations'
    ),
);

type Routes = {
  path: string;
  Component: ComponentType;
  Fallback?: ComponentType;
  props?: ComponentProps<any>;
}[];

export const routes: Routes = [
  {
    path: '/login/',
    Component: Login,
  },
  {
    path: '/register/activation/:activationHash',
    Component: Register,
  },
  {
    path: '/register/',
    Component: Register,
  },
  {
    path: '/logout/',
    Component: Login,
  },
  {
    path: '/superset/welcome/',
    Component: Welcome,
  },
  {
    path: '/superset/public/',
    Component: PublicLandingPage,
  },
  {
    path: '/superset/public/:pageSlug/',
    Component: PublicLandingPage,
  },
  {
    path: '/superset/cms/',
    Component: CMSAdminPage,
  },
  {
    path: '/superset/cms/:subpath/',
    Component: CMSAdminPage,
  },
  {
    path: '/dashboard/list/',
    Component: DashboardList,
  },
  {
    path: '/superset/dashboard/:idOrSlug/',
    Component: Dashboard,
  },
  {
    path: '/chart/add',
    Component: ChartCreation,
  },
  {
    path: '/chart/list/',
    Component: ChartList,
  },
  {
    path: '/tablemodelview/list/',
    Component: DatasetList,
  },
  {
    path: '/databaseview/list/',
    Component: DatabaseList,
  },
  {
    path: '/savedqueryview/list/',
    Component: SavedQueryList,
  },
  {
    path: '/csstemplatemodelview/list/',
    Component: CssTemplateList,
  },
  {
    path: '/theme/list/',
    Component: ThemeList,
  },
  {
    path: '/annotationlayer/list/',
    Component: AnnotationLayerList,
  },
  {
    path: '/annotationlayer/:annotationLayerId/annotation/',
    Component: AnnotationList,
  },
  {
    path: '/sqllab/history/',
    Component: QueryHistoryList,
  },
  {
    path: '/alert/list/',
    Component: AlertReportList,
  },
  {
    path: '/report/list/',
    Component: AlertReportList,
    props: {
      isReportEnabled: true,
    },
  },
  {
    path: '/alert/:alertId/log/',
    Component: ExecutionLogList,
  },
  {
    path: '/report/:alertId/log/',
    Component: ExecutionLogList,
    props: {
      isReportEnabled: true,
    },
  },
  {
    path: '/explore/',
    Component: Chart,
  },
  {
    path: '/superset/explore/public/',
    Component: Chart,
  },
  {
    path: '/superset/explore/p',
    Component: Chart,
  },
  {
    path: '/dataset/add/',
    Component: DatasetCreation,
  },
  {
    path: '/dataset/:datasetId',
    Component: DatasetCreation,
  },
  {
    path: '/superset/dhis2/instances/',
    Component: DHIS2Instances,
  },
  {
    path: '/superset/dhis2/health/',
    Component: DHIS2Health,
  },
  {
    path: '/superset/dhis2/sync-history/',
    Component: DHIS2SyncHistory,
  },
  {
    path: '/superset/dhis2/local-metadata/',
    Component: DHIS2LocalMetadata,
  },
  {
    path: '/superset/dhis2/local-data/',
    Component: DHIS2LocalData,
  },
  {
    path: '/superset/dhis2/downloads/',
    Component: DHIS2Downloads,
  },
  {
    path: '/superset/local-staging/',
    Component: LocalStagingSettings,
  },
  {
    path: '/rowlevelsecurity/list',
    Component: RowLevelSecurityList,
  },
  {
    path: '/sqllab/',
    Component: SqlLab,
  },
  { path: '/user_info/', Component: UserInfo },
  {
    path: '/actionlog/list',
    Component: ActionLogList,
  },
  {
    path: '/registrations/',
    Component: UserRegistrations,
  },
];

if (isFeatureEnabled(FeatureFlag.TaggingSystem)) {
  routes.push({
    path: '/superset/all_entities/',
    Component: AllEntities,
  });
  routes.push({
    path: '/superset/tags/',
    Component: Tags,
  });
}

const user = getBootstrapData()?.user;
const authRegistrationEnabled =
  getBootstrapData()?.common.conf.AUTH_USER_REGISTRATION;
const isAdmin = isUserAdmin(user);

if (isAdmin) {
  routes.push(
    {
      path: '/roles/',
      Component: RolesList,
    },
    {
      path: '/users/',
      Component: UsersList,
    },
    {
      path: '/list_groups/',
      Component: GroupsList,
    },
  );

  if (isFeatureEnabled(FeatureFlag.EnableExtensions)) {
    routes.push({
      path: '/extensions/list/',
      Component: Extensions,
    });
  }
}

if (authRegistrationEnabled) {
  routes.push({
    path: '/registrations/',
    Component: UserRegistrations,
  });
}

const frontEndRoutes: Record<string, boolean> = routes
  .map(r => r.path)
  .reduce(
    (acc, curr) => ({
      ...acc,
      [curr]: true,
    }),
    {},
  );

export const isFrontendRoute = (path?: string): boolean => {
  if (path) {
    const basePath = path.split(/[?#]/)[0]; // strip out query params and link bookmarks
    return !!frontEndRoutes[basePath];
  }
  return false;
};
