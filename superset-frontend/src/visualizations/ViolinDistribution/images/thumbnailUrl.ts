/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

/* eslint-disable max-len */
const thumbnailUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 145" width="200" height="145">
  <rect width="200" height="145" rx="4" fill="#f8fafc"/>
  <rect x="0" y="0" width="200" height="3" fill="#a855f7"/>
  <!-- Y-axis -->
  <line x1="24" y1="14" x2="24" y2="128" stroke="#cbd5e1" stroke-width="1"/>
  <!-- X-axis -->
  <line x1="24" y1="128" x2="190" y2="128" stroke="#cbd5e1" stroke-width="1"/>
  <!-- Violin 1 -->
  <path d="M52,20 Q62,30 66,50 Q70,70 66,90 Q62,110 52,120 Q42,110 38,90 Q34,70 38,50 Q42,30 52,20 Z" fill="#a855f7" opacity="0.3" stroke="#a855f7" stroke-width="1.5"/>
  <line x1="42" y1="65" x2="62" y2="65" stroke="#a855f7" stroke-width="2"/>
  <rect x="47" y="50" width="10" height="30" rx="2" fill="#a855f7" opacity="0.5"/>
  <circle cx="52" cy="65" r="2.5" fill="#fff" stroke="#a855f7" stroke-width="1"/>
  <!-- Violin 2 -->
  <path d="M100,28 Q114,38 118,55 Q122,72 118,92 Q114,112 100,122 Q86,112 82,92 Q78,72 82,55 Q86,38 100,28 Z" fill="#c084fc" opacity="0.3" stroke="#c084fc" stroke-width="1.5"/>
  <line x1="88" y1="72" x2="112" y2="72" stroke="#c084fc" stroke-width="2"/>
  <rect x="94" y="55" width="12" height="34" rx="2" fill="#c084fc" opacity="0.5"/>
  <circle cx="100" cy="72" r="2.5" fill="#fff" stroke="#c084fc" stroke-width="1"/>
  <!-- Violin 3 -->
  <path d="M148,35 Q158,45 160,60 Q162,80 160,100 Q158,115 148,124 Q138,115 136,100 Q134,80 136,60 Q138,45 148,35 Z" fill="#7c3aed" opacity="0.3" stroke="#7c3aed" stroke-width="1.5"/>
  <line x1="140" y1="78" x2="156" y2="78" stroke="#7c3aed" stroke-width="2"/>
  <rect x="143" y="62" width="10" height="32" rx="2" fill="#7c3aed" opacity="0.5"/>
  <circle cx="148" cy="78" r="2.5" fill="#fff" stroke="#7c3aed" stroke-width="1"/>
  <!-- Labels -->
  <text x="52" y="138" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" fill="#6b7280">Grp A</text>
  <text x="100" y="138" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" fill="#6b7280">Grp B</text>
  <text x="148" y="138" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" fill="#6b7280">Grp C</text>
</svg>`)}`;

export default thumbnailUrl;
