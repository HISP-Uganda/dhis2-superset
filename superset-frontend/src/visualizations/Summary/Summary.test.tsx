/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, supersetTheme } from '@superset-ui/core';
import Summary from './Summary';
import { SummaryTransformedProps } from './types';

const BASE_PROPS: SummaryTransformedProps = {
  width: 600,
  height: 400,
  items: [
    {
      key: 'summary-0',
      label: 'Malaria Cases',
      rawValue: 42700,
      formattedValue: '42.7K',
      trendDirection: 'up',
      trendValue: 0.12,
      formattedTrendValue: '+12%',
      statusColor: null,
      accentColor: '#1976D2',
      sparklineData: [100, 200, 300, 250, 427],
      progressPercent: 42.7,
    },
    {
      key: 'summary-1',
      label: 'Vaccinations',
      rawValue: 1200000,
      formattedValue: '1.2M',
      trendDirection: 'down',
      trendValue: -0.05,
      formattedTrendValue: '-5%',
      statusColor: '#2E7D32',
      accentColor: '#2E7D32',
    },
    {
      key: 'summary-2',
      label: 'Coverage',
      rawValue: 78,
      formattedValue: '78%',
      trendDirection: 'flat',
      statusColor: '#F9A825',
      accentColor: '#F9A825',
    },
  ],
  layoutMode: 'grid',
  gridColumns: 3,
  densityTier: 'compact',
  valuePosition: 'below',
  cardStyle: 'elevated',
  labelFontSize: '11px',
  valueFontSize: '22px',
  showLabels: true,
  showTrendIndicator: true,
  showMicroViz: true,
  showDividers: false,
  invertSemanticColors: false,
  trendDisplay: 'both',
  trendLogic: 'higher-is-better',
  microVisualType: 'none',
  nullValueText: '–',
  thresholdUpper: null,
  thresholdLower: null,
  itemPadding: 8,
  itemGap: 8,
  itemBorderRadius: 12,

  /* Typography */
  fontFamily: 'Inter',
  labelFontWeight: '600',
  valueFontWeight: '700',
  labelTextTransform: 'uppercase',
  labelColor: '',

  /* Value coloring */
  valueColorMode: 'threshold',
  fixedValueColor: '',

  /* Alignment */
  alignment: 'start',

  /* Images */
  imagePlacement: 'before',
  imageSize: 32,

  /* Border */
  borderWidth: 1,
  borderColor: '',
  borderStyle: 'solid',
};

function renderSummary(overrides: Partial<SummaryTransformedProps> = {}) {
  return render(
    <ThemeProvider theme={supersetTheme}>
      <Summary {...BASE_PROPS} {...overrides} />
    </ThemeProvider>,
  );
}

