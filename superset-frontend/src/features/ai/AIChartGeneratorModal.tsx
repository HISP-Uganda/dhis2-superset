import { ReactNode, useCallback, useEffect, useState } from 'react';
import rison from 'rison';
import {
  css,
  JsonResponse,
  styled,
  SupersetClient,
  t,
} from '@superset-ui/core';
import {
  Alert,
  AsyncSelect,
  Button,
  Loading,
  Modal,
} from '@superset-ui/core/components';
import { useToasts } from 'src/components/MessageToasts/withToasts';
import { Dataset } from 'src/features/datasets/DatasetSelectLabel';
import { getDatasetDisplayName } from 'src/utils/dhis2DatasetDisplay';
import {
  proposeAICharts,
  saveConfirmedCharts,
  AIProposedChart,
  AIGeneratedChart,
  AltVizType,
} from './api';
import { useAIEnabled } from './useAIEnabled';

/* eslint-disable theme-colors/no-literal-colors */

/* ── Styled Components ─────────────────────────────── */

const ModalContent = styled.div`
  min-height: 400px;
  padding: 4px 0;
`;

const StepIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 20px;
  padding: 0 4px;
`;

const StepDot = styled.div<{ $active: boolean; $done: boolean }>`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.2s;

  ${({ $active, $done }) => {
    if ($done) return 'background: #10B981; color: #fff; border: 2px solid #10B981;';
    if ($active) return 'background: #2563EB; color: #fff; border: 2px solid #2563EB;';
    return 'background: #F3F4F6; color: #9CA3AF; border: 2px solid #E5E7EB;';
  }}
`;

const StepLabel = styled.span<{ $active: boolean }>`
  font-size: 12px;
  font-weight: 600;
  margin-left: 6px;
  margin-right: 12px;
  color: ${({ $active }) => ($active ? '#111827' : '#9CA3AF')};
`;

const StepConnector = styled.div`
  flex: 1;
  height: 2px;
  background: #E5E7EB;
  margin: 0 4px;
  min-width: 20px;
  max-width: 60px;
`;

const PromptSection = styled.div`
  margin-bottom: 20px;
`;

const PromptLabel = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 8px;
`;

const PromptTextarea = styled.textarea`
  width: 100%;
  min-height: 110px;
  padding: 12px 14px;
  border: 2px solid #D1D5DB;
  border-radius: 10px;
  font-size: 14px;
  font-family: inherit;
  color: #1F2937;
  background: #fff;
  resize: vertical;
  line-height: 1.5;
  transition: border-color 0.2s;
  &:focus { outline: none; border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
  &::placeholder { color: #9CA3AF; }
  &:disabled { background: #F3F4F6; cursor: not-allowed; }
`;

const SuggestionChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
`;

const Chip = styled.button`
  padding: 5px 12px;
  border-radius: 16px;
  border: 1px solid #E5E7EB;
  background: #F9FAFB;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { background: #EFF6FF; border-color: #93C5FD; color: #1D4ED8; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const OptionsRow = styled.div`
  display: flex;
  gap: 14px;
  align-items: flex-end;
  margin-bottom: 16px;
  flex-wrap: wrap;
`;

const OptionGroup = styled.div`
  min-width: 180px;
  label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #6B7280;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  select {
    width: 100%;
    min-height: 36px;
    padding: 6px 12px;
    border: 1px solid #D1D5DB;
    border-radius: 8px;
    font-size: 13px;
    color: #1F2937;
    background: #fff;
  }
`;

const DatasetSelectorWrapper = styled.div`
  flex: 2;
  min-width: 300px;
  .dataset-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #6B7280;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .dataset-hint {
    font-size: 11px;
    color: #9CA3AF;
    margin-top: 4px;
    font-style: italic;
  }
`;

const GeneratingAnimation = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  .spinner-text { font-size: 15px; font-weight: 600; color: #1D4ED8; margin-top: 16px; }
  .sub-text { font-size: 12px; color: #6B7280; margin-top: 6px; }
`;

