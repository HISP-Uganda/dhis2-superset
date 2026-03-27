import { render, screen, waitFor, userEvent } from 'spec/helpers/testing-library';
import AIInsightPanel from './AIInsightPanel';
import { fetchAICapabilities, requestAIInsight } from './api';

jest.mock('./api', () => ({
  fetchAICapabilities: jest.fn(),
  requestAIInsight: jest.fn(),
}));

const mockFetchAICapabilities = fetchAICapabilities as jest.MockedFunction<
  typeof fetchAICapabilities
>;
const mockRequestAIInsight = requestAIInsight as jest.MockedFunction<
  typeof requestAIInsight
>;

describe('AIInsightPanel', () => {
  beforeEach(() => {
    mockFetchAICapabilities.mockResolvedValue({
      default_provider: 'mock',
      default_model: 'mock-1',
      allow_sql_execution: true,
      providers: [
        {
          id: 'mock',
          label: 'Mock Provider',
          models: ['mock-1'],
          default_model: 'mock-1',
          provider_type: 'mock',
          is_local: true,
          available: true,
        },
      ],
    });
    mockRequestAIInsight.mockResolvedValue({
      mode: 'sql',
      question: 'Show top regions',
      provider: 'mock',
      model: 'mock-1',
      sql: 'SELECT * FROM admissions_mart LIMIT 100',
      explanation: 'Reads from the admissions MART.',
      execution: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('loads capabilities, submits an insight request, and exposes SQL actions', async () => {
    const onApplySql = jest.fn();
    const onRunSql = jest.fn();

    render(
      <AIInsightPanel
        mode="sql"
        context={{ query_editor: { id: '1' } }}
        defaultQuestion="Show top regions"
        currentSql="SELECT 1"
        databaseId={7}
        schema="public"
        onApplySql={onApplySql}
        onRunSql={onRunSql}
      />,
      {
        useRedux: true,
      },
    );

    expect(await screen.findByLabelText('Provider')).toHaveValue('mock');
    expect(screen.getByLabelText('Model')).toHaveValue('mock-1');

    userEvent.click(screen.getByRole('button', { name: /generate sql insight/i }));

    await waitFor(() =>
      expect(mockRequestAIInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'sql',
          question: 'Show top regions',
          currentSql: 'SELECT 1',
          databaseId: 7,
          schema: 'public',
        }),
      ),
    );

    expect(await screen.findByText('Generated SQL')).toBeInTheDocument();
    expect(screen.getByText('SELECT * FROM admissions_mart LIMIT 100')).toBeInTheDocument();
    expect(screen.getByText('Reads from the admissions MART.')).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: /apply to editor/i }));
    expect(onApplySql).toHaveBeenCalledWith(
      'SELECT * FROM admissions_mart LIMIT 100',
    );

    userEvent.click(screen.getByRole('button', { name: /run in sql lab/i }));
    expect(onRunSql).toHaveBeenCalledWith(
      'SELECT * FROM admissions_mart LIMIT 100',
    );
  });

  test('disables submission when no providers are configured', async () => {
    mockFetchAICapabilities.mockResolvedValueOnce({
      default_provider: null,
      default_model: null,
      allow_sql_execution: false,
      providers: [],
    });

    render(
      <AIInsightPanel
        mode="chart"
        context={{}}
        targetId={12}
        defaultQuestion="Summarize this chart"
      />,
      {
        useRedux: true,
      },
    );

    expect(await screen.findByText('No AI providers configured')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /generate insight/i }),
    ).toBeDisabled();
    expect(mockRequestAIInsight).not.toHaveBeenCalled();
  });
});
