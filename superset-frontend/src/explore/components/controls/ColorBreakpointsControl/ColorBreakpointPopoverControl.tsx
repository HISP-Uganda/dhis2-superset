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
import { useState, useMemo } from 'react';
import { Button, Row, Col, InputNumber, Select } from '@superset-ui/core/components';
import { styled, t } from '@superset-ui/core';
import ControlHeader from '../../ControlHeader';
import ColorPickerControl from '../ColorPickerControl';
import {
  ColorBreakpointsPopoverControlProps,
  ColorType,
  ColorBreakpointType,
  ErrorMapType,
  MinOperator,
  MaxOperator,
} from './types';
import { matchesBreakpoint } from './colorBreakpointUtils';

const ColorBreakpointActionsContainer = styled.div`
  margin-top: ${({ theme }) => theme.sizeUnit * 8}px;
  display: flex;
  justify-content: flex-end;
`;

const StyledRow = styled(Row)`
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const ValuesRow = styled(Row)`
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
`;

const OperatorSelectWrapper = styled.div`
  width: 72px;
  flex-shrink: 0;
`;

const FullWidthInputNumber = styled(InputNumber)`
  width: 100%;
`;

const BoundGroup = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeUnit}px;
  flex: 1;
  min-width: 140px;
`;

const Divider = styled.div`
  padding: 6px 4px;
  color: ${({ theme }) => theme.colorTextSecondary};
`;

const MIN_OPERATORS: { value: MinOperator; label: string }[] = [
  { value: '>=', label: '≥' },
  { value: '>', label: '>' },
];

const MAX_OPERATORS: { value: MaxOperator; label: string }[] = [
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
];

const determineErrorMap = (
  colorBreakpoint: ColorBreakpointType,
  colorBreakpoints: ColorBreakpointType[],
): ErrorMapType => {
  const errorMap: ErrorMapType = {
    minValue: [],
    maxValue: [],
    color: [],
  };

  const hasMin = colorBreakpoint.minValue !== undefined && colorBreakpoint.minValue !== null;
  const hasMax = colorBreakpoint.maxValue !== undefined && colorBreakpoint.maxValue !== null;

  if (!hasMin && !hasMax) {
    errorMap.minValue.push(t('At least one bound (min or max) is required.'));
    return errorMap;
  }

  if (hasMin && hasMax) {
    const minOp = colorBreakpoint.minOperator ?? '>=';
    const maxOp = colorBreakpoint.maxOperator ?? '<';
    const minV = Number(colorBreakpoint.minValue);
    const maxV = Number(colorBreakpoint.maxValue);
    // Detect an empty interval: when min === max and operators exclude that point
    const emptyInterval =
      minV > maxV ||
      (minV === maxV && (minOp === '>' || maxOp === '<'));
    if (emptyInterval) {
      errorMap.minValue.push(t('Min value must be less than max value for this interval to contain any values.'));
    }
  }

  if (errorMap.minValue.length > 0) return errorMap;

  // Overlap check: two breakpoints overlap if there exists a value v satisfying both.
  // We approximate this with a point-in-range test on the endpoints of the other range.
  const otherBreakpoints = colorBreakpoints.filter(
    bp => bp.id !== colorBreakpoint.id,
  );
  const overlaps = otherBreakpoints.some(other => {
    // Test both boundary points of the new breakpoint against the existing one
    // and vice-versa.  If any point is matched by both, they overlap.
    const testPoints: number[] = [];
    if (colorBreakpoint.minValue !== undefined) testPoints.push(Number(colorBreakpoint.minValue));
    if (colorBreakpoint.maxValue !== undefined) testPoints.push(Number(colorBreakpoint.maxValue));
    // midpoint when both bounds exist
    if (colorBreakpoint.minValue !== undefined && colorBreakpoint.maxValue !== undefined) {
      testPoints.push((Number(colorBreakpoint.minValue) + Number(colorBreakpoint.maxValue)) / 2);
    }
    return testPoints.some(
      v => matchesBreakpoint(v, colorBreakpoint) && matchesBreakpoint(v, other),
    );
  });

  if (overlaps) {
    const msg = t('The range overlaps an existing breakpoint.');
    errorMap.minValue.push(msg);
    errorMap.maxValue.push(msg);
  }

  const validColor =
    typeof colorBreakpoint.color === 'object' &&
    colorBreakpoint.color !== null &&
    'r' in colorBreakpoint.color &&
    typeof (colorBreakpoint.color as any).r === 'number';

  if (!validColor) {
    errorMap.color.push(t('Invalid color'));
  }

  return errorMap;
};

