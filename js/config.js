// Brand palette and application defaults.
// CBRE colours follow the CBRE Guidelines 2021 colour formulas (RGB values are authoritative).
export const CBRE = {
  green: '#003F2D', // CBRE Green (Pantone 3435 C)
  accentGreen: '#17E88F', // Accent Green (Pantone 7479 C)
  darkGreen: '#012A2D',
  darkGrey: '#435254',
  lightGrey: '#CAD1D3',
  midnight: '#032842',
  sage: '#538184',
  celadon: '#80BBAD',
  wheat: '#DBD99A',
  cement: '#7F8480',
  midnightTint: '#778F9C',
  sageTint: '#96B3B6',
  celadonTint: '#C0D4CB',
  wheatTint: '#EFECD2',
  cementTint: '#CBCDCB',
  dataOrange: '#D2785A',
  dataPurple: '#885073',
  dataLightPurple: '#A388BF',
  dataBlue: '#1F3765',
  dataLightBlue: '#3E7CA6',
  negativeRed: '#AD2A2A',
  pageTint: '#F6F6F6',
  dividerGrey: '#C7C8CA',
  textSecondary: '#333333',
  white: '#FFFFFF',
};

export const RING_DEFAULTS = {
  radius: 250,
  unit: 'yd',
  color: CBRE.accentGreen,
  weight: 4,
  dash: 'solid', // solid | dashed | dotted | dashdot
  fill: false,
  fillColor: CBRE.accentGreen,
  fillOpacity: 0.08,
  segments: 128,
};

export const PARCEL_STYLE = {
  outline: { color: CBRE.darkGrey, weight: 1, fill: true, fillColor: CBRE.white, fillOpacity: 0.0 },
  inRing: { color: CBRE.darkGrey, weight: 1.6, fill: true, fillColor: CBRE.white, fillOpacity: 0.0 },
  hover: { color: CBRE.midnight, weight: 3 },
  selected: { color: CBRE.dataOrange, weight: 3 },
  multicareOwned: { color: CBRE.green, weight: 2, fill: true, fillColor: CBRE.green, fillOpacity: 0.45 },
  multicareAffiliate: { color: CBRE.green, weight: 2, fill: true, fillColor: CBRE.celadon, fillOpacity: 0.55 },
  multicareOccupied: { color: CBRE.dataLightBlue, weight: 2 },
};

export const MIN_PARCEL_ZOOM = 15; // parcels in view are fetched at or above this zoom
export const MAX_RING_RADIUS_M = 8047; // 5 miles: keeps result sets manageable

// Published site; the standalone (file://) build loads the weekly assessor extracts from here.
export const SITE_BASE = 'https://justin-tran1.github.io/multicare-parcel-mapping-2026/';

// Only basemaps that need no API key or account: OpenStreetMap's public tile server and the
// U.S. Geological Survey's National Map (public domain). CARTO and Esri basemaps require an
// API key / subscription for use in a product and were removed. USGS tiles stop at zoom 16
// and are upscaled beyond that so parcels can still be inspected at zoom 17-19.
export const BASEMAPS = [
  {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  },
  {
    id: 'usgs-topo',
    name: 'Topographic (USGS)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>' },
  },
  {
    id: 'usgs-imagery',
    name: 'Aerial imagery (USGS)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>' },
  },
  {
    id: 'usgs-imagery-topo',
    name: 'Aerial imagery with labels (USGS)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>' },
  },
];

export const DEFAULT_BASEMAP = 'osm';

// Washington State bounding box (WGS84) used to warn when a location is out of coverage.
export const WA_BBOX = [-124.85, 45.54, -116.91, 49.01];

export const DISCLAIMER =
  '© ' + new Date().getFullYear() + ' CBRE, Inc. All rights reserved. This information has been obtained from sources believed reliable, but has not been verified for accuracy or completeness. ' +
  'You should conduct a careful, independent investigation of the property and verify all information. Any reliance on this information is solely at your own risk. ' +
  'Parcel geometry and attributes are served live from Washington county and city GIS records and reflect the publishing agency’s most recent update.';
