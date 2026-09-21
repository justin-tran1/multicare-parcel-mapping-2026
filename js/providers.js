// Registry of Washington parcel data providers (ArcGIS REST layers published by counties,
// cities, regional agencies and the State). Every provider lists sources in priority order:
//   geometry: true  -> can serve parcel polygons; the first that responds with parcels becomes
//                      primary (a source that answers with no parcels is skipped)
//   enrich: true    -> attribute-only layer joined to the primary by normalized parcel id
// `fields` are ordered candidate field names per normalized attribute (see fields.js); the
// live layer schema is read at runtime, unknown candidates are ignored and name heuristics
// fill any gaps. A candidate list of `false` disables that attribute for the source (used
// where a layer's field would mislead, e.g. Thurston's TAXABLE yes/no flag). `computed`
// derives attributes from sums or differences of fields. `ownerCompose` builds an owner
// name from split organisation / last / first fields. `situsCompose` joins address parts.
//
// Further source options:
//   joinBy: 'ids'   -> attribute table queried by parcel-id list (WHERE <id> IN (...)) instead of
//                      by envelope; `joinField` names the id column when it cannot be inferred
//   static: {...}   -> pre-built extract published with the site (manifest + JSON shards keyed
//                      by normalized parcel number), see scripts/build-pierce-assessor.mjs
//   item: {id,layer}-> ArcGIS Online / Hub item whose service URL is resolved at runtime
//   notesFor: {...} -> caveat text attached to an attribute supplied by the source
//   idCompose: [..] -> parcel number stored in parts (e.g. Major + Minor)
// `zoning` on a provider lists zoning-district polygon layers in precedence order (city source
// of record, then county, then the statewide atlas); parcels take the zoning of the polygon
// containing their label point. `extent` is an approximate lon/lat box used to skip a city
// layer for studies elsewhere; `jurisdictionField` reads the jurisdiction per polygon.
//
// `confidence` records how the endpoint was verified:
//   confirmed -> layer URL and field names observed live (scripts/probe-providers.mjs, run on
//                GitHub's runners on 2026-09-18) or seen verbatim in agency documentation
//   likely    -> URL seen verbatim; fields inferred from the same agency's schema
//   guess     -> plausible endpoint; everything is resolved from the live schema at runtime
// Counties without a provider fall back to the statewide layer (no owner names).

const STATEWIDE_URL = 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0';
const STATEWIDE_FIELDS = {
  parcel_id: ['ORIG_PARCEL_ID', 'PARCEL_ID_NR'],
  owner: ['TAXPAYER_NM', 'OWNER_NM'],
  situs_address: ['SITUS_ADDRESS'],
  situs_city: ['SITUS_CITY_NM'],
  land_value: ['VALUE_LAND'],
  improvement_value: ['VALUE_BLDG'],
  total_value: ['VALUE_TOTAL'],
  use_code: ['LANDUSE_CD'],
  use_description: ['LANDUSE_DESC'],
  assessor_link: ['DATA_LINK', 'ASSESSOR_LINK'],
  county: ['COUNTY_NM'],
};
const STATEWIDE_COMPUTED = { total_value: { sum: ['VALUE_LAND', 'VALUE_BLDG'], label: 'Market land + building value' } };
// Companion table in the same service: county-specific land-use code -> description
// (observed live: CODE "53-1101" -> CODE_DESC "1101 - SINGLE FAMILY DWELLING").
const STATEWIDE_USE_LOOKUP = {
  url: 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/2',
  byField: 'COUNTY_NM',
  keyField: 'CODE',
  valueField: 'CODE_DESC',
  sourceField: 'ORIG_LANDUSE_CD',
  target: 'use_description',
};

/** The statewide layer used as an attribute-only join (values, DOR use, assessor link). */
const STATEWIDE_ENRICH = {
  id: 'wa-current-parcels-enrich',
  geometry: false,
  enrich: true,
  confidence: 'confirmed',
  name: 'Current Parcels (Parcels_2026), attribute join',
  publisher: 'Washington State OCIO Geospatial Program',
  url: STATEWIDE_URL,
  fields: STATEWIDE_FIELDS,
  computed: STATEWIDE_COMPUTED,
  notes: 'Supplies market values, DOR land use and the assessor link where the county layer lacks them.',
};

// ---------------------------------------------------------------------------
// Zoning-district layers
// ---------------------------------------------------------------------------

/** Statewide fallback: the Department of Commerce zoning atlas (every city and county). */
export const WAZA_ZONING = {
  id: 'waza-zones',
  confidence: 'confirmed',
  name: 'Washington Zoning Atlas, zoning districts (all jurisdictions)',
  publisher: 'Washington State Department of Commerce / National Zoning Atlas',
  url: 'https://services6.arcgis.com/tboeqGwETr5ppr5Q/arcgis/rest/services/WAZA_Prototype_Layers/FeatureServer/0',
  fields: { zoning: ['ZoneID'], zoning_description: ['ZoneName'] },
  jurisdictionField: 'Jurisdiction',
  notes: 'Normalized statewide atlas of city and county zoning (2024–2025 vintage) used where the jurisdiction publishes no zoning service; codes can lag recent municipal code amendments. Commerce publishes the atlas under the State open-data terms (RCW 42.56.070(8) restricts commercial use of lists of individuals, which zoning polygons do not contain).',
};

const AUBURN_ZONING = {
  id: 'auburn-zoning',
  confidence: 'confirmed',
  name: 'Zoning (City of Auburn Public map service)',
  publisher: 'City of Auburn GIS',
  url: 'https://gis.auburnwa.gov/mapping/rest/services/Public/Public/MapServer/6',
  fields: { zoning: ['ZONINGNAME'] },
  jurisdiction: 'City of Auburn',
  extent: [-122.34, 47.23, -122.15, 47.37],
  notes: 'ZONINGNAME combines code and label, e.g. "C1 (Light Commercial)".',
};

const PIERCE_ZONING = [
  {
    id: 'tacoma-zoning-2025',
    confidence: 'likely',
    name: 'Zoning Districts 2025 (City of Tacoma Open Data)',
    publisher: 'City of Tacoma Planning & Development Services',
    item: { id: 'e71809b0bb4e4365a478a46117583daf', layer: 0 },
    fields: { zoning: ['Zoning', 'ZONING', 'ZONE', 'Zone_Code', 'ZONECODE'] },
    jurisdiction: 'City of Tacoma',
    extent: [-122.62, 47.13, -122.3, 47.34],
    notes: 'Hub item "Zoning Districts 2025 (Tacoma)"; the hosted layer URL is resolved from the item at run time.',
  },
  {
    id: 'puyallup-zoning',
    confidence: 'likely',
    name: 'Zoning (City of Puyallup ZoningReview map service)',
    publisher: 'City of Puyallup GIS',
    url: 'https://gis.puyallupwa.gov/arcgis/rest/services/PuyViewPlanning/ZoningReviewMService/MapServer/1',
    fields: {},
    jurisdiction: 'City of Puyallup',
    extent: [-122.38, 47.13, -122.22, 47.23],
    notes: 'Field names resolved from the live schema.',
  },
  {
    id: 'lakewood-zoning',
    confidence: 'likely',
    name: 'Lakewood Zoning (City of Lakewood feature service)',
    publisher: 'City of Lakewood GIS',
    url: 'https://egis.lakewood.org/server/rest/services/PL/Lakewood_Zoning_Feature_Service/FeatureServer/0',
    fields: {},
    jurisdiction: 'City of Lakewood',
    extent: [-122.63, 47.1, -122.45, 47.22],
    notes: 'Lakewood Municipal Code Title 17 zoning; field names resolved from the live schema.',
  },
  {
    id: 'fife-zoning',
    confidence: 'likely',
    name: 'City of Fife Zoning View (Fife Open Data)',
    publisher: 'City of Fife GIS',
    item: { id: 'cea255ec7ebf4cfd88434836fa7874f8', layer: 0 },
    fields: {},
    jurisdiction: 'City of Fife',
    extent: [-122.42, 47.2, -122.28, 47.28],
    notes: 'Official zoning map dated June 2025; layer URL resolved from the hub item.',
  },
  AUBURN_ZONING,
  {
    id: 'pierce-county-zoning',
    confidence: 'likely',
    name: 'Zoning and Land Use Designations, unincorporated Pierce County',
    publisher: 'Pierce County Planning & Public Works',
    item: { id: '068b1c905eb1465ab61812e9a8d1032e', layer: 0 },
    fields: { zoning: ['ZON_CUR_CD', 'zon_cur_cd'], zoning_description: ['ZON_CUR_NA', 'zon_cur_na'] },
    jurisdiction: 'Pierce County (unincorporated)',
    notes: 'Adopted zoning for unincorporated Pierce County only (ZON_CUR_CD code, ZON_CUR_NA name); city zoning is not included.',
  },
  WAZA_ZONING,
];

