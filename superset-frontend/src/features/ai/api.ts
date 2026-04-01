import { SupersetClient } from '@superset-ui/core';
import {
  AICapabilities,
  AIConversationMessage,
  AIConversationSummary,
  AIInsightMode,
  AIInsightResult,
} from './types';

function getCapabilitiesEndpoint(mode: AIInsightMode) {
  if (mode === 'dashboard') return '/api/v1/ai/dashboard/capabilities';
  if (mode === 'sql') return '/api/v1/ai/sql/capabilities';
  return '/api/v1/ai/chart/capabilities';
}

function getActionEndpoint(
  mode: AIInsightMode,
  targetId?: number | string,
  isPublic = false,
) {
  if (mode === 'dashboard') {
    const base = isPublic ? '/api/v1/ai/public/dashboard' : '/api/v1/ai/dashboard';
    return `${base}/${targetId}/insight`;
  }
  if (mode === 'sql') return '/api/v1/ai/sql/assistant';
  return `/api/v1/ai/chart/${targetId}/insight`;
}

function getStreamEndpoint(
  mode: AIInsightMode,
  targetId?: number | string,
  isPublic = false,
) {
  if (mode === 'dashboard') {
    const base = isPublic ? '/api/v1/ai/public/dashboard' : '/api/v1/ai/dashboard';
    return `${base}/${targetId}/insight/stream`;
  }
  return `/api/v1/ai/chart/${targetId}/insight/stream`;
}

export async function fetchAICapabilities(
  mode: AIInsightMode,
): Promise<AICapabilities> {
  const { json } = await SupersetClient.get({
    endpoint: getCapabilitiesEndpoint(mode),
  });
  return json.result;
}

export async function requestAIInsight(input: {
  mode: AIInsightMode;
  targetId?: number | string;
  providerId?: string | null;
  model?: string | null;
  question: string;
  context: Record<string, unknown>;
  conversation: AIConversationMessage[];
  currentSql?: string;
  databaseId?: number;
  schema?: string | null;
  execute?: boolean;
}): Promise<AIInsightResult> {
  const { json } = await SupersetClient.post({
    endpoint: getActionEndpoint(input.mode, input.targetId),
    jsonPayload: {
      provider_id: input.providerId || null,
      model: input.model || null,
      question: input.question,
      context: input.context,
      conversation: input.conversation,
      current_sql: input.currentSql || null,
      database_id: input.databaseId ?? null,
      schema: input.schema ?? null,
      execute: Boolean(input.execute),
    },
  });
  return json.result;
}

/**
 * Stream AI insight via SSE. Calls onChunk with each text fragment,
 * onDone when complete, onError on failure.
 */
export async function requestAIInsightStream(input: {
  mode: AIInsightMode;
  targetId?: number | string;
  providerId?: string | null;
  model?: string | null;
  question: string;
  context: Record<string, unknown>;
  conversation: AIConversationMessage[];
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
}): Promise<void> {
  // SQL mode doesn't support streaming (needs structured JSON response)
  if (input.mode === 'sql') {
    try {
      const result = await requestAIInsight({
        ...input,
        currentSql: undefined,
        execute: false,
      });
      input.onDone(result.insight || result.explanation || result.sql || '');
    } catch (err: any) {
      input.onError(err?.message || 'Request failed');
    }
    return;
  }

  const endpoint = getStreamEndpoint(input.mode, input.targetId);
  const csrfToken = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrf_access_token='))
    ?.split('=')[1];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (csrfToken) {
    headers['X-CSRFToken'] = csrfToken;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({
      provider_id: input.providerId || null,
      model: input.model || null,
      question: input.question,
      context: input.context,
      conversation: input.conversation,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    input.onError(`HTTP ${response.status}: ${text}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    input.onError('Streaming not supported');
    return;
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.error) {
          input.onError(data.error);
          return;
        }
        if (data.text) {
          fullText += data.text;
          input.onChunk(fullText);
        }
        if (data.done) {
          input.onDone(fullText);
          return;
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }
  input.onDone(fullText);
}

/* ── Conversation persistence API ─────────────────── */

export async function listConversations(params?: {
  mode?: string;
  targetId?: string;
  limit?: number;
}): Promise<AIConversationSummary[]> {
  const searchParams = new URLSearchParams();
  if (params?.mode) searchParams.set('mode', params.mode);
  if (params?.targetId) searchParams.set('target_id', params.targetId);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/ai/conversations/${qs ? `?${qs}` : ''}`,
  });
  return json.result;
}

export async function getConversation(
  conversationId: number,
): Promise<AIConversationSummary & { messages: AIConversationMessage[] }> {
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/ai/conversations/${conversationId}`,
  });
  return json.result;
}

export async function createConversation(payload: {
  mode: string;
  target_id?: string | null;
  title?: string | null;
  provider_id?: string | null;
  model_name?: string | null;
}): Promise<AIConversationSummary> {
  const { json } = await SupersetClient.post({
    endpoint: '/api/v1/ai/conversations/',
    jsonPayload: payload,
  });
  return json.result;
}

export async function appendMessage(
  conversationId: number,
  message: { role: string; content: string; duration_ms?: number },
): Promise<void> {
  await SupersetClient.post({
    endpoint: `/api/v1/ai/conversations/${conversationId}/messages`,
    jsonPayload: message,
  });
}

export async function deleteConversation(
  conversationId: number,
): Promise<void> {
  await SupersetClient.delete({
    endpoint: `/api/v1/ai/conversations/${conversationId}`,
  });
}
