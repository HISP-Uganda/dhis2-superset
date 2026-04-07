import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'markdown-to-jsx';
// docx, pptxgenjs and file-saver are loaded dynamically inside their
// respective export functions to avoid pulling Node.js-only modules
// (node:fs, node:https) into the webpack browser bundle.
import {
  css,
  getClientErrorObject,
  styled,
  SupersetClient,
  t,
} from '@superset-ui/core';
import { Alert, Button, Input, Loading } from '@superset-ui/core/components';
import getBootstrapData from 'src/utils/getBootstrapData';
import { useToasts } from 'src/components/MessageToasts/withToasts';
import {
  fetchAICapabilities,
  requestAIInsight,
  requestAIInsightStream,
  createConversation,
  appendMessage,
  listConversations,
  getConversation,
} from './api';
import {
  AICapabilities,
  AIConversationMessage,
  AIConversationSummary,
  AIInsightMode,
  AIInsightResult,
  ChatMessage,
} from './types';

/* ── Styled components ───────────────────────────────── */
/* eslint-disable theme-colors/no-literal-colors */

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 420px;
  font-family: var(--pro-font-family, Inter, 'Segoe UI', Roboto, sans-serif);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pro-border, #E5EAF0);
  background: var(--pro-bg-card, #FAFBFC);
`;

const ProviderControls = styled.div`
  display: flex;
  gap: 8px;
  flex: 1;

  select {
    min-height: 32px;
    border: 1px solid var(--pro-border, #E5EAF0);
    border-radius: 6px;
    padding: 0 8px;
    background: #fff;
    font-size: 12px;
    color: #374151;
  }

  label {
    font-size: 11px;
    color: #6B7280;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
`;

const ChatArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const MessageBubble = styled.div<{ $isUser: boolean }>`
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  align-self: ${({ $isUser }) => ($isUser ? 'flex-end' : 'flex-start')};
  background: ${({ $isUser }) =>
    $isUser ? 'var(--pro-blue, #1976D2)' : 'var(--pro-bg-card, #F3F4F6)'};
  color: ${({ $isUser }) => ($isUser ? '#fff' : '#1F2937')};
  border: ${({ $isUser }) =>
    $isUser ? 'none' : '1px solid var(--pro-border, #E5EAF0)'};
  white-space: ${({ $isUser }) => ($isUser ? 'pre-wrap' : 'normal')};

  /* ── Markdown prose styling for assistant messages ── */
  ${({ $isUser }) =>
    !$isUser
      ? `
    h1, h2, h3, h4, h5, h6 {
      margin: 12px 0 6px;
      line-height: 1.3;
      font-weight: 700;
    }
    h1 { font-size: 18px; }
    h2 { font-size: 16px; }
    h3 { font-size: 14px; }
    h4, h5, h6 { font-size: 13px; }
    h1:first-of-type, h2:first-of-type, h3:first-of-type { margin-top: 0; }

    p { margin: 6px 0; }
    p:first-of-type { margin-top: 0; }
    p:last-child { margin-bottom: 0; }

    strong { font-weight: 700; color: #111827; }
    em { font-style: italic; }

    ul, ol {
      margin: 6px 0;
      padding-left: 20px;
    }
    li { margin: 3px 0; }
    li > p { margin: 2px 0; }

    blockquote {
      margin: 8px 0;
      padding: 4px 12px;
      border-left: 3px solid #1976D2;
      color: #4B5563;
      background: rgba(25, 118, 210, 0.04);
      border-radius: 0 6px 6px 0;
    }

    code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
      padding: 1px 5px;
      border-radius: 4px;
      background: #E5E7EB;
      color: #1E293B;
    }

    pre {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: #1E293B;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
      color: #E2E8F0;
      font-size: 12px;
    }

    table {
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 12px;
      width: 100%;
      table-layout: fixed;
      border: 1px solid #CBD5E1;
      border-radius: 6px;
      overflow: hidden;
    }
    th, td {
      border: 1px solid #D1D5DB;
      padding: 6px 10px;
      text-align: left;
      line-height: 1.4;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    th {
      background: #E2E8F0;
      font-weight: 700;
      color: #1E293B;
      white-space: normal;
    }
    tr:nth-of-type(even) td {
      background: #F8FAFC;
    }
    tr:hover td {
      background: #EFF6FF;
    }

    hr {
      border: none;
      border-top: 1px solid #E5EAF0;
      margin: 10px 0;
    }

    a {
      color: #1976D2;
      text-decoration: underline;
    }

    /* ── Health alert callout blocks ── */
    .alert-callout {
      margin: 8px 0;
      padding: 8px 12px;
      border-radius: 8px;
      border-left: 4px solid;
      font-size: 13px;
      line-height: 1.5;
    }
    .alert-callout p { margin: 2px 0; }
    .alert-callout strong { font-weight: 700; }
    .alert-callout .alert-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 4px;
      margin-right: 6px;
      vertical-align: middle;
    }

    .alert-critical {
      background: #FEF2F2;
      border-color: #DC2626;
      color: #991B1B;
    }
    .alert-critical .alert-badge {
      background: #DC2626;
      color: #fff;
    }

    .alert-warning {
      background: #FFFBEB;
      border-color: #F59E0B;
      color: #92400E;
    }
    .alert-warning .alert-badge {
      background: #F59E0B;
      color: #fff;
    }

    .alert-good {
      background: #F0FDF4;
      border-color: #16A34A;
      color: #166534;
    }
    .alert-good .alert-badge {
      background: #16A34A;
      color: #fff;
    }

    .alert-info {
      background: #EFF6FF;
      border-color: #3B82F6;
      color: #1E40AF;
    }
    .alert-info .alert-badge {
      background: #3B82F6;
      color: #fff;
    }
  `
      : ''}
`;

const TypingIndicator = styled.div`
  display: flex;
  gap: 4px;
  padding: 8px 14px;
  align-self: flex-start;

  span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #9CA3AF;
    animation: blink 1.4s infinite both;
  }
  span:nth-of-type(2) {
    animation-delay: 0.2s;
  }
  span:nth-of-type(3) {
    animation-delay: 0.4s;
  }

  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.3;
    }
    40% {
      opacity: 1;
    }
  }
`;

const InputArea = styled.div`
  border-top: 1px solid var(--pro-border, #E5EAF0);
  padding: 12px 16px;
  display: flex;
  gap: 8px;
  background: var(--pro-bg-card, #FAFBFC);
`;

const SqlBlock = styled.div`
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #1E293B;
  color: #E2E8F0;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-x: auto;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
`;

const HistorySidebar = styled.div`
  width: 200px;
  border-right: 1px solid var(--pro-border, #E5EAF0);
  overflow-y: auto;
  padding: 8px;
  background: var(--pro-bg-card, #FAFBFC);
`;

const HistoryItem = styled.div<{ $active: boolean }>`
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${({ $active }) => ($active ? '#1976D2' : '#6B7280')};
  background: ${({ $active }) => ($active ? '#EFF6FF' : 'transparent')};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};

  &:hover {
    background: #F3F4F6;
  }
`;

const EmptyChat = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #9CA3AF;
  font-size: 14px;
  text-align: center;
  padding: 40px;
`;

const SuggestionChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
`;

const Chip = styled.button`
  padding: 4px 10px;
  border: 1px solid var(--pro-border, #E5EAF0);
  border-radius: 16px;
  background: #fff;
  font-size: 11px;
  color: #374151;
  cursor: pointer;

  &:hover {
    background: #EFF6FF;
    border-color: #1976D2;
    color: #1976D2;
  }
`;

const MainLayout = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const ExportBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-top: 1px solid var(--pro-border, #E5EAF0);
  background: var(--pro-bg-card, #FAFBFC);
  font-size: 11px;
  color: #6B7280;
`;

const ExportButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--pro-border, #E5EAF0);
  border-radius: 6px;
  background: #fff;
  font-size: 11px;
  font-weight: 600;
  color: #374151;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: #EFF6FF;
    border-color: #1976D2;
    color: #1976D2;
  }
`;

/* ── Props ───────────────────────────────────────────── */

type DashboardChartInfo = {
  chartId: number;
  sliceName: string;
  vizType?: string;
};

type Props = {
  mode: AIInsightMode;
  context: Record<string, unknown>;
  targetId?: number | string;
  defaultQuestion: string;
  currentSql?: string;
  databaseId?: number;
  schema?: string | null;
  onApplySql?: (sql: string) => void;
  onRunSql?: (sql: string) => void;
  showHistory?: boolean;
  /** CSS selector for capturing a screenshot of the chart (chart mode). */
  chartNodeSelector?: string;
  /** Chart metadata for dashboard chart-by-chart mode. */
  dashboardCharts?: DashboardChartInfo[];
};

/* ── Chart Preview Components ─────────────────────────── */

const ChartPreview = styled.div`
  padding: 8px 16px;
  border-bottom: 1px solid #E5E7EB;
  background: #F8FAFC;
`;

const ChartPreviewImage = styled.img`
  width: 100%;
  max-height: 360px;
  object-fit: contain;
  border-radius: 4px;
  background: #fff;
`;

const ChartPreviewLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
`;

const DashboardModeSelector = styled.div`
  display: flex;
  gap: 4px;
  padding: 6px 16px;
  border-bottom: 1px solid #E5E7EB;
  background: #F8FAFC;
`;

const ModeTab = styled.button<{ $active: boolean }>`
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid ${({ $active }) => ($active ? '#1976D2' : '#D1D5DB')};
  background: ${({ $active }) => ($active ? '#EFF6FF' : '#fff')};
  color: ${({ $active }) => ($active ? '#1976D2' : '#6B7280')};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    border-color: #1976D2;
    color: #1976D2;
  }
`;

const ChartByChartCard = styled.div`
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  margin: 8px 0;
  overflow: hidden;
  background: #fff;
`;

const ChartByChartHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #F3F4F6;
  border-bottom: 1px solid #E5E7EB;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
`;

const ChartByChartBody = styled.div`
  padding: 0;
`;

/**
 * Capture a DOM element as a PNG data-URL using dom-to-image-more.
 * Returns null on failure (element not found, cross-origin, etc).
 */
async function captureElementAsImage(
  selector: string,
): Promise<string | null> {
  try {
    const container = document.querySelector(selector);
    if (!container) return null;
    // Drill into the actual chart visualization element, skipping
    // headers, context menus, data-tables pane, and other chrome.
    // Priority order: SuperChart wrapper → ECharts canvas → SVG → fallback to container.
    const vizEl =
      container.querySelector('.superset-chart, .chart-slice') ||
      container.querySelector('[data-test="chart-container"]') ||
      container.querySelector('.slice_container') ||
      container.querySelector('.panel-body') ||
      container;
    const el = vizEl as HTMLElement;

    // Temporarily expand all scroll containers so the full chart is visible.
    // Walk up from the viz element and remove overflow/height constraints,
    // then restore them after capture.
    const saved: { el: HTMLElement; overflow: string; maxHeight: string; height: string }[] = [];
    let walk: HTMLElement | null = el;
    while (walk && walk !== document.body) {
      const cs = window.getComputedStyle(walk);
      if (
        cs.overflow !== 'visible' ||
        cs.overflowY !== 'visible' ||
        cs.overflowX !== 'visible'
      ) {
        saved.push({
          el: walk,
          overflow: walk.style.overflow,
          maxHeight: walk.style.maxHeight,
          height: walk.style.height,
        });
        walk.style.overflow = 'visible';
        walk.style.maxHeight = 'none';
        // Only clear explicit height if the element is actually clipping content
        if (walk.scrollHeight > walk.clientHeight + 2) {
          walk.style.height = 'auto';
        }
      }
      walk = walk.parentElement;
    }

    // Also expand the target element itself
    const origElOverflow = el.style.overflow;
    const origElMaxH = el.style.maxHeight;
    const origElH = el.style.height;
    el.style.overflow = 'visible';
    el.style.maxHeight = 'none';
    if (el.scrollHeight > el.clientHeight + 2) {
      el.style.height = 'auto';
    }

    // Force ECharts instances to resize to their container's new dimensions
    const echartsDivs = el.querySelectorAll('[_echarts_instance_]');
    const echartsInstances: any[] = [];
    if ((window as any).echarts) {
      echartsDivs.forEach(div => {
        const inst = (window as any).echarts.getInstanceByDom(div);
        if (inst) {
          echartsInstances.push(inst);
          inst.resize();
        }
      });
    }

    // Brief delay for reflow
    await new Promise(r => setTimeout(r, 100));

    // Remove borders, shadows, and padding from chart containers for clean capture
    const borderOverrides: { el: HTMLElement; border: string; shadow: string; padding: string; borderRadius: string }[] = [];
    let borderWalk: HTMLElement | null = el;
    while (borderWalk && borderWalk !== document.body) {
      const cs = window.getComputedStyle(borderWalk);
      if (cs.border !== 'none' || cs.boxShadow !== 'none' || cs.borderRadius !== '0px') {
        borderOverrides.push({
          el: borderWalk,
          border: borderWalk.style.border,
          shadow: borderWalk.style.boxShadow,
          padding: borderWalk.style.padding,
          borderRadius: borderWalk.style.borderRadius,
        });
        borderWalk.style.border = 'none';
        borderWalk.style.boxShadow = 'none';
        borderWalk.style.borderRadius = '0';
      }
      borderWalk = borderWalk.parentElement;
    }

    const domToImage = (await import('dom-to-image-more')).default;
    const dataUrl = await domToImage.toPng(el, {
      bgcolor: '#ffffff',
      quality: 0.92,
      cacheBust: true,
      // Use the actual scroll dimensions so nothing is cut off
      width: el.scrollWidth || el.offsetWidth,
      height: el.scrollHeight || el.offsetHeight,
      style: {
        overflow: 'visible',
      },
      filter: (node: Node) => {
        if (node instanceof HTMLElement) {
          const cl = node.classList;
          const dt = node.getAttribute('data-test') || '';
          // Exclude headers, footers, toolbars, context menus, and chrome
          if (
            cl.contains('ant-dropdown') ||
            cl.contains('ant-tooltip') ||
            cl.contains('ant-popover') ||
            cl.contains('chart-header') ||
            cl.contains('slice-header') ||
            cl.contains('header-title') ||
            cl.contains('header-controls') ||
            cl.contains('chart-controls') ||
            cl.contains('filter-bar') ||
            cl.contains('query-and-save-btns') ||
            cl.contains('data-tab') ||
            cl.contains('force-query') ||
            cl.contains('nonce-viewer') ||
            dt === 'slice-header' ||
            dt === 'chart-controls' ||
            dt === 'query-and-save' ||
            // Exclude footer elements
            node.tagName === 'FOOTER' ||
            // MapLibre attribution / zoom controls
            cl.contains('maplibregl-ctrl-bottom-left') ||
            cl.contains('maplibregl-ctrl-bottom-right') ||
            cl.contains('mapboxgl-ctrl-bottom-left') ||
            cl.contains('mapboxgl-ctrl-bottom-right')
          ) {
            return false;
          }
        }
        return true;
      },
    });

    // Restore border overrides
    for (const o of borderOverrides) {
      o.el.style.border = o.border;
      o.el.style.boxShadow = o.shadow;
      o.el.style.padding = o.padding;
      o.el.style.borderRadius = o.borderRadius;
    }

    // Restore all modified elements
    el.style.overflow = origElOverflow;
    el.style.maxHeight = origElMaxH;
    el.style.height = origElH;
    for (const s of saved) {
      s.el.style.overflow = s.overflow;
      s.el.style.maxHeight = s.maxHeight;
      s.el.style.height = s.height;
    }
    // Resize ECharts back to original dimensions
    echartsInstances.forEach(inst => inst.resize());

    return dataUrl;
  } catch {
    return null;
  }
}

/* ── Suggestion prompts by mode ──────────────────────── */

const SUGGESTIONS: Record<AIInsightMode, string[]> = {
  chart: [
    'Summary',
    'Key trends',
    'Outlier analysis',
    'Top and bottom performers',
    'Period-over-period comparison',
    'Regional breakdown',
    'Performance against targets',
    'Risk assessment',
    'Root cause analysis',
    'Distribution analysis',
    'Year-on-year growth',
    'Seasonal patterns',
    'Anomaly detection',
    'Data quality check',
    'Ranking analysis',
    'Rate of change',
    'Forecast implications',
    'Critical thresholds',
    'Executive brief',
    'Actionable recommendations',
  ],
  dashboard: [
    'Summary',
    'Key takeaways',
    'Metrics needing attention',
    'Concerning trends',
    'Cross-chart patterns',
    'Performance overview',
    'Risk and issue analysis',
    'Regional comparison',
    'Period-over-period trends',
    'Top performers and laggards',
    'Target achievement status',
    'Leading vs lagging indicators',
    'Data gaps and quality',
    'Correlation analysis',
    'Executive presentation brief',
    'Strategic recommendations',
    'Critical alerts',
    'Improvement opportunities',
    'Quarter-over-quarter changes',
    'Comprehensive deep dive',
  ],
  sql: [
    'Show the latest data from all MART tables',
    'Summarize records by district and period',
    'Count distinct facilities per district',
    'Find top 10 indicators by total value',
    'Generate a trend analysis query',
    'Show completeness rates by org unit',
    'Compare current vs previous period',
    'Find missing or null values',
    'Monthly aggregation by region',
    'Pivot data by indicator and period',
  ],
};

/* ── Markdown options ─────────────────────────────────── */

const MARKDOWN_OPTIONS: Record<string, any> = {
  forceBlock: true,
  forceWrapper: true,
  overrides: {
    // Allow alert callout divs and badges to pass through as raw HTML
    div: { component: 'div' },
    span: { component: 'span' },
  },
};

const ALERT_TAGS: Record<string, { css: string; label: string }> = {
  CRITICAL: { css: 'critical', label: 'Critical' },
  WARNING: { css: 'warning', label: 'Warning' },
  GOOD: { css: 'good', label: 'Good' },
  INFO: { css: 'info', label: 'Info' },
};

/**
 * Convert `[CRITICAL] ...text...` blocks into HTML callout divs that
 * markdown-to-jsx will pass through.  Works for:
 *   - Block-level tags: `[CRITICAL]` on its own line followed by content
 *   - Inline tags at line start: `[CRITICAL] Some text here`
 *   - Tags inside bullets: `- [CRITICAL] Some text here`
 *   - Bare tag words: `Critical` / `Warning` / `Good` / `Info` on own line
 */
function preprocessAlertTags(text: string): string {
  const inlineMarkdownToHtml = (value: string) =>
    value
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Step 0: Normalize bare tag words on their own line (Gemini often writes
  // "Critical" instead of "[CRITICAL]"). Only match when the word is the
  // entire line content (with optional whitespace).
  let processed = text.replace(
    /^[ \t]*(Critical|Warning|Good|Info)[ \t]*$/gim,
    (_match, tag: string) => `[${tag.toUpperCase()}]`,
  );

  // Step 1: Convert bullet-inline tags (- [TAG] text) to block-level format
  processed = processed.replace(
    /^([ \t]*[-*][ \t]+)\[(CRITICAL|WARNING|GOOD|INFO)\][ \t]*(.*)/gm,
    (_match, _prefix: string, tag: string, rest: string) =>
      `[${tag}] ${rest.trim()}`,
  );

  // Step 2: Match block-level tags — optional leading whitespace, [TAG],
  // then content until next blank line, next tag, or end of string.
  // Output as single-line HTML so markdown-to-jsx treats it as one block
  // (multi-line <div> with \n\n inside causes the parser to split it).
  processed = processed.replace(
    /^[ \t]*\[(CRITICAL|WARNING|GOOD|INFO)\][ \t]*\n?([\s\S]*?)(?=\n[ \t]*\[(?:CRITICAL|WARNING|GOOD|INFO)\]|\n{2,}|$)/gm,
    (_match, tag: string, body: string) => {
      const info = ALERT_TAGS[tag];
      if (!info) return _match;
      const trimmed = body.trim();
      // Convert internal newlines to <br/> so the entire callout stays
      // within one HTML block — prevents markdown-to-jsx from splitting
      // and leaking </div> tags into rendered output.
      const singleLine = inlineMarkdownToHtml(trimmed).replace(/\n/g, '<br/>');
      return `\n<div class="alert-callout alert-${info.css}"><span class="alert-badge">${info.label}</span> ${singleLine}</div>\n`;
    },
  );

  return processed;
}

/**
 * Strip emoji and non-ASCII symbols that render as garbled text.
 * Keeps basic Latin, extended Latin (accented chars), and common
 * punctuation/whitespace so that standard English text is untouched.
 */
function sanitizeNonAscii(text: string): string {
  // Step 1: Convert common Unicode symbols to plain English words
  // so they render correctly in PDF (helvetica doesn't support Unicode arrows)
  const symbolsToText = text
    .replace(/\u2191|\u25B2|\u25B3|\u2197/g, 'Rising')   // ↑ ▲ △ ↗
    .replace(/\u2193|\u25BC|\u25BD|\u2198/g, 'Falling')   // ↓ ▼ ▽ ↘
    .replace(/\u2192|\u2794|\u279C|\u27A1/g, 'Stable')    // → ➔ ➜ ➡
    .replace(/\u2190/g, 'Declining')                        // ←
    .replace(/\u2194/g, 'Fluctuating')                      // ↔
    .replace(/\u2714|\u2705|\u2611/g, 'Yes')               // ✔ ✅ ☑
    .replace(/\u2716|\u274C|\u2717/g, 'No')                // ✖ ❌ ✗
    .replace(/\u26A0/g, '[WARNING]')                        // ⚠
    .replace(/\u2022/g, '-')                                // •
    .replace(/\u2013/g, '-')                                // –
    .replace(/\u2014/g, ' - ')                              // —
    .replace(/\u2018|\u2019/g, "'")                         // ' '
    .replace(/\u201C|\u201D/g, '"')                         // " "
    .replace(/\u2026/g, '...')                              // …
    .replace(/\u00B7/g, '-')                                // ·
    .replace(/\u25CF|\u25CB/g, '-');                        // ● ○

  // Step 2: Remove emoji and miscellaneous symbols
  const cleaned = symbolsToText
    .replace(
      /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]|[\u{20E3}]|[\u{E0020}-\u{E007F}]/gu,
      '',
    )
    // Remove any remaining non-printable or unsupported characters (keep basic Latin + extended Latin)
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t|#*_\-`>]/g, '')
    // Collapse any resulting double-spaces
    .replace(/ {2,}/g, ' ');
  // Fix concatenated words and missing punctuation spacing
  return fixWordSpacing(cleaned);
}

