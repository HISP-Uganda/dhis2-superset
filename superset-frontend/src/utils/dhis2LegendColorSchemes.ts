/**
 * DHIS2 Legend Set → Superset Color Scheme bridge.
 *
 * Converts staged DHIS2 legend sets into CategoricalScheme instances and
 * registers them with the global CategoricalSchemeRegistry so they appear in
 * the color-scheme picker for ALL chart types (bar, line, pie, …) and not
 * only the DHIS2Map.
 *
 * Registration is idempotent — re-registering the same id overwrites with the
 * latest data, which is fine because the registry is a simple Map.
 */

import {
  CategoricalScheme,
  ColorSchemeGroup,
  getCategoricalSchemeRegistry,
} from '@superset-ui/core';

/** Prefix used for all auto-registered DHIS2 legend scheme ids. */
const DHIS2_SCHEME_PREFIX = 'dhis2_legendset_';

/** localStorage key prefix for cached legend sets per database. */
const LS_CACHE_PREFIX = 'dhis2_legend_sets_db';

/** Cache TTL: 10 minutes */
const CACHE_TTL_MS = 10 * 60 * 1000;

// Track which database IDs have already been registered in this session
// so we only re-register if the localStorage cache is fresher.
const _lastRegisteredAt: Record<number, number> = {};

// Fingerprint of already-registered schemes: id → colors joined string.
// Avoids triggering the Registry OverwritePolicy.Warn console noise when
// the same legend set data is registered more than once (cache hit + network
// fetch both call registerLegendSetsAsColorSchemes with identical data).
const _registeredFingerprints: Record<string, string> = {};

interface LegendItem {
  startValue?: number;
  endValue?: number;
  color?: string;
}

interface LegendDefinition {
  items?: LegendItem[];
  setName?: string;
}

export interface StagedLegendSet {
  id?: string;
  displayName?: string;
  name?: string;
  legendDefinition?: LegendDefinition;
}

/**
 * Extract an ordered list of hex colours from a DHIS2 legend set.
 * Items are sorted ascending by startValue so colours map low→high.
 */
export function legendSetToColors(legendSet: StagedLegendSet): string[] {
  const items = legendSet.legendDefinition?.items;
  if (!Array.isArray(items) || items.length === 0) return [];

  return items
    .slice()
    .sort((a, b) => (a.startValue ?? 0) - (b.startValue ?? 0))
    .map(item => item.color ?? '')
    .filter(Boolean);
}

/**
 * Convert a DHIS2 legend set to a CategoricalScheme id.
 */
export function legendSetToSchemeId(legendSet: StagedLegendSet): string {
  const raw = legendSet.id || legendSet.displayName || legendSet.name || '';
  // Sanitise: keep alphanumeric + hyphens, replace spaces with underscores
  return `${DHIS2_SCHEME_PREFIX}${raw.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/**
 * Register an array of DHIS2 legend sets as CategoricalSchemes.
 * Safe to call multiple times — overwrites stale registrations.
 */
export function registerLegendSetsAsColorSchemes(
  legendSets: StagedLegendSet[],
): void {
  const registry = getCategoricalSchemeRegistry();

  legendSets.forEach(legendSet => {
    const colors = legendSetToColors(legendSet);
    if (colors.length === 0) return;

    const id = legendSetToSchemeId(legendSet);
    if (!id || id === DHIS2_SCHEME_PREFIX) return;

    // Skip if we already registered the exact same colors for this id.
    // This prevents the CategoricalSchemeRegistry OverwritePolicy.Warn noise
    // that fires when both the cache-hit path and the network-fetch path call
    // this function with identical data (new object reference == "overwrite").
    const fingerprint = colors.join(',');
    if (_registeredFingerprints[id] === fingerprint) return;
    _registeredFingerprints[id] = fingerprint;

    const label = `DHIS2: ${
      legendSet.legendDefinition?.setName ||
      legendSet.displayName ||
      legendSet.name ||
      legendSet.id ||
      id
    }`;

    registry.registerValue(
      id,
      new CategoricalScheme({
        id,
        label,
        colors,
        group: ColorSchemeGroup.Custom,
      }),
    );
  });
}

/**
 * Read cached legend sets from localStorage (set by the DHIS2Map
 * controlPanel's async fetch).
 */
export function readCachedLegendSets(
  databaseId: number | string | null | undefined,
): StagedLegendSet[] {
  if (!databaseId) return [];
  try {
    const raw = window.localStorage.getItem(`${LS_CACHE_PREFIX}${Number(databaseId)}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      data?: StagedLegendSet[];
      timestamp?: number;
    };
    if (!Array.isArray(parsed.data)) return [];
    return parsed.data;
  } catch {
    return [];
  }
}

