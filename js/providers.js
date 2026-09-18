// Registry of Washington parcel data providers (ArcGIS REST layers published by counties,
// cities, regional agencies and the State). Every provider lists sources in priority order:
//   geometry: true  -> can serve parcel polygons; the first that responds becomes primary
//   enrich: true    -> attribute-only layer joined to the primary by normalized parcel id
// `fields` are ordered candidate field names per normalized attribute (see fields.js); the
// live layer schema is read at runtime, unknown candidates are ignored and name heuristics
// fill any gaps. `computed` derives attributes from sums of fields. `ownerCompose` builds an
// owner name from split organisation / last / first fields.
//
// `confidence` records how the endpoint was verified while this app was built:
//   confirmed -> exact layer URL and the listed field names were seen verbatim in indexed
//                ArcGIS REST directory pages, agency metadata, or working client code
//   likely    -> URL seen verbatim; field names inferred from the same agency's schema
//   guess     -> plausible endpoint; everything is resolved from the live schema at runtime
// Counties without a provider fall back to the statewide layer (no owner names).

export const STATEWIDE = {
  key: 'wa',
  name: 'Washington State Current Parcels',
  counties: ['*'],
  useCodeScheme: 'dor',
  assessorLink: null,
  sources: [
    {
      id: 'wa-current-parcels',
      geometry: true,
      confidence: 'confirmed',
      name: 'Current Parcels (Parcels_2026)',
      publisher: 'Washington State OCIO Geospatial Program / WA Geospatial Open Data',
      url: 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0',
      fields: {
        parcel_id: ['ORIG_PARCEL_ID', 'PARCEL_ID_NR'],
        owner: [],
        situs_address: ['SITUS_ADDRESS'],
        situs_city: ['SITUS_CITY_NM'],
        land_value: ['VALUE_LAND'],
        improvement_value: ['VALUE_BLDG'],
        use_code: ['LANDUSE_CD'],
        assessor_link: ['DATA_LINK'],
        county: ['COUNTY_NM'],
      },
      computed: { total_value: { sum: ['VALUE_LAND', 'VALUE_BLDG'], label: 'Market land + building value' } },
      notes: 'Normalized DOR schema for all 39 counties, updated April 2026. Owner/taxpayer names are not published on this layer; values are market (not taxable). DATA_LINK opens the county assessor record.',
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
      computed: { total_value: { sum: ['VALUE_LAND', 'VALUE_BLDG'], label: 'Market land + building value' } },
      notes: 'Same schema as the State layer; vintage may lag. Used only if the State layer is unreachable.',
    },
  ],
};

// Pierce County assessor schema shared by the county open-data layer and its regional mirrors.
const PIERCE_COUNTY_FIELDS = {
  parcel_id: ['TaxParcelNumber'],
  owner: ['Taxpayer_Name', 'Business_Name'],
  owner_address: ['Delivery_Address'],
  situs_address: ['Site_Address'],
  taxable_value: ['Taxable_Value'],
  land_value: ['Land_Value'],
  improvement_value: ['Improvement_Value'],
  total_value: ['Total_Market_Value'],
  land_acres: ['Land_Acres'],
  use_code: ['Use_Code'],
  use_description: ['Landuse_Description'],
};

// King County assessor schema (parcel_address_area) shared by county layers and city mirrors.
const KING_FIELDS = {
  parcel_id: ['PIN'],
  owner: ['KCTP_NAME', 'TAXPAYERNAME'],
  owner_address: ['KCTP_ADDR'],
  situs_address: ['ADDR_FULL'],
  situs_city: ['CTYNAME', 'POSTALCTYNAME'],
  land_value: ['APPRLNDVAL'],
  improvement_value: ['APPR_IMPR'],
  land_acres: ['KCA_ACRES'],
  land_sqft: ['LOTSQFT'],
  use_code: ['PREUSE_CODE', 'PRESENTUSE'],
  use_description: ['PREUSE_DESC'],
};
const KING_COMPUTED = {
  taxable_value: { sum: ['TAX_LNDVAL', 'TAX_IMPR'], label: 'Taxable land + improvement value' },
  total_value: { sum: ['APPRLNDVAL', 'APPR_IMPR'], label: 'Appraised land + improvement value' },
};

