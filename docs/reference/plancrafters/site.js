/* ============================================================
   PlanCrafters — site.js
   SITE / ZONING checker. Compares the building FOOTPRINT (the
   ground-floor exterior loop) against the parcel polygon and the
   required yard setbacks, and reports lot coverage, floor area
   ratio (FAR), and any encroachments.

   Plan coordinates are in INCHES (x → east/+x, y → south/+y).
   model.site = {
     lot:[{x,y}...]            parcel polygon (closed loop, in inches)
     setbacks:{front,side,rear}  required yards (inches)
     maxCoverage               max building footprint / lot area (0..1
                               fraction OR a percent >1, both accepted)
     maxFAR                    max gross floor area / lot area (ratio)
     frontEdge                 optional lot-edge index to force as the
                               street/front edge (else inferred from the
                               edge whose outward normal points most NORTH)
   }

   ────────────────────────────────────────────────────────────
   DRAFT / PRELIMINARY — [JURIS]. Pure geometry only. Setback,
   coverage and FAR rules vary by jurisdiction and zoning district;
   the values here are checked against whatever model.site declares.
   CONFIRM the parcel survey, the zoning district standards, and how
   the AHJ measures FAR / coverage / yards before relying on any
   result. Not a substitute for a stamped site plan or a zoning
   determination.
   ────────────────────────────────────────────────────────────

   Code / reference basis (cited in comments below):
   - CA Gov. Code §65852.2 (ADU) — a detached new ADU up to 800 sf,
     16 ft tall, with 4-ft side & rear yard setbacks must be allowed
     even where FAR / lot-coverage / open-space limits would otherwise
     preclude it (AB 68, 2019). So an ADU's 4-ft side/rear is the CA
     statewide floor; coverage/FAR caps cannot block that ADU.
   - Typical single-family (R-1) yards (DRAFT defaults, vary widely):
     front 20-25 ft, side 5 ft, rear 15-20 ft. Coverage 35-50%.
     FAR for low-density SFR ~0.4-0.6 (jurisdiction-specific).
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;
  const U = HA.U;

  /* ---------- DRAFT zoning reference constants ([JURIS]) ----------
     These are planning-grade defaults ONLY surfaced as notes/fallbacks
     — the real check always uses the numbers on model.site. */
  const REF = {
    // CA Gov. Code §65852.2 / AB 68: detached new ADU statewide minimums.
    ADU_SIDE_REAR_FT: 4,      // 4-ft side & rear (no front-setback floor in statute)
    ADU_MAX_SF_DEFAULT: 800,  // a >=800 sf ADU @16ft must be allowed past FAR/coverage
    ADU_MIN_HEIGHT_FT: 16,
    // typical R-1 single-family yards (DRAFT planning numbers, vary by AHJ)
    SFR_FRONT_FT: 20,
    SFR_SIDE_FT: 5,
    SFR_REAR_FT: 15,
    SFR_MAX_COVERAGE: 0.40,   // 40% footprint coverage (common low-density cap)
    SFR_MAX_FAR: 0.50,        // 0.5 FAR (common low-density cap)
  };

  const FT = 12; // inches per foot

  const round1 = (v) => Math.round(v * 10) / 10;
  const round2 = (v) => Math.round(v * 100) / 100;
  const round0 = (v) => Math.round(v);

  /* polygon area in SF from an inch polygon (always positive) */
  const polyAreaSf = (poly) => Math.abs(U.polyArea(poly)) / 144;

  /* Normalize maxCoverage: accept a 0..1 fraction OR a percent (e.g. 40).
     Returns a 0..1 fraction, or null when unset/invalid. */
  const asFraction = (v) => {
    if (v == null || !Number.isFinite(v) || v <= 0) return null;
    return v > 1 ? v / 100 : v;
  };

  /* ---------- the building footprint ----------
     Lot coverage is measured off the GROUND-floor footprint (the level-0
     exterior loop). Returns {pts, lvlIdx} or null when no closed loop. */
  const footprintLoop = (model) => {
    if (!model || !model.levels || !model.levels.length) return null;
    // prefer level 0 (ground floor = the footprint that touches the lot);
    // fall back to the first level that has a closed exterior loop.
    for (let i = 0; i < model.levels.length; i++) {
      const lp = HA.exteriorLoop(model, i);
      if (lp && lp.pts && lp.pts.length >= 3) return { pts: lp.pts, lvlIdx: i };
    }
    return null;
  };

  /* Gross floor area (SF) for FAR — sum of every level's exterior-loop area.
     FAR counts conditioned/gross above-grade floor area; how a given AHJ
     counts garages, basements, etc. varies [JURIS], so this is the simple
     "sum of enclosed floor plates" interpretation. */
  const grossFloorAreaSf = (model) => {
    let sf = 0;
    for (let i = 0; i < model.levels.length; i++) {
      const lp = HA.exteriorLoop(model, i);
      if (lp && lp.pts && lp.pts.length >= 3) sf += polyAreaSf(lp.pts);
    }
    return sf;
  };

  /* ---------- classify each lot edge as front / side / rear ----------
     We use the edge OUTWARD normal direction. Plan convention: +y = south,
     so -y points NORTH (toward the conventional top-of-sheet street). The
     edge whose outward normal points most north is taken as the FRONT yard;
     the opposite (most +y / south) is the REAR; everything else is a SIDE.
     A caller can override with model.site.frontEdge (an edge index).
     Returns an array `kinds[i] in {'front','side','rear'}` parallel to edges. */
  const classifyEdges = (lot, frontEdgeIdx) => {
    const n = lot.length;
    const kinds = new Array(n).fill('side');
    // outward normal per edge (U.edgeOutNormal handles CW/CCW winding)
    const outN = [];
    for (let i = 0; i < n; i++) outN.push(U.edgeOutNormal(lot, i));

    // pick FRONT: explicit override, else the most-north-facing edge
    let fi = (Number.isInteger(frontEdgeIdx) && frontEdgeIdx >= 0 && frontEdgeIdx < n)
      ? frontEdgeIdx : 0;
    if (!(Number.isInteger(frontEdgeIdx) && frontEdgeIdx >= 0 && frontEdgeIdx < n)) {
      let best = -Infinity;
      for (let i = 0; i < n; i++) {
        const northness = -outN[i].y; // +1 = faces due north
        if (northness > best) { best = northness; fi = i; }
      }
    }
    kinds[fi] = 'front';

    // REAR: the edge whose outward normal most OPPOSES the front normal
    const fN = outN[fi];
    let ri = fi, worst = Infinity;
    for (let i = 0; i < n; i++) {
      if (i === fi) continue;
      const d = U.dot(outN[i], fN); // -1 = opposite-facing
      if (d < worst) { worst = d; ri = i; }
    }
    if (ri !== fi) kinds[ri] = 'rear';
    // all remaining edges stay 'side'
    return kinds;
  };

  /* LEFT vs RIGHT for a SIDE edge — relative to facing the street (the front
     outward normal fN). Standing on the lot looking toward the front/street,
     the WEST edge is on your LEFT and EAST on your RIGHT; the sign of
     cross(fN, edgeOutNormal) is constant per side and flips between them. */
  const sideLR = (lot, i, fN) => (U.cross(fN, U.edgeOutNormal(lot, i)) < 0 ? 'left' : 'right');

  /* The yard KIND for a single lot edge as one of front/left/right/rear — the
     4-independent-sides classification (left & right are separate yards). */
  const edgeYardKind = (lot, i, frontEdgeIdx) => {
    const kinds = classifyEdges(lot, frontEdgeIdx);
    const k = kinds[i];
    if (k === 'front' || k === 'rear') return k;
    const fi = kinds.indexOf('front');
    const fN = fi >= 0 ? U.edgeOutNormal(lot, fi) : { x: 0, y: -1 };
    return sideLR(lot, i, fN);
  };

  /* Per-edge inward setback distance. Four INDEPENDENT yards:
     front / left / right / rear. `side` is the legacy shared-side value — left &
     right fall back to it when not set, so old models keep working. The returned
     `kinds` stay the 3-kind front/side/rear (labels/DXF unchanged); only the
     DISTANCES resolve left vs right per edge. */
  const edgeSetbacks = (lot, setbacks, frontEdgeIdx) => {
    const kinds = classifyEdges(lot, frontEdgeIdx);
    const sb = setbacks || {};
    const num = (x, d) => (Number.isFinite(x) ? x : d);
    const f = num(sb.front, 0), r = num(sb.rear, 0), s = num(sb.side, 0);
    const left = num(sb.left, s), right = num(sb.right, s);
    const fi = kinds.indexOf('front');
    const fN = fi >= 0 ? U.edgeOutNormal(lot, fi) : { x: 0, y: -1 };
    const dists = kinds.map((k, i) =>
      k === 'front' ? f : k === 'rear' ? r : (sideLR(lot, i, fN) === 'left' ? left : right));
    return { kinds, dists };
  };

  /* ---------- the buildable envelope (setback) polygon ----------
     Offset every lot edge INWARD by its yard distance (miter joins via
     U.offsetPoly with negative distances). Returns {poly, kinds, dists}.
     poly is the polygon a structure must stay inside of. */
  const SITE = {};

  SITE.setbackLines = (model) => {
    const site = (model && model.site) || {};
    const lot = Array.isArray(site.lot) ? cleanLoop(site.lot) : null;
    if (!lot || lot.length < 3) {
      return { poly: [], kinds: [], dists: [], note: 'No site.lot polygon to offset.' };
    }
    const { kinds, dists } = edgeSetbacks(lot, site.setbacks, site.frontEdge);
    // Build the buildable envelope by offsetting every lot edge INWARD by its
    // yard. For a CONVEX lot, intersecting each edge's inward half-plane is exact
    // and naturally returns EMPTY when the yards exceed the lot (tiny / non-
    // conforming lots — the ADU case). But half-plane intersection is convex-ONLY:
    // on a CONCAVE parcel (L-shaped corner lot, flag/pole, notched lot) the reflex
    // edges' half-planes slice away the real arms, collapsing the envelope to a
    // corner box and reporting a FALSE setback encroachment on a compliant build.
    // So: convex lots keep the exact clip; concave lots use a true inward MITER
    // offset (U.offsetPoly, negative per-edge yards) that PRESERVES reflex corners,
    // validated (winding kept, shrank, simple, inside the lot) with a clip fallback
    // for the over-shrink/tiny case so "no buildable area" still reads empty.
    let poly;
    if (isConvexLoop(lot)) {
      poly = clipEnvelope(lot, dists);
    } else {
      const off = U.offsetPoly(lot, dists.map((d) => -(d || 0)));
      poly = validInwardOffset(off, lot) ? cleanLoop(off) : clipEnvelope(lot, dists);
    }
    return {
      poly,
      kinds,
      dists,
      note: 'DRAFT setback envelope [JURIS] — offset of the parcel by the ' +
        'declared front/side/rear yards. Field-verify the survey + how the ' +
        'AHJ measures yards (to wall face vs. eave vs. property line).',
    };
  };

  /* drop duplicate / nearly-coincident consecutive vertices + closing dup */
  const cleanLoop = (poly) => {
    const out = [];
    for (const p of poly) {
      const last = out[out.length - 1];
      if (!last || U.dist(last, p) > 1e-4) out.push({ x: p.x, y: p.y });
    }
    if (out.length > 1 && U.dist(out[0], out[out.length - 1]) < 1e-4) out.pop();
    return out;
  };

  /* the convex half-plane-intersection envelope (Sutherland–Hodgman). Exact for
     convex lots; returns empty when yards exceed the lot. Used directly for
     convex lots and as the over-shrink fallback for concave ones. */
  const clipEnvelope = (lot, dists) => {
    let poly = lot.slice();
    for (let i = 0; i < lot.length && poly.length; i++) {
      const outN = U.edgeOutNormal(lot, i);
      const d = dists[i] || 0;
      const p0 = { x: lot[i].x - outN.x * d, y: lot[i].y - outN.y * d }; // edge pulled inward by d
      const A = -outN.x, B = -outN.y, C = -(A * p0.x + B * p0.y);        // keep the interior side
      poly = U.clipHalfPlane(poly, A, B, C);
    }
    return cleanLoop(poly);
  };

  /* a simple loop is convex iff every consecutive edge turn keeps the same sign. */
  const isConvexLoop = (poly) => {
    const n = poly.length;
    if (n < 4) return true;
    let sign = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
      const cr = U.cross(U.sub(b, a), U.sub(c, b));
      if (Math.abs(cr) < 1e-9) continue; // collinear vertex
      const s = cr > 0 ? 1 : -1;
      if (!sign) sign = s; else if (s !== sign) return false;
    }
    return true;
  };

  /* do two non-adjacent segments PROPERLY cross (interiors only)? */
  const segCross = (a1, a2, b1, b2) => {
    const h = U.lineLine(a1, U.sub(a2, a1), b1, U.sub(b2, b1));
    return !!h && h.t > 1e-6 && h.t < 1 - 1e-6 && h.u > 1e-6 && h.u < 1 - 1e-6;
  };

  /* is an inward miter offset a VALID buildable envelope — not over-shrunk,
     inverted, or self-crossing? If false, the caller falls back to the clip so a
     tiny lot still reads "no buildable area" instead of a phantom box. */
  const validInwardOffset = (off, lot) => {
    if (!off || off.length < 3) return false;
    const aOff = U.polyArea(off), aLot = U.polyArea(lot);
    if (aOff === 0 || aLot === 0) return false;
    if ((aOff > 0) !== (aLot > 0)) return false;                    // winding flipped → inverted
    if (Math.abs(aOff) > Math.abs(aLot) * (1 + 1e-6)) return false; // grew → wrong
    if (Math.abs(aOff) < 1) return false;                          // degenerate
    for (const v of off) {                                          // each vertex inside (or on) the lot
      if (U.pointInPoly(v, lot)) continue;
      let near = Infinity;
      for (let i = 0; i < lot.length; i++) {
        const d = U.distToSeg(v, lot[i], lot[(i + 1) % lot.length]);
        if (d < near) near = d;
      }
      if (near > 1) return false;                                  // vertex escaped the lot
    }
    const n = off.length;                                          // simple (no self-intersection)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if ((i + 1) % n === j || (j + 1) % n === i) continue;      // skip adjacent edges
        if (segCross(off[i], off[(i + 1) % n], off[j], off[(j + 1) % n])) return false;
      }
    }
    return true;
  };

  /* signed distance of a point to the buildable envelope: >0 inside, <0 outside,
     magnitude = distance to the nearest envelope EDGE. CONCAVE-SAFE (ray-cast
     membership + nearest-segment distance) so an L/flag lot's arm classifies
     correctly — the old min-over-edges form was convex-only and false-failed
     a compliant build sitting in a reflex arm. */
  const distInsideEnvelope = (p, env) => {
    if (!env || env.length < 3) return -Infinity;
    let near = Infinity;
    for (let i = 0; i < env.length; i++) {
      const d = U.distToSeg(p, env[i], env[(i + 1) % env.length]);
      if (d < near) near = d;
    }
    return U.pointInPoly(p, env) ? near : -near;
  };

  /* ---------- main analysis ----------
     analyze(model) -> {
       hasSite, lotAreaSf, footprintSf, coveragePct, far, grossFloorSf,
       setbackOk, violations:[{code,kind,msg,...}], setback:{poly,...},
       maxCoveragePct, maxFAR, draft, note
     } */
  SITE.analyze = (model) => {
    const site = (model && model.site) || {};
    const lot = Array.isArray(site.lot) ? cleanLoop(site.lot) : null;

    const base = {
      hasSite: false,
      lotAreaSf: 0,
      footprintSf: 0,
      grossFloorSf: 0,
      coveragePct: 0,
      far: 0,
      setbackOk: true,
      violations: [],
      setback: { poly: [], kinds: [], dists: [] },
      maxCoveragePct: null,
      maxFAR: null,
      draft: true,
      note: 'DRAFT / PRELIMINARY zoning check [JURIS] — confirm local zoning ' +
        'district standards + parcel survey. Not a zoning determination.',
    };

    if (!lot || lot.length < 3) {
      base.note = 'No site.lot polygon — add a parcel boundary to run the ' +
        'zoning check. ' + base.note;
      return base;
    }
    base.hasSite = true;

    const lotAreaSf = polyAreaSf(lot);
    base.lotAreaSf = round1(lotAreaSf);

    const fp = footprintLoop(model);
    const footprintSf = fp ? polyAreaSf(fp.pts) : 0;
    base.footprintSf = round1(footprintSf);

    const grossSf = grossFloorAreaSf(model);
    base.grossFloorSf = round1(grossSf);

    const coverage = lotAreaSf > 0 ? footprintSf / lotAreaSf : 0;
    base.coveragePct = round1(coverage * 100);
    const far = lotAreaSf > 0 ? grossSf / lotAreaSf : 0;
    base.far = round2(far);
    // ADDITIVE coverage figures (the footprint-only coveragePct/far above stay
    // authoritative + untouched): a covered porch commonly counts toward lot
    // coverage, so expose a separate "with porch" percentage + the porch SF.
    base.coveredPorchSf = round1(SITE.coveredPorchSf ? SITE.coveredPorchSf(model) : 0);
    base.coverageWithPorchPct = lotAreaSf > 0 ? round1(((footprintSf + base.coveredPorchSf) / lotAreaSf) * 100) : 0;

    const sbInfo = SITE.setbackLines(model);
    base.setback = { poly: sbInfo.poly, kinds: sbInfo.kinds, dists: sbInfo.dists };

    const violations = [];

    /* ---- (1) setback / encroachment: every footprint vertex AND every
       footprint-edge midpoint must lie inside the buildable envelope.
       Testing midpoints too catches a wall that crosses a yard line between
       two compliant corners. We report the worst encroachment depth. */
    const env = sbInfo.poly;
    if (fp && env && env.length >= 3) {
      const samples = [];
      for (let i = 0; i < fp.pts.length; i++) {
        const a = fp.pts[i], b = fp.pts[(i + 1) % fp.pts.length];
        samples.push(a);
        samples.push(U.lerp(a, b, 0.5)); // edge midpoint
      }
      let worst = 0, outsideCount = 0, worstPt = null;
      // Gate membership on the SIGNED DISTANCE, not U.pointInPoly: the half-open
      // ray-cast classifies points lying exactly ON the south/east envelope edges
      // as outside, which false-FAILS a code-maximal build snapped exactly to the
      // setback line. A point within TOL of the boundary counts as inside (no
      // phantom encroachment); a true encroachment past TOL is still flagged.
      const TOL = 1e-4;
      for (const p of samples) {
        const sd = distInsideEnvelope(p, env); // >0 inside, <0 outside
        const inside = sd >= -TOL;
        const encroach = Math.max(0, -sd);
        if (!inside) {
          outsideCount++;
          if (encroach > worst) { worst = encroach; worstPt = p; }
        }
      }
      if (outsideCount > 0) {
        violations.push({
          code: 'SETBACK',
          kind: 'encroachment',
          msg: 'Building footprint encroaches into a required yard at ' +
            outsideCount + ' point(s); worst ~' + round1(worst / FT) +
            ' ft past the setback line.',
          worstEncroachIn: round1(worst),
          worstEncroachFt: round1(worst / FT),
          atPoint: worstPt,
          note: 'DRAFT [JURIS] — yard measured to the wall CENTERLINE here; ' +
            'AHJ may measure to wall face / eave. Field-verify.',
        });
      }
    } else if (fp && (!env || env.length < 3)) {
      // setbacks consumed the whole lot (huge yards / tiny lot) — flag it
      violations.push({
        code: 'SETBACK',
        kind: 'no-buildable-area',
        msg: 'Setbacks leave no buildable envelope on this parcel — yards ' +
          'exceed the lot dimensions.',
        note: 'DRAFT [JURIS] — verify yard requirements vs. parcel size.',
      });
    }

    /* ---- (2) lot coverage cap ---- */
    const maxCov = asFraction(site.maxCoverage);
    if (maxCov != null) {
      base.maxCoveragePct = round1(maxCov * 100);
      if (coverage > maxCov + 1e-6) {
        violations.push({
          code: 'COVERAGE',
          kind: 'over-coverage',
          msg: 'Lot coverage ' + round1(coverage * 100) + '% exceeds the ' +
            round1(maxCov * 100) + '% maximum.',
          coveragePct: round1(coverage * 100),
          maxCoveragePct: round1(maxCov * 100),
          overSf: round1(Math.max(0, footprintSf - maxCov * lotAreaSf)),
          note: 'DRAFT [JURIS]. NOTE: CA Gov. Code §65852.2 (AB 68) — a ' +
            'detached new ADU up to ' + REF.ADU_MAX_SF_DEFAULT + ' sf @' +
            REF.ADU_MIN_HEIGHT_FT + 'ft w/ ' + REF.ADU_SIDE_REAR_FT +
            'ft side+rear must be allowed even past coverage caps.',
        });
      }
    }

    /* ---- (3) floor area ratio (FAR) cap ---- */
    const maxFAR = Number.isFinite(site.maxFAR) && site.maxFAR > 0 ? site.maxFAR : null;
    if (maxFAR != null) {
      base.maxFAR = round2(maxFAR);
      if (far > maxFAR + 1e-6) {
        violations.push({
          code: 'FAR',
          kind: 'over-far',
          msg: 'Floor area ratio ' + round2(far) + ' exceeds the maximum ' +
            round2(maxFAR) + '.',
          far: round2(far),
          maxFAR: round2(maxFAR),
          overSf: round1(Math.max(0, grossSf - maxFAR * lotAreaSf)),
          note: 'DRAFT [JURIS] — how the AHJ counts garages/basements toward ' +
            'FAR varies. CA §65852.2 also exempts a qualifying ADU from FAR caps.',
        });
      }
    }

    base.violations = violations;
    // setbackOk is specifically the yard test (the others are coverage/FAR)
    base.setbackOk = !violations.some((v) => v.code === 'SETBACK');
    base.compliant = violations.length === 0;
    return base;
  };

  /* ---------- convenience: a quick textual summary for chat / sheets ----------
     Pure — returns a string; callers decide how to render it. */
  SITE.summary = (model) => {
    const a = SITE.analyze(model);
    if (!a.hasSite) return 'No parcel boundary set — add model.site.lot to run a zoning check.';
    const lines = [];
    lines.push('Lot ' + a.lotAreaSf + ' sf | Footprint ' + a.footprintSf +
      ' sf | Coverage ' + a.coveragePct + '%' +
      (a.maxCoveragePct != null ? ' (max ' + a.maxCoveragePct + '%)' : ''));
    lines.push('FAR ' + a.far + (a.maxFAR != null ? ' (max ' + a.maxFAR + ')' : '') +
      ' | Setbacks ' + (a.setbackOk ? 'OK' : 'ENCROACH'));
    if (a.violations.length) {
      lines.push(a.violations.length + ' issue(s):');
      for (const v of a.violations) lines.push('  • ' + v.msg);
    } else {
      lines.push('No zoning issues found (DRAFT — confirm local code).');
    }
    lines.push('DRAFT / PRELIMINARY [JURIS] — confirm local zoning + survey.');
    return lines.join('\n');
  };

  /* ---------- CA ADU setback notes (surprise-feature helper) ----------
     Returns the statewide ADU yard floor + the caveats, so the UI can show
     "an ADU here only needs 4-ft side/rear" guidance. Pure data. */
  SITE.aduSetbackNotes = () => ({
    code: 'CA Gov. Code §65852.2 (AB 68, 2019)',
    sideFt: REF.ADU_SIDE_REAR_FT,
    rearFt: REF.ADU_SIDE_REAR_FT,
    frontFt: null, // statute sets no front-yard floor for ADUs
    maxSf: REF.ADU_MAX_SF_DEFAULT,
    minHeightFt: REF.ADU_MIN_HEIGHT_FT,
    notes: [
      'Detached NEW ADU: 4-ft side & rear yards are the statewide maximum a ' +
        'city can require (no front-setback floor in statute).',
      'Conversion of an existing permitted structure to an ADU needs NO added ' +
        'setback (existing walls may stay).',
      'A qualifying ADU (>=' + REF.ADU_MAX_SF_DEFAULT + ' sf, ' +
        REF.ADU_MIN_HEIGHT_FT + 'ft) must be allowed even where lot-coverage, ' +
        'FAR, open-space or min-lot-size limits would otherwise preclude it.',
      'DRAFT [JURIS] — many cities adopt LESS restrictive local ADU standards; ' +
        'confirm the local ADU ordinance.',
    ],
  });

  /* ---------- permit-grade SITE DATA rows (pure, testable) ----------
     The labeled rows A1.0 prints: area / coverage / FAR / impervious /
     required yards + compliance / APN-zoning-jurisdiction / (E) tree count,
     plus boilerplate SITE PLAN NOTES. Impervious = footprint + the area of
     every walkway/hardscape site feature (HA.sitefeatures.featureArea).
     Returns { rows:[{k,v}|{h}|{sep}], notes:[..], impervSf, treeCount }. */
  /* ---------- decks + porches (outdoor area schedule) ----------
     Every deck in the model (across all levels) with its area + a
     covered/uncovered description, for the A1.0 site-plan labels AND the
     SITE DATA tabulation (so the two always agree). A deck's `covered` flag
     means a roof above (the code calls a covered deck a porch); an optional
     `use:'porch'|'deck'` overrides the noun. Rectangles are axis-aligned
     (makeDeck sorts the corners), so area = w x h / 144 sq ft. */
  SITE.deckAreas = (model) => {
    const out = [];
    for (const lvl of (model && model.levels) || []) {
      for (const d of (lvl.decks || [])) {
        const w = Math.abs((d.x2 || 0) - (d.x1 || 0)), h = Math.abs((d.y2 || 0) - (d.y1 || 0));
        if (w < 1 || h < 1) continue;
        const covered = !!d.covered;
        const noun = (d.use === 'porch' || d.use === 'deck') ? d.use.toUpperCase() : (covered ? 'PORCH' : 'DECK');
        out.push({
          id: d.id,
          poly: [{ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y1 }, { x: d.x2, y: d.y2 }, { x: d.x1, y: d.y2 }],
          cx: (d.x1 + d.x2) / 2, cy: (d.y1 + d.y2) / 2,
          areaSqFt: (w * h) / 144, covered, railing: !!d.railing, noun,
          label: (covered ? 'COVERED ' : 'UNCOVERED ') + noun,
        });
      }
    }
    return out;
  };

  /* totals by label, e.g. {'COVERED PORCH': 96, 'UNCOVERED DECK': 200} (sq ft) */
  SITE.deckTotals = (model) => {
    const t = {};
    for (const d of SITE.deckAreas(model)) t[d.label] = (t[d.label] || 0) + d.areaSqFt;
    for (const k in t) t[k] = Math.round(t[k]);
    return t;
  };

  /* paint each deck/porch on the site plan: a wood-toned fill, decking board
     lines, a covered-roof cross-hatch for covered ones, and a centered
     NAME + sq-ft label. T(world{x,y}) -> canvas px (the siteplan T()). */
  SITE.drawDecks = (ctx, model, T, opts) => {
    opts = opts || {};
    const ppi = opts.ppi || 72;
    const decks = SITE.deckAreas(model);
    const halo = (text, x, y, px, color) => {
      ctx.font = `700 ${Math.max(6, px)}px "IBM Plex Sans",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, px * 0.34); ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
    };
    for (const d of decks) {
      const poly = d.poly.map(T);
      if (poly.length < 4) continue;
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = d.covered ? 'rgba(150,120,80,0.20)' : 'rgba(176,150,112,0.16)';
      ctx.fill();
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const p of poly) { if (p.x < mnx) mnx = p.x; if (p.y < mny) mny = p.y; if (p.x > mxx) mxx = p.x; if (p.y > mxy) mxy = p.y; }
      // decking board lines (parallel), clipped to the deck
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(122,90,54,0.30)'; ctx.lineWidth = Math.max(0.5, ppi * 0.006);
      const step = Math.max(4, ppi * 0.09);
      ctx.beginPath();
      for (let y = mny; y <= mxy; y += step) { ctx.moveTo(mnx, y); ctx.lineTo(mxx, y); }
      ctx.stroke();
      // covered porch -> a light "roof above" diagonal cross
      if (d.covered) {
        ctx.strokeStyle = 'rgba(80,80,80,0.22)'; ctx.lineWidth = Math.max(0.6, ppi * 0.007);
        ctx.setLineDash([ppi * 0.05, ppi * 0.05]);
        ctx.beginPath(); ctx.moveTo(mnx, mny); ctx.lineTo(mxx, mxy); ctx.moveTo(mxx, mny); ctx.lineTo(mnx, mxy);
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
      // outline: covered solid, uncovered dashed
      ctx.strokeStyle = '#7a5a36'; ctx.lineWidth = Math.max(1, ppi * 0.013);
      if (!d.covered) ctx.setLineDash([ppi * 0.08, ppi * 0.06]);
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      // label: NAME + area (sq ft), centered
      const c = T({ x: d.cx, y: d.cy });
      const px = Math.max(6.5, ppi * 0.12);
      halo(d.label, c.x, c.y - px * 0.6, px, '#5a3d22');
      halo(U.fmtArea(Math.round(d.areaSqFt)), c.x, c.y + px * 0.65, px * 0.95, '#5a3d22');
      ctx.restore();
    }
    return decks.length;
  };

  /* total GROUND-FLOOR COVERED (roofed) porch area, sq ft — the part that
     commonly counts toward lot coverage + impervious. ONLY level 0: an upper
     covered balcony touches neither the ground nor the lot, so it adds zero
     lot coverage / impervious (uncovered decks add nothing either). */
  SITE.coveredPorchSf = (model) => {
    const L0 = (model && model.levels && model.levels[0]) || null;
    if (!L0) return 0;
    let sf = 0;
    for (const d of (L0.decks || [])) {
      if (!d.covered) continue;
      const w = Math.abs((d.x2 || 0) - (d.x1 || 0)), h = Math.abs((d.y2 || 0) - (d.y1 || 0));
      if (w < 1 || h < 1) continue;
      sf += (w * h) / 144;
    }
    return Math.round(sf);
  };

  /* AREA TABULATION — conditioned DWELLING + GARAGE + covered/uncovered outdoor
     areas, the way a permit cover sheet breaks it down. DWELLING = gross floor
     minus the garage (porches/decks are already outside the wall loop). GARAGE
     SF is derived from room_label rooms named GARAGE/CARPORT via HA.rooms (the
     only way a garage is represented); guarded so headless/garageless cases
     return 0 instead of throwing. Returns the numbers + ready {k,v} rows. */
  SITE.areaTabulation = (model) => {
    const grossFloorSf = round1(grossFloorAreaSf(model));
    // GARAGE from ground-floor (level 0) GARAGE/CARPORT rooms only — the usual
    // case, and counting every level would double-count a garage region that
    // resolves on more than one storey (tuck-under / room-object array fallback).
    let garageSf = 0;
    if (HA.rooms && HA.rooms.resolveRooms) {
      let rr = [];
      try { rr = HA.rooms.resolveRooms(model, 0) || []; } catch (e) { rr = []; }
      for (const r of rr) if (/\bGARAGE\b|\bCARPORT\b/.test(String(r.name || '').toUpperCase())) garageSf += r.areaSf || 0;
    }
    garageSf = round1(garageSf);
    const dwellingSf = round1(Math.max(0, grossFloorSf - garageSf));
    const deckT = SITE.deckTotals(model);
    const porchCoveredSf = SITE.coveredPorchSf(model);
    let deckUncoveredSf = 0;
    for (const d of SITE.deckAreas(model)) if (!d.covered) deckUncoveredSf += d.areaSqFt;
    deckUncoveredSf = Math.round(deckUncoveredSf);
    const rows = [];
    if (grossFloorSf > 0) rows.push({ k: 'DWELLING (COND.)', v: U.fmtArea(dwellingSf) });
    if (garageSf > 0) rows.push({ k: 'GARAGE', v: U.fmtArea(garageSf) });
    for (const lbl of Object.keys(deckT)) rows.push({ k: lbl, v: U.fmtArea(deckT[lbl]) });
    return { grossFloorSf, garageSf, dwellingSf, porchCoveredSf, deckUncoveredSf, rows };
  };

  SITE.siteDataRows = (model) => {
    const A = SITE.analyze(model);
    const site = (model && model.site) || {};
    const nf = (n) => Math.round(n || 0).toLocaleString();
    const rows = [];
    const kv = (k, v) => rows.push({ k, v: String(v) });
    const head = (h) => rows.push({ h });
    const sep = () => rows.push({ sep: true });

    kv('LOT AREA', U.fmtLandArea(A.lotAreaSf));
    kv('FOOTPRINT', U.fmtArea(A.footprintSf));
    if (A.grossFloorSf) kv('GROSS FLOOR', U.fmtArea(A.grossFloorSf));
    // AREA TABULATION: conditioned DWELLING + GARAGE + the covered/uncovered porch
    // & deck areas — the SAME labels + totals the A1.0 deck graphics show, so the
    // plan and the tabulation always agree.
    for (const r of SITE.areaTabulation(model).rows) kv(r.k, r.v);
    kv('COVERAGE', A.coveragePct + '%' + (A.maxCoveragePct ? ' / ' + A.maxCoveragePct + '% max' : ''));
    // a covered (roofed) porch commonly counts toward lot coverage — an INFORMATIONAL
    // "with porch" figure (no "/max": the regulated COVERAGE above is footprint-only
    // per the AHJ, so this row never implies a violation).
    if (A.coveredPorchSf > 0) kv('COVERAGE (W/ PORCH)', A.coverageWithPorchPct + '% (info)');
    kv('FAR', A.far + (A.maxFAR ? ' / ' + A.maxFAR + ' max' : ''));

    // impervious (footprint + COVERED porches + paved features + (E) structures) + landscape %
    let imperv = (A.footprintSf || 0) + (A.coveredPorchSf || 0);
    const feats = site.features || [];
    const SF = HA.sitefeatures;
    if (SF && SF.featureArea)
      for (const f of feats) {
        if (f.type === 'walkway' || f.type === 'hardscape') imperv += SF.featureArea(f);
        else if (f.type === 'structure') imperv += (SF.structureSf ? SF.structureSf(f) : SF.featureArea(f));
      }
    imperv = Math.round(imperv);
    kv('IMPERVIOUS', U.fmtArea(imperv));
    if (A.lotAreaSf > 0) kv('LANDSCAPE', Math.max(0, Math.round((1 - imperv / A.lotAreaSf) * 100)) + '%');

    // (E) EXISTING STRUCTURES — user-placed boxes, each with its own sq ft (the
    // "other side of the tabulations"). Lists every box + a total.
    const structs = feats.filter((f) => f.type === 'structure');
    if (structs.length) {
      sep();
      head('(E) EXISTING STRUCTURES');
      let esum = 0;
      for (const f of structs) {
        const sf = SF && SF.structureSf ? SF.structureSf(f) : Math.round((SF && SF.featureArea ? SF.featureArea(f) : 0));
        esum += sf;
        kv('  ' + (SF && SF.labelFor ? SF.labelFor(f) : (f.label || 'STRUCTURE')), U.fmtArea(sf));
      }
      kv('  TOTAL (E)', U.fmtArea(Math.round(esum)));
    }

    sep();
    head('REQUIRED YARDS (DRAFT)');
    const sb = site.setbacks || { front: 0, side: 0, rear: 0 };
    kv('  FRONT', U.fmtLen(sb.front || 0));   // feet-inches (drag can set non-12" values)
    kv('  SIDE', U.fmtLen(sb.side || 0));
    kv('  REAR', U.fmtLen(sb.rear || 0));
    kv('  STATUS', A.setbackOk ? 'COMPLIES' : 'ENCROACHMENT — SEE PLAN');

    const apn = (model.parcel && model.parcel.apn) || site.apn;
    const juris = model.project && model.project.jurisdiction;
    const treeCount = feats.filter((f) => f.type === 'tree').length;
    if (apn || site.zone || juris || treeCount) {
      sep();
      if (apn) kv('APN', apn);
      if (site.zone) kv('ZONING', site.zone);
      if (juris) kv('JURISDICTION', juris);
      if (treeCount) kv('(E) TREES', String(treeCount));
    }

    const notes = [
      'EXISTING GRADE — FIELD VERIFY. POSITIVE DRAINAGE AWAY FROM STRUCTURE, 2% MIN.',
      'ALL (E) SITE FEATURES TO REMAIN UNLESS NOTED OTHERWISE.',
      'UTILITY LOCATIONS INDICATIVE — VERIFY W/ UTILITY + CALL 811 BEFORE DIGGING.',
      'PROPERTY LINES + STRUCTURE LOCATION PER SURVEY. DRAFT — NOT A SURVEY.',
    ];
    return { rows, notes, impervSf: imperv, treeCount, analyze: A };
  };

  /* ---------- model.site bootstrap ----------
     newModel() ships NO site object — model.site is created lazily when a
     parcel resolves (ui.applyParcel). ensureSite makes that object exist
     idempotently (preserving any lot/setbacks/northRot already there) and
     guarantees the site.features[] array the site-plan layer + symbols use.
     Safe to call from a load-migration path and from every site consumer. */
  SITE.DEFAULT_SETBACKS = { front: 240, side: 60, rear: 180 }; // 20'/5'/15' (in)
  const ensureSite = (model) => {
    if (!model) return null;
    const s = model.site || (model.site = {});
    if (!s.setbacks) s.setbacks = Object.assign({}, SITE.DEFAULT_SETBACKS);
    // 4 INDEPENDENT yards (front/left/right/rear) — backfill left & right from the
    // legacy shared 'side' so older saved plans keep their setbacks.
    const sb = s.setbacks;
    if (!Number.isFinite(sb.left)) sb.left = Number.isFinite(sb.side) ? sb.side : 60;
    if (!Number.isFinite(sb.right)) sb.right = Number.isFinite(sb.side) ? sb.side : 60;
    if (!Array.isArray(s.features)) s.features = [];
    // lot stays null until a parcel resolves; frontEdge optional (inferred)
    return s;
  };
  SITE.ensureSite = ensureSite;
  HA.ensureSite = ensureSite;

  /* The lot-edge index whose OUTWARD normal best matches a unit direction
     {x,y} (north = {0,-1}, west = {-1,0}, …). Drives the UI "street side"
     picker: the user says which way the street faces and we set
     model.site.frontEdge to that edge, so the street name / drainage /
     utilities / setbacks all reorient to that side. */
  SITE.frontEdgeForDir = (lot, dir) => {
    if (!Array.isArray(lot) || lot.length < 3 || !dir) return null;
    let best = -Infinity, idx = 0;
    for (let i = 0; i < lot.length; i++) {
      const o = U.edgeOutNormal(lot, i);
      const d = o.x * dir.x + o.y * dir.y;
      if (d > best) { best = d; idx = i; }
    }
    return idx;
  };

  /* ============================================================
     AUTO STREET-SIDE + TRUE-NORTH from the GIS map (Steve, Jul 5:
     "detect the correct street side too? and align the north south
      from the gis map… then the driveway always would go correctly").
     Both PURE (no DOM, no network): detectNorthRot reads site.geoXform;
     detectFrontEdge reads OSM road centerlines already on the model (or
     any {centerline:[{x,y}]} list passed in) — the U1b streets. The
     async fetch/wiring lives in ui.js; these stay unit-testable offline.
     ============================================================ */

  /* ---- TRUE NORTH from geoXform -------------------------------------
     site.geoXform maps PLAN → GEO (parcel.planToGeo): a plan point (x,y)
     inches becomes {lat = xf.lat − p0y/(k), lng = xf.lng + p0x/(k')} after
     un-rotating (x,y) about the pivot by −xf.rot. So plan +Y drives lat DOWN
     — i.e. plan +Y is (roughly) SOUTH and plan −Y (screen up) is NORTH when
     xf.rot === 0. The north arrow (pvdraw.northArrow / sheets northarrow)
     draws the pointer UP (plan −Y) and then does `ctx.rotate(northRot)`
     (canvas rotate = CLOCKWISE on screen) to swing it to TRUE north on the
     squared site plan. squareLotToAxes proves the convention: northRot ===
     the angle the LOT was rotated to square it, "the same angle the north
     arrow must turn by to keep showing true north."

     CONVENTION (must match pvdraw.js northArrow + sheets.js northarrow EXACTLY):
       Let planNorth = the unit PLAN direction that points to geographic north.
       The arrow starts along plan up = (0,−1) and is rotated by `northRot`
       using a canvas (clockwise-positive, y-down) rotation. Rotating (0,−1)
       by a canvas angle θ gives (sin θ, −cos θ). Setting that equal to
       planNorth ⇒  planNorth = (sin northRot, −cos northRot)
                ⇒  northRot = atan2(planNorth.x, −planNorth.y).
     We recover planNorth straight from the xform: transform plan (0,0),(1,0),
     (0,1) to geo, form the plan→geo Jacobian [E N] (dLng·cosLat, dLat per plan
     unit), then the plan vector whose geo step is due-north (dLat>0, dLng=0)
     is the SECOND column of the INVERSE Jacobian, normalised. This is
     independent of how xf.rot/pivot were built — geoXform is authoritative,
     so a hand-edited or externally-supplied xform still yields correct north.
     Returns degrees in (−180,180], or null if no usable geoXform. */
  SITE.detectNorthRot = (model) => {
    const xf = model && model.site && model.site.geoXform;
    if (!xf || xf.lat == null || xf.lng == null ||
        !HA.parcel || typeof HA.parcel.planToGeo !== 'function') return null;
    const g0 = HA.parcel.planToGeo({ x: 0, y: 0 }, xf);
    const gx = HA.parcel.planToGeo({ x: 1, y: 0 }, xf);
    const gy = HA.parcel.planToGeo({ x: 0, y: 1 }, xf);
    if (!g0 || !gx || !gy) return null;
    const cosLat = Math.cos(g0.lat * Math.PI / 180) || 1e-9;
    // plan→geo Jacobian in a LOCAL east/north metric (east = dLng·cosLat, north = dLat)
    const a = (gx.lng - g0.lng) * cosLat, c = (gx.lat - g0.lat);   // +X → (east a, north c)
    const b = (gy.lng - g0.lng) * cosLat, d = (gy.lat - g0.lat);   // +Y → (east b, north d)
    const det = a * d - b * c;
    if (!isFinite(det) || Math.abs(det) < 1e-30) return null;
    // planNorth = J⁻¹ · (east 0, north 1)  → the plan vector giving a pure +north step
    const nx = -b / det, ny = a / det;
    const L = Math.hypot(nx, ny);
    if (!(L > 0)) return null;
    const px = nx / L, py = ny / L;                                 // unit plan-north
    const rad = Math.atan2(px, -py);                               // see convention proof above
    return rad * 180 / Math.PI;
  };

  /* ---- AUTO FRONT (STREET) EDGE from OSM road centerlines -----------
     roads: array of { centerline:[{x,y}], name?, klass? } already in the
     lot's PLAN frame (model.site.features type 'road', source 'osm' — laid
     by HA.osmroads.fetchRoads via the same geoXform). For every lot edge we
     score how well a road fronts it:
       1. PARALLELISM — the edge direction must be within ~PARALLEL_DEG of the
          nearest road segment's direction (streets run ALONG a frontage, they
          don't stab across it). A road perpendicular to an edge is rejected.
       2. OUTSIDE — the nearest road point must sit on the OUTWARD side of the
          edge (dot(roadPt − edgeMid, outwardNormal) > 0): the street is off the
          lot, not a driveway/alley cutting through it.
       3. DISTANCE — among edges that pass 1+2, the smallest edge-midpoint-to-
          -road-centerline distance wins (the closest fronting street).
     CORNER LOTS: when the project address's street NAME matches an OSM way name
     (addressStreet arg), edges fronting THAT named road are preferred over a
     merely-closer cross street — the addressed street is the true front.
     Returns the winning lot-edge index, or null (→ keep manual/current). */
  const PARALLEL_DEG = 30;
  // core street name: drop the house number + a leading/trailing direction +
  // the street-type suffix so "2600 Castro Way" ↔ OSM "Castro Way" ↔ "S Castro".
  const streetCore = (s) => String(s || '')
    .toLowerCase()
    .replace(/^\s*\d+[a-z]?\s+/, '')
    .replace(/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)\s+/, '')
    .replace(/\s+(n|s|e|w|ne|nw|se|sw|north|south|east|west)$/, '')
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|place|pl|boulevard|blvd|circle|cir|terrace|ter|trail|trl|parkway|pkwy|highway|hwy|route|rte)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  SITE.detectFrontEdge = (model, roads, addressStreet) => {
    const site = model && model.site;
    const lot = site && Array.isArray(site.lot) ? cleanLoop(site.lot) : null;
    if (!lot || lot.length < 3) return null;
    // default roads source: the OSM road features already on the model
    if (!Array.isArray(roads)) {
      roads = ((site.features || []).filter((f) => f && f.type === 'road' && Array.isArray(f.centerline)));
    }
    if (!Array.isArray(roads) || !roads.length) return null;
    const wantCore = streetCore(addressStreet);
    const n = lot.length;

    let best = null;      // {i, dist} closest overall qualifying edge
    let bestNamed = null; // …restricted to edges whose nearest road name-matches the address

    for (let i = 0; i < n; i++) {
      const a = lot[i], b = lot[(i + 1) % n];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const eLen = U.dist(a, b);
      if (eLen < 1) continue;
      const eDir = { x: (b.x - a.x) / eLen, y: (b.y - a.y) / eLen };
      const outN = U.edgeOutNormal(lot, i);

      // nearest road segment to this edge's midpoint (across all road centerlines)
      let near = Infinity, nearPt = null, nearDir = null, nearName = '';
      for (const road of roads) {
        const cl = road.centerline;
        for (let k = 0; k + 1 < cl.length; k++) {
          const s0 = cl[k], s1 = cl[k + 1];
          const t = Math.max(0, Math.min(1, U.projT ? U.projT(mid, s0, s1) : segT(mid, s0, s1)));
          const foot = { x: s0.x + (s1.x - s0.x) * t, y: s0.y + (s1.y - s0.y) * t };
          const d = U.dist(mid, foot);
          if (d < near) {
            near = d; nearPt = foot;
            const sl = U.dist(s0, s1) || 1;
            nearDir = { x: (s1.x - s0.x) / sl, y: (s1.y - s0.y) / sl };
            nearName = road.name || '';
          }
        }
      }
      if (!nearPt || !nearDir) continue;

      // (1) PARALLELISM: |sin(angle between edge and road)| small ⇒ near-parallel
      const sinAng = Math.abs(U.cross(eDir, nearDir)); // = |sin θ|
      if (sinAng > Math.sin(PARALLEL_DEG * Math.PI / 180)) continue;
      // (2) OUTSIDE: the road must lie on the OUTWARD side of the edge
      if (U.dot(U.sub(nearPt, mid), outN) <= 0) continue;

      if (!best || near < best.dist) best = { i, dist: near };
      if (wantCore && streetCore(nearName) && streetCore(nearName) === wantCore) {
        if (!bestNamed || near < bestNamed.dist) bestNamed = { i, dist: near };
      }
    }
    // CORNER-LOT RULE: the addressed street wins over a merely-closer cross street.
    const pick = bestNamed || best;
    return pick ? pick.i : null;
  };
  // tiny param-t of the closest point on seg s0→s1 to p (0..1), if U.projT absent
  const segT = (p, s0, s1) => {
    const dx = s1.x - s0.x, dy = s1.y - s0.y;
    const dd = dx * dx + dy * dy;
    if (dd < 1e-9) return 0;
    return ((p.x - s0.x) * dx + (p.y - s0.y) * dy) / dd;
  };

  /* expose internals that are independently useful / testable */
  SITE.classifyEdges = classifyEdges;
  SITE.edgeYardKind = edgeYardKind;   // front/left/right/rear for one lot edge
  SITE.grossFloorAreaSf = grossFloorAreaSf;
  SITE.footprintLoop = footprintLoop;
  SITE.REF = REF;

  HA.site = SITE;
})();
