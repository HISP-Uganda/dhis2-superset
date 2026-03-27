import { render, screen } from 'spec/helpers/testing-library';
import mockState from 'spec/fixtures/mockState';
import DashboardInsightsButton from './DashboardInsightsButton';

jest.mock('./AIInsightPanel', () => ({
  __esModule: true,
  default: () => <div data-test="mock-ai-insight-panel" />,
}));

describe('DashboardInsightsButton', () => {
  afterEach(() => {
    (global as any).featureFlags = {};
  });

  test('renders when the AI feature flag is enabled', async () => {
    (global as any).featureFlags = { AI_INSIGHTS: true };

    render(
      <DashboardInsightsButton
        dashboardId={14}
        dashboardTitle="District summary"
        charts={[]}
        activeFilters={{ period: '2026Q1' }}
      />,
      {
        useRedux: true,
        initialState: {
          ...mockState,
          charts: {},
        },
      },
    );

    expect(screen.getAllByRole('button', { name: /ai insights/i })).not.toHaveLength(0);
  });

  test('does not render when the AI feature flag is disabled', () => {
    (global as any).featureFlags = { AI_INSIGHTS: false };

    render(
      <DashboardInsightsButton
        dashboardId={14}
        dashboardTitle="District summary"
        charts={[]}
      />,
      {
        useRedux: true,
        initialState: {
          ...mockState,
          charts: {},
        },
      },
    );

    expect(
      screen.queryByRole('button', { name: /ai insights/i }),
    ).not.toBeInTheDocument();
  });
});
