export type PointRow = {
  latitude: number;
  longitude: number;
  metric?: number;
  category?: string;
  label?: string;
  [key: string]: any;
};

export type GeometryRow = {
  geometry: string | object | null;
  metric?: number;
  category?: string;
  label?: string;
  [key: string]: any;
};

export type NormalizedFeature = {
  type: 'Feature';
  id?: string | number;
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: Record<string, any>;
};

export type NormalizedFeatureCollection = {
  type: 'FeatureCollection';
  features: NormalizedFeature[];
};

export type BBox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
