import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from 'spec/helpers/testing-library';

import AIManagement from '.';

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockPost = jest.fn();

jest.mock('@superset-ui/core', () => ({
  ...jest.requireActual('@superset-ui/core'),
  SupersetClient: {
    get: (...args: any[]) => mockGet(...args),
    put: (...args: any[]) => mockPut(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}));

const payload = {
  feature_flag_enabled: true,
  role_names: ['Admin', 'Gamma'],
  provider_presets: [
    {
      id: 'openai',
      provider_type: 'openai',
      label: 'OpenAI Cloud',
      description: 'Hosted OpenAI API',
      catalog_key: 'openai_text',
      default_base_url: 'https://api.openai.com/v1',
      default_model: 'gpt-5.4',
      is_local: false,
      supports_base_url: false,
      supports_api_key: true,
      supports_api_key_env: true,
    },
    {
      id: 'mock',
      provider_type: 'mock',
      label: 'Mock / Test',
      description: 'Mock provider',
      catalog_key: 'mock',
      default_model: 'mock-1',
      is_local: true,
      supports_base_url: false,
      supports_api_key: false,
      supports_api_key_env: false,
    },
  ],
  model_catalogs: {
    openai_text: [
      { id: 'gpt-5.4', label: 'GPT-5.4', group: 'Frontier', is_latest: true },
      { id: 'gpt-4.1', label: 'GPT-4.1', group: 'Balanced' },
    ],
    mock: [{ id: 'mock-1', label: 'Mock 1', group: 'Testing' }],
  },
  settings: {
    enabled: true,
    allow_sql_execution: false,
    max_context_rows: 20,
    max_context_columns: 25,
    max_dashboard_charts: 12,
    max_follow_up_messages: 6,
    max_generated_sql_rows: 200,
    request_timeout_seconds: 30,
    max_tokens: 1200,
    temperature: 0.1,
    default_provider: 'openai',
    default_model: 'gpt-5.4',
    allowed_roles: [],
    mode_roles: { chart: [], dashboard: [], sql: [] },
    providers: {
      openai: {
        enabled: true,
        type: 'openai',
        label: 'OpenAI Cloud',
        api_key: '**********',
        has_api_key: true,
        api_key_env: 'OPENAI_API_KEY',
        models: ['gpt-5.4', 'gpt-4.1'],
        default_model: 'gpt-5.4',
        is_local: false,
        catalog_key: 'openai_text',
      },
      mock: {
        enabled: false,
        type: 'mock',
        label: 'Mock / Test',
        models: ['mock-1'],
        default_model: 'mock-1',
        is_local: true,
        catalog_key: 'mock',
      },
    },
  },
};

beforeEach(() => {
  mockGet.mockResolvedValue({ json: { result: payload } });
  mockPut.mockResolvedValue({ json: { result: payload } });
  mockPost.mockResolvedValue({
    json: { result: { provider: 'openai', model: 'gpt-5.4', text: 'OK' } },
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders AI management settings and provider cards', async () => {
  render(<AIManagement />, {
    useRedux: true,
    useRouter: true,
  });

  await screen.findByText('AI Management');
  expect((await screen.findAllByText('OpenAI Cloud')).length).toBeGreaterThan(
    0,
  );
  expect(screen.getByText('Mock / Test')).toBeInTheDocument();
});

test('saves AI settings', async () => {
  render(<AIManagement />, {
    useRedux: true,
    useRouter: true,
  });

  await screen.findByText('AI Management');
  await userEvent.click(
    screen.getByRole('button', { name: 'Save AI Settings' }),
  );

  await waitFor(() => {
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/ai-management/settings',
      }),
    );
  });
});

test('tests a provider from the page', async () => {
  render(<AIManagement />, {
    useRedux: true,
    useRouter: true,
  });

  await screen.findByText('AI Management');
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Test Provider' })[0],
  );

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/ai-management/test-provider',
      }),
    );
  });
});
