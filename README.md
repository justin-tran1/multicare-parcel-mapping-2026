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
| Pierce | City of Tacoma *Pierce County Tax Parcels (with ATS Info)* when reachable, else Pierce County *Tax Parcels* (also joined for land-use description) | TAXPAYERNAME (Tacoma layer); Business_Name only on the county layer (‡) | TaxableValue / Taxable_Value | LandGrossAcres / Land_Acres | Landuse_Description | confirmed (county), likely (Tacoma host) |
| King | King County GIS *parcel_address_area*, then the ArcGIS Online copy (no owner names) | KCTP_NAME | TAX_LNDVAL + TAX_IMPR | KCA_ACRES | PREUSE_DESC | confirmed |
| Snohomish | Snohomish County Open Data *Parcels* (ArcGIS Online), then *Cadastral/Tax_Parcels* | TAXPRNAME / OWNERNAME | market total MKTTL (*) | TAB_ACRES | USECODE (code + text) | confirmed |
| Spokane | Spokane County Open Data *Parcels* (ArcGIS Online) + SCOUT *PropertyLookup* join for owner | owner_name (SCOUT join) | taxable_amt | acreage | prop_use_desc | confirmed |
| Thurston | Thurston County Enterprise *Parcel Boundaries* + State join for land use | OWNER_NAME | market TOTAL_VALUE (*); TAXABLE is a flag | TOTAL_ACRES | DOR code via State join | confirmed |
| Yakima | Yakima County Assessor *Taxlots* | ORG_NAME or LAST/FIRST | market MKT_LAND + MKT_IMPVT (*) | ACRES | USE_CODE (code + text) | confirmed |
| Kitsap | Kitsap Public Health District *KitsapParcelsPub* + State join for values | OWNER | market (*) via State join | from geometry (†) | DOR code via State join | confirmed |
| Clark | Clark County *TaxlotsforPublicUse* | not published (MainOwnerID is an internal id) | TaxTotVal | AssrAc | Pt1Desc | confirmed |
| Skagit | Skagit County *Tax_Parcels* | OwnerName | TaxableValue | Acres | LandUse (code + text) | confirmed |
| Cowlitz | Cowlitz County Assessor *Parcels* | DEED_HOLDER_NAME | assessed land + improvement (*) | ACRES_TOTAL | USE_CODE_DESCRIPTION | confirmed |
| Lewis | Lewis County *Public/BaseLayers* Parcels | OWNER | market VAL_TOTAL (*) | TOTAL_ACRE | USE_DESC | confirmed |
| Chelan | City of Wenatchee copy of the county PACS parcels, then Chelan Atlas *ParcelsOwners*; State join for values | Owner_Nam (PACS) | market (*) via State join | Acres (PACS) | DOR code via State join | confirmed |
| Island | Island County *Geocortex/Base* Parcels + State join | taxpayer | market assessed_value (*) | legal_acreage | property_land_use_code | confirmed |
| Benton | Benton County *Parcels_and_Assess* (ArcGIS Online) + State join | owner_name | market appraised_val (*) | legal_acres | primary_use | confirmed |
| Kittitas | Kittitas County COMPAS *TaxParcelQuery* + Open Data *Parcels* join for values | t2_Owner | market t2_ValueMrkt (*) | from geometry (†) | landuse_name | confirmed |
| Mason | Mason County SmartGov parcels + State join | LAST/FIRST name parts | market (*) via State join | from geometry (†) | DOR code via State join | likely |
| Whatcom, Clallam, Franklin | Documented county layers with owner names that did not answer when probed; the State layer covers them until they return | as documented | market (*) | from geometry (†) | DOR code | likely |
| Walla Walla | State layer + College Place city parcels join | OWNER (College Place only) | market (*) | from geometry (†) | DOR code | confirmed |
| All others (including Grays Harbor) | Washington State *Current Parcels* (Parcels_2026, OCIO/DOR) | not published | market VALUE_LAND + VALUE_BLDG (*) | from geometry (†) | county code decoded via the service's land-use table, else DOR LANDUSE_CD | confirmed |

*Verification*: **confirmed** means the layer answered a live probe from GitHub's runners
(`scripts/probe-providers.mjs`, run by `.github/workflows/probe.yml`) and the listed fields
were observed in its schema and sample records; **likely** means the URL and fields are
documented in the agency's REST directory or metadata but the host did not answer the probe
(it may be reachable only from some networks, or temporarily stopped). The probe runs weekly
and on demand; read its job log or download the `probe-report` artifact to see the current
state of every source. In the app, the *Data sources* panel reports each source as *online*
with its field mapping or *unavailable* with the reason. A source that answers with no
parcels is skipped, and the statewide layer is the automatic fallback for any county whose
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
