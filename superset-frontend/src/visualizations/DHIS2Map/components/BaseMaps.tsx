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

import React, { useState, useEffect, useRef } from 'react';
import { TileLayer } from 'react-leaflet';
import { styled } from '@superset-ui/core';

// Available base map configurations
export const BASE_MAPS = {
  none: {
    name: 'White Background',
    url: '',
    attribution: '',
    maxZoom: 20,
  },
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
  // Key prop forces TileLayer to remount when mapType changes
  return <TileLayer key={mapType} url={config.url} attribution={config.attribution} maxZoom={config.maxZoom} />;
}

/* eslint-disable theme-colors/no-literal-colors */
const SelectorWrapper = styled.div`
  position: relative;
  z-index: 4;
`;

const SelectorButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 9px;
  background: rgba(248, 250, 252, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 999px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 500;
  color: #334155;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);

  &:hover {
    background: rgba(241, 245, 249, 0.98);
  }
`;

const DropdownMenu = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 10px;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.14);
  min-width: 196px;
  max-height: 300px;
  overflow-y: auto;
  z-index: 5;
`;

const MapOption = styled.button<{ $isActive: boolean }>`
  display: block;
  width: 100%;
  padding: 9px 12px;
  text-align: left;
  border: none;
  background: ${({ $isActive }) => ($isActive ? '#e6f7ff' : '#ffffff')};
  cursor: pointer;
  font-size: 11px;
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [isOpen]);

  return (
    <SelectorWrapper ref={wrapperRef}>
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
