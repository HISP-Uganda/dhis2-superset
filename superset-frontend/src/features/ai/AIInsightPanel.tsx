import { useEffect, useMemo, useRef, useState } from 'react';
import {
  css,
  getClientErrorObject,
  styled,
  t,
  useTheme,
} from '@superset-ui/core';
import { Alert, Button, Input, Loading } from '@superset-ui/core/components';
import { useToasts } from 'src/components/MessageToasts/withToasts';
import { fetchAICapabilities, requestAIInsight } from './api';
import {
  AICapabilities,
  AIConversationMessage,
  AIInsightMode,
  AIInsightResult,
} from './types';

const Panel = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    gap: ${theme.sizeUnit * 3}px;
    min-height: 420px;
  `}
`;

const Controls = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: ${theme.sizeUnit * 2}px;

    label {
      display: flex;
      flex-direction: column;
      gap: ${theme.sizeUnit}px;
      font-size: ${theme.fontSizeSM}px;
      color: ${theme.colorTextLabel};
    }

    select {
      min-height: ${theme.sizeUnit * 8}px;
      border: 1px solid ${theme.colorBorder};
      border-radius: ${theme.borderRadius}px;
      padding: 0 ${theme.sizeUnit * 2}px;
      background: ${theme.colorBgContainer};
    }
  `}
`;

const ResponseBlock = styled.div`
  ${({ theme }) => css`
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    background: ${theme.colorBgElevated};
    padding: ${theme.sizeUnit * 3}px;
    white-space: pre-wrap;
    line-height: 1.6;
  `}
`;

const ActionRow = styled.div`
  ${({ theme }) => css`
    display: flex;
    gap: ${theme.sizeUnit * 2}px;
    flex-wrap: wrap;
  `}
`;

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
};

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
}: Props) {
  const theme = useTheme();
  const { addDangerToast } = useToasts();
  const isMountedRef = useRef(true);
  const [capabilities, setCapabilities] = useState<AICapabilities | null>(null);
  const [providerId, setProviderId] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [question, setQuestion] = useState(defaultQuestion);
  const [conversation, setConversation] = useState<AIConversationMessage[]>([]);
  const [result, setResult] = useState<AIInsightResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAICapabilities(mode)
      .then(data => {
        if (!isMountedRef.current) {
          return;
        }
        setCapabilities(data);
        setProviderId(data.default_provider || data.providers[0]?.id || '');
        setModel(data.default_model || data.providers[0]?.default_model || '');
      })
      .catch(async error => {
        const clientError = await getClientErrorObject(error);
        if (isMountedRef.current) {
          addDangerToast(clientError.message || t('Failed to load AI capabilities'));
        }
      });
    return () => {
      isMountedRef.current = false;
    };
  }, [addDangerToast, mode]);

  const selectedProvider = useMemo(
    () => capabilities?.providers.find(provider => provider.id === providerId),
    [capabilities, providerId],
  );

  useEffect(() => {
    if (!selectedProvider) {
      return;
    }
    if (!selectedProvider.models.includes(model)) {
      setModel(selectedProvider.default_model || selectedProvider.models[0] || '');
    }
  }, [model, selectedProvider]);

  const submit = async (execute = false) => {
    if (!capabilities?.providers.length) {
      addDangerToast(t('No AI providers are configured for this environment'));
      return;
    }

    if (isMountedRef.current) {
      setLoading(true);
    }

    try {
      const response = await requestAIInsight({
        mode,
        targetId,
        providerId,
        model,
        question: question.trim() || defaultQuestion,
        context,
        conversation,
        currentSql,
        databaseId,
        schema,
        execute,
      });
      if (!isMountedRef.current) {
        return;
      }
      setResult(response);
      setConversation(prev => [
        ...prev,
        { role: 'user', content: question.trim() || defaultQuestion },
        {
          role: 'assistant',
          content:
            response.insight ||
            response.explanation ||
            response.sql ||
            t('AI response received'),
        },
      ]);
    } catch (error) {
      const clientError = await getClientErrorObject(error);
      if (isMountedRef.current) {
        addDangerToast(clientError.message || t('AI request failed'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <Panel>
      {capabilities ? (
        <Controls>
          <label>
            {t('Provider')}
            <select
              value={providerId}
              onChange={event => setProviderId(event.target.value)}
            >
              {capabilities.providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                  {provider.is_local ? ` (${t('Local')})` : ` (${t('Remote')})`}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Model')}
            <select value={model} onChange={event => setModel(event.target.value)}>
              {(selectedProvider?.models || []).map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </Controls>
      ) : (
        <Loading />
      )}

      {capabilities && capabilities.providers.length === 0 ? (
        <Alert
          type="warning"
          message={t('No AI providers configured')}
          description={t(
            'An administrator must enable at least one approved AI provider before this assistant can be used.',
          )}
        />
      ) : null}

      <Input.TextArea
        rows={4}
        value={question}
        onChange={event => setQuestion(event.target.value)}
        placeholder={defaultQuestion}
      />

      <ActionRow>
        <Button
          buttonStyle="primary"
          onClick={() => void submit(false)}
          loading={loading}
          disabled={Boolean(capabilities && capabilities.providers.length === 0)}
        >
          {mode === 'sql' ? t('Generate SQL insight') : t('Generate insight')}
        </Button>
        {mode === 'sql' && capabilities?.allow_sql_execution ? (
          <Button
            onClick={() => void submit(true)}
            loading={loading}
            disabled={capabilities.providers.length === 0}
          >
            {t('Generate and run')}
          </Button>
        ) : null}
      </ActionRow>

      {mode === 'sql' && result?.sql ? (
        <Alert
          type="info"
          message={t('Generated SQL')}
          description={
            <ResponseBlock>
              {result.sql}
              <ActionRow
                css={css`
                  margin-top: ${theme.sizeUnit * 2}px;
                `}
              >
                {onApplySql ? (
                  <Button onClick={() => onApplySql(result.sql!)} buttonStyle="secondary">
                    {t('Apply to editor')}
                  </Button>
                ) : null}
                {onRunSql ? (
                  <Button onClick={() => onRunSql(result.sql!)}>{t('Run in SQL Lab')}</Button>
                ) : null}
              </ActionRow>
            </ResponseBlock>
          }
        />
      ) : null}

      {result?.explanation ? (
        <Alert type="success" message={t('Explanation')} description={result.explanation} />
      ) : null}

      {result?.insight ? <ResponseBlock>{result.insight}</ResponseBlock> : null}

      {result?.execution ? (
        <Alert
          type="info"
          message={t('Execution sample')}
          description={
            <ResponseBlock>
              {JSON.stringify(result.execution, null, 2)}
            </ResponseBlock>
          }
        />
      ) : null}
    </Panel>
  );
}
