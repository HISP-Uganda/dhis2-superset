import { useEffect, useMemo, useState } from 'react';
import { styled, SupersetClient, useTheme } from '@superset-ui/core';
import {
  Card,
  Row,
  Col,
  Alert,
  Divider,
  Typography,
  Loading,
  Tag,
  Statistic,
} from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { DHIS2WizardState } from '../index';

const { Title, Paragraph, Text } = Typography;

const RELATIVE_PERIOD_IDS = new Set([
  'TODAY',
  'YESTERDAY',
  'LAST_3_DAYS',
  'LAST_7_DAYS',
  'LAST_14_DAYS',
  'LAST_30_DAYS',
  'LAST_60_DAYS',
  'LAST_90_DAYS',
  'LAST_180_DAYS',
  'LAST_365_DAYS',
  'THIS_WEEK',
  'LAST_WEEK',
  'LAST_4_WEEKS',
  'LAST_12_WEEKS',
  'LAST_52_WEEKS',
  'WEEKS_THIS_YEAR',
  'WEEKS_LAST_YEAR',
  'THIS_BIWEEK',
  'LAST_BIWEEK',
  'LAST_4_BIWEEKS',
  'LAST_12_BIWEEKS',
  'BIWEEKS_THIS_YEAR',
  'BIWEEKS_LAST_YEAR',
  'THIS_MONTH',
  'LAST_MONTH',
  'LAST_3_MONTHS',
  'LAST_6_MONTHS',
  'LAST_12_MONTHS',
  'MONTHS_THIS_YEAR',
  'MONTHS_LAST_YEAR',
  'THIS_BIMONTH',
  'LAST_BIMONTH',
  'LAST_6_BIMONTHS',
  'BIMONTHS_THIS_YEAR',
  'BIMONTHS_LAST_YEAR',
  'THIS_QUARTER',
  'LAST_QUARTER',
  'LAST_4_QUARTERS',
  'QUARTERS_THIS_YEAR',
  'QUARTERS_LAST_YEAR',
  'THIS_SIX_MONTH',
  'LAST_SIX_MONTH',
  'LAST_2_SIXMONTHS',
  'SIXMONTHS_THIS_YEAR',
  'SIXMONTHS_LAST_YEAR',
  'THIS_YEAR',
  'LAST_YEAR',
  'LAST_5_YEARS',
  'LAST_10_YEARS',
  'THIS_FINANCIAL_YEAR',
  'LAST_FINANCIAL_YEAR',
  'LAST_5_FINANCIAL_YEARS',
  'LAST_10_FINANCIAL_YEARS',
]);

const RELATIVE_PERIOD_LABELS: Record<string, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  LAST_3_DAYS: 'Last 3 Days',
  LAST_7_DAYS: 'Last 7 Days',
  LAST_14_DAYS: 'Last 14 Days',
  LAST_30_DAYS: 'Last 30 Days',
  LAST_60_DAYS: 'Last 60 Days',
  LAST_90_DAYS: 'Last 90 Days',
  LAST_180_DAYS: 'Last 180 Days',
  LAST_365_DAYS: 'Last 365 Days',
  THIS_WEEK: 'This Week',
  LAST_WEEK: 'Last Week',
  LAST_4_WEEKS: 'Last 4 Weeks',
  LAST_12_WEEKS: 'Last 12 Weeks',
  LAST_52_WEEKS: 'Last 52 Weeks',
  WEEKS_THIS_YEAR: 'Weeks This Year',
  WEEKS_LAST_YEAR: 'Weeks Last Year',
  THIS_BIWEEK: 'This Bi-week',
  LAST_BIWEEK: 'Last Bi-week',
  LAST_4_BIWEEKS: 'Last 4 Bi-weeks',
  LAST_12_BIWEEKS: 'Last 12 Bi-weeks',
  BIWEEKS_THIS_YEAR: 'Bi-weeks This Year',
  BIWEEKS_LAST_YEAR: 'Bi-weeks Last Year',
  THIS_MONTH: 'This Month',
  LAST_MONTH: 'Last Month',
  LAST_3_MONTHS: 'Last 3 Months',
  LAST_6_MONTHS: 'Last 6 Months',
  LAST_12_MONTHS: 'Last 12 Months',
  MONTHS_THIS_YEAR: 'Months This Year',
  MONTHS_LAST_YEAR: 'Months Last Year',
  THIS_BIMONTH: 'This Bi-month',
  LAST_BIMONTH: 'Last Bi-month',
  LAST_6_BIMONTHS: 'Last 6 Bi-months',
  BIMONTHS_THIS_YEAR: 'Bi-months This Year',
  BIMONTHS_LAST_YEAR: 'Bi-months Last Year',
  THIS_QUARTER: 'This Quarter',
  LAST_QUARTER: 'Last Quarter',
  LAST_4_QUARTERS: 'Last 4 Quarters',
  QUARTERS_THIS_YEAR: 'Quarters This Year',
  QUARTERS_LAST_YEAR: 'Quarters Last Year',
  THIS_SIX_MONTH: 'This Six-month',
  LAST_SIX_MONTH: 'Last Six-month',
  LAST_2_SIXMONTHS: 'Last 2 Six-months',
  SIXMONTHS_THIS_YEAR: 'Six-months This Year',
  SIXMONTHS_LAST_YEAR: 'Six-months Last Year',
  THIS_YEAR: 'This Year',
  LAST_YEAR: 'Last Year',
  LAST_5_YEARS: 'Last 5 Years',
  LAST_10_YEARS: 'Last 10 Years',
  THIS_FINANCIAL_YEAR: 'This Financial Year',
  LAST_FINANCIAL_YEAR: 'Last Financial Year',
  LAST_5_FINANCIAL_YEARS: 'Last 5 Financial Years',
  LAST_10_FINANCIAL_YEARS: 'Last 10 Financial Years',
};

