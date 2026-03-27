import { QueryData } from '@superset-ui/core';

export type AIInsightMode = 'chart' | 'dashboard' | 'sql';

export type AIConversationMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AIProviderCapability = {
  id: string;
  label: string;
  models: string[];
  default_model?: string | null;
  provider_type: string;
  is_local: boolean;
  available: boolean;
};

export type AICapabilities = {
  default_provider?: string | null;
  default_model?: string | null;
  providers: AIProviderCapability[];
  allow_sql_execution?: boolean;
  max_context_rows?: number;
};

export type AIInsightResult = {
  mode: AIInsightMode;
  question: string;
  insight?: string;
  provider: string;
  model: string;
  duration_ms?: number;
  sql?: string;
  tables?: string[];
  validated?: boolean;
  explanation?: string;
  assumptions?: string[];
  follow_ups?: string[];
  execution?: {
    row_count: number;
    sample_rows: Record<string, unknown>[];
  } | null;
  database_backend?: string;
};

export type QueryResponseSummary = {
  row_count: number;
  columns: string[];
  sample_rows: Record<string, unknown>[];
  applied_filters?: unknown;
  rejected_filters?: unknown;
  error?: string | null;
};

export type ChartInsightContext = {
  chart: {
    id?: number;
    name?: string;
    viz_type?: string;
    form_data?: Record<string, unknown>;
  };
  query_result: QueryResponseSummary;
  datasource?: unknown;
};

export type DashboardInsightContext = {
  dashboard: {
    id?: number | string;
    title?: string;
    active_filters?: unknown;
  };
  charts: ChartInsightContext[];
};

export type QueryDataLike = QueryData | Record<string, any> | null | undefined;