const KING_ZONING = [
  {
    id: 'seattle-zoning-detail',
    confidence: 'confirmed',
    name: 'Current Land Use Zoning Detail (City of Seattle)',
    publisher: 'City of Seattle, Office of Planning & Community Development',
    url: 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Current_Land_Use_Zoning_Detail_2/FeatureServer/0',
    fields: { zoning: ['ZONING', 'ZONELUT'], zoning_description: ['ZONING_DESC', 'ZONELUT_DESC'] },
    jurisdiction: 'City of Seattle',
    extent: [-122.46, 47.47, -122.2, 47.75],
    notes: 'Seattle zoning detail (PDDL licence).',
  },
  {
    id: 'bellevue-zoning',
    confidence: 'likely',
    name: 'Zoning (City of Bellevue)',
    publisher: 'City of Bellevue GIS',
    url: 'https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Zoning/FeatureServer/7',
    fields: { zoning: ['Zoning'], zoning_description: ['ZoningDescription'] },
    jurisdiction: 'City of Bellevue',
    extent: [-122.25, 47.52, -122.06, 47.69],
  },
  {
    id: 'mercer-island-zoning',
    confidence: 'likely',
    name: 'Zoning (City of Mercer Island planning layers)',
    publisher: 'City of Mercer Island',
    url: 'https://services3.arcgis.com/bJ3kuL5CJAvqKrUn/arcgis/rest/services/Mercer_Island_Planning_Layers/FeatureServer/2',
    fields: { zoning: ['ZONING'], zoning_description: ['ZoningDescription'] },
    jurisdiction: 'City of Mercer Island',
    extent: [-122.27, 47.51, -122.19, 47.62],
  },
  {
    id: 'kent-zoning',
    confidence: 'likely',
    name: 'Zoning Districts (City of Kent)',
    publisher: 'City of Kent GIS',
    url: 'https://geoservices.kentwa.gov/public/rest/services/PUBLIC_PLANNING_ZoningDistricts/MapServer/0',
    fields: { zoning: ['Short_Name'], zoning_description: ['Long_Name'] },
    jurisdiction: 'City of Kent',
    extent: [-122.35, 47.32, -122.1, 47.46],
  },
  {
    id: 'federal-way-zoning',
    confidence: 'likely',
    name: 'Zoning (City of Federal Way)',
    publisher: 'City of Federal Way GIS',
    url: 'https://geoportal.cityoffederalway.com/res/rest/services/FW_Land/zoning/MapServer/0',
    fields: { zoning: ['ZONING'] },
    jurisdiction: 'City of Federal Way',
    extent: [-122.42, 47.24, -122.23, 47.37],
  },
  AUBURN_ZONING,
  {
    id: 'king-county-zoning',
    confidence: 'likely',
    name: 'King County zoning, unincorporated (KingCo_Zoning)',
    publisher: 'King County GIS Center / Permitting',
    url: 'https://gismaps.kingcounty.gov/arcgis/rest/services/Planning/KingCo_Zoning/MapServer/1',
    fields: { zoning: ['CURRZONE'], zoning_description: false },
    jurisdiction: 'King County (unincorporated)',
    notes: 'CURRZONE is the current zoning of unincorporated King County; city zoning comes from city layers or the statewide atlas.',
  },
  WAZA_ZONING,
];

const SNOHOMISH_ZONING = [
  {
    id: 'everett-zoning',
    confidence: 'confirmed',
    name: 'Zoning Districts (City of Everett Planning)',
    publisher: 'City of Everett GIS',
    url: 'https://gismaps.everettwa.gov/manarcgis/rest/services/Planning/Planning/MapServer/49',
    fields: { zoning: ['Zone'], zoning_description: ['Zone_Desc'] },
    jurisdiction: 'City of Everett',
    extent: [-122.32, 47.86, -122.11, 48.06],
  },
  {
    id: 'snohomish-county-zoning',
    confidence: 'likely',
    name: 'Zoning polygons, unincorporated Snohomish County (PLANNING zoning_poly)',
    publisher: 'Snohomish County Planning & Development Services',
    item: { id: '7a90035a35f6424785f6e74ed3e49941', layer: 0 },
    fields: {},
    jurisdiction: 'Snohomish County (unincorporated)',
    notes: 'Field names resolved from the live schema.',
  },
  WAZA_ZONING,
];

const SPOKANE_ZONING = [
  {
    id: 'spokane-city-zoning',
    confidence: 'confirmed',
    name: 'Zoning (City of Spokane), SCOUT layers menu',
    publisher: 'City of Spokane / Spokane County GIS (SCOUT)',
    url: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/LayersMenu/MapServer/33',
    fields: { zoning: ['ZoneCode'], zoning_description: ['ZoneLabel'] },
    jurisdiction: 'City of Spokane',
    extent: [-117.56, 47.57, -117.27, 47.77],
  },
  {
    id: 'spokane-valley-zoning',
    confidence: 'confirmed',
    name: 'Zoning (City of Spokane Valley)',
    publisher: 'City of Spokane Valley GIS',
    url: 'https://gis.spokanevalley.org/arcgis/rest/services/Layers/ValleyZoning/FeatureServer/1',
    fields: { zoning: ['Zoning'] },
    jurisdiction: 'City of Spokane Valley',
    extent: [-117.33, 47.59, -117.1, 47.73],
  },
  {
    id: 'spokane-county-zoning',
    confidence: 'confirmed',
    name: 'Zoning District, unincorporated Spokane County (OpenData/Planning)',
    publisher: 'Spokane County Building & Planning',
    url: 'https://gismo.spokanecounty.org/arcgis/rest/services/OpenData/Planning/MapServer/0',
    fields: { zoning: ['ZONECLASS'] },
    jurisdiction: 'Spokane County (unincorporated)',
  },
  WAZA_ZONING,
];

const THURSTON_ZONING = [
  {
    id: 'lacey-area-zoning',
    confidence: 'confirmed',
    name: 'Lacey Area Zoning (Thurston County, UGAs, Lacey, Rainier, Bucoda, Yelm)',
    publisher: 'City of Lacey GIS / Thurston County',
    url: 'https://laceyportal.ci.lacey.wa.us/server/rest/services/base_data/Lacey_Area_Zoning_0822/MapServer/3',
    fields: {},
    notes: 'August 2022 compilation; Olympia and Tumwater are not included (the statewide atlas covers them).',
  },
  WAZA_ZONING,
];

const CLARK_ZONING = [
  {
    id: 'clark-zoning',
    confidence: 'confirmed',
    name: 'Zoning, all Clark County jurisdictions (ClarkView_Public)',
    publisher: 'Clark County GIS',
    url: 'https://gis.clark.wa.gov/arcgisfed/rest/services/ClarkView_Public/Zoning/MapServer/0',
    fields: { zoning: ['ZONING'], zoning_description: ['GRPDESC'] },
    notes: 'Combines the zoning layers of every city and unincorporated Clark County.',
  },
  WAZA_ZONING,
];

