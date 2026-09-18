# Washington Parcel Radius Map

Interactive web map for radius studies of tax parcels in Washington State, built in the
style of CBRE's *Properties within 250 yards* exhibits. Drop a pin or type an address, and
the app draws an adjustable radius ring, pulls the live parcel fabric and assessor attributes
from county, city, and State GIS services, numbers every parcel that touches or falls within
the ring, shades MultiCare-affiliated properties in CBRE green, and lists owner, taxable
value, land acres, and use in a sortable table with CSV export and a print-ready exhibit.

No build step, server, or API key is required. Open `index.html` from any static host
(GitHub Pages, SharePoint, a local folder) or open `dist/index.html`, a single
self-contained file that can be emailed.

## Features

- **Location**: geocode an address or place (Nominatim, with U.S. Census and Photon
  fallbacks), enter `lat, lon`, or click *Drop pin on map*. The pin is draggable.
- **Radius ring**: default 250 yards; any radius in yards, feet, meters, miles, or
  kilometers (slider, number input, presets). Switching units converts the value so the ring
  does not change size. Ring color, width, line style (solid, dashed, dotted, dash-dot),
  and optional fill are all adjustable.
- **Parcels**: every parcel whose polygon intersects the disk (fully inside, straddling the
  ring, or containing the pin) is numbered from the pin outwards. Parcel outlines for the
  whole viewport load at zoom 15 and above.
- **MultiCare shading**: owner and taxpayer names are matched against MultiCare Health
  System and its hospitals, clinics, foundations, and joint ventures (see
  `js/multicare.js`). Owned parcels fill CBRE Green, affiliates and joint ventures fill
  Celadon, and parcels containing a known MultiCare campus (or marked by the user) are
  flagged *MultiCare occupied* with a blue marker, matching the reference exhibit legend.
  Extra name fragments can be added in the sidebar.
- **Table**: ID, True Owner, Taxable Value, Land AC, Use, plus optional parcel number,
  address, and distance columns; sortable; totals row; *Renumber by sort*; CSV export with
  every underlying field (values, acres source, assessor link, data source).
- **Basemaps**: CARTO Positron (light, matches the reference), CARTO no-labels, Voyager and
  Dark Matter, OpenStreetMap, Esri Light Gray Canvas, Streets, Imagery and Topographic,
  USGS Imagery and Topo. Switch from the sidebar or the map's layer control.
- **Exhibit**: *Print exhibit* reflows the page into a 17 x 11 in landscape layout with a
  CBRE-green header (editable title and subtitle), the map, legend, the numbered table
  (split into columns for long lists), disclaimer, and wordmark. Use the browser's *Save as
  PDF*.
- **Sharing**: the URL hash carries the pin and radius, so a link reproduces the study.
- **Data-source transparency**: the sidebar lists each service queried, whether it
  responded, how many records it returned, and exactly which source field feeds each column.

## Accuracy notes

- Distances are measured in a local tangent frame using the WGS84 radii of curvature at the
  pin, accurate to well under a centimetre at study scales. 1 yard = 0.9144 m exactly.
- A parcel is included when the shortest distance from the pin to the parcel boundary is at
  or below the radius (or the parcel contains the pin). This is an exact disk-polygon test,
  not a vertex or centroid test.
- **Taxable value** is shown when the assessor publishes it (Pierce, King, Thurston, Clark).
  Where only market values are published (Snohomish, Yakima, the statewide layer), the total
  market or land + improvement value is shown and flagged with `*`; the CSV records which.
- **Land AC** comes from the assessor's acreage field when present, otherwise from lot
  square feet, otherwise it is computed from the parcel polygon and flagged with `†`.
- **Owner names** come from the county or city assessor join. The statewide layer does not
  publish owner names, so counties without a dedicated provider show *not published*; the
  assessor link opens the county record. Pierce County's own open-data layer publishes only
  business taxpayer names (flagged `‡`); the City of Tacoma layer publishes all taxpayer
  names and is queried first.
- All attributes are read live from the publishing agency, so figures reflect the current
  tax roll, not a snapshot. Verify with the county assessor before relying on any figure.

## Data sources

Parcel geometry and attributes are queried directly from ArcGIS REST layers in the
browser (`js/providers.js`). Layer schemas are read at run time and mapped by candidate
field names and heuristics (`js/fields.js`), so a renamed field degrades gracefully and the
mapping actually used is shown in the sidebar.

