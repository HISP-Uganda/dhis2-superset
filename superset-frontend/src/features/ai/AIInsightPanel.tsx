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
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }

    p { margin: 6px 0; }
    p:first-child { margin-top: 0; }
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
      margin: 8px 0;
      font-size: 12px;
      width: 100%;
    }
    th, td {
      border: 1px solid #D1D5DB;
      padding: 4px 8px;
      text-align: left;
    }
    th {
      background: #E5E7EB;
      font-weight: 600;
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
  max-height: 280px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
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
    const el = document.querySelector(selector);
    if (!el) return null;
    const domToImage = (await import('dom-to-image-more')).default;
    const dataUrl = await domToImage.toPng(el, {
      bgcolor: '#ffffff',
      quality: 0.92,
      cacheBust: true,
    });
    return dataUrl;
  } catch {
    return null;
  }
}

/* ── Suggestion prompts by mode ──────────────────────── */

const SUGGESTIONS: Record<AIInsightMode, string[]> = {
  chart: [
    'Summary',
    'What trends do you see?',
    'Are there any outliers?',
    'Compare the highest and lowest values',
  ],
  dashboard: [
    'Summary',
    'What are the key takeaways?',
    'Which metrics need attention?',
    'Are there any concerning trends?',
  ],
  sql: [
    'Show the latest data from all MART tables',
    'Summarize records by district and period',
    'Count distinct facilities per district',
    'Find top 10 indicators by total value',
    'Generate a trend analysis query',
    'Show completeness rates by org unit',
  ],
};

/* ── Markdown options ─────────────────────────────────── */

const MARKDOWN_OPTIONS: Record<string, any> = {
  forceBlock: true,
  forceWrapper: true,
};

const ALERT_TAGS: Record<string, { css: string; label: string }> = {
  CRITICAL: { css: 'critical', label: 'Critical' },
  WARNING: { css: 'warning', label: 'Warning' },
  GOOD: { css: 'good', label: 'Good' },
  INFO: { css: 'info', label: 'Info' },
};

/**
 * Convert `[CRITICAL] ...text...` blocks into HTML callout divs that
 * markdown-to-jsx will pass through.  Works for both block-level tags
 * (tag on its own line followed by content) and inline tags (tag at
 * the start of a paragraph / bullet).
 */
function preprocessAlertTags(text: string): string {
  // Match: optional leading whitespace, [TAG], then the rest of the
  // "paragraph" — which may span multiple lines until the next blank
  // line, next tag, or end of string.
  return text.replace(
    /^[ \t]*\[(CRITICAL|WARNING|GOOD|INFO)\][ \t]*\n?([\s\S]*?)(?=\n[ \t]*\[(?:CRITICAL|WARNING|GOOD|INFO)\]|\n{2,}|$)/gm,
    (_match, tag: string, body: string) => {
      const info = ALERT_TAGS[tag];
      if (!info) return _match;
      const trimmed = body.trim();
      return `<div class="alert-callout alert-${info.css}"><span class="alert-badge">${info.label}</span>\n\n${trimmed}\n\n</div>\n`;
    },
  );
}

/**
 * Strip emoji and non-ASCII symbols that render as garbled text.
 * Keeps basic Latin, extended Latin (accented chars), and common
 * punctuation/whitespace so that standard English text is untouched.
 */
function sanitizeNonAscii(text: string): string {
  // Remove emoji and miscellaneous symbols (U+2600..U+FFFF surrogate pairs, etc.)
  return text
    .replace(
      /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]|[\u{20E3}]|[\u{E0020}-\u{E007F}]/gu,
      '',
    )
    // Collapse any resulting double-spaces
    .replace(/ {2,}/g, ' ');
}

function RenderedMarkdown({ text }: { text: string }) {
  const clean = sanitizeNonAscii(text);
  const processed = preprocessAlertTags(clean);
  return <Markdown options={MARKDOWN_OPTIONS}>{processed}</Markdown>;
}

/* ── Export helpers ───────────────────────────────────── */

