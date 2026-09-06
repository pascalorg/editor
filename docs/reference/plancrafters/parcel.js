/* ============================================================
   PlanCrafters — parcel.js  (HA.parcel)
   CLIENT module. Two things live here:

   1. Thin fetch wrappers around OUR server proxies. The Google Maps
      Platform key (Geocoding / Elevation / Static Maps) lives ONLY on
      the server (Secret Manager env), exactly like the Gemini key — so
      the browser never sees it. Server routes (added to server.js):
        POST /api/parcel     {address}        -> {rings,...}  parcel polygon
        POST /api/geocode    {address}        -> {lat,lng,...}
        POST /api/elevation  {points:[{lat,lng}]} -> {results:[{elevation,...}]}
        GET  /api/staticmap  ?lat&lng&zoom...  -> proxied PNG (image bytes)

   2. PURE geometry helpers that work OFFLINE (no key, no network) so the
      rest of the app can place a real parcel on the plan:
        ringsToPlan(rings, originLatLng, scaleInPerFt) — lng/lat -> PLAN inches
        lotAreaSqFt(rings)                              — shoelace area
        ringsBounds(rings)                              — lng/lat bbox

   COORDINATE NOTES
   - "rings" is GeoJSON-style: an array of rings; each ring is an array of
     [lng, lat] pairs (x=lng, y=lat — lng FIRST, matching GeoJSON). Ring[0]
     is the outer boundary; later rings are holes (ignored for area sign here
     beyond the outer ring).
   - PLAN coordinates are in INCHES, x → east (+x), y → south (+y on screen),
     matching the rest of HA. Latitude increases NORTH, so plan.y flips sign.
   - We use a local equirectangular (flat-earth) projection good for a single
     parcel: 1° latitude ≈ FEET_PER_DEG_LAT feet; 1° longitude scales by
     cos(latitude). At parcel scale (≪1 mi) the error is sub-inch.

   ────────────────────────────────────────────────────────────
   DRAFT / PRELIMINARY — [JURIS]. Parcel geometry from a web service is
   approximate and is NOT a survey. Confirm bearings, dimensions, and the
   true property corners against a recorded plat / stamped survey before
   relying on any setback, area, or coverage number derived from it.
   ────────────────────────────────────────────────────────────
   ============================================================ */
