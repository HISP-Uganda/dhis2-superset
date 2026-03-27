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
import { ReactNode } from 'react';
import { OptionValueType } from 'src/explore/components/controls/DndColumnSelectControl/types';
import { ControlComponentProps } from 'src/explore/components/Control';
import { DHIS2LegendDefinition } from './colorBreakpointUtils';

export interface ColorType {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Operator applied to the lower bound.  Defaults to '>=' (inclusive). */
export type MinOperator = '>=' | '>';
/** Operator applied to the upper bound.  Defaults to '<' (exclusive). */
export type MaxOperator = '<' | '<=';

export interface ColorBreakpointType {
  id?: number;
  color?: ColorType;
  /** Lower bound value.  Undefined means no lower bound (−∞). */
  minValue?: number;
  /** How the lower bound is compared.  Defaults to '>=' (inclusive). */
  minOperator?: MinOperator;
  /** Upper bound value.  Undefined means no upper bound (+∞). */
  maxValue?: number;
  /** How the upper bound is compared.  Defaults to '<' (exclusive). */
  maxOperator?: MaxOperator;
}

export interface ErrorMapType {
  color: string[];
  minValue: string[];
  maxValue: string[];
}

export interface ColorBreakpointsControlProps
  extends ControlComponentProps<OptionValueType[]> {
  breakpoints: ColorBreakpointType[];
  /**
   * DHIS2 legend definition from ``column.extra.dhis2_legend``.  When
   * provided, an "Import from DHIS2 legend" button is rendered alongside
   * the auto-generate controls.
   */
  dhis2LegendDefinition?: DHIS2LegendDefinition | null;
  /**
   * Superset database ID for the current datasource.  When provided the
   * control can fetch available DHIS2 legend sets from the metadata API and
   * present them as a picker.
   */
  databaseId?: number | string;
}

export interface ColorBreakpointsPopoverTriggerProps {
  description?: string;
  hovered?: boolean;
  value?: ColorBreakpointType;
  children?: ReactNode;
  saveColorBreakpoint: (colorBreakpoint: ColorBreakpointType) => void;
  isControlled?: boolean;
  visible?: boolean;
  toggleVisibility?: (visibility: boolean) => void;
  colorBreakpoints: ColorBreakpointType[];
}

export interface ColorBreakpointsPopoverControlProps {
  description?: string;
  hovered?: boolean;
  value?: ColorBreakpointType;
  onSave?: (colorBreakpoint: ColorBreakpointType) => void;
  onClose?: () => void;
  colorBreakpoints: ColorBreakpointType[];
}

export interface ColorBreakpointOptionProps {
  breakpoint: ColorBreakpointType;
  colorBreakpoints: ColorBreakpointType[];
  index: number;
  saveColorBreakpoint: (colorBreakpoint: ColorBreakpointType) => void;
  onClose: (index: number) => void;
  onShift: (hoverIndex: number, dragIndex: number) => void;
}
