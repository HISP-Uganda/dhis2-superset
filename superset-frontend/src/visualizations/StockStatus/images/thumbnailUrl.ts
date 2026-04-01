/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

/* eslint-disable max-len */
const thumbnailUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 145" width="200" height="145">
  <rect width="200" height="145" rx="4" fill="#f8fafc"/>
  <rect x="0" y="0" width="200" height="3" fill="#0d9488"/>
  <!-- Stacked pipeline bars -->
  <!-- Item 1 -->
  <text x="14" y="30" font-family="system-ui,sans-serif" font-size="7" fill="#475569">ACTs</text>
  <rect x="50" y="22" width="50" height="14" rx="2" fill="#10b981"/>
  <rect x="100" y="22" width="35" height="14" rx="2" fill="#fbbf24"/>
  <rect x="135" y="22" width="20" height="14" rx="2" fill="#ef4444"/>
  <!-- Item 2 -->
  <text x="14" y="52" font-family="system-ui,sans-serif" font-size="7" fill="#475569">RDTs</text>
  <rect x="50" y="44" width="70" height="14" rx="2" fill="#10b981"/>
  <rect x="120" y="44" width="25" height="14" rx="2" fill="#fbbf24"/>
  <rect x="145" y="44" width="10" height="14" rx="2" fill="#ef4444"/>
  <!-- Item 3 -->
  <text x="14" y="74" font-family="system-ui,sans-serif" font-size="7" fill="#475569">LLINs</text>
  <rect x="50" y="66" width="30" height="14" rx="2" fill="#10b981"/>
  <rect x="80" y="66" width="25" height="14" rx="2" fill="#fbbf24"/>
  <rect x="105" y="66" width="50" height="14" rx="2" fill="#ef4444"/>
  <!-- Item 4 -->
  <text x="14" y="96" font-family="system-ui,sans-serif" font-size="7" fill="#475569">SP/IPT</text>
  <rect x="50" y="88" width="60" height="14" rx="2" fill="#10b981"/>
  <rect x="110" y="88" width="30" height="14" rx="2" fill="#fbbf24"/>
  <rect x="140" y="88" width="15" height="14" rx="2" fill="#ef4444"/>
  <!-- Threshold line -->
  <line x1="100" y1="16" x2="100" y2="108" stroke="#475569" stroke-width="1" stroke-dasharray="3,2"/>
  <text x="100" y="14" text-anchor="middle" font-family="system-ui,sans-serif" font-size="6" fill="#475569">Min Stock</text>
  <!-- Legend -->
  <rect x="40" y="116" width="10" height="8" rx="2" fill="#10b981"/>
  <text x="54" y="123" font-family="system-ui,sans-serif" font-size="7" fill="#475569">Adequate</text>
  <rect x="92" y="116" width="10" height="8" rx="2" fill="#fbbf24"/>
  <text x="106" y="123" font-family="system-ui,sans-serif" font-size="7" fill="#475569">Low</text>
  <rect x="130" y="116" width="10" height="8" rx="2" fill="#ef4444"/>
  <text x="144" y="123" font-family="system-ui,sans-serif" font-size="7" fill="#475569">Stockout</text>
</svg>`)}`;

export default thumbnailUrl;