// Snohomish County assessor schema (CADASTRAL parcels) shared by county and city mirrors.
const SNOHOMISH_FIELDS = {
  parcel_id: ['PARCEL_ID'],
  owner: ['TAXPRNAME', 'OWNERNAME'],
  owner_address: ['OWNERLINE1'],
  situs_address: ['SITUSLINE1'],
  situs_city: ['SITUSCITY'],
  land_value: ['MKLND'],
  improvement_value: ['MKIMP'],
  total_value: ['MKTTL'],
  land_acres: ['TAB_ACRES'],
  use_code: ['USECODE'],
  use_description: ['USEDESC'],
};

// Yakima County assessor Taxlots schema.
const YAKIMA_FIELDS = {
  parcel_id: ['ASSESSOR_N', 'TAXLOT_N', 'PARC'],
  owner: ['ORG_NAME'],
  owner_address: ['MAILING_AD'],
  situs_address: ['SITUS_ADDR'],
  situs_city: ['SITUS_CITY'],
  land_value: ['MKT_LAND'],
  improvement_value: ['MKT_IMPVT'],
  land_acres: ['ACRES', 'SIZE'],
  use_code: ['USE_CODE'],
};

// Clark County public taxlot schema.
const CLARK_FIELDS = {
  parcel_id: ['Prop_id', 'prop_id', 'PROP_ID'],
  owner: ['MainOwnerI', 'MainOwnerInfo', 'Owner'],
  situs_address: ['SitusAddrs', 'SitusAddress'],
  taxable_value: ['TaxTotVal'],
  land_value: ['MktLandVal'],
  improvement_value: ['MktBldgVal'],
  land_acres: ['GISAc', 'LandAcres'],
  use_code: ['PropClass', 'PropertyClass', 'LandUse'],
};

