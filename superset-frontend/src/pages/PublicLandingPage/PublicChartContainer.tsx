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

import { useEffect, useState } from 'react';
import { styled, t } from '@superset-ui/core';

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

const Frame = styled.iframe`
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: transparent;
`;

type PublicChartContainerProps = {
  title: string;
  url: string;
  height?: number;
  loadingLabel?: string;
};

export default function PublicChartContainer({
  title,
  url,
  height = 360,
  loadingLabel = t('Loading analytics...'),
}: PublicChartContainerProps) {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
  }, [url]);

  return (
    <FrameShell $height={height}>
      {isLoading && <FrameOverlay>{loadingLabel}</FrameOverlay>}
      <Frame
        src={url}
        title={title}
        loading="lazy"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        onLoad={() => setIsLoading(false)}
      />
    </FrameShell>
  );
}
