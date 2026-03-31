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
  ViolinDistributionFormData,
  ViolinDistributionChartProps,
  ViolinGroup,
} from './types';

/* ── Kernel Density Estimation (Gaussian) ──────────── */

function gaussianKernel(u: number): number {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

function kde(
  values: number[],
  bandwidth: number,
  resolution: number,
): [number, number][] {
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = range / (resolution - 1);
  const points: [number, number][] = [];

  for (let i = 0; i < resolution; i++) {
    const x = min + i * step;
    let density = 0;
    for (const v of values) {
      density += gaussianKernel((x - v) / bandwidth);
    }
    density /= values.length * bandwidth;
    points.push([x, density]);
  }

  return points;
}

/* ── Statistics helpers ────────────────────────────── */

function quantile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    mean: sum / values.length,
  };
}

/* ── Main transform ────────────────────────────────── */

export default function transformProps(
  chartProps: any,
): ViolinDistributionChartProps {
  const { width, height, formData, queriesData } = chartProps;
  const fd = formData as ViolinDistributionFormData;
  const data = queriesData?.[0]?.data || [];

  const groupCol = Array.isArray(fd.group_column)
    ? fd.group_column[0]
    : fd.group_column;
  const valueCol = Array.isArray(fd.value_column)
    ? fd.value_column[0]
    : fd.value_column;
  const bandwidth = fd.bandwidth ?? 1.0;
  const resolution = fd.density_resolution ?? 50;
  const scaleMode = fd.scale_mode ?? 'area';

  // Group values
  const groupMap = new Map<string, number[]>();
  for (const row of data) {
    const group = String(row[groupCol] ?? 'All');
    const value = row[valueCol] as number;
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(value);
  }

  const groups: ViolinGroup[] = [];
  for (const [name, values] of groupMap) {
    if (values.length === 0) continue;
    const stats = computeStats(values);
    const densityPoints = kde(values, bandwidth, resolution);

    // Apply scale mode normalization
    let normalizedDensity = densityPoints;
    if (scaleMode === 'count') {
      // Scale by count so larger groups have larger violins
      normalizedDensity = densityPoints.map(([x, d]) => [x, d * values.length] as [number, number]);
    } else if (scaleMode === 'width') {
      // Normalize so all violins have equal max width
      const maxD = Math.max(...densityPoints.map(([, d]) => d), 1e-10);
      normalizedDensity = densityPoints.map(([x, d]) => [x, d / maxD] as [number, number]);
    }
    // 'area' is the default KDE output (already area-normalized)

    groups.push({
      name,
      values,
      median: stats.median,
      q1: stats.q1,
      q3: stats.q3,
      min: stats.min,
      max: stats.max,
      mean: stats.mean,
      densityPoints: normalizedDensity,
    });
  }

  return {
    width,
    height,
    groups,
    showJitter: fd.show_jitter ?? false,
    showMedian: fd.show_median ?? true,
    showIQR: fd.show_iqr ?? true,
    violinWidth: fd.violin_width ?? 60,
    jitterOpacity: fd.jitter_opacity ?? 0.3,
    jitterSize: fd.jitter_size ?? 3,
    yAxisFormat: fd.y_axis_format || 'SMART_NUMBER',
    orientation: fd.orientation ?? 'vertical',
    scaleMode,
    showBoxOverlay: fd.show_box_overlay ?? false,
    colorByGroup: fd.color_by_group ?? true,
    showLegend: fd.show_legend ?? false,
    showMean: fd.show_mean ?? false,
    showQuartileLabels: fd.show_quartile_labels ?? false,
  };
}
