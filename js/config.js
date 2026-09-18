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

export const BASEMAPS = [
  {
    id: 'carto-light',
    name: 'Light (CARTO Positron)',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    options: { subdomains: 'abcd', maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  },
  {
    id: 'carto-light-nolabels',
    name: 'Light, no labels (CARTO)',
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    options: { subdomains: 'abcd', maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  },
  {
    id: 'carto-voyager',
    name: 'Streets (CARTO Voyager)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: { subdomains: 'abcd', maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  },
  {
    id: 'carto-dark',
    name: 'Dark (CARTO Dark Matter)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: { subdomains: 'abcd', maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  },
  {
    id: 'esri-gray',
    name: 'Light Gray Canvas (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 16, attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ' },
    overlay: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  },
  {
    id: 'esri-streets',
    name: 'Streets (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012' },
  },
  {
    id: 'esri-imagery',
    name: 'Aerial imagery (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community' },
    overlay: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  {
    id: 'esri-topo',
    name: 'Topographic (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community' },
  },
  {
    id: 'usgs-imagery',
    name: 'Aerial imagery (USGS)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 16, attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>' },
  },
  {
    id: 'usgs-topo',
    name: 'Topographic (USGS)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 16, attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>' },
  },
];

export const DEFAULT_BASEMAP = 'carto-light';

// Washington State bounding box (WGS84) used to warn when a location is out of coverage.
export const WA_BBOX = [-124.85, 45.54, -116.91, 49.01];

export const DISCLAIMER =
  '© ' + new Date().getFullYear() + ' CBRE, Inc. All rights reserved. This information has been obtained from sources believed reliable, but has not been verified for accuracy or completeness. ' +
  'You should conduct a careful, independent investigation of the property and verify all information. Any reliance on this information is solely at your own risk. ' +
  'Parcel geometry and attributes are served live from Washington county and city GIS records and reflect the publishing agency’s most recent update.';
