import { SupersetClient, t } from '@superset-ui/core';
import { useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import rison from 'rison';

import type { DHIS2DatabaseOption } from './types';
import { getDatabaseIdFromSearch } from './utils';

interface UseDHIS2DatabasesResult {
  databases: DHIS2DatabaseOption[];
  loading: boolean;
  selectedDatabaseId?: number;
  setSelectedDatabaseId: (databaseId?: number) => void;
  refreshDatabases: () => Promise<void>;
}

export default function useDHIS2Databases(
  addDangerToast: (message: string) => void,
): UseDHIS2DatabasesResult {
  const history = useHistory();
  const location = useLocation();
  const locationSearchRef = useRef(location.search);
  const [databases, setDatabases] = useState<DHIS2DatabaseOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDatabaseId, setSelectedDatabaseIdState] = useState<
    number | undefined
  >(() => getDatabaseIdFromSearch(location.search));

  // Keep ref current so Effect 4 can read it without depending on it
  useEffect(() => {
    locationSearchRef.current = location.search;
  });

  const refreshDatabases = async () => {
    setLoading(true);
    try {
      const query = rison.encode({ page: 0, page_size: 1000 });
      const response = await SupersetClient.get({
        endpoint: `/api/v1/database/?q=${query}`,
      });
      const result = ((response.json.result || []) as DHIS2DatabaseOption[]).filter(
        database => database.backend === 'dhis2',
      );
      setDatabases(result);
    } catch (error) {
      addDangerToast(
        (error as { body?: { message?: string }; message?: string })?.body
          ?.message ||
          (error as { message?: string })?.message ||
          t('Failed to load DHIS2 databases'),
      );
      setDatabases([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshDatabases();
  }, []);

  // Sync URL → state (browser back/forward navigation)
  // Always call setState; React bails out if the value hasn't changed.
  useEffect(() => {
    setSelectedDatabaseIdState(getDatabaseIdFromSearch(location.search));
  }, [location.search]);

  useEffect(() => {
    if (!databases.length) {
      return;
    }
    const hasSelectedDatabase = selectedDatabaseId
      ? databases.some(database => database.id === selectedDatabaseId)
      : false;
    if (!hasSelectedDatabase) {
      setSelectedDatabaseIdState(databases[0].id);
    }
  }, [databases, selectedDatabaseId]);

  // Sync state → URL. Uses locationSearchRef (not location.search) to avoid
  // a feedback loop: history.replace() changes location.search which would
  // re-trigger this effect, which would call history.replace() again, etc.
  useEffect(() => {
    const params = new URLSearchParams(locationSearchRef.current);
    if (selectedDatabaseId) {
      params.set('database', String(selectedDatabaseId));
    } else {
      params.delete('database');
    }
    const nextSearch = params.toString() ? `?${params.toString()}` : '';
    if (nextSearch !== locationSearchRef.current) {
      history.replace({
        pathname: location.pathname,
        search: nextSearch,
      });
    }
  }, [history, location.pathname, selectedDatabaseId]);

  return {
    databases,
    loading,
    selectedDatabaseId,
    setSelectedDatabaseId: setSelectedDatabaseIdState,
    refreshDatabases,
  };
}