const KITSAP_ZONING = [
  {
    id: 'bremerton-zoning',
    confidence: 'likely',
    name: 'Bremerton Zoning (City of Bremerton)',
    publisher: 'City of Bremerton GIS',
    url: 'https://arcgis.bremertonwa.gov/arcgis/rest/services/Bremerton_Zoning/MapServer/0',
    fields: { zoning: ['MAX_ZONE'] },
    jurisdiction: 'City of Bremerton',
    extent: [-122.75, 47.5, -122.55, 47.65],
  },
  WAZA_ZONING,
];

const YAKIMA_ZONING = [
  {
    id: 'yakima-county-zoning',
    confidence: 'confirmed',
    name: 'CountyZoning, unincorporated Yakima County',
    publisher: 'Yakima County Planning',
    url: 'https://maps.yakimacounty.us/server/rest/services/Planning/CountyZoning/MapServer/0',
    fields: {},
    jurisdiction: 'Yakima County (unincorporated)',
    notes: 'Field names resolved from the live schema.',
  },
  WAZA_ZONING,
];

export const STATEWIDE = {
  key: 'wa',
  name: 'Washington State Current Parcels',
  counties: ['*'],
  useCodeScheme: 'dor',
  assessorLink: null,
  zoning: [WAZA_ZONING],
  sources: [
    {
      id: 'wa-current-parcels',
      geometry: true,
      confidence: 'confirmed',
      name: 'Current Parcels (Parcels_2026)',
      publisher: 'Washington State OCIO Geospatial Program / WA Geospatial Open Data',
      url: STATEWIDE_URL,
      fields: STATEWIDE_FIELDS,
      computed: STATEWIDE_COMPUTED,
      lookup: STATEWIDE_USE_LOOKUP,
      notes: 'Normalized DOR schema for all 39 counties, updated April 2026; CORS enabled. Owner names are not published; values are market (not taxable). DATA_LINK opens the county assessor record.',
    },
    {
      id: 'wa-ecology-mirror',
      geometry: true,
      confidence: 'confirmed',
      name: 'Statewide parcels (Ecology mirror)',
      publisher: 'Washington State Department of Ecology',
      url: 'https://gis.ecology.wa.gov/serverext/rest/services/GIS/WetlandsRatingTool/MapServer/123',
      fields: {
        parcel_id: ['PARCEL_ID_NR'],
        situs_address: ['SITUS_ADDRESS'],
        situs_city: ['SITUS_CITY_NM'],
        land_value: ['VALUE_LAND'],
        improvement_value: ['VALUE_BLDG'],
        use_code: ['LANDUSE_CD'],
        assessor_link: ['DATA_LINK'],
        county: ['COUNTY_NM'],
      },
      computed: STATEWIDE_COMPUTED,
      notes: 'Same schema as the State layer (values were not populated when probed); used only if the State layer is unreachable.',
    },
  ],
};

// Pierce County assessor schema shared by the county open-data layer and its regional mirrors
// (observed live). Taxpayer names are withheld from the county's public GIS data
// (RCW 42.56.070(8)); Business_Name is the business operating on the parcel, not its owner.
const PIERCE_COUNTY_FIELDS = {
  parcel_id: ['TaxParcelNumber'],
  owner: ['Taxpayer_Name', 'TaxpayerName'],
  owner_address: ['Delivery_Address'],
  business_name: ['Business_Name'],
  situs_address: ['Site_Address'],
  taxable_value: ['Taxable_Value'],
  land_value: ['Land_Value'],
  improvement_value: ['Improvement_Value'],
  total_value: ['Total_Market_Value'],
  land_acres: ['Land_Acres'],
  use_code: ['Use_Code'],
  use_description: ['Landuse_Description'],
  exemption: ['Exemption_Code'],
};
const PIERCE_COUNTY_COMPUTED = { total_value: { sum: ['Land_Value', 'Improvement_Value'], label: 'Land + improvement value' } };

// Weekly Assessor-Treasurer bulk extract (tax_account, appraisal_account, sale tables) built by
// scripts/build-pierce-assessor.mjs in the deployment workflow and published with the site.
const PIERCE_ASSESSOR_EXTRACT = {
  id: 'pierce-assessor-extract',
  geometry: false,
  enrich: true,
  confidence: 'confirmed',
  name: 'Assessor-Treasurer weekly data extract: deeds (legal owner, last sale), business name, exemption, values',
  publisher: 'Pierce County Assessor-Treasurer Data Downloads, compiled weekly for this map',
  url: 'https://www.piercecountywa.gov/736/Data-Downloads',
  static: { manifest: 'data/assessor/pierce/manifest.json', shard: 'data/assessor/pierce/shards/{prefix}.json', prefixLength: 4 },
  notesFor: { legal_owner: 'grantee on the most recent recorded deed in the Assessor-Treasurer sale file' },
  notes: 'Last sale date, price, deed type, grantor and grantee for every parcel (full recorded history), business name, exemption type and current-year values. No public Pierce County bulk table carries taxpayer names.',
};

// City of Tacoma layer joined to Assessor-Treasurer data (documented; not reachable from
// GitHub's runners when probed, so it is tried first and falls through quickly if blocked).
const TACOMA_FIELDS = {
  parcel_id: ['TaxParcelNumber'],
  owner: ['TAXPAYERNAME', 'TaxpayerName', 'Taxpayer_Name'],
  situs_address: ['SiteAddress', 'Site_Address'],
  taxable_value: ['TaxableValueCurrentYear', 'TaxableValue', 'Taxable_Value', 'TaxableValuePriorYear'],
  land_value: ['LandValueCurrentYear', 'LandValue', 'Land_Value', 'LandValuePriorYear'],
  improvement_value: ['ImprovementValueCurrentYear', 'ImprovementValue', 'Improvement_Value', 'ImprovementValuePriorYear'],
  total_value: ['TotalMarketValueCurrentYear', 'TotalMarketValue', 'TotalMarketValuePriorYear'],
  land_acres: ['LandGrossAcres', 'Land_Acres'],
  // CurrentUseCodeCurrentYear is the RCW 84.34 open-space / farm program code, not land use
  use_code: ['Use_Code'],
  use_description: ['Landuse_Description', 'UseDescription'],
};

// King County assessor schema (parcel_address_area), observed live.
const KING_FIELDS = {
  parcel_id: ['PIN'],
  owner: ['KCTP_NAME'],
  owner_address: ['KCTP_ADDR'],
  situs_address: ['ADDR_FULL'],
  situs_city: ['CTYNAME', 'POSTALCTYNAME'],
  taxable_value: false, // TAX_LNDVAL + TAX_IMPR (computed); TAXVAL_RSN is a reason code
  land_value: ['APPRLNDVAL'],
  improvement_value: ['APPR_IMPR'],
  land_acres: ['KCA_ACRES'],
  land_sqft: ['LOTSQFT'],
  use_code: ['PREUSE_CODE', 'PRESENTUSE'],
  use_description: ['PREUSE_DESC'],
  zoning: ['KCA_ZONING'],
};
const KING_COMPUTED = {
  taxable_value: { sum: ['TAX_LNDVAL', 'TAX_IMPR'], label: 'Taxable land + improvement value' },
  total_value: { sum: ['APPRLNDVAL', 'APPR_IMPR'], label: 'Appraised land + improvement value' },
};

// Snohomish County assessor schema (observed live). USECODE holds "279 Other Printing..."
const SNOHOMISH_FIELDS = {
  parcel_id: ['PARCEL_ID'],
  owner: ['TAXPRNAME', 'OWNERNAME'],
  owner_address: ['TAXPRLINE1', 'OWNERLINE1'],
  situs_address: ['SITUSLINE1'],
  situs_city: ['SITUSCITY'],
  taxable_value: false, // not published; MKTTL (total market) is shown and flagged
  land_value: ['MKLND'],
  improvement_value: ['MKIMP'],
  total_value: ['MKTTL'],
  land_acres: ['TAB_ACRES', 'GIS_ACRES'],
  land_sqft: ['GIS_SQ_FT'],
  use_code: ['USECODE'],
  use_description: ['USEDESC'],
};

