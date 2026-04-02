import { useCallback, useEffect, useMemo, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Tabs,
  Tag,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { Typography } from '@superset-ui/core/components/Typography';

import { useToasts } from 'src/components/MessageToasts/withToasts';
import { resetAIEnabledCache } from 'src/features/ai/useAIEnabled';
import PushAnalysisTab from './PushAnalysisTab';
import UsageAnalyticsTab from './UsageAnalyticsTab';

const { Title, Paragraph, Text } = Typography;

type AIProviderConfig = {
  enabled: boolean;
  type: string;
  label?: string | null;
  base_url?: string | null;
  api_key?: string | null;
  api_key_env?: string | null;
  has_api_key?: boolean;
  clear_api_key?: boolean;
  organization_id?: string | null;
  models: string[];
  default_model?: string | null;
  is_local?: boolean;
  catalog_key?: string | null;
};

type AISettings = {
  enabled: boolean;
  allow_sql_execution: boolean;
  allow_public_dashboard_ai: boolean;
  public_ai_max_tokens: number;
  public_ai_rate_limit_per_minute: number;
  max_context_rows: number;
  max_context_columns: number;
  max_dashboard_charts: number;
  max_follow_up_messages: number;
  max_generated_sql_rows: number;
  request_timeout_seconds: number;
  max_tokens: number;
  temperature: number;
  default_provider?: string | null;
  default_model?: string | null;
  allowed_roles: string[];
  mode_roles: Record<string, string[]>;
  providers: Record<string, AIProviderConfig>;
};

type ProviderPreset = {
  id: string;
  provider_type: string;
  label: string;
  description: string;
  catalog_key?: string | null;
  default_base_url?: string | null;
  default_model?: string | null;
  is_local?: boolean;
  supports_base_url?: boolean;
  supports_api_key?: boolean;
  supports_api_key_env?: boolean;
};

type ModelCatalogItem = {
  id: string;
  label: string;
  group?: string;
  description?: string;
  is_latest?: boolean;
  is_recommended?: boolean;
  is_deprecated?: boolean;
};

type AIManagementPayload = {
  feature_flag_enabled: boolean;
  settings: AISettings;
  provider_presets: ProviderPreset[];
  model_catalogs: Record<string, ModelCatalogItem[]>;
  role_names: string[];
};

/* ── Pro Theme styled components ─────────────────────── */

const PageContainer = styled.div`
  ${({ theme }) => css`
    width: 100%;
    margin: 0;
    padding: ${theme.sizeUnit * 4}px ${theme.sizeUnit * 5}px;

    @media (max-width: 768px) {
      padding: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 3}px;
    }
  `}
`;

const SectionCard = styled(Card)`
  ${({ theme }) => css`
    border-radius: ${theme.borderRadiusLG}px;
    box-shadow: 0 10px 32px rgba(15, 23, 42, 0.05);

    .ant-card-body {
      padding: ${theme.sizeUnit * 4}px;
    }
  `}
`;

const MetricsGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: ${theme.sizeUnit * 3}px;

    @media (max-width: 1000px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (max-width: 640px) {
      grid-template-columns: 1fr;
    }
  `}
`;

const ProviderGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: ${theme.sizeUnit * 3}px;

    @media (max-width: 1040px) {
      grid-template-columns: 1fr;
    }
  `}
`;

const ProviderCard = styled(Card, {
  shouldForwardProp: prop => prop !== '$active',
})<{ $active?: boolean }>`
  ${({ theme, $active }) => css`
    border-radius: ${theme.borderRadiusLG}px;
    border: 2px solid
      ${$active ? theme.colorPrimary : theme.colorBorderSecondary};
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    .ant-card-body {
      padding: ${theme.sizeUnit * 3}px;
    }

    ${$active &&
    css`
      box-shadow: 0 0 0 2px ${theme.colorPrimaryBg};
    `}
  `}
`;

const ProviderHeader = styled.div`
  ${({ theme }) => css`
    display: flex;
    justify-content: space-between;
    gap: ${theme.sizeUnit * 2}px;
    align-items: flex-start;
    margin-bottom: ${theme.sizeUnit * 2}px;
  `}
`;

/* ── Helpers ─────────────────────────────────────────── */

function buildGroupedOptions(items: ModelCatalogItem[]) {
  const groups = new Map<string, ModelCatalogItem[]>();
  items.forEach(item => {
    const group = item.group || t('Models');
    const current = groups.get(group) || [];
    current.push(item);
    groups.set(group, current);
  });
  return Array.from(groups.entries()).map(([label, groupItems]) => ({
    label,
    options: groupItems.map(item => ({
      label: `${item.label}${item.is_latest ? ' \u00b7 Latest' : ''}${
        item.is_recommended ? ' \u00b7 Recommended' : ''
      }${item.is_deprecated ? ' \u00b7 Deprecated' : ''}`,
      value: item.id,
    })),
  }));
}

function normalizeProviderForUI(
  providerId: string,
  provider: AIProviderConfig,
  preset?: ProviderPreset,
  catalogItems?: ModelCatalogItem[],
): AIProviderConfig {
  const catalogIds = (catalogItems || []).map(item => item.id);
  // Merge: keep every saved model, then append any new catalog models
  // so newly added models automatically appear in the allowed list.
  const saved = provider.models?.length ? provider.models : [];
  const savedSet = new Set(saved);
  const newFromCatalog = catalogIds.filter(id => !savedSet.has(id));
  const models = saved.length > 0 ? [...saved, ...newFromCatalog] : catalogIds;
  return {
    enabled: Boolean(provider.enabled),
    type: provider.type || preset?.provider_type || 'openai_compatible',
    label: provider.label || preset?.label || providerId,
    base_url:
      provider.base_url ??
      preset?.default_base_url ??
      (provider.type === 'ollama' ? 'http://127.0.0.1:11434' : ''),
    api_key: provider.api_key || '',
    api_key_env: provider.api_key_env || '',
    has_api_key: Boolean(provider.has_api_key),
    clear_api_key: Boolean(provider.clear_api_key),
    organization_id: provider.organization_id || '',
    models,
    default_model:
      provider.default_model || preset?.default_model || models[0] || null,
    is_local: Boolean(provider.is_local ?? preset?.is_local),
    catalog_key: provider.catalog_key ?? preset?.catalog_key ?? null,
  };
}

/**
 * Build flat model options for the Default Model selector from ALL enabled
 * providers, grouped by provider label.
 */
function buildDefaultModelOptions(
  providerEntries: Array<
    [string, AIProviderConfig, ProviderPreset | undefined]
  >,
  modelCatalogs: Record<string, ModelCatalogItem[]>,
) {
  return providerEntries
    .filter(([, p]) => p.enabled)
    .map(([pid, provider, preset]) => {
      const catalogKey =
        provider.catalog_key || preset?.catalog_key || '';
      const catalogItems = modelCatalogs[catalogKey] || [];
      const catalogMap = new Map(
        catalogItems.map(ci => [ci.id, ci]),
      );
      return {
        label: provider.label || pid,
        options: provider.models.map(modelId => {
          const ci = catalogMap.get(modelId);
          return {
            label: ci
              ? `${ci.label}${ci.is_recommended ? ' \u00b7 Recommended' : ''}`
              : modelId,
            value: `${pid}::${modelId}`,
          };
        }),
      };
    });
}

/* ── Component ───────────────────────────────────────── */

export default function AIManagement() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(
    null,
  );
  const [payload, setPayload] = useState<AIManagementPayload | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const { json } = await SupersetClient.get({
        endpoint: '/api/v1/ai-management/settings',
      });
      setPayload(json.result as AIManagementPayload);
    } catch (error: any) {
      addDangerToast(error?.message || t('Unable to load AI settings'));
    } finally {
      setLoading(false);
    }
  }, [addDangerToast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const providerPresetMap = useMemo(
    () =>
      new Map(
        (payload?.provider_presets || []).map(preset => [preset.id, preset]),
      ),
    [payload?.provider_presets],
  );

  const providerEntries = useMemo(() => {
    const settings = payload?.settings;
    if (!settings) {
      return [] as Array<
        [string, AIProviderConfig, ProviderPreset | undefined]
      >;
    }
    return Object.entries(settings.providers).map(([providerId, provider]) => [
      providerId,
      normalizeProviderForUI(
        providerId,
        provider,
        providerPresetMap.get(providerId),
        payload?.model_catalogs?.[
          provider.catalog_key ||
            providerPresetMap.get(providerId)?.catalog_key ||
            ''
        ],
      ),
      providerPresetMap.get(providerId),
    ] as [string, AIProviderConfig, ProviderPreset | undefined]);
  }, [payload, providerPresetMap]);

  const enabledProviders = providerEntries.filter(
    ([, provider]) => provider.enabled,
  );

  const defaultModelOptions = useMemo(
    () =>
      payload
        ? buildDefaultModelOptions(
            providerEntries,
            payload.model_catalogs,
          )
        : [],
    [providerEntries, payload],
  );

  /** Resolve the combined "provider::model" value for the default model selector */
  const defaultModelCombo =
    payload?.settings.default_provider && payload?.settings.default_model
      ? `${payload.settings.default_provider}::${payload.settings.default_model}`
      : undefined;

  const updateSettings = (patch: Partial<AISettings>) => {
    setPayload(current =>
      current
        ? {
            ...current,
            settings: {
              ...current.settings,
              ...patch,
            },
          }
        : current,
    );
  };

  const updateProvider = (
    providerId: string,
    patch: Partial<AIProviderConfig>,
  ) => {
    setPayload(current => {
      if (!current) return current;
      const existing = current.settings.providers[providerId];
      if (!existing) return current;
      const nextProvider = { ...existing, ...patch };
      if (
        patch.models &&
        nextProvider.default_model &&
        !patch.models.includes(nextProvider.default_model)
      ) {
        nextProvider.default_model = patch.models[0] || null;
      }
      return {
        ...current,
        settings: {
          ...current.settings,
          providers: {
            ...current.settings.providers,
            [providerId]: nextProvider,
          },
        },
      };
    });
  };

  const save = async () => {
    if (!payload) return;
    setSaving(true);
    try {
      const { json } = await SupersetClient.put({
        endpoint: '/api/v1/ai-management/settings',
        jsonPayload: payload.settings,
      });
      setPayload(json.result as AIManagementPayload);
      resetAIEnabledCache();
      addSuccessToast(t('AI settings saved'));
    } catch (error: any) {
      addDangerToast(error?.message || t('Unable to save AI settings'));
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async (
    providerId: string,
    provider: AIProviderConfig,
  ) => {
    setTestingProviderId(providerId);
    try {
      const { json } = await SupersetClient.post({
        endpoint: '/api/v1/ai-management/test-provider',
        jsonPayload: {
          provider_id: providerId,
          model: provider.default_model,
          provider,
          prompt: 'Reply with OK only.',
        },
      });
      addSuccessToast(
        t('Provider test succeeded: %s', json.result?.text || 'OK'),
      );
    } catch (error: any) {
      // SupersetClient rejects with the raw Response object on non-OK status.
      let msg = t('Provider test failed');
      try {
        if (typeof error?.json === 'function') {
          const body = await error.json();
          if (body?.message) msg = `${msg}: ${body.message}`;
        } else if (error?.message) {
          msg = `${msg}: ${error.message}`;
        }
      } catch {
        // ignore parse errors
      }
      addDangerToast(msg);
    } finally {
      setTestingProviderId(null);
    }
  };

  if (loading || !payload) {
    return (
      <PageContainer>
        <Spin />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* ── Page header ──────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <Space
          align="start"
          size="large"
          style={{ justifyContent: 'space-between', width: '100%' }}
          wrap
        >
          <Space align="start" size="middle">
            <Icons.ExperimentOutlined style={{ fontSize: 28, marginTop: 4 }} />
            <div>
              <Title level={3} style={{ margin: 0 }}>
                {t('AI Management')}
              </Title>
              <Paragraph type="secondary" style={{ margin: '4px 0 0', maxWidth: 720 }}>
                {t(
                  'Manage AI providers, model access, defaults, execution policy, and test connectivity from one admin surface.',
                )}
              </Paragraph>
            </div>
          </Space>
          <Space wrap>
            <Button
              icon={<Icons.ReloadOutlined />}
              onClick={() => void loadSettings()}
            >
              {t('Reload')}
            </Button>
            <Button
              type="primary"
              icon={<Icons.SaveOutlined />}
              loading={saving}
              onClick={save}
            >
              {t('Save AI Settings')}
            </Button>
          </Space>
        </Space>
      </div>

      {!payload.feature_flag_enabled && (
        <Alert
          type="warning"
          showIcon
          message={t(
            'The AI_INSIGHTS feature flag is disabled in server configuration.',
          )}
          description={t(
            'You can still manage providers here, but chart, dashboard, and SQL AI actions will remain unavailable until the server feature flag is enabled.',
          )}
          style={{ marginBottom: 24 }}
        />
      )}

      {/* ── Metrics strip ────────────────────────────────── */}
      <MetricsGrid style={{ marginBottom: 24 }}>
        <Card>
          <Statistic
            title={t('AI Status')}
            value={payload.settings.enabled ? t('Enabled') : t('Disabled')}
            prefix={<Icons.ThunderboltOutlined />}
          />
        </Card>
        <Card>
          <Statistic
            title={t('Enabled Providers')}
            value={enabledProviders.length}
            prefix={<Icons.DatabaseOutlined />}
          />
        </Card>
        <Card>
          <Statistic
            title={t('Default Provider')}
            value={
              payload.settings.default_provider
                ? payload.settings.providers[payload.settings.default_provider]
                    ?.label || payload.settings.default_provider
                : t('None')
            }
            prefix={<Icons.SettingOutlined />}
          />
        </Card>
        <Card>
          <Statistic
            title={t('Feature Flag')}
            value={payload.feature_flag_enabled ? t('On') : t('Off')}
            prefix={<Icons.CheckCircleOutlined />}
          />
        </Card>
      </MetricsGrid>

      {/* ── Tabs ─────────────────────────────────────────── */}
      <Tabs
        defaultActiveKey="settings"
        size="large"
        items={[
          {
            key: 'settings',
            label: (
              <Space>
                <Icons.SettingOutlined />
                {t('Settings & Providers')}
              </Space>
            ),
            children: (
              <Space direction="vertical" size={24} style={{ width: '100%' }}>
                {/* ── Authenticated AI toggle ────────────── */}
                <SectionCard title={t('Authenticated Users')}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <Form layout="vertical">
                        <Form.Item
                          label={t('Enable AI insights (authenticated)')}
                          extra={t(
                            'Turn on chart, dashboard, and SQL AI assistance for logged-in users.',
                          )}
                        >
                          <Switch
                            checked={payload.settings.enabled}
                            onChange={checked =>
                              updateSettings({ enabled: checked })
                            }
                          />
                        </Form.Item>
                        <Form.Item
                          label={t('Allow SQL execution')}
                          extra={t(
                            'Permit AI SQL responses to run validated MART-only queries.',
                          )}
                        >
                          <Switch
                            checked={payload.settings.allow_sql_execution}
                            onChange={checked =>
                              updateSettings({ allow_sql_execution: checked })
                            }
                          />
                        </Form.Item>
                      </Form>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form layout="vertical">
                        <Form.Item
                          label={t('Default provider & model')}
                          extra={t(
                            'Select the provider and model used when no explicit choice is made.',
                          )}
                        >
                          <Select
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder={t('Select a provider and model')}
                            value={defaultModelCombo}
                            options={defaultModelOptions}
                            onChange={value => {
                              if (!value) {
                                updateSettings({
                                  default_provider: null,
                                  default_model: null,
                                });
                                return;
                              }
                              const [pid, mid] = (value as string).split('::');
                              updateSettings({
                                default_provider: pid,
                                default_model: mid,
                              });
                            }}
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      </Form>
                    </Col>
                  </Row>
                </SectionCard>

                {/* ── Public / embedded AI toggle ─────────── */}
                <SectionCard title={t('Public & Embedded Dashboards')}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <Form layout="vertical">
                        <Form.Item
                          label={t('Enable AI insights (public)')}
                          extra={t(
                            'Allow guest-token and embedded dashboard viewers to use AI insights.',
                          )}
                        >
                          <Switch
                            checked={payload.settings.allow_public_dashboard_ai}
                            onChange={checked =>
                              updateSettings({
                                allow_public_dashboard_ai: checked,
                              })
                            }
                          />
                        </Form.Item>
                      </Form>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form layout="vertical">
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item
                              label={t('Public max tokens')}
                              extra={t(
                                'Limit response length for public viewers.',
                              )}
                            >
                              <InputNumber
                                min={100}
                                max={4000}
                                style={{ width: '100%' }}
                                value={
                                  payload.settings.public_ai_max_tokens
                                }
                                onChange={value =>
                                  updateSettings({
                                    public_ai_max_tokens: Number(
                                      value || 600,
                                    ),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              label={t('Rate limit (req/min)')}
                              extra={t(
                                'Max requests per minute per public session.',
                              )}
                            >
                              <InputNumber
                                min={1}
                                max={120}
                                style={{ width: '100%' }}
                                value={
                                  payload.settings
                                    .public_ai_rate_limit_per_minute
                                }
                                onChange={value =>
                                  updateSettings({
                                    public_ai_rate_limit_per_minute: Number(
                                      value || 10,
                                    ),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Form>
                    </Col>
                  </Row>
                </SectionCard>

                {/* ── Tuning ─────────────────────────────── */}
                <SectionCard title={t('Request Tuning')}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <Form layout="vertical">
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item label={t('Request timeout (s)')}>
                              <InputNumber
                                min={5}
                                max={180}
                                style={{ width: '100%' }}
                                value={
                                  payload.settings.request_timeout_seconds
                                }
                                onChange={value =>
                                  updateSettings({
                                    request_timeout_seconds: Number(
                                      value || 30,
                                    ),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label={t('Max tokens')}>
                              <InputNumber
                                min={100}
                                max={16000}
                                style={{ width: '100%' }}
                                value={payload.settings.max_tokens}
                                onChange={value =>
                                  updateSettings({
                                    max_tokens: Number(value || 1200),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item label={t('Temperature')}>
                              <InputNumber
                                min={0}
                                max={2}
                                step={0.1}
                                style={{ width: '100%' }}
                                value={payload.settings.temperature}
                                onChange={value =>
                                  updateSettings({
                                    temperature: Number(value || 0.1),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label={t('Max dashboard charts')}>
                              <InputNumber
                                min={1}
                                max={100}
                                style={{ width: '100%' }}
                                value={
                                  payload.settings.max_dashboard_charts
                                }
                                onChange={value =>
                                  updateSettings({
                                    max_dashboard_charts: Number(
                                      value || 12,
                                    ),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Form>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Form layout="vertical">
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item label={t('Max context rows')}>
                              <InputNumber
                                min={1}
                                max={200}
                                style={{ width: '100%' }}
                                value={payload.settings.max_context_rows}
                                onChange={value =>
                                  updateSettings({
                                    max_context_rows: Number(value || 20),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label={t('Max generated SQL rows')}>
                              <InputNumber
                                min={1}
                                max={5000}
                                style={{ width: '100%' }}
                                value={
                                  payload.settings.max_generated_sql_rows
                                }
                                onChange={value =>
                                  updateSettings({
                                    max_generated_sql_rows: Number(
                                      value || 200,
                                    ),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item label={t('Max context columns')}>
                              <InputNumber
                                min={1}
                                max={100}
                                style={{ width: '100%' }}
                                value={
                                  payload.settings.max_context_columns
                                }
                                onChange={value =>
                                  updateSettings({
                                    max_context_columns: Number(
                                      value || 25,
                                    ),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label={t('Max follow-up messages')}>
                              <InputNumber
                                min={1}
                                max={20}
                                style={{ width: '100%' }}
                                value={
                                  payload.settings.max_follow_up_messages
                                }
                                onChange={value =>
                                  updateSettings({
                                    max_follow_up_messages: Number(
                                      value || 6,
                                    ),
                                  })
                                }
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Form>
                    </Col>
                  </Row>
                </SectionCard>

                {/* ── Access & Roles ─────────────────────── */}
                <SectionCard title={t('Access & Roles')}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <Form layout="vertical">
                        <Form.Item
                          label={t('Global allowed roles')}
                          extra={t(
                            'Leave empty to allow all authenticated users with feature access.',
                          )}
                        >
                          <Select
                            mode="multiple"
                            value={payload.settings.allowed_roles}
                            options={payload.role_names.map(role => ({
                              label: role,
                              value: role,
                            }))}
                            onChange={value =>
                              updateSettings({ allowed_roles: value })
                            }
                          />
                        </Form.Item>
                      </Form>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Row gutter={[12, 12]}>
                        {(['chart', 'dashboard', 'sql'] as const).map(
                          mode => (
                            <Col xs={24} key={mode}>
                              <Form layout="vertical">
                                <Form.Item
                                  label={t('%s mode roles', mode)}
                                >
                                  <Select
                                    mode="multiple"
                                    value={
                                      payload.settings.mode_roles?.[mode] ||
                                      []
                                    }
                                    options={payload.role_names.map(
                                      role => ({
                                        label: role,
                                        value: role,
                                      }),
                                    )}
                                    onChange={value =>
                                      updateSettings({
                                        mode_roles: {
                                          ...payload.settings.mode_roles,
                                          [mode]: value,
                                        },
                                      })
                                    }
                                  />
                                </Form.Item>
                              </Form>
                            </Col>
                          ),
                        )}
                      </Row>
                    </Col>
                  </Row>
                </SectionCard>

                {/* ── Providers ───────────────────────────── */}
                <SectionCard
                  title={t('Providers')}
                  extra={
                    <Space>
                      <Tag color="blue">
                        {t('%s providers', providerEntries.length)}
                      </Tag>
                      <Tag color="green">
                        {t('%s enabled', enabledProviders.length)}
                      </Tag>
                    </Space>
                  }
                >
                  <ProviderGrid>
                    {providerEntries.map(
                      ([providerId, provider, preset]) => {
                        const catalogItems =
                          payload.model_catalogs[
                            provider.catalog_key ||
                              preset?.catalog_key ||
                              ''
                          ] || [];
                        const catalogOptions =
                          catalogItems.length > 0
                            ? buildGroupedOptions(catalogItems)
                            : [];
                        // Ensure every selected model appears in the
                        // options so rc-select never triggers an
                        // internal setState during render reconciliation.
                        const knownValues = new Set(
                          catalogItems.map(ci => ci.id),
                        );
                        const extraModels = provider.models.filter(
                          m => !knownValues.has(m),
                        );
                        const modelOptions = [
                          ...catalogOptions,
                          ...(extraModels.length > 0
                            ? [
                                {
                                  label: t('Custom'),
                                  options: extraModels.map(m => ({
                                    label: m,
                                    value: m,
                                  })),
                                },
                              ]
                            : []),
                        ];
                        return (
                          <ProviderCard
                            key={providerId}
                            $active={provider.enabled}
                          >
                            <ProviderHeader>
                              <div>
                                <Space align="center" size={8} wrap>
                                  <Text strong>
                                    {provider.label || providerId}
                                  </Text>
                                  <Tag
                                    color={
                                      provider.is_local ? 'gold' : 'blue'
                                    }
                                  >
                                    {provider.type}
                                  </Tag>
                                  {provider.enabled && (
                                    <Tag
                                      color="green"
                                      icon={
                                        <Icons.CheckCircleOutlined />
                                      }
                                    >
                                      {t('Enabled')}
                                    </Tag>
                                  )}
                                </Space>
                                <Paragraph
                                  type="secondary"
                                  style={{
                                    marginTop: 8,
                                    marginBottom: 0,
                                  }}
                                >
                                  {preset?.description ||
                                    t('Configured AI provider')}
                                </Paragraph>
                              </div>
                              <Switch
                                checked={provider.enabled}
                                onChange={checked =>
                                  updateProvider(providerId, {
                                    enabled: checked,
                                  })
                                }
                              />
                            </ProviderHeader>

                            <Form layout="vertical">
                              <Form.Item label={t('Display label')}>
                                <Input
                                  value={provider.label || ''}
                                  onChange={event =>
                                    updateProvider(providerId, {
                                      label: event.target.value,
                                    })
                                  }
                                />
                              </Form.Item>
                              {preset?.supports_base_url !== false && (
                                <Form.Item label={t('Base URL')}>
                                  <Input
                                    value={provider.base_url || ''}
                                    onChange={event =>
                                      updateProvider(providerId, {
                                        base_url: event.target.value,
                                      })
                                    }
                                  />
                                </Form.Item>
                              )}
                              {provider.type === 'openai' && (
                                <Form.Item label={t('Organization ID')}>
                                  <Input
                                    value={provider.organization_id || ''}
                                    onChange={event =>
                                      updateProvider(providerId, {
                                        organization_id:
                                          event.target.value,
                                      })
                                    }
                                  />
                                </Form.Item>
                              )}
                              {preset?.supports_api_key !== false && (
                                <Form.Item
                                  label={t('API key')}
                                  extra={
                                    provider.has_api_key
                                      ? t(
                                          'A key is already stored securely. Replace it to update it.',
                                        )
                                      : undefined
                                  }
                                >
                                  <Input.Password
                                    value={provider.api_key || ''}
                                    placeholder={
                                      provider.has_api_key
                                        ? '**********'
                                        : ''
                                    }
                                    onChange={event =>
                                      updateProvider(providerId, {
                                        api_key: event.target.value,
                                        clear_api_key:
                                          event.target.value === '',
                                      })
                                    }
                                  />
                                </Form.Item>
                              )}
                              {preset?.supports_api_key_env !== false && (
                                <Form.Item
                                  label={t(
                                    'API key environment variable',
                                  )}
                                >
                                  <Input
                                    value={provider.api_key_env || ''}
                                    onChange={event =>
                                      updateProvider(providerId, {
                                        api_key_env: event.target.value,
                                      })
                                    }
                                  />
                                </Form.Item>
                              )}
                              <Form.Item
                                label={t('Allowed models')}
                                extra={
                                  catalogItems.length > 0
                                    ? t(
                                        'Includes the current official model catalog for this provider.',
                                      )
                                    : t(
                                        'Enter the locally available model ids for this provider.',
                                      )
                                }
                              >
                                <Select
                                  mode="tags"
                                  value={provider.models}
                                  options={
                                    Array.isArray(modelOptions)
                                      ? modelOptions
                                      : []
                                  }
                                  onChange={value => {
                                    // Defer state update to avoid React
                                    // "setState during render" warning
                                    // triggered by Ant Design Select
                                    // reconciling tags internally.
                                    queueMicrotask(() =>
                                      updateProvider(providerId, {
                                        models: value,
                                        default_model: value.includes(
                                          provider.default_model || '',
                                        )
                                          ? provider.default_model
                                          : value[0] || null,
                                      }),
                                    );
                                  }}
                                />
                              </Form.Item>
                              <Form.Item label={t('Default model')}>
                                <Select
                                  value={
                                    provider.default_model || undefined
                                  }
                                  options={provider.models.map(
                                    modelId => ({
                                      label: modelId,
                                      value: modelId,
                                    }),
                                  )}
                                  onChange={value =>
                                    queueMicrotask(() =>
                                      updateProvider(providerId, {
                                        default_model: value || null,
                                      }),
                                    )
                                  }
                                />
                              </Form.Item>
                              <Button
                                onClick={() =>
                                  testProvider(providerId, provider)
                                }
                                loading={
                                  testingProviderId === providerId
                                }
                              >
                                {t('Test Provider')}
                              </Button>
                            </Form>
                          </ProviderCard>
                        );
                      },
                    )}
                  </ProviderGrid>
                  <Divider />
                  <Text type="secondary">
                    {t(
                      'OpenAI, Gemini, Claude, DeepSeek, and compatible providers ship with provider-specific model catalogs tuned for MART-backed chart, dashboard, and SQL insights.',
                    )}
                  </Text>
                </SectionCard>
              </Space>
            ),
          },
          {
            key: 'push-analysis',
            label: (
              <Space>
                <Icons.ScheduleOutlined />
                {t('Push Analysis')}
              </Space>
            ),
            children: <PushAnalysisTab />,
          },
          {
            key: 'usage',
            label: (
              <Space>
                <Icons.BarChartOutlined />
                {t('Usage Analytics')}
              </Space>
            ),
            children: <UsageAnalyticsTab />,
          },
        ]}
      />
    </PageContainer>
  );
}
