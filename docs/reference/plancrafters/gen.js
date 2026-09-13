/* ============================================================
   PlanCrafters — gen.js  (HA.generator)  — AUTO HOUSE GENERATOR
   Steve's dream feature: "auto house generator — fits within the
   setback, nice designs of all types, graph network (master with
   master bath), presets, 1-story / 2-story / ADU, knows if it's on
   a hill it goes into the hill, different entrances, porch tool,
   roofs automatic — it's just moving walls and creating stories."

   HA.generator.generate(model, opts) MUTATES levels/roof/foundation/
   finishes/fixtures/entrances/decks and PRESERVES model.site (lot,
   terrain, geo, frontEdge) + project + settings the user owns.

   Seeded (mulberry32): opts.seed reproduces a design byte-for-byte;
   "reroll" is a fresh seed with the same opts.

   PIPELINE (see GENERATOR-DESIGN.md):
     1 ENVELOPE  -> setback poly (fallback default lot), oriented local
                    frame u=along front, v=depth into lot.
     2 FOOTPRINT -> target-SF rect inside the envelope + style jog (L/T).
     3 ROOM GRAPH-> recursive band slices; public / service / private
                    zones; documented kitchen & master variants.
     4 WALLS     -> exterior loop + interior partitions on a 6" grid,
                    collinear merge; openings (doors on graph edges,
                    windows per room type incl. bedroom egress).
     5 PORCH     -> full / entry / none.
     6 HILLSIDE  -> terrain sampling -> basement / raised / slab.
     7 STYLE     -> preset roof (gable/hip/pitch/overhang/eave) + finishes.
     8 FIXTURES  -> kitchen/bath/bed/living/dining/laundry + room labels.

   ALL geometry below is computed in the LOCAL frame (inches, u across
   the front, v into the lot) then projected to world by toWorld().
   Rooms are ALWAYS axis-aligned rectangles in local space -> they stay
   rectangular in world space (rigid rotation), which is the quality bar.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;
  const U = HA.U;

  const GRID = 6;                 // everything snaps to a 6" grid
  const snap = (v) => Math.round(v / GRID) * GRID;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------- seeded RNG (mulberry32) ---------- */
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---------- style presets ---------- */
  // roof geometry is driven by wall.gable flags (HA.roofStyle) + roof.pitch/
  // overhang/eaveStyle — the REAL knobs the roof engine reads. `roofShape` is the
  // HA.roofStyle argument ('gable'|'hip'|'mixed'). 'modern-mono' aims a low single
  // slope: gable ends + a low pitch reads as the modern low-slope roof the engine
  // supports (there is no dedicated shed path in roof.js — verified). We store
  // roof.style as a HINT only; geometry comes from gable + pitch.
  const STYLES = {
    farmhouse: {
      label: 'Farmhouse', roofShape: 'gable', pitch: 8, overhang: 14, eave: 'closed',
      cladding: 'lap', siding: 'lap_white', sidingProduct: 'hardie_lap', roofProduct: 'ct_landmark',
      roofMat: 'shingle_charcoal', paintSW: 'SW 7005', trimSW: 'SW 6258',
      porch: 'full', longLow: false, bigGlass: false, roofStyleHint: 'gable',
    },
    craftsman: {
      label: 'Craftsman', roofShape: 'gable', pitch: 6, overhang: 24, eave: 'exposed',
      cladding: 'lap', siding: 'lap_sage', sidingProduct: 'hardie_shingle', roofProduct: 'ct_presidential',
      roofMat: 'shingle_brown', paintSW: 'SW 7038', trimSW: 'SW 7008',
      porch: 'entry', longLow: false, bigGlass: false, roofStyleHint: 'gable',
    },
    ranch: {
      label: 'Ranch', roofShape: 'hip', pitch: 4, overhang: 16, eave: 'closed',
      cladding: 'stucco', siding: 'stucco_sage', sidingProduct: 'stucco_3coat', roofProduct: 'ct_landmark',
      roofMat: 'shingle_green', paintSW: 'SW 6172', trimSW: 'SW 7008',
      porch: 'entry', longLow: true, bigGlass: false, roofStyleHint: 'hip',
    },
    modern: {
      label: 'Modern', roofShape: 'hip', pitch: 3, overhang: 20, eave: 'closed',
      cladding: 'lap', siding: 'lap_black', sidingProduct: 'lp_lap', roofProduct: 'mcelroy_ss',
      roofMat: 'metal_black', paintSW: 'SW 7069', trimSW: 'SW 7048',
      porch: 'none', longLow: false, bigGlass: true, roofStyleHint: 'hip',
    },
    'modern-mono': {
      // TRUE single-plane shed (mono-pitch) — roofShape 'shed' flips the roof engine
      // to buildShed. 2.5/12 rises to one HIGH side; the high wall carries clerestory
      // glass. Keeps the window-wall (bigGlass) living-room run.
      label: 'Modern (mono roof)', roofShape: 'shed', pitch: 2.5, overhang: 22, eave: 'closed',
      cladding: 'stucco', siding: 'stucco_gray', sidingProduct: 'stucco_3coat', roofProduct: 'mbci_ss',
      roofMat: 'metal_gray', paintSW: 'SW 7674', trimSW: 'SW 7069',
      porch: 'none', longLow: false, bigGlass: true, mono: true, roofStyleHint: 'shed',
    },
    cottage: {
      label: 'Cottage', roofShape: 'mixed', pitch: 6, overhang: 12, eave: 'closed',
      cladding: 'lap', siding: 'lap_yellow', sidingProduct: 'hardie_lap', roofProduct: 'ct_landmark',
      roofMat: 'shingle_charcoal', paintSW: 'SW 6360', trimSW: 'SW 7005',
      porch: 'entry', longLow: false, bigGlass: false, roofStyleHint: 'mixed',
    },
  };
  const STYLE_KEYS = Object.keys(STYLES);

  /* ---------- CURATED THEME PALETTES (Steve: "the trim colors and stuff — our
     general color variable — need to change when they push random too").
     Each style carries 3-5 coordinated palettes: siding SURFACE (materials-library
     id) + trim + door + shutter hexes that actually go together. The seeded roll
     picks ONE palette AS A UNIT — never independent channels (that's how you get
     clown houses). Applied by applyStyle on Generate AND Random; anything the user
     sets afterward persists until the next roll. ---------- */
  const PALETTES = {
    farmhouse: [
      { siding: 'lap_white', trim: '#2d2d2d', door: '#1c1c1c', shutter: '#1c1c1c' },   // modern farmhouse — white / black
      { siding: 'lap_sage', trim: '#f4f1ea', door: '#6f5136', shutter: '#33413a' },    // sage / cream / walnut door
      { siding: 'lap_navy', trim: '#f4f1ea', door: '#8d2f23', shutter: '#22303f' },    // navy / white / barn-red door
      { siding: 'batten_white', trim: '#f4f1ea', door: '#33413a', shutter: '#33413a' },// board&batten white / green door
      { siding: 'lap_greige', trim: '#f4f1ea', door: '#2c2f33', shutter: '#2c2f33' },  // greige / white / iron
    ],
    craftsman: [
      { siding: 'lap_sage', trim: '#e8e2d2', door: '#6f4d2c', shutter: '#4a4032' },    // sage / cream / oak (earth)
      { siding: 'lap_clay', trim: '#e5dfd0', door: '#3c4a3c', shutter: '#3c4a3c' },    // clay / cream / hunter door
      { siding: 'lap_forest', trim: '#d9cdb4', door: '#8a5a34', shutter: '#2e3a2e' },  // hunter / sand trim / oak door
      { siding: 'lap_greige', trim: '#e8e2d2', door: '#5a4632', shutter: '#4a4032' },  // greige earth tones
    ],
    ranch: [
      { siding: 'stucco_sage', trim: '#f4f1ea', door: '#6f5136', shutter: '#5b5348' },
      { siding: 'stucco_sand', trim: '#eceae2', door: '#3d4f63', shutter: '#5b5348' }, // sand / navy door
      { siding: 'stucco_white', trim: '#d8cdb8', door: '#8d2f23', shutter: '#4a4f55' },// white / red door
      { siding: 'stucco_adobe', trim: '#e6dcc4', door: '#4a3a2a', shutter: '#6b5842' },// adobe / walnut
    ],
    modern: [
      { siding: 'lap_black', trim: '#3a3d40', door: '#8a6a3a', shutter: '#2b2d30' },   // dark mono / warm-wood door
      { siding: 'lap_gray', trim: '#2c2f33', door: '#1c1c1c', shutter: '#2b2d30' },    // gray / iron
      { siding: 'batten_charcoal', trim: '#54585c', door: '#c9762c', shutter: '#3a3d40' }, // charcoal / ember door
      { siding: 'lap_white', trim: '#2c2f33', door: '#2c2f33', shutter: '#2c2f33' },   // light mono / iron accents
    ],
    'modern-mono': [
      { siding: 'stucco_gray', trim: '#3a3d40', door: '#8a6a3a', shutter: '#2b2d30' },
      { siding: 'stucco_white', trim: '#2c2f33', door: '#1c1c1c', shutter: '#2b2d30' },
      { siding: 'batten_black', trim: '#54585c', door: '#c9762c', shutter: '#3a3d40' },
      { siding: 'lap_gray', trim: '#26292c', door: '#3d4f63', shutter: '#2b2d30' },
    ],
    cottage: [
      { siding: 'lap_yellow', trim: '#f4f1ea', door: '#3d4f63', shutter: '#33413a' },  // buttercream / navy door
      { siding: 'lap_white', trim: '#f4f1ea', door: '#3c4a3c', shutter: '#3c4a3c' },   // white / hunter door
      { siding: 'lap_sage', trim: '#eceae2', door: '#8d2f23', shutter: '#33413a' },    // sage / red door
      { siding: 'lap_navy', trim: '#eceae2', door: '#e9d9a8', shutter: '#22303f' },    // navy / buttercream door
      { siding: 'lap_gray', trim: '#f4f1ea', door: '#3c4a3c', shutter: '#3c4a3c' },    // dove gray / green
    ],
  };
  /* pick a palette for a style — `pick` is an rng() function OR a numeric index.
     Pure + deterministic: one palette object as a UNIT (never mixed channels). */
  const pickPalette = (styleKey, pick) => {
    const list = PALETTES[styleKey] || PALETTES.farmhouse;
    let i = 0;
    if (typeof pick === 'function') i = Math.floor(pick() * list.length) % list.length;
    else if (Number.isFinite(pick)) i = ((Math.floor(pick) % list.length) + list.length) % list.length;
    return list[Math.max(0, Math.min(list.length - 1, i))];
  };

  /* ---------- default lot fallback (no site.lot) ----------
     60x100 lot, 20'/5'/15' setbacks -> a buildable box of 50' wide x 65' deep,
     placed so the FRONT (street) edge is at v=0. We return the ENVELOPE in local
     frame directly and a null world-transform-from-lot (identity translate). */
  const DEFAULT_LOT = { W: 60 * 12, D: 100 * 12, front: 20 * 12, side: 5 * 12, rear: 15 * 12 };

  /* ---------- local frame ----------
     Build an oriented frame from the setback envelope. origin = a corner of the
     envelope's oriented bounding box; ex = unit vector ALONG the front edge (u),
     ey = unit vector INTO the lot (v, perpendicular, pointing away from the front).
     Returns { origin, ex, ey, W (u-extent), D (v-extent) } and toWorld(u,v). */
  const buildFrame = (model) => {
    let poly = null, frontDir = null, frontMid = null;
    try {
      const sb = HA.site && HA.site.setbackLines ? HA.site.setbackLines(model) : null;
      if (sb && sb.poly && sb.poly.length >= 3) poly = sb.poly;
    } catch (e) { poly = null; }

    if (poly && poly.length >= 3) {
      // find the front edge on the LOT — STREET TRUTH first: resolveFrontEdge
      // honors an explicit site.frontEdge exactly like classifyEdges did, and
      // when none is set it consults the mapped OSM roads (siteplus
      // detectRoadFrontEdge) so a generated house FACES the real street, not
      // the blind most-north default. classifyEdges stays as the fallback.
      const lot = model.site && Array.isArray(model.site.lot) ? model.site.lot : null;
      if (lot && lot.length >= 3) {
        let fi = -1;
        try {
          const feR = (HA.siteplus && HA.siteplus.resolveFrontEdge) ? HA.siteplus.resolveFrontEdge(model) : null;
          if (feR && Number.isInteger(feR.i) && feR.i >= 0 && feR.i < lot.length) fi = feR.i;
        } catch (e) { fi = -1; }
        if (fi < 0 && HA.site.classifyEdges) {
          try {
            const kinds = HA.site.classifyEdges(lot, model.site.frontEdge);
            fi = kinds.indexOf('front');
          } catch (e) { fi = -1; }
        }
        if (fi >= 0) {
          const a = lot[fi], b = lot[(fi + 1) % lot.length];
          frontDir = U.norm(U.sub(b, a));
          frontMid = U.lerp(a, b, 0.5);
        }
      }
      if (!frontDir) frontDir = { x: 1, y: 0 };  // default: front runs east-west
      return frameFromPoly(poly, frontDir, frontMid, false);
    }

    // ---- fallback default lot: buildable envelope centered at origin ----
    const halfW = (DEFAULT_LOT.W - DEFAULT_LOT.side * 2) / 2;
    const d0 = 0, d1 = DEFAULT_LOT.D - DEFAULT_LOT.front - DEFAULT_LOT.rear;
    const env = [
      { x: -halfW, y: DEFAULT_LOT.front },
      { x: halfW, y: DEFAULT_LOT.front },
      { x: halfW, y: DEFAULT_LOT.front + d1 },
      { x: -halfW, y: DEFAULT_LOT.front + d1 },
    ];
    return frameFromPoly(env, { x: 1, y: 0 }, { x: 0, y: 0 }, true);
  };

  /* AXIS-ALIGNED frame. The 3D roof mesh, framing, dims/anno and the wall schedule
     are battle-tested on axis-aligned walls only — users draw ortho houses and the
     LOT carries the rotation. So we SNAP the frame to the nearest 90° of the
     front-edge direction (u = ±x or ±y; the 'front' still faces the street side
     conceptually) and toWorld is TRANSLATION + axis-mapping only — no arbitrary-
     angle rotation ever reaches wall coordinates.

     The buildable box is the LARGEST AXIS-ALIGNED RECTANGLE inscribed in the true
     setback poly: scanline at 6" — per-v widest u-interval, then an O(m²) band
     sweep keeps the max-area [v0,v1]×[u-intersection] rect. Containment therefore
     holds against the TRUE poly by construction. The rect corners land on the 6"
     grid, and since ex/ey are unit axis vectors every toWorld() of on-grid local
     coords is on-grid in world. */
  const frameFromPoly = (poly, frontDir, frontMid, isFallback) => {
    // 1) snap ex to the nearest axis of the front direction
    const fx = frontDir.x, fy = frontDir.y;
    const ex = Math.abs(fx) >= Math.abs(fy)
      ? { x: fx >= 0 ? 1 : -1, y: 0 }
      : { x: 0, y: fy >= 0 ? 1 : -1 };
    // 2) ey perpendicular, pointing INTO the lot (from the front edge toward the
    //    envelope centroid). Falls back to +v toward centroid when no frontMid.
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    let ey = { x: -ex.y, y: ex.x };
    const ref = frontMid || { x: cx - ey.x * 1000, y: cy - ey.y * 1000 };
    if ((cx - ref.x) * ey.x + (cy - ref.y) * ey.y < 0) ey = { x: -ey.x, y: -ey.y };

    // local coords: u = dot(p,ex), v = dot(p,ey); inverse p = ex*u + ey*v
    const toUV = (p) => ({ u: p.x * ex.x + p.y * ex.y, v: p.x * ey.x + p.y * ey.y });
    const uv = poly.map(toUV);
    let vLo = Infinity, vHi = -Infinity;
    for (const p of uv) { if (p.v < vLo) vLo = p.v; if (p.v > vHi) vHi = p.v; }

    // widest u-interval of the poly slice at a given v (even-odd crossings)
    const sliceAt = (v) => {
      const xs = [];
      for (let i = 0; i < uv.length; i++) {
        const a = uv[i], b = uv[(i + 1) % uv.length];
        if ((a.v <= v && b.v > v) || (b.v <= v && a.v > v)) {
          const t = (v - a.v) / (b.v - a.v);
          xs.push(a.u + t * (b.u - a.u));
        }
      }
      xs.sort((m, n) => m - n);
      let best = null;
      for (let i = 0; i + 1 < xs.length; i += 2)
        if (!best || xs[i + 1] - xs[i] > best.hi - best.lo) best = { lo: xs[i], hi: xs[i + 1] };
      return best;
    };

    // sample slices every 6" (nudged half a cell in so we never sit exactly on a vertex)
    const STEP = GRID;
    const nS = Math.max(2, Math.floor((vHi - vLo) / STEP));
    const S = [];
    for (let k = 0; k <= nS; k++) S.push(sliceAt(vLo + 3 + ((vHi - vLo - 6) * k) / nS));
    const vAt = (k) => vLo + 3 + ((vHi - vLo - 6) * k) / nS;

    // O(m²) band sweep: for each start slice keep the running interval intersection
    let bestRect = null;
    for (let i = 0; i < S.length; i++) {
      if (!S[i]) continue;
      let lo = S[i].lo, hi = S[i].hi;
      for (let j = i + 1; j < S.length; j++) {
        if (!S[j]) break;
        lo = Math.max(lo, S[j].lo); hi = Math.min(hi, S[j].hi);
        const w = hi - lo, d = vAt(j) - vAt(i);
        if (w < 16 * 12 || d < 14 * 12) continue;      // ignore unusable slivers
        const area = w * d;
        if (!bestRect || area > bestRect.area) bestRect = { u0: lo, u1: hi, v0: vAt(i), v1: vAt(j), area };
      }
    }
    // fallback (degenerate poly): the poly's local AABB shrunk 10% — keeps generating
    if (!bestRect) {
      let uLo = Infinity, uHi = -Infinity;
      for (const p of uv) { if (p.u < uLo) uLo = p.u; if (p.u > uHi) uHi = p.u; }
      const mU = (uHi - uLo) * 0.1, mV = (vHi - vLo) * 0.1;
      bestRect = { u0: uLo + mU, u1: uHi - mU, v0: vLo + mV, v1: vHi - mV };
    }

    // snap the rect INWARD to the 6" grid so all downstream coords are on-grid
    const u0 = Math.ceil(bestRect.u0 / GRID) * GRID;
    const u1 = Math.floor(bestRect.u1 / GRID) * GRID;
    const v0 = Math.ceil(bestRect.v0 / GRID) * GRID;
    const v1 = Math.floor(bestRect.v1 / GRID) * GRID;

    // origin (world) = local (u0,v0); toWorld = translation + axis mapping ONLY
    const origin = { x: ex.x * u0 + ey.x * v0, y: ex.y * u0 + ey.y * v0 };
    const W = u1 - u0, D = v1 - v0;
    const toWorld = (u, v) => ({
      x: origin.x + ex.x * u + ey.x * v,
      y: origin.y + ex.y * u + ey.y * v,
    });
    return { origin, ex, ey, W, D, toWorld, poly, isFallback };
  };

  /* ============================================================
     GENERATOR v2 — PROGRAM-DRIVEN, SCORED layouts.
     The v1 band-slicer crammed six rooms into one shallow back band ("designs
     are just boxes"). v2 works like a designer:
       1. PROGRAM FIRST — per-room area targets + hard minimums + aspect caps.
       2. FOOTPRINT FROM PROGRAM — the footprint W×D is DERIVED from the rooms;
          when a wing is tight we GROW DEEPER into the lot ("stretch it
          backward") before ever shrinking a room; only at the envelope limit
          do rooms drop toward minimums (and finally a bedroom, with a warn).
       3. HALL-SPINE PRIVATE WING — bedrooms organize around a real hall with
          rooms on both sides; the primary suite is its own end cluster (bed on
          the exterior corner, bath+WIC column beside it).
       4. MASSING — the 1-story plan is a 2-rect composition (public block +
          bedroom wing of different depths -> a purposeful L), not one box.
       5. SCORED SEARCH — per user seed we generate K internal candidates
          (deterministic sub-seeds) and keep the best by a design score:
          aspect, area-vs-target, hall fraction, adjacency, window access,
          privacy, massing.
     All v1 contracts hold: axis-aligned, 6" grid, connectivity, containment.
     ============================================================ */

  /* ---------- PROGRAM (inches) — targets, minimums, aspect caps ---------- */
  const PROG = {
    great: { tw: 16 * 12, td: 18 * 12, minDim: 13 * 12, asp: 1.5 },
    kitchen: { tw: 12 * 12, td: 13 * 12, minDim: 9 * 12, asp: 1.7 },
    dining: { tw: 11 * 12, td: 12 * 12, minDim: 9 * 12, asp: 1.5 },
    primary: { tw: 13 * 12, td: 15 * 12, minDim: 12 * 12, asp: 1.4 },
    pbath: { tw: 8 * 12, td: 10 * 12, minDim: 4.5 * 12 },
    wic: { tw: 6 * 12, td: 7 * 12 },
    bed: { tw: 11 * 12, td: 12 * 12, minDim: 10 * 12, asp: 1.4 },
    // CANON standard bath (Steve): long-and-skinny, ~5' x 8'-11" — the tub
    // dictates the width (5'-1" FRAMED = 5'-0" clear). On the 6" plan grid the
    // tightest centerline width that still swallows a 60" tub is 66"
    // (≈ 62.5" framed / 61.5" clear); 108" deep ≈ the 8'-11" clear minimum.
    bath: { tw: 5.5 * 12, td: 9 * 12, minDim: 4.5 * 12 },
    laundry: { tw: 6 * 12, td: 7 * 12 },
    entry: { tw: 7 * 12, td: 7 * 12 },
    office: { minDim: 8 * 12, asp: 1.7 },
    hallW: 42,               // 3'-6" clear halls
    hallFracMax: 0.12,
    circulation: 1.12,
  };

  /* ---------- rectilinear loop helpers ---------- */
  const loopEdgesOf = (loop) => {
    const E = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      if (Math.abs(a.u - b.u) < 0.5) E.push({ axis: 'v', c: a.u, a: Math.min(a.v, b.v), b: Math.max(a.v, b.v) });
      else E.push({ axis: 'h', c: a.v, a: Math.min(a.u, b.u), b: Math.max(a.u, b.u) });
    }
    return E;
  };
  const onLoop = (edges, axis, c, a, b) =>
    edges.some((e) => e.axis === axis && Math.abs(e.c - c) < 1 && Math.min(b, e.b) - Math.max(a, e.a) > 6);
  const loopArea = (loop) => {
    let s = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      s += a.u * b.v - b.u * a.v;
    }
    return Math.abs(s) / 2;
  };

  /* fill a strip of length `total` with rooms {name,kind,tgt,min,max}; stretches
     toward targets, clamps to [min,max], and closes any remainder with a CLOSET
     (or by relaxing the last room) so the strip tiles EXACTLY. Returns the list
     of {name, kind, d} with sum(d) === total, all on the 6" grid. */
  const fillStrip = (total, items) => {
    total = snap(total);
    const out = items.map((it) => ({ name: it.name, kind: it.kind, d: snap(it.tgt), min: snap(it.min), max: snap(it.max) }));
    let sum = out.reduce((s, o) => s + o.d, 0);
    // stretch (or shrink) proportionally within caps
    let guard = 40;
    while (Math.abs(sum - total) >= GRID && guard-- > 0) {
      const grow = sum < total;
      const cands = out.filter((o) => (grow ? o.d < o.max : o.d > o.min));
      if (!cands.length) break;
      for (const o of cands) {
        if (Math.abs(sum - total) < GRID) break;
        o.d += grow ? GRID : -GRID;
        sum += grow ? GRID : -GRID;
      }
    }
    let rem = total - sum;
    // absorb remainder into rooms that still have HEADROOM (d < max) first —
    // never bowl-alley a room past its cap; anything left ≥ 24" becomes a closet
    let i = 0, guard2 = 400;
    while (rem >= GRID && guard2-- > 0) {
      const o = out[i % out.length];
      if (o.d < o.max) { o.d += GRID; rem -= GRID; }
      i++;
      if (i % out.length === 0 && !out.some((x) => x.d < x.max)) break;
    }
    if (rem >= 24) { out.push({ name: 'CLOSET', kind: 'closet', d: snap(rem) }); rem = 0; }
    i = 0;
    while (rem >= GRID) { out[i % out.length].d += GRID; rem -= GRID; i++; }
    while (rem <= -GRID) { const o = out[i % out.length]; if (o.d > 3 * 12) { o.d -= GRID; rem += GRID; } i++; if (i > 400) break; }
    if (rem !== 0) out[out.length - 1].d += rem;
    return out;
  };

  /* mirror a designed candidate about u = W/2 (wing left <-> right) */
  const flipU = (cand, W) => {
    for (const plan of cand.plans) {
      for (const r of plan.rooms) { const a = W - r.u1, b = W - r.u0; r.u0 = a; r.u1 = b; }
      if (plan.stairs) { const a = W - plan.stairs.u1, b = W - plan.stairs.u0; plan.stairs.u0 = a; plan.stairs.u1 = b; }
    }
    for (const p of cand.loop) p.u = W - p.u;
    return cand;
  };

  /* ============================================================
     ATTACHED GARAGE (front-load) — the US-standard mass + the best
     "not a box" articulation (a mass projecting toward the street).

     opts.garage: 'none' | '1car' | '2car' | 'auto'
       auto = a 2-car for 3+ bed 1story/2story on a lot wide enough,
              else none.  ADU only gets a garage when EXPLICITLY asked
              ('1car'/'2car' — always the one-car corner stall, designed
              inside designADU, not here; see the ADU GARAGE block there).

     GEOMETRY (local frame, u=along front, v=depth into lot):
       The garage is an axis-aligned rectangle attached to the STREET
       side (v=0), offset to ONE side of the front entry so the door
       faces the street and the entry stays prominent. It is FLUSH with
       the main mass front, or PROJECTS 2-8ft forward (the articulation
       — preferred when the placed footprint leaves front slack). The
       shared garage↔house wall becomes the R302.6 fire-separation
       partition (tagged wall.fireSep by HA.assemblies.applyGarageProtection).

     LOOP: the composed exterior outline is re-traced from the UNION of
     the house rect-set and the garage rect on the 6" grid (a boundary
     walk) — this always yields ONE valid rectilinear polygon the roof
     engine's straight skeleton handles (L / T massing), regardless of
     any existing house jog.
     ============================================================ */

  // garage interior clear dims (inches) — real single/double stall sizes
  /* ROOF-POLICY-SPEC A4 — the seed-hashed FLUSH-BOX roll (Steve: "include some
     box designs where the garage aligns with the face and roof can pass over and
     go gable easily"). Gable-heavy styles roll a BOX massing ~45% of the time:
     the garage places FLUSH with the front (attachGarage) AND the suite bump
     flattens (design1story) so the footprint classifies FLUSH and keeps the
     style's gable vocabulary. Hash side-channel — never consumes rng(), so every
     existing seeded fixture's rng stream is unchanged. */
  const flushBoxRoll = (opts) => {
    const sty = ((opts && opts.style) || '').toLowerCase();
    const heavy = sty.indexOf('farmhouse') >= 0 || sty.indexOf('craftsman') >= 0 || sty.indexOf('cottage') >= 0;
    return heavy && ((((opts && opts.seed) || 0) * 2654435761) >>> 16) % 100 < 45;
  };

  const GARAGE_DIMS = {
    '1car': { w: 12 * 12, d: 22 * 12, door: 9 * 12 },   // 12x22 clear, 9' door
    '2car': { w: 22 * 12, d: 22 * 12, door: 16 * 12 },  // 22x22 clear, 16' door
    // ADU corner stall (Steve): one car, ~12'x20' interior min. This is the
    // wall-line rect (12'-6" x 20'-6") so the clear inside the shell ≈ 12x20.
    adu: { w: 150, d: 246, door: 9 * 12 },
  };

  // the garage mass width (interior clear + one ext2x6 wall) for a stall kind
  const GARAGE_MASS_W = (kind) => snap(GARAGE_DIMS[kind].w + 6.5);
  /* R171 (Steve: "the generate button i selected garage and it didn't show
     up" — thin 40-60ft lots): the old flat MIN_HOUSE_W = 27ft was wrong in
     BOTH directions. It BLOCKED valid narrow programs (a 2-story puts the
     beds upstairs and lays out at ~20ft — the R57 20ft-lot work; a 1-story
     2-bed needs ~24ft), silently dropping every requested garage on a
     40-55ft lot — and the driveway generator follows the garage, so those
     lots lost their driveways too (measured: garage+driveway NONE at
     40/45/50/55ft with garage:'2car' requested). It also PERMITTED a
     1-story 3-bed beside a garage at 27ft when that program's front band
     needs [foyer 5 | bath 5 | bed2 10 | hall 3.5 | bed3 10] = 33.5ft of
     minimums. The floor is what the PROGRAM actually needs: */
  const MIN_HOUSE_W_FOR = (mode, opts) => {
    if (mode !== '1story') return 20 * 12;                 // beds ride upstairs (R57: 20ft lots work)
    return ((opts && opts.beds) || 3) >= 3 ? 34 * 12 : 24 * 12;
  };

  /* decide the garage kind from the ENVELOPE (before the house is designed) and
     the width to RESERVE for it. auto = 2-car for a 3+ bed on a wide-enough lot,
     else 1-car if it fits, else none. Explicit '1car'/'2car' honor the request
     when a viable house still fits beside it (2-car degrades to 1-car if not).
     ADU / 'none' → null. Returns { kind, reserveW } | null. */
  // debug surface: why did a requested garage (not) place? Read by the
  // thin-lot harness; an array because generate() probes candidate frames.
  const _dbgGarage = [];
  const planGarage = (frame, mode, opts) => {
    const g = opts.garage;
    const done = (out, kind) => {
      _dbgGarage.push({ W: frame && frame.W, mode, g, beds: opts && opts.beds,
        need: MIN_HOUSE_W_FOR(mode, opts), out });
      return kind ? { kind, reserveW: GARAGE_MASS_W(kind) } : null;
    };
    if (mode === 'adu' || g === 'none' || g == null) return done('skip');
    const availW = frame.W - 12;
    const houseFits = (kind) => availW - GARAGE_MASS_W(kind) >= MIN_HOUSE_W_FOR(mode, opts);
    if (g === '1car') return houseFits('1car') ? done('1car', '1car') : done('none');
    if (g === '2car') return houseFits('2car') ? done('2car', '2car') : (houseFits('1car') ? done('1car-degraded', '1car') : done('none'));
    // auto
    if ((opts.beds || 3) >= 3 && houseFits('2car')) return done('2car', '2car');
    if (houseFits('1car')) return done('1car', '1car');
    return done('none');
  };

  /* trace the boundary of a UNION of axis-aligned rects on the 6" grid as a
     single rectilinear loop of {u,v} vertices (corners only). Robust cell-edge
     method: rasterize the union to grid cells, emit each filled cell's 4 unit
     boundary edges, CANCEL shared (interior) edges, then chain the surviving
     boundary edges tip-to-tail into one loop and collapse collinear runs. Works
     for any simply-connected union (house-L + garage) — no marching turn cases. */
  const traceRectUnion = (rects) => {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const r of rects) { u0 = Math.min(u0, r.u0); v0 = Math.min(v0, r.v0); u1 = Math.max(u1, r.u1); v1 = Math.max(v1, r.v1); }
    const cols = Math.round((u1 - u0) / GRID), rows = Math.round((v1 - v0) / GRID);
    if (cols < 1 || rows < 1) return null;
    const cu = (c) => u0 + c * GRID, cv = (r) => v0 + r * GRID;
    const filledAt = (c, r) => {
      const mu = cu(c) + GRID / 2, mv = cv(r) + GRID / 2;
      for (const R of rects) if (mu > R.u0 && mu < R.u1 && mv > R.v0 && mv < R.v1) return true;
      return false;
    };
    // directed boundary edges (interior on the left → CCW), keyed by grid nodes
    const edges = new Map();   // "c,r" -> next "c,r"
    const key = (c, r) => c + ',' + r;
    const add = (c0, r0, c1, r1) => edges.set(key(c0, r0), key(c1, r1));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!filledAt(c, r)) continue;
      // a cell's edge is on the boundary iff the neighbor across it is empty.
      // wind CCW in (u,v): bottom→right→top→left keeps interior on the left.
      if (!filledAt(c, r - 1)) add(c, r, c + 1, r);           // bottom edge (v const, +u)
      if (!filledAt(c + 1, r)) add(c + 1, r, c + 1, r + 1);   // right edge (u const, +v)
      if (!filledAt(c, r + 1)) add(c + 1, r + 1, c, r + 1);   // top edge (v const, -u)
      if (!filledAt(c - 1, r)) add(c, r + 1, c, r);           // left edge (u const, -v)
    }
    if (!edges.size) return null;
    // chain: follow next-pointers from any start node back to itself
    const start = edges.keys().next().value;
    const raw = [];
    let cur = start, guard = edges.size + 4;
    do {
      const [cc, rr] = cur.split(',').map(Number);
      raw.push({ u: snap(cu(cc)), v: snap(cv(rr)) });
      cur = edges.get(cur);
      if (!cur) return null;
    } while (cur !== start && guard-- > 0);
    if (raw.length < 4) return null;
    // collapse collinear runs → corner vertices only
    const pts = [];
    for (let i = 0; i < raw.length; i++) {
      const a = raw[(i - 1 + raw.length) % raw.length], b = raw[i], d = raw[(i + 1) % raw.length];
      const turn = (a.u === b.u && b.u === d.u) || (a.v === b.v && b.v === d.v);
      if (!turn) pts.push(b);   // b is a real corner (direction changes here)
    }
    return pts.length >= 4 ? pts : null;
  };

  /* attach the garage to `cand` (mutates cand.plans[0], cand.loop, cand.W,
     cand.D). Returns { kind, side, project } or null when no garage. All house
     geometry is shifted forward by the projection so the garage FRONT is the
     new v=0; the garage sits on the u-side with the most envelope slack. */
  const attachGarage = (cand, frame, style, mode, opts, rng, gPlan) => {
    if (!gPlan || !gPlan.kind) return null;
    const kind = gPlan.kind;
    const G = GARAGE_DIMS[kind];
    const availW = frame.W - 12;
    const GW = GARAGE_MASS_W(kind);                      // garage mass width (clear + one ext wall)
    // the house block occupies u∈[0, cand.W]; the garage fills the RESERVED strip
    // beside it (the house was designed narrower to make room). It goes on the side
    // with the most envelope slack so the mass sits inside the setback envelope.
    const slack = availW - cand.W;
    const side = rng() < 0.5 ? 'left' : 'right';         // deterministic per sub-seed
    // PROJECTION forward: 2-8ft when there's front slack in the placed footprint.
    // The footprint is front-biased at v≈0.25*(D slack). We can always afford at
    // least a modest projection since the garage front becomes the new datum; cap
    // by the envelope depth so house-back stays inside.
    const depthSlack = Math.max(0, (frame.D - 12) - (cand.D + 0));
    // FLUSH-GARAGE massing variant (ROOF-POLICY-SPEC A4, Steve: "include some box
    // designs where the garage aligns with the face and roof can pass over and go
    // gable easily"): gable-heavy styles roll a FLUSH placement (project = 0 — the
    // garage face ON the house front line) ~45% of the time. The massing then
    // classifies FLUSH BOX and keeps the style's gabled character; popped rolls get
    // the hip-default policy. Seeded via a HASH side-channel — rng() is still
    // consumed exactly once either way, so the rng stream (and every existing
    // seeded fixture downstream) is unchanged.
    const flushRoll = flushBoxRoll(opts);
    const rProj = rng();
    // TRUE FLUSH = exactly 0 (Steve: the 6"-proud workaround read as "a slight
    // gap in the front garage wall, don't line up"). Collinear garage/house
    // fronts are now handled at the ROOT: buildLevel splits the merged loop edge
    // at the garage corners, so the garage front stays its own wall entity and
    // the dropped-garage chain (garageWallDrop / door cut / curb / band skip)
    // keeps its dedicated wall while the faces align dead-flush.
    let project = flushRoll ? 0
      : snap(clamp(ftIn(2) + rProj * ftIn(6), 0, Math.min(ftIn(8), Math.max(0, depthSlack))));
    // SLIVER GUARD (Steve: "weird pop-out wall"): when the buildable depth barely
    // clears the house depth (depthSlack ∈ 1–23"), the clamp above lands the garage
    // 6–18" proud — a stub return wall that reads as an unintentional bump, not a
    // deliberate projection (~11% of garage placements). Collapse any sub-2ft
    // projection to FLUSH: the garage either projects a real ≥2ft or sits dead-flush
    // (handled by buildLevel's garage-corner loop split), never a sliver.
    if (project > 0 && project < ftIn(2)) project = 0;
    /* R67 — a house that came out of a NARROW parti is already a slender bar.
       Projecting the garage forward off it produces a deep two-mass step that
       assignRoofGables cannot gable, and the style's gables went EXTINCT on the
       garage-squeezed class (dev-roofpolicy-test farmhouse s19: 8-pt loop, 78"
       pop, zero gable walls). ROOF-POLICY-SPEC A4 wants the flush box exactly
       here, so a narrow bar always takes the FLUSH garage. Consumes no rng. */
    if (/^narrow/.test((cand.plans[0] && cand.plans[0].parti) || '')) project = 0;

    // shift ALL house geometry forward by `project` so the house front is at v=project
    for (const plan of cand.plans) {
      for (const rr of plan.rooms) { rr.v0 += project; rr.v1 += project; }
      if (plan.stairs) { plan.stairs.v0 += project; plan.stairs.v1 += project; }
    }
    for (const p of cand.loop) p.v += project;
    cand.D += project;

    // garage mass rect (local): front at v=0, back at v = project + GDinto where the
    // garage runs the stall depth. Its inner side abuts the house at u = seam.
    const GDinto = snap(Math.min(G.d, cand.D - ftIn(2)));   // never deeper than the house back
    let gu0, gu1, seam;
    if (side === 'left') { gu1 = 0; gu0 = snap(-GW); seam = 0; }
    else { gu0 = cand.W; gu1 = snap(cand.W + GW); seam = cand.W; }
    const gRect = { u0: gu0, v0: 0, u1: gu1, v1: snap(project + GDinto) };

    // add the GARAGE room to L0 (its own mass; connected via a man-door punched by
    // ensureConnectivity, and a garage overhead door on the street wall)
    const p0 = cand.plans[0];
    const garage = addRoom(p0, 'GARAGE', 'garage', gRect.u0, gRect.v0, gRect.u1, gRect.v1);
    garage.garage = true;
    garage._doorW = G.door;
    garage._seam = seam;
    garage._side = side;
    garage._project = project;
    // connect the garage to the nearest habitable room (a man-door on the shared
    // seam wall). Prefer a service room (laundry/hall/kitchen) — NEVER a bedroom.
    const seamRooms = p0.rooms.filter((rr) => rr !== garage && rr.kind !== 'garage' &&
      (Math.abs((side === 'left' ? rr.u0 : rr.u1) - seam) < 1) &&
      Math.min(rr.v1, gRect.v1) - Math.max(rr.v0, gRect.v0) > ftIn(3));
    const prefer = ['laundry', 'hall', 'kitchen', 'entry', 'closet', 'dining', 'living'];
    seamRooms.sort((a, b) => (prefer.indexOf(a.kind) + 100) % 100 - (prefer.indexOf(b.kind) + 100) % 100);
    const mud = seamRooms.find((rr) => rr.kind !== 'bed') || seamRooms[0];
    if (mud) { addEdge(p0, garage, mud, 'door'); garage._mud = mud.name; }

    // recompose the exterior loop from the union of the house rect-set + garage.
    // house rects = its plan rooms' bounding footprint is the loop; simplest robust
    // source is the current (shifted) loop's rects. We rebuild from: the house loop
    // polygon decomposed as its bbox MINUS any back jog is complex — instead trace
    // the union of {every L0 room rect} ∪ {garage}. Every room tiles the footprint,
    // so their union == the footprint; adding the garage extends it cleanly.
    const rects = p0.rooms.map((rr) => ({ u0: rr.u0, v0: rr.v0, u1: rr.u1, v1: rr.v1 }));
    const traced = traceRectUnion(rects);
    if (traced && traced.length >= 4) cand.loop = traced;
    // normalize u so the composed footprint starts at u=0 (garage-left made u negative)
    let minU = Infinity;
    for (const p of cand.loop) minU = Math.min(minU, p.u);
    if (minU !== 0) {
      const du = -minU;
      for (const plan of cand.plans) {
        for (const rr of plan.rooms) { rr.u0 += du; rr.u1 += du; }
        if (plan.stairs) { plan.stairs.u0 += du; plan.stairs.u1 += du; }
      }
      for (const p of cand.loop) p.u += du;
    }
    // recompute composed width from the loop
    let lo = Infinity, hi = -Infinity;
    for (const p of cand.loop) { lo = Math.min(lo, p.u); hi = Math.max(hi, p.u); }
    cand.W = hi - lo;
    cand.garage = { kind, side, project, doorW: G.door };
    return cand.garage;
  };

  /* ---------- room-plan primitives ---------- */
  const ftIn = (ft) => ft * 12;
  const mkPlan = () => ({ rooms: [], edges: [] });
  const addRoom = (plan, name, kind, u0, v0, u1, v1) => {
    const r = { name, kind, u0: snap(u0), v0: snap(v0), u1: snap(u1), v1: snap(v1) };
    plan.rooms.push(r); return r;
  };
  const addEdge = (plan, a, b, kind) => { if (a && b) plan.edges.push({ a: a.name, b: b.name, kind: kind || 'door' }); };

  /* ============================================================
     GENERATOR v3 — OPEN CONCEPT (the owner's "no open concept / closed-off
     kitchen / long hallways / just boxes" pass).

     The core of every plan is ONE contiguous open space: FOYER + GREAT ROOM +
     KITCHEN + DINING are zones of a single region with NO interior walls
     between them (rooms carry open:true; the wall builder skips any boundary
     where BOTH sides are open). The kitchen is a cabinet run on an exterior
     wall + island facing the great room; dining is a furniture zone.

     1-STORY "open-core split ranch":
       - front-left BEDROOM CLUSTER: beds side by side over a <=12ft hall
         centered on their joint; bath/laundry (or bed4) across the hall; the
         hall's east APPROACH is an open pocket flowing straight into the core.
       - right column: foyer + great room up front, kitchen + dining across
         the back (slider to the yard, sink window on the back wall).
       - PRIMARY SUITE behind the cluster (own wing, bumps past the core -> the
         L): bath/WIC column + a tiny open vest off the kitchen zone.
     Halls are SHORT (each hall room <= 12ft) and never closed tubes.
     ============================================================ */
  const design1story = (frame, style, opts, rng) => {
    const availW = frame.W - 12, availD = frame.D - 12;
    let nSec = opts.beds - 1, dropped = 0;
    const HW = PROG.hallW;   // 42" halls

    // WIDE-LOT bias (owner: "wider homes vs longer homes"): ranch W/D >= ~1.6,
    // farmhouse ~1.35 — shallower bands + wider rooms when the lot allows.
    const wideBias = style.longLow ? 1.6 : style.label === 'Farmhouse' ? 1.35 : 0;

    // program jitters (the wide bias starts shallower so the stretch reads long-low)
    let bedW = snap(ftIn(10.5) + rng() * ftIn(1.5));
    let bedD = snap(ftIn(wideBias >= 1.5 ? 11 : 11.5) + rng() * ftIn(1));
    let r2D = snap(ftIn(9.5) + rng() * ftIn(0.5));
    let foyW = snap(ftIn(6) + rng() * ftIn(1));
    let greatW = snap(ftIn(14) + rng() * ftIn(2));
    let kw = snap(ftIn(12.5) + rng() * ftIn(1));
    let dw = snap(ftIn(9) + rng() * ftIn(1));
    let gd = snap(ftIn(wideBias >= 1.5 ? 15.5 : 16.5) + rng() * ftIn(1));
    let kd = snap(ftIn(wideBias >= 1.5 ? 13 : 14.5) + rng() * ftIn(1));
    let colW = snap(ftIn(8) + rng() * ftIn(0.5));
    let sd = snap(ftIn(wideBias >= 1.5 ? 14 : 15.5) + rng() * ftIn(1.5));
    const mirror = rng() < 0.5;

    // beds=5 spreads WIDE (5th bed on the front-right corner of the core) instead
    // of stacking a third cluster row; beds=2 on a wide lot pairs the bed with a
    // front OFFICE so the cluster is wide enough for the shallow column suite.
    let bed5Mode = nSec >= 4 ? 'right' : 'none';   // beds=5: wide guest room, else 3rd cluster row
    const officePair = nSec === 1 && !!wideBias;
    let ofW = snap(ftIn(9.5));                        // front-office width (grows on wide lots)
    const clusterW = () => (nSec >= 3 ? 2 * bedW + ftIn(3) : nSec === 2 ? 2 * bedW : bedW + (officePair ? ofW : ftIn(6)));
    let CW = clusterW();
    const b5w = snap(ftIn(11));
    let RW = Math.max(foyW + greatW, kw + dw) + (bed5Mode === 'right' ? b5w : 0);
    let guard = 200;
    while (CW + RW > availW && guard-- > 0) {
      if (greatW > ftIn(13)) greatW -= GRID;
      else if (dw > ftIn(8.5)) dw -= GRID;
      else if (kw > ftIn(12)) kw -= GRID;           // never under 12' (open-frontage contract)
      else if (bedW > ftIn(10)) bedW -= GRID;
      else if (foyW > ftIn(5.5)) foyW -= GRID;
      else break;
      CW = clusterW(); RW = Math.max(foyW + greatW, kw + dw) + (bed5Mode === 'right' ? b5w : 0);
    }
    if (CW + RW > availW && bed5Mode === 'right') {
      bed5Mode = 'row3';                              // 5th bed moves to a 3rd cluster row
      // restore program widths (the shrink pass targeted the wider guest-column form)
      greatW = Math.max(greatW, snap(ftIn(14))); kw = Math.max(kw, snap(ftIn(12.5)));
      dw = Math.max(dw, snap(ftIn(9.5))); bedW = Math.max(bedW, snap(ftIn(10.5))); foyW = Math.max(foyW, snap(ftIn(6)));
      CW = clusterW(); RW = Math.max(foyW + greatW, kw + dw);
      let g3 = 200;
      while (CW + RW > availW && g3-- > 0) {
        if (greatW > ftIn(13)) greatW -= GRID;
        else if (dw > ftIn(9.5)) dw -= GRID;
        else if (kw > ftIn(12)) kw -= GRID;
        else if (bedW > ftIn(10)) bedW -= GRID;
        else if (foyW > ftIn(5.5)) foyW -= GRID;
        else break;
        CW = clusterW(); RW = Math.max(foyW + greatW, kw + dw);
      }
    }
    if (CW + RW > availW) return narrowParti(frame, style, opts, rng);   // <38' lots

    // WIDE-LOT ASPECT BIAS: widen rooms toward their caps until the target
    // width (estD * bias, bounded by the envelope) is reached.
    if (wideBias) {
      const estD = Math.max(bedD + HW + r2D + ftIn(15), gd + kd + 24);
      const targetW = Math.min(availW - 6, snap(estD * (wideBias + rng() * 0.15)));
      let g2 = 200;
      while (CW + RW < targetW && g2-- > 0) {
        if (greatW < snap(gd * 1.5)) greatW += GRID;
        else if (bedW < ftIn(13.5)) bedW += GRID;
        else if (kw < ftIn(17)) kw += GRID;
        else if (dw < ftIn(14)) dw += GRID;
        else if (foyW < ftIn(9)) foyW += GRID;
        else if (officePair && ofW < ftIn(13)) ofW += GRID;
        else break;
        CW = clusterW(); RW = Math.max(foyW + greatW, kw + dw) + (bed5Mode === 'right' ? b5w : 0);
      }
    }
    /* R175 (sweep: DINING shipped 8.5ft on 55ft-4bd) — MAKE THE PROGRAM WHOLE
       before committing widths. The shrink ladder legitimately squeezes dining
       to 8.5ft when width is scarce (the 50x55ft shallow-lot class NEEDS that
       to build at all — dev-partimin-test guards it), and the widen pass can
       re-spend slack on the great room without paying dining back. This
       post-pass TRANSFERS grid-steps into a sub-9ft dining from any room still
       above its own floor (kitchen first — RW-neutral — then great/bed/foyer),
       reverting any step the envelope can't absorb and moving to the next
       donor. When no donor can pay, dining keeps its last-resort 8.5. */
    if (dw < ftIn(9)) {
      /* donors are RIGHT-COLUMN rooms only. bedW is deliberately NOT a donor:
         shrinking the bed cluster can flip the stackedSuite trigger, which
         demands 21ft of suite depth — on the shallow-lot class that kills
         every candidate (the dev-partimin-test tight-lot guard caught it). */
      const floors = { kw: ftIn(12), greatW: ftIn(13), foyW: ftIn(5.5) };
      const dead = {};
      let g3 = 30;
      while (dw < ftIn(9) && g3-- > 0) {
        let donor = null;
        const vals = { kw, greatW, foyW };
        for (const k of ['kw', 'greatW', 'foyW']) {
          if (!dead[k] && vals[k] > floors[k]) { donor = k; break; }
        }
        if (!donor) break;
        const prev = { kw, greatW, foyW, dw, CW, RW };
        if (donor === 'kw') kw -= GRID; else if (donor === 'greatW') greatW -= GRID;
        else foyW -= GRID;
        dw += GRID;
        CW = clusterW(); RW = Math.max(foyW + greatW, kw + dw) + (bed5Mode === 'right' ? b5w : 0);
        if (CW + RW > availW) { ({ kw, greatW, foyW, dw, CW, RW } = prev); dead[donor] = true; }
      }
    }
    const W = CW + RW, uS = CW;

    // depths — cluster rows + suite wing; the suite ALWAYS bumps past the core.
    // ARTICULATION: the bump scales 2-6ft with the envelope slack so a roomy lot
    // never reads as a plain box (the L is a real jog, not a 2ft nick).
    const r3D = snap(ftIn(11.5));
    const cdOf = () => bedD + HW + r2D + (bed5Mode === 'row3' ? r3D : 0);
    let cd = cdOf();
    let DR = gd + kd;
    // a narrow cluster forces the STACKED suite (bed full width, bath/WIC row
    // behind) — that variant needs the extra depth for a 13'+ deep primary
    const stackedSuite = CW - colW < ftIn(12);
    const sdMin = stackedSuite ? ftIn(21) : ftIn(14);
    sd = Math.max(sd, sdMin);
    const slackD = Math.max(0, availD - Math.max(cd + sd, DR));
    // FLUSH-BOX roll (ROOF-POLICY-SPEC A4): the suite bump flattens to 0 so the
    // massing reads as Steve's "box design" (gables pass straight over). rng()
    // is still consumed exactly once so the seed stream is unchanged.
    const rBump = rng();
    const bump = flushBoxRoll(opts) ? 0
      : snap(clamp(ftIn(2) + rBump * ftIn(4), ftIn(2), Math.max(ftIn(2), Math.min(ftIn(6), slackD))));
    let DL = Math.max(cd + sd, DR + bump);
    sd = DL - cd;
    guard = 120;
    while (DL > availD && guard-- > 0) {
      if (sd > sdMin + 12 && DL - DR > 24) { DL -= GRID; sd = DL - cd; }
      else if (kd > ftIn(13)) { kd -= GRID; DR = gd + kd; DL = Math.max(cd + sd, DR + 24); sd = DL - cd; }
      else if (r2D > ftIn(8.5)) { r2D -= GRID; cd = cdOf(); DL = Math.max(cd + sd, DR + 24); sd = DL - cd; }
      else if (bedD > ftIn(10.5)) { bedD -= GRID; cd = cdOf(); DL = Math.max(cd + sd, DR + 24); sd = DL - cd; }
      else if (nSec > 1) {
        nSec--; dropped++;
        cd = cdOf(); DL = Math.max(cd + sd, DR + 24); sd = DL - cd;
      } else break;
    }
    if (DL > availD) return null;
    const D = DL;

    const plan = mkPlan();
    plan.parti = 'splitL';
    const mkOpen = (r) => { r.open = true; return r; };

    /* ---- bedroom cluster (front-left) ---- */
    let bed2 = null, bed3 = null, laundry = null, bath = null;
    let j;                       // bed joint the hall centers on
    if (nSec >= 2) {
      const halfW = CW / 2;
      bed2 = addRoom(plan, 'BEDROOM 2', 'bed', 0, 0, halfW, bedD);
      bed3 = addRoom(plan, 'BEDROOM 3', 'bed', halfW, 0, CW, bedD);
      bed2.tgt = bed3.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      j = snap(halfW);
    } else {
      bed2 = addRoom(plan, 'BEDROOM 2', 'bed', 0, 0, bedW, bedD);
      bed2.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      if (officePair) {
        addRoom(plan, 'OFFICE', 'office', bedW, 0, CW, bedD);   // wide lot: bed + front office pair (door off the hall)
      } else addRoom(plan, 'LINEN', 'closet', bedW, 0, CW, bedD);          // hall-side linen tower
      j = snap(Math.min(bedW, CW - ftIn(6)));
    }
    // hall band: [CL][HALL <=12ft centered on j][APPROACH -> open to the core]
    const hv0 = bedD, hv1 = bedD + HW;
    let hu0 = snap(clamp(j - ftIn(6), 0, Math.max(0, CW - ftIn(12))));
    let hu1 = snap(Math.min(hu0 + ftIn(12), CW));
    if (hu0 >= 30) {
      const cl = addRoom(plan, 'CL.', 'closet', 0, hv0, hu0, hv1);
      if (bed2) addEdge(plan, bed2, cl, 'door');   // walk-in for bed 2
    } else if (hu0 > 0) hu0 = 0;
    const hall = mkOpen(addRoom(plan, 'HALL', 'hall', hu0, hv0, hu1, hv1));
    if (hu1 < CW - 1) mkOpen(addRoom(plan, '', 'hall', hu1, hv0, CW, hv1));  // open approach to the core
    // r2 across the hall
    const r2v0 = hv1, r2v1 = hv1 + r2D;
    // helper: cap the LAUNDRY near its ~7ft target instead of handing it the whole
    // leftover of the row (Steve: "your laundry rooms are odd sizes ... fix"). A real
    // remainder (>=30") becomes a LINEN closet off the laundry; a sliver is absorbed.
    const capLaundry = (lstart) => {
      const lw = snap(clamp(ftIn(7), ftIn(5), CW - lstart));
      if (CW - lstart - lw >= 30) {
        laundry = addRoom(plan, 'LAUNDRY', 'laundry', lstart, r2v0, lstart + lw, r2v1);
        const linen = addRoom(plan, 'LINEN', 'closet', lstart + lw, r2v0, CW, r2v1);
        addEdge(plan, laundry, linen, 'door');
      } else {
        laundry = addRoom(plan, 'LAUNDRY', 'laundry', lstart, r2v0, CW, r2v1);
      }
    };
    if (nSec <= 2) {
      // CANON bath width: ~5.5' centerline (long-skinny down the r2 row depth) —
      // the old 9.5' bath came out near-square, which the canon dislikes. The
      // Math.max(hu0+42) term guarantees ≥42" of shared wall with the HALL so the
      // bath door always fits (a 66" bath left of an offset hall went doorless).
      const bw = snap(clamp(Math.max(PROG.bath.tw, hu0 + ftIn(3.5)), ftIn(5), CW - ftIn(6)));
      bath = addRoom(plan, 'BATH', 'bath', 0, r2v0, bw, r2v1);
      capLaundry(bw);
    } else {
      const b4w = snap(CW / 2 - ftIn(1.5));
      const bed4 = addRoom(plan, 'BEDROOM 4', 'bed', 0, r2v0, b4w, r2v1);
      bed4.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      const bw2 = snap(clamp(Math.max(PROG.bath.tw, hu0 + ftIn(3.5) - b4w), ftIn(5), CW - b4w - ftIn(4.5)));
      bath = addRoom(plan, 'BATH', 'bath', b4w, r2v0, b4w + bw2, r2v1);
      capLaundry(b4w + bw2);
      addEdge(plan, hall, bed4, 'door');
    }
    addEdge(plan, hall, bath, 'door');
    // 3rd cluster row (beds=5 on lots too tight for the wide guest room): 5th bed
    // + storage off a short vertical stub; ensureConnectivity guarantees the chain
    if (bed5Mode === 'row3') {
      const cv0 = r2v1, cv1 = r2v1 + r3D;
      const conn = addRoom(plan, 'HALL 2', 'hall', j, cv0, j + HW, cv1);
      const bed5 = addRoom(plan, 'BEDROOM 5', 'bed', 0, cv0, j, cv1);
      bed5.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      addRoom(plan, 'STOR.', 'closet', j + HW, cv0, CW, cv1);
      addEdge(plan, conn, bed5, 'door');
      addEdge(plan, hall, conn, 'door');
    }

    /* ---- open core (right column): foyer+great / kitchen+dining;
       beds=5 puts BEDROOM 5 on the front-right corner (guest room off the
       great zone — the wide-plan answer to a 5th bed).
       CORE FLIP (parti variety, Steve: "the kitchen can go to the front wall,
       adjust the windows correctly"): a seeded roll swaps the core rows —
       KITCHEN takes the FRONT corner (sink window lands on the street facade
       via addRoomWindows' exterior-edge pick) and the GREAT ROOM moves to the
       back with the big glazing + yard slider. Zone geometry only — walls,
       windows, doors, fixtures and the kitchen designer all re-derive from the
       plan, so everything follows the rooms. */
    // the flip is a PER-SEED arrangement identity (rolled once in generate(),
    // passed via opts) — NOT per-candidate: when each of the K candidates
    // rolled independently, the flipped ones always lost the score race to
    // their unflipped siblings by the soft kitchen↔dining adjacency penalty,
    // so the front-kitchen arrangement never actually shipped.
    // WIDTH GATE: the flipped back row is [dining | GREAT] — the great room
    // inherits what used to be the kitchen slot, so the core must be wide
    // enough to keep it >=13' (the great-room minimum) beside a real dining.
    const coreFlip = opts._coreFlip === true && bed5Mode !== 'right'
      && (RW - dw) >= ftIn(13) && dw >= ftIn(9);
    let foyer, great, kitchen, dining;
    if (coreFlip) {
      // front row: [foyer | KITCHEN]  (row depth = the kitchen band kd′ = DR-gd)
      // back row:  [dining | GREAT]   (great keeps its full target depth gd)
      const kd2 = DR - gd;
      foyer = mkOpen(addRoom(plan, 'FOYER', 'entry', uS, 0, uS + foyW, kd2));
      kitchen = mkOpen(addRoom(plan, 'KITCHEN', 'kitchen', uS + foyW, 0, W, kd2));
      kitchen.tgt = { w: PROG.kitchen.tw, d: PROG.kitchen.td };
      dining = mkOpen(addRoom(plan, 'DINING', 'dining', uS, kd2, uS + dw, DR));
      dining.tgt = { w: PROG.dining.tw, d: PROG.dining.td };
      great = mkOpen(addRoom(plan, 'GREAT ROOM', 'living', uS + dw, kd2, W, DR));
      great.tgt = { w: PROG.great.tw, d: PROG.great.td };
      addEdge(plan, foyer, kitchen, 'open');
      addEdge(plan, kitchen, great, 'open');
      addEdge(plan, kitchen, dining, 'open');
      addEdge(plan, great, dining, 'open');
      addEdge(plan, foyer, dining, 'open');
    } else {
      foyer = mkOpen(addRoom(plan, 'FOYER', 'entry', uS, 0, uS + foyW, gd));
      const greatU1 = bed5Mode === 'right' ? W - b5w : W;
      great = mkOpen(addRoom(plan, 'GREAT ROOM', 'living', uS + foyW, 0, greatU1, gd));
      great.tgt = { w: PROG.great.tw, d: PROG.great.td };
      if (bed5Mode === 'right') {
        const b5d = Math.min(gd, snap(ftIn(12)));
        const bed5 = addRoom(plan, 'BEDROOM 5', 'bed', greatU1, 0, W, b5d);
        bed5.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
        if (gd - b5d >= 30) {
          const c5 = addRoom(plan, 'CL.', 'closet', greatU1, b5d, W, gd);
          addEdge(plan, bed5, c5, 'door');
        } else bed5.v1 = gd;
        addEdge(plan, great, bed5, 'door');
      }
      dining = mkOpen(addRoom(plan, 'DINING', 'dining', uS, gd, uS + dw, DR));
      dining.tgt = { w: PROG.dining.tw, d: PROG.dining.td };
      kitchen = mkOpen(addRoom(plan, 'KITCHEN', 'kitchen', uS + dw, gd, W, DR));
      kitchen.tgt = { w: PROG.kitchen.tw, d: PROG.kitchen.td };
      addEdge(plan, foyer, great, 'open');
      addEdge(plan, great, kitchen, 'open');
      addEdge(plan, kitchen, dining, 'open');
    }
    addEdge(plan, foyer, hall, 'open');
    plan.coreFlip = coreFlip;

    /* ---- primary suite wing (behind the cluster, bumps past the core) ---- */
    const sv0 = cd, sv1 = D;
    let primary, pbath, wic;
    if (CW - colW >= ftIn(12)) {
      // column suite: vest (open, off the kitchen zone) + WIC + bath column, bed on the corner
      const cu0 = CW - colW;
      const vest = mkOpen(addRoom(plan, '', 'hall', cu0, sv0, CW, sv0 + ftIn(4)));
      wic = addRoom(plan, 'W.I.C.', 'closet', cu0, sv0 + ftIn(4), CW, sv0 + ftIn(9));
      pbath = addRoom(plan, 'PRIMARY BATH', 'bath', cu0, sv0 + ftIn(9), CW, sv1);
      primary = addRoom(plan, 'PRIMARY BEDROOM', 'bed', 0, sv0, cu0, sv1);
      addEdge(plan, vest, primary, 'door');
    } else {
      // stacked suite (narrow cluster): bed full width, WIC+bath row behind
      const rowV = snap(sv1 - ftIn(7.5));
      primary = addRoom(plan, 'PRIMARY BEDROOM', 'bed', 0, sv0, CW, rowV);
      wic = addRoom(plan, 'W.I.C.', 'closet', 0, rowV, snap(CW * 0.45), sv1);
      pbath = addRoom(plan, 'PRIMARY BATH', 'bath', snap(CW * 0.45), rowV, CW, sv1);
      // owner's entry off the casual zone — with the core flipped the kitchen
      // sits at the FRONT (not adjacent to the rear suite); the dining zone is
      // the rear-left core neighbor in both arrangements' stacked case
      addEdge(plan, coreFlip ? dining : kitchen, primary, 'door');
    }
    primary.beds = 'primary';
    primary.tgt = { w: PROG.primary.tw, d: PROG.primary.td };
    addEdge(plan, primary, wic, 'door');
    addEdge(plan, primary, pbath, 'door');
    if (laundry) addEdge(plan, hall, laundry, 'door');

    plan.frontDoorRoom = 'FOYER';
    const loop = [
      { u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: DR },
      { u: uS, v: DR }, { u: uS, v: D }, { u: 0, v: D },
    ];
    const cand = { plans: [plan], loop, W, D, dropped };
    return mirror ? flipU(cand, W) : cand;
  };

  /* ---------- NARROW-LOT 1-story (inscribed width under ~38ft) ----------
     Open-concept stacked bands: [foyer gallery | bath | bed cluster + 4' stub]
     across the front, then the open GREAT/DINING band, the open KITCHEN/nook
     band, and the primary-suite band across the back. The foyer gallery and
     the bedroom stub both flow straight into the open core — no corridors. */
  const design1storyNarrowV3 = (frame, style, opts, rng) => {
    const availW = frame.W - 12, availD = frame.D - 12;
    let nSec = opts.beds - 1, dropped = 0;
    if (nSec > 2) {
      dropped = nSec - 2; nSec = 2;
    }
    /* R67 — SETBACK TRUTH. This was `clamp(availW, 29ft, 38ft)`, and clamp()'s LOW
       bound wins: any lot narrower than 29ft of buildable width still got a 29ft
       house, so the guard below was dead code by construction and the house was
       drawn straight through the side setback (measured: 26ft lot -> 29ft house,
       162" outside the setback poly; 30ft lot -> 114"; 36ft lot -> 42"). The width
       may only ever SHRINK to the envelope. The floor is this parti's own honest
       program minimum: its front band is [foyer 5 | bath 5 | bed2 10 | hall 3.5 |
       bed3 10] = 33.5ft, and below that fillStrip crushes rooms under their
       minimums (on a 40ft lot it shipped 9ft bedrooms and a 4ft bath). Narrower
       lots are served by the other narrow partis in NARROW_PARTIS. */
    const W = snap(Math.min(availW, ftIn(38)));
    if (W < NARROW_STACK_MIN_W) return null;
    const bd = snap(ftIn(11.5) + rng() * ftIn(1));
    const gd = snap(ftIn(14.5) + rng() * ftIn(1.5));
    const kd = snap(ftIn(13) + rng() * ftIn(1));
    const sd = snap(ftIn(13.5) + rng() * ftIn(1));
    const D = bd + gd + kd + sd;
    if (D > availD) return null;
    const mirror = rng() < 0.5;
    const plan = mkPlan();
    plan.parti = 'narrow';
    const mkOpen = (r) => { r.open = true; return r; };

    // front band: foyer gallery + bath + beds around a 4' stub
    const items = [
      { name: 'FOYER', kind: 'entry', tgt: ftIn(6), min: ftIn(5), max: ftIn(7.5) },
      { name: 'BATH', kind: 'bath', tgt: ftIn(5.5), min: ftIn(5), max: ftIn(6) },   // canon: keep it skinny (tub width + walls)
      { name: 'BEDROOM 2', kind: 'bed', tgt: ftIn(11), min: ftIn(10), max: ftIn(12.5) },
      { name: 'HALL', kind: 'hall', tgt: 48, min: 42, max: 54 },
    ];
    if (nSec >= 2) items.push({ name: 'BEDROOM 3', kind: 'bed', tgt: ftIn(11), min: ftIn(10), max: ftIn(13) });
    let u = 0, foyer = null, bath = null, hallStub = null;
    const fBeds = [];
    for (const seg of fillStrip(W, items)) {
      const r = addRoom(plan, seg.name, seg.kind, u, 0, u + seg.d, bd);
      if (seg.kind === 'entry') mkOpen(r), foyer = r;
      if (seg.kind === 'hall') mkOpen(r), hallStub = r;
      if (seg.kind === 'bath') bath = r;
      if (seg.kind === 'bed') { r.tgt = { w: PROG.bed.tw, d: PROG.bed.td }; fBeds.push(r); }
      u += seg.d;
    }
    if (bath && foyer) addEdge(plan, foyer, bath, 'door');
    for (const b of fBeds) if (hallStub) addEdge(plan, hallStub, b, 'door');
    // open core: great/dining band + kitchen/nook band
    const v1 = bd, v2 = bd + gd, v3 = bd + gd + kd;
    const great = mkOpen(addRoom(plan, 'GREAT ROOM', 'living', 0, v1, snap(W * 0.58), v2));
    great.tgt = { w: PROG.great.tw, d: PROG.great.td };
    const dining = mkOpen(addRoom(plan, 'DINING', 'dining', snap(W * 0.58), v1, W, v2));
    dining.tgt = { w: PROG.dining.tw, d: PROG.dining.td };
    const kw2 = snap(clamp(ftIn(13), ftIn(11), W - ftIn(12)));
    const kitchen = mkOpen(addRoom(plan, 'KITCHEN', 'kitchen', 0, v2, kw2, v3));
    kitchen.tgt = { w: PROG.kitchen.tw, d: PROG.kitchen.td };
    mkOpen(addRoom(plan, '', 'living', kw2, v2, W, v3));   // open family nook
    addEdge(plan, foyer, great, 'open');
    addEdge(plan, great, dining, 'open');
    addEdge(plan, great, kitchen, 'open');
    // back band: primary suite + laundry
    let u2 = 0, primary = null, wic = null, pbath = null, laundry = null;
    for (const seg of fillStrip(W, [
      { name: 'PRIMARY BEDROOM', kind: 'bed', tgt: ftIn(14), min: ftIn(12), max: ftIn(17) },
      { name: 'W.I.C.', kind: 'closet', tgt: ftIn(5.5), min: ftIn(4.5), max: ftIn(7) },
      { name: 'PRIMARY BATH', kind: 'bath', tgt: ftIn(7), min: ftIn(5.5), max: ftIn(9) },
      { name: 'LAUNDRY', kind: 'laundry', tgt: ftIn(6.5), min: ftIn(5.5), max: ftIn(8) },
    ])) {
      const r = addRoom(plan, seg.name, seg.kind, u2, v3, u2 + seg.d, D);
      if (seg.name === 'PRIMARY BEDROOM') { primary = r; r.beds = 'primary'; r.tgt = { w: PROG.primary.tw, d: PROG.primary.td }; }
      if (seg.name === 'W.I.C.') wic = r;
      if (seg.name === 'PRIMARY BATH') pbath = r;
      if (seg.kind === 'laundry') laundry = r;
      u2 += seg.d;
    }
    if (primary) {
      addEdge(plan, kitchen, primary, 'door');      // owner's entry off the casual zone
      if (wic) addEdge(plan, primary, wic, 'door');
      if (pbath) addEdge(plan, primary, pbath, 'door');
    }
    if (laundry && kitchen) addEdge(plan, kitchen, laundry, 'door');
    plan.frontDoorRoom = 'FOYER';
    const loop = [{ u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: D }, { u: 0, v: D }];
    const cand = { plans: [plan], loop, W, D, dropped };
    return mirror ? flipU(cand, W) : cand;
  };

  /* ============================================================
     R67 — NARROW-LOT PARTI POOL (Steve: "your thin lots only do this basic
     design left or right, its really sucky, i dont ever see the other designs";
     "we need things for everything long and skinny ... it goes left or right
     entrance and the house is a box really").

     BEFORE: every lot whose buildable width defeated the split-L fell through to
     the ONE stacked-band parti above, which then clamped its width UP to 29ft.
     Measured over lot widths 16..60ft x 10 seeds: lots 26-50ft ALL reported
     parti 'narrow', the 26-40ft band all reported the identical 29ft x 54ft
     footprint, and the only arrangement difference across seeds was the mirror
     flip. That is exactly "left or right and the house is a box".

     NOW: a POOL of narrow partis, each a BAND RECIPE — an ordered list of
     front-to-back bands, each band a fillStrip of slots. Every recipe returns
     the SAME { plans, loop, W, D, dropped } contract design1story returns, so
     rooms / walls / roof / framing / sheets / the K-candidate scorer all keep
     working with no special-casing anywhere downstream.

     The seed picks the PRIMARY recipe (hash side-channel, like flushBoxRoll —
     consumes no rng(), so every existing seeded stream is byte-identical) and it
     STICKS: this seed's house TYPE is part of its identity, exactly like splitL
     vs centerCore on a wide lot.

     WIDTH IS A CEILING, NEVER A FLOOR: W = min(availW, recipe cap). A recipe
     whose required (non-optional) slots do not fit returns null rather than
     overhanging the setback.
     ============================================================ */

  // the stacked-band parti's honest program floor: its front band is
  // [foyer 5 | bath 5 | bed2 10 | hall 3.5 | bed3 10] = 33.5ft of minimums.
  const NARROW_STACK_MIN_W = ftIn(33.5);

  /* Drop OPTIONAL slots (last first) until the required minimums fit the strip.
     Returns the surviving slot list, or null when the requireds still overflow. */
  const fitSlots = (W, slots) => {
    const list = slots.filter(Boolean);
    const minSum = (l) => l.reduce((s, i) => s + i.min, 0);
    for (let i = list.length - 1; i >= 0 && minSum(list) > W; i--)
      if (list[i].opt) list.splice(i, 1);
    return minSum(list) <= W ? list : null;
  };

  /* Build a candidate from a band recipe.
     Slot: { name, kind, tgt, min, max, open, primary, opt, stack:[{name,kind,w}] }
       stack -> the slot is split into rows down the band depth (a WIC over a
       primary bath, say) weighted by w. */
  const designNarrowBands = (frame, style, opts, rng, recipe) => {
    const availW = frame.W - 12, availD = frame.D - 12;
    const W = snap(Math.min(availW, recipe.maxW));
    if (W < recipe.minW) return null;

    const bands = recipe.bands(rng, W, opts);
    /* MASSING ROLL (Steve: "the house is a box really"). Half the time the REAR
       band jogs in from one side by a real 3-6ft return, so the footprint is an L
       and the roof gets a genuine cross-gable/hip return instead of one flat box.
       The jog is capped by the rear band's own required minimums, so it never
       squeezes a room, and flipU sends it left or right. */
    const last = bands[bands.length - 1];
    let inset = 0;
    // ROOF-POLICY-SPEC A4 still wins: when the SEED rolled a flush box, the
    // footprint stays a box so the gable vocabulary survives. Without this the
    // jog fired on the garage-squeezed 60ft lots too (dev-roofpolicy-test:
    // "flush-only boundary" went 0 -> 4 popped, house gables 20/20 -> 16/20).
    const narrowLot = (opts._lotFrameW == null || opts._lotFrameW <= ftIn(42));
    if (recipe.insetLast && narrowLot && !opts._reservedW && !flushBoxRoll(opts) && rng() < 0.5) {
      const need = last.slots.filter((s) => !s.opt).reduce((s, x) => s + x.min, 0);
      inset = snap(clamp(ftIn(3) + rng() * ftIn(3), 0, Math.max(0, W - need)));
      if (inset < ftIn(3)) inset = 0;
    }
    for (const b of bands) {
      b.W = snap(b === last ? W - inset : W);
      b.slots = fitSlots(b.W, b.slots);
      if (!b.slots) return null;                       // a required band cannot fit
    }
    // depth: shrink bands toward their floors until the strip fits the envelope
    let D = bands.reduce((s, b) => s + b.d, 0);
    let guard = 400;
    while (D > availD && guard-- > 0) {
      const g = bands.filter((b) => b.d > b.dmin);
      if (!g.length) break;
      for (const b of g) { b.d -= GRID; D -= GRID; if (D <= availD) break; }
    }
    if (D > availD) return null;                       // too deep for the envelope
    D = snap(bands.reduce((s, b) => s + b.d, 0));

    const plan = mkPlan();
    plan.parti = recipe.key;
    const byName = {};
    let v = 0;
    for (const b of bands) {
      let u = 0;
      const segs = fillStrip(b.W, b.slots.map((s) => ({ name: s.name, kind: s.kind, tgt: s.tgt, min: s.min, max: s.max })));
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i], slot = b.slots[i];        // fillStrip may APPEND a closet -> slot undefined
        if (slot && slot.stack && slot.stack.length) {
          // split this slot into rows down the band depth
          const tot = slot.stack.reduce((s, x) => s + (x.w || 1), 0);
          let vv = v;
          for (let j = 0; j < slot.stack.length; j++) {
            const st = slot.stack[j];
            const v1 = j === slot.stack.length - 1 ? v + b.d : snap(vv + b.d * ((st.w || 1) / tot));
            const r = addRoom(plan, st.name, st.kind, u, vv, u + seg.d, Math.max(vv + 24, v1));
            if (st.open) r.open = true;
            if (st.primary) { r.beds = 'primary'; r.tgt = { w: PROG.primary.tw, d: PROG.primary.td }; }
            else if (st.kind === 'bed') r.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
            byName[st.name] = r;
            vv = r.v1;
          }
        } else {
          const r = addRoom(plan, seg.name, seg.kind, u, v, u + seg.d, v + b.d);
          if (slot && slot.open) r.open = true;
          if (slot && slot.primary) { r.beds = 'primary'; r.tgt = { w: PROG.primary.tw, d: PROG.primary.td }; }
          else if (seg.kind === 'bed') r.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
          if (seg.kind === 'kitchen') r.tgt = { w: PROG.kitchen.tw, d: PROG.kitchen.td };
          if (seg.kind === 'living' && seg.name) r.tgt = { w: PROG.great.tw, d: PROG.great.td };
          if (seg.kind === 'dining') r.tgt = { w: PROG.dining.tw, d: PROG.dining.td };
          if (seg.name) byName[seg.name] = r;
        }
        u += seg.d;
      }
      v += b.d;
    }
    for (const [a, c, kind] of recipe.links) addEdge(plan, byName[a], byName[c], kind || 'door');
    plan.frontDoorRoom = recipe.frontDoorRoom || 'FOYER';
    if (!byName[plan.frontDoorRoom]) return null;      // no entry room -> no front door
    const beds = plan.rooms.filter((r) => r.kind === 'bed').length;
    const dropped = Math.max(0, (opts.beds || 3) - beds);
    const vJog = snap(D - last.d);
    const loop = inset > 0
      ? [{ u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: vJog }, { u: W - inset, v: vJog }, { u: W - inset, v: D }, { u: 0, v: D }]
      : [{ u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: D }, { u: 0, v: D }];
    const cand = { plans: [plan], loop, W, D, dropped };
    return rng() < 0.5 ? flipU(cand, W) : cand;        // left/right entrance mirror
  };

  const jit = (rng, lo, hi) => snap(ftIn(lo) + rng() * ftIn(hi - lo));

  /* A full-width OPEN circulation band. Every recipe hangs its private rooms off
     one of these, which is what structurally guarantees the plan contracts the
     v2/v3 suites check: every secondary bedroom has >=36" of shared wall with a
     hall, the bath is off the hall, and the owner's suite is entered from the
     hall rather than through the living zone. It is split into <=12ft rooms (only
     the first is named) for exactly the reason design1story does it — scoreCand
     punishes any single hall room longer than 12ft as a corridor. */
  const hallRow = (W, name) => {
    const n = Math.max(1, Math.ceil(W / ftIn(11.5)));
    const slots = [];
    for (let i = 0; i < n; i++)
      slots.push({ name: i === 0 ? (name || 'HALL') : '', kind: 'hall', tgt: snap(W / n), min: ftIn(3), max: ftIn(12), open: 1 });
    return slots;
  };
  const hallBand = (W, depth) => ({ d: depth, dmin: depth, slots: hallRow(W) });

  /* ---- the recipes. Each one is a genuinely different narrow-lot HOUSE TYPE
     (not the same plan mirrored): where the living zone sits relative to the
     street, where the owner's suite sits, and how you circulate. ---- */
  const NARROW_RECIPES = [
    /* FRONT-LIVING — living room on the street (front porch type), bedrooms in
       the middle off a full-width hall, owner's suite behind them, and the
       kitchen/dining zone across the BACK opening to the yard. A side GALLERY
       slot threads each blocking band so circulation runs front to back without
       walking through a bedroom or the suite. */
    {
      key: 'narrowFront', minW: ftIn(20.5), maxW: ftIn(38), insetLast: 1,
      bands: (rng, W) => [
        { d: jit(rng, 14.5, 16), dmin: ftIn(13), slots: [
          { name: 'FOYER', kind: 'entry', tgt: ftIn(6), min: ftIn(5), max: ftIn(8), open: 1 },
          { name: 'GREAT ROOM', kind: 'living', tgt: ftIn(17), min: ftIn(13), max: ftIn(30), open: 1 },
        ] },
        // each secondary bed carries a reach-in CLOSET as a strip across its STREET
        // side — that keeps the bed's own back edge on the hall band behind it (the
        // "secondary bed off a hall" contract) and its side wall exterior (egress).
        { d: jit(rng, 13.5, 14.5), dmin: ftIn(12.5), slots: [
          { name: '_BED2COL', kind: 'bed', tgt: ftIn(11), min: ftIn(10), max: ftIn(13.5),
            stack: [{ name: 'CL.', kind: 'closet', w: 1 }, { name: 'BEDROOM 2', kind: 'bed', w: 4.5 }] },
          { name: 'GALLERY', kind: 'hall', tgt: 48, min: 42, max: 54, open: 1 },
          { name: 'BATH', kind: 'bath', tgt: ftIn(5.5), min: ftIn(5), max: ftIn(6.5) },
          { name: '_BED3COL', kind: 'bed', tgt: ftIn(11), min: ftIn(10), max: ftIn(13.5), opt: 1,
            stack: [{ name: 'CL. 2', kind: 'closet', w: 1 }, { name: 'BEDROOM 3', kind: 'bed', w: 4.5 }] },
        ] },
        hallBand(W, ftIn(3.5)),
        { d: jit(rng, 13.5, 15), dmin: ftIn(12.5), slots: [
          { name: 'GALLERY 2', kind: 'hall', tgt: 48, min: 42, max: 54, open: 1 },
          { name: '_SUITECOL', kind: 'closet', tgt: ftIn(6.5), min: ftIn(5), max: ftIn(10),
            stack: [{ name: 'W.I.C.', kind: 'closet', w: 1 }, { name: 'PRIMARY BATH', kind: 'bath', w: 1.35 }] },
          { name: 'PRIMARY BEDROOM', kind: 'bed', tgt: ftIn(13), min: ftIn(12), max: ftIn(22), primary: 1 },
        ] },
        { d: jit(rng, 13, 14.5), dmin: ftIn(12), slots: [
          { name: 'LAUNDRY', kind: 'laundry', tgt: ftIn(6), min: ftIn(5.5), max: ftIn(8), opt: 1 },
          { name: 'KITCHEN', kind: 'kitchen', tgt: ftIn(12), min: ftIn(9), max: ftIn(19), open: 1 },
          { name: 'DINING', kind: 'dining', tgt: ftIn(11), min: ftIn(9), max: ftIn(19), open: 1 },
        ] },
      ],
      links: [['FOYER', 'GREAT ROOM', 'open'], ['GREAT ROOM', 'GALLERY', 'open'],
        ['GALLERY', 'BEDROOM 2'], ['GALLERY', 'BATH'], ['GALLERY', 'HALL', 'open'],
        ['HALL', 'BEDROOM 2'], ['HALL', 'BEDROOM 3'], ['HALL', 'BATH'],
        ['HALL', 'PRIMARY BEDROOM'], ['HALL', 'GALLERY 2', 'open'],
        ['PRIMARY BEDROOM', 'W.I.C.'], ['PRIMARY BEDROOM', 'PRIMARY BATH'],
        ['GALLERY 2', 'KITCHEN', 'open'], ['KITCHEN', 'DINING', 'open'], ['KITCHEN', 'LAUNDRY']],
    },
    /* REAR-LIVING ("reverse") — bedrooms front on the street, the owner's suite
       in the middle off a gallery, and the great room across the BACK opening to
       the yard. Different zone graph AND a different street facade (bedroom
       windows, not a living-room bay) from narrowFront. */
    {
      key: 'narrowRear', minW: ftIn(25.5), maxW: ftIn(38), insetLast: 1,
      bands: (rng, W) => [
        { d: jit(rng, 11.5, 12.5), dmin: ftIn(10.5), slots: [
          { name: 'FOYER', kind: 'entry', tgt: ftIn(6), min: ftIn(5), max: ftIn(8), open: 1 },
          { name: 'BEDROOM 2', kind: 'bed', tgt: ftIn(11), min: ftIn(10), max: ftIn(14) },
          // the shared closet strip sits BETWEEN the two street-facing beds so both
          // get clothes storage while both keep their street window for egress.
          // R174 (sweep: a 2.0ft closet SHIPPED at 40ft) — 30" is the reach-in
          // floor; below it the strip is a useless sliver, so the band takes the
          // 6" from the beds' 10-14ft range instead.
          { name: 'CL.', kind: 'closet', tgt: ftIn(2.5), min: ftIn(2.5), max: ftIn(4) },
          { name: 'BEDROOM 3', kind: 'bed', tgt: ftIn(11), min: ftIn(10), max: ftIn(14), opt: 1 },
        ] },
        hallBand(W, ftIn(3.5)),
        { d: jit(rng, 14, 15.5), dmin: ftIn(13), slots: [
          { name: 'BATH', kind: 'bath', tgt: ftIn(5.5), min: ftIn(5), max: ftIn(7) },
          { name: 'GALLERY', kind: 'hall', tgt: 48, min: 42, max: 54, open: 1 },
          { name: '_SUITECOL', kind: 'closet', tgt: ftIn(6.5), min: ftIn(5), max: ftIn(10),
            stack: [{ name: 'W.I.C.', kind: 'closet', w: 1 }, { name: 'PRIMARY BATH', kind: 'bath', w: 1.35 }] },
          { name: 'PRIMARY BEDROOM', kind: 'bed', tgt: ftIn(13), min: ftIn(12), max: ftIn(22), primary: 1 },
        ] },
        { d: jit(rng, 14.5, 16), dmin: ftIn(13), slots: [
          { name: 'LAUNDRY', kind: 'laundry', tgt: ftIn(6), min: ftIn(5.5), max: ftIn(8), opt: 1 },
          { name: 'KITCHEN', kind: 'kitchen', tgt: ftIn(11), min: ftIn(9), max: ftIn(14), open: 1 },
          { name: 'DINING', kind: 'dining', tgt: ftIn(10), min: ftIn(9), max: ftIn(14), open: 1, opt: 1 },
          { name: 'GREAT ROOM', kind: 'living', tgt: ftIn(15), min: ftIn(13), max: ftIn(24), open: 1 },
        ] },
      ],
      links: [['FOYER', 'HALL', 'open'], ['HALL', 'BEDROOM 2'], ['HALL', 'BEDROOM 3'], ['HALL', 'BATH'],
        ['HALL', 'GALLERY', 'open'], ['HALL', 'PRIMARY BEDROOM'], ['GALLERY', 'KITCHEN', 'open'],
        ['PRIMARY BEDROOM', 'W.I.C.'], ['PRIMARY BEDROOM', 'PRIMARY BATH'],
        ['KITCHEN', 'DINING', 'open'], ['KITCHEN', 'GREAT ROOM', 'open'], ['DINING', 'GREAT ROOM', 'open'],
        ['KITCHEN', 'LAUNDRY']],
    },
    /* CROSS-HALL — THE 3-BEDROOM NARROW PLAN (R68).

       MEASURED CLIFF (28-46ft lots x 8 seeds, 100ft deep, default 5ft sides,
       "3 bed" requested):
         lot 28-36ft -> 2 beds on 8/8 seeds, "requested 3 bedrooms; selected
         plan fits 2"; lot 38ft -> 3 beds on 6/8; lot 40ft+ -> 3 beds on 8/8.

       WHY, with the numbers. Every pre-R68 narrow recipe put BOTH secondary
       bedrooms in ONE band together with something else, and that something
       else is what broke:
         narrowFront band 2 = BED2 10' + GALLERY 3'-6" + BATH 5' + BED3 10'
                            = 28.5ft of house width for 3 beds
         narrowRear  band 1 = FOYER 5' + BED2 10' + CL. 2' + BED3 10'
                            = 27.0ft of house width for 3 beds
       BED3 is the optional slot in both, so fitSlots silently dropped it. House
       width is (buildable - 1ft of wall margin), so narrowFront needed a 39.5ft
       lot and narrowRear a 38ft lot at 5ft side setbacks. 36ft gives 25ft of
       house width — 2ft short of the cheapest 3-bed band in the pool. That is
       the whole cliff: NOT the bedroom minimum, NOT the stair, NOT the
       setbacks — the BATH and the FOYER riding in the bedroom band.

       THE FIX IS A PARTI, NOT A FUDGE. Two 10ft bedrooms either side of a 3'-6"
       gallery is 23.5ft, which fits 25ft with room to spare. So this recipe
       pulls the bath OUT of the bedroom band and into a proper CROSS HALL
       behind it — the hall is 9'-6" deep instead of 3'-6" and carries the
       family bath at one end (5'-6" x 9'-6", a real tub bay: PROG.bath wants
       66" x 108"). The cross hall then serves all three bedrooms, the bath and
       the owner's suite, which is the classic narrow-lot center-hall plan.

       Cost: depth. Its bands floor at 59ft where narrowFront floors at 53.5ft,
       so on a shallow lot it self-rejects and narrowFront takes over. That is
       the honest trade — a narrow 3-bed IS a deep house.

       FLOOR: 23.5ft of house width = 24.5ft buildable = a 34.5ft lot at 5ft
       side yards. Below that the generator says so instead of downgrading. */
    {
      /* WIDTH WINDOW [23.5, 32.5]. The ceiling is not taste, it is tiling: the
         bed band's slot maxima sum to 14 + 4.5 + 14 = 32.5ft, so on a wider
         strip fillStrip closes the remainder with an appended CLOSET — which
         lands OUTBOARD of BEDROOM 3 and takes away the exterior wall its egress
         window needs (caught on a 48ft lot, seed 5: "BEDROOM 3 has an egress
         window" failed, bed at u10.0-24.0 with the house edge at u5.5).
         maxAvailW is pinned EQUAL to maxW rather than the usual +1ft so this
         recipe is only ever offered where W = availW — it always fills its
         envelope, never leaves buildable width on the table. Above 32.5ft the
         other three narrow partis all seat three bedrooms anyway. */
      key: 'narrowCross', minW: ftIn(23.5), maxW: ftIn(32.5), maxAvailW: ftIn(32.5),
      insetLast: 1, beds3MinW: ftIn(23.5),
      bands: (rng, W) => [
        { d: jit(rng, 14.5, 16), dmin: ftIn(13), slots: [
          { name: 'FOYER', kind: 'entry', tgt: ftIn(6), min: ftIn(5), max: ftIn(8), open: 1 },
          { name: 'GREAT ROOM', kind: 'living', tgt: ftIn(17), min: ftIn(13), max: ftIn(30), open: 1 },
        ] },
        /* the 3-bed band. NEITHER bed column is optional — this recipe exists to
           deliver 3 bedrooms, so if they do not fit it returns null and another
           recipe answers, rather than shipping a silent 2-bed. Each bed carries
           its reach-in closet as a strip on the STREET side so the bedroom's own
           back edge lands on the cross hall and its side wall stays exterior
           (egress window). The GALLERY between them is the front-to-back route
           from the living zone to the hall. */
        { d: jit(rng, 13.5, 14.5), dmin: ftIn(12.5), slots: [
          { name: '_BED2COL', kind: 'bed', tgt: ftIn(10.75), min: ftIn(10), max: ftIn(14),
            stack: [{ name: 'CL.', kind: 'closet', w: 1 }, { name: 'BEDROOM 2', kind: 'bed', w: 4.5 }] },
          { name: 'GALLERY', kind: 'hall', tgt: 48, min: 42, max: 54, open: 1 },
          { name: '_BED3COL', kind: 'bed', tgt: ftIn(10.75), min: ftIn(10), max: ftIn(14),
            stack: [{ name: 'CL. 2', kind: 'closet', w: 1 }, { name: 'BEDROOM 3', kind: 'bed', w: 4.5 }] },
        ] },
        /* THE CROSS HALL. Deep enough to be a room band, so the family bath
           lives here at one end instead of eating the bedroom band. The hall
           runs to u=0 so it still reaches GALLERY 2 in the suite band behind. */
        { d: jit(rng, 9.5, 10.5), dmin: ftIn(9), slots: hallRow(W - ftIn(5.5)).concat([
          { name: 'BATH', kind: 'bath', tgt: ftIn(5.5), min: ftIn(5), max: ftIn(6.5) },
        ]) },
        { d: jit(rng, 13.5, 15), dmin: ftIn(12.5), slots: [
          { name: 'GALLERY 2', kind: 'hall', tgt: 48, min: 42, max: 54, open: 1 },
          { name: '_SUITECOL', kind: 'closet', tgt: ftIn(6.5), min: ftIn(5), max: ftIn(10),
            stack: [{ name: 'W.I.C.', kind: 'closet', w: 1 }, { name: 'PRIMARY BATH', kind: 'bath', w: 1.35 }] },
          { name: 'PRIMARY BEDROOM', kind: 'bed', tgt: ftIn(13), min: ftIn(12), max: ftIn(22), primary: 1 },
        ] },
        { d: jit(rng, 13, 14.5), dmin: ftIn(12), slots: [
          { name: 'LAUNDRY', kind: 'laundry', tgt: ftIn(6), min: ftIn(5.5), max: ftIn(8), opt: 1 },
          { name: 'KITCHEN', kind: 'kitchen', tgt: ftIn(12), min: ftIn(9), max: ftIn(19), open: 1 },
          { name: 'DINING', kind: 'dining', tgt: ftIn(11), min: ftIn(9), max: ftIn(19), open: 1 },
        ] },
      ],
      links: [['FOYER', 'GREAT ROOM', 'open'], ['GREAT ROOM', 'GALLERY', 'open'],
        ['GALLERY', 'HALL', 'open'], ['GALLERY', 'BEDROOM 2'], ['GALLERY', 'BEDROOM 3'],
        ['HALL', 'BEDROOM 2'], ['HALL', 'BEDROOM 3'], ['HALL', 'BATH'],
        ['HALL', 'PRIMARY BEDROOM'], ['HALL', 'GALLERY 2', 'open'],
        ['PRIMARY BEDROOM', 'W.I.C.'], ['PRIMARY BEDROOM', 'PRIMARY BATH'],
        ['GALLERY 2', 'KITCHEN', 'open'], ['KITCHEN', 'DINING', 'open'], ['KITCHEN', 'LAUNDRY']],
    },
    /* CENTER-ENTRY (R177, Steve: "the main house entrance is always right and
       left not on center … like an architect would") — the classic center-door
       cottage facade: [BEDROOM 2 | FOYER | BEDROOM 3] across the street front,
       both beds keeping TRUE street windows flanking a centered door, the
       foyer spine running straight back into a deep cross hall (family bath
       at one end, a LINEN at the other — the R68 cross-hall trick, so neither
       rides the bedroom band) and on to the suite + rear living zone
       (narrowRear's proven back half). The front beds trade dedicated closet
       slots for the facade — the 1920s-cottage trade; wardrobes are the
       real-world answer at this width.
       FRONT-BAND MINIMUMS SUM TO 27.5ft ON PURPOSE (10.5 + 6.5 + 10.5): a
       center-hall plan wants a real foyer and symmetric beds — and 27.5
       equals narrowRear's 3-bed width, so the depth-cost gate below (which
       confines any recipe that is strictly narrower AND deeper than an
       alternative) leaves this one its full [27.5, 36] range. */
    {
      key: 'narrowCenter', minW: ftIn(27.5), maxW: ftIn(36), maxAvailW: ftIn(36),
      insetLast: 1, beds3MinW: ftIn(27.5),
      bands: (rng, W) => [
        { d: jit(rng, 12, 13.5), dmin: ftIn(11), slots: [
          { name: 'BEDROOM 2', kind: 'bed', tgt: ftIn(11), min: ftIn(10.5), max: ftIn(14) },
          { name: 'FOYER', kind: 'entry', tgt: ftIn(6.5), min: ftIn(6.5), max: ftIn(8), open: 1 },
          { name: 'BEDROOM 3', kind: 'bed', tgt: ftIn(11), min: ftIn(10.5), max: ftIn(14) },
        ] },
        /* the deep cross hall: bath first (its span sits behind BEDROOM 2, so
           the hall's remaining span behind each bed stays >= a door), linen
           opposite. The hall row's first slot keeps the name 'HALL'. */
        { d: jit(rng, 9.5, 10.5), dmin: ftIn(9), slots: [
          { name: 'BATH', kind: 'bath', tgt: ftIn(5.5), min: ftIn(5), max: ftIn(6.5) },
        ].concat(hallRow(W - ftIn(8.5))).concat([
          { name: 'LINEN', kind: 'closet', tgt: ftIn(3), min: ftIn(2.5), max: ftIn(4), opt: 1 },
        ]) },
        { d: jit(rng, 14, 15.5), dmin: ftIn(13), slots: [
          { name: 'GALLERY', kind: 'hall', tgt: 48, min: 42, max: 54, open: 1 },
          { name: '_SUITECOL', kind: 'closet', tgt: ftIn(6.5), min: ftIn(5), max: ftIn(10),
            stack: [{ name: 'W.I.C.', kind: 'closet', w: 1 }, { name: 'PRIMARY BATH', kind: 'bath', w: 1.35 }] },
          { name: 'PRIMARY BEDROOM', kind: 'bed', tgt: ftIn(13), min: ftIn(12), max: ftIn(22), primary: 1 },
        ] },
        { d: jit(rng, 14.5, 16), dmin: ftIn(13), slots: [
          { name: 'LAUNDRY', kind: 'laundry', tgt: ftIn(6), min: ftIn(5.5), max: ftIn(8), opt: 1 },
          { name: 'KITCHEN', kind: 'kitchen', tgt: ftIn(11), min: ftIn(9), max: ftIn(14), open: 1 },
          { name: 'DINING', kind: 'dining', tgt: ftIn(10), min: ftIn(9), max: ftIn(14), open: 1, opt: 1 },
          { name: 'GREAT ROOM', kind: 'living', tgt: ftIn(15), min: ftIn(13), max: ftIn(24), open: 1 },
        ] },
      ],
      links: [['FOYER', 'HALL', 'open'], ['HALL', 'BEDROOM 2'], ['HALL', 'BEDROOM 3'],
        ['HALL', 'BATH'], ['HALL', 'LINEN'], ['HALL', 'GALLERY', 'open'],
        ['HALL', 'PRIMARY BEDROOM'],
        ['PRIMARY BEDROOM', 'W.I.C.'], ['PRIMARY BEDROOM', 'PRIMARY BATH'],
        ['GALLERY', 'KITCHEN', 'open'], ['KITCHEN', 'DINING', 'open'],
        ['KITCHEN', 'GREAT ROOM', 'open'], ['DINING', 'GREAT ROOM', 'open'],
        ['KITCHEN', 'LAUNDRY']],
    },
    /* RAILROAD / rowhouse — the genuinely thin one. Full-width bands front to
       back off a short circulation stub, 2 bedrooms. Deep: it needs ~63ft of
       buildable depth, so it self-rejects on shallow lots. */
    {
      /* FLOOR = 15ft of HOUSE width (16ft of buildable, after the 6" wall margin
         each side). That number is the Chicago answer to Steve's "i went to a lot
         in chicago and it was like 20' and no house design would fit": Chicago
         allows 2ft side yards on a lot that narrow, which leaves exactly 16ft
         buildable. A 15ft-wide rowhouse is a real product (the Chicago workers'
         cottage), and at that width the great room lands at 10ft — UNDER the 13ft
         PROG.great minimum on purpose. scoreCand still penalises it, so this only
         ever wins when nothing better fits, which is exactly right. It will NOT
         fit the app's default 5ft side setbacks (10ft left) — and the failure
         message now names that constraint instead of shrugging. */
      /* OFFERED ONLY WHEN NOTHING ELSE FITS (maxAvailW below narrowFront's floor).
         UNFINISHED, and deliberately scoped that way: this parti's rear band is
         the owner's suite, so it has no rear yard door — the v3 rear-access
         contract in dev-generator-test would fail if it ever won on a normal lot.
         Confined to sub-20.5ft envelopes it is the difference between a house and
         an error message, which is the trade worth making. Write-up in the report. */
      key: 'narrowRailroad', minW: ftIn(15), maxW: ftIn(20), maxAvailW: ftIn(20.4),
      bands: (rng, W) => [
        { d: jit(rng, 14, 15), dmin: ftIn(12.5), slots: [
          { name: 'FOYER', kind: 'entry', tgt: ftIn(5.5), min: ftIn(5), max: ftIn(7), open: 1 },
          { name: 'GREAT ROOM', kind: 'living', tgt: ftIn(14), min: ftIn(10), max: ftIn(19), open: 1 },
        ] },
        { d: jit(rng, 12.5, 13.5), dmin: ftIn(11.5), slots: [
          { name: 'KITCHEN', kind: 'kitchen', tgt: ftIn(10), min: ftIn(9), max: ftIn(13), open: 1 },
          { name: 'DINING', kind: 'dining', tgt: ftIn(9.5), min: ftIn(9), max: ftIn(12), open: 1, opt: 1 },
        ] },
        { d: jit(rng, 9, 10), dmin: ftIn(8.5), slots: [
          { name: 'HALL', kind: 'hall', tgt: 48, min: 42, max: 54, open: 1 },
          { name: 'BATH', kind: 'bath', tgt: ftIn(5.5), min: ftIn(5), max: ftIn(7) },
          { name: 'LAUNDRY', kind: 'laundry', tgt: ftIn(6), min: ftIn(5.5), max: ftIn(8), opt: 1 },
        ] },
        { d: jit(rng, 11.5, 12), dmin: ftIn(10.5), slots: [
          { name: 'HALL 2', kind: 'hall', tgt: 48, min: 42, max: 54, open: 1 },
          { name: 'BEDROOM 2', kind: 'bed', tgt: ftIn(12), min: ftIn(10), max: ftIn(17) },
        ] },
        { d: jit(rng, 14, 15), dmin: ftIn(13), slots: [
          { name: 'PRIMARY BEDROOM', kind: 'bed', tgt: ftIn(12.5), min: ftIn(10.5), max: ftIn(17), primary: 1 },
          { name: '_SUITECOL', kind: 'closet', tgt: ftIn(6), min: ftIn(4.5), max: ftIn(8),
            stack: [{ name: 'W.I.C.', kind: 'closet', w: 1 }, { name: 'PRIMARY BATH', kind: 'bath', w: 1.35 }] },
        ] },
      ],
      links: [['FOYER', 'GREAT ROOM', 'open'], ['GREAT ROOM', 'KITCHEN', 'open'],
        ['KITCHEN', 'DINING', 'open'], ['KITCHEN', 'HALL', 'open'],
        ['HALL', 'BATH'], ['HALL', 'LAUNDRY'], ['HALL', 'HALL 2', 'open'],
        ['HALL 2', 'BEDROOM 2'], ['HALL 2', 'PRIMARY BEDROOM'],
        ['PRIMARY BEDROOM', 'W.I.C.'], ['PRIMARY BEDROOM', 'PRIMARY BATH']],
    },
  ];

  /* R68 — THE 3-BEDROOM ENVELOPE, DERIVED FROM THE RECIPES THEMSELVES.
     The generator has to be able to explain a bed shortfall, and an explanation
     is only worth printing if it cannot drift away from the code it describes.
     So instead of hand-copied constants, read each recipe's own numbers:

       W = the widest band's REQUIRED minimums, where "required" is every
           non-optional slot PLUS every optional slot up to and including the
           last bed-bearing one — because fitSlots drops optional slots from the
           END, so keeping an optional bedroom means keeping everything before it.
           This reproduces the measured cliff exactly: narrowFront 28.5ft,
           narrowRear 27.0ft, narrowCross 23.5ft of house width.
       D = the sum of the band depth floors.

     Recipes that top out at two bedrooms (the railroad) are excluded. bands()
     consumes rng only for a band's TARGET depth, never its floor or its slot
     minimums, so the zero-rng probe below is exact. */
  const NARROW_3BED = NARROW_RECIPES.map((rec) => {
    let bands;
    try { bands = rec.bands(() => 0, rec.maxW, {}); } catch (e) { return null; }
    const isBed = (s) => s.kind === 'bed' || (s.stack || []).some((x) => x.kind === 'bed');
    let nBed = 0, W = 0, D = 0;
    for (const b of bands) {
      const slots = (b.slots || []).filter(Boolean);
      let last = -1;
      for (let i = 0; i < slots.length; i++) if (isBed(slots[i])) {
        last = i;
        nBed += (slots[i].stack || []).filter((x) => x.kind === 'bed').length || 1;
      }
      let need = 0;
      for (let i = 0; i < slots.length; i++) if (!slots[i].opt || i <= last) need += slots[i].min;
      W = Math.max(W, need);
      D += b.dmin;
    }
    return nBed >= 3 ? { key: rec.key, W, D } : null;
  }).filter(Boolean);
  const NARROW_3BED_W = NARROW_3BED.reduce((m, c) => Math.min(m, c.W), Infinity);

  /* The pool entry list — the recipes above plus the original stacked-band parti
     (kept for the widths where its program genuinely fits, 33.5ft+). */
  const NARROW_PARTIS = NARROW_RECIPES.map((rec) => {
    /* R68 — DEPTH IS A COST, SO ONLY PAY IT WHERE IT BUYS SOMETHING. narrowCross
       reaches three bedrooms 3.5ft narrower than anything else by stacking the
       program front to back, and that costs 19ft of extra depth (59ft of band
       floors vs narrowRear's 40ft). On a 40ft lot it therefore drew a 29 x 63ft
       house where narrowRear draws 29 x 46 — same three bedrooms, and the deep
       one swallowed the back yard: dev-yardplace-test's "every 40ft design still
       gets a dining set" fell to 8/10 because there was no longer room for one.
       So a recipe that buys its third bedroom with DEPTH — narrower AND deeper
       than some alternative that also seats three — is offered only BELOW that
       alternative's 3-bed width: exactly the band where it is the difference
       between a 3-bed and a 2-bed, and not one foot wider.

       The test is `mine.W < alt.W && mine.D > alt.D`, and BOTH halves matter.
       Dropping the width half caught narrowFront too (deeper than narrowRear at
       642 vs 480, but 28.5ft wide vs 27ft, so it is never the narrowness
       specialist) and collapsed the 40ft lot to a single parti. Derived from the
       recipes rather than hand-typed, so it cannot drift away from them. */
    const mine = NARROW_3BED.find((c) => c.key === rec.key);
    const shallowerAlt = mine
      ? NARROW_3BED.filter((c) => c.D < mine.D && c.W > mine.W).reduce((m, c) => Math.min(m, c.W), Infinity)
      : Infinity;
    const cap = rec.maxAvailW != null ? rec.maxAvailW : rec.maxW + ftIn(1);
    return {
      key: rec.key, minW: rec.minW,
      // a recipe stops being OFFERED once the envelope is comfortably wider than the
      // widest house it draws — otherwise the rowhouse turns up on a 44ft lot and
      // leaves 4ft of buildable width on the table.
      maxAvailW: Math.min(cap, Number.isFinite(shallowerAlt) ? shallowerAlt - GRID : Infinity),
      build: (frame, style, opts, rng) => designNarrowBands(frame, style, opts, rng, rec),
    };
  }).concat([{ key: 'narrow', minW: NARROW_STACK_MIN_W, maxAvailW: Infinity, build: design1storyNarrowV3 }]);

  // narrowest width any narrow parti can serve — used by the honest failure message
  const NARROW_FLOOR_W = NARROW_PARTIS.reduce((m, p) => Math.min(m, p.minW), Infinity);

  const narrowParti = (frame, style, opts, rng) => {
    const availW = frame.W - 12;
    let pool = NARROW_PARTIS.filter((p) => availW >= p.minW && availW <= p.maxAvailW);
    if (!pool.length) pool = NARROW_PARTIS.filter((p) => availW >= p.minW);
    if (!pool.length) return null;
    // PRIMARY = seed-hashed (side channel; consumes no rng, so every pre-existing
    // seeded stream is unchanged), and it STICKS. An earlier cut rolled a
    // per-candidate alternate and let the scorer choose — which collapsed straight
    // back to one winning type for every seed (measured: 36ft and 38ft lots
    // returned narrowRear on all 10 seeds). We only walk on to the next recipe
    // when the primary genuinely cannot solve this envelope.
    const h = Math.imul(((opts && opts.seed) || 0) ^ 0x5bf03635, 2246822519) >>> 0;
    const i0 = (h >>> 11) % pool.length;
    /* R68 — THE PROGRAM OUTRANKS THE SEED'S TASTE. Stickiness above was picking
       narrowFront on a 36ft lot, and narrowFront cannot seat a third bedroom
       under 28.5ft of house width, so it returned a 2-bed and the rotation
       stopped there — a silent downgrade on the single most common infill
       width in the country. Now the rotation keeps walking while the candidate
       is short of the REQUESTED bed count, and only falls back to the first
       thing that built if nothing in the pool can serve the program. Seed
       identity is untouched wherever the primary can deliver (which includes
       the whole 40ft+ demo band), so no existing seeded stream moves there. */
    let fallback = null;
    for (let n = 0; n < pool.length; n++) {
      let c = null;
      try { c = pool[(i0 + n) % pool.length].build(frame, style, opts, rng); } catch (e) { c = null; }
      if (!c) continue;
      if (!(c.dropped > 0)) return c;
      if (!fallback) fallback = c;
    }
    return fallback;
  };

  /* ============================================================
     PARTI 2 — "CENTER-CORE SPLIT RANCH" (1-story, wide-ish lots >=~50ft):
     three columns [secondary-bed CLUSTER | open CORE | PRIMARY SUITE] — the
     true split-bedroom ranch (kids one side, owners the other, living between).
       - CORE: KITCHEN takes the FRONT corner beside the foyer (sink window on
         the street facade), GREAT ROOM (+ optional dining nook) spans the BACK
         with the yard slider + big glazing.
       - SUITE: bath/WIC buffer band up front (street side), primary bedroom on
         the quiet back corner, entered from the FOYER (no bedroom door off the
         living zone).
     Structurally distinct from design1story's split-L in both zone graph and
     massing; scoreCand's existing contracts gate it like any candidate.
     ============================================================ */
  const design1storyCenterCore = (frame, style, opts, rng) => {
    const availW = frame.W - 12, availD = frame.D - 12;
    let nSec = opts.beds - 1, dropped = 0;
    const HW = PROG.hallW;
    const mkOpenR = (r) => { r.open = true; return r; };

    // program jitters
    let bedW = snap(ftIn(10) + rng() * ftIn(1.5));
    let bd = snap(ftIn(11.5) + rng() * ftIn(1));
    let r2D = snap(ftIn(9.5) + rng() * ftIn(1));
    let foyW = snap(ftIn(6.5) + rng() * ftIn(1.5));
    let kw = snap(ftIn(12.5) + rng() * ftIn(1.5));
    let kd = snap(ftIn(13) + rng() * ftIn(1.5));
    let gdT = snap(ftIn(15) + rng() * ftIn(1.5));
    let primaryD = snap(ftIn(14) + rng() * ftIn(2));
    let SW = snap(ftIn(12.5) + rng() * ftIn(1.5));

    const r3D = snap(ftIn(11.5));
    const clusterW = () => (nSec >= 2 ? 2 * bedW : bedW + ftIn(6));
    // dining nook only when the core is wide enough to keep the great >=13'
    const dnwOf = (MW) => (MW - ftIn(13) >= ftIn(8.5) ? snap(clamp(MW - ftIn(14.5), ftIn(8.5), ftIn(10))) : 0);
    let CW = clusterW(), MW = foyW + kw;
    let guard = 200;
    while (CW + MW + SW > availW && guard-- > 0) {
      if (kw > ftIn(12)) kw -= GRID;
      else if (foyW > ftIn(6)) foyW -= GRID;
      else if (bedW > ftIn(10)) bedW -= GRID;
      else if (SW > ftIn(12)) SW -= GRID;
      else if (nSec > 1) { nSec--; dropped++; }
      else break;
      CW = clusterW(); MW = foyW + kw;
    }
    if (CW + MW + SW > availW) return null;   // lot too tight for this parti
    const W = CW + MW + SW;

    // depth: core rows drive it; cluster + suite stretch to tile the column
    let D = kd + gdT;
    guard = 100;
    while (D > availD && guard-- > 0) {
      if (gdT > ftIn(14)) { gdT -= GRID; D = kd + gdT; }
      else if (kd > ftIn(12.5)) { kd -= GRID; D = kd + gdT; }
      else break;
    }
    const cdMin = bd + HW + r2D + (nSec >= 4 ? r3D : 0);
    if (D < cdMin) D = snap(cdMin);            // cluster rows must fit
    if (D > availD) return null;
    const gd = D - kd;
    if (gd < ftIn(13.5)) return null;
    const dnw = dnwOf(MW);
    // stretch the cluster rows into the column depth so the back-left corner
    // never ends as dead space (beds cap 13'6", service row 11'6"; anything
    // beyond becomes a real FLEX/storage room below)
    {
      let slack = D - cdMin;
      const bdG = Math.max(0, Math.min(snap(slack * 0.5), ftIn(13.5) - bd));
      bd += bdG; slack -= bdG;
      const r2G = Math.max(0, Math.min(snap(slack), ftIn(11.5) - r2D));
      r2D += r2G;
    }

    const plan = mkPlan();
    plan.parti = 'centerCore';

    /* ---- cluster column (left): beds front, hall band, service row ---- */
    let bed2 = null, bed3 = null, bath = null, laundry = null;
    let j;
    if (nSec >= 2) {
      const halfW = CW / 2;
      bed2 = addRoom(plan, 'BEDROOM 2', 'bed', 0, 0, halfW, bd);
      bed3 = addRoom(plan, 'BEDROOM 3', 'bed', halfW, 0, CW, bd);
      bed2.tgt = bed3.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      j = snap(halfW);
    } else {
      bed2 = addRoom(plan, 'BEDROOM 2', 'bed', 0, 0, bedW, bd);
      bed2.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      addRoom(plan, 'LINEN', 'closet', bedW, 0, CW, bd);
      j = snap(Math.min(bedW, CW - ftIn(6)));
    }
    const hv0 = bd, hv1 = bd + HW;
    let hu0 = snap(clamp(j - ftIn(6), 0, Math.max(0, CW - ftIn(12))));
    let hu1 = snap(Math.min(hu0 + ftIn(12), CW));
    if (hu0 >= 30) {
      const cl = addRoom(plan, 'CL.', 'closet', 0, hv0, hu0, hv1);
      if (bed2) addEdge(plan, bed2, cl, 'door');
    } else if (hu0 > 0) hu0 = 0;
    const hall = mkOpenR(addRoom(plan, 'HALL', 'hall', hu0, hv0, hu1, hv1));
    if (hu1 < CW - 1) mkOpenR(addRoom(plan, '', 'hall', hu1, hv0, CW, hv1));  // open approach into the core
    // service row (+ bed4 when the program wants it)
    const r2v0 = hv1, r2v1 = hv1 + r2D;
    // canon-bath fix: with the bath slimmed to ~5.5' the laundry would swallow
    // the whole leftover — cap it near ~7ft and give a real remainder to a
    // LINEN closet (mirrors splitL's capLaundry).
    const capL2 = (lstart) => {
      const lw = snap(clamp(ftIn(7), ftIn(5), CW - lstart));
      if (CW - lstart - lw >= 30) {
        laundry = addRoom(plan, 'LAUNDRY', 'laundry', lstart, r2v0, lstart + lw, r2v1);
        const linen = addRoom(plan, 'LINEN', 'closet', lstart + lw, r2v0, CW, r2v1);
        addEdge(plan, laundry, linen, 'door');
      } else laundry = addRoom(plan, 'LAUNDRY', 'laundry', lstart, r2v0, CW, r2v1);
    };
    if (nSec >= 3) {
      const b4w = snap(CW / 2 - ftIn(1.5));
      const bed4 = addRoom(plan, 'BEDROOM 4', 'bed', 0, r2v0, b4w, r2v1);
      bed4.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      const bw2 = snap(clamp(Math.max(PROG.bath.tw, hu0 + ftIn(3.5) - b4w), ftIn(5), CW - b4w - ftIn(4.5)));
      bath = addRoom(plan, 'BATH', 'bath', b4w, r2v0, b4w + bw2, r2v1);
      capL2(b4w + bw2);
      addEdge(plan, hall, bed4, 'door');
    } else {
      // ≥42" shared wall with the hall (hu0 term) so the bath door always fits
      const bw = snap(clamp(Math.max(PROG.bath.tw, hu0 + ftIn(3.5)), ftIn(5), CW - ftIn(7)));
      bath = addRoom(plan, 'BATH', 'bath', 0, r2v0, bw, r2v1);
      capL2(bw);
    }
    addEdge(plan, hall, bath, 'door');
    if (laundry) addEdge(plan, hall, laundry, 'door');
    // 3rd cluster row for a 5th bed
    let cd = r2v1;
    if (nSec >= 4) {
      const cv0 = r2v1, cv1 = r2v1 + r3D;
      const conn = addRoom(plan, 'HALL 2', 'hall', j, cv0, j + HW, cv1);
      const bed5 = addRoom(plan, 'BEDROOM 5', 'bed', 0, cv0, j, cv1);
      bed5.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      addRoom(plan, 'STOR.', 'closet', j + HW, cv0, CW, cv1);
      addEdge(plan, conn, bed5, 'door');
      addEdge(plan, hall, conn, 'door');
      cd = cv1;
    }
    // leftover cluster depth (rows were pre-stretched, so this is rare): a real
    // back-corner room when it's genuinely room-sized, else storage / absorbed
    if (D - cd >= ftIn(7) && CW / (D - cd) <= 2.2) {
      const flex = addRoom(plan, 'FLEX', 'office', 0, cd, CW, D);
      flex.tgt = { w: CW, d: D - cd };
      addEdge(plan, hall, flex, 'door');
    } else if (D - cd >= ftIn(3.5)) {
      const stor = addRoom(plan, 'STOR.', 'closet', 0, cd, CW, D);
      addEdge(plan, hall, stor, 'door');
    } else if (D - cd > 6) {
      // absorb a sliver into the service row
      for (const r of plan.rooms) if (Math.abs(r.v1 - cd) < 1 && r.u1 <= CW + 1) r.v1 = D;
    }

    /* ---- open core (center): [KITCHEN | FOYER] front, [DINING? | GREAT] back ---- */
    const kitchen = mkOpenR(addRoom(plan, 'KITCHEN', 'kitchen', CW, 0, CW + kw, kd));
    kitchen.tgt = { w: PROG.kitchen.tw, d: PROG.kitchen.td };
    const foyer = mkOpenR(addRoom(plan, 'FOYER', 'entry', CW + kw, 0, CW + MW, kd));
    let dining = null, great;
    if (dnw) {
      dining = mkOpenR(addRoom(plan, 'DINING', 'dining', CW, kd, CW + dnw, D));
      dining.tgt = { w: PROG.dining.tw, d: PROG.dining.td };
      great = mkOpenR(addRoom(plan, 'GREAT ROOM', 'living', CW + dnw, kd, CW + MW, D));
    } else {
      great = mkOpenR(addRoom(plan, 'GREAT ROOM', 'living', CW, kd, CW + MW, D));
    }
    great.tgt = { w: PROG.great.tw, d: PROG.great.td };
    addEdge(plan, foyer, kitchen, 'open');
    addEdge(plan, foyer, great, 'open');
    addEdge(plan, kitchen, great, 'open');
    if (dining) { addEdge(plan, kitchen, dining, 'open'); addEdge(plan, great, dining, 'open'); }
    addEdge(plan, hall, kitchen, 'open');
    addEdge(plan, hall, great, 'open');

    /* ---- primary suite column (right): bath/WIC buffer front, bed on the
       quiet back corner; entered from the FOYER ---- */
    // keep the buffer band SHALLOWER than the foyer so the foyer→primary door
    // always has a real shared span on the suite wall
    const sfd = snap(clamp(D - primaryD, ftIn(8), Math.max(ftIn(8), kd - 48)));
    const wic = addRoom(plan, 'W.I.C.', 'closet', CW + MW, 0, CW + MW + snap(SW * 0.45), sfd);
    const pbath = addRoom(plan, 'PRIMARY BATH', 'bath', CW + MW + snap(SW * 0.45), 0, W, sfd);
    const primary = addRoom(plan, 'PRIMARY BEDROOM', 'bed', CW + MW, sfd, W, D);
    primary.beds = 'primary';
    primary.tgt = { w: PROG.primary.tw, d: PROG.primary.td };
    addEdge(plan, foyer, primary, 'door');
    addEdge(plan, primary, wic, 'door');
    addEdge(plan, primary, pbath, 'door');

    plan.frontDoorRoom = 'FOYER';
    const loop = [{ u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: D }, { u: 0, v: D }];
    const cand = { plans: [plan], loop, W, D, dropped };
    const mirror = rng() < 0.5;
    return mirror ? flipU(cand, W) : cand;
  };

  /* ============================================================
     2-STORY designer — open-concept L0 (foyer+great / kitchen+dining, laundry+
     pantry column, optional guest bed) and a COMPACT L1: short hall (<=12ft)
     with beds both sides, primary suite cluster on the back, bath off the hall.
     beds > 4 drop to 4 (a compact two-story footprint
     honestly hosts 4; a 5-bed 2-story needs a wider plan than this template).
     ============================================================ */
  const design2story = (frame, style, opts, rng) => {
    const availW = frame.W - 12, availD = frame.D - 12;
    let beds = opts.beds, dropped = 0;
    if (beds > 4) {
      dropped = beds - 4; beds = 4;
    }
    const HW = PROG.hallW;
    const sw = snap(ftIn(6));
    let W = snap(ftIn(31) + rng() * ftIn(2));
    let D = snap(ftIn(30) + rng() * ftIn(2));
    if (W > availW) W = snap(availW);
    if (D > availD) D = snap(availD);
    if (W < ftIn(29) || D < ftIn(28)) return null;
    const mirror = rng() < 0.5;
    const fb = snap(ftIn(12));                 // L1 front bed band
    const hv0 = fb, hv1 = fb + HW;

    /* ---- L1 ---- */
    const p1 = mkPlan();
    // Chief-style stair truth (Steve Jul 6): the upper level has NO second flight —
    // its stairwell is OPEN TO BELOW (floor holed over the L0 run, dashed CAD
    // reference on the L1 plan). The zone keeps kind 'stair' (circulation for the
    // bed-off-hall adjacency contracts) but reads like Chief's label.
    const stair1 = addRoom(p1, 'OPEN TO BELOW', 'stair', 0, 0, sw, hv1);
    const b2w = snap(ftIn(11));
    // beds=2: the second upstairs slot becomes a LOFT (open bonus space)
    const bed2 = beds >= 3
      ? addRoom(p1, 'BEDROOM 2', 'bed', sw, 0, sw + b2w, fb)
      : addRoom(p1, 'LOFT', 'office', sw, 0, sw + b2w, fb);
    if (beds >= 3) bed2.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
    const bed3 = addRoom(p1, beds >= 3 ? 'BEDROOM 3' : 'BEDROOM 2', 'bed', sw + b2w, 0, W, hv1);   // east column bed
    bed3.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
    const hall1 = addRoom(p1, 'HALL', 'hall', sw, hv0, sw + b2w, hv1);   // 11ft
    addEdge(p1, stair1, hall1, 'open');
    addEdge(p1, hall1, bed2, 'door');
    addEdge(p1, hall1, bed3, 'door');    // door at the hall's east end
    // back band: bath (off hall) + primary suite cluster — canon 5.5' bath, not 6'
    const bw = snap(ftIn(5.5));
    const bath1 = addRoom(p1, 'BATH', 'bath', sw, hv1, sw + bw, hv1 + ftIn(8.5));
    addEdge(p1, hall1, bath1, 'door');
    const stor1 = addRoom(p1, 'LINEN', 'closet', 0, hv1, sw, D);
    addEdge(p1, bath1, stor1, 'door');
    const pw = snap(ftIn(12));
    const primary1 = addRoom(p1, 'PRIMARY BEDROOM', 'bed', sw + bw, hv1, sw + bw + pw, D);
    primary1.beds = 'primary';
    primary1.tgt = { w: PROG.primary.tw, d: PROG.primary.td };
    addEdge(p1, hall1, primary1, 'door');
    const wic2 = addRoom(p1, 'W.I.C.', 'closet', sw, hv1 + ftIn(8.5), sw + bw, D);
    addEdge(p1, primary1, wic2, 'door');
    const colU = sw + bw + pw;
    const wic1 = addRoom(p1, 'W.I.C. 2', 'closet', colU, hv1, W, hv1 + ftIn(6));
    const pbath1 = addRoom(p1, 'PRIMARY BATH', 'bath', colU, hv1 + ftIn(6), W, D);
    addEdge(p1, primary1, wic1, 'door');
    addEdge(p1, primary1, pbath1, 'door');
    p1.stairs = { u0: 6, v0: 12, u1: sw - 6, v1: 12 + ftIn(11), landing: true };

    /* ---- L0: open core ---- */
    const p0 = mkPlan();
    const gd0 = snap(D * 0.55);
    let fw = snap(ftIn(7));
    let guestW = 0;
    const nGuest = beds - 3;                        // beds=4 -> one guest room down
    if (nGuest > 0) guestW = snap(ftIn(11));
    /* R176 (sweep: GREAT ROOM shipped 11ft wide on 40ft-2story-4bd, 6 rows) —
       the guest carve took its fixed 11ft with a fixed 7ft foyer and let the
       great room eat the whole shortfall, right through its 13ft floor. Pay
       the deficit from the FOYER first (7 -> 5.5ft), then the guest stall
       (11 -> 10ft); when the band still can't hold all three at their floors,
       SKIP the ground guest — the existing actualBeds recount then reports
       the honest fits-3 downgrade. */
    if (guestW > 0) {
      let deficit = ftIn(13) - (W - fw - guestW);
      if (deficit > 0) { const give = Math.min(deficit, fw - snap(ftIn(5.5))); if (give > 0) { fw = snap(fw - give); deficit -= give; } }
      if (deficit > 0) { const give = Math.min(deficit, guestW - snap(ftIn(10))); if (give > 0) { guestW = snap(guestW - give); deficit -= give; } }
      if (deficit > 0) { guestW = 0; fw = snap(ftIn(7)); }
    }
    const foyer = addRoom(p0, 'FOYER', 'entry', 0, 0, fw, gd0);
    foyer.open = true;
    const great = addRoom(p0, 'GREAT ROOM', 'living', fw, 0, W - guestW, gd0);
    great.open = true;
    great.tgt = { w: PROG.great.tw, d: PROG.great.td };
    if (guestW > 0) {
      const g = addRoom(p0, 'BEDROOM 4', 'bed', W - guestW, 0, W, gd0 > ftIn(13) ? snap(ftIn(13)) : gd0);
      g.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      addEdge(p0, foyer, g, 'door');                // guest room off the entry zone
      if (gd0 > ftIn(13) + 30) addRoom(p0, 'CL.', 'closet', W - guestW, snap(ftIn(13)), W, gd0);
    }
    const lw = snap(ftIn(6));
    const laundry0 = addRoom(p0, 'LAUNDRY', 'laundry', 0, gd0, lw, Math.min(gd0 + ftIn(7), D));
    // R176 — keys on guestW (not nGuest): a DROPPED ground guest must not
    // leave a full bath serving no bedroom; that slot reverts to the pantry.
    const bath0 = (guestW > 0)
      ? addRoom(p0, 'BATH 2', 'bath', 0, gd0 + ftIn(7), lw, D)
      : addRoom(p0, 'PANTRY', 'closet', 0, gd0 + ftIn(7), lw, D);
    const bd0 = D - gd0;
    let kitchen0 = null, dining0 = null, u0b = lw;
    for (const seg of fillStrip(W - lw, [
      { name: 'KITCHEN', kind: 'kitchen', tgt: ftIn(12.5), min: ftIn(12), max: snap(bd0 * 1.7) },
      { name: 'DINING', kind: 'dining', tgt: ftIn(11.5), min: ftIn(9.5), max: snap(bd0 * 1.7) },
    ])) {
      const r = addRoom(p0, seg.name, seg.kind, u0b, gd0, u0b + seg.d, D);
      r.open = seg.kind !== 'closet';
      if (seg.kind === 'kitchen') { kitchen0 = r; r.tgt = { w: PROG.kitchen.tw, d: PROG.kitchen.td }; }
      if (seg.kind === 'dining') { dining0 = r; r.tgt = { w: PROG.dining.tw, d: PROG.dining.td }; }
      u0b += seg.d;
    }
    addEdge(p0, foyer, great, 'open');
    addEdge(p0, great, kitchen0 || dining0, 'open');
    if (kitchen0 && dining0) addEdge(p0, kitchen0, dining0, 'open');
    if (kitchen0) addEdge(p0, kitchen0, laundry0, 'door');
    if (bath0) addEdge(p0, kitchen0 || great, bath0, 'door');
    p0.frontDoorRoom = 'FOYER';
    p0.stairs = { u0: 6, v0: 12, u1: sw - 6, v1: 12 + ftIn(11) };

    const loop = [{ u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: D }, { u: 0, v: D }];
    const cand = { plans: [p0, p1], loop, W, D, dropped };
    return mirror ? flipU(cand, W) : cand;
  };

  /* ---- ADU designer: compact open studio / 1-bed ---- */
  const designADU = (frame, style, opts, rng) => {
    const availW = frame.W - 12, availD = frame.D - 12;
    /* ---- ADU CORNER GARAGE (Steve, Jul 14): "in the corners, usually back
       right, elevated on a platform … access door facing OUT is common — never
       really with inside access." Only an EXPLICIT garage ask ('1car'/'2car' —
       both give the one-car ADU stall) adds one; 'auto'/'none' never do. The
       garage is a corner mass EXTENDING the footprint at the back (default
       back-right, opts.garageCorner 'back-left' mirrors it): vehicle door on
       the rear (alley-facing) exterior wall, person door on the OUTER side
       wall facing out, and NO interior door into the living space (extOnly —
       connectivity treats it as satisfied by its exterior doors). Slab/
       platform elevation reuses the house-garage machinery wholesale: the
       GARAGE room label is stamped by applyGarage (floorDrop/garageRect), so
       HA.garageInfo / garageWallDrop / floor hole / foundation step all work
       unchanged. If the envelope can't hold living + stall depth, the garage
       is dropped (never degrade the dwelling program). */
    const wantGar = opts.garage === '1car' || opts.garage === '2car';
    const GA = GARAGE_DIMS.adu;
    const oneBed = (opts.beds || 1) >= 1 && availD > ftIn(26) + (wantGar ? GA.d : 0);
    const bathW = snap(ftIn(5.5)), bathD = snap(ftIn(8.5));
    const availDliv = wantGar ? availD - GA.d : availD;   // depth left for the dwelling
    const W = snap(Math.min(availW, ftIn(21) + rng() * ftIn(4)));
    const D = snap(Math.min(availDliv, (oneBed ? ftIn(27) : ftIn(19)) + rng() * ftIn(4)));
    // the garage only lands when the dwelling still fits at full program in front
    // of it AND the stall strip fits the width; otherwise design the plain ADU.
    const garOK = wantGar && W >= GA.w + ftIn(2) && D >= ftIn(15);
    if (W < ftIn(15) || D < ftIn(15)) {
      if (!wantGar) return null;
      // retry without the garage reservation rather than failing the ADU outright
      return designADU(frame, style, Object.assign({}, opts, { garage: 'none' }), rng);
    }
    const plan = mkPlan();
    const bathLeft = rng() < 0.5;
    /* ---- COMPACT KITCHENETTE ZONE (Steve, Jul 14: "nobody would make the
       WHOLE room a kitchen") — the old plans stamped the entire open great
       room as ONE 'LIVING / KITCHEN' zone, so the kitchen designer + the
       Kitchen click-selection treated the whole room as their canvas. Real
       small-plan design: the kitchenette is ONE compact corner band (8-12 lf
       of run, ~8'-6" deep) on the plumbing-adjacent side next to the bath,
       with a DINING nook beside it and LIVING taking the rest. All three are
       OPEN zones (no walls between them — the wall builder skips open|open
       boundaries); only the stamped zone polys change, which is exactly what
       _genRooms/_genZones, the designers, electrical and click-zones read. */
    const kd = bathD;   // kitchen band depth ties to the bath canon depth (~8'-6")
    if (oneBed) {
      const vBed = snap(D - ftIn(12.5));
      const kw = snap(clamp(Math.min(ftIn(9) + rng() * ftIn(3), W - ftIn(11)), ftIn(8), ftIn(12)));
      const cU0 = bathLeft ? 0 : W - bathW, cU1 = bathLeft ? bathW : W;
      const kU0 = bathLeft ? 0 : W - kw, kU1 = bathLeft ? kw : W;
      // kitchen corner band at the BACK of the great room (against the bed/bath
      // partition — the wet wall it shares with the bath column)
      const kitchen = addRoom(plan, 'KITCHEN', 'kitchen', kU0, vBed - kd, kU1, vBed);
      kitchen.open = true;
      // dining nook in front of the kitchenette (unnamed circulation if too shallow)
      const nookD = vBed - kd;
      const nook = nookD >= ftIn(5)
        ? addRoom(plan, 'DINING', 'dining', kU0, 0, kU1, nookD)
        : addRoom(plan, '', 'hall', kU0, 0, kU1, nookD);
      nook.open = true;
      const living = addRoom(plan, 'LIVING', 'living', bathLeft ? kw : 0, 0, bathLeft ? W : W - kw, vBed);
      living.open = true;
      const closet = (D - vBed - bathD >= ftIn(2.5))
        ? addRoom(plan, 'CLOSET', 'closet', cU0, vBed, cU1, D - bathD) : null;
      const bath = addRoom(plan, 'BATH', 'bath', cU0, closet ? D - bathD : vBed, cU1, D);
      const bed = addRoom(plan, 'BEDROOM', 'bed', bathLeft ? bathW : 0, vBed, bathLeft ? W : W - bathW, D);
      bed.beds = 'primary';
      bed.tgt = { w: PROG.bed.tw, d: PROG.bed.td };
      addEdge(plan, living, kitchen, 'open');
      addEdge(plan, kitchen, nook, 'open');
      addEdge(plan, living, bed, 'door');
      addEdge(plan, bed, bath, 'door');
      if (closet) addEdge(plan, bed, closet, 'door');
      plan.frontDoorRoom = 'LIVING';
    } else {
      // STUDIO: open living band across the front; the BACK band is
      // bath | compact kitchenette | dining nook (tiled — no overlap, so the
      // stamped zones are honest and the living zone never spans the bath).
      const great = addRoom(plan, 'STUDIO', 'living', 0, 0, W, D - kd);
      great.open = true;
      const bath = addRoom(plan, 'BATH', 'bath', bathLeft ? 0 : W - bathW, D - kd, bathLeft ? bathW : W, D);
      let kw = snap(clamp(Math.min(ftIn(9) + rng() * ftIn(3), W - bathW - ftIn(6)), ftIn(8), ftIn(12)));
      const rem = W - bathW - kw;
      if (rem < ftIn(2)) kw = snap(W - bathW);   // too little left — the band is bath + kitchen
      const kU0 = bathLeft ? bathW : snap(W - bathW - kw);
      const kitchen = addRoom(plan, 'KITCHEN', 'kitchen', kU0, D - kd, snap(kU0 + kw), D);
      kitchen.open = true;
      if (rem >= ftIn(2)) {
        const nook = rem >= ftIn(6)
          ? addRoom(plan, 'DINING', 'dining', bathLeft ? bathW + kw : 0, D - kd, bathLeft ? W : W - bathW - kw, D)
          : addRoom(plan, '', 'hall', bathLeft ? bathW + kw : 0, D - kd, bathLeft ? W : W - bathW - kw, D);
        nook.open = true;
        addEdge(plan, kitchen, nook, 'open');
      }
      addEdge(plan, great, kitchen, 'open');
      addEdge(plan, great, bath, 'door');
      plan.frontDoorRoom = 'STUDIO';
    }
    plan.isADU = true;
    if (!garOK)
      return { plans: [plan], loop: [{ u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: D }, { u: 0, v: D }], W, D, dropped: 0 };

    // ---- attach the ADU corner garage (back-right default) ----
    const corner = opts.garageCorner === 'back-left' ? 'back-left' : 'back-right';
    const side = corner === 'back-left' ? 'left' : 'right';
    const GW = GA.w, GD = GA.d;
    const gu0 = side === 'right' ? snap(W - GW) : 0;
    const gu1 = side === 'right' ? W : snap(GW);
    const garage = addRoom(plan, 'GARAGE', 'garage', gu0, D, gu1, snap(D + GD));
    garage.garage = true;
    garage.extOnly = true;          // NO interior door — exterior access only (Steve)
    garage._doorW = GA.door;        // 9' overhead
    garage._vdoor = 'back';         // vehicle door on the REAR (v1, alley-facing) wall
    garage._manSide = side;         // person door on the outer side wall, facing out
    garage._side = side;
    garage._project = 0;
    // NO addEdge(garage, …): the graph carries no interior garage connection.
    const Dg = snap(D + GD);
    const loop = side === 'right'
      ? [{ u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: Dg }, { u: gu0, v: Dg }, { u: gu0, v: D }, { u: 0, v: D }]
      : [{ u: 0, v: 0 }, { u: W, v: 0 }, { u: W, v: D }, { u: gu1, v: D }, { u: gu1, v: Dg }, { u: 0, v: Dg }];
    const cand = { plans: [plan], loop, W, D: Dg, dropped: 0 };
    cand.garage = { kind: 'adu', side, corner, project: 0, doorW: GA.door, adu: true };
    return cand;
  };

  /* ---------- the DESIGN SCORE (lower = better) ---------- */
  const scoreCand = (cand, opts) => {
    let pen = 0;
    const area = loopArea(cand.loop) || 1;
    const lims = { living: 1.55, bed: 1.45, dining: 1.85, kitchen: 1.75, office: 1.75 };
    const mins = {
      living: PROG.great.minDim, bed: PROG.bed.minDim, kitchen: PROG.kitchen.minDim,
      dining: PROG.dining.minDim, bath: PROG.bath.minDim,
      // R173 (sweep finding): closets/laundry had NO score floor at all — a
      // 2ft-wide closet sliver shipped on 40ft lots costing zero points.
      closet: 30, laundry: 54,
    };
    const edges = loopEdgesOf(cand.loop);
    for (const plan of cand.plans) {
      let hallA = 0;
      const byName = {};
      for (const r of plan.rooms) if (r.name) byName[r.name] = r;
      for (const r of plan.rooms) {
        const w = r.u1 - r.u0, d = r.v1 - r.v0;
        const long = Math.max(w, d), short = Math.min(w, d);
        if (r.kind === 'hall') {
          hallA += w * d;
          if (long > 144) pen += 50 + (long - 144) / 6;   // punish long halls HARD
        }
        const lim = lims[r.kind];
        if (lim) { const asp = long / (short || 1); if (asp > lim) pen += 32 * (asp - lim) * (asp - lim); }
        let min = mins[r.kind];
        if (r.beds === 'primary') min = PROG.primary.minDim;
        if (min && short < min) {
          pen += 30 + (min - short) / 6;
          /* R173 (the 40-60ft sweep: a 2.0ft closet, an 8.5ft dining and an
             11ft great room all SHIPPED as winning candidates) — a room more
             than 6" under its hard floor is a broken output, not a trade-off.
             Dominate the score so any contract-clean candidate always wins;
             the soft slope above still handles hair-under near-misses so
             tuned seed fixtures don't churn. A dominated candidate can still
             ship only when NOTHING clean solves (better a tight room than no
             house — the R67 constraint report covers the truly impossible). */
          if (short <= min - 6) pen += 4000;
        }
        if (r.tgt) { const ta = r.tgt.w * r.tgt.d; pen += 6 * Math.abs(w * d - ta) / ta; }
        if (['living', 'bed', 'dining', 'kitchen', 'office'].includes(r.kind)) {
          const hasWin = edges.some((e) => e.axis === 'v'
            ? (Math.abs(e.c - r.u0) < 1 || Math.abs(e.c - r.u1) < 1) && Math.min(r.v1, e.b) - Math.max(r.v0, e.a) >= ftIn(6)
            : (Math.abs(e.c - r.v0) < 1 || Math.abs(e.c - r.v1) < 1) && Math.min(r.u1, e.b) - Math.max(r.u0, e.a) >= ftIn(6));
          if (!hasWin) pen += 15;
        }
      }
      const hf = hallA / area;
      if (hf > PROG.hallFracMax) pen += (hf - PROG.hallFracMax) * 300;
      // OPEN-CONCEPT contract: the kitchen zone must front the great/dining/entry
      // zones with >=12ft of wall-free boundary — a kitchen enclosed on 3+ sides dies here
      const kit = byName['KITCHEN'];
      if (kit && kit.open) {
        let openFront = 0;
        for (const r2 of plan.rooms) {
          if (r2 === kit || !r2.open || !['living', 'dining', 'entry'].includes(r2.kind)) continue;
          for (const s of sharedEdges(kit, r2)) openFront += Math.max(0, s.b - s.a);
        }
        if (openFront < ftIn(12)) pen += 40;
      }
      const need = (a, b, minShared) => {
        const ra = byName[a], rb = byName[b];
        if (!ra || !rb) return;
        const se = sharedEdges(ra, rb);
        if (!se.some((s) => s.b - s.a >= (minShared || ftIn(3)))) pen += 10;
      };
      need('KITCHEN', 'DINING'); need('PRIMARY BEDROOM', 'PRIMARY BATH', ftIn(4));
      const l = byName['LAUNDRY'];
      if (l) {
        const halls = plan.rooms.filter((r) => r.kind === 'hall');
        const okL = (byName['KITCHEN'] && sharedEdges(l, byName['KITCHEN']).length) ||
                    halls.some((h) => sharedEdges(l, h).length) ||
                    (byName['FOYER'] && sharedEdges(l, byName['FOYER']).length);
        if (!okL) pen += 10;
      }
      for (const e of plan.edges) {
        const ra = byName[e.a], rb = byName[e.b];
        if (!ra || !rb) continue;
        const kinds = [ra.kind, rb.kind];
        if (kinds.includes('bed') && (kinds.includes('living') || kinds.includes('dining'))) pen += 8;
      }
    }
    if (cand.loop.length > 4) pen -= 8;
    // WIDE-LOT shape truth (owner): ranch/farmhouse must stretch along the street
    // when the envelope allows — squareness is punished in proportion to the miss.
    const st = STYLES[opts.style] || {};
    const bias = st.longLow ? 1.6 : st.label === 'Farmhouse' ? 1.35 : 0;
    if (bias && cand._availW && cand.W + ftIn(6) < cand._availW) {
      const ar = cand.W / (cand.D || 1);
      if (ar < bias - 0.1) pen += 40 * (bias - ar);
    }
    // a PLAIN RECTANGLE on a roomy envelope (>=8ft slack both ways) is "just a box"
    if (cand.loop.length <= 4 && cand._availW && cand._availW - cand.W >= ftIn(8) && cand._availD - cand.D >= ftIn(8)) pen += 25;
    pen += (cand.dropped || 0) * 100;
    return pen;
  };

  const overlaps = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 6;

  /* R67 — SETBACK TRUTH. A designed candidate is only admissible if it actually
     FITS the buildable envelope it was designed into. The narrow parti used to
     clamp its width UP to 29ft on any lot, so a 26-38ft lot shipped a house that
     ran straight through the side setback (measured 162" outside the setback poly
     on a 26ft lot). Nothing downstream re-checked it: placement centers the
     footprint in the frame and the walls follow. This is the one guard that makes
     "no design fits" an honest failure instead of a silent encroachment. */
  const fitsEnvelope = (cand, fr) => cand.W <= fr.W + 0.5 && cand.D <= fr.D + 0.5;

  /* ============================================================
     ROOM CODE (R183) — the AUTHORED-plan path.
     An authored plan document (built by HA.roomcode from Steve's
     Python/JSON authoring format) bypasses the parti search: the
     author IS the designer. The document arrives NORMALIZED from
     roomcode.js (inches, resolved rects, canonical kinds); this
     compiles it into the exact cand shape the partis emit —
     { plans:[{rooms, edges, parti, frontDoorRoom}], W, D, loop,
     garage? } — so every downstream stage (buildLevel, door
     seating, egress windows, fixtures, kitchen/bath designers,
     porch, foundation, roof, style, MEP) derives identically from
     an authored plan and a generated one. Errors THROW in
     room-name language; roomcode.js surfaces them as the
     validation report.
     ============================================================ */
  const compileRoomcode = (doc, frame) => {
    const plan = mkPlan();
    const byName = {};
    for (const r of doc.rooms) {
      if (byName[r.name]) throw new Error('roomcode: two rooms are both named "' + r.name + '" — every room needs a unique name.');
      const room = addRoom(plan, r.name, r.kind, snap(r.u0), snap(r.v0), snap(r.u1), snap(r.v1));
      if (room.u1 - room.u0 < 24 || room.v1 - room.v0 < 24)
        throw new Error('roomcode: room "' + r.name + '" is under 2ft on a side after grid snapping — give it real dimensions.');
      if (r.open) room.open = true;
      if (r.primary && r.kind === 'bed') room.beds = 'primary';
      if (r.kind === 'garage') {
        room.garage = true;
        const clearW = Math.min(room.u1 - room.u0, room.v1 - room.v0);
        room._doorW = Number.isFinite(r.doorW) ? r.doorW : (clearW >= ftIn(18) ? GARAGE_DIMS['2car'].door : GARAGE_DIMS['1car'].door);
      }
      if (Number.isFinite(r.ceil)) room._rcCeil = r.ceil;
      if (r.cathedral) room._rcCathedral = true;
      byName[r.name] = room;
    }
    // pairwise overlap = an authoring error, named for the author (>6" tolerance
    // matches the engine's own shared-wall slack).
    for (let i = 0; i < plan.rooms.length; i++) {
      for (let j = i + 1; j < plan.rooms.length; j++) {
        const a = plan.rooms[i], b = plan.rooms[j];
        if (overlaps(a.u0, a.u1, b.u0, b.u1) && overlaps(a.v0, a.v1, b.v0, b.v1))
          throw new Error('roomcode: rooms "' + a.name + '" and "' + b.name + '" overlap — rooms must tile, never stack.');
      }
    }
    for (const e of (doc.edges || [])) {
      const A = byName[e.a], B = byName[e.b];
      if (!A || !B) throw new Error('roomcode: attach references unknown room "' + (A ? e.b : e.a) + '".');
      // ZONE (v2.1, Steve: "invisible walls... open kitchen and living is more
      // common"): a zone connector marks BOTH rooms open-concept — the engine
      // then emits NO wall on their shared spans (addSeg) and punches no door
      // (placeOpenings skips open pairs). One flowing space, zero framing.
      if (e.kind === 'zone') { A.open = true; B.open = true; }
      addEdge(plan, A, B, e.kind);
    }
    // normalize the authored coordinates to a 0-origin — and REMEMBER the
    // offset on the document: site-composed declarations (carport/detached
    // garage) author in the same coordinates as the rooms, so the world
    // transform stamped at placement needs these to map them back.
    let nu = Infinity, nv = Infinity;
    for (const r of plan.rooms) { nu = Math.min(nu, r.u0); nv = Math.min(nv, r.v0); }
    for (const r of plan.rooms) { r.u0 -= nu; r.u1 -= nu; r.v0 -= nv; r.v1 -= nv; }
    doc._nu = nu; doc._nv = nv;
    // the footprint is the union of the room rects — a fragmented or holey union
    // means the rooms don't form one buildable mass.
    const loop = traceRectUnion(plan.rooms.map((r) => ({ u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1 })));
    if (!loop || loop.length < 4)
      throw new Error('roomcode: the rooms do not tile ONE connected footprint — every room must share edges with the rest (no gaps between rooms, no islands).');
    let W = 0, D = 0;
    for (const p of loop) { W = Math.max(W, p.u); D = Math.max(D, p.v); }
    plan.parti = 'roomcode:' + (doc.name || 'plan');
    if (doc.frontDoorRoom) {
      if (!byName[doc.frontDoorRoom]) throw new Error('roomcode: front_door names unknown room "' + doc.frontDoorRoom + '".');
      plan.frontDoorRoom = doc.frontDoorRoom;
    }
    const cand = { plans: [plan], W, D, loop };
    // an authored GARAGE room rides the same downstream chain as attachGarage's
    // (fire separation, dropped slab, overhead door, driveway) via cand.garage.
    const gR = plan.rooms.find((r) => r.kind === 'garage');
    if (gR) {
      const side = (gR.u0 + gR.u1) / 2 < W / 2 ? 'left' : 'right';
      let houseFrontV = Infinity;
      for (const r of plan.rooms) if (r.kind !== 'garage') houseFrontV = Math.min(houseFrontV, r.v0);
      gR._seam = side === 'left' ? gR.u1 : gR.u0;
      gR._side = side;
      gR._project = Math.max(0, houseFrontV - gR.v0);
      cand.garage = {
        kind: Math.min(gR.u1 - gR.u0, gR.v1 - gR.v0) >= ftIn(18) ? '2car' : '1car',
        side, project: gR._project, doorW: gR._doorW,
      };
    }
    if (!fitsEnvelope(cand, frame)) {
      const bw = frame.W / 12, bd = frame.D / 12;
      throw new Error('roomcode: the authored plan is ' + (W / 12).toFixed(1) + 'ft wide x ' + (D / 12).toFixed(1) +
        'ft deep, but the buildable envelope after setbacks is ' + bw.toFixed(1) + 'ft x ' + bd.toFixed(1) +
        'ft. Shrink the plan, reduce the setbacks, or use a bigger lot.');
    }
    return cand;
  };

  /* ============================================================
     MAIN generate()
     ============================================================ */
  const generate = (model, opts) => {
    opts = opts || {};
    // NOTE: 2-story is PARKED at the SURFACE (UI rolls/dialog + the AI tool
    // route to 1-story) while the single-story floor-plan core gets rebuilt —
    // the ENGINE still honors an explicit '2story' so the roof/band/stairwell
    // test coverage stays alive for the future revival.
    const mode = ['1story', '2story', 'adu'].includes(opts.mode) ? opts.mode : '1story';
    const styleKey = STYLES[opts.style] ? opts.style : (mode === 'adu' ? 'modern' : 'farmhouse');
    const style = STYLES[styleKey];
    const seed = Number.isFinite(opts.seed) ? (opts.seed >>> 0) : (Math.random() * 1e9) >>> 0;
    const rng = mulberry32(seed);
    const beds = clamp(opts.beds || (mode === 'adu' ? 1 : 3), mode === 'adu' ? 0 : 2, 5);
    const baths = clamp(opts.baths || (mode === 'adu' ? 1 : 2), 1, 3);
    const garage = ['none', '1car', '2car', 'auto'].includes(opts.garage) ? opts.garage : 'auto';
    opts = Object.assign({}, opts, { mode, style: styleKey, seed, beds, baths, garage });

    const frame = buildFrame(model);
    // R67 — the TRUE buildable width of the lot (before any garage reservation).
    // The narrow partis' L-jog articulation is a NARROW-LOT feature and keys off
    // this, not off the squeezed design frame: a standard 60ft lot that merely
    // reserved a garage strip must keep the flush massing ROOF-POLICY-SPEC A4
    // documents for that class.
    opts._lotFrameW = frame.W;

    // ---- RESERVE the garage width UP FRONT *only when the full-program house
    // still fits beside it*: a front-load garage is a mass BESIDE the house, so the
    // house is designed NARROWER by the garage strip. We first probe the natural
    // (garage-free) house width, and reserve the garage strip ONLY if a house of at
    // least that width still fits — otherwise the garage would force the program to
    // shrink (drop bedrooms), so we skip it. This keeps a garage additive: it never
    // degrades the house the user asked for. ADU never reserves. ----
    // PARTI POOL (1-story): the SEED picks this design's primary parti, so
    // "New layout" genuinely changes the plan ARRANGEMENT (split-L vs
    // center-core split ranch — plus each parti's own internal rolls like the
    // front-kitchen core flip), not just the room dimensions. The candidate
    // search still sprinkles the other parti as a scored fallback so a lot the
    // primary can't fit (center-core needs ~50ft) never fails to generate.
    const partis = mode === '2story' ? [design2story] : mode === 'adu' ? [designADU]
      : (rng() < 0.45 ? [design1storyCenterCore, design1story] : [design1story, design1storyCenterCore]);
    const partiFor = (k, kTotal) => partis[(k < Math.ceil(kTotal * 0.7) || partis.length < 2) ? 0 : 1];
    const designer = partis[0];
    // split-L's front-kitchen core flip — also a per-seed identity (see design1story)
    if (mode === '1story' && rng() < 0.38) opts._coreFlip = true;
    const probeHouseW = () => {
      let w = 0;
      for (let k = 0; k < 6; k++) {
        const rngK = mulberry32((seed ^ Math.imul(k + 1, 0x9E3779B9)) >>> 0);
        let c = null; try { c = designer(frame, style, opts, rngK); } catch (e) { c = null; }
        if (c) w = Math.max(w, c.W);
      }
      return w;
    };
    // ROOM CODE (R183): an authored plan declares its garage as a ROOM — the
    // front-load reservation/probe machinery is the procedural path's.
    let gPlan = opts._roomcode ? null : planGarage(frame, mode, opts);   // { kind, reserveW } | null
    let squeezed = false;
    if (gPlan) {
      const naturalW = probeHouseW();
      // Prefer not to squeeze: when the NATURAL width + full reservation overflows,
      // downgrade 2car -> 1car if that fits the natural width. Otherwise KEEP the
      // reservation and let the K-candidate search design the narrower house inside
      // the reserved frame (planGarage already guaranteed >= MIN_HOUSE_W remains,
      // and the reserved-design failure fallback below still guards). The old guard
      // nulled the garage outright — the 1story program stretches to fill the
      // envelope (naturalW 582 of 588 on a standard 60ft lot), so NO 1story ever
      // got an attached garage there: the flush/popped massing mix collapsed to
      // 100% flush and Steve's pop-out articulation went extinct (acceptance
      // bounce, Jul 6).
      if (naturalW && naturalW + gPlan.reserveW > frame.W - 12 &&
          gPlan.kind === '2car' && naturalW + GARAGE_MASS_W('1car') <= frame.W - 12)
        gPlan = { kind: '1car', reserveW: GARAGE_MASS_W('1car') };
      squeezed = !!(naturalW && naturalW + gPlan.reserveW > frame.W - 12);
    }
    const designFrame = gPlan
      ? Object.assign({}, frame, { W: snap(frame.W - gPlan.reserveW) })
      : frame;
    /* R67 — the narrow partis roll an L jog for articulation, but ONLY when the
       house is the whole massing. When a garage strip is reserved, the garage IS
       the articulation and ROOF-POLICY-SPEC A4 documents this class as flush-only
       (dev-roofpolicy-test: "popped == 0 on this class"). designNarrowBands reads
       this flag. Reset to 0 before each garage-free fallback search below. */
    opts._reservedW = gPlan ? gPlan.reserveW : 0;

    // ---- SCORED CANDIDATE SEARCH: K designs per seed, keep the best. The
    // seed's PRIMARY parti fills 70% of the slots and gets a scoring
    // preference (-15) so this seed keeps its arrangement identity unless the
    // primary genuinely can't fit the lot or scores far worse. ----
    const K = mode === '1story' ? 28 : 16;
    let best = null;
    // ROOM CODE (R183): the author IS the designer — compile the authored
    // document into the winning cand directly; no search, no scoring, and the
    // compile THROWS its own room-name-language errors (so the generic
    // "no parti fits" below can never mask an authoring mistake).
    if (opts._roomcode) {
      best = { cand: compileRoomcode(opts._roomcode, designFrame), sc: 0, k: -1 };
    } else for (let k = 0; k < K; k++) {
      const rngK = mulberry32((seed ^ Math.imul(k + 1, 0x9E3779B9)) >>> 0);
      const fn = partiFor(k, K);
      let cand = null;
      try { cand = fn(designFrame, style, opts, rngK); } catch (e) { cand = null; }
      if (!cand) continue;
      if (!fitsEnvelope(cand, designFrame)) continue;   // R67 setback truth — see fitsEnvelope
      cand._availW = designFrame.W - 12; cand._availD = designFrame.D - 12;   // envelope slack for the scorer
      const sc = scoreCand(cand, opts) - (fn === partis[0] ? 15 : 0);
      if (!best || sc < best.sc - 1e-9) best = { cand, sc, k };
    }
    // QUALITY-GATED SQUEEZE (acceptance bounce, Jul 6): when the reservation
    // forced the house NARROWER than its natural width, also design the
    // garage-FREE pool and keep the garage only if the squeezed plan preserves
    // the program — same bed count and comparable score. Restores the
    // popped/flush garage mix on standard lots WITHOUT shipping degraded plans
    // (the naive squeeze dropped bedrooms / broke room-aspect contracts).
    if (best && gPlan && squeezed) {
      let bestFree = null;
      opts._reservedW = 0;   // R67: the garage-free pool may articulate freely
      for (let k = 0; k < K; k++) {
        const rngK = mulberry32((seed ^ Math.imul(k + 1, 0x9E3779B9)) >>> 0);
        const fn = partiFor(k, K);
        let cand = null;
        try { cand = fn(frame, style, opts, rngK); } catch (e) { cand = null; }
        if (!cand) continue;
        if (!fitsEnvelope(cand, frame)) continue;   // R67 setback truth
        cand._availW = frame.W - 12; cand._availD = frame.D - 12;
        const sc = scoreCand(cand, opts) - (fn === partis[0] ? 15 : 0);
        if (!bestFree || sc < bestFree.sc - 1e-9) bestFree = { cand, sc, k };
      }
      if (bestFree) {
        const bedsOf = (c) => c.plans.reduce((n, p) => n + p.rooms.filter((r) => r.kind === 'bed').length, 0);
        // HARD plan contracts (mirror the design-quality bar): a squeezed plan may
        // keep its garage only if every room still meets the minimum dims + aspect
        // caps and the primary suite keeps its attached bath. Score alone missed
        // these (quadratic penalties can stay under any margin while a contract is
        // violated outright).
        const contractsOK = (c) => {
          const mins = { living: 156, bed: 120, kitchen: 108, dining: 108, bath: 54 };
          const asps = { living: 1.65, bed: 1.5, dining: 1.85, kitchen: 1.85, office: 1.85 };
          let pbed = null, pbathBest = 0;
          for (const p of c.plans) {
            for (const r of p.rooms) {
              const w = r.u1 - r.u0, d = r.v1 - r.v0, short = Math.min(w, d), long = Math.max(w, d);
              let min = mins[r.kind]; if (r.beds === 'primary') { min = 138; pbed = r; }
              if (min && short < min - 1) return false;
              const cap = asps[r.kind];
              if (cap && long / (short || 1) > cap + 0.01) return false;
            }
          }
          if (pbed) {
            const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
            for (const p of c.plans) for (const r of p.rooms) {
              if (r.kind !== 'bath') continue;
              let s = 0;
              if (Math.abs(pbed.u1 - r.u0) < 2 || Math.abs(r.u1 - pbed.u0) < 2) s = Math.max(s, ov(pbed.v0, pbed.v1, r.v0, r.v1));
              if (Math.abs(pbed.v1 - r.v0) < 2 || Math.abs(r.v1 - pbed.v0) < 2) s = Math.max(s, ov(pbed.u0, pbed.u1, r.u0, r.u1));
              pbathBest = Math.max(pbathBest, s);
            }
            if (pbathBest < 48) return false;
          }
          return true;
        };
        /* R171 (Steve: "the generate button i selected garage and it didn't
           show up"): the ±60 score comparison is an AESTHETIC preference —
           correct for garage:'auto', wrong for an EXPLICIT '1car'/'2car'
           request, where it silently discarded the user's ask on every thin
           lot (the roomier garage-free plan always scores better there;
           measured: no garage at 40-55ft with garage:'2car'). An explicit
           request now loses only to the HARD gates: same bed count + the
           room-dim/aspect/suite contracts. 'auto' keeps the score gate.
           GABLE-HEAVY CARVE-OUT: on farmhouse/craftsman/cottage the kept
           squeezed massing extinguished the style's HOUSE gables on 3/20
           acceptance rolls (the R67 redline — dev-roofpolicy-test). Until
           the roof assigner can gable a garage-squeezed bar, those styles
           keep the old drop-rather-than-extinguish behavior; ranch/modern/
           etc. honor the explicit request. */
        const sty = ((opts && opts.style) || '').toLowerCase();
        const gableHeavy = sty.indexOf('farmhouse') >= 0 || sty.indexOf('craftsman') >= 0 || sty.indexOf('cottage') >= 0;
        const explicit = !gableHeavy && (opts.garage === '1car' || opts.garage === '2car');
        const keepGarage = bedsOf(best.cand) >= bedsOf(bestFree.cand) &&
          (explicit || best.sc <= bestFree.sc + 60) && contractsOK(best.cand);
        if (!keepGarage) { best = bestFree; gPlan = null; }
      }
    }
    if (!best && gPlan) {
      // the reserved-width design failed to solve → fall back to a garage-free house
      gPlan = null;
      for (let k = 0; k < K; k++) {
        const rngK = mulberry32((seed ^ Math.imul(k + 1, 0x9E3779B9)) >>> 0);
        const fn = partiFor(k, K);
        let cand = null;
        try { cand = fn(frame, style, opts, rngK); } catch (e) { cand = null; }
        if (!cand) continue;
        if (!fitsEnvelope(cand, frame)) continue;   // R67 setback truth
        cand._availW = frame.W - 12; cand._availD = frame.D - 12;
        const sc = scoreCand(cand, opts) - (fn === partis[0] ? 15 : 0);
        if (!best || sc < best.sc - 1e-9) best = { cand, sc, k };
      }
    }
    /* R67 — NAME THE CONSTRAINT. "cannot host the program" told a user on a 20ft
       Chicago lot nothing. Report the buildable envelope they actually have and
       the narrowest 1-story parti the generator owns, so the answer is "you need N
       more feet of X", not a shrug. (The alternative — silently drawing a house
       over the property line — is what fitsEnvelope now stops.) */
    if (!best) {
      const bw = (designFrame.W / 12), bd = (designFrame.D / 12);
      const why = [];
      if (mode === '1story' && bw - 1 < NARROW_FLOOR_W / 12)
        why.push(`the narrowest 1-story parti needs ${(NARROW_FLOOR_W / 12).toFixed(1)}ft of buildable width`);
      if (bd < 40) why.push('a 1-story parti needs about 40ft of buildable depth');
      throw new Error('generator: the buildable envelope after setbacks is ' +
        `${bw.toFixed(1)}ft wide x ${bd.toFixed(1)}ft deep` +
        (why.length ? ' — ' + why.join('; ') : ' — no parti fits the requested program') +
        '. Reduce the side setbacks or the bedroom count, or draw a wider lot.');
    }
    const cand = best.cand;

    /* R46 — FRESH YARD ON A FRESH HOUSE (Steve: "when a new house generates all
       the yard stuff needs to go — planters, pools, everything concrete,
       driveways, sidewalks"). A new footprint makes old yard placements stale,
       and only _gen features were swept before, so user/AI-placed objects piled
       up. Clear the whole yard DESIGN; the generator re-lays it below. Runs
       HERE — after the fit is confirmed — so a generate that CANNOT fit (throws
       above) leaves the existing yard untouched instead of nuking it. Rotate is
       the opposite (preserves) and never calls generate. preserveDesign is the
       internal re-derive flag a real Generate never sets. */
    if (!opts.preserveDesign) clearYardForGenerate(model);

    // ---- ATTACHED GARAGE (front-load): extend the footprint into an L/T mass
    // BEFORE placement so the existing front-bias + wall/roof/_genRooms pipeline
    // handles the composed footprint uniformly ----
    let garageInfo = null;
    // an ADU corner garage is designed INSIDE designADU (cand.garage already set);
    // the front-load house garage still attaches here.
    try { garageInfo = cand.garage || attachGarage(cand, frame, style, mode, opts, rng, gPlan); } catch (e) { garageInfo = null; }
    // reset any prior garage record up front — a regen to garage:'none' must not carry
    // a stale _genGarage (which would make the front-yard sweep think a garage exists
    // and skip removing the old driveway). applyGarage re-sets it when a garage lands.
    if (!garageInfo) delete model._genGarage;

    // ---- place the footprint in the envelope (front-biased) + freeze fp ----
    const fu0 = snap(Math.max(GRID, (frame.W - cand.W) / 2));
    const fv0 = snap(clamp((frame.D - cand.D) * 0.25, GRID, Math.max(GRID, frame.D - cand.D - GRID)));
    for (const plan of cand.plans) {
      for (const r of plan.rooms) { r.u0 += fu0; r.u1 += fu0; r.v0 += fv0; r.v1 += fv0; }
      if (plan.stairs) { plan.stairs.u0 += fu0; plan.stairs.u1 += fu0; plan.stairs.v0 += fv0; plan.stairs.v1 += fv0; }
    }
    for (const p of cand.loop) { p.u += fu0; p.v += fv0; }
    const bbox = { u0: fu0, v0: fv0, u1: fu0 + cand.W, v1: fv0 + cand.D };
    const fp = { loop: cand.loop, edges: loopEdgesOf(cand.loop), rect: bbox };
    const plans = cand.plans;

    /* ROOM CODE (R185): stamp the footprint's NAMED boundary edges (front/
       back/left/right — the author's own axes, v runs front→back) as WORLD
       segments. roomcode.js pins per-edge gables against these AFTER its
       roof-form pass; the frame dies with this call, and world space is the
       only safe currency later (the frame-vs-world gable lesson). */
    if (opts._roomcode) {
      let vLo = Infinity, vHi = -Infinity, uLo = Infinity, uHi = -Infinity;
      for (const e of fp.edges) {
        if (e.axis === 'h') { vLo = Math.min(vLo, e.c); vHi = Math.max(vHi, e.c); }
        else { uLo = Math.min(uLo, e.c); uHi = Math.max(uHi, e.c); }
      }
      const seg = (e) => {
        const A = e.axis === 'h' ? frame.toWorld(e.a, e.c) : frame.toWorld(e.c, e.a);
        const B = e.axis === 'h' ? frame.toWorld(e.b, e.c) : frame.toWorld(e.c, e.b);
        return { x1: A.x, y1: A.y, x2: B.x, y2: B.y };
      };
      const cls = { front: [], back: [], left: [], right: [] };
      for (const e of fp.edges) {
        if (e.axis === 'h' && Math.abs(e.c - vLo) < 1) cls.front.push(seg(e));
        else if (e.axis === 'h' && Math.abs(e.c - vHi) < 1) cls.back.push(seg(e));
        else if (e.axis === 'v' && Math.abs(e.c - uLo) < 1) cls.left.push(seg(e));
        else if (e.axis === 'v' && Math.abs(e.c - uHi) < 1) cls.right.push(seg(e));
      }
      model._rcEdges = cls;
      /* R186: the AUTHORED→WORLD transform. Authored inches map to frame
         u/v as (a - n) + f0 (compile's 0-origin normalization + this
         placement), and frame.toWorld dies with this call — stamp the
         affine so site-composed declarations (carport / detached garage)
         can be placed in the author's own coordinates post-generate. */
      const rcDoc = opts._roomcode;
      const o0 = frame.toWorld(0, 0), oU = frame.toWorld(12, 0), oV = frame.toWorld(0, 12);
      model._rcXform = {
        du: fu0 - (rcDoc._nu || 0), dv: fv0 - (rcDoc._nv || 0),
        o: { x: o0.x, y: o0.y },
        eu: { x: (oU.x - o0.x) / 12, y: (oU.y - o0.y) / 12 },
        ev: { x: (oV.x - o0.x) / 12, y: (oV.y - o0.y) / 12 },
      };
    }

    // ---- per-level footprint: the GARAGE is a 1-story mass, so UPPER levels use a
    // house-only loop (no garage). Derived from each upper plan's own room tiling.
    // (No garage → all levels share `fp`, byte-identical to the legacy path.) ----
    const fpFor = (li) => {
      if (!garageInfo || li === 0) return fp;
      const rects = plans[li].rooms.map((rr) => ({ u0: rr.u0, v0: rr.v0, u1: rr.u1, v1: rr.v1 }));
      const loop = traceRectUnion(rects);
      if (!loop || loop.length < 4) {
        // HARDENED fallback (Steve Jul 6: "its creating a 2nd story garage!!!"):
        // NEVER fall back to the full L0 fp here — it includes the GARAGE mass, so a
        // traceRectUnion failure would silently build a phantom second story over the
        // garage (walls/platform/ceiling/roof all keying off this loop). The upper
        // plans never tile the garage strip, so their room BOUNDING BOX is always a
        // garage-free envelope — use that rectangle instead. (Verified: on current
        // code the union succeeds across the whole 2story matrix — this guards the
        // failure path only; the true L0 fp is still returned when there's no garage.)
        let lo = Infinity, hi = -Infinity, vlo = Infinity, vhi = -Infinity;
        for (const rr of plans[li].rooms) {
          lo = Math.min(lo, rr.u0); hi = Math.max(hi, rr.u1);
          vlo = Math.min(vlo, rr.v0); vhi = Math.max(vhi, rr.v1);
        }
        if (!isFinite(lo) || !(hi - lo > 1) || !(vhi - vlo > 1)) return fp;
        const bb = [{ u: lo, v: vlo }, { u: hi, v: vlo }, { u: hi, v: vhi }, { u: lo, v: vhi }];
        return { loop: bb, edges: loopEdgesOf(bb), rect: { u0: lo, v0: vlo, u1: hi, v1: vhi } };
      }
      let lo = Infinity, hi = -Infinity, vlo = Infinity, vhi = -Infinity;
      for (const p of loop) { lo = Math.min(lo, p.u); hi = Math.max(hi, p.u); vlo = Math.min(vlo, p.v); vhi = Math.max(vhi, p.v); }
      return { loop, edges: loopEdgesOf(loop), rect: { u0: lo, v0: vlo, u1: hi, v1: vhi } };
    };

    // ---- rebuild model levels ----
    const S = model.settings;
    const wallH = S.wallHeight || 96;
    // ---- MEP REGEN SWEEP (Steve, Jul 14: "electrical and hvac don't regenerate
    // on Random/Generate — leaves bad electrical everywhere"). The per-level
    // device arrays die with the level replacement below, but MODEL-level MEP
    // state survives it: model.mech (HVAC equipment/ducts/registers at the OLD
    // house's coordinates) and model.electrical (service/panels/circuits sized
    // for the old design). Remember whether the previous design HAD the auto
    // passes, sweep the stale state, and re-run them on the finished house at
    // the end of generate — a re-generated house comes out with clean
    // code-spaced electrical + a load-sized HVAC, never leftovers. ----
    const _priorMEP = {
      elecAuto: (model.levels || []).some((L) => (L.electrical || []).some((e) => e && e._auto)),
      mechSystem: (model.mech && model.mech.system) || null,
      waterHeater: (model.levels || []).some((L) => (L.fixtures || []).some((f) => f && (f.type === 'hpwh' || f.type === 'water_heater'))),
    };
    if (model.mech) delete model.mech;                 // old-geometry ducts/registers/equipment
    if (model.electrical) delete model.electrical;     // service/circuits re-seed from the new design
    if (model._fpOrigin) delete model._fpOrigin;       // stale one-shot floor-plan anchors (the
    if (model._fpSpec) delete model._fpSpec;           // generated design owns the level now)
    model.levels = plans.map((_, i) => HA.makeLevel('Level ' + (i + 1), wallH));

    const levelFps = plans.map((_, li) => fpFor(li));
    // ---- stamp the room map BEFORE buildLevel runs — the kitchen designer (called
    // inside buildLevel) resolves its zone from model._genRooms, and on a RE-generate
    // the stamp still held the PREVIOUS generation's rects, so the designed kitchen
    // landed at the old kitchen's world rect. Stamping fresh here (the plans/frame
    // are already final) also lets design()'s room-rect clear work on the first pass.
    model._genRooms = plans.map((plan, li) => plan.rooms.map((r) => {
      const a = frame.toWorld(r.u0, r.v0), b = frame.toWorld(r.u1, r.v1);
      return {
        level: li, name: r.name, kind: r.kind, primary: r.beds === 'primary',
        x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
        u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1,
      };
    }));
    for (let li = 0; li < plans.length; li++) {
      buildLevel(model, li, plans[li], levelFps[li], frame, style, opts, rng);
    }

    // ---- STYLE-AWARE FENESTRATION (Steve: "craftsman gets the upper lite…make
    // sure they follow the style"). Stamp every generated window with the
    // operation type + grid pattern that fits the house style — craftsman gets
    // the divided upper sash, modern/ranch run grid-free sliders, farmhouse/
    // cottage carry true colonial grids. Small/privacy windows (baths) drop the
    // grid and stay fixed-ish so they don't read busy. ----
    {
      const wd = (HA.windowDefaultsFor ? HA.windowDefaultsFor(styleKey)
        : { winType: 'double_hung', grid: 'colonial' });
      for (const L of model.levels) {
        for (const w of (L.walls || [])) {
          for (const o of (w.openings || [])) {
            if (o.kind !== 'window') continue;
            o.winType = wd.winType;
            o.grid = wd.grid;
            o.muntins = (wd.grid && wd.grid !== 'none');
            // a wide, low-sill living/great light reads best as a fixed picture.
            if (o.width >= 60 && o.height >= 72) { o.winType = 'picture'; }
            // small privacy lights (bath) — keep them plain and grid-free.
            if (o.width <= 30 && o.height <= 36) { o.grid = 'none'; o.muntins = false; o.winType = 'slider'; }
            if (o.winType === 'slider') o.slide = (o.pos % 2 < 1) ? 'left' : 'right';
          }
        }
      }
    }

    // ---- persist the ZONE MAP — the honest record of where every plan room
    // and open-concept ZONE is (kitchen/dining/great have no walls between
    // them, so detectRooms merges them into one region and can't tell you
    // where the dining zone ends). This is the foundation the room-REMIX
    // features build on (bathrooms + bedrooms next): serializable world-space
    // quads, rotation-safe (the frame can be rotated to the parcel). ----
    for (let li = 0; li < plans.length; li++) {
      const toW = frame.toWorld;
      model.levels[li]._genZones = plans[li].rooms
        .filter((r) => r.name && (r.u1 - r.u0) > 6 && (r.v1 - r.v0) > 6)
        .map((r) => ({
          name: r.name, kind: r.kind, open: !!r.open,
          pts: [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]]
            .map(([u, v]) => { const p = toW(u, v); return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; }),
        }));
    }

    // ---- hillside foundation (BEFORE porch: the deck-on-hills logic reads the
    // grade + auto-enables the backyard bench off it) ----
    applyFoundation(model, fp, frame, mode, style);

    // ---- HILLS/DECKS A1-A2: read the grade under/behind the footprint, and on a
    // steep rear slope AUTO-ENABLE the backyard bench (a level yard held by a
    // retaining terrain wall). `grade` drives the deck-on-hills preference below. ----
    const grade = gradeInfo(model, fp, frame);
    autoEnableBench(model, fp, frame, grade);

    // ---- porch / decks (favors WOOD decks + bigger front/rear on hills) ----
    applyPorch(model, plans[0], fp, frame, style, opts, rng, grade);

    // ---- style: roof + finishes (massing-aware gable assignment lives here) ----
    applyStyle(model, style, mode, { plan: plans[0], fp, frame, garageInfo, opts, rng });

    // ---- GARAGE: fire separation (CRC R302.6) + driveway ----
    if (garageInfo) applyGarage(model, plans[0], fp, frame, garageInfo, opts);

    // ---- GARAGE WING ROOF PITCH (Steve redline Jul 6: "your attached garage roof
    // are still sunk down too"). The lower-roof AUTO pitch caps itself so the DEEPEST
    // exposed inset dies below the 2nd-floor reveal — but that bound uses the full
    // wall-to-wall depth, while the straight skeleton's real die-in height is governed
    // by the distance to the NEAREST eave (the garage HALF-WIDTH). On a 2-story with
    // an attached 2-car garage the depth-based cap crushes the whole wing roof to a
    // ~1:12 pancake at plate height ("sunk"). Fix WITHOUT touching the roof engine:
    // set the explicit model.roof.lowerPitch (in :12 — the engine honors it with its
    // own upper-plate poke-through clamp) to the steepest pitch that keeps the garage
    // die-in apex just below the 2nd-floor window sills:
    //   apex = L0plate + halfWidth·m  ≤  sillZ (L1 floor + 32")
    // clamped to [3, stylePitch] so the wing reads like a real roof but never out-
    // pitches the main. 1-story houses keep the default (no lower roofs to fix).
    if (garageInfo && model.levels.length > 1) {
      try {
        const gi3 = HA.garageInfo(model);
        if (gi3 && gi3.rect) {
          const r3 = gi3.rect;
          // WING MASS RULE (Steve, seed 720063791: "2-story garage"). The wing's
          // roof DIES INTO the upper wall across its FULL inset run — NOT half its
          // short span (the old halfW/sill model let a 3:12 wing climb ~37" above
          // a modern 10ft plate, its high edge landing in the L1 window band).
          // Run = the rect extent PERPENDICULAR to the edge shared with the upper
          // mass; target apex = the L1 FLOOR BAND + 6" (clearly below the story
          // above — draftsman practice). Floored at 1.5:12 (modern tall plates
          // land here); the roof engine's own massCap backstops anything steeper.
          const up3 = HA.exteriorLoop(model, 1);
          let runIn = Math.min(r3.x1 - r3.x0, r3.y1 - r3.y0);
          if (up3 && up3.pts && up3.pts.length) {
            let ux0 = 1e9, ux1 = -1e9;
            for (const p of up3.pts) { ux0 = Math.min(ux0, p.x); ux1 = Math.max(ux1, p.x); }
            const besideX = r3.x0 >= ux1 - 2 || r3.x1 <= ux0 + 2;   // garage BESIDE the house -> dies in across its X extent
            runIn = besideX ? (r3.x1 - r3.x0) : (r3.y1 - r3.y0);
          }
          const plateZ = Math.max(...model.levels[0].walls.map((w) => w.height || model.settings.wallHeight));
          const bandZ = HA.levelElev(model, 1) + 6;                // wing apex cap: L1 floor band + 6"
          const maxM = Math.max(0, bandZ - plateZ) / Math.max(24, runIn);
          const stylePitch = model.roof.pitch || 6;
          const lp = Math.max(1.5, Math.min(stylePitch, Math.floor(maxM * 12 * 2) / 2));
          model.roof.lowerPitch = lp;
        }
      } catch (e) { /* pitch tune is additive — the auto pitch still builds a roof */ }
    }

    // ---- AUTO BACKYARD DESIGN (HILLS/DECKS A3) — after the garage regen sweep
    // (which strips _gen site features), furnish the rear yard with a seeded
    // archetype (patio/BBQ/dining/fire pit/beds). All features tagged _gen so the
    // next regen replaces them. ----
    applyBackyard(model, opts);

    // ---- FRONT YARD + WALKWAYS (Steve, Jul 5) — runs WITH OR WITHOUT a garage:
    // sweeps prior _gen front features, guarantees no driveway when garage:'none',
    // lays the front walkway (L-shape to the drive / straight to the sidewalk) + seeds
    // front-yard designs + walkway material variants. All _gen tagged (regen-swept). ----
    applyFrontYard(model, { seed: opts.seed, style: styleKey });

    // (model._genRooms is stamped BEFORE the buildLevel loop above — the kitchen
    // designer reads it mid-build, and the old post-build stamp meant a re-generate
    // designed the kitchen against the PREVIOUS generation's room rects.)

    // ---- UNDER-ROOF REAR PORCH (Steve: "back patios under the roof line") — a seeded
    // ~42% share of 1-story plans carve a covered porch from the great-room's back
    // corner (away from the rear slider so it survives): the main roof continues over
    // it (the loop is unchanged), the loop-side walls open to posts+beam, a French door
    // leads onto it. Runs BEFORE the room designers so the great-room's furnishable rect
    // (model._genRooms) is shrunk clear of the porch and auto-arrange never seats a sofa
    // on the open porch. Fail-soft. ----
    try { applyRearPorch(model, plans[0], fp, frame, style, opts); } catch (e) { /* additive — never break generate */ }

    // ---- AUTO ROOM DESIGNERS — now that model._genRooms exists, hand the soft
    // great room (living/dining/entry) to HA.arrange and run the parametric LAUNDRY
    // + BATHROOM designers (Steve: auto laundry/bathroom). Deterministic seed per
    // level; guarded + fail-soft (an unloaded designer leaves the generator's basic
    // fixtures). The engines are re-runnable on a saved model (world coords), but
    // dedicated UI "room mode" buttons for laundry/bath are still a FOLLOW-UP —
    // only the kitchen has an on-demand trigger today. ----
    for (let li = 0; li < plans.length; li++) {
      const ds = ((seed >>> 0) * 2654435761 + li * 40503) >>> 0;
      try { if (HA.arrange && HA.arrange.greatRoom) HA.arrange.greatRoom(model, li, { seed: (ds ^ 0x9e3779) >>> 0 }); } catch (e) { /* additive */ }
      try { if (HA.laundry && HA.laundry.design) HA.laundry.design(model, li, { seed: (ds ^ 0x5bd1e995) >>> 0 }); } catch (e) { /* additive */ }
      try { if (HA.bathroom && HA.bathroom.designAll) HA.bathroom.designAll(model, li, { seed: (ds ^ 0x27d4eb2f) >>> 0 }); } catch (e) { /* additive */ }
    }


    // ---- ENTRY + GARAGE SCONCES (Steve: "i still don't see sconces on the auto
    // build") — the generator never ran ANY autoplace, so generated houses came
    // out lightless. Run the TARGETED sconce-only pass (front-door flank + garage
    // flank per the Jul-6 rules) — NOT the full electrical autoplace (interior
    // outlets etc. stay user-triggered via ⚡). Idempotent + fail-soft. ----
    try { if (HA.autoplace && HA.autoplace.placeEntrySconces) HA.autoplace.placeEntrySconces(model); } catch (e) { /* additive */ }
    // interior RECESSED-CAN grid in habitable rooms — so generated houses have
    // ceiling lighting (was dark). Idempotent + fail-soft, like the sconce pass.
    try { if (HA.autoplace && HA.autoplace.placeRecessedCans) HA.autoplace.placeRecessedCans(model); } catch (e) { /* additive */ }
    // SERVICE EQUIPMENT (main panel + utility meter) on a side/rear exterior wall —
    // generated houses were missing the electrical service box entirely.
    try { if (HA.autoplace && HA.autoplace.placeServiceEquipment) HA.autoplace.placeServiceEquipment(model); } catch (e) { /* additive */ }

    // ---- ADU DEFAULT DHW (Steve, Jul 2026): the HPWH lives OUTSIDE in its
    // louvered galvanized-metal exterior enclosure on a service wall — ONE real
    // movable fixture, never in front of a window or door and clear of the
    // entrance. Runs POST-build so every wall + opening exists for the slot
    // scorer. Larger homes keep the interior garage/utility placement above.
    // Fail-soft (waterheater.js may be unloaded headlessly). ----
    if (mode === 'adu') {
      try {
        if (HA.waterheater && HA.waterheater.place)
          HA.waterheater.place(model, { mount: 'exterior' });
      } catch (e) { /* additive — never break generate */ }
    }

    // ---- MEP REGEN RE-RUN (pairs with the sweep at the level rebuild): the
    // previous design had the auto passes → run the SAME shared passes on the
    // finished house. applyAutoElectrical is the exact function behind the AI's
    // auto_electrical tool; mech.autoDesign keeps the previously chosen system.
    // Fail-soft — never break generate. ----
    if (_priorMEP.elecAuto) {
      try { if (HA.autoplace && HA.autoplace.applyAutoElectrical) HA.autoplace.applyAutoElectrical(model); } catch (e) { /* additive */ }
    }
    /* R180 (Steve: "on auto generate house include hvac now, and hvac
       selection in generate house") — EVERY generate designs HVAC, not just
       regenerates that had a prior system. Precedence: an explicit
       opts.hvac ('minisplit'|'ducted'|'heatpump') wins; 'none' skips;
       otherwise the prior system carries across a regenerate; otherwise
       mech.autoDesign's own default (mini-split) applies. Fail-soft. */
    {
      const HVAC_KINDS = ['minisplit', 'ducted', 'heatpump'];
      const want = opts.hvac === 'none' ? null
        : HVAC_KINDS.indexOf(opts.hvac) >= 0 ? opts.hvac
        : (_priorMEP.mechSystem || 'auto');
      if (want && mode !== 'adu') {
        try {
          if (HA.mech && HA.mech.autoDesign)
            model.mech = HA.mech.autoDesign(model, want === 'auto' ? {} : { system: want });
        } catch (e) { /* additive — never break generate */ }
      }
    }
    // EVERY non-ADU build gets its water heater from the placement-policy
    // engine (garage corner > closet/utility > legal laundry run > exterior
    // fallback) — run AFTER the room designers so the ladder sees the real
    // appliance/cabinet layout. The level-build's basic corner tank (a
    // pre-designer placeholder that the door-swing guard silently skipped on
    // most plans, shipping houses with NO water heater) is stripped first —
    // waterheater.place owns DHW now. (Was: re-place only when the PRIOR
    // design had one, which on furnished houses dropped the unit AT the
    // laundry label on top of the washer/dryer — Steve, Jul 19.)
    if (mode !== 'adu') {
      try {
        if (HA.waterheater && HA.waterheater.place) {
          for (const L of model.levels) if (Array.isArray(L.fixtures))
            L.fixtures = L.fixtures.filter((f) => !(f && f.type === 'water_heater' && !f._autoWH));
          HA.waterheater.place(model, { mount: 'auto' });
        }
      } catch (e) { /* additive */ }
    }

    // ---- stamp the APPLIED program so reroll/status never echo a request that
    // the selected candidate could not fit. Candidate designers are called many
    // dozens of times by probe + scored/fallback searches; they intentionally
    // stay side-effect-free. Only the CHOSEN, fully stamped room map may warn.
    const stampedRooms = (model._genRooms || []).flat().filter(Boolean);
    const actualBeds = stampedRooms.filter((r) => r.kind === 'bed').length;
    const actualBaths = stampedRooms.filter((r) => r.kind === 'bath').length;
    const shortfalls = [];
    /* R68 — SAY WHY, AND SAY WHAT TO DO. "requested 3 bedrooms; selected plan
       fits 2" was the entire message on a 36ft lot, which reads as the tool
       being unable to count. When the bed count is the casualty of a narrow
       envelope, quote the width a 3-bed actually needs, the width this lot has
       after ITS OWN setbacks, and the smallest change that buys it. */
    const bedShortWhy = () => {
      if (mode !== '1story' || actualBeds < 2 || !Number.isFinite(NARROW_3BED_W)) return '';
      const haveW = (cand && cand._availW) || (frame.W - 12);   // house width available
      const haveD = (cand && cand._availD) || (frame.D - 12);
      const sb = (model.site && model.site.setbacks) || {};
      if (NARROW_3BED.some((c) => c.W <= haveW && c.D <= haveD)) return '';   // width/depth were not the blocker
      if (haveW < NARROW_3BED_W) {
        const needB = (NARROW_3BED_W + 12) / 12, haveB = (haveW + 12) / 12;
        const newSide = sb.side ? Math.floor((sb.side - (NARROW_3BED_W - haveW) / 2) / 6) * 6 : 0;
        return ` — a 3-bedroom 1-storey needs ${needB.toFixed(1)}ft of buildable WIDTH` +
          ` (two ${(PROG.bed.minDim / 12).toFixed(0)}ft bedrooms either side of a 3'-6" hall);` +
          ` this lot gives ${haveB.toFixed(1)}ft after the setbacks.` +
          (newSide >= 36 ? ` Drop the side setback to ${(newSide / 12).toFixed(1)}ft`
            : ' Widen the lot') +
          ` (or add ${(needB - haveB).toFixed(1)}ft of width) and the 3-bed fits;` +
          ' otherwise this is the 2-bedroom.';
      }
      /* WIDTH was fine, so the third bedroom was lost to DEPTH: at this width the
         only 3-bed parti stacks its program front-to-back, and that plan is 59ft
         deep before it is anything else. Measured on a 36ft x 95ft lot — width
         to spare, one foot short on depth. Saying "width" there would have been
         a confident wrong answer, so the second lever quoted is the width at
         which a SHALLOWER 3-bed parti (narrowRear, 40ft deep) becomes available. */
      const deep = NARROW_3BED.filter((c) => c.W <= haveW).reduce((m, c) => Math.min(m, c.D), Infinity);
      const wide = NARROW_3BED.filter((c) => c.D <= haveD).reduce((m, c) => Math.min(m, c.W), Infinity);
      if (!Number.isFinite(deep)) return '';
      const needB = (deep + 12) / 12, haveB = (haveD + 12) / 12;
      return ` — this lot has the width, but at ${((haveW + 12) / 12).toFixed(1)}ft of buildable width` +
        ' a 3-bedroom has to stack its rooms front-to-back, and that plan needs' +
        ` ${needB.toFixed(1)}ft of buildable DEPTH; this lot gives ${haveB.toFixed(1)}ft after the ` +
        `${((sb.front || 0) / 12).toFixed(0)}ft front and ${((sb.rear || 0) / 12).toFixed(0)}ft rear setbacks.` +
        ` Add ${(needB - haveB).toFixed(1)}ft of depth` +
        (Number.isFinite(wide) ? ` (or ${((wide + 12) / 12).toFixed(1)}ft of buildable width, which lets` +
          ' the plan spread sideways instead)' : '') +
        '; otherwise this is the 2-bedroom.';
    };
    if (actualBeds < beds) shortfalls.push(`requested ${beds} bedrooms; selected plan fits ${actualBeds}${bedShortWhy()}`);
    if (actualBaths < baths) shortfalls.push(`requested ${baths} bathrooms; selected plan fits ${actualBaths}`);
    const warning = shortfalls.length ? shortfalls.join(' · ') : null;
    if (warning) { try { console.warn('generator: ' + warning); } catch (e) {} }
    model._genOpts = { mode, style: styleKey, beds: actualBeds, baths: actualBaths,
      requestedBeds: beds, requestedBaths: baths, warning,
      porch: opts.porch || 'auto', garage: opts.garage || 'auto', seed,
      parti: ((plans[0] && plans[0].parti) || 'splitL') + (plans[0] && plans[0].coreFlip ? '+frontKitchen' : '') };
    /* R66 (Steve: "if they generate like a 3 bed house or whatever it shouldnt
       say adu"). Generate never wrote project.type at all, so the cover kept
       whatever the model was born with — 'adu' by default, or 'carport' if the
       user started in Carport mode. That type is not cosmetic: the cover
       declares the occupancy, electrical.projectIsAdu feeds an ADU from a
       subpanel instead of a main, and the energy screen scopes to it. The
       generator knows exactly what it drew, so it says so. */
    try { if (model.project) model.project.type = (mode === 'adu') ? 'adu' : 'house'; } catch (e) {}
    /* R64 — Generate rebuilds model.levels from scratch and clearYardForGenerate
       sweeps site.features, which destroys the detached carport's solids AND its
       graded pad — but model.carport survives, and view3d still draws
       HA.carport.faces(model) from it. That left the gable and masonry faces
       hanging in mid-air over bare ground with no slab and no cut, and the next
       ↻ Update reusing a stale origin. Put the whole carport back on the new
       site; if it can't be rebuilt, drop the record rather than render a ghost. */
    try {
      if (model.carport && HA.carport && HA.carport.reseat) {
        HA.carport.reseat(model);
        if (!(model.levels[0].solids || []).some((s) => s && s.carport)) delete model.carport;
      }
    } catch (e) { try { delete model.carport; } catch (e2) {} }
    return model;
  };

  /* ---- build all walls, openings, fixtures, labels for one level ---- */
  const buildLevel = (model, li, plan, fp, frame, style, opts, rng) => {
    const lvl = model.levels[li];
    const S = model.settings;
    const toW = frame.toWorld;
    // 1) EXTERIOR loop — straight from the candidate's rectilinear footprint loop.
    // GARAGE-BOUNDARY SPLIT (Steve: "slight gap in the front garage wall, don't
    // line up — an issue on your coding end"): a TRUE-FLUSH garage front is
    // COLLINEAR with the house front, so the loop tracer collapses them into ONE
    // edge → one wall → the dropped-garage chain (garageWallDrop / door cut /
    // curb / band skip) lost its dedicated garage wall. The old 6"-proud
    // workaround read as a misaligned front. Root fix: split any loop edge that
    // is collinear with a garage-rect side AT the garage corners, so the garage
    // segment stays its own wall entity while the fronts align at exactly 0.
    const gRoom = li === 0 ? ((plan.rooms || []).find((r) => r.kind === 'garage' || r.garage) || null) : null;
    const splitsFor = (a, b) => {
      if (!gRoom) return [];
      const out = [];
      if (Math.abs(a.v - b.v) < 0.01) {          // horizontal edge at v = a.v
        if (Math.abs(a.v - gRoom.v0) < 0.01 || Math.abs(a.v - gRoom.v1) < 0.01) {
          const lo = Math.min(a.u, b.u), hi = Math.max(a.u, b.u);
          for (const u of [gRoom.u0, gRoom.u1]) if (u > lo + 1 && u < hi - 1) out.push({ u, v: a.v });
          out.sort((p, q) => (b.u > a.u ? p.u - q.u : q.u - p.u));
        }
      } else if (Math.abs(a.u - b.u) < 0.01) {   // vertical edge at u = a.u
        if (Math.abs(a.u - gRoom.u0) < 0.01 || Math.abs(a.u - gRoom.u1) < 0.01) {
          const lo = Math.min(a.v, b.v), hi = Math.max(a.v, b.v);
          for (const v of [gRoom.v0, gRoom.v1]) if (v > lo + 1 && v < hi - 1) out.push({ u: a.u, v });
          out.sort((p, q) => (b.v > a.v ? p.v - q.v : q.v - p.v));
        }
      }
      return out;
    };
    const extPts = fp.loop;
    const extWalls = [];
    // construction system: SIP projects generate their shell as 6-1/2" SIP
    // panels (same ext class — the loop/roof/foundation see no difference);
    // interior partitions stay conventional 2x stick either way.
    const extType = (S.construction === 'sip') ? 'ext_sip65' : 'ext2x6';
    for (let i = 0; i < extPts.length; i++) {
      const a = extPts[i], b = extPts[(i + 1) % extPts.length];
      const chain = [a, ...splitsFor(a, b), b];
      for (let s = 0; s + 1 < chain.length; s++) {
        const sa = chain[s], sb = chain[s + 1];
        const wa = toW(sa.u, sa.v), wb = toW(sb.u, sb.v);
        const w = HA.makeWall(wa.x, wa.y, wb.x, wb.y, extType, S);
        // remember local endpoints for opening placement
        w._loc = { a: sa, b: sb };
        lvl.walls.push(w); extWalls.push(w);
      }
    }

    // 2) INTERIOR partitions: every room edge NOT on the loop boundary, MINUS any
    // span where BOTH sides are OPEN zones (the open-concept core has no walls —
    // foyer/great/kitchen/dining/hall-approach flow into each other).
    const segs = [];   // {axis:'v'|'h', c, a, b}
    const addSeg = (axis, c, a, b, room) => {
      if (b - a < 6) return;
      let spans = [[Math.min(a, b), Math.max(a, b)]];
      if (room && room.open) {
        // subtract intervals shared with other OPEN rooms on the same line
        for (const r2 of plan.rooms) {
          if (r2 === room || !r2.open) continue;
          const lineOn = axis === 'v'
            ? (Math.abs(r2.u0 - c) < 1 || Math.abs(r2.u1 - c) < 1)
            : (Math.abs(r2.v0 - c) < 1 || Math.abs(r2.v1 - c) < 1);
          if (!lineOn) continue;
          const o0 = axis === 'v' ? r2.v0 : r2.u0, o1 = axis === 'v' ? r2.v1 : r2.u1;
          const next = [];
          for (const [s0, s1] of spans) {
            const c0 = Math.max(s0, o0), c1 = Math.min(s1, o1);
            if (c1 - c0 <= 1) { next.push([s0, s1]); continue; }
            if (c0 - s0 > 6) next.push([s0, c0]);
            if (s1 - c1 > 6) next.push([c1, s1]);
          }
          spans = next;
        }
      }
      for (const [s0, s1] of spans) if (s1 - s0 >= 6) segs.push({ axis, c, a: s0, b: s1 });
    };
    // subtract the spans of `edge [c: a..b on axis]` that lie ON the exterior loop
    // → the remaining INTERIOR spans (a room edge can be PARTLY on the loop and
    // partly interior, e.g. the GARAGE seam where the garage projects/recedes past
    // the house; the plain onLoop gate would drop the whole edge). Returns spans.
    const interiorSpans = (axis, c, a, b) => {
      let spans = [[a, b]];
      for (const e of fp.edges) {
        if (e.axis !== axis || Math.abs(e.c - c) >= 1) continue;
        const next = [];
        for (const [s0, s1] of spans) {
          const c0 = Math.max(s0, e.a), c1 = Math.min(s1, e.b);
          if (c1 - c0 <= 1) { next.push([s0, s1]); continue; }
          if (c0 - s0 > 6) next.push([s0, c0]);
          if (s1 - c1 > 6) next.push([c1, s1]);
        }
        spans = next;
      }
      return spans;
    };
    const addRoomEdge = (r, axis, c, a, b) => {
      if (r.kind === 'garage') { for (const [s0, s1] of interiorSpans(axis, c, a, b)) addSeg(axis, c, s0, s1, r); }
      else if (!onLoop(fp.edges, axis, c, a, b)) addSeg(axis, c, a, b, r);
    };
    for (const r of plan.rooms) {
      addRoomEdge(r, 'v', r.u0, r.v0, r.v1);
      addRoomEdge(r, 'v', r.u1, r.v0, r.v1);
      addRoomEdge(r, 'h', r.v0, r.u0, r.u1);
      addRoomEdge(r, 'h', r.v1, r.u0, r.u1);
    }
    const merged = mergeSegs(segs);
    const intWalls = [];
    for (const s of merged) {
      let a, b;
      if (s.axis === 'v') { a = toW(s.c, s.a); b = toW(s.c, s.b); }
      else { a = toW(s.a, s.c); b = toW(s.b, s.c); }
      const w = HA.makeWall(a.x, a.y, b.x, b.y, 'int2x4', S);
      w._locSeg = s;
      lvl.walls.push(w); intWalls.push(w);
    }

    // 2b) CEILINGS — 9' minimum (owner: "all ceilings 8' — should be min 9'"),
    // 10' for the modern / big-glass styles. Set the LEVEL height (levelElev
    // reads it) AND each wall's own height (makeWall seeded settings.wallHeight,
    // which we deliberately do NOT mutate — the user owns settings).
    const ceilH = (style.mono || style.bigGlass) ? 120 : 108;
    lvl.height = ceilH;
    for (const w of lvl.walls) if (!(HA.isLow && HA.isLow(w))) w.height = ceilH;

    // 3) OPENINGS
    placeOpenings(model, li, plan, fp, frame, style, opts, rng, extWalls, intWalls);

    // 3b) CONNECTIVITY GUARANTEE — every room must be reachable through doors.
    // Uses the SAME geometric flood-fill the tests use: flood the interior over the
    // exterior loop minus wall barriers (door gaps are passable); any room whose
    // centroid is unreached gets a door punched on the wall segment between it and
    // its nearest reached neighbor, then we re-flood — repeating until connected.
    ensureConnectivity(model, li, plan, frame, intWalls, extWalls);

    // 3c) DOOR GUARANTEE — connectivity ensures a room is REACHABLE, but a room
    // reached through an open passage (or whose graph edge failed to seat a door)
    // can end up with NO door slab in its own partition. Steve saw bedrooms + the
    // laundry with no door. Audit every ENCLOSED (non-open) habitable/service room
    // and punch a door on its best hall-facing interior wall if it has none.
    ensureRoomDoors(model, li, plan, frame, intWalls, extWalls, fp);

    // 3d) FINAL DOOR GEOMETRY — hinge + wall-relative swing must be settled
    // BEFORE any bed, nightstand, cabinet, or room designer chooses a footprint.
    // Applying this after furniture let later swing changes sweep through pieces
    // that had correctly avoided the stale default leaf.
    applyDoorSwing(model, li, plan, frame, fp);

    // 4) FIXTURES + LABELS
    placeFixtures(model, li, plan, fp, frame, style, opts, rng);

    // 4a-2) NEW KITCHEN DESIGNER — replace the generator's basic single-box
    // kitchen with the parametric designer: confined to a corner, coherent
    // wall selection, modular runs (drawer bases, doors, fillers), tray + pantry,
    // proper appliances, and an island only where it fits. Consumes exactly ONE
    // rng() call (same as the old hook) so generate() determinism is unchanged.
    // Falls back to modularize+enhance if the kitchen can't be resolved (design
    // never touches walls, only fixtures).
    const kSeed = Math.round(rng() * 1e6);
    let kitchenDesigned = false;
    try {
      if (HA.kitchen && HA.kitchen.design && HA.kitchen.findKitchen && HA.kitchen.findKitchen(model, li)) {
        const r = HA.kitchen.design(model, li, { seed: kSeed });
        kitchenDesigned = !!(r && r.ok);
      }
    } catch (e) { /* fall back below */ }
    if (!kitchenDesigned) {
      try { if (HA.cabinets && HA.cabinets.modularizeLevel) HA.cabinets.modularizeLevel(model, li); } catch (e) {}
      try { if (HA.kitchen && HA.kitchen.enhance) HA.kitchen.enhance(model, li, { seed: kSeed }); } catch (e) {}
    }

    // 4a-3) GREAT-ROOM FURNITURE — hand the soft rooms (living / dining / entry) to
    // the re-runnable arranger so generated houses use the SAME seed-varied, window-
    // and island-aware layout the "New layout" button re-rolls (Steve: "living rooms
    // and door entrance dont auto arrange"). Runs AFTER the kitchen designer so it
    // sees the island as an obstacle; clears + replaces placeFixtures' soft furniture.
    // Deterministic seed derived from kSeed (no extra rng() call). Guarded + fail-soft:
    // without arrange.js loaded, placeFixtures' own furniture stands.
    // NOTE: the great-room ARRANGE + LAUNDRY + BATHROOM designers need model._genRooms,
    // which isn't populated until after the buildLevel loop — they run in a dedicated
    // pass down in generate() once the room map exists (search "AUTO ROOM DESIGNERS").

  };

  // whether a DOOR opening actually pierces the partition on this shared edge:
  // a wall must lie ON the shared line (running along the free axis) and carry a
  // door whose world position falls WITHIN the shared overlap span. Tight so a
  // stray window / a door on a different segment never counts as a passage.
  const edgeHasDoor = (frame, walls, shared) => {
    const toW = frame.toWorld;
    const p0 = shared.axis === 'v' ? toW(shared.c, shared.a) : toW(shared.a, shared.c);
    const p1 = shared.axis === 'v' ? toW(shared.c, shared.b) : toW(shared.b, shared.c);
    // R172 — WORLD-space axis (shared.axis is frame u/v; on a 90°-rotated
    // frame the old frame-vs-world compare made this detector BLIND, so the
    // connectivity pass could neither see nor correctly punch passages)
    const wantAxis = Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y) ? 'h' : 'v';
    for (const w of walls) {
      const d = HA.wallDir(w);
      const wallAxis = Math.abs(d.x) >= Math.abs(d.y) ? 'h' : 'v';
      if (wallAxis !== wantAxis) continue;
      const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
      const wLen = HA.wallLen(w) || 1;
      // wall must be collinear with the shared line (both endpoints near it)
      const tA = U.clamp(U.projT(p0, A, B), 0, 1);
      const distA = U.dist(p0, U.lerp(A, B, tA));
      if (distA > 5) continue;   // wall must sit ON the shared line, not a parallel partition ~1' away
      for (const o of w.openings || []) {
        if (o.kind !== 'door') continue;
        const opWorld = U.lerp(A, B, o.pos / wLen);
        // opWorld must fall inside the shared overlap span [p0..p1] (with a small pad)
        const tt = U.projT(opWorld, p0, p1);
        if (tt >= -0.15 && tt <= 1.15) return true;
      }
    }
    return false;
  };

  // Coarse geometric flood over the level interior. Returns a fn reached(worldPt)
  // telling whether a point is reachable from `startWorld` through door gaps.
  const buildFlood = (model, li, startWorld) => {
    const loop = HA.exteriorLoop(model, li);
    if (!loop) return { reached: () => true, ok: false };
    const lvl = model.levels[li];
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of loop.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const cell = 6;
    const cols = Math.ceil((maxX - minX) / cell) + 1;
    const rows = Math.ceil((maxY - minY) / cell) + 1;
    const idx = (c, r) => r * cols + c;
    const cx = (c) => minX + c * cell + cell / 2;
    const cy = (r) => minY + r * cell + cell / 2;
    const inside = new Uint8Array(cols * rows), blocked = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      inside[idx(c, r)] = U.pointInPoly({ x: cx(c), y: cy(r) }, loop.pts) ? 1 : 0;
    for (const w of lvl.walls) {
      if (HA.isLow && HA.isLow(w)) continue;
      const A = { x: w.x1, y: w.y1 }; const len = HA.wallLen(w); if (len < 1) continue;
      const d = HA.wallDir(w), n = { x: -d.y, y: d.x };
      const openAt = (pos) => (w.openings || []).some((o) => Math.abs(o.pos - pos) <= o.width / 2 + 1);
      for (let s = 0; s <= len; s += cell / 2) {
        if (openAt(s)) continue;
        const base = { x: A.x + d.x * s, y: A.y + d.y * s };
        for (let off = -HA.wallT(w) / 2 - cell; off <= HA.wallT(w) / 2 + cell; off += cell) {
          const p = { x: base.x + n.x * off, y: base.y + n.y * off };
          const c = Math.round((p.x - minX - cell / 2) / cell), r = Math.round((p.y - minY - cell / 2) / cell);
          if (c >= 0 && c < cols && r >= 0 && r < rows) blocked[idx(c, r)] = 1;
        }
      }
    }
    const cellOf = (p) => ({ c: Math.round((p.x - minX - cell / 2) / cell), r: Math.round((p.y - minY - cell / 2) / cell) });
    const seen = new Uint8Array(cols * rows);
    const st = cellOf(startWorld);
    if (st.c < 0 || st.c >= cols || st.r < 0 || st.r >= rows) return { reached: () => false, ok: true };
    seen[idx(st.c, st.r)] = 1; const q = [[st.c, st.r]];
    while (q.length) {
      const [c, r] = q.pop();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const ii = idx(nc, nr);
        if (seen[ii] || !inside[ii] || blocked[ii]) continue;
        seen[ii] = 1; q.push([nc, nr]);
      }
    }
    const reached = (p) => {
      const cc = cellOf(p);
      for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) {
        const nc = cc.c + dc, nr = cc.r + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && seen[idx(nc, nr)]) return true;
      }
      return false;
    };
    return { reached, ok: true };
  };

  const ensureConnectivity = (model, li, plan, frame, intWalls, extWalls) => {
    const rooms = plan.rooms;
    if (rooms.length <= 1) return;
    const toW = frame.toWorld;
    const centW = (r) => toW((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
    // start room = entry/living
    let start = rooms.find((r) => r.name === plan.frontDoorRoom) || rooms.find((r) => r.kind === 'entry' || r.kind === 'living') || rooms[0];
    const startW = centW(start);

    // pre-index rect adjacency for punching
    const adj = rooms.map(() => []);
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++) {
        const se = sharedEdges(rooms[i], rooms[j]);
        if (se.length) { const best = se.sort((a, b) => (b.b - b.a) - (a.b - a.a))[0]; adj[i].push({ n: j, shared: best }); adj[j].push({ n: i, shared: best }); }
      }

    const punchedSet = new Set();   // dedupe: never punch the same shared edge twice
    let guard = rooms.length * 4;
    while (guard-- > 0) {
      const fl = buildFlood(model, li, startW);
      if (!fl.ok) return;
      // extOnly rooms (the ADU corner garage) are satisfied by their EXTERIOR
      // doors — never punch an interior door into them (Steve: "never really
      // with inside access").
      const reached = rooms.map((r) => r.extOnly ? true : fl.reached(centW(r)));
      if (reached.every(Boolean)) break;
      // pick a stranded room that HAS a reached neighbor (punching it actually helps)
      let did = false;
      for (let i = 0; i < rooms.length; i++) {
        if (reached[i]) continue;
        const pick = adj[i].find((e) => reached[e.n] && !rooms[e.n].extOnly);   // never route THROUGH an ext-only garage
        if (!pick) continue;
        const key = pick.shared.axis + ':' + Math.round(pick.shared.c) + ':' + Math.round((pick.shared.a + pick.shared.b) / 2);
        if (punchedSet.has(key)) continue;
        const wide = rooms[i].kind === 'living' || rooms[pick.n].kind === 'living';
        if (punchDoor(frame, intWalls, extWalls, pick.shared, wide ? 60 : 32)) { punchedSet.add(key); did = true; break; }
      }
      if (!did) break;   // no further progress possible — bail rather than spin
    }
  };

  const punchDoor = (frame, intWalls, extWalls, shared, width) => {
    const toW = frame.toWorld;
    // shared-span endpoints in world (the extent of the real partition between rooms)
    const sp0 = shared.axis === 'v' ? toW(shared.c, shared.a) : toW(shared.a, shared.c);
    const sp1 = shared.axis === 'v' ? toW(shared.c, shared.b) : toW(shared.b, shared.c);
    const wpMid = U.lerp(sp0, sp1, 0.5);
    /* R172 (the MISSING-DOORS root cause, Steve/Aaron): shared.axis is a
       FRAME (u/v) orientation, but the old test compared it against each
       wall's WORLD orientation. On a lot whose front edge rotates the frame
       90° vs world (the roofpolicy live-class rig, frontEdge 2) a frame-'v'
       partition is world-HORIZONTAL, so every correct wall was rejected and
       NO door could ever be punched — measured: 7 doorless rooms per house
       (bedrooms, baths, the primary suite) on the rig lot, 0 unrotated.
       Same family as the setGableOnEdge frame-vs-world fix. Compare in
       WORLD space: the span endpoints are already world points. */
    const spanDx = sp1.x - sp0.x, spanDy = sp1.y - sp0.y;
    const wantAxis = Math.abs(spanDx) >= Math.abs(spanDy) ? 'h' : 'v';
    for (const pool of [intWalls, extWalls]) {
      let best = null, bestD = 20;
      for (const w of pool) {
        const d = HA.wallDir(w);
        const wallAxis = Math.abs(d.x) >= Math.abs(d.y) ? 'h' : 'v';
        if (wallAxis !== wantAxis) continue;
        const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
        const t = U.clamp(U.projT(wpMid, A, B), 0, 1);
        const dd = U.dist(wpMid, U.lerp(A, B, t));
        if (dd < bestD) { bestD = dd; best = { w, A, B }; }
      }
      if (best) {
        const wLen = HA.wallLen(best.w) || 1;
        // wall-local positions of the shared span; center the door in the OVERLAP of
        // [span] and [wall], kept off both wall corners by (width/2 + 10").
        const t0 = U.clamp(U.projT(sp0, best.A, best.B), 0, 1) * wLen;
        const t1 = U.clamp(U.projT(sp1, best.A, best.B), 0, 1) * wLen;
        const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
        const m = width / 2 + 10;
        let pos = (lo + hi) / 2;
        pos = clamp(pos, Math.min(lo + m, wLen - m), Math.max(hi - m, m));
        pos = clamp(pos, m, wLen - m);
        // R21 Q2: slide off any perpendicular wall junction when the span allows
        // (connectivity still wins — if no tee-clear slot exists we keep pos).
        const tees = wallTees(intWalls.concat(extWalls), best.w);
        if (!teeClear(tees, pos - width / 2, pos + width / 2)) {
          const sLo = Math.max(Math.min(lo, hi) + width / 2 + 3, width / 2 + 4);
          const sHi = Math.min(Math.max(lo, hi) - width / 2 - 3, wLen - width / 2 - 4);
          scan: for (let s = 0; s <= sHi - sLo; s += 6) {
            for (const c of (s === 0 ? [clamp(pos, sLo, sHi)] : [clamp(pos, sLo, sHi) + s, clamp(pos, sLo, sHi) - s])) {
              if (c < sLo - 0.01 || c > sHi + 0.01) continue;
              if (teeClear(tees, c - width / 2, c + width / 2)) { pos = c; break scan; }
            }
          }
        }
        for (const o of best.w.openings) if (Math.abs(o.pos - pos) < (o.width + width) / 2) return true; // already open here
        best.w.openings.push(HA.makeDoor(pos, width, { style: 'flush', handle: 'knob', swing: 'in' }));
        return true;
      }
    }
    return false;
  };

  /* ---- DOOR-per-ROOM helpers (shared by ensureRoomDoors + applyDoorSwing) ----
     A room's WORLD rect corners from its local u/v via the frame; the door count on
     that rect boundary; and the code-min leaf width by room kind. */
  const roomWorldRect = (r, frame) => {
    const a = frame.toWorld(r.u0, r.v0), b = frame.toWorld(r.u1, r.v1);
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  };
  // a door center is ON this room's boundary if it lies within 6" of one of the four
  // edge lines AND inside that edge's span.
  const doorOnRect = (o, w, R) => {
    const d = HA.wallDir(w);
    const px = w.x1 + d.x * o.pos, py = w.y1 + d.y * o.pos;
    const onV = (Math.abs(px - R.x0) < 6 || Math.abs(px - R.x1) < 6) && py > R.y0 - 6 && py < R.y1 + 6;
    const onH = (Math.abs(py - R.y0) < 6 || Math.abs(py - R.y1) < 6) && px > R.x0 - 6 && px < R.x1 + 6;
    return onV || onH;
  };
  const roomDoorWidth = (r) => {
    // 32" clear at bedrooms/baths/offices (egress-side accessible), 30" at closets/
    // laundry/pantry (30" is fine for a service door and often a bifold/slider in the
    // real plan — we place a single hinged 30" slab as the schedule stand-in).
    if (r.kind === 'closet' || r.kind === 'laundry' || r.kind === 'pantry') return 30;
    return 32;
  };
  // kinds that MUST carry their own door slab (open zones + circulation are exempt)
  const NEEDS_DOOR = new Set(['bed', 'bath', 'laundry', 'closet', 'office', 'pantry']);

  /* Punch a door on the room's best interior wall — the longest interior partition
     span on the room boundary that faces a hall/circulation/entry (or, failing that,
     any non-open neighbor), kept off both corners and off existing openings. */
  const ensureRoomDoors = (model, li, plan, frame, intWalls, extWalls, fp) => {
    const lvl = model.levels[li];
    for (const r of plan.rooms) {
      if (r.open || !NEEDS_DOOR.has(r.kind)) continue;
      const R = roomWorldRect(r, frame);
      // already has a door on its own boundary? (a garage man-door / graph door counts)
      let has = false;
      for (const w of lvl.walls) for (const o of (w.openings || [])) {
        if (o.kind === 'door' && doorOnRect(o, w, R)) { has = true; break; }
        if (has) break;
      }
      if (has) continue;
      // find the longest interior-partition span on this room's boundary and punch there
      const width = roomDoorWidth(r);
      let placed = false;
      // prefer a shared edge with a HALL/ENTRY/STAIR/LIVING neighbor (proper approach)
      const neighbors = plan.rooms
        .filter((n) => n !== r)
        .map((n) => ({ n, se: sharedEdges(r, n) }))
        .filter((x) => x.se.length);
      const rank = (n) => (n.kind === 'hall' || n.kind === 'entry' || n.kind === 'stair') ? 0
        : (n.kind === 'living' || n.kind === 'dining' || n.kind === 'kitchen') ? 1
        : (n.kind === 'bath' || n.kind === 'closet') ? 3 : 2;
      neighbors.sort((a, b) => rank(a.n) - rank(b.n)
        || ((b.se[0].b - b.se[0].a) - (a.se[0].b - a.se[0].a)));
      for (const { se } of neighbors) {
        const shared = se.sort((x, y) => (y.b - y.a) - (x.b - x.a))[0];
        if (shared.b - shared.a < width + 20) continue;   // partition too short for the leaf
        if (punchDoor(frame, intWalls, extWalls, shared, width)) { placed = true; break; }
      }
      if (!placed) console.log('generator: could not seat a door for', r.name, '(' + r.kind + ')');
    }
  };

  /* ---- L1 STAIRWELL GUARD (Chief-style open-below, Steve Jul 6) ----
     The upper level carries NO flight; its floor is holed over the L0 run (the
     hole = the L0 stairs fixture footprint, punched by view3d._buildFloors from
     the level below). Any hole edge that is neither
       (a) the ARRIVAL edge (top of the run, the +v end — you walk on/off there), nor
       (b) hugged by a parallel wall within 12" (the sliver is unwalkable and the
           wall itself is the barrier)
     gets a 36" pony guard wall (type 'porch', low:true — IRC R312 minimum guard;
     isLow walls are ignored by flood-fill connectivity and the ceiling contracts).
     Endpoints snap to the 6" grid to honor the generator's grid contract. */
  const guardStairwell = (model, li, s, frame) => {
    const lvl = model.levels[li];
    const S = model.settings;
    const toW = frame.toWorld;
    const scu = (s.u0 + s.u1) / 2, scv = (s.v0 + s.v1) / 2;
    // MUST mirror the L0 fixture sizing (placeFixtures): the hole is that footprint
    const hw = Math.max(36, s.u1 - s.u0) / 2, hd = Math.max(120, s.v1 - s.v0) / 2;
    const snap6 = (x) => Math.round(x / 6) * 6;
    const edges = [
      { axis: 'h', c: scv - hd, a: scu - hw, b: scu + hw },   // bottom-of-run end (foot of the well)
      { axis: 'v', c: scu - hw, a: scv - hd, b: scv + hd },   // west side of the well
      { axis: 'v', c: scu + hw, a: scv - hd, b: scv + hd },   // east side of the well
      // (the +v edge is the ARRIVAL — never railed)
    ];
    for (const e of edges) {
      const p0 = e.axis === 'v' ? toW(e.c, e.a) : toW(e.a, e.c);
      const p1 = e.axis === 'v' ? toW(e.c, e.b) : toW(e.b, e.c);
      const span = U.dist(p0, p1) || 1;
      // coverage by an existing parallel wall within 12" of the edge line
      let cov = 0;
      for (const w of lvl.walls) {
        const d = HA.wallDir(w);
        const horizEdge = Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y);
        const horizWall = Math.abs(d.x) >= Math.abs(d.y);
        if (horizEdge !== horizWall) continue;                 // must run parallel
        const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
        const tA = U.projT(A, p0, p1), tB = U.projT(B, p0, p1);
        const off = U.dist(A, U.lerp(p0, p1, tA));             // perpendicular offset (parallel walls)
        if (off > 12.5) continue;
        const lo = Math.max(0, Math.min(tA, tB)), hi = Math.min(1, Math.max(tA, tB));
        cov += Math.max(0, hi - lo) * span;
      }
      if (cov >= span * 0.6) continue;                         // a real wall protects this edge
      const g0 = { x: snap6(p0.x), y: snap6(p0.y) }, g1 = { x: snap6(p1.x), y: snap6(p1.y) };
      if (U.dist(g0, g1) < 12) continue;                       // degenerate after snapping
      lvl.walls.push(HA.makeWall(g0.x, g0.y, g1.x, g1.y, 'porch', S));   // defH 36 guard
    }
  };

  /* ---- SWING TRUTH ----
     For every INTERIOR hinged door, set hinge + wall-relative swing so the OPEN leaf
     parks flat against the nearest perpendicular wall in the room the door serves,
     and never sweeps into the hall. Rule (matches plan2d's arc math):
       - swing='in' means HA.interiorSign(model, wall); 'out' means the other side.
       - the leaf, open 90°, lies along the door wall `width` deep FROM THE HINGE.
       - so we hinge at the door END nearest a perpendicular return wall inside the
         room -> the leaf parks alongside that wall. A second Jack-and-Jill bath
         door opens into its adjoining room so two leaves cannot consume the bath. */
  const applyDoorSwing = (model, li, plan, frame, fp) => {
    const lvl = model.levels[li];
    const inwardBathDoors = new Map();
    // pick, for each door, the SERVED room = the room on the door's interior side.
    // Prefer the smaller / more-private room (bath/closet/laundry/bed) so the leaf
    // parks inside it, not out in the great room.
    const priv = (k) => ({ closet: 0, pantry: 0, bath: 1, laundry: 1, bed: 2, office: 3 }[k] ?? 5);
    const roomsW = plan.rooms.map((r) => ({ r, R: roomWorldRect(r, frame) }));
    for (const w of lvl.walls) {
      if (HA.isExt(w)) continue;
      const d = HA.wallDir(w), n = { x: -d.y, y: d.x }, wLen = HA.wallLen(w);
      for (const o of w.openings || []) {
        if (o.kind !== 'door' || o.doorType === 'slider' || o.doorType === 'garage') continue;
        const cx = w.x1 + d.x * o.pos, cy = w.y1 + d.y * o.pos;
        // rooms this door touches (center on their boundary), most private first
        const allTouch = roomsW.filter(({ R }) => cx > R.x0 - 6 && cx < R.x1 + 6 && cy > R.y0 - 6 && cy < R.y1 + 6);
        const touch = allTouch
          .filter(({ r }) => !r.open)
          .sort((a, b) => priv(a.r.kind) - priv(b.r.kind));
        const served = touch[0];
        if (!served) continue;   // between two open zones — leave the placer default
        const R = served.R, cu = (R.x0 + R.x1) / 2, cv = (R.y0 + R.y1) / 2;
        // interior side = toward the served room center
        const inSign = ((cu - cx) * n.x + (cv - cy) * n.y) >= 0 ? 1 : -1;
        // A compact Jack-and-Jill bath cannot safely accept two full in-swing
        // leaves. Keep the first leaf in the bath and swing subsequent bath doors
        // toward an adjoining private room (bed/office) when one exists. Never
        // trade the bath conflict for a leaf sweeping into a hall or entry.
        const bathKey = served.r.kind === 'bath' ? `${served.r.u0},${served.r.v0},${served.r.u1},${served.r.v1}` : null;
        const priorBathLeaves = bathKey ? (inwardBathDoors.get(bathKey) || 0) : 0;
        const safeAwayRoom = bathKey && allTouch.some(({ r }) => r !== served.r && !r.open && /^(bed|office)$/.test(r.kind));
        const opensIntoServed = !bathKey || priorBathLeaves === 0 || !safeAwayRoom;
        if (bathKey && opensIntoServed) inwardBathDoors.set(bathKey, priorBathLeaves + 1);
        // the two door ends along the wall (start = pos-w/2, end = pos+w/2)
        const half = o.width / 2;
        const startPt = { x: cx - d.x * half, y: cy - d.y * half };   // 'left' hinge (x0 end)
        const endPt = { x: cx + d.x * half, y: cy + d.y * half };     // 'right' hinge (x1 end)
        // distance from each end to the NEAREST perpendicular wall inside the served
        // room, measured ALONG the wall axis (the return wall the leaf should park on)
        const perpNear = (endPt2) => {
          let best = 1e9;
          for (const w2 of lvl.walls) {
            if (w2 === w) continue;
            const d2 = HA.wallDir(w2);
            // must be roughly PERPENDICULAR to this wall
            if (Math.abs(d2.x * d.x + d2.y * d.y) > 0.2) continue;
            const A = { x: w2.x1, y: w2.y1 }, B = { x: w2.x2, y: w2.y2 };
            const t = U.clamp(U.projT(endPt2, A, B), 0, 1);
            const foot = U.lerp(A, B, t);
            // the return wall must lie on the INTERIOR side (where the leaf sweeps)
            const toWall = { x: foot.x - cx, y: foot.y - cy };
            if ((toWall.x * n.x + toWall.y * n.y) * inSign < -2) continue;
            // and within the served room band (not some far wall)
            if (foot.x < R.x0 - 12 || foot.x > R.x1 + 12 || foot.y < R.y0 - 12 || foot.y > R.y1 + 12) continue;
            const along = Math.abs((foot.x - endPt2.x) * d.x + (foot.y - endPt2.y) * d.y);
            best = Math.min(best, along);
          }
          return best;
        };
        const dStart = perpNear(startPt), dEnd = perpNear(endPt);
        // hinge at the end whose nearest return wall is CLOSER -> leaf parks on it.
        // 'left' hinge => hinge at start (x0); 'right' => hinge at end (x1).
        let hinge = dStart <= dEnd ? 'left' : 'right';
        // guard: keep the leaf off the room corner it hinges into — if the hinge end
        // is < (leaf depth) from the parallel end wall, the door can't fully open;
        // fall back to the roomier end.
        o.hinge = hinge;
        const authoredInterior = HA.interiorSign(model, w);
        const desiredSide = opensIntoServed ? inSign : -inSign;
        o.swing = desiredSide === authoredInterior ? 'in' : 'out';
      }
    }
  };

  // merge collinear same-line segments that overlap or touch
  const mergeSegs = (segs) => {
    const byKey = new Map();
    for (const s of segs) {
      const k = s.axis + ':' + Math.round(s.c);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(s);
    }
    const out = [];
    for (const [k, list] of byKey) {
      list.sort((a, b) => a.a - b.a);
      let cur = { axis: list[0].axis, c: list[0].c, a: list[0].a, b: list[0].b };
      for (let i = 1; i < list.length; i++) {
        const s = list[i];
        if (s.a <= cur.b + 2) cur.b = Math.max(cur.b, s.b);
        else { out.push(cur); cur = { axis: s.axis, c: s.c, a: s.a, b: s.b }; }
      }
      out.push(cur);
    }
    return out;
  };

  /* ---------- OPENINGS ----------
     - front door on the ENTRY exterior wall
     - interior doors: for each graph edge, find the shared wall segment between the
       two rooms and drop a door in it
     - windows per room type on exterior walls only
  */
  const placeOpenings = (model, li, plan, fp, frame, style, opts, rng, extWalls, intWalls) => {
    const roomByName = {};
    for (const r of plan.rooms) roomByName[r.name] = r;

    // ---- interior doors on graph edges (SOLID interior doors only) ----
    for (const e of plan.edges) {
      const ra = roomByName[e.a], rb = roomByName[e.b];
      if (!ra || !rb) continue;
      // open-zone pairs have NO WALL between them — nothing to place (v2 put a
      // wide glass accordion here, the owner's "glass doors inside" bug)
      if (ra.open && rb.open) continue;
      placeInteriorDoor(intWalls, extWalls, ra, rb, frame, e.kind === 'open' ? 48 : 32);
    }

    // ---- front door ----
    const entry = roomByName[plan.frontDoorRoom] || plan.rooms.find((r) => r.kind === 'entry' || r.kind === 'living');
    if (entry) {
      // find the exterior wall on the ENTRY room's FRONT edge crossing its u-range.
      // (With a garage, the composed footprint front FR.v0 is the GARAGE front line;
      // the HOUSE front is at entry.v0 — match the entry's own front edge so the door
      // lands on the house facade, not the garage wall.)
      const FR = fp.rect;
      const frontWall = extWalls.find((w) => w._loc &&
        Math.abs(w._loc.a.v - entry.v0) < 1 && Math.abs(w._loc.b.v - entry.v0) < 1 &&
        Math.min(w._loc.a.u, w._loc.b.u) <= entry.u1 && Math.max(w._loc.a.u, w._loc.b.u) >= entry.u0)
        || extWalls.find((w) => w._loc &&
          Math.abs(w._loc.a.v - FR.v0) < 1 && Math.abs(w._loc.b.v - FR.v0) < 1);
      if (frontWall) {
        const wLen = HA.wallLen(frontWall);
        // door centered on entry room in local u, projected to a pos along the wall.
        // Keep it ≥36" off both wall ends so the entrance/porch never cantilevers past
        // a facade corner (critical when a garage shortens the house front wall).
        const uc = (entry.u0 + entry.u1) / 2;
        const m = Math.min(36, Math.max(24, (wLen - 36) / 2));
        const pos = clamp(localUtoWallPos(frontWall, uc, frame), m, wLen - m);
        const door = HA.makeDoor(pos, style.mono || style.bigGlass ? 42 : 36,
          { style: doorStyleForStyle(style), swing: 'in', hinge: rng() < 0.5 ? 'left' : 'right' });
        frontWall.openings.push(door);
        model.levels[li]._frontDoorWallId = frontWall.id;
      }
    }

    // ---- GARAGE OVERHEAD DOOR on the garage's exterior wall (L0): the STREET
    // (front, v0) wall for the house garage; the REAR (v1, alley-facing) wall
    // for the ADU corner garage (garage._vdoor === 'back') ----
    if (li === 0) {
      const garage = plan.rooms.find((r) => r.kind === 'garage');
      if (garage) {
        const gv = garage._vdoor === 'back' ? garage.v1 : garage.v0;
        const gWall = extWalls.find((w) => w._loc &&
          Math.abs(w._loc.a.v - gv) < 1 && Math.abs(w._loc.b.v - gv) < 1 &&
          Math.min(w._loc.a.u, w._loc.b.u) <= garage.u0 + 6 && Math.max(w._loc.a.u, w._loc.b.u) >= garage.u1 - 6);
        if (gWall) {
          const wLen = HA.wallLen(gWall);
          const uc = (garage.u0 + garage.u1) / 2;
          const gw = garage._doorW || ftIn(16);
          // header per span (real): 16' door → 4x12, 9' → 4x10
          const pos = clamp(localUtoWallPos(gWall, uc, frame), gw / 2 + 12, wLen - gw / 2 - 12);
          gWall.openings.push(HA.makeDoor(pos, gw, {
            doorType: 'garage', style: 'garage', height: 84, handle: 'none', trim: 'none',
            header: HA.headerForSpan ? HA.headerForSpan(gw) : 'auto',
          }));
          model.levels[li]._garageDoorWallId = gWall.id;
        }
        // EXTERIOR PERSON DOOR for the exterior-access-only (ADU) garage: on the
        // OUTER side wall (u1 when the garage sits back-right, u0 back-left),
        // facing OUT — no interior garage↔living door exists (Steve). It sits in
        // a dropped garage wall and serves the SLAB side, so sillAtSlab makes
        // HA.wallOpeningCut land it on the garage slab, not up at house FF.
        if (garage.extOnly) {
          const gu = garage._manSide === 'left' ? garage.u0 : garage.u1;
          const mWall = extWalls.find((w) => w._loc &&
            Math.abs(w._loc.a.u - gu) < 1 && Math.abs(w._loc.b.u - gu) < 1 &&
            Math.min(w._loc.a.v, w._loc.b.v) <= garage.v0 + 6 && Math.max(w._loc.a.v, w._loc.b.v) >= garage.v1 - 6);
          if (mWall) {
            const wLen = HA.wallLen(mWall);
            const vc = (garage.v0 + garage.v1) / 2;
            const pos = clamp(localUtoWallPos(mWall, vc, frame), 30, wLen - 30);
            const man = HA.makeDoor(pos, 36, { style: 'flush', swing: 'out', handle: 'knob' });
            man.sillAtSlab = true;
            mWall.openings.push(man);
          }
        }
      }
    }

    // ---- rear SLIDER from the open core to the back yard (L0 only; placed
    // BEFORE the windows so it wins the center of the back wall) ----
    if (li === 0) {
      const zone = plan.rooms.find((r) => (r.kind === 'dining' || r.kind === 'living') && r.open &&
        onLoop(fp.edges, 'h', r.v1, r.u0, r.u1) && (r.u1 - r.u0) >= ftIn(8));
      if (zone) {
        const back = extWalls.find((w) => w._loc &&
          Math.abs(w._loc.a.v - zone.v1) < 1 && Math.abs(w._loc.b.v - zone.v1) < 1);
        if (back) {
          const wLen = HA.wallLen(back);
          const pos = clamp(localUtoWallPos(back, (zone.u0 + zone.u1) / 2, frame), 42, wLen - 42);
          let clash = false;
          for (const o of back.openings) if (Math.abs(o.pos - pos) < (o.width + 72) / 2 + 6) clash = true;
          if (!clash) back.openings.push(HA.makeDoor(pos, 72, {
            doorType: 'slider', panels: 2, style: 'full_glass', handle: 'none', height: 80,
          }));
        }
      }
    }

    // ---- windows per room (after the slider so they yield the back-wall center) ----
    for (const r of plan.rooms) {
      addRoomWindows(model, li, r, fp, frame, style, extWalls, rng);
    }

    // ---- EGRESS GUARANTEE (IRC R310): every bedroom must end with at least
    // one operable window (sill <=44") on its OWN exterior wall. addRoomWindows
    // silently SKIPS on a clash with an existing opening, so a bed could go
    // windowless (non-compliant + reads as a dungeon). Sweep + force-place at
    // fallback fractions, shrinking once before giving up loudly. ----
    for (const r of plan.rooms) {
      if (r.kind !== 'bed') continue;
      if (bedHasEgress(r, fp, frame, extWalls)) continue;
      forceEgressWindow(r, fp, frame, extWalls);
    }
  };

  // room's exterior edges (local) — shared by the egress sweep below
  const extEdgesOf = (r, fp) => {
    const exts = [];
    if (onLoop(fp.edges, 'v', r.u0, r.v0, r.v1)) exts.push({ axis: 'v', c: r.u0, a: r.v0, b: r.v1 });
    if (onLoop(fp.edges, 'v', r.u1, r.v0, r.v1)) exts.push({ axis: 'v', c: r.u1, a: r.v0, b: r.v1 });
    if (onLoop(fp.edges, 'h', r.v0, r.u0, r.u1)) exts.push({ axis: 'h', c: r.v0, a: r.u0, b: r.u1 });
    if (onLoop(fp.edges, 'h', r.v1, r.u0, r.u1)) exts.push({ axis: 'h', c: r.v1, a: r.u0, b: r.u1 });
    return exts;
  };
  const wallForEdge = (ed, frame, extWalls) => {
    const toW = frame.toWorld;
    const mid = ed.axis === 'v' ? toW(ed.c, (ed.a + ed.b) / 2) : toW((ed.a + ed.b) / 2, ed.c);
    /* R67 — the wall must RUN ALONG the edge. Without this the search matched by
       proximity alone, and at an inside corner (an attached garage's back wall
       meeting the house side wall) the PERPENDICULAR wall is also distance ~0 from
       the edge midpoint. Picking it made the caller compute a nonsense span and
       give up, which is how a primary bedroom ended up with no egress window at
       all (seed 4955, modern). Axis 'v' edges run along frame.ey, 'h' along ex. */
    const want = ed.axis === 'v' ? frame.ey : frame.ex;
    let best = null, bestD = 18;
    for (const w of extWalls) {
      const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
      const wd = HA.wallDir(w);
      if (Math.abs(wd.x * want.x + wd.y * want.y) < 0.9) continue;   // not parallel to the edge
      const t = U.clamp(U.projT(mid, A, B), 0, 1);
      const d = U.dist(mid, U.lerp(A, B, t));
      if (d < bestD) { bestD = d; best = w; }
    }
    return best;
  };
  const bedHasEgress = (r, fp, frame, extWalls) => {
    for (const ed of extEdgesOf(r, fp)) {
      const w = wallForEdge(ed, frame, extWalls);
      if (!w) continue;
      const pA = localAlongToWallPos(w, ed, ed.a, frame), pB = localAlongToWallPos(w, ed, ed.b, frame);
      const lo = Math.min(pA, pB) - 2, hi = Math.max(pA, pB) + 2;
      for (const o of w.openings || []) {
        if (o.kind === 'window' && (o.sill == null || o.sill <= 44) && o.pos >= lo && o.pos <= hi) return true;
      }
    }
    return false;
  };
  const forceEgressWindow = (r, fp, frame, extWalls) => {
    const exts = extEdgesOf(r, fp).sort((x, y) => (y.b - y.a) - (x.b - x.a));
    /* R67 — sweep the WALL's usable span, not the ROOM's. The old loop
       interpolated over the room edge and then clamped into the wall, so when a
       room's exterior edge is only PARTLY on the loop — the classic case is an
       attached garage covering the front half of that wall — every candidate
       clamped to the same end position, collided with the neighbouring room's
       window and the room ended up with no egress at all (measured: seed 4955,
       modern, 3 bed — "EGRESS — could not seat a bedroom window for PRIMARY
       BEDROOM", and dev-generator-test's per-bed-zone egress contract caught it).
       Clipping to [wall∩room] and stepping inside that makes the reachable
       positions real. */
    for (const [ww, wh] of [[48, 60], [42, 57]]) {
      for (const ed of exts) {
        const wall = wallForEdge(ed, frame, extWalls);
        if (!wall) continue;
        const wLen = HA.wallLen(wall);
        const pA = localAlongToWallPos(wall, ed, ed.a, frame);
        const pB = localAlongToWallPos(wall, ed, ed.b, frame);
        const lo = Math.max(ww / 2 + 4, Math.min(pA, pB));
        const hi = Math.min(wLen - ww / 2 - 4, Math.max(pA, pB));
        if (hi < lo) continue;                       // no usable run on this wall
        for (const f of [0.5, 0.35, 0.65, 0.25, 0.75]) {
          const pos = clamp(lo + (hi - lo) * f, ww / 2 + 4, Math.max(ww / 2 + 4, wLen - ww / 2 - 4));
          let clash = false;
          for (const o of wall.openings) if (Math.abs(o.pos - pos) < (o.width + ww) / 2 + 4) clash = true;
          if (clash) continue;
          wall.openings.push(HA.makeWindow(pos, ww, wh, 96 - wh));   // head at the 96" line, sill <=44 ✓
          return true;
        }
      }
    }
    try { console.warn('generator: EGRESS — could not seat a bedroom window for ' + r.name); } catch (e) {}
    return false;
  };

  const doorStyleForStyle = (style) => {
    const k = style.label.toLowerCase();
    if (k.indexOf('craftsman') >= 0) return 'craftsman';
    if (k.indexOf('modern') >= 0) return 'plank';
    if (k.indexOf('farmhouse') >= 0) return 'glass';
    return 'panel';
  };

  // map a local u (on a front/back horizontal wall) to a pos along that wall
  const localUtoWallPos = (wall, u, frame) => {
    // wall endpoints in local: wall._loc.a/b (for ext) — pos measured from wallA
    if (wall._loc) {
      const a = wall._loc.a, b = wall._loc.b;
      const along = Math.abs(b.u - a.u) > Math.abs(b.v - a.v) ? 'u' : 'v';
      const A = a[along], B = b[along];
      const t = (u - A) / (B - A || 1);
      return t * HA.wallLen(wall);
    }
    return HA.wallLen(wall) / 2;
  };

  /* ---- WALL-TEE TRUTH (R21 Q2/Q3) ----
     wall-local t of every PERPENDICULAR wall junction landing on this wall's
     line (partition tees + articulation returns; wall-end corners excluded).
     An opening straddling one is unbuildable — the crossing wall frames
     straight through the jamb/glass — and a door leaf there sweeps into the
     partition (the audit's "32-inch laundry door centered on a 24-inch
     laundry-hall overlap" defect). Low/porch walls don't frame into the wall
     at head height, so they never make a tee. */
  const wallTees = (walls, wall) => {
    const d = HA.wallDir(wall), A = { x: wall.x1, y: wall.y1 };
    const len = HA.wallLen(wall), out = [];
    for (const w2 of walls) {
      if (w2 === wall || (HA.isLow && HA.isLow(w2)) || w2.type === 'porch') continue;
      const d2 = HA.wallDir(w2);
      if (Math.abs(d2.x * d.x + d2.y * d.y) > 0.2) continue;
      for (const p of [{ x: w2.x1, y: w2.y1 }, { x: w2.x2, y: w2.y2 }]) {
        const off = Math.abs(-(p.x - A.x) * d.y + (p.y - A.y) * d.x);
        if (off > 4) continue;
        const t = (p.x - A.x) * d.x + (p.y - A.y) * d.y;
        if (t > 2 && t < len - 2) out.push(t);
      }
    }
    return out;
  };
  const teeClear = (tees, lo, hi) => tees.every((t) => t <= lo + 1.5 || t >= hi - 1.5);

  // place an interior door on the wall between two room rects. Works for both
  // ABUTTING rects (share a full edge) and NESTED rects (one rect's edge lies on
  // the other's interior — e.g. a bath carved into a great room's corner). We
  // enumerate every candidate shared edge (both abut + nested), pick the longest
  // overlap, and drop the door on the real wall along that edge.
  const placeInteriorDoor = (intWalls, extWalls, ra, rb, frame, width, wide) => {
    const cands = sharedEdges(ra, rb);
    if (!cands.length) return false;
    const toW = frame.toWorld;
    // an interior door NEVER belongs on an exterior wall — prefer the interior
    // partition. Only if no interior wall carries the edge do we fall back to ext.
    // try candidates longest-overlap first until one seats on a real wall
    cands.sort((x, y) => (y.b - y.a) - (x.b - x.a));
    for (const pool of [intWalls, extWalls]) {
    for (const shared of cands) {
      const oc = (shared.a + shared.b) / 2;
      const wp = shared.axis === 'v' ? toW(shared.c, oc) : toW(oc, shared.c);
      // R172 — WORLD-space axis from the span's world endpoints (shared.axis
      // is frame u/v; the frame-vs-world compare broke rotated frames)
      const _e0 = shared.axis === 'v' ? toW(shared.c, shared.a) : toW(shared.a, shared.c);
      const _e1 = shared.axis === 'v' ? toW(shared.c, shared.b) : toW(shared.b, shared.c);
      const wantAxis = Math.abs(_e1.x - _e0.x) >= Math.abs(_e1.y - _e0.y) ? 'h' : 'v';
      let best = null, bestD = 20;
      for (const w of pool) {
        // wall must run ALONG the shared edge's free axis (collinear), so a door in it
        // actually pierces the partition rather than sitting on a perpendicular wall.
        const d = HA.wallDir(w);
        const wallAxis = Math.abs(d.x) >= Math.abs(d.y) ? 'h' : 'v';  // h=horiz(const y), v=vert(const x)
        if (wallAxis !== wantAxis) continue;
        const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
        const t = U.clamp(U.projT(wp, A, B), 0, 1);
        const dd = U.dist(wp, U.lerp(A, B, t));
        if (dd < bestD) { bestD = dd; best = { w, t }; }
      }
      if (!best) continue;
      const wLen = HA.wallLen(best.w);
      // R21 Q2: the door must SEAT inside the SHARED SPAN (it used to clamp only
      // to the wall ends, so a 24" room overlap happily took a 32" door whose
      // jamb landed inside the neighbouring partition tee) AND keep its span
      // clear of every perpendicular wall junction on the wall.
      const sp0w = shared.axis === 'v' ? toW(shared.c, shared.a) : toW(shared.a, shared.c);
      const sp1w = shared.axis === 'v' ? toW(shared.c, shared.b) : toW(shared.b, shared.c);
      const wA = { x: best.w.x1, y: best.w.y1 }, wB = { x: best.w.x2, y: best.w.y2 };
      const t0 = U.clamp(U.projT(sp0w, wA, wB), 0, 1) * wLen;
      const t1 = U.clamp(U.projT(sp1w, wA, wB), 0, 1) * wLen;
      const pLo = Math.max(Math.min(t0, t1) + width / 2 + 3, width / 2 + 4);
      const pHi = Math.min(Math.max(t0, t1) - width / 2 - 3, wLen - width / 2 - 4);
      if (pHi < pLo) continue;                       // overlap too short for the leaf — next edge
      const tees = wallTees(intWalls.concat(extWalls), best.w);
      const mid = clamp(best.t * wLen, pLo, pHi);
      let pos = null;
      for (let s = 0; s <= pHi - pLo && pos == null; s += GRID) {
        for (const c of (s === 0 ? [mid] : [mid + s, mid - s])) {
          if (c < pLo - 0.01 || c > pHi + 0.01) continue;
          if (!teeClear(tees, c - width / 2, c + width / 2)) continue;
          if (best.w.openings.some((o) => Math.abs(o.pos - c) < (o.width + width) / 2)) continue;
          pos = c; break;
        }
      }
      if (pos == null) continue;                     // no clean seat on this edge — next candidate
      // SOLID interior slab — never glass/slider/accordion inside the house
      best.w.openings.push(HA.makeDoor(pos, width, { style: 'flush', handle: 'knob', swing: 'in', hinge: 'left' }));
      return true;
    }
    }
    return false;
  };

  // ALL shared/coincident edges between two axis-aligned rects (abut OR nest).
  // Returns [{axis:'v'|'h', c, a, b}] where axis 'v' = a vertical wall at u=c
  // spanning v in [a,b]; 'h' = horizontal wall at v=c spanning u in [a,b].
  // For NESTED rects (child inside parent) the child's inner edge lies WITHIN the
  // parent's u/v range — so we consider the edges of BOTH rects and keep any that
  // (a) run through the shared overlap band and (b) sit strictly between the two
  // rects (i.e. a real partition), which naturally covers abut + nest.
  const sharedEdges = (ra, rb) => {
    const out = [];
    const vOv = Math.min(ra.v1, rb.v1) - Math.max(ra.v0, rb.v0);
    const uOv = Math.min(ra.u1, rb.u1) - Math.max(ra.u0, rb.u0);
    const within = (x, lo, hi) => x >= lo - 2 && x <= hi + 2;
    // vertical lines (const u): overlap in v; the line must lie on both rects' u-span
    if (vOv > 12) {
      const va = Math.max(ra.v0, rb.v0), vb = Math.min(ra.v1, rb.v1);
      const seen = new Set();
      for (const u of [ra.u0, ra.u1, rb.u0, rb.u1]) {
        const k = Math.round(u); if (seen.has(k)) continue;
        if (within(u, ra.u0, ra.u1) && within(u, rb.u0, rb.u1)) { out.push({ axis: 'v', c: u, a: va, b: vb }); seen.add(k); }
      }
    }
    // horizontal lines (const v): overlap in u; the line must lie on both rects' v-span
    if (uOv > 12) {
      const ua = Math.max(ra.u0, rb.u0), ub = Math.min(ra.u1, rb.u1);
      const seen = new Set();
      for (const v of [ra.v0, ra.v1, rb.v0, rb.v1]) {
        const k = Math.round(v); if (seen.has(k)) continue;
        if (within(v, ra.v0, ra.v1) && within(v, rb.v0, rb.v1)) { out.push({ axis: 'h', c: v, a: ua, b: ub }); seen.add(k); }
      }
    }
    return out;
  };

  /* ---------- WINDOWS by room type ----------
     Only on exterior walls (segments of the room's rect that lie on the boundary).
     - bedrooms: egress 36x48 or 48x48, sill <=44 (CRC R310)
     - kitchen: sink window 36-48, sill ~42
     - bath: privacy 24x24 / 36x24, sill 54-60
     - living/great: large 2-3 x 36x72; modern => window-wall run
  */
  const addRoomWindows = (model, li, r, fp, frame, style, extWalls, rng) => {
    // exterior edges of this room = its rect edges that lie on the loop boundary
    // exterior edges of this room (in local): each returns {axis, c, a, b, outSign}
    const exts = [];
    if (onLoop(fp.edges, 'v', r.u0, r.v0, r.v1)) exts.push({ axis: 'v', c: r.u0, a: r.v0, b: r.v1 });
    if (onLoop(fp.edges, 'v', r.u1, r.v0, r.v1)) exts.push({ axis: 'v', c: r.u1, a: r.v0, b: r.v1 });
    if (onLoop(fp.edges, 'h', r.v0, r.u0, r.u1)) exts.push({ axis: 'h', c: r.v0, a: r.u0, b: r.u1 });
    if (onLoop(fp.edges, 'h', r.v1, r.u0, r.u1)) exts.push({ axis: 'h', c: r.v1, a: r.u0, b: r.u1 });
    if (!exts.length) return;

    const toW = frame.toWorld;
    const findWall = (ed) => {
      // world midpoint of the edge
      const mid = ed.axis === 'v' ? toW(ed.c, (ed.a + ed.b) / 2) : toW((ed.a + ed.b) / 2, ed.c);
      let best = null, bestD = 18;
      for (const w of extWalls) {
        const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
        const t = U.clamp(U.projT(mid, A, B), 0, 1);
        const d = U.dist(mid, U.lerp(A, B, t));
        if (d < bestD) { bestD = d; best = w; }
      }
      return best;
    };
    const edgeLen = (ed) => ed.b - ed.a;
    // place n windows evenly along an edge segment [a,b] of the given wall
    const placeN = (ed, wall, n, wWidth, wHeight, sill) => {
      if (!wall) return 0;
      const wLen = HA.wallLen(wall);
      // R21 Q3: a window must never straddle a perpendicular wall junction
      // (an interior partition teeing into the facade would frame through
      // the glass); treat a straddle as a clash so the nudges dodge it.
      const tees = wallTees(model.levels[li].walls, wall);
      let placed = 0;
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / (n + 1);
        // NUDGE on clash: a slider/door mid-wall used to silently eat the
        // window slot (modern window-walls came up short); slide a touch to
        // either side before giving up on this slot.
        for (const df of [0, 0.09, -0.09, 0.18, -0.18]) {
          const localCoord = ed.a + (ed.b - ed.a) * clamp(f + df, 0.08, 0.92);
          const pos = clamp(localAlongToWallPos(wall, ed, localCoord, frame), wWidth / 2 + 4, wLen - wWidth / 2 - 4);
          let clash = false;
          for (const o of wall.openings) if (Math.abs(o.pos - pos) < (o.width + wWidth) / 2 + 4) clash = true;
          if (!clash && !teeClear(tees, pos - wWidth / 2, pos + wWidth / 2)) clash = true;
          if (clash) continue;
          wall.openings.push(HA.makeWindow(pos, wWidth, wHeight, sill));
          placed++;
          break;
        }
      }
      return placed;
    };

    // pick the LONGEST exterior edge for the primary glazing
    exts.sort((x, y) => edgeLen(y) - edgeLen(x));
    const primary = exts[0];

    /* WINDOW SPEC v3 — all heads ALIGN at 96" (door-head line for the 9'+ walls):
       the owner saw "windows at the top" because v2 heads floated (some past the
       old 8' plate). sill = 96 - height everywhere below; the two exceptions are
       bath privacy (sill 60, head 90) and the mono clerestory band (sill 96,
       head 114 under the 10' plate on the shed's high side). */
    if (r.kind === 'bed') {
      // egress: 48x60, sill 36 (<=44 per CRC R310), head 96
      const w = findWall(primary);
      let n = edgeLen(primary) > 16 * 12 ? 2 : 1;
      placeN(primary, w, n, 48, 60, 36);
      if (exts[1] && edgeLen(exts[1]) > 12 * 12) placeN(exts[1], findWall(exts[1]), 1, 48, 60, 36);
    } else if (r.kind === 'living') {
      // PRIMARY glazing prefers the FRONT (street, v0) exterior wall so the living/
      // great room reads with a picture window to the street (Steve: "picture window
      // off living room to front"). A rear great room (split-bed ranch) has no front
      // exterior edge, so it falls back to the longest edge — glazing the backyard.
      const frontEdge = exts.find((e) => e.axis === 'h' && Math.abs(e.c - r.v0) < 2 && edgeLen(e) >= 9 * 12);
      const glaze = frontEdge || primary;
      const w = findWall(glaze);
      if (style.bigGlass) {
        // window-wall: tall glazing, head 96
        const cnt = clamp(Math.floor(edgeLen(glaze) / (30 * 12) * 4) + 2, 3, 6);
        placeN(glaze, w, cnt, 36, 84, 12);
        // clerestory band on modern-mono (the shed's HIGH side). LIMITATION: uniform
        // plate heights — the band sits at sill 96 / head 114 under the 10' plate on
        // exts[1] (the secondary exterior wall, typically the tall side of the plan).
        if (style.mono && exts[1]) placeN(exts[1], findWall(exts[1]), 2, 36, 18, 96);
      } else if (frontEdge && edgeLen(glaze) >= 12 * 12) {
        // a real PICTURE WINDOW: one big fixed light centered on the front wall,
        // flanked by a shorter operable window each side for egress/vent + symmetry.
        const pw = clamp(Math.round(edgeLen(glaze) * 0.36), 60, 84);
        placeN(glaze, w, 1, pw, 78, 18);                                     // center picture light
        const flankTees = wallTees(model.levels[li].walls, w);
        for (const df of [-0.28, 0.28]) {
          const lc = glaze.a + (glaze.b - glaze.a) * clamp(0.5 + df, 0.1, 0.9);
          const pos = clamp(localAlongToWallPos(w, glaze, lc, frame), 36 / 2 + 4, HA.wallLen(w) - 36 / 2 - 4);
          if (!teeClear(flankTees, pos - 18, pos + 18)) continue;   // R21 Q3: never across a partition tee
          if (!w.openings.some((o) => Math.abs(o.pos - pos) < (o.width + 36) / 2 + 4)) w.openings.push(HA.makeWindow(pos, 36, 66, 30));   // sill 30 + h 66 = head 96 (aligns with the picture light)
        }
      } else {
        placeN(glaze, w, edgeLen(glaze) > 16 * 12 ? 3 : 2, 36, 78, 18);
      }
      // a secondary exterior wall (NOT the one we just glazed) gets a pair too
      const secondary = exts.find((e) => e !== glaze && edgeLen(e) > 14 * 12);
      if (secondary) placeN(secondary, findWall(secondary), 2, 36, 60, 36);
    } else if (r.kind === 'kitchen') {
      // sink window over the sink run — same wall the run lands on (r._sinkEdge)
      const backEdge = exts.find((e) => e.axis === 'h' && Math.abs(e.c - r.v1) < 2);
      const sinkEdge = backEdge || primary;
      r._sinkEdge = { axis: sinkEdge.axis, c: sinkEdge.c, mid: (sinkEdge.a + sinkEdge.b) / 2 };
      const w = findWall(sinkEdge);
      // sill 42 over the counter; head 96 WHERE IT FITS. On an 8' wall a 96"
      // head buries the header in the top plates (framer clamps, glass runs
      // into the plate zone — the Kitchen tool used to have to fix it after
      // the fact). Size at creation: cap the head at the wall's legal head
      // (HA.legalHeadFor = wallH − 3" plates − header), preferring the
      // standard 80" (6'-8") head when it fits. 9'+ walls: legal ≥ 96 → head
      // 96, height 54, byte-identical to before.
      const sinkWallH = (w && w.height) || (model.settings && model.settings.wallHeight) || 96;
      const sinkLegal = HA.legalHeadFor ? HA.legalHeadFor(sinkWallH, 48) : sinkWallH - 10.25;
      const sinkHead = sinkLegal >= 96 ? 96 : (sinkLegal >= 80 ? 80 : sinkLegal);
      placeN(sinkEdge, w, 1, 48, Math.max(18, sinkHead - 42), 42);
    } else if (r.kind === 'dining' || r.kind === 'office' || r.kind === 'flex') {
      const w = findWall(primary);
      placeN(primary, w, 2, 36, 60, 36);
    } else if (r.kind === 'bath') {
      // privacy: sill 60, head 90 — only when the bath actually has an exterior wall
      const w = findWall(primary);
      placeN(primary, w, 1, 30, 30, 60);
    }
    // entry (front door + porch), halls, closets, laundry: no windows
  };

  // map an along-edge local coordinate to a pos along a wall (works for ext walls)
  const localAlongToWallPos = (wall, ed, coord, frame) => {
    const toW = frame.toWorld;
    const wp = ed.axis === 'v' ? toW(ed.c, coord) : toW(coord, ed.c);
    const A = { x: wall.x1, y: wall.y1 }, B = { x: wall.x2, y: wall.y2 };
    const t = U.clamp(U.projT(wp, A, B), 0, 1);
    return t * HA.wallLen(wall);
  };

  /* ---------- FIXTURES + ROOM LABELS (v3: clearance + orientation truth) ----------
     Owner bugs fixed here: "kitchens go across the whole wall and cover doors",
     "beds coming in backward", "dressers in front of doors".
     - Every wall-hugging fixture is placed on a CLEAR SEGMENT: the wall span
       minus door openings (+6" each side). Windows are fine behind counter-height
       base cabinets but never behind TALL units (fridge) or upper cabinets.
     - DOOR SWING ZONES (opening span x door-width deep, both sides) are computed
       for the whole level; no fixture rect may intersect one.
     - ORIENTATION (fixtures.js convention: local -d/2 = bed HEADBOARD / sofa &
       dresser BACK / TV screen; plan xform local(0,1) -> world(-sinR, cosR)):
       rotFacing(du,dv) solves the rot that points the fixture FRONT at the
       local-frame direction (du,dv) — so headboards/backs sit flush on walls. */
  const placeFixtures = (model, li, plan, fp, frame, style, opts, rng) => {
    const lvl = model.levels[li];
    const toW = frame.toWorld;
    const inv = (p) => ({
      u: (p.x - frame.origin.x) * frame.ex.x + (p.y - frame.origin.y) * frame.ex.y,
      v: (p.x - frame.origin.x) * frame.ey.x + (p.y - frame.origin.y) * frame.ey.y,
    });

    /* door swing zones in LOCAL coords (span + 6", door-width deep, BOTH sides) */
    const zones = [];
    for (const w of lvl.walls) {
      const len = HA.wallLen(w); if (len < 1) continue;
      const A = { x: w.x1, y: w.y1 }, dw = HA.wallDir(w);
      const horiz = Math.abs(dw.x * frame.ex.x + dw.y * frame.ex.y) > 0.7;
      for (const o of w.openings || []) {
        if (o.kind !== 'door') continue;
        const c = inv({ x: A.x + dw.x * o.pos, y: A.y + dw.y * o.pos });
        // sliders don't swing — keep only a shallow threshold clear; hinged doors
        // block their full swing arc footprint on BOTH sides (swing side unknown)
        const half = o.width / 2 + 6, depth = o.doorType === 'slider' ? 14 : o.width + 4;
        zones.push(horiz
          ? { u0: c.u - half, u1: c.u + half, v0: c.v - depth, v1: c.v + depth }
          : { u0: c.u - depth, u1: c.u + depth, v0: c.v - half, v1: c.v + half });
      }
    }
    const hitZone = (u0, v0, u1, v1) => zones.some((z) =>
      Math.min(u1, z.u1) - Math.max(u0, z.u0) > 1 && Math.min(v1, z.v1) - Math.max(v0, z.v0) > 1);

    /* openings projected onto a wall line: spans along the free axis */
    const lineOpenings = (axis, cLine, a, b, kinds) => {
      const spans = [];
      for (const w of lvl.walls) {
        const dw = HA.wallDir(w);
        const horiz = Math.abs(dw.x * frame.ex.x + dw.y * frame.ex.y) > 0.7;
        if ((axis === 'h') !== horiz) continue;
        const la = inv({ x: w.x1, y: w.y1 });
        if (Math.abs((axis === 'h' ? la.v : la.u) - cLine) > 4) continue;
        for (const o of w.openings || []) {
          if (kinds && kinds.indexOf(o.kind) < 0) continue;
          const oc = inv({ x: w.x1 + dw.x * o.pos, y: w.y1 + dw.y * o.pos });
          const along = axis === 'h' ? oc.u : oc.v;
          if (along < a - 12 || along > b + 12) continue;
          spans.push([along - o.width / 2, along + o.width / 2]);
        }
      }
      return spans;
    };
    const clearSegs = (a, b, spans, pad) => {
      let segs = [[a, b]];
      for (const [s0, s1] of spans) {
        const next = [];
        for (const [x0, x1] of segs) {
          const c0 = Math.max(x0, s0 - pad), c1 = Math.min(x1, s1 + pad);
          if (c1 <= c0) { next.push([x0, x1]); continue; }
          if (c0 - x0 > 12) next.push([x0, c0]);
          if (x1 - c1 > 12) next.push([c1, x1]);
        }
        segs = next;
      }
      return segs.sort((m, n) => (n[1] - n[0]) - (m[1] - m[0]));
    };

    /* fixture FRONT faces local (du,dv); fixtures.js: local(0,1)->world(-sinR,cosR) */
    const rotFacing = (du, dv) => {
      const nx = frame.ex.x * du + frame.ey.x * dv;
      const ny = frame.ex.y * du + frame.ey.y * dv;
      return Math.round(Math.atan2(-nx, ny) * 180 / Math.PI);
    };
    const FX = (type, u, v, rot, w, d) => {
      const p = toW(u, v);
      const f = HA.makeFixture(type, p.x, p.y, rot || 0);
      if (w) f.w = w; if (d) f.d = d;
      lvl.fixtures.push(f);
      return f;
    };
    const LABEL = (text, u, v) => {
      if (!text) return;
      const p = toW(u, v);
      const lb = HA.makeFixture('room_label', p.x, p.y, 0);
      lb.text = text;
      lvl.fixtures.push(lb);
    };
    /* place a wall-backed fixture (back flush on the given room edge). side is
       'v0'|'v1'|'u0'|'u1'; along = coordinate along that wall. Checks the swing
       zones and (checkOpen) any door opening overlapping the back span. */
    const backOn = (r, side, along, type, fw, fd, opts2) => {
      const def = HA.FIXTURES[type] || { w: 24, d: 24 };
      const w = fw || def.w, d = fd || def.d;
      const GAP = 2.75;   // half wall + finish: back edge flush within ~1" of the face
      let u, v, face, rect;
      if (side === 'v0') { face = [0, 1]; v = r.v0 + GAP + d / 2; u = along; rect = [u - w / 2, r.v0, u + w / 2, r.v0 + GAP + d]; }
      else if (side === 'v1') { face = [0, -1]; v = r.v1 - GAP - d / 2; u = along; rect = [u - w / 2, r.v1 - GAP - d, u + w / 2, r.v1]; }
      else if (side === 'u0') { face = [1, 0]; u = r.u0 + GAP + d / 2; v = along; rect = [r.u0, v - w / 2, r.u0 + GAP + d, v + w / 2]; }
      else { face = [-1, 0]; u = r.u1 - GAP - d / 2; v = along; rect = [r.u1 - GAP - d, v - w / 2, r.u1, v + w / 2]; }
      if (hitZone(rect[0], rect[1], rect[2], rect[3])) return null;
      if (!opts2 || !opts2.allowDoorBack) {
        // the back span must be clear of DOOR openings on that wall
        const axis = side[0] === 'v' ? 'h' : 'v';
        const cLine = side === 'v0' ? r.v0 : side === 'v1' ? r.v1 : side === 'u0' ? r.u0 : r.u1;
        const spans = lineOpenings(axis, cLine, along - w / 2, along + w / 2, opts2 && opts2.avoidWindows ? ['door', 'window'] : ['door']);
        for (const [s0, s1] of spans) if (Math.min(along + w / 2, s1) - Math.max(along - w / 2, s0) > 1) return null;
      }
      const f = FX(type, u, v, rotFacing(face[0], face[1]), fw, fd);
      f._rect = rect;   // local footprint — lets a later piece register it as an obstacle
      return f;
    };
    /* try several walls for a back-against-wall piece; returns the fixture or null */
    const backAny = (r, sides, type, fw, fd, opts2) => {
      for (const side of sides) {
        const span = side[0] === 'v' ? [r.u0, r.u1] : [r.v0, r.v1];
        const along = (span[0] + span[1]) / 2;
        const f = backOn(r, side, along, type, fw, fd, opts2);
        if (f) return f;
        // slide toward either end before giving up
        for (const t of [0.3, 0.7]) {
          const f2 = backOn(r, side, span[0] + (span[1] - span[0]) * t, type, fw, fd, opts2);
          if (f2) return f2;
        }
      }
      return null;
    };
    const isExtEdge = (r, side) =>
      side[0] === 'v' ? onLoop(fp.edges, 'h', side === 'v0' ? r.v0 : r.v1, r.u0, r.u1)
                      : onLoop(fp.edges, 'v', side === 'u0' ? r.u0 : r.u1, r.v0, r.v1);

    for (const r of plan.rooms) {
      const cu = (r.u0 + r.u1) / 2, cv = (r.v0 + r.v1) / 2;
      LABEL(r.name, cu, cv);
      const rw = r.u1 - r.u0, rd = r.v1 - r.v0;

      if (r.kind === 'kitchen' || (r.kind === 'living' && r.kitchenRun)) {
        /* ---- kitchen composition on the sink wall's CLEAR SEGMENT ----
           sink under its window; DW beside the sink; fridge at the END of the
           run (never mid-run, never over the window); range mid-run with
           counter both sides; island only with >=42" all-around clearance. */
        const se = r._sinkEdge || { axis: 'h', c: r.v1, mid: cu };
        const horiz = se.axis === 'h';
        const A0 = horiz ? r.u0 + 6 : r.v0 + 6;
        const B0 = horiz ? r.u1 - 6 : r.v1 - 6;
        const doors = lineOpenings(horiz ? 'h' : 'v', se.c, A0, B0, ['door']);
        const wins = lineOpenings(horiz ? 'h' : 'v', se.c, A0, B0, ['window']);
        // ALSO clear the swing zones of doors on PERPENDICULAR walls that reach
        // into the counter band (the bath/laundry door at the end of the run)
        const into2 = horiz ? (Math.abs(se.c - r.v1) < 2 ? -1 : 1) : (Math.abs(se.c - r.u1) < 2 ? -1 : 1);
        const bandLo = Math.min(se.c, se.c + into2 * 30), bandHi = Math.max(se.c, se.c + into2 * 30);
        for (const z of zones) {
          const zA = horiz ? [z.v0, z.v1] : [z.u0, z.u1];       // across the band
          const zS = horiz ? [z.u0, z.u1] : [z.v0, z.v1];       // along the run
          if (Math.min(zA[1], bandHi) - Math.max(zA[0], bandLo) > 1) doors.push([zS[0], zS[1]]);
        }
        const seg = clearSegs(A0, B0, doors, 6)[0];
        if (seg && seg[1] - seg[0] >= ftIn(8)) {
          const [sa, sb] = seg;
          const segLen = sb - sa;
          // wall-face offset + facing into the room
          const intoPos = horiz ? (Math.abs(se.c - r.v1) < 2 ? -1 : 1) : (Math.abs(se.c - r.u1) < 2 ? -1 : 1);
          const runC = se.c + intoPos * 15;         // counter centerline 15" off the wall line
          const face = horiz ? [0, intoPos] : [intoPos, 0];
          const rotRun = rotFacing(face[0], face[1]);
          const P = (along, type, fw, fd) => horiz ? FX(type, along, runC, rotRun, fw, fd) : FX(type, runC, along, rotRun, fw, fd);
          // base cabinets span the clear segment
          P((sa + sb) / 2, 'base_cabinet', segLen);
          // uppers: pieces of the segment NOT crossing the window
          for (const up of clearSegs(sa, sb, wins, 3)) if (up[1] - up[0] >= 18) P((up[0] + up[1]) / 2, 'upper_cabinet', up[1] - up[0]);
          // sink under the window (clamped inside the segment)
          const sinkC = clamp(wins.length ? (wins[0][0] + wins[0][1]) / 2 : (se.mid != null ? se.mid : (sa + sb) / 2), sa + 30, sb - 30);
          P(sinkC, 'kitchen_sink');
          // fridge at the segment END farther from the sink, clear of the window
          let fridgeEndHi = (sb - sinkC) > (sinkC - sa);
          let fridgeC = fridgeEndHi ? sb - 20 : sa + 20;
          const overWin = (cch) => wins.some(([w0, w1]) => Math.min(cch + 18, w1) - Math.max(cch - 18, w0) > 1);
          if (overWin(fridgeC)) { fridgeEndHi = !fridgeEndHi; fridgeC = fridgeEndHi ? sb - 20 : sa + 20; }
          if (!overWin(fridgeC)) P(fridgeC, 'fridge');
          // dishwasher beside the sink (fridge-away side), range beyond with 12"+ counters
          const dirAway = fridgeEndHi ? -1 : 1;
          P(clamp(sinkC + dirAway * 27, sa + 14, sb - 14), 'dishwasher');
          const rangeC = clamp(sinkC + dirAway * 60, sa + 28, sb - 28);
          if (Math.abs(rangeC - fridgeC) > 34 && Math.abs(rangeC - sinkC) > 36) P(rangeC, 'range');
          // island: 42" clearance to the run face AND to the far wall, no swing conflicts
          const need = 42 + 39 / 2;
          const roomSpan = horiz ? rd : rw;
          if (segLen >= ftIn(9) && roomSpan >= 26 + 42 + 39 + 42) {
            const isl = horiz
              ? { u: (sa + sb) / 2, v: se.c + intoPos * (26 + need) }
              : { u: se.c + intoPos * (26 + need), v: (sa + sb) / 2 };
            const iw = Math.min(66, segLen - 24), idp = 39;
            const iRect = horiz ? [isl.u - iw / 2, isl.v - idp / 2, isl.u + iw / 2, isl.v + idp / 2]
                                : [isl.u - idp / 2, isl.v - iw / 2, isl.u + idp / 2, isl.v + iw / 2];
            const inRoom = iRect[0] > r.u0 + 6 && iRect[1] > r.v0 + 6 && iRect[2] < r.u1 - 6 && iRect[3] < r.v1 - 6;
            const farClear = horiz ? (intoPos > 0 ? r.v1 - iRect[3] : iRect[1] - r.v0) : (intoPos > 0 ? r.u1 - iRect[2] : iRect[0] - r.u0);
            if (inRoom && farClear >= 42 && !hitZone(iRect[0], iRect[1], iRect[2], iRect[3]))
              FX('island', isl.u, isl.v, rotRun, iw);
          }
        }
      } else if (r.kind === 'bath') {
        /* CLEAN BATH LAYOUT (CRC/IRC clearances):
           - VANITY first, centered on a wall clear of the door (wide face for the
             sink + mirror + light).
           - TOILET on the same wall, tucked to the roomier corner with >=15" from
             its centerline to any side wall (30" clear zone) and >=15" clear to the
             vanity edge; 21" clear in front is guaranteed by the opposite-wall gap.
           - TUB (>=8' run) or SHOWER on the opposite wall.
           Fixtures already dodge the door SWING zone via backOn's hitZone guard. */
        const opp = (s) => (s === 'v1' ? 'v0' : s === 'v0' ? 'v1' : s === 'u0' ? 'u1' : 'u0');
        const spanOf = (s) => (s[0] === 'v' ? [r.u0, r.u1] : [r.v0, r.v1]);
        // rank walls: interior (no window) first, then by length
        const sides = ['v1', 'v0', 'u0', 'u1']
          .filter((s) => spanOf(s)[1] - spanOf(s)[0] >= 42)
          .sort((a, b) => (isExtEdge(r, a) ? 1 : 0) - (isExtEdge(r, b) ? 1 : 0)
            || (spanOf(b)[1] - spanOf(b)[0]) - (spanOf(a)[1] - spanOf(a)[0]));
        let done = false;
        for (const side of sides) {
          const [a, b] = spanOf(side);
          const len = b - a;
          if (len < 60) continue;
          // vanity centered; if it collides with the door, backOn slides it — we then
          // read its real position back to tuck the toilet on the clear side.
          const van = backOn(r, side, (a + b) / 2, 'vanity');
          if (!van) continue;
          const vl = inv({ x: van.x, y: van.y });
          const vAlong = side[0] === 'v' ? vl.u : vl.v;             // vanity center along the wall
          const vHalf = (HA.FIXTURES.vanity ? HA.FIXTURES.vanity.w : 30) / 2;
          // toilet: pick the roomier side of the vanity, >=18" off the corner and
          // >=15"+vanityHalf clear of the vanity face; slide toward the corner.
          const roomLo = (vAlong - a) > (b - vAlong);              // more room on the low side?
          let tAlong = roomLo ? a + 18 : b - 18;
          const gapNeed = vHalf + 24;                              // 15" clear + ~9" half-toilet
          if (Math.abs(tAlong - vAlong) < gapNeed) tAlong = roomLo ? vAlong - gapNeed : vAlong + gapNeed;
          tAlong = clamp(tAlong, a + 18, b - 18);
          const toi = backOn(r, side, tAlong, 'toilet') || backOn(r, side, roomLo ? b - 18 : a + 18, 'toilet');
          if (toi) done = true; else done = true;   // vanity alone still counts as furnished
          // tub/shower on the opposite wall (or any wall if that fails)
          const oSide = opp(side);
          const bigTub = Math.max(rw, rd) >= ftIn(8);
          if (!backAny(r, [oSide], bigTub ? 'tub' : 'shower')) backAny(r, sides, bigTub ? 'tub' : 'shower');
          break;
        }
        if (!done) backAny(r, sides, 'toilet');
      } else if (r.kind === 'bed') {
        /* HEADBOARD flush on a wall: prefer interior walls clear of openings,
           then walls whose windows don't sit behind the headboard */
        const bedType = r.beds === 'primary' ? 'bed_king' : (rw > 11 * 12 ? 'bed_queen' : 'bed_full');
        const def = HA.FIXTURES[bedType];
        const sides = ['v0', 'v1', 'u0', 'u1']
          .filter((s) => (s[0] === 'v' ? rw : rd) >= def.w + 20)
          .sort((a, b) => (isExtEdge(r, a) ? 1 : 0) - (isExtEdge(r, b) ? 1 : 0));   // interior first
        let bed = null, bedSide = null;
        for (const side of sides) {
          const span = side[0] === 'v' ? [r.u0, r.u1] : [r.v0, r.v1];
          bed = backOn(r, side, (span[0] + span[1]) / 2, bedType, null, null, { avoidWindows: true });
          if (!bed) bed = backOn(r, side, (span[0] + span[1]) / 2, bedType);   // window behind is OK if nothing else fits
          if (bed) { bedSide = side; break; }
        }
        const placedPieces = [];
        if (bed && bedSide) {
          placedPieces.push(bed);
          // nightstands flanking the headboard when the wall is wide enough
          const span = bedSide[0] === 'v' ? [r.u0, r.u1] : [r.v0, r.v1];
          const mid = (span[0] + span[1]) / 2;
          for (const sgn of [-1, 1]) {
            const along = mid + sgn * (def.w / 2 + 14);
            if (along - 11 > span[0] + 4 && along + 11 < span[1] - 4) {
              // FAMILY: the auto-placed nightstands are children of the bed, so
              // dragging the bed carries them (Steve: "nightstands too").
              const ns = backOn(r, bedSide, along, 'nightstand');
              if (ns) { ns.parentId = bed.id; placedPieces.push(ns); }
            }
          }
          // dresser: back on one of the OTHER walls, never in a swing
          const others = ['v0', 'v1', 'u0', 'u1'].filter((s) => s !== bedSide);
          const dr = backAny(r, others, 'dresser');
          if (dr) placedPieces.push(dr);
        }
        // R21 Q1: REAL clothes storage in every bedroom. The splitL cluster's
        // BEDROOM 3/4 shipped with no closet at all (the census: 84/120 plans).
        // A bedroom without an adjacent closet ZONE (>=24" shared wall) gets a
        // freestanding WARDROBE on a wall clear of doors/swings/windows; the
        // already-placed bed set registers as obstacles so it can't overlap.
        const hasClosetZone = plan.rooms.some((c) => c.kind === 'closet'
          && sharedEdges(r, c).some((e2) => e2.b - e2.a >= 24));
        if (!hasClosetZone) {
          for (const f2 of placedPieces) if (f2._rect)
            zones.push({ u0: f2._rect[0], v0: f2._rect[1], u1: f2._rect[2], v1: f2._rect[3] });
          const wSides = ['v0', 'v1', 'u0', 'u1'].filter((s) => s !== bedSide).concat(bedSide ? [bedSide] : []);
          if (!backAny(r, wSides, 'wardrobe', null, null, { avoidWindows: true }))
            backAny(r, wSides, 'wardrobe');
        }
      } else if (r.kind === 'living') {
        // TV backed on an interior wall; sofa floating, facing it; coffee table between
        const sides = ['v0', 'v1', 'u0', 'u1'].sort((a, b) => (isExtEdge(r, a) ? 1 : 0) - (isExtEdge(r, b) ? 1 : 0));
        let tv = null, tvSide = null;
        for (const side of sides) {
          tv = backOn(r, side, (side[0] === 'v' ? cu : cv), 'tv_console', null, null, { avoidWindows: true });
          if (tv) { tvSide = side; break; }
        }
        if (tvSide) {
          const off = 9 * 12;   // sofa ~9ft off the TV wall
          // floating pieces still respect swing zones: nudge along the wall, then skip
          const freeFX = (type, u, v, face, fw2, fd2) => {
            const def2 = HA.FIXTURES[type] || { w: 24, d: 24 };
            const w2 = fw2 || def2.w, d2 = fd2 || def2.d;
            const vert = face[0] !== 0;                      // facing ±u -> long side runs v
            for (const s of [0, -30, 30, -60, 60]) {
              const uu = u + (vert ? 0 : s), vvv = v + (vert ? s : 0);
              const bw2 = vert ? d2 : w2, bd2 = vert ? w2 : d2;
              if (!hitZone(uu - bw2 / 2, vvv - bd2 / 2, uu + bw2 / 2, vvv + bd2 / 2))
                return FX(type, uu, vvv, rotFacing(face[0], face[1]), fw2, fd2);
            }
            return null;
          };
          // seating group: face points from the sofa back toward the TV wall.
          // sofaC / coffeeC are the sofa + coffee-table centers for this wall.
          let face, sofaC, coffeeC;
          if (tvSide === 'v0') { face = [0, -1]; sofaC = [cu, Math.min(r.v1 - 30, r.v0 + off)]; coffeeC = [cu, Math.min(r.v1 - 60, r.v0 + off - 44)]; }
          else if (tvSide === 'v1') { face = [0, 1]; sofaC = [cu, Math.max(r.v0 + 30, r.v1 - off)]; coffeeC = [cu, Math.max(r.v0 + 60, r.v1 - off + 44)]; }
          else if (tvSide === 'u0') { face = [-1, 0]; sofaC = [Math.min(r.u1 - 30, r.u0 + off), cv]; coffeeC = [Math.min(r.u1 - 60, r.u0 + off - 44), cv]; }
          else { face = [1, 0]; sofaC = [Math.max(r.u0 + 30, r.u1 - off), cv]; coffeeC = [Math.max(r.u0 + 60, r.u1 - off + 44), cv]; }
          // AREA RUG under the seating group — pushed FIRST so it draws below the
          // sofa/coffee in 2D; local w runs along the wall, d off the wall. Clamp
          // to fit the room (facing ±v -> w spans rw, d spans rd; ±u swaps them).
          const rugW = Math.min(96, (face[0] ? rd : rw) - 12), rugD = Math.min(60, (face[0] ? rw : rd) - 12);
          if (rugW >= 40 && rugD >= 30) FX('area_rug', coffeeC[0], coffeeC[1], rotFacing(face[0], face[1]), rugW, rugD);
          freeFX('sofa', sofaC[0], sofaC[1], face);
          freeFX('coffee_table', coffeeC[0], coffeeC[1], face);
          // ACCENT CHAIR angled in from a side wall (never the sofa or TV wall),
          // seated at the group center + facing the coffee table. First one that clears.
          const sideWalls = face[0] ? ['v0', 'v1'] : ['u0', 'u1'];
          for (const sw of sideWalls) {
            const inset = 22;   // ~2ft off the side wall, turned toward the group
            let au, av, aface;
            if (sw === 'u0') { au = r.u0 + inset; av = coffeeC[1]; aface = [1, 0]; }
            else if (sw === 'u1') { au = r.u1 - inset; av = coffeeC[1]; aface = [-1, 0]; }
            else if (sw === 'v0') { au = coffeeC[0]; av = r.v0 + inset; aface = [0, 1]; }
            else { au = coffeeC[0]; av = r.v1 - inset; aface = [0, -1]; }
            if (freeFX('accent_chair', au, av, aface)) break;
          }
        }
      } else if (r.kind === 'entry') {
        // FOYER: a console table backed on an interior wall, clear of the front
        // door swing (backOn's hitZone + door-span guard keep it out of the swing
        // and off the opening). Interior walls sort first; prefer a window-free
        // wall, then fall back to any clear wall so most foyers get a console.
        const sides = ['v0', 'v1', 'u0', 'u1'].sort((a, b) => (isExtEdge(r, a) ? 1 : 0) - (isExtEdge(r, b) ? 1 : 0));
        backAny(r, sides, 'console_table', null, null, { avoidWindows: true })
          || backAny(r, sides, 'console_table');
        // roomy foyer (both dims > ~6') gets a centered runner/area rug underfoot
        if (rw > ftIn(6) && rd > ftIn(6)) {
          const rugW = Math.min(60, rw - 18), rugD = Math.min(40, rd - 18);
          if (rugW >= 30 && rugD >= 24 && !hitZone(cu - rugW / 2, cv - rugD / 2, cu + rugW / 2, cv + rugD / 2))
            FX('area_rug', cu, cv, rotFacing(0, 1), rugW, rugD);
        }
      } else if (r.kind === 'dining') {
        // center the table; slide toward the front if a slider/door threshold bites
        let table = null, tShift = 0;
        for (const s of [0, -24, -48, 24]) {
          if (!hitZone(cu - 36, cv + s - 20, cu + 36, cv + s + 20)) { table = FX('dining_table', cu, cv + s, rotFacing(0, 1)); tShift = s; break; }
        }
        if (table) {
          // ring dining chairs around the table facing IN. local w(72) runs along
          // u, d(40) along v (rotFacing(0,1)); a chair facing ±v has its 18" width
          // along u, 20" depth along v (and swapped for the ±u end chairs).
          const tw = table.w, td = table.d, tcu = cu, tcv = cv + tShift;
          const chW = HA.FIXTURES.dining_chair.w, chD = HA.FIXTURES.dining_chair.d;
          const gap = 2.5;                                   // tuck ~2.5" off the table edge
          const place = (u, v, fx2, fy2) => {
            const bw = fx2 ? chD : chW, bd = fx2 ? chW : chD; // world extents for this facing
            if (u - bw / 2 > r.u0 + 2 && u + bw / 2 < r.u1 - 2 && v - bd / 2 > r.v0 + 2 && v + bd / 2 < r.v1 - 2
                && !hitZone(u - bw / 2, v - bd / 2, u + bw / 2, v + bd / 2))
              FX('dining_chair', u, v, rotFacing(fx2, fy2), chW, chD);
          };
          const nLong = tw >= 66 ? 3 : 2;                    // 2 (4 total) small -> 3 (6 total) long
          for (let i = 0; i < nLong; i++) {
            const u = tcu + (i - (nLong - 1) / 2) * (tw / nLong);
            place(u, tcv - td / 2 - gap - chD / 2, 0, 1);    // back-side chairs face +v
            place(u, tcv + td / 2 + gap + chD / 2, 0, -1);   // front-side chairs face -v
          }
          if (tw >= 84) {                                    // only a long table seats end chairs
            place(tcu - tw / 2 - gap - chD / 2, tcv, 1, 0);
            place(tcu + tw / 2 + gap + chD / 2, tcv, -1, 0);
          }
        }
      } else if (r.kind === 'laundry') {
        const w1 = backAny(r, ['v1', 'v0', 'u0', 'u1'], 'washer');
        if (w1) {
          const lw1 = inv({ x: w1.x, y: w1.y });
          // dryer right beside the washer on the same wall
          const dSide = Math.abs(lw1.v - (r.v1 - 2.75 - 14.5)) < 3 ? 'v1' : Math.abs(lw1.v - (r.v0 + 2.75 + 14.5)) < 3 ? 'v0' : (Math.abs(lw1.u - r.u0) < 20 ? 'u0' : 'u1');
          const along = dSide[0] === 'v' ? lw1.u + 29 : lw1.v + 29;
          backOn(r, dSide, along, 'dryer');
        }
      } else if (r.kind === 'office') {
        backAny(r, ['v0', 'u0', 'u1', 'v1'], 'desk');
        backAny(r, ['u0', 'u1', 'v1'], 'bookcase');
      }
      // stair / closet / pantry / hall rooms carry only their label
    }

    // stairs (2-story) — ONE physical flight, on the LOWEST level only (Steve
    // Jul 6: "should just be a stair on the first floor run"; the L1 copy's
    // handrail poked through the roof). Upper levels get an OPEN-BELOW stairwell
    // instead: view3d._buildFloors already punches the L1 platform hole from the
    // BELOW level's stairs fixture, plan2d draws the dashed below-stair reference,
    // and guardStairwell() rails any open hole edge (IRC R312 guard).
    if (plan.stairs) {
      const s = plan.stairs;
      const scu = (s.u0 + s.u1) / 2, scv = (s.v0 + s.v1) / 2;
      if (li === 0) {
        // top of the run toward +v (rotFacing(0,1), no +180): the flight ARRIVES
        // at the upper landing band beside the hall. The old +180 orientation
        // arrived at the 12" strip against the FRONT wall — backwards.
        const st = HA.makeFixture('stairs', toW(scu, scv).x, toW(scu, scv).y, rotFacing(0, 1));
        st.d = Math.max(120, s.v1 - s.v0);
        st.w = Math.max(36, s.u1 - s.u0);
        lvl.fixtures.push(st);
      } else {
        guardStairwell(model, li, s, frame);
      }
    }
    // water heater — in the GARAGE corner when one exists (real detail: WH lives in
    // the garage, off the finished floor), else the laundry/closet corner (level 0).
    // An ADU is SKIPPED here: its HPWH mounts OUTSIDE in the louvered exterior
    // enclosure (placed post-build in generate(), once walls + openings exist).
    if (li === 0 && !plan.isADU) {
      const gar = plan.rooms.find((r) => r.kind === 'garage');
      const util = gar || plan.rooms.find((r) => r.kind === 'laundry') || plan.rooms.find((r) => r.kind === 'closet');
      if (util && !hitZone(util.u0 + 2, util.v0 + 2, util.u0 + 26, util.v0 + 26))
        FX('water_heater', util.u0 + 14, util.v0 + 14, 0);
    }
  };

  /* ---------- PORCH / ENTRIES ----------
     The ENTRANCE TOOL is the porch system (owner): one entrance object per
     doorway — it already builds the landing (concrete or wood), steps, posts
     and its own gable/shed/hip/flat roof (or roof OFF = plain landing). The
     generator therefore NEVER stacks a deck object under an entrance and never
     adds porch walls/extra roofs on top of one.
       front door  -> entrance, style roof; 'full' = a WIDE entrance (the
                      entrance spans the porch bay with railing + posts)
       rear slider -> rear entrance: covered patio (roof ON) for the porch-
                      loving styles, plain concrete landing (roof 'none') else */
  /* ---------- HILLS/DECKS A1: GRADE under + behind the footprint ----------
     Samples HA.terrain.heightAtInches (grade-relative inches) at the footprint
     corners + the rear-yard band, so the porch/deck + bench logic know whether the
     lot has meaningful relief. Returns { hasTerrain, maxDeltaIn, rearDeltaIn,
     rearMid, rearN }. All-zero (flat / terrain off) when no usable surface. Pure. */
  const gradeInfo = (model, fp, frame) => {
    const out = { hasTerrain: false, maxDeltaIn: 0, rearDeltaIn: 0, rearMid: null, rearN: null };
    if (!HA.terrain || typeof HA.terrain.heightAtInches !== 'function') return out;
    const toW = frame.toWorld, FR = fp.rect;
    const hAt = (x, y) => { const h = HA.terrain.heightAtInches(model, x, y); return (h != null && isFinite(h)) ? h : null; };
    // footprint corners
    const corners = [toW(FR.u0, FR.v0), toW(FR.u1, FR.v0), toW(FR.u1, FR.v1), toW(FR.u0, FR.v1)];
    const hs = [];
    for (const c of corners) { const h = hAt(c.x, c.y); if (h != null) hs.push(h); }
    if (hs.length < 2) return out;
    out.hasTerrain = true;
    out.maxDeltaIn = Math.max(...hs) - Math.min(...hs);
    // rear edge (v1, the far side from the street) midpoint + outward normal (+v)
    const rearMidW = toW((FR.u0 + FR.u1) / 2, FR.v1);
    const inW = toW((FR.u0 + FR.u1) / 2, FR.v1 - 12);
    const nx = rearMidW.x - inW.x, ny = rearMidW.y - inW.y, nl = Math.hypot(nx, ny) || 1;
    out.rearMid = rearMidW; out.rearN = { x: nx / nl, y: ny / nl };
    // grade delta from the rear wall out to ~20' behind (the bench depth window)
    const hRear = hAt(rearMidW.x, rearMidW.y);
    const hBack = hAt(rearMidW.x + out.rearN.x * 240, rearMidW.y + out.rearN.y * 240);
    if (hRear != null && hBack != null) out.rearDeltaIn = Math.abs(hBack - hRear);
    return out;
  };

  /* ---------- HILLS/DECKS A2: AUTO-ENABLE the backyard bench on a steep rear ----
     Steve: "if the hill is steep its fine to make the background flat and level
     out the back with terrain wall in rear." When the rear grade delta over the
     bench depth exceeds ~30", set model.site.terrain.backyardBench = {enabled,
     depthIn} so terrain.js flattens the yard to pad grade + drops a retaining wall.
     No-op on flat lots / terrain off (keeps legacy renders byte-identical). */
  const BENCH_TRIGGER_IN = 30;      // rear grade delta over the bench depth to level
  const autoEnableBench = (model, fp, frame, grade) => {
    const site = model && model.site;
    if (!site || !site.terrain || !site.terrain.enabled) return;
    if (!grade || !grade.hasTerrain) return;
    if (grade.rearDeltaIn <= BENCH_TRIGGER_IN) return;
    const depthIn = (HA.terrain && HA.terrain.DEFAULT_BENCH_DEPTH) || 240;
    site.terrain.backyardBench = { enabled: true, depthIn };
    if (site._benchCache) delete site._benchCache;   // force a re-resolve off the new footprint
  };

  /* ---------- HILLS/DECKS A3: AUTO BACKYARD DESIGN ----------
     Furnish the rear yard via HA.sitefeatures.autoBackyardDesign (seeded archetype:
     patio + BBQ + dining + fire pit + beds + trees). Runs AFTER applyGarage's _gen
     sweep so the features it emits (all tagged _gen + backyard) survive to render
     and get replaced on the next regen. Best-effort — never fails generation. */
  const applyBackyard = (model, opts) => {
    try {
      if (HA.ensureSite) HA.ensureSite(model);
      const site = model.site; if (!site) return;
      opts = opts || {};
      // POOL mode for the orchestrator: a SEEDED-probability pool fits in the CREATIVE
      // flow — Random mode (opts.random) or an explicit pool:true — so plain generate
      // stays pool-conservative (the pool + its 5' apron reshape the whole yard, which
      // a deterministic "generate this plan" shouldn't do unasked). pool:false (the
      // rotate re-derive) forces OFF. The 🌴 Backyard panel drives pool:'auto' directly
      // for the on-demand "design a pool in" experience Steve asked for.
      const poolMode = (opts.pool === false) ? 'off'
        : (opts.pool === true || opts.random === true) ? 'auto' : 'off';
      // PREFERRED PATH: the parametric backyard designer (schemes + pool-aware layout
      // + poolside lounge). Clears prior _gen backyard/pool itself (idempotent regen).
      if (HA.backyard && typeof HA.backyard.design === 'function') {
        HA.backyard.design(model, { seed: (opts.seed >>> 0) || 0, pool: poolMode });
      } else if (HA.sitefeatures && typeof HA.sitefeatures.autoBackyardDesign === 'function') {
        // FALLBACK (designer not bundled): the raw yard engine, as before.
        const feats = site.features || (site.features = []);
        for (let i = feats.length - 1; i >= 0; i--) if (feats[i] && feats[i]._gen && (feats[i].backyard || feats[i].poolside)) feats.splice(i, 1);
        for (const f of (HA.sitefeatures.autoBackyardDesign(model, { seed: (opts.seed >>> 0) }) || [])) feats.push(f);
        if (poolMode !== 'off' && (opts.pool === true || opts.random === true) && HA.sitefeatures.autoPool) {
          const pool = HA.sitefeatures.autoPool(model, { seed: (opts.seed >>> 0) });
          if (pool) { feats.push(pool); addPoolLounge(model, pool); }
        }
      }
      // PORCH SWING + rear-DECK FURNITURE (HILLS/DECKS A5) — read the entrances the
      // porch pass flagged (_wantSwing / _wantDeckFurniture) and drop the pieces now,
      // AFTER the garage _gen sweep, so they survive. Tagged _gen + backyard.
      const lvl0 = model.levels && model.levels[0];
      for (const ent of ((lvl0 && lvl0.entrances) || [])) {
        if (ent._wantSwing) addPorchSwing(model, ent);
        if (ent._wantDeckFurniture) addDeckFurniture(model, ent);
      }
    } catch (e) { /* backyard is best-effort */ }
  };

  /* Steve addendum (Jul 5): poolside CHAISE PAIR. Two chaises side by side on the
     HOUSE side of the pool, PARALLEL (identical rot), both facing the water, with a
     small side table between. Placed off the pool's edge toward the house so they
     read as a deck-side lounge row. Tagged _gen + backyard (+poolside) for the
     regen sweep. Best-effort; never fails generation. */
  /* R46 — clear the whole yard DESIGN ahead of a fresh house build. Removes
     every hardscape / planting / water / furniture feature (pools, driveways,
     sidewalks, walkways, concrete/paving, flower beds, trees, bushes,
     trellises, fences, trash enclosures, yard items) whether the generator
     made it (_gen) or the user / AI placed it by hand — a new footprint makes
     all of them stale. KEEPS true site CONTEXT only:
       street / road  — imagery context, not the house's yard
       label          — "(E) existing" free-text annotations
       structure      — existing (E) buildings kept as site context
     Also drops the transient _genGarage record so the driveway re-derives
     against the new garage, and the seeded starter-walk flag. Best-effort. */
  const KEEP_ON_GENERATE = { street: 1, road: 1, label: 1, structure: 1 };
  const clearYardForGenerate = (model) => {
    try {
      // NB: do NOT ensureSite() here — it backfills left/right setbacks from
      // 'side', which counts as mutating user-set setbacks on a generate that
      // then FAILS (tiny lot). There's nothing to clear if the site/features
      // don't exist yet, so just read what's there.
      const feats = model && model.site && Array.isArray(model.site.features) ? model.site.features : null;
      if (feats) {
        for (let i = feats.length - 1; i >= 0; i--) {
          const f = feats[i];
          if (!f) { feats.splice(i, 1); continue; }
          if (!KEEP_ON_GENERATE[f.type]) feats.splice(i, 1);
        }
      }
      // the garage record is rebuilt by applyGarage; a stale one would misroute
      // the fresh driveway. Yard-edited flag is a re-derive hint, not for a full build.
      try { delete model._genGarage; } catch (e) {}
      try { if (model.site) delete model.site._yardUserEdited; } catch (e) {}
    } catch (e) { /* clearing the yard must never fail generation */ }
  };

  const addPoolLounge = (model, pool) => {
    try {
      const SFm = HA.sitefeatures;
      if (!SFm || !SFm.yardItem || !SFm.faceRot || !pool || !Array.isArray(pool.poly) || pool.poly.length < 3) return;
      const feats = model.site.features;
      // pool centroid + the direction from the pool back toward the house footprint
      let cx = 0, cy = 0; for (const p of pool.poly) { cx += p.x; cy += p.y; }
      cx /= pool.poly.length; cy /= pool.poly.length;
      const loop = HA.exteriorLoop ? HA.exteriorLoop(model, 0) : null;
      const foot = (loop && loop.pts && loop.pts.length >= 3) ? loop.pts : null;
      if (!foot) return;
      let hx = 0, hy = 0; for (const p of foot) { hx += p.x; hy += p.y; }
      hx /= foot.length; hy /= foot.length;
      const dl = Math.hypot(hx - cx, hy - cy) || 1;
      const dir = { x: (hx - cx) / dl, y: (hy - cy) / dl };   // pool → house
      // pool half-extent toward the house, so the chaises sit just OFF the water edge
      let ext = 0;
      for (const p of pool.poly) { const d = (p.x - cx) * dir.x + (p.y - cy) * dir.y; if (d > ext) ext = d; }
      const base = { x: cx + dir.x * (ext + 52), y: cy + dir.y * (ext + 52) };
      const perp = { x: -dir.y, y: dir.x };
      const rot = SFm.faceRot(-dir.x, -dir.y);                // BOTH chaises FACE the water
      const lot = model.site.lot;
      const okp = (p) => (!lot || U.pointInPoly(p, lot)) && !U.pointInPoly(p, pool.poly);
      const c1 = { x: base.x + perp.x * 26, y: base.y + perp.y * 26 };
      const c2 = { x: base.x - perp.x * 26, y: base.y - perp.y * 26 };
      if (!okp(c1) || !okp(c2)) return;
      for (const c of [c1, c2]) {
        const ch = SFm.yardItem('chaise', c.x, c.y, { rot });
        ch._gen = true; ch.backyard = true; ch.poolside = true;
        feats.push(ch);
      }
      const tb = SFm.yardItem('generic', base.x, base.y, { w: 18, d: 18, label: '' });
      tb._gen = true; tb.backyard = true; tb.poolside = true;
      feats.push(tb);
    } catch (e) { /* best-effort */ }
  };

  /* ---------- FRONT YARD + WALKWAYS (Steve, Jul 5) ----------
     Runs on EVERY generate/random, WITH OR WITHOUT a garage:
       • sweeps prior _gen FRONT features (walkways, pads, front-yard beds/trees) so a
         regen never stacks them;
       • when garage:'none' — guarantees NO driveway feature survives on Random
         (Steve: "if no driveway, remove all driveways on random") + lays a STRAIGHT
         walkway from the front door to the sidewalk/front lot line;
       • when a driveway exists — lays an L-shaped walkway from the driveway edge to
         the front entrance;
       • seeds FRONT-YARD DESIGNS (foundation beds, trees, flower boxes) + walkway
         MATERIAL variants (concrete / stepping pads with grass joints / pavers).
     All emitted features are tagged _gen + frontyard so the next regen replaces them.
     Best-effort — never fails generation. */
  const applyFrontYard = (model, opts) => {
    try {
      if (!HA.sitefeatures || typeof HA.sitefeatures.frontWalkway !== 'function') return;
      if (HA.ensureSite) HA.ensureSite(model);
      const site = model.site; if (!site) return;
      const feats = site.features || (site.features = []);
      const hasGarage = !!(model._genGarage);
      const preserveDesign = !!(opts && opts.preserveDesign);
      // STRIP prior _gen front features (walkway/pads/frontyard). The backyard + drive
      // _gen features are swept by applyBackyard/applyGarage; here we sweep the FRONT
      // set. Also: when there is NO garage, sweep ANY _gen driveway that a prior regen
      // (with a garage) left behind — Random with garage:'none' must have zero drives.
      for (let i = feats.length - 1; i >= 0; i--) {
        const f = feats[i];
        if (!f) continue;
        if (f._gen && (f.walkwayFollow || f.padStep || (!preserveDesign && f.frontyard))) { feats.splice(i, 1); continue; }
        if (!hasGarage && f._gen && f.driveway) { feats.splice(i, 1); continue; }   // no-garage → no drive
        // ROUND 7 (Steve: "the sidewalk dont go all the way to the street") — the app
        // BOOT auto-seeds a short 9' starter walk (SF.seedDefaults) before the user
        // hits Random; its stub then lingers beside the real generated walkway,
        // reading as a walk that "stops mid-lawn". Sweep the seeded stub (tagged
        // walk.seeded) + the legacy untagged seed signature on generator-built
        // models (label WALKWAY, 36" wide, no walkwayFollow, ≤3 verts). User-drawn
        // paths (label PATH / edited) are never touched.
        if (f.type === 'walkway' && !f._gen && !f.walkwayFollow &&
            (f.seeded === true ||
             (model._genOpts && f.label === 'WALKWAY' && Math.abs((f.widthIn || 0) - 36) < 0.5 &&
              Array.isArray(f.centerline) && f.centerline.length <= 3))) { feats.splice(i, 1); continue; }
      }
      const seed = (opts && opts.seed) >>> 0;
      const style = (opts && opts.style) || (model._genOpts && model._genOpts.style);
      // FRONT WALKWAY (L-shape to the drive, or straight to the sidewalk with no drive)
      const walk = HA.sitefeatures.frontWalkway(model, { gen: true, seed, style });
      if (walk) {
        feats.push(walk);
        // STEPPING-PAD material → emit discrete concrete pads with grass joints ALONG
        // the walk instead of the continuous ribbon; hide the ribbon (keep it as the
        // route carrier but mark it so 3D/2D draw pads, not a slab).
        if (walk.material === 'stepping' && typeof HA.sitefeatures.steppingPads === 'function') {
          const pads = HA.sitefeatures.steppingPads(walk, { gen: true });
          if (pads.length) { walk.ribbonHidden = true; for (const p of pads) { p.frontyard = true; feats.push(p); } }
        }
      }
      // FRONT-YARD DESIGN (foundation beds + trees + flower boxes) — always seeded so
      // the front reads finished; the archetype varies by seed.
      if (!preserveDesign && typeof HA.sitefeatures.frontYardDesign === 'function') {
        const fy = HA.sitefeatures.frontYardDesign(model, { seed });
        for (const f of (fy || [])) feats.push(f);
      }
    } catch (e) { /* front yard is best-effort */ }
  };

  /* ---------- RE-DERIVE SITE FEATURES (Steve round 7: "if the house is rotated
     or flipped the driveway and the sidewalk entrance dont change directions") ----
     After HA.rotateModel (or any house-pose change), every GENERATED site feature
     is stale — the drive still aims at the old garage-door bearing, the walk leaves
     the old door facing. This re-runs the same sweep+derive path the generator
     uses: refresh the transient garage record from the LIVE (rotated) label
     geometry, sweep the pose-derived _gen features (driveway / front yard / walk /
     pads / backyard — a placed POOL + its poolside chaises stay, they're
     yard-anchored), then re-route the drive + backyard + front yard. Manual
     (non-_gen) features are never touched. Best-effort; returns true on success. */
  const regenSiteFeatures = (model, regenOpts) => {
    try {
      if (!model || !HA.sitefeatures || !HA.ensureSite) return false;
      HA.ensureSite(model);
      const feats = model.site && model.site.features;
      if (!feats) return false;
      // refresh the garage record from the LIVE label-derived geometry (rotateModel
      // spun the label's offset vectors; _genGarage.rect/manDoor were stale).
      try {
        const gi = HA.garageInfo ? HA.garageInfo(model) : null;
        if (gi && model._genGarage) {
          if (gi.rect) model._genGarage.rect = gi.rect;
          if (gi.manDoor) model._genGarage.manDoor = gi.manDoor;
          model._genGarage.slabY = gi.slabY;
        }
      } catch (e) { /* garage record refresh is best-effort */ }
      const opts = model._genOpts || {};
      // A moved yard feature makes the current composition user-authored. House
      // and entrance edits may still reroute their driveway/walk, but must not
      // tear down and re-seed unrelated trees, pools, beds or furniture.
      const preserveYard = !!(model.site._yardUserEdited || (regenOpts && regenOpts.preserveYard));
      // sweep every pose-derived generated feature (pool + poolside lounge stay)
      for (let i = feats.length - 1; i >= 0; i--) {
        const f = feats[i];
        const route = f && (f.driveway || f.walkwayFollow || f.padStep || f.padFoot);
        const design = f && (f.frontyard || f.backyard);
        if (f && f._gen && f.type !== 'pool' && !f.poolside &&
            (route || (!preserveYard && design))) feats.splice(i, 1);
      }
      // driveway re-route (garage door + lot present)
      const hasLot = Array.isArray(model.site.lot) && model.site.lot.length >= 3;
      if (hasLot && HA.sitefeatures.garageDriveway && HA.sitefeatures.garageDoorInfo &&
          HA.sitefeatures.garageDoorInfo(model)) {
        const drv = HA.sitefeatures.garageDriveway(model, { gen: true, style: opts.style, seed: opts.seed });
        if (drv) feats.push(drv);
      }
      // backyard + front yard + walkway re-derive off the rotated house (pool:false
      // — the surviving pool is kept, never re-rolled by a rotate)
      if (!preserveYard) applyBackyard(model, { seed: (opts.seed >>> 0) || 0, pool: false });
      applyFrontYard(model, { seed: opts.seed, style: opts.style, preserveDesign: preserveYard });
      try { if (model.site._benchCache) delete model.site._benchCache; } catch (e) {}
      return true;
    } catch (e) { return false; }
  };

  const applyPorch = (model, plan, fp, frame, style, opts, rng, grade) => {
    let mode = opts.porch && opts.porch !== 'auto' ? opts.porch : style.porch;
    // HILLS/DECKS A1: a meaningful slope under/behind the footprint → prefer WOOD
    // decks (raised on posts, above grade) over concrete patios, and make the front
    // porch + rear deck BIGGER + furniture-workable.
    const onHill = !!(grade && grade.hasTerrain && (grade.maxDeltaIn > 18 || grade.rearDeltaIn > 18));
    const lvl = model.levels[0];
    const toW = frame.toWorld;
    const FR = fp.rect;
    const entry = plan.rooms.find((r) => r.name === plan.frontDoorRoom) || plan.rooms.find((r) => r.kind === 'entry');
    // CENTERING INVARIANT (owner: "your entrance is offset, they don't look good"):
    // the entrance centers on the ACTUAL front door opening — read the placed door
    // back off the front wall (its pos may have been clamped), never the room center.
    let doorU = snap(entry ? (entry.u0 + entry.u1) / 2 : (FR.u0 + FR.u1) / 2);
    const frontWall = lvl.walls.find((w) => w.id === lvl._frontDoorWallId);
    if (frontWall && frontWall._loc) {
      const door = (frontWall.openings || []).find((o) => o.kind === 'door');
      if (door) {
        const a = frontWall._loc.a, b = frontWall._loc.b;
        const t = door.pos / (HA.wallLen(frontWall) || 1);
        doorU = a.u + (b.u - a.u) * t;
      }
    }
    const outFront = { x: -frame.ey.x, y: -frame.ey.y };   // outward past the front wall

    // ---- FRONT entrance (unless porch:'none' — then a bare concrete stoop) ----
    // width SHRINKS to stay centered on the door WITHIN the facade span: the
    // entrance may never cantilever past a house corner. With an attached GARAGE
    // the house front wall is a SHORT segment (the garage split the facade), so the
    // span is the front-door WALL's own u-extent — not the whole composed footprint.
    let facLo = FR.u0, facHi = FR.u1, frontV = FR.v0;
    if (frontWall && frontWall._loc) {
      facLo = Math.min(frontWall._loc.a.u, frontWall._loc.b.u);
      facHi = Math.max(frontWall._loc.a.u, frontWall._loc.b.u);
      frontV = frontWall._loc.a.v;   // the HOUSE front line (behind the garage projection)
    }
    const maxCentered = 2 * Math.min(doorU - facLo - 6, facHi - doorU - 6);
    // ON A HILL a raised WOOD porch reads right (concrete stoop on a slope would
    // need a tall dirt-holding wall); on flat ground concrete stays the default.
    const frontLanding = onHill ? 'wood' : 'concrete';
    let frontEnt = null;
    if (mode !== 'none') {
      const wide = mode === 'full';
      let w = 96;
      if (wide) {
        const great = plan.rooms.find((r) => r.kind === 'living');
        const bay = (great ? great.u1 - great.u0 : 0) + (entry ? entry.u1 - entry.u0 : 0);
        w = snap(clamp(bay - 24, ftIn(10), ftIn(20)));
      }
      // HILLS/DECKS A1: bigger front porch on a slope (a real usable porch, not a stoop)
      if (onHill && !wide) w = Math.max(w, ftIn(10));
      w = snap(clamp(Math.min(w, maxCentered), ftIn(5), ftIn(20)));
      frontEnt = addEntrance(lvl, toW(doorU, frontV), outFront, style, wide ? 'full' : 'entry', w, { landing: frontLanding, deeper: onHill });
      // GRAND STUCCO ENTRANCE (Steve: "stucco walls and pillars, the roof pops
      // up in the entrance and ties back to the hip on the house — super common
      // in CA"): on stucco-clad hip-roof styles (ranch today), roll the
      // raised-entry treatment — fat stucco pillars in the house cladding, a
      // stucco entablature, and the entry hip RAISED so it reads as its own
      // popped mass dying back into the main hip (the entrance die-in framing
      // handles the tie-back). Seed-rolled so plain entries still appear.
      if (frontEnt && style.cladding === 'stucco' && style.roofShape === 'hip' && rng() < 0.6) {
        frontEnt.pillarStyle = 'stucco';
        frontEnt.pillarSize = 13;
        // NO pillarMaterial stamp — the 3D reads the model's ACTUAL exterior-wall
        // surface, so the piers always match the palette roll + later repaints
        frontEnt.roofType = 'hip';
        frontEnt.entryPop = snap(clamp(18 + rng() * 12, 18, 30));
        frontEnt.depth = Math.max(frontEnt.depth || 0, ftIn(7));
        frontEnt.railing = false;   // open stucco entry — the code guard still adds a rail on tall stoops
      }
    } else {
      // ENHANCED bare-door entry (Steve: "enhance some for front entrances") — even the
      // no-porch (modern) styles get a MODEST covered entry: a shallow flat/shed canopy
      // on two slim posts over a deeper stoop, instead of a bare slab. Stays proportioned
      // (never cantilevers past a corner: width clamped to the centered facade span).
      const ew = snap(clamp(Math.min(maxCentered, ftIn(6)), ftIn(4), ftIn(7)));
      const e = addEntrance(lvl, toW(doorU, frontV), outFront, style, 'entry', ew, { landing: frontLanding });
      e.depth = ftIn(5);                                    // a real covered stoop, not a slab
      e.roofType = style.roofShape === 'shed' ? 'shed' : 'flat';  // flat canopy reads modern
      e.pillarStyle = 'square'; e.pillarSize = 6;           // two slim posts
      e.railing = false;
      frontEnt = e;
    }
    // A PORCH SWING + rear-deck FURNITURE are added LATER (in applyBackyard, after
    // the garage _gen sweep) by reading lvl.entrances — so they aren't wiped. Mark
    // the front porch as swing-eligible for that pass.
    if (frontEnt && frontEnt.roofType !== 'none' && (frontEnt.width || 0) >= ftIn(9)) frontEnt._wantSwing = true;

    // ---- REAR entrance at the slider (covered patio / WOOD DECK / plain landing) ----
    const zone = plan.rooms.find((r) => (r.kind === 'dining' || r.kind === 'living') && r.open &&
      onLoop(fp.edges, 'h', r.v1, r.u0, r.u1) && (r.u1 - r.u0) >= ftIn(8));
    const hasSlider = zone && model.levels[0].walls.some((wl) =>
      (wl.openings || []).some((o) => o.kind === 'door' && o.doorType === 'slider'));
    if (zone && hasSlider) {
      const ru = snap(clamp((zone.u0 + zone.u1) / 2, FR.u0 + 48, FR.u1 - 48));
      const outBack = { x: frame.ey.x, y: frame.ey.y };
      // HILLS/DECKS A1: on a slope, a raised WOOD DECK (on posts, ABOVE grade, never
      // cutting into the terrain) — BIG + furniture-workable (target ≥ 12'×16' when
      // the zone allows). Flat lot keeps the covered-patio / concrete-landing default.
      if (onHill) {
        const wantW = Math.max(ftIn(16), Math.min(zone.u1 - zone.u0, ftIn(20)));   // ≥16' wide
        const deckW = snap(clamp(wantW, ftIn(12), FR.u1 - FR.u0 - 24));
        const re = addEntrance(lvl, toW(ru, zone.v1), outBack, style, 'patio', deckW, { landing: 'wood', deeper: true });
        re.depth = ftIn(12);        // ≥12' deep → furniture-workable rear deck
        re.railing = true;          // a raised deck needs a guard
        re.roofType = style.porch !== 'none' ? re.roofType : 'none';   // cover only for porch styles
        re._wantDeckFurniture = true;   // furnished later (post garage-sweep) in applyBackyard
        re.doorHalf = ftIn(3);          // keep the 72" slider walkway clear of cover posts
      } else {
        const covered = style.porch !== 'none' && rng() < 0.6;   // patio for the porch styles
        const re = addEntrance(lvl, toW(ru, zone.v1), outBack, style, covered ? 'patio' : 'landing', snap(ftIn(10)));
        if (!covered) { re.roofType = 'none'; re.railing = false; }
        // OPENING half-width behind this rear entrance (the 72" slider it centers on).
        // The cover/trellis post solvers keep this ± 18" clear so no post lands in the
        // walkway from the slider to the patio (Steve: "a post dead center on the back").
        re.doorHalf = ftIn(3);   // 72" slider → 36" half
        // TRELLIS over the rear CONCRETE PATIO (Steve, Jul 5): a flat-lot rear entrance
        // is the concrete-patio kind (never the raised wood deck — that's the onHill
        // branch above). Auto-cover it with an open 2x6 PERGOLA (entrance.roofType
        // 'trellis', ~72-96" projection) for the modern/ranch/craftsman styles — the
        // ones that read right with a pergola. Overrides both the 'none' landing and a
        // solid patio cover: a rear concrete patio gets a trellis, not a hip/gable roof.
        const lbl = (style.label || '').toLowerCase();
        const trellisStyle = /modern|ranch|craftsman/.test(lbl);
        if (trellisStyle && re.landing === 'concrete') {
          re.roofType = 'trellis';
          // BIGGER TRELLIS (Steve Jul 5): scale the pergola with the rear patio — a big
          // rear slider/zone gets a deep (up to 120" / 10') pergola covering a wide span
          // (up to ~16'), with heavier members (handled in _buildTrellisRoof). A small
          // zone stays modest. Projection scales with the zone width.
          const zoneW = zone.u1 - zone.u0;
          // deeper pergola for a wider rear zone: ≥12' zone → 10' deep, ≥10' → 9', else 8'.
          re.depth = snap(clamp(zoneW >= ftIn(12) ? ftIn(10) : zoneW >= ftIn(10) ? ftIn(9) : ftIn(8), ftIn(6), ftIn(10)));
          re.width = snap(clamp(re.width || zoneW, ftIn(8), ftIn(16)));   // cover the patio zone, up to 16'
          re.trellisHeavy = zoneW >= ftIn(12) || re.depth >= ftIn(9);     // 4x6 beam / 2x8 rafter look
          re.railing = false;         // an at-grade concrete patio needs no guard
        }
      }
    }
  };

  const addEntrance = (lvl, pos, outN, style, kind, width, o) => {
    o = o || {};
    const e = HA.makeEntrance(pos.x, pos.y, outN);
    e.preset = kind === 'full' ? 'porch' : 'small';
    e.width = width || (kind === 'full' ? ftIn(14) : 72);
    e.depth = kind === 'full' || kind === 'patio' ? (o.deeper ? 8 * 12 : 7 * 12) : 6 * 12;
    e.roofType = style.roofShape === 'hip' ? 'hip' : style.roofShape === 'shed' ? 'shed' : 'gable';
    e.pillarStyle = style.label.toLowerCase().indexOf('craftsman') >= 0 ? 'tapered' : 'square';
    e.pillarSize = kind === 'full' ? 7 : 5.5;
    e.railing = kind === 'full';
    // HILLS/DECKS A1: 'wood' = a raised platform on posts (rides ABOVE grade — the
    // existing entrance/deck 3D system posts it up; it NEVER cuts into terrain). A
    // wood deck always gets a guard rail (code) when it's a real platform.
    e.landing = (o.landing === 'wood') ? 'wood' : 'concrete';
    e.material = (e.landing === 'wood') ? 'deck_cedar' : 'concrete';
    if (e.landing === 'wood') e.railing = true;
    lvl.entrances.push(e);
    return e;
  };

  /* ===================== UNDER-ROOF PORCH ENGINE (Steve: rear covered porches UNDER
     the roof line + "turn a room into a covered porch") =====================
     Representation (see model.js HA.isPorchOpen): the porch footprint stays INSIDE the
     exterior loop, so HA.buildRoof — which reads only the loop — continues the MAIN
     roof over it UNCHANGED. The porch's loop-side edges keep their ext2x6 walls but get
     flagged porchOpen → view3d/framing draw 6x6 posts + a beam at plate height instead
     of a solid wall. The porch's interior-side edges are int2x6 walls (NOT ext — so
     they never corrupt the loop tracer), one carrying a slider from the house. The
     ceiling lid at plate height already spans the porch → a flat finished soffit. The
     floor renderer holes the finish floor over lvl._porches[] + lays a stepped slab. */

  // Mark the EXTERIOR wall collinear with (and overlapping) the world segment P0→P1 as
  // porch-OPEN over that span, along the WALL's own direction (rotation-safe — parcels
  // can be rotated, so world walls are not global-axis-aligned). The wall is NEVER split
  // — it stays ONE loop wall (so the roof solver's loop is byte-identical); only a
  // porchSpan sub-range is flagged, and openings that fall on the open span are dropped
  // (it's open air now). Returns the wall, or null when no exterior wall lies on the edge
  // (→ that edge stays a normal interior boundary).
  const openExtSpan = (model, li, P0, P1) => {
    const lvl = model.levels[li];
    if (U.dist(P0, P1) < 24) return null;
    const segDir = U.norm(U.sub(P1, P0));
    const TOL = 5;
    for (const w of lvl.walls) {
      if (!HA.isExt(w) || HA.isPorchOpen(w)) continue;
      const a = HA.wallA(w), b = HA.wallB(w), wLen = HA.wallLen(w);
      if (wLen < 6) continue;
      const wDir = U.norm(U.sub(b, a));
      if (Math.abs(U.cross(wDir, segDir)) > 0.03) continue;      // not parallel
      if (Math.abs(U.cross(wDir, U.sub(P0, a))) > TOL) continue; // P0 off the wall's line
      const t0 = U.dot(U.sub(P0, a), wDir), t1 = U.dot(U.sub(P1, a), wDir);
      const o0 = Math.max(0, Math.min(t0, t1)), o1 = Math.min(wLen, Math.max(t0, t1));
      if (o1 - o0 < 24) continue;                                // meaningful overlap only
      // drop any opening whose center falls on the now-open span
      w.openings = (w.openings || []).filter((o) => !(o.pos > o0 - 1 && o.pos < o1 + 1));
      // whole wall open → porchOpen; a sub-span → porchSpan (keeps the solid remainder)
      if (o0 <= 2 && o1 >= wLen - 2) w.porchOpen = true;
      else w.porchSpan = [o0, o1];
      return w;
    }
    return null;
  };

  // an interior porch-boundary wall (int2x6 — NOT ext, so the loop stays valid), with
  // an optional opening (the slider from the house onto the porch).
  const addPorchIntWall = (model, li, P0, P1, opening) => {
    const lvl = model.levels[li];
    if (U.dist(P0, P1) < 12) return null;
    const w = HA.makeWall(P0.x, P0.y, P1.x, P1.y, 'int2x6', model.settings);
    w.height = lvl.height || w.height;
    // The porch's interior boundary is the OLD exterior wall of the house — a BEARING
    // wall carrying the ceiling/roof AND the thermal-envelope edge, so it ALWAYS keeps
    // a continuous footing under it (Steve). Flag it so the foundation renderer + plan
    // draw that footing (thickened slab edge on slab houses; stem+footing on raised).
    w.porchBearing = true;
    if (opening) w.openings.push(opening);
    lvl.walls.push(w);
    // R21 Q3: this wall lands AFTER the window pass, so its endpoints create
    // fresh TEES into existing (mostly exterior) walls. Any window/door whose
    // span straddles the new junction is now unbuildable — the porch wall
    // would frame straight through the glass. Drop it (the porch face keeps
    // its own opening set).
    const wd = HA.wallDir(w);
    for (const P of [P0, P1]) {
      for (const w2 of lvl.walls) {
        if (w2 === w || (HA.isLow && HA.isLow(w2)) || !(w2.openings || []).length) continue;
        const d2 = HA.wallDir(w2);
        if (Math.abs(d2.x * wd.x + d2.y * wd.y) > 0.2) continue;   // only true perpendicular tees
        const a2 = HA.wallA(w2), wl2 = HA.wallLen(w2);
        const off = Math.abs(-(P.x - a2.x) * d2.y + (P.y - a2.y) * d2.x);
        if (off > 4) continue;
        const t = (P.x - a2.x) * d2.x + (P.y - a2.y) * d2.y;
        if (t <= 2 || t >= wl2 - 2) continue;
        w2.openings = w2.openings.filter((o) => !(t > o.pos - o.width / 2 + 1 && t < o.pos + o.width / 2 - 1));
      }
    }
    return w;
  };

  // clear porch-footprint furniture, stamp a 'Porch' room label, record the porch rect.
  const finishPorch = (model, li, rect, opts) => {
    opts = opts || {};
    const lvl = model.levels[li];
    const cx = (rect.x0 + rect.x1) / 2, cy = (rect.y0 + rect.y1) / 2;
    let label = null;
    lvl.fixtures = (lvl.fixtures || []).filter((f) => {
      const inside = f.x > rect.x0 + 2 && f.x < rect.x1 - 2 && f.y > rect.y0 + 2 && f.y < rect.y1 - 2;
      if (!inside) return true;
      if (f.type === 'room_label' && !label) { label = f; return true; }  // reuse one label
      return false;                                                        // drop furniture + extra labels
    });
    if (label) { label.text = 'Porch'; label.x = cx; label.y = cy; label.garage = false; }
    else { const l = HA.makeFixture('room_label', cx, cy, 0); l.text = 'Porch'; lvl.fixtures.push(l); }
    lvl._porches = lvl._porches || [];
    // FLOOR SYSTEM (Steve: "use our deck framing logic tools as an option for this
    // room"). SLAB houses → a concrete porch slab poured MONOLITHIC with the house
    // slab (default 'slab'). RAISED houses → a WOOD DECK by default (ledger on the
    // house band, joists, beam on the porch posts) — a concrete slab floating over
    // the crawlspace would be an odd island. Caller may pin either via opts.floor.
    const raised = !!(model.foundation && model.foundation.type === 'raised');
    const floor = (opts.floor === 'slab' || opts.floor === 'deck') ? opts.floor
      : (opts.deck ? 'deck' : (raised ? 'deck' : 'slab'));
    lvl._porches.push({ x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1,
      drop: HA.PORCH_FLOOR_DROP || 4, deck: floor === 'deck', floor });
  };

  // GENERATOR pass (single story only): a seeded ~42% share of 1-story plans get a REAR
  // covered porch carved from the open great-room's back corner, under the main roof.
  const applyRearPorch = (model, plan, fp, frame, style, opts) => {
    if (!model.levels || model.levels.length !== 1) return null;   // 1-story only (roof over it)
    if (opts.underRoofPorch === 'off') return null;
    // covered porches read right on TRADITIONAL styles (ranch/farmhouse/craftsman/
    // cottage); the modern/mono big-glass styles want an open rear GLASS wall, not a
    // porch — skip them so their window-wall stays intact.
    if (style && (style.mono || style.bigGlass)) return null;
    const li = 0, lvl = model.levels[li];
    const forced = opts.porch === 'porch' || opts.underRoofPorch === 'on';
    const rp = mulberry32(((opts.seed >>> 0) ^ 0x706f7263) >>> 0);  // independent seed stream
    if (!forced && rp() >= 0.42) return null;
    const toW = frame.toWorld;
    // rear open zone on the back loop edge, big enough to carve a porch from.
    const zone = plan.rooms.find((r) => (r.kind === 'living' || r.kind === 'dining') && r.open &&
      onLoop(fp.edges, 'h', r.v1, r.u0, r.u1) && (r.u1 - r.u0) >= ftIn(15) && (r.v1 - r.v0) >= ftIn(14));
    if (!zone) return null;
    const zoneW = zone.u1 - zone.u0, zoneD = zone.v1 - zone.v0;
    // corner porch: 7-9' deep, 10-13' wide (a real usable covered porch that doesn't eat
    // the whole great room). Kept modest so a furnishable LEG of the room survives.
    let D = snap(clamp(ftIn(7) + rp() * ftIn(2), ftIn(7), Math.min(ftIn(9), zoneD - ftIn(7))));
    let W = snap(clamp(ftIn(10) + rp() * ftIn(3), ftIn(10), Math.min(ftIn(13), zoneW - ftIn(9))));
    if (D < ftIn(7) || W < ftIn(10)) return null;
    const leftExt = onLoop(fp.edges, 'v', zone.u0, zone.v0, zone.v1);
    const rightExt = onLoop(fp.edges, 'v', zone.u1, zone.v0, zone.v1);
    // Anchor the porch in a rear corner — prefer a corner whose SIDE is also on the loop
    // (two open sides, a proper wrap corner); else a seeded side. The porch's French door
    // becomes the rear yard access (it consumes the centered rear slider placed earlier).
    let left;
    if (leftExt && !rightExt) left = true;
    else if (rightExt && !leftExt) left = false;
    else left = rp() < 0.5;
    let pu0, pu1;
    if (left) { pu0 = zone.u0; pu1 = zone.u0 + W; }
    else { pu1 = zone.u1; pu0 = zone.u1 - W; }
    pu0 = snap(pu0); pu1 = snap(pu1);
    const pv0 = snap(zone.v1 - D), pv1 = snap(zone.v1);
    if (pu1 - pu0 < ftIn(10) || pv1 - pv0 < ftIn(7)) return null;
    // FURNISHABILITY GUARD: after the corner is removed the great room becomes an L. Auto-
    // arrange needs a rectangle — the larger of the FRONT strip (full width × reduced
    // depth) or the SIDE leg (reduced width × full depth). Keep whichever has the bigger
    // minimum dimension; if NEITHER leaves a ~10' furnishable rect, skip the porch (an
    // honest "the room is too small to give up a porch"). Computed BEFORE any mutation.
    const frontStrip = { u0: zone.u0, v0: zone.v0, u1: zone.u1, v1: pv0 };
    const sideLeg = left ? { u0: pu1, v0: zone.v0, u1: zone.u1, v1: zone.v1 }
      : { u0: zone.u0, v0: zone.v0, u1: pu0, v1: zone.v1 };
    const minDim = (r) => Math.min(r.u1 - r.u0, r.v1 - r.v0);
    const bestLeg = minDim(frontStrip) >= minDim(sideLeg) ? frontStrip : sideLeg;
    if (minDim(bestLeg) < ftIn(9)) return null;
    // classify each edge: on the loop → OPEN (posts+beam); else → interior wall.
    const backOpen = onLoop(fp.edges, 'h', pv1, pu0, pu1);
    const leftEdgeOpen = onLoop(fp.edges, 'v', pu0, pv0, pv1);
    const rightEdgeOpen = onLoop(fp.edges, 'v', pu1, pv0, pv1);
    if (!backOpen && !leftEdgeOpen && !rightEdgeOpen) return null; // not an edge zone → bail
    // world corners
    const wBL = toW(pu0, pv0), wBR = toW(pu1, pv0), wTL = toW(pu0, pv1), wTR = toW(pu1, pv1);
    // OPEN edges → posts+beam
    let opened = 0;
    if (backOpen && openExtSpan(model, li, wTL, wTR)) opened++;
    if (leftEdgeOpen && openExtSpan(model, li, wBL, wTL)) opened++;
    if (rightEdgeOpen && openExtSpan(model, li, wBR, wTR)) opened++;
    if (!opened) return null;
    // INTERIOR edges → int2x6 walls. The FRONT (house-facing) wall carries the porch
    // door: a HINGED glass-lite (French-style) door — NOT a full-glass slider on an
    // interior wall (the generator forbids interior glass sliders / accordions).
    // a STANDARD 36" hinged glass-lite door (not a wide French unit — a wide swing zone
    // fouls the auto-arranged seating), swinging OUT onto the empty porch.
    const porchDoor = HA.makeDoor(U.dist(wBL, wBR) / 2, 36, { doorType: 'hinged', style: 'glass', panels: 1, handle: 'lever', swing: 'out' });
    addPorchIntWall(model, li, wBL, wBR, porchDoor);
    if (!leftEdgeOpen) addPorchIntWall(model, li, wBL, wTL, null);
    if (!rightEdgeOpen) addPorchIntWall(model, li, wBR, wTR, null);
    // porch world AABB + finish (label / furniture clear / record)
    const xs = [wBL.x, wBR.x, wTL.x, wTR.x], ys = [wBL.y, wBR.y, wTL.y, wTR.y];
    const rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    finishPorch(model, li, rect, {});
    // record on the plan for _genZones + the reroll stamp
    plan.rooms.push({ name: 'Porch', kind: 'porch', u0: pu0, v0: pv0, u1: pu1, v1: pv1, open: false });
    // SHRINK the great-room's furnishable rect (model._genRooms — the arrange designer's
    // source) to the chosen furnishable LEG so auto-arrange centers the sofa/rug/coffee
    // CLEAR of the open porch. plan.rooms is left intact so applyPorch still finds the
    // rear slider/zone. The remaining L strip beside the porch is unfurnished floor.
    const gr = (model._genRooms && model._genRooms[li] || []).find((r) => r.name === zone.name);
    if (gr) {
      const c = [toW(bestLeg.u0, bestLeg.v0), toW(bestLeg.u1, bestLeg.v0), toW(bestLeg.u1, bestLeg.v1), toW(bestLeg.u0, bestLeg.v1)];
      gr.x0 = Math.min(...c.map((p) => p.x)); gr.y0 = Math.min(...c.map((p) => p.y));
      gr.x1 = Math.max(...c.map((p) => p.x)); gr.y1 = Math.max(...c.map((p) => p.y));
      gr._porchShrunk = true;   // this great room gave floor to a porch → smaller furnishing target
    }
    return rect;
  };

  // non-mutating probe: is there an exterior wall collinear with + overlapping this
  // world edge? (used to classify a room's edges before converting it to a porch).
  const _extWallOnEdge = (model, li, P0, P1) => {
    const lvl = model.levels[li];
    if (U.dist(P0, P1) < 24) return null;
    const segDir = U.norm(U.sub(P1, P0));
    for (const w of lvl.walls) {
      if (!HA.isExt(w) || HA.isPorchOpen(w)) continue;
      const a = HA.wallA(w), b = HA.wallB(w), wLen = HA.wallLen(w);
      if (wLen < 6) continue;
      const wDir = U.norm(U.sub(b, a));
      if (Math.abs(U.cross(wDir, segDir)) > 0.03) continue;
      if (Math.abs(U.cross(wDir, U.sub(P0, a))) > 5) continue;
      const t0 = U.dot(U.sub(P0, a), wDir), t1 = U.dot(U.sub(P1, a), wDir);
      const o0 = Math.max(0, Math.min(t0, t1)), o1 = Math.min(wLen, Math.max(t0, t1));
      if (o1 - o0 >= 24) return w;
    }
    return null;
  };

  /* HA.generator.roomToPorch(model, li, roomRefOrRect) — convert an eligible EDGE room
     (touches the exterior on 1-2 sides) into an under-roof covered porch: its exterior
     walls open to posts+beam, interior separations stay (with their doors), the floor
     steps down, fixtures clear + it relabels 'Porch'. roomRefOrRect may be a world rect
     {x0,y0,x1,y1}, a {pts:[...]} zone, or a room name/kind string. Fail-soft: returns
     { ok:false, reason } on an interior room, a room-with-a-floor-above (2-story), or an
     unresolved ref — never throws, never half-converts. */
  const roomToPorch = (model, li, roomRefOrRect) => {
    li = li || 0;
    if (!model || !model.levels || !model.levels[li]) return { ok: false, reason: 'no such level' };
    if (li < model.levels.length - 1)
      return { ok: false, reason: 'only the top story can become an open porch — a room with a floor above it cannot be roofed open' };
    const lvl = model.levels[li];
    // resolve a world rect from the ref
    let rect = null;
    const R = roomRefOrRect;
    if (R && isFinite(R.x0) && isFinite(R.x1)) {
      rect = { x0: Math.min(R.x0, R.x1), y0: Math.min(R.y0, R.y1), x1: Math.max(R.x0, R.x1), y1: Math.max(R.y0, R.y1) };
    } else if (R && Array.isArray(R.pts)) {
      const xs = R.pts.map((p) => (Array.isArray(p) ? p[0] : p.x)), ys = R.pts.map((p) => (Array.isArray(p) ? p[1] : p.y));
      rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    } else if (typeof R === 'string') {
      const name = R.trim().toLowerCase();
      const z = (lvl._genZones || []).find((q) => (q.name || '').toLowerCase() === name || (q.kind || '').toLowerCase() === name);
      if (z && z.pts) { const xs = z.pts.map((p) => p[0]), ys = z.pts.map((p) => p[1]); rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }
      else { const g = ((model._genRooms && model._genRooms[li]) || []).find((r) => (r.name || '').toLowerCase() === name || (r.kind || '').toLowerCase() === name);
        if (g) rect = { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 }; }
    }
    if (!rect || !(rect.x1 - rect.x0 > 24) || !(rect.y1 - rect.y0 > 24)) return { ok: false, reason: 'could not resolve that room' };
    // classify the 4 axis-aligned edges (world) — how many are on the exterior?
    const edges = [
      [{ x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 }],
      [{ x: rect.x0, y: rect.y1 }, { x: rect.x1, y: rect.y1 }],
      [{ x: rect.x0, y: rect.y0 }, { x: rect.x0, y: rect.y1 }],
      [{ x: rect.x1, y: rect.y0 }, { x: rect.x1, y: rect.y1 }],
    ];
    const extEdges = edges.filter(([a, b]) => _extWallOnEdge(model, li, a, b));
    if (extEdges.length === 0) return { ok: false, reason: 'that room is interior — it has no exterior wall to open into a porch' };
    if (extEdges.length > 2) return { ok: false, reason: 'that room touches the exterior on ' + extEdges.length + ' sides — too exposed to roof as an open porch' };
    let opened = 0;
    for (const [a, b] of extEdges) if (openExtSpan(model, li, a, b)) opened++;
    if (!opened) return { ok: false, reason: 'no exterior wall could be opened on that room' };
    // FLAG the interior boundary walls (conditioned↔porch separations) as BEARING so
    // the foundation keeps a continuous footing under the old exterior wall line that
    // now sits inside the porch (Steve). Any solid wall coincident with a rect edge
    // that was NOT opened is a house-side separation.
    const _wallOnEdge = (a, b) => {
      const segDir = U.norm(U.sub(b, a));
      for (const w of lvl.walls) {
        if (HA.isPorchOpen(w) || HA.isLow(w)) continue;
        const wa = HA.wallA(w), wLen = HA.wallLen(w);
        if (wLen < 6) continue;
        const wDir = U.norm(U.sub(HA.wallB(w), wa));
        if (Math.abs(U.cross(wDir, segDir)) > 0.03) continue;
        if (Math.abs(U.cross(wDir, U.sub(a, wa))) > 5) continue;
        const t0 = U.dot(U.sub(a, wa), wDir), t1 = U.dot(U.sub(b, wa), wDir);
        if (Math.min(wLen, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) >= 24) w.porchBearing = true;
      }
    };
    for (const [a, b] of edges) if (!extEdges.some(([ea, eb]) => ea === a && eb === b)) _wallOnEdge(a, b);
    finishPorch(model, li, rect, roomRefOrRect && roomRefOrRect.floor ? { floor: roomRefOrRect.floor } : {});
    return { ok: true, opened, rect };
  };

  /* HILLS/DECKS A5: a porch SWING hung on a covered front porch. A yarditem 'swing'
     dropped near the porch's house-side, centered on the porch width, tagged _gen so
     regen replaces it. Uses the entrance geometry so it sits ON the porch. */
  const addPorchSwing = (model, ent) => {
    try {
      if (!HA.sitefeatures || !HA.sitefeatures.yardItem || !HA.entranceGeom) return;
      const g = HA.entranceGeom(ent); if (!g || !g.out) return;
      if (HA.ensureSite) HA.ensureSite(model);
      const feats = model.site.features || (model.site.features = []);
      // ORIENTATION TRUTH (Steve addendum): back to the house wall, FACING OUT —
      // SF.faceRot(out) is the exact outward facing (the old +90° formula turned the
      // swing to face INTO the house). Offset to the SIDE of the door so it never
      // blocks the door swing / stair top; 20" off the wall seats its back at the wall.
      // slide toward a porch end but stay clear of the corner POST (posts sit ~6"
      // inset from the end; swing half 30" + 6" post clearance → cap at hw−42).
      const off = Math.min(Math.max(0, g.hw - 42), 54);
      const sx = ent.pos.x + g.along.x * off + g.out.x * 20;
      const sy = ent.pos.y + g.along.y * off + g.out.y * 20;
      const rot = HA.sitefeatures.faceRot
        ? HA.sitefeatures.faceRot(g.out.x, g.out.y)
        : Math.atan2(-g.out.x, g.out.y) * 180 / Math.PI;
      const sw = HA.sitefeatures.yardItem('swing', sx, sy, { rot });
      sw._gen = true; sw.backyard = true; sw.porch = true;
      feats.push(sw);
    } catch (e) { /* best-effort */ }
  };

  /* HILLS/DECKS A5: patio/deck FURNITURE on a large rear deck — a dining set + a
     pair of loungers, placed on the deck, tagged _gen. The auto-backyard also
     furnishes the yard; this covers the deck surface specifically. */
  const addDeckFurniture = (model, ent) => {
    try {
      if (!HA.sitefeatures || !HA.sitefeatures.yardItem || !HA.entranceGeom) return;
      const g = HA.entranceGeom(ent); if (!g || !g.out || !g.along) return;
      if ((ent.width || 0) < ftIn(10)) return;   // only a genuinely large deck
      if (HA.ensureSite) HA.ensureSite(model);
      const feats = model.site.features || (model.site.features = []);
      // ORIENTATION TRUTH: deck dining faces along the deck (chairs are built into
      // the set facing the table); the lounge faces the OPEN YARD (its focal point),
      // not sideways — both via SF.faceRot on real world directions.
      const SFm = HA.sitefeatures;
      const faceOut = SFm.faceRot ? SFm.faceRot(g.out.x, g.out.y) : 0;
      const mid = { x: ent.pos.x + g.out.x * (ent.depth * 0.5), y: ent.pos.y + g.out.y * (ent.depth * 0.5) };
      const off = Math.min((ent.width || 0) * 0.28, ftIn(5));
      const dining = SFm.yardItem('dining', mid.x - g.along.x * off, mid.y - g.along.y * off, { rot: faceOut });
      const lounge = SFm.yardItem('lounge', mid.x + g.along.x * off, mid.y + g.along.y * off, { rot: faceOut });
      for (const f of [dining, lounge]) { f._gen = true; f.backyard = true; f.onDeck = true; feats.push(f); }
    } catch (e) { /* best-effort */ }
  };

  /* ---------- FOUNDATION (hillside) ---------- */
  const applyFoundation = (model, fp, frame, mode, style) => {
    const toW = frame.toWorld;
    const FR = fp.rect;
    const corners = [toW(FR.u0, FR.v0), toW(FR.u1, FR.v0), toW(FR.u1, FR.v1), toW(FR.u0, FR.v1)];
    let heights = [];
    if (HA.terrain && typeof HA.terrain.heightAtInches === 'function') {
      for (const c of corners) {
        const h = HA.terrain.heightAtInches(model, c.x, c.y);
        if (h != null && isFinite(h)) heights.push(h);
      }
    }
    const fnd = model.foundation || (model.foundation = {});
    fnd.enabled = true;
    if (heights.length >= 2) {
      const delta = Math.max(...heights) - Math.min(...heights);
      if (delta > 30 && mode !== 'adu') {
        fnd.type = 'basement'; fnd.basementDepth = 96; fnd.stemHeight = 24;
        return;
      } else if (delta >= 12) {
        fnd.type = 'raised'; fnd.stemHeight = clamp(snap(delta), 24, 36);
        return;
      }
    }
    /* flat / no terrain: style default.
       R67 — NARROW-LOT ENTRANCE HEIGHT (Steve: "your thinner lots do the front
       entrance but its usually a little too high"). Measured before: EVERY lot
       width, 30ft through 60ft, came out raised/18" — a 3-riser stoop. On a wide
       house with a 14-20ft porch that reads fine; on a narrow facade the entrance
       is clamped to a ~8ft stoop by the centered-facade rule in applyPorch, and an
       18" podium under an 8ft stoop is what reads TOO HIGH.
       A narrow entry-level house on flat ground is a SLAB product anyway (this is
       literally D.R. Horton's narrow-lot spec), so a narrow footprint takes the
       same slab/8" path the long-low ranch and the ADU already take — 8" is one
       riser, not three. Nothing new is invented; it is an existing, tested
       foundation configuration.
       HILLS ARE UNTOUCHED — the terrain branches above RETURN before here, so the
       raised/basement entries on a slope (Steve: "the entrances look cool on
       hills though") keep exactly the stem they had. */
    const narrowFootprint = (FR.u1 - FR.u0) <= ftIn(34);
    if (style.longLow || mode === 'adu' || narrowFootprint) { fnd.type = 'slab'; fnd.stemHeight = 8; }
    else { fnd.type = 'raised'; fnd.stemHeight = 18; }
  };

  /* ---------- GARAGE: fire separation (CRC R302.6) + slab + driveway ----------
     - R302.6: the garage↔dwelling common wall(s) get wall.fireSep + a 5/8" Type X
       gypsum layer, via the EXISTING (tested) HA.assemblies.applyGarageProtection —
       which finds the separation walls from the 'GARAGE' room label + adjacency.
       The man-door from the garage into the house is retagged 20-min self-closing.
     - the garage slab sits ~4" below the house finish floor (real detail; stored on
       the garage room label fixture for the section/detail systems to read).
     - the driveway extends from the garage overhead door to the front lot line via
       the EXISTING HA.sitefeatures driveway (auto-snaps to the widest garage door). */
  const applyGarage = (model, plan, fp, frame, garageInfo, opts) => {
    // 1) R302.6 fire separation — reuse the assemblies engine (defensive: the
    // headless test harness may not load assemblies.js)
    let sep = { count: 0, wallIds: [] };
    try {
      if (HA.assemblies && HA.assemblies.applyGarageProtection)
        sep = HA.assemblies.applyGarageProtection(model) || sep;
    } catch (e) { sep = { count: 0, wallIds: [] }; }
    model._genGarage = { kind: garageInfo.kind, side: garageInfo.side, project: garageInfo.project, fireSepWalls: sep.count };

    // 2) man-door garage→house = 20-min self-closing solid door (never into a
    // sleeping room; connectivity already picked a service/circulation room). Tag
    // ONLY the door(s) on the GARAGE room's own perimeter (the true garage↔dwelling
    // openings) — not every door that happens to share a fireSep exterior wall.
    const lvl = model.levels[0];
    const gr = plan.rooms.find((r) => r.kind === 'garage');
    let gx0, gy0, gx1, gy1, manDoor = null;
    if (gr) {
      // garage rect in WORLD (axis-aligned corners)
      const a = frame.toWorld(gr.u0, gr.v0), b = frame.toWorld(gr.u1, gr.v1);
      gx0 = Math.min(a.x, b.x); gx1 = Math.max(a.x, b.x); gy0 = Math.min(a.y, b.y); gy1 = Math.max(a.y, b.y);
      const gcx = (gx0 + gx1) / 2, gcy = (gy0 + gy1) / 2;
      const onGaragePerim = (wx, wy) => {
        const nearU = (Math.abs(wx - gx0) < 8 || Math.abs(wx - gx1) < 8) && wy > gy0 - 8 && wy < gy1 + 8;
        const nearV = (Math.abs(wy - gy0) < 8 || Math.abs(wy - gy1) < 8) && wx > gx0 - 8 && wx < gx1 + 8;
        return nearU || nearV;
      };
      for (const w of lvl.walls || []) {
        if (garageInfo.adu) break;   // ADU corner garage: exterior access ONLY — its
        // person door is an exterior slab-level door, NOT a house↔garage man-door
        // (no 20-min tag, no manDoor record → no interior step flight).
        for (const o of w.openings || []) {
          if (o.kind !== 'door' || o.doorType === 'garage') continue;
          const d = HA.wallDir(w);
          const wx = w.x1 + d.x * o.pos, wy = w.y1 + d.y * o.pos;
          if (onGaragePerim(wx, wy)) {
            o.fireRating = 20; o.selfClosing = true; o.style = o.style || 'flush';
            // this IS the house↔garage man-door: record its WORLD point + the wall
            // NORMAL pointing OUT of the garage (toward the house side) so the step
            // flight (HA.garageStepFlight) descends into the garage off it. Prefer a
            // door on the seam wall (the one facing the garage centroid).
            const n = { x: -d.y, y: d.x };                       // a wall normal
            const toHouse = (n.x * (gcx - wx) + n.y * (gcy - wy) <= 0) ? n : { x: d.y, y: -d.x };
            if (!manDoor) manDoor = { x: wx, y: wy, nx: toHouse.x, ny: toHouse.y };
          }
        }
      }
    }

    // 3) GARAGE SLAB ELEVATION (spec B): the garage floor sits floorDrop BELOW the
    // house finish floor — 8" on a slab house (curb between), ~18" on a raised
    // house (garage sits into grade). Stamp the truth on the garage room label so
    // HA.garageInfo / terrain pad / 3D floor / foundation step / steps / sections
    // all read ONE source. Store the WORLD rect as corner OFFSETS from the label
    // anchor so a moved house re-derives it (moveHouse translates the label).
    const gLabel = (lvl.fixtures || []).find((f) => f.type === 'room_label' && /garage/i.test(f.text || ''));
    if (gLabel) {
      const drop = (HA.garageDefaultDrop ? HA.garageDefaultDrop(model) : (model.foundation && model.foundation.type === 'raised' ? 18 : 8));
      gLabel.floorDrop = drop; gLabel.slab = true; gLabel.garage = true;
      if (gx0 != null) gLabel.garageRect = { dx0: gx0 - gLabel.x, dy0: gy0 - gLabel.y, dx1: gx1 - gLabel.x, dy1: gy1 - gLabel.y };
      // house→garage step props (spec C): concrete + straight out by default.
      gLabel.stepMaterial = 'concrete'; gLabel.stepDir = 'straight';
      // store the man-door as an OFFSET from the label anchor (like garageRect) so a
      // moved house re-derives it — moveHouse only translates the label x/y, not
      // nested absolute coords.
      if (manDoor) gLabel.manDoor = { dx: manDoor.x - gLabel.x, dy: manDoor.y - gLabel.y, nx: manDoor.nx, ny: manDoor.ny };
      // stamp resolved geometry for the site/terrain/driveway pipeline + tests.
      model._genGarage.floorDrop = drop;
      model._genGarage.slabY = -drop;
      if (gx0 != null) model._genGarage.rect = { x0: gx0, y0: gy0, x1: gx1, y1: gy1 };
      if (manDoor) model._genGarage.manDoor = manDoor;
    }

    // 4) DRIVEWAY from the garage door to the street (only when the site has a lot).
    // A1 (STACKING FIX): first STRIP every generator-created (_gen) site feature —
    // prior driveways aimed at a garage door that no longer exists after a regen —
    // so 🏠 Generate / 🎲 Random never piles "driveways on hella sides." User-drawn
    // features carry no _gen tag and are left untouched. A2 (ROUTING): the new drive
    // LEAVES the garage door (straight apron out the door normal) then doglegs to
    // meet the front lot line ~perpendicular (curb-cut), via HA.sitefeatures
    // .garageDriveway. Defensive: guarded on the module + a real lot.
    try {
      if (HA.ensureSite) HA.ensureSite(model);
      const feats = (model.site && model.site.features) || null;
      if (feats) {
        // remove all previously generated site features (driveways today; any future
        // _gen feature the generator emits) — never a user-drawn (untagged) feature.
        for (let i = feats.length - 1; i >= 0; i--) if (feats[i] && feats[i]._gen) feats.splice(i, 1);
        // LEGACY MIGRATION: builds before the _gen tag existed (rev 555) stacked
        // UNTAGGED driveways on every regen ("driveways on hella sides"). Those old
        // applyGarage drives carry an EXACT signature the manual Drive tool doesn't:
        // driveway:true + side + 8-vert poly + no centerline. On a model the GENERATOR
        // built (model._genOpts present), sweep that signature once here. Hand-drawn
        // plans and hand-drawn drives are never touched.
        if (model._genOpts) {
          for (let i = feats.length - 1; i >= 0; i--) {
            const f = feats[i];
            if (f && !f._gen && f.type === 'hardscape' && f.driveway === true && f.side !== undefined
                && Array.isArray(f.poly) && f.poly.length === 8 && !(f.centerline && f.centerline.length))
              feats.splice(i, 1);
          }
        }
      }
      const hasLot = model.site && Array.isArray(model.site.lot) && model.site.lot.length >= 3;
      if (hasLot && HA.sitefeatures && HA.sitefeatures.garageDriveway) {
        // pass style + seed so the driveway SURFACE (concrete / permeable / pavers) is
        // seeded + style-matched (model._genOpts isn't set yet at this point in generate).
        const drv = HA.sitefeatures.garageDriveway(model, { side: garageInfo.side, gen: true, style: opts.style, seed: opts.seed });
        if (drv) {
          const list = model.site.features || (model.site.features = []);
          if (list.indexOf(drv) < 0) list.push(drv);
          model._genGarage.driveway = true;
        }
      }
    } catch (e) { /* driveway is best-effort — never fail generation over it */ }
  };

  /* ============================================================
     MASSING-AWARE GABLE ASSIGNMENT  (Steve: "some walls that should be hip are
     not hip … architects mix designs — but it must be correct")

     The generator composes its footprint from axis-aligned rectangles: the MAIN
     house block, an optional attached GARAGE mass, and the primary-suite / wing
     BUMP (the L jog). HA.roofStyle's bbox heuristic gables ANY short wall — on an
     articulated L/T that gables jog/notch walls and pairs adjacent convex gables,
     which is exactly the documented roof-engine residual (a spike above the local
     ridge). Here we assign wall.gable DIRECTLY from the composed masses per real
     architectural vocabulary, honoring HARD CONSTRAINTS:

       C1 a gabled wall is a TRUE END wall — a full loop edge whose BOTH endpoints
          are CONVEX corners (the flat cap of a rectangular protrusion). Jog / notch
          / inside-corner walls (an endpoint at a concave corner) are NEVER gabled.
       C2 NEVER two gabled walls sharing a convex corner (the engine residual).
       C3 never gable a wall < 8 ft.
       C4 at least one wall PER AXIS stays hip/eave so the roof always builds.

     Style vocabulary (encoded below):
       farmhouse : gable BOTH main ends + the garage/wing outer end (all-gable).
       craftsman : gable the main ends + the STREET-FACING wing/garage end
                   (the front-gable craftsman signature).
       ranch     : HIP everything, except an optional single gable accent on the
                   garage/wing FRONT (seed-gated).
       cottage   : gable the main ends, HIP the wings (the hip-gable mix).
       modern    : hip (handled by roofShape 'hip' — falls through to the main-ends
                   rule, then C4 keeps it buildable; reads as a clean hip mass).
       modern-mono: shed (never reaches here).
     Operates in the LOCAL frame (exact 6" grid) on fp.loop, then maps each chosen
     END edge to the built L0 exterior wall by world midpoint. Sets wall.gable on
     the L0 loop; upper-level roofs (lower-roof engine) read their own gable flags,
     which we also stamp when an end edge belongs to an upper footprint. ==========*/
  /* per-side POP DEPTH of a rectilinear footprint (ROOF-POLICY-SPEC A): for each
     of the 4 facing directions, the gap between the loop's EXTREME line and its
     DOMINANT (longest-edge) line on that side. 0 on every side = FLUSH BOX (the
     roof passes straight over); anything > ~2ft = a POPPED wing/garage. Pure,
     world-or-frame pts ({x,y}); exposed for the policy tests + roofmatrix. */
  const popSide = (pts, nx, ny) => {
    if (!pts || pts.length < 4) return 0;
    let extreme = -Infinity, domC = null, domLen = -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const oN = U.edgeOutNormal(pts, i);
      if (oN.x * nx + oN.y * ny < 0.9) continue;          // edge not facing this way
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 12) continue;
      const c = a.x * nx + a.y * ny;                       // extent along the facing dir
      if (c > extreme) extreme = c;
      if (len > domLen) { domLen = len; domC = c; }
    }
    return (domC != null && extreme > -Infinity) ? extreme - domC : 0;
  };
  const popDepthOf = (pts) => Math.max(
    popSide(pts, 0, -1), popSide(pts, 0, 1), popSide(pts, -1, 0), popSide(pts, 1, 0));
  /* POPPED classification (calibrated on the generated massing): ONLY the
     STREET-VISIBLE front pop trips (>2ft) — the garage projecting forward is
     both the mess class Steve kept hitting AND the articulation he likes
     ("pokes out, great for surface areas"), so it takes the full-hip package.
     Side/rear articulation (the suite jog, the garage's own width beside the
     house — bbox-minus-notch shapes) is proven-safe massing (120-fixture
     junction sweep + C5/cone machinery) and keeps the style's gable character:
     that IS Steve's front-flush "box design" where the roof passes over. */
  // frontN: optional {x,y} unit FRONT direction (which way the house faces).
  // Defaults to -y (the FRAME convention — inside assignRoofGables the loop is in
  // frame coords where the front is always -v). WORLD-space callers on a lot with
  // a rotated frontEdge MUST pass the true front direction or popped rolls
  // misclassify as flush (live acceptance rig, frontEdge-2 lot: front faces +x).
  const massingPoppedOf = (pts, frontN) => {
    const fx = frontN && Number.isFinite(frontN.x) ? frontN.x : 0;
    const fy = frontN && Number.isFinite(frontN.y) ? frontN.y : -1;
    return popSide(pts, fx, fy) > 24;
  };

  /* plan-coverage of the BUILT main roof, % of footprint probe points with no
     slope face over them (boundary-tolerant). Cheap 18" grid — the gate only
     needs to catch CATASTROPHIC rolls (Steve's half-white roof), not slivers. */
  const roofCoveragePct = (model) => {
    const rd = HA.buildRoof(model);
    if (!rd || !rd.ok) return 100;
    const slopes = (HA.mergeRoofPlanes ? HA.mergeRoofPlanes(rd) : rd.faces).filter((f) => f.kind === 'slope');
    const lp = rd.loop;
    if (!lp || !lp.pts || lp.pts.length < 3) return 100;
    const distTo = (p, poly) => { let d = 1e9; for (let i = 0; i < poly.length; i++) d = Math.min(d, U.distToSeg(p, poly[i], poly[(i + 1) % poly.length])); return d; };
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of lp.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    let miss = 0, tot = 0;
    for (let x = minX + 4; x < maxX; x += 18) for (let y = minY + 4; y < maxY; y += 18) {
      const pt = { x, y };
      if (!U.pointInPoly(pt, lp.pts)) continue;
      tot++;
      if (!slopes.some((f) => f.poly2 && (U.pointInPoly(pt, f.poly2) || distTo(pt, f.poly2) < 0.5))) miss++;
    }
    return tot ? (100 * miss) / tot : 100;
  };
  /* the SELF-HEALING GATE (ROOF-POLICY-SPEC C): if the roll's roof fails plan
     coverage, fall back to hip-everything (clear every gable directive) and
     re-verify. Returns { pct, healed } for the policy tests. */
  const roofGate = (model) => {
    const pct = roofCoveragePct(model);
    if (pct <= 2) return { pct, healed: false };
    for (const lvl of model.levels) for (const w of (lvl.walls || [])) w.gable = false;
    try { if (HA.roofStyle && model.roof && model.roof.style === 'shed') HA.roofStyle(model, 'hip'); } catch (e) {}
    return { pct: roofCoveragePct(model), healed: true };
  };

  /* WORLD-SPACE gable sanity pass (C5b — Steve on craftsman s802951789: "just make
     this hip on the right … I see this shape often"). Frame-INDEPENDENT: runs on the
     FINAL wall.gable flags in WORLD coords, so it catches every assignment path. On a
     street-oriented (rotated-frame) real lot the frame's main/wing classification
     inverts and assignRoofGables stamps INVALID gables that the clean frontEdge-0 path
     never makes: a gable on the CONCAVE inner-corner NOTCH wall (→ a pop-up box) AND a
     gable on BOTH ends of a STEPPED bar whose two ridge heights fight (→ the raked
     transition plane). Two rules, both provably safe (they only ever REMOVE clearly
     invalid gables, never a legit convex single/opposite gable):
       C1  a gable belongs only on a TRUE end wall — BOTH its loop corners CONVEX.
       C4b two MAIN-axis ends (perpendicular to the ridge) gabled at DIFFERENT widths =
           a stepped bar; keep the NARROWEST-end gable, hip the rest. The narrow end's
           ridge is the LOW one — the wider sections hip up above it and meet in a clean
           valley; gabling the WIDE end instead forces its HIGH ridge to overrun the
           narrow section (a leftover gablet). On s802951789 this also hips the wide
           right end — exactly Steve's "make this hip on the right". */
  const hipBadGables = (model) => {
    for (let li = 0; li < model.levels.length; li++) {
      const lp = HA.exteriorLoop && HA.exteriorLoop(model, li);
      if (!lp || !lp.pts || lp.pts.length < 4) continue;
      const pts = lp.pts;
      let a2 = 0; for (let i = 0; i < pts.length; i++) { const A = pts[i], B = pts[(i + 1) % pts.length]; a2 += A.x * B.y - B.x * A.y; }
      const ccw = a2 > 0;
      const convexAt = (i) => { const p = pts[(i - 1 + pts.length) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length]; const cr = (c.x - p.x) * (n.y - c.y) - (c.y - p.y) * (n.x - c.x); return ccw ? cr > 0 : cr < 0; };
      const near = (A, B) => Math.abs(A.x - B.x) < 1.5 && Math.abs(A.y - B.y) < 1.5;
      const cornerIdx = (P) => { for (let i = 0; i < pts.length; i++) if (near(pts[i], P)) return i; return -1; };
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const ridgeAlongX = (x1 - x0) >= (y1 - y0);
      const mains = [];
      for (const w of (model.levels[li].walls || [])) {
        if (!w.gable || !(HA.isExt && HA.isExt(w))) continue;
        const i1 = cornerIdx({ x: w.x1, y: w.y1 }), i2 = cornerIdx({ x: w.x2, y: w.y2 });
        if (i1 < 0 || i2 < 0 || !convexAt(i1) || !convexAt(i2)) { w.gable = false; continue; }   // C1: not a true (both-convex) end
        const d = HA.wallDir(w), horiz = Math.abs(d.x) >= Math.abs(d.y);
        if (ridgeAlongX ? !horiz : horiz) mains.push({ w, width: horiz ? Math.abs(w.x2 - w.x1) : Math.abs(w.y2 - w.y1) });
      }
      if (mains.length >= 2) {
        let mn = Infinity, mx = -Infinity; for (const g of mains) { mn = Math.min(mn, g.width); mx = Math.max(mx, g.width); }
        if (mx - mn > GRID * 3) {   // >18" cross-width step between the two ends → keep the NARROWEST gable only
          mains.sort((p, q) => p.width - q.width);
          for (let k = 1; k < mains.length; k++) mains[k].w.gable = false;
        }
      }
    }
  };

  const assignRoofGables = (model, style, ctx) => {
    const { plan, fp, frame } = ctx;
    const loop = fp && fp.loop;
    if (!loop || loop.length < 4) { if (HA.roofStyle) HA.roofStyle(model, style.roofShape); return; }
    const toW = frame.toWorld;

    // ---- 1. loop bbox + ridge axis (long axis; matches HA.roofStyle) ----
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of loop) { u0 = Math.min(u0, p.u); u1 = Math.max(u1, p.u); v0 = Math.min(v0, p.v); v1 = Math.max(v1, p.v); }
    const spanU = u1 - u0, spanV = v1 - v0;
    const ridgeAlongU = spanU >= spanV;   // ridge runs along the longer footprint axis

    // ---- 2. loop edges + convex/concave corner classification ----
    // signed area tells winding; per-corner cross product then tells convex vs concave.
    let area2 = 0;
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; area2 += a.u * b.v - b.u * a.v; }
    const ccw = area2 > 0;
    const convexAt = (i) => {
      const p = loop[(i - 1 + loop.length) % loop.length], c = loop[i], n = loop[(i + 1) % loop.length];
      const cross = (c.u - p.u) * (n.v - c.v) - (c.v - p.v) * (n.u - c.u);
      return ccw ? cross > 0 : cross < 0;   // convex = a left turn on a CCW loop
    };
    // edge i connects corner i -> i+1
    const edges = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const horiz = Math.abs(a.v - b.v) < 0.5;    // const-v run (spans u) — an END wall for a U-ridge
      const len = Math.abs(horiz ? b.u - a.u : b.v - a.v);
      edges.push({
        i, a, b, horiz, len,
        c: horiz ? a.v : a.u,                        // the constant coordinate
        lo: horiz ? Math.min(a.u, b.u) : Math.min(a.v, b.v),
        hi: horiz ? Math.max(a.u, b.u) : Math.max(a.v, b.v),
        ai: i, bi: (i + 1) % loop.length,
        convexBoth: convexAt(i) && convexAt((i + 1) % loop.length),
      });
    }
    // inward normal of edge e (points INTO the footprint). For a CCW loop the
    // interior is on the LEFT of the a->b travel direction.
    const inwardN = (e) => {
      const dx = e.b.u - e.a.u, dy = e.b.v - e.a.v, L = Math.hypot(dx, dy) || 1;
      const n = ccw ? { u: -dy / L, v: dx / L } : { u: dy / L, v: -dx / L };
      return n;
    };
    // how DEEP the mass capped by this edge runs perpendicular to it (inches). March
    // inward from the edge midpoint until we leave the footprint. A true END wall caps
    // a mass that runs DEEPER than the wall is long (spans the short dimension) — this
    // is what makes a garage/wing FRONT (a cross-gable cap) an end wall even though it
    // runs parallel to the MAIN ridge.
    const inPoly = (u, v) => U.pointInPoly({ x: u, y: v }, loop.map((p) => ({ x: p.u, y: p.v })));
    const perpDepthAt = (e, frac) => {
      const n = inwardN(e);
      const mu = e.a.u + (e.b.u - e.a.u) * frac, mv = e.a.v + (e.b.v - e.a.v) * frac;
      let d = 0; const STEP = GRID, MAX = Math.max(spanU, spanV) + GRID;
      while (d < MAX) { const t = d + STEP / 2; if (!inPoly(mu + n.u * t, mv + n.v * t)) break; d += STEP; }
      return d;
    };
    const perpDepth = (e) => perpDepthAt(e, 0.5);
    // C5 (Steve: "gable-to-hip transition breaking on most designs where it pops
    // out" / "your L shape auto design roof is still messed up … should be hip in
    // the back on this one"): a gabled end wall must cap ONE mass that is at least as
    // DEEP as the wall is long, ALONG ITS WHOLE LENGTH. A COMPOUND end wall — one
    // spanning the deep MAIN mass AND a shallower pop-out wing / corner notch whose
    // depth drops BELOW the wall length — takes a gable whose ridge peak is set by the
    // FULL wall length yet cannot reach that height over the shallow strip: the ridge
    // can't run level, so the whole back half becomes ONE RAKED PLANE sweeping from the
    // over-tall gable peak down to the main ridge, with a notch/hole where the two
    // ridge heights fight (measured: farmhouse s262/craftsman s655 2-car, east cap 486"
    // long over a main mass 384" wide + a 300"-deep notched strip, gable peak z270 vs
    // main ridge z236). The old probe checked depth >= 0.6·len at the MIDPOINT only, so
    // a wing/notch step occupying < ~20% of the wall slipped past (the deep-mass
    // stations straddled it). Sample the capped-mass depth DENSELY and require the
    // MINIMUM depth to clear the wall length: a station shallower than the wall means
    // the mass steps down there, so the gable can't terminate level — hip it. A shallow
    // front-corner inset (cottage/wide vocabulary) leaves the mass FAR deeper than the
    // wall is long everywhere, so it stays comfortably above this bar and keeps its
    // gable.
    const uniformMass = (e) => {
      let mn = Infinity;
      for (let f = 0.1; f <= 0.9 + 1e-9; f += 0.1) { const d = perpDepthAt(e, f); if (d < mn) mn = d; }
      return mn >= e.len - GRID;
    };
    // ---- 3. candidate END walls: true caps only (C1 both-convex, C3 >=8ft), the
    // mass they cap must run at least as deep as the wall is long (span the short
    // dim), and be step-free through its core (C5 — no compound-mass end walls) ----
    const MIN_GABLE = ftIn(8);
    const cand = edges.filter((e) => e.convexBoth && e.len >= MIN_GABLE)
      .map((e) => { e.depth = perpDepth(e); return e; })
      .filter((e) => e.depth >= e.len - GRID)    // deeper-than-wide => a real gable end
      .filter(uniformMass);                       // C5: no gable across a major mass step

    // classify each candidate END: a MAIN end sits at the footprint's ridge-axis
    // extreme (the two ends of the dominant mass); everything else is a WING / GARAGE
    // outer cap (a cross-gable projecting toward the street or a suite bump).
    const ridgeMin = ridgeAlongU ? u0 : v0, ridgeMax = ridgeAlongU ? u1 : v1;
    // a MAIN end wall is perpendicular to the global ridge AND at a ridge extreme
    const isMainAxisEnd = (e) => (ridgeAlongU ? !e.horiz : e.horiz);
    for (const e of cand) {
      const pos = e.c;   // const coord; for a main-axis end this is its ridge position
      e.main = isMainAxisEnd(e) && (Math.abs(pos - ridgeMin) < 1 || Math.abs(pos - ridgeMax) < 1);
      // reaches the front edge (v ~ v0)
      e.frontish = Math.min(e.a.v, e.b.v) <= v0 + ftIn(6);
      // FACES the street: a horizontal cap sitting on the front line — the gable it
      // raises is seen head-on from the street (the craftsman front-gable signature).
      e.facesStreet = e.horiz && Math.abs(e.c - v0) < ftIn(6);
    }
    const mains = cand.filter((e) => e.main);
    const wings = cand.filter((e) => !e.main);

    // ---- 4. style vocabulary -> the set of END walls to gable ----
    const pick = new Set();
    const add = (e) => { if (e) pick.add(e.i); };
    const label = (style.label || '').toLowerCase();
    const seedRng = ctx.rng || Math.random;
    if (label.indexOf('farmhouse') >= 0) {
      mains.forEach(add);
      wings.forEach(add);                                  // all-gable vocabulary
    } else if (label.indexOf('craftsman') >= 0) {
      mains.forEach(add);
      // front-facing gable signature: gable STREET-facing wing/garage caps (the gable
      // is seen head-on from the street). Falls back to any frontish cap if none face
      // the street head-on (e.g. a side-loaded garage).
      const streetCaps = wings.filter((e) => e.facesStreet);
      (streetCaps.length ? streetCaps : wings.filter((e) => e.frontish)).forEach(add);
    } else if (label.indexOf('ranch') >= 0) {
      // hip everything; optional single gable accent on a front wing/garage cap
      const acc = wings.filter((e) => e.facesStreet || e.frontish).sort((a, b) => b.len - a.len)[0];
      if (acc && seedRng() < 0.5) add(acc);
    } else if (label.indexOf('cottage') >= 0) {
      mains.forEach(add);                                  // hip the wings
    } else {
      // modern / default = clean hip mass: gable the main ends only if the style's
      // roofShape asks for gable; 'hip' modern gables nothing (C4 then keeps a roof).
      if (style.roofShape === 'gable') mains.forEach(add);
    }

    // ---- 4b. MASSING-AWARE POLICY (ROOF-POLICY-SPEC A + Steve's reinforcement:
    // "this garage defaulted to gable too — I'd rather BOTH sides go hip on this
    // variation because it's impossible for our roof to work correctly like
    // this"). Classify the footprint: FLUSH BOX (front dominant-line flush, no
    // wing beyond the safe band) keeps the style vocabulary above untouched;
    // POPPED goes FULL HIP — every gable pick cleared, garage cap included, so
    // no gable pair can straddle a pop-out junction. When in doubt, hip. ----
    const massingPopped = massingPoppedOf(loop.map((p) => ({ x: p.u, y: p.v })));
    if (massingPopped) pick.clear();

    // ---- 5. C2: no two gabled walls sharing a CONVEX corner (the engine residual —
    // two convex-adjacent gables spike above the local ridge). Two perpendicular caps
    // of the SAME projecting mass (e.g. a garage FRONT + its OUTER SIDE) meet at that
    // mass's convex corner; only ONE may gable. Tie-break by style: craftsman keeps the
    // FRONT-facing cap (its front-gable signature); everyone else keeps the LONGER run
    // (the dominant gable). ----
    const preferFront = label.indexOf('craftsman') >= 0;
    const chosen = edges.filter((e) => pick.has(e.i));
    const cornerOf = (e) => [e.ai, e.bi];
    for (let i = 0; i < chosen.length; i++) {
      for (let j = i + 1; j < chosen.length; j++) {
        if (!pick.has(chosen[i].i) || !pick.has(chosen[j].i)) continue;
        const ci = cornerOf(chosen[i]), cj = cornerOf(chosen[j]);
        if (ci.some((k) => cj.includes(k))) {
          let drop;
          if (preferFront && chosen[i].facesStreet !== chosen[j].facesStreet) {
            drop = chosen[i].facesStreet ? chosen[j] : chosen[i];   // keep the street-facing cap
          } else {
            drop = chosen[i].len <= chosen[j].len ? chosen[i] : chosen[j];
          }
          pick.delete(drop.i);
        }
      }
    }

    // ---- 6. C4: never gable EVERY end wall of an axis. For the axis carrying the
    // ridge-perpendicular ends, leave at least one hip. If we picked every end on that
    // axis and there is exactly one, that's fine (opposite ends are the classic gable
    // roof); the danger is a compact footprint whose EVERY loop wall would gable — the
    // engine's own safety also guards this, but we pre-empt: if all loop walls end up
    // gabled, un-pick the longest run on each axis. ----
    const finalPick = new Set(pick);
    // apply to the L0 exterior walls by mapping each edge midpoint to the nearest wall
    const li = 0;
    const lvl = model.levels[li];
    const extWalls = (lvl.walls || []).filter((w) => HA.isExt && HA.isExt(w));
    // clear all first (start from a clean hip)
    for (const w of extWalls) w.gable = false;
    const setGableOnEdge = (e, val) => {
      // ORIENTATION FIX (live acceptance re-bounce, frontEdge-2 wide lot: ZERO
      // gables stamped on any roll): e.horiz is the edge's orientation in the
      // FRAME axes, but the wall runs in WORLD axes — on a lot whose front edge
      // rotates the frame 90° (frontEdge 1/3, or 2 with a vertical front line),
      // frame-horiz maps to world-VERTICAL walls, so `wallHoriz !== e.horiz`
      // rejected every wall and the picks silently evaporated. Compare in ONE
      // space: map the edge's endpoints to world and take its WORLD orientation.
      const wA = e.horiz ? toW(e.lo, e.c) : toW(e.c, e.lo);
      const wB = e.horiz ? toW(e.hi, e.c) : toW(e.c, e.hi);
      const eHorizW = Math.abs(wB.x - wA.x) >= Math.abs(wB.y - wA.y);
      const mid = { x: (wA.x + wB.x) / 2, y: (wA.y + wB.y) / 2 };
      let best = null, bestD = 24;
      for (const w of extWalls) {
        const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
        const d = HA.wallDir(w), wallHoriz = Math.abs(d.x) >= Math.abs(d.y);
        if (wallHoriz !== eHorizW) continue;              // must run the same WORLD way as the edge
        const t = U.clamp(U.projT(mid, A, B), 0, 1);
        const dd = U.dist(mid, U.lerp(A, B, t));
        if (dd < bestD) { bestD = dd; best = w; }
      }
      if (best) best.gable = val;
      return best;
    };
    for (const e of edges) if (finalPick.has(e.i)) setGableOnEdge(e, true);

    // engine-level safety net (identical intent to HA.roofStyle's): if EVERY loop wall
    // somehow ended gabled, un-gable the longest run on each axis so a roof still builds.
    if (extWalls.length && extWalls.every((w) => w.gable)) {
      let lx = null, ly = null, lxLen = -1, lyLen = -1;
      for (const w of extWalls) {
        const d = HA.wallDir(w), len = HA.wallLen(w);
        if (Math.abs(d.x) >= Math.abs(d.y)) { if (len > lxLen) { lxLen = len; lx = w; } }
        else if (len > lyLen) { lyLen = len; ly = w; }
      }
      if (lx) lx.gable = false;
      if (ly) ly.gable = false;
    }

    // ---- GARAGE WINGS ARE HIP-ONLY, ALWAYS (Steve: "I'd rather the garages all
    // be hip only — make the other side hip too on those craftsman ones and any
    // others; it's breaking the system mixing hip with gable"). Clear any gable
    // directive that landed on a garage-rect wall — end cap, outer side, any of
    // them, any style. The C5 wing end-cap gable stays legal for NON-garage wings
    // only. FLUSH keeps the house's own gables (the garage sits under the main
    // roof with no separate cap); POPPED garages take the full-hip package. ----
    try {
      // the garage room label (HA.garageInfo's source) is stamped AFTER this roof
      // section runs — derive the rect from the PLAN's garage room instead.
      const gR9 = ((plan && plan.rooms) || []).find((r) => r.kind === 'garage' || r.garage);
      let gi9 = null;
      if (gR9) {
        const c1 = toW(gR9.u0, gR9.v0), c2 = toW(gR9.u1, gR9.v1);
        gi9 = { rect: { x0: Math.min(c1.x, c2.x), y0: Math.min(c1.y, c2.y), x1: Math.max(c1.x, c2.x), y1: Math.max(c1.y, c2.y) } };
      }
      if (gi9 && gi9.rect) {
        const r9 = gi9.rect, T9 = 3;
        const onRect = (p) =>
          (Math.abs(p.x - r9.x0) <= T9 || Math.abs(p.x - r9.x1) <= T9 || Math.abs(p.y - r9.y0) <= T9 || Math.abs(p.y - r9.y1) <= T9) &&
          p.x >= r9.x0 - T9 && p.x <= r9.x1 + T9 && p.y >= r9.y0 - T9 && p.y <= r9.y1 + T9;
        for (const w of extWalls) {
          if (!w.gable) continue;
          const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
          const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
          if (onRect(A) && onRect(B) && onRect(M)) w.gable = false;
        }
      }
    } catch (e) { /* the hip-only garage filter is additive */ }

    // ---- upper levels (2-story): the L1+ roofs read their OWN loop's gable flags via
    // the lower-roof / main-roof engine. Give each upper level the SAME main-end gable
    // treatment (its footprint is a clean rect, so main-ends only — no wings up top). ----
    for (let ul = 1; ul < model.levels.length; ul++) {
      const uLoop = HA.exteriorLoop(model, ul);
      if (!uLoop) continue;
      let ux0 = Infinity, ux1 = -Infinity, uy0 = Infinity, uy1 = -Infinity;
      for (const p of uLoop.pts) { ux0 = Math.min(ux0, p.x); ux1 = Math.max(ux1, p.x); uy0 = Math.min(uy0, p.y); uy1 = Math.max(uy1, p.y); }
      const uAlongX = (ux1 - ux0) >= (uy1 - uy0);
      for (const w of uLoop.walls) w.gable = false;
      // gable the two END walls only when the style gables its main ends (not ranch/hip)
      const gablesMains = (label.indexOf('farmhouse') >= 0 || label.indexOf('craftsman') >= 0 ||
        label.indexOf('cottage') >= 0 || (style.roofShape === 'gable'));
      if (!gablesMains) continue;
      for (const w of uLoop.walls) {
        const d = HA.wallDir(w), runsX = Math.abs(d.x) >= Math.abs(d.y);
        if (HA.wallLen(w) < MIN_GABLE) continue;
        w.gable = uAlongX ? !runsX : runsX;   // end walls perpendicular to the ridge
      }
    }
  };

  /* ---------- STYLE: roof + finishes ---------- */
  const applyStyle = (model, style, mode, ctx) => {
    model.roof = model.roof || {};
    model.roof.enabled = true;
    model.roof.pitch = style.pitch;
    model.roof.overhang = style.overhang;
    model.roof.eaveStyle = style.eave;
    model.roof.style = style.mono ? 'shed' : style.roofStyleHint;   // stored hint
    model.roof.dormers = [];
    model.roof.overrides = [];
    // GABLE FLAGS.
    //  - shed (modern-mono): flip the whole engine to buildShed via HA.roofStyle.
    //  - everything else: MASSING-AWARE assignment (assignRoofGables) — the generator
    //    KNOWS its own composed masses (main rect / garage / wing bump), so it assigns
    //    gable/hip DIRECTLY from architectural rules instead of leaning on HA.roofStyle's
    //    bbox heuristic (which gabled jog/notch walls on articulated L/T footprints →
    //    the documented convex-corner ridge spike). Falls back to HA.roofStyle only when
    //    the massing context is unavailable (defensive; every generate() supplies it).
    if (style.roofShape === 'shed' || style.mono) {
      try { if (HA.roofStyle) HA.roofStyle(model, 'shed'); } catch (e) {}
    } else if (ctx && ctx.plan) {
      try { assignRoofGables(model, style, ctx); } catch (e) {
        try { if (HA.roofStyle) HA.roofStyle(model, style.roofShape); } catch (e2) {}
      }
    } else {
      try { if (HA.roofStyle) HA.roofStyle(model, style.roofShape); } catch (e) {}
    }

    // C5b: clear INVALID gables on the final world-space flags (concave-notch gable +
    // stepped-bar double-main gable) regardless of which path assigned them.
    try { hipBadGables(model); } catch (e) { /* additive */ }

    // ---- ROOF-POLICY-SPEC C: SELF-HEALING COVERAGE GATE ----
    // A catastrophic roll (near-total unskinned roof) must never reach the user:
    // verify the BUILT roof's plan coverage; if more than ~2% of the footprint is
    // unskinned, RETRY with the hip-everything fallback (hips always resolve).
    try { roofGate(model); } catch (e) { /* the gate is best-effort insurance */ }

    // finishes (products.js ids)
    model.finishes = model.finishes || {};
    model.finishes.roofProduct = style.roofProduct;
    model.finishes.sidingProduct = style.sidingProduct;
    model.finishes.paintSW = style.paintSW;
    model.finishes.trimSW = style.trimSW;

    // 3D materials + THEME COLORS (Steve: "trim colors need to change on random
    // too — siding changes but not the theme"). Roll ONE curated palette for the
    // style — siding + trim + door + shutter move TOGETHER as a unit. The roll is
    // seeded from opts.seed on an INDEPENDENT mulberry32 stream — it never consumes
    // the shared ctx.rng, so massing/backyard rolls downstream are byte-identical
    // with or without the theme roll (deterministic per seed either way). User
    // edits after generation stick until the next roll (this only runs in generate()).
    const _palSeed = ctx && ctx.opts && Number.isFinite(ctx.opts.seed) ? ctx.opts.seed : null;
    const pal = pickPalette(
      STYLE_KEYS.find((k) => STYLES[k] === style) || 'farmhouse',
      _palSeed != null ? mulberry32(((_palSeed * 2654435761) >>> 0) ^ 0x9e3779b9) : (ctx && ctx.rng));
    model.settings.surfaces = model.settings.surfaces || {};
    model.settings.surfaces.exteriorWall = (pal && pal.siding) || style.siding;
    model.settings.surfaces.roof = style.roofMat;
    if (pal) {
      model.settings.colors = model.settings.colors || {};
      model.settings.colors.trim = pal.trim;
      model.settings.colors.door = pal.door;
      model.settings.colors.shutter = pal.shutter;
    }
    // cladding thickness hint (stucco slightly thicker than lap in the assembly);
    // derive the kind from the ROLLED siding id so a stucco palette on a lap style
    // (and vice versa) still gets the right assembly thickness.
    const sidId = String((pal && pal.siding) || style.siding || '');
    model.settings.assembly = model.settings.assembly || { drywall: 0.5, sheathing: 0.5, cladding: 0.75 };
    model.settings.assembly.cladding = sidId.indexOf('stucco') === 0 ? 0.875 : 0.75;
    if (HA.clearTextureCaches) try { HA.clearTextureCaches(); } catch (e) {}
  };

  /* ---------- shared program roller ----------
     rollOpts(overrides, themeStyle) — the ONE place a full generate program is
     rolled (mode 1story 85% / adu 15%; style across all 6; beds 2-5 [adu 1-2];
     baths 1..min(3,beds); garage randomized [adu none]; porch auto; fresh seed;
     random:true so the CREATIVE flow — pools etc — engages). The 🎲 Random
     button AND the AI's generate_house tool both call this so the two paths can
     never drift: explicit overrides win, absent params roll like the button.
     themeStyle (the 🎲 theme picker) constrains the style roll only when no
     explicit style override is given. */
  function rollOpts(overrides, themeStyle) {
    overrides = overrides || {};
    const pick = (a) => a[(Math.random() * a.length) | 0];
    // An omitted mode is free to roll only among programs that can honor the
    // user's explicit requirements. Otherwise a 4-bedroom request could roll
    // an ADU and silently return one bedroom even though explicit overrides are
    // promised to win. A one-car corner garage is supported by ADUs; 2-car and
    // more than 2 beds/baths require the full-house program.
    const aduCompatible = !(Number.isFinite(overrides.beds) && overrides.beds > 2) &&
      !(Number.isFinite(overrides.baths) && overrides.baths > 2) &&
      overrides.garage !== '2car';
    const mode = ['1story', '2story', 'adu'].includes(overrides.mode)
      ? overrides.mode
      : (aduCompatible && Math.random() >= 0.85 ? 'adu' : '1story');   // 2-story parked at every surface
    const style = STYLES[overrides.style] ? overrides.style
      : (themeStyle && STYLES[themeStyle]) ? themeStyle
      : pick(STYLE_KEYS);
    const beds = Number.isFinite(overrides.beds) ? (overrides.beds | 0)
      : mode === 'adu' ? (1 + ((Math.random() * 2) | 0)) : (2 + ((Math.random() * 4) | 0));
    const baths = Number.isFinite(overrides.baths) ? (overrides.baths | 0)
      : mode === 'adu' ? 1 : (1 + ((Math.random() * Math.min(3, beds)) | 0));
    const garage = ['none', '1car', '2car', 'auto'].includes(overrides.garage) ? overrides.garage
      : mode === 'adu' ? 'none' : pick(['auto', '2car', '1car', 'none']);
    const porch = ['auto', 'full', 'entry', 'none'].includes(overrides.porch) ? overrides.porch : 'auto';
    const seed = Number.isFinite(overrides.seed) ? (overrides.seed >>> 0) : (Math.random() * 1e9) >>> 0;
    return Object.assign({}, overrides, { mode, style, beds, baths, garage, porch, seed, random: true });
  }

  /* ---------- public API ---------- */
  /* ============================================================
     generateFit — generate, but DON'T hard-fail on a shallow lot.

     Steve (R47): the R42 street-true front detection is right — a
     generated house should face the real street. But when the front
     edge (detected, or a genuinely short street frontage) leaves too
     little DEPTH for any house, generate() threw "the buildable
     envelope cannot host the program" and the user saw a bare
     "Generate failed" where the design used to (wrongly) appear by
     facing the house sideways.

     Fix: if the front-edge attempt fails, FACE THE DEEPEST alternative
     lot edge instead and say so — the ⟳ Front button flips it back.
     If nothing fits (a genuinely too-small or too-square lot the
     generator can't serve at all), fail honestly and restore state;
     the caller shows the numeric diagnostic.

     NOTE — an earlier draft also tried "trim the yards to keep the
     street front". Measured across many lot geometries it NEVER
     rescued a single case: setbackLines clamps setbacks to the lot,
     and the generator has a hard minimum footprint, so trimming yards
     changes nothing a reface doesn't already cover. Shipping that
     branch would have been dead code, so it's gone. If the generator
     later gains a genuinely smaller house, revisit with a test that
     proves the trim path actually fires.

     Pure escalation over model.site.frontEdge; every attempt is a real
     generate(); state is restored on total failure. Returns
     {ok, note, frontChanged, frontEdge, error}. (`relaxed` is retained
     as always-false for callers that read it.) */
  const generateFit = (model, opts) => {
    opts = opts || {};
    const out = { ok: false, note: '', relaxed: false, frontChanged: false, error: null };
    const attempt = () => { try { generate(model, opts); return true; } catch (e) { out.error = e; return false; } };
    // 1) as-is: the street-true front with the user's (or default) yards
    if (attempt()) { out.ok = true; return out; }

    const site = model && model.site;
    const lot = site && Array.isArray(site.lot) ? site.lot : null;
    if (!lot || lot.length < 3) return out;   // no lot to reshape — honest fail

    const fe0 = site.frontEdge, feM0 = site.frontEdgeManual;

    // FACE THE WIDEST ALTERNATIVE FRONTAGE. The generator builds a wide, shallow
    // house happily but not a narrow, deep one (measured: a 60'-wide x 26'-deep
    // lot fits facing the wide edge; the same lot facing its 26' edge throws).
    // So the failure is a too-NARROW frontage — reface to the longest lot edge.
    // The real generate() validates each try.
    const edgeLen = (i) => {
      const a = lot[i], b = lot[(i + 1) % lot.length];
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const edges = [];
    for (let i = 0; i < lot.length; i++) if (i !== (fe0 | 0)) edges.push({ i, d: edgeLen(i) });
    edges.sort((p, q) => q.d - p.d);
    for (const e of edges) {
      site.frontEdge = e.i; site.frontEdgeManual = true;
      if (attempt()) {
        out.ok = true; out.frontChanged = true; out.frontEdge = e.i;
        out.note = 'The street-facing side was too narrow for a house, so it now faces a wider lot edge. ' +
          'Use the ⟳ Front button (top-right of the 3D view) to turn it to another side.';
        return out;
      }
    }

    // nothing fits — restore and report honestly
    site.frontEdge = fe0;
    if (feM0 == null) delete site.frontEdgeManual; else site.frontEdgeManual = feM0;
    return out;
  };

  HA.generator = {
    generate,
    generateFit,
    rollOpts,
    _dbgGarage,   // R171 debug surface — planGarage decisions (thin-lot harness)
    // UNDER-ROOF PORCH: convert an eligible edge room into an open covered porch under
    // the roof line (the chat AI + a future room-mode button call this).
    roomToPorch,
    // ROUND 7: re-derive every generated site feature (drive/walk/yards) after a
    // house-pose change — the rotate button calls this before app.sync.
    regenSiteFeatures,
    STYLES,
    STYLE_KEYS,
    mulberry32,
    // curated theme palettes (siding+trim+door+shutter rolled as a UNIT on
    // Generate/Random) + the pure deterministic picker — exposed for tests/UI.
    PALETTES,
    pickPalette,
    _internal: { buildFrame, design1story, design2story, designADU, scoreCand, loopEdgesOf, fillStrip, sharedEdges, mergeSegs, attachGarage, planGarage, traceRectUnion, assignRoofGables, GARAGE_DIMS },
    _popDepth: popDepthOf,       // ROOF-POLICY-SPEC A raw metric (worst side)
    _massingPopped: massingPoppedOf,   // ROOF-POLICY-SPEC A classifier (policy tests + roofmatrix)
    _roofGate: roofGate,         // ROOF-POLICY-SPEC C self-healing gate (policy tests)
    _roofCoveragePct: roofCoveragePct,
    _hipBadGables: hipBadGables,   // C5b invalid-gable clear pass (concave-notch + stepped-bar); policy tests
  };
})();
