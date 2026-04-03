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
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { styled, useTheme, t } from '@superset-ui/core';
import { SlideshowChartProps, SlideshowSlide, TransitionType } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

/* eslint-disable theme-colors/no-literal-colors */
const Wrapper = styled.div<{
  $height: number;
  $bgColor: string | null;
  $borderRadius: number;
  $showBorder: boolean;
  $showShadow: boolean;
  $borderColor: string;
}>`
  position: relative;
  width: 100%;
  height: ${({ $height }) => $height}px;
  background: ${({ $bgColor }) => $bgColor ?? 'var(--pro-bg-card)'};
  border-radius: ${({ $borderRadius }) => $borderRadius}px;
  border: ${({ $showBorder, $borderColor }) =>
    $showBorder ? `1px solid ${$borderColor}` : 'none'};
  box-shadow: ${({ $showShadow }) =>
    $showShadow ? 'var(--pro-shadow-md, 0 4px 20px rgba(0,0,0,0.08))' : 'none'};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  outline: none;
  user-select: none;
  font-family: var(--pro-font-family, 'Inter', 'Segoe UI', Roboto, sans-serif);
`;

const SlideViewport = styled.div`
  position: relative;
  flex: 1;
  overflow: hidden;
`;

interface SlideProps {
  $active: boolean;
  $entering: boolean;
  $exiting: boolean;
  $transitionType: TransitionType;
  $durationMs: number;
  $direction: 1 | -1;
}

function getSlideTransform(
  type: TransitionType,
  phase: 'enter-from' | 'exit-to',
  direction: 1 | -1,
): string {
  const sign = direction === 1 ? '' : '-';
  if (type === 'slide-horizontal') {
    return phase === 'enter-from'
      ? `translateX(${sign}100%)`
      : `translateX(-${sign}100%)`;
  }
  if (type === 'slide-vertical') {
    return phase === 'enter-from'
      ? `translateY(${sign}100%)`
      : `translateY(-${sign}100%)`;
  }
  return 'none';
}

const SlideContainer = styled.div<SlideProps>`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: ${({ $transitionType, $durationMs }) =>
    $transitionType === 'none'
      ? 'none'
      : `opacity ${$durationMs}ms ease, transform ${$durationMs}ms cubic-bezier(0.4,0,0.2,1)`};

  /* Entering slide */
  ${({ $entering, $transitionType, $direction, $durationMs }) =>
    $entering &&
    `
    opacity: 0;
    transform: ${getSlideTransform($transitionType, 'enter-from', $direction)};
    animation: none;
  `}

  /* Active slide */
  ${({ $active, $entering }) =>
    $active &&
    !$entering &&
    `
    opacity: 1;
    transform: none;
  `}

  /* Exiting slide */
  ${({ $exiting, $transitionType, $direction, $durationMs }) =>
    $exiting &&
    `
    opacity: 0;
    transform: ${getSlideTransform($transitionType, 'exit-to', $direction)};
  `}

  /* Hidden (not current, not transitioning) */
  ${({ $active, $entering, $exiting }) =>
    !$active &&
    !$entering &&
    !$exiting &&
    `
    opacity: 0;
    pointer-events: none;
  `}
`;

