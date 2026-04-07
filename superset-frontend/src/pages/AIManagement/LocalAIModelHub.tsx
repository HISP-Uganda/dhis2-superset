import { useCallback, useEffect, useRef, useState } from 'react';
import { css, styled, SupersetClient, t } from '@superset-ui/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Row,
  Space,
  Statistic,
  Tag,
  Tooltip,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import ProgressBar from '@superset-ui/core/components/ProgressBar';
import { Typography } from '@superset-ui/core/components/Typography';
import { useToasts } from 'src/components/MessageToasts/withToasts';

const { Text, Paragraph } = Typography;

/* ── Types ────────────────────────────────────────────── */

type GalleryModel = {
  id: string;
  label: string;
  group: string;
  description: string;
  capabilities?: string[];
  is_recommended: boolean;
  file_size: string;
  asset_file_size?: string;
  base_model?: string;
  base_model_file_size?: string;
  lora_adapter?: string;
  lora_adapter_file_size?: string;
  installed: boolean;
  is_default_model?: boolean;
  is_repo_managed?: boolean;
  model_ready?: boolean;
  missing_dependencies?: string[];
};

type DownloadJob = {
  uuid: string;
  modelId: string;
  progress: number;
  fileSize: string;
  downloadedSize: string;
  processed: boolean;
  error: string | null;
  message: string;
};

type EvalResult = {
  file: string;
  model: string;
  overall_score: number;
  category_scores: Record<string, number>;
};

type TrainingStatus = {
  training_data: { exists: boolean; examples: number; path?: string };
  scripts: Record<string, boolean>;
  all_scripts_present: boolean;
  artifacts: {
    has_adapter: boolean;
    has_gguf: boolean;
    adapter_files?: number;
    gguf_files?: { name: string; size: string }[];
  };
  evaluations: EvalResult[];
  training_meta: {
    base_model?: string;
    epochs?: number;
    train_examples?: number;
    trainable_params?: number;
  } | null;
  finetune_dir: string;
};

/* ── Styled components ────────────────────────────────── */

const ModelGrid = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: ${theme.sizeUnit * 2}px;
  `}
`;

const ModelCard = styled(Card, {
  shouldForwardProp: prop =>
    !['$installed', '$downloading'].includes(String(prop)),
})<{ $installed?: boolean; $downloading?: boolean }>`
  ${({ theme, $installed, $downloading }) => css`
    border-radius: ${theme.borderRadiusLG}px;
    border: 2px solid
      ${$installed
        ? theme.colorSuccess
        : $downloading
          ? theme.colorWarning
          : theme.colorBorderSecondary};
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    }

    .ant-card-body {
      padding: ${theme.sizeUnit * 2.5}px;
    }
  `}
`;

const StatusBar = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${theme.sizeUnit * 2}px ${theme.sizeUnit * 3}px;
    background: linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 100%);
    border-radius: ${theme.borderRadiusLG}px;
    margin-bottom: ${theme.sizeUnit * 3}px;
  `}
`;

const GROUP_COLORS: Record<string, string> = {
  Custom: 'magenta',
  General: 'blue',
  Reasoning: 'purple',
  Code: 'geekblue',
  Compact: 'cyan',
  MoE: 'volcano',
  Installed: 'green',
};

const CUSTOM_MODEL_ID = 'ai-insights-model-26.04';

/* ── Component ────────────────────────────────────────── */

