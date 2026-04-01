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
import { PrintExportManager } from '../utils/enhancedFeatures';

interface PrintExportControlsProps {
  mapElement: HTMLElement | null;
  position?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
}

const ControlsContainer = styled.div<{ position?: string }>`
  position: absolute;
  ${({ position = 'topright' }) => {
    const [vertical, horizontal] = [
      position.includes('top') ? 'top: 10px' : 'bottom: 30px',
      position.includes('left') ? 'left: 10px' : 'right: 10px',
    ];
    return `${vertical}; ${horizontal};`;
  }}
  background: rgba(255, 255, 255, 0.95);
  padding: 8px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  z-index: 4;
  display: flex;
  gap: 4px;
  backdrop-filter: blur(2px);
`;

const Button = styled.button`
  background: #1890ff;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;

  &:hover {
    background: #0050b3;
  }

  &:disabled {
    background: #d9d9d9;
    cursor: not-allowed;
  }
`;

const PrintExportControls: React.FC<PrintExportControlsProps> = ({
  mapElement,
  position = 'topright',
}) => {
  const handleExportPNG = async () => {
    if (!mapElement) {
      return;
    }
    await PrintExportManager.exportAsImage(mapElement, 'dhis2-map', 'png');
  };

  const handleExportSVG = async () => {
    if (!mapElement) {
      return;
    }
    await PrintExportManager.exportAsImage(mapElement, 'dhis2-map', 'svg');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <ControlsContainer position={position}>
      <Button onClick={handleExportPNG} title={t('Export as PNG')}>
        📷 PNG
      </Button>
      <Button onClick={handleExportSVG} title={t('Export as SVG')}>
        📄 SVG
      </Button>
      <Button onClick={handlePrint} title={t('Print')}>
        🖨️ Print
      </Button>
    </ControlsContainer>
  );
};

export default PrintExportControls;
