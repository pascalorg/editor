# Pascal Map → plan generation: the integration plan

Steve, 2026-09-07: "i have a present for you, we need to integrate this into
the plan generation system!! aymeric did it! (pascal team) read through the
docs and come up with a plan to integrate into plans".

Source read: `https://map.pascal.app/api/openapi.json` (OpenAPI 3.1),
`/llms.txt`, `/docs`, `/api/agent-tools.json`. Probed `/v1/health` (ok, 69
county parcel archives) and `/v1/location` (401 without a key — keys are
minted at map.pascal.app → account → API keys, `Authorization: Bearer`,
300 requests / 60 s, `Retry-After` on 429, allow up to 90 s for a full
dossier).

## 1. What the platform gives us

One call — `GET /v1/location?address=…` (or `ll=lat,lng`, or `parcel=key`)
with `layers=` to pick sections, `include_geometry=true` for GeoJSON,
`include_adjacent=true` for neighbours and FRONTAGE — returns a dossier.
Every section carries `status` (available | empty | not_covered |
not_available — a missing answer is never "no risk"), a plain `summary`,
structured `data`, and `source` (name, kind live | official | archive |
computed, vintage, attribution, note). Coverage today: Florida (Tampa–
Orlando region full, statewide sections everywhere in FL) and California;
`GET /v1/coverage` is the scorecard to check first.

The sections that change what we draw:

| Section | What we use | Replaces / adds |
|---|---|---|
| `parcel` | polygon (geometry), area, county + FIPS, situs address, `frontage` — the boundary NOT shared with any neighbour (the street / right-of-way edges, as a MultiLineString), adjacent parcels, stacked parcels | the ArcGIS parcel resolve; the Overpass road match for the front edge |
| `zoning` | district + description, `setbacks` front / side / rear (null = a conditional rule, with `dimensional_note` verbatim and `dimensional_source` url + section), `max_height_ft`, `max_far`, `min_lot_sqft`, future land use, governing documents (deep links) | the 20 / 5 / 15 ft default setbacks |
| `flood` | zone at the point, SFHA flag, BFE + datum, FIRM panel + effective date, zones on the parcel with coverage %, clipped geometry | nothing today — the plans are blind to flood |
| `code_basis` | IECC climate zone, frost depth, ground snow, seismic design category (+ SDS / SD1), ASCE 7 wind speed (RC II, county), wind-borne debris region, NOAA Atlas 14 rainfall, CA Title 24 zone, CA fire hazard severity, CGS liquefaction / landslide / tsunami zones, FL subsidence reports | the STATE-TYPICAL climate table in Bones' jurisdiction profile |
| `elevation` | point elevation + parcel-wide USGS 3DEP bare-earth terrain (min / max / relief, 1-ft contours as geometry; `terrain_status` computing on first look ~30 s) | the 81-point EPQS grid |
| `utilities` | sewer vs septic (FLWMI, with confidence), drinking-water class, electric providers | the sewer setting's assumption; nothing knew about septic |
| `soils` | SSURGO map units, drainage class, hydrologic group, hydric % | nothing |
| `wetlands` | on-parcel coverage %, NWI classes, clipped geometry | nothing |
| `structures` | existing buildings on the lot: footprints, height, year built, county record (living area, units), NSI foundation type / first-floor elevation estimate | nothing |
| `boundaries` | state, county (FIPS), ZIP with precision | the address state Bones guesses the jurisdiction from |
| `tax`, `market`, `permits`, `weather` | cover-sheet project data (assessed value, year built, recent permits), nothing structural | — |

Rules the docs insist on and we will honour: ignore unknown keys (additive
policy), carry provenance, treat `not_covered` / `not_available` as "not
answered" (never as a negative finding), read `Retry-After`, keep the key
out of the browser and out of prompts.

## 2. Where it lands in our pipeline

Today the lot comes in through `packages/editor/src/lib/lot/drop-in.ts`
→ `/api/parcel/resolve` (ArcGIS parcel ring), `/api/parcel/roads`
(Overpass, the front edge by the nearest parallel road), `/api/parcel/
elevation` (USGS EPQS grid), and `sitePatchFromParcel` writes the site node
(polygon, address, parcel provenance, DEFAULT setbacks, `frontEdge`,
terrain). The generator sits the house on the setback envelope facing the
front edge, picks slab vs raised from the terrain, and Bones sizes the
frame from the STATE profile (wind / frost / snow / SDC). The sheets print
"state typical" next to every such number.

### Phase 0 — the pipe (no design change)

- `apps/editor/app/api/parcel/dossier/route.ts`: a server route that
  calls `/v1/location` with `MAP_API_KEY` from the environment (never
  shipped to the client), forwards `address | ll | parcel`, `layers`,
  `include_geometry`, `include_adjacent`; maps the structured error
  envelope; honours `Retry-After`; 90 s timeout; caches by parcel key for
  the session. A `/api/parcel/coverage` passthrough for the panel's
  honesty line.
