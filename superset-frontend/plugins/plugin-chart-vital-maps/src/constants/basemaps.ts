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
    attribution: '© OpenFreeMap © OpenStreetMap contributors',
  },
  {
    id: 'vital-streets',
    label: 'Vital Streets',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '© OpenFreeMap © OpenStreetMap contributors',
  },
  {
    id: 'vital-bright',
    label: 'Vital Bright',
    style: 'https://tiles.openfreemap.org/styles/bright',
    attribution: '© OpenFreeMap © OpenStreetMap contributors',
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
          attribution: '© CARTO © OpenStreetMap contributors',
        },
      },
      layers: [{ id: 'background', type: 'raster', source: 'carto-dark' }],
    },
    attribution: '© CARTO © OpenStreetMap contributors',
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
          attribution: '© Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'satellite-bg', type: 'raster', source: 'esri' }],
    },
    attribution: '© Esri, Maxar',
  },
];

export const BASEMAP_PRESETS_BY_ID: Record<string, BasemapStyleDefinition> =
  Object.fromEntries(BASEMAP_PRESETS.map(b => [b.id, b]));

export const DEFAULT_BASEMAP_ID = 'vital-light';
