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

import { useEffect, useRef, useState } from 'react';
import { SupersetClient } from '@superset-ui/core';
import { PortalPayload } from './types';

type UsePublicPortalResult = {
  data: PortalPayload | null;
  error: string | null;
  loading: boolean;
  reloadPortal: (pageSlug?: string | null) => Promise<PortalPayload | null>;
};

const buildEndpoint = (pageSlug?: string | null) =>
  pageSlug
    ? `/api/v1/public_page/portal?page=${encodeURIComponent(pageSlug)}`
    : '/api/v1/public_page/portal';

export default function usePublicPortal(
  pageSlug?: string | null,
): UsePublicPortalResult {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latestPageSlug = useRef<string | null | undefined>(pageSlug);

  latestPageSlug.current = pageSlug;

  async function reloadPortal(nextPageSlug = latestPageSlug.current) {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await SupersetClient.get({
        endpoint: buildEndpoint(nextPageSlug),
      });
      const payload = response.json?.result as PortalPayload;
      setData(payload);
      return payload;
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Failed to load the public portal.';
      setError(message);
      setData(null);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    const fetchPortal = async () => {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const response = await SupersetClient.get({
          endpoint: buildEndpoint(pageSlug),
        });
        if (!isMounted) {
          return;
        }
        setData(response.json?.result as PortalPayload);
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : 'Failed to load the public portal.';
        setError(message);
        setData(null);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchPortal();

    return () => {
      isMounted = false;
    };
  }, [pageSlug]);

  return {
    data,
    error,
    loading,
    reloadPortal,
  };
}
