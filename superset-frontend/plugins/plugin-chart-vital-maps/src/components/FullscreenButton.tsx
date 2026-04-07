import React, { useState, useEffect, useCallback } from 'react';

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const FullscreenButton: React.FC<Props> = ({ containerRef }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (!isFullscreen) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, [isFullscreen, containerRef]);

  return (
    <button
      onClick={toggle}
      title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      style={{
        position: 'absolute',
        top: 10,
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
        fontSize: 16,
        color: '#444',
        lineHeight: 1,
        padding: 0,
      }}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
    >
      {isFullscreen ? '\u2716' : '\u26F6'}
    </button>
  );
};

export default FullscreenButton;