const StepContainer = styled.div`
  max-width: 700px;
  margin: 0 auto;
`;

const SummaryCard = styled(Card)`
  ${({ theme }) => `
    margin-bottom: 16px;
  `}
`;

const PeriodsList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`;

const ColumnsList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
  margin-top: 12px;
`;

const ColumnItem = styled.div`
  ${({ theme }) => `
    padding: 12px;
    background: ${theme.colorBgContainer};
    border: 1px solid ${theme.colorBorder};
    border-radius: ${theme.borderRadius}px;
    font-size: 12px;
  `}
`;

const ColumnName = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
`;

const ColumnMeta = styled.div`
  ${({ theme }) => `
    color: ${theme.colorTextSecondary};
    font-size: 11px;
  `}
`;

interface StepSaveProps {
  wizardState: DHIS2WizardState;
  dataset: any;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleSave: () => Promise<void>;
  loading: boolean;
}

export default function WizardStepSave({
  wizardState,
  dataset,
  handleSave,
  loading,
}: StepSaveProps) {
  const theme = useTheme();
  const orgUnitCount = wizardState.orgUnits.length;
  const isScopeApplied =
    wizardState.dataLevelScope &&
    wizardState.dataLevelScope !== 'selected';
  const [expandedOrgUnitCount, setExpandedOrgUnitCount] = useState<number | null>(
    null,
  );
  const [expandedCountLoading, setExpandedCountLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const databaseId = dataset?.db?.id;

    if (!isScopeApplied || !databaseId || orgUnitCount === 0) {
      setExpandedOrgUnitCount(null);
      return () => {
        cancelled = true;
      };
    }

    setExpandedCountLoading(true);
    SupersetClient.post({
      endpoint: `/api/v1/database/${databaseId}/dhis2_expanded_org_units/`,
      jsonPayload: {
        org_units: wizardState.orgUnits,
        include_children: true,
      },
    })
      .then(({ json }) => {
        if (!cancelled) {
          setExpandedOrgUnitCount(json?.count ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExpandedOrgUnitCount(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setExpandedCountLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dataset?.db?.id, isScopeApplied, orgUnitCount, wizardState.orgUnits]);

  const getPeriodType = (periodId: string) => {
    const periodKey = periodId.split('|')[0];
    return RELATIVE_PERIOD_IDS.has(periodKey) ? 'RELATIVE' : 'FIXED';
  };

  const getPeriodLabel = (periodId: string) => {
    const periodKey = periodId.split('|')[0];
    return RELATIVE_PERIOD_LABELS[periodKey] || periodId;
  };

  const periodsByType = useMemo(() => {
    const relative: string[] = [];
    const fixed: string[] = [];

    wizardState.periods.forEach(periodId => {
      if (getPeriodType(periodId) === 'RELATIVE') {
        relative.push(periodId);
      } else {
        fixed.push(periodId);
      }
    });

    return { relative, fixed };
  }, [wizardState.periods]);

  // Org unit expansion is handled by DHIS2 at query time (ouMode + LEVEL-*),
  // so we keep only the selected org unit IDs here.

  if (loading) {
    return (
      <StepContainer>
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <Loading />
          <Paragraph style={{ marginTop: 24, color: theme.colorTextSecondary }}>
            Creating your DHIS2 dataset... This may take a few moments.
          </Paragraph>
        </div>
      </StepContainer>
    );
  }

  return (
    <StepContainer>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
          Review & Complete Setup
        </Title>
        <Paragraph style={{ margin: 0, color: theme.colorTextSecondary }}>
          Verify your dataset configuration before completion.
        </Paragraph>
      </div>

      <Alert
        message="Ready to Create"
        description="All required information provided. Your dataset will be created with the configuration below."
        type="success"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <SummaryCard title="Dataset Information" type="inner">
        <Row gutter={[24, 16]}>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Dataset Name
            </Text>
            <br />
            <Title level={5} style={{ margin: '8px 0 0 0' }}>
              {wizardState.datasetName}
            </Title>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Database
            </Text>
            <br />
            <Title level={5} style={{ margin: '8px 0 0 0' }}>
              {dataset?.db?.database_name}
            </Title>
          </Col>
        </Row>
        {wizardState.description && (
          <>
            <Divider style={{ margin: '16px 0' }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Description
              </Text>
              <br />
              <Paragraph
                style={{
                  margin: '8px 0 0 0',
                  color: theme.colorTextSecondary,
                }}
              >
                {wizardState.description}
              </Paragraph>
            </div>
          </>
        )}
      </SummaryCard>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card type="inner" hoverable>
            <Statistic
              title="Data Elements"
              value={wizardState.dataElements.length}
              prefix={<Icons.DatabaseOutlined />}
              valueStyle={{ color: theme.colorPrimary }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card type="inner" hoverable>
            <Statistic
              title="Time Periods"
              value={wizardState.periods.length}
              prefix={<Icons.CheckCircleOutlined />}
              valueStyle={{ color: theme.colorSuccess }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card type="inner" hoverable>
            <Statistic
              title={
                isScopeApplied
                  ? 'Organization Units (selected)'
                  : 'Organization Units'
              }
              value={orgUnitCount}
              prefix={
                isScopeApplied ? (
                  <Icons.WarningOutlined />
                ) : (
                  <Icons.CheckCircleOutlined />
                )
              }
              valueStyle={{ color: theme.colorWarning }}
              suffix={
                isScopeApplied
                  ? expandedCountLoading
                    ? '(calculating scope…)'
                    : expandedOrgUnitCount !== null
                      ? `(${expandedOrgUnitCount} with scope)`
                      : '(scope applied)'
                  : ''
              }
            />
          </Card>
        </Col>
      </Row>

      {wizardState.periods.length > 0 && (
        <SummaryCard title="Time Periods Details" type="inner">
          {periodsByType.relative.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
                RELATIVE PERIODS ({periodsByType.relative.length})
              </Text>
              <PeriodsList>
                {periodsByType.relative.map(periodId => (
                  <Tag
                    key={periodId}
                    color="blue"
                    style={{
                      marginRight: 0,
                      fontSize: 12,
                      padding: '4px 8px',
                    }}
                  >
                    {getPeriodLabel(periodId)}
                  </Tag>
                ))}
              </PeriodsList>
            </div>
          )}
          {periodsByType.fixed.length > 0 && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
                FIXED PERIODS ({periodsByType.fixed.length})
              </Text>
              <PeriodsList>
                {periodsByType.fixed.map(periodId => (
                  <Tag
                    key={periodId}
                    color="green"
                    style={{
                      marginRight: 0,
                      fontSize: 12,
                      padding: '4px 8px',
                    }}
                  >
                    {getPeriodLabel(periodId)}
                  </Tag>
                ))}
              </PeriodsList>
            </div>
          )}
        </SummaryCard>
      )}

      {wizardState.columns.length > 0 && (
        <SummaryCard title="Dataset Columns" type="inner">
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            Total: {wizardState.columns.length} columns will be created
          </Text>
          <ColumnsList>
            {wizardState.columns.map((col, idx) => (
              <ColumnItem key={col.name || idx}>
                <ColumnName>{col.verbose_name || col.name}</ColumnName>
                <ColumnMeta>Column: {col.name}</ColumnMeta>
                {col.is_dttm && (
                  <ColumnMeta
                    style={{ color: theme.colorSuccess, marginTop: 4 }}
                  >
                    📅 Time Dimension
                  </ColumnMeta>
                )}
              </ColumnItem>
            ))}
          </ColumnsList>
        </SummaryCard>
      )}

      <Card style={{ marginBottom: 16 }} type="inner">
        <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
          What Happens Next
        </Title>
        <ol style={{ paddingLeft: 20, margin: 0, lineHeight: '1.7' }}>
          <li>Dataset created with your selected parameters</li>
          <li>Data fetched from DHIS2 in background</li>
          <li>Visualizations available after data loads</li>
          <li>Dataset appears in your datasets list</li>
        </ol>
      </Card>

      <Card style={{ marginBottom: 24 }} type="inner">
        <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
          Need to Make Changes?
        </Title>
        <Paragraph style={{ margin: 0, color: theme.colorTextSecondary }}>
          Use the "Previous" button to modify settings before completion.
        </Paragraph>
      </Card>

      <Alert
        message="Important Note"
        description="Do not close this window while the dataset is being created. Processing may take several minutes depending on data size."
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
    </StepContainer>
  );
}
