/* ============================================================
   PlanCrafters — osmroads.js  (HA.osmroads)   [U1b]
   ------------------------------------------------------------
   "Fill the streets from the map." Fetches REAL road geometry from
   OpenStreetMap (the Overpass API) around the subject lot and lays the
   actual street centerlines — names, widths by class, the real bends —
   into the model, aligned to the lot via the SAME geoXform that places
   the parcel + the aerial underlay (HA.parcel.projectWithXform). This is
   a step toward Steve's "click a few buttons → tons of houses".

   Split:
     - PURE  : overpassQuery / classOf / widthInForWay / parseOverpass /
               roadFeature   (offline + unit-tested with a fixture)
     - ASYNC : fetchRoads(model)  — the live Overpass call + projection,
               fail-soft (returns {ok:false} on any network error).

   Data: © OpenStreetMap contributors (ODbL). The roadway WIDTHS are
   screen estimates by highway class (or the OSM width/lanes tags when
   present) — NOT surveyed right-of-way; verify against a plat for filing.
   No DOM. Pure parts run standalone in tests / before the app boots.
   ============================================================ */
(function () {
  const HA = (typeof window !== 'undefined' ? window : globalThis).HA ||
    ((typeof window !== 'undefined' ? window : globalThis).HA = {});
  const ROADS = {};

  /* OSM highway classes we lay, each with a default roadway WIDTH (feet) and a
     rank (lower = bigger road, drawn first/under). Foot/cycle ways are narrow
     (sidewalks / trails). Anything not listed is skipped. */
  ROADS.CLASSES = {
    motorway: { widthFt: 48, rank: 0 }, motorway_link: { widthFt: 24, rank: 0 },
    trunk: { widthFt: 44, rank: 1 }, trunk_link: { widthFt: 22, rank: 1 },
    primary: { widthFt: 40, rank: 2 }, primary_link: { widthFt: 20, rank: 2 },
    secondary: { widthFt: 34, rank: 3 }, secondary_link: { widthFt: 18, rank: 3 },
    tertiary: { widthFt: 30, rank: 4 }, tertiary_link: { widthFt: 18, rank: 4 },
    residential: { widthFt: 26, rank: 5 },
    living_street: { widthFt: 22, rank: 6 },
    unclassified: { widthFt: 24, rank: 6 },
    service: { widthFt: 16, rank: 7 },
    footway: { widthFt: 5, rank: 9 }, path: { widthFt: 5, rank: 9 },
    cycleway: { widthFt: 6, rank: 9 }, pedestrian: { widthFt: 12, rank: 8 },
  };
  ROADS.DEFAULT_RADIUS_M = 220;        // ~720 ft around the lot
  ROADS.ATTRIBUTION = '© OpenStreetMap contributors';
  // public Overpass mirrors, tried in order (fail-soft to the next)
  ROADS.ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  const FT_PER_M = 3.280839895;

  /* the OSM highway class of a way's tags, or null if we don't lay it. */
  ROADS.classOf = (tags) => {
    const h = tags && tags.highway;
    return (h && ROADS.CLASSES[h]) ? h : null;
  };

  /* roadway width in PLAN INCHES: an explicit width tag (metres) wins, else a
     lane count (~11 ft/lane + 4 ft), else the per-class default. Min 3 ft. */
  ROADS.widthInForWay = (tags) => {
    const k = ROADS.classOf(tags);
    let ft = (k && ROADS.CLASSES[k].widthFt) || 24;
    if (tags && tags.width != null) {
      const m = parseFloat(tags.width);
      if (isFinite(m) && m > 0) ft = m * FT_PER_M;
    } else if (tags && tags.lanes != null) {
      const n = parseInt(tags.lanes, 10);
      if (isFinite(n) && n > 0) ft = Math.max(ft, n * 11 + 4);
    }
    return Math.max(36, Math.round(ft * 12));
  };

  /* Overpass QL: every highway way within `radiusM` of (lat,lng). `out geom`
     returns each way's node lat/lng INLINE (one round-trip, no node pass). */
  ROADS.overpassQuery = (lat, lng, radiusM) => {
    const r = Math.max(40, Math.min(1500, Math.round(radiusM || ROADS.DEFAULT_RADIUS_M)));
    return '[out:json][timeout:25];' +
      '(way["highway"](around:' + r + ',' + (+lat).toFixed(7) + ',' + (+lng).toFixed(7) + '););' +
      'out body geom;';
  };

  /* PURE: Overpass JSON (from `out geom`) + a projectRing fn
     ([[lng,lat],...] → [{x,y},...] plan inches) → roads in the lot's plan
     frame. opts.clipRadiusIn (+ opts.center) drops ways entirely outside a
     plan circle. Returns [{id,name,klass,widthIn,oneway,centerline:[{x,y}]}],
     biggest roads first (so they draw under the smaller ones). */
  ROADS.parseOverpass = (json, projectRing, opts) => {
    opts = opts || {};
    const els = (json && json.elements) || [];
    const clipR = opts.clipRadiusIn || 0;
    const center = opts.center || { x: 0, y: 0 };
    const out = [];
    for (const el of els) {
      if (!el || el.type !== 'way') continue;
      const tags = el.tags || {};
      const klass = ROADS.classOf(tags);
      if (!klass) continue;
      const geom = el.geometry;
      if (!Array.isArray(geom) || geom.length < 2) continue;
      const llRing = [];
      for (const g of geom) { if (g && isFinite(g.lon) && isFinite(g.lat)) llRing.push([g.lon, g.lat]); }
      if (llRing.length < 2) continue;
      let planRing = [];
      try { planRing = projectRing(llRing) || []; } catch (e) { planRing = []; }
      const centerline = [];
      for (const p of planRing) { if (p && isFinite(p.x) && isFinite(p.y)) centerline.push({ x: p.x, y: p.y }); }
      if (centerline.length < 2) continue;
      if (clipR > 0) {
        let near = false;
        for (const p of centerline) { if (Math.hypot(p.x - center.x, p.y - center.y) <= clipR) { near = true; break; } }
        if (!near) continue;
      }
      out.push({
        id: 'osm' + el.id,
        name: tags.name || tags.ref || '',
        klass,
        widthIn: ROADS.widthInForWay(tags),
        oneway: tags.oneway === 'yes',
        centerline,
      });
    }
    out.sort((a, b) => (ROADS.CLASSES[a.klass].rank - ROADS.CLASSES[b.klass].rank));
    return out;
  };

  /* ---------- PARCEL GUARD (Jul 10: brown "roads" crossing the lot) ----------
     A public street must never run THROUGH the subject parcel: on CA lots the
     resolved ring can be APPROXIMATE (ArcGIS fallback) and overlap the real
     street, and OSM sometimes maps service ways/alleys across a parcel — either
     way the road ribbon then paints across the yard on the plan/A1.0 (and used
     to carve a soil strip out of the 3D terrain pad). Clip every centerline to
     the OUTSIDE of the lot ring: exact segment↔ring intersections split each
     segment, sub-segments whose midpoint is inside the ring are dropped, and
     the survivors keep the boundary crossing points so a street still meets the
     lot line flush. detectFrontEdge is safe by construction — it already
     REJECTS road points on the inward side of an edge, so we only remove points
     it could never score. All pure (unit-tested offline). */

  /* even-odd point-in-ring (local, so the module stays standalone/pure) */
  ROADS.pointInRing = (p, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
      if (((yi > p.y) !== (yj > p.y)) &&
          (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  };

  /* split a centerline into the RUNS of it that lie OUTSIDE `ring`. Each run is
     [{x,y},…] (≥2 pts) ending/starting exactly ON the ring where the line
     crosses it. A line fully outside → one run (the whole line); fully inside →
     []. Degenerate/absent ring → the whole line untouched. Pure. */
  ROADS.clipCenterlineOutsideLot = (cl, ring) => {
    if (!Array.isArray(cl) || cl.length < 2) return [];
    if (!Array.isArray(ring) || ring.length < 3) return [cl.map((p) => ({ x: p.x, y: p.y }))];
    const runs = [];
    let cur = [];
    const pushPt = (p) => {
      const q = cur[cur.length - 1];
      if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 1e-6) cur.push({ x: p.x, y: p.y });
    };
    const closeRun = () => { if (cur.length >= 2) runs.push(cur); cur = []; };
    for (let i = 0; i + 1 < cl.length; i++) {
      const a = cl[i], b = cl[i + 1];
      // parametric ts where this segment crosses a ring edge (plus the endpoints)
      const ts = [0, 1];
      for (let j = 0; j < ring.length; j++) {
        const c = ring[j], d = ring[(j + 1) % ring.length];
        const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        if (Math.abs(den) < 1e-12) continue;                    // parallel
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
        const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
        if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
      }
      ts.sort((p, q) => p - q);
      // keep each sub-segment whose midpoint sits outside the ring
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        if (t1 - t0 < 1e-9) continue;
        const tm = (t0 + t1) / 2;
        if (!ROADS.pointInRing({ x: a.x + (b.x - a.x) * tm, y: a.y + (b.y - a.y) * tm }, ring)) {
          pushPt({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 });
          pushPt({ x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 });
        } else closeRun();
      }
    }
    closeRun();
    return runs;
  };

  /* apply the guard to a parseOverpass result: roads untouched by the lot pass
     through as-is; a road crossing it is SPLIT into its outside runs (ids get a
     _c<k> suffix so each stays unique). Pure. */
  ROADS.clipRoadsToLot = (parsed, lotRing) => {
    if (!Array.isArray(parsed) || !Array.isArray(lotRing) || lotRing.length < 3) return parsed || [];
    const out = [];
    for (const r of parsed) {
      const runs = ROADS.clipCenterlineOutsideLot(r.centerline, lotRing);
      if (runs.length === 1 && runs[0].length === r.centerline.length) { out.push(r); continue; }
      runs.forEach((run, k) => { if (run.length >= 2) out.push(Object.assign({}, r, { id: r.id + '_c' + k, centerline: run })); });
    }
    return out;
  };

  /* signature of the geoXform a road batch was projected under. Stamped on every
     laid road feature (feature.xfSig) so consumers can tell a road laid for the
     CURRENT lot from a STALE one left behind by a fast lot swap whose OSM
     re-fetch failed — a stale batch sits in the old projection and can land
     anywhere on the new lot. Mirrors terrain.cacheKey's field list. Pure. */
  ROADS.xfSig = (xf) => {
    if (!xf || xf.lat == null || xf.lng == null) return null;
    return [xf.lat, xf.lng, xf.scale, xf.rot, xf.dx, xf.dy,
      xf.pivot && xf.pivot.x, xf.pivot && xf.pivot.y].map((v) => String(v)).join('|');
  };

  /* THE geoXform every OSM projection must ride (Steve, Jul 20: "your 3d
     building overlays are off"). satdrape.verifiedXform is the registration
     authority for ALL geo imagery — it heals a stale/corrupt saved rot/shift
     (the Jul-6 northRot-overwrite era) by replaying the source parcel rings
     against site.lot. The OSM layers used to project through the RAW saved
     site.geoXform, so on a healed model every massing/road sat a consistent
     several feet off the drape imagery (measured 11.5 ft at 1.5° of stale rot,
     100 m out) while the parcels/tiles registered fine. One authority = the
     buildings land on their roofs. Fail-soft: headless/pure consumers without
     satdrape (or a throw inside the heal) get the raw saved xform. */
  ROADS.effectiveXform = (model) => {
    const site = model && model.site;
    const raw = (site && site.geoXform && site.geoXform.lat != null && site.geoXform.lng != null)
      ? site.geoXform : null;
    try {
      if (raw && HA.satdrape && typeof HA.satdrape.verifiedXform === 'function') {
        const v = HA.satdrape.verifiedXform(model);
        if (v && v.lat != null && v.lng != null) return v;
      }
    } catch (e) { /* the heal is an optimization — never break a fetch */ }
    return raw;
  };

  /* a renderable 'road' site feature: the centerline offset into a ribbon poly
     (HA.sitefeatures.offsetPath) the 2D painter + the 3D terrain-drape slab read. */
  ROADS.roadFeature = (road) => {
    const SF = HA.sitefeatures;
    const half = Math.max(18, (road.widthIn || 288) / 2);
    let poly = [];
    try { if (SF && SF.offsetPath) poly = SF.offsetPath(road.centerline, half); } catch (e) { poly = []; }
    return {
      id: road.id || ('road_' + road.klass + '_' + (road.centerline[0] ? Math.round(road.centerline[0].x) : 0)),
      type: 'road', existing: true, source: 'osm',
      label: road.name || 'STREET', klass: road.klass, widthIn: road.widthIn,
      oneway: !!road.oneway,
      centerline: road.centerline.map((p) => ({ x: p.x, y: p.y })),
      poly,
    };
  };

  /* ASYNC: fetch real roads around the lot from Overpass + project them into the
     lot's plan frame, returning 'road' features. Fail-soft: any missing
     geoXform / network error / empty result resolves {ok:false, roads:[]} so the
     caller can fall back gracefully (never throws, never breaks the app). */
  ROADS.fetchRoads = async (model, opts) => {
    opts = opts || {};
    const site = model && model.site;
    // effectiveXform: same healed transform the sat drape/aerial imagery uses
    const xf = ROADS.effectiveXform(model);
    if (!xf || xf.lat == null || xf.lng == null ||
        !HA.parcel || typeof HA.parcel.planToGeo !== 'function' || typeof HA.parcel.projectWithXform !== 'function') {
      return { ok: false, reason: 'no-geoxform', roads: [] };
    }
    // lot centroid (plan) → geo: the query centre
    const lot = (Array.isArray(site.lot) && site.lot.length >= 3) ? site.lot : null;
    let cx = 0, cy = 0;
    if (lot) { for (const p of lot) { cx += p.x; cy += p.y; } cx /= lot.length; cy /= lot.length; }
    const cg = HA.parcel.planToGeo({ x: cx, y: cy }, xf) || { lat: xf.lat, lng: xf.lng };
    const radiusM = Math.max(60, Math.min(1200, opts.radiusM || ROADS.DEFAULT_RADIUS_M));
    const query = ROADS.overpassQuery(cg.lat, cg.lng, radiusM);

    let json = null, reason = 'fetch-failed';
    if (typeof fetch !== 'function') return { ok: false, reason: 'no-fetch', roads: [] };
    for (const url of ROADS.ENDPOINTS) {
      try {
        let signal;
        let timer = null;
        if (typeof AbortController !== 'undefined') {
          const ctrl = new AbortController();
          signal = ctrl.signal;
          timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, opts.timeoutMs || 22000);
        }
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal,
        });
        if (timer) clearTimeout(timer);
        if (resp && resp.ok) { json = await resp.json(); break; }
        reason = 'http-' + (resp ? resp.status : '0');
      } catch (e) { reason = 'fetch-error'; }
    }
    if (!json) return { ok: false, reason, roads: [] };

    const projectRing = (llRing) => {
      try { const r = HA.parcel.projectWithXform([llRing], xf); return (r && r[0]) ? r[0] : []; }
      catch (e) { return []; }
    };
    const clipRadiusIn = radiusM * FT_PER_M * 12 * 1.15;
    let parsed = ROADS.parseOverpass(json, projectRing, { clipRadiusIn, center: { x: cx, y: cy } });
    // PARCEL GUARD: streets render AROUND the lot, never through it — clip every
    // centerline to the outside of the parcel ring (see clipCenterlineOutsideLot).
    if (lot) parsed = ROADS.clipRoadsToLot(parsed, lot);
    const roads = parsed.map(ROADS.roadFeature).filter((f) => Array.isArray(f.poly) && f.poly.length >= 3);
    // stamp the projection signature so a stale batch (old lot's xform) is detectable
    const sig = ROADS.xfSig(xf);
    if (sig) for (const f of roads) f.xfSig = sig;
    return { ok: true, roads, attribution: ROADS.ATTRIBUTION, center: cg, radiusM, raw: parsed.length };
  };

  /* ============================================================
     OSM CONTEXT — NEIGHBOR BUILDING MASSINGS
     ------------------------------------------------------------
     "The neighborhood suddenly exists." Fetches OSM building FOOTPRINTS
     around the geocoded lot (same Overpass path fetchRoads uses) and emits
     muted ghost-gray extruded massings as standard site features:
       { type:'neighbor', source:'osm', existing:true, noPick:true,
         poly:[{x,y}…] (plan inches), heightIn }
     Rules: NEVER on the subject parcel (any footprint vertex or the centroid
     inside the lot ring drops the building), capped at NEIGHBOR_CAP nearest,
     deterministic ordering, cached per address (xfSig), fail-soft offline.
     PURE: buildingsQuery / buildingHeightIn / parseBuildings / neighborFeature.
     ASYNC: fetchNeighbors. Data © OpenStreetMap contributors (ODbL).
     ============================================================ */
  ROADS.NEIGHBOR_CAP = 60;                 // most context massings per lot
  ROADS.NEIGHBOR_DEFAULT_HEIGHT_FT = 18;   // no tags → a modest one/two-story mass
  ROADS.NEIGHBOR_FT_PER_LEVEL = 10;

  /* Overpass QL: every building way within `radiusM` of (lat,lng), geometry inline. */
  ROADS.buildingsQuery = (lat, lng, radiusM) => {
    const r = Math.max(40, Math.min(1500, Math.round(radiusM || ROADS.DEFAULT_RADIUS_M)));
    return '[out:json][timeout:25];' +
      '(way["building"](around:' + r + ',' + (+lat).toFixed(7) + ',' + (+lng).toFixed(7) + '););' +
      'out body geom;';
  };

  /* massing height in PLAN INCHES: explicit height tag (metres) wins, else
     building:levels × 10 ft, else 18 ft. Clamped 8..200 ft. Pure. */
  ROADS.buildingHeightIn = (tags) => {
    let ft = ROADS.NEIGHBOR_DEFAULT_HEIGHT_FT;
    if (tags && tags.height != null) {
      const m = parseFloat(tags.height);
      if (isFinite(m) && m > 0) ft = m * FT_PER_M;
    } else if (tags && tags['building:levels'] != null) {
      const n = parseInt(tags['building:levels'], 10);
      if (isFinite(n) && n > 0) ft = n * ROADS.NEIGHBOR_FT_PER_LEVEL;
    }
    ft = Math.max(8, Math.min(200, ft));
    return Math.round(ft * 12);
  };

  /* PURE: Overpass building JSON + projectRing → neighbor massings in the lot's
     plan frame. opts: { lotRing (subject parcel — buildings touching it are
     DROPPED), center, clipRadiusIn, cap }. Deterministic: sorted nearest-first
     (centroid distance to center, then id) and capped. Returns
     [{id:'osmb<id>', poly:[{x,y}…], heightIn, name}]. */
  ROADS.parseBuildings = (json, projectRing, opts) => {
    opts = opts || {};
    const els = (json && json.elements) || [];
    const lotRing = (Array.isArray(opts.lotRing) && opts.lotRing.length >= 3) ? opts.lotRing : null;
    const center = opts.center || { x: 0, y: 0 };
    const clipR = opts.clipRadiusIn || 0;
    const cap = Math.max(1, opts.cap || ROADS.NEIGHBOR_CAP);
    const out = [];
    for (const el of els) {
      if (!el || el.type !== 'way') continue;
      const tags = el.tags || {};
      if (tags.building == null) continue;
      const geom = el.geometry;
      if (!Array.isArray(geom) || geom.length < 4) continue;   // closed ring needs ≥3 + dup
      const llRing = [];
      for (const g of geom) { if (g && isFinite(g.lon) && isFinite(g.lat)) llRing.push([g.lon, g.lat]); }
      // drop the OSM closing duplicate (first == last)
      if (llRing.length >= 2) {
        const a = llRing[0], b = llRing[llRing.length - 1];
        if (a[0] === b[0] && a[1] === b[1]) llRing.pop();
      }
      if (llRing.length < 3) continue;
      let planRing = [];
      try { planRing = projectRing(llRing) || []; } catch (e) { planRing = []; }
      const poly = [];
      for (const p of planRing) { if (p && isFinite(p.x) && isFinite(p.y)) poly.push({ x: p.x, y: p.y }); }
      if (poly.length < 3) continue;
      let cx = 0, cy = 0; for (const p of poly) { cx += p.x; cy += p.y; } cx /= poly.length; cy /= poly.length;
      // ON-LOT EXCLUSION: context never sits on the subject parcel — a building
      // whose centroid OR any footprint vertex lies inside the lot ring is dropped
      // (that's the subject's own existing structure territory, not context).
      if (lotRing) {
        let onLot = ROADS.pointInRing({ x: cx, y: cy }, lotRing);
        if (!onLot) for (const p of poly) { if (ROADS.pointInRing(p, lotRing)) { onLot = true; break; } }
        if (onLot) continue;
      }
      const dist = Math.hypot(cx - center.x, cy - center.y);
      if (clipR > 0 && dist > clipR) continue;
      out.push({ id: 'osmb' + el.id, name: tags.name || '', heightIn: ROADS.buildingHeightIn(tags), poly, _d: dist });
    }
    out.sort((a, b) => (a._d - b._d) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const capped = out.slice(0, cap);
    for (const b of capped) delete b._d;
    return capped;
  };

  /* a renderable 'neighbor' site feature: ghost-gray context massing the 3D view
     extrudes. noPick + existing — never selectable, never counted as scope. */
  ROADS.neighborFeature = (b) => ({
    id: b.id,
    type: 'neighbor', existing: true, source: 'osm', noPick: true,
    label: b.name || '',
    heightIn: b.heightIn,
    poly: b.poly.map((p) => ({ x: p.x, y: p.y })),
  });

  /* ASYNC: fetch neighbor building massings around the lot. Same fail-soft
     contract as fetchRoads ({ok:false, neighbors:[]} on any problem, never
     throws). Cached PER ADDRESS (geoXform signature + radius): a successful
     batch is reused on every later call for the same lot; failures are NOT
     cached so a flaky network can recover. */
  ROADS._neighborCache = Object.create(null);
  ROADS.fetchNeighbors = async (model, opts) => {
    opts = opts || {};
    const site = model && model.site;
    // effectiveXform: massings must land on the drape imagery's roofs, so they
    // project through the SAME healed transform satdrape drapes with (Jul 20)
    const xf = ROADS.effectiveXform(model);
    if (!xf || xf.lat == null || xf.lng == null ||
        !HA.parcel || typeof HA.parcel.planToGeo !== 'function' || typeof HA.parcel.projectWithXform !== 'function') {
      return { ok: false, reason: 'no-geoxform', neighbors: [] };
    }
    const radiusM = Math.max(60, Math.min(1200, opts.radiusM || ROADS.DEFAULT_RADIUS_M));
    const sig = ROADS.xfSig(xf);
    const cacheKey = sig + '|' + radiusM;
    if (!opts.force && ROADS._neighborCache[cacheKey]) return ROADS._neighborCache[cacheKey];

    const lot = (Array.isArray(site.lot) && site.lot.length >= 3) ? site.lot : null;
    let cx = 0, cy = 0;
    if (lot) { for (const p of lot) { cx += p.x; cy += p.y; } cx /= lot.length; cy /= lot.length; }
    const cg = HA.parcel.planToGeo({ x: cx, y: cy }, xf) || { lat: xf.lat, lng: xf.lng };
    const query = ROADS.buildingsQuery(cg.lat, cg.lng, radiusM);

    let json = null, reason = 'fetch-failed';
    if (typeof fetch !== 'function') return { ok: false, reason: 'no-fetch', neighbors: [] };
    for (const url of ROADS.ENDPOINTS) {
      try {
        let signal, timer = null;
        if (typeof AbortController !== 'undefined') {
          const ctrl = new AbortController();
          signal = ctrl.signal;
          timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, opts.timeoutMs || 22000);
        }
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal,
        });
        if (timer) clearTimeout(timer);
        if (resp && resp.ok) { json = await resp.json(); break; }
        reason = 'http-' + (resp ? resp.status : '0');
      } catch (e) { reason = 'fetch-error'; }
    }
    if (!json) return { ok: false, reason, neighbors: [] };

    const projectRing = (llRing) => {
      try { const r = HA.parcel.projectWithXform([llRing], xf); return (r && r[0]) ? r[0] : []; }
      catch (e) { return []; }
    };
    const clipRadiusIn = radiusM * FT_PER_M * 12 * 1.15;
    const parsed = ROADS.parseBuildings(json, projectRing,
      { lotRing: lot, center: { x: cx, y: cy }, clipRadiusIn, cap: ROADS.NEIGHBOR_CAP });
    const neighbors = parsed.map(ROADS.neighborFeature).filter((f) => Array.isArray(f.poly) && f.poly.length >= 3);
    if (sig) for (const f of neighbors) f.xfSig = sig;
    const res = { ok: true, neighbors, attribution: ROADS.ATTRIBUTION, center: cg, radiusM, raw: parsed.length };
    ROADS._neighborCache[cacheKey] = res;   // success only — failures retry
    return res;
  };

  HA.osmroads = ROADS;
})();
