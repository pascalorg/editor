/* ============================================================
   Home Architect — roof.js
   Automatic roof generation via a straight-skeleton wavefront.

   The footprint (expanded by the eave/rake overhang) shrinks
   inward at uniform speed; vertices ride angle bisectors.
   Two event types restructure the wavefront:
     - edge event: a wavefront edge collapses to a point
     - split event: a reflex vertex crashes into an opposite edge
   Every vertex trajectory segment borders exactly two roof
   faces, so faces are recovered by chaining each source edge's
   collected segments into a closed polygon. Heights follow
   z(p) = plate + slope * (inward distance from the wall line),
   which is exact on every skeleton face. Gable walls get their
   hip face re-partitioned among neighboring planes and a
   vertical gable polygon from plate to the roof underside.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;
  const U = HA.U;

  /* Manual roof-edit PULL POINTS. Each override {fx,fy,tx,ty} moves any auto-roof
     face vertex near (fx,fy) to (tx,ty), recomputing z on the SAME face plane so
     the moved point stays on pitch (drag it out and the eave just holds its
     overhang). Applied after auto-build, so it survives pitch/footprint tweaks as
     long as a vertex still lands near (fx,fy); otherwise it's a harmless no-op. */
  const applyRoofOverrides = (faces, model) => {
    const ovs = (model.roof && model.roof.overrides) || [];
    if (!ovs.length || !faces || !faces.length) return faces;
    const TOL = 10;
    for (const ov of ovs) {
      for (const f of faces) {
        if (!f.poly2 || !f.coef) continue;
        // move ONLY the single closest vertex within TOL — moving every vertex in
        // range merged two distinct adjacent corners into one (a degenerate
        // doubled point). Shared corners still move on each face (closest in each),
        // so faces stay connected.
        let bi = -1, bd = TOL * TOL;
        for (let i = 0; i < f.poly2.length; i++) {
          const p = f.poly2[i], dd = (p.x - ov.fx) * (p.x - ov.fx) + (p.y - ov.fy) * (p.y - ov.fy);
          if (dd < bd) { bd = dd; bi = i; }
        }
        if (bi >= 0) {
          f.poly2[bi].x = ov.tx; f.poly2[bi].y = ov.ty;
          f.pts3 = f.poly2.map((p) => ({ x: p.x, y: p.y, z: f.coef.A * p.x + f.coef.B * p.y + f.coef.C }));
          f.maxZ = Math.max(...f.pts3.map((q) => q.z));
        }
      }
    }
    return faces;
  };
  HA.applyRoofOverrides = applyRoofOverrides;

  /* Trace the closed loop of exterior walls on a level.
     Returns { pts:[{x,y}], walls:[wall per edge] } or null. */
  HA.exteriorLoop = (model, levelIdx) => {
    const lvl = model.levels[levelIdx == null ? 0 : levelIdx];
    if (!lvl) return null;
    // carport infill walls are exterior-type but belong to a FREESTANDING
    // overlay — including them dangles open endpoints and NULLS the whole
    // house loop (R60: adding carport sides made the terrain pad shoot up
    // because grading lost the house). They are never part of this loop.
    const ext = lvl.walls.filter((w) => HA.isExt(w) && !w.carport && HA.wallLen(w) > 1);
    if (ext.length < 3) return null;
    const nodes = new Map();
    for (const w of ext) {
      for (const end of [0, 1]) {
        const p = end === 0 ? HA.wallA(w) : HA.wallB(w);
        const k = U.ptKey(p.x, p.y);
        if (!nodes.has(k)) nodes.set(k, []);
        nodes.get(k).push({ wall: w, end });
      }
    }
    for (const [, list] of nodes) if (list.length !== 2) return null;

    const pts = [], walls = [], used = new Set();
    let cur = ext[0], end = 1;
    let guard = ext.length + 2;
    let entryPt = HA.wallA(cur);
    while (guard-- > 0) {
      used.add(cur.id);
      pts.push({ x: entryPt.x, y: entryPt.y });
      walls.push(cur);
      const exitPt = end === 1 ? HA.wallB(cur) : HA.wallA(cur);
      const k = U.ptKey(exitPt.x, exitPt.y);
      const conns = (nodes.get(k) || []).filter((c) => c.wall.id !== cur.id);
      if (!conns.length) return null;
      const next = conns[0];
      if (next.wall.id === ext[0].id) {
        return used.size === ext.length && pts.length === ext.length
          ? { pts, walls }
          : null;
      }
      if (used.has(next.wall.id)) return null;
      cur = next.wall;
      end = next.end === 0 ? 1 : 0;
      entryPt = exitPt;
    }
    return null;
  };

  /* The exterior loop offset OUTWARD to the STUD FACE — each edge pushed out by its
     own wall's HALF-STUD (foundation reference; Steve: "the studs is how you line up
     your foundations"), corners mitered (U.offsetPoly). Used by the DIMENSION code
     (plan + site plan + DXF) so overall / exterior dims read stud-face to stud-face,
     not centerline — while all structural geometry keeps using the centerline
     HA.exteriorLoop. Returns { pts, walls } (or the centerline loop as a fallback). */
  /* Generic: the exterior loop offset OUTWARD to a per-wall face distance.
     distFn(wall) → inches from the wall centerline. Corners mitered (U.offsetPoly).
     Returns { pts, walls } on success, or NULL if the loop is invalid / can't be offset.
     (Callers that must always get a loop OR the centerline back the call with `|| exteriorLoop`.) */
  HA.exteriorLoopFace = (model, levelIdx, distFn) => {
    const loop = HA.exteriorLoop(model, levelIdx);
    if (!loop || !loop.pts || loop.pts.length < 3 || !loop.walls || !U.offsetPoly) return null;
    try {
      const dists = loop.walls.map((w) => distFn(w));
      const od = U.offsetPoly(loop.pts, dists);
      if (od && od.length === loop.pts.length && od.every((p) => p && isFinite(p.x) && isFinite(p.y)))
        return { pts: od, walls: loop.walls };
    } catch (e) { /* offset failed */ }
    return null;
  };

  HA.exteriorLoopStudDist = (w) => (HA.wallStudHalf ? HA.wallStudHalf(w) : (HA.wallT ? HA.wallT(w) : 5) / 2);
  HA.exteriorLoopCladDist = (w) => (HA.wallT ? HA.wallT(w) : 5) / 2 + (HA.wallClad ? HA.wallClad(w) : 0);

  // STUD-face loop for the DIM code — always returns a loop (centerline fallback).
  HA.exteriorLoopOD = (model, levelIdx) =>
    HA.exteriorLoopFace(model, levelIdx, HA.exteriorLoopStudDist) || HA.exteriorLoop(model, levelIdx);

  /* CLADDING outer face (siding/stucco): wallT/2 (gyp+stud+sheathing) + cladding thickness.
     Purely a DRAWN face — dims/foundation stay on the stud, structure on the centerline.
     Returns null on failure so the 2D drawer simply skips it (no centerline artifact). */
  HA.exteriorLoopClad = (model, levelIdx) => HA.exteriorLoopFace(model, levelIdx, HA.exteriorLoopCladDist);

  /* ---------- straight skeleton ----------
     pts: simple polygon. Returns array of
     { edgeIdx, poly2:[{x,y}], segs:[{a,b}] } — one or zero per edge. */
  const skeletonFaces = (pts, sigmaFn) => {
    const n = pts.length;
    const SE = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dir = U.norm(U.sub(b, a));
      const inN = U.mul(U.edgeOutNormal(pts, i), -1);
      // sigma = wavefront speed of this edge. 1 = EAVE (slope rises inward, default).
      // 0 = WALL the roof DIES INTO (stationary; the wavefront rises UP TO it). For a plain
      // single-pitch roof all sigma=1, which reduces the math below EXACTLY to the original.
      SE.push({ i, a, b, dir, inN, sigma: sigmaFn ? sigmaFn(i) : 1 });
    }
    const orient = U.polyArea(pts) > 0 ? 1 : -1;

    // WEIGHTED unit-bisector: V with dot(inN_L,V)=sigma_L and dot(inN_R,V)=sigma_R, so each edge's
    // offset line recedes at its own sigma. For sigma_L=sigma_R=1 this is the ORIGINAL formula
    // (1/(1+c))·(inN_L+inN_R) — kept on that exact path so the main roof stays bit-identical.
    const mkVel = (eL, eR) => {
      const c = U.dot(eL.inN, eR.inN);
      if (eL.sigma === 1 && eR.sigma === 1) {
        const denom = 1 + c;
        if (denom < 1e-9) return { x: 0, y: 0 }; // anti-parallel: dies same-instant
        return U.mul(U.add(eL.inN, eR.inN), 1 / denom);
      }
      const den = 1 - c * c;
      if (Math.abs(den) < 1e-9) {               // (anti)parallel edges of different speed
        if (1 + c < 1e-9) return { x: 0, y: 0 };
        return U.mul(eL.inN, eL.sigma);          // collinear -> ride the shared normal at its speed
      }
      return U.add(U.mul(eL.inN, (eL.sigma - eR.sigma * c) / den), U.mul(eR.inN, (eR.sigma - eL.sigma * c) / den));
    };
    const mkVertex = (p, t0, eL, eR) => ({ p, t0, eL, eR, vel: mkVel(eL, eR) });
    const pos = (v, t) => U.add(v.p, U.mul(v.vel, t - v.t0));
    const isReflex = (v) => U.cross(v.eL.dir, v.eR.dir) * orient < -1e-9;

    let loops = [pts.map((p, i) => mkVertex({ x: p.x, y: p.y }, 0, SE[(i + n - 1) % n], SE[i]))];
    const faceSegs = SE.map(() => []);
    const addSeg = (eIdx, a, b) => {
      if (U.dist(a, b) > 0.05) faceSegs[eIdx].push({ a: { ...a }, b: { ...b } });
    };
    const recordTraj = (v, t, end) => {
      addSeg(v.eL.i, v.p, end);
      addSeg(v.eR.i, v.p, end);
    };

    const kill2 = (loop, t) => {
      const [v1, v2] = loop;
      const s = v1.eR;
      const c1 = U.dot(U.sub(v2.vel, v1.vel), s.dir);
      let tm = null;
      if (Math.abs(c1) > 1e-9) {
        const c0 = U.dot(
          U.sub(U.sub(v2.p, U.mul(v2.vel, v2.t0)), U.sub(v1.p, U.mul(v1.vel, v1.t0))),
          s.dir);
        tm = -c0 / c1;
      }
      if (tm != null && tm >= t - 1e-6 && tm < t + 1e7) {
        const pm = U.lerp(pos(v1, tm), pos(v2, tm), 0.5);
        recordTraj(v1, tm, pm);
        recordTraj(v2, tm, pm);
      } else {
        // anti-parallel ridge: the connector IS a skeleton arc
        const p1 = pos(v1, t), p2 = pos(v2, t);
        addSeg(v1.eL.i, p1, p2);
        addSeg(v1.eR.i, p1, p2);
        recordTraj(v1, t, pos(v1, t));
        recordTraj(v2, t, pos(v2, t));
      }
    };

    let tNow = 0;
    let guard = Math.max(64, n * n * 12);
    while (loops.length && guard-- > 0) {
      loops = loops.filter((L) => L.length >= 3);
      if (!loops.length) break;

      let best = null;
      for (const L of loops) {
        const m = L.length;
        for (let k = 0; k < m; k++) {
          const v = L[k], w = L[(k + 1) % m];
          const s = v.eR;
          const c1 = U.dot(U.sub(w.vel, v.vel), s.dir);
          if (Math.abs(c1) < 1e-12) continue;
          const c0 = U.dot(
            U.sub(U.sub(w.p, U.mul(w.vel, w.t0)), U.sub(v.p, U.mul(v.vel, v.t0))),
            s.dir);
          const t = -c0 / c1;
          if (t < tNow - 1e-6) continue;
          if (!best || t < best.t - 1e-9 || (Math.abs(t - best.t) <= 1e-9 && best.type !== 'edge'))
            best = { t: Math.max(t, tNow), type: 'edge', L, k };
        }
        for (let k = 0; k < m; k++) {
          const v = L[k];
          if (!isReflex(v)) continue;
          for (let j = 0; j < m; j++) {
            const a = L[j], b = L[(j + 1) % m];
            if (a === v || b === v) continue;
            const s = a.eR;
            if (s === v.eL || s === v.eR) continue;
            const c1 = U.dot(s.inN, v.vel);
            if (Math.abs(s.sigma - c1) < 1e-12) continue;   // s.sigma = rate s's offset line recedes (1 for an eave; the only place edge speed entered the math)
            const c0 = U.dot(s.inN, U.sub(U.sub(v.p, U.mul(v.vel, v.t0)), s.a));
            const t = c0 / (s.sigma - c1);
            if (t < tNow - 1e-6 || t < v.t0 - 1e-6) continue;
            const x = pos(v, t);
            const pa = pos(a, t), pb = pos(b, t);
            const span = U.dot(U.sub(pb, pa), s.dir);
            const proj = U.dot(U.sub(x, pa), s.dir);
            if (proj < -0.25 || proj > span + 0.25) continue;
            if (!best || t < best.t - 1e-9)
              best = { t: Math.max(t, tNow), type: 'split', L, k, j };
          }
        }
      }
      if (!best) break;
      tNow = best.t;
      const L = best.L, m = L.length;

      if (best.type === 'edge') {
        const v = L[best.k], w = L[(best.k + 1) % m];
        const pm = U.lerp(pos(v, tNow), pos(w, tNow), 0.5);
        recordTraj(v, tNow, pm);
        recordTraj(w, tNow, pm);
        const u = mkVertex(pm, tNow, v.eL, w.eR);
        const idx = Math.min(best.k, (best.k + 1) % m);
        if ((best.k + 1) % m === 0) { L.pop(); L.shift(); L.push(u); }
        else L.splice(best.k, 2, u);
        if (L.length === 2) { kill2(L, tNow); loops = loops.filter((x) => x !== L); }
      } else {
        const v = L[best.k];
        const a = L[best.j], b = L[(best.j + 1) % m];
        const s = a.eR;
        const x = pos(v, tNow);
        recordTraj(v, tNow, x);
        const w1 = mkVertex(x, tNow, v.eL, s);
        const w2 = mkVertex(x, tNow, s, v.eR);
        // loop1: b .. pv(+w1)   loop2: nv .. a(+w2)
        const loop1 = [], loop2 = [];
        for (let q = (best.j + 1) % m; q !== best.k; q = (q + 1) % m) loop1.push(L[q]);
        loop1.push(w1);
        for (let q = (best.k + 1) % m; q !== (best.j + 1) % m; q = (q + 1) % m) loop2.push(L[q]);
        loop2.push(w2);
        loops = loops.filter((x) => x !== L);
        for (const nl of [loop1, loop2]) {
          if (nl.length === 2) kill2(nl, tNow);
          else if (nl.length >= 3) loops.push(nl);
        }
      }
    }

    /* chain each face's segments into a polygon: base edge a->b,
       then walk skeleton arcs from b back to a */
    const faces = [];
    for (let i = 0; i < n; i++) {
      const segs = faceSegs[i].slice();
      if (!segs.length) continue;
      const a = SE[i].a, b = SE[i].b;
      const poly = [{ ...a }, { ...b }];
      let cur = b;
      let guard2 = segs.length + 2;
      while (guard2-- > 0 && segs.length) {
        let bi = -1, bRev = false, bd = 1.5; // tolerance for endpoint matching
        for (let q = 0; q < segs.length; q++) {
          const dA = U.dist(cur, segs[q].a);
          const dB = U.dist(cur, segs[q].b);
          if (dA < bd) { bd = dA; bi = q; bRev = false; }
          if (dB < bd) { bd = dB; bi = q; bRev = true; }
        }
        if (bi < 0) break;
        const sg = segs.splice(bi, 1)[0];
        const nxt = bRev ? sg.a : sg.b;
        if (U.dist(nxt, a) < 1.0) { cur = a; break; }
        poly.push({ ...nxt });
        cur = nxt;
      }
      // strip collinear/duplicate points
      let clean = [];
      for (const p of poly) {
        const last = clean[clean.length - 1];
        if (!last || U.dist(last, p) > 0.1) clean.push(p);
      }
      // UNTWIST: the greedy nearest-endpoint walk can chain a near-degenerate
      // face (ridge just a few inches long) in BOWTIE order — planar and right-
      // sized but self-intersecting, so the skin triangulates with a flipped
      // overlap and renders a white/dark diagonal band across the roof end
      // (owner's screenshot; repro: craftsman 2story seed 7, lower roof).
      // 2-opt repair; fail-soft (returns the input if it can't untangle).
      if (clean.length >= 4 && HA.untwistRing) clean = HA.untwistRing(clean);
      if (clean.length >= 3 && Math.abs(U.polyArea(clean)) > 2)
        faces.push({ edgeIdx: i, poly2: clean, segs: faceSegs[i] });
    }
    return faces;
  };
  HA._skel = skeletonFaces;   // test hook (scratch validation of the weighted skeleton); harmless

  /* ---------- core: build a roof over one loop ----------
     opts.coveredFn(edge) marks edges under a story above. Covered edges
     still carry hip planes (so the skeleton stays bounded), but their
     faces are DROPPED afterwards — they'd be hidden inside the upper
     story. The kept faces die into the upper walls naturally. */
  const buildOn = (model, loop, baseZ, opts) => {
    opts = opts || {};
    const roof = model.roof;
    if (!loop) return { ok: false, reason: 'Exterior walls must form one closed loop.' };

    const n = loop.pts.length;
    const slope = (opts && opts.pitch != null) ? Math.max(0.03, opts.pitch) : Math.max(0.5, roof.pitch) / 12;
    const plate = baseZ + Math.max(...loop.walls.map((w) => w.height || model.settings.wallHeight));

    const edges = [];
    for (let i = 0; i < n; i++) {
      const a = loop.pts[i], b = loop.pts[(i + 1) % n];
      const wall = loop.walls[i];
      const e = {
        i, a, b,
        dir: U.norm(U.sub(b, a)),
        inN: U.mul(U.edgeOutNormal(loop.pts, i), -1),
        wall,
        // gableFn (pop-out continuation): the derived roof loop's continued edge carries the
        // flanking wall's gable directive even though the WALL loop jogs. Default: the wall's own flag.
        gable: opts.gableFn ? !!opts.gableFn(i) : !!wall.gable,
        covered: false,
        // per-edge PLATE (wall-top) elevation — this wall's own height, so a wall set to a
        // different ceiling height makes its roof face rise from a different plate (Chief-style
        // variable ceilings). Uniform heights → every plate == the old global plate (byte-identical).
        plate: baseZ + (wall.height || model.settings.wallHeight),
      };
      if (opts.coveredFn && opts.coveredFn(e)) { e.covered = true; e.gable = false; }
      edges.push(e);
    }
    const inactive = (e) => e.gable;
    if (edges.every(inactive))
      return { ok: false, reason: 'At least one wall must carry a roof plane.' };

    const effRake = (e) => Math.max(roof.rake, HA.wallT(e.wall) / 2 + 2);
    const dists = edges.map((e) =>
      e.covered ? 0.5 : e.gable ? effRake(e) : roof.overhang);
    // NOTE: an earlier "harmonize collinear covered/exposed offsets to fix a
    // stepped eave" pass was REMOVED — widening a covered wall stub to its
    // exposed sibling's offset corrupts the straight skeleton on L-shaped lower
    // roofs and opened a large coverage HOLE (the visible "cut out" wing). The
    // step it fixed is minor and sits at the covered/exposed boundary that dies
    // into the story above (mostly hidden), so coverage wins over that step.
    const over = U.offsetPoly(loop.pts, dists);

    let skel;
    try {
      skel = skeletonFaces(over);
    } catch (err) {
      return { ok: false, reason: 'Roof solver failed on this footprint.' };
    }
    if (!skel.length) return { ok: false, reason: 'Roof could not be generated.' };

    // plane height function for edge i, measured from the WALL line
    const hCoef = (e) => ({
      A: slope * e.inN.x,
      B: slope * e.inN.y,
      C: (e.plate != null ? e.plate : plate) - slope * U.dot(e.inN, e.a),
    });
    const hAt = (c, p) => c.A * p.x + c.B * p.y + c.C;

    const faces = [];
    const pushFace = (e, poly2p) => {
      if (!poly2p || poly2p.length < 3 || Math.abs(U.polyArea(poly2p)) < 2) return;
      const coef = hCoef(e);
      faces.push({
        kind: 'slope',
        wallId: e.wall.id,
        edge: e,
        coef,
        poly2: poly2p,
        pts3: poly2p.map((p) => ({ x: p.x, y: p.y, z: hAt(coef, p) })),
        maxZ: Math.max(...poly2p.map((p) => hAt(coef, p))),
      });
    };
    const pushSlope = (edgeIdx, poly2) => {
      if (!poly2 || poly2.length < 3 || Math.abs(U.polyArea(poly2)) < 2) return;
      const e = edges[edgeIdx];
      /* R192 — PER-SPAN PLATES on collinear runs. The straight skeleton
         returns ONE face per LINE, so when collinear edges carry DIFFERENT
         plates (a vaulted room's span amid normal walls — the span-accurate
         vault raise), the whole face landed on ONE edge: the other spans
         rendered from the wrong eave and the plate-diff transition scan saw
         no step (dev-rooms-test 14 caught it: zero transitions). Split the
         face at the sibling breakpoints — one piece per collinear edge, each
         rising from its OWN plate; the transition scan then skins the step.
         Uniform-plate runs (every generated roof until now) never enter the
         branch — byte-identical. */
      const orig = opts._origLoop;
      const t = (p) => (p.x - e.a.x) * e.dir.x + (p.y - e.a.y) * e.dir.y;
      const sibs = [];   // {lo, hi, plate} — the ORIGINAL sub-spans on e's line
      if (orig && orig.pts && orig.pts.length) {
        const eLen = U.dist(e.a, e.b);
        for (let j = 0; j < orig.pts.length; j++) {
          const a = orig.pts[j], b = orig.pts[(j + 1) % orig.pts.length];
          const w = orig.walls[j];
          const dirO = U.norm(U.sub(b, a));
          if (Math.abs(U.cross(e.dir, dirO)) > 0.02) continue;
          const off = U.sub(a, e.a);
          if (Math.abs(off.x * e.inN.x + off.y * e.inN.y) > 1) continue;   // a different parallel line
          const lo = Math.min(t(a), t(b)), hi = Math.max(t(a), t(b));
          if (hi < -1 || lo > eLen + 1) continue;                          // another run on the same line
          sibs.push({ lo, hi, plate: baseZ + ((w && w.height) || model.settings.wallHeight) });
        }
      }
      if (sibs.length > 1 && new Set(sibs.map((s) => s.plate)).size > 1) {
        const da = e.dir.x * e.a.x + e.dir.y * e.a.y;
        sibs.sort((x, y) => x.lo - y.lo);
        for (let k = 0; k < sibs.length; k++) {
          const lo = k === 0 ? -1e9 : sibs[k].lo;                 // the run's ends keep the
          const hi = k === sibs.length - 1 ? 1e9 : sibs[k].hi;    // rake/miter overspill
          let piece = U.clipHalfPlane(poly2, e.dir.x, e.dir.y, -da - lo);
          piece = U.clipHalfPlane(piece, -e.dir.x, -e.dir.y, da + hi);
          pushFace(Object.assign({}, e, { plate: sibs[k].plate }), piece);
        }
        return;
      }
      pushFace(e, poly2);
    };

    const gableSkel = [];
    for (const f of skel) {
      if (inactive(edges[f.edgeIdx])) gableSkel.push(f);
      else pushSlope(f.edgeIdx, f.poly2);
    }

    /* Gable hip-faces get re-partitioned among the neighboring planes
       (lower envelope is valid locally among adjacent faces). */
    for (const gf of gableSkel) {
      const segMid = (s) => U.lerp(s.a, s.b, 0.5);
      const neighbors = new Set();
      for (const f of skel) {
        if (f === gf || inactive(edges[f.edgeIdx])) continue;
        let touch = false;
        for (const s1 of gf.segs) {
          for (const s2 of f.segs) {
            if (U.dist(segMid(s1), segMid(s2)) < 1 ||
                (U.dist(s1.a, s2.b) < 1 && U.dist(s1.b, s2.a) < 1) ||
                (U.dist(s1.a, s2.a) < 1 && U.dist(s1.b, s2.b) < 1)) { touch = true; break; }
          }
          if (touch) break;
        }
        if (touch) neighbors.add(f.edgeIdx);
      }
      // Pick the planes that re-tile this gable's removed hip face. Exclude:
      //  - SIBLINGS (collinear/parallel-same-facing): they sit at plate height
      //    along the gable line and would flatten it.
      //  - COVERED edges: on a wing/lower roof a covered edge carries a hip
      //    plane only to keep the skeleton bounded; that plane is physically
      //    under the upper story and dives far below plate over this exposed
      //    region, so if allowed in it wins the lower-envelope, leaves a hole
      //    (covered faces are dropped later) AND suppresses the gable face
      //    entirely. It must never re-tile an exposed gable region.
      const gEdge = edges[gf.edgeIdx];
      const notSibling = (i) => U.dot(edges[i].inN, gEdge.inN) < 0.99;
      // a candidate plane must actually COVER this gable's footprint FROM ABOVE.
      // At a concave / re-entrant corner (an L / wing / notch), an adjacent wall's
      // plane extrapolated onto the WRONG side dives BELOW plate over this strip
      // and — being the lowest — wins the lower-envelope, flattening the gable to
      // plate so no peak forms and the gable face is dropped (the "missing gable"
      // on a wing wall). Excluding sub-plate planes here lets the genuine
      // perpendicular slope raise the ridge so the gable renders.
      const gCen = U.polyCentroid(gf.poly2);
      const aboveP = (i) => {
        const c = hCoef(edges[i]);
        return (c.A * gCen.x + c.B * gCen.y + c.C) >= plate - 1;
      };
      const usable = (i) => notSibling(i) && !edges[i].covered && aboveP(i);
      let cand = [...neighbors].filter(usable);
      if (!cand.length)
        cand = edges.filter((e) => !inactive(e) && usable(e.i)).map((e) => e.i);
      if (!cand.length)
        cand = edges.filter((e) => !inactive(e) && !e.covered).map((e) => e.i); // last resort
      // NOTE: a known residual exists where TWO OR MORE gabled walls meet at a
      // convex corner (and the roofStyle 'gable'/'mixed' presets that gable
      // many walls): the lower envelope of the surviving distant hip planes can
      // spike above the local ridge. Correctly bounding that needs a gable-
      // constrained skeleton, tracked separately; single/opposite gables and
      // hip roofs (the common cases) are correct.
      // PER-POINT VALIDITY (Steve: "gable-to-hip transition breaking on most
      // designs where it pops out"): aboveP() checks the plane at the gable's
      // CENTROID only — an end gable spanning the main mass AND a pop-out wing
      // let the main slope win the envelope over the WING's plan region, where
      // that plane dives up to 86" BELOW plate (the unskinned gray triangle; the
      // rake board then traced the garbage silhouette down the wall). The
      // envelope now assigns a region to a plane ONLY where that plane sits at
      // eave height or above (its validity floor); sub-floor leftovers re-run
      // the envelope with the failing plane removed, so the wing's OWN planes
      // take their region — the wing roof dies into the main mass with a bounded
      // step instead of plunging.
      /* R192 (Steve's showcase: a 31ft roof FIN): the validity floor was the
         GLOBAL max plate — one VAULTED room (132" plates) raised the floor for
         every plane, so the 108-plate planes at a pinned gable corner all
         failed validity, the leftover cascade exhausted its candidates, and
         the far RAISED plane was emitted as-is 45ft from its own eave
         (z=348 over a 193" ridge). Each plane validates against ITS OWN
         plate now; uniform-height roofs are byte-identical. */
      const floorOf = (ci) => ((edges[ci].plate != null ? edges[ci].plate : plate)
        - slope * ((roof.overhang || 0) + 2) - 1);
      // VALIDITY of a candidate plane over a region = (a) at/above its eave-line
      // FLOOR and (b) inside its HIP CONE — within the lateral span of its source
      // edge, expanded 1:1 with inward distance (a skeleton face spreads past an
      // edge endpoint only along the 45° bisector). Without (b) the MAIN-front
      // plane extended 162" sideways into a garage pop-out corner just 26" deep,
      // sat 28" under the garage's own plane and won the min-envelope — a sunken
      // sliver + exposed pediment edge at the gable junction (Steve's farmhouse
      // seed 5002315: "garage pops out in front and messes up this roof").
      const validityClips = (ci) => {
        const e = edges[ci], cc = hCoef(e);
        // slack covers the over-polygon band OUTSIDE the wall line (overhang +
        // rake + corner miter): at a gable's outer corner the cone coordinates go
        // t=-12, d=-16 legitimately — a tight cone cut those slivers loose and the
        // leftover reassign spiked them onto a far plane (+126" over plate).
        const len = U.dist(e.a, e.b), slack = (roof.overhang || 0) + (roof.rake || 0) + 24;
        const d1 = { x: e.inN.x - e.dir.x, y: e.inN.y - e.dir.y };   // keep t - d <= len + slack
        const d2 = { x: e.inN.x + e.dir.x, y: e.inN.y + e.dir.y };   // keep t + d >= -slack
        return [
          { A: cc.A, B: cc.B, C: cc.C - floorOf(ci) },
          { A: d1.x, B: d1.y, C: len + slack - (d1.x * e.a.x + d1.y * e.a.y) },
          { A: d2.x, B: d2.y, C: slack - (d2.x * e.a.x + d2.y * e.a.y) },
        ];
      };
      const assign = (polys, candSet, depth) => {
        if (!polys.length || !candSet.length) return;
        for (const ci of candSet) {
          const cc = hCoef(edges[ci]);
          const leftovers = [];
          for (const rg of polys) {
            let poly = rg.slice();
            for (const oi of candSet) {
              if (oi === ci || !poly.length) continue;
              const oc = hCoef(edges[oi]);
              // keep where h_ci <= h_oi
              poly = U.clipHalfPlane(poly, oc.A - cc.A, oc.B - cc.B, oc.C - cc.C);
            }
            if (poly.length < 3 || Math.abs(U.polyArea(poly)) < 2) continue;
            if (depth >= 6 || candSet.length < 2) { pushSlope(ci, poly); continue; }  // no fallback left: emit as-is
            // split into the VALID part (inside every validity clip) and leftover
            // complement pieces (outside clip k, inside clips < k) for reassignment
            let hi = poly;
            const loParts = [];
            for (const cl of validityClips(ci)) {
              if (!hi.length) break;
              const loP = U.clipHalfPlane(hi, -cl.A, -cl.B, -cl.C);
              if (loP.length >= 3 && Math.abs(U.polyArea(loP)) > 2) loParts.push(loP);
              hi = U.clipHalfPlane(hi, cl.A, cl.B, cl.C);
            }
            const lo = loParts.length ? loParts[0] : [];   // FLOOR-side piece (transition scan below reads it)
            if (hi.length >= 3 && Math.abs(U.polyArea(hi)) > 2) pushSlope(ci, hi);
            if (loParts.length) {
              for (const lp2 of loParts) leftovers.push(lp2);
              // TRANSITION band along the split line (the FLOOR contour of ci):
              // the reassigned side rises to the next owner's plane, leaving a
              // vertical step — skin it (view3d renders kind:'transition' as an
              // exterior-wall band) so the junction never reads open.
              const rest = candSet.filter((x) => x !== ci);
              const zNext = (p) => {
                let z = null;
                for (const oi of rest) { const oc = hCoef(edges[oi]); const v = oc.A * p.x + oc.B * p.y + oc.C; if (z == null || v < z) z = v; }
                return z;
              };
              const ciFloor = floorOf(ci);   // the floor line is per-plane too (R192)
              for (let k = 0; k < lo.length; k++) {
                const a = lo[k], b = lo[(k + 1) % lo.length];
                if (Math.abs(cc.A * a.x + cc.B * a.y + cc.C - ciFloor) > 0.1) continue;   // edge must lie
                if (Math.abs(cc.A * b.x + cc.B * b.y + cc.C - ciFloor) > 0.1) continue;   // on the floor line
                if (U.dist(a, b) < 4) continue;
                const za = zNext(a), zb = zNext(b);
                if (za == null || (za <= ciFloor + 1 && zb <= ciFloor + 1)) continue;     // no real step
                faces.push({
                  kind: 'transition', wallId: gEdge.wall && gEdge.wall.id,
                  pts3: [
                    { x: a.x, y: a.y, z: ciFloor },
                    { x: b.x, y: b.y, z: ciFloor },
                    { x: b.x, y: b.y, z: Math.max(zb, ciFloor) },
                    { x: a.x, y: a.y, z: Math.max(za, ciFloor) },
                  ],
                });
              }
            }
          }
          if (leftovers.length) assign(leftovers, candSet.filter((x) => x !== ci), depth + 1);
        }
      };
      assign([gf.poly2.slice()], cand, 0);
    }

    /* ---------- POP-OUT STEPPED-RAKE EXTENSION (roof continuation) ----------
       The simplified skeleton stops at the continued line's rake/eave offset, but the
       pop-out sticks out FURTHER — up to 8ft, while the rake is ~12-16" — so the pop-out
       top would be open to the sky (rain falls straight in). Physically CONTINUE each
       slope plane over the pop-out with a Chief-style STEPPED rake: the boundary edge
       runs at wall+offset as today, juts out to popoutFace+offset across the pop-out
       band (widened by the same offset past the pop-out side walls), then returns. SAME
       plane equation — only the poly2 outline gains the step (pts3 re-derived from the
       plane), so pitch/ridge continue level over the pop-out and rake trim follows the
       stepped edge. If the band straddles the ridge, BOTH planes extend (each clips the
       band to its own boundary-edge span). Fail-soft: a step that would self-intersect
       the ring is discarded (face left untouched). */
    for (const nt of (opts.popoutNotches || [])) {
      if (!nt || !nt.aPt || !nt.dPt || !nt.outN || !(nt.depth > 0)) continue;
      const bDir = U.norm(U.sub(nt.dPt, nt.aPt));
      if (!isFinite(bDir.x) || Math.hypot(bDir.x, bDir.y) < 0.5) continue;
      const oN = U.norm(nt.outN);
      const along = (p) => U.dot(U.sub(p, nt.aPt), bDir);
      const offOf = (p) => U.dot(U.sub(p, nt.aPt), oN);
      const tD = along(nt.dPt);
      const b0raw = Math.min(0, tD), b1raw = Math.max(0, tD);
      const maxOff = Math.max(roof.overhang || 0, roof.rake || 0) + 12;   // boundary edges live within rake/eave offset
      for (const f of faces) {
        if (f.kind !== 'slope' || !f.poly2 || f.poly2.length < 3 || !f.coef) continue;
        const poly = f.poly2;
        let out = null;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i], q = poly[(i + 1) % poly.length];
          const op = offOf(p), oq = offOf(q);
          // the face's boundary edge just OUTSIDE the continued wall line, parallel to it
          if (op < 0.5 || op > maxOff || Math.abs(op - oq) > 1) continue;
          const dq = U.norm(U.sub(q, p));
          if (Math.abs(U.cross(dq, bDir)) > 0.02) continue;
          const o = (op + oq) / 2;                        // this edge's own rake/eave offset
          const b0 = b0raw - o, b1 = b1raw + o;           // band widened by the SAME offset past the side walls
          const tp = along(p), tq = along(q);
          const lo = Math.max(Math.min(tp, tq), b0), hi = Math.min(Math.max(tp, tq), b1);
          if (hi - lo < 2) continue;                      // no meaningful overlap with this face
          const sFirst = tp <= tq ? lo : hi, sLast = tp <= tq ? hi : lo;   // walk order p→q
          const ext = o + nt.depth;                       // step out to popoutFace + the same offset
          const P = (t, oo) => ({ x: nt.aPt.x + bDir.x * t + oN.x * oo, y: nt.aPt.y + bDir.y * t + oN.y * oo });
          const ins = [P(sFirst, o), P(sFirst, ext), P(sLast, ext), P(sLast, o)];
          out = poly.slice(0, i + 1);
          for (const v of ins) if (U.dist(out[out.length - 1], v) > 0.3) out.push(v);
          for (let k = i + 1; k < poly.length; k++) {
            const v = poly[k];
            if (U.dist(out[out.length - 1], v) > 0.3) out.push(v);
          }
          if (out.length > 3 && U.dist(out[0], out[out.length - 1]) < 0.3) out.pop();
          break;                                           // one step per face per notch
        }
        if (out && out.length >= 3 && !(HA.ringSelfIntersects && HA.ringSelfIntersects(out))) {
          f.poly2 = out;
          f.pts3 = out.map((p) => ({ x: p.x, y: p.y, z: f.coef.A * p.x + f.coef.B * p.y + f.coef.C }));
          f.maxZ = Math.max(...f.pts3.map((v) => v.z));
        }
      }
    }
    const slopeFaces = faces.filter((f) => f.kind === 'slope');
    if (!slopeFaces.length) return { ok: false, reason: 'Roof could not be generated.' };

    /* roof surface profile along a->b, from the tiled faces.
       COVERED-portion planes (the parts of a wall under the story above, which
       die at/below plate right at the exposed gable wall line) are excluded:
       they are physically under the upper story and must never define an exposed
       gable's peak. A run-end asymmetry (offsetPoly's loop-direction miter)
       lets a covered plane's polygon reach the gable peak on ONE end only —
       returning a sub-plate z that dropped the gable on that side while the
       symmetric end gabled fine. Filtering covered faces makes both ends pick up
       the genuine cross-slope (the same exclusion the gable re-partition already
       applies via `!edges[i].covered`). No-op on the main roof (nothing covered). */
    const profFaces = (() => {
      const exposed = slopeFaces.filter((f) => !(f.edge && f.edge.covered));
      return exposed.length ? exposed : slopeFaces;
    })();
    const roofProfile = (a, b) => {
      const ts = new Set([0, 1]);
      const segDir = U.sub(b, a);
      for (const f of profFaces) {
        const poly = f.poly2;
        for (let i = 0; i < poly.length; i++) {
          const hit = U.lineLine(a, segDir, poly[i], U.sub(poly[(i + 1) % poly.length], poly[i]));
          if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6 && hit.u > -1e-6 && hit.u < 1 + 1e-6)
            ts.add(hit.t);
        }
      }
      const zAt = (p) => {
        const f = profFaces.find((f) => U.pointInPoly(p, f.poly2));
        if (f) return hAt(f.coef, p);
        let bestF = null, bestD = Infinity;
        for (const f of profFaces) {
          const d = U.dist(p, U.polyCentroid(f.poly2));
          if (d < bestD) { bestD = d; bestF = f; }
        }
        return bestF ? hAt(bestF.coef, p) : null;
      };
      const out = [];
      for (const t of [...ts].sort((x, y) => x - y)) {
        const tEval = U.clamp(t === 0 ? t + 1e-4 : t === 1 ? t - 1e-4 : t, 0, 1);
        const z = zAt(U.lerp(a, b, tEval));
        if (z != null) out.push({ t, p: U.lerp(a, b, t), z });
      }
      return out;
    };

    // vertical gable faces at the wall's exterior surface
    for (const e of edges) {
      if (!e.gable) continue;
      const off = U.mul(e.inN, -HA.wallT(e.wall) / 2);
      const a = U.add(e.a, off), b = U.add(e.b, off);
      const env = roofProfile(a, b);
      if (!env.some((s) => s.z > plate + 0.25)) continue;
      const pts3 = [
        { x: a.x, y: a.y, z: plate },
        ...env.map((s) => ({ x: s.p.x, y: s.p.y, z: Math.max(s.z, plate) })),
        { x: b.x, y: b.y, z: plate },
      ];
      faces.push({ kind: 'gable', wallId: e.wall.id, edge: e, pts3 });
    }

    /* ---------- POP-OUT COVERED-WALL PEDIMENT INFILL (roof continuation) ----------
       The pop-out's own OUT/ALONG/BACK walls sit OUTBOARD of the continued gable plane and
       under the roof line that now runs straight across the gable end. They aren't in the
       skeleton loop, so emit a siding pediment (kind:'gable') on each — from the wall's own
       plate UP to the continued roof surface sampled at the wall's exterior face — reusing
       the exact roofProfile machinery (the stepped-gable siding look Steve asked for). The
       wall itself stays at plate; view3d fills plate→roofline with siding. Additive +
       fail-soft: any wall whose profile never rises above plate is skipped. */
    for (const w of (opts.popoutCovered || [])) {
      if (!w) continue;
      const A = HA.wallA(w), B = HA.wallB(w);
      if (!A || !B || U.dist(A, B) < 2) continue;
      const dEdge = U.norm(U.sub(B, A));
      const outN = { x: dEdge.y, y: -dEdge.x };                 // one plan normal (sign fixed below)
      // push to the EXTERIOR face: pick the normal pointing AWAY from the roof body (loop centroid)
      const cen = U.polyCentroid(loop.pts);
      const mid = U.lerp(A, B, 0.5);
      const oN = U.dot(outN, U.sub(mid, cen)) >= 0 ? outN : U.mul(outN, -1);
      const off = U.mul(oN, HA.wallT(w) / 2);
      const a = U.add(A, off), b = U.add(B, off);
      const wPlate = baseZ + (w.height || model.settings.wallHeight);
      const env = roofProfile(a, b);
      if (!env.some((s) => s.z > wPlate + 0.5)) continue;
      const pts3 = [
        { x: a.x, y: a.y, z: wPlate },
        ...env.map((s) => ({ x: s.p.x, y: s.p.y, z: Math.max(s.z, wPlate) })),
        { x: b.x, y: b.y, z: wPlate },
      ];
      // carry a minimal edge{a,b,dir,inN,wall} so the view3d gable-pediment renderer
      // (which reads edge.inN to orient the prism + rake boards) treats it like any pediment.
      const edge = { a: A, b: B, dir: dEdge, inN: U.mul(oN, -1), wall: w, gable: true, covered: true };
      faces.push({ kind: 'gable', wallId: w.id, popout: true, edge, pts3 });
    }

    /* ---------- variable-ceiling TRANSITION walls (Chief-style) ----------
       Two slope faces that share an edge but rise from DIFFERENT plates (walls set to
       different ceiling heights) leave a vertical STEP between their planes. Fill it with a
       wall quad so the roof reads as roof-over-roof, not a gap. ADDITIVE + plate-diff-gated:
       on a uniform-height roof every plate is equal → nothing is added (byte-identical). */
    {
      const slopeF = faces.filter((f) => f.kind === 'slope' && f.poly2 && f.coef && f.edge);
      const ovSeg = (a1, a2, b1, b2) => {            // collinear-overlap of edges a1→a2 & b1→b2
        const da = U.sub(a2, a1), la = Math.hypot(da.x, da.y); if (la < 1) return null;
        const u = { x: da.x / la, y: da.y / la };
        if (Math.abs(U.cross(u, U.sub(b1, a1))) > 0.75 || Math.abs(U.cross(u, U.sub(b2, a1))) > 0.75) return null;
        const t = (p) => U.dot(U.sub(p, a1), u);
        const t0 = Math.max(0, Math.min(t(b1), t(b2))), t1 = Math.min(la, Math.max(t(b1), t(b2)));
        if (t1 - t0 < 2) return null;
        return [U.add(a1, U.mul(u, t0)), U.add(a1, U.mul(u, t1))];
      };
      for (let i = 0; i < slopeF.length; i++) for (let j = i + 1; j < slopeF.length; j++) {
        const A = slopeF[i], B = slopeF[j];
        if (Math.abs((A.edge.plate || plate) - (B.edge.plate || plate)) < 0.5) continue;
        let ov = null;
        for (let ai = 0; ai < A.poly2.length && !ov; ai++) {
          const a1 = A.poly2[ai], a2 = A.poly2[(ai + 1) % A.poly2.length];
          for (let bi = 0; bi < B.poly2.length; bi++) {
            const o = ovSeg(a1, a2, B.poly2[bi], B.poly2[(bi + 1) % B.poly2.length]);
            if (o) { ov = o; break; }
          }
        }
        if (!ov) continue;
        const [p, q] = ov;
        const zAp = hAt(A.coef, p), zAq = hAt(A.coef, q), zBp = hAt(B.coef, p), zBq = hAt(B.coef, q);
        if (Math.max(Math.abs(zAp - zBp), Math.abs(zAq - zBq)) < 1) continue;   // planes meet → no step
        faces.push({
          kind: 'transition',
          wallId: ((A.edge.plate || plate) >= (B.edge.plate || plate) ? A : B).wallId,
          pts3: [
            { x: p.x, y: p.y, z: Math.min(zAp, zBp) }, { x: q.x, y: q.y, z: Math.min(zAq, zBq) },
            { x: q.x, y: q.y, z: Math.max(zAq, zBq) }, { x: p.x, y: p.y, z: Math.max(zAp, zBp) },
          ],
        });
      }
    }

    /* ---------- dormers ---------- */
    const dormers = [];
    for (const d of (opts.withDormers === false ? [] : roof.dormers || [])) {
      const wallFaces = slopeFaces.filter((f) => f.wallId === d.wallId);
      if (!wallFaces.length) continue;
      const e = wallFaces[0].edge;
      const ex = e.dir, ny = e.inN;
      const base = U.add(e.a, U.mul(ex, d.offset));
      const probe = U.add(base, U.mul(ny, Math.max(12, d.inset) + 6));
      const face =
        wallFaces.find((f) => U.pointInPoly(probe, f.poly2)) || wallFaces[0];
      const P = (u, v) => U.add(base, U.add(U.mul(ex, u), U.mul(ny, v)));
      const P3 = (u, v, z) => { const p = P(u, v); return { x: p.x, y: p.y, z }; };
      const w = Math.max(36, d.width);
      const d0 = Math.max(12, d.inset);
      const zf = plate + slope * d0;
      let sideH = Math.max(26, d.sideH || 48);
      let zR = zf + sideH + (w / 2) * slope;
      const lid = Math.max(...wallFaces.map((f) => f.maxZ)) - 2;
      if (zR > lid) { sideH -= zR - lid; zR = lid; }
      if (sideH < 22) continue;
      const zE = zf + sideH;
      const dE = (zE - plate) / slope;
      const dR = (zR - plate) / slope;
      const zLow = zf - 6;
      const fOv = 7;

      // window cut in the FRONT wall (adjustable, clamped to the wall)
      let win = null;
      if (d.window !== false) {
        const ww = U.clamp(d.winW || w - 28, 14, w - 10);
        const sill = U.clamp(d.sill == null ? 8 : d.sill, 2, sideH - 14);
        const wh = U.clamp(d.winH || sideH - 16, 12, sideH - sill - 4);
        win = {
          u: ex, n: ny, base, w: ww, h: wh,
          sillZ: zf + sill, faceV: d0,
        };
      }

      const parts = [];
      const front = [
        P3(-w / 2, d0, zLow), P3(w / 2, d0, zLow),
        P3(w / 2, d0, zE), P3(0, d0, zR), P3(-w / 2, d0, zE),
      ];
      const frontHoles = win
        ? [[
            P3(-win.w / 2, d0, win.sillZ), P3(win.w / 2, d0, win.sillZ),
            P3(win.w / 2, d0, win.sillZ + win.h), P3(-win.w / 2, d0, win.sillZ + win.h),
          ]]
        : [];
      parts.push({ kind: 'dormer-wall', pts3: front, thick: 4, holes: frontHoles });
      for (const s of [-1, 1]) {
        parts.push({
          kind: 'dormer-wall', thick: 3,
          pts3: s > 0
            ? [P3(s * w / 2, d0, zLow), P3(s * w / 2, d0, zE), P3(s * w / 2, dE, zE)]
            : [P3(s * w / 2, dE, zE), P3(s * w / 2, d0, zE), P3(s * w / 2, d0, zLow)],
        });
      }
      const rw = w / 2 + 5;
      for (const s of [-1, 1]) {
        const zEdge = zR - rw * slope;
        const dEdge = (Math.max(zEdge, plate + 1) - plate) / slope;
        const quad = [
          P3(0, d0 - fOv, zR),
          P3(s * rw, d0 - fOv, zEdge),
          P3(s * rw, Math.max(dEdge, d0 - fOv + 1), zEdge),
          P3(0, dR, zR),
        ];
        parts.push({ kind: 'dormer-roof', pts3: s > 0 ? quad : quad.slice().reverse(), thick: 5 });
      }
      dormers.push({
        id: d.id, ref: d, parts, win, face, frame: { base, ex, ny },
        w, d0, dE, dR, zLow, zE, zR, fOv, slope,
      });
    }

    // lower roofs: shed the faces hidden under the story above
    const kept = opts.coveredFn
      ? faces.filter((f) => !(f.edge && f.edge.covered))
      : faces;
    return { ok: true, loop, over, faces: kept, dormers, slope, plate, baseZ };
  };

  /* split lower-loop edges wherever the upper footprint boundary meets
     them, so coverage is decided per sub-edge (handles walls that run
     past the upper story) */
  const refineLoopAgainst = (loop, upperPts) => {
    const pts = [], walls = [];
    const n = loop.pts.length;
    for (let i = 0; i < n; i++) {
      const a = loop.pts[i], b = loop.pts[(i + 1) % n];
      const wall = loop.walls[i];
      const seg = U.sub(b, a);
      const ts = new Set();
      for (let j = 0; j < upperPts.length; j++) {
        const q = upperPts[j];
        // upper vertices lying on this edge
        const t = U.projT(q, a, b);
        if (t > 0.01 && t < 0.99 && U.dist(q, U.lerp(a, b, t)) < 1.5) ts.add(Math.round(t * 1000) / 1000);
        // upper edges crossing this edge
        const hit = U.lineLine(a, seg, q, U.sub(upperPts[(j + 1) % upperPts.length], q));
        if (hit && hit.t > 0.01 && hit.t < 0.99 && hit.u > -0.001 && hit.u < 1.001)
          ts.add(Math.round(hit.t * 1000) / 1000);
      }
      const sorted = [0, ...[...ts].sort((x, y) => x - y)];
      for (const t of sorted) {
        pts.push(U.lerp(a, b, t));
        walls.push(wall);
      }
    }
    return { pts, walls };
  };

  /* ---------- SHED (mono-pitch) roof over one loop ----------
     A TRUE single-plane shed: ONE slope face over the whole exterior loop,
     LOW at the front eave and rising toward the high (back) side at the roof
     pitch. Unlike buildOn (a straight-skeleton hip/gable engine that tiles many
     faces), a shed is one plane z(p)=plate+slope·dot(p-loEave, hiDir), so we
     bypass the skeleton entirely and emit:
       • ONE kind:'slope' face over the eave/rake overhang polygon, edge=the LOW
         eave (dir/inN/wall) so framing runs rafters LOW→HIGH and solar reads the
         single azimuth/tilt off coef.
       • kind:'gable' faces on the two RAKE walls (the sloped-top sides) — a
         trapezoid plate→sloping-roof-underside — and on the HIGH back wall — a
         plate→level-high rectangle. view3d turns these into the pediment wall
         infill + rake/barge trim (the walls "read taller"). The LOW front wall's
         top is level at plate, so its gable is degenerate and correctly skipped.
     hiDir (unit vector the plane rises toward) comes from model.roof.shedDir
     ('n'|'s'|'e'|'w'), else the BACK direction (opposite model.site.frontEdge),
     else the loop's LONGER axis. Overhangs: roof.overhang on eave (low/high)
     sides, effRake on the two rake sides. */
  const buildShed = (model, loop, baseZ, opts) => {
    opts = opts || {};
    const roof = model.roof;
    if (!loop || !loop.pts || loop.pts.length < 3)
      return { ok: false, reason: 'Exterior walls must form one closed loop.' };
    const n = loop.pts.length;
    const slope = (opts.pitch != null) ? Math.max(0.03, opts.pitch) : Math.max(0.5, roof.pitch) / 12;
    const plate = baseZ + Math.max(...loop.walls.map((w) => w.height || model.settings.wallHeight));

    // ----- pick the high-side direction hiDir (plane rises toward +hiDir) -----
    // model.roof.shedDir overrides; screen convention is +x=E, -y=N (see the
    // dev-roof azimuth tests), so N=-y, S=+y, E=+x, W=-x.
    const DIRV = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } };
    let hiDir = null;
    const sd = (roof.shedDir || '').toString().toLowerCase();
    if (DIRV[sd]) hiDir = DIRV[sd];
    if (!hiDir && model.site && Number.isInteger(model.site.frontEdge) &&
        Array.isArray(model.site.lot) && model.site.lot.length >= 3) {
      // BACK = INWARD normal of the front lot edge (opposite the street) → high there.
      const lot = model.site.lot, fi = model.site.frontEdge % lot.length;
      const a = lot[fi], b = lot[(fi + 1) % lot.length];
      const outN = U.edgeOutNormal(lot, fi);
      if (outN && isFinite(outN.x)) hiDir = U.norm({ x: -outN.x, y: -outN.y });
    }
    if (!hiDir) {
      // fall back to the loop's LONGER axis (ridge along the long side → shed rises
      // across the long span). Bounding box longer dim decides.
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const p of loop.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      hiDir = (maxX - minX) >= (maxY - minY) ? { x: 1, y: 0 } : { x: 0, y: 1 };
    }
    hiDir = U.norm(hiDir);

    // ----- classify each wall: LOW eave, HIGH eave, or RAKE side -----
    // A wall's outward normal ~ +hiDir → HIGH; ~ -hiDir → LOW; ~ perpendicular → RAKE.
    const effRake = (w) => Math.max(roof.rake, HA.wallT(w) / 2 + 2);
    const cls = [];       // per edge: 'low' | 'high' | 'rake'
    for (let i = 0; i < n; i++) {
      const outN = U.edgeOutNormal(loop.pts, i);
      const d = U.dot(outN, hiDir);
      cls.push(d > 0.5 ? 'high' : d < -0.5 ? 'low' : 'rake');
    }
    // must have at least one LOW eave to anchor the plane (the shed's downhill edge)
    if (!cls.includes('low')) {
      // hiDir landed diagonal to every wall — snap it to the nearest wall-normal axis
      // so a rectangular footprint always resolves cleanly.
      let best = null, bd = -1;
      for (let i = 0; i < n; i++) { const oN = U.edgeOutNormal(loop.pts, i); const dd = Math.abs(U.dot(oN, hiDir)); if (dd > bd) { bd = dd; best = oN; } }
      if (best) { hiDir = U.dot(best, hiDir) >= 0 ? U.norm(best) : U.norm({ x: -best.x, y: -best.y }); }
      for (let i = 0; i < n; i++) { const d = U.dot(U.edgeOutNormal(loop.pts, i), hiDir); cls[i] = d > 0.5 ? 'high' : d < -0.5 ? 'low' : 'rake'; }
      if (!cls.includes('low')) return { ok: false, reason: 'Shed roof needs a clear low eave; footprint too irregular.' };
    }

    // ----- the LOW eave: reference wall for edge{a,b,dir,inN,wall} -----
    let loIdx = -1, loLen = -1;
    for (let i = 0; i < n; i++) {
      if (cls[i] !== 'low') continue;
      const L = U.dist(loop.pts[i], loop.pts[(i + 1) % n]);
      if (L > loLen) { loLen = L; loIdx = i; }
    }
    const loWall = loop.walls[loIdx];
    const loA = loop.pts[loIdx], loB = loop.pts[(loIdx + 1) % n];
    const loInN = U.mul(U.edgeOutNormal(loop.pts, loIdx), -1);

    // ----- offset the loop OUTWARD (overhang on eaves, rake on sides) -----
    const dists = loop.walls.map((w, i) => cls[i] === 'rake' ? effRake(w) : roof.overhang);
    const over = U.offsetPoly(loop.pts, dists);
    if (!over || over.length !== n) return { ok: false, reason: 'Roof solver failed on this footprint.' };

    // ----- the single plane: z rises at `slope` along hiDir, BEARING on the plates -----
    // Anchor C so the plane CLEARS every wall's own top plate and BEARS on the
    // governing one (the most-forward-along-hiDir / tallest combination). The old
    // anchor (plate at the LONGEST low wall's line) broke on composed L/T loops:
    // a wing projecting FORWARD of that wall had its plate ABOVE the plane (the
    // wall poked through the roof — "doesn't sit on the top plates"), and mixed
    // wall heights floated the plane off shorter walls. Per wall: the plane must
    // be >= its top along its whole run ⇔ C >= top − slope·min(dot at endpoints);
    // take the max so at least one plate bears exactly and none poke.
    const topW = (w) => baseZ + (w.height || model.settings.wallHeight);
    let C = -Infinity;
    for (let i = 0; i < n; i++) {
      const dMin = Math.min(U.dot(hiDir, loop.pts[i]), U.dot(hiDir, loop.pts[(i + 1) % n]));
      C = Math.max(C, topW(loop.walls[i]) - slope * dMin);
    }
    if (!isFinite(C)) C = plate - slope * U.dot(hiDir, loA);   // fail-soft: old anchor
    const coef = { A: slope * hiDir.x, B: slope * hiDir.y, C };
    const hAt = (p) => coef.A * p.x + coef.B * p.y + coef.C;
    const poly2 = over.slice();
    if (U.polyArea(poly2) < 0) poly2.reverse();   // CCW → 3D normal points up
    const pts3 = poly2.map((p) => ({ x: p.x, y: p.y, z: hAt(p) }));
    const faces = [{
      kind: 'slope',
      wallId: loWall.id,
      edge: { a: loA, b: loB, dir: U.norm(U.sub(loB, loA)), inN: loInN, wall: loWall, gable: false, covered: false },
      coef, poly2, pts3,
      maxZ: Math.max(...pts3.map((p) => p.z)),
      shed: true,
    }];

    // ----- tall wall infill (kind:'gable') on EVERY wall the plane rises above -----
    // Emitted at the wall EXTERIOR face, from the wall's OWN top plate up to the
    // roof underside, so view3d builds the pediment wall + rake/barge trim and the
    // walls read taller. Do NOT skip by class: on a composed L/T loop a SECOND
    // 'low'-facing wall sits INBOARD of the anchor eave with the plane feet above
    // it — skipping 'low' left a wall-to-roof OPEN GAP there (owner's modern-mono
    // + garage: a dark 56" band along the front). The true bearing wall is skipped
    // naturally by the nothing-taller-than-plate guard. Bottom at the wall's OWN
    // top (not the global max plate) so shorter walls get a full-height infill.
    for (let i = 0; i < n; i++) {
      const w = loop.walls[i];
      const wTop = topW(w);
      const eOut = U.edgeOutNormal(loop.pts, i);
      const off = U.mul(eOut, HA.wallT(w) / 2);         // push to the exterior face
      const a = U.add(loop.pts[i], off), b = U.add(loop.pts[(i + 1) % n], off);
      const za = hAt(a), zb = hAt(b);
      if (za <= wTop + 0.25 && zb <= wTop + 0.25) continue;   // plane at/below this wall's top
      const pts3g = [
        { x: a.x, y: a.y, z: wTop },
        { x: a.x, y: a.y, z: Math.max(za, wTop) },
        { x: b.x, y: b.y, z: Math.max(zb, wTop) },
        { x: b.x, y: b.y, z: wTop },
      ];
      // classify this infill edge so view3d can build UNIFORM trim: a shed gets a
      // LEVEL fascia across the HIGH edge (rectangular infill, level top) and raking
      // BARGE boards up the two RAKE sides (trapezoid infill, sloped top). A wall
      // whose top edge is (near-)level at high z is a HIGH edge; one that climbs is a
      // RAKE. (The LOW eave never emits an infill.) Steve: "side trim fascia isn't
      // same all around … the high side + rakes get different/missing treatment."
      const dCl = U.dot(eOut, hiDir);
      const shedCls = dCl > 0.5 ? 'high' : (Math.abs(za - zb) < 1 ? 'high' : 'rake');
      faces.push({
        kind: 'gable', wallId: w.id, shedCls,
        edge: { a: loop.pts[i], b: loop.pts[(i + 1) % n], dir: U.norm(U.sub(loop.pts[(i + 1) % n], loop.pts[i])), inN: U.mul(eOut, -1), wall: w, gable: true, covered: false },
        pts3: pts3g, shed: true,
      });
    }

    return { ok: true, loop, over, faces, dormers: [], slope, plate, baseZ, shed: true, hiDir, shedCoef: coef };
  };
  HA._buildShed = buildShed;   // test hook

  /* ---------- STYLED analytic roofs: GAMBREL / DUTCH GABLE / BUTTERFLY ----------
     Additive style options for single homes, built the same way buildShed is: an
     ANALYTIC plane layout over the exterior loop instead of the straight skeleton.
     A frame is set from the LONGEST wall run (ax = ridge axis, py = across-span);
     u = across-coordinate, v = along-coordinate. Each style is a piecewise-planar
     height function whose regions are recovered by half-plane clipping of the
     overhang polygon, so faces tile it exactly (plan-area conserving) and honest
     overhangs fall straight out of z(p) continuing past the wall line:
       GAMBREL    — classic barn profile: steep lower pair (2.2x pitch, capped) up
                    to a pitch break at HALF the half-span, shallow upper pair
                    (0.5x pitch) to a level ridge; vertical pediment ends.
       DUTCH GABLE— hip base whose end planes are CAPPED at half the hip rise;
                    above that a small vertical GABLET triangle at each end while
                    the side planes run through to the full ridge.
       BUTTERFLY  — inverted gable: two planes drain INWARD to a level central
                    valley AT the plate (so no wall ever pokes through the roof);
                    perimeter walls get shed-style infill up to the raised eaves.
     Fail-soft: any degeneracy returns ok:false and buildRoof falls back to the
     skeleton path — a styled preset can never leave a building roofless. */
  const clipHalf = (poly, fn) => {
    // Sutherland–Hodgman: keep the region where fn(p) >= 0
    const out = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const fa = fn(a), fb = fn(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out.length >= 3 ? out : null;
  };
  const buildStyled = (model, loop, baseZ, style) => {
    const roof = model.roof;
    if (!loop || !loop.pts || loop.pts.length < 3)
      return { ok: false, reason: 'Exterior walls must form one closed loop.' };
    const pts = loop.pts, n = pts.length;
    // frame: ridge axis = the LONGEST exterior wall run; py = across the span
    let ax = { x: 1, y: 0 }, bl = -1;
    for (let i = 0; i < n; i++) {
      const L = U.dist(pts[i], pts[(i + 1) % n]);
      if (L > bl) { bl = L; ax = U.norm(U.sub(pts[(i + 1) % n], pts[i])); }
    }
    const py = { x: -ax.y, y: ax.x };
    const dU = (p) => p.x * py.x + p.y * py.y, dV = (p) => p.x * ax.x + p.y * ax.y;
    let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
    for (const p of pts) {
      const u = dU(p), v = dV(p);
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
    const uc = (uMin + uMax) / 2, halfSpan = (uMax - uMin) / 2;
    const vc = (vMin + vMax) / 2, halfLen = (vMax - vMin) / 2;
    if (halfSpan < 24) return { ok: false, reason: 'Footprint too narrow for a styled roof.' };
    const slope = Math.max(0.5, roof.pitch) / 12;
    const plate = baseZ + Math.max(...loop.walls.map((w) => w.height || model.settings.wallHeight));
    const topW = (w) => baseZ + (w.height || model.settings.wallHeight);
    // overhang polygon: eave overhang on the across-facing walls, rake on the ends
    const effRake = (w) => Math.max(roof.rake, HA.wallT(w) / 2 + 2);
    const dists = loop.walls.map((w, i) => {
      const oN = U.edgeOutNormal(pts, i);
      return Math.abs(oN.x * py.x + oN.y * py.y) > 0.5 ? roof.overhang : effRake(w);
    });
    const over = U.offsetPoly(pts, dists);
    if (!over || over.length !== n || over.some((p) => !p || !isFinite(p.x) || !isFinite(p.y)))
      return { ok: false, reason: 'Roof solver failed on this footprint.' };
    const clipAll = (fns) => { let p = over; for (const f of fns) p = p && clipHalf(p, f); return p; };
    // reference wall on a given outward side (longest whose normal agrees)
    const pickWall = (dir) => {
      let best = loop.walls[0], bd = -1;
      for (let i = 0; i < n; i++) {
        const oN = U.edgeOutNormal(pts, i);
        if (oN.x * dir.x + oN.y * dir.y > 0.6) {
          const L = U.dist(pts[i], pts[(i + 1) % n]);
          if (L > bd) { bd = L; best = loop.walls[i]; }
        }
      }
      return best;
    };
    const faces = [];
    const mkSlope = (poly2, coef, dirOut) => {
      if (!poly2 || Math.abs(U.polyArea(poly2)) < 4) return null;
      if (U.polyArea(poly2) < 0) poly2 = poly2.slice().reverse();   // CCW -> normal up
      const w = pickWall(dirOut);
      const wa = HA.wallA(w), wb = HA.wallB(w);
      const inN = U.norm({ x: coef.A, y: coef.B });   // uphill = the plane's "inward"
      const pts3 = poly2.map((p) => ({ x: p.x, y: p.y, z: coef.A * p.x + coef.B * p.y + coef.C }));
      const f = {
        kind: 'slope', wallId: w.id,
        edge: { a: wa, b: wb, dir: U.norm(U.sub(wb, wa)), inN, wall: w, gable: false, covered: false },
        coef, poly2, pts3, maxZ: Math.max(...pts3.map((p) => p.z)), styled: style,
      };
      faces.push(f);
      return f;
    };
    // shed-style wall infill (kind:'gable') wherever the roof surface hAt rises
    // above a wall's own top plate; uBreaks inserts profile kinks (pitch break /
    // ridge / valley crossings) so the pediment follows the styled silhouette.
    const emitInfill = (hAt, uBreaks) => {
      for (let i = 0; i < n; i++) {
        const w = loop.walls[i], wTop = topW(w);
        const eOut = U.edgeOutNormal(pts, i);
        const off = U.mul(eOut, HA.wallT(w) / 2);   // at the wall exterior face
        const A0 = U.add(pts[i], off), B0 = U.add(pts[(i + 1) % n], off);
        const uA = dU(A0), uB = dU(B0);
        const ts = [0, 1];
        for (const ub of uBreaks) if ((uA - ub) * (uB - ub) < 0) ts.push((ub - uA) / (uB - uA));
        ts.sort((a, b) => a - b);
        const line = ts.map((t) => U.lerp(A0, B0, t));
        const zs = line.map((p) => hAt(p));
        if (!zs.some((z) => z > wTop + 0.25)) continue;   // roof at/below this wall's top
        const pts3g = [
          { x: line[0].x, y: line[0].y, z: wTop },
          ...line.map((p, k) => ({ x: p.x, y: p.y, z: Math.max(zs[k], wTop) })),
          { x: line[line.length - 1].x, y: line[line.length - 1].y, z: wTop },
        ];
        faces.push({
          kind: 'gable', wallId: w.id,
          edge: { a: pts[i], b: pts[(i + 1) % n], dir: U.norm(U.sub(pts[(i + 1) % n], pts[i])), inN: U.mul(eOut, -1), wall: w, gable: true, covered: false },
          pts3: pts3g, styled: style,
        });
      }
    };
    const done = (mainSlope) =>
      ({ ok: true, loop, over, faces, dormers: [], slope: mainSlope, plate, baseZ, styled: style });

    if (style === 'gambrel') {
      const sLow = Math.min(3.5, slope * 2.2), sUp = Math.max(0.12, slope * 0.5);
      const bu = halfSpan / 2;                        // pitch break, in from the eave
      const zBreak = plate + sLow * (halfSpan - bu);
      let slopes = 0;
      for (const s of [1, -1]) {
        const du = (p) => s * (dU(p) - uc);
        // lower steep plane: z = plate + sLow*(halfSpan - du)
        const cLow = { A: -sLow * s * py.x, B: -sLow * s * py.y, C: plate + sLow * halfSpan + sLow * s * uc };
        // upper shallow plane: z = zBreak + sUp*(bu - du)
        const cUp = { A: -sUp * s * py.x, B: -sUp * s * py.y, C: zBreak + sUp * bu + sUp * s * uc };
        if (mkSlope(clipAll([(p) => du(p) - bu]), cLow, U.mul(py, s))) slopes++;
        if (mkSlope(clipAll([du, (p) => bu - du(p)]), cUp, U.mul(py, s))) slopes++;
      }
      if (slopes !== 4) return { ok: false, reason: 'Gambrel needs a clear two-sided span.' };
      const hAt = (p) => {
        const a = Math.abs(dU(p) - uc);
        return a >= bu ? plate + sLow * (halfSpan - a) : zBreak + sUp * (bu - a);
      };
      emitInfill(hAt, [uc - bu, uc, uc + bu]);
      return done(sLow);
    }

    if (style === 'butterfly') {
      let slopes = 0;
      for (const s of [1, -1]) {
        // z = plate + slope*(s*(u-uc)): level valley AT plate on the centerline,
        // rising outward to the high eaves (honest inverted overhang past the wall)
        const coef = { A: slope * s * py.x, B: slope * s * py.y, C: plate - slope * s * uc };
        if (mkSlope(clipAll([(p) => s * (dU(p) - uc)]), coef, U.mul(py, s))) slopes++;
      }
      if (slopes !== 2) return { ok: false, reason: 'Butterfly needs a clear two-sided span.' };
      emitInfill((p) => plate + slope * Math.abs(dU(p) - uc), [uc]);
      return done(slope);
    }

    if (style === 'dutchgable') {
      const dG = halfSpan * 0.5;                      // gablet base at HALF the hip rise
      if (halfLen <= dG + 12) return { ok: false, reason: 'Footprint too short for a dutch gable.' };
      const zG = plate + slope * dG, apexZ = plate + slope * halfSpan;
      const gLine = halfLen - dG;                     // |v-vc| of the gablet wall line
      const gw = halfSpan - dG;                       // gablet base half-width
      let sides = 0;
      for (const s of [1, -1]) {
        // side plane z = plate + slope*(halfSpan - du); three clipped pieces that
        // mergeRoofPlanes reunites (same coef object): the central strip between the
        // gablet lines runs full to the ridge; each end piece stops at the hip line.
        const coef = { A: -slope * s * py.x, B: -slope * s * py.y, C: plate + slope * halfSpan + slope * s * uc };
        const du = (p) => s * (dU(p) - uc);
        if (mkSlope(clipAll([du, (p) => gLine - (dV(p) - vc), (p) => gLine + (dV(p) - vc)]), coef, U.mul(py, s))) sides++;
        for (const e of [1, -1])
          mkSlope(clipAll([du, (p) => e * (dV(p) - vc) - gLine,
            (p) => du(p) - (halfSpan - halfLen + e * (dV(p) - vc))]), coef, U.mul(py, s));
      }
      if (sides !== 2) return { ok: false, reason: 'Dutch gable needs a clear two-sided span.' };
      for (const e of [1, -1]) {
        // hip END plane z = plate + slope*(halfLen - bv), truncated AT the gablet base
        const coefE = { A: -slope * e * ax.x, B: -slope * e * ax.y, C: plate + slope * halfLen + slope * e * vc };
        const bv = (p) => e * (dV(p) - vc);
        mkSlope(clipAll([(p) => bv(p) - gLine,
          (p) => (halfSpan - (dU(p) - uc)) - (halfLen - bv(p)),
          (p) => (halfSpan + (dU(p) - uc)) - (halfLen - bv(p))]), coefE, U.mul(ax, e));
        // vertical GABLET triangle: base at zG on the gablet line, apex at the ridge
        const vg = vc + e * gLine;
        const P = (u) => ({ x: u * py.x + vg * ax.x, y: u * py.y + vg * ax.y });
        const p1 = P(uc - gw), p2 = P(uc), p3 = P(uc + gw);
        const wE = pickWall(U.mul(ax, e));
        faces.push({
          kind: 'gable', wallId: wE.id, gablet: true,
          edge: { a: p1, b: p3, dir: U.norm(U.sub(p3, p1)), inN: U.mul(ax, -e), wall: wE, gable: true, covered: false },
          pts3: [{ x: p1.x, y: p1.y, z: zG }, { x: p2.x, y: p2.y, z: apexZ }, { x: p3.x, y: p3.y, z: zG }],
          styled: style,
        });
      }
      return done(slope);
    }

    return { ok: false, reason: 'Unknown roof style.' };
  };
  HA._buildStyled = buildStyled;   // test hook
  const STYLED_ROOFS = { gambrel: 1, butterfly: 1, dutchgable: 1 };

  /* ---------- 1x12 BELLY BAND at the story transition ----------
     Steve (2-story mono redline): "has a black line around; on non-stucco
     2-story houses we put a 1x12 rim all around, makes it look better."
     Pure GEOMETRY helper (view3d renders it; dev tests assert it): for every
     upper story, one band segment per exterior wall whose cladding is a SIDING
     family (lap/batten/wood — same set as the corner boards). The board is a
     1x12 (11.25" face, 0.75" thick) CENTERED on the platform band (the 13"
     joist+subfloor zone between the lower plate and the upper floor), laid at
     the wall OUTER face along the upper loop, segments sharing corner points so
     they miter and butt into the full-height corner boards. STUCCO/masonry
     walls get NO segment — their skin runs continuous through the band
     (the platform rim is already skinned course-aligned by _bandSkin). */
  HA.bellyBandSegments = (model) => {
    const out = [];
    try {
      const pd = (model.settings && model.settings.platformDepth) || 13;
      const FACE = 11.25, THICK = 0.75;
      const SIDED = ['lap', 'batten', 'wood'];
      // LOWER-ROOF CLIP (Steve: two 1x12 slivers laid ON TOP of the garage-roof
      // shingles at floor-band height): where a lower roof (garage/porch wing)
      // rises against the upper wall ABOVE the band bottom, the band must STOP —
      // emit only the runs where the wall face is exposed. The lower-roof SKIN
      // TOP (rafter plane + rt·√(1+s²)) is sampled 1" outside the wall face; a
      // run is covered when that skin top reaches the band bottom.
      const rt = Math.max(4, (model.roof && model.roof.thickness) || 8);
      let lrs = [];
      try { lrs = (model.roof && model.roof.enabled !== false && HA.buildLowerRoofs) ? HA.buildLowerRoofs(model) : []; } catch (e) { lrs = []; }
      const lrFaces = [];
      for (const lr of lrs) {
        if (!lr || !lr.ok) continue;
        for (const f of lr.faces) {
          if (f.kind !== 'slope' || !f.poly2 || !f.coef) continue;
          const lift = rt * Math.sqrt(1 + f.coef.A * f.coef.A + f.coef.B * f.coef.B);
          lrFaces.push({ poly2: f.poly2, coef: f.coef, lift });
        }
      }
      const roofSkinZ = (p) => {   // highest lower-roof skin TOP at plan point p (null if none)
        let z = null;
        for (const f of lrFaces) {
          if (!U.pointInPoly(p, f.poly2)) continue;
          const v = f.coef.A * p.x + f.coef.B * p.y + f.coef.C + f.lift;
          if (z == null || v > z) z = v;
        }
        return z;
      };
      for (let li = 1; li < model.levels.length; li++) {
        const loop = HA.exteriorLoop(model, li);
        if (!loop || !loop.pts || loop.pts.length < 3 || !loop.walls) continue;
        const elev = HA.levelElev(model, li);
        const outer = U.offsetPoly(loop.pts, loop.walls.map((w) => HA.wallT(w) / 2));
        if (!outer || outer.length !== loop.pts.length) continue;
        const n = outer.length;
        const y0 = elev - pd / 2 - FACE / 2, y1 = elev - pd / 2 + FACE / 2;
        for (let i = 0; i < n; i++) {
          const w = loop.walls[i];
          const kind = (HA.wallMaterial && w) ? HA.wallMaterial(model, w).kind : 'lap';
          if (!SIDED.includes(kind)) continue;    // stucco/brick: continuous skin, no band
          const A = outer[i], B = outer[(i + 1) % n];
          const L = U.dist(A, B);
          if (L < 2) continue;
          const eOut = U.edgeOutNormal(outer, i);
          const push = (a, b) => {
            if (U.dist(a, b) < 8) return;         // sub-run too short for a board
            out.push({ a, b, out: eOut, y0, y1, face: FACE, thick: THICK, wallId: w && w.id, lvl: li });
          };
          if (!lrFaces.length) { push(A, B); continue; }
          // exposure test just OUTSIDE the wall face (where the roof skirt would be)
          const exposedAt = (t) => {
            const p = U.lerp(A, B, t / L);
            const z = roofSkinZ({ x: p.x + eOut.x * 1, y: p.y + eOut.y * 1 });
            return z == null || z < y0 - 0.25;
          };
          const STEP = 3;
          const cut = (tA, tB) => {              // bisect the exposure crossing to ~0.1"
            let lo = tA, hi = tB; const eLo = exposedAt(tA);
            for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2; if (exposedAt(mid) === eLo) lo = mid; else hi = mid; }
            return (lo + hi) / 2;
          };
          let runStart = exposedAt(0) ? 0 : null;
          let tPrev = 0, expPrev = runStart != null;
          for (let t = STEP; t <= L + STEP; t += STEP) {
            const tc = Math.min(t, L);
            const exp = exposedAt(tc);
            if (exp !== expPrev) {
              const tx = cut(tPrev, tc);
              if (expPrev && runStart != null) { push(U.lerp(A, B, runStart / L), U.lerp(A, B, tx / L)); runStart = null; }
              else runStart = tx;
              expPrev = exp;
            }
            tPrev = tc;
            if (tc >= L) break;
          }
          if (expPrev && runStart != null) push(U.lerp(A, B, runStart / L), B);
        }
      }
    } catch (e) { /* additive helper — never breaks the caller */ }
    return out;
  };

  /* merge COLLINEAR loop joints for the ROOF SOLVER only. The generator now
     SPLITS a flush garage front out of the collinear house front so the dropped-
     garage chain keeps its dedicated wall — but the straight skeleton mishandles
     collinear vertices (degenerate bisectors dropped a whole face: 33% of the
     plan unskinned on true-flush rolls). Walls stay split in the model; the roof
     sees one straight edge. Merge only equal-height neighbours; the representative
     wall is the LONGER half; gable = OR (the pre-split single-edge semantics —
     a flush front gable legitimately spans the garage under the same pediment). */
  const mergeCollinearLoop = (loop) => {
    if (!loop || !loop.pts || loop.pts.length < 4) return loop;
    const pts = loop.pts.slice(), walls = loop.walls.slice();
    let guard = pts.length + 4;
    for (let i = 0; i < pts.length && pts.length > 3 && guard-- > 0;) {
      const p = pts[(i - 1 + pts.length) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length];
      const d1 = U.norm(U.sub(c, p)), d2 = U.norm(U.sub(n, c));
      if (Math.abs(U.cross(d1, d2)) < 1e-4 && U.dot(d1, d2) > 0.99) {
        const wi = (i - 1 + walls.length) % walls.length;
        const wa = walls[wi], wb = walls[i];
        /* R192: merge DIFFERENT-height neighbours too — the "historical
           per-edge path" for unequal collinear plates never actually worked
           (the skeleton's degenerate bisectors DROPPED those faces, one per
           line: dev-rooms-test 14, zero transitions). The skeleton now always
           sees one clean line; pushSlope re-divides the returned face by the
           ORIGINAL spans' own plates (opts._origLoop). Gable mismatches still
           stay split — the gable machinery is genuinely per-edge. */
        if (!!(wa && wa.gable) === !!(wb && wb.gable)) {
          const keep = (HA.wallLen(wa) >= HA.wallLen(wb)) ? wa : wb;
          walls[wi] = keep;
          pts.splice(i, 1); walls.splice(i, 1);
          i = 0; continue;
        }
      }
      i++;
    }
    return { pts, walls };
  };
  HA._mergeCollinearLoop = mergeCollinearLoop;   // test hook

  /* ---------- public: the main roof (topmost closed story) ---------- */
  HA.buildRoof = (model) => {
    const lvlIdx = HA.roofLevelIdx(model);
    const rawLoop = HA.exteriorLoop(model, lvlIdx);   // pre-merge: per-span plates (R192)
    const loop = mergeCollinearLoop(rawLoop);
    const baseZ = HA.levelElev(model, lvlIdx);
    // TRUE shed (mono-pitch single plane) when the roof style is 'shed'.
    if (model.roof && model.roof.style === 'shed') {
      const rs = buildShed(model, loop, baseZ);
      rs.lvlIdx = lvlIdx;
      if (rs.ok) applyRoofOverrides(rs.faces, model);
      return rs;
    }
    // STYLED analytic roofs (gambrel / dutch gable / butterfly). Fail-soft: any
    // degeneracy falls through to the skeleton path — never roofless.
    if (model.roof && STYLED_ROOFS[model.roof.style]) {
      let rs = null;
      try { rs = buildStyled(model, loop, baseZ, model.roof.style); } catch (e) { rs = null; }
      if (rs && rs.ok) {
        rs.lvlIdx = lvlIdx;
        applyRoofOverrides(rs.faces, model);
        return rs;
      }
    }

    // POP-OUT CONTINUATION (skeleton path only; default ON): derive a simplified ROOF
    // loop that straightens shallow gable-end pop-outs so the roof line continues across
    // them, with the pop-out walls carried as covered pediment infill. Any skeleton
    // failure with the simplified loop falls back to the unsimplified loop (fail-soft).
    let simplified = null;
    if (loop && (!model.roof || model.roof.continuePopouts !== false)) {
      try {
        const wh = model.settings.wallHeight;
        simplified = HA.continueRoofPopouts(loop, { plateOf: (w) => (w && w.height) || wh });
      } catch (e) { simplified = null; }
    }
    if (simplified) {
      // reconstruct the derived loop's per-edge gable flag from gableIdx
      const dl = { pts: simplified.pts, walls: simplified.walls };
      const gset = simplified.gableIdx;
      try {
        const rc = buildOn(model, dl, baseZ, {
          withDormers: true,
          gableFn: (i) => gset.has(i),
          popoutCovered: simplified.coveredWalls,
          popoutNotches: simplified.notchGeo,
          _origLoop: rawLoop,
        });
        if (rc && rc.ok && rc.faces && rc.faces.some((f) => f.kind === 'slope')) {
          rc.lvlIdx = lvlIdx;
          applyRoofOverrides(rc.faces, model);
          return rc;
        }
      } catch (e) { /* fall through to legacy */ }
    }

    const r = buildOn(model, loop, baseZ, { withDormers: true, _origLoop: rawLoop });
    r.lvlIdx = lvlIdx;
    if (r.ok) applyRoofOverrides(r.faces, model);
    return r;
  };

  /* ---------- public: lower roofs over exposed story portions ----------
     For each level below the roof level, edges NOT covered by the story
     above carry roof planes; covered edges are silent, so the lower roof
     dies into the upper walls (classic wing / one-story-section roofs). */
  /* ===== NEW watertight lower-roof path (flag model.roof._newLower) =====
     The exposed footprint (1st-floor exterior MINUS 2nd-floor outside-face) with edges TAGGED
     eave/wall is fed to the WEIGHTED skeleton (eave sigma=1, wall sigma=0). The roof rises from the
     eaves and DIES INTO the wall by construction — watertight, no post-clip surgery, ledgers aligned. */
  const _segInt = (a, b, c, d) => {
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const den = rx * sy - ry * sx; if (Math.abs(den) < 1e-9) return null;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null;
    return { x: a.x + t * rx, y: a.y + t * ry, t, u };
  };
  const buildExposedRegion = (extPtsIn, cutPtsIn) => {
    const ccw = (p) => (U.polyArea(p) > 0 ? p.slice() : p.slice().reverse());
    const ext = ccw(extPtsIn), cut = ccw(cutPtsIn);
    const pip = (p, poly) => U.pointInPoly(p, poly);
    let crosses = 0;
    for (let i = 0; i < ext.length; i++) for (let j = 0; j < cut.length; j++)
      if (_segInt(ext[i], ext[(i + 1) % ext.length], cut[j], cut[(j + 1) % cut.length])) crosses++;
    if (cut.every((p) => pip(p, ext)) && crosses === 0) {
      const inner = cut.slice().reverse();
      return { topology: 'annulus', rings: [{ pts: ext, kinds: ext.map(() => 'eave') }, { pts: inner, kinds: inner.map(() => 'wall') }] };
    }
    const E = [];
    for (let i = 0; i < ext.length; i++) {
      E.push({ p: ext[i], kind: 'v' });
      const a = ext[i], b = ext[(i + 1) % ext.length], hits = [];
      for (let j = 0; j < cut.length; j++) { const x = _segInt(a, b, cut[j], cut[(j + 1) % cut.length]); if (x) hits.push({ p: { x: x.x, y: x.y }, t: x.t, cutEdge: j, cutU: x.u }); }
      hits.sort((m, n) => m.t - n.t);
      for (const h of hits) E.push({ p: h.p, kind: 'x', onCut: h.cutEdge, cutU: h.cutU });
    }
    const C = [];
    for (let j = 0; j < cut.length; j++) {
      C.push({ p: cut[j], kind: 'v' });
      const hits = []; for (const e of E) if (e.kind === 'x' && e.onCut === j) hits.push({ p: e.p, u: e.cutU });
      hits.sort((m, n) => m.u - n.u);
      for (const h of hits) C.push({ p: h.p, kind: 'x' });
    }
    const key = (p) => Math.round(p.x * 16) + ',' + Math.round(p.y * 16);
    const cIndex = new Map(); C.forEach((e, idx) => { if (e.kind === 'x') cIndex.set(key(e.p), idx); });
    const eIndex = new Map(); E.forEach((e, idx) => { if (e.kind === 'x') eIndex.set(key(e.p), idx); });
    const inCut = (p) => pip(p, cut);
    // The 2nd floor can SPLIT the exposed roof into several disjoint regions (e.g. spans across,
    // leaving two strips). Walk a ring from EACH un-consumed exposed exterior vertex.
    const usedV = new Set();
    const rings = [];
    for (let s0 = 0; s0 < E.length; s0++) {
      if (E[s0].kind !== 'v' || inCut(E[s0].p) || usedV.has(s0)) continue;
      const outPts = [], outKinds = []; let mode = 'ext', ei = s0, ci = 0, guard = (E.length + C.length) * 3 + 8;
      const startKey = key(E[s0].p);
      do {
        if (mode === 'ext') {
          if (E[ei].kind === 'v') usedV.add(ei);
          outPts.push(E[ei].p); outKinds.push('eave');
          const nxt = (ei + 1) % E.length;
          if (E[nxt].kind === 'x') { outPts.push(E[nxt].p); outKinds.push('wall'); ci = cIndex.get(key(E[nxt].p)); mode = 'cut'; }
          else ei = nxt;
        } else {
          const prev = (ci - 1 + C.length) % C.length, c = C[prev];
          // An intersection where we leave the cut back onto the exterior STARTS an EAVE edge
          // (the roof projects out from here), so tag it 'eave' — tagging it 'wall' (the kind of
          // the cut edge we just walked) mislabels the whole following eave run as a die-into-wall,
          // dropping that slope (the wing/bump case: a protrusion's far eave became a 'wall').
          if (c.kind === 'x') { outPts.push(c.p); outKinds.push('eave'); ei = (eIndex.get(key(c.p)) + 1) % E.length; mode = 'ext'; }
          else { outPts.push(c.p); outKinds.push('wall'); ci = prev; }
        }
      } while (--guard > 0 && !(mode === 'ext' && key(E[ei].p) === startKey && outPts.length > 1));
      const P = [], K = [];
      for (let i = 0; i < outPts.length; i++) { const last = P[P.length - 1]; if (!last || U.dist(last, outPts[i]) > 0.3) { P.push(outPts[i]); K.push(outKinds[i]); } }
      if (P.length >= 3 && Math.abs(U.polyArea(P)) > 200) rings.push({ pts: P, kinds: K });
    }
    if (!rings.length) return { topology: 'fully-covered', rings: [] };
    return { topology: rings.length > 1 ? 'multi' : 'simply-connected', rings };
  };
  HA._exposed = buildExposedRegion;   // test hook (scratch validation of the exposed-region tagging); harmless
  // build the lower roof for one level via the weighted skeleton; returns r{ok,faces,...} or null to fall back.
  const buildLowerNew = (model, extLoop, upFacePts, baseZ, pitch) => {
    const region = buildExposedRegion(extLoop.pts, upFacePts);
    if ((region.topology !== 'simply-connected' && region.topology !== 'multi') || !region.rings.length) return null;   // annulus -> old path for now
    const plate = baseZ + Math.max(...extLoop.walls.map((w) => w.height || model.settings.wallHeight));
    const slope = Math.max(0.03, pitch);
    // map a ring EAVE edge to its source lower wall (nearest parallel extLoop edge to the edge midpoint)
    const srcWall = (pts, i) => {
      const a = pts[i], b = pts[(i + 1) % pts.length], mid = U.lerp(a, b, 0.5), dir = U.norm(U.sub(b, a));
      let best = null, bd = 1e9;
      for (let j = 0; j < extLoop.pts.length; j++) {
        const ea = extLoop.pts[j], eb = extLoop.pts[(j + 1) % extLoop.pts.length];
        if (Math.abs(U.cross(dir, U.norm(U.sub(eb, ea)))) > 0.05) continue;
        const d = U.distToSeg(mid, ea, eb);
        if (d < bd) { bd = d; best = extLoop.walls[j]; }
      }
      return best;
    };
    const effRake = (w) => Math.max(model.roof.rake || 0, HA.wallT(w) / 2 + 2);
    const faces = [];
    for (const ring of region.rings) {
      const kinds = ring.kinds, nn = ring.pts.length;
      if (nn < 3) continue;
      // per-edge metadata: an EAVE edge whose source lower wall is gabled becomes a GABLE
      // (no slope plane of its own; its hip footprint is re-tiled by the neighbours so the
      // ridge runs out to a peak, then a vertical pediment fills the wall). WALL edges
      // (the roof dies into the upper story there) never gable.
      const meta = [];
      for (let i = 0; i < nn; i++) {
        const a = ring.pts[i], b = ring.pts[(i + 1) % nn], inN = U.mul(U.edgeOutNormal(ring.pts, i), -1);
        const w = srcWall(ring.pts, i);
        meta.push({ a, b, dir: U.norm(U.sub(b, a)), inN, wall: w, kind: kinds[i], gable: kinds[i] === 'eave' && !!(w && w.gable) });
      }
      const over = U.offsetPoly(ring.pts, meta.map((m) => (m.kind === 'wall' ? 0 : m.gable ? effRake(m.wall) : model.roof.overhang)));
      if (!over || over.length !== nn) return null;   // offset changed edge count -> fall back to old path
      let skel; try { skel = skeletonFaces(over, (i) => (meta[i].kind === 'wall' ? 0 : 1)); } catch (e) { return null; }
      if (!skel.length) continue;
      // BEARING TRUTH (ROOF-POLICY-SPEC B, Steve's hand-framing): a wing rafter's
      // heel bears plumb over the INSIDE FACE of its bearing wall's top plate —
      // the plane passes through z = plate AT THE INSIDE FACE and projects up-
      // slope from there. The old math anchored at the wall CENTERLINE, riding
      // every lower plane slope·(wallT/2) too high ("looks mostly correct but the
      // logic don't work right"). The skin still terminates against the upper
      // wall's outside face — only the plane equation moves to the true bearing.
      const hCoef = (i) => {
        const halfT = (meta[i].wall && HA.wallT) ? HA.wallT(meta[i].wall) / 2 : 3;
        const aIn = { x: meta[i].a.x + meta[i].inN.x * halfT, y: meta[i].a.y + meta[i].inN.y * halfT };
        return { A: slope * meta[i].inN.x, B: slope * meta[i].inN.y, C: plate - slope * U.dot(meta[i].inN, aIn) };
      };
      const hAt = (c, p) => c.A * p.x + c.B * p.y + c.C;
      const pushSlopeFace = (i, poly2) => {
        if (!poly2 || poly2.length < 3) return;
        // SANITIZE the ring: the clip chains (gable/coverage re-partition) can leave
        // coincident vertices and micro "bowtie" slivers — a 10in² ring with a repeated
        // vertex read as a TWISTED face downstream (Steve's all-hip "folds/messes up").
        const cl = [];
        for (const p of poly2) if (!cl.length || U.dist(p, cl[cl.length - 1]) > 0.1) cl.push(p);
        while (cl.length > 1 && U.dist(cl[0], cl[cl.length - 1]) <= 0.1) cl.pop();
        if (cl.length < 3 || Math.abs(U.polyArea(cl)) < 2) return;
        // PINCHED ring (a repeated NON-adjacent vertex = two loops sharing a point —
        // clipHalfPlane emits these): split at the pinch and push each sub-loop as
        // its own face on the same plane (was a "TWISTED" face downstream).
        for (let ii = 0; ii < cl.length; ii++) {
          for (let jj = ii + 2; jj < cl.length; jj++) {
            if (ii === 0 && jj === cl.length - 1) continue;   // wrap-adjacent, not a pinch
            if (U.dist(cl[ii], cl[jj]) <= 0.1) {
              pushSlopeFace(i, cl.slice(ii, jj));
              pushSlopeFace(i, cl.slice(jj).concat(cl.slice(0, ii)));
              return;
            }
          }
        }
        if (Math.abs(U.polyArea(cl)) < 50 && HA.ringSelfIntersects && HA.ringSelfIntersects(cl)) return;  // sliver bowtie: drop
        const c = hCoef(i), m = meta[i];
        const pts3 = cl.map((p) => ({ x: p.x, y: p.y, z: hAt(c, p) }));
        faces.push({ kind: 'slope', wallId: m.wall ? m.wall.id : (extLoop.walls[0] && extLoop.walls[0].id), edge: { a: m.a, b: m.b, dir: m.dir, inN: m.inN, wall: m.wall, gable: false, covered: false }, coef: c, poly2: cl, pts3, maxZ: Math.max(...pts3.map((p) => p.z)) });
      };
      // classify skeleton faces: wall -> die-in (re-partition if it has area),
      // gable -> re-partition, eave -> slope.
      // A sigma-0 WALL edge should be stationary (zero-area face), but the kinetic
      // skeleton DOES allocate real area to one where an eave wavefront collides
      // with its stationary line (measured: a 4200in² wall face on the generated
      // craftsman/farmhouse 2-story L). Dropping those left a WHITE UNSKINNED HOLE
      // at the gable-to-hip junction (Steve: "gable to hip transfer roof … you can
      // see through to white"). Collect them and re-tile their footprint among the
      // neighbouring eave planes (lower envelope) exactly like the gable handler —
      // the skeleton tiles the ring watertight, so re-assigning (not dropping)
      // keeps it watertight.
      const ringFaceStart = faces.length;   // marks THIS ring's emissions (coverage patch below)
      const gableSkel = [];
      for (const f of skel) {
        if (meta[f.edgeIdx].kind === 'wall') continue;   // die-in edge: dropped; the coverage patch re-tiles its true footprint
        if (meta[f.edgeIdx].gable) gableSkel.push(f);
        else pushSlopeFace(f.edgeIdx, f.poly2);
      }
      // re-partition each gable's removed hip face among the neighbouring EAVE slope planes
      // (lower envelope, locally valid). Wall/gable/sibling/sub-plate planes are excluded —
      // same rule as the main-roof gable handler, with 'wall' edges playing the 'covered' role.
      const eaveIdx = meta.map((m, i) => i).filter((i) => meta[i].kind === 'eave' && !meta[i].gable);
      for (const gf of gableSkel) {
        const segMid = (s) => U.lerp(s.a, s.b, 0.5);
        const neighbors = new Set();
        for (const f of skel) {
          if (f === gf || meta[f.edgeIdx].kind === 'wall' || meta[f.edgeIdx].gable) continue;
          let touch = false;
          for (const s1 of gf.segs) {
            for (const s2 of f.segs) {
              if (U.dist(segMid(s1), segMid(s2)) < 1 ||
                  (U.dist(s1.a, s2.b) < 1 && U.dist(s1.b, s2.a) < 1) ||
                  (U.dist(s1.a, s2.a) < 1 && U.dist(s1.b, s2.b) < 1)) { touch = true; break; }
            }
            if (touch) break;
          }
          if (touch) neighbors.add(f.edgeIdx);
        }
        const gInN = meta[gf.edgeIdx].inN, gCen = U.polyCentroid(gf.poly2);
        const usable = (i) => U.dot(meta[i].inN, gInN) < 0.99 && hAt(hCoef(i), gCen) >= plate - 1;
        let cand = [...neighbors].filter(usable);
        if (!cand.length) cand = eaveIdx.filter(usable);
        if (!cand.length) cand = eaveIdx.slice();
        for (const ci of cand) {
          const cc = hCoef(ci); let poly = gf.poly2.slice();
          for (const oi of cand) {
            if (oi === ci || !poly.length) continue;
            const oc = hCoef(oi);
            poly = U.clipHalfPlane(poly, oc.A - cc.A, oc.B - cc.B, oc.C - cc.C);
          }
          pushSlopeFace(ci, poly);
        }
      }
      // (wallSkel re-partition REMOVED — Steve's all-hip "folds in": the kinetic
      // skeleton's wall faces can carry EXCESS area that OVERLAPS the eave faces
      // (measured: a 176in² wedge on the generated craftsman 2-story after
      // roofStyle('hip') — two planes claiming the same plan region, the roof
      // "folding" under itself). Re-partitioning the wall face poly re-emitted
      // that overlap. The unified COVERAGE PATCH below replaces it: it tiles
      // exactly ring − union(emitted faces), which is DISJOINT from the emitted
      // set by construction — closing the wall-face holes with zero overlap.)
      //
      // COVERAGE PATCH: the kinetic walk both LOSES wall-adjacent regions (two
      // consecutive sigma-0 wall edges — 6,600in² gone on the generated farmhouse;
      // Steve's white gable-to-hip hole) and mis-sizes wall faces (overlap above).
      // Subtract THIS RING's emitted slope faces from the over ring (ear-clip +
      // exact per-triangle convex complement, the old clip path's idiom) and tile
      // any remainder by the lower envelope of the eave planes — the min-height
      // plane owns each point, so the patch is watertight, seam-consistent, and
      // can never double-cover.
      {
        const ringArea = Math.abs(U.polyArea(over));
        const ringFaces = faces.slice(ringFaceStart).filter((f) => f.kind === 'slope' && f.poly2 && f.poly2.length >= 3);
        let covArea = 0;
        for (const f of ringFaces) covArea += Math.abs(U.polyArea(f.poly2));
        if (ringArea - covArea > 24 && eaveIdx.length) {
          const earClip = (poly) => {
            const V = poly.map((p) => ({ x: p.x, y: p.y })); if (V.length < 3) return [];
            if (U.polyArea(V) < 0) V.reverse();
            const idx = V.map((_, i) => i), tris = [];
            const cr = (o, a2, b2) => (a2.x - o.x) * (b2.y - o.y) - (a2.y - o.y) * (b2.x - o.x);
            const inTri = (p, a2, b2, c2) => { const d1 = cr(a2, b2, p), d2 = cr(b2, c2, p), d3 = cr(c2, a2, p); return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0))); };
            let guard = V.length * V.length + 8;
            while (idx.length > 3 && guard-- > 0) {
              let cut = false;
              for (let i2 = 0; i2 < idx.length; i2++) {
                const ia = idx[(i2 + idx.length - 1) % idx.length], ib = idx[i2], ic = idx[(i2 + 1) % idx.length];
                const a2 = V[ia], b2 = V[ib], c2 = V[ic];
                if (cr(a2, b2, c2) <= 1e-6) continue;
                let ear = true;
                for (let j = 0; j < idx.length; j++) { const vj = idx[j]; if (vj === ia || vj === ib || vj === ic) continue; if (inTri(V[vj], a2, b2, c2)) { ear = false; break; } }
                if (!ear) continue;
                tris.push([a2, b2, c2]); idx.splice(i2, 1); cut = true; break;
              }
              if (!cut) return [];
            }
            if (idx.length === 3) tris.push([V[idx[0]], V[idx[1]], V[idx[2]]]);
            return tris;
          };
          let pieces = [over.slice()];
          for (const f of ringFaces) {          // subtract only the EMITTED faces —
            if (!pieces.length) break;          // the remainder is disjoint from them
            for (const tri of earClip(f.poly2)) {
              const next = [];
              for (const pc of pieces) {
                let inside = pc;
                for (let k = 0; k < 3 && inside && inside.length; k++) {
                  const oN = U.edgeOutNormal(tri, k), q1 = tri[k];
                  const A = oN.x, B = oN.y, C = -(oN.x * q1.x + oN.y * q1.y);
                  const outP = U.clipHalfPlane(inside, A, B, C);
                  if (outP.length >= 3 && Math.abs(U.polyArea(outP)) > 2) next.push(outP);
                  inside = U.clipHalfPlane(inside, -A, -B, -C);
                }
              }
              pieces = next;
            }
          }
          for (const piece of pieces) {
            if (Math.abs(U.polyArea(piece)) < 4) continue;
            for (const ci of eaveIdx) {
              const cc = hCoef(ci); let poly = piece.slice();
              for (const oi of eaveIdx) {
                if (oi === ci || !poly.length) continue;
                const oc = hCoef(oi);
                poly = U.clipHalfPlane(poly, oc.A - cc.A, oc.B - cc.B, oc.C - cc.C);
              }
              pushSlopeFace(ci, poly);
            }
          }
        }
      }
      // vertical gable pediment faces at each gabled wall's exterior surface
      const anyGable = meta.some((m) => m.gable);
      if (anyGable) {
        const slopeNow = faces.filter((f) => f.kind === 'slope');
        const roofProfile = (a, b) => {
          const ts = new Set([0, 1]), segDir = U.sub(b, a);
          for (const f of slopeNow) {
            const poly = f.poly2;
            for (let i = 0; i < poly.length; i++) {
              const hit = U.lineLine(a, segDir, poly[i], U.sub(poly[(i + 1) % poly.length], poly[i]));
              if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6 && hit.u > -1e-6 && hit.u < 1 + 1e-6) ts.add(hit.t);
            }
          }
          const zAt = (p) => {
            const f = slopeNow.find((f) => U.pointInPoly(p, f.poly2));
            if (f) return f.coef.A * p.x + f.coef.B * p.y + f.coef.C;
            let bestF = null, bestD = Infinity;
            for (const f of slopeNow) { const d = U.dist(p, U.polyCentroid(f.poly2)); if (d < bestD) { bestD = d; bestF = f; } }
            return bestF ? bestF.coef.A * p.x + bestF.coef.B * p.y + bestF.coef.C : null;
          };
          const out = [];
          for (const t of [...ts].sort((x, y) => x - y)) {
            const tE = U.clamp(t === 0 ? t + 1e-4 : t === 1 ? t - 1e-4 : t, 0, 1);
            const z = zAt(U.lerp(a, b, tE));
            if (z != null) out.push({ t, p: U.lerp(a, b, t), z });
          }
          return out;
        };
        for (const m of meta) {
          if (!m.gable || !m.wall) continue;
          const off = U.mul(m.inN, -HA.wallT(m.wall) / 2);
          const a = U.add(m.a, off), b = U.add(m.b, off);
          const env = roofProfile(a, b);
          if (!env.some((s) => s.z > plate + 0.25)) continue;
          const pts3 = [{ x: a.x, y: a.y, z: plate }, ...env.map((s) => ({ x: s.p.x, y: s.p.y, z: Math.max(s.z, plate) })), { x: b.x, y: b.y, z: plate }];
          faces.push({ kind: 'gable', wallId: m.wall.id, edge: { a: m.a, b: m.b, dir: m.dir, inN: m.inN, wall: m.wall, gable: true, covered: false }, pts3 });
        }
      }
    }
    if (!faces.length) return null;
    return { ok: true, faces, lvlIdx: extLoop._li, plate, slope, dormers: [], loop: extLoop, baseZ };
  };
  HA._buildLowerNew = buildLowerNew;   // test hook (dev-gablehip-test)

  HA.buildLowerRoofs = (model) => {
    const out = [];
    const top = HA.roofLevelIdx(model);
    if (!model.roof.enabled) return out;
    for (let li = 0; li < top; li++) {
      const rawLoop = mergeCollinearLoop(HA.exteriorLoop(model, li));   // roof-side: straighten split flush-garage joints
      const upper = HA.exteriorLoop(model, li + 1);
      if (!rawLoop || !upper) continue;
      // WINDING NORMALIZE — fixes Steve's long-standing ONE-SIDED lower-roof glitch (a slope
      // collapses to the centre wall / a white hole on just one side, which moved when the roof was
      // "swapped over"). HA.exteriorLoop returns an arrangement-dependent CW/CCW winding, so mirroring
      // the footprint FLIPPED upper's winding; the order-dependent clip (subtractUpper) + dissolve then
      // produced a DIFFERENT (broken) face set on one side. Force canonical CCW so the whole lower-roof
      // pipeline is mirror-invariant. (Both pts arrays are freshly built by exteriorLoop — safe to reverse.)
      if (U.polyArea(upper.pts) < 0) upper.pts.reverse();
      const loop = refineLoopAgainst(rawLoop, upper.pts);
      const covered = (e) => {
        const mid = U.lerp(e.a, e.b, 0.5);
        if (U.pointInPoly(mid, upper.pts)) return true;
        for (let i = 0; i < upper.pts.length; i++) {
          if (U.distToSeg(mid, upper.pts[i], upper.pts[(i + 1) % upper.pts.length]) < 2) return true;
        }
        return false;
      };
      let anyExposed = false;
      for (let i = 0; i < loop.pts.length; i++) {
        if (!covered({ a: loop.pts[i], b: loop.pts[(i + 1) % loop.pts.length] })) { anyExposed = true; break; }
      }
      if (!anyExposed) continue; // fully under the story above
      // ----- ONE global lower-roof pitch, computed BEFORE the skeleton -----
      // The whole lower roof is the straight skeleton of the lower footprint at a
      // single pitch, clipped at the 2nd-floor walls. The pitch is set by the
      // DEEPEST exposed overhang (the band that must die into a 2nd-floor wall),
      // so that band reaches the wall at/below a clean reveal above the 2nd-floor
      // floor (keeps it under the upper windows); shallower edges die lower and
      // wings rise to their own ridge — all at the same pitch.
      const upperFloorZ = HA.levelElev(model, li + 1);
      const lowerPlate = HA.levelElev(model, li) + Math.max(...loop.walls.map((w) => w.height || model.settings.wallHeight));
      const upperWallH = (upper.walls && upper.walls.length)
        ? Math.max(...upper.walls.map((w) => w.height || model.settings.wallHeight))
        : model.settings.wallHeight;
      const upperPlateZ = upperFloorZ + upperWallH;
      const LOWER_ROOF_REVEAL = 20;            // inches a skirt may die in above the 2nd-floor floor
      const skirtCapZ = upperFloorZ + LOWER_ROOF_REVEAL;
      const mainSlope = Math.max(0.5, model.roof.pitch) / 12;
      // deepest exposed overhang: lower wall -> nearest PARALLEL facing 2nd-floor wall
      let maxInset = 0;
      const upN = upper.pts.length;
      for (let i = 0; i < loop.pts.length; i++) {
        const a = loop.pts[i], b = loop.pts[(i + 1) % loop.pts.length];
        if (U.dist(a, b) < 1) continue;
        if (covered({ a, b })) continue;
        const dir = U.norm(U.sub(b, a));
        const inN = U.mul(U.edgeOutNormal(loop.pts, i), -1);
        for (let j = 0; j < upN; j++) {
          const u1 = upper.pts[j], u2 = upper.pts[(j + 1) % upN];
          if (U.dist(u1, u2) < 1) continue;
          const ud = U.norm(U.sub(u2, u1)), uo = U.edgeOutNormal(upper.pts, j);
          if (Math.abs(U.cross(dir, ud)) > 0.02) continue;     // not parallel
          if (U.dot(uo, inN) > -0.9) continue;                 // upper wall must face the eave
          const wallInset = U.dot(U.sub(u1, a), inN);
          if (wallInset > maxInset) maxInset = wallInset;
        }
      }
      const maxD = maxInset + (model.roof.overhang || 0);
      // one pitch for the whole lower roof, set by the deepest overhang so it dies
      // into the wall at/below the reveal cap; shallower edges die lower; wings rise
      // to their own ridge at the same pitch. (min 0.05 so it's never flat.)
      // AUTO (default): one pitch capped so the deepest overhang dies in below the
      // 2nd-floor windows. EXPLICIT (model.roof.lowerPitch in :12, >0): honor the
      // user's pitch (the upperPlateZ safety clamp still stops a poke-through).
      //
      // WING MASS RULE (Steve, seed 720063791: the attached garage "reads like a
      // 2-story stub" — its die-in roof climbed ~37" above the plate into the L1
      // window band). HARD CAP for BOTH branches: the deepest die-in apex stays
      // at/below the L1 FLOOR BAND + 6" — clearly below the upper story, never up
      // into the window band. The explicit lowerPitch used to be honored blindly
      // (gen's 3:12 on a modern 10ft plate climbed the full 150" wing inset); it
      // is now bounded by the same rule. Draftsman practice: an attached wing's
      // roof mass sits below the second floor.
      const bandCapZ = upperFloorZ + 6;
      const massCap = maxD > 1 ? Math.max(0.05, (bandCapZ - lowerPlate) / maxD) : Infinity;
      const userLP = (model.roof.lowerPitch > 0) ? Math.max(0.05, model.roof.lowerPitch / 12) : null;
      const mGlobal = userLP != null
        ? Math.min(userLP, massCap)
        : (maxD > 1 ? Math.max(0.05, Math.min(mainSlope, massCap, (skirtCapZ - lowerPlate) / maxD)) : mainSlope);

      // NEW watertight path (flag model.roof._newLower): the weighted skeleton of the EXPOSED footprint
      // dying into the 2nd-floor wall OUTSIDE FACE. Watertight by construction; no clip/dissolve. Falls
      // back to the old clip path on the embedded-2nd-floor ANNULUS case or any failure.
      // DEFAULT ON (set model.roof._newLower=false to force the old clip path). Now a full drop-in:
      // gable ends + ledger/framing face contract. Falls back to the old path on the embedded-2nd-floor
      // ANNULUS case (buildLowerNew returns null) or any failure.
      if (model.roof._newLower !== false) {
        const _upHalf = (upper.walls && upper.walls.length) ? Math.max(...upper.walls.map((w) => HA.wallT(w))) / 2 : 3;
        const upFace = U.offsetPoly(upper.pts, upper.pts.map(() => _upHalf)) || upper.pts;
        rawLoop._li = li;
        const rn = buildLowerNew(model, rawLoop, upFace, HA.levelElev(model, li), mGlobal);
        // MASS-RULE exactness pass: maxD under-measures OBLIQUE die-in runs (a
        // front eave rising BESIDE the upper mass dies at a skeleton node past
        // the parallel-wall inset — measured 171" vs maxInset 144 on the
        // generated farmhouse, apex 0.8" over the band cap). Don't crush the
        // whole wing's pitch for it — FLATTEN at the cap instead (pointwise min
        // with z = bandCapZ, the old clip path's emit-clamp idiom): each face is
        // split at the cap plane, the part above re-emitted FLAT at bandCapZ.
        // Reads as an intentional clipped-hip cap on low wings; eave pitch and
        // the anti-pancake read stay intact. Watertight: min() is continuous.
        if (rn && rn.faces && rn.faces.length && isFinite(massCap)) {
          const capped = [];
          for (const f of rn.faces) {
            // gable pediments were profiled off the PRE-flatten planes — clamp
            // their silhouette at the cap too so they stay ON the roof surface.
            if (f.kind === 'gable' && f.pts3) {
              if (f.pts3.some((p) => p.z > bandCapZ + 0.01))
                f.pts3 = f.pts3.map((p) => ({ x: p.x, y: p.y, z: Math.min(p.z, bandCapZ) }));
              capped.push(f); continue;
            }
            if (f.kind !== 'slope' || !f.coef || !f.poly2 || (f.maxZ || 0) <= bandCapZ + 0.1) { capped.push(f); continue; }
            const c = f.coef;
            const lo = U.clipHalfPlane(f.poly2, -c.A, -c.B, bandCapZ - c.C);   // hAt <= cap
            const hi = U.clipHalfPlane(f.poly2, c.A, c.B, c.C - bandCapZ);     // hAt >= cap
            if (lo.length >= 3 && Math.abs(U.polyArea(lo)) > 2) {
              const pts3 = lo.map((p) => ({ x: p.x, y: p.y, z: c.A * p.x + c.B * p.y + c.C }));
              capped.push(Object.assign({}, f, { poly2: lo, pts3, maxZ: Math.max(...pts3.map((p) => p.z)) }));
            }
            if (hi.length >= 3 && Math.abs(U.polyArea(hi)) > 2) {
              const pts3 = hi.map((p) => ({ x: p.x, y: p.y, z: bandCapZ }));
              capped.push(Object.assign({}, f, { flat: true, coef: { A: 0, B: 0, C: bandCapZ }, poly2: hi, pts3, maxZ: bandCapZ }));
            }
          }
          if (capped.length) rn.faces = capped;
        }
        if (rn && rn.faces && rn.faces.length) { out.push(rn); continue; }
      }

      const r = buildOn(model, loop, HA.levelElev(model, li), {
        withDormers: false,
        coveredFn: covered,
        pitch: mGlobal,
      });
      if (r.ok && r.faces.length) {
        // clip the kept faces at the upper story's walls so the lower
        // roof dies INTO them instead of creeping through the interior
        const clipped = [];

        // Outward half-plane (A*x+B*y+C >= 0 == OUTSIDE) for each upper-wall edge.
        // edgeOutNormal handles either winding, so the sign is robust.
        const upHP = [];
        for (let j = 0; j < upper.pts.length; j++) {
          const q1 = upper.pts[j], q2 = upper.pts[(j + 1) % upper.pts.length];
          if (U.dist(q1, q2) < 1) { upHP.push(null); continue; }
          const oN = U.edgeOutNormal(upper.pts, j);
          upHP.push({ A: oN.x, B: oN.y, C: -(oN.x * q1.x + oN.y * q1.y) });
        }
        // Subtract the (convex-or-not) upper footprint from a face: keep only the
        // parts OUTSIDE the upper polygon, so the face dies into the 2nd-floor
        // walls. Convex-complement decomposition — piece_k = (outside edge k) AND
        // (inside edges 0..k-1) — gives disjoint pieces that tile face\upper with
        // hips landing exactly on the inner corners (the per-wall half-plane clip
        // sheared those corner wedges off; this keeps them). Wing faces don't
        // overlap the upper polygon, so they pass through whole.
        const _convexComplement = (poly) => {   // old path — EXACT only for a CONVEX upper
          const pieces = []; let inside = poly;
          for (let k = 0; k < upHP.length && inside && inside.length; k++) {
            const hp = upHP[k]; if (!hp) continue;
            const out = U.clipHalfPlane(inside, hp.A, hp.B, hp.C);
            if (out.length >= 3 && Math.abs(U.polyArea(out)) > 4) pieces.push(out);
            inside = U.clipHalfPlane(inside, -hp.A, -hp.B, -hp.C);
          }
          return pieces;
        };
        // Ear-clip the upper footprint into triangles; the convex-complement IS exact for a triangle,
        // so subtracting each triangle in sequence gives the TRUE difference face\upper even when the
        // upper is NON-CONVEX (L/notch). The old single-pass convex-complement converged `inside` to the
        // upper's CONVEX CORE and over-covered the reflex pocket — and because it was order-dependent it
        // dropped/garbled a different slope when the footprint was mirrored (Steve's one-sided hole).
        const _earClip = (poly) => {
          const V = poly.map((p) => ({ x: p.x, y: p.y })); if (V.length < 3) return [];
          if (U.polyArea(V) < 0) V.reverse();
          const idx = V.map((_, i) => i), tris = [];
          const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
          const inTri = (p, a, b, c) => { const d1 = cr(a, b, p), d2 = cr(b, c, p), d3 = cr(c, a, p); return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0))); };
          let guard = V.length * V.length + 8;
          while (idx.length > 3 && guard-- > 0) {
            let cut = false;
            for (let i = 0; i < idx.length; i++) {
              const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
              const a = V[ia], b = V[ib], c = V[ic];
              if (cr(a, b, c) <= 1e-6) continue;   // reflex / collinear ear candidate
              let ear = true;
              for (let j = 0; j < idx.length; j++) { const vj = idx[j]; if (vj === ia || vj === ib || vj === ic) continue; if (inTri(V[vj], a, b, c)) { ear = false; break; } }
              if (!ear) continue;
              tris.push([a, b, c]); idx.splice(i, 1); cut = true; break;
            }
            if (!cut) return [];   // degenerate polygon -> caller falls back
          }
          if (idx.length === 3) tris.push([V[idx[0]], V[idx[1]], V[idx[2]]]);
          return tris;
        };
        // CONVEX upper -> the convex-complement is exact AND seam-free; only a NON-CONVEX (L/notch)
        // upper needs the ear-clip difference (the ear-clip's triangulation diagonal would otherwise
        // leave a hairline seam across an otherwise-clean roof).
        const _isConvex = (pts) => { let s = 0; const n = pts.length; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n]; const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x); if (Math.abs(cr) < 1e-6) continue; const sg = cr > 0 ? 1 : -1; if (s === 0) s = sg; else if (sg !== s) return false; } return true; };
        const _upTris = _isConvex(upper.pts) ? [] : _earClip(upper.pts);
        const subtractUpper = (poly) => {
          if (!_upTris.length) return _convexComplement(poly);   // convex upper, or fallback for a degenerate ear-clip
          let pieces = [poly];
          for (const tri of _upTris) {
            const next = [];
            for (const pc of pieces) {
              let inside = pc;
              for (let k = 0; k < 3 && inside && inside.length; k++) {
                const oN = U.edgeOutNormal(tri, k), q1 = tri[k];
                const A = oN.x, B = oN.y, C = -(oN.x * q1.x + oN.y * q1.y);
                const out = U.clipHalfPlane(inside, A, B, C);
                if (out.length >= 3 && Math.abs(U.polyArea(out)) > 4) next.push(out);
                inside = U.clipHalfPlane(inside, -A, -B, -C);
              }
            }
            pieces = next;
          }
          return pieces;
        };

        for (const f of r.faces) {
          if (f.kind !== 'slope' || !f.edge) { clipped.push(f); continue; }
          const coef = f.coef;
          // emit one slope piece, applying the safety clamp at the upper PLATE
          const emit = (poly, src) => {
            if (poly.length < 3 || Math.abs(U.polyArea(poly)) <= 4) return;
            const cMax = Math.max(...poly.map((p) => coef.A * p.x + coef.B * p.y + coef.C));
            // Safety ceiling: at mGlobal the wall-clip already caps overhang faces
            // at the wall (<= skirtCapZ), so this clamp at the 2nd-floor PLATE
            // (top of the upper walls) should rarely fire — it only guards against
            // a face ever poking through the upper roof.
            const clampZ = upperPlateZ;
            if (cMax > clampZ + 0.5) {
              // CLAMP: split at z=clampZ — keep the part below as a true slope,
              // re-flatten the part above to clampZ so the roof never pokes through
              // the story above. Watertight: pointwise min of slope and z=clampZ.
              const lo = U.clipHalfPlane(poly, -coef.A, -coef.B, clampZ - coef.C); // hAt <= clampZ
              const hi = U.clipHalfPlane(poly, coef.A, coef.B, coef.C - clampZ);   // hAt >= clampZ
              if (lo.length >= 3 && Math.abs(U.polyArea(lo)) > 4) {
                clipped.push({
                  kind: 'slope', wallId: f.wallId, edge: f.edge, coef,
                  poly2: lo,
                  pts3: lo.map((p) => ({ x: p.x, y: p.y, z: coef.A * p.x + coef.B * p.y + coef.C })),
                  maxZ: Math.max(...lo.map((p) => coef.A * p.x + coef.B * p.y + coef.C)),
                });
              }
              if (hi.length >= 3 && Math.abs(U.polyArea(hi)) > 4) {
                clipped.push({
                  kind: 'slope', wallId: f.wallId, edge: f.edge, flat: true,
                  coef: { A: 0, B: 0, C: clampZ },     // horizontal top band (safety ceiling)
                  poly2: hi,
                  pts3: hi.map((p) => ({ x: p.x, y: p.y, z: clampZ })),
                  maxZ: clampZ,
                });
              }
            } else {
              clipped.push({
                kind: 'slope', wallId: f.wallId, edge: f.edge, coef,
                poly2: poly,
                pts3: poly.map((p) => ({ x: p.x, y: p.y, z: coef.A * p.x + coef.B * p.y + coef.C })),
                maxZ: Math.max(...poly.map((p) => coef.A * p.x + coef.B * p.y + coef.C)),
              });
            }
          };
          for (const piece of subtractUpper(f.poly2)) emit(piece, f);
        }

        // ---- EAVE RETURN: dissolve flush-corner FIN slivers onto the deep
        // overhang's plane. Where a deep eave meets a FLUSH (covered) eave the
        // offset kinks, and the straight skeleton spits out a thin ACUTE facet on
        // a different plane than the deep overhang beside it — it renders as a
        // triangle spiking off the corner. The clean detail (Chief's sloping eave
        // RETURN; the straight-skeleton "line-segment event") is to let the deep
        // overhang's plane WRAP the corner. So: find each small acute facet that
        // CREASES against a much larger neighbour on a different plane, and re-tile
        // its plan area onto that neighbour's plane. Defensive — only commit when
        // the union is one clean simple loop that doesn't poke above the plate;
        // otherwise leave the facet untouched (worst case: no change, never broken).
        const _eKey = (p, q) => { const a = Math.round(p.x) + ',' + Math.round(p.y), b = Math.round(q.x) + ',' + Math.round(q.y); return a < b ? a + '|' + b : b + '|' + a; };
        const _normOf = (f) => { const n = Math.hypot(f.coef.A, f.coef.B, 1) || 1; return { x: f.coef.A / n, y: f.coef.B / n, z: 1 / n }; };
        const _minEdge = (poly) => { let m = 1e9; for (let i = 0; i < poly.length; i++) m = Math.min(m, U.dist(poly[i], poly[(i + 1) % poly.length])); return m; };
        const _minAngle = (poly) => {
          let m = 180;
          for (let i = 0; i < poly.length; i++) {
            const a = poly[(i - 1 + poly.length) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length];
            const u = { x: a.x - b.x, y: a.y - b.y }, v = { x: c.x - b.x, y: c.y - b.y };
            const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
            if (lu < 0.5 || lv < 0.5) continue;
            let cos = (u.x * v.x + u.y * v.y) / (lu * lv); cos = Math.max(-1, Math.min(1, cos));
            m = Math.min(m, Math.acos(cos) * 180 / Math.PI);
          }
          return m;
        };
        // union two polygons that share exactly one edge -> single CCW loop, or
        // null if the result isn't one clean simple polygon (then we don't merge).
        const _ccw = (poly) => (U.polyArea(poly) < 0 ? poly.slice().reverse() : poly);
        // Union two polygons that share one edge into a single CCW loop, or null
        // if the result isn't one clean simple polygon. Vertices are WELDED within
        // a tolerance (skeleton coords carry sub-inch noise, so exact keys would
        // fail to cancel a shared edge) — this is what makes the merge robust.
        const _unionAdj = (A0, B0) => {
          const TOL = 0.75;
          const reps = [];                          // canonical welded vertices
          const idOf = (p) => {
            for (let i = 0; i < reps.length; i++) if (U.dist(reps[i], p) < TOL) return i;
            reps.push({ x: p.x, y: p.y }); return reps.length - 1;
          };
          const edges = new Map();                  // "i>j" -> [i, j]
          const addPoly = (poly) => {
            const ids = poly.map(idOf);
            for (let k = 0; k < ids.length; k++) {
              const i = ids[k], j = ids[(k + 1) % ids.length];
              if (i === j) continue;                // degenerate/duplicate vertex
              const rev = j + '>' + i;
              if (edges.has(rev)) edges.delete(rev);  // shared edge cancels
              else edges.set(i + '>' + j, [i, j]);
            }
          };
          addPoly(_ccw(A0)); addPoly(_ccw(B0));
          if (edges.size < 3) return null;
          const byFrom = new Map();
          for (const [, e] of edges) { if (byFrom.has(e[0])) return null; byFrom.set(e[0], e[1]); }
          const startE = edges.values().next().value;
          const loop = [reps[startE[0]]]; let cur = startE[1]; let guard = 0;
          while (cur !== startE[0] && guard++ < edges.size + 2) {
            const nxt = byFrom.get(cur);
            if (nxt == null) return null;
            loop.push(reps[cur]); cur = nxt;
          }
          if (cur !== startE[0] || loop.length !== edges.size || loop.length < 3) return null;
          return loop;
        };
        // Distance from a point to the nearest upper-story wall segment. Used to
        // PROTECT a wing's HIP-END from the eave-return dissolve: a real hip-end
        // closes against the 2nd-floor wall, so it carries a substantial edge lying
        // ALONG that wall. A genuine eave-return FIN, by contrast, is a sliver at the
        // OUTER eave perimeter (where a deep overhang wraps a flush corner) with no
        // on-wall edge. Dissolving a hip-end pulls its plane off the wall and opens a
        // vertical notch/gap (the "wing hip broken against the main wall" bug).
        const _distUpWall = (p) => {
          let d = 1e9;
          for (let j = 0; j < upper.pts.length; j++) {
            const a = upper.pts[j], b = upper.pts[(j + 1) % upper.pts.length];
            if (U.dist(a, b) < 1) continue;
            const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
            let t = L2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2 : 0;
            t = Math.max(0, Math.min(1, t));
            d = Math.min(d, Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y));
          }
          return d;
        };
        // A facet "closes against the upper wall" if it has a long edge (>=12") whose
        // BOTH endpoints sit on an upper-story wall — i.e. a hip dying into that wall.
        const _closesOnWall = (poly) => {
          for (let i = 0; i < poly.length; i++) {
            const p = poly[i], q = poly[(i + 1) % poly.length];
            if (U.dist(p, q) >= 12 && _distUpWall(p) < 3 && _distUpWall(q) < 3) return true;
          }
          return false;
        };
        let dissolved = clipped.slice();
        for (let pass = 0; pass < 12 && !(typeof process !== 'undefined' && process.env && process.env.NO_EAVE_RETURN); pass++) {
          const slopes = dissolved.filter((f) => f.kind === 'slope' && !f.flat && f.poly2 && f.poly2.length >= 3);
          const emap = new Map();
          for (const f of slopes) for (let i = 0; i < f.poly2.length; i++) {
            const k = _eKey(f.poly2[i], f.poly2[(i + 1) % f.poly2.length]);
            if (!emap.has(k)) emap.set(k, []); emap.get(k).push(f);
          }
          const _zAt = (f, p) => f.coef.A * p.x + f.coef.B * p.y + f.coef.C;
          const cands = [];
          for (const f of slopes) {
            const a = Math.abs(U.polyArea(f.poly2));
            if (a >= 8000 || a < 1) continue;
            const acute = _minEdge(f.poly2) < 6 || _minAngle(f.poly2) < 12;
            // Find the neighbour this facet most badly RIDES ABOVE (a small corner
            // facet on a wrong plane that pokes up over the big roof beside it),
            // breaking ties toward the largest neighbour (the acute-sliver case,
            // where poke ~ 0). A facet is a fin if it pokes above a big neighbour
            // OR it is an acute sliver creasing against one.
            let best = null, bestArea = 0;
            for (let i = 0; i < f.poly2.length; i++) {
              const p = f.poly2[i], q = f.poly2[(i + 1) % f.poly2.length];
              if (U.dist(p, q) < 8) continue;
              for (const o of (emap.get(_eKey(p, q)) || [])) {
                if (o === f) continue;
                const oa = Math.abs(U.polyArea(o.poly2));
                if (oa < 2.5 * a) continue;
                const n1 = _normOf(f), n2 = _normOf(o);
                const ang = Math.acos(Math.max(-1, Math.min(1, n1.x * n2.x + n1.y * n2.y + n1.z * n2.z))) * 180 / Math.PI;
                if (ang <= 15) continue;   // ~coplanar -> mergeRoofPlanes handles it later
                // Pick the largest different-plane neighbour as the merge target.
                if (oa > bestArea) { best = o; bestArea = oa; }
              }
            }
            // ONLY dissolve genuine ACUTE slivers (the thin offset-kink fin at a
            // flush corner — a near-degenerate edge / spike angle). Facets that
            // merely RIDE a few inches above a neighbour are real corner HIPS (the
            // lower roof's single global pitch leaves the hip vertex a little off
            // the ideal hip line, so they always diverge a bit) — dissolving those
            // wrongly flattened a clean hip into a rake. Keep them.
            // ALSO never dissolve a facet that CLOSES against the upper wall (a hip-
            // end whose long edge lies on the 2nd-floor wall): a wing's hip dying
            // into the taller main wall trips `acute` only because of the tiny
            // covered-boundary miter sliver, but it is a real roof plane — merging it
            // into the perpendicular slope pulls the plane off the wall and leaves a
            // vertical notch/gap (the wing-hip-into-main-wall bug). Genuine eave-
            // return fins sit at the OUTER eave corner and have no on-wall edge.
            if (best && acute && !_closesOnWall(f.poly2)) cands.push({ f, M: best, a });
          }
          if (!cands.length) break;
          cands.sort((x, y) => x.a - y.a);
          const gone = new Set(), usedTarget = new Set();
          let mergedAny = false;
          for (const c of cands) {
            if (gone.has(c.f) || gone.has(c.M) || usedTarget.has(c.M)) continue;
            const u = _unionAdj(c.M.poly2, c.f.poly2);
            if (!u) continue;
            const coef = c.M.coef;
            const zmax = Math.max(...u.map((p) => coef.A * p.x + coef.B * p.y + coef.C));
            if (zmax > upperPlateZ + 0.5) continue;   // would poke through the upper roof
            c.M.poly2 = u;
            c.M.pts3 = u.map((p) => ({ x: p.x, y: p.y, z: coef.A * p.x + coef.B * p.y + coef.C }));
            c.M.maxZ = zmax;
            gone.add(c.f); usedTarget.add(c.M); mergedAny = true;
          }
          if (!mergedAny) break;
          dissolved = dissolved.filter((x) => !gone.has(x));
        }

        // ---- HEAL near-wall NOTCHES: at a flush-meets-deep corner the covered
        // offset leaves a face's inner boundary dipping a few inches off the
        // upper wall between two ON-wall vertices, leaving a sliver gap where the
        // roof should meet the 2nd-floor wall. Straighten that shallow dip back
        // to the wall (fills the gap on the SAME plane, toward the wall, so z only
        // drops). Guarded so real footprint notches (deep, neighbours OFF the
        // wall) are never touched.
        const _dWall = (p) => {
          let d = 1e9;
          for (let j = 0; j < upper.pts.length; j++) {
            const a = upper.pts[j], b = upper.pts[(j + 1) % upper.pts.length];
            if (U.dist(a, b) < 1) continue;
            const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
            let t = L2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2 : 0;
            t = Math.max(0, Math.min(1, t));
            d = Math.min(d, Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y));
          }
          return d;
        };
        for (const f of dissolved) {
          if (f.kind !== 'slope' || f.flat || !f.poly2 || f.poly2.length < 4) continue;
          let changed = true, guard = 0;
          while (changed && f.poly2.length >= 4 && guard++ < 16) {
            changed = false;
            for (let i = 0; i < f.poly2.length; i++) {
              const A = f.poly2[(i - 1 + f.poly2.length) % f.poly2.length];
              const V = f.poly2[i];
              const P = f.poly2[(i + 1) % f.poly2.length];
              const dA = _dWall(A), dV = _dWall(V), dP = _dWall(P);
              if (dA > 3 || dP > 3) continue;                 // both neighbours sit on a wall
              if (dV <= Math.max(dA, dP) + 1) continue;       // V doesn't dip off the wall
              if (dV > 15) continue;                          // SHALLOW dips only (not real notches)
              if (U.dist(A, P) > 140) continue;               // not across a big feature
              const zChord = Math.max(f.coef.A * A.x + f.coef.B * A.y + f.coef.C, f.coef.A * P.x + f.coef.B * P.y + f.coef.C);
              if (zChord > upperPlateZ + 0.5) continue;        // never poke through the upper roof
              f.poly2.splice(i, 1);                            // straighten A–P, fill the notch
              changed = true;
              break;
            }
          }
          f.pts3 = f.poly2.map((p) => ({ x: p.x, y: p.y, z: f.coef.A * p.x + f.coef.B * p.y + f.coef.C }));
          f.maxZ = Math.max(...f.pts3.map((q) => q.z));
        }
        // ---- EAVE STRAIGHTEN: un-bend a diagonal eave at a collinear
        // covered/exposed split. When a lower exterior wall is COLLINEAR with an
        // upper wall but runs PAST it, refineLoopAgainst splits that one straight
        // wall into a COVERED stub (offset 0.5) flanked by an EXPOSED eave (offset
        // 16) on the SAME line; offsetPoly can't intersect the two parallel offsets
        // so the shared corner COLLAPSES inward and the exposed eave bends
        // diagonally from full overhang down to ~the wall (it "dies into the centre
        // of the wall" instead of running straight). The clean detail mirrors the
        // opposite end of the same wall, where the loop winding keeps the eave
        // straight and drops a clean vertical at the boundary. So: find a kept
        // slope face whose eave has a vertex pulled SHORT of the full overhang while
        // a neighbour sits AT full overhang along the eave and the other neighbour
        // is the collapsed stub on the wall line — push that vertex back OUT onto
        // the full-overhang eave line. Defensive: only commit when the result is one
        // clean simple loop with the same winding that doesn't poke above the plate.
        const _simpleCCW = (poly) => {
          if (poly.length < 3) return false;
          for (let i = 0; i < poly.length; i++) {
            if (U.dist(poly[i], poly[(i + 1) % poly.length]) < 0.5) return false;
            const a1 = poly[i], a2 = poly[(i + 1) % poly.length];
            for (let j = i + 1; j < poly.length; j++) {
              if (j === i || (j + 1) % poly.length === i || j === (i + 1) % poly.length) continue;
              const b1 = poly[j], b2 = poly[(j + 1) % poly.length];
              const h = U.lineLine(a1, U.sub(a2, a1), b1, U.sub(b2, b1));
              if (h && h.t > 1e-3 && h.t < 1 - 1e-3 && h.u > 1e-3 && h.u < 1 - 1e-3) return false;
            }
          }
          return true;
        };
        for (const f of dissolved) {
          if (f.kind !== 'slope' || f.flat || !f.edge || !f.poly2 || f.poly2.length < 4) continue;
          if (!f.edge.dir || !f.edge.inN) continue;
          const overD = model.roof.overhang;
          if (!(overD > 1)) continue;
          const outN = U.mul(f.edge.inN, -1);            // outward (eave) direction
          const dOut = (p) => U.dot(U.sub(p, f.edge.a), outN);   // signed overhang at p
          const along = (p) => U.dot(U.sub(p, f.edge.a), f.edge.dir);
          let changed = true, guard = 0;
          while (changed && guard++ < 8) {
            changed = false;
            const N = f.poly2.length;
            for (let i = 0; i < N; i++) {
              const A = f.poly2[(i - 1 + N) % N];
              const V = f.poly2[i];
              const P = f.poly2[(i + 1) % N];
              const dV = dOut(V);
              // V must be an eave-side vertex pulled SHORT of full overhang
              if (!(dV > 0.4 && dV < overD - 0.75)) continue;
              // exactly one neighbour at full overhang & ~collinear along the eave;
              // the other is the collapsed stub on (near) the wall line, sharing V's
              // position along the eave (the vertical drop at the boundary).
              const eaveNb = [A, P].find((q) => Math.abs(dOut(q) - overD) < 0.75 &&
                Math.abs(along(q) - along(V)) > 4);
              const stubNb = [A, P].find((q) => dOut(q) < 0.75 &&
                Math.abs(along(q) - along(V)) < 4);
              if (!eaveNb || !stubNb) continue;
              // push V straight OUT onto the full-overhang eave line (keep its
              // position along the eave, mirroring the clean opposite end).
              const Vnew = U.add(V, U.mul(outN, overD - dV));
              const trial = f.poly2.slice();
              trial[i] = Vnew;
              const a0 = U.polyArea(f.poly2), a1 = U.polyArea(trial);
              if (!(a0 * a1 > 0)) continue;               // winding must be preserved
              if (!_simpleCCW(trial)) continue;           // must stay one simple loop
              const z = f.coef.A * Vnew.x + f.coef.B * Vnew.y + f.coef.C;
              if (z > upperPlateZ + 0.5) continue;         // never poke through the upper roof
              f.poly2 = trial;
              changed = true;
              break;
            }
          }
          f.pts3 = f.poly2.map((p) => ({ x: p.x, y: p.y, z: f.coef.A * p.x + f.coef.B * p.y + f.coef.C }));
          f.maxZ = Math.max(...f.pts3.map((q) => q.z));
        }
        r.faces = dissolved;
        r.lvlIdx = li;
        applyRoofOverrides(r.faces, model);
        if (r.faces.some((f) => f.kind === 'slope')) out.push(r);
      }
    }
    return out;
  };

  /* ---------- merge co-planar slope facets into whole planes ----------
     The straight skeleton subdivides even a plain gable plane into several
     triangles. One polygon per plane gives continuous rafters, seam-free
     skins and clean ridge caps. Union = drop edges shared by two facets of
     the group, chain the border, strip collinear vertices. Falls back to
     the original facets if a group's border doesn't chain into loops. */
  HA.mergeRoofPlanes = (roofData) => {
    if (!roofData || !roofData.ok) return [];
    const slopes = roofData.faces.filter((f) => f.kind === 'slope');
    const groups = new Map();
    for (const f of slopes) {
      const k = f.coef.A.toFixed(5) + '|' + f.coef.B.toFixed(5) + '|' + f.coef.C.toFixed(1);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    const out = [];
    for (const fs of groups.values()) {
      if (fs.length === 1) { out.push(fs[0]); continue; }
      const pKey = (p) => Math.round(p.x * 8) + ',' + Math.round(p.y * 8);
      // T-JUNCTION SPLIT: a face's LONG seam edge vs a neighbour's TWO half edges
      // never cancel (different keys) — the boundary walk then emits a zero-width
      // spur arm (a pinched "twisted" merged ring; hit by the gable re-partition's
      // envelope pieces). Subdivide every edge at every group vertex lying ON it
      // so interior seams cancel segment-by-segment.
      const verts = [];
      for (const f of fs) for (const p of f.poly2) verts.push(p);
      const splitEdge = (a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
        const hits = [];
        for (const v of verts) {
          const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / L2;
          if (t <= 0.001 || t >= 0.999) continue;
          const px = a.x + dx * t, py = a.y + dy * t;
          if (Math.hypot(v.x - px, v.y - py) <= 0.1) hits.push({ t, v });
        }
        hits.sort((m, n) => m.t - n.t);
        const chain = [a];
        for (const h of hits) if (U.dist(h.v, chain[chain.length - 1]) > 0.2) chain.push(h.v);
        if (U.dist(b, chain[chain.length - 1]) > 0.2) chain.push(b); else chain[chain.length - 1] = b;
        return chain;
      };
      const edges = new Map(); // undirected: key -> {a, b, n}
      for (const f of fs) {
        const poly = f.poly2;
        for (let i = 0; i < poly.length; i++) {
          const a0 = poly[i], b0 = poly[(i + 1) % poly.length];
          if (U.dist(a0, b0) < 0.5) continue;
          const chain = splitEdge(a0, b0);
          for (let s = 0; s + 1 < chain.length; s++) {
            const a = chain[s], b = chain[s + 1];
            if (U.dist(a, b) < 0.5) continue;
            const k1 = pKey(a), k2 = pKey(b);
            const k = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
            const e = edges.get(k);
            if (e) e.n++; else edges.set(k, { a, b, n: 1 });
          }
        }
      }
      const border = [...edges.values()].filter((e) => e.n === 1);
      const adj = new Map();
      const push = (k, e) => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(e); };
      for (const e of border) { push(pKey(e.a), e); push(pKey(e.b), e); }
      const used = new Set();
      const loops = [];
      let bad = false;
      for (const e0 of border) {
        if (used.has(e0)) continue;
        const pts = [e0.a];
        let cur = e0.b;
        used.add(e0);
        let guard = border.length + 2, closed = false;
        while (guard-- > 0) {
          if (pKey(cur) === pKey(pts[0])) { closed = true; break; }
          pts.push(cur);
          const cand = (adj.get(pKey(cur)) || []).filter((e) => !used.has(e));
          if (!cand.length) break;
          const e = cand[0];
          used.add(e);
          cur = pKey(e.a) === pKey(cur) ? e.b : e.a;
        }
        if (!closed || pts.length < 3) { bad = true; break; }
        loops.push(pts);
      }
      if (bad || !loops.length) { out.push(...fs); continue; }
      const f0 = fs[0], c = f0.coef;
      const zAt = (p) => c.A * p.x + c.B * p.y + c.C;
      for (const rawLoop of loops) {
        let loop = rawLoop.slice();
        if (U.polyArea(loop) < 0) loop.reverse(); // CCW → 3D normal points up
        // SANITIZE (same idiom as buildLowerNew's pushSlopeFace): the input faces'
        // internal seams can mismatch by ~0.1" (clip precision) — the boundary
        // walk then leaves HAIRPIN spurs / pinched rings that read as a TWISTED
        // merged face. Collapse near-coincident vertices, drop hairpin backtracks
        // (a vertex whose neighbors coincide), then simplify collinear runs.
        {
          let cl = loop.slice(), changed = true, guard = 64;
          while (changed && guard-- > 0) {
            changed = false;
            for (let i = 0; i < cl.length && cl.length > 3;) {           // consecutive dups (incl. wrap)
              if (U.dist(cl[i], cl[(i + 1) % cl.length]) <= 0.3) { cl.splice((i + 1) % cl.length, 1); changed = true; }
              else i++;
            }
            for (let i = 0; i < cl.length && cl.length > 3;) {           // hairpin tips (multi-vertex spurs shrink iteratively)
              const p = cl[(i + cl.length - 1) % cl.length], n = cl[(i + 1) % cl.length];
              if (U.dist(p, n) <= 0.3) { cl.splice(i, 1); changed = true; i = 0; }
              else i++;
            }
          }
          loop = cl;
        }
        const simp = loop.filter((v, i) => {
          const p = loop[(i + loop.length - 1) % loop.length];
          const n = loop[(i + 1) % loop.length];
          const d1 = U.norm(U.sub(v, p)), d2 = U.norm(U.sub(n, v));
          return Math.abs(U.cross(d1, d2)) > 0.01 || U.dot(d1, d2) < 0;
        });
        if (simp.length < 3) continue;
        // a still-twisted MICRO ring (numeric residue) is dropped rather than
        // rendered as a folded face; large rings are kept (never lose real skin)
        if (Math.abs(U.polyArea(simp)) < 50 && HA.ringSelfIntersects && HA.ringSelfIntersects(simp)) continue;
        // eave edge for rafter stationing: longest among the lowest edges
        let edge = f0.edge, best = -1e9;
        for (let i = 0; i < simp.length; i++) {
          const a = simp[i], b = simp[(i + 1) % simp.length];
          const len = U.dist(a, b);
          if (len < 12) continue;
          const zm = zAt(U.lerp(a, b, 0.5));
          const score = -zm * 1000 + len;
          if (score > best) {
            best = score;
            edge = { a, dir: U.norm(U.sub(b, a)), inN: U.norm({ x: c.A, y: c.B }) };
          }
        }
        out.push({
          kind: 'slope', coef: c, poly2: simp,
          pts3: simp.map((p) => ({ x: p.x, y: p.y, z: zAt(p) })),
          maxZ: Math.max(...simp.map(zAt)),
          edge, wallId: f0.wallId, wallIds: fs.map((f) => f.wallId), merged: true,
        });
      }
    }
    return out;
  };

  /* ---------- HIP/EAVE RETURNS at a GABLE end ("wrap a bit") ----------
     Steve: "fix the hip roofs at a gable so they wrap a bit." A lower/wing roof
     that dies into a main-house GABLE END has a horizontal eave whose corner butts
     the raking gable wall. Real cornice/hip returns don't stop dead at the wall —
     the eave (and its fascia) turns 90° and returns a modest 12-18" along the wall
     face before closing, mitered on the corner bisector exactly like _addRidgeCaps.
     Pure + fail-soft: consumes the (merged or raw) lower-roof SLOPE faces and the
     UPPER exterior loop; emits small quad returns tagged kind:'hipreturn' at the eave
     plane. These are a RENDER/trim detail, NOT skeleton slopes, so they are excluded
     from the watertight-slope edge multiset (same as gable pediments) — the skeleton
     stays manifold. wallId is carried so the return highlights with its wall; edge is
     omitted (framing.js only ledgers kind==='slope', so returns never spawn a ledger).
     Returns [] on any degeneracy so it can never break a render. */
  HA.hipGableReturns = (model, lrSlopes, upper, opts) => {
    opts = opts || {};
    if (!Array.isArray(lrSlopes) || !upper || !upper.pts || !upper.walls) return [];
    const WRAP = Math.max(6, Math.min(24, opts.wrapLen != null ? opts.wrapLen : 15));  // return run along the wall (in), clamped 6..24
    // gable-end wall segments of the upper story (outer FACE line, so the return lands on the cladding)
    const half = (w) => (HA.wallT ? HA.wallT(w) : 6) / 2;
    const gsegs = [];
    for (let i = 0; i < upper.walls.length; i++) {
      const w = upper.walls[i]; if (!w || !w.gable) continue;
      const a = upper.pts[i], b = upper.pts[(i + 1) % upper.pts.length];
      if (U.dist(a, b) < 1) continue;
      const oN = U.edgeOutNormal(upper.pts, i);
      const off = U.mul(oN, half(w));
      gsegs.push({ a: U.add(a, off), b: U.add(b, off), dir: U.norm(U.sub(b, a)), oN });
    }
    if (!gsegs.length) return [];
    const out = [];
    const seen = new Set();
    for (const f of lrSlopes) {
      if (!f || f.kind !== 'slope' || !f.pts3 || f.pts3.length < 3) continue;
      const P = f.pts3;
      let zlo = Infinity; for (const p of P) if (p.z < zlo) zlo = p.z;
      // the EAVE edge: the (near-)level low edge of this slope (both ends within ~2" of zlo)
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if (Math.abs(a.z - zlo) > 2 || Math.abs(b.z - zlo) > 2) continue;
        const elen = Math.hypot(b.x - a.x, b.y - a.y);
        if (elen < 12) continue;
        const eDir = { x: (b.x - a.x) / elen, y: (b.y - a.y) / elen };
        // each eave endpoint that lands ON a gable-end wall segment gets a return
        for (const [end, inward] of [[a, b], [b, a]]) {
          let g = null;
          for (const s of gsegs) {
            // endpoint on the wall line AND within the segment span
            const perp = Math.abs(U.cross(s.dir, U.sub(end, s.a)));
            const along = U.dot(U.sub(end, s.a), s.dir);
            if (perp < 3 && along > -3 && along < U.dist(s.a, s.b) + 3) { g = s; break; }
          }
          if (!g) continue;
          // the eave must run roughly PERPENDICULAR into the wall (a true hip/eave-to-gable
          // corner), not graze along it — else it's the die-in edge, no return there.
          if (Math.abs(U.dot(eDir, g.dir)) > 0.3) continue;
          // return direction = along the wall, on the side AWAY from the roof body (outboard),
          // so the wrap tucks PAST the corner like a real cornice return. The eave runs ⟂ into
          // the wall, so "into the roof" (inDir) is ~⟂ to the wall and can't pick the side; use the
          // slope face's plan centroid instead — the return points along the wall away from it.
          const inDir = U.norm(U.sub(inward, end));            // eave direction into the roof
          const cen = U.polyCentroid(f.poly2 || f.pts3.map((p) => ({ x: p.x, y: p.y })));
          let rDir = g.dir;
          if (U.dot(rDir, U.sub(cen, end)) > 0) rDir = U.mul(rDir, -1);  // point away from the roof body
          const tip = { x: end.x + rDir.x * WRAP, y: end.y + rDir.y * WRAP };
          // de-dupe (two faces can share the same eave corner)
          const key = Math.round(end.x) + ',' + Math.round(end.y) + '|' + Math.round(tip.x) + ',' + Math.round(tip.y);
          if (seen.has(key)) continue; seen.add(key);
          // small return quad at the eave plane: [corner, tip, tip-inset, corner-inset],
          // inset a hair (mitered) back toward the eave along eDir so it reads as a fold.
          const inset = Math.min(WRAP, elen * 0.5);
          const eInto = U.mul(eDir, U.dot(inDir, eDir) >= 0 ? inset : -inset);
          const z = end.z;
          const quad = [
            { x: end.x, y: end.y, z },
            { x: tip.x, y: tip.y, z },
            { x: tip.x + eInto.x, y: tip.y + eInto.y, z },
            { x: end.x + eInto.x, y: end.y + eInto.y, z },
          ];
          if (Math.abs(U.polyArea(quad.map((p) => ({ x: p.x, y: p.y })))) < 4) continue;
          out.push({ kind: 'hipreturn', wallId: f.wallId, pts3: quad, corner: { x: end.x, y: end.y, z }, tip: { x: tip.x, y: tip.y, z }, wrap: WRAP });
        }
      }
    }
    return out;
  };

  /* ---------- ridge / hip / valley structural lines ----------
     Shared edges between two non-coplanar slope faces, classified by the
     crease (level peak = ridge, sloped peak = hip, trough = valley), with
     collinear same-kind chains merged. Endpoints carry z so framing can
     place real boards. Mirrors plan2d's annotation logic. */
  HA.roofMemberLines = (roofData) => {
    if (!roofData || !roofData.ok) return [];
    const slopes = roofData.faces.filter((f) => f.kind === 'slope');
    const zOf = (c, p) => c.A * p.x + c.B * p.y + c.C;
    const segs = [];
    for (const f of slopes) {
      const poly = f.poly2;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (U.dist(a, b) < 6) continue;
        segs.push({ a, b, f });
      }
    }
    const raw = [];
    const seen = new Set();
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s1 = segs[i], s2 = segs[j];
        if (s1.f === s2.f) continue;
        const coincident =
          (U.dist(s1.a, s2.a) < 1.5 && U.dist(s1.b, s2.b) < 1.5) ||
          (U.dist(s1.a, s2.b) < 1.5 && U.dist(s1.b, s2.a) < 1.5);
        if (!coincident) continue;
        const c1 = s1.f.coef, c2 = s2.f.coef;
        if (Math.abs(c1.A - c2.A) < 1e-4 && Math.abs(c1.B - c2.B) < 1e-4 &&
            Math.abs(c1.C - c2.C) < 0.5) continue; // coplanar seam
        const mid = U.lerp(s1.a, s1.b, 0.5);
        const d = U.norm(U.sub(s1.b, s1.a));
        const pn = { x: -d.y, y: d.x };
        const p1 = U.add(mid, U.mul(pn, 2)), p2 = U.sub(mid, U.mul(pn, 2));
        const into1 = U.pointInPoly(p1, s1.f.poly2) ? p1 : p2;
        const into2 = U.pointInPoly(p1, s2.f.poly2) ? p1 : p2;
        const zm = zOf(c1, mid);
        const g1 = zOf(c1, into1) - zm;
        const g2 = zOf(c2, into2) - zm;
        const za = zOf(c1, s1.a), zb = zOf(c1, s1.b);
        let kind = null;
        if (g1 < -0.01 && g2 < -0.01) kind = Math.abs(za - zb) < 0.5 ? 'ridge' : 'hip';
        else if (g1 > 0.01 && g2 > 0.01) kind = 'valley';
        if (!kind) continue;
        const key = kind + ':' + Math.round(mid.x / 2) + ',' + Math.round(mid.y / 2);
        if (seen.has(key)) continue;
        seen.add(key);
        raw.push({ kind, a: { x: s1.a.x, y: s1.a.y, z: za }, b: { x: s1.b.x, y: s1.b.y, z: zb } });
      }
    }
    let merged = raw, changed = true;
    let guard = raw.length + 4;
    while (changed && guard-- > 0) {
      changed = false;
      for (let i = 0; i < merged.length && !changed; i++) {
        for (let j = i + 1; j < merged.length && !changed; j++) {
          const m = merged[i], n = merged[j];
          if (m.kind !== n.kind) continue;
          const d1 = U.norm(U.sub(m.b, m.a)), d2 = U.norm(U.sub(n.b, n.a));
          if (Math.abs(U.cross(d1, d2)) > 0.05) continue;
          const pairs = [['a', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'b']]
            .filter(([p, q]) => U.dist(m[p], n[q]) < 2);
          if (!pairs.length) continue;
          const ptsAll = [m.a, m.b, n.a, n.b];
          let bp = null, bd = -1;
          for (let p = 0; p < 4; p++)
            for (let q = p + 1; q < 4; q++) {
              const dd = U.dist(ptsAll[p], ptsAll[q]);
              if (dd > bd) { bd = dd; bp = [ptsAll[p], ptsAll[q]]; }
            }
          merged = merged.filter((x) => x !== m && x !== n);
          merged.push({ kind: m.kind, a: { ...bp[0] }, b: { ...bp[1] } });
          changed = true;
        }
      }
    }
    for (const m of merged) m.len = U.dist(m.a, m.b);
    return merged;
  };

  /* ---------- roof style presets ----------
     Sets the gable flags across the top level's exterior walls:
     hip = none gabled; gable = the end walls (perpendicular to the long/ridge
     axis); mixed = gable the shorter runs + hip the long stretches; random =
     coin-flip per wall. Geometry (HA.buildRoof) does the rest. */
  HA.roofStyle = (model, style) => {
    const li = HA.roofLevelIdx(model);
    const loop = HA.exteriorLoop(model, li);
    if (!loop || !loop.walls.length) return false;
    // SHED (true mono-pitch): not a gable-flag preset — it flips the whole roof
    // engine to the single-plane buildShed path via model.roof.style. Clear the
    // per-wall gable flags (buildShed ignores them) and keep any prior shedDir; a
    // default high side (back / longer axis) is resolved inside buildShed.
    // The STYLED roofs (shed + gambrel/dutchgable/butterfly) share the idiom:
    // they flip the roof engine via model.roof.style, ignore per-wall gable flags.
    if (style === 'shed' || style === 'gambrel' || style === 'dutchgable' || style === 'butterfly') {
      model.roof = model.roof || {};
      model.roof.style = style;
      for (const w of loop.walls) w.gable = false;
      return true;
    }
    // any other style leaves the styled modes — restore skeleton hip/gable geometry.
    if (model.roof && (model.roof.style === 'shed' || model.roof.style === 'gambrel' ||
        model.roof.style === 'dutchgable' || model.roof.style === 'butterfly'))
      model.roof.style = style;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of loop.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const spanX = maxX - minX, spanY = maxY - minY;
    const ridgeAlongX = spanX >= spanY;       // ridge runs along the longer side
    const shortSpan = Math.min(spanX, spanY);
    for (const w of loop.walls) {
      const d = HA.wallDir(w);
      const runsX = Math.abs(d.x) >= Math.abs(d.y);
      const len = HA.wallLen(w);
      if (style === 'gable') w.gable = ridgeAlongX ? !runsX : runsX; // end walls
      else if (style === 'mixed') w.gable = len <= shortSpan * 1.15;  // short runs
      else if (style === 'random') w.gable = Math.random() < 0.5;
      else w.gable = false;                                           // hip
    }
    // SAFETY: a roof needs at least one wall carrying a hip/eave plane. On square /
    // compact / L footprints 'mixed' (and 'random') can flag EVERY wall as a gable,
    // which makes buildRoof bail ("At least one wall must carry a roof plane") and the
    // building goes ROOFLESS. If every wall ended up gabled, un-gable the longest run
    // on EACH axis (the natural ridge-bearing eaves) so a roof always builds — only
    // triggers in that failure case, so every footprint that already had a hip is
    // byte-unchanged.
    if (style !== 'hip' && loop.walls.length && loop.walls.every((w) => w.gable)) {
      let lx = null, ly = null, lxLen = -1, lyLen = -1;
      for (const w of loop.walls) {
        const d = HA.wallDir(w), len = HA.wallLen(w);
        if (Math.abs(d.x) >= Math.abs(d.y)) { if (len > lxLen) { lxLen = len; lx = w; } }
        else if (len > lyLen) { lyLen = len; ly = w; }
      }
      if (lx) lx.gable = false;
      if (ly) ly.gable = false;
    }
    return true;
  };

  /* ---------- 3D cap / entrance-hip geometry helpers (pure, testable) ----------
     Kept here (loaded by the dev gate) rather than in view3d.js (which needs THREE
     and isn't unit-tested) so the math the 3D renderer relies on can be locked in. */

  /* How far to pull a ridge/hip CAP board back from each end so converging caps
     leave a clean gap instead of overlapping into triangular tabs at an apex
     (Steve's "little triangles on the ridge edge boards"). Half the cap width
     (6.5") at most, never more than half the run, never negative. */
  HA.roofCapInset = (axisLen) => Math.max(0, Math.min(6.5, (axisLen || 0) * 0.5 - 0.5));

  /* The ridge segment [in,out] (along the entrance depth) for a 4-slope "pyramid"
     hip roof of plan depth `dp` inches. The ridge length is FLOORED at 12" so a
     wide-shallow entrance no longer collapses the ridge to a point and spikes the
     end-triangles (it stays a real short ridge). Always 0 < in < out < dp. */
  HA.hipRidgeBounds = (dp) => {
    dp = (dp > 0 && isFinite(dp)) ? dp : 12;
    const ridgeLen = Math.min(dp * 0.85, Math.max(12, dp * 0.4));
    const mid = dp * 0.5;
    return { in: mid - ridgeLen / 2, out: mid + ridgeLen / 2, len: ridgeLen };
  };

  /* ---------- ENTRANCE ROOF DIE-IN (California framing) helpers ----------
     When a porch/entrance cover roof attaches where the MAIN roof surface is
     AT or BELOW the porch roof's back edge (low eaves / 1-story), the porch
     roof must be OVERFRAMED onto the main slope: its ridge extends onto the
     main plane and dies at the plane intersection (the APEX), and its side
     skins meet the main roof in VALLEY lines. These are the pure planar solves
     the 3D renderer (view3d _buildEntranceRoof) consumes. All fail-soft: any
     degenerate/parallel input returns null and the caller falls back to the
     current wall-stop behavior.

     PLANE CONVENTION matches view3d's _planeCoef and section2d.roofTopAt:
       a plane {A,B,C} means  z = A*x + B*y + C.  */

  const _zOnPlane = (pl, x, y) => pl.A * x + pl.B * y + pl.C;
  HA.planeZAt = _zOnPlane;

  /* Intersect a 3D line (point p0 {x,y,z}, plan direction d {x,y} with a
     vertical rise rate dz per unit of |d| already folded into a z-slope) with
     a plane {A,B,C}. The line is parametrized p(t) = p0 + t*(dx,dy,dzL) where
     the caller passes the line as TWO endpoints so we derive its own z-slope.
     Returns { x,y,z,t } of the crossing, or null if the line is parallel to
     the plane (never crosses) within tol. t is measured from p0 toward p1
     (t=0 at p0, t=1 at p1); it is NOT clamped — the caller clamps/validates. */
  HA.linePlaneCross = (p0, p1, pl, tol) => {
    tol = tol || 1e-9;
    if (!p0 || !p1 || !pl) return null;
    // f(t) = z_line(t) - z_plane(t). Both are affine in t, so one linear solve.
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    // residual at p0 and p1: how far the line's z is ABOVE the plane there.
    const r0 = p0.z - _zOnPlane(pl, p0.x, p0.y);
    const r1 = p1.z - _zOnPlane(pl, p1.x, p1.y);
    const denom = r0 - r1;              // = d/dt of (plane_z - line_z) scaled; if ~0 the line runs parallel
    if (Math.abs(denom) < tol) return null;
    const t = r0 / denom;
    return { x: p0.x + dx * t, y: p0.y + dy * t, z: p0.z + dz * t, t: t };
  };

  /* Intersection LINE of two non-parallel planes {A,B,C}, returned as a plan
     line: a point {x,y} on it + a unit plan direction {x,y}, plus the shared
     z at that point (both planes agree there). The valley/hip between the porch
     skin plane and the main-roof plane. null if the planes are parallel in
     plan (same gradient) → no distinct crossing line. */
  HA.planePlaneLine = (p, q, tol) => {
    tol = tol || 1e-9;
    if (!p || !q) return null;
    // z_p - z_q = 0  =>  (Ap-Aq)x + (Bp-Bq)y + (Cp-Cq) = 0  — a line in plan.
    const a = p.A - q.A, b = p.B - q.B, c = p.C - q.C;
    const nrm = Math.hypot(a, b);
    if (nrm < tol) return null;         // parallel gradients: planes never cross in a line (or are coincident)
    // plan direction along the line is perpendicular to (a,b)
    const dir = { x: -b / nrm, y: a / nrm };
    // a point on the line: closest point to origin on a*x+b*y+c=0
    const k = -c / (a * a + b * b);
    const pt = { x: a * k, y: b * k };
    return { pt: pt, dir: dir, z: _zOnPlane(p, pt.x, pt.y) };
  };

  /* DIE-IN DETECTION for one entrance. Given the main-roof plane the porch
     dies into (mainPl {A,B,C}) and the porch back-edge SAMPLES (array of
     {x,y,z} points along the wall line o=0, z = the porch skin height there),
     decide whether die-in is required.
       - if EVERY sample's porch z is at/below the main roof there (within tol)
         the porch tucks under the wall's roof line → case (a), NO die-in
         (current wall-ledger behavior is correct).
       - if the porch's back edge would rise ABOVE the main roof anywhere →
         die-in REQUIRED.
     Returns { dieIn:bool, maxAbove:number } (maxAbove = worst porch-above-main
     gap in inches; 0 or negative means fully below). mainPl null → no die-in
     (can't sample → fail-soft to wall stop). */
  HA.entranceDieInNeeded = (mainPl, backSamples, tol) => {
    tol = (tol == null) ? 0.25 : tol;   // 1/4" slop
    if (!mainPl || !Array.isArray(backSamples) || !backSamples.length) return { dieIn: false, maxAbove: 0 };
    let maxAbove = -Infinity;
    for (const s of backSamples) {
      if (!s || !isFinite(s.z)) continue;
      const zMain = _zOnPlane(mainPl, s.x, s.y);
      if (!isFinite(zMain)) return { dieIn: false, maxAbove: 0 };
      const above = s.z - zMain;
      if (above > maxAbove) maxAbove = above;
    }
    if (!isFinite(maxAbove)) return { dieIn: false, maxAbove: 0 };
    return { dieIn: maxAbove > tol, maxAbove: maxAbove };
  };

  /* Clip a plan polygon (array of {x,y,z}, z carried) against a reference plane
     {A,B,C} by the signed z-gap (poly z minus plane z), Sutherland–Hodgman: the
     cut edge lands exactly on the plane-intersection (valley) line and the cut
     vertices carry the correct interpolated z. `keep`='above' keeps gap>=0,
     'below' (default) keeps gap<=0. NOTE for the die-in caller: an OVERFRAMED
     (California) porch skin is the part of its plane ABOVE the main roof —
     clip with keep='above' (the part that dips UNDER the main surface inboard
     of the valley is what gets cut). Returns a new ring (possibly empty). */
  HA.clipPolyByPlaneZ = (ring, pl, keep) => {
    if (!Array.isArray(ring) || ring.length < 3 || !pl) return ring ? ring.slice() : [];
    const below = keep !== 'above';
    const gap = (p) => (p.z - _zOnPlane(pl, p.x, p.y));       // >0 : porch above main
    const inside = (p) => below ? (gap(p) <= 1e-7) : (gap(p) >= -1e-7);
    const lerp = (a, b) => {
      const ga = gap(a), gb = gap(b);
      const t = Math.abs(ga - gb) < 1e-12 ? 0 : ga / (ga - gb);   // gap==0 crossing point
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    };
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const cur = ring[i], prev = ring[(i + ring.length - 1) % ring.length];
      const cIn = inside(cur), pIn = inside(prev);
      if (cIn) {
        if (!pIn) out.push(lerp(prev, cur));
        out.push({ x: cur.x, y: cur.y, z: cur.z });
      } else if (pIn) {
        out.push(lerp(prev, cur));
      }
    }
    return out;
  };

  /* Plan (xy) area of a ring — the die-in caller's degenerate guard: a clipped
     skin that collapsed to a sliver (wrong side / bad plane) can still have
     >=3 vertices but ~zero plan area, so vertex count alone is NOT a safe
     acceptance test (a zero-area sliver once replaced the whole porch skin). */
  HA.ringPlanArea = (ring) => {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a / 2);
  };

  /* ---- ring self-intersection repair (pure) ----
     The skeleton face chainer walks segments by nearest endpoint (1.5" tol);
     on a near-degenerate face (a ridge only a few inches long) it can emit the
     vertices in a TWISTED (bowtie) order. The ring is still planar and has
     ~the right area, but triangulation overlaps/flips → the renderer paints a
     white/dark diagonal band across the roof end from the ridge to the eave
     corner (owner's screenshot, craftsman 2story seed 7 lower roof). Detect
     the crossing and untangle with classic 2-opt segment reversal. */
  const _segsCross = (a, b, c, d) => {
    const d1 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
    const d2 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
    const d3 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d4 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const _firstCross = (ring) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;   // adjacent around the wrap
        if (_segsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return [i, j];
      }
    }
    return null;
  };
  HA.ringSelfIntersects = (ring) => Array.isArray(ring) && ring.length >= 4 && !!_firstCross(ring);

  /* Untangle a self-intersecting plan ring by 2-opt: reverse the sub-chain
     between each crossing edge pair until simple (bounded passes). Returns a
     NEW simple ring, or the ORIGINAL ring untouched if it cannot be fixed
     (fail-soft — never worse than the input). z (and any extra fields) ride
     along with their vertices. */
  HA.untwistRing = (ring) => {
    if (!Array.isArray(ring) || ring.length < 4) return ring;
    let out = ring.slice();
    let guard = ring.length * ring.length + 4;
    while (guard-- > 0) {
      const x = _firstCross(out);
      if (!x) return out;                       // simple — done
      const [i, j] = x;
      // reverse out[i+1 .. j] (untangles the crossing between edges i and j)
      const head = out.slice(0, i + 1), mid = out.slice(i + 1, j + 1).reverse(), tail = out.slice(j + 1);
      out = head.concat(mid, tail);
    }
    return _firstCross(out) ? ring : out;       // couldn't untangle → original
  };

  /* Is a plan point inside a plan polygon (ring of {x,y})? Thin wrapper on the
     shared util so the die-in helpers can CLAMP an apex/valley to the main
     face's poly2 without pulling U into every caller. */
  HA.pointInFace = (pt, poly2) => {
    if (!pt || !Array.isArray(poly2) || poly2.length < 3) return false;
    try { return U.pointInPoly(pt, poly2); } catch (e) { return false; }
  };

  /* FULL GABLE-PORCH DIE-IN solve. Inputs (all world coords):
       ridgeBack {x,y,z}  — porch ridge point AT the wall (o=0)
       ridgeFwd  {x,y,z}  — porch ridge point at the FRONT (o=dp+ov); together
                            they define the ridge line + its z-slope.
       leftPl,rightPl     — the two porch SKIN planes {A,B,C}.
       mainPl             — the main roof plane {A,B,C} the porch dies into.
       facePoly2          — the main face's plan polygon (for clamping), optional.
     Returns null if no valid die-in (caller falls back to wall stop), else:
       { apex:{x,y,z},           — ridge×main crossing (the die-in point)
         leftValley:{pt,dir,z},  — left skin × main plane line
         rightValley:{pt,dir,z}, — right skin × main plane line
         onFace:bool }           — apex lies inside facePoly2 (else clamp/fallback advised)
     The ridge is extended INWARD (toward the wall and beyond, o<0) from
     ridgeFwd toward ridgeBack and past it until it meets the main plane. */
  HA.gablePorchDieIn = (ridgeBack, ridgeFwd, leftPl, rightPl, mainPl, facePoly2) => {
    if (!ridgeBack || !ridgeFwd || !mainPl) return null;
    // ridge line from FRONT to BACK, extended past the wall: solve the crossing.
    // Extend the segment far past ridgeBack so the crossing (which lands o<0,
    // inward of the wall on the main slope) is found.
    const dx = ridgeBack.x - ridgeFwd.x, dy = ridgeBack.y - ridgeFwd.y, dz = ridgeBack.z - ridgeFwd.z;
    const far = { x: ridgeFwd.x + dx * 8, y: ridgeFwd.y + dy * 8, z: ridgeFwd.z + dz * 8 };
    const apex = HA.linePlaneCross(ridgeFwd, far, mainPl);
    if (!apex || !isFinite(apex.z)) return null;
    const leftValley = leftPl ? HA.planePlaneLine(leftPl, mainPl) : null;
    const rightValley = rightPl ? HA.planePlaneLine(rightPl, mainPl) : null;
    const onFace = facePoly2 ? HA.pointInFace(apex, facePoly2) : true;
    return { apex: { x: apex.x, y: apex.y, z: apex.z }, leftValley, rightValley, onFace };
  };

  /* ---- ROOF-LOOP POP-OUT CONTINUATION (pure preprocessing) ----
     ROOF-CONTINUATION-SPEC (Steve): when a shallow addition/pop-out sticks out of a
     GABLE END, the roof line should CONTINUE straight across it and the wider mass
     stay gable — Chief breaks the wall manually; we do it automatically.

     Detect each 3-edge run  base→OUT→ALONG→BACK→base  that protrudes OUTWARD from an
     otherwise-straight side (a convex bump), where:
       - the bump lies on a GABLE-END side: its outward normal is ~parallel to the
         footprint's RIDGE axis (long bbox axis). Continuing along the ridge keeps the
         roof profile constant; an EAVE-side bump (normal ⟂ ridge) would push a slope
         downhill into its own plate, so it stays hip/valley as today.
       - depth d (OUT/BACK length) ≤ maxDepthIn (8ft) AND ≤ 40% of the adjacent mass's
         perpendicular span (bbox extent ⟂ the base line), and
       - all plate heights across the run + the two flanking base walls MATCH.
     Returns { pts, walls, coveredIdx:Set, gableIdx:Set } — a DERIVED ROOF loop where
     each qualifying notch is replaced by the straight base segment (carrying the
     flanking wall so its gable directive transfers to the continued edge), the removed
     OUT/ALONG/BACK edges re-inserted as ZERO-LENGTH-free COVERED sub-edges appended so
     buildOn drops their slope faces + a pediment fills the step. Or NULL when nothing
     qualifies (caller keeps the original loop — byte-identical legacy).
     Pure + fail-soft: any malformed input → null. */
  HA.continueRoofPopouts = (loop, opts) => {
    opts = opts || {};
    if (!loop || !Array.isArray(loop.pts) || loop.pts.length < 6 || !Array.isArray(loop.walls)) return null;
    const pts = loop.pts, walls = loop.walls, n = pts.length;
    if (walls.length !== n) return null;
    const MAXD = opts.maxDepthIn != null ? opts.maxDepthIn : 96;      // 8 ft
    const MAXFRAC = opts.maxFrac != null ? opts.maxFrac : 0.40;        // ≤ 40% of the mass span
    const plateOf = opts.plateOf || ((w) => (w && w.height) || 0);
    const dir = (i) => U.norm(U.sub(pts[(i + 1) % n], pts[i]));
    const elen = (i) => U.dist(pts[i], pts[(i + 1) % n]);
    const area = U.polyArea(pts);
    const orient = area > 0 ? 1 : -1;                                  // >0 CCW: interior LEFT of a→b
    // ridge axis = longer bbox axis
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const spanX = x1 - x0, spanY = y1 - y0;
    const ridge = spanX >= spanY ? { x: 1, y: 0 } : { x: 0, y: 1 };   // ridge runs along the LONG axis
    const massAcross = spanX >= spanY ? spanY : spanX;                 // full mass ⟂ the base line

    const notches = [];   // {i0,i1,i2,i3, depth, baseWall} : corner i1 = OUT start, edges i1(out) i2(along) i3? ...
    // A notch is 4 consecutive corners a=i, b=i+1, c=i+2, d=i+3 with edges OUT=i, ALONG=i+1, BACK=i+2,
    // where OUT & BACK are antiparallel, both ⟂ ALONG, the notch turns OUTWARD (convex bump), and the
    // base corners a & d lie on ONE straight line (flanking edges e_(i-1) and e_(i+3) collinear with a→d).
    const used = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const a = i, b = (i + 1) % n, c = (i + 2) % n, dC = (i + 3) % n;
      if (used[i] || used[b] || used[c]) continue;
      const dOut = dir(a), dAlong = dir(b), dBack = dir(c);
      if (U.dot(dOut, dBack) > -0.985) continue;                      // OUT/BACK not antiparallel
      if (Math.abs(U.dot(dOut, dAlong)) > 0.12) continue;             // ALONG not ⟂ OUT
      // OUTWARD bump: both corners of the notch must be CONVEX (jut out of the otherwise-straight
      // side). On a loop of winding `orient`, a convex corner has cross(inDir,outDir)*orient > 0.
      // (A recessed notch — an INWARD dent — turns the other way and must NOT continue.)
      const turnB = U.cross(dOut, dAlong) * orient;
      const turnC = U.cross(dAlong, dBack) * orient;
      if (turnB < 0.2 || turnC < 0.2) continue;                       // both corners must jut OUTWARD
      const depth = elen(a);                                          // OUT length
      if (!(depth > 1) || depth > MAXD) continue;
      if (Math.abs(elen(c) - depth) > 6) continue;                    // OUT ≈ BACK length (a clean rectangular bump)
      if (depth > MAXFRAC * massAcross) continue;                     // shallow vs the mass it sits on
      // base line = through corner a (pts[a]) along the flanking edge direction; d (pts[dC]) must be on it.
      const baseDir = U.norm(U.sub(pts[a], pts[dC]));
      if (Math.hypot(baseDir.x, baseDir.y) < 0.5) continue;
      const off = Math.abs(U.cross(baseDir, U.sub(pts[b], pts[a])));  // sanity (OUT ⟂ base ⇒ |cross|≈depth)
      // GABLE-END: the bump's OUTWARD normal ~ parallel to the ridge axis.
      const outN = U.mul(U.edgeOutNormal(pts, a), 1);                 // outward normal of the OUT edge? no — use ALONG's outward
      const bumpOutN = U.edgeOutNormal(pts, b);                       // ALONG faces OUT of the bump tip
      if (Math.abs(U.dot(bumpOutN, ridge)) < 0.9) continue;           // eave-side bump → skip (stays hip/valley)
      // flanking base edges collinear with a→d (the side is otherwise straight)
      const eBefore = (a + n - 1) % n, eAfter = dC;                   // edge INTO a, edge OUT of d
      const dBefore = dir(eBefore), dAfter = dir(eAfter);
      const baseAD = U.norm(U.sub(pts[dC], pts[a]));
      if (Math.abs(U.cross(dBefore, baseAD)) > 0.02 || Math.abs(U.cross(dAfter, baseAD)) > 0.02) continue;
      // plate heights: OUT/ALONG/BACK walls + the two flanking base walls all equal
      const ph = [walls[a], walls[b], walls[c], walls[eBefore], walls[eAfter]].map(plateOf);
      if (Math.max(...ph) - Math.min(...ph) > 0.5) continue;
      // no lower-roof / porch directive on the pop-out walls
      const hasDirective = (w) => !!(w && (w.roofDirective || w.lowerRoof || w.porch));
      if ([walls[a], walls[b], walls[c]].some(hasDirective)) continue;
      notches.push({
        a, b, c, dC, eBefore, depth,
        // plan geometry for the STEPPED-RAKE roof extension (buildOn): the continued
        // base segment aPt→dPt, the bump's outward normal, and its depth.
        aPt: { x: pts[a].x, y: pts[a].y }, dPt: { x: pts[dC].x, y: pts[dC].y },
        outN: { x: bumpOutN.x, y: bumpOutN.y },
      });
      used[a] = used[b] = used[c] = true;
      void off; void outN;
    }
    if (!notches.length) return null;

    // Build the derived ROOF loop: for each corner, keep it UNLESS it's the interior of a notch
    // (corner b or c). At corner a (base start of a notch) DROP corners b,c and jump straight to d.
    const byStart = new Map();  // start corner a -> notch
    for (const nt of notches) byStart.set(nt.a, nt);
    const skip = new Set();
    for (const nt of notches) { skip.add(nt.b); skip.add(nt.c); }
    const outPts = [], outWalls = [], gableIdx = new Set();
    const coveredWalls = [];    // OUT/ALONG/BACK walls, emitted as covered sub-edges after the main ring
    for (let i = 0; i < n; i++) {
      if (skip.has(i)) continue;
      const nt = byStart.get(i);
      if (nt) {
        // continued straight edge  a → d, carrying the FLANKING base wall (its gable transfers here)
        const baseWall = walls[nt.eBefore] || walls[i];
        outPts.push({ x: pts[nt.a].x, y: pts[nt.a].y });
        outWalls.push(baseWall);
        if (baseWall && baseWall.gable) gableIdx.add(outPts.length - 1);
        coveredWalls.push(walls[nt.a], walls[nt.b], walls[nt.c]);
      } else {
        outPts.push({ x: pts[i].x, y: pts[i].y });
        outWalls.push(walls[i]);
        if (walls[i] && walls[i].gable) gableIdx.add(outPts.length - 1);
      }
    }
    if (outPts.length < 3) return null;
    return {
      pts: outPts, walls: outWalls, gableIdx, coveredWalls, notches: notches.length,
      // per-notch plan geometry for the stepped-rake slope extension
      notchGeo: notches.map((nt) => ({ aPt: nt.aPt, dPt: nt.dPt, outN: nt.outN, depth: nt.depth })),
    };
  };

  /* =====================================================================
     ATTIC VENTILATION — HA.roofVents(model)   (PURE, additive)
     ---------------------------------------------------------------------
     Steve, ROOF-VENT batch (C8-C9). Computes IRC R806.2 attic ventilation
     for the auto roof: required NET FREE AREA (NFA), then a placement plan
     (soffit/eave vents, ridge vent, gable vents) whose provided NFA meets
     the requirement, plus roof-plan symbols/tags, a vent legend, gable
     window-swap handling, and takeoff line items.

     CODE (IRC R806.2 / IBC 1202.2):
       - Minimum net free ventilating area = 1/150 of the attic floor area.
       - REDUCED to 1/300 when BOTH: (1) a Class-I/II vapor retarder on the
         warm side (assumed satisfied for the design worksheet), AND
         (2) BALANCED venting — 40%..50% (we accept 40%..60%, the common
         "at least 40% and not more than 50%, ≤60% allowed by many AHJs")
         of the required NFA is provided by HIGH vents (ridge/gable, within
         3 ft of the ridge) and the balance by LOW vents (eave/soffit).
       We size to 1/300 when the plan CAN be balanced (has both eave runs
       and ridge/gable high venting); otherwise fall back to 1/150. The
       result flags `balanced` + the achieved high fraction so the roof
       plan can print which rule governed.

     NFA per device (standard aluminum residential products, net free area):
       - soffit/eave vent  16"×8" undereave louver ............ 56 sq in
       - continuous ridge vent .............................. 18 sq in / LF
       - continuous soffit strip (2" cont.) ................. 9 sq in / LF
       - gable louver 12"×12" / 12"×18" / 14"×24" .... 65 / 98 / 140 sq in

     ATTIC FLOOR AREA: the exterior-loop footprint of each roof volume
     (main roof + each lower roof) is one attic. Multiple roof levels →
     per-attic sizing; a single volume → one conservative attic.

     Units: inches / square inches / linear feet.  Absence-safe: a model
     with no roof returns { ok:false }.  READ-ONLY on the model.
     ===================================================================== */
  const VENT_NFA = {
    soffit:  56,    // 16x8 undereave louver, net free area (sq in)
    ridgeLf: 18,    // continuous ridge vent, sq in per LF
    gable: { '12x12': 65, '12x18': 98, '14x24': 140 },
  };
  // pick the largest standard gable louver whose NFA does not exceed the
  // per-gable target (but never smaller than the 12x12 minimum).
  const pickGable = (targetSqin) => {
    const opts = [['12x12', 65], ['12x18', 98], ['14x24', 140]];
    let chosen = opts[0];
    for (const o of opts) if (o[1] <= targetSqin + 1) chosen = o;
    return { size: chosen[0], nfa: chosen[1] };
  };
  const inchesToLf = (v) => v / 12;

  // read the per-gable fill directive defensively (no model.js dependency):
  //   wall.gableFill = 'vent' (default) | 'window' | 'none'
  const gableFillOf = (wall) => {
    const f = wall && wall.gableFill;
    return (f === 'window' || f === 'none') ? f : 'vent';
  };

  /* Attic floor area (sq in) for one roof volume from its exterior loop. */
  const atticFloorSqin = (loop) => (loop && loop.pts && loop.pts.length >= 3)
    ? Math.abs(U.polyArea(loop.pts)) : 0;

  /* Collect the eave (non-gable) exterior wall run length and the gable
     end walls for one roof volume. rd = built roofData for that volume,
     loop = its exterior loop {pts,walls}. Returns {eaveLf, ridgeLf, gables[]}. */
  const ventGeomFor = (model, loop, rd) => {
    const out = { eaveLf: 0, ridgeLf: 0, gables: [] };
    if (!loop || !loop.walls) return out;
    // eave length = exterior perimeter of NON-gable walls; gable walls are
    // the vertical ends. roofData.faces kind:'gable' carry wallId — use them
    // to identify gable ends; fall back to wall.gable on the loop.
    const gableWallIds = new Set();
    if (rd && rd.ok && Array.isArray(rd.faces)) {
      for (const f of rd.faces) if (f.kind === 'gable' && !f.popout && f.wallId != null) gableWallIds.add(f.wallId);
    }
    for (let i = 0; i < loop.walls.length; i++) {
      const w = loop.walls[i];
      const a = loop.pts[i], b = loop.pts[(i + 1) % loop.pts.length];
      const lenIn = U.dist(a, b);
      const isGable = w && (gableWallIds.has(w.id) || w.gable === true);
      if (isGable) {
        out.gables.push({ wall: w, lenIn, a, b, mid: U.lerp(a, b, 0.5),
          fill: gableFillOf(w) });
      } else {
        out.eaveLf += inchesToLf(lenIn);
      }
    }
    // ridge length available for a continuous ridge vent = sum of ridge
    // member lines (level ridges only; hips/valleys aren't vented).
    if (rd && rd.ok) {
      try {
        const members = HA.roofMemberLines(rd);
        for (const m of members) if (m.kind === 'ridge') out.ridgeLf += inchesToLf(m.len);
      } catch (e) { /* member lines guarded */ }
    }
    return out;
  };

  /* Build the placement plan + provided NFA for ONE attic volume. */
  const planOneAttic = (model, loop, rd, opts) => {
    const roof = model.roof || {};
    const ridgeVentOn = !!roof.ridgeVent;
    const gableVentsOn = roof.gableVents !== false;   // DEFAULT ON
    const floorSqin = atticFloorSqin(loop);
    const floorSf = floorSqin / 144;
    const geom = ventGeomFor(model, loop, rd);

    // ---- HIGH venting candidates (ridge + gable louvers), for balance ----
    // gable louvers count as HIGH (they sit at/near the ridge on the end wall).
    // Only gables whose fill is 'vent' contribute NFA; 'window'/'none' drop out.
    const ventGables = geom.gables.filter((g) => g.fill === 'vent');
    // ridge vent LF is capped at the actual ridge length available.
    const ridgeAvailLf = geom.ridgeLf;

    // Decide the governing rule. We can use 1/300 only when the plan is
    // BALANCEABLE: it has eave (low) runs AND a high source (ridge or gable).
    const hasLow = geom.eaveLf > 1;
    const hasHigh = (ridgeVentOn && ridgeAvailLf > 0.5) || (gableVentsOn && ventGables.length > 0);
    const canBalance = hasLow && hasHigh;
    const divisor = canBalance ? 300 : 150;
    const reqNfa = floorSqin / divisor;   // sq in

    // ---- size HIGH venting first, aim for ~50% of reqNfa ----
    const highTarget = reqNfa * 0.5;
    let ridgeLfUsed = 0, ridgeNfa = 0;
    let gableUnits = [];
    let highNfa = 0;
    if (ridgeVentOn && ridgeAvailLf > 0.5) {
      // use as much ridge as needed up to what's available
      const wantLf = Math.min(ridgeAvailLf, highTarget / VENT_NFA.ridgeLf);
      ridgeLfUsed = Math.max(0, wantLf);
      ridgeNfa = ridgeLfUsed * VENT_NFA.ridgeLf;
      highNfa += ridgeNfa;
    }
    if (gableVentsOn && ventGables.length) {
      const remain = Math.max(0, highTarget - highNfa);
      // per-gable target so the pair (typical) splits the remaining high need.
      const per = remain / ventGables.length;
      for (const g of ventGables) {
        const pick = pickGable(Math.max(VENT_NFA.gable['12x12'], per));
        gableUnits.push({ wall: g.wall, size: pick.size, nfa: pick.nfa, mid: g.mid, a: g.a, b: g.b });
        highNfa += pick.nfa;
      }
    }

    const gableNfa = gableUnits.reduce((s, g) => s + g.nfa, 0);
    highNfa = ridgeNfa + gableNfa;   // authoritative high total (gable rounding may overshoot the target)

    // ---- size LOW venting (soffit) to cover the balance (or all of req) ----
    // when balanced, low must be >= 50% of req; otherwise low carries it all.
    // Additionally, LOW must be large enough that the HIGH fraction lands at or
    // below 50% (IRC 40-50%): if a big gable louver overshot the high target, we
    // add soffit until high/(high+low) <= 0.5 so the plan reads BALANCED.
    let lowTarget = canBalance ? Math.max(reqNfa - highNfa, reqNfa * 0.5) : reqNfa;
    if (canBalance && highNfa > 0) lowTarget = Math.max(lowTarget, highNfa);   // low >= high -> highFrac <= 50%
    let soffitCount = 0, soffitNfa = 0;
    if (geom.eaveLf > 1 || !canBalance) {
      soffitCount = Math.max(hasLow ? 2 : 0, Math.ceil(lowTarget / VENT_NFA.soffit));
      soffitNfa = soffitCount * VENT_NFA.soffit;
    }

    const providedNfa = soffitNfa + ridgeNfa + gableNfa;
    const highFrac = providedNfa > 0 ? highNfa / providedNfa : 0;
    // BALANCED when 40%..60% of PROVIDED NFA is high (IRC 40-50%, ≤60% common AHJ).
    const balanced = canBalance && highFrac >= 0.40 && highFrac <= 0.60;

    return {
      floorSf: Math.round(floorSf), floorSqin: Math.round(floorSqin),
      rule: '1/' + divisor, divisor,
      reqNfa: Math.round(reqNfa),
      providedNfa: Math.round(providedNfa),
      meets: providedNfa >= reqNfa - 0.5,
      balanced, highFrac: Math.round(highFrac * 100) / 100,
      eaveLf: Math.round(geom.eaveLf * 10) / 10,
      ridgeAvailLf: Math.round(ridgeAvailLf * 10) / 10,
      soffit: { count: soffitCount, sizeIn: '16x8', nfaEach: VENT_NFA.soffit, nfa: Math.round(soffitNfa) },
      ridge: { on: ridgeVentOn && ridgeLfUsed > 0, lf: Math.round(ridgeLfUsed * 10) / 10, nfaPerLf: VENT_NFA.ridgeLf, nfa: Math.round(ridgeNfa) },
      gables: gableUnits.map((g) => ({ wallId: g.wall ? g.wall.id : null, size: g.size, nfa: g.nfa, mid: g.mid, a: g.a, b: g.b })),
      // all gable ends for this volume (incl. window/none) so the plan + schedule can label each
      gableEnds: geom.gables.map((g) => ({ wallId: g.wall ? g.wall.id : null, fill: g.fill, mid: g.mid, a: g.a, b: g.b, lenIn: g.lenIn })),
    };
  };

  /* Public: HA.roofVents(model) → full attic-ventilation plan.
     Returns { ok, attics:[perAtticPlan], totals, symbols, legend,
               gableWindows:[schedule rows], takeoff:[line items] }. */
  HA.roofVents = (model) => {
    const out = { ok: false, attics: [], totals: null, symbols: [], legend: [], gableWindows: [], takeoff: [], notes: [] };
    if (!model || !model.roof || model.roof.enabled === false || !Array.isArray(model.levels)) return out;

    // ---- MAIN roof volume ----
    let mainRd = null;
    try { mainRd = (typeof HA.buildRoof === 'function') ? HA.buildRoof(model) : null; } catch (e) { mainRd = null; }
    const mainLvl = HA.roofLevelIdx(model);
    const mainLoop = HA.exteriorLoop(model, mainLvl);
    if (mainLoop) out.attics.push(Object.assign({ name: 'MAIN', lvlIdx: mainLvl }, planOneAttic(model, mainLoop, mainRd, {})));

    // ---- LOWER roof volumes (wings / one-story sections below the roof level) ----
    // Each level below the roof level with its own exterior loop is a distinct
    // attic volume (high-roof / low-roof capability). Conservative: sized on its
    // own footprint, using wall.gable flags (lower roofs seldom have a merged rd here).
    try {
      for (let li = 0; li < mainLvl; li++) {
        const loop = HA.exteriorLoop(model, li);
        if (!loop || !loop.pts || loop.pts.length < 3) continue;
        if (Math.abs(U.polyArea(loop.pts)) < 400 * 144) continue;   // skip tiny/degenerate
        out.attics.push(Object.assign({ name: 'LOWER L' + (li + 1), lvlIdx: li }, planOneAttic(model, loop, null, {})));
      }
    } catch (e) { /* lower-roof enumeration guarded */ }

    if (!out.attics.length) return out;
    out.ok = true;

    // ---- TOTALS across every attic ----
    const T = { floorSf: 0, reqNfa: 0, providedNfa: 0, soffitCount: 0, ridgeLf: 0, gableCount: 0, meets: true, balancedAll: true };
    for (const a of out.attics) {
      T.floorSf += a.floorSf; T.reqNfa += a.reqNfa; T.providedNfa += a.providedNfa;
      T.soffitCount += a.soffit.count; T.ridgeLf += a.ridge.lf; T.gableCount += a.gables.length;
      if (!a.meets) T.meets = false;
      if (!a.balanced) T.balancedAll = false;
    }
    T.ridgeLf = Math.round(T.ridgeLf * 10) / 10;
    T.rule = out.attics.every((a) => a.divisor === 300) ? '1/300' : (out.attics.some((a) => a.divisor === 150) ? 'mixed' : '1/300');
    out.totals = T;

    // ---- LEGEND (type / size / NFA-each / count) ----
    if (T.soffitCount) out.legend.push({ tag: 'SV', type: 'Soffit / eave vent', size: '16"×8"', nfaEach: VENT_NFA.soffit, unit: 'EA', count: T.soffitCount });
    if (T.ridgeLf > 0) out.legend.push({ tag: 'RV', type: 'Continuous ridge vent', size: 'cont.', nfaEach: VENT_NFA.ridgeLf + '/LF', unit: 'LF', count: T.ridgeLf });
    // gable louvers grouped by size
    const gbySize = {};
    for (const a of out.attics) for (const g of a.gables) gbySize[g.size] = (gbySize[g.size] || 0) + 1;
    for (const size of Object.keys(gbySize)) {
      const dims = size.replace('x', '"×') + '"';
      out.legend.push({ tag: 'GV', type: 'Gable louver', size: dims, nfaEach: VENT_NFA.gable[size], unit: 'EA', count: gbySize[size] });
    }

    // ---- SYMBOLS for the roof plan (abstract drafting marks + letter tags) ----
    //   soffit: a tick along the eave with tag 'SV' (one representative per attic;
    //           the plan drawer tiles ticks along eaves — see plan2d/sheets)
    //   ridge : dashed band on ridge lines, tag 'RV'
    //   gable : louver mark at the gable-end midpoint, tag 'GV' (or 'AW' window)
    for (const a of out.attics) {
      if (a.soffit.count) out.symbols.push({ kind: 'soffit', tag: 'SV', count: a.soffit.count, lvlIdx: a.lvlIdx });
      if (a.ridge.on) out.symbols.push({ kind: 'ridge', tag: 'RV', lf: a.ridge.lf, lvlIdx: a.lvlIdx });
      for (const g of a.gables) out.symbols.push({ kind: 'gable', tag: 'GV', at: g.mid, a: g.a, b: g.b, size: g.size, wallId: g.wallId, lvlIdx: a.lvlIdx });
      for (const g of a.gableEnds) {
        if (g.fill === 'window') out.symbols.push({ kind: 'gablewindow', tag: 'AW', at: g.mid, a: g.a, b: g.b, wallId: g.wallId, lvlIdx: a.lvlIdx });
      }
    }

    // ---- GABLE WINDOW SWAP → window-schedule rows ----
    // Any gable end with gableFill==='window' becomes a fixed attic window
    // (standard 24"×24" fixed louvered-look sash) tagged for the WINDOW SCHEDULE.
    // Grouped so identical attic windows share one row + qty.
    let awCount = 0;
    for (const a of out.attics) for (const g of a.gableEnds) if (g.fill === 'window') awCount++;
    if (awCount) {
      out.gableWindows.push({
        kind: 'gable-window', width: 24, height: 24, sill: null,
        type: 'FIXED / ATTIC', header: '—', count: awCount,
        note: 'ATTIC GABLE — FIXED, NON-VENTED', attic: true,
      });
    }

    // ---- TAKEOFF line items (map to existing CSI Div 07) ----
    if (T.soffitCount) out.takeoff.push({ key: 'vent.soffit', label: 'Soffit / eave vent 16"×8"', qty: T.soffitCount, unit: 'EA', div: '07' });
    if (T.ridgeLf > 0) out.takeoff.push({ key: 'vent.ridge', label: 'Continuous ridge vent', qty: T.ridgeLf, unit: 'LF', div: '07' });
    if (T.gableCount) out.takeoff.push({ key: 'vent.gable', label: 'Gable louver vent', qty: T.gableCount, unit: 'EA', div: '07' });

    // ---- roof-plan compliance note ----
    out.note = 'ATTIC VENTILATION: PROVIDED ' + T.providedNfa.toLocaleString('en-US') +
      ' SI ' + (T.meets ? '≥' : '<') + ' REQ\'D ' + T.reqNfa.toLocaleString('en-US') +
      ' SI (' + T.rule + ')' + (T.balancedAll ? ' — BALANCED HIGH/LOW' : '');
    if (!T.meets) out.notes.push('Attic ventilation SHORT of code minimum — add vents.');
    return out;
  };

  HA._VENT_NFA = VENT_NFA;   // test hook
})();

