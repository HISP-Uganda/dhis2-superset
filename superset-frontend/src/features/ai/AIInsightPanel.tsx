import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  css,
  getClientErrorObject,
  styled,
  t,
  useTheme,
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
  white-space: pre-wrap;
  word-break: break-word;
  align-self: ${({ $isUser }) => ($isUser ? 'flex-end' : 'flex-start')};
  background: ${({ $isUser }) =>
    $isUser ? 'var(--pro-blue, #1976D2)' : 'var(--pro-bg-card, #F3F4F6)'};
  color: ${({ $isUser }) => ($isUser ? '#fff' : '#1F2937')};
  border: ${({ $isUser }) =>
    $isUser ? 'none' : '1px solid var(--pro-border, #E5EAF0)'};
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
  span:nth-child(2) {
    animation-delay: 0.2s;
  }
  span:nth-child(3) {
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

/* ── Props ───────────────────────────────────────────── */

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
};

/* ── Suggestion prompts by mode ──────────────────────── */

const SUGGESTIONS: Record<AIInsightMode, string[]> = {
  chart: [
    'Summarize this chart',
    'What trends do you see?',
    'Are there any outliers?',
    'Compare the highest and lowest values',
  ],
  dashboard: [
    'Summarize this dashboard',
    'What are the key takeaways?',
    'Which metrics need attention?',
    'Are there any concerning trends?',
  ],
  sql: [
    'Show top 10 rows from this table',
    'Aggregate by district and period',
    'Find records with null values',
    'Create a summary query',
  ],
};

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
          if (response.sql) setLastSql(response.sql);

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
              </EmptyChat>
            )}

            {messages.map(msg => (
              <MessageBubble key={msg.id} $isUser={msg.role === 'user'}>
                {msg.content}
              </MessageBubble>
            ))}

            {streamingText && (
              <MessageBubble $isUser={false}>
                {streamingText}
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
                <ActionRow>
                  {onApplySql && (
                    <Button
                      buttonStyle="secondary"
                      onClick={() => onApplySql(lastSql!)}
                    >
                      {t('Apply to editor')}
                    </Button>
                  )}
                  {onRunSql && (
                    <Button onClick={() => onRunSql(lastSql!)}>
                      {t('Run in SQL Lab')}
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
