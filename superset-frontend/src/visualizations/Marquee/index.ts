/*
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

import { t, ChartMetadata, ChartPlugin, Behavior } from '@superset-ui/core';
import buildQuery from './buildQuery';
import controlPanel from './controlPanel';
import transformProps from './transformProps';
import MarqueeViz from './MarqueeViz';
import thumbnail from './images/thumbnailUrl';

const metadata = new ChartMetadata({
  name: t('Marquee KPI'),
  description: t(
    'Scrolling marquee of KPI cards. Display multiple metrics as professional animated ticker — supports horizontal and vertical layouts, flexible placement, and rich styling options.',
  ),
  category: t('KPI'),
  tags: [
    t('KPI'),
    t('Marquee'),
    t('Ticker'),
    t('Scrolling'),
    t('Dashboard'),
    t('Summary'),
    t('Multi-metric'),
  ],
  thumbnail,
  behaviors: [Behavior.InteractiveChart],
});

export default class MarqueeChartPlugin extends ChartPlugin {
  constructor() {
    super({
      buildQuery,
      controlPanel,
      // @ts-ignore - React 19 compatibility with FC return type
      loadChart: () => Promise.resolve(MarqueeViz),
      metadata,
      transformProps,
    });
  }
}
