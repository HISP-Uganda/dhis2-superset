import { useMemo } from 'react';
import { FeatureFlag, isFeatureEnabled, styled, css, t } from '@superset-ui/core';
import { Button, ModalTrigger } from '@superset-ui/core/components';
import { useSelector } from 'react-redux';
import { RootState } from 'src/dashboard/types';
import type Chart from 'src/types/Chart';
import AIInsightPanel from './AIInsightPanel';
import { buildDashboardInsightContext } from './context';

const FloatingButton = styled.div`
  ${({ theme }) => css`
    position: fixed;
    right: ${theme.sizeUnit * 4}px;
    bottom: ${theme.sizeUnit * 4}px;
    z-index: 1000;
  `}
`;

type Props = {
  dashboardId: number | string;
  dashboardTitle?: string;
  charts: Chart[];
  activeFilters?: unknown;
};

export default function DashboardInsightsButton({
  dashboardId,
  dashboardTitle,
  charts,
  activeFilters,
}: Props) {
  const chartStates = useSelector((state: RootState) => state.charts);

  const context = useMemo(
    () =>
      buildDashboardInsightContext({
        dashboardId,
        dashboardTitle,
        activeFilters,
        charts: charts.map(chart => ({
          id: chart.id,
          slice_name: chart.slice_name,
          viz_type: chart.viz_type,
          form_data: chart.form_data,
          queryResponse: chartStates[chart.id]?.queriesResponse?.[0],
        })),
      }),
    [activeFilters, chartStates, charts, dashboardId, dashboardTitle],
  );

  if (!isFeatureEnabled(FeatureFlag.AiInsights)) {
    return null;
  }

  return (
    <FloatingButton>
      <ModalTrigger
        triggerNode={
          <Button buttonStyle="primary">
            {t('AI insights')}
          </Button>
        }
        modalTitle={t('Dashboard AI insights')}
        modalBody={
          <AIInsightPanel
            mode="dashboard"
            targetId={dashboardId}
            context={context}
            defaultQuestion={t('Summarize this dashboard')}
          />
        }
        responsive
        destroyOnHidden
      />
    </FloatingButton>
  );
}
