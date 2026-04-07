import maplibregl from 'maplibre-gl';
import { SRC, LYR } from '../constants/defaults';

const SID = SRC.MARKER;

/** Names of bundled marker icons */
export const MARKER_ICON_NAMES = [
  'default', 'hospital', 'clinic', 'warehouse', 'office', 'lab', 'school', 'water',
] as const;

export type MarkerIconName = (typeof MARKER_ICON_NAMES)[number];

/**
 * Professional SVG marker icons for health facility mapping.
 * Each icon is a 48×48 SVG with a drop-shadow pin shape and a crisp interior symbol.
 */
function makeIconSvg(bgColor: string, symbolPath: string): string {
  // Pin-shaped marker with shadow and crisp symbol inside
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <filter id="s" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.3"/>
    </filter>
  </defs>
  <g filter="url(#s)">
    <path d="M24 4C16.268 4 10 10.268 10 18c0 10.5 14 24 14 24s14-13.5 14-24C38 10.268 31.732 4 24 4z" fill="${bgColor}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="24" cy="18" r="11" fill="rgba(255,255,255,0.25)"/>
  </g>
  <g transform="translate(24,18)" fill="#fff" text-anchor="middle" dominant-baseline="central">
    ${symbolPath}
  </g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Icon definitions with professional SVG paths for each facility type.
 * Colors follow a health-sector visual identity palette.
 */
const ICON_DEFS: Record<string, { bg: string; symbol: string }> = {
  // Default: location pin dot
  default: {
    bg: '#3B82F6',
    symbol: '<circle cx="0" cy="0" r="4" fill="#fff"/>',
  },
  // Hospital: H cross symbol
  hospital: {
    bg: '#DC2626',
    symbol: `<path d="M-6-2h4v-4h4v4h4v4h-4v4h-4v-4h-4z" fill="#fff"/>`,
  },
  // Clinic: medical cross (thinner)
  clinic: {
    bg: '#F97316',
    symbol: `<path d="M-1.5-7h3v4.5h4.5v3h-4.5v4.5h-3v-4.5h-4.5v-3h4.5z" fill="#fff"/>`,
  },
  // Warehouse: box/crate icon
  warehouse: {
    bg: '#0D9488',
    symbol: `<path d="M-7-3l7-5 7 5v9h-14z M-7-3h14" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><line x1="0" y1="-8" x2="0" y2="6" stroke="#fff" stroke-width="1.2"/><line x1="-7" y1="1" x2="7" y2="1" stroke="#fff" stroke-width="1.2"/>`,
  },
  // Office: building icon
  office: {
    bg: '#16A34A',
    symbol: `<rect x="-6" y="-7" width="12" height="14" rx="1" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="-3.5" y="-4.5" width="3" height="2.5" rx="0.5" fill="#fff"/><rect x="0.5" y="-4.5" width="3" height="2.5" rx="0.5" fill="#fff"/><rect x="-3.5" y="0" width="3" height="2.5" rx="0.5" fill="#fff"/><rect x="0.5" y="0" width="3" height="2.5" rx="0.5" fill="#fff"/><rect x="-1.5" y="4" width="3" height="3" fill="#fff"/>`,
  },
  // Lab: flask/beaker icon
  lab: {
    bg: '#7C3AED',
    symbol: `<path d="M-2.5-7v5l-5 9h15l-5-9v-5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><line x1="-4" y1="-7" x2="4" y2="-7" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="-1" cy="3" r="1.2" fill="#fff"/><circle cx="2" cy="1" r="0.8" fill="#fff"/>`,
  },
  // School: graduation cap
  school: {
    bg: '#CA8A04',
    symbol: `<path d="M-8 0l8-5 8 5-8 5z" fill="#fff"/><path d="M-4 2v4c0 1.5 4 3 4 3s4-1.5 4-3v-4" fill="none" stroke="#fff" stroke-width="1.4"/><line x1="8" y1="0" x2="8" y2="6" stroke="#fff" stroke-width="1.4"/>`,
  },
  // Water: water drop icon
  water: {
    bg: '#0284C7',
    symbol: `<path d="M0-8c0 0-7 8-7 12a7 7 0 0014 0c0-4-7-12-7-12z" fill="#fff" opacity="0.9"/><path d="M-3 3a4 4 0 004 4" fill="none" stroke="${'#0284C7'}" stroke-width="1.2" stroke-linecap="round"/>`,
  },
};

function ensureSource(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SID) as maplibregl.GeoJSONSource | undefined;
  if (src) { src.setData(geojson); } else { map.addSource(SID, { type: 'geojson', data: geojson }); }
}

/** Load all marker icon images into the map's sprite */
export async function loadMarkerIcons(map: maplibregl.Map): Promise<void> {
  const promises = Object.entries(ICON_DEFS).map(async ([name, def]) => {
    const imgName = `marker-${name}`;
    if (map.hasImage(imgName)) return;
    const url = makeIconSvg(def.bg, def.symbol);
    const img = await map.loadImage(url);
    if (!map.hasImage(imgName)) {
      map.addImage(imgName, img.data, { sdf: false });
    }
  });
  await Promise.all(promises);
}

export function addOrUpdateMarkerLayer(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection,
  opts: {
    iconCol?: string;
    iconSize: number;
    defaultIcon: string;
    labelCol?: string;
    opacity: number;
  },
): void {
  const { iconCol, iconSize, defaultIcon, labelCol, opacity } = opts;
  ensureSource(map, geojson);

  // Build icon-image expression
  let iconImage: maplibregl.ExpressionSpecification | string = `marker-${defaultIcon}`;
  if (iconCol) {
    const matchExpr: unknown[] = ['match', ['get', iconCol]];
    for (const name of MARKER_ICON_NAMES) {
      matchExpr.push(name, `marker-${name}`);
    }
    // Also match capitalized versions
    for (const name of MARKER_ICON_NAMES) {
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      matchExpr.push(cap, `marker-${name}`);
    }
    matchExpr.push(`marker-${defaultIcon}`); // fallback
    iconImage = matchExpr as unknown as maplibregl.ExpressionSpecification;
  }

  if (!map.getLayer(LYR.MARKER)) {
    map.addLayer({
      id: LYR.MARKER,
      type: 'symbol',
      source: SID,
      layout: {
        'icon-image': iconImage as unknown as maplibregl.ExpressionSpecification,
        'icon-size': iconSize,
        'icon-allow-overlap': true,
        'icon-anchor': 'bottom',
        ...(labelCol ? {
          'text-field': ['get', labelCol] as unknown as maplibregl.ExpressionSpecification,
          'text-size': 11,
          'text-offset': [0, 0.8] as [number, number],
          'text-anchor': 'top' as const,
          'text-optional': true,
        } : {}),
      },
      paint: {
        'icon-opacity': opacity,
        ...(labelCol ? {
          'text-color': '#1F2937',
          'text-halo-color': 'rgba(255,255,255,0.95)',
          'text-halo-width': 1.5,
        } : {}),
      },
    });
  } else {
    map.setLayoutProperty(LYR.MARKER, 'icon-image', iconImage);
    map.setLayoutProperty(LYR.MARKER, 'icon-size', iconSize);
    map.setPaintProperty(LYR.MARKER, 'icon-opacity', opacity);
  }
}

export function removeMarkerLayer(map: maplibregl.Map): void {
  if (map.getLayer(LYR.MARKER)) map.removeLayer(LYR.MARKER);
  if (map.getSource(SID)) map.removeSource(SID);
}