- `packages/editor/src/lib/lot/dossier.ts`: the typed client + a
  `DossierSection<T>` reader that returns `{ status, summary, data, source }`
  and a `provenanceLine(section)` for the sheets.
- Site node schema (`packages/core/src/schema/nodes/site.ts`, all
  optional, additive): `dossier: { as_of, request_id, point, address:
  { formatted, precision }, sections: Record<layer, { status, summary,
  source }> }`, plus the data we act on: `flood`, `codeBasis`, `zoningDetail`,
  `utilities`, `soils`, `wetlands`, `structures` (each the section's `data`
  minus geometries, which go to the heightfield / site overlays). A scene
  that predates it loads unchanged.
- The drop-in uses the dossier when the key is present and falls back to
  today's three routes when it is not (or on `not_available`), and its
  status line says which. Tests run against a RECORDED dossier fixture
  (the Miami Shores lot) so nothing hits the network in CI.

### Phase 1 — site truth

- FRONT EDGE from `parcel.data.frontage.geometry`: the lot edges that
  touch no neighbour are the street (or water) edges. Match each ring edge
  to a frontage segment; one segment → the front; a corner lot → the one
  named by the situs street (else the longer). The Overpass match stays as
  the fallback and for the site plan's street names. This is the fix for
  the house that faced the other way (the road lookup's timeouts).
- SETBACKS from `zoning.data.setbacks`; `setbacksSource` = the
  `dimensional_source` section + url; a null side keeps the default and
  prints the `dimensional_note` verbatim on the site plan with VERIFY.
  `max_height_ft` becomes a generator check (roof ridge vs the cap) and a
  cover-sheet line; `max_far` / `min_lot_sqft` print beside it.
- TERRAIN from `elevation.data.terrain` (3DEP, 1-ft contours): the
  heightfield from the contour set (or a denser sample of it) instead of
  the 81 EPQS points; `metadata.terrainSample.source` says "USGS 3DEP via
  Pascal Map, vintage …". `terrain_status: computing` → retry once after
  30 s, else the EPQS grid.
- The COVER SHEET (A0.0) project-data block: parcel key + county + APN,
  zoning district, flood zone / FIRM panel / BFE, wind speed, IECC zone,
  SDC, frost, sewer or septic, electric provider, elevation — each with
  its source and vintage. The SITE PLAN (A1.0): flood-zone hatch (clipped
  geometry) with the zone label and BFE, wetlands hatch, 3DEP contours,
  the frontage edges marked, setback lines with the code section, existing
  structures dashed (with year built).

### Phase 2 — design decisions the dossier changes

- FLOOD → the FINISHED FLOOR and the foundation (`plugin-generate/src/
  foundation.ts`): in an A / AE zone the floor goes to BFE + 1 ft
  (FBC freeboard; ASCE 24 by class) — a raised floor on a stem wall or a
  built-up pad, said so on the sheets with the FIRM panel; a V / VE zone
  is piles / piers (not modelled) → a loud warning and the R322.3 notes;
  no BFE → the design-flood note. Flood-zone general notes (R322: flood
  vents, flood-resistant materials below BFE, utilities elevated).
- CODE BASIS → Bones' jurisdiction (`plugin-bones/src/jurisdiction/
  profiles.ts`): a `SiteCodeBasis` on the site overrides the state
  profile's wind / frost / snow / SDC with the county / point values and
  their provenance, so hurricane ties, uplift straps, hold-downs, footing
  depth, rafter and joist tables and the energy sheet's R-values follow the
  SITE; `wind_borne_debris_region` → the impact-glazing note (R301.2.1.2)
  on the window schedule; the SN1 / EN1.0 / S-sheet criteria rows read
  "site-specific (ASCE 7 RC II county value, Pascal Map as_of …)" instead
  of "state typical"; CA: Title 24 zone for the energy sheet, fire hazard
  severity → the WUI note, liquefaction / landslide zones → the
  geotechnical-report note.
- UTILITIES → the services: `wastewater` KnownSeptic / LikelySeptic sets a
  new `wastewater: 'sewer' | 'septic'` beside `sewerSide` (septic = the
  building drain to a tank and drainfield in the rear yard — Phase 3
  models them; Phase 2 says so on P1.0); the electric provider on E1.0's
  service note.
- WETLANDS → the buildable envelope clips out the on-parcel wetland
  polygons (with the required buffer left as a VERIFY note); the generator
  refuses to sit the house over one.
- SOILS → foundation notes: "Poorly drained" / hydric → drainage and
  slab-vapour notes, hydrologic group D → the stormwater note; a
  recommendation for a geotechnical report when the drainage class is
  poor or a subsidence report stands within a mile.

### Phase 3 — what the dossier makes possible next

- A septic system in Bones plumbing (tank, distribution box, drainfield
  laterals sized by bedrooms, the setbacks from the well / the lot lines).
- Existing structures as context: keep-or-demolish on the site plan, an
  addition placed against the county-record footprint.
- The permit feed and the market observation on the cover sheet's
  project data; the `changes` feed to tell a user their lot's plane was
  re-pinned since the set was printed.
- The Generate panel's lot box calls `/v1/search` for autocomplete (the
  Mapbox-backed index) instead of the editor's own route.

## 3. Open questions for Steve

1. The KEY: one server key in the editor's environment (`MAP_API_KEY`),
   or per-user keys typed into the Lot panel? Server-side is the safe
   default; the headless print script would read the same variable.
2. COVERAGE for Miami Shores (Miami-Dade): the scorecard says Tampa–
   Orlando full plus statewide sections — the parcel and zoning depth for
   Miami-Dade needs a `/v1/coverage` look with a key before Phase 1 is
   promised there.
3. Keep Overpass as the fallback for street names and for lots outside FL
   / CA, or drop it once the dossier covers the front edge?
4. Freeboard: FBC's 1 ft over BFE by default, or the county's own (some
   coastal counties ask 2 ft) — a setting with the county default.

## 4. What the live data showed (2026-09-07, with Steve's test key)

Three dossiers recorded under `docs/reference/map-dossiers/` (plus the
coverage scorecard) — the Phase 0 test fixtures:

| Lot | parcel | zoning | code_basis | flood | elevation terrain | utilities |
|---|---|---|---|---|---|---|
| 1247 NE 104th St, Miami Shores (our preset) | not_covered | not_available (city GIS not connected; FLU says LDR 2.5–6 du/ac) | not_covered | zone X 0.2 %, panel 12086C0306L | point only, no parcel | FPL; no wastewater |
| 501 5th Ave NE, St Petersburg (the docs' example; Pinellas) | 13.1 ac, 3 frontage segments, 30 neighbours | DC-3 form-based: setbacks null + verbatim note, FAR 2, code deep link | zone 2A, frost 0, snow 0, SDC A, wind 150 mph RC II, debris region TRUE, rainfall 13.8 in, 17 subsidence reports in 5 mi | AE, BFE 9 ft NAVD88, 69 % of the parcel, panel 12103C0219H | ready: 0–20.9 ft, 129 one-foot contours | sewer (likely), public water, Duke |
| 2600 Castro Way, Sacramento (our CA preset) | 0.13 ac, NO frontage / adjacency | R-1, no dimensional data | Title 24 zone 12, SDC D (SDS 0.65 / SD1 0.42), liquefaction zone with the CGS report link, no wind value | X behind a levee, panel 06067C0190H | ready: 20.3–22.5 ft, 9 contours | SMUD |

What that changes in the plan:

- Coverage gates everything. Parcel + code basis are FULL in Hillsborough,
  Orange, Pinellas, Lake, Manatee, Osceola, Pasco (zoning partial in the
  first three) and PARCEL is full statewide in California; Miami-Dade has
  no parcel plane yet. So Phase 1 keys off `/v1/coverage` per county and
  the drop-in says which sections the dossier answered — today's ArcGIS
  parcel + Overpass road path stays the fallback wherever `parcel` is
  not_covered (Miami Shores included).
- FRONTAGE only comes with a parcel plane that carries adjacency: the FL
  priority counties give segments (St Pete: 3 — a corner block); the CA
  plane gave none. The front-edge rule: frontage segments when present,
  else the road match, else north-facing — and the status line says which.
- The WIND VALUE is the big structural win: Pinellas reads 150 mph RC II
  with the wind-borne debris region TRUE, where our state table sizes FL
  as one number. Bones' hurricane ties / uplift / bracing and the S-sheet
  criteria table should take the county value with its provenance, and
  the window schedule the impact-glazing note.
- FLOOD is real on the St Pete lot: AE with BFE 9 ft NAVD88 over 69 % of
  the parcel. The finished-floor rule (BFE + freeboard) needs the site
  elevation in the SAME datum — the terrain section gives NAVD88 contours
  (the point elevation is EGM2008 surface: do not mix them).
- ZONING is honest about conditional rules: DC-3 returns null setbacks
  with the code text verbatim and the section link — print the note, keep
  the default with VERIFY; Sacramento's R-1 returns no numbers at all.
- We need RESIDENTIAL presets in the covered counties (Tampa / St Pete /
  Orlando single-family lots) — every current FL preset is Miami-Dade.
- The key lives server-side in `apps/editor/.env.local` (`MAP_API_KEY`,
  gitignored); the headless script reads the same variable. Keys pasted
  into chat should be rotated once the integration is wired.
