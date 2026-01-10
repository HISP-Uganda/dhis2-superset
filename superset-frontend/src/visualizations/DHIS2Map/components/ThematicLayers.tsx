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
import { GeoJSON } from 'react-leaflet';
import { ThematicLayerConfig } from '../types';

interface ThematicLayersProps {
  layers: ThematicLayerConfig[];
  dataMap: Map<string, Record<string, number>>;
}

const ThematicLayers: React.FC<ThematicLayersProps> = ({ layers, dataMap }) => (
  <>
    {layers.map((layer, index) => (
      // @ts-ignore - React 19 compatibility with react-leaflet
      <GeoJSON
        key={`thematic-${index}`}
        data={layer.boundaries as any}
        style={
          ((feature: any) => {
            const values = dataMap.get(feature?.id);
            const value = values?.[layer.metric] ?? 0;
            return {
              fillColor: layer.colorScale(value),
              fillOpacity: layer.opacity,
              color: layer.strokeColor,
              weight: layer.strokeWidth,
            };
          }) as any
        }
      />
    ))}
  </>
);

export default ThematicLayers;
