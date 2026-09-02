/*
 * VENDORED VERBATIM from PlanCrafters:
 *   C:\Dev\Plan Crafters Integration\plancrafters\app\server-parcel.cjs
 * Copied 2026-09-02 by the `site` workstream. Do not hand-edit — re-copy from
 * the source if it changes. Single dependency: node:https (stdlib). Keyless by
 * default (Census / Esri / ArcGIS); Google paths activate only when
 * MAPS_API_KEY is set.
 */
/* server-parcel.cjs — server-side ParcelScope pipeline (CommonJS, no npm deps).
   Ports the PCS ParcelScope flow onto KEYLESS public data sources so the
   browser app needs no key for geocode / parcel / elevation:
     - geocode   : US Census geocoder (keyless), Google Geocoding fallback
     - parcel    : CA statewide ArcGIS parcels (keyless), rectangle fallback
     - elevation : USGS EPQS (keyless)
     - staticMapUrl : Google Static Maps (needs MAPS_API_KEY) — URL only
   Geometry is lng/lat (degrees) in; FEET for all derived dimensions.
   Every network call is 15s-timeout + fail-soft (returns null on any error). */
'use strict';

const https = require('https');

const TIMEOUT_MS = 15000;
const FEET_PER_DEG_LAT = 364000; // ~ feet per degree of latitude
const USGS_NODATA = -1000000; // EPQS sentinel for "no data"

/* ---- tiny keyless HTTPS GET → parsed JSON, fail-soft -------------------
   Resolves null on any error (timeout, non-2xx, bad JSON) so callers can
   degrade gracefully instead of throwing. */
const getJson = (url, timeoutMs, extraHeaders) => new Promise((resolve) => {
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; resolve(v); } };
  let req;
  try {
    // browser-like UA — some hosts (e.g. MS gis.waggonereng.com) WAF-block non-browser agents.
    // extraHeaders: some sources also demand a Referer (SA's SAPPA atlas sits behind
    // CloudFront and answers 403 "Request blocked" without one — verified 2026-09-01).
    const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PlanCrafters/1.0' };
    for (const k in (extraHeaders || {})) headers[k] = extraHeaders[k];
    req = https.get(url, { headers }, (res) => {
      const code = res.statusCode || 0;
      if (code < 200 || code >= 300) { res.resume(); return done(null); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        if (body.length > 8e6) { req.destroy(); done(null); } // guard runaway responses
      });
      res.on('end', () => {
        try { done(JSON.parse(body)); } catch (e) { done(null); }
      });
    });
  } catch (e) { return done(null); }
  req.on('error', () => done(null));
  req.setTimeout(timeoutMs || TIMEOUT_MS, () => { req.destroy(); done(null); });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- ring generalization tolerance (degrees) for ArcGIS queries ---------
   Jul 20 2026 (Gilroy offset investigation): the old 1e-5 deg tolerance is
   ~3.6 ft on the ground — the server was allowed to shave any vertex within
   3.6 ft of a simplified edge, which visibly pulled complex parcel boundaries
   off fences/driveways. 3e-6 deg (~1.1 ft) matched the site-address path.

   R36 (Steve, Jul 20 evening): GENERALIZATION IS GONE ENTIRELY. Any
   maxAllowableOffset makes the server Douglas-Peucker each parcel
   INDEPENDENTLY, so two lots that share an edge in the fabric come back with
   edges disagreeing by up to 2x the tolerance — the systematic "gaps around
   all the lots, city-wide" he reported. Shape simplification of survey
   fabric is the wrong approach at any tolerance. All query paths now send
   `geometryPrecision=7` instead: COORDINATE ROUNDING (1e-7 deg ≈ 0.44 in),
   shape-preserving, keeps JSON compact, and both sides of a genuinely shared
   edge round to identical digits so seams stay closed. MAX_OFFSET_DEG is
   retained only as the exported historical constant the suite pins against
   ever coming back.
   NOTE the datum itself was verified CORRECT (Jul 20): every wired source
   applies a real NAD83->WGS84 transformation for outSR=4326 (4326 vs 4269
   outputs differ by the true ~1.2-1.5 m shift), and the DWR fabric registers
   to current Google ortho within ~1 ft at the live test block. */
const MAX_OFFSET_DEG = 0.000003;   // historical; no query sends it anymore

/* getJson + retry for INTERMITTENT fast failures. The DWR MapServer 500s
   sub-second on a random fraction of queries (measured live: 1-4 consecutive
   500s, then success) — one un-retried 500 silently dropped CA resolves onto
   the FB fabric, which sits ~4.4 ft east of / ~6.5 ft smaller than the DWR
   ring for the same APN. Retry QUICK failures only: a failure that took
   longer than quickMs was a timeout/stall, and retrying would compound the
   caller's latency budget. opts.fetch is injectable for tests. */
/* Two-wave DWR fetch: its 500 bursts outlast a rapid retry salvo (measured
   live: 5 quick retries still lost ~half the runs) but usually not a second
   salvo after a real pause. Wave 1: 5 quick retries; pause 1200 ms; wave 2:
   3 more. ~3.5 s worst case before the caller may fall back — worth it,
   because the fallback fabric scatters adjacent lots (R36). */
/* DWR CIRCUIT BREAKER (2026-09-01, "GIS is broken in CA"). The failure mode
   changed: the DWR /query endpoint no longer 500s sub-second — it now takes
   ~30 SECONDS to return {"error":{code:500}} on EVERY query (measured live at a
   Sacramento rooftop point). The two-wave retry was built for sub-second
   bursts, so during this outage each dwrFetch burned ~61s (30s + 1.2s pause +
   30s), and the registry path burned it TWICE (envelope + point) before the FB
   fabric — which answers the same point in 0.4s — was ever consulted. Users
   saw CA "not working": the upstream request died before the fallback ran.

   The breaker: one TOTAL dwrFetch failure (both waves lost — not a 0-feature
   miss, which is a valid answer) opens the breaker for 10 minutes, and every
   DWR call in that window returns null IMMEDIATELY so callers drop to their FB
   paths in sub-second time. After 10 minutes one call probes DWR again; the
   moment it answers, everything upgrades back to the primary fabric. Worst
   case during an outage is therefore ONE bounded burn per 10 minutes per
   instance, instead of every CA lookup hanging. Exported (DWR_BREAKER) so
   tests can trip/reset it without the network. */
const DWR_BREAK_MS = 10 * 60 * 1000;
const DWR_BREAKER = { downUntil: 0 };
const dwrFetch = async (url, timeoutMs) => {
  if (Date.now() < DWR_BREAKER.downUntil) return null;   // open -> FB immediately
  const t0 = Date.now();
  let j = await getJsonRetry(url, timeoutMs, { tries: 5 });
  if (j) return j;
  /* Wave 2 exists for the sub-second 500 BURSTS (five quick fails + backoffs
     ≈ 6s worst). A first wave that took >= 7s hit the slow-stall mode instead
     (one failure at the timeout — the 2026-09-01 outage delivers its 500 in
     ~30s), where a second salvo can only compound the caller's wait: trip the
     breaker now and let the FB fabric serve. */
  if (Date.now() - t0 >= 7000) { DWR_BREAKER.downUntil = Date.now() + DWR_BREAK_MS; return null; }
  await sleep(1200);
  j = await getJsonRetry(url, timeoutMs, { tries: 3 });
  if (!j) DWR_BREAKER.downUntil = Date.now() + DWR_BREAK_MS;
  return j;
};

const getJsonRetry = async (url, timeoutMs, opts) => {
  opts = opts || {};
  const tries = Math.max(1, opts.tries || 3);
  const quickMs = opts.quickMs != null ? opts.quickMs : 6000;
  const backoffMs = opts.backoffMs != null ? opts.backoffMs : 500;
  // opts.headers rides through to getJson (SA's SAPPA layer needs a Referer);
  // an injected opts.fetch (tests) keeps its exact two-arg contract.
  const fetch = opts.fetch || ((u, t) => getJson(u, t, opts.headers));
  const now = opts.now || Date.now;               // injectable clock — tests must not ride wall time
  for (let i = 0; i < tries; i++) {
    const t0 = now();
    const j = await fetch(url, timeoutMs);
    /* R36 — ArcGIS reports failures as HTTP 200 + {"error":{code:500,...}}.
       getJson parses that fine, so a truthy check read the ERROR as success
       and the retry layer NEVER retried on the live failure mode (measured:
       DWR 200-wrapped 500s in 3-5 s bursts → every burst silently fell back
       to the scattered FB fabric). A body carrying .error is a failure. */
    if (j && j.error == null) return j;
    // '>=' matters: quickMs=0 must mean EVERY failure is slow. With '>', a
    // failure resolving within the same millisecond measured 0 > 0 = false and
    // got retried — a boundary flake that hit only on fast idle machines.
    if (now() - t0 >= quickMs) return null;       // slow failure — do not compound timeouts
    if (i < tries - 1) await sleep(backoffMs * (i + 1));
  }
  return null;
};

/* ======================= geometry helpers ============================= */

/* shoelace area in square FEET for one or more rings ([[ [lng,lat],... ]]).
   Degrees → feet using FEET_PER_DEG_LAT for lat and a cos(lat) scale for
   lng (so areas are correct at the ring's own latitude). Outer ring counts
   positive; any further rings are treated as holes and subtracted. */
const ringsAreaSqFt = (rings) => {
  if (!Array.isArray(rings) || !rings.length) return 0;
  const flat = rings.filter((r) => Array.isArray(r) && r.length >= 3);
  if (!flat.length) return 0;
  // reference latitude = first vertex of the first ring
  const lat0 = flat[0][0][1];
  const fx = FEET_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180); // feet per deg lng
  const fy = FEET_PER_DEG_LAT;
  // SIGNED shoelace per ring (do NOT abs each one): ArcGIS winds outer rings one
  // way and holes the other, so summing signed areas SUBTRACTS true donut holes
  // while ADDING multipart outer pieces (a parcel split into two pieces encodes
  // as several same-winding outer rings). The old code abs'd each ring and
  // subtracted rings[1..], which zeroed out a 2-part parcel's area. abs() the
  // final net so the result is winding-convention-agnostic.
  const ringSigned = (ring) => {
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      a += (p[0] * fx) * (q[1] * fy) - (q[0] * fx) * (p[1] * fy);
    }
    return a / 2;
  };
  let total = 0;
  for (let i = 0; i < flat.length; i++) total += ringSigned(flat[i]);
  return Math.abs(total);
};

/* lat/lng bounding box of all rings -> {n,s,e,w}. null if no usable verts. */
const ringsBounds = (rings) => {
  if (!Array.isArray(rings)) return null;
  let n = -Infinity, s = Infinity, e = -Infinity, w = Infinity, seen = false;
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue;
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const lng = p[0], lat = p[1];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (lat > n) n = lat;
      if (lat < s) s = lat;
      if (lng > e) e = lng;
      if (lng < w) w = lng;
      seen = true;
    }
  }
  return seen ? { n, s, e, w } : null;
};

/* derive a width/depth (feet) for a lot given its area + perimeter, by
   solving the rectangle that has both: w+d = perim/2, w*d = area.
   Falls back to a square (sqrt area) when the quadratic has no real root. */
const lotDimsFromAreaPerim = (area, perim) => {
  const a = Math.max(0, Number(area) || 0);
  const p = Math.max(0, Number(perim) || 0);
  if (a <= 0) return { lotWidthFt: 0, lotDepthFt: 0 };
  const half = p / 2; // w + d
  const disc = half * half - 4 * a; // (w+d)^2 - 4wd
  if (p > 0 && disc >= 0) {
    const root = Math.sqrt(disc);
    const w = (half + root) / 2;
    const d = (half - root) / 2;
    return { lotWidthFt: Math.round(w * 10) / 10, lotDepthFt: Math.round(d * 10) / 10 };
  }
  const side = Math.sqrt(a);
  return { lotWidthFt: Math.round(side * 10) / 10, lotDepthFt: Math.round(side * 10) / 10 };
};

/* perimeter (feet) of the outer ring */
const ringPerimeterFt = (ring) => {
  if (!Array.isArray(ring) || ring.length < 2) return 0;
  const lat0 = ring[0][1];
  const fx = FEET_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const fy = FEET_PER_DEG_LAT;
  let per = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const dx = (q[0] - p[0]) * fx;
    const dy = (q[1] - p[1]) * fy;
    per += Math.sqrt(dx * dx + dy * dy);
  }
  return per;
};

/* ======================= geocode ===================================== */

/* PRIMARY: US Census onelineaddress geocoder (keyless). */
/* ---- STREET-NAME INTEGRITY (2026-09-01, 4040 Minnesota Creek, Fair Oaks) ----
   Every geocoder we ask (Census, Esri, even Sacramento County's own) FUZZY-
   MATCHES an unknown street to the nearest-spelled known one and reports it
   with a confident score: "4040 Minnesota Creek" came back as "4040 Minnesota
   AVE, score 95.8". The interpolated point sat in the roadway, no polygon
   contained it, and the nearest-lot fallback handed the studio 7689 FERRARI
   CT — the corner house. The real lot (4040 BRAXTON LN, Lot 1 of Woodland
   Lane Estates, on Minnesota Creek) was 180 m west.

   So a candidate carries the street it MATCHED and whether that agrees with
   the street ASKED FOR. When every candidate substituted the street, the
   resolver refuses the nearest-lot fallback: it looks for the same house
   number within ~400 m on a county layer that indexes situs numbers, and
   returns that lot LABELED as a number match — or an honest miss. Never a
   confident neighbour. */
