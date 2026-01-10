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
import { TileLayer } from 'react-leaflet';
import { styled } from '@superset-ui/core';

// Available base map configurations
export const BASE_MAPS = {
  osmLight: {
    name: 'OSM Light (DHIS2 Default)',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  satellite: {
    name: 'Satellite (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    maxZoom: 18,
  },
  terrain: {
    name: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap',
    maxZoom: 17,
  },
  dark: {
    name: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CartoDB',
    maxZoom: 20,
  },
  light: {
    name: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CartoDB',
    maxZoom: 20,
  },
};

export type BaseMapType = keyof typeof BASE_MAPS;

interface BaseMapLayerProps {
  mapType: BaseMapType;
}

export function BaseMapLayer({ mapType }: BaseMapLayerProps): React.ReactElement | null {
  const config = BASE_MAPS[mapType];
  if (!config || !config.url) {
    return null;
  }
  // @ts-ignore - React 19 compatibility with react-leaflet
  return <TileLayer url={config.url} />;
}

/* eslint-disable theme-colors/no-literal-colors */
const SelectorWrapper = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1000;
`;

const SelectorButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #ffffff;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);

  &:hover {
    background: #f4f4f4;
  }
`;

const DropdownMenu = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: #ffffff;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  min-width: 180px;
  max-height: 300px;
  overflow-y: auto;
`;

const MapOption = styled.button<{ $isActive: boolean }>`
  display: block;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  border: none;
  background: ${({ $isActive }) => ($isActive ? '#e6f7ff' : '#ffffff')};
  cursor: pointer;
  font-size: 12px;
  color: ${({ $isActive }) => ($isActive ? '#1890ff' : '#333333')};
  border-bottom: 1px solid #f0f0f0;

  &:hover {
    background: ${({ $isActive }) => ($isActive ? '#e6f7ff' : '#f5f5f5')};
  }

  &:last-child {
    border-bottom: none;
  }
`;
/* eslint-enable theme-colors/no-literal-colors */

interface BaseMapSelectorProps {
  currentMap: BaseMapType;
  onMapChange: (mapType: BaseMapType) => void;
}

export function BaseMapSelector({
  currentMap,
  onMapChange,
}: BaseMapSelectorProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <SelectorWrapper>
      <SelectorButton type="button" onClick={() => setIsOpen(!isOpen)}>
        🗺️ {BASE_MAPS[currentMap]?.name || 'Select Map'}
        <span style={{ fontSize: 8 }}>{isOpen ? '▲' : '▼'}</span>
      </SelectorButton>

      {isOpen && (
        <DropdownMenu>
          {(Object.keys(BASE_MAPS) as BaseMapType[]).map(mapType => (
            <MapOption
              key={mapType}
              $isActive={currentMap === mapType}
              type="button"
              onClick={() => {
                onMapChange(mapType);
                setIsOpen(false);
              }}
            >
              {BASE_MAPS[mapType].name}
            </MapOption>
          ))}
        </DropdownMenu>
      )}
    </SelectorWrapper>
  );
};
