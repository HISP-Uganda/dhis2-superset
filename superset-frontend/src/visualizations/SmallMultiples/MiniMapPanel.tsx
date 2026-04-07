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
import { useMemo, useState, useCallback } from 'react';
import type { PanelData } from './types';

/* ── Color scale helpers ────────────────────────────── */

const FALLBACK_RAMP = ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c'];

function quantize(value: number, min: number, max: number, steps: number): number {
  if (max === min) return 0;
  const normalized = (value - min) / (max - min);
  return Math.min(steps - 1, Math.max(0, Math.floor(normalized * steps)));
}

/* ── GeoJSON → SVG path conversion ──────────────────── */

interface BBox {
  minX: number; minY: number; maxX: number; maxY: number;
}

function computeBBox(features: GeoJSON.Feature[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of features) {
    visitCoords(f.geometry, (lon, lat) => {
      if (lon < minX) minX = lon;
      if (lon > maxX) maxX = lon;
      if (lat < minY) minY = lat;
      if (lat > maxY) maxY = lat;
    });
  }
  return { minX, minY, maxX, maxY };
}

function visitCoords(
  geom: GeoJSON.Geometry,
  fn: (lon: number, lat: number) => void,
) {
  if (!geom) return;
  switch (geom.type) {
    case 'Point':
      fn(geom.coordinates[0], geom.coordinates[1]);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const c of geom.coordinates) fn(c[0], c[1]);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geom.coordinates)
        for (const c of ring) fn(c[0], c[1]);
      break;
    case 'MultiPolygon':
      for (const poly of geom.coordinates)
        for (const ring of poly)
          for (const c of ring) fn(c[0], c[1]);
      break;
    case 'GeometryCollection':
      for (const g of geom.geometries) visitCoords(g, fn);
      break;
    default:
      break;
  }
}

function projectCoord(
  lon: number, lat: number,
  bbox: BBox, width: number, height: number,
  padding: number,
): [number, number] {
  const bboxW = bbox.maxX - bbox.minX || 1;
  const bboxH = bbox.maxY - bbox.minY || 1;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scale = Math.min(innerW / bboxW, innerH / bboxH);
  const offsetX = (innerW - bboxW * scale) / 2 + padding;
  const offsetY = (innerH - bboxH * scale) / 2 + padding;
  const x = (lon - bbox.minX) * scale + offsetX;
  const y = (bbox.maxY - lat) * scale + offsetY; // flip Y
  return [x, y];
}

function ringToPath(
  ring: number[][],
  bbox: BBox, w: number, h: number, pad: number,
): string {
  return ring
    .map((c, i) => {
      const [x, y] = projectCoord(c[0], c[1], bbox, w, h, pad);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('') + 'Z';
}

function geometryToPath(
  geom: GeoJSON.Geometry,
  bbox: BBox, w: number, h: number, pad: number,
): string {
  if (!geom) return '';
  switch (geom.type) {
    case 'Polygon':
      return geom.coordinates
        .map(ring => ringToPath(ring, bbox, w, h, pad))
        .join('');
    case 'MultiPolygon':
      return geom.coordinates
        .flatMap(poly => poly.map(ring => ringToPath(ring, bbox, w, h, pad)))
        .join('');
    default:
      return '';
  }
}

/* ── Component ──────────────────────────────────────── */

interface MiniMapPanelProps {
  panel: PanelData;
  chartHeight: number;
  linearColors?: string[];
  formatter: (v: number) => string;
  nullText: string;
}

export default function MiniMapPanel({
  panel,
  chartHeight,
  linearColors,
  formatter,
  nullText,
}: MiniMapPanelProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const features = panel.geojson?.features || [];
  const COLOR_STEPS = 7;
  const ramp = useMemo(() => {
    if (linearColors && linearColors.length >= 3) {
      return linearColors.slice(0, Math.max(COLOR_STEPS, linearColors.length));
    }
    return FALLBACK_RAMP;
  }, [linearColors]);

  const { bbox, values, min, max } = useMemo(() => {
    const vals = features.map(f => Number(f.properties?.value ?? 0));
    const mn = vals.length > 0 ? Math.min(...vals) : 0;
    const mx = vals.length > 0 ? Math.max(...vals) : 100;
    return {
      bbox: computeBBox(features),
      values: vals,
      min: mn,
      max: mx,
    };
  }, [features]);

  const handleMouseEnter = useCallback((idx: number) => setHoveredIdx(idx), []);
  const handleMouseLeave = useCallback(() => setHoveredIdx(null), []);

  if (!features.length) {
    return (
      <div
        style={{
          width: '100%',
          height: chartHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#9CA3AF',
          fontSize: 11,
        }}
      >
        No geometry data
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: chartHeight, position: 'relative' }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 300 ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        {features.map((f, idx) => {
          const d = geometryToPath(f.geometry, bbox, 300, chartHeight, 8);
          if (!d) return null;
          const colorIdx = quantize(values[idx], min, max, COLOR_STEPS);
          const fill = ramp[colorIdx] || ramp[0];
          const isHovered = hoveredIdx === idx;
          return (
            <path
              key={idx}
              d={d}
              fill={fill}
              stroke={isHovered ? '#0D3B66' : '#fff'}
              strokeWidth={isHovered ? 1.5 : 0.5}
              opacity={isHovered ? 1 : 0.9}
              onMouseEnter={() => handleMouseEnter(idx)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
            />
          );
        })}
      </svg>
      {hoveredIdx !== null && features[hoveredIdx] && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: 4,
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #ddd',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 10,
            pointerEvents: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            zIndex: 10,
          }}
        >
          <strong>{features[hoveredIdx].properties?.label || '—'}</strong>
          {': '}
          {values[hoveredIdx] != null && Number.isFinite(values[hoveredIdx])
            ? formatter(values[hoveredIdx])
            : nullText}
        </div>
      )}
    </div>
  );
}