/**
 * Fetch DHIS2 legend sets for a database, cache them, and register as color
 * schemes.  Skips if recently registered (< CACHE_TTL_MS).
 */
export async function syncDHIS2LegendSchemesForDatabase(
  databaseId: number | string,
  options: {
    isPublicView?: boolean;
    chartId?: number;
    dashboardId?: number;
  } = {},
): Promise<void> {
  const dbId = Number(databaseId);
  const lastAt = _lastRegisteredAt[dbId] ?? 0;
  const now = Date.now();

  // Try from localStorage cache first
  const cached = readCachedLegendSets(dbId);
  if (cached.length > 0) {
    registerLegendSetsAsColorSchemes(cached);
  }

  // Skip network fetch if recently synced
  if (now - lastAt < CACHE_TTL_MS) return;
  _lastRegisteredAt[dbId] = now;

  try {
    const { SupersetClient } = await import('@superset-ui/core');
    const { isPublicView, chartId, dashboardId } = options;

    // Include chart/dashboard context in the primary endpoint so the
    // backend can resolve public-dashboard access for anonymous users
    // without needing a separate fallback request.
    const chartParams = [
      chartId != null ? `slice_id=${chartId}` : '',
      dashboardId != null ? `dashboard_id=${dashboardId}` : '',
    ]
      .filter(Boolean)
      .join('&');
    const primaryEndpoint = `/api/v1/database/${dbId}/dhis2_metadata/?type=legendSets&staged=true${chartParams ? `&${chartParams}` : ''}`;
    const publicEndpoint =
      chartId != null
        ? `/api/v1/database/${dbId}/dhis2_metadata_public/?type=legendSets&staged=true&slice_id=${chartId}${
            dashboardId ? `&dashboard_id=${dashboardId}` : ''
          }`
        : null;

    let response;
    try {
      response = await SupersetClient.get({
        endpoint: primaryEndpoint,
        ignoreUnauthorized: true,
      });
    } catch (error) {
      const status = Number((error as any)?.status);
      if (
        !isPublicView ||
        !publicEndpoint ||
        ![400, 401, 403, 404].includes(status)
      ) {
        throw error;
      }
      response = await SupersetClient.get({
        endpoint: publicEndpoint,
      });
    }

    const legendSets = response.json?.result;
    const responseStatus = response.json?.status || 'success';
    if (!Array.isArray(legendSets)) return;

    // Only persist to localStorage if not pending.
    // Overwriting with status='pending' and data=[] causes the UI to show 
    // "No legend sets found" even if valid data was previously cached.
    if (responseStatus !== 'pending') {
      window.localStorage.setItem(
        `${LS_CACHE_PREFIX}${dbId}`,
        JSON.stringify({
          data: legendSets,
          timestamp: now,
          status: responseStatus,
        }),
      );
      registerLegendSetsAsColorSchemes(legendSets);
    }
  } catch {
    _lastRegisteredAt[dbId] = 0; // Allow retry on error
    // Non-fatal — fall back to cached or no DHIS2 legend sets
  }
}

/**
 * Remove all previously registered DHIS2 legend set color schemes.
 * Useful when switching databases.
 */
export function clearDHIS2LegendSchemes(): void {
  // getCategoricalSchemeRegistry does not expose a delete API.
  // Re-registration with newer data is sufficient for session use.
}
