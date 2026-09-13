/* ============================================================
   PlanCrafters — terrain.js  (HA.terrain)
   Roadmap #21: terrain mesh from parcel + elevation.

   PURE DATA module (no THREE). It samples a small N×N grid of
   ground elevations over the resolved lot, maps each grid point
   plan-inches → geo via HA.parcel.planToGeo, and asks the server
   (HA.parcel.elevation → /api/elevation) for the ground height at
   each point. It returns the grid in a form view3d can drape a
   mesh over, with a DATUM (the elevation under the building
   footprint) so the house sits ON grade (relative z = 0 there).

   HARD CONTRACT — opt-in + graceful no-op:
   - Nothing here runs unless the caller asks. The whole feature
     hangs off model.site.terrain.enabled (owned by the UI toggle).
   - sampleGrid NEVER throws to the caller. Missing lot / missing
     geoXform / network failure / all-null elevations all resolve
     to { ok:false } so the existing flat ground stays untouched.

   COORDINATE NOTES
   - Grid points are PLAN INCHES {x,y}, the same frame as
     model.site.lot and the building walls.
   - Elevations from /api/elevation are in FEET (null where the
     service has no data).
   - relativeZ() converts to INCHES relative to grade(=0) at the
     house: zIn = (elevFt - datumFt) * 12. view3d consumes zIn.

   ────────────────────────────────────────────────────────────
   DRAFT / PRELIMINARY. Ground elevations from a web service are
   approximate and are NOT a survey. Confirm spot grades and the
   true finished-floor / pad elevation against a stamped survey or
   civil grading plan before relying on any cut/fill or drainage
   conclusion drawn from this surface.
   ────────────────────────────────────────────────────────────
   ============================================================ */