/** Hex color string "#RRGGBB" → [r, g, b] tuple for jsPDF. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
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
  const bottomMargin = 25;
  let y = startY;

  const clean = sanitizeNonAscii(text);
  const lines = clean.split('\n');
  let inCodeBlock = false;

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - bottomMargin) {
      pdf.addPage();
      y = margin;
    }
  }

  /** Render a line with inline **bold** and *italic* segments. */
  function renderFormattedLine(
    line: string,
    baseSize: number,
    baseStyle: string,
    color: [number, number, number],
    indent: number = 0,
  ) {
    const maxW = contentWidth - indent;
    // Split into segments: **bold**, *italic*, `code`, plain
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

    // Flatten into a single string to word-wrap, then render with formatting
    const fullText = segments.map(s => s.text).join('');
    pdf.setFont('helvetica', baseStyle);
    pdf.setFontSize(baseSize);
    const wrapped: string[] = pdf.splitTextToSize(fullText, maxW);

    for (const wrapLine of wrapped) {
      ensureSpace(baseSize * 0.5 + 2);
      // For simplicity, render each wrapped line; apply formatting per segment
      let xPos = margin + indent;
      let remaining = wrapLine;
      for (const seg of segments) {
        if (!remaining) break;
        // How much of this segment fits in the remaining wrapped line
        let chunk = '';
        if (remaining.startsWith(seg.text)) {
          chunk = seg.text;
          remaining = remaining.slice(chunk.length);
        } else if (seg.text.length > 0 && remaining.includes(seg.text.substring(0, 1))) {
          // Partial match — take what fits
          const idx = Math.min(remaining.length, seg.text.length);
          chunk = remaining.substring(0, idx);
          remaining = remaining.slice(idx);
          seg.text = seg.text.slice(idx);
        }
        if (!chunk) continue;

        if (seg.code) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(baseSize - 1);
          // Light grey background for inline code
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
        // Reset
        pdf.setFont('helvetica', baseStyle);
        pdf.setFontSize(baseSize);
        pdf.setTextColor(...color);
      }
      y += baseSize * 0.5 + 1;
    }
    return y;
  }

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    // Code block fences
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      ensureSpace(7);
      pdf.setFillColor(229, 231, 235);
      pdf.rect(margin, y - 4, contentWidth, 6, 'F');
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(30, 41, 59);
      pdf.text(trimmed, margin + 3, y);
      y += 6;
      continue;
    }

    // Empty line
    if (!trimmed) {
      y += 4;
      continue;
    }

    // Alert tags
    const alertMatch = trimmed.match(/^\[(CRITICAL|WARNING|GOOD|INFO)\]\s*(.*)/);
    if (alertMatch) {
      const [, tag, body] = alertMatch;
      const colors = ALERT_PDF_COLORS[tag] || ALERT_PDF_COLORS.INFO;
      const label = ALERT_TAGS[tag]?.label || tag;

      // Measure wrapped text height
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      const fullAlertText = `${label}: ${body}`;
      const wrappedAlert: string[] = pdf.splitTextToSize(fullAlertText, contentWidth - 20);
      const blockHeight = wrappedAlert.length * 5.5 + 8;

      ensureSpace(blockHeight);
      // Background
      const [bgR, bgG, bgB] = hexToRgb(colors.bg);
      pdf.setFillColor(bgR, bgG, bgB);
      pdf.roundedRect(margin, y - 3, contentWidth, blockHeight, 2, 2, 'F');
      // Left border
      const [brR, brG, brB] = hexToRgb(colors.border);
      pdf.setFillColor(brR, brG, brB);
      pdf.rect(margin, y - 3, 2.5, blockHeight, 'F');
      // Badge
      const badgeW = pdf.getTextWidth(label.toUpperCase()) + 6;
      pdf.setFillColor(brR, brG, brB);
      pdf.roundedRect(margin + 6, y - 1, badgeW, 5, 1, 1, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(255, 255, 255);
      pdf.text(label.toUpperCase(), margin + 9, y + 2.5);
      // Body text
      const [txR, txG, txB] = hexToRgb(colors.text);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(txR, txG, txB);
      let alertY = y + 7;
      for (const wl of wrappedAlert) {
        pdf.text(wl, margin + 8, alertY);
        alertY += 5.5;
      }
      y += blockHeight + 4;
      continue;
    }

    // Headers
    const h1 = trimmed.match(/^# (.+)/);
    if (h1) {
      ensureSpace(12);
      y += 4;
      renderFormattedLine(h1[1], 16, 'bold', [25, 118, 210]);
      // Underline
      pdf.setDrawColor(229, 234, 240);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y, margin + contentWidth, y);
      y += 4;
      continue;
    }
    const h2 = trimmed.match(/^## (.+)/);
    if (h2) {
      ensureSpace(10);
      y += 3;
      renderFormattedLine(h2[1], 13, 'bold', [25, 118, 210]);
      y += 2;
      continue;
    }
    const h3 = trimmed.match(/^### (.+)/);
    if (h3) {
      ensureSpace(8);
      y += 2;
      renderFormattedLine(h3[1], 11, 'bold', [55, 65, 81]);
      y += 1;
      continue;
    }

    // Bullet list
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      ensureSpace(6);
      pdf.setFontSize(9);
      pdf.setTextColor(55, 65, 81);
      pdf.text('\u2022', margin + 4, y);
      renderFormattedLine(bulletMatch[1], 9, 'normal', [55, 65, 81], 10);
      continue;
    }

    // Numbered list
    const numMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    if (numMatch) {
      ensureSpace(6);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(55, 65, 81);
      pdf.text(`${numMatch[1]}.`, margin + 4, y);
      pdf.setFont('helvetica', 'normal');
      renderFormattedLine(numMatch[2], 9, 'normal', [55, 65, 81], 12);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      ensureSpace(6);
      pdf.setDrawColor(229, 234, 240);
      pdf.setLineWidth(0.3);
      pdf.line(margin, y, margin + contentWidth, y);
      y += 5;
      continue;
    }

    // Normal paragraph
    ensureSpace(6);
    renderFormattedLine(trimmed, 9, 'normal', [31, 41, 55]);
    y += 1;
  }

  return y;
}

