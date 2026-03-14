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
import { useState, ReactNode } from 'react';
import {
  RawAntdSelect as AntdSelect,
  type RawAntdSelectProps as AntdSelectProps,
} from '@superset-ui/core/components';

export const { Option }: any = AntdSelect;
const NULL_OPTION_VALUE = '__superset_null_option__';

export type SelectOption<VT = string> = [VT, ReactNode];

export type SelectProps<VT> = Omit<AntdSelectProps<VT>, 'options'> & {
  creatable?: boolean;
  minWidth?: string | number;
  options?: SelectOption<VT>[];
};

/**
 * AntD select with creatable options.
 */
export default function Select<VT extends string | number>({
  creatable,
  onSearch,
  popupMatchSelectWidth = false,
  minWidth = '100%',
  showSearch: showSearch_ = true,
  onChange,
  options,
  children,
  value,
  ...props
}: SelectProps<VT>) {
  const [searchValue, setSearchValue] = useState<string>();
  const hasNullOption = options?.some(([val]) => val === null) ?? false;
  const normalizeOptionValue = (optionValue: VT | null | undefined) =>
    optionValue === null ? NULL_OPTION_VALUE : optionValue;
  const normalizeValue = (selectedValue: unknown) => {
    if (Array.isArray(selectedValue)) {
      return selectedValue.map(item => normalizeOptionValue(item as VT | null));
    }
    if (selectedValue === null && !hasNullOption) {
      return selectedValue;
    }
    return normalizeOptionValue(selectedValue as VT | null | undefined);
  };
  const denormalizeValue = (selectedValue: unknown) => {
    if (selectedValue === NULL_OPTION_VALUE) {
      return null;
    }
    if (Array.isArray(selectedValue)) {
      return selectedValue.map(item =>
        item === NULL_OPTION_VALUE ? null : item,
      );
    }
    return selectedValue;
  };
  // force show search if creatable
  const showSearch = showSearch_ || creatable;
  const handleSearch = showSearch
    ? (input: string) => {
        if (creatable) {
          setSearchValue(input);
        }
        if (onSearch) {
          onSearch(input);
        }
      }
    : undefined;

  const optionsHasSearchValue = options?.some(
    ([val]) => normalizeOptionValue(val) === searchValue,
  );
  const optionsHasValue = !Array.isArray(value)
    ? options?.some(
        ([val]) => normalizeOptionValue(val) === normalizeValue(value),
      )
    : false;
  const normalizedValue = normalizeValue(value);
  const normalizedSelectValue =
    normalizedValue as unknown as AntdSelectProps<VT>['value'];

  const handleChange: SelectProps<VT>['onChange'] = showSearch
    ? (val, opt) => {
        // reset input value once selected
        setSearchValue('');
        if (onChange) {
          onChange(denormalizeValue(val) as VT, opt);
        }
      }
    : ((val, opt) => onChange?.(denormalizeValue(val) as VT, opt));

  return (
    <AntdSelect<VT>
      popupMatchSelectWidth={popupMatchSelectWidth}
      showSearch={showSearch}
      onSearch={handleSearch}
      onChange={handleChange}
      value={normalizedSelectValue}
      {...props}
      css={{
        minWidth,
      }}
    >
      {options?.map(([val, label]) => {
        const normalizedOptionValue = normalizeOptionValue(val);
        return (
          <Option
            key={String(normalizedOptionValue)}
            value={normalizedOptionValue}
          >
            {label}
          </Option>
        );
      })}
      {children}
      {value != null && !optionsHasValue && (
        <Option key={String(normalizedValue)} value={normalizedValue}>
          {value}
        </Option>
      )}
      {searchValue && !optionsHasSearchValue && (
        <Option key={searchValue} value={searchValue}>
          {/* Unfortunately AntD select does not support displaying different
          label for option vs select value, so we can't use
          `t('Create "%s"', searchValue)` here */}
          {searchValue}
        </Option>
      )}
    </AntdSelect>
  );
}

Select.Option = Option;
