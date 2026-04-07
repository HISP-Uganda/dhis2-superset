import React from 'react';
import type { LayerType } from '../plugin/types';

interface Props {
  layerType: LayerType;
  opacity: number;
  onOpacityChange: (v: number) => void;
}

const LAYER_LABELS: Record<LayerType, string> = {
  point: 'Point',
  bubble: 'Bubble',
  choropleth: 'Choropleth',
  heatmap: 'Heatmap',
  boundary: 'Boundary',
  extrusion: '3D Extrusion',
  marker: 'Marker / Icon',
};

const LayerPanel: React.FC<Props> = ({ layerType, opacity, onOpacityChange }) => (
  <div
    style={{
      position: 'absolute',
      top: 55,
      right: 10,
      background: 'rgba(255,255,255,0.95)',
      borderRadius: 6,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      padding: '10px 14px',
      minWidth: 160,
      zIndex: 11,
      fontFamily: 'system-ui, sans-serif',
      fontSize: 12,
    }}
  >
    <div style={{ fontWeight: 600, marginBottom: 8, color: '#333', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em' }}>
      Layer
    </div>
    <div style={{ marginBottom: 10, color: '#555' }}>{LAYER_LABELS[layerType] ?? layerType}</div>
    <label style={{ display: 'block', color: '#777', marginBottom: 4 }}>
      Opacity: {Math.round(opacity * 100)}%
    </label>
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={opacity}
      onChange={e => onOpacityChange(Number(e.target.value))}
      style={{ width: '100%', cursor: 'pointer' }}
    />
  </div>
);

export default LayerPanel;
