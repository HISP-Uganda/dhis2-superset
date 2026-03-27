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
import { ControlPanelSectionConfig } from '@superset-ui/chart-controls';

type ControlRow = ControlPanelSectionConfig['controlSetRows'][number];
type ControlRowItem = ControlRow[number];

function isNamedControlItem(item: ControlRowItem): item is { name: string } {
  return Boolean(
    item && typeof item === 'object' && 'name' in item && item.name,
  );
}

function getControlNamesFromRow(row: ControlRow): string[] {
  return row.flatMap(item => {
    if (typeof item === 'string') {
      return [item];
    }
    if (isNamedControlItem(item)) {
      return [item.name];
    }
    return [];
  });
}

function getSectionLabel(section: ControlPanelSectionConfig): string {
  return typeof section.label === 'string' ? section.label.toLowerCase() : '';
}

export function sectionHasNamedControl(
  section: ControlPanelSectionConfig,
  controlName: string,
): boolean {
  return section.controlSetRows.some(row =>
    getControlNamesFromRow(row).includes(controlName),
  );
}

export function sectionsHaveNamedControl(
  sections: ControlPanelSectionConfig[],
  controlName: string,
): boolean {
  return sections.some(section => sectionHasNamedControl(section, controlName));
}

function findColorSectionIndex(sections: ControlPanelSectionConfig[]): number {
  return sections.findIndex(section => {
    const label = getSectionLabel(section);
    return (
      sectionHasNamedControl(section, 'color_scheme') ||
      sectionHasNamedControl(section, 'linear_color_scheme') ||
      label === 'color scheme' ||
      label === 'color schemes'
    );
  });
}

export function mergeColorRowsIntoSections(
  sections: ControlPanelSectionConfig[],
  rows: ControlRow[],
  label: string,
): ControlPanelSectionConfig[] {
  if (!rows.length) {
    return sections;
  }

  const colorSectionIndex = findColorSectionIndex(sections);
  if (colorSectionIndex === -1) {
    return [
      ...sections,
      {
        label,
        expanded: false,
        controlSetRows: rows,
      },
    ];
  }

  const colorSection = sections[colorSectionIndex];
  const mergedRows = [...colorSection.controlSetRows];

  rows.forEach(row => {
    const rowControlNames = getControlNamesFromRow(row);
    const hasDuplicate = rowControlNames.some(controlName =>
      sectionHasNamedControl(colorSection, controlName),
    );
    if (!hasDuplicate) {
      mergedRows.push(row);
    }
  });

  return sections.map((section, index) =>
    index === colorSectionIndex
      ? {
          ...section,
          label,
          controlSetRows: mergedRows,
        }
      : section,
  );
}
