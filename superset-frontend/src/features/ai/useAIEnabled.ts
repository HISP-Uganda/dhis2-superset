import { useEffect, useState } from 'react';
import { FeatureFlag, isFeatureEnabled } from '@superset-ui/core';
import { fetchAICapabilities } from './api';
import { AIInsightMode } from './types';

/**
 * Module-level cache: one capabilities check shared by every component.
 * Resets on full page reload — same lifecycle as feature flags.
 */
let _cache: Promise<boolean> | null = null;

function checkAIEnabled(): Promise<boolean> {
  if (!isFeatureEnabled(FeatureFlag.AiInsights)) {
    return Promise.resolve(false);
  }
  if (!_cache) {
    _cache = fetchAICapabilities('chart')
      .then(caps => caps.enabled !== false && caps.providers.length > 0)
      .catch(() => false);
  }
  return _cache;
}

/** Reset the cache (e.g. after saving settings on the management page). */
export function resetAIEnabledCache(): void {
  _cache = null;
}

/**
 * Hook that returns whether the AI service is enabled and has at least
 * one available provider.  Uses a module-level cache so only one HTTP
 * request is issued regardless of how many components mount.
 */
export function useAIEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkAIEnabled().then(result => {
      if (!cancelled) setEnabled(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
