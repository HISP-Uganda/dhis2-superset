import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';

interface Props {
  geojson: GeoJSON.FeatureCollection;
  labelCol: string;
  onSelect: (feature: GeoJSON.Feature) => void;
}

const MAX_RESULTS = 8;

const SearchBar: React.FC<Props> = ({ geojson, labelCol, onSelect }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim() || !labelCol) return [];
    const q = query.toLowerCase();
    return geojson.features
      .filter(f => {
        const label = String((f.properties ?? {})[labelCol] ?? '');
        return label.toLowerCase().includes(q);
      })
      .slice(0, MAX_RESULTS);
  }, [query, geojson, labelCol]);

  const handleSelect = useCallback((feat: GeoJSON.Feature) => {
    setQuery(String((feat.properties ?? {})[labelCol] ?? ''));
    setOpen(false);
    onSelect(feat);
  }, [onSelect, labelCol]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!labelCol) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 10,
        left: 52,
        zIndex: 13,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        placeholder="Search features..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        style={{
          width: 200,
          padding: '6px 10px',
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 6,
          outline: 'none',
          background: 'rgba(255,255,255,0.95)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          fontSize: 12,
        }}
      />
      {open && results.length > 0 && (
        <div
          style={{
            marginTop: 2,
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxHeight: 220,
            overflow: 'auto',
          }}
        >
          {results.map((feat, i) => {
            const label = String((feat.properties ?? {})[labelCol] ?? '');
            return (
              <div
                key={i}
                onClick={() => handleSelect(feat)}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  borderBottom: i < results.length - 1 ? '1px solid #f0f0f0' : 'none',
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = '#f0f4ff'; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = '#fff'; }}
              >
                {label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
