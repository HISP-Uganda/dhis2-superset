import React, { useState } from 'react';
import type { BasemapStyleDefinition } from '../constants/basemaps';

interface Props {
  currentId: string;
  presets: BasemapStyleDefinition[];
  onChange: (id: string) => void;
}

const BasemapSwitcher: React.FC<Props> = ({ currentId, presets, onChange }) => {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'absolute', bottom: 30, right: 10, zIndex: 12, fontFamily: 'system-ui, sans-serif' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Switch basemap"
        style={{
          display: 'block',
          width: 34,
          height: 34,
          borderRadius: 4,
          border: '1px solid rgba(0,0,0,0.15)',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 16,
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          lineHeight: '34px',
          textAlign: 'center',
          padding: 0,
        }}
      >
        🗺
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            right: 0,
            background: '#fff',
            borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            padding: '6px 0',
            minWidth: 140,
          }}
        >
          {presets.map(p => (
            <button
              key={p.id}
              onClick={() => { onChange(p.id); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '7px 14px',
                border: 'none',
                background: p.id === currentId ? '#f0f4ff' : 'transparent',
                fontWeight: p.id === currentId ? 600 : 400,
                color: p.id === currentId ? '#4e79a7' : '#333',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default BasemapSwitcher;
