/**
 * Keep the app-local path stable while the reusable implementation lives in
 * `superset-ui-core` for plugin packages that cannot import app-only files.
 */
export {
  buildDHIS2LegendPieces,
  formatDHIS2LegendItemLabel,
  getDHIS2LegendColorForValue,
  getDHIS2LegendIndexForValue,
  getDHIS2LegendRange,
  getNormalizedDHIS2LegendItems,
  hasDHIS2LegendItems,
  parseDHIS2LegendDefinition,
  resolveDHIS2LegendDefinition,
} from '@superset-ui/core';

export type {
  DHIS2LegendDefinition,
  DHIS2LegendItem,
} from '@superset-ui/core';