type ExportImages = {
  chartPreviewUrl?: string | null;
  dashboardChartImages?: Record<number, string>;
  dashboardCharts?: DashboardChartInfo[];
};

function exportAsPdf(
  messages: ChatMessage[],
  images?: ExportImages,
) {
  // Dynamic import to avoid bundling jspdf when not needed
  import('jspdf').then(({ jsPDF }) => {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // ── Title ──
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(22);
    pdf.setTextColor(25, 118, 210);
    pdf.text('AI Insights Report', margin, y + 8);
    y += 14;

    // Subtitle line
    pdf.setDrawColor(25, 118, 210);
    pdf.setLineWidth(0.8);
    pdf.line(margin, y, margin + contentWidth, y);
    y += 6;

    // Date
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor(156, 163, 175);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
    y += 8;

    // ── Chart preview image (single chart mode) ──
    if (images?.chartPreviewUrl) {
      try {
        const imgH = 60;
        if (y + imgH > pageHeight - 30) { pdf.addPage(); y = margin; }
        pdf.addImage(images.chartPreviewUrl, 'PNG', margin, y, contentWidth, imgH);
        y += imgH + 6;
      } catch { /* skip if image fails */ }
    }

    // ── Messages ──
    for (const msg of messages) {
      const isUser = msg.role === 'user';

      // In dashboard chart-by-chart mode, show chart image before user question
      if (isUser && images?.dashboardChartImages && images?.dashboardCharts) {
        const matched = images.dashboardCharts.find(c =>
          msg.content.includes(c.sliceName),
        );
        if (matched && images.dashboardChartImages[matched.chartId]) {
          try {
            const imgH = 45;
            if (y + imgH + 15 > pageHeight - 30) { pdf.addPage(); y = margin; }
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(11);
            pdf.setTextColor(31, 41, 55);
            pdf.text(matched.sliceName, margin, y);
            y += 5;
            pdf.addImage(
              images.dashboardChartImages[matched.chartId],
              'PNG', margin, y, contentWidth, imgH,
            );
            y += imgH + 4;
          } catch { /* skip */ }
        }
      }

      // Check space for role label + at least a few lines
      if (y > pageHeight - 40) {
        pdf.addPage();
        y = margin;
      }

      // Role label
      if (isUser) {
        pdf.setFillColor(25, 118, 210);
        const labelW = pdf.getTextWidth('  You  ') + 4;
        pdf.roundedRect(margin, y - 3.5, labelW, 6, 1.5, 1.5, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(255, 255, 255);
        pdf.text('You', margin + 3, y + 0.5);
      } else {
        pdf.setFillColor(55, 65, 81);
        const labelW = pdf.getTextWidth('  AI Assistant  ') + 4;
        pdf.roundedRect(margin, y - 3.5, labelW, 6, 1.5, 1.5, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(255, 255, 255);
        pdf.text('AI Assistant', margin + 3, y + 0.5);
      }
      y += 7;

      if (isUser) {
        // User message — plain text
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(31, 41, 55);
        const wrapped: string[] = pdf.splitTextToSize(
          sanitizeNonAscii(msg.content),
          contentWidth,
        );
        for (const line of wrapped) {
          if (y > pageHeight - 20) {
            pdf.addPage();
            y = margin;
          }
          pdf.text(line, margin, y);
          y += 5;
        }
      } else {
        // Assistant message — full markdown rendering
        y = renderMarkdownToPdf(pdf, msg.content, y, pageWidth, margin);
      }

      y += 6;

      // Separator between messages
      pdf.setDrawColor(229, 234, 240);
      pdf.setLineWidth(0.2);
      pdf.line(margin, y, margin + contentWidth, y);
      y += 5;
    }

    // ── Footer on last page ──
    const pageCount = pdf.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(156, 163, 175);
      const footerY = pageHeight - 8;
      pdf.text('Superset AI Insights', margin, footerY);
      pdf.text(`Page ${i} of ${pageCount}`, pageWidth - margin - 20, footerY);
    }

    pdf.save(`ai-insights-${Date.now()}.pdf`);
  });
}

/**
 * Export conversation as a .docx file.
 * Uses dynamic import() so the `docx` package (which depends on node:fs)
 * is NOT bundled into the main webpack chunk.
 */
async function exportAsDocx(
  messages: ChatMessage[],
  images?: ExportImages,
) {
  const [
    { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ShadingType, ImageRun },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')]);

  /** Parse inline **bold**, *italic*, `code` into TextRun objects. */
  function parseInlineFormatting(text: string) {
    const runs: InstanceType<typeof TextRun>[] = [];
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|([^*`]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        runs.push(new TextRun({ text: match[1], bold: true, size: 22 }));
      } else if (match[2]) {
        runs.push(new TextRun({ text: match[2], italics: true, size: 22 }));
      } else if (match[3]) {
        runs.push(
          new TextRun({
            text: match[3],
            font: 'Courier New',
            size: 20,
            shading: { type: ShadingType.SOLID, color: 'E5E7EB' },
          }),
        );
      } else if (match[4]) {
        runs.push(new TextRun({ text: match[4], size: 22 }));
      }
    }
    return runs.length ? runs : [new TextRun({ text, size: 22 })];
  }

  /** Parse markdown text into docx Paragraph objects. */
  function markdownToDocxParagraphs(text: string) {
    const paragraphs: InstanceType<typeof Paragraph>[] = [];
    const lines = sanitizeNonAscii(text).split('\n');
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: line, font: 'Courier New', size: 20, color: '1E293B' })],
          shading: { type: ShadingType.SOLID, color: 'E5E7EB' },
          spacing: { before: 40, after: 40 },
        }));
        continue;
      }
      if (!line.trim()) { paragraphs.push(new Paragraph({ children: [] })); continue; }

      const alertMatch = line.match(/^\[(CRITICAL|WARNING|GOOD|INFO)\]\s*(.*)/);
      if (alertMatch) {
        const [, tag, body] = alertMatch;
        const colors: Record<string, { bg: string; text: string }> = {
          CRITICAL: { bg: 'FEF2F2', text: 'DC2626' },
          WARNING: { bg: 'FFFBEB', text: 'B45309' },
          GOOD: { bg: 'F0FDF4', text: '16A34A' },
          INFO: { bg: 'EFF6FF', text: '3B82F6' },
        };
        const c = colors[tag] || colors.INFO;
        paragraphs.push(new Paragraph({
          children: [
            new TextRun({ text: `[${tag}] `, bold: true, color: c.text, size: 22 }),
            ...parseInlineFormatting(body),
          ],
          shading: { type: ShadingType.SOLID, color: c.bg },
          spacing: { before: 120, after: 120 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: c.text } },
          indent: { left: 200 },
        }));
        continue;
      }

      const h1Match = line.match(/^# (.+)/);
      if (h1Match) { paragraphs.push(new Paragraph({ children: parseInlineFormatting(h1Match[1]), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } })); continue; }
      const h2Match = line.match(/^## (.+)/);
      if (h2Match) { paragraphs.push(new Paragraph({ children: parseInlineFormatting(h2Match[1]), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } })); continue; }
      const h3Match = line.match(/^### (.+)/);
      if (h3Match) { paragraphs.push(new Paragraph({ children: parseInlineFormatting(h3Match[1]), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } })); continue; }

      const bulletMatch = line.match(/^[\s]*[-*]\s+(.+)/);
      if (bulletMatch) { paragraphs.push(new Paragraph({ children: parseInlineFormatting(bulletMatch[1]), bullet: { level: 0 }, spacing: { before: 40, after: 40 } })); continue; }

      const numMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)/);
      if (numMatch) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: `${numMatch[1]}. `, bold: true }), ...parseInlineFormatting(numMatch[2])],
          spacing: { before: 40, after: 40 }, indent: { left: 360 },
        }));
        continue;
      }

      if (/^---+$/.test(line.trim())) {
        paragraphs.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E5EAF0' } }, spacing: { before: 120, after: 120 } }));
        continue;
      }

      paragraphs.push(new Paragraph({ children: parseInlineFormatting(line), spacing: { before: 60, after: 60 } }));
    }
    return paragraphs;
  }

  /** Convert a data URL to Uint8Array for docx ImageRun. */
  function dataUrlToUint8Array(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  const sections: InstanceType<typeof Paragraph>[] = [];
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: 'AI Insights Report', bold: true, size: 36, color: '1976D2' })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      spacing: { after: 100 },
    }),
  );
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: `Generated: ${new Date().toLocaleString()}`, size: 18, color: '9CA3AF', italics: true })],
      spacing: { after: 300 },
    }),
  );

  // ── Chart preview image (single chart mode) ──
  if (images?.chartPreviewUrl) {
    try {
      sections.push(new Paragraph({
        children: [new ImageRun({
          data: dataUrlToUint8Array(images.chartPreviewUrl),
          transformation: { width: 580, height: 300 },
          type: 'png',
        })],
        spacing: { after: 200 },
      }));
    } catch { /* skip */ }
  }

  for (const msg of messages) {
    const isUser = msg.role === 'user';

    // Dashboard chart-by-chart: show chart image before user question
    if (isUser && images?.dashboardChartImages && images?.dashboardCharts) {
      const matched = images.dashboardCharts.find(c =>
        msg.content.includes(c.sliceName),
      );
      if (matched && images.dashboardChartImages[matched.chartId]) {
        try {
          sections.push(new Paragraph({
            children: [new TextRun({ text: matched.sliceName, bold: true, size: 24, color: '1976D2' })],
            spacing: { before: 240, after: 80 },
          }));
          sections.push(new Paragraph({
            children: [new ImageRun({
              data: dataUrlToUint8Array(images.dashboardChartImages[matched.chartId]),
              transformation: { width: 560, height: 250 },
              type: 'png',
            })],
            spacing: { after: 120 },
          }));
        } catch { /* skip */ }
      }
    }

    sections.push(
      new Paragraph({
        children: [new TextRun({ text: isUser ? 'You' : 'AI Assistant', bold: true, size: 22, color: isUser ? '1976D2' : '374151' })],
        spacing: { before: 240, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E5EAF0' } },
      }),
    );
    if (isUser) {
      sections.push(new Paragraph({ children: [new TextRun({ text: msg.content, size: 22 })], spacing: { before: 60, after: 120 } }));
    } else {
      sections.push(...markdownToDocxParagraphs(msg.content));
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: sections,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `ai-insights-${Date.now()}.docx`);
}

/**
 * Export conversation as a .pptx file.
 * Uses dynamic import() to avoid bundling pptxgenjs into the main chunk.
 */
async function exportAsPptx(
  messages: ChatMessage[],
  images?: ExportImages,
) {
  const PptxGenJS = (await import('pptxgenjs')).default;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Superset AI';
  pptx.title = 'AI Insights Report';

  const titleSlide = pptx.addSlide();
  titleSlide.addText('AI Insights Report', {
    x: 0.5, y: 1.5, w: '90%', fontSize: 36, bold: true, color: '1976D2', fontFace: 'Arial',
  });
  titleSlide.addText(`Generated: ${new Date().toLocaleString()}`, {
    x: 0.5, y: 2.5, w: '90%', fontSize: 14, color: '9CA3AF', fontFace: 'Arial',
  });

  // Chart preview slide (single chart mode)
  if (images?.chartPreviewUrl) {
    try {
      const chartSlide = pptx.addSlide();
      chartSlide.addText('Chart Analyzed', {
        x: 0.5, y: 0.2, w: '90%', fontSize: 18, bold: true, color: '1976D2', fontFace: 'Arial',
      });
      chartSlide.addImage({
        data: images.chartPreviewUrl, x: 0.5, y: 0.8, w: 9.0, h: 4.5,
      });
    } catch { /* skip */ }
  }

  // Build a map of user messages to matched charts for dashboard mode
  const userChartMap = new Map<number, DashboardChartInfo>();
  if (images?.dashboardCharts && images?.dashboardChartImages) {
    messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        const matched = images.dashboardCharts!.find(c =>
          msg.content.includes(c.sliceName),
        );
        if (matched && images.dashboardChartImages![matched.chartId]) {
          userChartMap.set(idx, matched);
        }
      }
    });
  }

  const assistantMessages = messages.filter(m => m.role === 'assistant');
  assistantMessages.forEach((msg, idx) => {
    // Find the user message that preceded this assistant message
    const userIdx = messages.findIndex(
      (m, i) => m.role === 'user' && messages[i + 1] === msg,
    );
    const matchedChart = userIdx >= 0 ? userChartMap.get(userIdx) : undefined;

    // If there's a chart image for this analysis, add it first
    if (matchedChart && images?.dashboardChartImages?.[matchedChart.chartId]) {
      try {
        const chartSlide = pptx.addSlide();
        chartSlide.addText(matchedChart.sliceName, {
          x: 0.5, y: 0.2, w: '90%', fontSize: 18, bold: true, color: '1976D2', fontFace: 'Arial',
        });
        chartSlide.addImage({
          data: images.dashboardChartImages[matchedChart.chartId],
          x: 0.5, y: 0.8, w: 9.0, h: 4.5,
        });
      } catch { /* skip */ }
    }
    const cleanText = sanitizeNonAscii(msg.content);
    const lines = cleanText.split('\n');
    type TextProps = { text: string; options?: Record<string, unknown> };
    const textParts: TextProps[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { textParts.push({ text: '\n', options: { fontSize: 6 } }); continue; }

      const alertMatch = trimmed.match(/^\[(CRITICAL|WARNING|GOOD|INFO)\]\s*(.*)/);
      if (alertMatch) {
        const [, tag, body] = alertMatch;
        const colors: Record<string, string> = { CRITICAL: 'DC2626', WARNING: 'B45309', GOOD: '16A34A', INFO: '3B82F6' };
        textParts.push({ text: `[${tag}] `, options: { fontSize: 11, bold: true, color: colors[tag] || '3B82F6', fontFace: 'Arial' } });
        textParts.push({ text: `${body}\n`, options: { fontSize: 11, color: '374151', fontFace: 'Arial' } });
        continue;
      }

      const h1 = trimmed.match(/^# (.+)/);
      if (h1) { textParts.push({ text: `${h1[1]}\n`, options: { fontSize: 20, bold: true, color: '1976D2', fontFace: 'Arial' } }); continue; }
      const h2 = trimmed.match(/^## (.+)/);
      if (h2) { textParts.push({ text: `${h2[1]}\n`, options: { fontSize: 16, bold: true, color: '1976D2', fontFace: 'Arial' } }); continue; }
      const h3 = trimmed.match(/^### (.+)/);
      if (h3) { textParts.push({ text: `${h3[1]}\n`, options: { fontSize: 14, bold: true, color: '374151', fontFace: 'Arial' } }); continue; }

      const bullet = trimmed.match(/^[-*]\s+(.+)/);
      if (bullet) { textParts.push({ text: `  \u2022 ${bullet[1]}\n`, options: { fontSize: 11, color: '374151', fontFace: 'Arial' } }); continue; }

      const plain = trimmed.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
      textParts.push({ text: `${plain}\n`, options: { fontSize: 11, color: '374151', fontFace: 'Arial' } });
    }

    const PARTS_PER_SLIDE = 25;
    const chunks: TextProps[][] = [];
    for (let j = 0; j < textParts.length; j += PARTS_PER_SLIDE) {
      chunks.push(textParts.slice(j, j + PARTS_PER_SLIDE));
    }

    chunks.forEach((chunk, ci) => {
      const slide = pptx.addSlide();
      const title = ci === 0 ? `Insight ${idx + 1}` : `Insight ${idx + 1} (continued)`;
      slide.addText(title, { x: 0.5, y: 0.2, w: '90%', fontSize: 18, bold: true, color: '1976D2', fontFace: 'Arial' });
      slide.addText(chunk as any, { x: 0.5, y: 0.8, w: '90%', h: 4.5, fontSize: 11, color: '374151', fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.3 });
    });
  });

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
            onChunk: (text: string) => {
              setStreamingText(text);
            },
            onDone: (fullText: string) => {
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
              addDangerToast(error);
              setLoading(false);
              setStreamingText('');
            },
          });
        } catch (error: any) {
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
            currentSql,
            databaseId,
            schema,
            execute: false,
          });
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
          const clientError = await getClientErrorObject(error);
          addDangerToast(clientError.message || t('AI request failed'));
        } finally {
          setLoading(false);
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
                        onClick={() =>
                          submit(
                            'Analyze each chart on this dashboard individually. For each chart, describe what it shows, key values, trends, and any concerns.',
                          )
                        }
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

            {/* Show chart image before first AI response in dashboard chart-by-chart mode */}
            {messages.map((msg, msgIdx) => {
              const showChartImageBefore =
                mode === 'dashboard' &&
                dashboardAnalysisMode === 'chart_by_chart' &&
                msg.role === 'user' &&
                dashboardCharts?.length;

              // Find which chart is being analyzed from the message content
              const matchedChart = showChartImageBefore
                ? dashboardCharts?.find(c =>
                    msg.content.includes(c.sliceName),
                  )
                : null;

              return (
                <div key={msg.id}>
                  {matchedChart && dashboardChartImages[matchedChart.chartId] && (
                    <ChartByChartCard
                      css={css`
                        margin: 8px 0;
                      `}
                    >
                      <ChartByChartHeader>
                        {matchedChart.sliceName}
                      </ChartByChartHeader>
                      <ChartByChartBody>
                        <ChartPreviewImage
                          src={dashboardChartImages[matchedChart.chartId]}
                          alt={matchedChart.sliceName}
                          css={css`
                            border: none;
                            border-radius: 0;
                            max-height: 200px;
                          `}
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
              <ExportButton onClick={() => exportAsPdf(messages, { chartPreviewUrl, dashboardChartImages, dashboardCharts })}>
                PDF
              </ExportButton>
              <ExportButton onClick={() => void exportAsDocx(messages, { chartPreviewUrl, dashboardChartImages, dashboardCharts })}>
                DOCX
              </ExportButton>
              <ExportButton onClick={() => void exportAsPptx(messages, { chartPreviewUrl, dashboardChartImages, dashboardCharts })}>
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
