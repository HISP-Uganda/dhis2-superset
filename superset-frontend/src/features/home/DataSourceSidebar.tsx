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

import { useState, useEffect } from 'react';
import { styled, SupersetClient, t } from '@superset-ui/core';
import { Menu, Spin } from 'antd';
import { Icons } from '@superset-ui/core/components/Icons';

const StyledSidebar = styled.div`
  ${({ theme }) => `
    width: 280px;
    min-height: calc(100vh - 60px);
    background: ${theme.colorBgContainer};
    border-right: 1px solid ${theme.colorBorderSecondary};
    position: fixed;
    left: 0;
    top: 60px;
    z-index: 5;
    overflow-y: auto;
    transition: all 0.3s ease;

    @media (max-width: 768px) {
      width: 0;
      overflow: hidden;
    }
  `}
`;

const StyledMenu = styled(Menu)`
  ${({ theme }) => `
    background: transparent;
    border-right: none;
    padding: ${theme.sizeUnit * 2}px 0;

    .ant-menu-item {
      height: auto;
      line-height: 1.4;
      padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 4}px !important;
      margin: 0;
      display: flex;
      align-items: center;
      color: ${theme.colorText};
      font-size: 14px;
      border-radius: 0;

      &:hover {
        background: ${theme.colorBgLayout};
        color: ${theme.colorPrimary};
      }

      &.ant-menu-item-selected {
        background: ${theme.colorPrimaryBg};
        color: ${theme.colorPrimary};
        font-weight: 600;
      }

      .ant-menu-item-icon {
        font-size: 18px;
        min-width: 24px;
        margin-right: ${theme.sizeUnit * 2}px;
      }
    }

    .ant-menu-item-divider {
      margin: ${theme.sizeUnit}px 0;
      background: ${theme.colorBorderSecondary};
    }
  `}
`;

const SidebarTitle = styled.div`
  ${({ theme }) => `
    padding: ${theme.sizeUnit * 4}px ${theme.sizeUnit * 4}px ${theme.sizeUnit * 2}px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: ${theme.colorTextSecondary};
  `}
`;

const LoadingContainer = styled.div`
  ${({ theme }) => `
    display: flex;
    justify-content: center;
    align-items: center;
    padding: ${theme.sizeUnit * 8}px;
  `}
`;

interface Dashboard {
  id: number;
  dashboard_title: string;
  slug: string;
  url: string;
  uuid?: string;
}

interface DataSourceSidebarProps {
  selectedKey?: string;
  onSelect?: (dashboard: Dashboard) => void;
  isPublic?: boolean;
}

export default function DataSourceSidebar({
  selectedKey,
  onSelect,
  isPublic = false,
}: DataSourceSidebarProps) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    const fetchDashboards = async () => {
      setLoading(true);
      try {
        const endpoint = isPublic
          ? '/api/v1/dashboard/public/'
          : `/api/v1/dashboard/?q=${JSON.stringify({
              page: 0,
              page_size: 100,
              order_column: 'dashboard_title',
              order_direction: 'asc',
            })}`;

        const response = await SupersetClient.get({
          endpoint,
          signal: controller.signal,
        });
        if (!isActive || controller.signal.aborted) {
          return;
        }
        const fetchedDashboards = response.json.result || [];
        setDashboards(fetchedDashboards);

        // Auto-select first dashboard if none selected
        if (fetchedDashboards.length > 0 && !selectedKey && onSelect) {
          onSelect(fetchedDashboards[0]);
        }
      } catch (error) {
        if (!isActive || controller.signal.aborted) {
          return;
        }
        console.error('Error fetching dashboards:', error);
        setDashboards([]);
      } finally {
        if (isActive && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchDashboards();
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [isPublic]);

  const handleMenuClick = ({ key }: { key: string }) => {
    const dashboard = dashboards.find(d => d.id.toString() === key);
    if (dashboard && onSelect) {
      onSelect(dashboard);
    }
  };

  if (loading) {
    return (
      <StyledSidebar>
        <SidebarTitle>{t('Categories')}</SidebarTitle>
        <LoadingContainer>
          <Spin />
        </LoadingContainer>
      </StyledSidebar>
    );
  }

  return (
    <StyledSidebar>
      <SidebarTitle>{t('Categories')}</SidebarTitle>
      {dashboards.length === 0 ? (
        <LoadingContainer>
          <span style={{ color: '#999' }}>{t('No dashboards available')}</span>
        </LoadingContainer>
      ) : (
        <StyledMenu
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          onClick={handleMenuClick}
          items={dashboards.map(dashboard => ({
            key: dashboard.id.toString(),
            icon: <Icons.DashboardOutlined />,
            label: dashboard.dashboard_title,
          }))}
        />
      )}
    </StyledSidebar>
  );
}

export type { Dashboard };
