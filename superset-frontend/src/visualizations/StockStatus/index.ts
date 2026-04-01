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

export default class StockStatusChartPlugin extends ChartPlugin {
  constructor() {
    super({
      metadata: new ChartMetadata({
        name: t('Stock Status / Pipeline'),
        description: t(
          'Supply chain visibility for health commodities. Auto-calculates Months of Stock ' +
            'with Understock / Optimal / Overstock banding and compact table layout.',
        ),
        thumbnail,
        tags: [
          t('Health'),
          t('Supply Chain'),
          t('Stock'),
          t('Pipeline'),
        ],
        behaviors: [Behavior.InteractiveChart],
      }),
      controlPanel,
      transformProps,
      loadChart: () => import('./StockStatusViz'),
    });
  }
}
