import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from 'spec/helpers/testing-library';

import LocalAIModelHub from './LocalAIModelHub';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();

jest.mock('@superset-ui/core', () => ({
  ...jest.requireActual('@superset-ui/core'),
  SupersetClient: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

const offlineGallery = {
  json: {
    result: {
      models: [
        {
          id: 'ai-insights-model-26.04',
          label: 'AI Insights Model 26.04',
          group: 'Custom',
          description: 'Optimized analytics model',
          capabilities: [
            'SQL generation and repair',
            'Superset MCP/API control',
          ],
          is_recommended: true,
          file_size: '3.4 KB',
          asset_file_size: '3.4 KB',
          base_model: 'hermes-3-llama-3.1-8b-lorablated.Q4_K_M.gguf',
          base_model_file_size: '',
          lora_adapter: '',
          lora_adapter_file_size: '',
          installed: true,
          is_default_model: true,
          is_repo_managed: true,
        },
      ],
      localai_running: false,
      provider_enabled: true,
      provider_default_model: 'ai-insights-model-26.04',
      default_provider: 'localai',
      base_url: 'http://127.0.0.1:39671',
    },
  },
};

const onlineGallery = {
  json: {
    result: {
      ...offlineGallery.json.result,
      localai_running: true,
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders LocalAI model size and capabilities', async () => {
  mockGet.mockResolvedValue(offlineGallery);

  render(<LocalAIModelHub />, {
    useRedux: true,
    useRouter: true,
  });

  expect(
    await screen.findByText('AI Insights Model 26.04'),
  ).toBeInTheDocument();
  expect(screen.getByText('3.4 KB')).toBeInTheDocument();
  expect(screen.getByText('SQL generation and repair')).toBeInTheDocument();
  expect(screen.getByText('Superset MCP/API control')).toBeInTheDocument();
  expect(screen.getByText(/Local asset size: 3.4 KB/i)).toBeInTheDocument();
  expect(
    screen.getByText(
      /Base model dependency: hermes-3-llama-3.1-8b-lorablated\.Q4_K_M\.gguf/i,
    ),
  ).toBeInTheDocument();
});

test('deploys repo-managed model while LocalAI is offline', async () => {
  mockGet
    .mockResolvedValueOnce({
      json: {
        result: {
          ...offlineGallery.json.result,
          models: [
            {
              ...offlineGallery.json.result.models[0],
              installed: false,
            },
          ],
        },
      },
    })
    .mockResolvedValueOnce(offlineGallery);
  mockPost.mockResolvedValue({
    json: {
      result: {
        deployed: true,
        model_id: 'ai-insights-model-26.04',
      },
    },
  });

  render(<LocalAIModelHub />, {
    useRedux: true,
    useRouter: true,
  });

  await screen.findByText('LocalAI Offline');
  await userEvent.click(
    screen.getByRole('button', { name: /Deploy local model/i }),
  );

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/ai-management/localai/models/install',
        jsonPayload: { model_id: 'ai-insights-model-26.04' },
      }),
    );
  });
});

test('starts LocalAI from the model hub', async () => {
  mockGet
    .mockResolvedValueOnce(offlineGallery)
    .mockResolvedValueOnce(onlineGallery);
  mockPost.mockResolvedValue({
    json: {
      result: {
        localai_running: true,
      },
    },
  });

  render(<LocalAIModelHub />, {
    useRedux: true,
    useRouter: true,
  });

  await screen.findByText('LocalAI Offline');
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Start LocalAI' })[0],
  );

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/ai-management/localai/start',
      }),
    );
  });
});

test('stops LocalAI from the model hub', async () => {
  mockGet
    .mockResolvedValueOnce(onlineGallery)
    .mockResolvedValueOnce(offlineGallery);
  mockPost.mockResolvedValue({
    json: {
      result: {
        localai_running: false,
      },
    },
  });

  render(<LocalAIModelHub />, {
    useRedux: true,
    useRouter: true,
  });

  await screen.findByText('LocalAI Running');
  await userEvent.click(screen.getByRole('button', { name: 'Stop LocalAI' }));

  await waitFor(() => {
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/ai-management/localai/stop',
      }),
    );
  });
});
