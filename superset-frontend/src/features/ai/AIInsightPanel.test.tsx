import { render, screen, waitFor, userEvent } from 'spec/helpers/testing-library';
import AIInsightPanel from './AIInsightPanel';
import {
  fetchAICapabilities,
  requestAIInsight,
  requestAIInsightStream,
  listConversations,
  createConversation,
  appendMessage,
  getConversation,
} from './api';

jest.mock('./api', () => ({
  fetchAICapabilities: jest.fn(),
  requestAIInsight: jest.fn(),
  requestAIInsightStream: jest.fn(),
  listConversations: jest.fn(),
  createConversation: jest.fn(),
  appendMessage: jest.fn(),
  getConversation: jest.fn(),
  deleteConversation: jest.fn(),
}));

const mockFetchAICapabilities = fetchAICapabilities as jest.MockedFunction<
  typeof fetchAICapabilities
>;
const mockRequestAIInsight = requestAIInsight as jest.MockedFunction<
  typeof requestAIInsight
>;
const mockListConversations = listConversations as jest.MockedFunction<
  typeof listConversations
>;
const mockCreateConversation = createConversation as jest.MockedFunction<
  typeof createConversation
>;
const mockAppendMessage = appendMessage as jest.MockedFunction<
  typeof appendMessage
>;

// jsdom doesn't support scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

describe('AIInsightPanel', () => {
  beforeEach(() => {
    mockFetchAICapabilities.mockResolvedValue({
      enabled: true,
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
    mockListConversations.mockResolvedValue([]);
    mockCreateConversation.mockResolvedValue({
      id: 1,
      user_id: 1,
      mode: 'sql',
      target_id: null,
      title: null,
      provider_id: 'mock',
      model_name: 'mock-1',
      created_on: new Date().toISOString(),
      updated_on: new Date().toISOString(),
      message_count: 0,
    });
    mockAppendMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('loads capabilities and shows provider controls', async () => {
    render(
      <AIInsightPanel
        mode="sql"
        context={{ query_editor: { id: '1' } }}
        defaultQuestion="Show top regions"
        currentSql="SELECT 1"
        databaseId={7}
        schema="public"
        onApplySql={jest.fn()}
        onRunSql={jest.fn()}
        showHistory={false}
      />,
      { useRedux: true },
    );

    await waitFor(() =>
      expect(mockFetchAICapabilities).toHaveBeenCalledWith('sql'),
    );
  });

  test('disables submission when no providers are configured', async () => {
    mockFetchAICapabilities.mockResolvedValueOnce({
      enabled: false,
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
        showHistory={false}
      />,
      { useRedux: true },
    );

    expect(
      await screen.findByText('No AI providers configured'),
    ).toBeInTheDocument();
  });

  test('shows suggestion chips when no messages', async () => {
    render(
      <AIInsightPanel
        mode="chart"
        context={{}}
        targetId={12}
        defaultQuestion="Summarize this chart"
        showHistory={false}
      />,
      { useRedux: true },
    );

    await waitFor(() =>
      expect(mockFetchAICapabilities).toHaveBeenCalled(),
    );
    expect(
      await screen.findByText('Ask a question about your data'),
    ).toBeInTheDocument();
  });
});
