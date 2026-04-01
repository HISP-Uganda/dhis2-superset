/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

/* eslint-disable max-len */
const thumbnailUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 145" width="200" height="145">
  <rect width="200" height="145" rx="4" fill="#f8fafc"/>
  <rect x="0" y="0" width="200" height="3" fill="#8b5cf6"/>
  <!-- KPI card frame -->
  <rect x="16" y="14" width="168" height="116" rx="8" fill="#fff" stroke="#e2e8f0" stroke-width="1"/>
  <!-- Big number -->
  <text x="100" y="55" text-anchor="middle" font-family="system-ui,sans-serif" font-size="32" fill="#1e293b" font-weight="800">87.4%</text>
  <!-- Comparison arrow + delta -->
  <polygon points="80,68 88,68 84,62" fill="#10b981"/>
  <text x="92" y="72" font-family="system-ui,sans-serif" font-size="12" fill="#10b981" font-weight="700">+5.2%</text>
  <!-- Target bar background -->
  <rect x="32" y="84" width="136" height="8" rx="4" fill="#e2e8f0"/>
  <!-- Target bar fill -->
  <rect x="32" y="84" width="119" height="8" rx="4" fill="#8b5cf6" opacity="0.8"/>
  <!-- Target marker -->
  <line x1="141" y1="81" x2="141" y2="95" stroke="#f59e0b" stroke-width="2"/>
  <!-- Labels -->
  <text x="32" y="106" font-family="system-ui,sans-serif" font-size="7" fill="#94a3b8">Actual</text>
  <text x="141" y="106" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" fill="#f59e0b" font-weight="600">Target</text>
  <text x="100" y="122" text-anchor="middle" font-family="system-ui,sans-serif" font-size="8" fill="#64748b">vs Previous Period</text>
</svg>`)}`;

export default thumbnailUrl;
