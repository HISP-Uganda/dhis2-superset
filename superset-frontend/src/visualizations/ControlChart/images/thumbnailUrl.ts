/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

/* eslint-disable max-len */
const thumbnailUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 145" width="200" height="145">
  <rect width="200" height="145" rx="4" fill="#f8fafc"/>
  <rect x="0" y="0" width="200" height="3" fill="#ef4444"/>
  <!-- Upper control limit band -->
  <rect x="20" y="22" width="165" height="30" fill="#fef2f2" opacity="0.7"/>
  <!-- Lower control limit band -->
  <rect x="20" y="88" width="165" height="30" fill="#fef2f2" opacity="0.7"/>
  <!-- Normal band -->
  <rect x="20" y="52" width="165" height="36" fill="#f0fdf4" opacity="0.6"/>
  <!-- UCL line -->
  <line x1="20" y1="22" x2="185" y2="22" stroke="#ef4444" stroke-width="1" stroke-dasharray="4,3"/>
  <!-- Mean line -->
  <line x1="20" y1="70" x2="185" y2="70" stroke="#3b82f6" stroke-width="1" stroke-dasharray="4,3"/>
  <!-- LCL line -->
  <line x1="20" y1="118" x2="185" y2="118" stroke="#ef4444" stroke-width="1" stroke-dasharray="4,3"/>
  <!-- Data line (epidemic channel) -->
  <polyline points="24,75 38,68 52,62 66,55 80,48 94,35 108,28 122,42 136,58 150,65 164,72 178,78" fill="none" stroke="#1e293b" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- Alert dot -->
  <circle cx="94" cy="35" r="4" fill="#ef4444"/>
  <circle cx="108" cy="28" r="4" fill="#ef4444"/>
  <!-- Normal dots -->
  <circle cx="24" cy="75" r="2.5" fill="#3b82f6"/>
  <circle cx="164" cy="72" r="2.5" fill="#3b82f6"/>
  <circle cx="178" cy="78" r="2.5" fill="#3b82f6"/>
  <!-- Labels -->
  <text x="188" y="25" font-family="system-ui,sans-serif" font-size="6" fill="#ef4444">UCL</text>
  <text x="188" y="73" font-family="system-ui,sans-serif" font-size="6" fill="#3b82f6">Mean</text>
  <text x="188" y="121" font-family="system-ui,sans-serif" font-size="6" fill="#ef4444">LCL</text>
  <text x="100" y="140" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" fill="#6b7280">Epidemic Channel</text>
</svg>`)}`;

export default thumbnailUrl;
