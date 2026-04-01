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

import React from 'react';
import { styled, t } from '@superset-ui/core';
import { Button } from 'antd';
import { ArrowLeftOutlined, HomeOutlined } from '@ant-design/icons';

interface Breadcrumb {
  id: string;
  name: string;
  level: number;
}

interface DrillControlsProps {
  breadcrumbs: Breadcrumb[];
  onDrillUp: () => void;
  onBreadcrumbClick: (index: number) => void;
}

const ControlsContainer = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const BreadcrumbContainer = styled.div`
  background: white;
  padding: 8px 12px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const BreadcrumbItem = styled.span<{ clickable?: boolean }>`
  color: ${({ clickable }) => (clickable ? '#1890ff' : '#333')};
  cursor: ${({ clickable }) => (clickable ? 'pointer' : 'default')};
  font-size: 12px;

  &:hover {
    ${({ clickable }) => clickable && 'text-decoration: underline;'}
  }
`;

const Separator = styled.span`
  color: #999;
  margin: 0 4px;
`;

function DrillControls({
  breadcrumbs,
  onDrillUp,
  onBreadcrumbClick,
}: DrillControlsProps): React.ReactElement {
  return (
  <ControlsContainer>
    <BreadcrumbContainer>
      <Button
        size="small"
        icon={<HomeOutlined />}
        onClick={() => onBreadcrumbClick(0)}
        title={t('Return to top level')}
      />
      <Button
        size="small"
        icon={<ArrowLeftOutlined />}
        onClick={onDrillUp}
        title={t('Go up one level')}
      />
      <Separator>|</Separator>
      <BreadcrumbItem clickable onClick={() => onBreadcrumbClick(0)}>
        {t('All')}
      </BreadcrumbItem>
      {breadcrumbs.map((crumb, index) => (
        // @ts-ignore - React 19 compatibility
        <React.Fragment key={crumb.id}>
          <Separator>›</Separator>
          <BreadcrumbItem
            clickable={index < breadcrumbs.length - 1}
            onClick={() =>
              index < breadcrumbs.length - 1 && onBreadcrumbClick(index + 1)
            }
          >
            {crumb.name}
          </BreadcrumbItem>
        </React.Fragment>
      ))}
    </BreadcrumbContainer>
  </ControlsContainer>
  );
}

export default DrillControls;
