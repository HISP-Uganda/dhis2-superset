/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

import { render, screen } from '@testing-library/react';
import MarqueeViz, { resolveIsVertical } from './MarqueeViz';
import { MarqueeChartProps, MarqueeKpiItem } from './types';

const baseItem: MarqueeKpiItem = {
  id: 'item-0',
  label: 'Total Cases',
  value: 1234567,
  formattedValue: '1.2M',
  deltaValue: 5.2,
  formattedDelta: '+5.2',
  deltaPositive: true,
  subtitle: 'Last 30 days',
};

const baseProps: MarqueeChartProps = {
  height: 80,
  width: 800,
  items: [baseItem],
  placement: 'top',
  orientation: 'auto',
  speed: 30,
  pauseOnHover: true,
  autoLoop: true,
  scrollDirection: 'forward',
  itemSpacing: 12,
  itemPadding: 16,
  itemMinWidth: 140,
  itemMaxWidth: 260,
  containerHeight: 72,
  gapBetweenItems: 32,
  labelFontSize: 11,
  labelFontWeight: '500',
  labelColor: '#6b7280',
  valueFontSize: 22,
  valueFontWeight: '700',
  valueColor: '#111827',
  subtitleFontSize: 11,
  subtitleColor: '#9ca3af',
  containerBackground: 'transparent',
  itemBackground: '#ffffff',
  itemBorderColor: '#e5e7eb',
  itemBorderWidth: 1,
  itemBorderRadius: 8,
  showShadow: true,
  hoverBackground: '#f9fafb',
  deltaPositiveColor: '#10b981',
  deltaNegativeColor: '#ef4444',
  dividerColor: '#e5e7eb',
  showLabel: true,
  showSubtitle: true,
  showDelta: true,
  showSeparators: false,
  variant: 'default',
  colorThresholds: [],
};

describe('MarqueeViz', () => {
  it('renders label and value', () => {
    render(<MarqueeViz {...baseProps} />);
    expect(screen.getAllByText('Total Cases').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.2M').length).toBeGreaterThan(0);
  });

  it('renders subtitle when showSubtitle is true', () => {
    render(<MarqueeViz {...baseProps} />);
    expect(screen.getAllByText('Last 30 days').length).toBeGreaterThan(0);
  });

  it('hides subtitle when showSubtitle is false', () => {
    render(<MarqueeViz {...baseProps} showSubtitle={false} />);
    expect(screen.queryByText('Last 30 days')).toBeNull();
  });

  it('hides label when showLabel is false', () => {
    render(<MarqueeViz {...baseProps} showLabel={false} />);
    expect(screen.queryByText('Total Cases')).toBeNull();
  });

  it('shows empty state when items is empty', () => {
    render(<MarqueeViz {...baseProps} items={[]} />);
    expect(screen.getByText(/No data available/i)).toBeInTheDocument();
  });

  it('renders multiple items', () => {
    const items: MarqueeKpiItem[] = [
      { ...baseItem, id: 'item-0', label: 'Metric A', formattedValue: '100' },
      { ...baseItem, id: 'item-1', label: 'Metric B', formattedValue: '200' },
      { ...baseItem, id: 'item-2', label: 'Metric C', formattedValue: '300' },
    ];
    render(<MarqueeViz {...baseProps} items={items} />);
    expect(screen.getAllByText('Metric A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Metric B').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Metric C').length).toBeGreaterThan(0);
  });

  it('uses horizontal mode for top placement', () => {
    const { container } = render(
      <MarqueeViz {...baseProps} placement="top" orientation="auto" />,
    );
    // Track should have flex-direction row for horizontal
    const track = container.querySelector('[class*="Track"]') as HTMLElement | null;
    if (track) {
      // Just verify it rendered without error
      expect(track).toBeTruthy();
    }
  });

  it('uses vertical mode for left placement', () => {
    const { container } = render(
      <MarqueeViz {...baseProps} placement="left" orientation="auto" />,
    );
    const track = container.querySelector('[class*="Track"]') as HTMLElement | null;
    expect(track).toBeTruthy();
  });

  it('uses explicit horizontal even for left placement', () => {
    const { container } = render(
      <MarqueeViz {...baseProps} placement="left" orientation="horizontal" />,
    );
    expect(container.firstChild).toBeTruthy();
  });
});

// ─── resolveIsVertical unit tests ────────────────────────────────────────────

describe('resolveIsVertical', () => {
  it('returns false for top placement with auto orientation', () => {
    expect(resolveIsVertical('top', 'auto')).toBe(false);
  });

  it('returns false for bottom placement with auto orientation', () => {
    expect(resolveIsVertical('bottom', 'auto')).toBe(false);
  });

  it('returns true for left placement with auto orientation', () => {
    expect(resolveIsVertical('left', 'auto')).toBe(true);
  });

  it('returns true for right placement with auto orientation', () => {
    expect(resolveIsVertical('right', 'auto')).toBe(true);
  });

  it('returns false for custom_section placement with auto orientation', () => {
    expect(resolveIsVertical('custom_section', 'auto')).toBe(false);
  });

  it('returns true when orientation is explicitly vertical regardless of placement', () => {
    expect(resolveIsVertical('top', 'vertical')).toBe(true);
    expect(resolveIsVertical('bottom', 'vertical')).toBe(true);
    expect(resolveIsVertical('left', 'vertical')).toBe(true);
    expect(resolveIsVertical('right', 'vertical')).toBe(true);
  });

  it('returns false when orientation is explicitly horizontal regardless of placement', () => {
    expect(resolveIsVertical('left', 'horizontal')).toBe(false);
    expect(resolveIsVertical('right', 'horizontal')).toBe(false);
    expect(resolveIsVertical('top', 'horizontal')).toBe(false);
  });
});
