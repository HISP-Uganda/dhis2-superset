import React from 'react';
import type { LegendModel, LegendPosition } from '../plugin/types';

interface Props {
  legend: LegendModel | null;
  position: LegendPosition;
  visible: boolean;
  hiddenItems?: Set<number>;
  onToggleItem?: (index: number) => void;
}

const POSITION_STYLE: Record<LegendPosition, React.CSSProperties> = {
  'top-left': { top: 10, left: 10 },
  'top-right': { top: 10, right: 10 },
  'bottom-left': { bottom: 30, left: 10 },
  'bottom-right': { bottom: 30, right: 10 },
};

const LegendPanel: React.FC<Props> = ({ legend, position, visible, hiddenItems, onToggleItem }) => {
  if (!visible || !legend || legend.items.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        ...POSITION_STYLE[position],
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        padding: '10px 14px',
        minWidth: 140,
        maxWidth: 220,
        zIndex: 10,
        fontSize: 12,
        fontFamily: 'system-ui, sans-serif',
        pointerEvents: onToggleItem ? 'auto' : 'none',
      }}
    >
      {legend.title && (
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {legend.title}
        </div>
      )}
      {legend.items.map((item, i) => {
        const isHidden = hiddenItems?.has(i) ?? false;
        return (
          <div
            key={i}
            onClick={onToggleItem ? () => onToggleItem(i) : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 4,
              cursor: onToggleItem ? 'pointer' : 'default',
              opacity: isHidden ? 0.35 : 1,
              transition: 'opacity 0.15s ease',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 16,
                height: 14,
                borderRadius: legend.type === 'categorical' ? '50%' : 3,
                background: isHidden ? '#ddd' : item.color,
                marginRight: 8,
                flexShrink: 0,
                border: item.isNoData ? '1px solid #ccc' : 'none',
              }}
            />
            <span style={{
              color: item.isNoData ? '#999' : '#222',
              lineHeight: 1.3,
              textDecoration: isHidden ? 'line-through' : 'none',
            }}>
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default LegendPanel;