const MetricSlide = styled.div<{
  $padding: number;
  $valueColor: string | null;
  $labelColor: string | null;
  $statusColor: string | null;
}>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: ${({ $padding }) => $padding}px;
  width: 100%;
  height: 100%;
  gap: 10px;

  .slide-label {
    font-size: 12px;
    font-weight: 600;
    color: ${({ $labelColor }) => $labelColor ?? 'var(--pro-text-muted)'};
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .slide-value {
    font-size: clamp(2rem, 8vw, 4.5rem);
    font-weight: 700;
    line-height: 1;
    color: ${({ $statusColor, $valueColor }) =>
      $statusColor ?? $valueColor ?? 'var(--pro-text-primary)'};
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }

  .slide-delta {
    font-size: 14px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 6px;
    &.positive {
      color: var(--pro-success);
      background: rgba(46, 125, 50, 0.08);
    }
    &.negative {
      color: var(--pro-error);
      background: rgba(211, 47, 47, 0.08);
    }
  }

  .slide-subtitle {
    font-size: 13px;
    color: var(--pro-text-muted);
  }
`;

const EmbedSlide = styled.div<{ $padding: number }>`
  width: 100%;
  height: 100%;
  padding: ${({ $padding }) => $padding}px;
  display: flex;
  align-items: center;
  justify-content: center;

  iframe {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 4px;
  }
`;

const EmbedErrorSlide = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: 14px;
`;

// Navigation controls
const ControlsBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  flex-shrink: 0;
  min-height: 40px;
  border-top: 1px solid var(--pro-border);
`;

const DotsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
`;

const Dot = styled.button<{
  $active: boolean;
  $dotColor: string | null;
  $activeDotColor: string;
}>`
  width: ${({ $active }) => ($active ? 24 : 8)}px;
  height: 8px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: width 0.3s ease, background 0.3s ease;
  background: ${({ $active, $dotColor, $activeDotColor }) =>
    $active ? ($dotColor ?? $activeDotColor) : 'var(--pro-border)'};
  &:focus-visible {
    outline: 2px solid var(--pro-accent);
    outline-offset: 2px;
  }
`;

const ArrowButton = styled.button<{ $arrowColor: string | null }>`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--pro-border);
  cursor: pointer;
  background: var(--pro-bg-card);
  color: ${({ $arrowColor }) => $arrowColor ?? 'var(--pro-text-primary)'};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  transition: background 0.15s ease, box-shadow 0.15s ease;
  flex-shrink: 0;
  &:hover {
    background: var(--pro-bg-canvas);
    box-shadow: var(--pro-shadow-sm, 0 1px 3px rgba(0,0,0,0.06));
  }
  &:focus-visible {
    outline: 2px solid var(--pro-accent);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
`;

const Counter = styled.span`
  font-size: 11px;
  font-weight: 500;
  color: var(--pro-text-muted);
  min-width: 48px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
`;

// Progress bar
const ProgressBarTrack = styled.div<{ $color: string | null }>`
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  width: 100%;
  background: rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
`;

const ProgressBarFill = styled.div<{
  $color: string | null;
  $duration: number;
  $active: boolean;
}>`
  height: 100%;
  background: ${({ $color }) => $color ?? 'var(--pro-accent)'};
  width: ${({ $active }) => ($active ? '100%' : '0%')};
  transition: ${({ $active, $duration }) =>
    $active ? `width ${$duration}ms linear` : 'none'};
`;

// ---------------------------------------------------------------------------
// Embedded iframe slide
// ---------------------------------------------------------------------------

function EmbedSlideContent({
  chartId,
  padding,
}: {
  chartId: number;
  padding: number;
}) {
  const [error, setError] = useState(false);
  const url = `/explore/?standalone=2&slice_id=${chartId}`;

  if (error) {
    return (
      <EmbedErrorSlide>
        <span style={{ fontSize: 32 }}>⚠</span>
        <span>{t('Chart unavailable')}</span>
        <span style={{ fontSize: 12 }}>{t('ID: %s', String(chartId))}</span>
      </EmbedErrorSlide>
    );
  }

  return (
    <EmbedSlide $padding={padding}>
      <iframe
        src={url}
        title={t('Chart %s', String(chartId))}
        onError={() => setError(true)}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </EmbedSlide>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type SlideEntry =
  | { type: 'metric'; slide: SlideshowSlide }
  | { type: 'embed'; chartId: number };

const SlideshowViz: React.FC<SlideshowChartProps> = ({
  width,
  height,
  slides,
  autoPlay,
  slideIntervalMs,
  pauseOnHover,
  pauseOnFocus,
  loop,
  startIndex,
  transitionType,
  transitionDurationMs,
  showArrows,
  showDots,
  showCounter,
  showProgressBar,
  keyboardNavigation,
  heightMode,
  fixedHeight,
  contentPadding,
  bgColor,
  valueColor,
  labelColor,
  borderRadius,
  showBorder,
  showShadow,
  dotColor,
  arrowColor,
  progressBarColor,
  embeddedChartIds,
}) => {
  const theme = useTheme();

  // Build unified slide entries
  const entries = useMemo<SlideEntry[]>(() => {
    if (embeddedChartIds.length > 0) {
      return embeddedChartIds.map(id => ({ type: 'embed', chartId: id }));
    }
    return slides.map(s => ({ type: 'metric', slide: s }));
  }, [slides, embeddedChartIds]);

  const total = entries.length;
  const [activeIndex, setActiveIndex] = useState(
    clamp(startIndex, 0, Math.max(0, total - 1)),
  );
  const [transitionDirection, setTransitionDirection] = useState<1 | -1>(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [progressActive, setProgressActive] = useState(false);

  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const autoPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const containerHeight = heightMode === 'fixed' ? fixedHeight : height;
  const navHeight = showDots || showArrows || showCounter ? 44 : 0;
  const progressHeight = showProgressBar ? 3 : 0;
  const slideHeight = containerHeight - navHeight - progressHeight;

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const goTo = useCallback(
    (nextIndex: number, direction: 1 | -1 = 1) => {
      if (isTransitioning || total <= 1) return;
      const clamped = loop
        ? ((nextIndex % total) + total) % total
        : clamp(nextIndex, 0, total - 1);

      setTransitionDirection(direction);
      setIsTransitioning(true);
      setPendingIndex(clamped);

      setTimeout(() => {
        setActiveIndex(clamped);
        setIsTransitioning(false);
        setPendingIndex(null);
        // Reset progress bar
        setProgressActive(false);
        setTimeout(() => setProgressActive(true), 50);
      }, transitionDurationMs);
    },
    [isTransitioning, total, loop, transitionDurationMs],
  );

  const goNext = useCallback(() => {
    goTo(activeIndex + 1, 1);
  }, [activeIndex, goTo]);

  const goPrev = useCallback(() => {
    goTo(activeIndex - 1, -1);
  }, [activeIndex, goTo]);

  // ---------------------------------------------------------------------------
  // Auto-play
  // ---------------------------------------------------------------------------

  const scheduleNext = useCallback(() => {
    if (autoPlayTimerRef.current) clearTimeout(autoPlayTimerRef.current);
    if (!autoPlay || total <= 1) return;
    autoPlayTimerRef.current = setTimeout(() => {
      if (hoveredRef.current || focusedRef.current) {
        scheduleNext();
        return;
      }
      goNext();
    }, slideIntervalMs);
  }, [autoPlay, total, slideIntervalMs, goNext]);

  // Restart timer when activeIndex changes
  useEffect(() => {
    setProgressActive(false);
    const t = setTimeout(() => {
      setProgressActive(autoPlay && total > 1);
    }, 50);
    scheduleNext();
    return () => {
      clearTimeout(t);
      if (autoPlayTimerRef.current) clearTimeout(autoPlayTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, autoPlay, slideIntervalMs, total]);

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!keyboardNavigation) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (!wrapperRef.current?.contains(document.activeElement)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [keyboardNavigation, goNext, goPrev]);

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  if (total === 0) {
    return (
      <Wrapper
        $height={containerHeight}
        $bgColor={bgColor}
        $borderRadius={borderRadius}
        $showBorder={showBorder}
        $showShadow={showShadow}
        $borderColor={theme.colorBorderSecondary}
        style={{ alignItems: 'center', justifyContent: 'center' }}
      >
        <span style={{ color: theme.colorTextSecondary, fontSize: 14 }}>
          {t('No slides configured')}
        </span>
      </Wrapper>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canGoPrev = loop || activeIndex > 0;
  const canGoNext = loop || activeIndex < total - 1;

  return (
    <Wrapper
      ref={wrapperRef}
      $height={containerHeight}
      $bgColor={bgColor}
      $borderRadius={borderRadius}
      $showBorder={showBorder}
      $showShadow={showShadow}
      $borderColor={theme.colorBorderSecondary}
      tabIndex={keyboardNavigation ? 0 : -1}
      onMouseEnter={() => {
        hoveredRef.current = true;
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
      }}
      onFocus={() => {
        focusedRef.current = pauseOnFocus;
      }}
      onBlur={() => {
        focusedRef.current = false;
      }}
      aria-label={t('Slideshow')}
      aria-roledescription="carousel"
    >
      {/* Slides */}
      <SlideViewport style={{ height: slideHeight }}>
        {entries.map((entry, idx) => {
          const isActive = idx === activeIndex;
          const isEntering = idx === pendingIndex;
          const isExiting = isTransitioning && idx === activeIndex && !isEntering;

          return (
            <SlideContainer
              key={entry.type === 'embed' ? `embed-${entry.chartId}` : entry.slide.key}
              $active={isActive}
              $entering={isEntering}
              $exiting={isExiting}
              $transitionType={transitionType}
              $durationMs={transitionDurationMs}
              $direction={transitionDirection}
              aria-hidden={!isActive}
              role="group"
              aria-roledescription="slide"
              aria-label={t('Slide %s of %s', String(idx + 1), String(total))}
            >
              {entry.type === 'embed' ? (
                <EmbedSlideContent
                  chartId={entry.chartId}
                  padding={contentPadding}
                />
              ) : (
                <MetricSlide
                  $padding={contentPadding}
                  $valueColor={valueColor}
                  $labelColor={labelColor}
                  $statusColor={entry.slide.statusColor ?? null}
                >
                  <div className="slide-label">{entry.slide.label}</div>
                  <div className="slide-value">{entry.slide.value}</div>
                  {entry.slide.delta && (
                    <div
                      className={`slide-delta ${
                        entry.slide.deltaPositive ? 'positive' : 'negative'
                      }`}
                    >
                      {entry.slide.delta}
                    </div>
                  )}
                  {entry.slide.subtitle && (
                    <div className="slide-subtitle">{entry.slide.subtitle}</div>
                  )}
                </MetricSlide>
              )}
            </SlideContainer>
          );
        })}
      </SlideViewport>

      {/* Progress bar */}
      {showProgressBar && (
        <ProgressBarTrack $color={progressBarColor}>
          <ProgressBarFill
            $color={progressBarColor}
            $duration={slideIntervalMs}
            $active={progressActive && autoPlay && total > 1}
          />
        </ProgressBarTrack>
      )}

      {/* Navigation bar */}
      {(showDots || showArrows || showCounter) && (
        <ControlsBar>
          {/* Prev arrow */}
          {showArrows && (
            <ArrowButton
              $arrowColor={arrowColor}
              onClick={goPrev}
              disabled={!canGoPrev}
              aria-label={t('Previous slide')}
            >
              ‹
            </ArrowButton>
          )}

          {/* Dots */}
          {showDots && (
            <DotsContainer role="tablist" aria-label={t('Slides')}>
              {entries.map((entry, idx) => (
                <Dot
                  key={idx}
                  $active={idx === activeIndex}
                  $dotColor={dotColor}
                  $activeDotColor={theme.colorPrimary}
                  onClick={() => goTo(idx, idx > activeIndex ? 1 : -1)}
                  role="tab"
                  aria-selected={idx === activeIndex}
                  aria-label={t('Go to slide %s', String(idx + 1))}
                />
              ))}
            </DotsContainer>
          )}

          {/* Counter */}
          {showCounter && (
            <Counter aria-live="polite">
              {activeIndex + 1} / {total}
            </Counter>
          )}

          {/* Next arrow */}
          {showArrows && (
            <ArrowButton
              $arrowColor={arrowColor}
              onClick={goNext}
              disabled={!canGoNext}
              aria-label={t('Next slide')}
            >
              ›
            </ArrowButton>
          )}
        </ControlsBar>
      )}
    </Wrapper>
  );
};

export default SlideshowViz;
