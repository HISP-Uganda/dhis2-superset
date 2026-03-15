import React from 'react';

interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

const BTN: React.CSSProperties = {
  display: 'block',
  width: 34,
  height: 34,
  background: '#fff',
  border: '1px solid rgba(0,0,0,0.15)',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: '32px',
  textAlign: 'center',
  color: '#444',
  padding: 0,
  fontWeight: 300,
};

const ZoomControls: React.FC<Props> = ({ onZoomIn, onZoomOut }) => (
  <div
    style={{
      position: 'absolute',
      top: 10,
      right: 10,
      zIndex: 12,
      borderRadius: 4,
      overflow: 'hidden',
      boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
    }}
  >
    <button style={{ ...BTN, borderBottom: '1px solid rgba(0,0,0,0.1)' }} onClick={onZoomIn} title="Zoom in">+</button>
    <button style={BTN} onClick={onZoomOut} title="Zoom out">−</button>
  </div>
);

export default ZoomControls;
