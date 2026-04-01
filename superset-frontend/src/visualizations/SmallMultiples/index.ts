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
import { Behavior, t, ChartMetadata, ChartPlugin } from '@superset-ui/core';
import transformProps from './transformProps';
import controlPanel from './controlPanel';
import thumbnail from './images/thumbnailUrl';

export default class SmallMultiplesChartPlugin extends ChartPlugin {
  constructor() {
    super({
      metadata: new ChartMetadata({
        name: t('Small Multiples (Trellis)'),
        description: t(
          'Compare trends across many categories with a grid of synchronized ' +
            'mini-charts. Supports line, bar, area, pie, donut, scatter, ' +
            'heatmap, Big Number (KPI), and gauge chart types. ' +
            'DHIS2-aware: auto-detects OU hierarchy levels and period columns ' +
            'for one-click "Compare by Region/District/Period" splitting. ' +
            'Multi-metric support with shared legend and synchronized tooltips.',
        ),
        thumbnail,
        tags: [
          t('Health'),
          t('Comparison'),
          t('Trellis'),
          t('Multi-series'),
          t('DHIS2'),
          t('KPI'),
          t('Gauge'),
        ],
        behaviors: [Behavior.InteractiveChart],
      }),
      controlPanel,
      transformProps,
      loadChart: () => import('./SmallMultiplesViz'),
    });
  }
}