export default function LocalAIModelHub() {
  const { addDangerToast, addSuccessToast } = useToasts();
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<GalleryModel[]>([]);
  const [localaiRunning, setLocalaiRunning] = useState(false);
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [providerDefaultModel, setProviderDefaultModel] = useState('');
  const [defaultProvider, setDefaultProvider] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [jobs, setJobs] = useState<Record<string, DownloadJob>>({});
  const [startingLocalAI, setStartingLocalAI] = useState(false);
  const [stoppingLocalAI, setStoppingLocalAI] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus | null>(
    null,
  );
  const [evaluating, setEvaluating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [evalOutput, setEvalOutput] = useState<string | null>(null);
  const [prepareOutput, setPrepareOutput] = useState<string | null>(null);

  /* ── Fetch gallery ──────────────────────────────────── */

  const loadGallery = useCallback(async () => {
    setLoading(true);
    try {
      const { json } = await SupersetClient.get({
        endpoint: '/api/v1/ai-management/localai/gallery',
      });
      const result = json.result || {};
      setModels(result.models || []);
      setLocalaiRunning(result.localai_running ?? false);
      setProviderEnabled(result.provider_enabled ?? false);
      setProviderDefaultModel(result.provider_default_model || '');
      setDefaultProvider(result.default_provider || '');
      setBaseUrl(result.base_url || '');
    } catch (err: any) {
      addDangerToast(err?.message || t('Unable to load LocalAI model gallery'));
    } finally {
      setLoading(false);
    }
  }, [addDangerToast]);

  useEffect(() => {
    loadGallery();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [loadGallery]);

  /* ── Polling for download progress ──────────────────── */

  const pollJobs = useCallback(async () => {
    const activeJobs = Object.values(jobs).filter(
      j => !j.processed && !j.error,
    );
    if (activeJobs.length === 0) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    const nextJobs = { ...jobs };
    let anyCompleted = false;

    for (const job of activeJobs) {
      try {
        const { json } = await SupersetClient.get({
          endpoint: `/api/v1/ai-management/localai/models/jobs/${job.uuid}`,
        });
        const r = json.result || {};
        nextJobs[job.modelId] = {
          ...job,
          progress: r.progress || 0,
          fileSize: r.file_size || job.fileSize,
          downloadedSize: r.downloaded_size || '',
          processed: r.processed || false,
          error: r.error || null,
          message: r.message || '',
        };
        if (r.processed) {
          anyCompleted = true;
          addSuccessToast(t('Model "%s" downloaded successfully', job.modelId));
        }
      } catch {
        // Ignore poll errors — will retry next interval
      }
    }
    setJobs(nextJobs);
    if (anyCompleted) {
      // Refresh gallery to update installed status
      loadGallery();
    }
  }, [jobs, addSuccessToast, loadGallery]);

  useEffect(() => {
    const hasActive = Object.values(jobs).some(j => !j.processed && !j.error);
    if (hasActive && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(pollJobs, 2000);
    } else if (!hasActive && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, [jobs, pollJobs]);

  /* ── Install model ──────────────────────────────────── */

  const installModel = async (modelId: string) => {
    try {
      const { json } = await SupersetClient.post({
        endpoint: '/api/v1/ai-management/localai/models/install',
        jsonPayload: { model_id: modelId },
      });
      const r = json.result || {};
      if (r.uuid) {
        setJobs(prev => ({
          ...prev,
          [modelId]: {
            uuid: r.uuid,
            modelId,
            progress: 0,
            fileSize: '',
            downloadedSize: '',
            processed: false,
            error: null,
            message: 'Queued',
          },
        }));
        addSuccessToast(t('Download started for "%s"', modelId));
      } else if (r.deployed) {
        addSuccessToast(t('Local model "%s" deployed', modelId));
        await loadGallery();
      }
    } catch (err: any) {
      let msg = t('Failed to install model');
      try {
        if (typeof err?.json === 'function') {
          const body = await err.json();
          if (body?.message) msg = `${msg}: ${body.message}`;
        }
      } catch {
        // ignore
      }
      addDangerToast(msg);
    }
  };

  const startLocalAI = async () => {
    setStartingLocalAI(true);
    try {
      const { json } = await SupersetClient.post({
        endpoint: '/api/v1/ai-management/localai/start',
      });
      const result = json.result || {};
      addSuccessToast(
        result.localai_running
          ? t(
              'LocalAI started and the optimized Superset model is configured as the default.',
            )
          : t('LocalAI start request completed'),
      );
      await loadGallery();
    } catch (err: any) {
      let msg = t('Failed to start LocalAI');
      try {
        if (typeof err?.json === 'function') {
          const body = await err.json();
          if (body?.message) msg = `${msg}: ${body.message}`;
        } else if (err?.message) {
          msg = `${msg}: ${err.message}`;
        }
      } catch {
        // ignore
      }
      addDangerToast(msg);
    } finally {
      setStartingLocalAI(false);
    }
  };

  const stopLocalAI = async () => {
    setStoppingLocalAI(true);
    try {
      const { json } = await SupersetClient.post({
        endpoint: '/api/v1/ai-management/localai/stop',
      });
      const result = json.result || {};
      addSuccessToast(
        result.localai_running
          ? t('LocalAI stop request completed')
          : t('LocalAI stopped'),
      );
      await loadGallery();
    } catch (err: any) {
      let msg = t('Failed to stop LocalAI');
      try {
        if (typeof err?.json === 'function') {
          const body = await err.json();
          if (body?.message) msg = `${msg}: ${body.message}`;
        } else if (err?.message) {
          msg = `${msg}: ${err.message}`;
        }
      } catch {
        // ignore
      }
      addDangerToast(msg);
    } finally {
      setStoppingLocalAI(false);
    }
  };

  /* ── Delete model ───────────────────────────────────── */

  const deleteModel = async (modelId: string) => {
    try {
      await SupersetClient.delete({
        endpoint: `/api/v1/ai-management/localai/models/${encodeURIComponent(modelId)}`,
      });
      addSuccessToast(t('Model "%s" deleted', modelId));
      loadGallery();
    } catch (err: any) {
      addDangerToast(t('Failed to delete model'));
    }
  };

  /* ── Training Pipeline ────────────────────────────────── */

  const loadTrainingStatus = useCallback(async () => {
    try {
      const { json } = await SupersetClient.get({
        endpoint: '/api/v1/ai-management/localai/training/status',
      });
      setTrainingStatus(json.result || null);
    } catch {
      // Training status is optional — don't toast on failure
    }
  }, []);

  useEffect(() => {
    loadTrainingStatus();
  }, [loadTrainingStatus]);

  const runEvaluation = async () => {
    setEvaluating(true);
    setEvalOutput(null);
    try {
      const { json } = await SupersetClient.post({
        endpoint: '/api/v1/ai-management/localai/training/evaluate',
        jsonPayload: { model_id: CUSTOM_MODEL_ID },
      });
      const r = json.result || {};
      setEvalOutput(r.stdout || '');
      if (r.evaluation) {
        const score = r.evaluation.overall_score;
        addSuccessToast(
          t('Evaluation complete: overall score %s', score?.toFixed(2)),
        );
      } else if (r.returncode === 0) {
        addSuccessToast(t('Evaluation completed'));
      } else {
        addDangerToast(r.stderr || t('Evaluation failed'));
      }
      await loadTrainingStatus();
    } catch (err: any) {
      addDangerToast(t('Evaluation failed'));
    } finally {
      setEvaluating(false);
    }
  };

  const runPrepareData = async () => {
    setPreparing(true);
    setPrepareOutput(null);
    try {
      const { json } = await SupersetClient.post({
        endpoint: '/api/v1/ai-management/localai/training/prepare',
      });
      const r = json.result || {};
      setPrepareOutput(r.stdout || '');
      if (r.returncode === 0) {
        addSuccessToast(t('Data preparation completed'));
      } else {
        addDangerToast(r.stderr || t('Data preparation failed'));
      }
      await loadTrainingStatus();
    } catch (err: any) {
      addDangerToast(t('Data preparation failed'));
    } finally {
      setPreparing(false);
    }
  };

  /* ── Render ─────────────────────────────────────────── */

  const installedCount = models.filter(m => m.installed).length;
  const activeDownloads = Object.values(jobs).filter(
    j => !j.processed && !j.error,
  ).length;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Icons.LoadingOutlined style={{ fontSize: 32 }} spin />
        <Paragraph style={{ marginTop: 12 }}>
          {t('Loading LocalAI Model Hub...')}
        </Paragraph>
      </div>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* ── Status bar ─────────────────────────────────── */}
      <StatusBar>
        <Space size="large" wrap>
          <Space>
            <Badge
              status={localaiRunning ? 'success' : 'error'}
              text={
                <Text strong>
                  {localaiRunning ? t('LocalAI Running') : t('LocalAI Offline')}
                </Text>
              }
            />
            {baseUrl && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {baseUrl}
              </Text>
            )}
          </Space>
          {providerEnabled && <Tag color="green">{t('Provider enabled')}</Tag>}
          {defaultProvider === 'localai' && (
            <Tag color="magenta">{t('Superset default provider')}</Tag>
          )}
          {providerDefaultModel && (
            <Tag color="purple">
              {t('Default model: %s', providerDefaultModel)}
            </Tag>
          )}
          <Tag color="blue">{t('%s models available', models.length)}</Tag>
          <Tag color="green">{t('%s installed', installedCount)}</Tag>
          {activeDownloads > 0 && (
            <Tag color="orange" icon={<Icons.SyncOutlined spin />}>
              {t('%s downloading', activeDownloads)}
            </Tag>
          )}
        </Space>
        <Space>
          {!localaiRunning && (
            <Button
              type="primary"
              size="small"
              icon={<Icons.ThunderboltOutlined />}
              loading={startingLocalAI}
              onClick={startLocalAI}
            >
              {t('Start LocalAI')}
            </Button>
          )}
          {localaiRunning && (
            <Button
              danger
              size="small"
              icon={<Icons.StopOutlined />}
              loading={stoppingLocalAI}
              onClick={stopLocalAI}
            >
              {t('Stop LocalAI')}
            </Button>
          )}
          <Button
            icon={<Icons.ReloadOutlined />}
            onClick={() => {
              loadGallery();
            }}
            size="small"
          >
            {t('Refresh')}
          </Button>
        </Space>
      </StatusBar>

      {!localaiRunning && (
        <Alert
          type="warning"
          showIcon
          message={t('LocalAI is not running')}
          description={
            <Space direction="vertical" size={8}>
              <Text type="secondary">
                {t(
                  'Start LocalAI on port 39671 to manage runtime-backed models. The repo-managed ai-insights-model-26.04 can be deployed from local codebase assets even before LocalAI is running.',
                )}
              </Text>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<Icons.ThunderboltOutlined />}
                  loading={startingLocalAI}
                  onClick={startLocalAI}
                >
                  {t('Start LocalAI')}
                </Button>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('CLI fallback: bash scripts/setup_localai.sh start')}
                </Text>
              </Space>
            </Space>
          }
        />
      )}

      {/* ── Model grid ─────────────────────────────────── */}
      {models.length === 0 ? (
        <Empty description={t('No models in catalog')} />
      ) : (
        <ModelGrid>
          {models.map(model => {
            const job = jobs[model.id];
            const isDownloading = job && !job.processed && !job.error;
            const hasFailed = job && job.error;

            return (
              <ModelCard
                key={model.id}
                $installed={model.installed}
                $downloading={!!isDownloading}
              >
                {/* Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <Space size={6} wrap>
                      <Text strong>{model.label}</Text>
                      {model.id === CUSTOM_MODEL_ID && (
                        <Tag
                          color="magenta"
                          style={{ fontSize: 10, fontWeight: 600 }}
                        >
                          Superset Optimized
                        </Tag>
                      )}
                      {model.is_repo_managed && (
                        <Tag color="cyan" style={{ fontSize: 10 }}>
                          {t('Repo managed')}
                        </Tag>
                      )}
                      {model.is_default_model && (
                        <Tag color="purple" style={{ fontSize: 10 }}>
                          {t('Default model')}
                        </Tag>
                      )}
                      {model.id === CUSTOM_MODEL_ID &&
                        defaultProvider === 'localai' && (
                          <Tag color="geekblue" style={{ fontSize: 10 }}>
                            {t('Default provider')}
                          </Tag>
                        )}
                      {model.is_recommended && (
                        <Tag color="gold" style={{ fontSize: 10 }}>
                          Recommended
                        </Tag>
                      )}
                      <Tag
                        color={GROUP_COLORS[model.group] || 'default'}
                        style={{ fontSize: 10 }}
                      >
                        {model.group}
                      </Tag>
                    </Space>
                    <div>
                      <Text
                        type="secondary"
                        style={{ fontSize: 11, fontFamily: 'monospace' }}
                      >
                        {model.id}
                      </Text>
                    </div>
                  </div>
                  {model.file_size && (
                    <Tag style={{ fontSize: 11, flexShrink: 0 }}>
                      {model.file_size}
                    </Tag>
                  )}
                </div>

                {/* Custom model training info banner */}
                {model.id === CUSTOM_MODEL_ID && (
                  <div
                    style={{
                      background:
                        'linear-gradient(135deg, #fff0f6 0%, #f9f0ff 100%)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      marginBottom: 8,
                      fontSize: 11,
                    }}
                  >
                    <Text strong style={{ fontSize: 11 }}>
                      {t('Purpose-built for Superset Analytics Copilot')}
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {t(
                          'Optimized for natural-language analytics, SQL reasoning, chart and dashboard generation, screenshot interpretation, structured JSON outputs, narrative reporting, and deterministic export workflows for professional decision support.',
                        )}
                      </Text>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {t(
                          'Local asset size: %s',
                          model.asset_file_size ||
                            model.file_size ||
                            t('Unknown'),
                        )}
                      </Text>
                    </div>
                    {model.base_model && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {t(
                            'Base model dependency: %s%s',
                            model.base_model,
                            model.base_model_file_size
                              ? ` (${model.base_model_file_size})`
                              : '',
                          )}
                        </Text>
                      </div>
                    )}
                    {model.lora_adapter && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {t(
                            'LoRA adapter: %s%s',
                            model.lora_adapter,
                            model.lora_adapter_file_size
                              ? ` (${model.lora_adapter_file_size})`
                              : '',
                          )}
                        </Text>
                      </div>
                    )}
                  </div>
                )}

                {/* Dependency warning for repo-managed models */}
                {model.is_repo_managed &&
                  model.model_ready === false &&
                  model.missing_dependencies &&
                  model.missing_dependencies.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 8, fontSize: 11 }}
                      message={t('Missing dependencies')}
                      description={
                        <div style={{ fontSize: 11 }}>
                          {model.missing_dependencies.map((dep, idx) => (
                            <div key={idx}>{dep}</div>
                          ))}
                          <Text
                            type="secondary"
                            style={{ fontSize: 11, marginTop: 4, display: 'block' }}
                          >
                            {t(
                              'Click Download to install the model config and download missing base model weights automatically.',
                            )}
                          </Text>
                        </div>
                      }
                    />
                  )}

                {/* Description */}
                <Paragraph
                  type="secondary"
                  style={{ fontSize: 12, margin: '4px 0 12px' }}
                  ellipsis={{ rows: 2 }}
                >
                  {model.description}
                </Paragraph>

                {model.capabilities && model.capabilities.length > 0 && (
                  <Space
                    size={[4, 4]}
                    wrap
                    style={{ display: 'flex', marginBottom: 12 }}
                  >
                    {model.capabilities.map(capability => (
                      <Tag
                        key={`${model.id}-${capability}`}
                        color={
                          model.id === CUSTOM_MODEL_ID ? 'blue' : 'default'
                        }
                        style={{ fontSize: 10, marginInlineEnd: 0 }}
                      >
                        {capability}
                      </Tag>
                    ))}
                  </Space>
                )}

                {/* Download progress bar */}
                {isDownloading && (
                  <div style={{ marginBottom: 12 }}>
                    <ProgressBar
                      percent={Math.round(job.progress)}
                      size="small"
                      status="active"
                      strokeColor={{
                        '0%': '#108ee9',
                        '100%': '#87d068',
                      }}
                    />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {job.downloadedSize
                        ? `${job.downloadedSize} / ${job.fileSize}`
                        : t('Starting download...')}
                    </Text>
                  </div>
                )}

                {/* Error */}
                {hasFailed && (
                  <Alert
                    type="error"
                    showIcon
                    message={t('Download failed')}
                    description={String(job.error)}
                    style={{ marginBottom: 12, fontSize: 11 }}
                  />
                )}

                {/* Actions */}
                <Row gutter={8}>
                  <Col flex="auto">
                    {model.installed ? (
                      <Space size={8}>
                        <Tag
                          color="success"
                          icon={<Icons.CheckCircleOutlined />}
                        >
                          {t('Installed')}
                        </Tag>
                        <Tooltip title={t('Remove this model from LocalAI')}>
                          <Button
                            size="small"
                            danger
                            icon={<Icons.DeleteOutlined />}
                            onClick={() => deleteModel(model.id)}
                          >
                            {model.is_repo_managed
                              ? t('Remove local deploy')
                              : t('Remove')}
                          </Button>
                        </Tooltip>
                      </Space>
                    ) : isDownloading ? (
                      <Tag
                        color="processing"
                        icon={<Icons.SyncOutlined spin />}
                      >
                        {t('Downloading... %s%%', Math.round(job.progress))}
                      </Tag>
                    ) : (
                      <Button
                        type="primary"
                        size="small"
                        icon={<Icons.DownloadOutlined />}
                        disabled={!localaiRunning && !model.is_repo_managed}
                        onClick={() => installModel(model.id)}
                      >
                        {model.is_repo_managed
                          ? t('Deploy local model')
                          : t('Download')}
                        {model.file_size ? ` (${model.file_size})` : ''}
                      </Button>
                    )}
                  </Col>
                </Row>
              </ModelCard>
            );
          })}
        </ModelGrid>
      )}

      {/* ── Training Pipeline ─────────────────────────────── */}
      <Collapse
        style={{ marginTop: 8 }}
        items={[
          {
            key: 'training',
            label: (
              <Space>
                <Icons.ExperimentOutlined />
                <Text strong>
                  {t('Fine-Tuning Pipeline — %s', CUSTOM_MODEL_ID)}
                </Text>
                {trainingStatus?.training_data?.exists && (
                  <Tag color="blue">
                    {t(
                      '%s training examples',
                      trainingStatus.training_data.examples,
                    )}
                  </Tag>
                )}
                {trainingStatus?.artifacts?.has_gguf && (
                  <Tag color="green">{t('GGUF exported')}</Tag>
                )}
                {trainingStatus?.evaluations &&
                  trainingStatus.evaluations.length > 0 && (
                    <Tag color="purple">
                      {t(
                        'Score: %s',
                        trainingStatus.evaluations[0].overall_score?.toFixed(2),
                      )}
                    </Tag>
                  )}
              </Space>
            ),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {/* Status overview */}
                <Row gutter={16}>
                  <Col span={6}>
                    <Statistic
                      title={t('Training Examples')}
                      value={trainingStatus?.training_data?.examples ?? 0}
                      prefix={<Icons.DatabaseOutlined />}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('Pipeline Scripts')}
                      value={
                        trainingStatus?.all_scripts_present
                          ? t('Ready')
                          : t('Missing')
                      }
                      valueStyle={{
                        color: trainingStatus?.all_scripts_present
                          ? '#52c41a'
                          : '#ff4d4f',
                      }}
                      prefix={
                        trainingStatus?.all_scripts_present ? (
                          <Icons.CheckCircleOutlined />
                        ) : (
                          <Icons.CloseCircleOutlined />
                        )
                      }
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('LoRA Adapter')}
                      value={
                        trainingStatus?.artifacts?.has_adapter
                          ? t('Trained')
                          : t('Not yet')
                      }
                      valueStyle={{
                        color: trainingStatus?.artifacts?.has_adapter
                          ? '#52c41a'
                          : '#8c8c8c',
                      }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('Latest Score')}
                      value={
                        trainingStatus?.evaluations?.[0]?.overall_score?.toFixed(
                          2,
                        ) ?? '—'
                      }
                      valueStyle={{
                        color:
                          (trainingStatus?.evaluations?.[0]?.overall_score ??
                            0) >= 0.7
                            ? '#52c41a'
                            : '#faad14',
                      }}
                      prefix={<Icons.BarChartOutlined />}
                    />
                  </Col>
                </Row>

                {/* Evaluation scores breakdown */}
                {trainingStatus?.evaluations &&
                  trainingStatus.evaluations.length > 0 && (
                    <Card size="small" title={t('Benchmark Scores')}>
                      <Row gutter={[12, 8]}>
                        {Object.entries(
                          trainingStatus.evaluations[0].category_scores || {},
                        ).map(([cat, score]) => (
                          <Col key={cat} span={6}>
                            <div style={{ fontSize: 11 }}>
                              <Text type="secondary">{cat}</Text>
                              <ProgressBar
                                percent={Math.round((score as number) * 100)}
                                size="small"
                                strokeColor={
                                  (score as number) >= 0.7
                                    ? '#52c41a'
                                    : (score as number) >= 0.5
                                      ? '#faad14'
                                      : '#ff4d4f'
                                }
                                format={pct => `${((pct ?? 0) / 100).toFixed(2)}`}
                              />
                            </div>
                          </Col>
                        ))}
                      </Row>
                    </Card>
                  )}

                {/* GGUF artifacts */}
                {trainingStatus?.artifacts?.gguf_files &&
                  trainingStatus.artifacts.gguf_files.length > 0 && (
                    <Card size="small" title={t('Exported GGUF Models')}>
                      <Space direction="vertical" size={4}>
                        {trainingStatus.artifacts.gguf_files.map(f => (
                          <Space key={f.name}>
                            <Icons.FileOutlined />
                            <Text code style={{ fontSize: 12 }}>
                              {f.name}
                            </Text>
                            <Tag>{f.size}</Tag>
                          </Space>
                        ))}
                      </Space>
                    </Card>
                  )}

                {/* Actions */}
                <Space wrap>
                  <Tooltip
                    title={t(
                      'Validate training data, split into train/eval sets, show stats',
                    )}
                  >
                    <Button
                      icon={<Icons.OrderedListOutlined />}
                      loading={preparing}
                      onClick={runPrepareData}
                      disabled={!trainingStatus?.training_data?.exists}
                    >
                      {t('Prepare Data')}
                    </Button>
                  </Tooltip>
                  <Tooltip
                    title={t(
                      'Run benchmark evaluation on the current model (14 prompts, 7 categories)',
                    )}
                  >
                    <Button
                      type="primary"
                      icon={<Icons.ExperimentOutlined />}
                      loading={evaluating}
                      onClick={runEvaluation}
                      disabled={!localaiRunning}
                    >
                      {t('Run Evaluation')}
                    </Button>
                  </Tooltip>
                  <Tooltip
                    title={t(
                      'Full training requires a CUDA GPU. Use the pipeline script on a server.',
                    )}
                  >
                    <Button icon={<Icons.CodeOutlined />} disabled>
                      {t('Train (requires GPU)')}
                    </Button>
                  </Tooltip>
                  <Button
                    icon={<Icons.ReloadOutlined />}
                    onClick={loadTrainingStatus}
                  >
                    {t('Refresh Status')}
                  </Button>
                </Space>

                {/* Output logs */}
                {prepareOutput && (
                  <Card
                    size="small"
                    title={t('Data Preparation Output')}
                    extra={
                      <Button
                        size="small"
                        type="text"
                        onClick={() => setPrepareOutput(null)}
                      >
                        {t('Clear')}
                      </Button>
                    }
                  >
                    <pre
                      style={{
                        fontSize: 11,
                        maxHeight: 300,
                        overflow: 'auto',
                        background: '#f5f5f5',
                        padding: 12,
                        borderRadius: 4,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {prepareOutput}
                    </pre>
                  </Card>
                )}
                {evalOutput && (
                  <Card
                    size="small"
                    title={t('Evaluation Output')}
                    extra={
                      <Button
                        size="small"
                        type="text"
                        onClick={() => setEvalOutput(null)}
                      >
                        {t('Clear')}
                      </Button>
                    }
                  >
                    <pre
                      style={{
                        fontSize: 11,
                        maxHeight: 300,
                        overflow: 'auto',
                        background: '#f5f5f5',
                        padding: 12,
                        borderRadius: 4,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {evalOutput}
                    </pre>
                  </Card>
                )}

                {/* CLI commands reference */}
                <Alert
                  type="info"
                  showIcon
                  message={t('CLI Pipeline Commands')}
                  description={
                    <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
                      <div>
                        bash localai/finetune/pipeline.sh prepare{' '}
                        <Text type="secondary">
                          {t('# validate & split data')}
                        </Text>
                      </div>
                      <div>
                        bash localai/finetune/pipeline.sh baseline{' '}
                        <Text type="secondary">
                          {t('# evaluate base model')}
                        </Text>
                      </div>
                      <div>
                        bash localai/finetune/pipeline.sh train{' '}
                        <Text type="secondary">
                          {t('# QLoRA fine-tuning (CUDA)')}
                        </Text>
                      </div>
                      <div>
                        bash localai/finetune/pipeline.sh export{' '}
                        <Text type="secondary">
                          {t('# merge adapter + GGUF')}
                        </Text>
                      </div>
                      <div>
                        bash localai/finetune/pipeline.sh deploy{' '}
                        <Text type="secondary">
                          {t('# deploy to LocalAI')}
                        </Text>
                      </div>
                      <div>
                        bash localai/finetune/pipeline.sh fallback{' '}
                        <Text type="secondary">
                          {t('# export for Colab/external GPU')}
                        </Text>
                      </div>
                    </div>
                  }
                />
              </Space>
            ),
          },
        ]}
      />

      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t(
          'Repo-managed models are deployed from local codebase assets, while other catalog models are downloaded through LocalAI. Once installed, models automatically become available in the AI Insights provider selector.',
        )}
      </Paragraph>
    </Space>
  );
}
