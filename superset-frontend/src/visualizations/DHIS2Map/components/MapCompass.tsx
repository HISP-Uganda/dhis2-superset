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
import { CompassStyle, MapCornerPosition } from '../types';

interface MapCompassProps {
  position?: MapCornerPosition;
  style?: CompassStyle;
}

/* eslint-disable theme-colors/no-literal-colors */

function getPositionStyle(position: MapCornerPosition): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    zIndex: 3,
    pointerEvents: 'none',
  };
  switch (position) {
    case 'topleft':
      return { ...base, top: 8, left: 8 };
    case 'top':
      return { ...base, top: 8, left: '50%', transform: 'translateX(-50%)' };
    case 'topright':
      return { ...base, top: 8, right: 8 };
    case 'left':
      return { ...base, top: '50%', left: 8, transform: 'translateY(-50%)' };
    case 'right':
      return { ...base, top: '50%', right: 8, transform: 'translateY(-50%)' };
    case 'bottomleft':
      return { ...base, bottom: 36, left: 8 };
    case 'bottom':
      return {
        ...base,
        bottom: 36,
        left: '50%',
        transform: 'translateX(-50%)',
      };
    case 'bottomright':
    default:
      return { ...base, bottom: 36, right: 8 };
  }
}

/** Compass arrow SVG pointing north (upward) */
function CompassArrow(): React.ReactElement {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* North (red) half */}
      <polygon points="15,3 19,15 15,13 11,15" fill="#e53e3e" />
      {/* South (grey) half */}
      <polygon points="15,27 19,15 15,17 11,15" fill="#94a3b8" />
      {/* Center dot */}
      <circle cx="15" cy="15" r="2.5" fill="#1e293b" />
    </svg>
  );
}

function MapCompass({
  position = 'topright',
  style: compassStyle = 'north_badge',
}: MapCompassProps): React.ReactElement {
  const posStyle = getPositionStyle(position);

  if (compassStyle === 'minimal_n') {
    // Just "N" text with a small line above it
    return (
      <div
        style={{
          ...posStyle,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <div
          style={{
            background: 'rgba(255,255,255,0.88)',
            border: '1px solid rgba(148,163,184,0.4)',
            borderRadius: 4,
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            padding: '3px 6px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <div
            style={{
              width: 2,
              height: 8,
              background: '#e53e3e',
              borderRadius: 1,
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#1e293b',
              lineHeight: 1,
              letterSpacing: '0.05em',
            }}
          >
            N
          </span>
        </div>
      </div>
    );
  }

  if (compassStyle === 'arrow_north') {
    return (
      <div
        style={{
          ...posStyle,
          background: 'rgba(255,255,255,0.88)',
          border: '1px solid rgba(148,163,184,0.4)',
          borderRadius: '50%',
          boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CompassArrow />
      </div>
    );
  }

  // Default: north_badge — circular badge with "N" and arrow
  return (
    <div
      style={{
        ...posStyle,
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(148,163,184,0.35)',
        borderRadius: '50%',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        width: 32,
        height: 32,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
      }}
    >
      {/* North arrow tip */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderBottom: '8px solid #e53e3e',
          marginBottom: 1,
        }}
      />
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: '#1e293b',
          lineHeight: 1,
          letterSpacing: '0.04em',
        }}
      >
        N
      </span>
    </div>
  );
}

/* eslint-enable theme-colors/no-literal-colors */

export default MapCompass;
