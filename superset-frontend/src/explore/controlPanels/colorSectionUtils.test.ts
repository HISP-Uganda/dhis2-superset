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
import {
  mergeColorRowsIntoSections,
  sectionsHaveNamedControl,
} from './colorSectionUtils';

describe('colorSectionUtils', () => {
  test('merges new rows into an existing color section and renames it', () => {
    const sections = [
      {
        label: 'Color scheme',
        controlSetRows: [['color_scheme']],
      },
      {
        label: 'Misc',
        controlSetRows: [['show_legend']],
      },
    ] as any;

    const result = mergeColorRowsIntoSections(
      sections,
      [
        [{ name: 'color_mode', config: { label: 'Color mode' } }],
        [{ name: 'chart_background_color', config: { label: 'Background color' } }],
      ],
      'Color schemes',
    );

    expect(result[0].label).toBe('Color schemes');
    expect(result[0].controlSetRows).toHaveLength(3);
    expect(sectionsHaveNamedControl(result, 'color_mode')).toBe(true);
    expect(sectionsHaveNamedControl(result, 'chart_background_color')).toBe(
      true,
    );
  });

  test('does not duplicate rows for controls already present', () => {
    const sections = [
      {
        label: 'Color scheme',
        controlSetRows: [
          ['color_scheme'],
          [{ name: 'chart_background_color', config: { label: 'Background color' } }],
        ],
      },
    ] as any;

    const result = mergeColorRowsIntoSections(
      sections,
      [
        [{ name: 'chart_background_color', config: { label: 'Background color' } }],
      ],
      'Color schemes',
    );

    expect(result[0].controlSetRows).toHaveLength(2);
  });

  test('creates a new section when no color section exists', () => {
    const sections = [
      {
        label: 'General',
        controlSetRows: [['show_legend']],
      },
    ] as any;

    const result = mergeColorRowsIntoSections(
      sections,
      [[{ name: 'color_mode', config: { label: 'Color mode' } }]],
      'Color schemes',
    );

    expect(result).toHaveLength(2);
    expect(result[1].label).toBe('Color schemes');
    expect(sectionsHaveNamedControl(result, 'color_mode')).toBe(true);
  });
});
