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
/* eslint-disable theme-colors/no-literal-colors */

import { useEffect, useRef, useState } from 'react';
import { embedDashboard } from '@superset-ui/embedded-sdk';
import { styled, t } from '@superset-ui/core';
import { fetchGuestToken } from 'src/utils/guestToken';

const FrameShell = styled.div<{ $height: number }>`
  position: relative;
  width: 100%;
  min-height: ${({ $height }) => $height}px;
  height: ${({ $height }) => $height}px;
  overflow: hidden;
  border-radius: var(--portal-radius-md, 0);
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: var(--portal-surface, #ffffff);
`;

const FrameOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: ${({ theme }) => theme.colorTextSecondary};
  background: var(--portal-surface, rgba(255, 255, 255, 0.96));
  z-index: 2;
`;

const ErrorOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  background: var(--portal-surface, rgba(255, 255, 255, 0.96));
  z-index: 2;
  color: ${({ theme }) => theme.colorError};
`;

const MountPoint = styled.div`
  width: 100%;
  height: 100%;

  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
    background: transparent;
  }
`;

type PublicDashboardEmbedProps = {
  title: string;
  dashboardId: number | string;
  dashboardUuid?: string | null;
  height?: number;
  loadingLabel?: string;
};

export default function PublicDashboardEmbed({
  title,
  dashboardId,
  dashboardUuid,
  height = 720,
  loadingLabel = t('Loading dashboard...'),
}: PublicDashboardEmbedProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const embedId = dashboardUuid || String(dashboardId || '').trim();

  useEffect(() => {
    if (!mountRef.current) {
      return undefined;
    }

    if (!embedId) {
      setError(t('This dashboard is not available for public viewing.'));
      setIsLoading(false);
      return undefined;
    }

    let isActive = true;
    const mountPoint = mountRef.current;

    setIsLoading(true);
    setError(null);
    mountPoint.replaceChildren();

    embedDashboard({
      id: embedId,
      supersetDomain: window.location.origin,
      mountPoint,
      fetchGuestToken: () => fetchGuestToken(embedId),
      iframeTitle: title,
      dashboardUiConfig: {
        hideTitle: true,
        hideTab: false,
        hideChartControls: false,
        filters: {
          visible: true,
          expanded: false,
        },
      },
    })
      .then(dashboard => {
        if (!isActive) {
          dashboard.unmount();
          return;
        }
        try {
          dashboard.setThemeConfig({
            theme_default: {
              algorithm: 'light',
            },
          });
        } catch {
          // Embedded theme overrides are best-effort only.
        }
        setIsLoading(false);
      })
      .catch(caughtError => {
        if (!isActive) {
          return;
        }
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : t('Failed to load dashboard.'),
        );
        setIsLoading(false);
      });

    return () => {
      isActive = false;
      mountPoint.replaceChildren();
    };
  }, [embedId, title]);

  return (
    <FrameShell $height={height} role="region" aria-label={title}>
      {isLoading && <FrameOverlay>{loadingLabel}</FrameOverlay>}
      {error && <ErrorOverlay>{error}</ErrorOverlay>}
      <MountPoint ref={mountRef} />
    </FrameShell>
  );
}