/**
 * Fix markdown structural issues where headers, sub-headers, numbered lists,
 * and bullet points get merged onto the same line.
 *
 * Examples:
 *   "Action Recommendations1. Deploy" → "Action Recommendations\n1. Deploy"
 *   "Chart by Chart### Malaria" → "Chart by Chart\n### Malaria"
 *   "some text- bullet" → "some text\n- bullet"
 */
function fixMarkdownStructure(text: string): string {
  let fixed = text;

  // 1. Missing newline before ## or ### headers embedded mid-line
  //    "...text## Header" or "...text### SubHeader"
  fixed = fixed.replace(/([^\n#])(#{2,3}\s)/g, '$1\n$2');

  // 2. Missing newline after ## header that runs into content
  //    "## Header\nContent" is fine, but "## HeaderContent" needs split
  //    Match: ## followed by text, then a digit+period (numbered list start)
  fixed = fixed.replace(
    /^(#{2,3}\s+[^\n]+?)(\d+\.\s)/gm,
    '$1\n$2',
  );

  // 3. Numbered list item starting mid-line after non-list text
  //    "some sentence1. First item" → "some sentence\n1. First item"
  //    Guard: don't split within table cells (|) or after decimal points
  fixed = fixed.replace(
    /([a-zA-Z.,:;!?])(\d+\.\s+[A-Z])/g,
    '$1\n$2',
  );

  // 4. Bullet point merged onto end of previous text
  //    "some text- bullet" → "some text\n- bullet"
  //    "text.- Bullet" → "text.\n- Bullet"
  fixed = fixed.replace(/([a-zA-Z.,:;!?])\s?([-*]\s*[A-Z])/g, '$1\n$2');

  // 5. Ensure blank line before ## headings (markdown requires it for proper parsing)
  fixed = fixed.replace(/([^\n])\n(#{2,3}\s)/g, '$1\n\n$2');

  // 6. Fix "â" (mojibake for em-dash "—") in headings
  fixed = fixed.replace(/â/g, '\u2014');

  return fixed;
}

/**
 * Fix common word-spacing and punctuation issues in AI-generated text.
 *
 * AI models sometimes concatenate words ("treatedfor", "highlightsa")
 * or omit spaces after punctuation ("value,but", "system.The").
 * This function repairs those issues while preserving markdown syntax,
 * URLs, numbers, and common abbreviations.
 */
function fixWordSpacing(text: string): string {
  // Common English words that the AI joins onto a preceding word.
  // Only words 3+ chars to avoid false positives with short fragments.
  // Sorted longest-first so "through" matches before "the".
  const BOUNDARY_WORDS = [
    // 8+ letter words — longest first to match greedily
    'throughout', 'presenting', 'associated', 'considered', 'represents',
    'concerning', 'continuing', 'indicating', 'suggesting', 'addressing',
    'experience', 'particular', 'management', 'proportion', 'generation',
    'population', 'department', 'percentage', 'comparison',
    'significant', 'important', 'concerning', 'including', 'according',
    'therefore', 'meanwhile', 'currently', 'following', 'affecting',
    'requiring', 'improving', 'declining', 'remaining', 'resulting',
    'achieving', 'providing', 'reporting', 'receiving', 'revealing',
    'primarily', 'typically', 'generally', 'estimated', 'available',
    // 7 letter words
    'between', 'through', 'without', 'against', 'because', 'however',
    'quality', 'several', 'overall', 'another', 'whether', 'notably',
    'already', 'remains', 'appears', 'reveals', 'implies', 'suggest',
    'warrant', 'signals', 'require', 'present', 'despite',
    // Domain-specific (health, analytics, geography)
    // NOTE: avoid short suffixes that appear inside common words:
    //   - "rates" breaks "demonstrates", "illustrates", "generates"
    //   - "health" breaks "stealth", "wealth", "commonwealth"
    //   - "cases" breaks "showcases", "staircases"
    //   - "zero" is safe (few false positives)
    'surveillance', 'adherence', 'preventive', 'treatment', 'clinical',
    'national', 'diagnostic', 'district', 'facility',
    'coverage', 'baseline', 'outbreak', 'incidence', 'mortality',
    'morbidity', 'indicator', 'threshold', 'quarterly', 'monthly',
    'annually', 'regional', 'performance', 'programme', 'program',
    'hotspots', 'hotspot', 'positivity', 'admissions',
    'watchouts', 'leadership', 'testing', 'malaria',
    'eradication', 'prevention', 'control', 'measures', 'resources',
    'commodities', 'interventions', 'protocols', 'strategies',
    'burden', 'capacity', 'children', 'pediatric', 'maternal',
    'migration', 'percent', 'million', 'thousand',
    // 6 letter words
    'before', 'during', 'within', 'around', 'across', 'toward',
    'likely', 'rather', 'simply', 'nearly', 'showed', 'showed',
    'higher', 'lowest', 'showed', 'steady', 'growth',
    // 5 letter words
    'about', 'after', 'which', 'where', 'while', 'their', 'there',
    'these', 'those', 'would', 'could', 'should', 'other',
    'being', 'still', 'under', 'until', 'since', 'shows',
    'needs', 'below', 'above', 'level',
    // 4 letter words
    'from', 'with', 'into', 'upon', 'over', 'than', 'then',
    'when', 'what', 'this', 'that', 'have', 'been', 'were',
    'more', 'some', 'will', 'only', 'just', 'each', 'both',
    'also', 'very', 'much', 'such', 'most', 'must',
    'like', 'even', 'well', 'many', 'high', 'poor',
    'data', 'rate', 'year',
    // 3 letter words
    'for', 'but', 'and', 'the', 'not', 'are', 'was', 'has',
    'had', 'can', 'may', 'all', 'its', 'per', 'yet', 'nor',
  ];
  // Build a single regex: (3+ lowercase)(boundary word) at word-like boundary
  const boundaryPattern = new RegExp(
    `([a-z]{3,})(${BOUNDARY_WORDS.join('|')})(?=[^a-z]|$)`,
    'gi',
  );

  const SPLIT_WORDS = new Set([
    'a', 'all', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'has',
    'have', 'in', 'into', 'is', 'it', 'its', 'last', 'lowest', 'month',
    'months', 'more', 'most', 'no', 'of', 'on', 'or', 'per', 'remained',
    'respectively', 'significant', 'significantly', 'since', 'stable', 'test',
    'tested', 'testing', 'tests', 'than', 'that', 'the', 'their', 'these',
    'this', 'those', 'to', 'treated', 'under', 'while', 'with', 'without',
    'year', 'years',
    'action', 'actions', 'admission', 'admissions', 'analysis', 'busoga',
    'cases', 'case', 'chart', 'critical', 'dashboard', 'death', 'deaths',
    'district', 'districts', 'dose', 'dropped', 'english', 'executive',
    'facilities', 'facility', 'fatality', 'highest', 'historical', 'hospital',
    'infection', 'insight',
    'insights', 'kampala', 'key', 'kigezi', 'lango', 'leadership', 'malaria',
    'massive', 'mip', 'nile', 'north', 'period', 'periods', 'points', 'positivity', 'pregnancy',
    'proportion', 'proportions', 'quality', 'rate', 'rates', 'recommendation',
    'recommendations', 'region', 'regions', 'signal', 'signals', 'sp',
    'summary', 'targeted', 'teso', 'treatment', 'under', 'urgent', 'warning', 'watchouts', 'west',
    'performing', 'population', 'rapid', 'record', 'required', 'response',
    'administered', 'treated', 'month',
  ]);

  const mergeSingleChars = (parts: string[]) => {
    const merged: string[] = [];
    let buffer = '';
    parts.forEach(part => {
      if (part.length === 1 && /[a-z]/i.test(part)) {
        buffer += part;
        return;
      }
      if (buffer) {
        merged.push(buffer);
        buffer = '';
      }
      merged.push(part);
    });
    if (buffer) merged.push(buffer);
    return merged;
  };

  const splitJoinedAlphaToken = (token: string): string => {
    if (token.length < 10 || !/^[A-Za-z]+$/.test(token)) return token;

    const lower = token.toLowerCase();
    const n = lower.length;
    const scores = Array(n + 1).fill(-1e9);
    const paths: Array<string[] | null> = Array(n + 1).fill(null);
    scores[0] = 0;
    paths[0] = [];

    for (let i = 0; i < n; i += 1) {
      if (!paths[i]) continue;
      if (scores[i] - 4 > scores[i + 1]) {
        scores[i + 1] = scores[i] - 4;
        paths[i + 1] = [...(paths[i] || []), token.slice(i, i + 1)];
      }
      for (let j = i + 1; j <= Math.min(n, i + 18); j += 1) {
        const piece = lower.slice(i, j);
        if (!SPLIT_WORDS.has(piece)) continue;
        const pieceScore = scores[i] + piece.length * piece.length;
        if (pieceScore > scores[j]) {
          scores[j] = pieceScore;
          paths[j] = [...(paths[i] || []), token.slice(i, j)];
        }
      }
    }

    const parts = mergeSingleChars(paths[n] || [token]);
    const recognized = parts.reduce(
      (sum, part) => sum + (SPLIT_WORDS.has(part.toLowerCase()) ? part.length : 0),
      0,
    );
    if (parts.length >= 2 && recognized / Math.max(1, token.length) >= 0.65) {
      return parts.join(' ');
    }
    return token;
  };

  const splitJoinedTokensInLine = (line: string) =>
    line.replace(/[A-Za-z][A-Za-z-]{8,}/g, token => {
      if (token.includes('-')) {
        return token
          .split('-')
          .map(part => splitJoinedAlphaToken(part))
          .join('-');
      }
      return splitJoinedAlphaToken(token);
    });

  const repairFragmentedAlphaSequences = (line: string) => {
    const tokens = line.match(/[A-Za-z]+|[^A-Za-z]+/g) || [];
    const repaired: string[] = [];
    let i = 0;
    while (i < tokens.length) {
      if (!/^[A-Za-z]+$/.test(tokens[i])) {
        repaired.push(tokens[i]);
        i += 1;
        continue;
      }

      let j = i;
      const parts: string[] = [];
      let hadShortPiece = false;
      while (j < tokens.length && /^[A-Za-z]+$/.test(tokens[j])) {
        parts.push(tokens[j]);
        hadShortPiece = hadShortPiece || tokens[j].length <= 2;
        if (j + 1 < tokens.length && /^\s+$/.test(tokens[j + 1])) {
          j += 2;
          continue;
        }
        break;
      }

      if (parts.length >= 2 && hadShortPiece) {
        const combined = parts.join('');
        const repairedToken = splitJoinedAlphaToken(combined);
        if (repairedToken !== combined) {
          repaired.push(repairedToken);
          i = j + 1;
          continue;
        }
      }

      repaired.push(tokens[i]);
      i += 1;
    }
    return repaired.join('');
  };

  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      // Skip code blocks, table rows, image links, raw URLs
      if (
        trimmed.startsWith('```') ||
        trimmed.startsWith('|') ||
        trimmed.startsWith('![') ||
        /^https?:\/\//.test(trimmed)
      ) {
        return line;
      }

      let fixed = line;

      // Normalize malformed bullets and odd glyphs from weaker local models
      fixed = fixed.replace(/¢/g, '- ');
      fixed = fixed.replace(/\u2022/g, '- ');
      fixed = fixed.replace(/(\d+(?:\.\d+)?)%([A-Za-z])/g, '$1% $2');
      fixed = fixed.replace(/([A-Za-z])(-\d(?:\.\d+)?)/g, '$1 $2');
      fixed = fixed.replace(
        /(\d+(?:\.\d+)?)(per|million|billion|thousand|population|cases|deaths|admissions|tests|patients|districts|regions|facilities|months|years|weeks|days)/gi,
        '$1 $2',
      );
      fixed = repairFragmentedAlphaSequences(fixed);

      // 1. Punctuation spacing: comma/semicolon followed by letter
      //    "value,but" → "value, but"
      fixed = fixed.replace(/([a-zA-Z])([,;])([a-zA-Z])/g, '$1$2 $3');

      // 2. Period + uppercase = sentence boundary: "system.The" → "system. The"
      fixed = fixed.replace(/([a-z])\.([A-Z])/g, '$1. $2');

      // 3. Colon + letter (not time like 12:30): "key:value" → "key: value"
      fixed = fixed.replace(/([a-zA-Z]):([a-zA-Z])/g, '$1: $2');

      // 4. Space before opening paren: "rate(95%)" → "rate (95%)"
      fixed = fixed.replace(/([a-zA-Z])\((?!\))/g, '$1 (');

      // 5. camelCase mid-sentence: lowercase + Uppercase word
      //    "highlightsA" → "highlights A", "treatedFor" → "treated For"
      //    Preserve actual camelCase inside backticks
      fixed = fixed.replace(
        /(?<!`)([a-z]{2,})([A-Z][a-z])(?!`)/g,
        '$1 $2',
      );
      fixed = splitJoinedTokensInLine(fixed);

      // 5b. Number joined to word: "early2026" → "early 2026", "5.0percent" → "5.0 percent"
      //     Guard: don't split hex codes, version numbers like "v2", or ordinals like "1st"
      fixed = fixed.replace(/([a-zA-Z]{2,})(\d{2,})/g, '$1 $2');
      fixed = fixed.replace(/(\d+(?:\.\d+)?)(percent|million|billion|thousand|cases|deaths|admissions|tests|patients|districts|regions|facilities|months|years|weeks|days)/gi, '$1 $2');

      // 6. Concatenated common words: "treatedfor" → "treated for"
      //    Apply the boundary word list. Guard against false positives
      //    by requiring the prefix to be 3+ lowercase chars.
      fixed = fixed.replace(boundaryPattern, (match, prefix, word) => {
        // Skip if the whole match is itself a known word (e.g., "performed" contains "for")
        // Simple heuristic: if prefix + word together form a very common word, skip
        const combined = (prefix + word).toLowerCase();
        // Allow splitting only if the combined form is likely NOT a real word.
        // Check: if word starts right at a boundary the AI likely missed.
        // We only split when prefix is 3+ chars AND word is 3+ chars.
        if (word.length < 3) return match;
        // Common false positives to skip
        const falsePositives = [
          'therefore', 'perform', 'performed', 'performer', 'performing', 'before',
          'inform', 'informed', 'information', 'informal', 'informing', 'transform',
          'transformed', 'transforming', 'transformation',
          'platform', 'reform', 'reformed', 'uniform', 'comfortable', 'furthermore',
          'moreover', 'otherwise', 'somewhere', 'everywhere', 'nowhere',
          'anywhere', 'whoever', 'whatever', 'however', 'whenever',
          'wherever', 'whether', 'together', 'altogether', 'another',
          'mother', 'father', 'brother', 'bother', 'other', 'rather',
          'gather', 'weather', 'feather', 'leather', 'either', 'neither',
          'further', 'perhaps', 'overall', 'overhaul', 'overcome',
          'within', 'forthwith', 'hitherto', 'withdraw', 'withstand',
          'withhold', 'notwithstanding', 'although', 'also',
          'already', 'always', 'almost', 'itself', 'himself', 'herself',
          'themselves', 'ourselves', 'yourself', 'myself',
          'percent', 'percentage', 'perennial', 'period', 'periodic',
          'permission', 'personal', 'personnel', 'perspective',
          'format', 'formula', 'formal', 'formation', 'formerly',
          'thermal', 'normal', 'abnormal',
          // Additional false positives for expanded word list
          'thereafter', 'beforehand', 'underlying', 'understand', 'understood',
          'undertake', 'underway', 'undergo', 'underline', 'undercover',
          'afterward', 'afterwards', 'afterward', 'toward', 'towards',
          'upward', 'downward', 'inward', 'outward', 'forward',
          'generate', 'generated', 'generating', 'generation',
          'erate', 'eration', 'moderate', 'accelerate', 'tolerate',
          'elaborate', 'integrate', 'integrated', 'demonstrate',
          'separate', 'separated', 'operate', 'operated', 'cooperate',
          'indicator', 'predicate', 'dedicate', 'dedicated',
          'investigate', 'investigate', 'syndicate',
          'coverage', 'leverage', 'average', 'beverage',
          'baseline', 'guideline', 'timeline', 'headline', 'deadline', 'outline',
          'decline', 'declined', 'incline',
          'populate', 'populated', 'population',
          'simulate', 'stimulate', 'accumulate', 'calculate',
          'regulate', 'regulated', 'speculate',
          'absolute', 'resolute', 'dissolve',
          'represent', 'represents', 'representing', 'represented',
          'present', 'presented', 'presenting', 'presentation',
          'programme', 'programmed', 'programmatic',
          'threshold', 'watershed',
          'district', 'restrict', 'restricted',
          'facility', 'ability', 'stability', 'capability',
          'monthly', 'quarterly', 'annually', 'currently',
          'recently', 'frequently', 'subsequently', 'consequently',
          'apparently', 'evidently', 'sufficiently', 'consistently',
          'persistently', 'predominantly', 'significantly',
          'unfortunately', 'approximately', 'particularly',
          // New additions for health domain words
          'diseases', 'stealth', 'stealthy', 'wealth', 'wealthy',
          'commonwealth', 'health', 'healthy', 'healthcare',
          'cases', 'showcases', 'suitcases', 'staircases',
          'resources', 'courses', 'forces', 'sources',
          'services', 'devices', 'practices', 'offices',
        ];
        if (falsePositives.includes(combined)) return match;
        // Pattern-based false positive detection: if the combined word is a
        // reasonable length (<=16 chars) and ends in a common English suffix,
        // it's likely a real word, not a merge.
        // E.g., "demonstrates" = "demonst" + "rates" should NOT be split.
        // But "geographicmigration" (20 chars) should be split.
        if (
          combined.length <= 16 &&
          /(?:ates|tion|sion|ment|ness|ence|ance|ible|able|ious|eous|ture|ular|iver|ical|inal|onal|ural|rial|tial|cial|ntal|rnal|ther|ever|over|ward|wise|like|less|ship|hood|full)$/i.test(combined)
        ) return match;
        return `${prefix} ${word}`;
      });

      // 7. Single-letter article/word concatenated onto previous word
      //    "highlightsa " → "highlights a ", "revealsa " → "reveals a "
      //    Pattern: 3+ lowercase letters + "a" followed by space/punctuation/end
      fixed = fixed.replace(/([a-z]{3,})(a)\s/g, (match, prefix, article) => {
        // Skip known words ending in 'a': "data", "visa", "extra", "quota", etc.
        const wordsEndingInA = [
          'data', 'visa', 'extra', 'ultra', 'meta', 'quota', 'alpha',
          'beta', 'delta', 'gamma', 'sigma', 'omega', 'flora', 'fauna',
          'drama', 'comma', 'dilemma', 'plasma', 'schema', 'stigma',
          'criteria', 'phenomena', 'area', 'idea', 'era', 'via',
          'formula', 'antenna', 'banana', 'camera', 'china', 'cola',
          'opera', 'pizza', 'saliva', 'sofa', 'toga', 'yoga', 'zebra',
          'manga', 'panda', 'propaganda', 'malaria', 'anda',
        ];
        if (wordsEndingInA.includes(prefix.toLowerCase() + 'a')) return match;
        return `${prefix} a `;
      });

      // 7b. Specific merged section labels seen in LocalAI output
      fixed = fixed.replace(/\b(Key)(points)\b/gi, '$1 $2');
      fixed = fixed.replace(/\b(Leadership)(watchouts)\b/gi, '$1 $2');
      fixed = fixed.replace(/\b(Executive)(Summary)\b/gi, '$1 $2');
      fixed = fixed.replace(/\b(year-over-year)([A-Za-z])/gi, '$1 $2');
      fixed = repairFragmentedAlphaSequences(fixed);
      fixed = splitJoinedTokensInLine(fixed);

      // 8. Collapse double-spaces
      fixed = fixed.replace(/ {2,}/g, ' ');

      return fixed;
    })
    .join('\n');
}

/**
 * Fix malformed markdown tables:
 * - Convert empty separator rows (| | | | |) to proper (|---|---|---|---|)
 * - Ensure header rows have a separator below them
 * - Remove completely blank table rows
 */
function fixMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect a pipe-delimited row
    if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

      // Skip completely empty rows (| | | | |) — these are malformed separators
      if (cells.every(c => c === '')) {
        // Replace with a proper separator row
        const sepCells = cells.map(() => '---');
        result.push(`| ${sepCells.join(' | ')} |`);
        continue;
      }

      // Check if this looks like a header row (has content) and next row is NOT a separator
      result.push(line);
      if (
        cells.some(c => c !== '') &&
        i + 1 < lines.length
      ) {
        const nextTrimmed = lines[i + 1]?.trim() || '';
        const isNextPipe = nextTrimmed.startsWith('|') && nextTrimmed.includes('|', 1);
        if (isNextPipe) {
          const nextCells = nextTrimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
          // If next row is empty (malformed sep) or already a proper sep, we'll handle it naturally
          // But if next row is a data row (no separator between header and data), inject one
          if (
            i === 0 || !result[result.length - 2]?.trim().startsWith('|')
          ) {
            // This might be the first row of a table — check if next line needs a separator
            const isNextSep = nextCells.every(c => /^[-:]+$/.test(c));
            const isNextEmpty = nextCells.every(c => c === '');
            if (!isNextSep && !isNextEmpty) {
              // No separator between header and first data row — inject one
              const sepCells = cells.map(() => '---');
              result.push(`| ${sepCells.join(' | ')} |`);
            }
          }
        }
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Unified proofreading pipeline for ALL AI insight text.
 * Applies in order: markdown structure fixes → unicode/word spacing cleanup →
 * table fixes → alert tag processing.
 * Called by RenderedMarkdown (inline display) and all export functions
 * (PDF, DOCX, PPTX) to ensure consistent quality across all providers.
 */
/**
 * Strip lines that contain leaked system prompt fragments.
 * Models sometimes echo instruction text like "Do NOT exceed the rules"
 * or "End with ## 6. Action Recommendations" — remove them.
 */
function stripPromptLeakage(text: string): string {
  const leakPatterns = [
    // Rule references and meta-instructions
    /(?:Do NOT|NEVER|MUST|ALWAYS)\s+(?:exceed|echo|quote|reference|use)\s+(?:the\s+)?(?:rules?|instructions?|prompt|section names?|meta-text|formatting|strict)/i,
    /(?:Strict Rules|FORMATTING RULES|PRESENTATION STYLE|CRITICAL OUTPUT RULE|OUTPUT RULE)/i,
    /End with\s+##\s+\d+\.\s+/i,
    // Stop markers leaked into output
    /^STOP\s*(?:writing\s+immediately)?\.?\s*$/i,
    // Instruction section headings leaked verbatim
    /^(?:ANALYSIS APPROACH|CROSS-CHART INTELLIGENCE|INTELLIGENT ANALYSIS REQUIREMENTS|SLIDE DESIGN PRINCIPLES|EXECUTIVE PRESENTATION OUTPUT RULES|ABSOLUTE REQUIREMENT|MANDATORY RESPONSE STRUCTURE|HEALTH PROGRAM THRESHOLDS AND COLOR LEGENDS|CHART TYPE INTERPRETATION GUIDE|ANALYTICAL REASONING FRAMEWORK|DATA ANALYSIS DRAFT)\s*[:—]?\s*$/i,
    // "You are Superset AI" identity text
    /^You are Superset AI/i,
    // Completion nagging leaked
    /^(?:COMPLETION IS MANDATORY|NON-NEGOTIABLE|WRITE A FULL|RECOMMENDED FLOW)\s*[:—]/i,
    // Truncation markers copied from compacted context/sample tables
    /^\s*\.\.\.\s+and\s+\d+\s+more\s+rows?\s*$/i,
    /^\s*and\s+\d+\s+more\s+rows?\s*$/i,
    /^\s*\.\.\.\s*$/i,
    /^\s*\[STUB\b.*$/i,
    /^\s*Add\s+\d+\s*-\s*\d+\s+more\s+rows.*$/i,
    /^\s*Bullet\s+\d+\s*-\s*\d+.*$/i,
    /^\s*Write\s+a\s+\d+\s*-\s*\d+\s+word\s+paragraph.*$/i,
  ];

  return text
    .split('\n')
    .filter(line => !leakPatterns.some(p => p.test(line.trim())))
    .join('\n');
}

function proofreadInsight(text: string): string {
  const noLeaks = stripPromptLeakage(text);
  const unescaped = noLeaks
    .replace(/\\\*/g, '*')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\`/g, '`');
  const structured = fixMarkdownStructure(unescaped);
  const clean = sanitizeNonAscii(structured);
  const tables = fixMarkdownTables(clean);
  return tables;
}

function RenderedMarkdown({ text }: { text: string }) {
  const proofread = proofreadInsight(text);
  const processed = preprocessAlertTags(proofread);
  return <Markdown options={MARKDOWN_OPTIONS}>{processed}</Markdown>;
}

/* ── Export helpers ───────────────────────────────────── */

/** Read Superset brand info from bootstrap data for export documents. */
function getBrandInfo(): { name: string; text: string } {
  try {
    const bootstrap = getBootstrapData();
    const brand = (bootstrap?.common as any)?.menu_data?.brand;
    return {
      name: brand?.alt || brand?.tooltip || 'Superset',
      text: brand?.text || '',
    };
  } catch {
    return { name: 'Superset', text: '' };
  }
}

/** Build a dynamic export title: "Brand Name - Dashboard/Chart Title" */
function buildExportTitle(
  brand: { name: string; text: string },
  exportContext?: { mode?: string; context?: Record<string, unknown> },
): string {
  const brandName = brand.text || brand.name;
  if (!exportContext?.context) return brandName;
  const ctx = exportContext.context as any;
  let targetTitle = '';
  if (exportContext.mode === 'dashboard' && ctx.dashboard?.title) {
    targetTitle = ctx.dashboard.title;
  } else if (exportContext.mode === 'chart' && ctx.chart?.name) {
    targetTitle = ctx.chart.name;
  }
  return targetTitle ? `${brandName} - ${targetTitle}` : brandName;
}

/** Hex color string "#RRGGBB" → [r, g, b] tuple for jsPDF. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** Load a data-URL image and return its natural width × height. */
function getImageDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Fit an image into a max bounding box while preserving aspect ratio.
 * Returns the scaled { width, height } that fits inside maxW × maxH.
 */
function fitImage(
  naturalW: number,
  naturalH: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  if (naturalW <= 0 || naturalH <= 0) return { width: maxW, height: maxH };
  const ratio = Math.min(maxW / naturalW, maxH / naturalH, 1);
  return { width: naturalW * ratio, height: naturalH * ratio };
}

const ALERT_PDF_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  CRITICAL: { bg: '#FEF2F2', border: '#DC2626', text: '#991B1B', badge: '#DC2626' },
  WARNING:  { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E', badge: '#F59E0B' },
  GOOD:     { bg: '#F0FDF4', border: '#16A34A', text: '#166534', badge: '#16A34A' },
  INFO:     { bg: '#EFF6FF', border: '#3B82F6', text: '#1E40AF', badge: '#3B82F6' },
};

/**
 * Render markdown-formatted text to the jsPDF document at the given Y position.
 * Returns the new Y position after rendering.
 *
 * Professional formatting: consistent paragraph spacing (before/after),
 * readable line-height, and proper heading hierarchy.
 */
function renderMarkdownToPdf(
  pdf: any,
  text: string,
  startY: number,
  pageWidth: number,
  margin: number,
): number {
  const contentWidth = pageWidth - margin * 2;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const bottomMargin = 22;
  let y = startY;

  // Professional spacing constants (mm) — compact but readable
  const LINE_HEIGHT = 1.35; // multiplier for font size → line step
  const PARA_SPACE_BEFORE = 1.5;
  const PARA_SPACE_AFTER = 1.5;
  const BODY_FONT = 9.5;
  const H1_FONT = 14;
  const H2_FONT = 12;
  const H3_FONT = 10.5;
  const CODE_FONT = 8;

  const clean = proofreadInsight(text);
  const lines = clean.split('\n');
  let inCodeBlock = false;

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - bottomMargin) {
      pdf.addPage();
      y = margin;
    }
  }

  /** Render a line with inline **bold**, *italic*, and `code` segments. */
  function renderFormattedLine(
    line: string,
    baseSize: number,
    baseStyle: string,
    color: [number, number, number],
    indent: number = 0,
  ) {
    const maxW = contentWidth - indent;
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|([^*`]+)/g;
    let m: RegExpExecArray | null;
    const segments: { text: string; bold: boolean; italic: boolean; code: boolean }[] = [];
    while ((m = regex.exec(line)) !== null) {
      if (m[1]) segments.push({ text: m[1], bold: true, italic: false, code: false });
      else if (m[2]) segments.push({ text: m[2], bold: false, italic: true, code: false });
      else if (m[3]) segments.push({ text: m[3], bold: false, italic: false, code: true });
      else if (m[4]) segments.push({ text: m[4], bold: false, italic: false, code: false });
    }
    if (!segments.length) segments.push({ text: line, bold: false, italic: false, code: false });

    const fullText = segments.map(s => s.text).join('');
    pdf.setFont('helvetica', baseStyle);
    pdf.setFontSize(baseSize);
    const wrapped: string[] = pdf.splitTextToSize(fullText, maxW);
    const lineStep = baseSize * LINE_HEIGHT * 0.352; // pt→mm × line-height

    for (const wrapLine of wrapped) {
      ensureSpace(lineStep + 1);
      let xPos = margin + indent;
      let remaining = wrapLine;
      for (const seg of segments) {
        if (!remaining) break;
        let chunk = '';
        if (remaining.startsWith(seg.text)) {
          chunk = seg.text;
          remaining = remaining.slice(chunk.length);
        } else if (seg.text.length > 0 && remaining.includes(seg.text.substring(0, 1))) {
          const idx = Math.min(remaining.length, seg.text.length);
          chunk = remaining.substring(0, idx);
          remaining = remaining.slice(idx);
          seg.text = seg.text.slice(idx);
        }
        if (!chunk) continue;

        if (seg.code) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(baseSize - 1);
          const cw = pdf.getTextWidth(chunk);
          pdf.setFillColor(229, 231, 235);
          pdf.roundedRect(xPos - 1, y - baseSize * 0.35, cw + 2, baseSize * 0.5, 1, 1, 'F');
          pdf.setTextColor(30, 41, 59);
        } else {
          const style = seg.bold && seg.italic ? 'bolditalic' : seg.bold ? 'bold' : seg.italic ? 'italic' : baseStyle;
          pdf.setFont('helvetica', style);
          pdf.setFontSize(baseSize);
          pdf.setTextColor(...color);
        }
        pdf.text(chunk, xPos, y);
        xPos += pdf.getTextWidth(chunk);
        pdf.setFont('helvetica', baseStyle);
        pdf.setFontSize(baseSize);
        pdf.setTextColor(...color);
      }
      y += lineStep;
    }
    return y;
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const trimmed = lines[lineIdx].trim();

    // Code block fences
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) y += 2;
      inCodeBlock = !inCodeBlock;
      if (!inCodeBlock) y += 2;
      continue;
    }
    if (inCodeBlock) {
      const codeLineH = CODE_FONT * LINE_HEIGHT * 0.352;
      ensureSpace(codeLineH + 2);
      pdf.setFillColor(243, 244, 246);
      pdf.rect(margin, y - codeLineH + 1, contentWidth, codeLineH + 1, 'F');
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(CODE_FONT);
      pdf.setTextColor(30, 41, 59);
      pdf.text(trimmed, margin + 4, y);
      y += codeLineH + 0.5;
      continue;
    }

    // Empty line → paragraph break (compact)
    if (!trimmed) {
      y += PARA_SPACE_BEFORE;
      continue;
    }

    // Alert tags — rendered as callout boxes with multi-line body support
    const alertMatch = trimmed.match(/^\[(CRITICAL|WARNING|GOOD|INFO)\]\s*(.*)/);
    if (alertMatch) {
      const [, tag, sameLine] = alertMatch;
      // Collect continuation lines: everything until next alert tag, double blank, or end
      const bodyParts: string[] = [];
      if (sameLine.trim()) bodyParts.push(sameLine.trim());
      while (lineIdx + 1 < lines.length) {
        const nextTrimmed = lines[lineIdx + 1].trim();
        // Stop at blank line, next alert tag, or heading
        if (!nextTrimmed || /^\[(CRITICAL|WARNING|GOOD|INFO)\]/.test(nextTrimmed) || /^#{1,3} /.test(nextTrimmed)) break;
        bodyParts.push(nextTrimmed);
        lineIdx++;
      }
      const body = bodyParts.join(' ');
      const colors = ALERT_PDF_COLORS[tag] || ALERT_PDF_COLORS.INFO;
      const label = (ALERT_TAGS[tag]?.label || tag).toUpperCase();

      // Measure alert block height
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(BODY_FONT);
      const labelW_ = pdf.getTextWidth(`${label}: `);
      pdf.setFont('helvetica', 'normal');
      const bodyLines_: string[] = pdf.splitTextToSize(body, contentWidth - 10 - labelW_);
      const lineH = BODY_FONT * LINE_HEIGHT * 0.352;
      const totalLines = Math.max(1, bodyLines_.length);
      const blockHeight = totalLines * lineH + 3;

      y += 1;
      ensureSpace(blockHeight + 1);

      // Background + left accent (compact)
      const blockTop = y;
      const [bgR, bgG, bgB] = hexToRgb(colors.bg);
      pdf.setFillColor(bgR, bgG, bgB);
      pdf.roundedRect(margin, blockTop, contentWidth, blockHeight, 1, 1, 'F');
      const [brR, brG, brB] = hexToRgb(colors.border);
      pdf.setFillColor(brR, brG, brB);
      pdf.rect(margin, blockTop, 2, blockHeight, 'F');

      // Render bold label then body text inline — vertically centered
      const [txR, txG, txB] = hexToRgb(colors.text);
      const textBlockH = totalLines * lineH;
      let alertY = blockTop + (blockHeight - textBlockH) / 2 + lineH * 0.75;

      // Draw bold label on first position
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(BODY_FONT);
      pdf.setTextColor(brR, brG, brB);
      const labelText = `${label}: `;
      pdf.text(labelText, margin + 5, alertY);
      const labelW = pdf.getTextWidth(labelText);

      // Wrap and draw body text separately (avoids duplication from combined string)
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(BODY_FONT);
      pdf.setTextColor(txR, txG, txB);
      const bodyWrapped: string[] = pdf.splitTextToSize(body, contentWidth - 10 - labelW);
      if (bodyWrapped.length > 0) {
        // First line starts after the label
        pdf.text(bodyWrapped[0], margin + 5 + labelW, alertY);
        alertY += lineH;
        // Subsequent lines at full indent
        for (let wi = 1; wi < bodyWrapped.length; wi++) {
          pdf.text(bodyWrapped[wi], margin + 5, alertY);
          alertY += lineH;
        }
      } else {
        alertY += lineH;
      }
      y += blockHeight + 1;
      continue;
    }

    // Headers
    const h1 = trimmed.match(/^# (.+)/);
    if (h1) {
      y += 4;
      ensureSpace(14);
      renderFormattedLine(h1[1], H1_FONT, 'bold', [25, 118, 210]);
      // Underline
      pdf.setDrawColor(200, 212, 228);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y + 1, margin + contentWidth, y + 1);
      y += 3;
      continue;
    }
    const h2 = trimmed.match(/^## (.+)/);
    if (h2) {
      y += 3;
      ensureSpace(12);
      renderFormattedLine(h2[1], H2_FONT, 'bold', [25, 118, 210]);
      y += 1.5;
      continue;
    }
    const h3 = trimmed.match(/^### (.+)/);
    if (h3) {
      y += 2.5;
      ensureSpace(10);
      renderFormattedLine(h3[1], H3_FONT, 'bold', [55, 65, 81]);
      y += 1;
      continue;
    }

    // Bullet list
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      ensureSpace(7);
      pdf.setFontSize(BODY_FONT);
      pdf.setTextColor(55, 65, 81);
      pdf.text('\u2022', margin + 5, y);
      renderFormattedLine(bulletMatch[1], BODY_FONT, 'normal', [55, 65, 81], 12);
      y += 0.5;
      continue;
    }

    // Numbered list
    const numMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    if (numMatch) {
      ensureSpace(7);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(BODY_FONT);
      pdf.setTextColor(55, 65, 81);
      pdf.text(`${numMatch[1]}.`, margin + 4, y);
      pdf.setFont('helvetica', 'normal');
      renderFormattedLine(numMatch[2], BODY_FONT, 'normal', [55, 65, 81], 14);
      y += 0.5;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      y += 3;
      ensureSpace(6);
      pdf.setDrawColor(200, 212, 228);
      pdf.setLineWidth(0.3);
      pdf.line(margin, y, margin + contentWidth, y);
      y += 4;
      continue;
    }

    // Table rows (pipe-delimited markdown tables)
    if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      // Skip separator rows (e.g., |---|---| or |:---:|:---|)
      if (cells.every(c => /^[-:]+$/.test(c))) {
        (pdf as any).__tableSepSeen = true;
        continue;
      }
      // Skip completely empty rows (e.g., | | | | |)
      if (cells.every(c => c === '')) {
        continue;
      }

      // Determine column count from this row OR from previously stored header
      if (!(pdf as any).__tableStarted) {
        (pdf as any).__tableStarted = true;
        (pdf as any).__tableRowIdx = -1; // -1 = header row
        (pdf as any).__tableSepSeen = false;
        (pdf as any).__tableColCount = cells.length;
      }
      (pdf as any).__tableRowIdx = ((pdf as any).__tableRowIdx ?? -1) + 1;

      // Header = row index 0 (first row), body rows come after separator
      const isHeader = (pdf as any).__tableRowIdx === 0;
      const rowIdx: number = Math.max(0, (pdf as any).__tableRowIdx - 1);
      const colCount = Math.max((pdf as any).__tableColCount || cells.length, 1);
      const colW = contentWidth / colCount;
      const rowH = 7;
      ensureSpace(rowH + 2);

      // Reset ALL PDF state before drawing each table row to prevent
      // contamination from prior alert callouts, code blocks, etc.
      pdf.setDrawColor(210, 218, 228); // #D2DAE4 — visible border
      pdf.setLineWidth(0.2);
      pdf.setTextColor(31, 41, 55);    // dark gray text — always readable

      if (isHeader) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
      } else {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8.5);
      }

      const textY = y + rowH * 0.6;
      for (let ci = 0; ci < colCount; ci++) {
        const cx = margin + ci * colW;
        // Set fill color PER CELL to guarantee it's never black
        if (isHeader) {
          pdf.setFillColor(226, 232, 240); // #E2E8F0 — stronger header bg
        } else if (rowIdx % 2 === 0) {
          pdf.setFillColor(255, 255, 255); // white
        } else {
          pdf.setFillColor(248, 250, 252); // #F8FAFC — subtle zebra stripe
        }
        pdf.rect(cx, y, colW, rowH, 'FD');
        // Re-assert text color and font after each rect() draw
        pdf.setTextColor(31, 41, 55);
        if (isHeader) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9);
        } else {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8.5);
        }
        // Strip inline markdown (**bold**, *italic*) from table cells for clean PDF output
        const rawCell = (cells[ci] || '').substring(0, 60);
        const cellText = rawCell.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
        if (cellText) {
          // Truncate text to fit within column width (with padding)
          const maxTextW = colW - 5;
          let truncated = cellText;
          while (truncated.length > 1 && pdf.getTextWidth(truncated) > maxTextW) {
            truncated = truncated.substring(0, truncated.length - 1);
          }
          if (truncated.length < cellText.length && truncated.length > 2) {
            truncated = truncated.substring(0, truncated.length - 1) + '..';
          }
          pdf.text(truncated, cx + 2.5, textY);
        }
      }
      y += rowH;
      continue;
    }
    // Reset table tracking when we leave a table block
    if ((pdf as any).__tableStarted) {
      (pdf as any).__tableStarted = false;
      (pdf as any).__tableRowIdx = -1;
      (pdf as any).__tableColCount = 0;
      (pdf as any).__tableSepSeen = false;
      y += 2;
    }

    // Normal paragraph
    y += PARA_SPACE_BEFORE;
    ensureSpace(7);
    renderFormattedLine(trimmed, BODY_FONT, 'normal', [31, 41, 55]);
    y += PARA_SPACE_AFTER;
  }

  return y;
}

type ExportImages = {
  chartPreviewUrl?: string | null;
  dashboardChartImages?: Record<number, string>;
  dashboardCharts?: DashboardChartInfo[];
};

async function exportAsPdf(
  messages: ChatMessage[],
  images?: ExportImages,
  exportContext?: { mode?: string; context?: Record<string, unknown> },
  aiInfo?: { provider?: string; model?: string },
) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth(); // 210
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297
  const margin = 20;
  const contentWidth = pageWidth - margin * 2; // 170
  let y = margin;
  const brand = getBrandInfo();
  const brandTitle = buildExportTitle(brand, exportContext);

  // ── Cover / Title area ──
  pdf.setFillColor(25, 118, 210);
  pdf.rect(0, 0, pageWidth, 3, 'F');

  y = 28;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(24);
  pdf.setTextColor(25, 118, 210);
  pdf.text(brandTitle, margin, y);
  y += 10;

  // Accent rule
  pdf.setDrawColor(25, 118, 210);
  pdf.setLineWidth(0.6);
  pdf.line(margin, y, margin + 50, y);
  y += 7;

  // Date
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(130, 140, 155);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
  y += 10;

  /** Add a chart image to PDF preserving aspect ratio, centered — no border. */
  async function addChartImage(dataUrl: string, maxH: number) {
    try {
      const dim = await getImageDimensions(dataUrl);
      const fit = fitImage(dim.width, dim.height, contentWidth, maxH);
      const xOffset = margin + (contentWidth - fit.width) / 2;
      if (y + fit.height + 6 > pageHeight - 25) { pdf.addPage(); y = margin; }
      pdf.addImage(dataUrl, 'PNG', xOffset, y, fit.width, fit.height);
      y += fit.height + 6;
    } catch { /* skip */ }
  }

  // ── Chart preview image (single chart mode) — enlarged for full visibility ──
  if (images?.chartPreviewUrl) {
    await addChartImage(images.chartPreviewUrl, 180);
  }

  /** Match a ## heading to a dashboard chart. */
  function matchChartForSection(sectionTitle: string | undefined) {
    if (!sectionTitle || !images?.dashboardCharts) return undefined;
    const lower = sectionTitle.toLowerCase();
    return images.dashboardCharts.find(c =>
      lower.includes(c.sliceName.toLowerCase()) ||
      c.sliceName.toLowerCase().includes(lower),
    );
  }

  // ── Render only assistant content — no user messages or role labels ──
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const hasDashboardImages =
    images?.dashboardChartImages &&
    images?.dashboardCharts &&
    Object.keys(images.dashboardChartImages || {}).length > 0;

  for (const msg of assistantMsgs) {
    if (hasDashboardImages) {
      const sections = msg.content.split(/(?=^## )/m);
      for (const section of sections) {
        const headingMatch = section.match(/^## (.+)/m);
        const matched = matchChartForSection(headingMatch?.[1]?.trim());
        if (matched && images.dashboardChartImages![matched.chartId]) {
          if (y > pageHeight - 40) { pdf.addPage(); y = margin; }
          await addChartImage(images.dashboardChartImages![matched.chartId], 140);
        }
        y = renderMarkdownToPdf(pdf, section, y, pageWidth, margin);
        y += 4;
      }
    } else {
      if (y > pageHeight - 40) { pdf.addPage(); y = margin; }
      y = renderMarkdownToPdf(pdf, msg.content, y, pageWidth, margin);
    }
    y += 6;
  }

  // ── Headers & footers on every page ──
  const pageCount = pdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);

    if (i > 1) {
      pdf.setFillColor(25, 118, 210);
      pdf.rect(0, 0, pageWidth, 1.5, 'F');
    }

    // Header: brand name (page 2+)
    if (i > 1) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(156, 163, 175);
      pdf.text(brandTitle, margin, 8);
    }

    // Footer
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(156, 163, 175);
    const footerY = pageHeight - 8;
    pdf.setDrawColor(210, 218, 228);
    pdf.setLineWidth(0.15);
    pdf.line(margin, footerY - 3, pageWidth - margin, footerY - 3);
    const footerLeft = aiInfo?.provider
      ? `AI Insights — ${aiInfo.provider}${aiInfo.model ? ` / ${aiInfo.model}` : ''}`
      : 'AI Insights';
    pdf.text(footerLeft, margin, footerY);
    pdf.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - margin - pdf.getTextWidth(`Page ${i} of ${pageCount}`),
      footerY,
    );
  }

  pdf.save(`ai-insights-${Date.now()}.pdf`);
}

/**
 * Export conversation as a professionally formatted .docx file.
 * Uses dynamic import() so the `docx` package is not bundled into main chunk.
 *
 * Professional formatting: 1-inch margins, Calibri body / Calibri Light headings,
 * 11pt body text, proper heading hierarchy with colour, paragraph spacing matching
 * the on-screen AI Insight panel, and aspect-ratio-preserving chart images.
 */
async function exportAsDocx(
  messages: ChatMessage[],
  images?: ExportImages,
  exportContext?: { mode?: string; context?: Record<string, unknown> },
  aiInfo?: { provider?: string; model?: string },
) {
  const [
    { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ShadingType, ImageRun, TabStopType, TabStopPosition, Header: DocxHeader, Footer: DocxFooter, PageNumber, Table, TableRow, TableCell, WidthType },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')]);

  // Typography constants (half-points: 22 = 11pt)
  const BODY_SIZE = 22;      // 11pt
  const BODY_FONT = 'Calibri';
  const HEADING_FONT = 'Calibri Light';
  const CODE_FONT = 'Consolas';
  const CODE_SIZE = 20;      // 10pt
  const LABEL_SIZE = 20;     // 10pt

  // Spacing (twips: 20 twips = 1pt, 240 twips = 12pt)
  const SP_PARA_BEFORE = 80;   // 4pt
  const SP_PARA_AFTER = 80;    // 4pt
  const SP_H1_BEFORE = 320;    // 16pt
  const SP_H1_AFTER = 160;     // 8pt
  const SP_H2_BEFORE = 260;    // 13pt
  const SP_H2_AFTER = 120;     // 6pt
  const SP_H3_BEFORE = 200;    // 10pt
  const SP_H3_AFTER = 80;      // 4pt
  const SP_LIST_BEFORE = 40;   // 2pt
  const SP_LIST_AFTER = 40;    // 2pt
  const SP_SECTION = 300;      // 15pt — between message blocks

  // Usable image width (A4 at 1" margins → ~6.27" ≈ 451pt, in EMU/pixel terms ~595px)
  const MAX_IMG_W = 580;
  const MAX_IMG_H = 360;

  /** Parse inline **bold**, *italic*, `code` into TextRun objects. */
  function parseInline(text: string, baseSz = BODY_SIZE) {
    const runs: InstanceType<typeof TextRun>[] = [];
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|([^*`]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        runs.push(new TextRun({ text: match[1], bold: true, size: baseSz, font: BODY_FONT }));
      } else if (match[2]) {
        runs.push(new TextRun({ text: match[2], italics: true, size: baseSz, font: BODY_FONT }));
      } else if (match[3]) {
        runs.push(new TextRun({
          text: match[3], font: CODE_FONT, size: CODE_SIZE,
          shading: { type: ShadingType.SOLID, color: 'F3F4F6' },
        }));
      } else if (match[4]) {
        runs.push(new TextRun({ text: match[4], size: baseSz, font: BODY_FONT }));
      }
    }
    return runs.length ? runs : [new TextRun({ text, size: baseSz, font: BODY_FONT })];
  }

  /** Convert markdown text to docx Paragraph objects with professional spacing. */
  function markdownToDocx(text: string) {
    const paragraphs: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
    const lines = proofreadInsight(text).split('\n');
    let inCodeBlock = false;

    // Collect table rows to flush as a single Table object
    let tableRows: string[][] = [];
    function flushTable() {
      if (tableRows.length === 0) return;
      const colCount = Math.max(...tableRows.map(r => r.length));
      const colWidthPct = Math.floor(100 / Math.max(colCount, 1));
      const rows = tableRows.map((cells, ri) =>
        new TableRow({
          children: Array.from({ length: colCount }, (_, ci) =>
            new TableCell({
              children: [new Paragraph({
                children: ri === 0
                  ? [new TextRun({ text: cells[ci] || '', bold: true, size: BODY_SIZE - 2, font: BODY_FONT, color: '1F2937' })]
                  : parseInline(cells[ci] || '', BODY_SIZE - 2),
                spacing: { before: 20, after: 20 },
              })],
              width: { size: colWidthPct, type: WidthType.PERCENTAGE },
              shading: ri === 0
                ? { type: ShadingType.SOLID, color: 'E6EAF0' }
                : ri % 2 === 0
                  ? { type: ShadingType.SOLID, color: 'F8FAFC' }
                  : undefined,
            }),
          ),
        }),
      );
      paragraphs.push(new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
      // Space after table
      paragraphs.push(new Paragraph({ spacing: { before: 80, after: 80 } }));
      tableRows = [];
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) {
        flushTable();
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: line, font: CODE_FONT, size: CODE_SIZE, color: '1E293B' })],
          shading: { type: ShadingType.SOLID, color: 'F3F4F6' },
          spacing: { before: 20, after: 20, line: 276 },
          indent: { left: 200 },
        }));
        continue;
      }

      // Table rows (pipe-delimited)
      if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
        const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        // Skip separator rows
        if (cells.every(c => /^[-:]+$/.test(c))) continue;
        tableRows.push(cells);
        continue;
      }
      // Flush accumulated table rows when we leave a table block
      flushTable();

      if (!trimmed) {
        paragraphs.push(new Paragraph({ spacing: { before: SP_PARA_BEFORE, after: SP_PARA_AFTER } }));
        continue;
      }

      // Alert callouts
      const alertMatch = trimmed.match(/^\[(CRITICAL|WARNING|GOOD|INFO)\]\s*(.*)/);
      if (alertMatch) {
        const [, tag, body] = alertMatch;
        const colors: Record<string, { bg: string; border: string; text: string }> = {
          CRITICAL: { bg: 'FEF2F2', border: 'DC2626', text: '991B1B' },
          WARNING:  { bg: 'FFFBEB', border: 'F59E0B', text: '92400E' },
          GOOD:     { bg: 'F0FDF4', border: '16A34A', text: '166534' },
          INFO:     { bg: 'EFF6FF', border: '3B82F6', text: '1E40AF' },
        };
        const c = colors[tag] || colors.INFO;
        paragraphs.push(new Paragraph({
          children: [
            new TextRun({ text: `${ALERT_TAGS[tag]?.label || tag}  `, bold: true, color: c.border, size: BODY_SIZE, font: BODY_FONT }),
            ...parseInline(body),
          ],
          shading: { type: ShadingType.SOLID, color: c.bg },
          spacing: { before: 160, after: 160, line: 300 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: c.border, space: 8 } },
          indent: { left: 240 },
        }));
        continue;
      }

      // Headings
      const h1 = trimmed.match(/^# (.+)/);
      if (h1) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: h1[1], bold: true, size: 32, color: '1976D2', font: HEADING_FONT })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: SP_H1_BEFORE, after: SP_H1_AFTER, line: 276 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C8D4E4', space: 4 } },
        }));
        continue;
      }
      const h2 = trimmed.match(/^## (.+)/);
      if (h2) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: h2[1], bold: true, size: 26, color: '1976D2', font: HEADING_FONT })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: SP_H2_BEFORE, after: SP_H2_AFTER, line: 276 },
        }));
        continue;
      }
      const h3 = trimmed.match(/^### (.+)/);
      if (h3) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: h3[1], bold: true, size: 24, color: '374151', font: HEADING_FONT })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: SP_H3_BEFORE, after: SP_H3_AFTER, line: 276 },
        }));
        continue;
      }

      // Bullet list
      const bullet = trimmed.match(/^[\s]*[-*]\s+(.+)/);
      if (bullet) {
        paragraphs.push(new Paragraph({
          children: parseInline(bullet[1]),
          bullet: { level: 0 },
          spacing: { before: SP_LIST_BEFORE, after: SP_LIST_AFTER, line: 276 },
        }));
        continue;
      }

      // Numbered list
      const num = trimmed.match(/^[\s]*(\d+)[.)]\s+(.+)/);
      if (num) {
        paragraphs.push(new Paragraph({
          children: [
            new TextRun({ text: `${num[1]}. `, bold: true, size: BODY_SIZE, font: BODY_FONT }),
            ...parseInline(num[2]),
          ],
          spacing: { before: SP_LIST_BEFORE, after: SP_LIST_AFTER, line: 276 },
          indent: { left: 360 },
        }));
        continue;
      }

      // Horizontal rule
      if (/^---+$/.test(trimmed)) {
        paragraphs.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D8E4' } },
          spacing: { before: 160, after: 160 },
        }));
        continue;
      }

      // Normal paragraph
      paragraphs.push(new Paragraph({
        children: parseInline(trimmed),
        spacing: { before: SP_PARA_BEFORE, after: SP_PARA_AFTER, line: 300 },
      }));
    }
    flushTable(); // flush any trailing table
    return paragraphs;
  }

  /** Data-URL → Uint8Array for ImageRun. */
  function dataUrlToUint8Array(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** Create an ImageRun preserving aspect ratio within max bounds. */
  async function makeImageRun(dataUrl: string, maxW = MAX_IMG_W, maxH = MAX_IMG_H) {
    const dim = await getImageDimensions(dataUrl);
    const fit = fitImage(dim.width, dim.height, maxW, maxH);
    return new ImageRun({
      data: dataUrlToUint8Array(dataUrl),
      transformation: { width: Math.round(fit.width), height: Math.round(fit.height) },
      type: 'png',
    });
  }

  // ── Build document content ──
  const brand = getBrandInfo();
  const brandTitle = buildExportTitle(brand, exportContext);
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  // Title — use dynamic brand + dashboard/chart name
  children.push(new Paragraph({
    children: [new TextRun({ text: brandTitle, bold: true, size: 44, color: '1976D2', font: HEADING_FONT })],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.LEFT,
    spacing: { after: 60 },
  }));
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '1976D2', space: 2 } },
    spacing: { after: 120 },
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: `Generated: ${new Date().toLocaleString()}`, size: 18, color: '9CA3AF', italics: true, font: BODY_FONT }),
    ],
    spacing: { after: SP_SECTION },
  }));

  // Chart preview (single chart mode)
  if (images?.chartPreviewUrl) {
    try {
      const imgRun = await makeImageRun(images.chartPreviewUrl);
      children.push(new Paragraph({
        children: [imgRun],
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
      }));
    } catch { /* skip */ }
  }

  /** Match a ## heading to a dashboard chart. */
  function matchChartDocx(sectionTitle: string | undefined) {
    if (!sectionTitle || !images?.dashboardCharts) return undefined;
    const lower = sectionTitle.toLowerCase();
    return images.dashboardCharts.find(c =>
      lower.includes(c.sliceName.toLowerCase()) ||
      c.sliceName.toLowerCase().includes(lower),
    );
  }

  // ── Render only assistant content — no user messages or role labels ──
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const hasDashboardImages =
    images?.dashboardChartImages &&
    images?.dashboardCharts &&
    Object.keys(images.dashboardChartImages || {}).length > 0;

  for (const msg of assistantMsgs) {
    if (hasDashboardImages) {
      const sections = msg.content.split(/(?=^## )/m);
      for (const section of sections) {
        const headingMatch = section.match(/^## (.+)/m);
        const matched = matchChartDocx(headingMatch?.[1]?.trim());
        if (matched && images.dashboardChartImages![matched.chartId]) {
          try {
            const imgRun = await makeImageRun(images.dashboardChartImages![matched.chartId], MAX_IMG_W, 280);
            children.push(new Paragraph({
              children: [imgRun],
              alignment: AlignmentType.CENTER,
              spacing: { before: SP_SECTION, after: 120 },
            }));
          } catch { /* skip */ }
        }
        children.push(...markdownToDocx(section));
      }
    } else {
      children.push(...markdownToDocx(msg.content));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: BODY_SIZE },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new DocxHeader({
          children: [new Paragraph({
            children: [new TextRun({ text: brandTitle, size: 16, color: 'B0B8C8', italics: true, font: BODY_FONT })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      footers: {
        default: new DocxFooter({
          children: [new Paragraph({
            children: [
              new TextRun({ text: aiInfo?.provider ? `AI Insights \u2014 ${aiInfo.provider}${aiInfo.model ? ` / ${aiInfo.model}` : ''}` : 'AI Insights', size: 16, color: '9CA3AF', font: BODY_FONT }),
              new TextRun({ text: '\t', size: 16 }),
              new TextRun({ text: '\t', size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '9CA3AF', font: BODY_FONT }),
              new TextRun({ text: ' / ', size: 16, color: '9CA3AF', font: BODY_FONT }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '9CA3AF', font: BODY_FONT }),
            ],
            tabStops: [
              { type: TabStopType.CENTER, position: TabStopPosition.MAX / 2 },
              { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
            ],
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'D0D8E4', space: 4 } },
          })],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `ai-insights-${Date.now()}.docx`);
}

/**
 * Export conversation as a professionally designed .pptx file.
 * Uses dynamic import() to avoid bundling pptxgenjs into the main chunk.
 *
 * Professional design: branded title slide with accent bar, consistent
 * slide master (header strip + footer), proper typography hierarchy,
 * aspect-ratio-preserving chart images, and readable content layout.
 */
async function exportAsPptx(
  messages: ChatMessage[],
  images?: ExportImages,
  exportContext?: { mode?: string; context?: Record<string, unknown> },
  aiInfo?: { provider?: string; model?: string },
) {
  const PptxGenJS = (await import('pptxgenjs')).default;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33" × 7.5"
  const pptxBrand = getBrandInfo();
  pptx.author = pptxBrand.text || pptxBrand.name;
  pptx.title = pptxBrand.text || pptxBrand.name;
  pptx.subject = 'Executive Insights Presentation';

  // ── Design constants ──
  const brandInfo = getBrandInfo();
  const brandTitle = buildExportTitle(brandInfo, exportContext);
  const BRAND = '1976D2';
  const BRAND_DARK = '0D47A1';
  const DARK = '1F2937';
  const GRAY = '6B7280';
  const LIGHT_BG = 'F8FAFC';
  const FONT = 'Calibri';
  const SLIDE_W = 13.33;
  const SLIDE_H = 7.5;
  const CONTENT_X = 0.7;
  const CONTENT_Y = 1.15;
  const CONTENT_W = SLIDE_W - 1.4;
  const CONTENT_H = SLIDE_H - 1.95;

  // Alert colours for PPTX
  const PPTX_ALERT: Record<string, { label: string; color: string; bg: string }> = {
    CRITICAL: { label: 'Critical', color: 'DC2626', bg: 'FEF2F2' },
    WARNING:  { label: 'Warning',  color: 'D97706', bg: 'FFFBEB' },
    GOOD:     { label: 'Good',     color: '16A34A', bg: 'F0FDF4' },
    INFO:     { label: 'Info',     color: '3B82F6', bg: 'EFF6FF' },
  };

  /** Apply the professional master layout to a content slide. */
  function applyMaster(slide: any, title: string, slideNum?: string) {
    // Top accent bar
    slide.addShape('rect', {
      x: 0, y: 0, w: SLIDE_W, h: 0.08,
      fill: { color: BRAND },
    });
    // Header background (taller to fit 24pt title)
    slide.addShape('rect', {
      x: 0, y: 0.08, w: SLIDE_W, h: 0.82,
      fill: { color: LIGHT_BG },
    });
    // Header divider line
    slide.addShape('line', {
      x: 0, y: 0.9, w: SLIDE_W, h: 0,
      line: { color: 'D0D8E4', width: 0.5 },
    });
    // Slide title in header — insight-led titles (6×6 rule: visible from back of room)
    slide.addText(title, {
      x: 0.6, y: 0.12, w: 11.5, h: 0.6,
      fontSize: 24, bold: true, color: BRAND, fontFace: FONT,
    });
    // Footer separator
    slide.addShape('line', {
      x: 0.5, y: SLIDE_H - 0.5, w: SLIDE_W - 1, h: 0,
      line: { color: 'D0D8E4', width: 0.5 },
    });
    // Footer text
    const pptxFooter = aiInfo?.provider
      ? `${brandTitle} — AI Insights — ${aiInfo.provider}${aiInfo.model ? ` / ${aiInfo.model}` : ''}`
      : `${brandTitle} — AI Insights`;
    slide.addText(pptxFooter, {
      x: 0.6, y: SLIDE_H - 0.45, w: 8, h: 0.3,
      fontSize: 8, color: GRAY, fontFace: FONT,
    });
    if (slideNum) {
      slide.addText(slideNum, {
        x: SLIDE_W - 1.5, y: SLIDE_H - 0.45, w: 1, h: 0.3,
        fontSize: 8, color: GRAY, fontFace: FONT, align: 'right',
      });
    }
  }

  /** Fit chart image into a pptx slide preserving aspect ratio, centered. */
  async function addChartSlide(
    dataUrl: string,
    title: string,
    slideIdx: number,
  ) {
    try {
      const slide = pptx.addSlide();
      applyMaster(slide, title, `${slideIdx}`);
      const dim = await getImageDimensions(dataUrl);
      const maxW = SLIDE_W - 1.4;
      const maxH = SLIDE_H - 2.0;
      const fit = fitImage(dim.width, dim.height, maxW * 96, maxH * 96);
      const wIn = fit.width / 96;
      const hIn = fit.height / 96;
      const xOff = (SLIDE_W - wIn) / 2;
      const yOff = 1.0 + (maxH - hIn) / 2;
      slide.addImage({ data: dataUrl, x: xOff, y: yOff, w: wIn, h: hIn });
    } catch { /* skip */ }
  }

  /** Parse inline markdown **bold**, *italic*, `code` into pptxgenjs text objects. */
  function parseInlinePptx(
    text: string,
    baseFontSize: number,
    baseColor: string,
  ): Array<{ text: string; options: Record<string, unknown> }> {
    const segments: Array<{ text: string; options: Record<string, unknown> }> = [];
    const regex = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|([^*`]+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[1]) {
        segments.push({ text: m[1], options: { fontSize: baseFontSize, bold: true, italic: true, color: baseColor, fontFace: FONT } });
      } else if (m[2]) {
        segments.push({ text: m[2], options: { fontSize: baseFontSize, bold: true, color: baseColor, fontFace: FONT } });
      } else if (m[3]) {
        segments.push({ text: m[3], options: { fontSize: baseFontSize, italic: true, color: baseColor, fontFace: FONT } });
      } else if (m[4]) {
        segments.push({ text: m[4], options: { fontSize: baseFontSize - 1, color: '374151', fontFace: 'Consolas' } });
      } else if (m[5]) {
        segments.push({ text: m[5], options: { fontSize: baseFontSize, color: baseColor, fontFace: FONT } });
      }
    }
    if (!segments.length) segments.push({ text, options: { fontSize: baseFontSize, color: baseColor, fontFace: FONT } });
    return segments;
  }

  /** Parse markdown into structured slide content blocks. */
  type SlideBlock =
    | { type: 'text'; parts: Array<{ text: string; options: Record<string, unknown> }> }
    | { type: 'table'; rows: string[][] };

  function markdownToSlideBlocks(text: string, skipFirstH2 = false): SlideBlock[] {
    const blocks: SlideBlock[] = [];
    const lines = proofreadInsight(text).split('\n');
    let currentParts: Array<{ text: string; options: Record<string, unknown> }> = [];
    let tableRows: string[][] = [];
    let inCodeBlock = false;
    let skippedFirstH2 = false;

    function flushParts() {
      if (currentParts.length) {
        blocks.push({ type: 'text', parts: [...currentParts] });
        currentParts = [];
      }
    }
    function flushTable() {
      if (tableRows.length) {
        blocks.push({ type: 'table', rows: [...tableRows] });
        tableRows = [];
      }
    }

    for (let li = 0; li < lines.length; li++) {
      const trimmed = lines[li].trim();

      // Code blocks — render as monospace text
      if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) {
        currentParts.push({ text: `${trimmed}\n`, options: { fontSize: 11, color: '374151', fontFace: 'Consolas' } });
        continue;
      }

      // Table rows
      if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
        const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c))) continue;
        flushParts();
        tableRows.push(cells);
        continue;
      }
      if (tableRows.length) { flushTable(); }

      if (!trimmed) {
        currentParts.push({ text: '\n', options: { fontSize: 8 } });
        continue;
      }

      // Alert callouts — with multi-line body support
      const alertMatch = trimmed.match(/^\[(CRITICAL|WARNING|GOOD|INFO)\]\s*(.*)/);
      if (alertMatch) {
        const [, tag, sameLine] = alertMatch;
        const bodyParts: string[] = [];
        if (sameLine.trim()) bodyParts.push(sameLine.trim());
        while (li + 1 < lines.length) {
          const nextTrimmed = lines[li + 1].trim();
          if (!nextTrimmed || /^\[(CRITICAL|WARNING|GOOD|INFO)\]/.test(nextTrimmed) || /^#{1,3} /.test(nextTrimmed)) break;
          bodyParts.push(nextTrimmed);
          li++;
        }
        const body = bodyParts.join(' ');
        const a = PPTX_ALERT[tag] || PPTX_ALERT.INFO;
        currentParts.push({ text: '\n', options: { fontSize: 8 } });
        currentParts.push({ text: ` ${a.label} `, options: { fontSize: 18, bold: true, color: 'FFFFFF', highlight: a.color, fontFace: FONT } });
        currentParts.push(...parseInlinePptx(`  ${body}\n`, 20, DARK));
        continue;
      }

      // Headings
      const h1 = trimmed.match(/^# (.+)/);
      if (h1) {
        currentParts.push({ text: '\n', options: { fontSize: 8 } });
        currentParts.push({ text: `${h1[1]}\n`, options: { fontSize: 24, bold: true, color: BRAND, fontFace: FONT } });
        continue;
      }
      const h2 = trimmed.match(/^## (.+)/);
      if (h2) {
        // Skip the first H2 — it's already rendered as the slide header by applyMaster
        if (skipFirstH2 && !skippedFirstH2) {
          skippedFirstH2 = true;
          continue;
        }
        currentParts.push({ text: '\n', options: { fontSize: 8 } });
        currentParts.push({ text: `${h2[1]}\n`, options: { fontSize: 28, bold: true, color: BRAND, fontFace: FONT } });
        continue;
      }
      const h3 = trimmed.match(/^### (.+)/);
      if (h3) {
        currentParts.push({ text: '\n', options: { fontSize: 8 } });
        currentParts.push({ text: `${h3[1]}\n`, options: { fontSize: 24, bold: true, color: DARK, fontFace: FONT } });
        continue;
      }

      // Bullet list — preserve bold/italic (6×6 rule: 20pt for readability)
      const bullet = trimmed.match(/^[-*]\s+(.+)/);
      if (bullet) {
        currentParts.push({ text: '   \u2022  ', options: { fontSize: 20, color: DARK, fontFace: FONT } });
        currentParts.push(...parseInlinePptx(bullet[1], 20, DARK));
        currentParts.push({ text: '\n', options: { fontSize: 20 } });
        continue;
      }

      // Numbered list
      const num = trimmed.match(/^(\d+)[.)]\s+(.+)/);
      if (num) {
        currentParts.push({ text: `   ${num[1]}.  `, options: { fontSize: 20, bold: true, color: DARK, fontFace: FONT } });
        currentParts.push(...parseInlinePptx(num[2], 20, DARK));
        currentParts.push({ text: '\n', options: { fontSize: 20 } });
        continue;
      }

      // Horizontal rule
      if (/^---+$/.test(trimmed)) {
        currentParts.push({ text: '\n', options: { fontSize: 8 } });
        continue;
      }

      // Normal paragraph — preserve bold/italic (6×6 rule: 20pt)
      currentParts.push(...parseInlinePptx(trimmed, 20, DARK));
      currentParts.push({ text: '\n', options: { fontSize: 20 } });
    }
    flushParts();
    flushTable();
    return blocks;
  }

  /** Render slide blocks onto slides, creating new slides as needed.
   *  Tables get their own slide. Text blocks are chunked to fit. */
  function renderBlocksToSlides(blocks: SlideBlock[], label: string) {
    // 6×6 rule: max ~6 content items per slide for readability
    const TEXT_PARTS_PER_SLIDE = 12;

    for (const block of blocks) {
      if (block.type === 'table') {
        // Render table on its own slide
        slideCount += 1;
        const slide = pptx.addSlide();
        applyMaster(slide, label, `${slideCount}`);
        const colCount = Math.max(...block.rows.map(r => r.length));
        const colW = CONTENT_W / Math.max(colCount, 1);
        const tblRows = block.rows.map((cells, ri) =>
          Array.from({ length: colCount }, (_, ci) => ({
            text: (cells[ci] || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1'),
            options: {
              fontSize: ri === 0 ? 16 : 14,
              bold: ri === 0,
              color: DARK,
              fontFace: FONT,
              fill: ri === 0 ? { color: 'E6EAF0' } : ri % 2 === 0 ? { color: 'F8FAFC' } : undefined,
              border: [
                { type: 'solid' as const, pt: 0.5, color: 'D0D8E4' },
                { type: 'solid' as const, pt: 0.5, color: 'D0D8E4' },
                { type: 'solid' as const, pt: 0.5, color: 'D0D8E4' },
                { type: 'solid' as const, pt: 0.5, color: 'D0D8E4' },
              ],
              valign: 'middle' as const,
              margin: [3, 6, 3, 6],
            },
          })),
        );
        slide.addTable(tblRows, {
          x: CONTENT_X,
          y: CONTENT_Y,
          w: CONTENT_W,
          colW: Array(colCount).fill(colW),
          rowH: 0.35,
          autoPage: false,
        });
        continue;
      }

      // Text blocks — chunk into slides
      const parts = block.parts;
      for (let j = 0; j < parts.length; j += TEXT_PARTS_PER_SLIDE) {
        const chunk = parts.slice(j, j + TEXT_PARTS_PER_SLIDE);
        slideCount += 1;
        const slide = pptx.addSlide();
        const title = j === 0 ? label : `${label} (cont.)`;
        applyMaster(slide, title, `${slideCount}`);
        slide.addText(chunk as any, {
          x: CONTENT_X, y: CONTENT_Y, w: CONTENT_W, h: CONTENT_H,
          fontSize: 20, color: DARK, fontFace: FONT,
          valign: 'top', lineSpacingMultiple: 1.3,
          paraSpaceAfter: 6,
        });
      }
    }
  }

  // ── Slide counter ──
  let slideCount = 0;

  // ── TITLE SLIDE ──
  const titleSlide = pptx.addSlide();
  slideCount += 1;

  // Full-bleed background
  titleSlide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fill: { color: 'FFFFFF' },
  });
  // Left accent column
  titleSlide.addShape('rect', {
    x: 0, y: 0, w: 0.5, h: SLIDE_H,
    fill: { color: BRAND },
  });
  // Top accent bar
  titleSlide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W, h: 0.12,
    fill: { color: BRAND },
  });
  // Bottom accent bar
  titleSlide.addShape('rect', {
    x: 0, y: SLIDE_H - 0.12, w: SLIDE_W, h: 0.12,
    fill: { color: BRAND_DARK },
  });
  // Decorative background box
  titleSlide.addShape('rect', {
    x: 0.5, y: 1.8, w: 8, h: 3.5,
    fill: { color: LIGHT_BG },
    rectRadius: 0.1,
  });

  // Brand title on title slide; extract first H1 as subtitle
  const allAssistant = messages.filter(m => m.role === 'assistant');
  const firstContent = allAssistant[0]?.content || '';
  const titleMatch = firstContent.match(/^# (.+)/m);
  const subtitle = titleMatch?.[1]?.trim() || 'Data-Driven Analysis & Recommendations';

  titleSlide.addText(brandTitle, {
    x: 1.2, y: 2.2, w: 8, h: 1.2,
    fontSize: 36, bold: true, color: BRAND_DARK, fontFace: FONT,
    lineSpacingMultiple: 1.1,
  });
  titleSlide.addText(subtitle, {
    x: 1.2, y: 3.3, w: 7, h: 0.5,
    fontSize: 16, color: GRAY, fontFace: FONT,
  });
  titleSlide.addShape('line', {
    x: 1.2, y: 4.0, w: 3, h: 0,
    line: { color: BRAND, width: 2 },
  });
  titleSlide.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), {
    x: 1.2, y: 4.3, w: 5, h: 0.4,
    fontSize: 13, color: GRAY, fontFace: FONT,
  });

  // ── Chart preview slide (single chart mode) ──
  if (images?.chartPreviewUrl) {
    slideCount += 1;
    await addChartSlide(images.chartPreviewUrl, 'Chart Analyzed', slideCount);
  }

  /** Match a ## heading text to a dashboard chart. */
  function matchChartPptx(sectionTitle: string | undefined) {
    if (!sectionTitle || !images?.dashboardCharts) return undefined;
    const lower = sectionTitle.toLowerCase();
    return images.dashboardCharts.find(c =>
      lower.includes(c.sliceName.toLowerCase()) ||
      c.sliceName.toLowerCase().includes(lower),
    );
  }

  // ── Section divider slide — visual separator between major sections ──
  function addSectionDivider(title: string, subtitle: string, accentColor: string) {
    slideCount += 1;
    const slide = pptx.addSlide();
    // Full background
    slide.addShape('rect', {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fill: { color: 'FFFFFF' },
    });
    // Left accent strip
    slide.addShape('rect', {
      x: 0, y: 0, w: 0.15, h: SLIDE_H,
      fill: { color: accentColor },
    });
    // Large decorative circle (top-right)
    slide.addShape('ellipse', {
      x: SLIDE_W - 3.5, y: -1.5, w: 5, h: 5,
      fill: { color: accentColor, type: 'solid' },
      line: { color: accentColor, width: 0 },
    });
    // Smaller accent circle (bottom-left)
    slide.addShape('ellipse', {
      x: -1, y: SLIDE_H - 2, w: 3, h: 3,
      fill: { color: LIGHT_BG, type: 'solid' },
      line: { color: 'E0E4EB', width: 1 },
    });
    // Section number / decorative bar
    slide.addShape('rect', {
      x: 1.2, y: 2.8, w: 2.5, h: 0.06,
      fill: { color: accentColor },
    });
    // Section title
    slide.addText(title, {
      x: 1.2, y: 3.0, w: 9, h: 1.2,
      fontSize: 36, bold: true, color: DARK, fontFace: FONT,
    });
    // Subtitle
    slide.addText(subtitle, {
      x: 1.2, y: 4.1, w: 8, h: 0.6,
      fontSize: 20, color: GRAY, fontFace: FONT,
    });
    // Footer
    const dividerFooter = aiInfo?.provider
      ? `${brandTitle} — AI Insights — ${aiInfo.provider}${aiInfo.model ? ` / ${aiInfo.model}` : ''}`
      : `${brandTitle} — AI Insights`;
    slide.addText(dividerFooter, {
      x: 0.6, y: SLIDE_H - 0.45, w: 8, h: 0.3,
      fontSize: 8, color: GRAY, fontFace: FONT,
    });
  }

  /** Add a visual KPI summary slide with colored stat boxes (dashboard overview). */
  function addDashboardOverviewSlide(charts: { sliceName: string; chartId: number }[]) {
    slideCount += 1;
    const slide = pptx.addSlide();
    applyMaster(slide, 'Dashboard Overview', `${slideCount}`);
    const count = Math.min(charts.length, 8);
    const cols = count <= 4 ? count : Math.ceil(count / 2);
    const rows = count <= 4 ? 1 : 2;
    const boxW = Math.min(2.8, (CONTENT_W - (cols - 1) * 0.3) / cols);
    const boxH = 1.4;
    const startX = CONTENT_X + (CONTENT_W - (cols * boxW + (cols - 1) * 0.3)) / 2;
    const startY = CONTENT_Y + 0.5;
    const chartColors = ['1976D2', 'E53935', '43A047', 'FB8C00', '8E24AA', '00ACC1', 'D81B60', '3949AB'];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = startX + col * (boxW + 0.3);
      const cy = startY + row * (boxH + 0.4);
      const color = chartColors[i % chartColors.length];
      // Card background
      slide.addShape('roundRect', {
        x: cx, y: cy, w: boxW, h: boxH,
        fill: { color: 'FFFFFF' },
        shadow: { type: 'outer', blur: 3, offset: 1, color: '00000015' },
        line: { color: 'E0E4EB', width: 0.5 },
        rectRadius: 0.08,
      });
      // Color accent bar at top of card
      slide.addShape('rect', {
        x: cx, y: cy, w: boxW, h: 0.06,
        fill: { color },
      });
      // Chart name
      slide.addText(charts[i].sliceName, {
        x: cx + 0.15, y: cy + 0.2, w: boxW - 0.3, h: 1.0,
        fontSize: 14, color: DARK, fontFace: FONT,
        valign: 'middle',
        wrap: true,
      });
    }
    // Subtitle text
    slide.addText(`${charts.length} charts analyzed in this dashboard`, {
      x: CONTENT_X, y: startY + rows * (boxH + 0.4) + 0.3, w: CONTENT_W, h: 0.4,
      fontSize: 16, color: GRAY, fontFace: FONT, align: 'center',
    });
  }

  // ── Content slides — one key message per section ──
  const hasDashboardImages =
    images?.dashboardChartImages &&
    images?.dashboardCharts &&
    Object.keys(images.dashboardChartImages).length > 0;

  // Dashboard mode: add overview slide with chart cards
  if (images?.dashboardCharts && images.dashboardCharts.length > 0) {
    addDashboardOverviewSlide(images.dashboardCharts);
  }

  // Track which major sections we've seen for divider slides
  const sectionDividers: Record<string, boolean> = {};

  for (let idx = 0; idx < allAssistant.length; idx++) {
    const msg = allAssistant[idx];

    // Split by ## sections — each becomes its own slide group
    // This ensures one key message per slide (executive presentation rule)
    const sections = msg.content.split(/(?=^## )/m);

    for (const section of sections) {
      const headingMatch = section.match(/^## (.+)/m);
      const sectionTitle = headingMatch?.[1]?.trim();

      // Insert visual section divider for major structure sections
      if (sectionTitle) {
        const titleLower = sectionTitle.toLowerCase();
        if (titleLower.includes('executive summary') && !sectionDividers.exec) {
          sectionDividers.exec = true;
          addSectionDivider('Executive Summary', 'Key findings and strategic overview', BRAND);
        } else if ((titleLower.includes('detailed analysis') || titleLower.includes('chart by chart')) && !sectionDividers.detail) {
          sectionDividers.detail = true;
          addSectionDivider('Detailed Analysis', 'Chart-by-chart breakdown with key insights', '43A047');
        } else if ((titleLower.includes('recommendation') || titleLower.includes('action')) && !sectionDividers.action) {
          sectionDividers.action = true;
          addSectionDivider('Action Recommendations', 'Prioritized next steps based on the analysis', 'E53935');
        }
      }

      // Dashboard mode: insert chart image slide before matching section
      if (hasDashboardImages && sectionTitle) {
        const matched = matchChartPptx(sectionTitle);
        if (matched && images.dashboardChartImages![matched.chartId]) {
          slideCount += 1;
          await addChartSlide(
            images.dashboardChartImages![matched.chartId],
            matched.sliceName,
            slideCount,
          );
        }
      }

      // Convert section markdown to structured blocks (text + tables)
      // skipFirstH2=true: the ## heading is already used as slide header by applyMaster
      const blocks = markdownToSlideBlocks(section, !!sectionTitle);
      if (blocks.length > 0) {
        renderBlocksToSlides(
          blocks,
          sectionTitle || `Insight ${idx + 1}`,
        );
      }
    }
  }

  pptx.writeFile({ fileName: `ai-insights-${Date.now()}.pptx` });
}

/* ── Component ───────────────────────────────────────── */

let msgIdCounter = 0;
function nextMsgId() {
  msgIdCounter += 1;
  return `msg-${Date.now()}-${msgIdCounter}`;
}

export default function AIInsightPanel({
  mode,
  context,
  targetId,
  defaultQuestion,
  currentSql,
  databaseId,
  schema,
  onApplySql,
  onRunSql,
  showHistory = true,
  chartNodeSelector,
  dashboardCharts,
}: Props) {
  const { addDangerToast } = useToasts();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [capabilities, setCapabilities] = useState<AICapabilities | null>(null);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<
    AIConversationMessage[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');

  // Conversation persistence
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [savedConversations, setSavedConversations] = useState<
    AIConversationSummary[]
  >([]);

  // SQL-specific state
  const [lastSql, setLastSql] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AIInsightResult | null>(null);

  // Chart preview screenshot (chart mode)
  const [chartPreviewUrl, setChartPreviewUrl] = useState<string | null>(null);
  // Dashboard chart screenshots (dashboard chart-by-chart mode)
  const [dashboardChartImages, setDashboardChartImages] = useState<
    Record<number, string>
  >({});
  // Dashboard analysis mode: 'overall' or 'chart_by_chart'
  const [dashboardAnalysisMode, setDashboardAnalysisMode] = useState<
    'overall' | 'chart_by_chart'
  >('overall');

  // Capture chart screenshot on mount (chart mode)
  useEffect(() => {
    if (mode === 'chart' && chartNodeSelector) {
      captureElementAsImage(chartNodeSelector).then(url => {
        if (url) setChartPreviewUrl(url);
      });
    }
  }, [mode, chartNodeSelector]);

  // Capture dashboard chart screenshots when switching to chart-by-chart mode
  useEffect(() => {
    if (
      mode === 'dashboard' &&
      dashboardAnalysisMode === 'chart_by_chart' &&
      dashboardCharts?.length
    ) {
      dashboardCharts.forEach(chart => {
        if (!dashboardChartImages[chart.chartId]) {
          const selector = `.dashboard-chart-id-${chart.chartId}`;
          captureElementAsImage(selector).then(url => {
            if (url) {
              setDashboardChartImages(prev => ({
                ...prev,
                [chart.chartId]: url,
              }));
            }
          });
        }
      });
    }
  }, [mode, dashboardAnalysisMode, dashboardCharts, dashboardChartImages]);

  // MART table browser (SQL mode)
  type MartTableInfo = {
    dataset_id: number;
    table_name: string;
    dataset_name: string;
    schema?: string;
    description?: string;
    columns: { name: string; type: string }[];
    column_count: number;
  };
  const [martTables, setMartTables] = useState<MartTableInfo[]>([]);
  const [martTablesLoaded, setMartTablesLoaded] = useState(false);
  const [expandedMartTable, setExpandedMartTable] = useState<string | null>(null);

  // Load MART tables for SQL mode
  useEffect(() => {
    if (mode !== 'sql' || martTablesLoaded) return;
    const qs = databaseId ? `?database_id=${databaseId}` : '';
    SupersetClient.get({ endpoint: `/api/v1/ai/sql/mart-tables${qs}` })
      .then(({ json }) => {
        setMartTables(json.result || []);
        setMartTablesLoaded(true);
      })
      .catch(() => {
        setMartTablesLoaded(true);
      });
  }, [mode, databaseId, martTablesLoaded]);

  // Load capabilities
  useEffect(() => {
    fetchAICapabilities(mode)
      .then(data => {
        setCapabilities(data);
        if (data.enabled === false) return;
        setProviderId(data.default_provider || data.providers[0]?.id || '');
        setModel(data.default_model || data.providers[0]?.default_model || '');
      })
      .catch(async error => {
        const clientError = await getClientErrorObject(error);
        addDangerToast(
          clientError.message || t('Failed to load AI capabilities'),
        );
      });
  }, [addDangerToast, mode]);

  // Load conversation history
  useEffect(() => {
    if (!showHistory) return;
    listConversations({
      mode,
      targetId: targetId ? String(targetId) : undefined,
      limit: 20,
    })
      .then(setSavedConversations)
      .catch(() => {});
  }, [mode, targetId, showHistory]);

  const selectedProvider = useMemo(
    () => capabilities?.providers.find(p => p.id === providerId),
    [capabilities, providerId],
  );

  useEffect(() => {
    if (!selectedProvider) return;
    if (!selectedProvider.models.includes(model)) {
      setModel(selectedProvider.default_model || selectedProvider.models[0] || '');
    }
  }, [model, selectedProvider]);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const ensureConversation = useCallback(async () => {
    if (conversationId) return conversationId;
    try {
      const conv = await createConversation({
        mode,
        target_id: targetId ? String(targetId) : null,
        title: null,
        provider_id: providerId || null,
        model_name: model || null,
      });
      setConversationId(conv.id);
      return conv.id;
    } catch {
      return null;
    }
  }, [conversationId, mode, targetId, providerId, model]);

  const submit = useCallback(
    async (inputQuestion?: string) => {
      const q = (inputQuestion || question).trim();
      if (!q && !defaultQuestion) return;
      const actualQuestion = q || defaultQuestion;

      if (!capabilities?.providers.length) {
        addDangerToast(t('No AI providers are configured'));
        return;
      }

      // Add user message
      const userMsg: ChatMessage = {
        id: nextMsgId(),
        role: 'user',
        content: actualQuestion,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, userMsg]);
      setQuestion('');
      setLoading(true);
      setStreamingText('');

      // Persist user message
      const convId = await ensureConversation();
      if (convId) {
        appendMessage(convId, {
          role: 'user',
          content: actualQuestion,
        }).catch(() => {});
      }

      const useStreaming = mode !== 'sql';

      if (useStreaming) {
        try {
          await requestAIInsightStream({
            mode,
            targetId,
            providerId,
            model,
            question: actualQuestion,
            context,
            conversation: conversationHistory,
            conversationId: convId,
            onChunk: (text: string) => {
              if (mountedRef.current) setStreamingText(text);
            },
            onDone: (fullText: string) => {
              if (!mountedRef.current) return;
              const assistantMsg: ChatMessage = {
                id: nextMsgId(),
                role: 'assistant',
                content: fullText,
                timestamp: Date.now(),
              };
              setMessages(prev => [...prev, assistantMsg]);
              setStreamingText('');
              setLoading(false);
              setConversationHistory(prev => [
                ...prev,
                { role: 'user', content: actualQuestion },
                { role: 'assistant', content: fullText },
              ]);
              if (convId) {
                appendMessage(convId, {
                  role: 'assistant',
                  content: fullText,
                }).catch(() => {});
              }
            },
            onError: (error: string) => {
              if (!mountedRef.current) return;
              addDangerToast(error);
              setLoading(false);
              setStreamingText('');
            },
          });
        } catch (error: any) {
          if (!mountedRef.current) return;
          addDangerToast(error?.message || t('AI request failed'));
          setLoading(false);
          setStreamingText('');
        }
      } else {
        // SQL mode: non-streaming
        try {
          const response = await requestAIInsight({
            mode,
            targetId,
            providerId,
            model,
            question: actualQuestion,
            context,
            conversation: conversationHistory,
            conversationId: convId,
            currentSql,
            databaseId,
            schema,
            execute: false,
          });
          if (!mountedRef.current) return;
          setLastResult(response);
          if (response.sql) {
            setLastSql(response.sql);
            // Auto-apply generated SQL to the editor
            if (onApplySql) {
              onApplySql(response.sql);
            }
          }

          const responseText =
            response.insight || response.explanation || response.sql || '';
          const assistantMsg: ChatMessage = {
            id: nextMsgId(),
            role: 'assistant',
            content: responseText,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, assistantMsg]);
          setConversationHistory(prev => [
            ...prev,
            { role: 'user', content: actualQuestion },
            { role: 'assistant', content: responseText },
          ]);
          if (convId) {
            appendMessage(convId, {
              role: 'assistant',
              content: responseText,
            }).catch(() => {});
          }
        } catch (error: any) {
          if (!mountedRef.current) return;
          const clientError = await getClientErrorObject(error);
          addDangerToast(clientError.message || t('AI request failed'));
        } finally {
          if (mountedRef.current) setLoading(false);
        }
      }
    },
    [
      question,
      defaultQuestion,
      capabilities,
      mode,
      targetId,
      providerId,
      model,
      context,
      conversationHistory,
      currentSql,
      databaseId,
      schema,
      ensureConversation,
      addDangerToast,
    ],
  );

  const loadConversation = useCallback(
    async (convId: number) => {
      try {
        const conv = await getConversation(convId);
        setConversationId(conv.id);
        const chatMsgs: ChatMessage[] = (conv.messages || [])
          .filter((m: any) => m.role !== 'system')
          .map((m: any) => ({
            id: nextMsgId(),
            role: m.role,
            content: m.content,
            timestamp: new Date(m.created_on).getTime(),
          }));
        setMessages(chatMsgs);
        setConversationHistory(
          (conv.messages || []).map((m: any) => ({
            role: m.role,
            content: m.content,
          })),
        );
      } catch {
        addDangerToast(t('Failed to load conversation'));
      }
    },
    [addDangerToast],
  );

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setConversationHistory([]);
    setLastSql(null);
    setLastResult(null);
    setStreamingText('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const hasMessages = messages.length > 0 || streamingText;
  const noProviders =
    capabilities &&
    (capabilities.enabled === false || capabilities.providers.length === 0);

  return (
    <Panel>
      <Header>
        <ProviderControls>
          {capabilities ? (
            <>
              <label>
                {t('Provider')}
                <select
                  value={providerId}
                  onChange={e => setProviderId(e.target.value)}
                >
                  {capabilities.providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.is_local ? ` (${t('Local')})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Model')}
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                >
                  {(selectedProvider?.models || []).map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <Loading />
          )}
        </ProviderControls>
        <Button buttonStyle="link" onClick={startNewConversation}>
          {t('New Chat')}
        </Button>
      </Header>

      {noProviders && (
        <Alert
          type="warning"
          message={t('No AI providers configured')}
          description={t(
            'An administrator must enable at least one approved AI provider.',
          )}
          css={css`
            margin: 12px 16px 0;
          `}
        />
      )}

      {/* Chart preview (chart mode) */}
      {mode === 'chart' && chartPreviewUrl && (
        <ChartPreview>
          <ChartPreviewLabel>
            {(context as any)?.chart?.name || t('Chart Preview')}
          </ChartPreviewLabel>
          <ChartPreviewImage
            src={chartPreviewUrl}
            alt={t('Chart visualization')}
          />
        </ChartPreview>
      )}

      {/* Dashboard analysis mode selector */}
      {mode === 'dashboard' && dashboardCharts && dashboardCharts.length > 0 && (
        <DashboardModeSelector>
          <ModeTab
            $active={dashboardAnalysisMode === 'overall'}
            onClick={() => setDashboardAnalysisMode('overall')}
          >
            {t('Overall Summary')}
          </ModeTab>
          <ModeTab
            $active={dashboardAnalysisMode === 'chart_by_chart'}
            onClick={() => setDashboardAnalysisMode('chart_by_chart')}
          >
            {t('Chart by Chart')}
          </ModeTab>
        </DashboardModeSelector>
      )}

      <MainLayout>
        {showHistory && savedConversations.length > 0 && (
          <HistorySidebar>
            <div
              css={css`
                font-size: 11px;
                font-weight: 600;
                color: #9ca3af;
                text-transform: uppercase;
                padding: 4px 8px 8px;
                letter-spacing: 0.04em;
              `}
            >
              {t('History')}
            </div>
            {savedConversations.map(conv => (
              <HistoryItem
                key={conv.id}
                $active={conv.id === conversationId}
                onClick={() => loadConversation(conv.id)}
                title={conv.title || `${conv.mode} — ${conv.updated_on}`}
              >
                {conv.title ||
                  `${conv.mode} ${conv.message_count} msgs`}
              </HistoryItem>
            ))}
          </HistorySidebar>
        )}

        <div
          css={css`
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          `}
        >
          <ChatArea>
            {!hasMessages && (
              <EmptyChat>
                <div
                  css={css`
                    font-size: 32px;
                    opacity: 0.4;
                  `}
                >
                  {mode === 'sql' ? '{}' : mode === 'dashboard' ? '||' : '/\\'}
                </div>
                <div>{t('Ask a question about your data')}</div>
                <SuggestionChips>
                  {SUGGESTIONS[mode].map(s => (
                    <Chip key={s} onClick={() => submit(s)}>
                      {s}
                    </Chip>
                  ))}
                </SuggestionChips>

                {/* MART Table Browser for SQL mode */}
                {mode === 'sql' && martTables.length > 0 && (
                  <div
                    css={css`
                      width: 100%;
                      margin-top: 16px;
                      text-align: left;
                    `}
                  >
                    <div
                      css={css`
                        font-size: 11px;
                        font-weight: 700;
                        color: #6B7280;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                        margin-bottom: 8px;
                        padding: 0 4px;
                      `}
                    >
                      {t('Available MART Tables')} ({martTables.length})
                    </div>
                    <div
                      css={css`
                        max-height: 260px;
                        overflow-y: auto;
                        border: 1px solid #E5E7EB;
                        border-radius: 8px;
                        background: #FAFAFA;
                      `}
                    >
                      {martTables.map(tbl => (
                        <div key={tbl.dataset_id}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              setExpandedMartTable(
                                expandedMartTable === tbl.table_name
                                  ? null
                                  : tbl.table_name,
                              )
                            }
                            onKeyDown={e => {
                              if (e.key === 'Enter')
                                setExpandedMartTable(
                                  expandedMartTable === tbl.table_name
                                    ? null
                                    : tbl.table_name,
                                );
                            }}
                            css={css`
                              padding: 8px 12px;
                              cursor: pointer;
                              display: flex;
                              justify-content: space-between;
                              align-items: center;
                              border-bottom: 1px solid #F3F4F6;
                              &:hover {
                                background: #EFF6FF;
                              }
                            `}
                          >
                            <div>
                              <span
                                css={css`
                                  display: inline-block;
                                  padding: 1px 6px;
                                  background: #DBEAFE;
                                  color: #1D4ED8;
                                  border-radius: 4px;
                                  font-size: 10px;
                                  font-weight: 700;
                                  margin-right: 6px;
                                `}
                              >
                                MART
                              </span>
                              <span
                                css={css`
                                  font-size: 12px;
                                  font-weight: 600;
                                  color: #111827;
                                `}
                              >
                                {tbl.table_name}
                              </span>
                              {tbl.schema && (
                                <span
                                  css={css`
                                    font-size: 10px;
                                    color: #9CA3AF;
                                    margin-left: 6px;
                                  `}
                                >
                                  {tbl.schema}
                                </span>
                              )}
                            </div>
                            <span
                              css={css`
                                font-size: 10px;
                                color: #9CA3AF;
                              `}
                            >
                              {tbl.column_count} cols{' '}
                              {expandedMartTable === tbl.table_name
                                ? '\u25B2'
                                : '\u25BC'}
                            </span>
                          </div>
                          {expandedMartTable === tbl.table_name && (
                            <div
                              css={css`
                                padding: 6px 12px 10px 28px;
                                background: #F9FAFB;
                                border-bottom: 1px solid #E5E7EB;
                              `}
                            >
                              {tbl.description && (
                                <div
                                  css={css`
                                    font-size: 11px;
                                    color: #6B7280;
                                    font-style: italic;
                                    margin-bottom: 6px;
                                  `}
                                >
                                  {tbl.description}
                                </div>
                              )}
                              <div
                                css={css`
                                  display: flex;
                                  flex-wrap: wrap;
                                  gap: 4px;
                                `}
                              >
                                {tbl.columns.map(col => (
                                  <span
                                    key={col.name}
                                    css={css`
                                      display: inline-block;
                                      padding: 2px 7px;
                                      background: #fff;
                                      border: 1px solid #E5E7EB;
                                      border-radius: 4px;
                                      font-size: 10px;
                                      color: #374151;
                                      font-family: monospace;
                                    `}
                                    title={col.type || ''}
                                  >
                                    {col.name}
                                    {col.type && (
                                      <span
                                        css={css`
                                          color: #9CA3AF;
                                          margin-left: 3px;
                                        `}
                                      >
                                        :{col.type.split('(')[0]}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Dashboard chart-by-chart browser */}
                {mode === 'dashboard' &&
                  dashboardAnalysisMode === 'chart_by_chart' &&
                  dashboardCharts &&
                  dashboardCharts.length > 0 && (
                    <div
                      css={css`
                        width: 100%;
                        margin-top: 16px;
                        text-align: left;
                      `}
                    >
                      <ChartPreviewLabel>
                        {t('Select a chart to analyze')}
                      </ChartPreviewLabel>
                      {dashboardCharts.map(chart => (
                        <ChartByChartCard key={chart.chartId}>
                          <ChartByChartHeader>
                            <span css={css`flex: 1;`}>
                              {chart.sliceName}
                            </span>
                            <Chip
                              onClick={() =>
                                submit(
                                  `Analyze the chart "${chart.sliceName}" in detail. What insights, trends, and anomalies do you see?`,
                                )
                              }
                            >
                              {t('Analyze')}
                            </Chip>
                          </ChartByChartHeader>
                          <ChartByChartBody>
                            {dashboardChartImages[chart.chartId] ? (
                              <ChartPreviewImage
                                src={dashboardChartImages[chart.chartId]}
                                alt={chart.sliceName}
                                css={css`
                                  border: none;
                                  border-radius: 0;
                                  max-height: 200px;
                                `}
                              />
                            ) : (
                              <div
                                css={css`
                                  padding: 20px;
                                  text-align: center;
                                  color: #9CA3AF;
                                  font-size: 12px;
                                `}
                              >
                                <Loading />
                              </div>
                            )}
                          </ChartByChartBody>
                        </ChartByChartCard>
                      ))}
                      <Chip
                        onClick={() => {
                          const chartNames = dashboardCharts!.map(c => c.sliceName);
                          const prompt =
                            'Analyze each chart on this dashboard one at a time within a single report. ' +
                            'For EACH chart, use a level-2 markdown heading with the EXACT chart name ' +
                            '(e.g. ## Chart Name), then give its insights, key values, trends, and any concerns. ' +
                            'After all individual charts, add a final ## Cross-Chart Summary section. ' +
                            `The charts are:\n${chartNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
                          submit(prompt);
                        }}
                        css={css`
                          margin-top: 8px;
                          width: 100%;
                          justify-content: center;
                        `}
                      >
                        {t('Analyze All Charts')}
                      </Chip>
                    </div>
                  )}
              </EmptyChat>
            )}

            {messages.map((msg) => {
              // In chart-by-chart mode, split assistant response by ## headings
              // and insert corresponding chart images before each section
              const isChartByChartAssistant =
                mode === 'dashboard' &&
                dashboardAnalysisMode === 'chart_by_chart' &&
                msg.role === 'assistant' &&
                dashboardCharts?.length &&
                Object.keys(dashboardChartImages).length > 0;

              if (isChartByChartAssistant) {
                // Split the response at ## headings, keeping the heading with its section
                const sections = msg.content.split(/(?=^## )/m);
                return (
                  <div key={msg.id}>
                    {sections.map((section, si) => {
                      const headingMatch = section.match(/^## (.+)/m);
                      const sectionTitle = headingMatch?.[1]?.trim();
                      // Find matching chart by name
                      const matched = sectionTitle
                        ? dashboardCharts?.find(c =>
                            sectionTitle.toLowerCase().includes(c.sliceName.toLowerCase()) ||
                            c.sliceName.toLowerCase().includes(sectionTitle.toLowerCase()),
                          )
                        : null;
                      return (
                        <div key={si}>
                          {matched && dashboardChartImages[matched.chartId] && (
                            <ChartByChartCard css={css`margin: 8px 0;`}>
                              <ChartByChartHeader>{matched.sliceName}</ChartByChartHeader>
                              <ChartByChartBody>
                                <ChartPreviewImage
                                  src={dashboardChartImages[matched.chartId]}
                                  alt={matched.sliceName}
                                  css={css`border: none; border-radius: 0; max-height: 200px;`}
                                />
                              </ChartByChartBody>
                            </ChartByChartCard>
                          )}
                          <MessageBubble $isUser={false}>
                            <RenderedMarkdown text={section} />
                          </MessageBubble>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // For single-chart user messages, show chart image if matched
              const showChartImageBefore =
                mode === 'dashboard' &&
                dashboardAnalysisMode === 'chart_by_chart' &&
                msg.role === 'user' &&
                dashboardCharts?.length;
              const matchedChart = showChartImageBefore
                ? dashboardCharts?.find(c => msg.content.includes(c.sliceName))
                : null;

              return (
                <div key={msg.id}>
                  {matchedChart && dashboardChartImages[matchedChart.chartId] && (
                    <ChartByChartCard css={css`margin: 8px 0;`}>
                      <ChartByChartHeader>{matchedChart.sliceName}</ChartByChartHeader>
                      <ChartByChartBody>
                        <ChartPreviewImage
                          src={dashboardChartImages[matchedChart.chartId]}
                          alt={matchedChart.sliceName}
                          css={css`border: none; border-radius: 0; max-height: 200px;`}
                        />
                      </ChartByChartBody>
                    </ChartByChartCard>
                  )}
                  <MessageBubble $isUser={msg.role === 'user'}>
                    {msg.role === 'user' ? (
                      msg.content
                    ) : (
                      <RenderedMarkdown text={msg.content} />
                    )}
                  </MessageBubble>
                </div>
              );
            })}

            {streamingText && (
              <MessageBubble $isUser={false}>
                <RenderedMarkdown text={streamingText} />
                <span
                  css={css`
                    display: inline-block;
                    width: 6px;
                    height: 14px;
                    background: #1976d2;
                    margin-left: 2px;
                    animation: cursorBlink 0.8s infinite;
                    @keyframes cursorBlink {
                      0%,
                      50% {
                        opacity: 1;
                      }
                      51%,
                      100% {
                        opacity: 0;
                      }
                    }
                  `}
                />
              </MessageBubble>
            )}

            {loading && !streamingText && (
              <TypingIndicator>
                <span />
                <span />
                <span />
              </TypingIndicator>
            )}

            {/* SQL-specific actions */}
            {lastSql && mode === 'sql' && (
              <div>
                <SqlBlock>{lastSql}</SqlBlock>
                {onApplySql && (
                  <div
                    css={css`
                      font-size: 11px;
                      color: #16A34A;
                      font-weight: 600;
                      margin: 4px 0 6px;
                    `}
                  >
                    {t('SQL applied to editor automatically')}
                  </div>
                )}
                <ActionRow>
                  {onRunSql && (
                    <Button
                      buttonStyle="primary"
                      onClick={() => onRunSql(lastSql!)}
                    >
                      {t('Run Query')}
                    </Button>
                  )}
                  {onApplySql && (
                    <Button
                      buttonStyle="secondary"
                      onClick={() => onApplySql(lastSql!)}
                    >
                      {t('Re-apply to editor')}
                    </Button>
                  )}
                </ActionRow>
              </div>
            )}

            {lastResult?.execution && (
              <MessageBubble $isUser={false}>
                <strong>{t('Query results')}</strong> ({lastResult.execution.row_count} rows)
                <SqlBlock>
                  {JSON.stringify(lastResult.execution.sample_rows, null, 2)}
                </SqlBlock>
              </MessageBubble>
            )}

            <div ref={chatEndRef} />
          </ChatArea>

          {messages.filter(m => m.role === 'assistant').length > 0 && (
            <ExportBar>
              <span>{t('Export')}:</span>
              <ExportButton onClick={() => void exportAsPdf(messages, { chartPreviewUrl, dashboardChartImages, dashboardCharts }, { mode, context }, { provider: selectedProvider?.label || providerId, model })}>
                PDF
              </ExportButton>
              <ExportButton onClick={() => void exportAsDocx(messages, { chartPreviewUrl, dashboardChartImages, dashboardCharts }, { mode, context }, { provider: selectedProvider?.label || providerId, model })}>
                DOCX
              </ExportButton>
              <ExportButton onClick={() => void exportAsPptx(messages, { chartPreviewUrl, dashboardChartImages, dashboardCharts }, { mode, context }, { provider: selectedProvider?.label || providerId, model })}>
                PPTX
              </ExportButton>
            </ExportBar>
          )}

          <InputArea>
            <Input.TextArea
              rows={1}
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={defaultQuestion}
              disabled={loading || !!noProviders}
            />
            <Button
              buttonStyle="primary"
              onClick={() => submit()}
              loading={loading}
              disabled={!!noProviders}
              css={css`
                align-self: flex-end;
              `}
            >
              {t('Send')}
            </Button>
          </InputArea>
        </div>
      </MainLayout>
    </Panel>
  );
}
