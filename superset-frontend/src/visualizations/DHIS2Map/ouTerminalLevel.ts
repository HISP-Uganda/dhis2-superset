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

export const hasOuValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  return String(value).trim().length > 0;
};

export const getOrderedOuHierarchyColumns = (
  columnNames: string[],
): string[] =>
  [...columnNames]
    .map(name => {
      const match = name.match(/^ou_level_(\d+)$/i);
      return match ? { name, level: Number(match[1]) } : null;
    })
    .filter((item): item is { name: string; level: number } => item !== null)
    .sort((left, right) => left.level - right.level)
    .map(item => item.name);

export const isTerminalAtSelectedLevel = (
  row: Record<string, unknown>,
  hierarchyColumns: string[],
  selectedColumn: string,
): boolean => {
  const selectedIndex = hierarchyColumns.indexOf(selectedColumn);
  if (selectedIndex < 0) {
    return false;
  }
  if (!hasOuValue(row[selectedColumn])) {
    return false;
  }
  return hierarchyColumns
    .slice(selectedIndex + 1)
    .every(columnName => !hasOuValue(row[columnName]));
};

export const filterRowsAtTerminalOuLevel = (
  rows: Record<string, unknown>[],
  hierarchyColumns: string[],
  selectedColumn: string,
): Record<string, unknown>[] =>
  rows.filter(row =>
    isTerminalAtSelectedLevel(row, hierarchyColumns, selectedColumn),
  );