export const PROVIDERS = [
  {
    key: 'pierce',
    name: 'Pierce County',
    counties: ['Pierce'],
    useCodeScheme: 'dor-prefix',
    assessorLink: 'https://atip.piercecountywa.gov/app/v2/propertyDetail/{parcel}/summary',
    sources: [
      {
        id: 'tacoma-ats-parcels',
        geometry: true,
        enrich: true,
        confidence: 'confirmed',
        name: 'Pierce County Tax Parcels with Assessor-Treasurer info (City of Tacoma GIS)',
        publisher: 'City of Tacoma ITD / Pierce County Assessor-Treasurer',
        url: 'https://esgis.tacoma.gov/arcgis/rest/services/Ref/ITD_Basemap/MapServer/2',
        fields: {
          parcel_id: ['TaxParcelNumber'],
          owner: ['TAXPAYERNAME', 'TaxpayerName', 'Taxpayer_Name'],
          situs_address: ['SiteAddress', 'Site_Address'],
          taxable_value: ['TaxableValueCurrentYear', 'TaxableValue', 'Taxable_Value', 'TaxableValuePriorYear'],
          land_value: ['LandValueCurrentYear', 'LandValue', 'Land_Value', 'LandValuePriorYear'],
          improvement_value: ['ImprovementValueCurrentYear', 'ImprovementValue', 'Improvement_Value', 'ImprovementValuePriorYear'],
          total_value: ['TotalMarketValueCurrentYear', 'TotalMarketValue', 'TotalMarketValuePriorYear'],
          land_acres: ['LandGrossAcres', 'Land_Acres'],
          use_code: ['Use_Code', 'CurrentUseCodeCurrentYear'],
          use_description: ['Landuse_Description', 'UseDescription'],
        },
        notes: 'County-wide parcel polygons joined to Assessor-Treasurer data including taxpayer name and taxable value.',
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
        ownerNote: 'Business_Name lists the taxpayer name for business-owned parcels only',
        notes: 'Authoritative county layer with taxable value, land acres, use code and land-use description; individual taxpayer names are not published here.',
      },
      {
        id: 'soundtransit-pierce-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcels, Pierce County (Sound Transit STARS mirror)',
        publisher: 'Sound Transit (mirror of Pierce County data)',
        url: 'https://rtamaps2.soundtransit.org/arcgis/rest/services/STARS_ContextLayers_Parcels/MapServer/1',
        fields: PIERCE_COUNTY_FIELDS,
        ownerNote: 'Business_Name lists the taxpayer name for business-owned parcels only',
        notes: 'Regional mirror of the county layer; refresh cadence may lag.',
      },
    ],
  },
  {
    key: 'king',
    name: 'King County',
    counties: ['King'],
    useCodeScheme: 'county',
    assessorLink: 'https://blue.kingcounty.com/Assessor/eRealProperty/Dashboard.aspx?ParcelNbr={parcel}',
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
        notes: 'Parcels with taxpayer name, appraised and taxable land/improvement values, lot size and present-use description.',
      },
      {
        id: 'king-propertyinfo-parcels',
        geometry: true,
        confidence: 'likely',
        name: 'Parcels (King County Property/KingCo_PropertyInfo)',
        publisher: 'King County GIS Center',
        url: 'https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/2',
        fields: { ...KING_FIELDS, owner: ['KCTP_NAME', 'TAXPAYERNAME', 'FULLNAME'] },
        computed: KING_COMPUTED,
        notes: 'Fallback property-themed parcel layer used by King County Parcel Viewer.',
      },
      {
        id: 'king-opendata-legacy',
        geometry: true,
        confidence: 'confirmed',
        name: 'parcel_address_area (King County Open Data legacy server)',
        publisher: 'King County GIS Center',
        url: 'https://gisdata.kingcounty.gov/arcgis/rest/services/OpenDataPortal/property__parcel_address_area/MapServer/1722',
        fields: KING_FIELDS,
        computed: KING_COMPUTED,
        notes: 'Legacy mirror with the same schema.',
      },
    ],
  },
  {
    key: 'snohomish',
    name: 'Snohomish County',
    counties: ['Snohomish'],
    useCodeScheme: 'county',
    assessorLink: 'https://www.snoco.org/proptax/search.aspx?parcel_number={parcel}',
    sources: [
      {
        id: 'snoco-tax-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcels (Snohomish County Cadastral)',
        publisher: 'Snohomish County GIS / Assessor',
        url: 'https://gis.snoco.org/sis/rest/services/Cadastral/Tax_Parcels/MapServer/0',
        fields: SNOHOMISH_FIELDS,
        notes: 'Taxpayer of record and owner names, market land/improvement/total values (no taxable value field), acres and use code.',
      },
      {
        id: 'snoco-hosted-parcels',
        geometry: true,
        confidence: 'guess',
        name: 'Parcels (Snohomish County hosted)',
        publisher: 'Snohomish County GIS',
        url: 'https://gis.snoco.org/host/rest/services/Hosted/Parcels/FeatureServer/0',
        fields: SNOHOMISH_FIELDS,
        notes: 'Hosted copy of the same schema; probed only if the cadastral service is unavailable.',
      },
      {
        id: 'soundtransit-snohomish-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Tax Parcels, Snohomish County (Sound Transit STARS mirror)',
        publisher: 'Sound Transit (mirror of Snohomish County data)',
        url: 'https://rtamaps2.soundtransit.org/arcgis/rest/services/STARS_ContextLayers_Parcels/MapServer/2',
        fields: SNOHOMISH_FIELDS,
        notes: 'Regional mirror; refresh cadence may lag.',
      },
    ],
  },
  {
    key: 'spokane',
    name: 'Spokane County',
    counties: ['Spokane'],
    useCodeScheme: 'dor-prefix',
    assessorLink: 'https://cp.spokanecounty.org/SCOUT/propertyinformation/Summary.aspx?PID={parcel}',
    sources: [
      {
        id: 'spokane-assessor-parcels',
        geometry: true,
        confidence: 'likely',
        name: 'Parcels (Spokane County Assessor, Parcels_GISCORE)',
        publisher: 'Spokane County Assessor / Spokane County GIS',
        url: 'https://gismo.spokanecounty.org/arcgis/rest/services/Assessor/Parcels/MapServer/0',
        fields: {
          parcel_id: ['PID_NUM', 'PID'],
          owner: ['OWNER_NAME', 'TAXPAYER_NAME', 'OWNER', 'Owner_Name', 'TaxpayerName'],
          situs_address: ['SITE_ADDRESS', 'Site_Address'],
          taxable_value: ['TAXABLE_VALUE', 'Taxable_Value'],
          land_value: ['LAND_VALUE', 'Land_Value'],
          improvement_value: ['IMP_VALUE', 'IMPROVEMENT_VALUE', 'Improvement_Value'],
          total_value: ['TOTAL_VALUE', 'TOTAL_MARKET_VALUE', 'Total_Value'],
          land_acres: ['GIS_ACRES', 'ACRES', 'Acres'],
          use_code: ['PROPERTY_CLASS', 'LAND_USE_CODE', 'PropClass'],
          use_description: ['PROPERTY_CLASS_DESC', 'LAND_USE_DESC'],
        },
        notes: 'County assessor parcel layer; attribute names are resolved from the live schema.',
      },
      {
        id: 'spokane-utilities-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (Spokane County Environmental Services)',
        publisher: 'Spokane County GIS',
        url: 'https://gismo.spokanecounty.org/arcgis/rest/services/EnvServices/SewerDrawings/MapServer/0',
        fields: {
          parcel_id: ['PID_NUM'],
          owner: ['OWNER_NAME', 'TAXPAYER_NAME', 'OWNER'],
          situs_address: ['SITE_ADDRESS'],
        },
        notes: 'County parcel feature class with owner and site address, published for utility mapping.',
      },
      {
        id: 'wisaard-spokane-2021',
        geometry: true,
        confidence: 'confirmed',
        name: 'Spokane County parcels, 2021 vintage (DAHP WISAARD)',
        publisher: 'Washington State Department of Archaeology and Historic Preservation',
        url: 'https://wisaard.dahp.wa.gov/server/rest/services/County_Parcels/MapServer/30',
        fields: {
          parcel_id: ['PID', 'PID_NUM', 'PARCEL_ID'],
          owner: ['OWNER_NM', 'TAXPAYER_NM'],
          use_description: ['LANDUSE_DESC'],
        },
        notes: 'Stale (2021) statewide compilation with owner names; last resort for Spokane.',
      },
    ],
  },
  {
    key: 'thurston',
    name: 'Thurston County',
    counties: ['Thurston'],
    useCodeScheme: 'county',
    assessorLink: 'https://tcproperty.co.thurston.wa.us/propsql/basic.asp?fe=PR&pn={parcel}',
    sources: [
      {
        id: 'thurston-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Thurston Parcels (Thurston GeoData Center)',
        publisher: 'Thurston County GeoData Center / Assessor',
        url: 'https://map.co.thurston.wa.us/arcgis/rest/services/Thurston/Thurston_Parcels/FeatureServer/0',
        fields: {
          parcel_id: ['ParcelNumber', 'PARCEL_NO'],
          owner: ['OWNER', 'OWNER_NAME', 'TAXPAYER', 'Owner'],
          owner_address: ['ADDRESS1'],
          situs_address: ['SITUS_STRE', 'SitusAddress'],
          situs_city: ['SITUS_CITY'],
          taxable_value: ['TAXABLE'],
          land_value: ['LAND_VALUE'],
          improvement_value: ['BLDG_VALUE'],
          total_value: ['TOTAL_VALU', 'TOTAL_VALUE'],
          land_acres: ['TOTAL_ACRE', 'TOTAL_ACRES'],
          use_code: ['CURR_USE', 'PROP_TYPE'],
          use_description: ['PROP_SUBTY', 'PROP_TYPE_DESC'],
        },
        notes: 'County parcel layer with taxable value, land/building values and acreage; owner names may not be published.',
      },
      {
        id: 'thurston-enterprise-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Parcels (Thurston County Enterprise, Common_Layers)',
        publisher: 'Thurston County',
        url: 'https://tconline.co.thurston.wa.us/server/rest/services/Common_Layers/Parcels/FeatureServer/4',
        fields: {
          parcel_id: ['ParcelNumber', 'PARCEL_NO'],
          owner: ['OWNER', 'OWNER_NAME', 'TAXPAYER'],
          situs_address: ['SITUS_STRE'],
          situs_city: ['SITUS_CITY'],
          taxable_value: ['TAXABLE'],
          land_value: ['LAND_VALUE'],
          improvement_value: ['BLDG_VALUE'],
          total_value: ['TOTAL_VALU'],
          land_acres: ['TOTAL_ACRE'],
          use_code: ['CURR_USE', 'PROP_TYPE'],
        },
        notes: 'Newer county host with the same assessor extract.',
      },
    ],
  },
  {
    key: 'yakima',
    name: 'Yakima County',
    counties: ['Yakima'],
    useCodeScheme: 'dor',
    assessorLink: null,
    sources: [
      {
        id: 'yakima-taxlots',
        geometry: true,
        confidence: 'confirmed',
        name: 'Taxlots (Yakima County Assessor)',
        publisher: 'Yakima County GIS / Assessor',
        url: 'https://maps.yakimacounty.us/server/rest/services/Assessor/Taxlots/FeatureServer/2',
        fields: YAKIMA_FIELDS,
        ownerCompose: { org: 'ORG_NAME', last: 'LAST_NAME', first: 'FIRST_NAME', middle: 'MIDDLE_NAME' },
        computed: { total_value: { sum: ['MKT_LAND', 'MKT_IMPVT'], label: 'Market land + improvement value' } },
        notes: 'Current tax-roll taxlots with organisation or individual owner names, market values, acres, and DOR use code with description.',
      },
      {
        id: 'yakima-agol-parcels',
        geometry: true,
        confidence: 'likely',
        name: 'Parcels (Yakima County ArcGIS Online)',
        publisher: 'Yakima County GIS',
        url: 'https://services3.arcgis.com/9Qz94N8Zml9hnG84/arcgis/rest/services/Parcels/FeatureServer/0',
        fields: YAKIMA_FIELDS,
        ownerCompose: { org: 'ORG_NAME', last: 'LAST_NAME', first: 'FIRST_NAME', middle: 'MIDDLE_NAME' },
        computed: { total_value: { sum: ['MKT_LAND', 'MKT_IMPVT'], label: 'Market land + improvement value' } },
        notes: 'Hosted copy; attribute coverage confirmed at runtime.',
      },
    ],
  },
  {
    key: 'kitsap',
    name: 'Kitsap County',
    counties: ['Kitsap'],
    useCodeScheme: 'county',
    assessorLink: 'https://psearch.kitsap.gov/pdetails/Details?parcel={parcel}&page=general',
    sources: [
      {
        id: 'kitsap-agol-parcels',
        geometry: true,
        confidence: 'guess',
        name: 'Parcels (Kitsap County ArcGIS Online)',
        publisher: 'Kitsap County GIS',
        url: 'https://services6.arcgis.com/qt3UCV9x5kB4CwRA/arcgis/rest/services/Parcels/FeatureServer/0',
        fields: {
          parcel_id: ['RP_ACCT_ID', 'APN', 'ACCT_NO'],
          owner: ['CONTACT_NAME', 'OWNER', 'TAXPAYER'],
          situs_address: ['SITE_ADDR'],
          land_acres: ['POLY_ACRES', 'ACRES'],
          use_code: ['PROP_CLASS', 'PROPERTY_CLASS'],
        },
        notes: 'County hosted parcel layer; attributes resolved from the live schema.',
      },
      {
        id: 'kitsap-health-parcels',
        geometry: true,
        confidence: 'confirmed',
        name: 'Kitsap Parcels (Kitsap Public Health District GIS)',
        publisher: 'Kitsap Public Health District (county parcel data)',
        url: 'https://secure.kitsappublichealth.org/agsserver/rest/services/KPHDGISPUB/KitsapParcelsPub/MapServer/0',
        fields: { parcel_id: ['ACCT_NO', 'TaxID', 'RP_ACCT_ID'], owner: ['OWNER', 'TAXPAYER', 'CONTACT_NAME'] },
        notes: 'Parcel boundaries keyed by account number; other attributes resolved at runtime.',
      },
    ],
  },
  {
    key: 'clark',
    name: 'Clark County',
    counties: ['Clark'],
    useCodeScheme: 'county',
    assessorLink: 'https://gis.clark.wa.gov/gishome/Property/?pid=findSN&account={parcel}',
    sources: [
      {
        id: 'clark-taxlots-public',
        geometry: true,
        confidence: 'confirmed',
        name: 'Taxlots for Public Use (Clark County GIS)',
        publisher: 'Clark County GIS / Assessor',
        url: 'https://services2.arcgis.com/ylxwjFBdCPBzP16d/arcgis/rest/services/TaxlotsforPublicUse/FeatureServer/0',
        fields: CLARK_FIELDS,
        computed: { total_value: { sum: ['MktLandVal', 'MktBldgVal'], label: 'Market land + building value' } },
        notes: 'County taxlots with owner, taxable total value, market land/building values and GIS acres.',
      },
      {
        id: 'clark-taxlots-public-legacy',
        geometry: true,
        confidence: 'likely',
        name: 'Taxlots Public (Clark County GIS, earlier service)',
        publisher: 'Clark County GIS',
        url: 'https://services2.arcgis.com/ylxwjFBdCPBzP16d/arcgis/rest/services/TaxlotsPublic/FeatureServer/0',
        fields: CLARK_FIELDS,
        computed: { total_value: { sum: ['MktLandVal', 'MktBldgVal'], label: 'Market land + building value' } },
        notes: 'Earlier service name; fallback only.',
      },
      {
        id: 'clark-enterprise-taxlots',
        geometry: true,
        confidence: 'likely',
        name: 'TaxlotsPublic_Singlepart (Clark County Enterprise)',
        publisher: 'Clark County GIS',
        url: 'https://gis.clark.wa.gov/arcgisfed/rest/services/Hosted/TaxlotsPublic_Singlepart/FeatureServer/0',
        fields: CLARK_FIELDS,
        computed: { total_value: { sum: ['MktLandVal', 'MktBldgVal'], label: 'Market land + building value' } },
        notes: 'County-hosted copy; fallback only.',
      },
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