const DEFAULT_COLOR_BREAKPOINT: ColorBreakpointType = {
  id: undefined,
  minValue: undefined,
  minOperator: '>=',
  maxValue: undefined,
  maxOperator: '<',
  color: { r: 0, g: 0, b: 0, a: 100 },
};

const ColorBreakpointsPopoverControl = ({
  value: initialValue,
  onSave,
  onClose,
  colorBreakpoints,
}: ColorBreakpointsPopoverControlProps) => {
  const [colorBreakpoint, setColorBreakpoint] = useState<ColorBreakpointType>(
    initialValue
      ? { minOperator: '>=', maxOperator: '<', ...initialValue }
      : DEFAULT_COLOR_BREAKPOINT,
  );

  const validationErrors = useMemo(
    () => determineErrorMap(colorBreakpoint, colorBreakpoints),
    [colorBreakpoint, colorBreakpoints],
  );

  const containsErrors = Object.values(validationErrors).some(e => e.length > 0);

  const update = (patch: Partial<ColorBreakpointType>) =>
    setColorBreakpoint(prev => ({ ...prev, ...patch }));

  const handleSave = () => {
    if (!containsErrors && onSave) {
      onSave({
        color: colorBreakpoint.color,
        minValue: colorBreakpoint.minValue !== undefined ? Number(colorBreakpoint.minValue) : undefined,
        minOperator: colorBreakpoint.minOperator ?? '>=',
        maxValue: colorBreakpoint.maxValue !== undefined ? Number(colorBreakpoint.maxValue) : undefined,
        maxOperator: colorBreakpoint.maxOperator ?? '<',
      });
      onClose?.();
    }
  };

  return (
    <div role="dialog">
      <StyledRow>
        <Col flex="1">
          <ControlHeader
            name="color"
            label={t('Color for breakpoint')}
            validationErrors={validationErrors.color}
            hovered
          />
          <ColorPickerControl
            value={colorBreakpoint.color}
            onChange={(rgb: ColorType) => update({ color: { ...rgb } })}
            data-test="color-picker"
          />
        </Col>
      </StyledRow>

      <ValuesRow style={{ marginTop: 12 }}>
        {/* ── Lower bound ── */}
        <Col flex="1">
          <ControlHeader
            name="min-value"
            label={t('Lower bound')}
            validationErrors={validationErrors.minValue}
            hovered
          />
          <BoundGroup>
            <OperatorSelectWrapper>
              <Select
                options={MIN_OPERATORS}
                value={colorBreakpoint.minOperator ?? '>='}
                onChange={(v: MinOperator) => update({ minOperator: v })}
                ariaLabel={t('Min operator')}
                data-test="min-operator"
              />
            </OperatorSelectWrapper>
            <FullWidthInputNumber
              placeholder={t('none (−∞)')}
              value={colorBreakpoint.minValue}
              onChange={(v: number) => update({ minValue: v ?? undefined })}
              data-test="min-value-input"
            />
          </BoundGroup>
        </Col>

        <Divider>–</Divider>

        {/* ── Upper bound ── */}
        <Col flex="1">
          <ControlHeader
            name="max-value"
            label={t('Upper bound')}
            validationErrors={validationErrors.maxValue}
            hovered
          />
          <BoundGroup>
            <OperatorSelectWrapper>
              <Select
                options={MAX_OPERATORS}
                value={colorBreakpoint.maxOperator ?? '<'}
                onChange={(v: MaxOperator) => update({ maxOperator: v })}
                ariaLabel={t('Max operator')}
                data-test="max-operator"
              />
            </OperatorSelectWrapper>
            <FullWidthInputNumber
              placeholder={t('none (+∞)')}
              value={colorBreakpoint.maxValue}
              onChange={(v: number) => update({ maxValue: v ?? undefined })}
              data-test="max-value-input"
            />
          </BoundGroup>
        </Col>
      </ValuesRow>

      <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
        {t('Tip: use ≥25 – <50, ≥50 – <75, ≥75 for gapless contiguous ranges.')}
      </div>

      <ColorBreakpointActionsContainer>
        <Button
          buttonSize="small"
          buttonStyle="secondary"
          onClick={onClose}
          aria-label={t('Close color breakpoint editor')}
          data-test="close-button"
        >
          {t('Close')}
        </Button>
        <Button
          disabled={containsErrors}
          buttonStyle="primary"
          buttonSize="small"
          onClick={handleSave}
          aria-label={t('Save color breakpoint values')}
          data-test="save-button"
        >
          {t('Save')}
        </Button>
      </ColorBreakpointActionsContainer>
    </div>
  );
};

export default ColorBreakpointsPopoverControl;
