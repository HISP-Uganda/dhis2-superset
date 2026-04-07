import React, { useCallback } from 'react';
import type maplibregl from 'maplibre-gl';

interface Props {
  mapRef: React.RefObject<maplibregl.Map | null>;
}

const ExportButton: React.FC<Props> = ({ mapRef }) => {
  const handleExport = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.once('render', () => {
      try {
        const dataUrl = map.getCanvas().toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `vital-map-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
      } catch {
        // Canvas may be tainted if tiles are cross-origin without CORS
      }
    });
    map.triggerRepaint();
  }, [mapRef]);

  return (
    <button
      onClick={handleExport}
      title="Export map as PNG"
      style={{
        position: 'absolute',
        top: 50,
        left: 10,
        zIndex: 12,
        width: 34,
        height: 34,
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 6,
        boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 15,
        color: '#444',
        lineHeight: 1,
        padding: 0,
      }}
      aria-label="Export map as PNG"
    >
      {'\u2B73'}
    </button>
  );
};

export default ExportButton;
