import { SupersetClient } from '@superset-ui/core';
import {
  AICapabilities,
  AIConversationMessage,
  AIInsightMode,
  AIInsightResult,
} from './types';

function getCapabilitiesEndpoint(mode: AIInsightMode) {
  if (mode === 'dashboard') return '/api/v1/ai/dashboard/capabilities';
  if (mode === 'sql') return '/api/v1/ai/sql/capabilities';
  return '/api/v1/ai/chart/capabilities';
}

function getActionEndpoint(mode: AIInsightMode, targetId?: number | string) {
  if (mode === 'dashboard') return `/api/v1/ai/dashboard/${targetId}/insight`;
  if (mode === 'sql') return '/api/v1/ai/sql/assistant';
  return `/api/v1/ai/chart/${targetId}/insight`;
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