const requestedStreet = (address) => {
  const m = String(address || '').match(/^\s*\d+[\w-]*\s+([^,]+?)(?:,|$)/);
  return m ? m[1].trim() : '';
};
const _STREET_ALIASES = { MT: 'MOUNT', ST: 'SAINT', FT: 'FORT', N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' };
const _streetTokens = (street) => streetCore(street)
  .split(/\s+/).filter(Boolean)
  .map((t) => _STREET_ALIASES[t] || t);
/* true when the two street names agree on their core tokens (type suffix and
   common abbreviations normalised). Empty on either side = nothing to compare
   = NOT a mismatch (a mismatch is only ever asserted from evidence). */
const streetMatches = (requested, matched) => {
  const a = _streetTokens(requested), b = _streetTokens(matched);
  if (!a.length || !b.length) return true;
  return a.join(' ') === b.join(' ');
};
/* leading house number of an address string, digits only */
const houseNumberOf = (address) => {
  const m = String(address || '').match(/^\s*(\d+)/);
  return m ? m[1] : '';
};

const geocodeCensus = async (address) => {
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
    + '?address=' + encodeURIComponent(address)
    + '&benchmark=Public_AR_Current&format=json';
  const j = await getJson(url);
  const m = j && j.result && j.result.addressMatches && j.result.addressMatches[0];
  if (!m || !m.coordinates) return null;
  const c = m.addressComponents || {};
  const lat = Number(m.coordinates.y);
  const lng = Number(m.coordinates.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    formattedAddress: m.matchedAddress || address,
    // the street the geocoder actually matched vs the one asked for (see streetMatches)
    matchedStreet: requestedStreet(m.matchedAddress || ''),
    streetMatch: streetMatches(requestedStreet(address), requestedStreet(m.matchedAddress || '')),
    state: c.state || '',
    county: '', // Census onelineaddress doesn't return county directly
    zip: c.zip || '',
    country: 'US', // the US Census geocoder only ever answers for US addresses
  };
};

/* FALLBACK: Google Geocoding (only when MAPS_API_KEY is set). */
const geocodeGoogle = async (address) => {
  const key = process.env.MAPS_API_KEY;
  if (!key) return null;
  const url = 'https://maps.googleapis.com/maps/api/geocode/json'
    + '?address=' + encodeURIComponent(address)
    + '&components=country:US'  // US-ONLY (Jul 11): never resolve a foreign address
    + '&key=' + key;
  const j = await getJson(url);
  const r = j && j.results && j.results[0];
  if (!r || !r.geometry || !r.geometry.location) return null;
  const loc = r.geometry.location;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const comp = (type, useShort) => {
    const hit = (r.address_components || []).find((x) => (x.types || []).includes(type));
    return hit ? (useShort ? hit.short_name : hit.long_name) : '';
  };
  let state = comp('administrative_area_level_1', true);
  let county = comp('administrative_area_level_2', false).replace(/ County$/i, '');
  // With components=country:US a FOREIGN address degrades to a country-level
  // match ("United States", centroid of the US, NO state) — junk for parcel
  // work; reject it so geocode() returns an honest null instead of Colorado.
  if (!state) return null;
  return {
    latitude: lat,
    longitude: lng,
    formattedAddress: r.formatted_address || address,
    state,
    county,
    zip: comp('postal_code', false),
    country: 'US', // hard-restricted by components=country:US above
  };
};

/* FALLBACK 2: Esri ArcGIS World geocoder (KEYLESS findAddressCandidates). The US
   Census geocoder MISSES many addresses (rural, just-outside-city-limits, new
   subdivisions — e.g. the NC + VA test addresses); the Esri World geocoder resolves
   them. Keyless single-line geocode, returns lon/lat + a parsed state.

   2026-09-01: sourceCountry widened USA -> USA,AUS. Australia is now a wired
   coverage area (the AU-* registry entries below), and the Esri geocoder
   resolves AU addresses keylessly with the same rooftop quality (verified:
   "1 Macquarie St, Sydney NSW 2000" -> Addr_type PointAddress, RegionAbbr NSW,
   Country AUS). The Jul-11 rule survives in its real intent: an address from a
   country we can't serve STILL degrades to a stateless candidate and is still
   rejected — nothing outside US+AU ever resolves. */
const geocodeArcGIS = async (address) => {
  const url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
    + '?SingleLine=' + encodeURIComponent(address) + '&outFields=Region,RegionAbbr,Subregion,Postal,Country,Addr_type,StName,StType'
    + '&sourceCountry=USA,AUS'  // US + Australia only — see the note above
    + '&maxLocations=1&f=json';
  const j = await getJson(url);
  const c = j && j.candidates && j.candidates[0];
  if (!c || !c.location) return null;
  const lat = Number(c.location.y), lng = Number(c.location.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const at = c.attributes || {};
  const country = String(at.Country || '').toUpperCase() === 'AUS' ? 'AU' : 'US';
  const state = at.RegionAbbr
    || (country === 'AU' ? _auStateAbbr(at.Region) : _stateAbbr(at.Region)) || '';
  // A candidate with NO state is a country-level degrade (the centroid of a
  // country, junk for parcel work) — reject it so geocode() returns an honest null.
  if (!state) return null;
  return {
    latitude: lat,
    longitude: lng,
    formattedAddress: c.address || address,
    matchedStreet: String(at.StName ? (at.StName + (at.StType ? ' ' + at.StType : '')) : requestedStreet(c.address || '')).trim(),
    streetMatch: streetMatches(requestedStreet(address), at.StName || requestedStreet(c.address || '')),
    state,
    county: (at.Subregion || '').replace(/ County$/i, ''),
    zip: at.Postal || '',
    country,
  };
};
// minimal full-name → 2-letter state map (Esri sometimes returns the full Region name)
const _STATE_ABBR = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };
const _stateAbbr = (name) => _STATE_ABBR[name] || '';
// Australian states/territories (Esri sometimes returns the full Region name).
const _AU_STATE_ABBR = { 'New South Wales': 'NSW', Victoria: 'VIC', Queensland: 'QLD', 'South Australia': 'SA', 'Western Australia': 'WA', Tasmania: 'TAS', 'Northern Territory': 'NT', 'Australian Capital Territory': 'ACT' };
const _auStateAbbr = (name) => _AU_STATE_ABBR[name] || '';

/* Which STATE_REGISTRY key serves this state+country. Australian entries are
   'AU-' prefixed because two AU abbreviations collide with US states ('WA' is
   both Washington and Western Australia; 'SA' would be one typo from a US
   code) — the prefix makes a cross-country mix-up structurally impossible. */
const registryKey = (state, country) =>
  (String(country || 'US').toUpperCase() === 'AU' ? 'AU-' : '') + String(state || '').toUpperCase();

/* Country inference for the coordinate paths (parcelAt / parcelsNear get a
   lat/lng and often no country). A generous box around Australia — nothing of
   the US is within 30 degrees of it, so a point inside is AU, full stop. */
const inAustralia = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -44.5 && lat <= -9.0 && lng >= 112.0 && lng <= 154.5;

/* Returns the best candidate, and ALSO exposes the alternates on `.candidates`
   so the parcel resolver can retry when the first point lands somewhere with no
   parcel polygon.

   WHY: the Census onelineaddress geocoder returns street-RANGE interpolations —
   a point on the road centreline derived from an address range, not a rooftop.
   Returning the first result that merely carries a state made that interpolation
   win outright, and the Esri World geocoder (which resolves the same address to
   an actual rooftop) was never consulted. Measured at 4202 E Fowler Ave, Tampa:
   Census put the point ~1.5 km away in the Fowler Ave right-of-way with ZIP
   33612, where the parcel query correctly returns 0 features; Esri resolved the
   same address to Addr_type PointAddress, score 100, ZIP 33620, where the query
   returns the parcel in 239 ms. The caller now tries each candidate in turn, so
   an interpolated first guess costs one extra query instead of the whole
   lookup. Same shape as before for every existing consumer — `geo.latitude`,
   `.longitude`, `.state` are unchanged on the returned object. */
const geocode = async (address) => {
  if (!address || !String(address).trim()) return null;
  const addr = String(address).trim();
  // In parallel: the services are independent, and awaiting Census FIRST made
  // every Australian lookup eat the Census wait (a US-only service that can
  // run to its 15s timeout on a foreign address — measured 27s total for a
  // Sydney address in production) before Esri was even asked.
  const [census, esri] = await Promise.all([geocodeCensus(addr), geocodeArcGIS(addr)]);

  // Rooftop-quality first. Esri's findAddressCandidates is a true point-address
  // match where it succeeds; Census is kept as a fallback and as a cross-check.
  const ordered = [esri, census].filter((g) => g && g.state);
  if (!ordered.length) {
    const g = census || esri || (await geocodeGoogle(addr));
    if (g) g.candidates = [g];
    return g;
  }
  const best = ordered[0];
  best.candidates = ordered;
  return best;
};

/* ======================= parcel ====================================== */

// CA statewide parcels (keyless, all 58 counties). The former
// services1.arcgis.com/.../CA_Statewide_Parcels_Public_view FeatureServer got
// locked behind a token ({code:499 "Token Required"}) — so EVERY parcel query
// silently fell back to the synthetic 60x100 rectangle (no real lot, no APN, no
// adjacents, mis-anchored aerial). Migrated to the State of California (DWR)
// public LightBox assessor-parcels MapServer: keyless, statewide, and the SAME
// schema we already map (PARCEL_APN / TAXAPN, COUNTYNAME, SITE_* site-address).
const CA_PARCELS = 'https://gis.water.ca.gov/arcgis/rest/services/planning/'
  + 'i15_Parcels_Assessor_Lightbox/MapServer/0/query';
// FALLBACK (Jul 6 2026: the DWR /query endpoint began 500-ing on EVERY query —
// even returnCountOnly — while its layer metadata stayed up. All CA resolves
// silently degraded to the synthetic 60x100 rectangle centered on the STREET-
// interpolated geocode point, so generated houses landed in the road). This is
// the same LightBox parcel fabric re-hosted statewide on ArcGIS Online; it
// exposes ONLY PARCEL_APN / SITE_ADDR (full "3258 STOCKTON BLVD" string) /
// SITE_CITY, so county/zip/owner come back empty on fallback hits — still a
// real recorded lot polygon + true APN instead of a fabricated rectangle.
// Third-party hosted copy: keep DWR primary; this answers only when DWR fails.
const CA_PARCELS_FB = 'https://services2.arcgis.com/zr3KAIbsRSUyARHG/arcgis/'
  + 'rest/services/CA_State_Parcels/FeatureServer/0/query';

/* pull the first present value among candidate attribute keys */
const pick = (attrs, keys) => {
  if (!attrs) return '';
  for (const k of keys) {
    if (attrs[k] != null && attrs[k] !== '') return attrs[k];
    // case-insensitive scan as a last resort
    const lk = k.toLowerCase();
    for (const a of Object.keys(attrs)) {
      if (a.toLowerCase() === lk && attrs[a] != null && attrs[a] !== '') return attrs[a];
    }
  }
  return '';
};

/* approximate 60x100ft rectangle centered on the point, returned as
   [lng,lat] rings (closed). 60ft wide (E-W) x 100ft deep (N-S). */
const rectangleRings = (lat, lng) => {
  const fLat = FEET_PER_DEG_LAT;
  const fLng = FEET_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const halfW = 30 / fLng; // 60ft total E-W -> 30ft each side, in deg lng
  const halfD = 50 / fLat; // 100ft total N-S -> 50ft each side, in deg lat
  const ring = [
    [lng - halfW, lat - halfD],
    [lng + halfW, lat - halfD],
    [lng + halfW, lat + halfD],
    [lng - halfW, lat + halfD],
    [lng - halfW, lat - halfD],
  ];
  return [ring];
};

/* ---- NATIONAL parcel registry: state → validated ArcGIS parcel layer ----
   Validated LIVE (June 2026): geocode the address → spatial-intersect the layer →
   keep the parcel that CONTAINS the point (else smallest plausible, 200–660k sqft).
   Each: { url(.../query), mode 'point'|'envelope'|'situs', env? deg half, situsField?,
   timeout? }. A value may also be an ARRAY of cfgs (per-county Tier-2 states: AZ, GA,
   IL, MI, plus AK's 6 boroughs) — _queryRegistry tries each, first polygon wins. The
   point-in-polygon pick rejects ROW/section overlaps (WY), neighbor slivers (NJ) and
   wrong-layer county polygons. See gis-coverage.md. (NE has no live statewide layer;
   per-county states only cover their listed metros — others fall back to rectangle.) */
const _Q = (u) => u + '/query';
const STATE_REGISTRY = {
  CA: [ // DWR statewide primary; ArcGIS-Online LightBox copy when DWR's query endpoint is down
    /* fetchVia:'dwr' routes this entry through dwrFetch, so it shares the
       circuit breaker with the APN / site-address / parcels-near paths: the
       first total DWR failure diverts EVERY CA query straight to the FB row
       below for 10 minutes. timeout 45000 -> 8000: healthy DWR answers a
       spatial intersect in 0.24-1.6s (measured), while the 2026-09-01 outage
       mode takes ~30s to deliver its 500 — at 45s the outage cost ~61s per
       wave-pair; at 8s the ONE probe that trips the breaker costs ~17s and
       everything after is sub-second on the FB fabric. */
    /* SACRAMENTO COUNTY FIRST (2026-09-01). The county's own Active GIS Parcel
       Base: current fabric (the statewide LightBox copies lag it), authoritative
       APN_DASH/APN10, situs STREET_NBR/STREET_NAME, subdivision + lot, and —
       measured — INDEXED attribute queries: APN lookup 0.5 s, "house number N
       within an envelope" 0.47 s, where the AGOL statewide fabric full-scans
       for 20-31 s. `near` gates it to the county; `numberField`/`apnFields`
       let the integrity paths (number-nearby, APN entry) use it directly.
       Keyless: mapservices.gis.saccounty.net/arcgis/rest/services. */
    { url: _Q('https://mapservices.gis.saccounty.net/arcgis/rest/services/PARCELS/MapServer/8'), mode: 'envelope', timeout: 8000, county: 'Sacramento', near: [-121.35, 38.55], numberField: 'STREET_NBR', streetField: 'STREET_NAME', apnFields: ['APN_DASH', 'APN10'] },
    { url: CA_PARCELS, mode: 'envelope', timeout: 8000, fetchVia: 'dwr' },
    { url: CA_PARCELS_FB, mode: 'envelope', timeout: 25000 },
  ],

  /* ── AUSTRALIA (2026-09-01) ──────────────────────────────────────────────
     Keys are 'AU-' + state (see registryKey). Every layer below was verified
     LIVE on 2026-09-01 with a spatial envelope query at a capital-city point:
       NSW  Spatial Services Lot layer          Sydney     1.4s  13 features
       VIC  Vicmap-as-a-Service Parcel (DEECA)  Melbourne  1.5s  120 features
       QLD  DCDB Land Parcel Framework          Brisbane   1.8s  31 features
       SA   SAPPA Land Parcels (needs Referer)  Adelaide   0.8s  6 features
       WA   SLIP Cadastre LGATE-001             Perth      1.1s  66 features
       TAS  theLIST Cadastral Parcels           Hobart     1.9s  20 features
       ACT  ACTGOV_BLOCKS (blocks ARE parcels)  Canberra   0.3s  1 feature
     WA's layer is the "(No Attributes)" cadastre — real polygons, no APN/situs
     attributes, so a WA lot resolves with true geometry and an empty apn
     (honest, like DE/HI/RI stateside). SA's SAPPA sits behind CloudFront and
     403s without a Referer; the headers entry rides through getJson. SA's
     service name carries a version (V19) that Plan SA bumps occasionally —
     if SA starts 404ing, list .../SAPPA?f=json and take the newest.
     NT (~1% of AU population) has NO wired layer: its cadastre lives in the
     NTLIS/ILIS WMS/WFS stack, not ArcGIS REST, and the only AGOL "Parcels"
     service from an NT-gov owner is a 24k-feature Darwin-area extract that
     returned 0 features at a real Parap residential block — a partial fabric
     would resolve some suburbs and silently rectangle the rest, so NT stays
     an honest miss until a complete source exists. */
  'AU-NSW': { url: _Q('https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9'), mode: 'envelope' },
  'AU-VIC': { url: _Q('https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/Vicmap_Parcel/FeatureServer/0'), mode: 'envelope' },
  'AU-QLD': { url: _Q('https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4'), mode: 'envelope' },
  'AU-SA': { url: _Q('https://lsa2.geohub.sa.gov.au/arcgis/rest/services/SAPPA/PropertyPlanningAtlasV19/MapServer/269'), mode: 'envelope', headers: { referer: 'https://sappa.plan.sa.gov.au/' } },
  'AU-WA': { url: _Q('https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Property_and_Planning/MapServer/2'), mode: 'envelope' },
  'AU-TAS': { url: _Q('https://services.thelist.tas.gov.au/arcgis/rest/services/Public/CadastreAndAdministrative/MapServer/38'), mode: 'envelope' },
  'AU-ACT': { url: _Q('https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_BLOCKS/FeatureServer/0'), mode: 'envelope' },
  AR: { url: _Q('https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6'), mode: 'point' },
  CO: { url: _Q('https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0'), mode: 'point' },
  CT: { url: _Q('https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0'), mode: 'point' },
  DE: { url: _Q('https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/FeatureServer/0'), mode: 'envelope' },
  /* FL was mode:'situs'. UPPER(PHY_ADDR1) LIKE '...' against the statewide
     cadastral layer TIMES OUT (measured 40,003 ms, no response, retried 3x —
     ~95 s to produce nothing). The same layer answers a spatial envelope query
     at the geocoded point in 239-1,739 ms with the correct single feature, so
     it is queried the way the other statewide layers are. PHY_ADDR1 is still
     read off the returned attributes for the address label. */
  FL: { url: _Q('https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0'), mode: 'envelope', situsField: 'PHY_ADDR1' },
  HI: { url: _Q('https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25'), mode: 'envelope' },
  ID: { url: _Q('https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0'), mode: 'envelope' },
  IN: { url: _Q('https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0'), mode: 'situs', situsField: 'prop_add' },
  MA: { url: _Q('https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0'), mode: 'point' },
  MD: { url: _Q('https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0'), mode: 'point' },
  ME: { url: _Q('https://services1.arcgis.com/RbMX0mRVOFNTdLzd/arcgis/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10'), mode: 'envelope' },
  MN: { url: _Q('https://pca-gis02.pca.state.mn.us/arcgis/rest/services/base/parcels_open_data_counties/MapServer/0'), mode: 'envelope' },
  MS: { url: _Q('https://gis.waggonereng.com/server/rest/services/Hosted/Mississippi_Parcels_Staewide/FeatureServer/3'), mode: 'envelope' },
  MT: { url: _Q('https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer/0'), mode: 'envelope' },
  NC: { url: _Q('https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1'), mode: 'envelope' },
  ND: { url: _Q('https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer/0'), mode: 'point' },
  NH: { url: _Q('https://nhgeodata.unh.edu/hosting/rest/services/Hosted/CAD_ParcelMosaic/FeatureServer/1'), mode: 'point' },
  NJ: { url: _Q('https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0'), mode: 'envelope' },
  NM: { url: _Q('https://services.arcgis.com/CWv1abTnC3urn4bV/arcgis/rest/services/2024_Tax_Parcels_Public_vs_Private/FeatureServer/0'), mode: 'envelope' },
  NV: { url: _Q('https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0'), mode: 'envelope' },
  NY: { url: _Q('https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1'), mode: 'point' },
  OH: { url: _Q('https://gis.ohiodnr.gov/arcgis/rest/services/OIT_Services/odnr_landbase/MapServer/4'), mode: 'envelope' },
  RI: { url: _Q('https://risegis.ri.gov/hosting/rest/services/RIDEM/Tax_Parcels/MapServer/0'), mode: 'envelope' },
  TN: { url: _Q('https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0'), mode: 'envelope', env: 0.0004 },
  /* TX intentionally has NO entry here — see the TX array further down. It carries
     the county sources AND the statewide StratMap layer as its final fallback.
     A second `TX:` key at this position would be silently DELETED by the later one
     (last key wins in an object literal), which is exactly what happened between
     R77 and R84: the statewide layer sat here looking correct while being dead, so
     the ~229 Texas counties outside the named list fell to the approximate
     rectangle. Every test passed because every test point was inside a named
     county, and `node --check` does not flag a duplicate key. */
  UT: { url: _Q('https://services1.arcgis.com/2exN3kG1f2h7coIQ/arcgis/rest/services/Parcels_SaltLake_LIR__442509739482180703/FeatureServer/0'), mode: 'envelope' },
  VA: { url: _Q('https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VA_Base_Layers/VA_Parcels/FeatureServer/0'), mode: 'point' },
  VT: { url: _Q('https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_VTPARCELS_WM_NOCACHE_v2/FeatureServer/1'), mode: 'envelope' },
  WA: { url: _Q('https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0'), mode: 'envelope' },
  WI: { url: _Q('https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels/FeatureServer/0'), mode: 'envelope' },
  WV: { url: _Q('https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/0'), mode: 'envelope' },
  WY: { url: _Q('https://services3.arcgis.com/r0iJ85SKZ4zAzz3P/arcgis/rest/services/Wyoming_Parcels_for_2026/FeatureServer/0'), mode: 'envelope' },
  NE: { url: _Q('https://giscat.ne.gov/enterprise/rest/services/StatewideParcelsExternal/FeatureServer/0'), mode: 'point' },   // NE statewide (CAMA, County_ID)
  PA: { url: _Q('https://gis.dep.pa.gov/depgisprd/rest/services/Parcels/PA_Parcels/MapServer/0'), mode: 'envelope' },          // PA statewide parcels

  // ---- PER-COUNTY states (Tier-2): no single statewide layer, so each value is an
  // ARRAY of big-metro county/borough layers. _queryRegistry tries them in order; a
  // service holds ONLY its own jurisdiction's parcels, so the one that returns a
  // polygon IS the right county (containment pick finds the exact lot). Append more
  // counties here over time — addresses outside the listed counties fall back to the
  // approximate rectangle. Validated LIVE June 2026 (gis-coverage.md build-plan #3).
  // `county` here is the AUTHORITATIVE jurisdiction label — it overrides the
  // attribute pick (these layers expose only a township/assessment field, e.g. Cook
  // stores "North Chicago" assessment township, which is NOT the county).
  AZ: [ // Maricopa (~62% pop) — Phoenix metro; MaricopaDynamicQueryService layer 3
    { url: _Q('https://gis.mcassessor.maricopa.gov/arcgis/rest/services/MaricopaDynamicQueryService/MapServer/3'), mode: 'envelope', county: 'Maricopa' },
  ],
  GA: [ // Fulton (Atlanta) — Tax_Parcels FeatureServer 0
    { url: _Q('https://services1.arcgis.com/AQDHTHDrZzfsFsB5/arcgis/rest/services/Tax_Parcels/FeatureServer/0'), mode: 'envelope', county: 'Fulton' },
  ],
  IL: [
    // Collar counties FIRST, because COOK IS DOWN and costs ~3.2s per attempt.
    // Measured 2026-07-26: every Illinois lookup — Lakeview, Hyde Park, Beverly,
    // Rogers Park, the Loop — fell back to the synthetic rectangle in a uniform
    // ~3.2s. That is a timeout signature, not a coverage gap.
    { url: _Q('https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/ParcelsWithRealEstateCC/MapServer/0'), mode: 'envelope', county: 'DuPage', near: [-88.11, 41.85] },  // 392ms
    { url: _Q('https://services3.arcgis.com/HESxeTbDliKKvec2/arcgis/rest/services/OpenData_ParcelPolygons/FeatureServer/0'), mode: 'envelope', county: 'Lake', near: [-87.86, 42.33] }, // 202ms
    { url: _Q('https://services.arcgis.com/iPiPjILCMYxPZWTc/arcgis/rest/services/Tax_Parcels/FeatureServer/5'), mode: 'envelope', county: 'Peoria', near: [-89.6, 40.72] },       // 275ms — NOTE layer /5
    // COOK — kept LAST, deliberately, and it does not work today. Two separate
    // problems: (a) the whole gis.cookcountyil.gov/traditional ArcGIS Server site
    // is down, and (b) cookVwrDynmc is the RETIRED CookViewer 2 service even when
    // it answers — the live bundle is CookViewer 3.0 on maps.cookcountyil.gov.
    // Every public substitute for Chicago proper was checked and none serves it
    // (the CDM Smith trimmed layer is project-clipped; Will County needs a token).
    // Left in place so it resumes working if the county restores the host, but
    // moved behind the collar counties so it stops taxing every IL lookup.
    // CHICAGO PROPER STILL HAS NO WORKING PARCEL SOURCE — that is open, not fixed.
    { url: _Q('https://gis.cookcountyil.gov/traditional/rest/services/cookVwrDynmc/MapServer/44'), mode: 'envelope', county: 'Cook', near: [-87.6298, 41.8781] },
  ],
  MI: [ // Oakland (Detroit metro) — Enterprise/EnterpriseOpenParcelDataMapService layer 1 (Tax Parcel Plus)
    { url: _Q('https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1'), mode: 'envelope', county: 'Oakland' },
  ],
  // ---- 11 states added Jul 2026 (research-verified live polygon parcel layers) ----
  AL: [ // Montgomery
    { url: _Q('https://web3.kcsgis.com/kcsgis/rest/services/Montgomery/AL_Montgomery_GIS_VAM/MapServer/29'), mode: 'point', county: 'Montgomery', near: [-86.3000, 32.3668] },  // Montgomery AL — NOT the TX one
  ],
  IA: [ // Linn (Cedar Rapids)
    { url: _Q('https://services.arcgis.com/i14SLLmXo7Hn9vNc/arcgis/rest/services/RealEstateParcel/FeatureServer/0'), mode: 'point', county: 'Linn' },
  ],
  KS: [ // Wyandotte (Kansas City KS)
    { url: _Q('https://gisweb.wycokck.org/arcgis/rest/services/GISPUB/UGMAPS_4_V02/MapServer/0'), mode: 'point', county: 'Wyandotte' },
  ],
  KY: [ // Fayette (Lexington)
    { url: _Q('https://services1.arcgis.com/Mg7DLdfYcSWIaDnu/ArcGIS/rest/services/Parcel/FeatureServer/0'), mode: 'point', county: 'Fayette' },
  ],
  LA: [ // East Baton Rouge
    { url: _Q('https://maps.brla.gov/gis/rest/services/Cadastral/Tax_Parcel/MapServer/0'), mode: 'point', county: 'East Baton Rouge' },
  ],
  MO: [ // St. Louis City; Franklin (R59d — Steve's Luebbering carport site).
    // Franklin tries the county's OWN address index FIRST (R59g): the Census
    // geocode point sits on the road line and landed in the NEIGHBOR parcel —
    // the situs match ("4255 PROJECT RD…" → PID …013.000) is authoritative.
    { url: _Q('https://maps8.stlouis-mo.gov/arcgis/rest/services/ASSESSOR/Assessor_Public_Parcels/MapServer/11'), mode: 'point', county: 'St. Louis', near: [-90.1994, 38.6270] },
    { url: _Q('https://services7.arcgis.com/HM4C7tGF5KT34U6h/arcgis/rest/services/FRANKLIN_CO_ARCGIS_ONLINE_2_gdb/FeatureServer/37'), mode: 'situs', situsField: 'SITUS_ADDRESS', county: 'Franklin' },
    { url: _Q('https://services7.arcgis.com/HM4C7tGF5KT34U6h/arcgis/rest/services/FRANKLIN_CO_ARCGIS_ONLINE_2_gdb/FeatureServer/20'), mode: 'point', county: 'Franklin', near: [-91.0600, 38.4100] },
  ],
  OK: [ // Tulsa
    { url: _Q('https://services2.arcgis.com/XkZ90iCdbTJ9oNXl/arcgis/rest/services/ResidentialParcels/FeatureServer/0'), mode: 'point', county: 'Tulsa' },
  ],
  OR: [ // Marion (Salem)
    { url: _Q('https://gis.co.marion.or.us/arcgis/rest/services/Public/Parcels/MapServer/0'), mode: 'point', county: 'Marion' },
  ],
  SD: [ // Pennington (Rapid City)
    { url: _Q('https://gis.rcgov.org/server/rest/services/AGOL/AGOL/MapServer/0'), mode: 'point', county: 'Pennington' },
  ],
  SC: [ // Greenville
    { url: _Q('https://citygis.greenvillesc.gov/arcgis/rest/services/AddressSearch/Property/MapServer/3'), mode: 'point', county: 'Greenville' },
  ],
  // Tarrant (Fort Worth / Arlington) — the Tarrant Appraisal District parcel layer.
  // 758,633 parcels, 55 fields, and materially richer than the statewide layer,
  // which carries only Prop_ID/OWNER_NAME/SITUS_ADDR/LEGAL_DESC/GIS_AREA. TAD adds
  // ACCOUNT + TAXPIN (APN), LAND_ACRES/LAND_SQFT, YEAR_BUILT, LIVING_ARE and the
  // subdivision. Independently re-verified 2026-07-26: 6/6 exact SITUS matches on
  // real single-family lots (7,119-11,356 sqft, real rings), 0/8 failures on a
  // repeat burst, median 1217ms, and ZERO features returned for Dallas / Denton /
  // Johnson / Parker points — so it cannot hijack a neighbouring county.
  // NOTE: several rows can share one polygon (personal-property and
  // improvement-only accounts repeat a TAXPIN with LAND_ACRES 0). pickParcelFeature
  // sorts by area and prefers the containing feature, so the 0-acre duplicates lose.
  // Ordered by build volume / population, because the registry tries them in order
  // and a wrong-county service returns zero features (confirmed: Tarrant returns 0
  // for Dallas / Denton / Johnson / Parker points, so no source can hijack another).
  // Every URL below was queried live on 2026-07-26 with the production query shape
  // and returned real polygon rings — 13/13 candidates passed, timings noted.
  TX: [
    // env 0.0006, not the 0.0002 default: HCAD returns ZERO features at 0.0002
    // (~22 m) on a Meyerland test point and 6 at 0.0006 (~66 m), all inside the
    // 200..660000 sqft gate. The point query returns 0 too, so the geocode lands
    // just off the polygon — a slightly wider net is what makes Houston resolve.
    // pickParcelFeature still prefers a CONTAINING parcel, so widening cannot
    // steal a neighbour's lot when the correct one is actually under the point.
    { url: _Q('https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0'), mode: 'envelope', county: 'Harris', env: 0.0006, near: [-95.472621, 29.678488] }, // Houston, 205ms
    { url: _Q('https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4'), mode: 'envelope', county: 'Dallas', near: [-96.77, 32.85] },        // Dallas, 358ms
    { url: _Q('https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcels/FeatureServer/0'), mode: 'envelope', county: 'Tarrant', near: [-97.35, 32.7025] }, // Fort Worth/Arlington — D.R. Horton HQ, 361ms
    { url: _Q('https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0'), mode: 'envelope', county: 'Bexar', near: [-98.55, 29.51] },                    // San Antonio, 289ms (Situs + Owner)
    { url: _Q('https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0'), mode: 'envelope', county: 'Travis', near: [-97.856317, 30.216512] }, // Austin, 235ms
    // LAYER 4, not 0 — I transcribed this wrong in R77 and layer 0 answers
    // "400 Invalid URL" at every envelope size, so Plano/Frisco silently fell back.
    // Layer 4 resolves at the DEFAULT 0.0002 envelope: 4 parcels, smallest 7,893 sqft.
    { url: _Q('https://services2.arcgis.com/uXyoacYrZTPTKD3R/ArcGIS/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4'), mode: 'envelope', county: 'Collin', near: [-96.73, 33.062] }, // Plano/Frisco, 308ms
    { url: _Q('https://gis.dentoncounty.gov/arcgis/rest/services/Parcels/MapServer/0'), mode: 'envelope', county: 'Denton', near: [-97.15, 33.2148] },             // 118ms — fastest of three Denton options; geo.dentoncad.com took 7.4s
    { url: _Q('https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0'), mode: 'envelope', county: 'Fort Bend', near: [-95.615, 29.599] }, // Sugar Land, 398ms
    { url: _Q('https://services1.arcgis.com/PRoAPGnMSUqvTrzq/arcgis/rest/services/Tax_Parcel_view/FeatureServer/0'), mode: 'envelope', county: 'Montgomery', near: [-95.4600, 30.1580] },  // The Woodlands TX, 260ms
    { url: _Q('https://gis.wilco.org/arcgis/rest/services/public/county_wcad_parcels/MapServer/0'), mode: 'envelope', county: 'Williamson', near: [-97.66, 30.515] },                   // Round Rock, 727ms
    // ---- second wave (R84). Every one queried live at a residential address with
    // the production query shape and re-verified independently: 18/18 returned a
    // polygon inside the 200..660000 sqft gate. Timings are from that run.
    { url: _Q('https://services7.arcgis.com/6qzfxgiNv7oGnzvU/arcgis/rest/services/Rockwall_County_CAD_Parcels/FeatureServer/0'), mode: 'envelope', county: 'Rockwall', near: [-96.4597, 32.931] },   // 268ms
    { url: _Q('https://services.arcgis.com/79g1H99xInKSRRK3/arcgis/rest/services/ParkerCADWebService/FeatureServer/0'), mode: 'envelope', county: 'Parker', near: [-97.7972, 32.7593] },              // Weatherford, 224ms
    { url: _Q('https://services5.arcgis.com/SNQMi91A9RRB0qcO/arcgis/rest/services/JohnsonCADWebService/FeatureServer/0'), mode: 'envelope', county: 'Johnson', near: [-97.3208, 32.5421] },           // Burleson, 161ms
    { url: _Q('https://services9.arcgis.com/26s7bQ5Q51Gt4J2Q/arcgis/rest/services/KaufmanCADWebService/FeatureServer/0'), mode: 'envelope', county: 'Kaufman', near: [-96.4719, 32.7482] },           // Forney, 137ms
    { url: _Q('https://services6.arcgis.com/j94FvPaik4etwHFk/arcgis/rest/services/BrazoriaCADWebService/FeatureServer/0'), mode: 'envelope', county: 'Brazoria', near: [-95.286, 29.5636] },         // Pearland, 232ms
    { url: _Q('https://services2.arcgis.com/uGo7PKALPg93ZiO2/arcgis/rest/services/Galveston_County_Appraisal_District_Parcels_and_Lot_Lines/FeatureServer/2'), mode: 'envelope', county: 'Galveston', near: [-94.7977, 29.3013] }, // 234ms
    { url: _Q('https://services5.arcgis.com/bVphnK8rPe5MHUSr/arcgis/rest/services/Hays_County_Parcels/FeatureServer/0'), mode: 'envelope', county: 'Hays', near: [-97.9414, 29.8833] },               // San Marcos, 244ms
    { url: _Q('https://services7.arcgis.com/Yz6eib2o8WvEgWq8/arcgis/rest/services/ComalCADWebService/FeatureServer/0'), mode: 'envelope', county: 'Comal', near: [-98.1245, 29.703] },               // New Braunfels, 108ms
    { url: _Q('https://services7.arcgis.com/URKkSE6MsjA926qB/arcgis/rest/services/Ellis_County_Parcel_Ownership/FeatureServer/0'), mode: 'envelope', county: 'Ellis', near: [-96.8483, 32.3865] },    // Waxahachie, 151ms
    { url: _Q('https://services7.arcgis.com/EHW2HuuyZNO7DZct/arcgis/rest/services/BellCADWebService/FeatureServer/0'), mode: 'envelope', county: 'Bell', near: [-97.7278, 31.1171] },                 // Killeen, 177ms
    { url: _Q('https://services9.arcgis.com/dwMDP55HTfoj4n1c/arcgis/rest/services/HCAD_PARCELS_2026/FeatureServer/1'), mode: 'envelope', county: 'Hidalgo', near: [-98.23, 26.2034] },              // McAllen, 175ms — NOTE layer /1
    { url: _Q('https://services5.arcgis.com/p65BQlkv8na0Y5l9/arcgis/rest/services/PARCELS/FeatureServer/0'), mode: 'envelope', county: 'Cameron', near: [-97.4975, 25.9017] },                        // Brownsville, 223ms
    // Nueces is the one that needs a wider net — nothing in gate at the 0.0002
    // default, one parcel at 0.0006. Same shape as Harris.
    { url: _Q('https://services6.arcgis.com/j94FvPaik4etwHFk/arcgis/rest/services/NuecesCADWebService/FeatureServer/0'), mode: 'envelope', county: 'Nueces', env: 0.0006, near: [-97.3964, 27.8006] }, // Corpus Christi, 135ms
    { url: _Q('https://gis.elpasotexas.gov/arcgis/rest/services/EPParcels/MapServer/0'), mode: 'envelope', county: 'El Paso', near: [-106.485, 31.7619] },                                            // 138ms
    // Lubbock is LAST of the Texas set: it works but measured 6.9s, an order of
    // magnitude slower than every other county here, so it must not sit in front
    // of a fast one in the try-order.
    { url: _Q('https://gis.lubbockcad.org/arcgis/rest/services/LubbockCADWebService/MapServer/129'), mode: 'envelope', county: 'Lubbock', near: [-101.8552, 33.5779] },                                // 6888ms — NOTE layer /129
    /* STATEWIDE FALLBACK, last. Carries no `near`, so it is always tried once the
       county sources above have missed — which is what gives the other ~229 Texas
       counties any coverage at all. Deliberately last: the county layers are
       fresher and richer, this one is the 2019 StratMap.
       NOTE: no timeout override any more. It carried timeout:35000 to survive the
       resultRecordCount stall fixed in R77; without that parameter it answers in
       ~250ms, and a 35s ceiling would only mask a future outage. */
    { url: _Q('https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services/2019_Texas_Parcels_StratMap/FeatureServer/0'), mode: 'envelope' },
  ],
  // DNR layer = 6 boroughs, one layer EACH; ordered by population so common hits are first.
  AK: [[9, 'Fairbanks North Star'], [3, 'Juneau'], [8, 'North Slope'], [10, 'Sitka'], [1, 'Denali'], [11, 'Skagway']]
    .map(([n, county]) => ({ url: _Q('https://arcgis.dnr.alaska.gov/arcgis/rest/services/OpenData/Administrative_BoroughParcels/FeatureServer/' + n), mode: 'envelope', county })),
};
const AREA_MIN = 200, AREA_MAX = 660000;   // sqft: reject wrong-layer county/ROW giants + dust

/* point-in-ring (ray cast); rings are [[lng,lat],...] */
const ptInRing = (lng, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
};
const ptInRings = (lng, lat, rings) => Array.isArray(rings) && rings.length > 0 && ptInRing(lng, lat, rings[0]);
/* metres from a point to the nearest edge of a ring set (outer ring) */
const ringsEdgeDistanceM = (lng, lat, rings) => {
  const ring = Array.isArray(rings) && rings.length ? rings[0] : null;
  if (!ring || ring.length < 2) return Infinity;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const t = (dx === 0 && dy === 0) ? 0 : Math.max(0, Math.min(1, ((lng - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    best = Math.min(best, Math.hypot((lng - cx) * kx, (lat - cy) * ky));
  }
  return best;
};

/* from ArcGIS features, pick the parcel for (lng,lat): the one CONTAINING the point,
   else the smallest plausible-area ring. Filters out ROW/sliver/giant non-lots. */
const pickParcelFeature = (features, lng, lat, maxArea) => {
  const lim = maxArea || AREA_MAX;
  const cands = [];
  for (const f of (features || [])) {
    if (!f || !f.geometry || !Array.isArray(f.geometry.rings) || !f.geometry.rings.length) continue;
    const area = ringsAreaSqFt(f.geometry.rings);
    const contains = ptInRings(lng, lat, f.geometry.rings);
    /* CONTAINMENT OUTRANKS AREA. The area window exists to reject wrong-layer
       county/ROW giants and slivers — features that merely OVERLAP the query
       envelope. A ring that actually CONTAINS the point is not a wrong-layer
       artifact, it is the parcel, whatever it measures: institutional and
       agricultural lots are legitimately hundreds of acres. Filtering on area
       BEFORE containment threw those away, and the caller then fell back to a
       fabricated rectangle. Measured: the 798-acre parcel at 4202 E Fowler Ave,
       Tampa was dropped by AREA_MAX and replaced with a 60x100 ft box carrying
       an EMPTY apn. A containing OVERSIZE ring is now kept and FLAGGED, so a
       consumer can decline to derive coverage/FAR from it rather than be handed
       a shape nobody surveyed.

       Containment rescues OVERSIZE ONLY, never dust: a sub-AREA_MIN ring that
       contains the point is an easement strip / lot-line artifact sitting ON
       the real lot — keeping it made a 3-ft sliver outrank the actual parcel
       (caught by dev-parcel-registry-test before this shipped). */
    if (area < AREA_MIN) continue;
    if (!contains && area > lim) continue;
    cands.push({ f, area, contains });
  }
  if (!cands.length) return null;
  const containing = cands.filter((c) => c.contains);
  /* NOTHING CONTAINS THE POINT (an interpolated geocode sits in the roadway):
     the NEAREST lot by edge distance wins, never the smallest. Sorting the
     whole window by area handed 4040 Minnesota Ave (Fair Oaks, 2026-09-01)
     the 9k-sqft corner house 16.6 m away over the 22k-sqft lot 1.8 m from
     the pin — the exact "wrong corner house" a user reported. */
  const pool = containing.length ? containing : cands;
  if (containing.length) pool.sort((a, b) => a.area - b.area);
  else {
    for (const c of pool) c.dist = ringsEdgeDistanceM(lng, lat, c.f.geometry.rings);
    pool.sort((a, b) => (a.dist - b.dist) || (a.area - b.area));
  }
  const best = pool[0];
  if (best.contains && best.area > lim) {
    // Non-destructive marker; a consumer that ignores it is no worse off.
    try { best.f.__oversizeSqFt = best.area; } catch (e) { /* frozen feature */ }
  }
  return best.f;
};

/* ONE list of parcel-identifier field names, shared by parcelResolve and buildParcel.
   There used to be two: a 26-entry list in parcelResolve and a 5-entry one in
   buildParcel — and the COUNTY path goes through buildParcel, so every Texas county
   layer resolved with a BLANK apn while the long list sat unused. The sheet's APN
   line and the cover block read empty on a real D.R. Horton lot. Two divergent lists
   for one concept is the bug; this is the fix.
   pick() is case-insensitive, so one spelling per distinct key is enough.
   The trailing block is the county-CAD names observed live on 2026-07-26:
     Tarrant TAXPIN/ACCOUNT · Harris HCAD_NUM/LOWPARCELID · Dallas PARCELID
     Fort Bend QUICKREFID/PROPNUMBER · Montgomery PIN · Collin+Travis PROP_ID
     Williamson QuickRefID/PropertyNumber · Bexar PropID · Denton prop_id
   TAXPIN before ACCOUNT deliberately: TAXPIN identifies the PARCEL, while ACCOUNT
   repeats across the personal-property rows that share one polygon. */
const PARCEL_ID_FIELDS = [
  'PARCEL_APN', 'Search_PARCELAPN', 'APN', 'APN_DASH', 'PARNO', 'PARCELID', 'ParcelID', 'PARCEL_ID', 'AIN',
  'Prop_ID', 'parno', 'SBL', 'PAMS_PIN', 'parcel_id', 'ACCTID', 'PIN', 'tmk', 'GISID', 'pid', 'SPAN',
  'PARCEL_ID_NR', 'UPC', 'PlatLot', 'parcelnb', 'Parcel', 'SERIAL_NUM', 'CleanParcelID', 'Parcel_ID',
  'Pin10', 'PAN', 'KEYPIN', 'MAP_BK_LOT',
  'TAXPIN', 'ACCOUNT', 'HCAD_NUM', 'LOWPARCELID', 'QUICKREFID', 'QuickRefID',
  'PROPNUMBER', 'PropertyNumber', 'PropID', 'propID',
  // Australian parcel identifiers (one per verified layer): VIC's SPI
  // ("1\TP834939"), QLD's lot-on-plan ("3/RP12345"), NSW's cadastre id +
  // lot-id string, SA's parcel identifier ("F183479AL207"), ACT's block key.
  // TAS's PID is caught by the existing case-insensitive 'pid' entry above.
  'parcel_spi', 'lotplan', 'lotidstring', 'cadid', 'parcel_identifier', 'BLOCK_KEY',
];

/* generic spatial-intersect connector for one state config (point↔envelope) */
const queryStateParcel = async (cfg, lng, lat) => {
  const timeout = cfg.timeout || 25000;
  const dd = cfg.env || 0.0002;
  // resultRecordCount is NOT sent by default. It was a size guard, and it silently
  // broke an entire state: the TX statewide StratMap layer REJECTS the parameter —
  // it stalls ~55s and then answers HTTP 200 carrying {"error":{"code":400,
  // "message":"Cannot perform query. Invalid query parameters."}}. TX is configured
  // timeout:35000, so getJsonRetry aborted at 35s and never even saw the 400.
  // Measured on the same bbox, 2026-07-26:
  //     without the param  ->  246ms, 2 features
  //     with the param     ->  55,078ms, error 400
  //     with it @ 35s      ->  AbortError at 35,016ms   <- what production did
  // Net effect: EVERY Texas lookup burned 35s and fell through to the approximate
  // rectangle. The guard is also barely load-bearing — the envelope is 0.0002 deg
  // (~22 m), so a query returns a handful of features anyway, and pickParcelFeature
  // already selects the smallest containing one from whatever arrives.
  // Any source that genuinely wants the cap can opt IN with recordCount: N.
  const cap = Number.isFinite(cfg.recordCount) ? `&resultRecordCount=${cfg.recordCount}` : '';
  const tail = '&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*'
    + '&returnGeometry=true&geometryPrecision=7&f=json' + cap;
  const ptGeom = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  const envGeom = JSON.stringify({ xmin: lng - dd, ymin: lat - dd, xmax: lng + dd, ymax: lat + dd, spatialReference: { wkid: 4326 } });
  const ptURL = cfg.url + '?where=' + encodeURIComponent('1=1') + '&geometry=' + encodeURIComponent(ptGeom) + '&geometryType=esriGeometryPoint' + tail;
  const envURL = cfg.url + '?where=' + encodeURIComponent('1=1') + '&geometry=' + encodeURIComponent(envGeom) + '&geometryType=esriGeometryEnvelope' + tail;
  for (const url of (cfg.mode === 'point' ? [ptURL, envURL] : [envURL, ptURL])) {
    // fetchVia:'dwr' (the CA primary) shares the DWR circuit breaker; when the
    // breaker is open this returns null instantly and the caller's next
    // candidate (the FB fabric row) serves in sub-second time.
    const j = cfg.fetchVia === 'dwr'
      ? await dwrFetch(url, timeout)
      : await getJsonRetry(url, timeout, cfg.headers ? { headers: cfg.headers } : undefined);
    const pick = pickParcelFeature(j && j.features, lng, lat);
    if (pick) return pick;
  }
  return null;
};

/* attribute (situs LIKE) connector for layers that REJECT spatial intersect (FL) or
   can't be Census-geocoded (IN). Parses the leading "<num> <street>" from the address. */
const _situsLike = (formatted) => {
  const m = String(formatted || '').match(/^\s*(\d+[\w-]*)\s+([^,]+?)(?:,|$)/);
  return m ? (m[1] + ' ' + m[2]).trim().toUpperCase().replace(/'/g, '') : null;
};
const queryStateSitus = async (cfg, formatted) => {
  const situs = _situsLike(formatted);
  if (!situs) return null;
  const where = 'UPPER(' + cfg.situsField + ") LIKE '" + situs + "%'";
  const url = cfg.url + '?where=' + encodeURIComponent(where)
    + '&outFields=*&returnGeometry=true&outSR=4326&f=json&resultRecordCount=4';
  for (let attempt = 0; attempt < 3; attempt++) {
    const j = await getJson(url, 30000);
    if (j && Array.isArray(j.features)) {
      for (const f of j.features) {
        if (f && f.geometry && Array.isArray(f.geometry.rings) && f.geometry.rings.length) {
          const area = ringsAreaSqFt(f.geometry.rings);
          if (area >= AREA_MIN && area <= AREA_MAX * 3) return f;   // condos large-but-real
        }
      }
    }
    await sleep(700 * (attempt + 1));   // FL throttling backoff
  }
  return null;
};

/* a registry value is EITHER a single state cfg OR an array of candidate county/
   borough cfgs (per-county states AZ/GA/IL/MI; AK's 6 boroughs). Each candidate
   layer holds only its own jurisdiction's parcels, so the first one that returns a
   polygon is the right county; pickParcelFeature then finds the exact lot by
   containment. Tries in order, first hit wins. */
/* Cheap geographic gate. A county service that does not cover the point returns
   zero features — correct, but it still costs a full round trip, and with 25 Texas
   counties in the list a Corpus Christi lookup was paying for ~20 DFW misses first.
   Measured after the R84 additions: Hidalgo 10.6s, 13 of 21 Texas points over 3s,
   where the pre-R84 worst case was 2.8s. Adding coverage must not make lookups
   slower.

   So each county source may carry `near: [lng, lat]` — one representative point,
   the same coordinate it was verified at. Anything further away than ~1.1 deg of
   latitude (~76 mi) or 1.3 deg of longitude is skipped without a request. Texas
   counties are far smaller than that, so the box is generous: it can only skip a
   source that could not plausibly have contained the point.

   A source with NO `near` is always tried, so this is purely additive — statewide
   layers and every untouched state behave exactly as before. */
const _nearMiss = (c, lng, lat) => {
  if (!Array.isArray(c.near) || c.near.length !== 2) return false;   // no hint -> always try
  return Math.abs(lat - c.near[1]) > 1.1 || Math.abs(lng - c.near[0]) > 1.3;
};

/* Same house number within ~400 m of a point, on registry layers that index
   a situs number field (`numberField`). Returns the feature ONLY when exactly
   one parcel carries that number in the envelope — two hits is ambiguity, not
   an answer. The hit is tagged so the caller can label it honestly. */
const sameNumberNearby = async (cfg, houseNumber, lng, lat, requestedStreetName) => {
  const hn = String(houseNumber || '').replace(/[^0-9]/g, '');
  if (!hn) return null;
  // The lot's OWN street must share the requested street's words ("Minnesota
  // Creek Ln" for "Minnesota Creek") — a 4040 on an unrelated street 180 m
  // away is a coincidence, not a match (4040 BRAXTON LN, the first version of
  // this rule, 2026-09-01).
  const want = _streetTokens(requestedStreetName || '');
  const compatible = (attrs) => {
    if (!want.length) return true;
    const have = _streetTokens(String(pick(attrs, ['STREET_NAME', 'SITE_STREET_NAME']) || requestedStreet(String(pick(attrs, ['SITUS_ADD1', 'SITE_ADDR']) || ''))));
    return want.every((t) => have.includes(t));
  };
  const dd = 0.004;   // ~440 m half-size
  const envGeom = JSON.stringify({ xmin: lng - dd, ymin: lat - dd, xmax: lng + dd, ymax: lat + dd, spatialReference: { wkid: 4326 } });
  for (const c of (Array.isArray(cfg) ? cfg : [cfg])) {
    if (!c.numberField || _nearMiss(c, lng, lat)) continue;
    const where = c.numberField + "='" + hn.replace(/'/g, "''") + "'";
    const url = c.url + '?where=' + encodeURIComponent(where) + '&geometry=' + encodeURIComponent(envGeom)
      + '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects'
      + '&outFields=*&returnGeometry=true&geometryPrecision=7&f=json';
    let feats = [];
    try { const j = await getJsonRetry(url, c.timeout || 25000, c.headers ? { headers: c.headers } : undefined); feats = (j && j.features) || []; } catch (e) { feats = []; }
    const real = feats.filter((f) => f && f.geometry && Array.isArray(f.geometry.rings) && f.geometry.rings.length && compatible(f.attributes || {}));
    if (real.length === 1) {
      const f = real[0];
      if (c.county) f.__county = c.county;
      f.__numberMatch = String(pick(f.attributes, ['SITUS_ADD1', 'SITE_ADDR', 'FullStreetAddress']) || hn);
      return f;
    }
    if (real.length > 1) return null;   // ambiguous — never guess between them
  }
  return null;
};
/* the situs house number a fabric feature carries, '' when it has none */
const situsNumberOf = (attrs) => {
  const direct = String(pick(attrs, ['STREET_NBR', 'SITE_HOUSE_NUMBER', 'STREET_NO']) || '').trim();
  if (direct) return direct.replace(/[^0-9]/g, '');
  return houseNumberOf(String(pick(attrs, ['SITUS_ADD1', 'SITE_ADDR', 'FullStreetAddress']) || ''));
};

const _queryRegistry = async (cfg, lng, lat, formatted) => {
  for (const c of (Array.isArray(cfg) ? cfg : [cfg])) {
    if (c.mode !== 'situs' && _nearMiss(c, lng, lat)) continue;
    let feat = null;
    try {
      feat = c.mode === 'situs'
        ? await queryStateSitus(c, formatted)
        : await queryStateParcel(c, lng, lat);
    } catch (e) { feat = null; }
    if (feat && feat.geometry && Array.isArray(feat.geometry.rings) && feat.geometry.rings.length) {
      if (c.county) feat.__county = c.county;   // authoritative jurisdiction label (per-county cfgs)
      if (c.url === CA_PARCELS_FB) feat.__fb = true;   // FB-fabric provenance (~4-7 ft off DWR)
      return feat;
    }
  }
  return null;
};

/* ArcGIS returns geometry.rings as [[ [x,y],... ]] in the requested SR
   (4326 -> [lng,lat]); pass them through as-is (already [lng,lat]). */
const parcelResolve = async (address) => {
  // an Australian lot/plan reference needs no geocoder - the cadastre has it
  const lp = auLotPlanOf(address);
  if (lp) {
    const r = await resolveAuLotPlan(lp);
    if (r) return r;
  }
  const geo = await geocode(address);
  if (!geo) return null;

  let rings = null;
  let attrs = null;
  let source = 'approximate';
  let countyLabel = '';   // authoritative jurisdiction label from a per-county cfg, if any

  // STATE PARCEL REGISTRY: the geocoded address → the state's validated ArcGIS parcel
  // layer → the parcel polygon that CONTAINS the point. ~37 US states + 7 AU
  // states wired (gis-coverage.md); no live layer falls through to the rectangle.
  //
  // EVERY geocode candidate is tried in turn, not just the best one. The Census
  // geocoder interpolates a point on the street CENTRELINE from an address
  // range — a location where the parcel fabric often has no polygon at all —
  // while Esri resolves the same address to a rooftop (measured at 4202 E
  // Fowler Ave, Tampa: Census ~1.5 km off in the right-of-way, 0 features;
  // Esri PointAddress, the parcel in 239 ms). An interpolated first guess now
  // costs one extra query instead of the whole lookup. `hit` is whichever
  // candidate produced the polygon, so the returned coordinates match it.
  let hit = geo;
  let note = '';
  const cands = Array.isArray(geo.candidates) && geo.candidates.length ? geo.candidates : [geo];
  // STREET SUBSTITUTED by every geocoder (see streetMatches): the point is on
  // the wrong street, so a containing/nearest parcel would be a confident
  // wrong answer. Look for the same house number nearby instead.
  const substituted = cands.every((c) => c.streetMatch === false);
  if (substituted) {
    const asked = requestedStreet(address);
    const swapped = cands.map((c) => c.matchedStreet).filter(Boolean)[0] || '';
    const cfg = STATE_REGISTRY[registryKey(geo.state, geo.country)];
    const alt = cfg ? await sameNumberNearby(cfg, houseNumberOf(address), geo.longitude, geo.latitude, asked) : null;
    if (alt) {
      rings = alt.geometry.rings;
      attrs = alt.attributes || {};
      source = 'arcgis-' + String(geo.state).toLowerCase() + '-number-match';
      countyLabel = alt.__county || '';
      note = 'street "' + asked + '" is not in county records (geocoders substituted "' + swapped + '"); '
        + 'matched the only lot numbered ' + houseNumberOf(address) + ' on a "' + asked + '" street within 400 m: ' + alt.__numberMatch + ' - verify';
    } else {
      // No honest number match: show the NEAREST lot to the substituted point,
      // clearly marked, so the user has something to confirm or move off of.
      const feat = cfg ? await _queryRegistry(cfg, geo.longitude, geo.latitude, geo.formattedAddress) : null;
      if (feat) {
        rings = feat.geometry.rings;
        attrs = feat.attributes || {};
        source = 'arcgis-' + String(geo.state).toLowerCase() + (feat.__fb ? '-fb' : '') + '-nearest-verify';
        countyLabel = feat.__county || '';
        note = 'street "' + asked + '" is not in county records (geocoders substituted "' + swapped + '"); '
          + 'showing the lot nearest that point (' + String(pick(attrs, ['SITUS_ADD1', 'SITE_ADDR']) || pick(attrs, PARCEL_ID_FIELDS) || '') + ') - VERIFY or pick the lot on the map';
      } else {
        note = 'street "' + asked + '" is not known to any geocoder (nearest known street: "' + swapped + '"); '
          + 'no parcel resolved - pick the lot on the map or enter the APN';
      }
    }
  } else {
    for (const cand of cands) {
      const cfg = STATE_REGISTRY[registryKey(cand.state, cand.country)];
      if (!cfg) continue;
      const feat = await _queryRegistry(cfg, cand.longitude, cand.latitude, cand.formattedAddress);
      if (feat) {
        rings = feat.geometry.rings;
        attrs = feat.attributes || {};
        source = 'arcgis-' + String(cand.state).toLowerCase() + (feat.__fb ? '-fb' : '');
        countyLabel = feat.__county || '';
        hit = cand;
        break;
      }
    }
  }
  let { latitude: lat, longitude: lng } = hit;
  if (rings && substituted) {
    // the returned coordinates must belong to the lot we return, not to the
    // street the geocoder invented
    const b = ringsBounds(rings);
    if (b) { lat = (b.n + b.s) / 2; lng = (b.e + b.w) / 2; }
  }

  // fall back to an approximate rectangle around the geocoded point
  if (!rings) {
    rings = rectangleRings(lat, lng);
    attrs = attrs || {};
    source = 'approximate';
  }

  const lotAreaSqFt = Math.round(ringsAreaSqFt(rings));
  const lotPerimeterFt = Math.round(ringPerimeterFt(rings[0]) * 10) / 10;
  const dims = lotDimsFromAreaPerim(lotAreaSqFt, lotPerimeterFt);
  const bounds = ringsBounds(rings);

  const parcelOut = {
    // candidate lists span the validated per-state schemas (gis-coverage.md); pick() is
    // case-insensitive, so one representative spelling per distinct key is enough.
    apn: String(pick(attrs, PARCEL_ID_FIELDS) || ''),
    lotAreaSqFt,
    lotWidthFt: dims.lotWidthFt,
    lotDepthFt: dims.lotDepthFt,
    lotPerimeterFt,
    county: String(countyLabel || pick(attrs, ['COUNTYNAME', 'COUNTY', 'CountyName', 'COUNTY_NAME',
      'CONAME', 'cntyname', 'JURSCODE', 'tax_county', 'TOWN', 'TownCode', 'jurisdicti', 'LOCALITY', 'co_name',
      'CountyID', 'COUNTY_NM', 'countyid', 'countyName']) || hit.county || ''),
    zoning: String(pick(attrs, ['ZONING', 'ZONE', 'ZONE_CODE', 'UseCode', 'USECODE', 'Zone', 'PROP_CLASS',
      'LANDUSE_CD', 'PROPCLASS', 'zoningCode', 'CAT', 'PropType', 'parusedesc', 'DESCLU']) || ''),
    ownerName: String(pick(attrs, ['OWNER', 'OwnerName', 'OWNER_NAME', 'OWN_NAME', 'OWNERNME1', 'ownname',
      'PRIMARY_OWNER', 'OWNER1', 'FullOwnerName', 'ownername', 'ownername1', 'Ownership', 'Owner']) || ''),
    state: hit.state || '',
    zip: hit.zip || '',
    // 'US' | 'AU' — consumers gate country-specific behaviour (energy-code
    // selection, address formatting) on this rather than sniffing the state code.
    country: hit.country || 'US',
    source,
    // set when the street was substituted by the geocoders — says what was
    // matched instead, or why nothing was
    note: note || undefined,
    attributes: attrs,
  };

  return {
    parcel: parcelOut,
    geometry: { rings, bounds },
    coordinates: { latitude: lat, longitude: lng },
    source,
  };
};

/* in-memory parcel cache (instance-local; min-instances=1 keeps it warm, so
   the slow CA statewide source — ~35-40s cold — is hit only ONCE per address;
   every repeat is instant). Real (non-approximate) hits are cached; approximate
   fallbacks are NOT cached, so a later retry can still upgrade to the real
   polygon. Capped to avoid unbounded growth. */
const _pCache = new Map();
const _normAddr = (a) => String(a || '').toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
const parcel = async (address) => {
  const key = _normAddr(address);
  if (key && _pCache.has(key)) return _pCache.get(key);
  const r = await parcelResolve(address);
  // '-fb' results are NOT cached (same reasoning as 'approximate'): the FB
  // fabric sits ~4-7 ft off the DWR ring, so a later retry can still upgrade.
  if (r && r.source !== 'approximate' && !/-fb$/.test(r.source) && key) {
    if (_pCache.size > 1000) _pCache.clear();
    _pCache.set(key, r);
  }
  return r;
};

/* ======================= address autocomplete (keyless) =============== */
/* Photon (Komoot) — OSM-based type-ahead geocoder, no API key, and it returns
   coordinates INLINE so a picked suggestion resolves the parcel with no second
   round-trip. This is the "few guesses as you type" intake Steve asked for.
   US-ONLY as of Jul 11 (bbox at the provider + a strict countrycode filter —
   see US_BBOX below); a Google Places proxy can swap in via PLACES_PROVIDER. */
const PHOTON = 'https://photon.komoot.io/api/';
const PHOTON_REV = 'https://photon.komoot.io/reverse';

/* US-ONLY restriction (Steve, Jul 11: no international addresses for now).
   US_BBOX = minLon,minLat,maxLon,maxLat covering CONUS + Alaska + Hawaii +
   Puerto Rico — passed to Photon (which has no country parameter) so foreign
   results are cut at the PROVIDER; usOnlySuggestions() then drops anything the
   box still admits (northern Mexico / southern Canada) by countrycode. Pure +
   exported so the filter is testable without the network. */
const US_BBOX = '-171,17.5,-65,71.5';
const usOnlySuggestions = (list) =>
  (Array.isArray(list) ? list : []).filter((s) => s && (s.countrycode || '').toUpperCase() === 'US');

/* AUSTRALIA (2026-09-01): AU is now a wired coverage area, so the type-ahead
   must be able to SUGGEST an Australian address — but the Jul-11 rule ("no
   international noise while typing a US address") must survive. So: the US box
   stays the default, and only a query that is RECOGNISABLY Australian routes to
   the AU box — it names Australia, uses an unambiguous AU state/territory
   abbreviation, or pairs the ambiguous WA/SA with a 4-digit postcode (US ZIPs
   are 5 digits, so "Perth WA 6000" is AU and "Seattle WA 98101" is not).
   Nothing outside US+AU is ever suggested. */
const AU_BBOX = '112.5,-44.5,154.1,-9.0';
const auQuery = (q) => {
  const s = String(q || '');
  return /\baustralia\b/i.test(s)
    || /\b(NSW|VIC|QLD|TAS|ACT)\b/i.test(s)
    || /\b(WA|SA|NT)\s*,?\s*\d{4}\b/i.test(s);
};
const auOnlySuggestions = (list) =>
  (Array.isArray(list) ? list : []).filter((s) => s && (s.countrycode || '').toUpperCase() === 'AU');

const US_STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const AU_STATE_ABBR = {
  'new south wales': 'NSW', victoria: 'VIC', queensland: 'QLD',
  'south australia': 'SA', 'western australia': 'WA', tasmania: 'TAS',
  'northern territory': 'NT', 'australian capital territory': 'ACT',
};
const stateAbbr = (name, cc) => {
  const n = String(name || '').trim();
  if (/^[A-Za-z]{2,3}$/.test(n)) return n.toUpperCase();      // already an abbr (US 2, AU 2-3)
  const country = (cc || 'US').toUpperCase();
  if (country === 'AU') return AU_STATE_ABBR[n.toLowerCase()] || '';
  if (country !== 'US') return '';                             // only US + AU states map
  return US_STATE_ABBR[n.toLowerCase()] || '';
};

/* one Photon GeoJSON feature -> a flat suggestion the client can show + apply. */
const photonToSuggestion = (f) => {
  const p = (f && f.properties) || {};
  const c = (f && f.geometry && f.geometry.coordinates) || [];
  const lng = Number(c[0]), lat = Number(c[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cc = (p.countrycode || '').toUpperCase();
  const st = stateAbbr(p.state, cc);
  const line1 = [p.housenumber, p.street || (p.osm_key === 'place' ? '' : p.name)].filter(Boolean).join(' ').trim();
  const city = p.city || p.town || p.village || p.municipality || p.county || '';
  const line2 = [city, st || p.state, p.postcode].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const label = [line1 || p.name, city, st || p.state, p.country].filter(Boolean).join(', ');
  return {
    label, line1: line1 || p.name || '', line2,
    city, state: st, postcode: p.postcode || '',
    country: p.country || '', countrycode: cc,
    lat, lng,
  };
};

const _acCache = new Map(); // tiny query cache (type-ahead fires a lot)
/* OPTIONAL upgrade: Google Places Autocomplete — sharper US house-number
   predictions than OSM. OFF unless PLACES_PROVIDER=google AND a Places-capable
   MAPS_API_KEY is set; ANY miss falls back to keyless Photon, so the app never
   hard-depends on the paid API. (No coords in a prediction — that's fine, the
   pick resolves via the site-address / Census paths, not the suggestion point.) */
const googlePredToSuggestion = (p) => {
  if (!p) return null;
  const sf = p.structured_formatting || {};
  const desc = String(p.description || '').trim();
  const line1 = (sf.main_text || desc.split(',')[0] || '').trim();
  const line2 = String(sf.secondary_text || desc.split(',').slice(1).join(',')).trim();
  const terms = (p.terms || []).map((t) => String(t.value || ''));
  let city = '', st = '', country = '';
  if (terms.length >= 1) country = terms[terms.length - 1];
  if (terms.length >= 2) st = terms[terms.length - 2];
  if (terms.length >= 3) city = terms[terms.length - 3];
  const cc = /^(usa|united states)$/i.test(country) ? 'US' : '';
  return {
    label: desc || [line1, line2].filter(Boolean).join(', '),
    line1, line2, city, state: stateAbbr(st, cc), postcode: '',
    country, countrycode: cc, lat: null, lng: null, placeId: p.place_id || '',
  };
};

let _googleAcOff = false;   // latch: once Places is denied/not-enabled, stop trying it
const autocompleteGoogle = async (q, opts) => {
  const key = process.env.MAPS_API_KEY;
  if (!key || _googleAcOff) return null;
  const limit = Math.max(1, Math.min(8, (opts && opts.limit) || 6));
  // US-restricted (Steve: intake kept surfacing OTHER COUNTRIES first) — this is
  // a US product, so hard-restrict Google predictions to country:us.
  let url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json'
    + '?input=' + encodeURIComponent(q) + '&types=address&components=country:us&key=' + key;
  if (opts && Number.isFinite(Number(opts.lat)) && Number.isFinite(Number(opts.lng)))
    url += '&location=' + Number(opts.lat) + ',' + Number(opts.lng) + '&radius=30000';
  let j = null;
  try { j = await getJson(url, 8000); } catch (e) { return null; }
  if (!j) return null;
  if (j.status && j.status !== 'OK' && j.status !== 'ZERO_RESULTS') {
    if (/DENIED|INVALID|NOT_ACTIVATED|API_KEY|AUTHORIZ/i.test((j.status || '') + ' ' + (j.error_message || ''))) _googleAcOff = true;
    return null;
  }
  const out = [];
  for (const p of (j.predictions || [])) {
    const s = googlePredToSuggestion(p);
    if (s) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
};

/* ---- TYPED-STATE CONSISTENCY (2026-09-02, 11343 Arno Rd, Galt CA) ----
   The type-ahead's fallbacks matched house number + street name anywhere in
   the country: a rural Galt address OSM/Census don't carry came back as
   "11343 Arno Road, Kansas City MO" and the studio built a Missouri lot. A
   suggestion must agree with the state the user typed; when they typed one,
   rows in any other state are dropped, whatever service produced them. */
const _US_ABBRS = new Set(Object.values(_STATE_ABBR));
const _AU_ABBRS = new Set(Object.values(_AU_STATE_ABBR));
const typedStateOf = (q) => {
  // Only the TAIL of the address names a state: "4040 Minnesota Creek, Fair
  // Oaks" contains a state's name in the STREET and must not read as MN.
  const up = String(q || '').toUpperCase().replace(/\b(AUSTRALIA|USA|UNITED STATES)\b/g, ' ').replace(/[.]/g, ' ');
  const auish = auQuery(q);
  const tail = up.replace(/[,\s]*\b\d{4,5}(?:-\d{4})?\s*$/, '').trim();   // drop a trailing ZIP / postcode
  const segs = tail.split(',').map((t) => t.trim()).filter(Boolean);
  const last = segs[segs.length - 1] || '';
  // full names at the END of the last segment ("…, California" / "Richmond New South Wales")
  for (const [name, ab] of Object.entries(_AU_STATE_ABBR)) if (last.endsWith(name.toUpperCase())) return { state: ab, country: 'AU' };
  for (const [name, ab] of Object.entries(_STATE_ABBR)) if (last.endsWith(name.toUpperCase())) return { state: ab, country: 'US' };
  const lastWord = (last.split(/\s+/).pop() || '');
  if (!lastWord) return null;
  const ambiguous = (lastWord === 'WA' || lastWord === 'SA' || lastWord === 'NT');
  if (_AU_ABBRS.has(lastWord) && (!ambiguous || auish)) return { state: lastWord, country: 'AU' };
  if (_US_ABBRS.has(lastWord)) return { state: lastWord, country: 'US' };
  return null;
};
const keepTypedState = (list, q) => {
  const want = typedStateOf(q);
  if (!want) return list;
  return (Array.isArray(list) ? list : []).filter((s) => {
    const st = String(s && s.state || '').toUpperCase();
    return !st || st === want.state;                      // a row with no state can't be proven wrong
  });
};

/* ---- AUSTRALIAN LOT / PLAN REFERENCES (2026-09-02, "Lot 2210, DP 1296588
   No 11, Myrtle Grove, North Richmond NSW") ----
   A new-subdivision lot has a plan reference long before any geocoder has its
   street number, but the state cadastre indexes it: NSW Lot layer
   `lotidstring` ('2210//DP1296588'), QLD `lotplan` ('5RP12345'). Parse the
   reference and resolve it directly - the AU equivalent of an APN. */
const auLotPlanOf = (q) => {
  const up = String(q || '').toUpperCase();
  const m = up.match(/\bLOT\s*(\d+[A-Z]?)\b[\s,.]*(?:(?:ON|IN|OF)\s+)?[\s,.]*\b(DP|SP|RP|CP|BUP|GTP|SL|USL|CPW|MPH|RL|MCP|PS|TP|LP|CS)\s*(\d{2,8})\b/);
  if (!m) return null;
  const rest = String(q || '').slice(m.index + m[0].length).replace(/^[\s,.-]+/, '').trim();
  const typed = typedStateOf(q);
  const lot = m[1], type = m[2], no = m[3];
  const states = [];
  if (typed && typed.country === 'AU') states.push(typed.state);
  if (type === 'DP') states.push('NSW');
  else if (type === 'SP') states.push('NSW', 'QLD');
  else if (/^(PS|TP|LP|CP)$/.test(type)) states.push('VIC', 'QLD');
  else states.push('QLD');
  return { lot, type, no, states: [...new Set(states)], label: 'Lot ' + lot + ' ' + type + no, rest };
};
const resolveAuLotPlan = async (lp) => {
  const esc = (v) => String(v).replace(/'/g, "''");
  for (const st of lp.states) {
    const cfg = STATE_REGISTRY['AU-' + st];   // attribute lookup (lot/plan): nothing spatial to gate
    if (!cfg || Array.isArray(cfg)) continue;
    let where = null;
    if (st === 'NSW') where = "lotidstring='" + esc(lp.lot + '//' + lp.type + lp.no) + "'";
    else if (st === 'QLD') where = "lotplan='" + esc(lp.lot + lp.type + lp.no) + "'";
    else if (st === 'VIC') where = "parcel_spi='" + esc(lp.lot + '\\' + lp.type + lp.no) + "'";
    if (!where) continue;
    let feat = null;
    try {
      const j = await getJsonRetry(cfg.url + '?where=' + encodeURIComponent(where) + '&outSR=4326&outFields=*&returnGeometry=true&geometryPrecision=7&f=json&resultRecordCount=2', cfg.timeout || 25000, cfg.headers ? { headers: cfg.headers } : undefined);
      const feats = ((j && j.features) || []).filter((f) => f && f.geometry && Array.isArray(f.geometry.rings) && f.geometry.rings.length);
      if (feats.length === 1) feat = feats[0];
    } catch (e) { feat = null; }
    if (!feat) continue;
    const b = ringsBounds(feat.geometry.rings);
    const ctr = b ? { latitude: (b.n + b.s) / 2, longitude: (b.e + b.w) / 2 } : null;
    const out = buildParcel(feat.geometry.rings, feat.attributes || {}, ctr && ctr.latitude, ctr && ctr.longitude,
      { apn: String(pick(feat.attributes, PARCEL_ID_FIELDS) || lp.label), state: st, country: 'AU', source: 'arcgis-' + st.toLowerCase() + '-lotplan' });
    out.parcel.state = st;
    out.parcel.country = 'AU';
    return out;
  }
  return null;
};

/* Esri World as a SUGGESTION source of last resort (US + AU). Only real
   address-level matches are offered (PointAddress / Subaddress /
   StreetAddress); postal and locality centroids are not addresses. */
const esriSuggest = async (q, limit) => {
  const url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
    + '?SingleLine=' + encodeURIComponent(q)
    + '&outFields=Match_addr,Addr_type,StAddr,City,Region,RegionAbbr,Postal,Country'
    + '&sourceCountry=USA,AUS&maxLocations=' + Math.max(1, Math.min(6, limit || 5)) + '&f=json';
  let j = null;
  try { j = await getJson(url, 8000); } catch (e) { return []; }
  const out = [];
  for (const c of ((j && j.candidates) || [])) {
    const at = c.attributes || {};
    if (!/^(PointAddress|Subaddress|StreetAddress|StreetAddressExt)$/i.test(String(at.Addr_type || ''))) continue;
    const country = String(at.Country || '').toUpperCase() === 'AUS' ? 'AU' : 'US';
    const st = at.RegionAbbr || (country === 'AU' ? _auStateAbbr(at.Region) : _stateAbbr(at.Region)) || '';
    const line1 = String(at.StAddr || String(c.address || '').split(',')[0] || '').trim();
    const city = String(at.City || '').trim();
    const line2 = [city, st, at.Postal].filter(Boolean).join(' ');
    out.push({
      label: [line1, city, st, country === 'AU' ? 'Australia' : 'United States'].filter(Boolean).join(', '),
      line1, line2, city, state: st, postcode: String(at.Postal || ''),
      country: country === 'AU' ? 'Australia' : 'United States', countrycode: country,
      lat: Number(c.location && c.location.y), lng: Number(c.location && c.location.x),
    });
  }
  return out;
};

const autocomplete = async (q, opts) => {
  const query = String(q || '').trim();
  if (query.length < 3) return [];
  const limit = Math.max(1, Math.min(8, (opts && opts.limit) || 6));
  const useGoogle = process.env.PLACES_PROVIDER === 'google';
  const ck = (useGoogle ? 'g|' : 'p|') + query.toLowerCase() + '|' + limit;
  if (_acCache.has(ck)) return _acCache.get(ck);
  let out = null;
  if (useGoogle) {
    const g = await autocompleteGoogle(query, opts);
    if (g && g.length) out = g;
  }
  if (!out) {                                  // keyless Photon (default + fallback)
    // STRICTLY US (Steve, Jul 11: "remove the international addresses for now —
    // while typing it suggests other countries and the semantics suck"). The old
    // "US-first" (keep US when ANY exist, else worldwide) still leaked foreign
    // results whenever a query had no US match. Now: (a) hard-limit the PROVIDER
    // with a bbox covering all 50 states + PR (Photon has no country param; the
    // box is the strongest restriction it supports), (b) bias proximity to the
    // CONUS centroid when the caller gave no explicit lat/lng, (c) over-fetch 3x,
    // then (d) keep ONLY countrycode=US — belt-and-suspenders, since the bbox
    // clips Canada/Mexico imperfectly. No US match → EMPTY list (the client says
    // so honestly instead of showing London). lang=en for US-style labels.
    // an Australian lot/plan reference resolves from the cadastre itself
  const lp = auLotPlanOf(query);
  if (lp) {
    const r = await resolveAuLotPlan(lp);
    if (r && r.coordinates) {
      const tail = lp.rest;
      const row = {
        label: lp.label + (tail ? ' · ' + tail : ''), line1: lp.label, line2: tail,
        city: '', state: r.parcel.state, postcode: String(pick(r.parcel.attributes, ['postcode', 'POSTCODE']) || (tail.match(/\b(\d{4})\b/) || [])[1] || ''),
        country: 'Australia', countrycode: 'AU', lat: r.coordinates.latitude, lng: r.coordinates.longitude,
        lotplan: { lot: lp.lot, type: lp.type, no: lp.no, state: r.parcel.state, apn: r.parcel.apn },
      };
      if (_acCache.size > 500) _acCache.clear();
      _acCache.set(ck, [row]);
      return [row];
    }
  }
  const au = auQuery(query);                 // recognisably Australian -> AU box
    const hasBias = opts && Number.isFinite(Number(opts.lat)) && Number.isFinite(Number(opts.lng));
    const bLat = hasBias ? Number(opts.lat) : (au ? -25.5 : 39.5);   // centre of AU / CONUS
    const bLng = hasBias ? Number(opts.lng) : (au ? 134.0 : -98.35);
    const url = PHOTON + '?q=' + encodeURIComponent(query) + '&limit=' + (limit * 3)
      + '&lang=en&lat=' + bLat + '&lon=' + bLng
      + '&bbox=' + (au ? AU_BBOX : US_BBOX);   // minLon,minLat,maxLon,maxLat
    let j = null;
    try { j = await getJson(url, 8000); } catch (e) { return []; }
    const seen = new Set(); const all = [];
    for (const f of (j && j.features) || []) {
      const s = photonToSuggestion(f);
      if (!s) continue;
      const k = s.label.toLowerCase();
      if (seen.has(k)) continue; seen.add(k);
      all.push(s);
    }
    out = keepTypedState(au ? auOnlySuggestions(all) : usOnlySuggestions(all), query).slice(0, limit);
  }
  // LAST-RESORT: the US CENSUS geocoder — authoritative for rural addresses
  // Photon/OSM has never heard of (Steve, Jul 23: "4255 Project Rd,
  // Luebbering, MO doesn't show up" — Photon: nothing; Census: exact hit).
  // Only fires on a full-looking address (has a house number) with zero
  // suggestions so far, so type-ahead latency is untouched.
  if ((!out || !out.length) && !auQuery(query) && /^\d+\s+\S/.test(query)) {
    try {
      const cj = await getJson('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
        + '?address=' + encodeURIComponent(query) + '&benchmark=Public_AR_Current&format=json', 8000);
      const cens = [];
      for (const m of ((cj && cj.result && cj.result.addressMatches) || []).slice(0, limit)) {
        const co = m.coordinates || {}, ac = m.addressComponents || {};
        const lat = Number(co.y), lng = Number(co.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const tc = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
        const line1 = tc(String(m.matchedAddress || '').split(',')[0]);
        const city = tc(ac.city), st = String(ac.state || '').toUpperCase(), zip = String(ac.zip || '');
        cens.push({
          label: [line1, city, st + (zip ? ' ' + zip : '')].filter(Boolean).join(', '),
          line1, line2: [city, st, zip].filter(Boolean).join(' '),
          city, state: st, postcode: zip,
          country: 'United States', countrycode: 'US',
          lat, lng,
        });
      }
      const kept = keepTypedState(cens, query);   // never a same-street match in another state
      if (kept.length) out = kept;
    } catch (e) { /* keyless fallback — never throws the type-ahead */ }
  }
  // ESRI LAST RESORT (US + AU): rural and new-subdivision addresses that
  // Photon and the Census both miss (11343 Arno Rd, Galt - a rooftop match)
  if ((!out || !out.length) && /\d/.test(query)) {
    try {
      const es = keepTypedState(await esriSuggest(query, limit), query);
      if (es.length) out = es.slice(0, limit);
    } catch (e) { /* keyless fallback - never throws the type-ahead */ }
  }
  if (_acCache.size > 500) _acCache.clear();
  _acCache.set(ck, out || []);
  return out || [];
};

const reverseGeocode = async (lat, lng) => {
  lat = Number(lat); lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const j = await getJson(PHOTON_REV + '?lat=' + lat + '&lon=' + lng + '&limit=1', 8000);
    const f = j && j.features && j.features[0];
    return f ? photonToSuggestion(f) : null;
  } catch (e) { return null; }
};

/* ======================= parcel by lat/lng + by APN ================== */

/* The CA statewide layer carries the parcel's SITE address — use it directly
   (authoritative) instead of a reverse-geocode, and to confirm a point query
   landed on the intended parcel. Returns {line1,line2,...} or null. */
const siteAddressFromAttrs = (attrs, fallbackState) => {
  if (!attrs) return null;
  const full = String(pick(attrs, ['FullStreetAddress', 'SITE_ADDR', 'SITUS_ADD1']) || '').trim();
  const hn = String(pick(attrs, ['SITE_HOUSE_NUMBER']) || '').trim();
  const dir = String(pick(attrs, ['SITE_DIRECTION']) || '').trim();
  const st = String(pick(attrs, ['SITE_STREET_NAME']) || '').trim();
  // FullStreetAddress bakes in the city/state/zip ("2544 BEATRICE LN, MODESTO, CA
  // 95355") — keep only the street line so line2 doesn't duplicate it.
  const line1 = full ? full.split(',')[0].trim() : [hn, dir, st].filter(Boolean).join(' ').trim();
  const city = String(pick(attrs, ['SITE_CITY']) || String(pick(attrs, ['SITUS_ADD2']) || '').split(',')[0] || '').trim();
  /* NEVER INVENT THE STATE. This defaulted to 'CA' because the helper was written
     for the California statewide layer (hence the Modesto example above), but it
     runs on every state's parcels. Harris County publishes SITE_CITY and SITE_ZIP
     and no SITE_STATE, so a Houston parcel came back "HOUSTON CA 77096" —
     a Texas lot labelled California, on its way onto a plan set.

     Worse, it made the caller's correct value unreachable: buildParcel resolves
     `(addr && addr.state) || opts.state`, and an always-truthy invented 'CA' meant
     opts.state was never consulted. Every caller passes a real state ('MO', 'CA',
     or the resolver's own opts.state — the TX path even builds source
     'arcgis-tx' from it), so take it from them and fall back to EMPTY, which
     line2 simply omits. An absent state is honest; a wrong one is not. */
  const state = String(pick(attrs, ['SITE_STATE']) || fallbackState || '').trim().toUpperCase();
  const zip = String(pick(attrs, ['SITE_ZIP', 'SITUS_ZIP']) || '').trim();
  if (!line1 && !city) return null;
  const line2 = [city, state, zip].filter(Boolean).join(' ').trim();
  return { line1, line2, city, state, zip, formatted: [line1, line2].filter(Boolean).join(', ') };
};

/* shared: assemble the parcel response from ArcGIS rings + attrs. */
const buildParcel = (rings, attrs, lat, lng, opts) => {
  opts = opts || {}; attrs = attrs || {};
  const lotAreaSqFt = Math.round(ringsAreaSqFt(rings));
  const lotPerimeterFt = Math.round(ringPerimeterFt(rings[0]) * 10) / 10;
  const dims = lotDimsFromAreaPerim(lotAreaSqFt, lotPerimeterFt);
  const bounds = ringsBounds(rings);
  const addr = siteAddressFromAttrs(attrs, opts.state);
  return {
    parcel: {
      apn: String(opts.apn || pick(attrs, PARCEL_ID_FIELDS) || ''),
      lotAreaSqFt, lotWidthFt: dims.lotWidthFt, lotDepthFt: dims.lotDepthFt, lotPerimeterFt,
      county: String(pick(attrs, ['COUNTYNAME', 'COUNTY', 'County', 'CountyName', 'COUNTY_NAME']) || opts.county || ''),
      zoning: String(pick(attrs, ['ZONING', 'Zoning', 'ZONE', 'ZONE_CODE', 'UseCode', 'USECODE']) || ''),
      ownerName: String(pick(attrs, ['OWNER', 'OwnerName', 'OWNER_NAME', 'OWN_NAME', 'Owner']) || ''),
      // no 'CA' tail: with the address helper no longer inventing one, opts.state
      // is finally reachable, and an unknown state stays empty rather than wrong
      state: (addr && addr.state) || opts.state || '', zip: (addr && addr.zip) || opts.zip || '',
      country: opts.country || 'US',
      source: opts.source || 'ca-statewide-arcgis', attributes: attrs,
    },
    address: addr,                 // authoritative site address from the parcel record
    geometry: { rings, bounds },
    coordinates: { latitude: lat, longitude: lng },
    source: opts.source || 'ca-statewide-arcgis',
  };
};

const CA_QTAIL = '&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects'
  + '&outFields=*&returnGeometry=true&geometryPrecision=7&f=json&resultRecordCount=1';

/* resolve a parcel directly at lat/lng (skips geocoding — used when a picked
   address suggestion already carries coordinates, so it's faster + exact). */
const _atCache = new Map();   // coord-path result cache (real hits only)
const parcelAt = async (lat, lng, opts) => {
  lat = Number(lat); lng = Number(lng); opts = opts || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Stateless click (Developer-Mode map pick): infer the state via reverse
  // geocode so the right registry layer is selected instead of falling straight
  // to the synthetic rectangle. Fail-soft — a miss just keeps opts.state empty.
  // The COORDINATES say which country this is — the caller often doesn't (a
  // Developer-Mode map pick sends no state, and a picked AU suggestion sends
  // state 'WA' that must NOT route into Washington's fabric).
  const country = String(opts.country || '').toUpperCase() || (inAustralia(lat, lng) ? 'AU' : 'US');
  if (!opts.state) {
    try {
      const sug = await reverseGeocode(lat, lng);
      const st = stateAbbr((sug && sug.state) || '', (sug && sug.countrycode) || country);
      if (st) { opts = { ...opts, state: st, zip: opts.zip || (sug && sug.postcode) || '' }; }
    } catch (e) { /* keep going without a state */ }
  }
  const ck = country + '|' + (opts.state || '') + '|' + lat.toFixed(5) + '|' + lng.toFixed(5) + '|' + (opts.formatted ? 'f' : '');
  if (_atCache.has(ck)) return _atCache.get(ck);
  // coordinate path (a picked address suggestion): use the state's registered layer via
  // the generic spatial-intersect connector (point↔envelope + point-in-polygon pick).
  // situs-only layers (FL/IN) need an address, not coords, so they fall to the rectangle here
  // (the address path /api/parcel{address} → parcel() handles them). Unconfigured states too.
  const cfg = STATE_REGISTRY[registryKey(opts.state, country)];
  if (cfg) {
    const all = Array.isArray(cfg) ? cfg : [cfg];
    let feat = null, matched = null;
    // R59g: when the caller sent the ADDRESS TEXT along with the coords, try
    // the situs (county address-index) candidates FIRST — a rural geocode
    // point sits on the road line and can land in the NEIGHBOR parcel (Steve's
    // Luebbering site: point → PID …012, situs → the true …013).
    if (opts.formatted) {
      for (const c of all) {
        if (c.mode !== 'situs' || !c.situsField) continue;
        try { feat = await queryStateSitus(c, opts.formatted); } catch (e) { feat = null; }
        if (feat && feat.geometry && Array.isArray(feat.geometry.rings) && feat.geometry.rings.length) { matched = c; break; }
        feat = null;
      }
    }
    /* The SAME geographic gate _queryRegistry uses. parcelAt has its own loop and
       does not go through _queryRegistry, so the R84 `near` hints were doing
       NOTHING on this path — which is the lat/lng path the API and every test
       actually take. Measured before this line existed: overhead scaled straight
       with position in the try-order —
           Houston  (order 0)   149ms      El Paso (order 23)  7,875ms
           Dallas   (order 1)   160ms      Lubbock (order 24) 10,268ms
       El Paso is 9.5 degrees of longitude from the DFW counties; every one of
       them was being queried and missed first. The R84 note claiming this was
       already fixed measured noise, not the gate. */
    const list = all.filter((c) => c.mode !== 'situs' && !_nearMiss(c, lng, lat));
    for (const c of (feat ? [] : list)) {
      try { feat = await queryStateParcel(c, lng, lat); } catch (e) { feat = null; }
      if (feat && feat.geometry && Array.isArray(feat.geometry.rings) && feat.geometry.rings.length) { matched = c; break; }
      feat = null;
    }
    // The caller said WHICH address this point stands for. If the lot under
    // the point carries a different house number (a geocoded point on the
    // wrong street, a suggestion that was really a creek or a park), look for
    // the asked-for number nearby before believing the point.
    let numberNote = '';
    const askedNo = houseNumberOf(opts.formatted);
    if (feat && askedNo) {
      const under = situsNumberOf(feat.attributes || {});
      if (under && under !== askedNo) {
        const alt = await sameNumberNearby(all, askedNo, lng, lat, requestedStreet(opts.formatted));
        if (alt) {
          feat = alt; matched = all.find((c) => c.numberField) || matched;
          numberNote = 'the point fell on a lot numbered ' + under + '; used the only lot numbered ' + askedNo + ' within 400 m: ' + alt.__numberMatch + ' - verify';
        }
      }
    }
    if (feat) {
      const usedFb = !!(matched && matched.url === CA_PARCELS_FB);   // FB-fabric provenance
      const res = buildParcel(feat.geometry.rings, feat.attributes || {}, lat, lng, { state: opts.state, zip: opts.zip, county: (matched && matched.county) || opts.county, country, source: 'arcgis-' + String(opts.state).toLowerCase() + (usedFb ? '-fb' : '') + (numberNote ? '-number-match' : '') });
      if (numberNote) res.parcel.note = numberNote;
      if (_atCache.size > 1000) _atCache.clear();
      if (!usedFb) _atCache.set(ck, res);    // cache real DWR hits only (approximate + FB → a retry can still upgrade)
      return res;
    }
  }
  return buildParcel(rectangleRings(lat, lng), {}, lat, lng, { state: opts.state || '', zip: opts.zip, county: opts.county, country, source: 'approximate' });
};

/* normalize an APN to digits+letters only (CA APNs are entered with/without
   dashes/spaces, e.g. "123-456-789" === "123456789"). */
const normApn = (a) => String(a || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
// ONLY fields that exist on the LightBox statewide layer — ArcGIS errors the
// whole WHERE clause if it references a missing field, so never OR across
// speculative names. PARCEL_APN = bare digits, TAXAPN = dashed form. NOTE: a
// bare APN attribute query has NO spatial filter, so it full-scans all 58
// counties and the MapServer aborts ("Error performing query operation") unless
// narrowed by county — APN-only resolution therefore fails soft (returns null);
// the address / site-address paths are the authoritative resolvers.
const APN_QUERY_FIELDS = ['PARCEL_APN', 'TAXAPN'];

/* APN -> parcel (CA statewide layer, attribute query). Tries the valid APN
   fields against both the raw entry and a dash/space-stripped form. The site
   address comes straight off the parcel record (buildParcel), with a centroid
   reverse-geocode only as a fallback. */
const parcelByApn = async (apnRaw) => {
  const apn = String(apnRaw || '').trim();
  const bare = normApn(apn);
  if (bare.length < 4) return null;
  const esc = (s) => s.replace(/'/g, "''");
  // County layers that index their APN (Sacramento: APN_DASH / APN10) answer
  // in ~0.5 s and stay up when the state layer is down. Tried against the
  // entry as typed, digits-only, and the 10-digit book/page/parcel form.
  for (const c of (Array.isArray(STATE_REGISTRY.CA) ? STATE_REGISTRY.CA : [])) {
    if (!Array.isArray(c.apnFields)) continue;
    const forms = [...new Set([apn, bare, bare.slice(0, 10)])].filter((v) => v.length >= 4);
    const where = c.apnFields.flatMap((f) => forms.map((v) => f + "='" + esc(v) + "'")).join(' OR ');
    let feat = null;
    try {
      const j = await getJsonRetry(c.url + '?where=' + encodeURIComponent(where) + '&outSR=4326&outFields=*&returnGeometry=true&geometryPrecision=7&f=json&resultRecordCount=2', c.timeout || 8000);
      const feats = ((j && j.features) || []).filter((f) => f && f.geometry && Array.isArray(f.geometry.rings) && f.geometry.rings.length);
      if (feats.length === 1) feat = feats[0];
    } catch (e) { feat = null; }
    if (feat) {
      const b = ringsBounds(feat.geometry.rings);
      const ctr = b ? { latitude: (b.n + b.s) / 2, longitude: (b.e + b.w) / 2 } : null;
      const out = buildParcel(feat.geometry.rings, feat.attributes || {}, ctr && ctr.latitude, ctr && ctr.longitude,
        { apn: pick(feat.attributes, c.apnFields) || apn, state: 'CA', county: c.county, source: 'arcgis-ca-' + String(c.county || 'county').toLowerCase().replace(/\s+/g, '-') + '-apn' });
      if (c.county) out.parcel.county = c.county;
      return out;
    }
  }
  // R59f — Franklin County MO PIDs (e.g. 31-5-22.0-0-000-013.000; Steve's
  // Luebbering carport site sits one parcel over from where the address
  // geocodes, so the exact PID is the authoritative pick). Also matches the
  // county's short LINK form (31-5-22.0-0-013.000).
  if (/^\d{2}-\d-\d{2}\.\d-\d-/.test(apn)) {
    const FCMO = 'https://services7.arcgis.com/HM4C7tGF5KT34U6h/arcgis/rest/services/FRANKLIN_CO_ARCGIS_ONLINE_2_gdb/FeatureServer/20/query';
    const where = "PID='" + esc(apn) + "' OR LINK='" + esc(apn) + "'";
    let feat = null;
    try {
      const j = await getJson(FCMO + '?where=' + encodeURIComponent(where)
        + '&outSR=4326&outFields=*&returnGeometry=true&geometryPrecision=7&f=json&resultRecordCount=1', 25000);
      feat = j && j.features && j.features[0];
    } catch (e) { feat = null; }
    if (feat && feat.geometry && Array.isArray(feat.geometry.rings) && feat.geometry.rings.length) {
      const b = ringsBounds(feat.geometry.rings);
      const c = b ? { latitude: (b.n + b.s) / 2, longitude: (b.e + b.w) / 2 } : null;
      const out = buildParcel(feat.geometry.rings, feat.attributes || {}, c && c.latitude, c && c.longitude,
        { apn, state: 'MO', source: 'arcgis-mo-apn' });
      out.parcel.county = 'Franklin';
      if (!out.address && c) {
        const rev = await reverseGeocode(c.latitude, c.longitude);
        if (rev) out.address = { line1: rev.line1, line2: rev.line2, formatted: rev.label, city: rev.city, state: rev.state || 'MO', zip: rev.postcode };
      }
      return out;
    }
    // fall through to the CA fabric only if the MO layer truly missed
  }
  const vals = bare !== apn ? [apn, bare] : [apn];
  const clauses = [];
  for (const fld of APN_QUERY_FIELDS) for (const v of vals) clauses.push(fld + "='" + esc(v) + "'");
  const where = clauses.join(' OR ');
  const tail = '&outSR=4326&outFields=*&returnGeometry=true&geometryPrecision=7&f=json&resultRecordCount=1';
  let feat = null, usedFb = false;
  try { const j = await dwrFetch(CA_PARCELS + '?where=' + encodeURIComponent(where) + tail, 12000); feat = j && j.features && j.features[0]; }
  catch (e) { feat = null; }
  if (!feat || !feat.geometry || !Array.isArray(feat.geometry.rings) || !feat.geometry.rings.length) {
    // DWR down/miss → the fallback fabric carries the same PARCEL_APN key.
    const fbWhere = vals.map((v) => "PARCEL_APN='" + esc(v) + "'").join(' OR ');
    try {
      const j = await getJson(CA_PARCELS_FB + '?where=' + encodeURIComponent(fbWhere) + tail, 25000);
      feat = j && j.features && j.features[0];
      if (feat) usedFb = true;
    } catch (e) { feat = null; }
  }
  if (!feat || !feat.geometry || !Array.isArray(feat.geometry.rings) || !feat.geometry.rings.length) return null;
  const bounds = ringsBounds(feat.geometry.rings);
  const center = bounds ? { latitude: (bounds.n + bounds.s) / 2, longitude: (bounds.e + bounds.w) / 2 } : null;
  const out = buildParcel(feat.geometry.rings, feat.attributes || {}, center && center.latitude, center && center.longitude, {
    // '-fb' provenance: the FB fabric measures ~4-7 ft off the DWR fabric for
    // the same APN (Gilroy, Jul 20 2026) — tag it so support can tell which
    // fabric a suspicious-looking lot line actually came from.
    apn: pick(feat.attributes, APN_QUERY_FIELDS) || apn, state: 'CA', source: 'ca-statewide-arcgis-apn' + (usedFb ? '-fb' : ''),
  });
  // fallback to a reverse-geocode only if the parcel record carries no address
  if (!out.address && center) {
    const rev = await reverseGeocode(center.latitude, center.longitude);
    if (rev) out.address = { line1: rev.line1, line2: rev.line2, formatted: rev.label, city: rev.city, state: rev.state || 'CA', zip: rev.postcode };
  }
  return out;
};

/* strip a trailing street-type suffix so "Beatrice Lane" -> "BEATRICE" matches
   the layer's SITE_STREET_NAME (which stores the core name, no suffix). */
const streetCore = (s) => String(s || '').toUpperCase()
  .replace(/[.,]/g, ' ')
  .replace(/\b(LANE|LN|STREET|ST|DRIVE|DR|AVENUE|AVE|AV|ROAD|RD|COURT|CT|PLACE|PL|WAY|BOULEVARD|BLVD|CIRCLE|CIR|TERRACE|TER|TRAIL|TRL|PARKWAY|PKWY|HIGHWAY|HWY|LOOP|RUN|PASS|PATH|ALLEY|ALY|SQUARE|SQ|CRESCENT|CRES|COVE|CV|BEND|BND)\b\s*$/, '')
  .replace(/\s+/g, ' ').trim();

/* CA parcel by its OWN site-address index (house number + street + city). This
   is the AUTHORITATIVE resolution — far more accurate than geocoding to a point,
   which interpolates along an address range and routinely lands on a NEIGHBORING
   parcel. Returns the exact recorded parcel (clean geometry + true APN). */
// result cache (site-address path): the CA layer is ~40s cold, so caching real
// hits makes a re-load of any address — e.g. a preset test-lot, or a saved
// project re-opened — instant. min-instances=1 keeps this warm across a session.
const _siteCache = new Map();
const parcelBySiteAddr = async (parts) => {
  parts = parts || {};
  const hn = String(parts.houseNumber || '').replace(/[^0-9]/g, '');
  const core = streetCore(parts.street);
  if (!hn || !core) return null;
  const ck = hn + '|' + core + '|' + String(parts.city || '').toUpperCase().trim();
  if (_siteCache.has(ck)) return _siteCache.get(ck);
  const esc = (s) => String(s).replace(/'/g, "''");
  // DIRECTION PREFIX ("6660 W Olive Ave"): the layers store the direction in a
  // SEPARATE field (DWR SITE_DIRECTION) or often OMIT it entirely (fallback
  // SITE_ADDR = "6660 OLIVE AVE"), so a street match that keeps the "W " MISSES
  // the recorded parcel and the resolve degrades to the geocode-point pick —
  // which interpolates on the street centerline and grabbed the NEIGHBOR ACROSS
  // THE ROAD (Steve, Jul 6: 6660 W Olive Ave Winton → 6687 Olive Ave). Try the
  // as-typed street first (real "W OLIVE"-named streets exist), then bare.
  // Photon/OSM suggestions spell the direction OUT ("West Olive Avenue") while
  // typed addresses abbreviate ("W Olive") — try as-typed, abbreviated, bare.
  const DIR_ABBR = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
  const dirM = core.match(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST|NORTHEAST|NORTHWEST|SOUTHEAST|SOUTHWEST)\s+(.+)$/);
  const streetCands = [core];
  if (dirM) {
    const alt = (DIR_ABBR[dirM[1]] || dirM[1]) + ' ' + dirM[2];
    if (alt !== core) streetCands.push(alt);
    streetCands.push(dirM[2]);
  }
  const city = String(parts.city || '').toUpperCase().trim();
  const tail = '&outSR=4326&outFields=*&returnGeometry=true&geometryPrecision=7&f=json&resultRecordCount=1';
  let feat = null, usedFb = false;
  for (const st of streetCands) {
    const clauses = ["SITE_HOUSE_NUMBER='" + esc(hn) + "'", "UPPER(SITE_STREET_NAME) LIKE '" + esc(st) + "%'"];
    if (city) clauses.push("UPPER(SITE_CITY)='" + esc(city) + "'");
    // getJsonRetry: DWR's intermittent fast 500s used to drop this AUTHORITATIVE
    // path onto the FB fabric (~4-7 ft off the DWR ring for the same APN).
    // 45000 -> 12000 (2026-09-01): during the slow-stall outage (30s per 500)
    // the first site-address lookup of a fresh instance burned its wave INSIDE
    // this call and the platform cut the request at ~30s — a 503 in the studio
    // before the breaker could serve the retry. 12s keeps the whole
    // trip-then-fallback inside one request.
    try { const j = await dwrFetch(CA_PARCELS + '?where=' + encodeURIComponent(clauses.join(' AND ')) + tail, 12000); feat = j && j.features && j.features[0]; }
    catch (e) { feat = null; }
    if (feat && feat.geometry) break;
  }
  if (!feat || !feat.geometry || !Array.isArray(feat.geometry.rings) || !feat.geometry.rings.length) {
    /* DWR down/miss → the fallback fabric. NOT by attribute: every attribute
       query on the AGOL FB layer is an unindexed full scan of ~13M rows —
       measured 2026-09-01 at 20-31s for both SITE_ADDR LIKE and PARCEL_APN
       equality — which blows any request budget and is why the studio's first
       CA lookup 503'd during the DWR outage. Instead: geocode the assembled
       address (keyless, ~1s), spatial-query the FB fabric at the point (~0.4s
       measured), then accept a hit ONLY if the parcel's OWN SITE_ADDR is the
       requested house number + street — the same authority the attribute
       query encoded, in ~2s instead of 30. */
    const composed = [hn + ' ' + String(parts.street || '').trim(), String(parts.city || '').trim(), 'CA', String(parts.zip || '').trim()].filter(Boolean).join(', ');
    let geo = null;
    try { geo = await geocode(composed); } catch (e) { geo = null; }
    if (geo && Number.isFinite(geo.latitude) && Number.isFinite(geo.longitude)) {
      const dd = 0.0004; // ~44 m half-size — the lot is within a rooftop/interpolated point
      const envGeom = JSON.stringify({ xmin: geo.longitude - dd, ymin: geo.latitude - dd, xmax: geo.longitude + dd, ymax: geo.latitude + dd, spatialReference: { wkid: 4326 } });
      const url = CA_PARCELS_FB + '?where=' + encodeURIComponent('1=1') + '&geometry=' + encodeURIComponent(envGeom)
        + '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects'
        + '&outFields=*&returnGeometry=true&geometryPrecision=7&f=json';
      let feats = [];
      try { const j = await getJson(url, 25000); feats = (j && j.features) || []; } catch (e) { feats = []; }
      for (const st of streetCands) {
        const want = (hn + ' ' + st).toUpperCase();
        for (const f of feats) {
          const sa = String(((f && f.attributes) || {}).SITE_ADDR || '').toUpperCase().trim();
          // exact "311 VERNON" or "311 VERNON ST…" — never "311 VERNONIA AVE"
          if ((sa === want || sa.startsWith(want + ' ')) && f.geometry && Array.isArray(f.geometry.rings) && f.geometry.rings.length) { feat = f; usedFb = true; break; }
        }
        if (feat) break;
      }
    }
  }
  if (!feat || !feat.geometry || !Array.isArray(feat.geometry.rings) || !feat.geometry.rings.length) return null;
  const bounds = ringsBounds(feat.geometry.rings);
  const center = bounds ? { latitude: (bounds.n + bounds.s) / 2, longitude: (bounds.e + bounds.w) / 2 } : null;
  const res = buildParcel(feat.geometry.rings, feat.attributes || {}, center && center.latitude, center && center.longitude,
    { state: 'CA', zip: parts.zip, source: 'ca-statewide-arcgis-site' + (usedFb ? '-fb' : '') });
  if (_siteCache.size > 500) _siteCache.clear();
  if (!usedFb) _siteCache.set(ck, res);   // FB hits are not cached — a retry can upgrade to the DWR fabric
  return res;
};

/* ======================= elevation =================================== */

/* USGS EPQS point query (keyless). Returns elevation in FEET or null. */
const elevationAt = async (lat, lng, timeoutMs) => {
  const url = 'https://epqs.nationalmap.gov/v1/json'
    + '?x=' + encodeURIComponent(lng)
    + '&y=' + encodeURIComponent(lat)
    + '&units=Feet&wkid=4326';
  const j = await getJson(url, timeoutMs);
  if (!j) return null;
  // EPQS v1 returns { value: <number-or-string> }
  let v = j.value;
  if (v == null && j.location && j.location.elevation != null) v = j.location.elevation;
  const num = Number(v);
  if (!Number.isFinite(num) || num <= USGS_NODATA) return null;
  return num;
};

/* Sample many points with BOUNDED CONCURRENCY + ONE GLOBAL DEADLINE. EPQS has no
   batch endpoint. The old sequential 16-point chunks had a hidden 4 × 15s tail:
   one stalled request held each chunk before the next could start, so a normal
   7×7 terrain grid could take almost exactly 60s. A small worker pool has no
   batch barriers, and every in-flight request inherits the SAME remaining
   deadline. Fast points are retained; late points return null and the client
   interpolates around those holes without reducing its authored 7×7 grid.

   Successful readings are cached by ~4-inch coordinate cells. Repeated/reload
   terrain requests therefore return immediately and can also combine cached
   points with fresh partial results during a degraded USGS interval. */
const ELEV_CONCURRENCY = 16;
const ELEV_DEADLINE_MS = Math.min(12000, Math.max(1000,
  Number(process.env.ELEVATION_DEADLINE_MS) || 5000));
const ELEV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ELEV_CACHE_MAX = 4096;
const _elevationCache = new Map();
const elevationCacheKey = (lat, lng) => lat.toFixed(6) + ',' + lng.toFixed(6);
const cachedElevation = (key, now) => {
  const hit = _elevationCache.get(key);
  if (!hit) return null;
  if (now - hit.at > ELEV_CACHE_TTL_MS) { _elevationCache.delete(key); return null; }
  // refresh insertion order so the size cap behaves like a tiny LRU
  _elevationCache.delete(key); _elevationCache.set(key, hit);
  return hit.elevation;
};
const rememberElevation = (key, value, now) => {
  if (!Number.isFinite(value)) return;
  if (_elevationCache.has(key)) _elevationCache.delete(key);
  _elevationCache.set(key, { elevation: value, at: now });
  while (_elevationCache.size > ELEV_CACHE_MAX) {
    const oldest = _elevationCache.keys().next().value;
    _elevationCache.delete(oldest);
  }
};
const settleWithin = (promise, timeoutMs) => new Promise((resolve) => {
  let settled = false;
  let timer = null;
  const done = (v) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(v); } };
  timer = setTimeout(() => done(null), Math.max(1, timeoutMs));
  Promise.resolve(promise).then(done, () => done(null));
});

const elevation = async (points, opts) => {
  if (!Array.isArray(points)) return [];
  opts = opts || {};
  const out = new Array(points.length);
  const now = Date.now();
  const deadlineMs = Math.min(15000, Math.max(1,
    Number.isFinite(Number(opts.deadlineMs)) ? Number(opts.deadlineMs) : ELEV_DEADLINE_MS));
  const deadlineAt = now + deadlineMs;
  const concurrency = Math.min(32, Math.max(1,
    Number.isFinite(Number(opts.concurrency)) ? Number(opts.concurrency) | 0 : ELEV_CONCURRENCY));
  const fetchPoint = typeof opts.fetchPoint === 'function' ? opts.fetchPoint : elevationAt;
  const jobsByKey = new Map();

  for (let i = 0; i < points.length; i++) {
    const p = points[i] || {};
    const lat = Number(p.lat), lng = Number(p.lng);
    out[i] = { lat, lng, elevation: null };
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = elevationCacheKey(lat, lng);
    const hit = opts.noCache ? null : cachedElevation(key, now);
    if (hit != null) { out[i].elevation = hit; continue; }
    let job = jobsByKey.get(key);
    if (!job) { job = { key, lat, lng, indexes: [] }; jobsByKey.set(key, job); }
    job.indexes.push(i);
  }

  const jobs = Array.from(jobsByKey.values());
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) return;
      let value = null;
      try { value = await settleWithin(fetchPoint(job.lat, job.lng, remaining), remaining); }
      catch (e) { value = null; }
      value = value == null ? null : Number(value);
      if (!Number.isFinite(value) || value <= USGS_NODATA) value = null;
      if (value != null && !opts.noCache) rememberElevation(job.key, value, Date.now());
      for (const i of job.indexes) out[i].elevation = value;
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, jobs.length); i++) workers.push(worker());
  await Promise.all(workers);
  return out;
};

/* ======================= static map URL ============================== */

/* Build a Google Static Maps URL. Needs MAPS_API_KEY; returns null without.
   When rings are supplied, draws the first ring as a red outline path. */
const staticMapUrl = (opts) => {
  const o = opts || {};
  const key = process.env.MAPS_API_KEY;
  if (!key) return null;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  const zoom = o.zoom || 19;
  const w = o.w || 640;
  const h = o.h || 640;
  const maptype = ['roadmap', 'hybrid'].includes(o.maptype) ? o.maptype : 'satellite';
  let url = 'https://maps.googleapis.com/maps/api/staticmap'
    + '?center=' + encodeURIComponent(lat + ',' + lng)
    + '&zoom=' + zoom
    + '&size=' + w + 'x' + h
    + '&maptype=' + maptype;
  if (o.scale === 2) url += '&scale=2';   // 2x pixel density — crisp street-name labels
  if (Array.isArray(o.rings) && o.rings.length && Array.isArray(o.rings[0])) {
    const pts = o.rings[0]
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((p) => p[1] + ',' + p[0]) // path takes lat,lng pairs
      .join('|');
    if (pts) url += '&path=' + encodeURIComponent('color:0xff0000|weight:2|') + pts;
  }
  url += '&key=' + key;
  return url;
};

/* WI-L: adjacent parcels — a WIDER envelope query around (lat,lng) that returns
   the NEIGHBORING lots for the site plan and the Developer-Mode multi-parcel
   picker (the subject `opts.apn` is dropped). CA uses the keyless statewide
   layer; every other state routes through its STATE_REGISTRY spatial layer
   (situs-only layers FL/IN can't do envelope queries and return []). Returns
   {parcels:[{apn,rings,areaSqFt,bounds}]}; empty on any error (fail-soft). */
const NEAR_APN_KEYS = ['PARCEL_APN', 'Search_PARCELAPN', 'APN', 'apn', 'AIN', 'PARNO', 'PARCELID',
  'ParcelID', 'PARCEL_ID', 'Prop_ID', 'parno', 'SBL', 'PAMS_PIN', 'parcel_id', 'ACCTID', 'PIN',
  'tmk', 'GISID', 'pid', 'SPAN', 'PARCEL_ID_NR', 'UPC', 'PlatLot', 'parcelnb', 'Parcel',
  'SERIAL_NUM', 'CleanParcelID', 'Parcel_ID', 'Pin10', 'PAN', 'KEYPIN', 'MAP_BK_LOT'];
const _featsToParcels = (feats, subjApn) => {
  const subj = normApn(subjApn);
  const parcels = [];
  for (const f of (feats || [])) {
    if (!f || !f.geometry || !Array.isArray(f.geometry.rings) || !f.geometry.rings.length) continue;
    const apn = String(pick(f.attributes, NEAR_APN_KEYS) || '');
    if (subj && normApn(apn) === subj) continue; // drop the subject parcel itself
    parcels.push({
      apn,
      rings: f.geometry.rings,
      areaSqFt: Math.round(ringsAreaSqFt(f.geometry.rings)),
      bounds: ringsBounds(f.geometry.rings),
    });
  }
  return parcels;
};
const parcelsNear = async (lat, lng, opts) => {
  lat = Number(lat); lng = Number(lng); opts = opts || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { parcels: [] };
  // envelope half-size in degrees: ~200 ft default (clamp 60–600 ft). 1° lat ≈ 364,000 ft;
  // widen the lng half-size by 1/cos(lat) so the box is ~square on the ground.
  const radiusFt = Math.min(600, Math.max(60, Number(opts.radiusFt) || 200));
  const dd = radiusFt / FEET_PER_DEG_LAT;
  const ddLng = dd / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  // record cap 100 (was 24): ArcGIS honors resultRecordCount in OBJECTID order,
  // not proximity — in dense city fabric a 400 ft envelope holds 80+ parcels, so
  // the old cap 24 returned an arbitrary block cluster and TRUNCATED the ring
  // around the subject lot (Steve's Broadway: neighbors "didn't appear" while
  // blocks 500 ft north rendered). Generalized rings are a few hundred bytes
  // each — 100 features is still a small payload.
  const limit = Math.min(120, Math.max(1, Number(opts.limit) || 100));
  const envGeom = JSON.stringify({ xmin: lng - ddLng, ymin: lat - dd, xmax: lng + ddLng, ymax: lat + dd, spatialReference: { wkid: 4326 } });
  const tail = '&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*'
    + '&returnGeometry=true&geometryPrecision=7&f=json&resultRecordCount=' + limit;
  const qs = '?where=' + encodeURIComponent('1=1') + '&geometry=' + encodeURIComponent(envGeom)
    + '&geometryType=esriGeometryEnvelope' + tail;
  /* INFER THE STATE, DO NOT ASSUME CALIFORNIA.

     This read `opts.state || 'CA'`, so a stateless call — the Developer-Mode map
     pick, which sends coordinates and no state — routed a Texas point into the
     California fabric. Measured against production before the fix:

         Houston TX   with state: 5 neighbours in 2.9s
                      no state:   0 neighbours in 35 SECONDS
         Arlington TX with state: 3 neighbours in 2.8s
                      no state:   0 neighbours in 22 SECONDS

     Both failures at once: a silent wrong answer ("this area has no parcels")
     AND half a minute spent earning it, because the CA branch below gives DWR
     five hard retries at a 45s budget and then tries the FB fallback — all for
     a point no California layer can ever contain.

     parcelAt already solves this exact case by reverse-geocoding the point, so
     use the same inference rather than a second guess. Fail-soft: if the lookup
     misses, fall through to CA as before, which is no worse than today. */
  const country = String(opts.country || '').toUpperCase() || (inAustralia(lat, lng) ? 'AU' : 'US');
  let state = String(opts.state || '').toUpperCase();
  if (!state) {
    try {
      const sug = await reverseGeocode(lat, lng);
      state = stateAbbr((sug && sug.state) || '', (sug && sug.countrycode) || country) || '';
    } catch (e) { /* keep going — the CA fallback below is the old behaviour */ }
  }
  // the historical CA default only ever made sense for a US point — an AU
  // point with no resolvable state honestly returns no neighbours instead
  if (!state && country === 'US') state = 'CA';
  if (country === 'US' && state === 'CA') {
    /* R36 — NO SILENT FABRIC SWAP. The FB fallback is offset ~4.4 ft E and
       ~20% undersize vs DWR on the measured Gilroy block; serving it
       UNTAGGED for a multi-parcel flow scatters every lot relative to its
       neighbors (Steve: "adjacent buildings lots are all scattered... I
       don't want tricks where you fall back"). DWR gets a harder retry
       (5 quick-fail retries — its failures are sub-second); if the fallback
       must serve, the result is TAGGED so the client can warn and refresh,
       and (already) never cached, so the next load upgrades to DWR. */
    let feats = [];
    try { const j = await dwrFetch(CA_PARCELS + qs, 12000); feats = (j && j.features) || []; } catch (e) { feats = []; }
    if (feats.length) return { parcels: _featsToParcels(feats, opts.apn), fabric: 'dwr' };
    try {
      const j = await getJson(CA_PARCELS_FB + qs, 25000);
      const fb = (j && j.features) || [];
      if (fb.length) return { parcels: _featsToParcels(fb, opts.apn), fabric: 'fb', approxFabric: true };
    } catch (e) { /* fall through */ }
    return { parcels: [], fabricDown: true };
  }
  // NATIONAL: the state's registered spatial layer(s) — same envelope, all features.
  // Per-county arrays (AZ/GA/IL/MI/AK) are tried in order; first layer with hits
  // wins (each layer only holds its own jurisdiction, so hits identify the county).
  const cfg = STATE_REGISTRY[registryKey(state, country)];
  if (!cfg) return { parcels: [] };
  for (const c of (Array.isArray(cfg) ? cfg : [cfg])) {
    if (c.mode === 'situs') continue;   // FL/IN: address-only layers, no spatial queries
    if (_nearMiss(c, lng, lat)) continue;   // THIRD consumer of the registry — gate it too
    try {
      const j = await getJson(c.url + qs, c.timeout || 25000, c.headers);
      const parcels = _featsToParcels(j && j.features, opts.apn);
      if (parcels.length) return { parcels };
    } catch (e) { /* try the next candidate layer */ }
  }
  return { parcels: [] };
};

module.exports = {
  geocode,
  parcel,
  parcelAt,
  parcelsNear,
  parcelByApn,
  parcelBySiteAddr,
  autocomplete,
  reverseGeocode,
  elevation,
  staticMapUrl,
  // pure helpers (handy for callers/tests)
  stateAbbr,
  photonToSuggestion,
  googlePredToSuggestion,
  usOnlySuggestions,
  US_BBOX,
  // typed-state consistency + AU lot/plan (pure/testable)
  typedStateOf,
  keepTypedState,
  auLotPlanOf,
  resolveAuLotPlan,
  esriSuggest,
  // street-name integrity (pure/testable)
  requestedStreet,
  streetMatches,
  houseNumberOf,
  situsNumberOf,
  sameNumberNearby,
  // Australia + country routing (pure/testable)
  auOnlySuggestions,
  auQuery,
  AU_BBOX,
  registryKey,
  inAustralia,
  // CA DWR circuit breaker — tests trip/reset it without the network
  DWR_BREAKER,
  normApn,
  buildParcel,
  // geometry helpers
  ringsAreaSqFt,
  ringsBounds,
  lotDimsFromAreaPerim,
  ringPerimeterFt,
  // parcel-registry internals (for non-network gate tests)
  STATE_REGISTRY,
  ptInRing,
  ptInRings,
  pickParcelFeature,
  // constants (handy for callers/tests)
  FEET_PER_DEG_LAT,
  MAX_OFFSET_DEG,
  // quick-fail retry (injectable fetch for tests)
  getJsonRetry,
};