(function () {
  'use strict';
  const HA = (window.HA = window.HA || {});

  /* 1° of latitude ≈ 364,000 ft (≈ 69 mi). Longitude shrinks by cos(lat). */
  const FEET_PER_DEG_LAT = 364000;
  const IN_PER_FT = 12;
  const DEG2RAD = Math.PI / 180;

  /* ---------- small internals (no HA.U dependency, so the pure helpers
     run standalone in tests / web workers / before utils.js loads) ---------- */

  /* normalize whatever the caller hands us into [lng,lat] pairs. We accept
     a bare ring ([[lng,lat],...]) or a rings array ([[[lng,lat],...],...]);
     each point may be [lng,lat] OR {lng,lat} / {x,y}. Returns [] on junk. */
  const asPair = (p) => {
    if (!p) return null;
    if (Array.isArray(p)) {
      return (p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) ? [+p[0], +p[1]] : null;
    }
    const lng = p.lng != null ? p.lng : p.lon != null ? p.lon : p.x;
    const lat = p.lat != null ? p.lat : p.y;
    return (isFinite(lng) && isFinite(lat)) ? [+lng, +lat] : null;
  };
  const outerRing = (rings) => {
    if (!Array.isArray(rings) || !rings.length) return [];
    // a rings array nests one level deeper than a bare ring of pairs.
    const first = rings[0];
    const isBareRing = asPair(first) != null; // first element is itself a point
    const ring = isBareRing ? rings : first;
    if (!Array.isArray(ring)) return [];
    const out = [];
    for (const p of ring) { const pr = asPair(p); if (pr) out.push(pr); }
    return out;
  };

  /* signed shoelace area of a [lng,lat] ring, in SQUARE DEGREES (lng·lat).
     Sign follows winding; caller takes abs for area. */
  const ringAreaDeg2 = (ring) => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  };

  /* ---------- PURE geometry (offline) ---------- */

  /* Bounding box of the outer ring in lng/lat. Returns
     {minLng,minLat,maxLng,maxLat,centerLng,centerLat} or null if empty. */
  const ringsBounds = (rings) => {
    const ring = outerRing(rings);
    if (!ring.length) return null;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return {
      minLng, minLat, maxLng, maxLat,
      centerLng: (minLng + maxLng) / 2,
      centerLat: (minLat + maxLat) / 2,
    };
  };

  /* Rotate a plan-coord lot ring so its dominant (longest) edge is axis-aligned
     — i.e. the lot is drawn SQUARE to the sheet (and the axis-aligned building
     footprint sits parallel inside it instead of cocked at the street bearing).
     Returns { lot, rot } where `rot` is the rotation (radians) APPLIED to the lot
     about its centroid — the same angle the north arrow must turn by to keep
     showing true north on the squared plan. A near-aligned lot is left as-is. */
  const squareLotToAxes = (lot) => {
    if (!Array.isArray(lot) || lot.length < 3) return { lot: lot, rot: 0 };
    // MIN-AREA BOUNDING BOX: try aligning to each edge's direction and keep the
    // rotation that makes the lot's axis-aligned bbox SMALLEST — that's the lot's
    // true rectangular orientation. Robust to a slightly irregular lot (a single
    // anomalous edge won't hijack it, unlike "align to the longest edge").
    let bestRot = 0, bestArea = Infinity;
    for (let i = 0; i < lot.length; i++) {
      const a = lot[i], b = lot[(i + 1) % lot.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
      let ang = Math.atan2(b.y - a.y, b.x - a.x) % (Math.PI / 2);
      if (ang > Math.PI / 4) ang -= Math.PI / 2;
      if (ang < -Math.PI / 4) ang += Math.PI / 2;
      const applied = -ang, cs = Math.cos(applied), sn = Math.sin(applied);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of lot) {
        const x = p.x * cs - p.y * sn, y = p.x * sn + p.y * cs;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
      const area = (maxx - minx) * (maxy - miny);
      if (area < bestArea - 1) { bestArea = area; bestRot = applied; }
    }
    if (Math.abs(bestRot) < 0.0035) return { lot: lot.slice(), rot: 0 }; // < ~0.2deg
    let sx = 0, sy = 0; for (const q of lot) { sx += q.x; sy += q.y; }
    const cx = sx / lot.length, cy = sy / lot.length;
    const cs = Math.cos(bestRot), sn = Math.sin(bestRot);
    const out = lot.map((q) => {
      const dx = q.x - cx, dy = q.y - cy;
      return { x: cx + dx * cs - dy * sn, y: cy + dx * sn + dy * cs };
    });
    return { lot: out, rot: bestRot };
  };

  /* Lot area in SQUARE FEET from the outer ring. Converts the signed
     degree² shoelace area into feet² using the local lat/lng scale taken
     at the ring's mean latitude (cos correction on the lng axis). */
  const lotAreaSqFt = (rings) => {
    const ring = outerRing(rings);
    if (ring.length < 3) return 0;
    const b = ringsBounds(rings);
    const ftPerDegLng = FEET_PER_DEG_LAT * Math.cos(b.centerLat * DEG2RAD);
    // |area in deg²| × (ft/deg_lng) × (ft/deg_lat) = ft²
    return Math.abs(ringAreaDeg2(ring)) * ftPerDegLng * FEET_PER_DEG_LAT;
  };

  /* Project a parcel polygon (lng/lat rings) into PLAN inches around an
     origin lat/lng. Latitude → -y (north is up / -y on screen), longitude
     → +x, both scaled to feet then inches. scaleInPerFt defaults to 12
     (true inches); pass another value to draw at a reduced plan scale.

     origin may be {lat,lng} | {lat,lng} on the ring's center (default =
     ring centroid bounds center). Returns an array of plan rings, each an
     array of {x,y} inches — mirroring the {x,y} polygons used elsewhere. */
  const ringsToPlan = (rings, originLatLng, scaleInPerFt) => {
    const scale = (scaleInPerFt == null ? IN_PER_FT : scaleInPerFt);
    const b = ringsBounds(rings);
    if (!b) return [];
    const o = asPair(originLatLng);
    // origin as [lng,lat]; default to the bbox center
    const oLng = o ? o[0] : b.centerLng;
    const oLat = o ? o[1] : b.centerLat;
    const ftPerDegLng = FEET_PER_DEG_LAT * Math.cos(oLat * DEG2RAD);
    const toPlan = (lng, lat) => ({
      x: (lng - oLng) * ftPerDegLng * scale,
      y: -(lat - oLat) * FEET_PER_DEG_LAT * scale, // north = up = -y
    });
    // honor the same nesting ringsBounds/outerRing accept: bare ring or rings array
    const nested = Array.isArray(rings[0]) && asPair(rings[0]) == null;
    const src = nested ? rings : [rings];
    const out = [];
    for (const ring of src) {
      if (!Array.isArray(ring)) continue;
      const pr = [];
      for (const p of ring) { const q = asPair(p); if (q) pr.push(toPlan(q[0], q[1])); }
      if (pr.length) out.push(pr);
    }
    return out;
  };

  /* Project neighbor parcel rings into the SAME plan frame as the subject lot,
     so adjacent parcels sit correctly around the house. `xf` is the transform
     applyParcel captured for the subject lot — {lat,lng,scale,rot,pivot:{x,y},
     dx,dy} — replaying its exact chain: ringsToPlan(origin) → rotate `rot` about
     `pivot` (the un-rotated subject-lot centroid, matching squareLotToAxes) →
     translate (dx,dy) (the footprint-centering offset). Returns plan rings
     (arrays of {x,y} inches). Invariant: projectWithXform(subjectRings, xf)
     reproduces model.site.lot (verified in dev-parcel-test). */
  const projectWithXform = (rings, xf) => {
    if (!xf || xf.lat == null || xf.lng == null) return [];
    const planRings = ringsToPlan(rings, { lat: xf.lat, lng: xf.lng }, xf.scale == null ? IN_PER_FT : xf.scale);
    const rot = xf.rot || 0, cs = Math.cos(rot), sn = Math.sin(rot);
    const px = xf.pivot ? xf.pivot.x : 0, py = xf.pivot ? xf.pivot.y : 0;
    const ox = xf.dx || 0, oy = xf.dy || 0;
    return planRings.map((ring) => ring.map((q) => {
      const dx = q.x - px, dy = q.y - py;
      return { x: Math.round(px + dx * cs - dy * sn + ox), y: Math.round(py + dx * sn + dy * cs + oy) };
    }));
  };

  /* ---------- MULTI-PARCEL geometry (Developer Mode) ----------
     Merge N TOUCHING parcels into ONE development-site outline. Everything
     happens in GEO space ([lng,lat] rings) BEFORE ringsToPlan, so the merged
     outline flows through the exact same geoXform pipeline as a single parcel
     — and satdrape.verifiedXform keeps healing (it replays
     model.parcel.geometry.rings against site.lot and needs them to be the SAME
     polygon, same vertex order/count).

     The boolean union comes from vendored Clipper (vendor/clipper/clipper.js,
     integer Vatti — loaded via its own <script> tag, NOT in the js bundle).
     Degrees are scaled by CL_SCALE to integers: 1e-7 deg ≈ 1.1 cm ground —
     far below survey noise. Fail-soft: no Clipper / bad input → {ok:false}. */
  const CL_SCALE = 1e7;
  const UNITS_PER_FT = CL_SCALE / FEET_PER_DEG_LAT; // ≈27.5 integer units per ft (lat axis; lng is 1/cos larger)
  const _clipper = () => (typeof window !== 'undefined' && window.ClipperLib) || null;
  const _toClipPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * CL_SCALE), Y: Math.round(p[1] * CL_SCALE) }));
  const _fromClipPath = (path) => path.map((q) => [q.X / CL_SCALE, q.Y / CL_SCALE]);

  /* R34 (client production bug, Jul 2026 — "one parcel did a weird split"):
     county GIS fabrics arrive with sub-tolerance vertex JITTER (0.05–2 ft)
     along shared parcel edges. Unioned raw, the near-zero-width overlap/gap
     wedges along a seam collapse into ZERO-WIDTH SPIKES stabbing into the
     merged outline — rendered as a dashed interior "split" — plus seam
     notches. Fix at the source: weld the integer paths BEFORE the boolean.
       (1) vertex↔vertex: cluster all vertices across rings within `snap`
           integer units onto one representative (first seen — deterministic),
       (2) vertex↔edge (T-vertex): a vertex lying within `snap` of the
           INTERIOR of another ring's edge is inserted INTO that edge,
     so both sides of a seam run through the exact same integer points and
     the union has nothing hairline left to keep. Mutates `paths` in place;
     collapsed (<3 pt) rings are dropped. */
  const _weldPaths = (paths, snap) => {
    const snap2 = snap * snap;
    const reps = [];
    for (const path of paths) {
      for (let i = 0; i < path.length; i++) {
        const v = path[i];
        let r = null;
        for (let k = 0; k < reps.length; k++) {
          const dx = v.X - reps[k].X, dy = v.Y - reps[k].Y;
          if (dx * dx + dy * dy <= snap2) { r = reps[k]; break; }
        }
        if (!r) { r = { X: v.X, Y: v.Y }; reps.push(r); }
        path[i] = { X: r.X, Y: r.Y };
      }
    }
    for (let pi = 0; pi < paths.length; pi++) {
      const path = paths[pi];
      const out = [];
      for (let i = 0; i < path.length; i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        out.push(a);
        const ex = b.X - a.X, ey = b.Y - a.Y;
        const L2 = ex * ex + ey * ey;
        if (!L2) continue;
        const hits = [];
        for (let pj = 0; pj < paths.length; pj++) {
          if (pj === pi) continue;
          for (const v of paths[pj]) {
            if ((v.X === a.X && v.Y === a.Y) || (v.X === b.X && v.Y === b.Y)) continue;
            const t = ((v.X - a.X) * ex + (v.Y - a.Y) * ey) / L2;
            if (t <= 0 || t >= 1) continue;
            const px = a.X + t * ex - v.X, py = a.Y + t * ey - v.Y;
            if (px * px + py * py <= snap2) hits.push({ t: t, X: v.X, Y: v.Y });
          }
        }
        hits.sort((u, w) => u.t - w.t);
        for (const h of hits) {
          const last = out[out.length - 1];
          if (last.X === h.X && last.Y === h.Y) continue;
          out.push({ X: h.X, Y: h.Y });
        }
      }
      const ded = [];
      for (const v of out) {
        const last = ded[ded.length - 1];
        if (last && last.X === v.X && last.Y === v.Y) continue;
        ded.push(v);
      }
      while (ded.length > 1 && ded[0].X === ded[ded.length - 1].X && ded[0].Y === ded[ded.length - 1].Y) ded.pop();
      paths[pi] = ded;
    }
    for (let i = paths.length - 1; i >= 0; i--) if (paths[i].length < 3) paths.splice(i, 1);
  };

  /* R34 belt-and-braces: remove zero-width SPIKES from an output ring — a
     vertex whose two neighbours lie in (nearly) the SAME direction, i.e. the
     ring doubles back on itself with a lateral deviation ≤ `snap`. Also eats
     consecutive duplicates. Repeats until stable (removing a spike tip can
     expose the next one down the shaft). */
  const _despike = (path, snap) => {
    let p = path.slice(), changed = true, guard = 0;
    while (changed && guard++ < 8 && p.length >= 3) {
      changed = false;
      const out = [], n = p.length;
      for (let i = 0; i < n; i++) {
        const a = p[(i + n - 1) % n], v = p[i], b = p[(i + 1) % n];
        const ux = a.X - v.X, uy = a.Y - v.Y, wx = b.X - v.X, wy = b.Y - v.Y;
        const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
        if (!lu || !lw) { changed = true; continue; }            // duplicate neighbour
        const cross = ux * wy - uy * wx, dot = ux * wx + uy * wy;
        if (dot > 0 && Math.abs(cross) <= snap * Math.max(lu, lw)) { changed = true; continue; } // spike tip
        out.push(v);
      }
      p = out;
    }
    return p;
  };

  /* Union a LIST of parcels (each item = that parcel's geometry.rings) into one
     outline. Returns { ok, rings, parts, vertexCount, bridgedFt, enclosedSF }:
       ok     — true only when the union is ONE connected polygon
       rings  — [outerRing, ...holes] in [lng,lat] (holes are rare: a fully
                enclosed courtyard of parcels; callers may drop them)
       parts  — how many DISJOINT polygons the union produced (1 = touching;
                2+ = the selection does not all touch → caller rejects)
       enclosedSF — ~SF of NEW hole area the morphological close introduced
                (0 without a close). A horseshoe pick around an UNSELECTED
                foreign parcel closes into one outer ring with that parcel
                inside as a hole — land the user does NOT own, invisible to
                outer-ring area math. Callers must reject when it's real
                (ui.applyParcels bails > ~500 SF) instead of claiming it.
     County fabrics share exact boundary vertices, so a plain union merges
     cleanly; when a fabric has hairline gaps (re-digitized county seams) a
     dilate→union→erode retry at ~tolFt closes them. The outer ring is cleaned
     and, if needed, progressively simplified to ≤ maxPts vertices — the 3D
     sat-drape / Google-tiles lot cutout shader caps at 64 (MAXP). */
  const unionRings = (ringsList, opts) => {
    opts = opts || {};
    const CL = _clipper();
    if (!CL) return { ok: false, reason: 'clipper-unavailable' };
    const paths = [];
    for (const rings of (Array.isArray(ringsList) ? ringsList : [])) {
      const ring = outerRing(rings);
      if (ring.length >= 3) paths.push(_toClipPath(ring));
    }
    if (!paths.length) return { ok: false, reason: 'no-rings' };

    /* R34: (a) MIXED WINDING cancels under nonzero fill — a CW-wound parcel
       beside a CCW one silently VANISHED from the union (half the assembly
       gone, ok:true). Normalize every input ring to positive orientation.
       (b) weld jittered seams to `snap` before the boolean so hairline
       overlap/gap wedges (the interior-split artifact) can never form. */
    const tolFt = Math.max(0.1, Number(opts.tolFt) || 0.75);
    const snap = Math.max(2, Math.round(tolFt * UNITS_PER_FT));
    for (const p of paths) if (!CL.Clipper.Orientation(p)) p.reverse();
    _weldPaths(paths, snap);
    if (!paths.length) return { ok: false, reason: 'no-rings' };

    const runUnion = (subject) => {
      const c = new CL.Clipper();
      c.AddPaths(subject, CL.PolyType.ptSubject, true);
      const sol = new CL.Paths();
      c.Execute(CL.ClipType.ctUnion, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
      return sol;
    };
    // polygon offset (dilate delta>0 / erode delta<0) — shared by the seam-heal
    // close, the street bridge, AND the R35 gap detector below.
    const off = (inPaths, delta) => {
      const o = new CL.ClipperOffset(2, 0.25);
      o.AddPaths(inPaths, CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
      const out = new CL.Paths();
      o.Execute(out, delta);
      return out;
    };
    /* dust: any part/hole under ~8·tol² SF, or thinner than tol/2 (2·area/
       perimeter ≈ mean width — catches a long hairline sliver whose raw area
       still clears the SF floor). Boolean/erode debris, not land: never
       counted as a "part" (a pinched-off erode crumb must not flip a merge
       to not-touching) and never returned. */
    const degSF = Math.max(1, 8 * tolFt * tolFt);
    const dustA = degSF * UNITS_PER_FT * UNITS_PER_FT;  // SF → integer units² (lat scale; class check only)
    const _perimI = (p) => {
      let t = 0;
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        t += Math.hypot(q.X - p[i].X, q.Y - p[i].Y);
      }
      return t;
    };
    const isDust = (p) => p.length < 3 || Math.abs(CL.Clipper.Area(p)) <= dustA ||
      (2 * Math.abs(CL.Clipper.Area(p)) / Math.max(1, _perimI(p))) < (tolFt / 2) * UNITS_PER_FT;
    const outerCount = (sol) => sol.reduce((n, p) => n + ((CL.Clipper.Orientation(p) && !isDust(p)) ? 1 : 0), 0);
    // Hole-area bookkeeping (SF, via the same shoelace the callers use): the
    // close can fully ENCIRCLE an unselected foreign parcel — it survives only
    // as a NEW hole ring while the outer ring swallows its ground. Measured
    // before vs after the close so enclosedSF reports exactly the land the
    // close captured (a pre-existing courtyard hole is NOT double-counted).
    const holeSF = (s) => {
      let t = 0;
      for (const p of s) { if (p.length >= 3 && !CL.Clipper.Orientation(p)) t += lotAreaSqFt([_fromClipPath(p)]); }
      return t;
    };

    let sol = runUnion(paths);
    let bridgedFt = 0;
    const plainHoleSF = holeSF(sol);           // holes BEFORE any close ran
    if (outerCount(sol) > 1 && paths.length > 1) {
      // morphological CLOSE at radius ft: dilate → union → erode → re-union
      // (the re-union canonicalizes orientation/holes after the erode)
      const closeAt = (ft) => {
        const d = Math.round((ft / FEET_PER_DEG_LAT) * CL_SCALE);   // ft → integer units
        return runUnion(off(runUnion(off(paths, d)), -d));
      };
      // hairline county-seam gaps: heal at ~tolFt (hoisted above for the weld).
      sol = closeAt(tolFt);
      /* STREET-ROW BRIDGE (the combiner's Winton failure): real town fabric
         puts a ~60 ft public right-of-way between parcels a developer picks
         as one assembly, so the seam-heal alone still yields N pieces and
         Confirm rejected every multi-lot pick. With opts.bridgeFt set, keep
         growing the close radius — SMALLEST radius that yields ONE part wins,
         so a parcel's own concave notch is never filled when a sliver-sized
         bridge already connects the assembly. The bridged ROW bed becomes
         part of the outline (raw-land assemblage semantics — callers should
         tell the user the street area was included). Radii are in deg-lat
         feet; the 0.75 cap keeps the worst-case EW (cos-lat-shrunk) reach
         under bridgeFt while NS gaps bridge a bit past it — good enough for
         a picker tolerance, and honest: far parcels still refuse. */
      const bridgeFt = Math.max(0, Number(opts.bridgeFt) || 0);
      if (outerCount(sol) > 1 && bridgeFt > 0) {
        for (const r of [5, 10, 15, 20, 30, 40, 55, 75]) {
          if (r > bridgeFt * 0.75) break;
          const s2 = closeAt(r);
          if (outerCount(s2) === 1) { sol = s2; bridgedFt = r * 2; break; }
        }
      }
    }
    // NEW hole area the close created = enclosed UNSELECTED land (audit [2]:
    // a horseshoe pick silently swallowed a ~33,000 SF foreign parcel).
    const enclosedSF = Math.round(Math.max(0, holeSF(sol) - plainHoleSF));

    // R34 output scrub + vertex budget with progressive cleaning. Clean at
    // the SNAP tolerance (the old fixed 1.5 units ≈ 1.6 cm was far below the
    // 0.05–2 ft county jitter, so seam vertices/spikes sailed through);
    // SimplifyPolygons enforces STRICTLY-SIMPLE rings (a self-touching ring
    // is split deterministically); _despike kills any remaining zero-width
    // spike; isDust drops sliver parts and hairline holes.
    const maxPts = Math.max(16, Number(opts.maxPts) || 60);
    const scrubAt = (t) => {
      let c = CL.Clipper.CleanPolygons(sol, t);
      c = CL.Clipper.SimplifyPolygons(c, CL.PolyFillType.pftNonZero);
      c = CL.Clipper.CleanPolygons(c, t);
      return c.map((p) => _despike(p, snap)).filter((p) => !isDust(p));
    };
    let tol = Math.max(1.5, snap);                     // integer units
    let clean = scrubAt(tol);
    let outers = clean.filter((p) => CL.Clipper.Orientation(p));
    let guard = 0;
    while (outers.length && Math.max(...outers.map((p) => p.length)) > maxPts && guard++ < 12) {
      tol *= 2;
      clean = scrubAt(tol);
      outers = clean.filter((p) => CL.Clipper.Orientation(p));
    }
    const holes = clean.filter((p) => !CL.Clipper.Orientation(p));
    if (!outers.length) return { ok: false, reason: 'empty-union' };
    outers.sort((a, b) => Math.abs(CL.Clipper.Area(b)) - Math.abs(CL.Clipper.Area(a)));
    const rings = [_fromClipPath(outers[0])].concat(holes.map(_fromClipPath));

    /* ---------- R35 GAP INTELLIGENCE (live, Jul 20 2026 — 626 Broadway,
       Gilroy) ---------- A 4-pick assembly wrapped a ~920 SF driveway STRIP
       PARCEL (APN 79032049) on all four sides. The union was geometrically
       honest — the strip wasn't picked, so the outline keeps a deep interior
       slot, reached through a sub-foot county-seam crack: no hole ring formed
       and enclosedSF stayed 0 (that guard only sees holes the morphological
       close CREATES). The developer got a donut with no explanation. Detect it
       here: (1) surviving hole rings are gaps kind 'hole'; (2) narrow interior
       INLETS — width ≤ ~SLOT_FT, depth ≥ 1.5× width, mouth no wider than the
       slot itself — found by closing the outer ring at ~SLOT_FT/2 and keeping
       the difference pieces that measure like a strip. Emitted as
       gaps:[{poly,sf,mouthFt,depthFt,kind}] — ADDITIVE; ok/rings/parts/
       bridgedFt/enclosedSF are untouched. ui.applyParcels asks the picker's
       neighbor fabric who OWNS each gap (flag the APN / absorb a provably
       unowned sliver). Diagnostics only: any failure → gaps [] on a good
       merge, never a changed verdict. Single-parcel input never flags its own
       courtyard notch (there is no "between your picks" with one pick). */
    const gaps = [];
    if (outers.length === 1) {
      try {
        for (const h of holes) {
          const hp = _fromClipPath(h);
          gaps.push({ poly: hp, sf: Math.round(lotAreaSqFt([hp])), mouthFt: 0, depthFt: 0, kind: 'hole' });
        }
        if (paths.length > 1) {
          const SLOT_FT = 25;                                 // widest inlet we call a slot
          const outerP = outers[0];
          let ySum = 0;
          for (const q of outerP) ySum += q.Y;
          const cosLat = Math.max(0.2, Math.cos((ySum / outerP.length / CL_SCALE) * DEG2RAD));
          // close radius: half the mouth, widened by 1/cos so an EW slot at
          // latitude still fills — the width FILTER below is the real gate
          const dR = Math.round((SLOT_FT / 2) * UNITS_PER_FT / cosLat);
          const closedSol = runUnion(off(runUnion(off([outerP], dR)), -dR));
          const dc = new CL.Clipper();
          dc.AddPaths(closedSol, CL.PolyType.ptSubject, true);
          dc.AddPath(outerP, CL.PolyType.ptClip, true);
          const diff = new CL.Paths();
          dc.Execute(CL.ClipType.ctDifference, diff, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
          // isotropic local-feet frame (EW shrunk by cos lat) for width/depth/mouth
          const iso = (q) => ({ x: q.X * cosLat / UNITS_PER_FT, y: q.Y / UNITS_PER_FT });
          const outFt = outerP.map(iso);
          const distToOuter = (p2) => {
            let best = Infinity;
            for (let i = 0; i < outFt.length; i++) {
              const a = outFt[i], b2 = outFt[(i + 1) % outFt.length];
              const ex = b2.x - a.x, ey = b2.y - a.y;
              const L2 = ex * ex + ey * ey;
              const t = L2 ? Math.max(0, Math.min(1, ((p2.x - a.x) * ex + (p2.y - a.y) * ey) / L2)) : 0;
              const dx = p2.x - (a.x + t * ex), dy = p2.y - (a.y + t * ey);
              const d2 = dx * dx + dy * dy;
              if (d2 < best) best = d2;
            }
            return Math.sqrt(best);
          };
          for (const raw of diff) {
            if (raw.length < 3 || !CL.Clipper.Orientation(raw)) continue;
            // the miter close can leave a zero-width WHISKER on a diff piece
            // (seen live: a 98-ft spur along a neighbor's edge line) that
            // inflates the bbox and hides a real slot — despike first
            const piece = _despike(raw, snap);
            if (piece.length < 3) continue;
            const gp = _fromClipPath(piece);
            const sf = lotAreaSqFt([gp]);
            if (sf < 100) continue;                           // close-fillet crumbs
            const f = piece.map(iso);
            // oriented min-area bbox: width = the slot's across dimension
            let bestA = Infinity, w = 0, depth = 0;
            for (let i = 0; i < f.length; i++) {
              const a = f[i], b2 = f[(i + 1) % f.length];
              const eL = Math.hypot(b2.x - a.x, b2.y - a.y);
              if (eL < 0.5) continue;
              const cs = (b2.x - a.x) / eL, sn = (b2.y - a.y) / eL;
              let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
              for (const q of f) {
                const x = q.x * cs + q.y * sn, y = -q.x * sn + q.y * cs;
                if (x < mnx) mnx = x; if (x > mxx) mxx = x;
                if (y < mny) mny = y; if (y > mxy) mxy = y;
              }
              const A2 = (mxx - mnx) * (mxy - mny);
              if (A2 < bestA) { bestA = A2; w = Math.min(mxx - mnx, mxy - mny); depth = Math.max(mxx - mnx, mxy - mny); }
            }
            if (!(w > 0 && w <= SLOT_FT * 1.05 && depth >= 1.5 * w)) continue;
            // mouth: piece edges NOT lying on the original outline = the opening
            // onto the exterior. A genuine slot opens no wider than its own width;
            // a broad shallow bay (or a close-corner fillet, whose hypotenuse lid
            // is ~1.41× its width) opens wide — rejected.
            let lid = 0;
            for (let i = 0; i < f.length; i++) {
              const a = f[i], b2 = f[(i + 1) % f.length];
              if (distToOuter({ x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 }) > 1.5) lid += Math.hypot(b2.x - a.x, b2.y - a.y);
            }
            if (lid > 1.4 * w) continue;
            gaps.push({ poly: gp, sf: Math.round(sf), mouthFt: Math.round(w * 10) / 10, depthFt: Math.round(depth * 10) / 10, kind: 'slot' });
          }
        }
        gaps.sort((a, b) => b.sf - a.sf);
        if (gaps.length > 4) gaps.length = 4;                 // bounded payload
      } catch (e) { gaps.length = 0; /* detection is advisory, never fatal */ }
    }
    return {
      ok: outers.length === 1,
      reason: outers.length === 1 ? '' : 'not-touching',
      rings,
      parts: outers.length,
      vertexCount: rings[0].length,
      bridgedFt,          // >0 = a street-ROW-sized close was needed (≈ widest gap bridged)
      enclosedSF,         // >0 = the close fully surrounded land that was NOT in the selection
      gaps,               // R35: interior slots/holes the outline honestly excludes (see above)
    };
  };

  /* R35: intersection AREA (SF) of two parcel outlines — how ui.applyParcels
     asks "does a real parcel OCCUPY this gap?" (a bordering neighbor touches a
     gap; only the occupant overlaps it). Outer rings only; orientation is
     normalized so a hole-wound gap poly still measures. Fail-soft 0. */
  const ringsOverlapSF = (ringsA, ringsB) => {
    const CL = _clipper();
    if (!CL) return 0;
    const A = outerRing(ringsA), B = outerRing(ringsB);
    if (A.length < 3 || B.length < 3) return 0;
    try {
      const pa = _toClipPath(A), pb = _toClipPath(B);
      if (!CL.Clipper.Orientation(pa)) pa.reverse();
      if (!CL.Clipper.Orientation(pb)) pb.reverse();
      const c = new CL.Clipper();
      c.AddPath(pa, CL.PolyType.ptSubject, true);
      c.AddPath(pb, CL.PolyType.ptClip, true);
      const sol = new CL.Paths();
      c.Execute(CL.ClipType.ctIntersection, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
      let sf = 0;
      for (const p of sol) if (p.length >= 3) sf += lotAreaSqFt([_fromClipPath(p)]);
      return Math.round(sf);
    } catch (e) { return 0; }
  };

  /* point-in-ring (ray cast) on a [lng,lat] ring. */
  const ptInRing = (lng, lat, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  };

  /* Do two parcels TOUCH (share boundary / overlap) within tolFt? Pure segment
     math in a local feet frame — used by the picker for the instant per-click
     "must be touching" check (unionRings is the final authority). */
  const ringsTouch = (ringsA, ringsB, tolFt) => {
    const tol = Math.max(0.05, Number(tolFt) || 1.0);
    const A = outerRing(ringsA), B = outerRing(ringsB);
    if (A.length < 3 || B.length < 3) return false;
    const bA = ringsBounds([A]), bB = ringsBounds([B]);
    const ftLng = FEET_PER_DEG_LAT * Math.cos(bA.centerLat * DEG2RAD);
    const padLng = tol / ftLng, padLat = tol / FEET_PER_DEG_LAT;
    if (bA.minLng - padLng > bB.maxLng || bB.minLng - padLng > bA.maxLng ||
        bA.minLat - padLat > bB.maxLat || bB.minLat - padLat > bA.maxLat) return false;
    // overlap / containment counts as touching
    if (ptInRing(B[0][0], B[0][1], A) || ptInRing(A[0][0], A[0][1], B)) return true;
    // local feet frame about A's bbox center
    const toFt = (p) => ({ x: (p[0] - bA.centerLng) * ftLng, y: (p[1] - bA.centerLat) * FEET_PER_DEG_LAT });
    const fa = A.map(toFt), fb = B.map(toFt);
    const segSegDist = (p, q, r, s) => {
      const d1 = { x: q.x - p.x, y: q.y - p.y }, d2 = { x: s.x - r.x, y: s.y - r.y };
      const ptSeg = (pt, a, b, d) => {
        const L2 = d.x * d.x + d.y * d.y;
        const t = L2 ? Math.max(0, Math.min(1, ((pt.x - a.x) * d.x + (pt.y - a.y) * d.y) / L2)) : 0;
        return Math.hypot(pt.x - (a.x + t * d.x), pt.y - (a.y + t * d.y));
      };
      return Math.min(ptSeg(p, r, s, d2), ptSeg(q, r, s, d2), ptSeg(r, p, q, d1), ptSeg(s, p, q, d1));
    };
    for (let i = 0; i < fa.length; i++) {
      const p = fa[i], q = fa[(i + 1) % fa.length];
      for (let j = 0; j < fb.length; j++) {
        if (segSegDist(p, q, fb[j], fb[(j + 1) % fb.length]) <= tol) return true;
      }
    }
    return false;
  };
  /* ---------- aerial underlay georef (WI-04) ----------
     The A1.0 site plan can show a satellite tile (same /api/staticmap proxy as
     the cover, scale=1 → no extra Maps cost) UNDER the linework. The tile is
     georeferenced by projecting its geographic corners through the SAME geoXform
     that places the subject lot + adjacent parcels, so it aligns precisely. */

  const WEBM = 156543.03392;            // Web-Mercator metres/pixel at zoom 0, equator
  const M_PER_DEG_LAT = 111320;         // metres per degree of latitude (Web-Mercator)

  /* Integer static-map zoom so a `px`-wide tile covers ~1.8× the lot's larger
     side (lot centred, neighbours visible around it). Clamped to [17,21]. */
  const aerialZoom = (spanFt, lat, px) => {
    px = px || 640;
    const targetM = Math.max(1, spanFt || 0) * 0.3048 * 1.8;     // ground span the tile should cover
    const mpp = targetM / px;
    const z = Math.log2((WEBM * Math.cos((lat || 0) * DEG2RAD)) / Math.max(1e-6, mpp));
    return Math.max(17, Math.min(21, Math.round(z)));
  };

  /* The tile's 4 geographic corners (north-up, centred on xf.lat/lng at `zoom`),
     projected through `xf` into PLAN INCHES. Returns [TL,TR,BR,BL] (a rotated
     rectangle, since projectWithXform is a similarity), or null. */
  const aerialQuad = (xf, opts) => {
    opts = opts || {};
    if (!xf || xf.lat == null || xf.lng == null || opts.zoom == null) return null;
    const w = opts.w || 640, h = opts.h || 640;
    // tile centre — default the geoXform origin, but the caller passes the LOT
    // centre's geo coords (the geocoded address can land well off the parcel).
    const lat = opts.centerLat != null ? opts.centerLat : xf.lat;
    const lng = opts.centerLng != null ? opts.centerLng : xf.lng;
    const mpp = (WEBM * Math.cos(lat * DEG2RAD)) / Math.pow(2, opts.zoom);
    const dLat = ((h / 2) * mpp) / M_PER_DEG_LAT;
    const dLng = ((w / 2) * mpp) / (M_PER_DEG_LAT * Math.max(1e-9, Math.cos(lat * DEG2RAD)));
    const corners = [                    // {x:lng, y:lat}: TL,TR,BR,BL = NW,NE,SE,SW
      { x: lng - dLng, y: lat + dLat },
      { x: lng + dLng, y: lat + dLat },
      { x: lng + dLng, y: lat - dLat },
      { x: lng - dLng, y: lat - dLat },
    ];
    const proj = projectWithXform([corners], xf);
    return (proj && proj[0]) || null;
  };

  /* Inverse of projectWithXform for a single PLAN point → {lat,lng}: undo the
     translate → un-rotate about the pivot → un-project ringsToPlan. Lets the
     aerial centre the tile on the LOT centroid instead of the geocoded address
     (round-trips with projectWithXform to sub-inch). */
  const planToGeo = (pt, xf) => {
    if (!xf || xf.lat == null || xf.lng == null || !pt) return null;
    const scale = xf.scale == null ? IN_PER_FT : xf.scale;
    const rot = xf.rot || 0, cs = Math.cos(rot), sn = Math.sin(rot);
    const px = xf.pivot ? xf.pivot.x : 0, py = xf.pivot ? xf.pivot.y : 0;
    const ax = (pt.x - (xf.dx || 0)) - px, ay = (pt.y - (xf.dy || 0)) - py;
    const p0x = px + ax * cs + ay * sn;        // un-rotate by -rot → ringsToPlan point
    const p0y = py - ax * sn + ay * cs;
    const ftPerDegLng = FEET_PER_DEG_LAT * Math.cos(xf.lat * DEG2RAD);
    return {
      lng: xf.lng + p0x / (ftPerDegLng * scale),
      lat: xf.lat - p0y / (FEET_PER_DEG_LAT * scale),
    };
  };

  /* ---------- server-proxy fetch wrappers (need the network) ----------
     Each posts JSON to our own origin; the server holds the Maps key. All
     reject with an Error carrying the server message on a non-2xx. */
  /* R164 (found during the post-deploy perf run): these calls had NO
     timeout — a stalled county GIS or a keyless proxy left the app spinning
     on "resolving" FOREVER with zero feedback (reproduced: 90s+ hang).
     Every request now aborts at a deadline, retries ONCE with an honest
     status line, and then rejects into the existing error cascades — which
     already know how to fall back (Census path) and how to say
     "↻ Re-fetch site + parcel". */
  const postJSON = async (url, payload, opts) => {
    const timeoutMs = (opts && opts.timeoutMs) || 25000;
    const tryOnce = async () => {
      const ac = (typeof AbortController === 'function') ? new AbortController() : null;
      const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
          signal: ac ? ac.signal : undefined,
        });
        let data = null;
        try { data = await resp.json(); } catch (e) { /* non-JSON error body */ }
        if (!resp.ok) {
          const msg = (data && data.error && (data.error.message || data.error)) ||
            ('parcel request failed (' + resp.status + ')');
          throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        return data;
      } finally { if (timer) clearTimeout(timer); }
    };
    const isAbort = (e) => !!e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message)));
    try { return await tryOnce(); }
    catch (e) {
      if (!isAbort(e)) throw e;
      try {
        if (HA.ui && HA.ui.setStatus) HA.ui.setStatus('The map/county service is slow — retrying…');
      } catch (e2) { /* status is best-effort */ }
      try { return await tryOnce(); }
      catch (e3) {
        if (!isAbort(e3)) throw e3;
        throw new Error('The map/county service did not answer (timed out twice). Try again in a minute, or ↻ Re-fetch site + parcel.');
      }
    }
  };

  /* Look up a parcel polygon for a street address. Server returns
     {rings, lat, lng, ...}; geometry helpers above consume rings directly. */
  const lookup = (address) => postJSON('/api/parcel', { address: String(address || '') });

  /* Geocode an address → {lat,lng,formatted,...}. */
  const geocode = (address) => postJSON('/api/geocode', { address: String(address || '') });

  /* Address TYPE-AHEAD (keyless, US-ONLY — the server hard-filters foreign
     results; Jul 11). q → {suggestions:[{label,line1,line2,city,state,postcode,
     country,countrycode,lat,lng}]}. Optional lat/lng biases results toward a
     location. Returns the suggestions array directly (input is trimmed). */
  const autocomplete = async (q, opts) => {
    const query = String(q == null ? '' : q).trim();
    if (query.length < 3) return [];
    // R164 — type-ahead gets a SHORT deadline: a suggestion that arrives in
    // 8+ seconds is useless to someone mid-keystroke, and the debounced next
    // keystroke re-asks anyway.
    const r = await postJSON('/api/places', Object.assign({ q: query }, opts || {}), { timeoutMs: 8000 });
    return (r && r.suggestions) || [];
  };

  /* ---------- RECENT SEARCHES (localStorage: pc.recentAddresses) ----------
     The last RECENTS_MAX SUCCESSFULLY-loaded addresses, most-recent first:
     [{label,line1,line2,city,state,postcode,lat,lng,ts}, ...]. Each entry is a
     full suggestion shape, so picking a recent replays ui.applySuggestion (the
     exact suggestion→parcel path) with NO re-geocode. De-duped by label
     (case-insensitive, newest wins); junk (no label / non-finite coords) is
     rejected; a corrupt or unavailable store fails soft to []. `store` is
     injectable ({getItem,setItem}) so tests run headless; the browser default
     is window.localStorage. */
  const RECENTS_KEY = 'pc.recentAddresses';
  const RECENTS_MAX = 8;
  const _recStore = () => { try { return window.localStorage || null; } catch (e) { return null; } };
  const recentAddresses = (store) => {
    const st = store || _recStore();
    try {
      const raw = st && st.getItem(RECENTS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((r) => r && r.label &&
        Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) : [];
    } catch (e) { return []; }
  };
  const rememberAddress = (entry, store) => {
    const st = store || _recStore();
    const lat = entry && Number(entry.lat), lng = entry && Number(entry.lng);
    const label = entry ? String(entry.label || '').trim() : '';
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return recentAddresses(st);
    const key = label.toLowerCase();
    const next = [{
      label,
      line1: String(entry.line1 || ''), line2: String(entry.line2 || ''),
      city: String(entry.city || ''), state: String(entry.state || ''),
      postcode: String(entry.postcode || ''),
      lat, lng, ts: Date.now(),
    }];
    for (const r of recentAddresses(st)) {
      if (String(r.label).trim().toLowerCase() === key) continue;   // de-dupe → newest wins
      next.push(r);
      if (next.length >= RECENTS_MAX) break;                        // cap
    }
    try { if (st) st.setItem(RECENTS_KEY, JSON.stringify(next)); } catch (e) { /* private mode / full — fail soft */ }
    return next;
  };

  /* Resolve a parcel directly at coordinates (a picked suggestion) — skips the
     geocode step, so it's faster + lands on the exact spot. */
  const lookupAt = (lat, lng, opts) =>
    postJSON('/api/parcel', Object.assign({ lat, lng }, opts || {}));

  /* APN → parcel (CA statewide). Returns the parcel resolve + an `address`
     block reverse-geocoded from the centroid (to auto-fill the address fields). */
  const lookupByApn = (apn) => postJSON('/api/parcel-apn', { apn: String(apn || '') });

  /* Resolve a CA parcel by the layer's OWN site-address index (house number +
     street + city) — the authoritative path; a geocoded point interpolates and
     often lands on a neighboring parcel. parts: {houseNumber, street, city, zip}. */
  const lookupSite = (parts) => postJSON('/api/parcel', { site: parts || {} });

  /* Adjacent parcels: a widened envelope query around (lat,lng) returning the
     neighboring lots (rings) for the site plan, EXCLUDING the subject `apn`.
     CA-only (the keyless statewide layer); returns {parcels:[{apn,rings,
     areaSqFt,bounds}]} — [] off-CA or on a miss (fail-soft). */
  const adjacentParcels = async (lat, lng, opts) => {
    // HARD CLIENT TIMEOUT (90s): the server's worst cold-county path is ~70s
    // (45s primary + 25s fallback layer). A stalled request used to hang the
    // promise FOREVER — the parcel scanner spun and "never came back" (Steve).
    // Now every scan settles: timeout/stall → [] and the picker's retry /
    // fallback paths run instead of spinning.
    const r = await Promise.race([
      postJSON('/api/parcels-near', Object.assign({ lat, lng }, opts || {})).catch(() => null),
      new Promise((res) => setTimeout(() => res(null), 90000)),
    ]);
    /* R36 — surface the fabric quality instead of discarding it. The server
       tags every response: fabric 'dwr' (exact) | 'fb' (approximate — offset
       a few feet, adjacent lots scatter) | fabricDown. The picker reads
       lastFabric after each scan and warns on approximate, because an
       untagged approximate load is visually identical to the old
       gaps-everywhere bug. */
    HA.parcel.lastFabric = {
      fabric: (r && r.fabric) || null,
      approx: !!(r && r.approxFabric),
      down: !!(r && r.fabricDown),
      at: Date.now(),
    };
    return (r && r.parcels) || [];
  };

  /* Reverse-geocode coordinates → nearest address suggestion. */
  const reverseGeocode = (lat, lng) => postJSON('/api/reverse', { lat, lng });

  /* Ground elevations for sample points. points: [{lat,lng}, ...]; returns
     {results:[{elevation,location,...}]}. Normalizes {x,y}/[lng,lat] inputs. */
  const elevation = (points) => {
    const list = (Array.isArray(points) ? points : [points]).map((p) => {
      const pr = asPair(p);
      return pr ? { lng: pr[0], lat: pr[1] } : null;
    }).filter(Boolean);
    return postJSON('/api/elevation', { points: list });
  };

  /* Build the URL for the server-proxied Static Maps image. This is a GET
     (an <img src> works directly) so we just assemble the query string;
     no key is exposed — the server injects it. opts:
       {lat,lng,zoom,size,maptype,scale,markers,...} */
  /* Build a /api/staticmap proxy URL in the SERVER'S contract: lat/lng/zoom/
     w/h/maptype/scale. (The old helper emitted Google-style center/size params
     the proxy never read — server saw lat=NaN and every caller got a blank
     tile; satdrape dodged it by hand-building its query, the parcel picker
     fell straight in. Steve: "the sat map does not appear".) Accepts the old
     center:'lat,lng' / size:'WxH' spellings and converts. */
  const staticMapUrl = (opts) => {
    const o = opts || {};
    let lat = o.lat, lng = o.lng;
    if ((lat == null || lng == null) && typeof o.center === 'string') {
      const m = o.center.split(',');
      lat = Number(m[0]); lng = Number(m[1]);
    }
    let w = o.w, h = o.h;
    if ((w == null || h == null) && typeof o.size === 'string') {
      const m = o.size.split('x');
      w = Number(m[0]); h = Number(m[1]);
    }
    const q = new URLSearchParams();
    if (lat != null && isFinite(lat)) q.set('lat', String(lat));
    if (lng != null && isFinite(lng)) q.set('lng', String(lng));
    if (o.zoom != null) q.set('zoom', String(o.zoom));
    q.set('w', String(Math.min(640, w || 640)));
    q.set('h', String(Math.min(640, h || 640)));
    if (o.maptype) q.set('maptype', String(o.maptype));
    if (o.scale != null) q.set('scale', String(o.scale));
    return '/api/staticmap?' + q.toString();
  };

  /* PURE (headless-tested): the "<number> <street>" synthesis row for the smart
     address search, or null when none is needed. Photon commonly returns the
     bare STREET for US residential — and (R115's measured case) sometimes a
     list where EVERY row carries a DIFFERENT house number:
     autocomplete("2056 S Maple Ave, Fresno, CA 93702") returns
     "5241 North Maple Avenue" (7 miles north) on top and never the asked
     address. The old UI rule synthesized only when the TOP row had no leading
     number, so a wrong-numbered top row left the dropdown with NO correct
     entry at all — the user's click landed a different property and the plain
     Project-tab path failed near-silently (the first symptom in Steve's
     Fresno report). R115 fixed the AI set_address tool with a house-number
     discriminator; this is the same discriminator for the interactive box:
     the typed house number must appear in SOME row, else offer exactly what
     was typed — on pick it resolves through the authoritative house-number
     path (lookupSite), which lands David's parcel in 0.2 s. */
  const synthAddressRow = (q, items) => {
    const hn = (String(q || '').match(/^\s*(\d+[A-Za-z]?)\b/) || [])[1];
    if (!hn || !Array.isArray(items) || !items.length) return null;
    const num = (hn.match(/^\d+/) || [hn])[0];
    /* R151 — anchor the check to each row's OWN leading house number. The old
       free regex over the whole line1 meant "5 5th Ave" matched the 5 in
       "5th" and concluded a row already carried house number 5 — so numbered
       streets could be offered NO correct entry at all. */
    const hasMatch = items.some((it) => {
      if (!it || it.kind === 'apn') return false;
      /* one optional letter then whitespace: '2056' and '2056B' are house
         numbers, the '5' in a bare '5th Avenue' row is an ordinal */
      const rowNum = (String(it.line1 || it.label || '').match(/^\s*(\d+)[A-Za-z]?\s/) || [])[1];
      return rowNum === num;
    });
    if (hasMatch) return null;
    /* Base row = the suggestion whose STREET matches what was typed — never
       merely the first bare row. Caught live on the PR-4 preview: typing
       "2056 S Maple Ave, Fresno" got Photon rows ordered [5241 N Maple ·
       East Washington Avenue (bare) · South East Avenue · North Maple Avenue ·
       2907 S Maple], and first-bare synthesized "2056 East Washington Avenue"
       — right number, WRONG STREET, one click from a wrong property. Score
       every row on the typed street's CORE tokens ("maple", +4 each, word
       match on the row street with its own house number stripped), +1 for a
       matching direction word (S↔South), +0.5 to prefer a bare row on ties —
       so "2907 South Maple Avenue" (5) beats bare "North Maple Avenue" (4.5)
       beats bare "East Washington Avenue" (0). No core-token match at all →
       fall back to the old first-bare behavior. */
    const stripNum = (s) => String(s || '').replace(/^\s*\d+[A-Za-z]?\s+/, '');
    const DIRS = { n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest' };
    const TYPE = /^(ave|avenue|st|street|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pl|place|cir|circle|ter|terrace|hwy|highway|pkwy|parkway)$/;
    const rest = String(q).replace(/^\s*\d+[A-Za-z]?\s*/, '');
    const typedStreet = rest.split(',')[0] || '';
    const typedTail = rest.slice(typedStreet.length).replace(/^\s*,\s*/, '').trim();
    /* R151 — unit designators are addresses' apartment tails, not street
       names: they must never score (measured: 'apt' survived the filter and
       became a +4 core token), and the tail must survive onto the synthesized
       line1 (it was silently discarded, so the A0.0 cover lost the unit). */
    const UNIT_RE = /\b(?:apt|unit|ste|suite|fl|bldg|no)\.?\s*#?\s*\S+\s*$|#\s*\S+\s*$/i;
    const unitTxt = (typedStreet.match(UNIT_RE) || [''])[0].trim();
    const streetOnly = typedStreet.replace(UNIT_RE, '').trim();
    const toks = streetOnly.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const dir = toks.map((t) => DIRS[t] || (Object.values(DIRS).indexOf(t) >= 0 ? t : null)).find(Boolean) || null;
    const core = toks.filter((t) => !DIRS[t] && Object.values(DIRS).indexOf(t) < 0 && !TYPE.test(t) && t.length > 2);
    /* R151 — lettered and direction-named streets ("E St", "W North Ave",
       "South St") empty `core` entirely, and the scorer then went BLIND: the
       exactly-correct row present in the list lost to the first bare row
       (5 of 5 measured wrong). When filtering would leave nothing, score on
       the full token set instead — a word-boundary match on 'e' or 'north'
       still separates "E Street" from "Broadway". */
    const scoreToks = core.length ? core : toks;
    const wordIn = (w, s) => new RegExp('(^|[^a-z0-9])' + w + '([^a-z0-9]|$)').test(s);
    let base = null, bestScore = 0;
    for (const it of items) {
      if (!it || it.kind === 'apn') continue;
      const rowStreet = stripNum(it.line1 || it.label).toLowerCase();
      let score = 0;
      for (const t of scoreToks) if (wordIn(t, rowStreet)) score += 4;
      if (score === 0) continue;                       // must match the street name itself
      if (dir && wordIn(dir, rowStreet)) score += 1;
      if (!/^\s*\d/.test(String(it.line1 || ''))) score += 0.5;
      if (score > bestScore) { bestScore = score; base = it; }
    }
    /* R151 — NO STREET MATCH, NO FABRICATION. The old fallback (first bare
       row, else items[0]) was the exact naive rule this function was written
       to replace, and it made synthesis ALWAYS-fire: "2056 Mapel" (one typo)
       and "2056 Elm St" (street not in the list) both fabricated "2056 East
       Washington Avenue" at the top of the dropdown, dressed as a county row,
       anchored 1.55 mi from the true parcel. When nothing on the list is the
       typed street, offering nothing is the honest answer — the noneMsg /
       retype flow already handles it. */
    if (!base) return null;
    /* the TYPED city/state/zip outrank the borrowed row's (the matched row can
       sit in a neighboring zip — 2907 S Maple is 93725, David is 93702); the
       row still lends its full street spelling and a coarse geo anchor. */
    const typedZip = (typedTail.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || '';
    const typedState = (typedTail.match(/\b([A-Z]{2})\b/) || [])[1] || '';
    const typedCity = (typedTail.split(',')[0] || '').replace(/\b[A-Z]{2}\b/, '').replace(/\b\d{5}(-\d{4})?\b/, '').trim();
    const line1 = (hn + ' ' + stripNum(base.line1 || base.label)
      + (unitTxt ? ' ' + unitTxt : '')).trim();
    const line2 = typedTail || base.line2 || '';
    return Object.assign({}, base, {
      /* R151 — this row is WHAT THE USER TYPED, resolved by house number on
         pick. It must say so: kind 'typed' (never an inherited 'apn'/'recent'
         — the APN-fallback case measurably stamped kind:'apn' onto a
         fabricated row) gets its own renderer branch, and the borrowed row's
         coordinates are DROPPED so a resolve miss can never fall back to a
         point a mile away, and a never-resolved fabrication can never be
         written into persistent recents (both measured). */
      kind: 'typed',
      lat: undefined, lng: undefined,
      line1,
      line2,
      label: (line1 + (line2 ? ', ' + line2 : '')).trim(),
      city: typedCity || base.city || '',
      state: typedState || base.state || '',
      postcode: typedZip || base.postcode || '',
    });
  };

  HA.parcel = {
    _postJSON: postJSON,   // R164 - exposed for the headless timeout test ONLY

    // pure geometry (offline)
    ringsToPlan,
    projectWithXform,
    planToGeo,
    aerialZoom,
    aerialQuad,
    squareLotToAxes,
    lotAreaSqFt,
    ringsBounds,
    // address-search row synthesis (pure — the smart input's discriminator)
    synthAddressRow,
    // multi-parcel (Developer Mode): geo-space union + touching test
    unionRings,
    ringsTouch,
    ringsOverlapSF,
    // fetch wrappers (server proxies)
    lookup,
    lookupAt,
    lookupByApn,
    lookupSite,
    adjacentParcels,
    geocode,
    autocomplete,
    reverseGeocode,
    elevation,
    staticMapUrl,
    // recent-searches store (localStorage; pure list-math, injectable store)
    recentAddresses,
    rememberAddress,
    RECENTS_KEY,
    RECENTS_MAX,
    // constants exposed for callers / tests
    FEET_PER_DEG_LAT,
  };
})();
