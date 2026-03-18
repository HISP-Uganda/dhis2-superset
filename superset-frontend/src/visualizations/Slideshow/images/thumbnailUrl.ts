/*
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

/* eslint-disable max-len */
const thumbnailUrl = `data:image/svg+xml;base64,${btoa(`
<svg width="200" height="140" viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="140" rx="8" fill="#1C2536"/>
  <rect x="12" y="12" width="176" height="100" rx="6" fill="#253148"/>
  <rect x="28" y="56" width="144" height="3" rx="2" fill="#ffffff" opacity="0.15"/>
  <text x="100" y="42" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="28" fill="#ffffff">42.7K</text>
  <text x="100" y="72" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#8B9BB4" letter-spacing="1">MALARIA CASES</text>
  <circle cx="86" cy="122" r="4" fill="#4D89E8"/>
  <circle cx="100" cy="122" r="5" fill="#4D89E8" opacity="0.9"/>
  <circle cx="114" cy="122" r="4" fill="#4D89E8" opacity="0.5"/>
  <rect x="12" y="130" width="50" height="3" rx="1.5" fill="#4D89E8"/>
</svg>
`)}`;

export default thumbnailUrl;
