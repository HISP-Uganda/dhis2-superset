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
  border-bottom: 1px solid var(--pro-\1);
  background: var(--pro-\1);
`;

const ProviderControls = styled.div`
  display: flex;
  gap: 8px;
  flex: 1;

  select {
    min-height: 32px;
    border: 1px solid var(--pro-\1);
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
    $isUser ? 'var(--pro-\1)' : 'var(--pro-\1)'};
  color: ${({ $isUser }) => ($isUser ? '#fff' : '#1F2937')};
  border: ${({ $isUser }) =>
    $isUser ? 'none' : '1px solid var(--pro-\1)'};
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
  border-top: 1px solid var(--pro-\1);
  padding: 12px 16px;
  display: flex;
  gap: 8px;
  background: var(--pro-\1);
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
  border-right: 1px solid var(--pro-\1);
  overflow-y: auto;
  padding: 8px;
  background: var(--pro-\1);
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
  border: 1px solid var(--pro-\1);
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
  border-top: 1px solid var(--pro-\1);
  background: var(--pro-\1);
  font-size: 11px;
  color: #6B7280;
`;

const ExportButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--pro-\1);
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
  const cleaned = text
    .replace(
      /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]|[\u{20E3}]|[\u{E0020}-\u{E007F}]/gu,
      '',
    )
    // Collapse any resulting double-spaces
    .replace(/ {2,}/g, ' ');
  // Fix concatenated words and missing punctuation spacing
  return fixWordSpacing(cleaned);
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
    'between', 'through', 'without', 'against', 'because', 'however',
    'significant', 'important', 'concerning', 'including', 'according',
    'quality', 'surveillance', 'adherence', 'preventive', 'treatment',
    'clinical', 'national', 'diagnostic', 'supply', 'system',
    'before', 'during', 'within', 'around', 'across',
    'about', 'after', 'which', 'where', 'while', 'their', 'there',
    'these', 'those', 'would', 'could', 'should', 'other',
    'being', 'still', 'under', 'until', 'since',
    'from', 'with', 'into', 'upon', 'over', 'than', 'then',
    'when', 'what', 'this', 'that', 'have', 'been', 'were',
    'more', 'some', 'will', 'only', 'just', 'each', 'both',
    'also', 'very', 'much', 'such', 'most', 'must',
    'like', 'even', 'well', 'many', 'high', 'poor',
    'for', 'but', 'and', 'the', 'not', 'are', 'was', 'has',
    'had', 'can', 'may', 'all', 'its', 'per', 'yet', 'nor',
  ];
  // Build a single regex: (3+ lowercase)(boundary word) at word-like boundary
  const boundaryPattern = new RegExp(
    `([a-z]{3,})(${BOUNDARY_WORDS.join('|')})(?=[^a-z]|$)`,
    'gi',
  );

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
          'therefore', 'perform', 'performed', 'performer', 'before',
          'inform', 'informed', 'information', 'informal', 'transform',
          'platform', 'reform', 'uniform', 'comfortable', 'furthermore',
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
        ];
        if (falsePositives.includes(combined)) return match;
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

      // 8. Collapse double-spaces
      fixed = fixed.replace(/ {2,}/g, ' ');

      return fixed;
    })
    .join('\n');
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

  const clean = sanitizeNonAscii(text);
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

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

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

    // Alert tags — rendered as compact single-line callouts
    const alertMatch = trimmed.match(/^\[(CRITICAL|WARNING|GOOD|INFO)\]\s*(.*)/);
    if (alertMatch) {
      const [, tag, body] = alertMatch;
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
      const [bgR, bgG, bgB] = hexToRgb(colors.bg);
      pdf.setFillColor(bgR, bgG, bgB);
      pdf.roundedRect(margin, y - 1.5, contentWidth, blockHeight, 1, 1, 'F');
      const [brR, brG, brB] = hexToRgb(colors.border);
      pdf.setFillColor(brR, brG, brB);
      pdf.rect(margin, y - 1.5, 2, blockHeight, 'F');

      // Render bold label then body text inline
      const [txR, txG, txB] = hexToRgb(colors.text);
      let alertY = y + 1;

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
) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth(); // 210
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297
  const margin = 20;
  const contentWidth = pageWidth - margin * 2; // 170
  let y = margin;

  // ── Cover / Title area ──
  // Top accent line
  pdf.setFillColor(25, 118, 210);
  pdf.rect(0, 0, pageWidth, 3, 'F');

  y = 28;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(24);
  pdf.setTextColor(25, 118, 210);
  pdf.text('AI Insights Report', margin, y);
  y += 10;

  // Accent rule
  pdf.setDrawColor(25, 118, 210);
  pdf.setLineWidth(0.6);
  pdf.line(margin, y, margin + 50, y);
  y += 7;

  // Date & meta
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(130, 140, 155);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
  y += 4;
  pdf.text('Superset AI Insights', margin, y);
  y += 10;

  /** Add a chart image to PDF preserving aspect ratio, centered. */
  async function addChartImage(dataUrl: string, maxH: number) {
    try {
      const dim = await getImageDimensions(dataUrl);
      const fit = fitImage(dim.width, dim.height, contentWidth, maxH);
      const xOffset = margin + (contentWidth - fit.width) / 2;
      if (y + fit.height + 6 > pageHeight - 25) { pdf.addPage(); y = margin; }
      // Light border around chart
      pdf.setDrawColor(210, 218, 228);
      pdf.setLineWidth(0.3);
      pdf.roundedRect(xOffset - 1, y - 1, fit.width + 2, fit.height + 2, 1, 1, 'S');
      pdf.addImage(dataUrl, 'PNG', xOffset, y, fit.width, fit.height);
      y += fit.height + 8;
    } catch { /* skip */ }
  }

  // ── Chart preview image (single chart mode) ──
  if (images?.chartPreviewUrl) {
    await addChartImage(images.chartPreviewUrl, 80);
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

  // ── Messages ──
  for (const msg of messages) {
    const isUser = msg.role === 'user';

    // Skip rendering "user" prompts that are the chart-by-chart instruction
    // (they are long auto-generated prompts, not meaningful to show in export)
    const isAutoChartPrompt =
      isUser && msg.content.startsWith('Analyze each chart on this dashboard');

    if (isAutoChartPrompt) continue;

    // For assistant messages with chart images available, split by ## sections
    // and insert chart images before each matching section
    const hasDashboardImages =
      !isUser &&
      images?.dashboardChartImages &&
      images?.dashboardCharts &&
      Object.keys(images.dashboardChartImages).length > 0;

    if (hasDashboardImages) {
      const sections = msg.content.split(/(?=^## )/m);
      for (const section of sections) {
        const headingMatch = section.match(/^## (.+)/m);
        const matched = matchChartForSection(headingMatch?.[1]?.trim());

        // Insert chart image before this section
        if (matched && images.dashboardChartImages![matched.chartId]) {
          if (y > pageHeight - 60) { pdf.addPage(); y = margin; }
          await addChartImage(images.dashboardChartImages![matched.chartId], 60);
        }

        // Render the markdown section
        y = renderMarkdownToPdf(pdf, section, y, pageWidth, margin);
        y += 4;
      }
      y += 4;
      pdf.setDrawColor(210, 218, 228);
      pdf.setLineWidth(0.15);
      pdf.line(margin, y, margin + contentWidth, y);
      y += 6;
      continue;
    }

    // Ensure space for role label + a few lines
    if (y > pageHeight - 40) {
      pdf.addPage();
      y = margin;
    }

    // Role label badge
    if (isUser) {
      pdf.setFillColor(25, 118, 210);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      const labelW = pdf.getTextWidth('You') + 8;
      pdf.roundedRect(margin, y - 3.5, labelW, 5.5, 1.5, 1.5, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.text('You', margin + 4, y + 0.3);
    } else {
      pdf.setFillColor(55, 65, 81);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      const labelW = pdf.getTextWidth('AI Assistant') + 8;
      pdf.roundedRect(margin, y - 3.5, labelW, 5.5, 1.5, 1.5, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.text('AI Assistant', margin + 4, y + 0.3);
    }
    y += 7;

    if (isUser) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(31, 41, 55);
      const wrapped: string[] = pdf.splitTextToSize(
        sanitizeNonAscii(msg.content),
        contentWidth,
      );
      for (const line of wrapped) {
        if (y > pageHeight - 22) { pdf.addPage(); y = margin; }
        pdf.text(line, margin, y);
        y += 5;
      }
    } else {
      y = renderMarkdownToPdf(pdf, msg.content, y, pageWidth, margin);
    }

    y += 8;

    // Separator
    pdf.setDrawColor(210, 218, 228);
    pdf.setLineWidth(0.15);
    pdf.line(margin, y, margin + contentWidth, y);
    y += 6;
  }

  // ── Headers & footers on every page ──
  const pageCount = pdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);

    // Top accent bar (already on page 1, add to rest)
    if (i > 1) {
      pdf.setFillColor(25, 118, 210);
      pdf.rect(0, 0, pageWidth, 1.5, 'F');
    }

    // Footer
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(156, 163, 175);
    const footerY = pageHeight - 8;
    // Footer rule
    pdf.setDrawColor(210, 218, 228);
    pdf.setLineWidth(0.15);
    pdf.line(margin, footerY - 3, pageWidth - margin, footerY - 3);
    pdf.text('Superset AI Insights', margin, footerY);
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
) {
  const [
    { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ShadingType, ImageRun, TabStopType, TabStopPosition, Header: DocxHeader, Footer: DocxFooter, PageNumber },
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
    const paragraphs: InstanceType<typeof Paragraph>[] = [];
    const lines = sanitizeNonAscii(text).split('\n');
    let inCodeBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: line, font: CODE_FONT, size: CODE_SIZE, color: '1E293B' })],
          shading: { type: ShadingType.SOLID, color: 'F3F4F6' },
          spacing: { before: 20, after: 20, line: 276 },
          indent: { left: 200 },
        }));
        continue;
      }
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
  const children: InstanceType<typeof Paragraph>[] = [];

  // Title
  children.push(new Paragraph({
    children: [new TextRun({ text: 'AI Insights Report', bold: true, size: 44, color: '1976D2', font: HEADING_FONT })],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.LEFT,
    spacing: { after: 60 },
  }));
  // Accent rule via bottom border
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '1976D2', space: 2 } },
    spacing: { after: 120 },
  }));
  // Meta line
  children.push(new Paragraph({
    children: [
      new TextRun({ text: `Generated: ${new Date().toLocaleString()}`, size: 18, color: '9CA3AF', italics: true, font: BODY_FONT }),
      new TextRun({ text: '     |     Superset AI Insights', size: 18, color: '9CA3AF', italics: true, font: BODY_FONT }),
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

  for (const msg of messages) {
    const isUser = msg.role === 'user';

    // Skip auto-generated chart-by-chart prompts in export
    if (isUser && msg.content.startsWith('Analyze each chart on this dashboard')) continue;

    // For assistant messages with dashboard chart images, split by ## sections
    const hasDashboardImages =
      !isUser &&
      images?.dashboardChartImages &&
      images?.dashboardCharts &&
      Object.keys(images.dashboardChartImages).length > 0;

    if (hasDashboardImages) {
      const sections = msg.content.split(/(?=^## )/m);
      for (const section of sections) {
        const headingMatch = section.match(/^## (.+)/m);
        const matched = matchChartDocx(headingMatch?.[1]?.trim());

        // Insert chart image before this section
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

        // Render the markdown section
        children.push(...markdownToDocx(section));
      }
      continue;
    }

    // Role label
    children.push(new Paragraph({
      children: [new TextRun({
        text: isUser ? 'You' : 'AI Assistant',
        bold: true, size: LABEL_SIZE, color: isUser ? '1976D2' : '374151', font: BODY_FONT,
      })],
      spacing: { before: SP_SECTION, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E5EAF0', space: 3 } },
    }));

    if (isUser) {
      children.push(new Paragraph({
        children: [new TextRun({ text: sanitizeNonAscii(msg.content), size: BODY_SIZE, font: BODY_FONT })],
        spacing: { before: 60, after: 120, line: 300 },
      }));
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
            children: [new TextRun({ text: 'AI Insights Report', size: 16, color: 'B0B8C8', italics: true, font: BODY_FONT })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      footers: {
        default: new DocxFooter({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'Superset AI Insights', size: 16, color: '9CA3AF', font: BODY_FONT }),
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
) {
  const PptxGenJS = (await import('pptxgenjs')).default;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33" × 7.5"
  pptx.author = 'Superset AI';
  pptx.title = 'AI Insights Report';
  pptx.subject = 'Generated by Superset AI Insights';

  // ── Design constants ──
  const BRAND = '1976D2';
  const BRAND_DARK = '0D47A1';
  const DARK = '1F2937';
  const GRAY = '6B7280';
  const LIGHT_BG = 'F8FAFC';
  const FONT = 'Calibri';
  const SLIDE_W = 13.33;
  const SLIDE_H = 7.5;

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
    // Header background
    slide.addShape('rect', {
      x: 0, y: 0.08, w: SLIDE_W, h: 0.72,
      fill: { color: LIGHT_BG },
    });
    // Header divider line
    slide.addShape('line', {
      x: 0, y: 0.8, w: SLIDE_W, h: 0,
      line: { color: 'D0D8E4', width: 0.5 },
    });
    // Slide title in header
    slide.addText(title, {
      x: 0.6, y: 0.15, w: 10, h: 0.5,
      fontSize: 18, bold: true, color: BRAND, fontFace: FONT,
    });
    // Footer separator
    slide.addShape('line', {
      x: 0.5, y: SLIDE_H - 0.5, w: SLIDE_W - 1, h: 0,
      line: { color: 'D0D8E4', width: 0.5 },
    });
    // Footer text
    slide.addText('Superset AI Insights', {
      x: 0.6, y: SLIDE_H - 0.45, w: 4, h: 0.3,
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
    totalSlides: number,
  ) {
    try {
      const slide = pptx.addSlide();
      applyMaster(slide, title, `${slideIdx}`);
      const dim = await getImageDimensions(dataUrl);
      const maxW = SLIDE_W - 1.4; // margins
      const maxH = SLIDE_H - 2.0; // header + footer
      const fit = fitImage(dim.width, dim.height, maxW * 96, maxH * 96); // px→in
      const wIn = fit.width / 96;
      const hIn = fit.height / 96;
      const xOff = (SLIDE_W - wIn) / 2;
      const yOff = 1.0 + (maxH - hIn) / 2;
      // Subtle shadow border
      slide.addShape('rect', {
        x: xOff - 0.05, y: yOff - 0.05, w: wIn + 0.1, h: hIn + 0.1,
        fill: { color: 'FFFFFF' },
        shadow: { type: 'outer', blur: 4, offset: 2, color: '00000020' },
        line: { color: 'E0E4EB', width: 0.5 },
        rectRadius: 0.05,
      });
      slide.addImage({ data: dataUrl, x: xOff, y: yOff, w: wIn, h: hIn });
    } catch { /* skip */ }
  }

  // ── Slide counter ──
  let slideCount = 0;

  // ── TITLE SLIDE ──
  const titleSlide = pptx.addSlide();
  slideCount += 1;

  // Full-bleed gradient-style background (solid brand colour + white overlay)
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
  // Decorative box (subtle background shape)
  titleSlide.addShape('rect', {
    x: 0.5, y: 1.8, w: 8, h: 3.5,
    fill: { color: LIGHT_BG },
    rectRadius: 0.1,
  });

  // Title text
  titleSlide.addText('AI Insights Report', {
    x: 1.2, y: 2.2, w: 7, h: 1.2,
    fontSize: 40, bold: true, color: BRAND_DARK, fontFace: FONT,
    lineSpacingMultiple: 1.1,
  });
  // Subtitle
  titleSlide.addText('Data-Driven Analysis & Recommendations', {
    x: 1.2, y: 3.3, w: 7, h: 0.5,
    fontSize: 16, color: GRAY, fontFace: FONT,
  });
  // Divider line
  titleSlide.addShape('line', {
    x: 1.2, y: 4.0, w: 3, h: 0,
    line: { color: BRAND, width: 2 },
  });
  // Date
  titleSlide.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), {
    x: 1.2, y: 4.3, w: 5, h: 0.4,
    fontSize: 13, color: GRAY, fontFace: FONT,
  });
  // Branding
  titleSlide.addText('Superset AI Insights', {
    x: 1.2, y: 4.7, w: 5, h: 0.35,
    fontSize: 11, color: BRAND, fontFace: FONT, italic: true,
  });

  // ── Chart preview slide (single chart mode) ──
  if (images?.chartPreviewUrl) {
    slideCount += 1;
    await addChartSlide(images.chartPreviewUrl, 'Chart Analyzed', slideCount, 0);
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

  /** Parse a markdown section into PPTX text segments. */
  type TextSeg = { text: string; options?: Record<string, unknown> };
  function markdownToTextParts(text: string): TextSeg[] {
    const parts: TextSeg[] = [];
    const lines = sanitizeNonAscii(text).split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { parts.push({ text: '\n', options: { fontSize: 8 } }); continue; }

      const alertMatch = trimmed.match(/^\[(CRITICAL|WARNING|GOOD|INFO)\]\s*(.*)/);
      if (alertMatch) {
        const [, tag, body] = alertMatch;
        const a = PPTX_ALERT[tag] || PPTX_ALERT.INFO;
        parts.push({ text: '\n', options: { fontSize: 4 } });
        parts.push({ text: ` ${a.label} `, options: { fontSize: 10, bold: true, color: 'FFFFFF', highlight: a.color, fontFace: FONT } });
        parts.push({ text: `  ${body}\n`, options: { fontSize: 11, color: DARK, fontFace: FONT } });
        continue;
      }

      const h1 = trimmed.match(/^# (.+)/);
      if (h1) { parts.push({ text: '\n', options: { fontSize: 6 } }); parts.push({ text: `${h1[1]}\n`, options: { fontSize: 20, bold: true, color: BRAND, fontFace: FONT } }); continue; }
      const h2 = trimmed.match(/^## (.+)/);
      if (h2) { parts.push({ text: '\n', options: { fontSize: 4 } }); parts.push({ text: `${h2[1]}\n`, options: { fontSize: 16, bold: true, color: BRAND, fontFace: FONT } }); continue; }
      const h3 = trimmed.match(/^### (.+)/);
      if (h3) { parts.push({ text: '\n', options: { fontSize: 3 } }); parts.push({ text: `${h3[1]}\n`, options: { fontSize: 14, bold: true, color: DARK, fontFace: FONT } }); continue; }

      const bullet = trimmed.match(/^[-*]\s+(.+)/);
      if (bullet) {
        const cleaned = bullet[1].replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
        parts.push({ text: `   \u2022  ${cleaned}\n`, options: { fontSize: 11, color: DARK, fontFace: FONT } });
        continue;
      }

      const num = trimmed.match(/^(\d+)[.)]\s+(.+)/);
      if (num) {
        const cleaned = num[2].replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
        parts.push({ text: `   ${num[1]}.  `, options: { fontSize: 11, bold: true, color: DARK, fontFace: FONT } });
        parts.push({ text: `${cleaned}\n`, options: { fontSize: 11, color: DARK, fontFace: FONT } });
        continue;
      }

      if (/^---+$/.test(trimmed)) { parts.push({ text: '\n', options: { fontSize: 6 } }); continue; }

      const plain = trimmed.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`([^`]+)`/g, '$1');
      parts.push({ text: `${plain}\n`, options: { fontSize: 11, color: DARK, fontFace: FONT } });
    }
    return parts;
  }

  /** Render text parts across one or more slides, returning updated slideCount. */
  function renderPartsToSlides(parts: TextSeg[], label: string) {
    const PARTS_PER_SLIDE = 22;
    const chunks: TextSeg[][] = [];
    for (let j = 0; j < parts.length; j += PARTS_PER_SLIDE) {
      chunks.push(parts.slice(j, j + PARTS_PER_SLIDE));
    }
    chunks.forEach((chunk, ci) => {
      slideCount += 1;
      const slide = pptx.addSlide();
      const title = ci === 0 ? label : `${label} (cont.)`;
      applyMaster(slide, title, `${slideCount}`);
      slide.addText(chunk as any, {
        x: 0.7, y: 1.0, w: SLIDE_W - 1.4, h: SLIDE_H - 1.8,
        fontSize: 11, color: DARK, fontFace: FONT,
        valign: 'top', lineSpacingMultiple: 1.4,
        paraSpaceAfter: 4,
      });
    });
  }

  // ── Content slides ──
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const hasDashboardImages =
    images?.dashboardChartImages &&
    images?.dashboardCharts &&
    Object.keys(images.dashboardChartImages).length > 0;

  for (let idx = 0; idx < assistantMessages.length; idx++) {
    const msg = assistantMessages[idx];

    // For dashboard chart-by-chart responses, split by ## sections
    // so each chart gets its own chart-image slide + analysis slides
    if (hasDashboardImages) {
      const sections = msg.content.split(/(?=^## )/m);
      for (const section of sections) {
        const headingMatch = section.match(/^## (.+)/m);
        const sectionTitle = headingMatch?.[1]?.trim();
        const matched = matchChartPptx(sectionTitle);

        // Chart image slide
        if (matched && images.dashboardChartImages![matched.chartId]) {
          slideCount += 1;
          await addChartSlide(
            images.dashboardChartImages![matched.chartId],
            matched.sliceName,
            slideCount,
            0,
          );
        }

        // Analysis slides for this section
        const parts = markdownToTextParts(section);
        if (parts.length > 0) {
          renderPartsToSlides(parts, sectionTitle || `Insight ${idx + 1}`);
        }
      }
    } else {
      // Non-dashboard or no chart images: render as before
      const parts = markdownToTextParts(msg.content);
      renderPartsToSlides(parts, `Insight ${idx + 1}`);
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
              <ExportButton onClick={() => void exportAsPdf(messages, { chartPreviewUrl, dashboardChartImages, dashboardCharts })}>
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
