import React from 'react';

interface Props {
  zoom: number;
  featureCount: number;
  loadTime?: number;
}

const MapStatusBar: React.FC<Props> = ({ zoom, featureCount, loadTime }) => (
  <div
    style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 22,
      background: 'rgba(255,255,255,0.88)',
      borderTop: '1px solid rgba(0,0,0,0.08)',
      display: 'flex',
      alignItems: 'center',
      paddingLeft: 10,
      fontSize: 11,
      color: '#666',
      fontFamily: 'system-ui, sans-serif',
      gap: 16,
      zIndex: 8,
      pointerEvents: 'none',
    }}
  >
    <span>Zoom: {zoom.toFixed(1)}</span>
    <span>{featureCount.toLocaleString()} features</span>
    {loadTime !== undefined && <span>Loaded in {loadTime}ms</span>}
  </div>
);

export default MapStatusBar;
