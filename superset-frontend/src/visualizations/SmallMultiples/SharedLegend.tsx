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

const LegendWrapper = styled.div<{ $position: 'top' | 'bottom' }>`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 6px 12px;
  justify-content: center;
  align-items: center;
  font-family: var(--pro-font-family, Inter, 'Segoe UI', Roboto, sans-serif);
  font-size: 11px;
  color: var(--pro-text-secondary, #6B7280);
  border-${({ $position }) => ($position === 'top' ? 'bottom' : 'top')}: 1px solid var(--pro-border, #E5EAF0);
  background: var(--pro-sub-surface, #F8FAFC);
  flex-shrink: 0;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
`;

const ColorDot = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background-color: ${({ $color }) => $color};
  flex-shrink: 0;
`;

interface SharedLegendProps {
  items: Array<{ label: string; color: string }>;
  position: 'top' | 'bottom';
}

export default function SharedLegend({ items, position }: SharedLegendProps) {
  if (!items || items.length <= 1) return null;

  return (
    <LegendWrapper $position={position}>
      {items.map(item => (
        <LegendItem key={item.label}>
          <ColorDot $color={item.color} />
          <span>{item.label}</span>
        </LegendItem>
      ))}
    </LegendWrapper>
  );
}
