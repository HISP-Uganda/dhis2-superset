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
/* eslint-disable no-restricted-imports, theme-colors/no-literal-colors, import/no-extraneous-dependencies */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoldOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { isProbablyHTML, sanitizeHtml, styled, t } from '@superset-ui/core';
import { Button, Space } from 'antd';

const Composer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 12px;
  background: #f8fafc;
`;

const EditorSurface = styled.div<{ $minHeight?: number }>`
  min-height: ${({ $minHeight = 180 }) => `${$minHeight}px`};
  padding: 14px 16px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 14px;
  background: #ffffff;
  color: #172b4d;
  line-height: 1.7;
  outline: none;
  overflow-wrap: anywhere;

  &:focus {
    border-color: #0f766e;
    box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.12);
  }

  &:empty::before {
    content: attr(data-placeholder);
    color: #94a3b8;
  }

  p:first-of-type,
  ul:first-of-type,
  ol:first-of-type,
  blockquote:first-of-type,
  h1:first-of-type,
  h2:first-of-type,
  h3:first-of-type,
  h4:first-of-type {
    margin-top: 0;
  }

  p:last-child,
  ul:last-child,
  ol:last-child,
  blockquote:last-child,
  h1:last-child,
  h2:last-child,
  h3:last-child,
  h4:last-child {
    margin-bottom: 0;
  }
`;

const HelperText = styled.div`
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: 12px;
`;

type RichTextComposerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: number;
  helperText?: string;
};

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toEditorHtml(value: string) {
  if (!value) {
    return '';
  }
  if (isProbablyHTML(value)) {
    return sanitizeHtml(value);
  }
  const paragraphs = value
    .split(/\n{2,}/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => `<p>${escapeHtml(chunk).replace(/\n/g, '<br />')}</p>`)
    .join('');
  return paragraphs || `<p>${escapeHtml(value)}</p>`;
}

export function extractPlainText(html: string) {
  if (typeof document === 'undefined') {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.textContent || container.innerText || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function RichTextComposer({
  value,
  onChange,
  placeholder = t('Write content'),
  readOnly = false,
  minHeight = 180,
  helperText,
}: RichTextComposerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const normalizedValue = useMemo(() => toEditorHtml(value), [value]);

  useEffect(() => {
    if (!editorRef.current || isFocused) {
      return;
    }
    if (editorRef.current.innerHTML !== normalizedValue) {
      editorRef.current.innerHTML = normalizedValue;
    }
  }, [normalizedValue, isFocused]);

  function emitChange() {
    if (!editorRef.current) {
      return;
    }
    onChange(sanitizeHtml(editorRef.current.innerHTML || ''));
  }

  function runCommand(command: string, argument?: string) {
    if (readOnly || !editorRef.current) {
      return;
    }
    editorRef.current.focus();
    document.execCommand(command, false, argument);
    emitChange();
  }

  function promptForLink() {
    if (readOnly || typeof window === 'undefined') {
      return;
    }
    // CMS authoring uses an inline prompt here to keep the editor lightweight.
    // eslint-disable-next-line no-alert
    const link = window.prompt(t('Enter a URL'), 'https://');
    if (!link) {
      return;
    }
    runCommand('createLink', link);
  }

  return (
    <Composer>
      <Toolbar>
        <Space wrap>
          <Button size="small" onClick={() => runCommand('bold')}>
            <BoldOutlined />
          </Button>
          <Button size="small" onClick={() => runCommand('italic')}>
            <ItalicOutlined />
          </Button>
          <Button size="small" onClick={() => runCommand('underline')}>
            <UnderlineOutlined />
          </Button>
          <Button size="small" onClick={() => runCommand('strikeThrough')}>
            <StrikethroughOutlined />
          </Button>
          <Button
            size="small"
            onClick={() => runCommand('insertUnorderedList')}
          >
            <UnorderedListOutlined />
          </Button>
          <Button size="small" onClick={() => runCommand('insertOrderedList')}>
            <OrderedListOutlined />
          </Button>
          <Button size="small" onClick={() => runCommand('formatBlock', '<p>')}>
            {t('P')}
          </Button>
          <Button
            size="small"
            onClick={() => runCommand('formatBlock', '<h2>')}
          >
            {t('H2')}
          </Button>
          <Button
            size="small"
            onClick={() => runCommand('formatBlock', '<h3>')}
          >
            {t('H3')}
          </Button>
          <Button
            size="small"
            onClick={() => runCommand('formatBlock', '<blockquote>')}
          >
            {t('Quote')}
          </Button>
          <Button size="small" onClick={promptForLink}>
            <LinkOutlined />
          </Button>
          <Button size="small" onClick={() => runCommand('removeFormat')}>
            {t('Clear')}
          </Button>
        </Space>
      </Toolbar>
      <EditorSurface
        ref={editorRef}
        $minHeight={minHeight}
        data-placeholder={placeholder}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          emitChange();
        }}
        onInput={emitChange}
      />
      {helperText ? <HelperText>{helperText}</HelperText> : null}
    </Composer>
  );
}
