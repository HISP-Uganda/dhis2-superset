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
/* eslint-disable import/first */
jest.mock('@superset-ui/core', () => ({
  FeatureFlag: {
    EnableExtensions: 'EnableExtensions',
    TaggingSystem: 'TaggingSystem',
  },
  isFeatureEnabled: jest.fn(() => false),
}));

jest.mock('src/utils/getBootstrapData', () => ({
  __esModule: true,
  default: () => ({
    common: {
      conf: {
        AUTH_USER_REGISTRATION: false,
      },
    },
    user: null,
  }),
}));

jest.mock('src/dashboard/util/permissionUtils', () => ({
  isUserAdmin: jest.fn(() => false),
}));

jest.mock('src/pages/Home', () => () => <div data-test="mock-home" />);
jest.mock('src/pages/PublicLandingPage', () => () => (
  <div data-test="mock-public-landing" />
));
jest.mock('src/pages/CMSAdminPage', () => () => (
  <div data-test="mock-cms-admin" />
));

import { isFrontendRoute, routes } from './routes';

// eslint-disable-next-line no-restricted-globals -- TODO: Migrate from describe blocks
describe('isFrontendRoute', () => {
  test('returns true if a route matches', () => {
    routes.forEach(r => {
      expect(isFrontendRoute(r.path)).toBe(true);
    });
  });

  test('includes the public explore iframe route used by portal chart blocks', () => {
    expect(isFrontendRoute('/superset/explore/public/')).toBe(true);
  });

  test('returns false if a route does not match', () => {
    expect(isFrontendRoute('/nonexistent/path/')).toBe(false);
  });
});
