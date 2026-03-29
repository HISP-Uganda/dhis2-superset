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

import { t } from '@superset-ui/core';
import { getDatabaseDocumentationLinks } from 'src/views/CRUD/hooks';
import { UploadFile } from '@superset-ui/core/components/Upload';
import { Typography } from '@superset-ui/core/components/Typography';
import { DatabaseForm, DatabaseObject } from '../types';
import {
  EditHeaderTitle,
  EditHeaderSubtitle,
  StyledFormHeader,
  StyledStickyHeader,
} from './styles';

type DHIS2CreateStage =
  | 'details'
  | 'connections'
  | 'repository'
  | 'review';

const supersetTextDocs = getDatabaseDocumentationLinks();

export const DOCUMENTATION_LINK = supersetTextDocs
  ? supersetTextDocs.support
  : 'https://superset.apache.org/docs/configuration/databases#installing-database-drivers';

const irregularDocumentationLinks = {
  postgresql: 'https://superset.apache.org',
  mssql: 'https://superset.apache.org/docs/databases/sql-server',
  gsheets: 'https://superset.apache.org/docs/databases/google-sheets',
};

const documentationLink = (engine: string | undefined) => {
  if (!engine) return null;

  if (supersetTextDocs) {
    // override doc link for superset_txt yml
    return supersetTextDocs[engine] || supersetTextDocs.default;
  }

  if (
    !irregularDocumentationLinks[
      engine as keyof typeof irregularDocumentationLinks
    ]
  ) {
    return `https://superset.apache.org/docs/databases/${engine}`;
  }
  return irregularDocumentationLinks[
    engine as keyof typeof irregularDocumentationLinks
  ];
};

