import { t, ChartMetadata, ChartPlugin, Behavior } from '@superset-ui/core';
import buildQuery from './plugin/buildQuery';
import controlPanel from './plugin/controlPanel';
import transformProps from './plugin/transformProps';
import thumbnail from './images/thumbnail';

const metadata = new ChartMetadata({
  name: t('Vital Maps'),
  description: t(
    'High-visibility thematic and geographic analysis maps for points, boundaries, heatmaps, bubbles, and public-health spatial reporting.',
  ),
  thumbnail,
  category: t('Map'),
  tags: [
    t('Map'),
    t('Geo'),
    t('Choropleth'),
    t('MapLibre'),
    t('Geographic'),
    t('Spatial'),
    t('Health'),
    t('Featured'),
  ],
  behaviors: [Behavior.InteractiveChart],
});

export default class VitalMapsChartPlugin extends ChartPlugin {
  constructor() {
    super({
      buildQuery,
      controlPanel,
      loadChart: () => import('./components/VitalMapsChart'),
      metadata,
      transformProps,
    });
  }
}