const AutoDetectBanner = styled.div`
  font-size: 12px;
  color: #6B7280;
  padding: 8px 12px;
  background: #F9FAFB;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  margin-bottom: 12px;
  .count { font-weight: 700; color: #374151; }
`;

/* ── Review Step Styles ────────────────────────────── */

const ReviewHeader = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 4px;
`;

const ReviewSubheader = styled.div`
  font-size: 12px;
  color: #6B7280;
  margin-bottom: 16px;
`;

const ProposedChartCard = styled.div`
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 10px;
  background: #fff;
  transition: border-color 0.2s;

  &:hover {
    border-color: #93C5FD;
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 6px;
  }

  .chart-name {
    font-weight: 700;
    font-size: 14px;
    color: #111827;
    flex: 1;
  }

  .chart-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .chart-meta-tag {
    font-size: 10px;
    font-weight: 600;
    border-radius: 4px;
    padding: 2px 8px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .chart-type-tag {
    color: #1D4ED8;
    background: #DBEAFE;
    border: 1px solid #93C5FD;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .chart-dataset-tag {
    color: #0369A1;
    background: #F0F9FF;
    border: 1px solid #BAE6FD;
  }

  .chart-desc {
    font-size: 12px;
    color: #4B5563;
    line-height: 1.5;
    margin-bottom: 10px;
  }

  .chart-dataset {
    font-size: 10px;
    color: #0369A1;
    background: #F0F9FF;
    border: 1px solid #BAE6FD;
    border-radius: 4px;
    padding: 1px 6px;
    display: inline-block;
    margin-bottom: 8px;
  }
`;

const VizTypeSelector = styled.div`
  .selector-label {
    font-size: 11px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
`;

const VizTypeOptions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const VizTypeOption = styled.button<{ $selected: boolean; $custom: boolean }>`
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  text-align: left;
  max-width: 220px;

  border: 2px solid ${({ $selected }) => ($selected ? '#2563EB' : '#E5E7EB')};
  background: ${({ $selected, $custom }) => {
    if ($selected) return '#EFF6FF';
    if ($custom) return '#FFF7ED';
    return '#F9FAFB';
  }};
  color: ${({ $selected }) => ($selected ? '#1D4ED8' : '#374151')};

  &:hover {
    border-color: ${({ $selected }) => ($selected ? '#2563EB' : '#93C5FD')};
    background: ${({ $selected }) => ($selected ? '#EFF6FF' : '#F0F9FF')};
  }

  .vt-label {
    font-weight: 700;
    font-size: 11px;
  }

  .vt-reason {
    font-size: 9px;
    font-weight: 400;
    color: #6B7280;
    line-height: 1.3;
  }

  .vt-badge {
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 4px;
    border-radius: 3px;
    margin-left: 4px;
  }

  .vt-badge-custom {
    background: #FED7AA;
    color: #9A3412;
  }

  .vt-badge-rec {
    background: #DBEAFE;
    color: #1D4ED8;
  }
`;

/* ── Results Step Styles ─────────────────────────────── */

const ChartGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  margin-top: 14px;
`;

const ChartCard = styled.div<{ $success: boolean }>`
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid ${({ $success }) => ($success ? '#BBF7D0' : '#FECACA')};
  background: ${({ $success }) => ($success ? '#F0FDF4' : '#FEF2F2')};
  font-size: 13px;
  transition: transform 0.15s;
  &:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .chart-name { font-weight: 700; color: #111827; margin-bottom: 4px; }
  .chart-type {
    display: inline-block; padding: 1px 8px;
    background: ${({ $success }) => ($success ? '#DCFCE7' : '#FEE2E2')};
    color: ${({ $success }) => ($success ? '#166534' : '#991B1B')};
    border-radius: 10px; font-size: 10px; font-weight: 600; text-transform: uppercase;
    margin-bottom: 6px;
  }
  .chart-desc { font-size: 11px; color: #6B7280; margin-bottom: 8px; line-height: 1.4; }
  .chart-link a { color: #2563EB; font-size: 12px; font-weight: 600; text-decoration: none; }
  .chart-link a:hover { text-decoration: underline; }
  .chart-error { color: #DC2626; font-size: 11px; margin-top: 4px; }
`;

const StatusBar = styled.div<{ $variant?: string }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  margin-top: 14px;
  font-size: 13px;
  font-weight: 600;
  ${({ $variant }) => {
    if ($variant === 'success')
      return 'background: #F0FDF4; color: #166534; border: 1px solid #BBF7D0;';
    if ($variant === 'error')
      return 'background: #FEF2F2; color: #991B1B; border: 1px solid #FECACA;';
    return 'background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE;';
  }}
`;

/* ── Constants ─────────────────────────────────────── */

const CUSTOM_VIZ_TYPES = new Set([
  'dhis2_map', 'vital_maps', 'summary', 'comparison_kpi', 'marquee_kpi',
  'control_chart', 'ranked_variance', 'cohort_cascade', 'small_multiples',
  'stock_status', 'age_sex_pyramid', 'violin_distribution', 'slideshow',
  'cartodiagram',
]);

const SUGGESTIONS = [
  'Create a dashboard for malaria case analysis with trends, positivity rates, and district comparisons',
  'Show testing volumes and positivity rates over time by facility',
  'Compare treatment outcomes across districts with bar and pie charts',
  'Create summary KPI cards for total cases, tests, and positivity rate',
  'Visualize commodity stock levels and consumption trends',
  'Show geographic distribution of malaria cases on a DHIS2 map',
  'Create time series charts for monthly malaria incidence trends',
  'Build a pivot table of cases by period and organisation unit',
];

type DatasetOption = {
  id: number;
  value: string;
  label: string | ReactNode;
  customLabel: string;
};

type Props = {
  show: boolean;
  onHide: () => void;
  onChartsCreated?: () => void;
};

type Step = 'prompt' | 'review' | 'results';

function mapDatasetToOption(item: Dataset): DatasetOption {
  const dbName = item.database?.database_name;
  const datasetLabel = getDatasetDisplayName(item);
  const label = dbName ? `${datasetLabel} — ${dbName}` : datasetLabel;
  return {
    id: item.id,
    value: `${item.id}__${item.datasource_type || 'table'}`,
    label,
    customLabel: datasetLabel,
  };
}

/* ── Component ────────────────────────────────────── */

export default function AIChartGeneratorModal({ show, onHide, onChartsCreated }: Props) {
  const aiEnabled = useAIEnabled();
  const { addDangerToast, addSuccessToast } = useToasts();

  // Step state
  const [step, setStep] = useState<Step>('prompt');

  // Step 1: Prompt
  const [selectedDataset, setSelectedDataset] = useState<DatasetOption | null>(null);
  const [prompt, setPrompt] = useState('');
  const [numCharts, setNumCharts] = useState(6);
  const [martDatasetCount, setMartDatasetCount] = useState<number | null>(null);
  const [proposing, setProposing] = useState(false);

  // Step 2: Review
  const [proposals, setProposals] = useState<AIProposedChart[]>([]);
  const [selectedVizTypes, setSelectedVizTypes] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  // Step 3: Results
  const [results, setResults] = useState<AIGeneratedChart[] | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (show) {
      setStep('prompt');
      setProposals([]);
      setResults(null);
      setSelectedVizTypes({});
      setProposing(false);
      setSaving(false);
      // Fetch dataset count
      loadDatasets('', 0, 1).then(res => {
        setMartDatasetCount(res.totalCount);
      }).catch(() => {});
    }
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDatasets = useCallback(
    (search: string, page: number, pageSize: number) => {
      const query = rison.encode({
        columns: [
          'id', 'table_name', 'extra', 'datasource_type',
          'database.database_name', 'schema',
        ],
        filters: [
          { col: 'dataset_role', opr: 'dataset_context', value: 'chart' },
          ...(search ? [{ col: 'table_name', opr: 'ct', value: search }] : []),
        ],
        page,
        page_size: pageSize,
        order_column: 'table_name',
        order_direction: 'asc',
      });
      return SupersetClient.get({
        endpoint: `/api/v1/dataset/?q=${query}`,
      }).then((response: JsonResponse) => ({
        data: response.json.result.map((item: Dataset) => mapDatasetToOption(item)),
        totalCount: response.json.count,
      }));
    },
    [],
  );

  /* ── Step 1 → Step 2: Propose ── */
  const handlePropose = useCallback(async () => {
    if (!prompt.trim() && !selectedDataset) {
      addDangerToast(t('Describe what charts you want, or select a dataset'));
      return;
    }
    setProposing(true);
    try {
      const result = await proposeAICharts({
        datasetId: selectedDataset?.id ?? null,
        prompt: prompt.trim() || null,
        numCharts,
      });
      const charts = result.charts || [];
      setProposals(charts);
      // Default: each chart uses AI's recommended viz_type
      const defaults: Record<number, string> = {};
      charts.forEach((c, i) => { defaults[i] = c.viz_type; });
      setSelectedVizTypes(defaults);
      setStep('review');
    } catch (err: any) {
      addDangerToast(err?.message || t('AI chart generation failed'));
    } finally {
      setProposing(false);
    }
  }, [selectedDataset, prompt, numCharts, addDangerToast]);

  /* ── Step 2 → Step 3: Save ── */
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const chartsToSave = proposals.map((chart, idx) => {
        const chosenViz = selectedVizTypes[idx] || chart.viz_type;
        return {
          slice_name: chart.slice_name,
          viz_type: chosenViz,
          description: chart.description,
          datasource_id: chart.datasource_id,
          datasource_type: chart.datasource_type || 'table',
          params: {
            ...chart.params,
            viz_type: chosenViz,
            datasource: `${chart.datasource_id}__table`,
          },
        };
      });
      const result = await saveConfirmedCharts(chartsToSave);
      setResults(result.charts);
      const sc = result.charts.filter(c => c.id != null).length;
      addSuccessToast(t('%s chart(s) created successfully', String(sc)));
      onChartsCreated?.();
      setStep('results');
    } catch (err: any) {
      let msg = t('Failed to save charts');
      if (err?.status === 404) {
        msg = t(
          'Save endpoint not found (404). The backend may need to be restarted to register the /save endpoint.',
        );
      } else if (err?.message) {
        msg = err.message;
      }
      addDangerToast(msg);
    } finally {
      setSaving(false);
    }
  }, [proposals, selectedVizTypes, addDangerToast, addSuccessToast, onChartsCreated]);

  const handleStartOver = useCallback(() => {
    setStep('prompt');
    setProposals([]);
    setResults(null);
    setSelectedVizTypes({});
    setPrompt('');
  }, []);

  const handleBackToPrompt = useCallback(() => {
    setStep('prompt');
  }, []);

  const savedCount = results?.filter(c => c.id != null).length || 0;
  const errorCount = results ? results.length - savedCount : 0;

  const stepIndex = step === 'prompt' ? 0 : step === 'review' ? 1 : 2;

  /* ── Footer buttons per step ── */
  const footer = (() => {
    if (proposing || saving) return null;

    if (step === 'prompt') {
      return (
        <>
          <Button onClick={onHide} buttonStyle="secondary">{t('Cancel')}</Button>
          <Button
            onClick={handlePropose}
            buttonStyle="primary"
            disabled={(!prompt.trim() && !selectedDataset) || !aiEnabled}
          >
            {t('Generate Proposals')}
          </Button>
        </>
      );
    }

    if (step === 'review') {
      return (
        <>
          <Button onClick={handleBackToPrompt} buttonStyle="secondary">
            {t('Back')}
          </Button>
          <Button onClick={handleSave} buttonStyle="primary" loading={saving}>
            {t('Confirm & Save %s Charts', String(proposals.length))}
          </Button>
        </>
      );
    }

    return (
      <>
        <Button onClick={onHide} buttonStyle="secondary">{t('Done')}</Button>
        <Button onClick={handleStartOver} buttonStyle="primary">
          {t('Create More Charts')}
        </Button>
      </>
    );
  })();

  return (
    <Modal
      title={t('AI Chart Creator')}
      show={show}
      onHide={onHide}
      responsive
      width="780px"
      hideFooter={proposing || saving}
      footer={footer}
    >
      <ModalContent>
        {/* Step indicator */}
        <StepIndicator>
          {['Describe', 'Review & Choose', 'Done'].map((label, i) => (
            <span key={label} style={{ display: 'contents' }}>
              <StepDot $active={i === stepIndex} $done={i < stepIndex}>
                {i < stepIndex ? '\u2713' : i + 1}
              </StepDot>
              <StepLabel $active={i <= stepIndex}>{t(label)}</StepLabel>
              {i < 2 && <StepConnector />}
            </span>
          ))}
        </StepIndicator>

        {!aiEnabled && (
          <Alert
            type="warning"
            message={t('AI Insights is not enabled')}
            description={t(
              'An administrator must enable AI Insights and configure at least one provider.',
            )}
            css={css`margin-bottom: 16px;`}
          />
        )}

        {/* ── Loading States ── */}
        {proposing && (
          <GeneratingAnimation>
            <Loading position="inline" />
            <div className="spinner-text">
              {t('AI is analyzing your data and proposing charts...')}
            </div>
            <div className="sub-text">
              {t('This typically takes 15-30 seconds. You will be able to review and customize each chart before saving.')}
            </div>
          </GeneratingAnimation>
        )}

        {saving && (
          <GeneratingAnimation>
            <Loading position="inline" />
            <div className="spinner-text">{t('Saving charts...')}</div>
          </GeneratingAnimation>
        )}

        {/* ══════ STEP 1: PROMPT ══════ */}
        {step === 'prompt' && !proposing && (
          <>
            <PromptSection>
              <PromptLabel>{t('Describe the charts you want')}</PromptLabel>
              <PromptTextarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder={t(
                  'e.g., "Create charts showing malaria testing trends by district, a positivity rate pie chart, and KPI summary cards"\n\nThe AI will propose chart types you can review and customize before saving.',
                )}
                disabled={!aiEnabled}
              />
              <SuggestionChips>
                {SUGGESTIONS.slice(0, 4).map(s => (
                  <Chip key={s} onClick={() => setPrompt(s)} disabled={!aiEnabled}>
                    {s.length > 65 ? `${s.slice(0, 62)}...` : s}
                  </Chip>
                ))}
              </SuggestionChips>
            </PromptSection>

            <OptionsRow>
              <DatasetSelectorWrapper>
                <span className="dataset-label">{t('Dataset (optional)')}</span>
                <AsyncSelect
                  ariaLabel={t('Dataset')}
                  name="ai-chart-dataset"
                  onChange={(val: DatasetOption | null) => setSelectedDataset(val)}
                  options={loadDatasets}
                  optionFilterProps={['id', 'customLabel']}
                  placeholder={t('Auto-detect — AI picks best dataset(s)')}
                  showSearch
                  allowClear
                  value={selectedDataset}
                  disabled={!aiEnabled}
                />
                <span className="dataset-hint">
                  {t('Leave empty to let AI automatically select the best dataset(s)')}
                </span>
              </DatasetSelectorWrapper>

              <OptionGroup css={css`flex: 0 0 120px;`}>
                <label>{t('Charts')}</label>
                <select
                  value={numCharts}
                  onChange={e => setNumCharts(Number(e.target.value))}
                  disabled={!aiEnabled}
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map(n => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? t('chart') : t('charts')}
                    </option>
                  ))}
                </select>
              </OptionGroup>
            </OptionsRow>

            {!selectedDataset && martDatasetCount != null && martDatasetCount > 0 && (
              <AutoDetectBanner>
                <span className="count">{martDatasetCount}</span>
                {t(' MART dataset(s) available. AI will automatically select the best dataset(s).')}
              </AutoDetectBanner>
            )}

            {martDatasetCount === 0 && (
              <Alert
                type="warning"
                message={t('No MART datasets found')}
                description={t(
                  'AI chart generation requires MART datasets. Please ensure your datasets have the MART role or names ending in _mart.',
                )}
                css={css`margin-top: 8px;`}
              />
            )}
          </>
        )}

        {/* ══════ STEP 2: REVIEW & CHOOSE ══════ */}
        {step === 'review' && !saving && (
          <>
            <ReviewHeader>
              {t('Review Proposed Charts (%s)', String(proposals.length))}
            </ReviewHeader>
            <ReviewSubheader>
              {t(
                'AI has recommended a chart type for each visualization (shown in blue). ' +
                'You can change the type below, or keep the recommendation.',
              )}
            </ReviewSubheader>

            <div css={css`max-height: 480px; overflow-y: auto; padding-right: 4px;`}>
              {proposals.map((chart, idx) => {
                const chosen = selectedVizTypes[idx] || chart.viz_type;
                const chosenAlt = (chart.alt_viz_types || []).find(
                  (a: AltVizType) => a.viz_type === chosen,
                );
                const chosenLabel =
                  chosenAlt?.label || chosen.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const datasetLabel = chart.datasource_name || `ID ${chart.datasource_id}`;

                return (
                  <ProposedChartCard key={idx}>
                    <div className="card-header">
                      <div className="chart-name">{chart.slice_name}</div>
                    </div>

                    <div className="chart-meta">
                      <span className="chart-meta-tag chart-type-tag">
                        {chosenLabel}
                      </span>
                      <span className="chart-meta-tag chart-dataset-tag">
                        {datasetLabel}
                      </span>
                    </div>

                    {chart.description && (
                      <div className="chart-desc">{chart.description}</div>
                    )}

                    <VizTypeSelector>
                      <div className="selector-label">
                        {t('Change chart type')}
                      </div>
                      <VizTypeOptions>
                        {(chart.alt_viz_types || []).map((alt: AltVizType, aidx: number) => {
                          const isCustom = CUSTOM_VIZ_TYPES.has(alt.viz_type);
                          const isSelected = alt.viz_type === chosen;
                          const isRecommended = aidx === 0;
                          return (
                            <VizTypeOption
                              key={alt.viz_type}
                              $selected={isSelected}
                              $custom={isCustom && !isSelected}
                              onClick={() =>
                                setSelectedVizTypes(prev => ({
                                  ...prev,
                                  [idx]: alt.viz_type,
                                }))
                              }
                            >
                              <span className="vt-label">
                                {alt.label}
                                {isRecommended && (
                                  <span className="vt-badge vt-badge-rec">AI REC</span>
                                )}
                                {isCustom && (
                                  <span className="vt-badge vt-badge-custom">CUSTOM</span>
                                )}
                              </span>
                              {alt.reason && (
                                <span className="vt-reason">{alt.reason}</span>
                              )}
                            </VizTypeOption>
                          );
                        })}
                      </VizTypeOptions>
                    </VizTypeSelector>
                  </ProposedChartCard>
                );
              })}
            </div>
          </>
        )}

        {/* ══════ STEP 3: RESULTS ══════ */}
        {step === 'results' && results && (
          <>
            <StatusBar $variant={savedCount > 0 ? 'success' : 'error'}>
              {savedCount > 0
                ? t(
                    '%s of %s charts created and saved successfully.',
                    String(savedCount),
                    String(results.length),
                  )
                : t('No charts could be saved. Check the errors below.')}
              {errorCount > 0 && savedCount > 0 && ` ${errorCount} failed.`}
            </StatusBar>
            <ChartGrid>
              {results.map((chart, idx) => (
                <ChartCard key={idx} $success={chart.id != null}>
                  <div className="chart-name">{chart.slice_name}</div>
                  {chart.viz_type && (
                    <div className="chart-type">{chart.viz_type}</div>
                  )}
                  {chart.description && (
                    <div className="chart-desc">{chart.description}</div>
                  )}
                  {chart.id != null && (
                    <div className="chart-link">
                      <a
                        href={chart.url || `/explore/?slice_id=${chart.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('Open in Explore')} &rarr;
                      </a>
                    </div>
                  )}
                  {chart.error && (
                    <div className="chart-error">{chart.error}</div>
                  )}
                </ChartCard>
              ))}
            </ChartGrid>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