| County | Primary layer | Owner | Taxable value | Acres | Use | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| Pierce | City of Tacoma *Pierce County Tax Parcels (with ATS Info)* + Pierce County *Tax Parcels* (joined for land-use description) | TAXPAYERNAME | TaxableValue (current or prior year) | LandGrossAcres | Use_Code + Landuse_Description | confirmed |
| King | King County GIS *parcel_address_area* | KCTP_NAME | TAX_LNDVAL + TAX_IMPR | KCA_ACRES | PREUSE_DESC | confirmed |
| Snohomish | Snohomish County *Cadastral/Tax_Parcels* | TAXPRNAME / OWNERNAME | market total MKTTL (*) | TAB_ACRES | USECODE | confirmed |
| Spokane | Spokane County Assessor *Parcels* (GISMO) | resolved at run time | resolved at run time | resolved at run time | resolved at run time | likely |
| Thurston | Thurston GeoData *Thurston_Parcels* | not published | TAXABLE | TOTAL_ACRE | CURR_USE / PROP_TYPE | confirmed |
| Yakima | Yakima County Assessor *Taxlots* | ORG_NAME or LAST/FIRST | market MKT_LAND + MKT_IMPVT (*) | ACRES | USE_CODE (code + text) | confirmed |
| Kitsap | Kitsap County hosted *Parcels* / Kitsap Public Health *KitsapParcelsPub* | resolved at run time | resolved at run time | POLY_ACRES | resolved at run time | guess |
| Clark | Clark County *TaxlotsforPublicUse* | MainOwnerI | TaxTotVal | GISAc | resolved at run time | confirmed |
| Whatcom | Whatcom County *WhatcomCo_Property* Public Tax Parcels | tax_payer_name_full | taxable_val_total | legal_acreage | property_use_description | confirmed |
| Skagit | Skagit County *Tax_Parcels* | OwnerName | TaxableValue | Acres | LandUse | confirmed |
| Cowlitz | Cowlitz County *Cadastral/Parcels* | DEED_HOLDER_NAME | TAXABLE_VALUE | ACRES_TOTAL | USE_CODE_DESCRIPTION | confirmed |
| Clallam | Clallam County *ParcelMap* + State layer join for values | OWN_LAST, OWN_FIRST | market (*) via State join | ACRES_GIS | PRC_CLASS | confirmed |
| Mason, Chelan, Island | County parcel layers + State layer join for values, 2021 DAHP compilation join for owner names where the county layer has none | varies (flagged) | market (*) | varies | varies | confirmed / likely |
| Grays Harbor | State layer + 2021 DAHP compilation join for owner names | OWNER (2021, flagged) | market (*) | from geometry (†) | DOR code | confirmed |
| Lewis, Walla Walla, Franklin, Benton, Kittitas | County parcel layers (schemas resolved at run time) + State layer join | resolved at run time | resolved at run time / market (*) | resolved at run time | resolved at run time | likely |
| All others | Washington State *Current Parcels* (Parcels_2026, OCIO/DOR) | not published | market VALUE_LAND + VALUE_BLDG (*) | from geometry (†) | DOR LANDUSE_CD decoded | confirmed |

*Verification* describes how the endpoint was checked while this app was built: the
development sandbox could not reach the GIS hosts directly, so **confirmed** means the exact
layer URL and field names were seen verbatim in indexed ArcGIS REST directory pages, agency
metadata, or working client code; **likely** means the URL was seen but fields are inferred
from the agency's schema; **guess** means the endpoint is plausible and everything is
resolved from the live schema. The first time you run the app on a real network, check the
*Data sources* panel: each source reports *online* with its field mapping, or *unavailable*
with the reason. The statewide layer is the automatic fallback for any county whose
provider fails. County routing uses coarse Census county outlines (`data/wa_counties.json`)
so a ring near a county line queries both counties.

Additional fallbacks per county (regional mirrors, legacy servers) are listed in
`js/providers.js`. Extending coverage is a matter of adding a provider entry with the layer
URL and candidate field names.

MultiCare campus addresses used for *occupied* markers are in
`data/multicare_locations.json`; they are geocoded on first use and cached in the browser.
Clinics and leased suites are not in assessor data, so mark those parcels from the popup
(*Mark MultiCare occupied*); marks persist in the browser.

## Running locally

```bash
npm install
npm run serve          # http://localhost:8080
npm test               # unit tests (geometry, ArcGIS conversion, field mapping, matching)
npm run test:e2e       # Playwright tests against mocked ArcGIS services
npm run build:single   # dist/index.html, self-contained single file
```

`npm run vendor` refreshes `vendor/leaflet` from node_modules; `npm run build:counties`
regenerates the county routing file from us-atlas.

## Deployment

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`
(the app at the site root, the single-file build at `/standalone.html`). Enable Pages with
*GitHub Actions* as the source under repository Settings if the first run does not enable
it automatically. Any static host works; the app is plain HTML, CSS, and ES modules.

## Project layout

```
index.html            app shell
css/app.css           styles, CBRE palette, print exhibit layout
js/app.js             controller: map, pin, ring, study, table, print, sharing
js/parcels.js         provider routing, live queries, enrichment joins, record normalisation
js/providers.js       county/city/state ArcGIS layer registry
js/arcgis.js          ArcGIS REST client (metadata, paginated queries, Esri JSON -> GeoJSON)
js/fields.js          field-name resolution (candidates + heuristics)
js/geometry.js        ellipsoidal local projection, ring polygon, disk-polygon tests, areas
js/multicare.js       MultiCare owner-name matching
js/table.js           results table and CSV
js/print.js           exhibit layout
js/geocode.js         geocoder chain
js/dor_codes.js       WA DOR land-use codes
data/                 county outlines, MultiCare campuses
vendor/leaflet        Leaflet 1.9.4 (BSD-2-Clause)
scripts/              vendor, county build, single-file build, dev server
tests/                node:test unit tests and Playwright e2e tests with mocked services
```

## Licence and attribution

Application code © CBRE. Map data © OpenStreetMap contributors; basemap tiles © CARTO, Esri,
USGS as attributed on the map. Parcel data is published by the respective Washington
counties, cities, and the Washington State Office of the Chief Information Officer and is
subject to each agency's terms. Leaflet is BSD-2-Clause licensed.
