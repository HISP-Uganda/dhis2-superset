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

// Vital Maps professional thumbnail as inline SVG data URL
const thumbnail = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e8f4f8"/>
      <stop offset="100%" stop-color="#d0e8f0"/>
    </linearGradient>
    <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0d3b66"/>
      <stop offset="100%" stop-color="#1976d2"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="200" height="200" rx="4" fill="url(#bg)"/>
  <!-- Header bar -->
  <rect width="200" height="5" fill="url(#hdr)"/>

  <!-- Choropleth polygons (Uganda-like regions) -->
  <path d="M35 55 L75 38 L95 48 L85 80 L55 88 Z" fill="#b2dfdb" stroke="#00796b" stroke-width="1"/>
  <path d="M75 38 L125 28 L155 45 L140 78 L95 48 Z" fill="#4db6ac" stroke="#00796b" stroke-width="1"/>
  <path d="M55 88 L85 80 L115 110 L80 128 L42 112 Z" fill="#00897b" stroke="#00695c" stroke-width="1"/>
  <path d="M85 80 L140 78 L150 115 L115 110 Z" fill="#00695c" stroke="#004d40" stroke-width="1"/>
  <path d="M115 110 L150 115 L158 148 L130 158 L90 140 L80 128 Z" fill="#004d40" stroke="#002922" stroke-width="1"/>

  <!-- Bubble markers (varying sizes = metric magnitude) -->
  <circle cx="65" cy="65" r="8" fill="#e53935" fill-opacity="0.6" stroke="#b71c1c" stroke-width="0.8"/>
  <circle cx="120" cy="55" r="12" fill="#e53935" fill-opacity="0.6" stroke="#b71c1c" stroke-width="0.8"/>
  <circle cx="90" cy="100" r="6" fill="#e53935" fill-opacity="0.6" stroke="#b71c1c" stroke-width="0.8"/>
  <circle cx="135" cy="135" r="10" fill="#e53935" fill-opacity="0.6" stroke="#b71c1c" stroke-width="0.8"/>
  <circle cx="55" cy="100" r="5" fill="#e53935" fill-opacity="0.6" stroke="#b71c1c" stroke-width="0.8"/>

  <!-- Point markers -->
  <circle cx="65" cy="65" r="2.5" fill="#fff" stroke="#0d3b66" stroke-width="1"/>
  <circle cx="120" cy="55" r="2.5" fill="#fff" stroke="#0d3b66" stroke-width="1"/>
  <circle cx="90" cy="100" r="2.5" fill="#fff" stroke="#0d3b66" stroke-width="1"/>
  <circle cx="135" cy="135" r="2.5" fill="#fff" stroke="#0d3b66" stroke-width="1"/>
  <circle cx="55" cy="100" r="2.5" fill="#fff" stroke="#0d3b66" stroke-width="1"/>

  <!-- Mini legend -->
  <rect x="148" y="60" width="44" height="52" rx="3" fill="#fff" fill-opacity="0.9" stroke="#bbb" stroke-width="0.5"/>
  <rect x="152" y="66" width="10" height="6" rx="1" fill="#b2dfdb" stroke="#00796b" stroke-width="0.3"/>
  <text x="164" y="72" font-family="Arial,sans-serif" font-size="5.5" fill="#333">Low</text>
  <rect x="152" y="76" width="10" height="6" rx="1" fill="#4db6ac" stroke="#00796b" stroke-width="0.3"/>
  <text x="164" y="82" font-family="Arial,sans-serif" font-size="5.5" fill="#333">Med</text>
  <rect x="152" y="86" width="10" height="6" rx="1" fill="#00695c" stroke="#004d40" stroke-width="0.3"/>
  <text x="164" y="92" font-family="Arial,sans-serif" font-size="5.5" fill="#333">High</text>
  <circle cx="157" cy="102" r="3" fill="#e53935" fill-opacity="0.5" stroke="#b71c1c" stroke-width="0.3"/>
  <text x="164" y="104" font-family="Arial,sans-serif" font-size="5.5" fill="#333">Cases</text>

  <!-- Title -->
  <rect x="0" y="172" width="200" height="28" fill="#0d3b66" fill-opacity="0.85"/>
  <text x="100" y="189" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#fff" font-weight="bold" letter-spacing="0.5">Vital Maps</text>
</svg>`)}`;

export default thumbnail;
