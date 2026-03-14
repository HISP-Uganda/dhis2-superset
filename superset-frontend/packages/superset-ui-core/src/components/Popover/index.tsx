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
import { forwardRef } from 'react';
import { Popover as AntdPopover } from 'antd';
import { PopoverProps as AntdPopoverProps } from 'antd/es/popover';

type LegacyDestroyOnHide = boolean | { keepParent?: boolean };

export interface PopoverProps
  extends Omit<AntdPopoverProps, 'destroyTooltipOnHide'> {
  forceRender?: boolean;
  destroyTooltipOnHide?: LegacyDestroyOnHide;
}

export const Popover = forwardRef<unknown, PopoverProps>(
  ({ destroyOnHidden, destroyTooltipOnHide, ...props }, _ref) => {
    const resolvedDestroyOnHidden =
      typeof destroyOnHidden === 'boolean'
        ? destroyOnHidden
        : typeof destroyTooltipOnHide === 'boolean'
          ? destroyTooltipOnHide
          : destroyTooltipOnHide
            ? true
            : undefined;

    return (
      <AntdPopover
        destroyOnHidden={resolvedDestroyOnHidden}
        {...props}
      />
    );
  },
);

Popover.displayName = 'Popover';
