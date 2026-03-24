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
import { SupersetClient, logging, ClientConfig } from '@superset-ui/core';
import parseCookie from 'src/utils/parseCookie';
import getBootstrapData from 'src/utils/getBootstrapData';

const bootstrapData = getBootstrapData();

function getDefaultConfiguration(): ClientConfig {
  const csrfNode = document.querySelector<HTMLInputElement>('#csrf_token');
  const csrfToken = csrfNode?.value;

  // when using flask-jwt-extended csrf is set in cookies
  const jwtAccessCsrfCookieName =
    bootstrapData.common.conf.JWT_ACCESS_CSRF_COOKIE_NAME;
  const cookieCSRFToken = parseCookie()[jwtAccessCsrfCookieName] || '';

  // Configure retry behavior from backend settings
  const retryConfig = bootstrapData.common.conf;

  // Create exponential backoff delay function with jitter
  const createRetryDelayFunction = () => {
    const baseDelay = retryConfig.SUPERSET_CLIENT_RETRY_DELAY || 1000;
    const multiplier =
      retryConfig.SUPERSET_CLIENT_RETRY_BACKOFF_MULTIPLIER || 2;
    const maxDelay = retryConfig.SUPERSET_CLIENT_RETRY_MAX_DELAY || 10000;

    return (attempt: number) => {
      // Calculate exponential backoff: baseDelay * Math.pow(multiplier, attempt)
      const safeAttempt = Math.min(attempt, 10); // Limit attempt to prevent overflow
      const exponentialDelay = baseDelay * Math.pow(multiplier, safeAttempt);

      // Apply max delay cap
      const cappedDelay = Math.min(exponentialDelay, maxDelay);

      // Add random jitter to prevent thundering herd
      const jitter = Math.random() * cappedDelay;

      return cappedDelay + jitter;
    };
  };

  const fetchRetryOptions = {
    retries: retryConfig.SUPERSET_CLIENT_RETRY_ATTEMPTS || 3,
    retryDelay: createRetryDelayFunction(),
    retryOn: retryConfig.SUPERSET_CLIENT_RETRY_STATUS_CODES || [502, 503, 504],
  };

  const PUBLIC_PORTAL_PATH_PREFIXES = ['/superset/public', '/public'];

  const isPublicPortalPath = (pathname: string) =>
    PUBLIC_PORTAL_PATH_PREFIXES.some(
      prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

  const unauthorizedHandler = () => {
    const { pathname, href } = window.location;
    // Suppress redirect if on a public page or login page
    if (
      window.IS_PUBLIC_PAGE === true ||
      isPublicPortalPath(pathname) ||
      pathname.includes('/public') ||
      pathname.includes('/login')
    ) {
      // eslint-disable-next-line no-console
      console.warn('[SupersetClient] 401 Unauthorized suppressed on public page:', pathname);
      return;
    }
    // Default behavior
    const appRoot = bootstrapData.common.application_root || '';
    const loginUrl = `${appRoot}/login?next=${href}`;
    // eslint-disable-next-line no-console
    console.warn('[SupersetClient] 401 Unauthorized - redirecting to login:', loginUrl);
    window.location.href = loginUrl;
  };

  return {
    protocol: ['http:', 'https:'].includes(window?.location?.protocol)
      ? (window?.location?.protocol as 'http:' | 'https:')
      : undefined,
    host: window.location?.host || '',
    csrfToken: csrfToken || cookieCSRFToken,
    fetchRetryOptions,
    unauthorizedHandler,
  };
}

export default function setupClient(customConfig: Partial<ClientConfig> = {}) {
  SupersetClient.configure({
    ...getDefaultConfiguration(),
    ...customConfig,
  })
    .init()
    .catch(error => {
      logging.warn('Error initializing SupersetClient', error);
    });
}
