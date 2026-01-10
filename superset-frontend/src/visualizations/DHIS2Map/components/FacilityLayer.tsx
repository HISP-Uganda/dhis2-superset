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
import { CircleMarker, Popup } from 'react-leaflet';
import { FacilityData } from '../types';

interface FacilityLayerProps {
  facilities: FacilityData[];
  dataMap: Map<string, number>;
  metric: string;
  colorScale: (value: number) => string;
  radiusScale: (value: number) => number;
  onFacilityClick?: (facility: FacilityData) => void;
}

function FacilityLayer({
  facilities,
  dataMap,
  metric,
  colorScale,
  radiusScale,
  onFacilityClick,
}: FacilityLayerProps): React.ReactElement {
  return (
  <>
    {facilities.map(facility => {
      const value = dataMap.get(facility.id);
      if (!facility.coordinates) return null;

      return (
        // @ts-ignore - React 19 compatibility with react-leaflet
        <CircleMarker
          key={facility.id}
          center={[facility.coordinates.lat, facility.coordinates.lng]}
          {...({ radius: value ? radiusScale(value) : 5 } as any)}
          pathOptions={{
            fillColor: value ? colorScale(value) : '#999',
            fillOpacity: 0.7,
            color: '#fff',
            weight: 1,
          }}
          eventHandlers={{
            click: () => onFacilityClick?.(facility),
          }}
        >
          {/* @ts-ignore - React 19 compatibility with react-leaflet */}
          <Popup>
            <strong>{facility.name}</strong>
            <br />
            {metric}: {value ?? 'No data'}
          </Popup>
        </CircleMarker>
      );
    })}
  </>
  );
}

export default FacilityLayer;
