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

import React, { useState } from 'react';
import { styled, t } from '@superset-ui/core';

export interface MapKey {
  symbol: string;
  label: string;
  description?: string;
  color?: string;
}

interface MapKeysProps {
  keys: MapKey[];
  position?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  title?: string;
  collapsible?: boolean;
}

const KeysContainer = styled.div<{ position?: string }>`
  position: absolute;
  ${({ position = 'topleft' }) => {
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
  min-width: 140px;
  max-height: 400px;
  overflow-y: auto;
  backdrop-filter: blur(2px);
`;

const KeysHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #e0e0e0;
`;

const KeysTitle = styled.h4`
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #333;
`;

const ToggleButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  padding: 0;

  &:hover {
    color: #000;
  }
`;

const KeyItem = styled.div`
  display: flex;
  align-items: center;
  margin: 6px 0;
  font-size: 11px;
  color: #333;
`;

const SymbolBox = styled.div<{ color?: string }>`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  background: ${({ color }) => color || '#f0f0f0'};
  border: 1px solid #ddd;
  border-radius: 3px;
  font-weight: bold;
  font-size: 12px;
  flex-shrink: 0;
`;

const LabelColumn = styled.div`
  flex: 1;
`;

const Label = styled.div`
  font-weight: 500;
  margin-bottom: 2px;
`;

const Description = styled.div`
  font-size: 10px;
  color: #666;
  line-height: 1.2;
`;

const MapKeys: React.FC<MapKeysProps> = ({
  keys,
  position = 'topleft',
  title = t('Map Keys'),
  collapsible = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (keys.length === 0) {
    return null;
  }

  if (!isExpanded) {
    return (
      <KeysContainer position={position}>
        <ToggleButton
          onClick={() => setIsExpanded(true)}
          title={t('Expand map keys')}
        >
          {title} ▼
        </ToggleButton>
      </KeysContainer>
    );
  }

  return (
    <KeysContainer position={position}>
      {collapsible && (
        <KeysHeader>
          <KeysTitle>{title}</KeysTitle>
          <ToggleButton
            onClick={() => setIsExpanded(false)}
            title={t('Collapse')}
          >
            ▲
          </ToggleButton>
        </KeysHeader>
      )}
      {!collapsible && (
        <KeysHeader>
          <KeysTitle>{title}</KeysTitle>
        </KeysHeader>
      )}
      {keys.map((key, index) => (
        <KeyItem key={index}>
          <SymbolBox color={key.color}>{key.symbol}</SymbolBox>
          <LabelColumn>
            <Label>{key.label}</Label>
            {key.description && <Description>{key.description}</Description>}
          </LabelColumn>
        </KeyItem>
      ))}
    </KeysContainer>
  );
};

export default MapKeys;
