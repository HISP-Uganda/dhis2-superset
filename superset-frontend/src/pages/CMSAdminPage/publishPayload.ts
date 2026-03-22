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

import { normalizeDraftPage } from 'src/pages/PublicLandingPage/portalUtils';
import type {
  PortalPage,
  PortalPageSummary,
} from 'src/pages/PublicLandingPage/types';

export function buildPublishStatePayload(
  page: Pick<PortalPageSummary, 'visibility' | 'scheduled_publish_at'>,
  isPublished: boolean,
) {
  return {
    is_published: isPublished,
    visibility:
      isPublished && page.visibility === 'draft' ? 'public' : page.visibility,
    scheduled_publish_at: page.scheduled_publish_at || null,
  };
}

export function buildPublishPagePayload(
  draftPage: PortalPage,
  isPublished: boolean,
) {
  const normalizedDraft = normalizeDraftPage(draftPage);
  return {
    ...normalizedDraft,
    ...buildPublishStatePayload(
      {
        visibility: normalizedDraft.visibility,
        scheduled_publish_at:
          normalizedDraft.scheduled_publish_at ||
          draftPage.scheduled_publish_at,
      },
      isPublished,
    ),
  };
}
