/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

/* eslint-disable max-len */
const thumbnailUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 145" width="200" height="145">
  <rect width="200" height="145" rx="4" fill="#f8fafc"/>
  <rect x="0" y="0" width="200" height="3" fill="#f97316"/>
  <!-- Horizontal ranked bars with variance markers -->
  <!-- Bar 1 - positive variance -->
  <text x="14" y="28" font-family="system-ui,sans-serif" font-size="7" fill="#475569">Dist A</text>
  <rect x="50" y="20" width="105" height="12" rx="2" fill="#3b82f6" opacity="0.8"/>
  <line x1="140" y1="18" x2="140" y2="34" stroke="#f97316" stroke-width="2"/>
  <text x="162" y="29" font-family="system-ui,sans-serif" font-size="7" fill="#10b981" font-weight="700">+12%</text>
  <!-- Bar 2 - positive variance -->
  <text x="14" y="48" font-family="system-ui,sans-serif" font-size="7" fill="#475569">Dist B</text>
  <rect x="50" y="40" width="92" height="12" rx="2" fill="#3b82f6" opacity="0.75"/>
  <line x1="128" y1="38" x2="128" y2="54" stroke="#f97316" stroke-width="2"/>
  <text x="162" y="49" font-family="system-ui,sans-serif" font-size="7" fill="#10b981" font-weight="700">+8%</text>
  <!-- Bar 3 - small positive -->
  <text x="14" y="68" font-family="system-ui,sans-serif" font-size="7" fill="#475569">Dist C</text>
  <rect x="50" y="60" width="80" height="12" rx="2" fill="#3b82f6" opacity="0.7"/>
  <line x1="118" y1="58" x2="118" y2="74" stroke="#f97316" stroke-width="2"/>
  <text x="162" y="69" font-family="system-ui,sans-serif" font-size="7" fill="#10b981" font-weight="700">+3%</text>
  <!-- Bar 4 - negative variance -->
  <text x="14" y="88" font-family="system-ui,sans-serif" font-size="7" fill="#475569">Dist D</text>
  <rect x="50" y="80" width="65" height="12" rx="2" fill="#3b82f6" opacity="0.65"/>
  <line x1="118" y1="78" x2="118" y2="94" stroke="#f97316" stroke-width="2"/>
  <text x="162" y="89" font-family="system-ui,sans-serif" font-size="7" fill="#ef4444" font-weight="700">-5%</text>
  <!-- Bar 5 - negative variance -->
  <text x="14" y="108" font-family="system-ui,sans-serif" font-size="7" fill="#475569">Dist E</text>
  <rect x="50" y="100" width="48" height="12" rx="2" fill="#3b82f6" opacity="0.6"/>
  <line x1="118" y1="98" x2="118" y2="114" stroke="#f97316" stroke-width="2"/>
  <text x="162" y="109" font-family="system-ui,sans-serif" font-size="7" fill="#ef4444" font-weight="700">-18%</text>
  <!-- Target line -->
  <line x1="118" y1="14" x2="118" y2="118" stroke="#f97316" stroke-width="1" stroke-dasharray="3,2"/>
  <text x="118" y="132" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" fill="#f97316" font-weight="600">Target</text>
</svg>`)}`;

export default thumbnailUrl;