// Yakima County assessor Taxlots schema (observed live). USE_CODE holds "11 Single Unit".
const YAKIMA_FIELDS = {
  parcel_id: ['ASSESSOR_N', 'TAXLOT_N', 'PARC'],
  owner: ['ORG_NAME'],
  owner_address: ['MAILING_AD'],
  situs_address: ['SITUS_ADDR'],
  situs_city: ['SITUS_CITY'],
  taxable_value: false,
  land_value: ['MKT_LAND'],
  improvement_value: ['MKT_IMPVT'],
  land_acres: ['ACRES', 'SIZE'],
  land_sqft: false,
  use_code: ['USE_CODE'],
  use_description: false,
};
const YAKIMA_COMPOSE = { org: 'ORG_NAME', last: 'LAST_NAME', first: 'FIRST_NAME', middle: 'MIDDLE_NAME' };
const YAKIMA_COMPUTED = { total_value: { sum: ['MKT_LAND', 'MKT_IMPVT'], label: 'Market land + improvement value' } };

// Clark County public taxlot schema (observed live). No owner name is published (MainOwnerID
// is an internal id); TaxTotVal is the taxable total, MktTotVal the market total.
const CLARK_FIELDS = {
  parcel_id: ['Prop_id', 'prop_id', 'PROP_ID'],
  owner: false,
  owner_address: false,
  situs_address: ['SitusAddrsFull', 'SitusAddrs'],
  situs_city: ['SitusCity'],
  taxable_value: ['TaxTotVal'],
  land_value: ['MktLandVal'],
  improvement_value: ['MktBldgVal'],
  total_value: ['MktTotVal'],
  land_acres: ['AssrAc', 'GISAc'],
  land_sqft: ['AssrSqFt', 'GISSqft'],
  use_code: ['PropertyUseClass', 'Pt1'],
  use_description: ['Pt1Desc'],
  sale_date: ['SaleDate'],
  sale_price: ['SaleAmount'],
  zoning: ['Zone1', 'ZONING', 'Zoning'],
  zoning_description: ['ZoneDesc'],
};

// Thurston County assessor extract (observed live). TAXABLE is a Y/N flag, so the taxable
// value is not published; TOTAL_VALUE is shown and flagged. PROP_TYPE/PROP_SUBTY are codes.
const THURSTON_FIELDS = {
  parcel_id: ['PARCEL_NO', 'ParcelNumber'],
  owner: ['OWNER_NAME', 'OWNER'],
  owner_address: ['ADDRESS1'],
  situs_address: ['SITUS_STRE'],
  situs_city: ['SITUS_CITY'],
  taxable_value: false,
  land_value: ['LAND_VALUE'],
  improvement_value: ['BLDG_VALUE'],
  total_value: ['TOTAL_VALUE', 'TOTAL_VALU'],
  land_acres: ['TOTAL_ACRES', 'TOTAL_ACRE'],
  use_code: false, // county codes are cryptic; the DOR code from the State join is used
  use_description: false,
  sale_date: ['SALE_DATE', 'SaleDate'],
  sale_price: ['SALE_PRICE', 'SalePrice'],
  sale_grantor: ['SELLER_NAM', 'SELLER_NAME', 'SELLER'],
};

// Skagit County assessor schema (observed live). LandUse holds "(120) HOUSEHOLD, 2-4 UNITS".
const SKAGIT_FIELDS = {
  parcel_id: ['PARCELID'],
  owner: ['OwnerName'],
  owner_address: ['OwnerAdd1'],
  situs_address: false, // composed from SitusStNo + SitusStName
  situs_city: ['SitusCSZ'],
  taxable_value: ['TaxableValue'],
  land_value: false, // sum of ImprLandValue + UnimprLandValue + TimberLandValue
  improvement_value: ['BuildingValue'],
  total_value: ['TotalMktValue', 'AssessedValue'],
  land_acres: ['Acres'],
  land_sqft: false,
  use_code: ['LandUse'],
  use_description: false,
  sale_date: ['SaleDate'],
  sale_price: ['SalePrice'],
  sale_deed_type: ['SaleDeedType'],
};
const SKAGIT_COMPUTED = { land_value: { sum: ['ImprLandValue', 'UnimprLandValue', 'TimberLandValue'], label: 'Improved + unimproved + timber land value' } };
const SKAGIT_SITUS = ['SitusStNo', 'SitusStName'];

// Cowlitz County assessor schema (observed live).
const COWLITZ_FIELDS = {
  parcel_id: ['PARCNO', 'ACCOUNTNO'],
  owner: ['DEED_HOLDER_NAME'],
  owner_address: ['DEED_HOLDER_ADDRESS_1', 'DEED_HOLDER_ADDRESS'],
  situs_address: false, // composed from situs parts
  situs_city: ['SITUS_CITY'],
  taxable_value: ['TAXABLE_VALUE'],
  land_value: ['LAND_ASSESSED_VALUE'],
  improvement_value: ['IMPR_ASSESSED_VALUE'],
  total_value: ['TOTAL_ASSESSED_VALUE'],
  land_acres: ['ACRES_TOTAL'],
  use_code: ['USE_CODE'],
  use_description: ['USE_CODE_DESCRIPTION'],
};
const COWLITZ_COMPUTED = { total_value: { sum: ['LAND_ASSESSED_VALUE', 'IMPR_ASSESSED_VALUE'], label: 'Assessed land + improvement value' } };
const COWLITZ_SITUS = ['SITUS_STREET_NUMBER', 'SITUS_STREET_DIRECTION', 'SITUS_STREET_NAME', 'SITUS_STREET_SUFFIX', 'SITUS_STREET_UNIT'];

// Chelan County PACS-joined parcel schema (observed live; SDE-truncated field names).
const CHELAN_FIELDS = {
  parcel_id: ['sde_CHELAN_PACS_TABLE_PID', 'sde_CHELAN_Property_Polygons_pr', 'sde_CHELAN_PACS_TABLE_Geo_ID'],
  owner: ['sde_CHELAN_PACS_TABLE_Owner_Nam'],
  owner_address: ['sde_CHELAN_PACS_TABLE_Address_1'],
  situs_address: ['sde_CHELAN_PACS_TABLE_Site_Addr'],
  situs_city: ['sde_CHELAN_PACS_TABLE_Situs_Cit'],
  land_acres: ['sde_CHELAN_PACS_TABLE_Acres'],
  assessor_link: ['ASSESSORLINK'],
  taxable_value: false,
  land_value: false,
  improvement_value: false,
  total_value: false,
  use_code: false,
  use_description: false,
};

