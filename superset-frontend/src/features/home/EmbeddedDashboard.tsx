// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { useEffect, useRef, useState } from 'react';
import { embedDashboard } from '@superset-ui/embedded-sdk';
import { styled } from '@superset-ui/core';
import { fetchGuestToken } from '../../utils/guestToken';

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  font-size: 16px;
  color: ${({ theme }) => theme.colorTextSecondary};
`;

const ErrorContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 20px;
  color: ${({ theme }) => theme.colorError};
  text-align: center;
`;

const DashboardContainer = styled.div`
  width: 100%;
  height: calc(100vh - 60px);
  min-height: 800px;

  iframe {
    border: none;
    width: 100%;
    height: 100%;
  }
`;

interface EmbeddedDashboardProps {
  dashboardId: string;
  filters?: Record<string, any>;
}

export default function EmbeddedDashboard({
  dashboardId,
  filters = {},
}: EmbeddedDashboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dashboardRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }
    let isActive = true;

    const embedDashboardAsync = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const dashboard = await embedDashboard({
          id: dashboardId,
          supersetDomain: window.location.origin,
          mountPoint: containerRef.current!,
          fetchGuestToken: () => fetchGuestToken(dashboardId),
          dashboardUiConfig: {
            hideTitle: true,
            hideChartControls: false,
            hideTab: false,
            filters: {
              visible: true,
              expanded: true,
            },
          },
        });

        if (!isActive) {
          return;
        }

        dashboardRef.current = dashboard;

        // Set light theme
        try {
          dashboard.setThemeConfig({
            theme_default: {
              algorithm: 'light',
            },
          });
        } catch (themeError) {
          console.error('Failed to set embedded dashboard theme:', themeError);
        }

        setIsLoading(false);
      } catch (err) {
        if (!isActive) {
          return;
        }
        console.error('Failed to embed dashboard:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setIsLoading(false);
      }
    };

    embedDashboardAsync();

    return () => {
      isActive = false;
      if (dashboardRef.current) {
        dashboardRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboardRef.current || Object.keys(filters).length === 0) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      Object.entries(filters).forEach(([filterId, value]) => {
        try {
          dashboardRef.current?.setFilterValue(filterId, value);
        } catch (e) {
          console.error(`Failed to set filter ${filterId}:`, e);
        }
      });
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [filters]);

  if (error) {
    return (
      <ErrorContainer>
        <div>
          <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>
            Failed to load dashboard
          </div>
          <div>{error}</div>
        </div>
      </ErrorContainer>
    );
  }

  return (
    <>
      {isLoading && <LoadingContainer>Loading dashboard...</LoadingContainer>}
      <DashboardContainer
        ref={containerRef}
        style={{ display: isLoading ? 'none' : 'block' }}
      />
    </>
  );
}
