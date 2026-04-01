/*
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

import React, { useState, useEffect } from 'react';
import { styled, t } from '@superset-ui/core';
import { OfflineCacheManager } from '../utils/enhancedFeatures';

interface OfflineCacheStatusProps {
  position?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
}

const StatusContainer = styled.div<{ position?: string }>`
  position: absolute;
  ${({ position = 'bottomleft' }) => {
    const [vertical, horizontal] = [
      position.includes('top') ? 'top: 10px' : 'bottom: 30px',
      position.includes('left') ? 'left: 10px' : 'right: 10px',
    ];
    return `${vertical}; ${horizontal};`;
  }}
  background: rgba(255, 255, 255, 0.95);
  padding: 10px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  z-index: 4;
  font-size: 11px;
  color: #333;
  min-width: 150px;
  backdrop-filter: blur(2px);
`;

const StatusLine = styled.div`
  margin: 4px 0;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const StatusDot = styled.div<{ status: 'online' | 'cached' | 'error' }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ status }) => {
    switch (status) {
      case 'online':
        return '#52c41a';
      case 'cached':
        return '#faad14';
      case 'error':
        return '#f5222d';
    }
  }};
`;

const ClearButton = styled.button`
  background: none;
  border: 1px solid #d9d9d9;
  padding: 4px 8px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 11px;
  margin-top: 6px;
  width: 100%;

  &:hover {
    border-color: #40a9ff;
    color: #40a9ff;
  }
`;

const OfflineCacheStatus: React.FC<OfflineCacheStatusProps> = ({
  position = 'bottomleft',
}) => {
  const [isCached, setIsCached] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleClearCache = async () => {
    await OfflineCacheManager.clearCache();
    setIsCached(false);
  };

  return (
    <StatusContainer position={position}>
      <StatusLine>
        <StatusDot status={isOnline ? 'online' : 'cached'} />
        <span>{isOnline ? t('Online') : t('Offline')}</span>
      </StatusLine>
      {isCached && (
        <>
          <StatusLine>
            <StatusDot status="cached" />
            <span>{t('Cached data available')}</span>
          </StatusLine>
          <ClearButton onClick={handleClearCache}>
            {t('Clear Cache')}
          </ClearButton>
        </>
      )}
    </StatusContainer>
  );
};

export default OfflineCacheStatus;