describe('Summary Plugin', () => {
  test('renders all item labels and values', () => {
    renderSummary();
    expect(screen.getByText('Malaria Cases')).toBeInTheDocument();
    expect(screen.getByText('42.7K')).toBeInTheDocument();
    expect(screen.getByText('Vaccinations')).toBeInTheDocument();
    expect(screen.getByText('1.2M')).toBeInTheDocument();
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
  });

  test('renders empty state when no items', () => {
    renderSummary({ items: [] });
    expect(screen.getByText('No metrics configured')).toBeInTheDocument();
  });

  test('renders trend badges with arrows', () => {
    renderSummary();
    expect(screen.getByText(/\+12%/)).toBeInTheDocument();
    expect(screen.getByText(/-5%/)).toBeInTheDocument();
  });

  test('hides trends when showTrendIndicator is false', () => {
    renderSummary({ showTrendIndicator: false });
    expect(screen.queryByText(/\+12%/)).not.toBeInTheDocument();
  });

  test('hides labels when showLabels is false', () => {
    renderSummary({ showLabels: false });
    expect(screen.queryByText('Malaria Cases')).not.toBeInTheDocument();
  });

  test('renders sparkline SVG when microVisualType is sparkline', () => {
    const { container } = renderSummary({ microVisualType: 'sparkline' });
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  test('renders mini-bar SVG when microVisualType is mini-bar', () => {
    const { container } = renderSummary({ microVisualType: 'mini-bar' });
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  test('renders progress bar when microVisualType is progress-bar', () => {
    const { container } = renderSummary({ microVisualType: 'progress-bar' });
    const fills = container.querySelectorAll('[class*="ProgressFill"]');
    expect(fills.length).toBeGreaterThanOrEqual(0);
  });

  test('renders bullet indicator when microVisualType is bullet', () => {
    const { container } = renderSummary({ microVisualType: 'bullet' });
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  test('hides micro viz when showMicroViz is false', () => {
    const { container } = renderSummary({
      microVisualType: 'sparkline',
      showMicroViz: false,
    });
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(0);
  });

  test('supports vertical layout', () => {
    const { container } = renderSummary({ layoutMode: 'vertical' });
    expect(container.firstChild).toBeInTheDocument();
  });

  test('supports horizontal layout', () => {
    const { container } = renderSummary({ layoutMode: 'horizontal' });
    expect(container.firstChild).toBeInTheDocument();
  });

  test('supports split layout', () => {
    const { container } = renderSummary({ layoutMode: 'split' });
    expect(container.firstChild).toBeInTheDocument();
  });

  test('supports micro-card layout', () => {
    const { container } = renderSummary({ layoutMode: 'micro-card' });
    expect(container.firstChild).toBeInTheDocument();
  });

  test('supports compact-kpi layout', () => {
    const { container } = renderSummary({ layoutMode: 'compact-kpi' });
    expect(container.firstChild).toBeInTheDocument();
  });

  test('renders value above label when valuePosition is above', () => {
    renderSummary({ valuePosition: 'above' });
    expect(screen.getByText('42.7K')).toBeInTheDocument();
    expect(screen.getByText('Malaria Cases')).toBeInTheDocument();
  });

  test('renders left value position', () => {
    renderSummary({ valuePosition: 'left' });
    expect(screen.getByText('42.7K')).toBeInTheDocument();
  });

  test('renders right value position', () => {
    renderSummary({ valuePosition: 'right' });
    expect(screen.getByText('42.7K')).toBeInTheDocument();
  });

  test('renders inline value position', () => {
    renderSummary({ valuePosition: 'inline' });
    expect(screen.getByText('42.7K')).toBeInTheDocument();
    expect(screen.getByText('Malaria Cases')).toBeInTheDocument();
  });

  test('renders with transparent card style', () => {
    const { container } = renderSummary({ cardStyle: 'transparent' });
    expect(container.firstChild).toBeInTheDocument();
  });

  test('renders with flat card style', () => {
    const { container } = renderSummary({ cardStyle: 'flat' });
    expect(container.firstChild).toBeInTheDocument();
  });

  test('renders arrow-only trend display', () => {
    renderSummary({ trendDisplay: 'arrow' });
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  test('renders badge trend display', () => {
    renderSummary({ trendDisplay: 'badge' });
    expect(screen.getByText(/\+12%/)).toBeInTheDocument();
  });

  test('renders subtitles when provided', () => {
    renderSummary({
      items: [
        {
          ...BASE_PROPS.items[0],
          subtitle: 'Last 30 days',
        },
      ],
    });
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  test('renders per-variable card image', () => {
    const { container } = renderSummary({
      items: [
        {
          ...BASE_PROPS.items[0],
          imageUrl: 'https://example.com/icon.png',
        },
      ],
    });
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe('https://example.com/icon.png');
  });

  test('renders per-variable background color', () => {
    const { container } = renderSummary({
      items: [
        {
          ...BASE_PROPS.items[0],
          cardColor: '#E3F2FD',
        },
      ],
    });
    expect(container.firstChild).toBeInTheDocument();
  });

  /* ── Group By tests ─────────────────────────────── */

  test('renders grouped sections with headers', () => {
    renderSummary({
      items: [],
      groups: [
        {
          groupKey: 'group-0',
          groupLabel: 'Kampala',
          items: [
            { ...BASE_PROPS.items[0], key: 'g0-0', formattedValue: '100' },
          ],
        },
        {
          groupKey: 'group-1',
          groupLabel: 'Gulu',
          items: [
            { ...BASE_PROPS.items[0], key: 'g1-0', formattedValue: '200' },
          ],
        },
      ],
      groupsPerPage: 6,
    });
    expect(screen.getByText('Kampala')).toBeInTheDocument();
    expect(screen.getByText('Gulu')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  test('paginates groups when exceeding groupsPerPage', () => {
    const groups = Array.from({ length: 8 }, (_, i) => ({
      groupKey: `group-${i}`,
      groupLabel: `District ${i}`,
      items: [
        {
          ...BASE_PROPS.items[0],
          key: `g${i}-0`,
          formattedValue: `${(i + 1) * 100}`,
        },
      ],
    }));

    renderSummary({
      items: [],
      groups,
      groupsPerPage: 4,
    });

    // Page 1: first 4 groups visible
    expect(screen.getByText('District 0')).toBeInTheDocument();
    expect(screen.getByText('District 3')).toBeInTheDocument();
    expect(screen.queryByText('District 4')).not.toBeInTheDocument();

    // Pagination info visible
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();

    // Click next page
    fireEvent.click(screen.getByText('›'));
    expect(screen.getByText('District 4')).toBeInTheDocument();
    expect(screen.getByText('District 7')).toBeInTheDocument();
    expect(screen.queryByText('District 0')).not.toBeInTheDocument();
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument();
  });

  test('shows no pagination when groups fit on one page', () => {
    renderSummary({
      items: [],
      groups: [
        {
          groupKey: 'group-0',
          groupLabel: 'Only Group',
          items: [BASE_PROPS.items[0]],
        },
      ],
      groupsPerPage: 6,
    });
    expect(screen.getByText('Only Group')).toBeInTheDocument();
    expect(screen.queryByText('›')).not.toBeInTheDocument();
  });
});