(function () {
  'use strict';
  const HA = (window.HA = window.HA || {});

  const IN_PER_FT = 12;
  const DEFAULT_N = 7;          // 7×7 = 49 points ≤ the 64-point /api/elevation cap
  const PAD_FRAC = 0.08;        // pad the lot bbox a touch so the mesh runs past the lines

  /* The lot polygon in PLAN INCHES, or null. Mirrors how the rest of the app
     reads it (site.lot = array of {x,y}). Absence-safe. */
  const lotOf = (model) =>
    (model && model.site && Array.isArray(model.site.lot) && model.site.lot.length >= 3)
      ? model.site.lot : null;

  /* The captured geo transform, or null. The REAL storage path is
     model.site.geoXform (shape {lat,lng,scale,rot,pivot:{x,y},dx,dy}), the same
     object sheets.js / parcel.projectWithXform / parcel.planToGeo consume. */
  const xformOf = (model) =>
    (model && model.site && model.site.geoXform &&
      model.site.geoXform.lat != null && model.site.geoXform.lng != null)
      ? model.site.geoXform : null;

  /* axis-aligned bbox of an {x,y} polygon */
  const bboxOf = (pts) => {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of pts) {
      if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
    }
    return { minx, miny, maxx, maxy };
  };

  /* Centroid of the building footprint (exterior loop of level 0), in plan
     inches. Falls back to averaging the level-0 wall endpoints, then to the lot
     centroid, so it always returns a point when a lot exists. */
  const footprintCentroid = (model) => {
    let pts = null;
    if (typeof HA.exteriorLoop === 'function') {
      const loop = HA.exteriorLoop(model, 0);
      if (loop && Array.isArray(loop.pts) && loop.pts.length >= 3) pts = loop.pts;
    }
    if (!pts) {
      const lvl = model && model.levels && model.levels[0];
      const wpts = [];
      // R60d: carport overlay walls are NOT the house footprint — including
      // them shifted this centroid every time a side was added, which moved
      // the auto-datum sample point and made the whole terrain jump (Steve:
      // "clicking the walls shoots the terrain up", round 2).
      if (lvl) for (const w of (lvl.walls || [])) {
        if (w.carport) continue;
        if (w.x1 != null) wpts.push({ x: w.x1, y: w.y1 });
        if (w.x2 != null) wpts.push({ x: w.x2, y: w.y2 });
      }
      if (wpts.length) pts = wpts;
    }
    if (!pts) pts = lotOf(model);              // last resort: the lot itself
    if (!pts || !pts.length) return null;
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  };

  /* Build the N×N grid of PLAN-INCH points over the lot bbox (with a little
     padding). Row-major: index = r*cols + c. Returns { n, cols, pts:[{x,y}] }. */
  const buildGridPoints = (lot, n) => {
    n = Math.max(2, n | 0);
    const b = bboxOf(lot);
    const w = b.maxx - b.minx, h = b.maxy - b.miny;
    const padX = w * PAD_FRAC, padY = h * PAD_FRAC;
    const x0 = b.minx - padX, x1 = b.maxx + padX;
    const y0 = b.miny - padY, y1 = b.maxy + padY;
    const cols = n;
    const pts = [];
    for (let r = 0; r < n; r++) {
      const ty = n === 1 ? 0 : r / (n - 1);
      const y = y0 + (y1 - y0) * ty;
      for (let c = 0; c < cols; c++) {
        const tx = cols === 1 ? 0 : c / (cols - 1);
        const x = x0 + (x1 - x0) * tx;
        pts.push({ x, y });
      }
    }
    return { n, cols, pts };
  };

  /* Index of the grid point nearest a plan-inch target {x,y}. */
  const nearestIdx = (gridPts, target) => {
    if (!target) return -1;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < gridPts.length; i++) {
      const dx = gridPts[i].x - target.x, dy = gridPts[i].y - target.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  /* ---------- sampleGrid (async, never throws to the caller) ----------
     opts: { n } (grid size, default 7). Returns
       { n, cols, grid:[{x,y,elevFt}], datumFt, ok:true }
     on success, where datumFt is the elevation sampled NEAREST the building
     footprint centroid (so the house sits ON grade). Returns { ok:false } when
     the lot or geoXform is absent, the elevation service is unavailable, or no
     usable (non-null) elevation comes back — in EVERY failure path. */
  const sampleGrid = async (model, opts) => {
    opts = opts || {};
    try {
      const lot = lotOf(model);
      const xf = xformOf(model);
      if (!lot || !xf) return { ok: false };
      if (!HA.parcel || typeof HA.parcel.planToGeo !== 'function' ||
          typeof HA.parcel.elevation !== 'function') return { ok: false };

      const n = opts.n ? (opts.n | 0) : DEFAULT_N;
      const { cols, pts } = buildGridPoints(lot, n);

      // plan inch -> geo for every grid point (skip any that fail to project)
      const geoPts = [];
      for (const p of pts) {
        const g = HA.parcel.planToGeo(p, xf);
        geoPts.push(g && g.lat != null && g.lng != null ? { lat: g.lat, lng: g.lng } : null);
      }
      const queryable = geoPts.filter(Boolean);
      if (!queryable.length) return { ok: false };

      // ONE elevation call for the whole grid (≤49 pts, under the 64 cap)
      const resp = await HA.parcel.elevation(queryable);
      const results = (resp && Array.isArray(resp.results)) ? resp.results : null;
      if (!results) return { ok: false };

      // map results back onto the grid in order (queryable preserved order). Any
      // grid point we couldn't project, or whose result is null/non-finite, gets
      // elevFt = null and is treated as a hole (mesh interpolates around it).
      let ri = 0, anyValid = false;
      const grid = [];
      for (let i = 0; i < pts.length; i++) {
        let elevFt = null;
        if (geoPts[i]) {
          const res = results[ri++];
          const e = res && res.elevation;
          if (e != null && isFinite(e)) { elevFt = +e; anyValid = true; }
        }
        grid.push({ x: pts[i].x, y: pts[i].y, elevFt });
      }
      if (!anyValid) return { ok: false };

      // DATUM = elevation AT the footprint centroid by the SAME bilinear read that
      // heightAtInches uses, so grade(=0) is truly at the house. The old "nearest
      // grid node" datum disagreed with the bilinear surface by up to half a cell's
      // relief on a slope — grass poked through floors uphill / foundation gapped
      // downhill even at the house center (AUDIT #20). Falls back to the mean of
      // the valid samples if the bilinear read lands on holes.
      const cen = footprintCentroid(model);
      let datumFt = null;
      if (cen && cols >= 2 && n >= 2) {
        let sum = 0, cnt = 0;
        for (const g of grid) if (g.elevFt != null) { sum += g.elevFt; cnt++; }
        const fill = cnt ? sum / cnt : null;
        if (fill != null) {
          const x0 = grid[0].x, x1 = grid[cols - 1].x;
          const y0 = grid[0].y, y1 = grid[(n - 1) * cols].y;
          const eAt = (r, c) => { const g = grid[r * cols + c]; return (g && g.elevFt != null) ? g.elevFt : fill; };
          const fx = (x1 === x0) ? 0 : ((cen.x - x0) / (x1 - x0)) * (cols - 1);
          const fy = (y1 === y0) ? 0 : ((cen.y - y0) / (y1 - y0)) * (n - 1);
          const gx = Math.max(0, Math.min(cols - 1, fx)), gy = Math.max(0, Math.min(n - 1, fy));
          const c0 = Math.floor(gx), c1 = Math.min(cols - 1, c0 + 1), tx = gx - c0;
          const r0 = Math.floor(gy), r1 = Math.min(n - 1, r0 + 1), ty = gy - r0;
          const etop = eAt(r0, c0) + (eAt(r0, c1) - eAt(r0, c0)) * tx;
          const ebot = eAt(r1, c0) + (eAt(r1, c1) - eAt(r1, c0)) * tx;
          datumFt = etop + (ebot - etop) * ty;
        }
      }
      if (datumFt == null) {
        const ci = nearestIdx(pts, cen);
        if (ci >= 0 && grid[ci] && grid[ci].elevFt != null) datumFt = grid[ci].elevFt;
      }
      if (datumFt == null) {
        let sum = 0, cnt = 0;
        for (const g of grid) if (g.elevFt != null) { sum += g.elevFt; cnt++; }
        if (cnt) datumFt = sum / cnt;
      }
      if (datumFt == null) return { ok: false };

      return { n, cols, grid, datumFt, ok: true };
    } catch (e) {
      // network error, malformed payload, anything — fail soft, NEVER throw.
      return { ok: false };
    }
  };

  /* ---------- relativeZ ----------
     Annotate each grid point with zIn = (elevFt - datumFt) * 12 (inches),
     relative to grade(=0) at the house datum. Holes (elevFt == null) get
     zIn = null. Returns a NEW grid array (does not mutate the input); the input
     `sample` is the { grid, datumFt, ... } object sampleGrid returned. */
  const relativeZ = (sample) => {
    if (!sample || !sample.ok || !Array.isArray(sample.grid)) return [];
    const datum = sample.datumFt || 0;
    return sample.grid.map((g) => ({
      x: g.x, y: g.y, elevFt: g.elevFt,
      zIn: g.elevFt == null ? null : (g.elevFt - datum) * IN_PER_FT,
    }));
  };

  /* ---------- caching ----------
     A cheap signature of the lot + xform so we only re-sample when the parcel
     actually changes. Cached on model.site._terrainCache (transient; never
     serialized into the saved plan — deserialize doesn't preserve it because
     it's an underscore-prefixed runtime field the UI owns). */
  const cacheKey = (model) => {
    const lot = lotOf(model), xf = xformOf(model);
    if (!lot || !xf) return null;
    // round lot coords (inches) so sub-inch jitter doesn't bust the cache
    const lp = lot.map((p) => Math.round(p.x) + ',' + Math.round(p.y)).join(';');
    const xp = [xf.lat, xf.lng, xf.scale, xf.rot, xf.dx, xf.dy,
      xf.pivot && xf.pivot.x, xf.pivot && xf.pivot.y].join('|');
    return lp + '#' + xp;
  };

  /* Read a fresh cached sample for the current parcel, or null. Checks the
     transient runtime cache first, then the PERSISTED copy (model.site.terrain.
     cache) — the persisted one survives serialize/reload, so the 3D terrain
     reappears instantly after a page refresh instead of re-fetching every time
     (Steve: "cache the terrain … so it stays there in place"). */
  const cached = (model) => {
    const key = cacheKey(model);
    if (!key) return null;
    const site = model && model.site;
    const c = site && site._terrainCache;
    if (c && c.key === key && c.sample && c.sample.ok) return c.sample;
    const p = site && site.terrain && site.terrain.cache;
    if (p && p.key === key && p.sample && p.sample.ok) {
      // promote the persisted sample into the runtime slot so later reads are O(1)
      site._terrainCache = { key, sample: p.sample };
      return p.sample;
    }
    return null;
  };

  /* ---------- R32 SAMPLE SCOPE — the per-sample resolve tax ----------
     cached() calls cacheKey(), and cacheKey() re-stringifies the ENTIRE lot ring
     (lot.map(p => round(x)+','+round(y)).join(';')) on EVERY sample. naturalHeight
     calls cached() once per sample, and a terrain-ON 272-lot rebuild takes ~1M
     samples: cacheKey + cached profiled at 23.2% of the post-bbox-reject entry
     rebuild. Same for the pond list, which rescans all ~722 site.features per
     sample just to find the (usually zero) ponds.

     A SCOPE is an explicitly-opened, STRICTLY SYNCHRONOUS window during which the
     caller guarantees the model is not mutated — the terrain mesh build is exactly
     that. Inside it the sample and the pond list resolve ONCE. Outside it every
     read falls through to the original per-call path, so nothing else in the app
     changes behaviour and there is no invalidation story to get wrong. Never open
     a scope across a chunked drain, a rAF, or an await: features CAN change there,
     and a stale scope would be a correctness bug, not a perf one. */
  let _scopeDepth = 0, _scopeModel = null, _scopeSample = null, _scopeLists = null;
  const beginSampleScope = (model) => {
    _scopeDepth++;
    if (_scopeDepth !== 1) return;                 // re-entrant: the outer scope owns it
    _scopeModel = model || null;
    _scopeSample = null; _scopeLists = null;
    if (!_scopeModel) return;
    try { _scopeSample = cached(_scopeModel); } catch (e) { _scopeSample = null; }
    try {
      const site = _scopeModel.site;
      const fs = (site && Array.isArray(site.features)) ? site.features : [];
      /* ONE pass builds every derived list the per-sample folds used to rescan
         site.features for. On a 650-lot development that array is ~722 entries
         and the folds walked it 5.24M times: pondDropAt, drivewayFeature,
         walkwayFeature and padFootTargetAt each did their own full scan per
         sample. Profiled AFTER the bbox reject, those four were 19.3% + 16.7% +
         16.4% + 12.4% = 64.8% of the remaining 65.9s. */
      const ponds = [], padFeet = [];
      let drive = null, walk = null;
      for (const f of fs) {
        if (!f) continue;
        if (f.type === 'pool' && f.pond && Array.isArray(f.poly) && f.poly.length >= 3) ponds.push(f);
        if (!drive && f.garageDrive && Array.isArray(f.centerline) && f.centerline.length >= 2) drive = f;
        if (!walk && f.walkwayFollow && Array.isArray(f.centerline) && f.centerline.length >= 2) walk = f;
        if (f.padFoot && Array.isArray(f.poly) && f.poly.length >= 3
          && (f.padAnchor || Number.isFinite(f.padZ))) padFeet.push(f);
      }
      _scopeLists = { ponds, drive, walk, padFeet };
    } catch (e) { _scopeLists = null; }
  };
  const endSampleScope = () => {
    if (--_scopeDepth > 0) return;
    _scopeDepth = 0; _scopeModel = null; _scopeSample = null; _scopeLists = null;
  };
  const inScope = (model) => (_scopeDepth > 0 && model && model === _scopeModel && _scopeLists) ? _scopeLists : null;
  const scopedSample = (model) =>
    (_scopeDepth > 0 && model && model === _scopeModel) ? _scopeSample : cached(model);

  /* relativeZ + the hole-fill mean are PURE functions of the sample object, and a
     sample is never mutated in place — sampleGrid builds a fresh one and flatten()
     deletes the slot outright — so memoising per sample is sound for the object's
     whole lifetime. naturalHeight rebuilt a fresh 49-object array AND re-summed it
     on every single sample; that profiled at 28.5% of the post-bbox-reject rebuild.
     A WeakMap (not a field on the sample) because the sample IS serialized into
     site.terrain.cache and must not grow a derived payload. */
  const _gridMemo = new WeakMap();
  const gridOf = (sample) => {
    if (!sample || typeof sample !== 'object') return null;
    let e = _gridMemo.get(sample);
    if (e) return e;
    const pts = relativeZ(sample);
    let sum = 0, cnt = 0;
    for (const p of pts) if (p.zIn != null && isFinite(p.zIn)) { sum += p.zIn; cnt++; }
    e = { pts, fill: cnt ? sum / cnt : null };
    _gridMemo.set(sample, e);
    return e;
  };

  /* ---------- ensure (async) ----------
     The UI toggle / re-sample entry point. Samples the grid (if not already
     cached for this parcel), stashes it on model.site._terrainCache, and asks
     for a 3D rebuild so _buildTerrain can pick it up. view3d stays synchronous —
     it only ever READS the cache. Returns the sample ({ok:true|false}) so the
     caller can show status. NEVER throws. */
  const ensure = async (model) => {
    try {
      if (!model || !model.site) return { ok: false };
      const key = cacheKey(model);
      if (!key) { return { ok: false }; }      // no lot/xf → nothing to sample
      const existing = cached(model);
      if (existing) { requestRebuild(); return existing; }
      // mark LOADING so the 3D view shows a translucent 'magic-box' placeholder at
      // the lot while the elevation sampling round-trips (~seconds); rebuild NOW so
      // it appears immediately, then clear + rebuild again when the sample lands so
      // the real terrain POOFs in. Runtime-only (HA.serialize strips _ keys). (#4d)
      // P0 loading policy overrides the legacy placeholder note above: current/flat
      // ground remains rendered until the replacement terrain is ready.
      model.site._terrainLoading = true;
      requestRebuild();
      const sample = await sampleGrid(model);
      delete model.site._terrainLoading;
      // only cache a successful sample; a failed one stays uncached so a later
      // retry (e.g. after the address resolves) re-attempts the fetch.
      // Partial samples are valid: null slots retain the 7x7 topology and are
      // interpolated from the usable readings by the terrain consumers.
      if (sample && sample.ok) {
        model.site._terrainCache = { key, sample };
        // ALSO persist on the terrain object so it survives serialize/reload
        // (HA.serialize strips only the runtime _terrainCache; site.terrain.cache
        // is kept + carried through migrate). Guarded: never CREATE site.terrain.
        if (model.site.terrain && typeof model.site.terrain === 'object')
          model.site.terrain.cache = { key, sample };
      }
      requestRebuild();
      return sample || { ok: false };
    } catch (e) {
      if (model && model.site) delete model.site._terrainLoading;
      return { ok: false };
    }
  };

  /* Nudge the app to rebuild the 3D scene (so terrain appears/updates). Guarded
     so it's a no-op headlessly (no HA.app) and never throws. */
  const requestRebuild = () => {
    try {
      const app = HA.app;
      if (app && typeof app.sync === 'function') app.sync(false);
    } catch (e) { /* headless / pre-app — fine */ }
  };

  /* Drop any cached sample (e.g. when the parcel is cleared, terrain turned off,
     or a manual ↻ refresh) — both the runtime and the persisted copy. */
  const clearCache = (model) => {
    if (!model || !model.site) return;
    if (model.site._terrainCache) delete model.site._terrainCache;
    if (model.site._benchCache) delete model.site._benchCache;
    if (model.site.terrain && model.site.terrain.cache) delete model.site.terrain.cache;
  };

  /* ---- heightAtInches(model, x, y) ----
     The terrain SURFACE height in INCHES, relative to the grade datum (= 0 at the
     house), at an arbitrary plan point — bilinear interpolation of the cached grid.
     Returns 0 when the terrain is FLATTENED, and null when there's no usable
     terrain (caller keeps flat grade). Lets grade-mounted things (the exterior
     condenser, etc.) SIT ON the terrain and ride the puller offset, so they stay
     consistent with everything else on the ground. */
  const naturalHeight = (model, x, y) => {
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return null;
    if (site.terrain.flat) return 0;
    const sample = scopedSample(model);            // R32: resolved once inside a sample scope
    if (!sample || !sample.ok) return null;
    const g = gridOf(sample);                      // R32: relativeZ + hole-fill mean memoised per sample
    const pts = g && g.pts;
    const n = sample.n, cols = sample.cols;
    if (!pts || pts.length !== n * cols || n < 2 || cols < 2) return null;
    const x0 = pts[0].x, x1 = pts[cols - 1].x;
    const y0 = pts[0].y, y1 = pts[(n - 1) * cols].y;
    const fill = g.fill;
    if (fill == null) return null;                 // no finite grid point anywhere
    const zAt = (r, c) => { const p = pts[r * cols + c]; return (p && p.zIn != null && isFinite(p.zIn)) ? p.zIn : fill; };
    const fx = (x1 === x0) ? 0 : ((x - x0) / (x1 - x0)) * (cols - 1);
    const fy = (y1 === y0) ? 0 : ((y - y0) / (y1 - y0)) * (n - 1);
    const gx = Math.max(0, Math.min(cols - 1, fx)), gy = Math.max(0, Math.min(n - 1, fy));
    const c0 = Math.floor(gx), c1 = Math.min(cols - 1, c0 + 1), tx = gx - c0;
    const r0 = Math.floor(gy), r1 = Math.min(n - 1, r0 + 1), ty = gy - r0;
    const ztop = zAt(r0, c0) + (zAt(r0, c1) - zAt(r0, c0)) * tx;
    const zbot = zAt(r1, c0) + (zAt(r1, c1) - zAt(r1, c0)) * tx;
    return ztop + (zbot - ztop) * ty;
  };

  /* ---- GARAGE PAD (garage-site-spec D) ----
     The terrain is GRADED UNDER THE GARAGE to the garage-slab elevation so the
     driveway apron butts the garage door perfectly. The garage slab sits floorDrop
     below the house finish floor (FF, world-y 0), and grade(=0 here) sits at
     -stemHeight, so the pad's SURFACE height in this grade-relative frame is
       padZ = stemHeight - floorDrop
     (e.g. an 8" drop on an 8" stem grades the pad to 0 = right at natural grade;
     an 18" drop on an 18" raised stem also lands the pad at grade). The pad
     spans the garage rect + a short GRADE_RAMP collar that blends pad→natural so
     the surrounding lot slopes into it (no vertical wall of dirt). Returns the
     TARGET pad height (inches, grade-relative) at (x,y) when the garage pad wants
     to LOWER the ground there, else null. Pure; derives entirely from the LIVE
     garage geometry (HA.garageInfo re-derives on a moved house). */
  const GARAGE_PAD_RAMP = 48;               // 4' graded collar around the pad
  const padTargetAt = (model, x, y) => {
    // pad ONLY grades when terrain is live (spec D "when terrain enabled"); a flat
    // lot with terrain OFF keeps its legacy behavior (no phantom recess, byte-
    // identical renders). site.terrain.flat still grades (the user flattened but
    // kept terrain on — the garage still steps into that flat pad).
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return null;
    // require a REAL terrain surface here (flat → 0, or a live sample) — an enabled
    // but unsampled terrain keeps the legacy flat-grade null so we never inject a
    // pad before the elevation grid lands.
    if (naturalHeight(model, x, y) == null) return null;
    if (!HA.garageInfo) return null;
    const gi = HA.garageInfo(model);
    if (!gi || !gi.rect) return null;
    const fd = model.foundation || {};
    const stem = fd.stemHeight || 8;
    const padZ = stem - gi.floorDrop;       // grade-relative surface under the slab
    const r = gi.rect;
    // signed distance INTO the rect (>=0 inside, negative = outside by that much)
    const dx = Math.min(x - r.x0, r.x1 - x);
    const dy = Math.min(y - r.y0, r.y1 - y);
    const d = Math.min(dx, dy);             // >=0 inside the rect
    if (d >= 0) return padZ;                 // full pad under the garage
    const out = -d;                          // how far outside
    if (out >= GARAGE_PAD_RAMP) return null; // beyond the collar → natural grade
    return { padZ, t: out / GARAGE_PAD_RAMP }; // blend fraction 0(edge)→1(collar toe)
  };

  /* ---- DRIVEWAY GRADE-FOLLOW (Steve redline Jul 5) ----
     The terrain follows the garage-route driveway's code-pitched elevation PROFILE:
     it COMES UP (fill shoulder) where the drive sits above natural grade, and CUTS
     IN where the drive sits below — so the driveway butts the garage slab lip flush
     (1" below) instead of leaving a ~12" step. The profile (SF.drivewayProfile) is
     surface-Y door→road; here we convert to the grade-relative frame heightAtInches
     uses (targetH = profileWorldY + stemHeight, matching padTargetAt's convention:
     the terrain-group offset carries the rest) and blend natural→drive over a
     DRIVEWAY_BLEND collar beside the centerline. Returns the target grade-relative
     height at (x,y) when the driveway corridor covers it, else null. PURE +
     re-derives (reads the LIVE feature + garageInfo → follows a moved house). */
  const DRIVEWAY_BLEND = 36;                 // 3' graded shoulder beside the drive
  const drivewayFeature = (model) => {
    const sc = inScope(model);                      // R32: resolved once per sample scope
    if (sc) return sc.drive;
    const site = model && model.site;
    const feats = (site && Array.isArray(site.features)) ? site.features : null;
    if (!feats) return null;
    // the generated garage-route drive (there is at most one _gen garage drive)
    return feats.find((f) => f && f.garageDrive && Array.isArray(f.centerline) && f.centerline.length >= 2) || null;
  };
  const drivewayTargetAt = (model, x, y) => {
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return null;
    if (naturalHeight(model, x, y) == null) return null;        // no real surface → no follow
    if (!HA.sitefeatures || !HA.sitefeatures.drivewayProfile) return null;
    const f = drivewayFeature(model);
    if (!f) return null;
    const cl = f.centerline;
    // distance from (x,y) to the nearest centerline segment
    let dMin = Infinity;
    for (let i = 1; i < cl.length; i++) {
      const a = cl[i - 1], b = cl[i];
      const abx = b.x - a.x, aby = b.y - a.y, L2 = abx * abx + aby * aby || 1;
      let u = ((x - a.x) * abx + (y - a.y) * aby) / L2; u = Math.max(0, Math.min(1, u));
      const px = a.x + abx * u, py = a.y + aby * u;
      const dd = Math.hypot(x - px, y - py);
      if (dd < dMin) dMin = dd;
    }
    const half = (f.widthIn || 108) / 2;
    if (dMin > half + DRIVEWAY_BLEND) return null;               // beyond the shoulder toe
    const fd = model.foundation || {};
    const stem = fd.stemHeight || 8;
    // natural-grade world-Y sampler in the terrain frame (matches padTargetAt: no
    // offsetIn — the terrain group carries it). Drive the profile's road end from it.
    const natWorldAt = (px, py) => {
      const h = naturalHeight(model, px, py);
      return (h != null && isFinite(h)) ? h - stem : null;
    };
    const prof = HA.sitefeatures.drivewayProfile(model, f, natWorldAt);
    if (!prof) return null;
    // grade-relative target under the drive = profile surface world-Y + stem
    const targetH = prof.yAt(x, y) + stem;
    if (dMin <= half) return targetH;                            // on the drive → full follow
    const t = (dMin - half) / DRIVEWAY_BLEND;                    // 0(edge)..1(toe)
    return { targetH, t };                                       // blend natural↔drive
  };

  /* ---- WALKWAY GRADE-FOLLOW (Steve Jul 5) ----
     The terrain follows a FRONT WALKWAY's smoothed grade profile the same way it
     follows the driveway: FILL where the walk sits above natural grade, CUT where
     below, blended over a narrow collar so a straight, clean walk sits flush on the
     ground (Steve: "work kind of like driveway, inset the walkway or do it on top if
     its flat"). Reuses SF.walkwayProfile (linear house→street grade, clamped).
     Returns the grade-relative target height at (x,y) when the walk covers it, else
     null. Narrower collar than the drive (a walk has no wide graded shoulder). */
  const WALKWAY_BLEND = 24;   // 2' graded shoulder beside the walk
  const walkwayFeature = (model) => {
    const sc = inScope(model);                      // R32: resolved once per sample scope
    if (sc) return sc.walk;
    const site = model && model.site;
    const feats = (site && Array.isArray(site.features)) ? site.features : null;
    if (!feats) return null;
    return feats.find((f) => f && f.walkwayFollow && Array.isArray(f.centerline) && f.centerline.length >= 2) || null;
  };
  const walkwayTargetAt = (model, x, y) => {
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return null;
    if (naturalHeight(model, x, y) == null) return null;
    if (!HA.sitefeatures || !HA.sitefeatures.walkwayProfile) return null;
    const f = walkwayFeature(model);
    if (!f) return null;
    const cl = f.centerline;
    let dMin = Infinity;
    for (let i = 1; i < cl.length; i++) {
      const a = cl[i - 1], b = cl[i], abx = b.x - a.x, aby = b.y - a.y, L2 = abx * abx + aby * aby || 1;
      let u = ((x - a.x) * abx + (y - a.y) * aby) / L2; u = Math.max(0, Math.min(1, u));
      const px = a.x + abx * u, py = a.y + aby * u, dd = Math.hypot(x - px, y - py);
      if (dd < dMin) dMin = dd;
    }
    const half = (f.widthIn || 44) / 2;
    if (dMin > half + WALKWAY_BLEND) return null;
    const fd = model.foundation || {};
    const stem = fd.stemHeight || 8;
    const natWorldAt = (px, py) => { const h = naturalHeight(model, px, py); return (h != null && isFinite(h)) ? h - stem : null; };
    const prof = HA.sitefeatures.walkwayProfile(model, f, natWorldAt);
    if (!prof) return null;
    const targetH = prof.yAt(x, y) + stem;
    if (dMin <= half) return targetH;
    const t = (dMin - half) / WALKWAY_BLEND;
    return { targetH, t };
  };

  /* ---- DEVELOPMENT GRADING FOLLOW (Developer Mode, Steve round 2: "road is
     messed up on Winton... it's like it's on the terrain or something, goes
     up — need to grade it in perfectly how a developer would") ----
     The generated court/approaches are a DESIGN SURFACE, not draped dirt:
     devplan.apply resolves site.dev.grading = { plane (anchored at the street
     approach, slopes clamped to the fire-access cap), courts:[{poly,bbox}],
     pads:[{poly,bbox,z}] (LEVEL lot pads at court+6") }. The terrain CONFORMS:
     court zones cut/fill to the plane (tucked 1" under the pavement like every
     hardscape), pads flatten level, both blending back over a 36" collar.
     Returns { targetH, t (0 inside → 1 at collar edge), tuck } | null. */
  const devPtInPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
  };
  const devTargetAt = (model, x, y) => {
    const site = model && model.site;
    const g = site && site.dev && site.dev.grading;
    if (!g || !site.terrain || !site.terrain.enabled) return null;
    if (naturalHeight(model, x, y) == null) return null;
    const BLEND = g.blendIn || 36;
    const planeZ = (px, py) => {
      const P = g.plane;
      if (!P) return null;
      const du = (px - P.anchor.x) * P.eu.x + (py - P.anchor.y) * P.eu.y;
      const dv = (px - P.anchor.x) * P.ev.x + (py - P.anchor.y) * P.ev.y;
      return P.z0 + P.su * du + P.sv * dv;
    };
    let best = null;
    const consider = (targetH, t, tuck) => {
      if (targetH == null || !isFinite(targetH)) return;
      if (!best || t < best.t) best = { targetH, t, tuck };
    };
    const scan = (zones, zOf, tuck) => {
      for (const zn of (zones || [])) {
        const b = zn.bbox, poly = zn.poly;
        if (!poly || poly.length < 3) continue;
        if (b && (x < b[0] - BLEND || x > b[2] + BLEND || y < b[1] - BLEND || y > b[3] + BLEND)) continue;
        const tH = zOf(zn);
        if (tH == null) continue;
        if (devPtInPoly(x, y, poly)) { consider(tH, 0, tuck); continue; }
        let dMin = Infinity;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], c = poly[(i + 1) % poly.length];
          const abx = c.x - a.x, aby = c.y - a.y, L2 = abx * abx + aby * aby || 1;
          let u = ((x - a.x) * abx + (y - a.y) * aby) / L2; u = Math.max(0, Math.min(1, u));
          const dd = Math.hypot(x - (a.x + abx * u), y - (a.y + aby * u));
          if (dd < dMin) dMin = dd;
        }
        if (dMin <= BLEND) consider(tH, dMin / BLEND, tuck);
      }
    };
    scan(g.courts, () => planeZ(x, y), true);      // court pavement: plane, tucked
    scan(g.pads, (zn) => zn.z, false);             // lot pads: level dirt benches
    return best;
  };

  /* ---- STAIR-FOOT PAD FOLLOW (Steve round 6: "the landing tucks into the
     terrain at bottom of stair") ----
     The poured stair-foot pad (feature.padFoot, stair-width × 36") is a LEVEL slab
     at the flight walk-off elevation; the terrain CONFORMS to it — flattens to the
     pad grade over its footprint and blends back to natural over a 24" collar — so
     the pad sits ON grade with its edges met, never buried under a grass wedge.
     The pad grade re-derives from padAnchor (the flight-foot point) each call, so a
     moved house / re-datumed terrain stays correct. Returns the grade-relative
     target inside the pad, a {targetH,t} blend on the collar, else null.

     R64 — two OPTIONAL per-feature fields (both absent on the stair-foot pads
     that authored this fold, so their behaviour is untouched):
       f.padZ    explicit grade-relative target height. Used INSTEAD of
                 naturalHeight(padAnchor). The anchor is a *proxy* for the pad
                 grade — fine for a 36" stair landing, wrong for a 24' carport
                 pad on a hill, where the anchor sits uphill of the slab's own
                 low corner and the flatten target lands ABOVE the slab lip
                 (measured: breach at >=21% grade). A pad that already knows
                 its underside elevation states it directly.
       f.blendIn collar width. 24" is right for a landing; a deep cut needs a
                 real graded bank, not a 2' cliff. */
  const PADFOOT_BLEND = 24;
  const padFootTargetAt = (model, x, y) => {
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return null;
    if (naturalHeight(model, x, y) == null) return null;
    const scPF = inScope(model);                    // R32: pre-filtered once per sample scope
    const feats = scPF ? scPF.padFeet : (Array.isArray(site.features) ? site.features : null);
    if (!feats || !feats.length) return null;
    const UU = HA.U;
    if (!UU || !UU.pointInPoly || !UU.distToSeg) return null;
    /* R64 — LOWEST TARGET WINS, and a pad you are INSIDE always beats a collar.
       This used to return on the first feature within range, so where two pads
       overlapped the winner was whichever happened to sit earlier in
       site.features — and Generate / a front-yard re-derive re-appends the
       stair-foot landing and silently flips it. A carport pad shadowed by a
       stair pad is a carport slab with no cut under it (measured: 10" of dirt
       through the concrete). Taking the LOWER of the two is both deterministic
       and the safe direction: a pad is never buried by its neighbour. */
    let inZ = null, colZ = null, colT = 0;
    for (const f of feats) {
      if (!f || !f.padFoot || !Array.isArray(f.poly) || f.poly.length < 3) continue;
      if (!f.padAnchor && !Number.isFinite(f.padZ)) continue;
      const blend = (Number.isFinite(f.blendIn) && f.blendIn > 0) ? f.blendIn : PADFOOT_BLEND;
      // bbox reject BEFORE pointInPoly/distToSeg — this fold is the only one that
      // walks an unbounded feature list with no spatial reject, and a graded bank
      // can now be 12' wide, so the band it has to consider grew with it.
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const q of f.poly) {
        if (q.x < bx0) bx0 = q.x; if (q.x > bx1) bx1 = q.x;
        if (q.y < by0) by0 = q.y; if (q.y > by1) by1 = q.y;
      }
      if (x < bx0 - blend || x > bx1 + blend || y < by0 - blend || y > by1 + blend) continue;
      let dMin;
      if (UU.pointInPoly({ x, y }, f.poly)) dMin = 0;
      else {
        dMin = Infinity;
        for (let i = 0; i < f.poly.length; i++) {
          const d2 = UU.distToSeg({ x, y }, f.poly[i], f.poly[(i + 1) % f.poly.length]);
          if (d2 < dMin) dMin = d2;
        }
      }
      if (dMin > blend) continue;
      // explicit target when the pad knows its own underside; else the legacy
      // stair-foot proxy — the natural grade at the flight-foot point.
      const hz = Number.isFinite(f.padZ) ? f.padZ
        : naturalHeight(model, f.padAnchor.x, f.padAnchor.y);
      if (hz == null || !isFinite(hz)) continue;
      if (dMin <= 0) { if (inZ == null || hz < inZ) inZ = hz; continue; }
      if (colZ == null || hz < colZ) { colZ = hz; colT = dMin / blend; }
    }
    if (inZ != null) return inZ;
    if (colZ != null) return { targetH: colZ, t: colT };
    return null;
  };

  /* Public: how far (inches, >=0) the garage pad drops the ground BELOW natural
     grade at (x,y) — 0 outside the pad/collar or when no garage. Used by the
     3D pad renderer + tests. */
  const padDropAt = (model, x, y) => {
    const t = padTargetAt(model, x, y);
    if (t == null) return 0;
    const nat = naturalHeight(model, x, y);
    const natZ = (nat != null && isFinite(nat)) ? nat : 0;
    const padZ = (typeof t === 'number') ? t : t.padZ;
    const target = (typeof t === 'number') ? padZ : (padZ * (1 - t.t) + natZ * t.t);
    return Math.max(0, natZ - target);
  };

  /* ============================================================
     BACKYARD BENCH — HILLS/DECKS/BACKYARD A2 (Steve, Jul 5)
     ------------------------------------------------------------
     "if the hill is steep its fine to make the background flat and level out
      the back with terrain wall in rear of house — terrain wall system for
      back yards … the distance from the house and it flattens the backyard so
      we can terrain nicely there and add furniture and stuff."

     From the REAR house wall out to backyardBench.depthIn (default 240" = 20'),
     the terrain FLATTENS to the house PAD grade (grade-relative 0 — the finish-
     floor datum family, same reference heightAtInches already uses) so the yard
     is workable. It terminates in a RETAINING WALL: a sharp, near-vertical drop
     (uphill: a cut face; downhill: a fill edge) over a short BLEND_WALL band at
     the bench toe, then resumes natural grade beyond. Same fold pattern as the
     garage padTargetAt (rev 557): benchTargetAt returns the target surface, and
     heightAtInches blends natural→target with a sharp wall at the bench line.

     PURE: derives entirely from the live rear wall + lot. Opt-in: only when
     site.terrain.backyardBench.enabled (the generator auto-enables on steep
     lots; the user can toggle). Never raises unless FILLING a downhill yard —
     the bench both CUTS an uphill slope down to pad AND FILLS a downhill slope
     up to pad, which is the whole point of leveling.
     ============================================================ */
  const BENCH_WALL_BAND = 12;         // the retaining-wall face blends over 12" (near-vertical)
  const DEFAULT_BENCH_DEPTH = 240;    // 20' of level yard behind the house by default

  /* Resolve the rear house wall as { mid, n(outward, unit), along(unit), lo, hi,
     depthIn }, or null. Rear = the exterior L0 wall whose outward normal points
     MOST opposite the front (street) direction — the same pick the auto-backyard
     uses. `along`/lo/hi bound the wall span so the bench only covers the yard
     directly behind the house (not the whole lot width). Cached per loop hash so
     repeated heightAtInches reads during a 3D rebuild stay cheap. */
  const benchGeom = (model) => {
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return null;
    const bb = site.terrain.backyardBench;
    if (!bb || bb.enabled !== true) return null;
    const lvl = model.levels && model.levels[0];
    if (!lvl || !Array.isArray(lvl.walls) || !HA.isExt || !HA.wallA) return null;
    let loop = null;
    if (typeof HA.exteriorLoop === 'function') { const l = HA.exteriorLoop(model, 0); if (l && l.pts && l.pts.length >= 3) loop = l.pts; }
    if (!loop) return null;
    // signature so we recompute only when the footprint / depth changes
    const sig = loop.map((p) => Math.round(p.x) + ',' + Math.round(p.y)).join(';') + '#' + (bb.depthIn || DEFAULT_BENCH_DEPTH);
    const c = site._benchCache;
    if (c && c.sig === sig) return c.geom;
    const inPoly = (x, y) => {
      let inside = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const xi = loop[i].x, yi = loop[i].y, xj = loop[j].x, yj = loop[j].y;
        if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
      }
      return inside;
    };
    const fe = (HA.siteplus && HA.siteplus.resolveFrontEdge) ? HA.siteplus.resolveFrontEdge(model) : null;
    const frontN = (fe && fe.outN) ? (() => { const L = Math.hypot(fe.outN.x, fe.outN.y) || 1; return { x: fe.outN.x / L, y: fe.outN.y / L }; })() : { x: 0, y: -1 };
    let rear = null, bestDot = Infinity, bestLen = 0;
    for (const w of lvl.walls) {
      if (!HA.isExt(w) || w.carport) continue;   // R60d: never bench off a carport wall
      const a = HA.wallA(w), b = HA.wallB(w), len = HA.wallLen ? HA.wallLen(w) : Math.hypot(b.x - a.x, b.y - a.y);
      if (!(len > 0)) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      if (inPoly(mid.x + nx * 6, mid.y + ny * 6)) { nx = -nx; ny = -ny; }   // point OUTWARD
      const d = nx * frontN.x + ny * frontN.y;
      if (d < bestDot - 1e-6 || (Math.abs(d - bestDot) < 1e-6 && len > bestLen)) {
        bestDot = d; bestLen = len;
        rear = { mid, n: { x: nx, y: ny }, along: { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, len };
      }
    }
    let geom = null;
    if (rear && bestDot < -0.3) {
      geom = { mid: rear.mid, n: rear.n, along: rear.along, lo: -rear.len / 2, hi: rear.len / 2,
        depthIn: Math.max(96, bb.depthIn || DEFAULT_BENCH_DEPTH) };
    }
    site._benchCache = { sig, geom };
    return geom;
  };

  /* The bench TARGET surface height (inches, grade-relative) at (x,y), or null
     when the point is outside the bench footprint / the wall band. The bench
     grades to the PAD (grade 0 = the finish-floor datum family). Returns a number
     inside the flat bench; a { targetZ, t } blend across the retaining-wall band
     (t 0 at the wall line → 1 at the band toe, blending target→natural); null
     beyond. Widened a touch (±18") past the wall span so the bench isn't a
     razor-edge behind the house corners. Pure. */
  const BENCH_TARGET_Z = 0;           // pad grade in the grade-relative frame
  const benchTargetAt = (model, x, y) => {
    const g = benchGeom(model);
    if (!g) return null;
    if (naturalHeight(model, x, y) == null) return null;   // need a real surface
    const dx = x - g.mid.x, dy = y - g.mid.y;
    const dOut = dx * g.n.x + dy * g.n.y;                   // distance OUT past the rear wall
    if (dOut <= 0) return null;                             // in front of / under the house
    const s = dx * g.along.x + dy * g.along.y;              // along the wall
    if (s < g.lo - 18 || s > g.hi + 18) return null;        // outside the house-width band
    if (dOut <= g.depthIn) return BENCH_TARGET_Z;           // flat bench = pad grade
    const over = dOut - g.depthIn;
    if (over >= BENCH_WALL_BAND) return null;               // beyond the wall → natural grade
    return { targetZ: BENCH_TARGET_Z, t: over / BENCH_WALL_BAND };   // near-vertical retaining face
  };

  /* Public: the retaining-wall RUN + face height for the takeoff (concrete/CMU LF
     + height). Returns { lengthIn, faceIn, midX, midY } | null. faceIn = the
     grade delta the wall retains at the bench line (|natural − pad| there); a
     positive cut (uphill) or fill (downhill) both need a wall. Pure. */
  const benchWall = (model) => {
    const g = benchGeom(model);
    if (!g) return null;
    // face height = natural grade at the bench line minus the pad, sampled at the
    // wall-line midpoint (the deepest cut is usually mid-span on a planar slope).
    const wx = g.mid.x + g.n.x * g.depthIn, wy = g.mid.y + g.n.y * g.depthIn;
    const nat = naturalHeight(model, wx, wy);
    const faceIn = (nat != null && isFinite(nat)) ? Math.abs(nat - BENCH_TARGET_Z) : 0;
    return { lengthIn: (g.hi - g.lo), faceIn, midX: wx, midY: wy, depthIn: g.depthIn };
  };

  const heightAtInches = (model, x, y) => {
    /* TERRAIN-OFF SHORT CIRCUIT (R31 — Steve's 5-minute cold-restore freeze on a
       saved 250+ lot development). Terrain off is the DEFAULT and the state of a
       plain Developer-Mode save, and EVERY fold below (naturalHeight, bench, pad,
       driveway, walkway, dev, padFoot) is independently gated on
       site.terrain.enabled and returns null in that state — so the whole stack was
       computed and discarded on every sample. The dev overlay's grade seat samples
       this per ribbon vertex, lot line, sprite anchor, curb piece and road slab:
       76,743 calls per 254-lot rebuild, 197,854 per 648-lot rebuild, and the fold
       measured ~96% of the cost of a rebuild that produced a flat scene anyway.

       Returning null here is EXACTLY the answer the fold already produced, minus
       one real bug: pondDropAt was the only fold with NO enabled gate, so on a
       terrain-off site with a pond `base -= pondDropAt(...)` evaluated
       `null - depth` = the NUMBER -depth, reporting a bogus finite surface where
       there is no terrain. Terrain-ON sites take the identical path they always
       did — the pond bowl is still derived fresh per call, so it stays scar-free. */
    const site0 = model && model.site;
    if (!site0 || !site0.terrain || !site0.terrain.enabled) return null;
    const nat = naturalHeight(model, x, y);
    // BACKYARD BENCH first: flatten the yard behind the house to pad grade (both
    // CUT downhill grade and FILL uphill), terminating in a retaining-wall face.
    // Only fires when site.terrain.backyardBench.enabled + a real rear wall.
    const bt = benchTargetAt(model, x, y);
    if (bt != null && nat != null) {
      const target = (typeof bt === 'number') ? bt : (bt.targetZ * (1 - bt.t) + nat * bt.t);
      // inside the bench the surface IS the pad (level); the garage pad below may
      // still cut it lower, so let padTargetAt refine from this benched base.
      const pt = padTargetAt(model, x, y);
      if (pt == null) return target;
      const padZ = (typeof pt === 'number') ? pt : pt.padZ;
      const padTarget = (typeof pt === 'number') ? padZ : (padZ * (1 - pt.t) + target * pt.t);
      return Math.min(target, padTarget);
    }
    // apply the garage pad: LOWER (never raise) the surface to the graded pad so
    // the driveway/ground meet the garage slab. padTargetAt is null (→ natural)
    // unless there is a REAL terrain surface here AND a garage rect covers (x,y).
    const t = padTargetAt(model, x, y);
    let base = nat;
    if (t != null) {
      const natZ = nat;                        // guaranteed non-null by padTargetAt
      const padZ = (typeof t === 'number') ? t : t.padZ;
      const target = (typeof t === 'number') ? padZ : (padZ * (1 - t.t) + natZ * t.t);
      base = Math.min(natZ, target);           // only ever cut DOWN to the pad
    }
    // DRIVEWAY FOLLOW (Steve redline Jul 5): grade the ground under/beside the garage
    // drive to its code-pitched profile — FILL up where the drive is above grade, CUT
    // down where below — so the apron butts the garage slab lip with no step. Applied
    // AFTER the pad (the pad governs directly under the garage; the drive governs its
    // own corridor out to the road). Both raise + lower here (unlike the cut-only pad).
    // HARDSCAPE TUCK (founder, launch day: "terrain still goes through sidewalks
    // and slabs... driveways too — remove once and for all"): grading terrain
    // exactly FLUSH with the walk/drive/pad surface z-fights at mesh resolution
    // and pokes through between samples. Inside every hardscape corridor the
    // terrain now tucks TUCK inches BELOW the surface target, so the slab is
    // always proud of grade; the blend shoulders interpolate to the tucked
    // height so the lip stays continuous.
    const TUCK = 1.0;
    // The driveway finish profile itself meets the garage lip 1" low; TUCK is
    // the additional soil reveal beneath that paved finish, preventing coplanar
    // grass/concrete without changing the driveway's authored elevation.
    const dt = drivewayTargetAt(model, x, y);
    if (dt != null) {
      base = (typeof dt === 'number') ? (dt - TUCK)
        : ((dt.targetH - TUCK) * (1 - dt.t) + base * dt.t);
    }
    // WALKWAY FOLLOW (Steve Jul 5): grade the ground under/beside the front walk to its
    // smoothed profile (fill above grade, cut below) so a straight clean walk sits flush
    // — "inset the walkway or do it on top if its flat." Applied after the drive so a
    // walk meeting the drive blends to the same graded corridor.
    const wt = walkwayTargetAt(model, x, y);
    if (wt != null) {
      base = (typeof wt === 'number') ? (wt - TUCK)
        : ((wt.targetH - TUCK) * (1 - wt.t) + base * wt.t);
    }
    // DEVELOPMENT GRADING (Developer Mode): the generated court/approaches are a
    // DESIGN surface (plane clamped to the fire-access grade cap, anchored at the
    // street) and each lot pad is a LEVEL bench — the terrain conforms to both,
    // court pavement tucked 1" like every other hardscape. Applied after the
    // walk/drive follows so a hand-drawn walk across the court still blends.
    const dg = devTargetAt(model, x, y);
    if (dg != null) {
      const th = dg.targetH - (dg.tuck ? TUCK : 0);
      base = th * (1 - dg.t) + base * dg.t;
    }
    // STAIR-FOOT PAD (Steve round 6): the poured landing pad is LEVEL at the flight
    // walk-off grade — terrain flattens to it (never buries it) and blends back over
    // a 24" collar. Applied LAST so the pad wins over the walk profile at the joint
    // (they share the same anchor elevation there — continuous by construction).
    const pf = padFootTargetAt(model, x, y);
    if (pf != null) {
      base = (typeof pf === 'number') ? (pf - TUCK)
        : ((pf.targetH - TUCK) * (1 - pf.t) + base * pf.t);
    }
    // GARDEN POND DEPRESSION (founder, Jul 15: "your pond leaves a HOLE in the
    // terrain, looks like crap"): instead of cutting a hole, the terrain itself
    // dishes DOWN toward each pond's center — a smooth bowl whose rim sits exactly
    // at grade on the pond outline (zero drop at the edge → continuous with the
    // yard, no torn faces). Derived FRESH from the feature poly on every call, so
    // moving/resizing the pond re-derives the bowl and the old spot restores
    // itself automatically — a pond can never leave a permanent scar.
    const pdp = pondDropAt(model, x, y);
    if (pdp > 0) base -= pdp;
    return base;
  };

  /* ---- pondDropAt(model, x, y) ----
     How far (inches, >= 0) a garden pond dishes the terrain BELOW the folded
     surface at plan (x,y). 0 outside every pond poly; inside, the drop ramps
     from 0 at the outline to the pond depth over POND_RAMP inches of inward
     travel (distance to the nearest outline edge), so the bowl rim is exactly
     at grade and the middle is a flat-bottomed basin. Pure + per-call — no
     cached terrain state, which is what makes pond move/resize scar-free. */
  const POND_RAMP = 30;                 // bank width: outline → full depth (inches)
  const POND_DEPTH_DEFAULT = 12;        // visual basin depth (inches)
  const pondDropAt = (model, x, y) => {
    const site = model && model.site;
    /* R32 — inside a sample scope the pond list is pre-filtered ONCE. Outside one
       this is the original full scan of site.features, unchanged: on a 650-lot
       development that is ~722 features re-walked per sample purely to discover
       there are no ponds. The list is still empty-checked below, so a pondless
       site now exits before the loop instead of iterating the whole array. */
    const sc = inScope(model);
    const feats = (sc ? sc.ponds : null) || (site && Array.isArray(site.features) ? site.features : null);
    if (!feats || !feats.length) return 0;
    const U = HA.U;
    if (!U || typeof U.pointInPoly !== 'function') return 0;
    let drop = 0;
    for (const f of feats) {
      if (!f || f.type !== 'pool' || !f.pond || !Array.isArray(f.poly) || f.poly.length < 3) continue;
      // cheap bbox reject before the poly test
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const p of f.poly) { if (p.x < bx0) bx0 = p.x; if (p.y < by0) by0 = p.y; if (p.x > bx1) bx1 = p.x; if (p.y > by1) by1 = p.y; }
      if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
      if (!U.pointInPoly({ x, y }, f.poly)) continue;
      // distance to the nearest outline edge (inside the poly)
      let dEdge = Infinity;
      for (let i = 0; i < f.poly.length; i++) {
        const a = f.poly[i], b = f.poly[(i + 1) % f.poly.length];
        const ex = b.x - a.x, ey = b.y - a.y;
        const L2 = ex * ex + ey * ey;
        let t = L2 > 1e-9 ? ((x - a.x) * ex + (y - a.y) * ey) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t));
        if (d < dEdge) dEdge = d;
      }
      const depth = (Number.isFinite(f.pondDepthIn) && f.pondDepthIn > 0) ? f.pondDepthIn : POND_DEPTH_DEFAULT;
      // smoothstep in — the bank curves into the bowl rather than a hard cone
      const t = Math.min(1, dEdge / POND_RAMP);
      const d = depth * (t * t * (3 - 2 * t));
      if (d > drop) drop = d;
    }
    return drop;
  };

  /* ---- footprintRings(model) ----
     The house + garage footprint OUTLINES as densified plan rings, for the 3D
     terrain pad's clean footprint cut (founder, Jul 15: "terrain is RIPPED —
     jagged edges all around"): the pad mesh snips its triangles TO these exact
     rings instead of centroid-dropping a sawtooth. Same geometry underFootprint
     tests point-wise — the stud-outer slab loop + the garage rect. Pure;
     returns [] when there's no footprint. Each ring: [{x,y}...] with bb. */
  const footprintRings = (model) => {
    const out = [];
    if (!model) return out;
    const U = HA.U;
    const dens = (ring, step) => {
      const r = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(L / step));
        for (let k = 0; k < n; k++) { const t = k / n; r.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
      }
      return r;
    };
    const push = (ring) => {
      if (!Array.isArray(ring) || ring.length < 3) return;
      const r = dens(ring, 24);
      let b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
      for (const p of r) { if (p.x < b.minx) b.minx = p.x; if (p.y < b.miny) b.miny = p.y; if (p.x > b.maxx) b.maxx = p.x; if (p.y > b.maxy) b.maxy = p.y; }
      out.push({ ring: r, bb: b });
    };
    if (typeof HA.exteriorLoop === 'function') {
      const loop = HA.exteriorLoop(model, 0);
      if (loop && Array.isArray(loop.pts) && loop.pts.length >= 3) {
        let ring = loop.pts;
        if (U && typeof U.offsetPoly === 'function' && Array.isArray(loop.walls) && loop.walls.length === loop.pts.length) {
          try {
            const halfT = loop.walls.map((w) =>
              (HA.studEdgeOffset ? HA.studEdgeOffset(w) : (HA.wallT ? HA.wallT(w) / 2 : 3)));
            const so = U.offsetPoly(loop.pts, halfT);
            if (so && so.length >= 3) ring = so;
          } catch (e) { /* raw loop */ }
        }
        push(ring);
      }
    }
    if (HA.garageInfo) {
      try {
        const gi = HA.garageInfo(model);
        if (gi && gi.rect) {
          const r = gi.rect;
          const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1);
          const y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
          push([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
        }
      } catch (e) { /* house loop already covers it */ }
    }
    return out;
  };

  /* ---- plantSeatY(model, x, y) ----
     The WORLD-Y (inches) a grade-seated object (plant, tree, bush, planter, bed
     plant) must sit at so its base rests ON the terrain surface at plan (x,y):
       seatY = heightAtInches + (-stemHeight) + effectiveOffsetIn
     — the IDENTICAL frame the 3D terrain mesh is built in (view3d displaces each
     terrain vertex by heightAtInches - stem, then translates the whole terrain
     group by effectiveOffsetIn). Falls back to the flat grade plane (-stem) when
     there's no usable terrain, so a plant never floats off a missing sample. This
     is the single source of truth for plant/tree seating (Steve Jul 13: "plants
     are floating… they don't sit on the terrain correctly"); every view3d seat
     closure defers to it so a plant is ALWAYS within rounding of the surface. */
  const plantSeatY = (model, x, y) => {
    const stem = (model && model.foundation && model.foundation.stemHeight) || 8;
    const gY = -stem;
    const h = heightAtInches(model, x, y);
    const off = effectiveOffsetIn(model);
    return (h != null && isFinite(h)) ? (h + gY + off) : gY;
  };

  /* ---- underFootprint(model, x, y) ----
     TRUE when plan point (x,y) lies UNDER the house exterior slab (the stud-edge
     slab-outer loop) or a garage rect — i.e. terrain there is HIDDEN by the slab
     and MUST be cut so the lot pad never pokes green up through the garage slab or
     an interior floor (Steve Jul 13: "terrain is breaking through garage slabs…
     cut out terrain through the house footprint so it's not visible"). Pure +
     geometric (no show/enabled gates — the caller decides when to apply it); the
     3D terrain builder drops every pad sub-triangle whose centroid returns true. */
  const underFootprint = (model, x, y) => {
    if (!model) return false;
    const U = HA.U;
    if (!U || typeof U.pointInPoly !== 'function') return false;
    if (typeof HA.exteriorLoop === 'function') {
      const loop = HA.exteriorLoop(model, 0);
      if (loop && Array.isArray(loop.pts) && loop.pts.length >= 3) {
        let ring = loop.pts;
        if (typeof U.offsetPoly === 'function' && Array.isArray(loop.walls) && loop.walls.length === loop.pts.length) {
          try {
            const halfT = loop.walls.map((w) =>
              (HA.studEdgeOffset ? HA.studEdgeOffset(w) : (HA.wallT ? HA.wallT(w) / 2 : 3)));
            const so = U.offsetPoly(loop.pts, halfT);
            if (so && so.length >= 3) ring = so;
          } catch (e) { /* fall back to the raw loop */ }
        }
        if (U.pointInPoly({ x, y }, ring)) return true;
      }
    }
    if (HA.garageInfo) {
      try {
        const gi = HA.garageInfo(model);
        if (gi && gi.rect) {
          const r = gi.rect;
          if (x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) &&
              y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1)) return true;
        }
      } catch (e) { /* no garage → house loop already covers it */ }
    }
    return false;
  };

  /* ============================================================
     HOUSE DATUM — TERRAIN-DATUM-SPEC A (Steve, Jul 3)
     ------------------------------------------------------------
     "Reset the terrain point on the house to the HIGHEST point where
      the house intersects, keeping the top of footing always 8" above
      grade on the house."

     The house finish floor (FF) and top-of-foundation live at world-Y ~0
     (slab: top of slab == FF == 0; raised: FF == 0, stem top at grade+stem).
     The terrain GROUP is translated vertically by an offset. Historically
     that offset was JUST site.terrain.offsetIn (a hand-tuned puller value)
     and the sampled surface was datum'd to the footprint CENTROID, so the
     centroid grade sat at world-Y 0 — i.e. the slab edge sat 0" above the
     grade at the house center and DUG IN uphill. That is not code-correct.

     NEW: the terrain group's effective vertical offset auto-derives so the
     TOP OF FOUNDATION sits ≥ FOUNDATION_CLEARANCE (8") above the HIGHEST
     natural grade sampled under/at the footprint. site.terrain.offsetIn
     becomes a USER DELTA applied ON TOP of that auto datum.

     The terrain MESH (and every grade-seated object) places grade at
       grade(p) world = heightAtInches(p) - stemHeight + effectiveOffsetIn
     (view3d builds the terrain vertices at heightAtInches - stemHeight, then
     translates the whole terrain group by effectiveOffsetIn; object seats use
     the identical h - stemHeight + off). The top of foundation (top of stem /
     slab edge) is the finish-floor plane at world-Y 0. We want the HIGHEST
     footprint grade to sit CLEAR below that top by max(stemHeight, 8"):

       want:  0 - max_p( grade(p) )  ==  max(stemHeight, 8)
       so:    max(h) - stemHeight + autoDatum  ==  -max(stemHeight, 8)
              autoDatum = -max(h) - ( max(stemHeight,8) - stemHeight )   [ = houseDatum ]
              effectiveOffsetIn = autoDatum + offsetIn(user delta)

     For the common stemHeight ≥ 8 that reduces to autoDatum = -max(h): FLAT
     terrain (max h = 0) → autoDatum 0, byte-identical to the legacy render;
     a SLOPE shifts the group so the HIGH corner (not the centroid) governs the
     8"/stem clearance, and the LOW corner correctly exposes more stem (spec C).

     MIGRATION: existing saved models carry a hand-tuned site.terrain.offsetIn
     that compensated for the OLD centroid datum. Those values are PRESERVED
     verbatim and now ride ON TOP of the auto datum, so they keep meaning as a
     relative nudge. A model with a LARGE manual offset (|offsetIn| big) that
     was fighting the old datum may now read too high/low — the UI surfaces a
     status note (HA.terrain.datumShiftNote) inviting the user to zero it.
     ============================================================ */
  const FOUNDATION_CLEARANCE = 8;   // CRC-style top-of-foundation above grade (in)

  /* Sample the natural terrain height (INCHES, grade-relative) at a dense set of
     points across the HOUSE FOOTPRINT — the exterior loop vertices PLUS an
     interior grid so a high knoll under the middle of the house is caught, not
     just the corners. Returns [] when there's no usable terrain. Pure. */
  const footprintGradeSamples = (model) => {
    const out = [];
    let loopPts = null;
    if (typeof HA.exteriorLoop === 'function') {
      const loop = HA.exteriorLoop(model, 0);
      if (loop && Array.isArray(loop.pts) && loop.pts.length >= 3) loopPts = loop.pts;
    }
    if (!loopPts) {
      const cen = footprintCentroid(model);
      if (cen) { const h = naturalHeight(model, cen.x, cen.y); if (h != null && isFinite(h)) out.push(h); }
      return out;
    }
    // perimeter vertices
    for (const p of loopPts) { const h = naturalHeight(model, p.x, p.y); if (h != null && isFinite(h)) out.push(h); }
    // interior grid over the footprint bbox (only points INSIDE the loop) so an
    // interior high spot governs. 6×6 is plenty against a 7×7 elevation grid.
    const b = bboxOf(loopPts);
    const inPoly = (x, y, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
      }
      return inside;
    };
    const NG = 6;
    for (let r = 0; r <= NG; r++) for (let c = 0; c <= NG; c++) {
      const x = b.minx + ((b.maxx - b.minx) * c) / NG;
      const y = b.miny + ((b.maxy - b.miny) * r) / NG;
      if (!inPoly(x, y, loopPts)) continue;
      const h = naturalHeight(model, x, y);
      if (h != null && isFinite(h)) out.push(h);
    }
    return out;
  };

  /* The AUTO vertical datum (inches) for the terrain group so the top of
     foundation sits FOUNDATION_CLEARANCE above the HIGHEST footprint grade.
     Returns 0 when terrain is off/unsampled (legacy flat behavior — the group
     stays at just the user offset). Pure; derives entirely from the live model.
     Flat terrain (naturalHeight==0 everywhere) → maxGrade 0 → -8, so a slab
     house reads its slab edge 8" above the flat grade, consistently (spec C). */
  const houseDatum = (model) => {
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return 0;
    // require a real surface (flat→0, or a live sample); else no auto datum.
    const samples = footprintGradeSamples(model);
    if (!samples.length) return 0;
    let maxGrade = -Infinity;
    for (const h of samples) if (h > maxGrade) maxGrade = h;
    if (!isFinite(maxGrade)) return 0;
    const stem = (model.foundation && model.foundation.stemHeight) || 8;
    // extra dig only when the stem is shallower than the 8" min clearance
    const extra = Math.max(0, FOUNDATION_CLEARANCE - stem);
    return -maxGrade - extra;
  };

  /* The EFFECTIVE terrain-group vertical offset (inches) = auto datum + the
     user delta (site.terrain.offsetIn). THIS is what every vertical-seating
     consumer (the 3D terrain group, HVAC/tree seats, entrance/garage steps,
     gradeDropUnder, foundation stem grow-down) must use in place of a raw
     offsetIn read, so the whole scene honors the datum + delta model. */
  const effectiveOffsetIn = (model) => {
    const user = (model && model.site && model.site.terrain && model.site.terrain.offsetIn) || 0;
    return houseDatum(model) + user;
  };

  /* Advisory: how far the auto datum has shifted the ground vs. the legacy
     centroid datum, so the UI can nudge the user to zero a now-fighting manual
     offset. Returns { shiftIn, bigManualOffset } or null when terrain is off.
     shiftIn = |houseDatum - (-FOUNDATION_CLEARANCE)| on flat is 0; on a slope it
     grows with the corner-to-centroid relief. bigManualOffset flags a legacy
     |offsetIn| that likely predates the auto datum (Spec A migration note). */
  const datumShiftNote = (model) => {
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return null;
    const user = site.terrain.offsetIn || 0;
    // the auto datum already places grade correctly; a large residual user delta
    // (> half a foot) most likely predates this feature and now double-counts.
    return { autoDatumIn: houseDatum(model), userDeltaIn: user, bigManualOffset: Math.abs(user) > 6 };
  };

  /* ---- gradeDropUnder(model, pts) ----
     How far (inches, >= 0) the LOWEST terrain under `pts` (plan points, e.g. the
     foundation perimeter) falls BELOW the foundation's default bottom (slab + stem).
     That's the floating gap on a drop-away slope, so view3d can GROW the stem down
     to meet grade (Steve #7: "if the foundation drops >8" below grade the stem grows
     so it looks correct — no floating slab"). 0 when terrain is off / unsampled, or
     the grade sits at/above the bottom. Honors the AUTO DATUM + user delta
     (effectiveOffsetIn), so on a hillside the low side correctly exposes more
     stem measured from the datumed surface (spec C). */
  const densePerimeter = (pts, maxStepIn) => {
    if (!Array.isArray(pts) || !pts.length) return [];
    const out = [], step = Math.max(12, maxStepIn || 48);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (!a || !b || !isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  };

  const gradeDropUnder = (model, pts) => {
    const fd = model && model.foundation;
    if (!fd || !Array.isArray(pts) || !pts.length) return 0;
    const gY = -(fd.stemHeight || 8);
    const offIn = effectiveOffsetIn(model);
    let minY = Infinity;
    // Long foundation edges need intermediate samples. Corners alone miss a low
    // swale between them and leave a visible opening even though both endpoints
    // appear supported.
    for (const p of densePerimeter(pts, 48)) {
      const h = heightAtInches(model, p.x, p.y);
      if (h != null && isFinite(h)) minY = Math.min(minY, h + gY + offIn);
    }
    if (!isFinite(minY)) return 0;
    const bottom = -((fd.slabThickness || 4) + (fd.stemHeight || 8));
    return Math.max(0, bottom - minY);
  };

  /* Validate the optional 5' soil transition around a slab foundation. The old
     renderer trusted offsetPoly unconditionally, so a reflex corner or very steep
     grade could turn the collar into a giant triangular flap. A berm is accepted
     only when the outer ring is simple, actually contains the slab, has bounded
     miters, and can meet natural grade at a no-steeper-than-2H:1V transition.
     Anything else returns ok:false and the renderer uses the full-depth concrete
     support below instead. */
  const foundationBermPlan = (model, slabOuter, widthIn, knownDrop, _retried) => {
    const width = Math.max(24, widthIn || 60);
    const dropIn = Number.isFinite(knownDrop) ? Math.max(0, knownDrop) : gradeDropUnder(model, slabOuter);
    const fail = (reason) => ({ ok: false, reason, widthIn: width, dropIn });
    const fd = model && model.foundation;
    const U = HA.U;
    if (!fd || fd.type === 'raised') return fail('raised-foundation');
    if (!(dropIn > 8)) return fail('no-berm-needed');
    if (!U || typeof U.offsetPoly !== 'function' || !Array.isArray(slabOuter) || slabOuter.length < 3)
      return fail('missing-outline');

    let outerRing;
    try { outerRing = U.offsetPoly(slabOuter, width); } catch (e) { return fail('offset-failed'); }
    if (!outerRing || outerRing.length !== slabOuter.length) return fail('offset-mismatch');
    for (const p of outerRing) if (!p || !isFinite(p.x) || !isFinite(p.y)) return fail('non-finite-offset');
    const area0 = Math.abs(U.polyArea(slabOuter)), area1 = Math.abs(U.polyArea(outerRing));
    if (!(area1 > area0 + 1)) return fail('offset-did-not-grow');
    for (const p of slabOuter) if (!U.pointInPoly(p, outerRing)) return fail('offset-does-not-contain-slab');

    const cross = (a, b, c, d) => {
      const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const a1 = side(a, b, c), a2 = side(a, b, d), b1 = side(c, d, a), b2 = side(c, d, b);
      return ((a1 > 0 && a2 < 0) || (a1 < 0 && a2 > 0)) && ((b1 > 0 && b2 < 0) || (b1 < 0 && b2 > 0));
    };
    for (let i = 0; i < outerRing.length; i++) for (let j = i + 1; j < outerRing.length; j++) {
      if ((i + 1) % outerRing.length === j || (j + 1) % outerRing.length === i) continue;
      if (cross(outerRing[i], outerRing[(i + 1) % outerRing.length], outerRing[j], outerRing[(j + 1) % outerRing.length]))
        return fail('self-intersecting-offset');
    }

    // Normal square corners pair at width*sqrt(2). Huge reflex-corner miters are
    // the characteristic source of the screenshot's projecting brown sheet.
    for (let i = 0; i < slabOuter.length; i++) {
      const d = Math.hypot(outerRing[i].x - slabOuter[i].x, outerRing[i].y - slabOuter[i].y);
      if (!(d >= width * 0.45 && d <= width * 2.0)) return fail('unbounded-miter');
    }

    const innerY = -(fd.stemHeight || 8), offIn = effectiveOffsetIn(model), outerYs = [];
    let maxVerticalIn = 0;
    for (const p of outerRing) {
      const h = heightAtInches(model, p.x, p.y);
      if (h == null || !isFinite(h)) return fail('unsampled-grade');
      const y = h + innerY + offIn;
      outerYs.push(y); maxVerticalIn = Math.max(maxVerticalIn, Math.abs(y - innerY));
    }
    if (maxVerticalIn > width / 2 + 0.01) {
      // Task #5 (skirting): before giving up on a steep grade, retry ONCE with
      // a collar wide enough to hold the 2H:1V transition — width = 2 ×
      // maxVerticalIn, capped at 120". Still too steep at 120" → real fail.
      const w2 = Math.min(120, Math.ceil(maxVerticalIn * 2));
      if (!_retried && w2 > width + 0.5) return foundationBermPlan(model, slabOuter, w2, dropIn, true);
      return fail('grade-too-steep');
    }
    return { ok: true, reason: 'ok', widthIn: width, dropIn, innerRing: slabOuter, outerRing, outerYs, innerY, maxVerticalIn };
  };

  /* Single foundation-support decision consumed by rendering and tests. Concrete
     always grows to the lowest sampled perimeter grade; the berm is merely an
     optional visual grading cover and is never relied on to close the foundation.
     This means a rejected/corrupt/extreme berm still produces a continuous skirt. */
  const foundationSupportPlan = (model, slabOuter, widthIn) => {
    const dropIn = gradeDropUnder(model, slabOuter);
    return {
      dropIn,
      // Ignore sub-half-inch interpolation noise, otherwise close every measured
      // gap instead of leaving a smaller (but still visible) opening below the stem.
      growDepthIn: dropIn > 0.5 ? dropIn : 0,
      berm: foundationBermPlan(model, slabOuter, widthIn, dropIn),
    };
  };

  /* ---- contours(model, intervalIn, opts) ----
     Iso-elevation CONTOUR LINES over the lot, from the sampled USGS grid (M6).
     Resamples the coarse N×N grid to a finer res×res field (bilinear), then runs
     marching-squares at every multiple of `intervalIn` inches of relative grade.
     Returns { ok, flat?, intervalIn, range:{minIn,maxIn,datumFt},
       lines:[{ elevIn, elevFt, relFt, segs:[[{x,y},{x,y}], …] }] } in PLAN inches.
     Memoized on model.site._contourCache so canvas repaints stay cheap. Pure. */
  const fracCross = (a, b, L) => { const d = b - a; return Math.abs(d) < 1e-9 ? 0 : Math.max(0, Math.min(1, (L - a) / d)); };

  const contours = (model, intervalIn, opts) => {
    opts = opts || {};
    const out = { ok: false, lines: [], intervalIn: intervalIn, range: null };
    const sample = cached(model);
    if (!sample || !sample.ok) return out;
    const grid = relativeZ(sample);
    const n = sample.n, cols = sample.cols;
    if (!grid || grid.length !== n * cols || n < 2 || cols < 2) return out;
    const interval = (intervalIn > 0 && isFinite(intervalIn)) ? intervalIn : 12;
    const res = Math.max(8, Math.min(160, opts.res || 56));

    // memo: re-use the last result when the parcel + interval + res are unchanged
    const sig = (cacheKey(model) || '') + '@' + interval + '@' + res;
    const memo = model.site && model.site._contourCache;
    if (memo && memo.sig === sig && memo.data) return memo.data;

    // mean fill for any missing grid samples
    let sum = 0, cnt = 0;
    for (const g of grid) if (g.zIn != null && isFinite(g.zIn)) { sum += g.zIn; cnt++; }
    if (!cnt) return out;
    const fill = sum / cnt;
    const zG = (r, c) => { const p = grid[r * cols + c]; return (p && p.zIn != null && isFinite(p.zIn)) ? p.zIn : fill; };
    const x0 = grid[0].x, x1 = grid[cols - 1].x;
    const y0 = grid[0].y, y1 = grid[(n - 1) * cols].y;
    const zAt = (fx, fy) => {
      const c0 = Math.floor(fx), c1 = Math.min(cols - 1, c0 + 1), tx = fx - c0;
      const r0 = Math.floor(fy), r1 = Math.min(n - 1, r0 + 1), ty = fy - r0;
      const top = zG(r0, c0) + (zG(r0, c1) - zG(r0, c0)) * tx;
      const bot = zG(r1, c0) + (zG(r1, c1) - zG(r1, c0)) * tx;
      return top + (bot - top) * ty;
    };
    // resample onto a res×res field; record plan coords + z-range
    const Z = new Array(res * res), PX = new Array(res), PY = new Array(res);
    for (let i = 0; i < res; i++) { const f = i / (res - 1); PX[i] = x0 + (x1 - x0) * f; PY[i] = y0 + (y1 - y0) * f; }
    let zmin = Infinity, zmax = -Infinity;
    for (let r = 0; r < res; r++) for (let c = 0; c < res; c++) {
      const z = zAt((cols - 1) * (c / (res - 1)), (n - 1) * (r / (res - 1)));
      Z[r * res + c] = z; if (z < zmin) zmin = z; if (z > zmax) zmax = z;
    }
    out.range = { minIn: zmin, maxIn: zmax, datumFt: sample.datumFt || 0 };
    if (!(zmax - zmin > 1e-6)) { out.ok = true; out.flat = true; if (model.site) model.site._contourCache = { sig, data: out }; return out; }

    const Zr = (r, c) => Z[r * res + c];
    const kMin = Math.ceil(zmin / interval), kMax = Math.floor(zmax / interval);
    const MAXLEV = 400;
    for (let k = kMin; k <= kMax && (k - kMin) <= MAXLEV; k++) {
      const L = k * interval, segs = [];
      for (let r = 0; r < res - 1; r++) for (let c = 0; c < res - 1; c++) {
        const tl = Zr(r, c), tr = Zr(r, c + 1), br = Zr(r + 1, c + 1), bl = Zr(r + 1, c);
        let idx = 0; if (tl >= L) idx |= 8; if (tr >= L) idx |= 4; if (br >= L) idx |= 2; if (bl >= L) idx |= 1;
        if (idx === 0 || idx === 15) continue;
        const xL = PX[c], xR = PX[c + 1], yT = PY[r], yB = PY[r + 1];
        const top = () => ({ x: xL + (xR - xL) * fracCross(tl, tr, L), y: yT });
        const right = () => ({ x: xR, y: yT + (yB - yT) * fracCross(tr, br, L) });
        const bottom = () => ({ x: xL + (xR - xL) * fracCross(bl, br, L), y: yB });
        const left = () => ({ x: xL, y: yT + (yB - yT) * fracCross(tl, bl, L) });
        switch (idx) {
          case 1: case 14: segs.push([left(), bottom()]); break;
          case 2: case 13: segs.push([bottom(), right()]); break;
          case 3: case 12: segs.push([left(), right()]); break;
          case 4: case 11: segs.push([top(), right()]); break;
          case 6: case 9: segs.push([top(), bottom()]); break;
          case 7: case 8: segs.push([left(), top()]); break;
          case 5: segs.push([top(), right()]); segs.push([left(), bottom()]); break;   // saddle tr+bl
          case 10: segs.push([left(), top()]); segs.push([bottom(), right()]); break;  // saddle tl+br
          default: break;
        }
      }
      if (segs.length) out.lines.push({ elevIn: L, elevFt: (sample.datumFt || 0) + L / 12, relFt: L / 12, segs });
    }
    out.ok = true;
    if (model.site) model.site._contourCache = { sig, data: out };
    return out;
  };

  HA.terrain = {
    sampleGrid,
    relativeZ,
    ensure,
    cached,
    beginSampleScope, endSampleScope,   // R32 — synchronous-only sample memo window
    clearCache,
    cacheKey,
    footprintCentroid,
    heightAtInches,
    // PLANT/TREE SEATING (Steve Jul 13): the world-Y a grade-seated object sits at
    // so its base rests on the terrain surface — the single source of truth so no
    // plant floats/buries. HOUSE-FOOTPRINT CUT: is (x,y) under the slab/garage.
    plantSeatY,
    underFootprint,
    footprintRings,
    // GARDEN POND (Jul 15): scar-free terrain bowl under a pond feature
    pondDropAt,
    POND_RAMP,
    // RAW natural grade (no pad/bench/driveway folds) — HA.garageDefaultDrop samples
    // this for the grade-driven garage slab elevation (Steve Jul 6: the garage slab
    // founds at its own grade, never a fixed dig below FF). MUST stay raw: the
    // heightAtInches garage pad derives FROM the garage drop — sampling the folded
    // surface here would recurse.
    naturalHeightAt: naturalHeight,
    padDropAt,
    // DRIVEWAY GRADE-FOLLOW (Steve redline Jul 5): terrain follows the garage-drive
    // code-pitched profile (fill above grade, cut below) so the apron butts the slab.
    drivewayTargetAt,
    // WALKWAY GRADE-FOLLOW (Steve Jul 5): terrain follows the front-walk smoothed profile
    walkwayTargetAt,
    // DEVELOPMENT GRADING (Developer Mode round 2): terrain conforms to the
    // generated court design plane + level lot pads (site.dev.grading)
    devTargetAt,
    // STAIR-FOOT PAD (Steve round 6): terrain conforms to the level landing pad
    padFootTargetAt,
    // BACKYARD BENCH (HILLS A2): flatten + retaining wall behind the house
    benchGeom,
    benchTargetAt,
    benchWall,
    DEFAULT_BENCH_DEPTH,
    gradeDropUnder,
    foundationBermPlan,
    foundationSupportPlan,
    contours,
    // TERRAIN-DATUM-SPEC A: house datum = highest footprint grade + 8"
    houseDatum,
    effectiveOffsetIn,
    footprintGradeSamples,
    datumShiftNote,
    FOUNDATION_CLEARANCE,
    // exposed for tests / callers
    DEFAULT_N,
  };
})();