const ModalHeader = ({
  isLoading,
  isEditMode,
  useSqlAlchemyForm,
  hasConnectedDb,
  db,
  dbName,
  dbModel,
  editNewDb,
  fileList,
  isDHIS2GuidedFlow = false,
  dhis2CreateStage = 'details',
}: {
  isLoading: boolean;
  isEditMode: boolean;
  useSqlAlchemyForm: boolean;
  hasConnectedDb: boolean;
  db: Partial<DatabaseObject> | null;
  dbName: string;
  dbModel: DatabaseForm;
  editNewDb?: boolean;
  fileList?: UploadFile[];
  isDHIS2GuidedFlow?: boolean;
  dhis2CreateStage?: DHIS2CreateStage;
  passwordFields?: string[];
  needsOverwriteConfirm?: boolean;
}) => {
  const fileCheck = fileList && fileList?.length > 0;

  const isEditHeader = (
    <StyledFormHeader>
      <EditHeaderTitle>{db?.backend}</EditHeaderTitle>
      <EditHeaderSubtitle>{dbName}</EditHeaderSubtitle>
    </StyledFormHeader>
  );

  const useSqlAlchemyFormHeader = (
    <StyledFormHeader>
      <p className="helper-top">
        {t('STEP %(stepCurr)s OF %(stepLast)s', {
          stepCurr: 2,
          stepLast: 2,
        })}
      </p>
      <Typography.Title level={4}>
        {t('Enter Primary Credentials')}
      </Typography.Title>
      <p className="helper-bottom">
        {t('Need help? Learn how to connect your database')}{' '}
        <a
          href={supersetTextDocs?.default || DOCUMENTATION_LINK}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('here')}
        </a>
        .
      </p>
    </StyledFormHeader>
  );

  const hasConnectedDbHeader = (
    <StyledStickyHeader>
      <StyledFormHeader>
        <p className="helper-top">
          {t('STEP %(stepCurr)s OF %(stepLast)s', {
            stepCurr: 3,
            stepLast: 3,
          })}
        </p>
        <Typography.Title level={4} className="step-3-text">
          {t('Database connected')}
        </Typography.Title>
        <p className="subheader-text">
          {t(`Create a dataset to begin visualizing your data as a chart or go to
          SQL Lab to query your data.`)}
        </p>
      </StyledFormHeader>
    </StyledStickyHeader>
  );

  const dhis2DetailsHeader = (
    <StyledStickyHeader>
      <StyledFormHeader>
        <p className="helper-top">
          {t('STEP %(stepCurr)s OF %(stepLast)s', {
            stepCurr: 2,
            stepLast: 5,
          })}
        </p>
        <Typography.Title level={4}>
          {t('Configure Database details')}
        </Typography.Title>
        <p className="helper-bottom">
          {t(
            'Name the logical Superset Database here. Add DHIS2 instance credentials in the next step.',
          )}
        </p>
      </StyledFormHeader>
    </StyledStickyHeader>
  );

  const dhis2ConnectionsHeader = (
    <StyledStickyHeader>
      <StyledFormHeader>
        <p className="helper-top">
          {t('STEP %(stepCurr)s OF %(stepLast)s', {
            stepCurr: 3,
            stepLast: 5,
          })}
        </p>
        <Typography.Title level={4}>
          {t('Add DHIS2 instances')}
        </Typography.Title>
        <p className="helper-bottom">
          {t(
            'Add the DHIS2 instances that belong to this Database.',
          )}
        </p>
      </StyledFormHeader>
    </StyledStickyHeader>
  );

  const dhis2RepositoryHeader = (
    <StyledStickyHeader>
      <StyledFormHeader>
        <p className="helper-top">
          {t('STEP %(stepCurr)s OF %(stepLast)s', {
            stepCurr: 4,
            stepLast: 5,
          })}
        </p>
        <Typography.Title level={4}>
          {t('Manage Repository Reporting Units and Hierarchy')}
        </Typography.Title>
        <p className="helper-bottom">
          {t(
            'Choose how reporting units from the connected DHIS2 instances should be selected, merged, and stored for repository reporting.',
          )}
        </p>
      </StyledFormHeader>
    </StyledStickyHeader>
  );

  const dhis2ReviewHeader = (
    <StyledStickyHeader>
      <StyledFormHeader>
        <p className="helper-top">
          {t('STEP %(stepCurr)s OF %(stepLast)s', {
            stepCurr: 5,
            stepLast: 5,
          })}
        </p>
        <Typography.Title level={4}>
          {t('Review & save Database')}
        </Typography.Title>
        <p className="helper-bottom">
          {t(
            'Review the database, DHIS2 instances, and repository reporting unit setup before saving.',
          )}
        </p>
      </StyledFormHeader>
    </StyledStickyHeader>
  );

  const hasDbHeader = (
    <StyledStickyHeader>
      <StyledFormHeader>
        <p className="helper-top">
          {t('STEP %(stepCurr)s OF %(stepLast)s', {
            stepCurr: 2,
            stepLast: 3,
          })}
        </p>
        <Typography.Title level={4}>
          {t('Enter the required %(dbModelName)s credentials', {
            dbModelName: dbModel.name,
          })}
        </Typography.Title>
        <p className="helper-bottom">
          {t('Need help? Learn more about')}{' '}
          <a
            href={documentationLink(db?.engine)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('connecting to %(dbModelName)s', { dbModelName: dbModel.name })}.
          </a>
        </p>
      </StyledFormHeader>
    </StyledStickyHeader>
  );

  const noDbHeader = (
    <StyledStickyHeader>
      <StyledFormHeader>
        <div className="select-db">
          <p className="helper-top">
            {t('STEP %(stepCurr)s OF %(stepLast)s', {
              stepCurr: 1,
              stepLast: 5,
            })}
          </p>
          <Typography.Title level={4}>
            {t('Select Database Type')}
          </Typography.Title>
        </div>
      </StyledFormHeader>
    </StyledStickyHeader>
  );

  const importDbHeader = (
    <StyledStickyHeader>
      <StyledFormHeader>
        <p className="helper-top">
          {t('STEP %(stepCurr)s OF %(stepLast)s', {
            stepCurr: 2,
            stepLast: 2,
          })}
        </p>
        <Typography.Title level={4}>
          {t('Enter the required %(dbModelName)s credentials', {
            dbModelName: dbModel.name,
          })}
        </Typography.Title>
        <p className="helper-bottom">{fileCheck ? fileList[0].name : ''}</p>
      </StyledFormHeader>
    </StyledStickyHeader>
  );

  if (fileCheck) return importDbHeader;
  if (isLoading) return <></>;
  if (isDHIS2GuidedFlow) {
    if (!hasConnectedDb || editNewDb || dhis2CreateStage === 'details') {
      return dhis2DetailsHeader;
    }
    if (dhis2CreateStage === 'connections') {
      return dhis2ConnectionsHeader;
    }
    if (dhis2CreateStage === 'repository') {
      return dhis2RepositoryHeader;
    }
    return dhis2ReviewHeader;
  }
  if (isEditMode) return isEditHeader;
  if (useSqlAlchemyForm) return useSqlAlchemyFormHeader;
  if (hasConnectedDb && !editNewDb) return hasConnectedDbHeader;
  if (db || editNewDb) return hasDbHeader;

  return noDbHeader;
};

export default ModalHeader;
