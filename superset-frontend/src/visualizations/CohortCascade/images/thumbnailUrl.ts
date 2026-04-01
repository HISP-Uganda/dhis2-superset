/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

/* eslint-disable max-len */
const thumbnailUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 145" width="200" height="145">
  <rect width="200" height="145" rx="4" fill="#f8fafc"/>
  <rect x="0" y="0" width="200" height="3" fill="#059669"/>
  <!-- Cascade / funnel bars descending -->
  <rect x="20" y="18" width="160" height="18" rx="3" fill="#10b981" opacity="0.95"/>
  <rect x="32" y="42" width="136" height="18" rx="3" fill="#34d399" opacity="0.9"/>
  <rect x="48" y="66" width="104" height="18" rx="3" fill="#6ee7b7" opacity="0.85"/>
  <rect x="60" y="90" width="80" height="18" rx="3" fill="#a7f3d0" opacity="0.8"/>
  <rect x="72" y="114" width="56" height="18" rx="3" fill="#d1fae5" opacity="0.75"/>
  <!-- Connecting lines -->
  <line x1="100" y1="36" x2="100" y2="42" stroke="#059669" stroke-width="1.5"/>
  <line x1="100" y1="60" x2="100" y2="66" stroke="#059669" stroke-width="1.5"/>
  <line x1="100" y1="84" x2="100" y2="90" stroke="#059669" stroke-width="1.5"/>
  <line x1="100" y1="108" x2="100" y2="114" stroke="#059669" stroke-width="1.5"/>
  <!-- Percentage labels -->
  <text x="100" y="30" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" fill="#fff" font-weight="700">100%</text>
  <text x="100" y="54" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" fill="#065f46" font-weight="600">85%</text>
  <text x="100" y="78" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" fill="#065f46" font-weight="600">65%</text>
  <text x="100" y="102" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" fill="#065f46" font-weight="600">50%</text>
  <text x="100" y="126" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" fill="#065f46" font-weight="600">35%</text>
  <text x="100" y="142" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" fill="#6b7280">Treatment Cascade</text>
</svg>`)}`;

export default thumbnailUrl;
