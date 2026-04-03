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
import { memo, useMemo } from 'react';
import { css, styled, useTheme } from '@superset-ui/core';
import { GRID_COLUMN_COUNT, GRID_GUTTER_SIZE } from '../util/constants';

interface GridOverlayProps {
  width: number;
  visible: boolean;
}

const Wrapper = styled.div<{ $visible: boolean }>`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity 0.2s ease;
`;

const ColumnGuide = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
`;

function GridOverlay({ width, visible }: GridOverlayProps) {
  const theme = useTheme();

  const columns = useMemo(() => {
    const columnPlusGutter = (width + GRID_GUTTER_SIZE) / GRID_COLUMN_COUNT;
    const columnWidth = columnPlusGutter - GRID_GUTTER_SIZE;

    return Array.from({ length: GRID_COLUMN_COUNT }, (_, i) => ({
      left: i * columnPlusGutter,
      width: columnWidth,
    }));
  }, [width]);

  if (!visible) return null;

  return (
    <Wrapper $visible={visible}>
      {columns.map((col, i) => (
        <ColumnGuide
          key={i}
          css={css`
            left: ${col.left}px;
            width: ${col.width}px;
            background: ${theme.colorPrimary}08;
            border-left: 1px dashed ${theme.colorPrimary}20;
            border-right: 1px dashed ${theme.colorPrimary}20;
          `}
        />
      ))}
    </Wrapper>
  );
}

export default memo(GridOverlay);
