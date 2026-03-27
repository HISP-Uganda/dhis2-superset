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
import { URL_PARAMS } from 'src/constants';
import { getParsedExploreURLParams } from 'src/explore/exploreUtils/getParsedExploreURLParams';
import { getExploreApiParams } from './getExploreApiParams';

jest.mock('src/explore/exploreUtils/getParsedExploreURLParams', () => ({
  getParsedExploreURLParams: jest.fn(),
}));

test('keeps dashboard page id client-side only', () => {
  (getParsedExploreURLParams as jest.Mock).mockReturnValue(
    new URLSearchParams(
      `slice_id=11&${URL_PARAMS.dashboardPageId.name}=page-1&foo=bar`,
    ),
  );

  const params = getExploreApiParams({
    pathname: '/explore/',
    search: '',
  });

  expect(params.get('slice_id')).toBe('11');
  expect(params.get('foo')).toBe('bar');
  expect(params.get(URL_PARAMS.dashboardPageId.name)).toBeNull();
});
