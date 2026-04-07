export type BasemapStyleDefinition = {
  id: string;
  label: string;
  style: string | Record<string, unknown>;
  attribution?: string;
};

export const BASEMAP_PRESETS: BasemapStyleDefinition[] = [
  {
    id: 'vital-light',
    label: 'Vital Light',
    style: 'https://tiles.openfreemap.org/styles/positron',
    attribution: '\u00a9 OpenFreeMap \u00a9 OpenStreetMap contributors',
  },
  {
    id: 'vital-streets',
    label: 'Vital Streets',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '\u00a9 OpenFreeMap \u00a9 OpenStreetMap contributors',
  },
  {
    id: 'vital-bright',
    label: 'Vital Bright',
    style: 'https://tiles.openfreemap.org/styles/bright',
    attribution: '\u00a9 OpenFreeMap \u00a9 OpenStreetMap contributors',
  },
  {
    id: 'dark',
    label: 'Dark',
    style: {
      version: 8,
      name: 'Dark',
      sources: {
        'carto-dark': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          ],
          tileSize: 256,
          attribution: '\u00a9 CARTO \u00a9 OpenStreetMap contributors',
        },
      },
      layers: [{ id: 'background', type: 'raster', source: 'carto-dark' }],
    },
    attribution: '\u00a9 CARTO \u00a9 OpenStreetMap contributors',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    style: {
      version: 8,
      name: 'Satellite',
      sources: {
        esri: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '\u00a9 Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'satellite-bg', type: 'raster', source: 'esri' }],
    },
    attribution: '\u00a9 Esri, Maxar',
  },
  {
    id: 'terrain',
    label: 'Terrain',
    style: {
      version: 8,
      name: 'Terrain',
      sources: {
        'stamen-terrain': {
          type: 'raster',
          tiles: [
            'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '\u00a9 Stadia Maps \u00a9 Stamen Design \u00a9 OpenStreetMap',
        },
      },
      layers: [{ id: 'terrain-bg', type: 'raster', source: 'stamen-terrain' }],
    },
    attribution: '\u00a9 Stadia Maps \u00a9 Stamen Design',
  },
];

export const BASEMAP_PRESETS_BY_ID: Record<string, BasemapStyleDefinition> =
  Object.fromEntries(BASEMAP_PRESETS.map(b => [b.id, b]));

export const DEFAULT_BASEMAP_ID = 'vital-light';
