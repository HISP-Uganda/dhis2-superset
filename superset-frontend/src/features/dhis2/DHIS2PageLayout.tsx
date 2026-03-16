import { ReactNode } from 'react';
import { css, styled, t } from '@superset-ui/core';
import { Typography, Loading } from '@superset-ui/core/components';
import { Empty, Select } from 'antd';

import SubMenu from 'src/features/home/SubMenu';

import type { DHIS2DatabaseOption } from './types';
import { getDHIS2Route } from './utils';

const { Title, Paragraph, Text } = Typography;

const PageContainer = styled.div`
  ${({ theme }) => css`
    padding: 0 ${theme.sizeUnit * 6}px ${theme.sizeUnit * 6}px;
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 4}px;

    @media (max-width: 768px) {
      padding: 0 ${theme.sizeUnit * 4}px ${theme.sizeUnit * 4}px;
    }
  `}
`;

const HeaderCard = styled.div`
  ${({ theme }) => css`
    background: ${theme.colorBgElevated};
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    padding: ${theme.sizeUnit * 5}px;
    display: flex;
    justify-content: space-between;
    gap: ${theme.sizeUnit * 4}px;
    flex-wrap: wrap;
  `}
`;

const HeaderBody = styled.div`
  min-width: 280px;
  flex: 1;
`;

const HeaderControls = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: flex-end;
    gap: ${theme.sizeUnit * 3}px;
    flex-wrap: wrap;
  `}
`;

const DatabaseControl = styled.div`
  min-width: 260px;
`;

type ActiveTab =
  | 'instances'
  | 'health'
  | 'sync-history'
  | 'local-metadata'
  | 'local-data'
  | 'downloads';

interface DHIS2PageLayoutProps {
  activeTab: ActiveTab;
  title: string;
  description: string;
  databases: DHIS2DatabaseOption[];
  loadingDatabases: boolean;
  selectedDatabaseId?: number;
  onDatabaseChange: (databaseId?: number) => void;
  extra?: ReactNode;
  children: ReactNode;
}

export default function DHIS2PageLayout({
  activeTab,
  title,
  description,
  databases,
  loadingDatabases,
  selectedDatabaseId,
  onDatabaseChange,
  extra,
  children,
}: DHIS2PageLayoutProps) {
  const tabs = [
    {
      label: t('Instances'),
      name: 'instances',
      url: getDHIS2Route('/superset/dhis2/instances/', selectedDatabaseId),
      usesRouter: true,
    },
    {
      label: t('Health'),
      name: 'health',
      url: getDHIS2Route('/superset/dhis2/health/', selectedDatabaseId),
      usesRouter: true,
    },
    {
      label: t('Sync History'),
      name: 'sync-history',
      url: getDHIS2Route('/superset/dhis2/sync-history/', selectedDatabaseId),
      usesRouter: true,
    },
    {
      label: t('Local Metadata'),
      name: 'local-metadata',
      url: getDHIS2Route('/superset/dhis2/local-metadata/', selectedDatabaseId),
      usesRouter: true,
    },
    {
      label: t('Data Workspace'),
      name: 'local-data',
      url: getDHIS2Route('/superset/dhis2/local-data/', selectedDatabaseId),
      usesRouter: true,
    },
    {
      label: t('Download Datasets'),
      name: 'downloads',
      url: getDHIS2Route('/superset/dhis2/downloads/', selectedDatabaseId),
      usesRouter: true,
    },
  ] as const;

  return (
    <>
      <SubMenu
        name={t('DHIS2 Federation')}
        tabs={tabs.map(tab => ({
          ...tab,
          'data-test': `dhis2-tab-${tab.name}`,
        }))}
        activeChild={activeTab}
        usesRouter
      />
      <PageContainer>
        <HeaderCard>
          <HeaderBody>
            <Title level={3} style={{ margin: 0 }}>
              {title}
            </Title>
            <Paragraph
              style={{ marginBottom: 0, marginTop: 8, maxWidth: 720 }}
              type="secondary"
            >
              {description}
            </Paragraph>
          </HeaderBody>
          <HeaderControls>
            {extra}
            <DatabaseControl>
              <Text strong>{t('Logical database')}</Text>
              <Select
                aria-label={t('Logical database')}
                data-test="dhis2-database-select"
                loading={loadingDatabases}
                options={databases.map(database => ({
                  label: database.database_name,
                  value: database.id,
                }))}
                placeholder={t('Select a DHIS2 database')}
                style={{ marginTop: 8, width: '100%' }}
                value={selectedDatabaseId}
                onChange={value => onDatabaseChange(value)}
              />
            </DatabaseControl>
          </HeaderControls>
        </HeaderCard>
        {loadingDatabases && !databases.length ? (
          <div style={{ padding: '64px 0', textAlign: 'center' }}>
            <Loading />
          </div>
        ) : null}
        {!loadingDatabases && !databases.length ? (
          <Empty
            description={t(
              'No DHIS2-backed Superset databases are configured yet.',
            )}
          />
        ) : null}
        {!loadingDatabases && databases.length ? children : null}
      </PageContainer>
    </>
  );
}
