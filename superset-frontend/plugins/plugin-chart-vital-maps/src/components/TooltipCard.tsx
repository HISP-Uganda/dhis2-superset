import React from 'react';
import type { TooltipPayload } from '../plugin/types';

interface Props {
  payload: TooltipPayload | null;
  x: number;
  y: number;
  pinned: boolean;
  containerWidth: number;
  containerHeight: number;
  onClose: () => void;
}

const TooltipCard: React.FC<Props> = ({ payload, x, y, pinned, containerWidth, containerHeight, onClose }) => {
  if (!payload) return null;
  const hasContent = payload.title || payload.metricLabel || payload.category || (payload.fields && payload.fields.length > 0);
  if (!hasContent) return null;

  const CARD_W = 220;
  const CARD_H = 120;
  const left = Math.min(x + 12, containerWidth - CARD_W - 10);
  const top = y > containerHeight / 2 ? Math.max(y - CARD_H - 12, 10) : y + 12;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: CARD_W,
        background: 'rgba(255,255,255,0.97)',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        padding: '10px 12px',
        zIndex: 20,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        pointerEvents: pinned ? 'auto' : 'none',
        border: pinned ? '1.5px solid #4e79a7' : '1px solid rgba(0,0,0,0.08)',
      }}
    >
      {pinned && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 4,
            right: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            color: '#999',
            lineHeight: 1,
            padding: 0,
          }}
          aria-label="Close"
        >
          ×
        </button>
      )}
      {payload.title && (
        <div style={{ fontWeight: 700, fontSize: 13, color: '#222', marginBottom: 4, paddingRight: pinned ? 14 : 0 }}>
          {payload.title}
        </div>
      )}
      {payload.subtitle && (
        <div style={{ color: '#666', marginBottom: 4 }}>{payload.subtitle}</div>
      )}
      {payload.metricLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ color: '#666' }}>{payload.metricLabel}</span>
          <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{payload.metricValue}</span>
        </div>
      )}
      {/* Color bar with percentage */}
      {payload.color && payload.percentage && (
        <div style={{ marginBottom: 4 }}>
          <div style={{
            height: 6,
            borderRadius: 3,
            background: '#eee',
            overflow: 'hidden',
            marginBottom: 2,
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(parseFloat(payload.percentage) || 0, 100)}%`,
              background: payload.color,
              borderRadius: 3,
              transition: 'width 0.2s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888' }}>
            <span>{payload.percentage} of total</span>
            {payload.rank && <span>Rank: {payload.rank}</span>}
          </div>
        </div>
      )}
      {payload.category && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ color: '#666' }}>Category</span>
          <span style={{ color: '#444' }}>{payload.category}</span>
        </div>
      )}
      {payload.fields?.map((f, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ color: '#888', marginRight: 8 }}>{f.label}</span>
          <span style={{ color: '#444', textAlign: 'right' }}>{String(f.value ?? '\u2014')}</span>
        </div>
      ))}
    </div>
  );
};

export default TooltipCard;
