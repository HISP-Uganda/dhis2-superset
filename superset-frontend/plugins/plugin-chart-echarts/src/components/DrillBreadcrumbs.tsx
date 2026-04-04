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
import { styled, t, useTheme } from '@superset-ui/core';
import type { DrillBreadcrumb, OuLevelDefinition } from '../utils/ouDrillDown';

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12px;
  line-height: 20px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  background: ${({ theme }) => theme.colorBgContainer};
  flex-shrink: 0;
  overflow: hidden;
`;

const Crumb = styled.button`
  all: unset;
  cursor: pointer;
  color: ${({ theme }) => theme.colorPrimary};
  font-weight: 500;
  white-space: nowrap;
  &:hover {
    text-decoration: underline;
  }
`;

const Separator = styled.span`
  color: ${({ theme }) => theme.colorTextSecondary};
  user-select: none;
`;

const CurrentLevel = styled.span`
  color: ${({ theme }) => theme.colorText};
  font-weight: 600;
  white-space: nowrap;
`;

const ResetButton = styled.button`
  all: unset;
  cursor: pointer;
  margin-left: auto;
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: 11px;
  &:hover {
    color: ${({ theme }) => theme.colorText};
  }
`;

interface DrillBreadcrumbsProps {
  breadcrumbs: DrillBreadcrumb[];
  currentLevelLabel: string;
  /** Index-based: -1 = reset, 0..n = navigate to that breadcrumb's child */
  onNavigate: (breadcrumbIndex: number) => void;
  /** Original (top-level) label, shown as the first crumb */
  topLevelLabel?: string;
}

export default function DrillBreadcrumbs({
  breadcrumbs,
  currentLevelLabel,
  onNavigate,
  topLevelLabel,
}: DrillBreadcrumbsProps) {
  return (
    <Bar>
      <Crumb onClick={() => onNavigate(-1)}>
        {topLevelLabel || t('Top')}
      </Crumb>
      {breadcrumbs.map((crumb, idx) => (
        <span key={idx} style={{ display: 'contents' }}>
          <Separator>/</Separator>
          {idx < breadcrumbs.length - 1 ? (
            <Crumb onClick={() => onNavigate(idx)}>
              {crumb.selectedValue}
            </Crumb>
          ) : (
            <CurrentLevel>{crumb.selectedValue}</CurrentLevel>
          )}
        </span>
      ))}
      <Separator>&rarr;</Separator>
      <CurrentLevel>{currentLevelLabel}</CurrentLevel>
      <ResetButton onClick={() => onNavigate(-1)}>{t('Reset')}</ResetButton>
    </Bar>
  );
}