export const PROVIDERS = [
  {
    key: 'pierce',
    name: 'Pierce County',
    counties: ['Pierce'],
    useCodeScheme: 'dor-prefix',
    assessorLink: 'https://atip.piercecountywa.gov/app/v2/propertyDetail/{parcel}/summary',
    zoning: PIERCE_ZONING,
    sources: [
      {
        id: 'tacoma-ats-parcels',
        geometry: true,
        enrich: true,
        confidence: 'likely',
        name: 'Pierce County Tax Parcels with Assessor-Treasurer info (City of Tacoma GIS)',
        publisher: 'City of Tacoma ITD / Pierce County Assessor-Treasurer',
        url: 'https://esgis.tacoma.gov/arcgis/rest/services/Ref/ITD_Basemap/MapServer/2',
        fields: TACOMA_FIELDS,
        notes: 'County-wide parcel polygons joined to Assessor-Treasurer data including taxpayer name and taxable value (documented in the indexed REST directory; the host did not answer GitHub’s runners, so it may be reachable only from some networks).',
      },
      {
        id: 'pierce-tax-parcels',
        geometry: true,
        enrich: true,
        confidence: 'confirmed',
        name: 'Tax Parcels (Pierce County Open GeoSpatial Data Portal)',
        publisher: 'Pierce County Planning & Public Works GIS / Assessor-Treasurer',
        url: 'https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Tax_Parcels/FeatureServer/0',
        fields: PIERCE_COUNTY_FIELDS,
        computed: PIERCE_COUNTY_COMPUTED,
        notes: 'Authoritative county layer (CORS enabled) with taxable value, land acres, use code, land-use description, exemption code and the business name on the parcel; taxpayer names are withheld from county open data.',
      },
      {
        id: 'soundtransit-pierce-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcels, Pierce County (Sound Transit STARS mirror)',
        publisher: 'Sound Transit (mirror of Pierce County data)',
        url: 'https://rtamaps2.soundtransit.org/arcgis/rest/services/STARS_ContextLayers_Parcels/MapServer/1',
        fields: PIERCE_COUNTY_FIELDS,
        computed: PIERCE_COUNTY_COMPUTED,
        notes: 'Regional mirror of the county layer; values may lag the county.',
      },
      PIERCE_ASSESSOR_EXTRACT,
    ],
  },
  {
    key: 'king',
    name: 'King County',
    counties: ['King'],
    useCodeScheme: 'county',
    assessorLink: 'https://blue.kingcounty.com/Assessor/eRealProperty/Dashboard.aspx?ParcelNbr={parcel}',
    zoning: KING_ZONING,
    sources: [
      {
        id: 'king-parcel-address-area',
        geometry: true,
        confidence: 'confirmed',
        name: 'parcel_address_area (King County GIS, Districts/DistrictsReport)',
        publisher: 'King County GIS Center / King County Assessor',
        url: 'https://gismaps.kingcounty.gov/arcgis/rest/services/Districts/DistrictsReport/MapServer/1',
        fields: KING_FIELDS,
        computed: KING_COMPUTED,
        notes: 'County layer with taxpayer name (KCTP_NAME), appraised and taxable land/improvement values, acres and present-use description.',
      },
      {
        id: 'king-parcel-address-pub-area',
        geometry: true,
        enrich: true,
        confidence: 'confirmed',
        name: 'Parcels with address and property information (King County ArcGIS Online)',
        publisher: 'King County GIS Center / King County Assessor',
        url: 'https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_ADDRESS_PUB_AREA_3069/FeatureServer/0',
        fields: { ...KING_FIELDS, owner: false },
        computed: KING_COMPUTED,
        notes: 'Hosted county layer (CORS enabled) with the same values, acres and present use, but without taxpayer names.',
      },
      {
        id: 'king-propertyinfo-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (King County Property/KingCo_PropertyInfo)',
        publisher: 'King County GIS Center',
        url: 'https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/2',
        fields: { ...KING_FIELDS, owner: false, owner_address: false },
        computed: { total_value: KING_COMPUTED.total_value },
        notes: 'Fallback property-themed parcel layer: appraised values, acres and present use; no taxable values or owner.',
      },
      {
        id: 'king-parcel-sales-3yr',
        geometry: false,
        enrich: true,
        confidence: 'confirmed',
        name: 'Parcel sales history, last 3 years (King County Assessor, ArcGIS Online)',
        publisher: 'King County GIS Center / King County Assessor',
        url: 'https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_SALES3YR_AREA_287/FeatureServer/0',
        fields: { parcel_id: ['PIN'], owner: false, situs_address: false, sale_date: ['SaleDate'], sale_price: ['SalePrice'], sale_grantor: ['Sellername', 'SellerName'], legal_owner: ['buyername', 'BuyerName'], use_code: false, use_description: false },
        notesFor: { legal_owner: 'buyer on the most recent recorded sale (King County Assessor sales, last three years)' },
        notes: 'One feature per recorded sale (excise affidavit) in the last three years: sale date, price, seller and buyer names.',
      },
      {
        id: 'king-propertyinfo-sales',
        geometry: false,
        enrich: true,
        confidence: 'confirmed',
        name: 'Property sales in the last 3 years (King County Property/KingCo_PropertyInfo)',
        publisher: 'King County GIS Center / King County Assessor',
        url: 'https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/3',
        fields: { parcel_id: ['PIN'], owner: false, situs_address: false, sale_date: ['SaleDate'], sale_price: ['SalePrice'], sale_grantor: ['Sellername', 'SellerName'], legal_owner: ['buyername', 'BuyerName'], use_code: false, use_description: false },
        notesFor: { legal_owner: 'buyer on the most recent recorded sale (King County Assessor sales, last three years)' },
        notes: 'County-hosted twin of the sales layer, used when the hosted copy is unavailable.',
      },
    ],
  },
  {
    key: 'snohomish',
    name: 'Snohomish County',
    counties: ['Snohomish'],
    useCodeScheme: 'county',
    assessorLink: 'https://www.snoco.org/proptax/search.aspx?parcel_number={parcel}',
    zoning: SNOHOMISH_ZONING,
    sources: [
      {
        id: 'snoco-open-data-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (Snohomish County Open Data, ArcGIS Online)',
        publisher: 'Snohomish County GIS / Assessor',
        url: 'https://services6.arcgis.com/z6WYi9VRHfgwgtyW/ArcGIS/rest/services/Parcels/FeatureServer/0',
        fields: SNOHOMISH_FIELDS,
        notes: 'Taxpayer of record and owner names, market land/improvement/total values (no taxable value field), acres, lot square feet and use code; CORS enabled.',
      },
      {
        id: 'snoco-tax-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcels (Snohomish County Cadastral)',
        publisher: 'Snohomish County GIS / Assessor',
        url: 'https://gis.snoco.org/sis/rest/services/Cadastral/Tax_Parcels/MapServer/0',
        fields: SNOHOMISH_FIELDS,
        notes: 'County-hosted layer with the same assessor schema.',
      },
      {
        id: 'soundtransit-snohomish-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcels, Snohomish County (Sound Transit STARS mirror)',
        publisher: 'Sound Transit (mirror of Snohomish County data)',
        url: 'https://rtamaps2.soundtransit.org/arcgis/rest/services/STARS_ContextLayers_Parcels/MapServer/2',
        fields: SNOHOMISH_FIELDS,
        notes: 'Regional mirror with the same schema; values may lag the county.',
      },
      {
        id: 'snoco-recent-sales',
        geometry: false,
        enrich: true,
        confidence: 'confirmed',
        name: 'Recent Property Sales (Snohomish County Assessor, ArcGIS Online)',
        publisher: 'Snohomish County Assessor / GIS',
        url: 'https://services6.arcgis.com/z6WYi9VRHfgwgtyW/arcgis/rest/services/Recent_Property_Sales/FeatureServer/0',
        fields: { parcel_id: ['PARCEL_ID'], owner: false, situs_address: false, sale_date: ['TRNSF_DATE'], sale_price: ['SALE_PRICE'], use_code: false, use_description: false },
        notes: 'Quarterly snapshot of recent sales; the transfer date is published to month precision (e.g. "Jun-2026").',
      },
    ],
  },
  {
    key: 'spokane',
    name: 'Spokane County',
    counties: ['Spokane'],
    useCodeScheme: 'dor-prefix',
    assessorLink: 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID={parcel}',
    zoning: SPOKANE_ZONING,
    sources: [
      {
        id: 'spokane-open-data-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (Spokane County Open Data, ArcGIS Online)',
        publisher: 'Spokane County GIS / Assessor',
        url: 'https://services1.arcgis.com/ozNll27nt9ZtPWOn/arcgis/rest/services/Parcels/FeatureServer/0',
        fields: {
          parcel_id: ['PID_NUM', 'parcel'],
          owner: false,
          situs_address: ['site_address'],
          situs_city: ['site_city'],
          taxable_value: ['taxable_amt'],
          land_value: ['land_value'],
          total_value: ['assessed_amt'],
          land_acres: ['acreage'],
          use_code: ['prop_use_code'],
          use_description: ['prop_use_desc'],
        },
        computed: { improvement_value: { diff: ['assessed_amt', 'land_value'], label: 'Assessed total minus land value' } },
        notes: 'County parcels (CORS enabled) with taxable and assessed values, acreage, and property-use code and description. Owner names come from the SCOUT join.',
      },
      {
        id: 'spokane-scout-property-lookup',
        geometry: false,
        enrich: true,
        confidence: 'confirmed',
        name: 'SCOUT Property Lookup (Spokane County), owner join',
        publisher: 'Spokane County GIS (SCOUT)',
        url: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/PropertyLookup/MapServer/0',
        fields: { parcel_id: ['PID_NUM'], owner: ['owner_name'], situs_address: ['site_address'], situs_city: ['site_city'], land_acres: ['acreage'], use_description: ['prop_use_desc'], sale_date: ['document_date'], sale_price: ['gross_sale_price'], sale_deed_type: ['transfer_type'] },
        notes: 'Owner name, use description, acreage and the most recent sale (document date, gross sale price, transfer type) keyed by parcel number.',
      },
      {
        id: 'spokane-scout-queries',
        geometry: true,
        enrich: true,
        confidence: 'confirmed',
        name: 'SCOUT Queries, Parcels (Spokane County)',
        publisher: 'Spokane County GIS (SCOUT)',
        url: 'https://gismo.spokanecounty.org/arcgis/rest/services/SCOUT/Queries/MapServer/2',
        fields: { parcel_id: ['PID_NUM'], owner: ['owner_name'], situs_address: ['site_address'] },
        notes: 'Parcel polygons with owner name and site address; geometry fallback and owner join.',
      },
      {
        id: 'spokane-assessor-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (Spokane County Assessor, Parcels_GISCORE)',
        publisher: 'Spokane County Assessor / Spokane County GIS',
        url: 'https://gismo.spokanecounty.org/arcgis/rest/services/Assessor/Parcels/MapServer/0',
        fields: { parcel_id: ['PID_NUM', 'PID'], owner: false, situs_address: ['site_address'], situs_city: ['site_city'], land_acres: ['acreage'] },
        notes: 'County-hosted assessor parcel geometry with situs and acreage; values come from the hosted layer.',
      },
    ],
  },
  {
    key: 'thurston',
    name: 'Thurston County',
    counties: ['Thurston'],
    useCodeScheme: 'dor',
    assessorLink: 'https://tcproperty.co.thurston.wa.us/propsql/basic.asp?fe=PR&pn={parcel}',
    zoning: THURSTON_ZONING,
    sources: [
      {
        id: 'thurston-enterprise-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcel Boundaries (Thurston County Enterprise, Common_Layers)',
        publisher: 'Thurston County / Assessor',
        url: 'https://tconline.co.thurston.wa.us/server/rest/services/Common_Layers/Parcels/FeatureServer/4',
        fields: THURSTON_FIELDS,
        notes: 'County parcels with owner name, land/building/total values and acreage; taxable value is not published (TAXABLE is a flag).',
      },
      {
        id: 'thurston-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Thurston Parcels (Thurston GeoData Center)',
        publisher: 'Thurston County GeoData Center / Assessor',
        url: 'https://map.co.thurston.wa.us/arcgis/rest/services/Thurston/Thurston_Parcels/FeatureServer/0',
        fields: { ...THURSTON_FIELDS, owner: false },
        notes: 'Older county layer with the same extract but without owner names.',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'yakima',
    name: 'Yakima County',
    counties: ['Yakima'],
    useCodeScheme: 'dor',
    assessorLink: null,
    zoning: YAKIMA_ZONING,
    sources: [
      {
        id: 'yakima-taxlots',
        geometry: true,
        confidence: 'confirmed',
        name: 'Taxlots (Yakima County Assessor)',
        publisher: 'Yakima County GIS / Assessor',
        url: 'https://maps.yakimacounty.us/server/rest/services/Assessor/Taxlots/FeatureServer/2',
        fields: YAKIMA_FIELDS,
        ownerCompose: YAKIMA_COMPOSE,
        computed: YAKIMA_COMPUTED,
        notes: 'Current tax-roll taxlots with organisation or individual owner names, market values, acres, and DOR use code with description.',
      },
      {
        id: 'yakima-sales',
        geometry: false,
        enrich: true,
        joinBy: 'ids',
        joinField: 'ASSESSOR_N',
        confidence: 'likely',
        name: 'Sales, recent assessment year (Yakima County Assessor)',
        publisher: 'Yakima County GIS / Assessor',
        url: 'https://maps.yakimacounty.us/server/rest/services/Assessor/Sales/FeatureServer/11',
        fields: { parcel_id: ['ASSESSOR_N'], owner: false, situs_address: false, sale_date: ['DOCUMENT_D'], sale_price: ['GROSS_SALE'], use_code: false, use_description: false },
        notesFor: { sale_date: 'from the assessor\'s recent-year sales layer; older sales are not in this layer' },
        notes: 'Recorded sales by assessor number (document date, gross sale price) for the assessor\'s most recent sales year only, so a parcel without a recent sale shows none; joined by parcel-number list.',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'kitsap',
    name: 'Kitsap County',
    counties: ['Kitsap'],
    useCodeScheme: 'dor',
    assessorLink: 'https://psearch.kitsap.gov/pdetails/Details?parcel={parcel}&page=general',
    zoning: KITSAP_ZONING,
    sources: [
      {
        id: 'kitsap-health-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Kitsap Parcels (Kitsap Public Health District GIS)',
        publisher: 'Kitsap Public Health District (county parcel data)',
        url: 'https://secure.kitsappublichealth.org/agsserver/rest/services/KPHDGISPUB/KitsapParcelsPub/MapServer/0',
        fields: { parcel_id: ['ACCT_NO', 'RP_ACCT_ID', 'TaxID'], owner: ['OWNER'], situs_address: ['Address'], assessor_link: false, taxable_value: false, land_value: false, improvement_value: false, total_value: false, land_acres: false, use_code: false, use_description: false },
        notes: 'Parcel boundaries with owner name and address; values and land use come from the State join.',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'clark',
    name: 'Clark County',
    counties: ['Clark'],
    useCodeScheme: 'county',
    assessorLink: 'https://gis.clark.wa.gov/gishome/Property/?pid=findSN&account={parcel}',
    zoning: CLARK_ZONING,
    sources: [
      {
        id: 'clark-taxlots-public',
        geometry: true,
        confidence: 'confirmed',
        name: 'Taxlots for Public Use (Clark County GIS)',
        publisher: 'Clark County GIS / Assessor',
        url: 'https://services2.arcgis.com/ylxwjFBdCPBzP16d/arcgis/rest/services/TaxlotsforPublicUse/FeatureServer/0',
        fields: CLARK_FIELDS,
        notes: 'County taxlots (CORS enabled) with taxable and market values, assessor acres and property use; owner names are not published on this layer.',
      },
    ],
  },
  {
    key: 'whatcom',
    name: 'Whatcom County',
    counties: ['Whatcom'],
    useCodeScheme: 'county',
    assessorLink: 'https://property.whatcomcounty.us/propertyaccess/Property.aspx?cid=0&prop_id={parcel}',
    sources: [
      {
        id: 'whatcom-property-parcels',
        geometry: true,
        confidence: 'likely',
        name: 'Public Tax Parcels (Whatcom County Property service)',
        publisher: 'Whatcom County GIS / Assessor',
        url: 'https://gis.whatcomcounty.us/arcgis/rest/services/EnterprisePublishing/WhatcomCo_Property/MapServer/1',
        fields: {
          parcel_id: ['geo_id', 'prop_id'],
          owner: ['tax_payer_name_full', 'tax_payer_name'],
          legal_owner: ['title_owner_name_full', 'title_owner_name'],
          owner_address: ['tax_payer_add_full'],
          situs_city: ['situs_city'],
          taxable_value: ['taxable_val_total'],
          land_value: ['market_land_val', 'appraised_land_val'],
          improvement_value: ['market_improvement_val', 'appraised_improvement_val'],
          total_value: ['appraised_val_total'],
          land_acres: ['legal_acreage'],
          use_code: ['property_use_cd'],
          use_description: ['property_use_description'],
        },
        situsCompose: ['situs_num', 'situs_street_prefix', 'situs_street', 'situs_unit'],
        linkIdField: 'prop_id',
        notes: 'Documented PACS-joined layer (taxpayer name, taxable and market values, legal acreage, property use). The service was stopped when probed; the State layer covers Whatcom until it returns.',
      },
    ],
  },
  {
    key: 'skagit',
    name: 'Skagit County',
    counties: ['Skagit'],
    useCodeScheme: 'county',
    assessorLink: 'https://www.skagitcounty.net/Search/Property/?id={parcel}',
    sources: [
      {
        id: 'skagit-tax-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcels (Skagit County GIS portal)',
        publisher: 'Skagit County GIS / Assessor',
        url: 'https://geo.skagitcountywa.gov/server/rest/services/PortalServiceLayers/Tax_Parcels/MapServer/0',
        fields: SKAGIT_FIELDS,
        situsCompose: SKAGIT_SITUS,
        computed: SKAGIT_COMPUTED,
        notes: 'County parcels with owner, taxable value, building and land values, acres and land use (code with description).',
      },
      {
        id: 'skagit-assessor-open-data',
        geometry: true,
        confidence: 'confirmed',
        name: 'Assessor Data Parcels (Skagit County Open Data)',
        publisher: 'Skagit County GIS',
        url: 'https://gis.skagitcountywa.gov/arcgis/rest/services/OpenData/AssessorDataParcels/FeatureServer/0',
        fields: SKAGIT_FIELDS,
        situsCompose: SKAGIT_SITUS,
        computed: SKAGIT_COMPUTED,
        notes: 'Same schema on the county open-data server.',
      },
    ],
  },
  {
    key: 'cowlitz',
    name: 'Cowlitz County',
    counties: ['Cowlitz'],
    useCodeScheme: 'county',
    assessorLink: 'https://cowlitzinfo.net/CowlitzPropertyApp/CowlitzPropertyApp/Zoner/property_detail?prop_id={parcel}',
    sources: [
      {
        id: 'cowlitz-assessor-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (Cowlitz County Assessor service)',
        publisher: 'Cowlitz County GIS / Assessor',
        url: 'https://gis.cowlitzwa.gov/ccserver/rest/services/Assessor/Parcels/MapServer/0',
        fields: { ...COWLITZ_FIELDS, taxable_value: false, total_value: false },
        situsCompose: COWLITZ_SITUS,
        computed: COWLITZ_COMPUTED,
        notes: 'Assessor-maintained parcels with deed holder, assessed land and improvement values, total acres and use code with description.',
      },
      {
        id: 'cowlitz-cadastral-parcels',
        geometry: true,
        confidence: 'likely',
        name: 'Parcels (Cowlitz County Cadastral)',
        publisher: 'Cowlitz County GIS / Assessor',
        url: 'https://cowlitzgis.net/ccserver/rest/services/Cadastral/Parcels/MapServer/0',
        fields: COWLITZ_FIELDS,
        situsCompose: COWLITZ_SITUS,
        computed: COWLITZ_COMPUTED,
        notes: 'Alternate county host documented with a taxable value field; did not answer when probed.',
      },
      {
        id: 'cowlitz-sales-by-parcel',
        geometry: false,
        enrich: true,
        joinBy: 'ids',
        confidence: 'guess',
        name: 'Sales By Parcel (Cowlitz County Assessor service)',
        publisher: 'Cowlitz County GIS / Assessor',
        url: 'https://gis.cowlitzwa.gov/ccserver/rest/services/Assessor/Sales_By_Parcel/MapServer/0',
        fields: { owner: false, situs_address: false, use_code: false, use_description: false },
        notes: 'Documented assessor sales layer; parcel-number and sale fields are resolved from the live schema.',
      },
    ],
  },
  {
    key: 'clallam',
    name: 'Clallam County',
    counties: ['Clallam'],
    useCodeScheme: 'dor',
    assessorLink: null,
    sources: [
      {
        id: 'clallam-parcelmap',
        geometry: true,
        confidence: 'likely',
        name: 'Parcels (Clallam County ParcelMap)',
        publisher: 'Clallam County GIS / Assessor',
        url: 'https://websrv19.clallam.net/arcgis/rest/services/ParcelMap/MapServer/2',
        fields: { parcel_id: ['PNUM'], situs_address: ['SITUS_ADDR', 'SITUS'], land_acres: ['ACRES_GIS', 'ACRES_SURV'], land_sqft: ['AREA_SF'], use_code: false, use_description: false },
        ownerCompose: { last: 'OWN_LAST', first: 'OWN_FIRST' },
        notes: 'Documented county parcels with owner last/first name; did not answer when probed. Values and land use come from the State join.',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'mason',
    name: 'Mason County',
    counties: ['Mason'],
    useCodeScheme: 'dor',
    assessorLink: 'https://property.masoncountywa.gov/TaxSifter/Assessor.aspx?parcelNumber={parcel}',
    sources: [
      {
        id: 'mason-smartgov-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax parcels (Mason County SmartGov layer)',
        publisher: 'Mason County GIS',
        url: 'https://gis.masoncountywa.gov/arcgis/rest/services/Smartgov/SmartgovLayer/MapServer/0',
        fields: {
          parcel_id: ['PIN', 'PARCEL_NO'],
          owner: ['OWNER_NAME'],
          situs_address: ['SitusAddr'],
          situs_city: ['CITY'],
          taxable_value: ['TAX_VALUE'],
          total_value: ['MARKET_VAL'],
          land_acres: ['TOT_ACRES'],
          use_code: false,
          use_description: false,
        },
        notes: 'County parcels with owner name, taxable and market values and acres (observed live; no pagination support, so the app pages by object id). Land use comes from the State join.',
      },
      {
        id: 'mason-tax-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcels (Mason County parcel viewer)',
        publisher: 'Mason County GIS',
        url: 'https://gis.masoncountywa.gov/arcgis/rest/services/MasonCoSite/TaxParcels/MapServer/0',
        fields: { parcel_id: ['PIN', 'PARCEL_NO'], situs_address: ['Address1'], situs_city: ['City'], land_acres: ['TotalAcres'], use_code: false, use_description: false },
        notes: 'Public parcel polygons; attributes resolved at run time.',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'lewis',
    name: 'Lewis County',
    counties: ['Lewis'],
    useCodeScheme: 'county',
    assessorLink: 'https://parcels.lewiscountywa.gov/{parcel}',
    sources: [
      {
        id: 'lewis-base-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (Lewis County public base layers)',
        publisher: 'Lewis County GIS / Assessor',
        url: 'https://arcgis.lewiscountywa.gov/arcgispublic/rest/services/Public/BaseLayers/MapServer/0',
        fields: {
          parcel_id: ['PIN'],
          owner: ['OWNER'],
          owner_address: ['MAILADD'],
          situs_address: ['SITEADD'],
          taxable_value: false,
          land_value: ['VAL_LAND'],
          improvement_value: ['VAL_IMPVT'],
          total_value: ['VAL_TOTAL'],
          land_acres: ['TOTAL_ACRE'],
          use_code: ['PROP_TYPE'],
          use_description: ['USE_DESC', 'LUNAME'],
        },
        notes: 'County parcels with owner, land/improvement/total values, acres and use description (observed live).',
      },
    ],
  },
  {
    key: 'chelan',
    name: 'Chelan County',
    counties: ['Chelan'],
    useCodeScheme: 'dor',
    assessorLink: null,
    sources: [
      {
        id: 'wenatchee-chelan-parcels',
        geometry: true,
        enrich: true,
        confidence: 'confirmed',
        name: 'Chelan County Parcel Layer (City of Wenatchee GIS)',
        publisher: 'City of Wenatchee (Chelan County PACS data)',
        url: 'https://maps.wenatcheewa.gov/server/rest/services/Parcels/MapServer/0',
        fields: CHELAN_FIELDS,
        notes: 'Weekly copy of the county parcel layer with owner name, situs, acres and the assessor link (observed live).',
      },
      {
        id: 'chelan-parcels-owners',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels with owners (Chelan County Atlas)',
        publisher: 'Chelan County GIS / Assessor (PACS)',
        url: 'https://atlas.co.chelan.wa.us/arcgis/rest/services/GIS/ParcelsOwners/MapServer/0',
        fields: { ...CHELAN_FIELDS, land_acres: false, assessor_link: false, owner_address: false },
        notes: 'County parcels joined to PACS owner name and site address (observed live).',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'island',
    name: 'Island County',
    counties: ['Island'],
    useCodeScheme: 'county',
    assessorLink: null,
    sources: [
      {
        id: 'island-base-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (Island County Geocortex base)',
        publisher: 'Island County GIS / Assessor',
        url: 'https://maps.islandcountywa.gov/arcgis/rest/services/Geocortex/Base/MapServer/0',
        fields: {
          parcel_id: ['ParcelNo', 'PID'],
          owner: ['taxpayer'],
          owner_address: ['mailing_addr1'],
          situs_address: ['physical_addr'],
          situs_city: ['physical_addr_city'],
          taxable_value: false,
          land_value: ['land_value'],
          improvement_value: ['improvement_value'],
          total_value: ['assessed_value', 'market_value'],
          land_acres: ['legal_acreage', 'GIS_Acres'],
          use_code: ['property_land_use_code'],
          use_description: false,
          assessor_link: ['smartgov_url'],
        },
        notes: 'Assessor-managed parcels with taxpayer, values, acreage and land-use code (observed live).',
      },
      {
        id: 'island-qualified-sales',
        geometry: false,
        enrich: true,
        joinBy: 'ids',
        joinField: 'ParcelNo',
        confidence: 'confirmed',
        name: 'Qualified Sales (Island County Assessor)',
        publisher: 'Island County GIS / Assessor',
        url: 'https://maps.islandcountywa.gov/arcgis/rest/services/AssessorFiles/QualifiedSales/MapServer/1',
        fields: { parcel_id: ['ParcelNo', 'PID'], owner: false, situs_address: false, sale_date: ['sale_date'], sale_price: ['sale_price'], use_code: false, use_description: false, land_acres: false },
        notes: 'Arm’s-length (ratio-study) sales only; non-qualified transfers are not listed.',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'walla_walla',
    name: 'Walla Walla County',
    counties: ['Walla Walla'],
    useCodeScheme: 'dor',
    assessorLink: null,
    sources: [
      { ...STATEWIDE.sources[0], id: 'wa-current-parcels-walla-walla' },
      {
        id: 'wallawalla-parcels-cp',
        geometry: false,
        enrich: true,
        confidence: 'confirmed',
        name: 'Parcels, College Place (Walla Walla County)',
        publisher: 'Walla Walla County GIS / Assessor',
        url: 'https://services1.arcgis.com/1Wj8xAact2ptcedL/arcgis/rest/services/Parcels_CP/FeatureServer/0',
        fields: { parcel_id: ['PARCEL'], owner: ['OWNER'], situs_address: ['Address'], land_acres: ['Acreage'], assessor_link: ['PACSLINK'] },
        notes: 'Covers the City of College Place only; joined for owner and acreage where available.',
      },
    ],
  },
  {
    key: 'franklin',
    name: 'Franklin County',
    counties: ['Franklin'],
    useCodeScheme: 'dor',
    assessorLink: 'http://terra.co.franklin.wa.us/TaxSifter/Search/Results.aspx?q={parcel}',
    sources: [
      {
        id: 'franklin-parcels-owner',
        geometry: true,
        confidence: 'likely',
        name: 'Parcels with Owner Name (Franklin County Assessor)',
        publisher: 'Franklin County GIS / Assessor',
        url: 'https://gisportal.franklin.co.franklin.wa.us/arcgis/rest/services/assessor/Parcels_with_Owner_Name/MapServer/0',
        fields: { parcel_id: ['ParcelNumber', 'ParcelID'] },
        notes: 'Documented assessor parcel layer with owner names; the server returned errors when probed, so the State layer covers Franklin until it returns.',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'benton',
    name: 'Benton County',
    counties: ['Benton'],
    useCodeScheme: 'dor',
    assessorLink: 'https://property.spatialest.com/wa/benton#/property/{parcel}',
    sources: [
      {
        id: 'benton-parcels-assess',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels and Assessment (Benton County ArcGIS Online)',
        publisher: 'Benton County GIS / Assessor',
        url: 'https://services7.arcgis.com/NURlY7V8UHl6XumF/ArcGIS/rest/services/Parcels_and_Assess/FeatureServer/0',
        fields: {
          parcel_id: ['Parcel_ID'],
          owner: ['owner_name'],
          owner_address: ['owner_address'],
          situs_address: ['situs_address'],
          taxable_value: false,
          land_value: ['LandVal'],
          improvement_value: ['imprv_val'],
          total_value: ['appraised_val'],
          land_acres: ['legal_acres'],
          land_sqft: ['land_sqft'],
          use_code: ['primary_use'],
          use_description: false,
        },
        linkIdField: 'Prop_ID',
        notes: 'County parcels (CORS enabled) with owner, appraised values, legal acres and primary use (observed live).',
      },
      STATEWIDE_ENRICH,
    ],
  },
  {
    key: 'kittitas',
    name: 'Kittitas County',
    counties: ['Kittitas'],
    useCodeScheme: 'county',
    assessorLink: 'https://taxsifter.co.kittitas.wa.us/Assessor.aspx?parcelNumber={parcel}&typeID=1',
    sources: [
      {
        id: 'kittitas-taxparcel-query',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcel Query (Kittitas County COMPAS)',
        publisher: 'Kittitas County GIS / Assessor',
        url: 'https://gis.co.kittitas.wa.us/kcgis/rest/services/COMPAS/TaxParcelQuery/MapServer/0',
        fields: {
          parcel_id: ['PARCELID', 't2_ParcelNumber'],
          owner: ['t2_Owner'],
          owner_address: ['t2_Address1'],
          situs_address: ['t2_Situs'],
          situs_city: false, // t2_SitusCity holds suite numbers on this layer
          taxable_value: false,
          improvement_value: ['t2_ValueImp'],
          use_description: ['landuse_name'],
          assessor_link: false,
        },
        notes: 'Parcel query layer behind the county property dashboard: owner, situs, land-use name (observed live).',
      },
      {
        id: 'kittitas-open-data-parcels',
        geometry: true,
        enrich: true,
        confidence: 'confirmed',
        name: 'Tax Parcels (Kittitas County Open Data)',
        publisher: 'Kittitas County GIS',
        url: 'https://gis.co.kittitas.wa.us/kcgis/rest/services/OpenData/Parcels/MapServer/1',
        fields: {
          parcel_id: ['PARCELID', 't2_parcelNumber'],
          owner: ['t2_Owner'],
          situs_address: ['t2_Situs'],
          situs_city: ['t2_SitusCity'],
          taxable_value: false,
          land_value: ['t2_ValueLand'],
          improvement_value: ['t2_MarketBuildingValue', 't2_ValueImp'],
          total_value: ['t2_ValueMrkt'],
          use_code: ['t2_SecondaryLandUse'],
        },
        notes: 'Open-data parcel layer with land, building and market values (observed live); joined for values.',
      },
      STATEWIDE_ENRICH,
    ],
  },
];

/** Providers whose county list includes `county` (case-insensitive). */
export function providersForCounty(county) {
  const c = String(county || '').trim().toLowerCase();
  return PROVIDERS.filter((p) => p.counties.some((n) => n.toLowerCase() === c));
}

export function allProviders() {
  return [...PROVIDERS, STATEWIDE];
}
