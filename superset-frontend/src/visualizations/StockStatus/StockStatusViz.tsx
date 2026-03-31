/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
/* eslint-disable theme-colors/no-literal-colors */
import { styled } from '@superset-ui/core';
import { StockStatusChartProps, CommodityRow } from './types';

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;
  font-family: var(--pro-font-family, Inter, 'Segoe UI', Roboto, sans-serif);
  background: transparent;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Thead = styled.thead`
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--pro-bg-canvas, #F5F7FA);
`;

const Th = styled.th`
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--pro-text-secondary, #6B7280);
  text-align: left;
  border-bottom: 1px solid var(--pro-border, #E5EAF0);
  white-space: nowrap;

  &:last-child {
    text-align: right;
  }
`;

interface TrProps {
  $height: number;
}

const Tr = styled.tr<TrProps>`
  height: ${({ $height }) => $height}px;
  border-bottom: 1px solid var(--pro-border, #E5EAF0);

  &:hover {
    background: var(--pro-bg-canvas, #F5F7FA);
  }

  &:last-child {
    border-bottom: none;
  }
`;

const Td = styled.td`
  padding: 4px 12px;
  font-size: 12px;
  color: var(--pro-text-primary, #1A1F2C);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
`;

const CommodityName = styled.div`
  font-weight: 600;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
`;

interface StatusPillProps {
  $color: string;
}

const StatusPill = styled.span<StatusPillProps>`
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--pro-radius-chip, 999px);
  font-size: 10px;
  font-weight: 600;
  background: ${({ $color }) => `${$color}14`};
  color: ${({ $color }) => $color};
`;

const MosBarTrack = styled.div`
  width: 100%;
  max-width: 200px;
  height: 10px;
  background: var(--pro-border, #E5EAF0);
  border-radius: 5px;
  overflow: hidden;
  position: relative;
`;

interface MosBarFillProps {
  $percent: number;
  $color: string;
}

const MosBarFill = styled.div<MosBarFillProps>`
  height: 100%;
  width: ${({ $percent }) => Math.max(2, $percent)}%;
  background: ${({ $color }) => $color};
  border-radius: 5px;
  transition: width 0.3s ease;
`;

const MosCell = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const MosValue = styled.span`
  font-weight: 700;
  font-size: 12px;
  min-width: 32px;
  text-align: right;
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--pro-text-muted, #9CA3AF);
  font-size: 14px;
  padding: 40px;
`;

/* ── Threshold markers inside the bar ──────────────── */

interface ThresholdMarkerProps {
  $position: number;
}

const ThresholdMarker = styled.div<ThresholdMarkerProps>`
  position: absolute;
  left: ${({ $position }) => $position}%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--pro-text-muted, #9CA3AF);
  opacity: 0.4;
`;

export default function StockStatusViz(props: StockStatusChartProps) {
  const {
    width,
    height,
    commodities,
    understockThreshold,
    overstockThreshold,
    maxMosDisplay,
    rowHeight,
    showSohColumn,
    showAmcColumn,
    showMosBar,
  } = props;

  if (!commodities || commodities.length === 0) {
    return (
      <Wrapper style={{ width, height }}>
        <EmptyState>No stock data available</EmptyState>
      </Wrapper>
    );
  }

  const underPos = (understockThreshold / maxMosDisplay) * 100;
  const overPos = (overstockThreshold / maxMosDisplay) * 100;

  return (
    <Wrapper style={{ width, height }}>
      <Table>
        <Thead>
          <tr>
            <Th>Commodity</Th>
            {showSohColumn && <Th>SOH</Th>}
            {showAmcColumn && <Th>AMC</Th>}
            <Th>MOS</Th>
            <Th>Status</Th>
            {showMosBar && <Th style={{ minWidth: 200 }}>Stock Level</Th>}
          </tr>
        </Thead>
        <tbody>
          {commodities.map((c: CommodityRow) => (
            <Tr key={c.name} $height={rowHeight}>
              <Td>
                <CommodityName>{c.name}</CommodityName>
              </Td>
              {showSohColumn && <Td>{c.formattedSoh}</Td>}
              {showAmcColumn && <Td>{c.formattedAmc}</Td>}
              <Td>
                <MosValue style={{ color: c.bandColor }}>
                  {c.formattedMos}
                </MosValue>
              </Td>
              <Td>
                <StatusPill $color={c.bandColor}>{c.bandLabel}</StatusPill>
              </Td>
              {showMosBar && (
                <Td>
                  <MosCell>
                    <MosBarTrack>
                      <ThresholdMarker $position={underPos} />
                      <ThresholdMarker $position={overPos} />
                      <MosBarFill
                        $percent={c.barPercent}
                        $color={c.bandColor}
                      />
                    </MosBarTrack>
                  </MosCell>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </Table>
    </Wrapper>
  );
}
