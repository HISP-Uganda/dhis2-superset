// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { SupersetClient } from '@superset-ui/core';

interface GuestTokenResponse {
  token: string;
}

const tokenCache = new Map<string, string>();

export async function fetchGuestToken(dashboardId: string): Promise<string> {
  if (tokenCache.has(dashboardId)) {
    return tokenCache.get(dashboardId)!;
  }

  try {
    // Always send what we have; backend will resolve to UUID when needed
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(dashboardId);
    const payload = isUuid
      ? { dashboard_uuid: dashboardId }
      : { dashboard_id: dashboardId };

    const response = await SupersetClient.post({
      endpoint: '/api/v1/security/guest_token_proxy/',
      jsonPayload: payload,
    });

    const data = response.json as GuestTokenResponse;
    const { token } = data;

    if (!token) {
      throw new Error('No token in response');
    }

    tokenCache.set(dashboardId, token);

    return token;
  } catch (error: any) {
    // Fallback: if proxy route is unavailable (404), try the legacy public endpoint
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(dashboardId);
    const status = (error && (error.status || error.response?.status)) as
      | number
      | undefined;
    if (status === 404 && !isUuid) {
      try {
        const fallback = await SupersetClient.post({
          endpoint: '/api/v1/security/public_guest_token/',
          jsonPayload: { dashboard_id: dashboardId },
        });
        const data = fallback.json as GuestTokenResponse;
        const { token } = data;
        if (!token) throw new Error('No token in fallback response');
        tokenCache.set(dashboardId, token);
        return token;
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
    throw error;
  }
}

export function clearGuestTokenCache(dashboardId?: string): void {
  if (dashboardId) {
    tokenCache.delete(dashboardId);
  } else {
    tokenCache.clear();
  }
}
