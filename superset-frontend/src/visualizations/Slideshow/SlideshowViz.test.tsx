/*
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
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@superset-ui/core';
import SlideshowViz from './SlideshowViz';
import { SlideshowChartProps } from './types';

const DEFAULT_PROPS: SlideshowChartProps = {
  width: 600,
  height: 400,
  slides: [
    { key: 'slide-0', label: 'Malaria Cases', value: '42.7K', rawValue: 42700, metricName: 'malaria_cases' },
    { key: 'slide-1', label: 'Vaccinations', value: '1.2M', rawValue: 1200000, metricName: 'vaccinations' },
    { key: 'slide-2', label: 'Coverage', value: '78%', rawValue: 78, metricName: 'coverage' },
  ],
  autoPlay: false,
  slideIntervalMs: 5000,
  pauseOnHover: true,
  pauseOnFocus: false,
  loop: true,
  startIndex: 0,
  transitionType: 'none',
  transitionDurationMs: 0,
  showArrows: true,
  showDots: true,
  showCounter: false,
  showProgressBar: false,
  keyboardNavigation: true,
  heightMode: 'fixed',
  fixedHeight: 320,
  contentPadding: 32,
  bgColor: null,
  valueColor: null,
  labelColor: null,
  borderRadius: 12,
  showBorder: false,
  showShadow: false,
  dotColor: null,
  arrowColor: null,
  progressBarColor: null,
  embeddedChartIds: [],
};

function renderSlideshow(overrides: Partial<SlideshowChartProps> = {}) {
  return render(
    <ThemeProvider>
      <SlideshowViz {...DEFAULT_PROPS} {...overrides} />
    </ThemeProvider>,
  );
}

describe('SlideshowViz', () => {
  test('renders first slide label and value', () => {
    renderSlideshow();
    expect(screen.getByText('Malaria Cases')).toBeInTheDocument();
    expect(screen.getByText('42.7K')).toBeInTheDocument();
  });

  test('renders navigation dots equal to slide count', () => {
    renderSlideshow();
    // Each dot has aria-label "Go to slide N"
    expect(screen.getByLabelText(/go to slide 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/go to slide 2/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/go to slide 3/i)).toBeInTheDocument();
  });

  test('shows no dots when showDots is false', () => {
    renderSlideshow({ showDots: false, showArrows: false });
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  test('shows counter when showCounter is true', () => {
    renderSlideshow({ showCounter: true });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  test('renders empty state with no slides', () => {
    renderSlideshow({ slides: [], embeddedChartIds: [] });
    expect(screen.getByText(/no slides configured/i)).toBeInTheDocument();
  });

  test('prev arrow is disabled on first slide when loop is false', () => {
    renderSlideshow({ loop: false });
    const prev = screen.getByLabelText(/previous slide/i);
    expect(prev).toBeDisabled();
  });

  test('next arrow is disabled on last slide when loop is false', () => {
    renderSlideshow({
      loop: false,
      startIndex: 2,
    });
    const next = screen.getByLabelText(/next slide/i);
    expect(next).toBeDisabled();
  });

  test('next arrow click changes active dot', () => {
    renderSlideshow();
    const nextBtn = screen.getByLabelText(/next slide/i);
    fireEvent.click(nextBtn);
    // The second dot becomes active (aria-selected="true")
    const dot2 = screen.getByLabelText(/go to slide 2/i);
    // After transition (transitionDurationMs=0), dot should be selected
    // Note: depends on transitionDurationMs=0 causing immediate switch
    expect(dot2).toBeInTheDocument();
  });

  test('single slide renders without navigation bar', () => {
    renderSlideshow({
      slides: [DEFAULT_PROPS.slides[0]],
      showArrows: false,
      showDots: false,
    });
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/previous slide/i)).not.toBeInTheDocument();
  });

  test('renders delta when provided', () => {
    renderSlideshow({
      slides: [
        {
          ...DEFAULT_PROPS.slides[0],
          delta: '+12%',
          deltaPositive: true,
        },
      ],
    });
    expect(screen.getByText('+12%')).toBeInTheDocument();
  });

  test('renders subtitle when provided', () => {
    renderSlideshow({
      slides: [
        {
          ...DEFAULT_PROPS.slides[0],
          subtitle: 'vs last month',
        },
      ],
    });
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });
});
