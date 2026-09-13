/* ============================================================
   Home Architect — framing.js
   Rule-based automatic framing, Chief Architect style.
   Members are {a:{x,y,z}, b:{x,y,z}, w, h, kind} — an axis from
   a to b with a w(horizontal) × h(vertical) cross-section.
   Defaults: studs 16" o.c. (double top / single bottom plate),
   rafters 24" o.c., floor joists 16" o.c., headers sized by a
   span table, deck framing per Chief's auto-deck defaults.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;
  const U = HA.U;
  const F = (HA.framing = {});

  const mem = (a, b, w, h, kind) => ({ a, b, w, h, kind });
  const P3 = (p, z) => ({ x: p.x, y: p.y, z });

  /* ---------------- covered-cover / pergola POST STATIONS (module scope, testable) ----
     Solve the intermediate post positions for a covered entrance / trellis whose beam
     runs from -halfSpan..+halfSpan with the door/slider centered at a=0 (Steve: "you
     randomly have a post always on the back, posts in the middle in the way — a glitch
     back there… backs are usually trellises"). Even ends+o.c. spacing planted a post
     DEAD CENTRE in front of the opening, blocking the walkway. Rules a builder follows:
       • keep the opening ± clearPad clear of any post (default the OSHA-ish 18");
       • odd bay count so the centered door falls MID-bay, never on a post;
       • carry any bay still wider than maxBay on the door JAMB lines (straddling bays)
         or a clear-side midpoint (side bays), iterating until every bay is in spec.
     Returns the intermediate station a-coords (excludes the two corner posts at ±halfSpan).
     Pure + deterministic → unit-tested in dev-porch-test without a THREE renderer. */
  HA.coverPostStations = (halfSpan, openHalf, opts) => {
    opts = opts || {};
    const spanW = halfSpan * 2;
    const ocMax = opts.oc || (8 * 12);            // even-spacing target o.c.
    const maxBay = opts.maxBay || (10 * 12);      // hard cap a beam bay may span
    const clearPad = opts.clearPad != null ? opts.clearPad : 18;
    const clearHalf = Math.min(halfSpan - 6, Math.max(0, openHalf) + clearPad);
    let nBays = Math.max(1, Math.ceil(spanW / ocMax));
    if (nBays % 2 === 0) nBays++;                 // odd → door falls MID-bay
    const stations = [];
    for (let k = 1; k < nBays; k++) {
      const a = -halfSpan + k * (spanW / nBays);
      if (Math.abs(a) < clearHalf) continue;      // keep the walkway clear
      stations.push(a);
    }
    for (let pass = 0; pass < 6; pass++) {
      const guard = [-halfSpan, ...stations].sort((x, y) => x - y); guard.push(halfSpan);
      let added = false;
      for (let i = 1; i < guard.length; i++) {
        const lo = guard[i - 1], hi = guard[i];
        if (hi - lo <= maxBay + 1) continue;
        if (lo < -clearHalf + 1 && hi > clearHalf - 1) {          // bay straddles the door
          if (clearHalf < halfSpan - 4) { stations.push(-clearHalf, clearHalf); added = true; }
        } else { stations.push((lo + hi) / 2); added = true; }
      }
      if (!added) break;
    }
    // drop any station that would double the corner posts, sort for a tidy row
    return stations.filter((a) => Math.abs(a) < halfSpan - 4).sort((x, y) => x - y);
  };

  /* ---------------- eave rafter-tail end condition (module scope, testable) -----
     A rafter/jack tail run all the way to the eave drop its BOTTOM corner below the
     fascia (see the long note in F.roof). These pure helpers compute the LEVEL-cut
     pull-back and apply it, so dev-rafterend-test can exercise them directly. */
  const RAFTER_D = 9.25;          // 2x10 rafter depth (matches F.roof's rD)
  const FASCIA_FACE = 11;         // view3d _eaveFasciaBoards FACE depth (plumb board)
  // pull-back (plan inches along the rafter run) that lifts the plumb-cut tail
  // bottom corner up to the fascia's bottom line. lift = (rD/2)·√(1+s²) is the
  // rafter's plumb half-depth; the skin drip sits lift + thickness·nz above the
  // tail bottom, so the tail hangs (lift + thickness·nz − FASCIA_FACE) below the
  // fascia bottom. Moving inboard by pb lifts the bottom by s·pb, hence:
  //   pb = max(0, (lift + thickness·nz − FASCIA_FACE) / s).   Flat roof → 0.
  F.eaveTailPullback = (slope, thickness, fasciaFace) => {
    const s = Math.abs(slope);
    if (!(s > 1e-4)) return 0;
    const pl = Math.sqrt(1 + s * s), lift = (RAFTER_D / 2) * pl, nz = 1 / pl;
    const ff = (fasciaFace != null) ? fasciaFace : FASCIA_FACE;
    return Math.max(0, (lift + thickness * nz - ff) / s);
  };
  // move a rafter's LOW (eave) plan endpoint INBOARD toward its HIGH end by `pb`,
  // capping the move so at least MIN_TAIL of rafter survives (a short hip-jack
  // stub still gets trimmed as far as it safely can rather than left hanging).
  const MIN_TAIL = 2;
  F.eaveTailCut = (pLow, pHigh, pb) => {
    const dx = pHigh.x - pLow.x, dy = pHigh.y - pLow.y;
    const L = Math.hypot(dx, dy);
    if (!(pb > 0) || L < MIN_TAIL + 0.5) return { x: pLow.x, y: pLow.y };
    const move = Math.min(pb, L - MIN_TAIL);
    const t = move / L;
    return { x: pLow.x + dx * t, y: pLow.y + dy * t };
  };

  /* ---------------- wall framing ---------------- */
  F.wall = (model, wall, elev) => {
    // UNDER-ROOF PORCH open edge: the open SPAN carries NO studs — the roof above bears
    // on a BEAM at plate height held by 6x6 posts on footings (open to the air). The
    // wall is never split (loop stays whole for the roof); we frame each SOLID remainder
    // as a normal stud wall + the open span as posts+beam, via sub-segments.
    if (HA.isPorchOpen && HA.isPorchOpen(wall)) {
      const wlen = HA.wallLen(wall);
      const [t0, t1] = HA.porchOpenRange(wall);
      if (t0 <= 1 && t1 >= wlen - 1) return F.porchWall(model, wall, elev);   // whole wall open
      const mm = [];
      if (t0 > 1) mm.push(...F.wall(model, HA.wallSubSegment(wall, 0, t0, true), elev));
      if (wlen - t1 > 1) mm.push(...F.wall(model, HA.wallSubSegment(wall, t1, wlen, true), elev));
      mm.push(...F.porchWall(model, HA.wallSubSegment(wall, t0, t1, false), elev));
      return mm;
    }
    // SIP wall types (WALL_TYPES[..].sip): panels + splines + plates instead of
    // studs — fork the whole layout (porch sub-segments above recurse back here,
    // so a partially-open SIP porch wall still panelizes its solid remainders).
    if ((HA.WALL_TYPES[wall.type] || {}).sip) return F.sipWall(model, wall, elev);
    const out = [];
    const len = HA.wallLen(wall);
    if (len < 3) return out;
    const d = HA.wallDir(wall);
    const A = HA.wallA(wall);
    const at = (x) => U.add(A, U.mul(d, x));
    const sw = (HA.WALL_TYPES[wall.type] || {}).stud || 3.5;
    const H = wall.height || model.settings.wallHeight;
    // STRUCTURAL AUTHORITY: stud o.c. honors wall > class > area > level > project overrides.
    const _wm = { x: (A.x + at(len).x) / 2, y: (A.y + at(len).y) / 2, level: null,
      wallId: wall.id, ext: /^ext/.test(wall.type || '') };
    const spacing = F.spacingFor(model, 'studSpacing', 'studSpacing', 16, _wm);
    const low = HA.isLow(wall);
    const plateTop = low ? 1 : 2; // pony walls: single top plate

    // plates
    out.push(mem(P3(at(0), elev + 0.75), P3(at(len), elev + 0.75), sw, 1.5, 'plate'));
    for (let i = 0; i < plateTop; i++) {
      const z = elev + H - 0.75 - i * 1.5;
      out.push(mem(P3(at(0), z), P3(at(len), z), sw, 1.5, 'plate'));
    }
    // SLAB foundation: exterior bottom plates bolt to the concrete (IRC R403.1.6) —
    // same layout rule as the raised mudsill via F.anchorPositions (AUDIT: slab plates
    // previously drew zero anchors). Plate top = elev+1.5 -> stickup to +2.75; 7"
    // embedment below slab top (elev) -> -7. R64: a carport infill wall bears on
    // its own concrete PAD, so it always bolts down regardless of the house's
    // foundation type.
    if ((wall.carport || (elev === 0 && model.foundation
        && model.foundation.enabled !== false && model.foundation.type !== 'raised'))
        && /^ext/.test(wall.type || '')) {
      for (const dst of F.anchorPositions(len, { maxOc: model.settings.anchorSpacing, edge: model.settings.anchorEdge })) {
        const p = at(dst);
        out.push(mem(P3(p, elev + 2.75), P3(p, elev - 7), 0.62, 0.62, 'anchor'));
      }
    }
    const studBot = elev + 1.5;
    const studTop = elev + H - plateTop * 1.5;

    const openings = (wall.openings || []).map((o) => {
      const header = HA.openingHeader(o);
      const hd = HA.headerDepth(header);
      const topZ = elev + (o.kind === 'door' ? o.height : o.sill + o.height);
      const botZ = o.kind === 'door' ? elev : elev + o.sill;
      return {
        o, x0: o.pos - o.width / 2, x1: o.pos + o.width / 2,
        headerZ0: topZ, headerZ1: Math.min(topZ + hd, studTop), botZ, header,
      };
    });
    const inOpening = (x) =>
      openings.find((op) => x > op.x0 - 3.2 && x < op.x1 + 3.2);

    // common studs — carry the wall direction so the 3D renderer orients the
    // narrow face ALONG the wall (not a fixed world axis)
    const stud = (x, z0, z1, kind) => {
      if (z1 - z0 < 1) return;
      const m = mem(P3(at(x), z0), P3(at(x), z1), 1.5, sw, kind || 'stud');
      m.ax = d;
      out.push(m);
    };
    stud(0.75, studBot, studTop);
    stud(len - 0.75, studBot, studTop);
    for (let x = spacing; x < len - 1.5; x += spacing) {
      const op = inOpening(x);
      if (!op) { stud(x, studBot, studTop); continue; }
      // cripples above header and below sill
      if (op.headerZ1 < studTop - 1) stud(x, op.headerZ1, studTop, 'cripple');
      if (op.botZ > studBot + 1) stud(x, studBot, op.botZ - 1.5, 'cripple');
    }
    // opening framing: kings, trimmers, header, sill
    for (const op of openings) {
      stud(op.x0 - 2.25, studBot, studTop, 'king');
      stud(op.x1 + 2.25, studBot, studTop, 'king');
      stud(op.x0 - 0.75, studBot, op.headerZ0, 'trimmer');
      stud(op.x1 + 0.75, studBot, op.headerZ0, 'trimmer');
      const hm = mem(
        P3(at(op.x0 - 1.5), op.headerZ0 + (op.headerZ1 - op.headerZ0) / 2),
        P3(at(op.x1 + 1.5), op.headerZ0 + (op.headerZ1 - op.headerZ0) / 2),
        sw, Math.max(1.5, op.headerZ1 - op.headerZ0), 'header');
      // tag the SCHEDULED nominal header so the takeoff bills from it, not the
      // wall-clipped member depth (headerZ1 is clamped to studTop; for a tall
      // opening in a standard-height wall that shrinks the drawn member below
      // its real cross-section and would under-bill the BOM).
      hm.hdr = op.header;
      out.push(hm);
      if (op.o.kind === 'window' && op.botZ > studBot + 1)
        out.push(mem(P3(at(op.x0), op.botZ - 0.75), P3(at(op.x1), op.botZ - 0.75), sw, 1.5, 'sill'));
    }
    return out;
  };

  /* ---------------- SIP wall framing (panels + splines + plates) ----------------
     A SIP wall is factory panels on a lumber chassis, not studs (IRC R610 / the
     reference GENII set):
       • 2x SOLE PLATE at core width (the panel sets OVER it — foam recessed) +
         DOUBLE top plate (top + cap, joints offset) — reuses the plate idiom.
       • Anchor bolts on slab exterior plates — unchanged from F.wall.
       • kind:'sip_panel' box members — one per 48" factory module along the
         clear runs between openings (w = module width, h = FULL panel thickness
         = WALL_TYPES.stud), plus panel pieces over headers / under sills (the
         factory cuts openings out of full blanks).
       • kind:'spline' 1.5"-wide core-depth verticals at interior module joints
         (surface-spline stock — billed in the takeoff's SIP section, NOT as
         dimensional lumber).
       • Openings: 2x perimeter BUCKS let into the foam recess (kind:'blocking')
         + a header carrying the hm.hdr nominal tag so the BOM bills it. */
  F.sipWall = (model, wall, elev) => {
    const out = [];
    const len = HA.wallLen(wall);
    if (len < 3) return out;
    const T = HA.WALL_TYPES[wall.type] || {};
    const panelT = T.stud || 6.375;            // full panel (skins + core)
    const coreW = T.core || (panelT - 0.875);  // lumber chassis width = foam core
    const d = HA.wallDir(wall);
    const A = HA.wallA(wall);
    const at = (x) => U.add(A, U.mul(d, x));
    const H = wall.height || model.settings.wallHeight;
    const low = HA.isLow(wall);
    const plateTop = low ? 1 : 2;              // double top plate (R610.9) unless pony

    // plates — sole + top/cap at CORE width (the 2x sets between the skins)
    out.push(mem(P3(at(0), elev + 0.75), P3(at(len), elev + 0.75), coreW, 1.5, 'plate'));
    for (let i = 0; i < plateTop; i++) {
      const z = elev + H - 0.75 - i * 1.5;
      out.push(mem(P3(at(0), z), P3(at(len), z), coreW, 1.5, 'plate'));
    }
    // anchor bolts (IRC R403.1.6) — identical rule to the stick path (R64: a
    // carport infill wall always bolts to its pad)
    if ((wall.carport || (elev === 0 && model.foundation
        && model.foundation.enabled !== false && model.foundation.type !== 'raised'))
        && /^ext/.test(wall.type || '')) {
      for (const dst of F.anchorPositions(len, { maxOc: model.settings.anchorSpacing, edge: model.settings.anchorEdge })) {
        const p = at(dst);
        out.push(mem(P3(p, elev + 2.75), P3(p, elev - 7), 0.62, 0.62, 'anchor'));
      }
    }
    const panBot = elev + 1.5;
    const panTop = elev + H - plateTop * 1.5;

    const openings = (wall.openings || []).map((o) => {
      const header = HA.openingHeader(o);
      const hd = HA.headerDepth(header);
      const topZ = elev + (o.kind === 'door' ? o.height : o.sill + o.height);
      const botZ = o.kind === 'door' ? elev : elev + o.sill;
      return {
        o, x0: o.pos - o.width / 2, x1: o.pos + o.width / 2,
        headerZ0: topZ, headerZ1: Math.min(topZ + hd, panTop), botZ, header,
      };
    });

    // a vertical box member (panel piece / spline / jamb buck), oriented to the wall
    const vbox = (xc, w, z0, z1, thick, kind) => {
      if (z1 - z0 < 1 || w < 0.5) return;
      const m = mem(P3(at(xc), z0), P3(at(xc), z1), w, thick, kind);
      m.ax = d;
      out.push(m);
    };

    // opening spans (with 2x bucks each side) to subtract from the panel runs
    const BUCK = 1.5;
    const spans = openings
      .map((op) => [Math.max(0, op.x0 - BUCK), Math.min(len, op.x1 + BUCK)])
      .sort((a, b) => a[0] - b[0]);
    const clearRuns = [];
    let cursor = 0;
    for (const [s0, s1] of spans) {
      if (s0 - cursor > 1) clearRuns.push([cursor, s0]);
      cursor = Math.max(cursor, s1);
    }
    if (len - cursor > 1) clearRuns.push([cursor, len]);

    // panels per 48" factory module measured from the WALL start, split at
    // opening bucks; a spline at every interior module joint inside a run.
    const MODULE = 48;
    for (const [r0, r1] of clearRuns) {
      let x = r0;
      while (x < r1 - 0.5) {
        // next module boundary on the 48" grid past x
        const nextGrid = Math.floor(x / MODULE + 1e-6) * MODULE + MODULE;
        const xEnd = Math.min(r1, nextGrid);
        vbox((x + xEnd) / 2, xEnd - x, panBot, panTop, panelT, 'sip_panel');
        if (xEnd < r1 - 0.5) // interior joint → surface spline (core-depth stock)
          vbox(xEnd, 1.5, panBot, panTop, coreW, 'spline');
        x = xEnd;
      }
    }

    // openings: perimeter 2x bucks in the foam recess + header (+ factory panel
    // pieces over the header / under the sill — the blank continues)
    for (const op of openings) {
      // jamb bucks (vertical 2x let into the core each side)
      vbox(op.x0 - 0.75, 1.5, panBot, op.headerZ0, coreW, 'blocking');
      vbox(op.x1 + 0.75, 1.5, panBot, op.headerZ0, coreW, 'blocking');
      const hm = mem(
        P3(at(op.x0 - 1.5), op.headerZ0 + (op.headerZ1 - op.headerZ0) / 2),
        P3(at(op.x1 + 1.5), op.headerZ0 + (op.headerZ1 - op.headerZ0) / 2),
        coreW, Math.max(1.5, op.headerZ1 - op.headerZ0), 'header');
      hm.hdr = op.header;   // scheduled nominal → BOM bills the real size
      out.push(hm);
      // sill buck under a window + head buck over the header line
      if (op.o.kind === 'window' && op.botZ > panBot + 1)
        out.push(mem(P3(at(op.x0), op.botZ - 0.75), P3(at(op.x1), op.botZ - 0.75), coreW, 1.5, 'blocking'));
      // factory panel continues above the header and below the sill
      if (op.headerZ1 < panTop - 1)
        vbox((op.x0 + op.x1) / 2, op.x1 - op.x0, op.headerZ1, panTop, panelT, 'sip_panel');
      if (op.o.kind === 'window' && op.botZ - 1.5 > panBot + 1)
        vbox((op.x0 + op.x1) / 2, op.x1 - op.x0, panBot, op.botZ - 1.5, panelT, 'sip_panel');
    }
    return out;
  };

  /* ---------------- UNDER-ROOF PORCH open edge framing ----------------
     An open porch edge = a BEAM at plate height carried by 6x6 posts on 16" footing
     pads, replacing the stud wall (the roof rafters above bear on the beam, not a
     top plate over studs). Mirrors F.deck's post/footing idioms (grade-seated posts,
     R507 spacing). The porch FLOOR steps down HA.PORCH_FLOOR_DROP below FF. */
  // find the porch AABB this open wall bounds (for the tributary pad-footing size)
  F.porchForWall = (model, wall) => {
    const mx = (wall.x1 + wall.x2) / 2, my = (wall.y1 + wall.y2) / 2;
    for (const lvl of model.levels || [])
      for (const pc of lvl._porches || [])
        if (mx > pc.x0 - 10 && mx < pc.x1 + 10 && my > pc.y0 - 10 && my < pc.y1 + 10) return pc;
    return null;
  };
  F.porchWall = (model, wall, elev) => {
    const out = [];
    const len = HA.wallLen(wall);
    if (len < 6) return out;
    const d = HA.wallDir(wall);
    const A = HA.wallA(wall);
    const at = (x) => U.add(A, U.mul(d, x));
    const H = wall.height || model.settings.wallHeight;
    const drop = HA.PORCH_FLOOR_DROP || 4;
    const floorY = elev - drop;                 // porch slab top (stepped down)
    // 6x8 support beam under the roof bearing line, + a bearing top plate on it.
    const beamD = 7.25, beamW = 5.5, beamTop = elev + H - 0.75;
    const beamCtr = beamTop - 1.5 - beamD / 2;  // beam sits below the single top plate
    out.push(mem(P3(at(0), beamTop - 0.75), P3(at(len), beamTop - 0.75), beamW, 1.5, 'plate'));
    out.push(mem(P3(at(0), beamCtr), P3(at(len), beamCtr), beamW, beamD, 'beam'));
    // posts: both ends + <=96" o.c. between (max ~8ft porch-post spacing).
    const nP = Math.max(2, Math.ceil(len / 96) + 1);
    const postSpacing = len / (nP - 1);
    // PAD FOOTING sized from the tributary roof load: spacing × porch depth (the
    // perpendicular extent of the porch to this open edge). Shared rule → the 3D
    // pads + foundation-plan callout all agree (HA.PORCH_POST_PAD).
    const _pc = F.porchForWall(model, wall);
    const _depth = _pc ? (Math.abs(d.x) >= Math.abs(d.y) ? (_pc.y1 - _pc.y0) : (_pc.x1 - _pc.x0)) : 96;
    const padSize = HA.PORCH_POST_PAD ? HA.PORCH_POST_PAD(postSpacing, _depth) : 16;
    const postTop = beamCtr - beamD / 2;
    const _gradeY = -((model.foundation && model.foundation.stemHeight) || 8);
    const _offIn = (model.site && model.site.terrain && model.site.terrain.offsetIn) || 0;
    const _seatY = (p) => {
      if (HA.terrain && typeof HA.terrain.heightAtInches === 'function') {
        const h = HA.terrain.heightAtInches(model, p.x, p.y);
        if (h != null && isFinite(h)) return Math.min(floorY - 2, h + _gradeY + _offIn);
      }
      return Math.min(floorY - 2, _gradeY);
    };
    for (let i = 0; i < nP; i++) {
      // pull the END posts a half-post inboard so the 6x6 sits INSIDE the corner
      let x = (len * i) / (nP - 1);
      if (i === 0) x += 2.75; else if (i === nP - 1) x -= 2.75;
      const p = at(x);
      const z0 = _seatY(p), z1 = postTop;
      out.push(mem(P3(p, z0), P3(p, z1), 5.5, 5.5, 'post'));
      out.push(mem(P3(p, z0 - 2), P3(p, z0 + 2), padSize, padSize, 'footing'));  // tributary-sized pad footing
    }
    return out;
  };

  /* ---------------- WOOD-FRAMED porch floor (Steve: "use our deck framing logic
     tools as an option for this room") ----------------
     A porch whose floor === 'deck' is framed as a real WOOD DECK, REUSING F.deck
     (one source of truth for ledger/joist/rim/beam/decking): a ledger on the house-
     side wall, joists across, a beam at the OPEN edge. The beam bears on the porch's
     OWN 6x6 posts (F.porchWall already runs those to grade on pad footings), so we
     DROP F.deck's redundant grade posts + footings — no doubled piers under the
     porch. Returns [] for a slab-floored porch (that's poured with the house slab). */
  F.porchFloor = (model, pc, li, elev) => {
    if (!pc || !(pc.floor === 'deck' || pc.deck)) return [];
    const ledgerEdge = HA.porchLedgerEdge ? HA.porchLedgerEdge(model, li, pc) : null;
    const synth = { x1: pc.x0, y1: pc.y0, x2: pc.x1, y2: pc.y1,
      drop: pc.drop || (HA.PORCH_FLOOR_DROP || 4), railing: false,
      material: pc.material || 'deck_cedar', ledgerEdge, _porch: true };
    return F.deck(model, synth, elev).filter((m) => m.kind !== 'post' && m.kind !== 'footing');
  };

  /* ---------------- floor framing (joists + girder) ----------------
     Upper levels (i >= 1) AND the GROUND floor over a RAISED foundation (joists in
     the crawlspace). A slab-on-grade ground floor has no joists. Joists run across
     the SHORT bbox dim @ settings.floorJoistSpacing o.c. (default 16"); when that span exceeds ~14' a GIRDER beam is
     dropped under mid-span (the joists bear on it) — Steve #9. */
  /* Anchor-bolt layout for one plate run of `len` inches, per IRC R403.1.6:
     minimum TWO bolts, one within 12" of each end, intermediate bolts <=72" o.c.
     Returns distances (inches) from the run start. Shared by F.floor (mudsill),
     F.wall (slab bottom plates) and the takeoff count so the BOM always matches
     the drawn bolts exactly. */
  F.anchorPositions = (len, opts) => {
    if (!(len > 4)) return [];
    // STRUCTURAL AUTHORITY: honor a user max-o.c. + edge inset (set_anchors); default
    // to code prescriptive (IRC R403.1.6): 12" insets, ≤72" between, min 2 bolts.
    const maxOc = (opts && opts.maxOc > 0) ? opts.maxOc : 72;
    const edge = (opts && opts.edge > 0) ? opts.edge : 12;
    const span = len - 2 * edge;
    if (span <= 0 || len <= 2 * edge + 2) return [len * 0.25, len * 0.75]; // short jog: two bolts
    const n = Math.max(2, Math.ceil(span / maxOc) + 1);
    const out = [];
    for (let k = 0; k < n; k++) out.push(edge + (k * span) / (n - 1));
    return out;
  };

  /* ---- STRUCTURAL AUTHORITY: per-scope framing override resolver ----
     Reads model.settings.framingScopes. Each scope carries one selector:
       {wallId}                 — a single wall (highest priority)
       {cls:'ext'|'int'}        — all exterior / interior walls
       {bbox:{x0,y0,x1,y1}}     — an area rectangle
       {level:N}                — a whole level
     plus any of: studSpacing, rafterSpacing, joistSpacing, joistDir.
     Hierarchy (most specific wins): wall > class > area > level > project.
     field: which value to read. ctx: {x,y,level,wallId,ext}. null → caller falls back. */
  F.frResolve = (model, field, ctx) => {
    const scopes = (model.settings && model.settings.framingScopes) || [];
    ctx = ctx || {};
    let wallHit = null, clsHit = null, areaHit = null, levelHit = null;
    for (const s of scopes) {
      if (s == null || s[field] == null) continue;
      if (s.wallId != null) {
        if (ctx.wallId != null && s.wallId === ctx.wallId) wallHit = s[field];
      } else if (s.cls != null) {
        if (ctx.ext != null && ((s.cls === 'ext') === !!ctx.ext)) clsHit = s[field];
      } else if (s.bbox) {
        if (ctx.x == null || ctx.y == null) continue;
        if (s.level != null && ctx.level != null && s.level !== ctx.level) continue;
        const b = s.bbox;
        if (ctx.x < b.x0 || ctx.x > b.x1 || ctx.y < b.y0 || ctx.y > b.y1) continue;
        areaHit = s[field]; // later area scopes override earlier
      } else if (s.level != null) {
        if (ctx.level != null && s.level === ctx.level) levelHit = s[field];
      }
    }
    return wallHit != null ? wallHit
      : clsHit != null ? clsHit
      : areaHit != null ? areaHit
      : levelHit;
  };
  // resolved o.c. spacing helper: scope override → global setting → hard default.
  F.spacingFor = (model, field, globalKey, hardDefault, ctx) => {
    const ov = F.frResolve(model, field, ctx);
    if (ov > 0) return ov;
    const g = model.settings && model.settings[globalKey];
    return g > 0 ? g : hardDefault;
  };

  /* ---- STRUCTURAL AUTHORITY: hold-down hardware members (view + BOM) ----
     One steel HDU box per user-placed hold-down (lvl.holddowns), seated at the wall
     base. gradeZ = the stem/mudsill top for that level. */
  F.holddownMembers = (model, levelIdx) => {
    const out = [];
    const L = model.levels[levelIdx];
    if (!L || !Array.isArray(L.holddowns)) return out;
    const elev = HA.levelElev(model, levelIdx);
    for (const h of L.holddowns) {
      if (!(isFinite(h.x) && isFinite(h.y))) continue;
      // 3"x3" x 14" tall steel body sitting on the plate, embedded anchor below.
      out.push(Object.assign(
        mem({ x: h.x, y: h.y, z: elev + 14 }, { x: h.x, y: h.y, z: elev }, 3, 3, 'holddown'),
        { hd: h }));
    }
    return out;
  };

  F.floor = (model, levelIdx) => {
    const out = [];
    const loop = HA.exteriorLoop(model, levelIdx);
    if (!loop) return out;
    const raisedGround = levelIdx === 0 && model.foundation && model.foundation.type === 'raised';
    if (levelIdx < 1 && !raisedGround) return out;
    const elev = HA.levelElev(model, levelIdx);
    const depth = (model.settings.platformDepth || 12) - 0.75; // joist depth (top under subfloor)
    const zMid = elev - 0.75 - depth / 2;   // joist / rim centerline (subfloor 0.75 above)
    const pts = loop.pts;
    // OUTER-FACE loop: rim board + mudsill align with the wall's OUTSIDE FACE (the bottom-plate /
    // stud edge = wall-stud/2), so rim + bottom plate + studs stack in ONE plane (Steve: "studs in
    // wall align with bottom plate; rim board correct"). offsetPoly pushes each edge out per its wall.
    const off = (dHalf) => (U.offsetPoly && loop.walls)
      ? (U.offsetPoly(pts, loop.walls.map((w) => (HA.wallStudHalf ? HA.wallStudHalf(w) : HA.wallT(w) / 2) - dHalf)) || pts)
      : pts;
    const rimPts = off(0.75);            // rim (1.5 thick): outer FACE flush with the stud face
    const okRim = rimPts && rimPts.length === pts.length;
    const RP = okRim ? rimPts : pts;
    // RIM board around the perimeter at the outer face
    for (let i = 0; i < RP.length; i++)
      out.push(mem(P3(RP[i], zMid), P3(RP[(i + 1) % RP.length], zMid), 1.5, depth, 'rim'));
    // MUDSILL (pressure-treated 2x, stud-width) flat on the stem-wall top, under the joists +
    // rim, with ANCHOR BOLTS through it into the concrete ~6' o.c. (raised ground floor only).
    if (raisedGround) {
      const sillZ = zMid - depth / 2 - 0.75;     // mudsill center (1.5 thick) just below the joists
      const swAvg = (loop.walls && loop.walls.length && HA.wallStud) ? HA.wallStud(loop.walls[0]) : 5.5;
      const sillPts = off(swAvg / 2);            // mudsill CENTERED on the stem (stud-width)
      const SP = (sillPts && sillPts.length === pts.length) ? sillPts : RP;
      for (let i = 0; i < SP.length; i++) {
        const a = SP[i], b = SP[(i + 1) % SP.length];
        out.push(mem(P3(a, sillZ), P3(b, sillZ), swAvg, 1.5, 'mudsill'));
        // ANCHOR BOLTS per IRC R403.1.6 (AUDIT #7/#8): min TWO per plate, one within
        // 12" of each end, <=6' o.c. between; 7" min embedment into the concrete
        // (stem top = sillZ-0.75 -> bottom at sillZ-7.75) with ~1.25" stickup above
        // the sill for nut + washer (top at sillZ+2).
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const bolts = F.anchorPositions(len, { maxOc: model.settings.anchorSpacing, edge: model.settings.anchorEdge });
        for (const d of bolts) {
          const t = d / len, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
          out.push(mem(P3({ x: px, y: py }, sillZ + 2), P3({ x: px, y: py }, sillZ - 7.75), 0.62, 0.62, 'anchor'));
        }
      }
    }
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // STRUCTURAL AUTHORITY: joist DIRECTION override. Default = span the SHORT bbox dim.
    // 'ns' → joists span N-S (alongX=true, member a..b runs minY..maxY); 'ew' → span E-W.
    const _fc = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, level: levelIdx };
    const _jd = F.frResolve(model, 'joistDir', _fc)
      || (model.settings.floorJoistDir && model.settings.floorJoistDir !== 'auto' ? model.settings.floorJoistDir : null);
    let alongX = (maxX - minX) >= (maxY - minY); // joists run along the SHORT dim
    if (_jd === 'ns' || _jd === 'y') alongX = true;
    else if (_jd === 'ew' || _jd === 'x') alongX = false;
    const span = alongX ? (maxY - minY) : (maxX - minX);
    const spacing = F.spacingFor(model, 'joistSpacing', 'floorJoistSpacing', 16, _fc);
    // GIRDER under mid-span when the joist span exceeds ~14'.
    if (span > 168) {
      const mid = alongX ? (minY + maxY) / 2 : (minX + maxX) / 2;
      const ga = alongX ? { x: minX, y: mid } : { x: mid, y: minY };
      const gb = alongX ? { x: maxX, y: mid } : { x: mid, y: maxY };
      const girderD = depth + 1.5;
      // RAISED crawlspace: a DROPPED girder — girder TOP at the joist BOTTOM so the
      // joists actually bear/lap on it (was flush-top: joists passed straight through
      // the beam, AUDIT #5). Ends pocket into the stem wall; interior 4x4 posts pick it
      // up at <=8' o.c. down to crawl grade (AUDIT #6). Upper floors keep a FLUSH beam
      // (joists on hangers — real construction) so nothing hangs into the room below.
      const girderZ = raisedGround ? (zMid - depth / 2 - girderD / 2) : (zMid - 0.75);
      const gradeZ = -((model.foundation && model.foundation.stemHeight) || 8);
      for (const [t0, t1] of U.clipSegToPoly(ga, gb, pts)) {
        const a = U.lerp(ga, gb, t0), b = U.lerp(ga, gb, t1);
        out.push(mem(P3(a, girderZ), P3(b, girderZ), 3.5, girderD, 'girder'));
        if (raisedGround) {
          const girderBot = girderZ - girderD / 2;
          if (girderBot > gradeZ + 0.5) {
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const nP = Math.ceil(len / 96) - 1;          // interior piers only (ends bear in stem pockets)
            for (let k = 1; k <= nP; k++) {
              const t = k / (nP + 1);
              const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
              out.push(mem(P3({ x: px, y: py }, girderBot), P3({ x: px, y: py }, gradeZ), 3.5, 3.5, 'post'));
            }
          }
        }
      }
    }
    /* STAIRWELL OPENINGS — R502.10. A flight on the level BELOW rises through THIS
       floor, so the joists must stop at the well and be carried by a header, and
       the header by doubled trimmers. Until now nothing clipped: a runtime probe
       on a 2-storey sample found 2 of 28 upper-floor joists running straight
       through the stairwell of the flight below.

       Subtracting the joists WITHOUT adding the header would be worse than leaving
       it — joists ending in mid-air with nothing carrying them is something a plans
       examiner catches immediately. So both, or neither. */
    const holes = [];
    {
      const below = (model.levels || [])[levelIdx - 1];
      for (const f of (below && below.fixtures) || []) {
        if (f.type !== 'stairs' || !HA.stairCorners) continue;
        const riseBelow = (below.height || 96) + (model.settings.platformDepth || 12);
        let poly = null;
        try { poly = HA.stairCorners(f, riseBelow); } catch (e) { poly = null; }
        if (poly && poly.length >= 3) holes.push(poly);
      }
    }
    /* Remove the parts of [t0,t1] that fall inside a hole. clipSegToPoly already
       returns the spans INSIDE a polygon, so the hole spans are subtracted from
       the footprint spans — one helper, used both ways. */
    const cutHoles = (a, b, spans) => {
      if (!holes.length) return spans;
      let cur = spans;
      for (const h of holes) {
        let inside = [];
        try { inside = U.clipSegToPoly(a, b, h) || []; } catch (e) { inside = []; }
        if (!inside.length) continue;
        const next = [];
        for (let [s0, s1] of cur) {
          let pieces = [[s0, s1]];
          for (const [h0, h1] of inside) {
            const acc = [];
            for (const [p0, p1] of pieces) {
              if (h1 <= p0 || h0 >= p1) { acc.push([p0, p1]); continue; }   // no overlap
              if (h0 > p0) acc.push([p0, h0]);                              // piece before
              if (h1 < p1) acc.push([h1, p1]);                              // piece after
            }
            pieces = acc;
          }
          for (const p of pieces) if (p[1] - p[0] > 1e-6) next.push(p);
        }
        cur = next;
      }
      return cur;
    };
    const emitJoists = (a, b) => {
      let spans = [];
      try { spans = U.clipSegToPoly(a, b, pts) || []; } catch (e) { spans = []; }
      for (const [t0, t1] of cutHoles(a, b, spans)) {
        const p0 = U.lerp(a, b, t0), p1 = U.lerp(a, b, t1);
        // a stub shorter than a joist is wide is litter on the plan, not a member
        if (U.dist(p0, p1) < 6) continue;
        out.push(mem(P3(p0, zMid), P3(p1, zMid), 1.5, depth, 'joist'));
      }
    };
    if (alongX) {
      for (let x = minX + spacing; x < maxX; x += spacing) emitJoists({ x, y: minY - 2 }, { x, y: maxY + 2 });
    } else {
      for (let y = minY + spacing; y < maxY; y += spacing) emitJoists({ x: minX - 2, y }, { x: maxX + 2, y });
    }
    /* HEADERS + TRIMMERS around each well. Doubled 2x of the joist depth: the
       header spans across the cut joists at both ends of the opening, the trimmers
       run parallel to the joists down both sides and carry the headers. Drawn on
       the well's axis-aligned bounds, which is what a framing plan shows — the
       raked outline of an L-flight is the FINISH opening, not the framing. */
    for (const h of holes) {
      const hx = h.map((p) => p.x), hy = h.map((p) => p.y);
      const x0 = Math.min(...hx), x1 = Math.max(...hx);
      const y0 = Math.min(...hy), y1 = Math.max(...hy);
      const DBL = 3.0;                       // two 1.5" plies
      if (alongX) {                          // joists run along Y -> headers are ⟂, along X
        out.push(mem(P3({ x: x0, y: y0 }, zMid), P3({ x: x1, y: y0 }, zMid), DBL, depth, 'header'));
        out.push(mem(P3({ x: x0, y: y1 }, zMid), P3({ x: x1, y: y1 }, zMid), DBL, depth, 'header'));
        out.push(mem(P3({ x: x0, y: y0 }, zMid), P3({ x: x0, y: y1 }, zMid), DBL, depth, 'trimmer'));
        out.push(mem(P3({ x: x1, y: y0 }, zMid), P3({ x: x1, y: y1 }, zMid), DBL, depth, 'trimmer'));
      } else {                               // joists run along X -> headers along Y
        out.push(mem(P3({ x: x0, y: y0 }, zMid), P3({ x: x0, y: y1 }, zMid), DBL, depth, 'header'));
        out.push(mem(P3({ x: x1, y: y0 }, zMid), P3({ x: x1, y: y1 }, zMid), DBL, depth, 'header'));
        out.push(mem(P3({ x: x0, y: y0 }, zMid), P3({ x: x1, y: y0 }, zMid), DBL, depth, 'trimmer'));
        out.push(mem(P3({ x: x0, y: y1 }, zMid), P3({ x: x1, y: y1 }, zMid), DBL, depth, 'trimmer'));
      }
    }
    // FIRE / SOLID BLOCKING between the joist bays (CRC R302.11 fireblocking of
    // concealed floor spaces + R502.7 lateral restraint). Solid 2x blocking the
    // full joist depth, run PERPENDICULAR to the joists, in continuous rows across
    // the footprint at <=8'-0" o.c. along the span (mid-span for a shorter bay).
    // The row line runs along the joist-SPACING axis (⟂ to the joists) and is
    // clipped to the footprint like the joists; a plans examiner looks for these
    // rows on the floor-framing plan + section. kind:'blocking' → billed as LF of
    // blocking in the takeoff and rendered in the 3D framing view (woodMat2 batch).
    {
      const BLOCK_OC = 96;                       // 8'-0" max between blocking rows
      const nRows = Math.max(1, Math.round(span / BLOCK_OC)); // interior rows
      // joists run along Y when alongX (spaced in X); blocking rows are LINES of
      // constant Y (alongX) or constant X (!alongX), stepped across the span.
      for (let r = 1; r <= nRows; r++) {
        const t = r / (nRows + 1);               // interior station fraction
        if (alongX) {
          const y = minY + (maxY - minY) * t;
          const a = { x: minX - 2, y }, b = { x: maxX + 2, y };
          for (const [t0, t1] of U.clipSegToPoly(a, b, pts))
            out.push(mem(P3(U.lerp(a, b, t0), zMid), P3(U.lerp(a, b, t1), zMid), 1.5, depth, 'blocking'));
        } else {
          const x = minX + (maxX - minX) * t;
          const a = { x, y: minY - 2 }, b = { x, y: maxY + 2 };
          for (const [t0, t1] of U.clipSegToPoly(a, b, pts))
            out.push(mem(P3(U.lerp(a, b, t0), zMid), P3(U.lerp(a, b, t1), zMid), 1.5, depth, 'blocking'));
        }
      }
    }
    return out;
  };

  /* ---------------- roof framing: rafters + ridge/hip/valley boards ----- */
  F.roof = (model, roofData) => {
    const out = [];
    if (!roofData || !roofData.ok) return out;
    const spacing = F.spacingFor(model, 'rafterSpacing', 'rafterSpacing', 24, { level: roofData.lvlIdx });
    // 2x10 rafters. BEARING: the roof plane z(p) = plate + slope·(inward
    // distance from the wall line) passes through the plate top exactly at
    // the bearing wall line. Lifting each rafter so its BOTTOM face lies in
    // that plane makes the underside cross the plate at the wall line — it
    // sits on the plate like a seat-cut (birdsmouth) rafter, with the tail
    // dropping below plate height out at the eave. Lifting the member axis
    // by (depth/2)·√(1+slope²) (perpendicular half-depth measured plumb)
    // puts the bottom face exactly in the roof plane.
    const rD = 9.25;
    const s = roofData.slope;
    const plumb = Math.sqrt(1 + s * s);
    const lift = (rD / 2) * plumb;

    // EAVE TAIL END-CONDITION (Steve: "rafters hang below fascia … miter those
    // edges so they are flush"). The roof SKIN is the rafter plane extruded ⟂ by
    // roof.thickness, so its DRIP sits `lift + rt·nz` ABOVE the rafter BOTTOM face
    // at the eave; view3d hangs a plumb FASCIA board (FASCIA_FACE deep) off that
    // drip. A 2x10 tail run all the way to the eave drops its bottom corner
    // `lift + rt·nz − FASCIA_FACE` BELOW the fascia's bottom edge — the little
    // triangular tail tip poking out under the eave in the screenshot (worst at a
    // hip corner where jack tails converge). Real carpentry gives the tail a PLUMB
    // cut at the fascia + a LEVEL (seat) cut so it tucks flush behind the board.
    // The renderer already plumb-cuts the flagged eave end; we add the LEVEL
    // condition here as DATA via F.eaveTailCut, pulling the tail's low endpoint
    // INBOARD by tailPB so the (plumb-cut) bottom corner rises to the fascia line.
    const roofT = Math.max(4, (model.roof && model.roof.thickness) || 8); // skin thickness (== view3d rt)
    const tailPB = F.eaveTailPullback(s, roofT, FASCIA_FACE);

    // ridge / hip / valley boards: 2x12 stock, one size over the rafters,
    // centered on the rafters' plumb depth so plumb cuts land on the board
    const lines = HA.roofMemberLines ? HA.roofMemberLines(roofData) : [];
    const bD = 11.25;
    for (const L of lines) {
      const zc = (z) => z + rD * plumb - bD / 2 + 0.4;
      out.push(mem(
        { x: L.a.x, y: L.a.y, z: zc(L.a.z) },
        { x: L.b.x, y: L.b.y, z: zc(L.b.z) },
        1.5, bD, L.kind));
    }
    // pull rafter ends back half the board thickness where they land on one
    const distToLine = (p, L) => {
      const d = U.sub(L.b, L.a);
      const len = Math.hypot(d.x, d.y) || 1;
      const t = ((p.x - L.a.x) * d.x + (p.y - L.a.y) * d.y) / (len * len);
      if (t < -0.02 || t > 1.02) return 1e9;
      const q = { x: L.a.x + d.x * t, y: L.a.y + d.y * t };
      return Math.hypot(p.x - q.x, p.y - q.y);
    };

    /* ---------------- DORMER OPENINGS (framed holes in the main roof) -------
       A gable dormer punches a rectangular hole in the slope it sits on. Real
       framing frames that hole: DOUBLED trimmer rafters up each side, a DOUBLED
       header across the top (high, back) and bottom (low, front), and the
       common rafters that would have run through the hole are cut and HUNG on
       those headers as jack rafters (nothing floats across the opening). We
       collect each opening in the plane's own {u=along-eave, v=inward} frame so
       the rafter loop can clip jacks to it and we can lay trimmers/headers here.
       roof.js stores the dormer's plan frame + the slope face it sits on. */
    const dOpenings = [];
    for (const dm of (roofData.dormers || [])) {
      if (!dm.frame || !dm.face || !dm.face.coef) continue;
      const { base, ex, ny } = dm.frame;
      // opening spans u∈[-w/2,+w/2] (eave direction) and v∈[d0,dR] (inward):
      // v=d0 is the LOW/front header line, v=dR is the HIGH/back header line
      // where the dormer's ridge dies into the main roof.
      dOpenings.push({
        base, ex, ny, coef: dm.face.coef,
        umin: -dm.w / 2, umax: dm.w / 2, vmin: dm.d0, vmax: dm.dR,
        w: dm.w, slope: roofData.slope, dm,
      });
    }
    // project a plan point into an opening's (u,v) frame
    const uvOf = (op, p) => {
      const rel = U.sub(p, op.base);
      return { u: U.dot(rel, op.ex), v: U.dot(rel, op.ny) };
    };
    // does plan point p fall inside opening op (with margin `m`)?
    const inOpening = (op, p, m) => {
      m = m || 0;
      const { u, v } = uvOf(op, p);
      return u > op.umin - m && u < op.umax + m && v > op.vmin - m && v < op.vmax + m;
    };
    // clip a rafter's plan segment [p0,p1] to the parts OUTSIDE every opening.
    // Returns a list of [q0,q1] sub-segments (the surviving jack pieces).
    const clipOutOfOpenings = (p0, p1) => {
      let segs = [[p0, p1]];
      for (const op of dOpenings) {
        const next = [];
        for (const [a, b] of segs) {
          const ua = uvOf(op, a), ub = uvOf(op, b);
          const inA = ua.u > op.umin && ua.u < op.umax && ua.v > op.vmin && ua.v < op.vmax;
          const inB = ub.u > op.umin && ub.u < op.umax && ub.v > op.vmin && ub.v < op.vmax;
          if (!inA && !inB) {
            // may still pass THROUGH: clip against v=vmin and v=vmax within the u band
            if (ua.u > op.umin && ua.u < op.umax && ub.u > op.umin && ub.u < op.umax
                && Math.min(ua.v, ub.v) < op.vmin && Math.max(ua.v, ub.v) > op.vmax) {
              const tLo = (op.vmin - ua.v) / (ub.v - ua.v);
              const tHi = (op.vmax - ua.v) / (ub.v - ua.v);
              const tA = Math.min(tLo, tHi), tB = Math.max(tLo, tHi);
              next.push([a, U.lerp(a, b, tA)]);
              next.push([U.lerp(a, b, tB), b]);
            } else next.push([a, b]);
            continue;
          }
          // one or both ends inside: keep only the outside piece(s)
          if (inA && inB) continue; // fully swallowed
          // find the v-crossing where it exits the opening (jacks hang on a header)
          const tLo = (op.vmin - ua.v) / (ub.v - ua.v);
          const tHi = (op.vmax - ua.v) / (ub.v - ua.v);
          const ts = [tLo, tHi].filter((t) => t > 1e-3 && t < 1 - 1e-3).sort((x, y) => x - y);
          const t = inA ? (ts[0] != null ? ts[0] : 0) : (ts[ts.length - 1] != null ? ts[ts.length - 1] : 1);
          if (inA) next.push([U.lerp(a, b, t), b]);
          else next.push([a, U.lerp(a, b, t)]);
        }
        segs = next;
      }
      return segs;
    };

    // one merged polygon per roof plane → continuous rafters; stations on a
    // WORLD grid so co-planar sections share layout across old facet seams
    const faces = HA.mergeRoofPlanes
      ? HA.mergeRoofPlanes(roofData)
      : roofData.faces.filter((f) => f.kind === 'slope');
    for (const f of faces) {
      if (f.kind !== 'slope') continue;
      const e = f.edge;
      const zAt = (p) => f.coef.A * p.x + f.coef.B * p.y + f.coef.C;
      const t0 = U.dot(U.sub(f.poly2.reduce((m, p) => (U.dot(U.sub(p, e.a), e.dir) < U.dot(U.sub(m, e.a), e.dir) ? p : m)), e.a), e.dir);
      const t1 = U.dot(U.sub(f.poly2.reduce((m, p) => (U.dot(U.sub(p, e.a), e.dir) > U.dot(U.sub(m, e.a), e.dir) ? p : m)), e.a), e.dir);
      const sA = U.dot(e.a, e.dir); // world offset → seam-independent phase
      for (let w = Math.floor((sA + t0) / spacing) * spacing + spacing; w < sA + t1; w += spacing) {
        const base = U.add(e.a, U.mul(e.dir, w - sA));
        const a = U.add(base, U.mul(e.inN, -s * 200 - 60));
        const b = U.add(base, U.mul(e.inN, 2400));
        for (const [s0, s1] of U.clipSegToPoly(a, b, f.poly2)) {
          let p0 = U.lerp(a, b, s0), p1 = U.lerp(a, b, s1);
          if (U.dist(p0, p1) < 6) continue;
          const run = U.norm(U.sub(p1, p0));
          // Where a rafter top lands on a ridge/hip/valley board, pull the axis
          // end back to the board FACE (half the 1.5" board width) and FLAG that
          // end for a PLUMB cut. The axis already meets the board face here, which
          // is carpentry-correct for the centerline; the flag tells the 3D
          // renderer to shear that end cap VERTICAL (a plumb cut) instead of
          // leaving it square to the slope. A square cap is tilted ~atan(slope)
          // off vertical, so opposing rafters' end caps splay ±(rD/2)·(s/√(1+s²))
          // in plan — the top corner falls short of the board (gap at the peak)
          // while the bottom corner overruns past the ridge centerline into the
          // far slope (Steve's "framing don't miter up top"). Plumb-cutting the
          // flagged end makes both rafters present a vertical face flush to the
          // ridge board, mirrored across it — a clean plumb-cut miter.
          let cutA = false, cutB = false, boardA = false, boardB = false;
          for (const L of lines) {
            if (distToLine(p1, L) < 1.2) { p1 = U.sub(p1, U.mul(run, 0.75)); cutB = true; boardB = true; }
            if (distToLine(p0, L) < 1.2) { p0 = U.add(p0, U.mul(run, 0.75)); cutA = true; boardA = true; }
          }
          // PLUMB-cut the free EAVE (tail) end too: the exposed rafter tail must read
          // VERTICAL at the fascia, not square to the slope (Steve). The LOWER end is
          // the eave — flag it. Then LEVEL-cut it (F.eaveTailCut): pull the eave
          // endpoint INBOARD by `tailPB` so the plumb-cut tail bottom tucks up behind
          // the fascia bottom instead of hanging below it. Only a FREE eave (not an
          // end that died on a ridge/hip/valley board) gets the tail cut.
          const lowIsP0 = zAt(p0) <= zAt(p1);
          if (lowIsP0) cutA = true; else cutB = true;
          if (tailPB > 0) {
            if (lowIsP0 && !boardA) p0 = F.eaveTailCut(p0, p1, tailPB);
            else if (!lowIsP0 && !boardB) p1 = F.eaveTailCut(p1, p0, tailPB);
          }
          // DORMER: a rafter that would pass through a dormer opening is CUT and
          // HUNG on the header(s). clipOutOfOpenings returns the surviving jack
          // piece(s) outside every opening; each piece keeps the parent's eave/
          // ridge plumb-cut flags on the matching end and becomes a 'jack' where
          // its inboard end lands on a header (so nothing floats across the hole).
          const pieces = dOpenings.length ? clipOutOfOpenings(p0, p1) : [[p0, p1]];
          for (const [q0, q1] of pieces) {
            if (U.dist(q0, q1) < 6) continue;
            const trimmed = pieces.length > 1 || U.dist(q0, p0) > 0.5 || U.dist(q1, p1) > 0.5;
            const kind = (dOpenings.length && trimmed) ? 'jack' : 'rafter';
            const rm = mem(
              P3(q0, zAt(q0) + lift), P3(q1, zAt(q1) + lift),
              1.5, rD, kind);
            // preserve original end flags only when the piece still reaches them
            if (cutA && U.dist(q0, p0) < 0.5) rm.cutA = true;
            if (cutB && U.dist(q1, p1) < 0.5) rm.cutB = true;
            // a jack's cut-at-header end reads plumb (butts the doubled header)
            if (kind === 'jack') { if (U.dist(q0, p0) > 0.5) rm.cutA = true; if (U.dist(q1, p1) > 0.5) rm.cutB = true; }
            out.push(rm);
          }
        }
      }
    }

    /* ---------------- DORMER FRAMING (trimmers, headers, dormer structure) ---
       For every dormer opening we now lay the members that frame the hole and
       carry the dormer above it. All plane-plan members sit in the MAIN roof
       plane using the same axis-lift convention as the common rafters (their
       bottom face lands in the plane): axis z = coef·p + lift.
         • DOUBLED TRIMMERS: two 2x rafters side-by-side up each u-side of the
           opening (4 members), running v=vmin→vmax along the slope.
         • DOUBLED HEADERS: two 2x members across the low (v=vmin, front) and the
           high (v=vmax, back) ends of the opening (4 members), spanning between
           the trimmers — the jack rafters butt/hang on these.
         • DORMER STRUCTURE: side-wall studs standing on the main plane along
           each u-side, a dormer RIDGE from the front wall peak back to where it
           dies into the main roof, and dormer common RAFTERS off that ridge. */
    for (const op of dOpenings) {
      const { base, ex, ny, coef, dm } = op;
      const zP = (p) => coef.A * p.x + coef.B * p.y + coef.C; // main-plane z at plan p
      const P = (u, v) => U.add(base, U.add(U.mul(ex, u), U.mul(ny, v)));
      const memPlane = (u0, v0, u1, v1, w, h, kind) => {
        const a = P(u0, v0), b = P(u1, v1);
        return mem(P3(a, zP(a) + lift), P3(b, zP(b) + lift), w, h, kind);
      };
      const hw = op.w / 2;
      // DOUBLED TRIMMERS — two 1.5" members straddling each u-edge, offset ±0.75
      for (const su of [-1, 1]) {
        for (const off of [-0.75, 0.75]) {
          out.push(memPlane(su * hw + off, op.vmin, su * hw + off, op.vmax, 1.5, rD, 'trimmer'));
        }
      }
      // DOUBLED HEADERS — two 1.5" members across each v-end, offset ±0.75 in v,
      // spanning trimmer-to-trimmer (jacks butt these). 2x stock, one over rafters.
      for (const vEnd of [op.vmin, op.vmax]) {
        for (const off of [-0.75, 0.75]) {
          out.push(memPlane(-hw, vEnd + off, hw, vEnd + off, 1.5, rD, 'header'));
        }
      }
      // ---- DORMER'S OWN STRUCTURE (above the plane) ----
      const zLow = dm.zLow != null ? dm.zLow : zP(P(0, op.vmin));
      const zR = dm.zR != null ? dm.zR : zLow + 60;
      const zE = dm.zE != null ? dm.zE : zLow + 48;
      const d0 = dm.d0 != null ? dm.d0 : op.vmin;
      const dR = dm.dR != null ? dm.dR : op.vmax;
      // dormer SIDE-WALL studs: short studs on each u-side from the main plane up
      // to the dormer eave line, 16" o.c. along v from front wall to where the
      // side wall dies into the main roof.
      for (const su of [-1, 1]) {
        for (let v = d0; v <= dR - 4; v += 16) {
          const p = P(su * hw, v);
          const zBot = zP(p) + lift;
          const zTop = Math.max(zBot + 6, zE - (v - d0) * op.slope);
          out.push(mem(P3(p, zBot), P3(p, zTop), 1.5, 3.5, 'stud'));
        }
      }
      // dormer front-wall king/jack studs framing the window opening head/sill —
      // corner studs at each u-side of the front wall (v=d0), plane→dormer eave.
      for (const su of [-1, 1]) {
        const p = P(su * hw, d0);
        out.push(mem(P3(p, zP(p) + lift), P3(p, zE), 1.5, 3.5, 'stud'));
      }
      // dormer RIDGE runs at constant zR from the front-wall peak back along v
      // until it dies INTO the rising main roof plane (where plane-z reaches zR).
      // Solve zP(P(0,v)) + lift == zR for that back station vEnd.
      const planeZv = (v) => zP(P(0, v)) + lift;
      let vEnd = dR;
      {
        // plane-z is linear in v; find the crossing (clamped to [d0,dR])
        const z0 = planeZv(d0), z1 = planeZv(dR);
        if (Math.abs(z1 - z0) > 1e-6) {
          const t = (zR - z0) / (z1 - z0);
          vEnd = U.clamp(d0 + t * (dR - d0), d0 + 4, dR);
        }
      }
      // dormer RIDGE: horizontal board at zR from front peak to vEnd. 2x, one over.
      {
        const pf = P(0, d0), pb = P(0, vEnd);
        out.push(mem(P3(pf, zR), P3(pb, zR), 1.5, bD, 'ridge'));
      }
      // dormer COMMON RAFTERS: ridge (zR) down to each side eave (zE) at ~16" o.c.
      // along v, only where the ridge is genuinely above the eave (real gable).
      if (zR > zE + 2) {
        for (let v = d0; v <= vEnd - 2; v += 16) {
          const ridgeP = P(0, v);
          for (const su of [-1, 1]) {
            const eaveP = P(su * hw, v);
            // the dormer side eave rides at zE only while it stands ABOVE the
            // rising main plane; once the main roof reaches zE the side wall has
            // died into the valley — stop the eave AT the main plane there so no
            // dormer member dips below/through the main roof inside the opening.
            const zEave = Math.max(zE, zP(eaveP) + lift);
            if (zEave >= zR - 2) continue;   // gable closed at this station
            out.push(mem(P3(ridgeP, zR), P3(eaveP, zEave), 1.5, rD, 'rafter'));
          }
        }
      }
    }

    /* ---------------- LEDGER + BLOCKING (roof-to-wall bearing) -----------
       Where a roof plane's HIGH side dies INTO a wall instead of meeting a
       ridge/hip/valley board, the rafters bear on a LEDGER fastened to that
       wall (shed roofs, a lower/skirt roof tying into a 2nd-floor wall, a
       wing landing on a taller wall). Real framing fastens a 2x ledger to the
       wall at the bearing height + adds BLOCKING between the wall studs behind
       it for nailing/backing. We detect those edges geometrically so it works
       for BOTH the main roof (rarely — its high side is usually a ridge) and
       lower roofs (where buildLowerRoofs already clips faces to die into the
       upper-story walls), with no double-up where a board already exists. */
    // every exterior wall in the model, with its plan line + top elevation —
    // the candidate walls a roof can bear against (a taller wall it ties into)
    const wallLines = [];
    for (let li = 0; li < model.levels.length; li++) {
      const lelev = HA.levelElev(model, li);
      for (const w of model.levels[li].walls) {
        if (!HA.isExt(w) || HA.wallLen(w) < 6) continue;
        const top = lelev + (w.height || model.settings.wallHeight);
        const sw = (HA.WALL_TYPES[w.type] || {}).stud || 3.5;
        wallLines.push({ a: HA.wallA(w), b: HA.wallB(w), dir: HA.wallDir(w), top, sw });
      }
    }
    const onLine = (p, L) => {        // distance from point p to wall line L
      const rel = U.sub(p, L.a);
      const off = Math.abs(U.cross(L.dir, rel));
      const along = U.dot(rel, L.dir);
      return off < 6 && along > -6 && along < U.dist(L.a, L.b) + 6 ? off : 1e9;
    };
    const nearBoard = (p) => {        // does p sit on a ridge/hip/valley board?
      for (const L of lines) if (distToLine(p, L) < 4) return true;
      return false;
    };
    // The ledger sits at the rafter BOTTOM-face bearing line (the seat), which is
    // `lift` below the roof-plane z, and the board is centered bD/2 above that.
    const seatZ = (zPlane) => zPlane - lift + bD / 2 - 0.4;
    const ledgerSeen = new Set();
    for (const f of faces) {
      if (f.kind !== 'slope' || !f.coef || !f.poly2) continue;
      const zAt = (p) => f.coef.A * p.x + f.coef.B * p.y + f.coef.C;
      const poly = f.poly2;
      // the eave (low) edge of this plane is f.edge — never a ledger; skip any
      // edge collinear with it so a shed's downhill edge isn't mistaken for one.
      const eaveDir = f.edge ? f.edge.dir : null;
      const eaveA = f.edge ? f.edge.a : null;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (U.dist(a, b) < 12) continue;
        const mid = U.lerp(a, b, 0.5);
        if (nearBoard(mid)) continue;     // a ridge/hip/valley board is already here
        // skip the eave: an edge lying on f.edge's line (low side, bears on its
        // own plate — F.wall/F.ceiling already frame that, no wall rises above it)
        if (eaveDir && Math.abs(U.cross(eaveDir, U.norm(U.sub(b, a)))) < 0.05 &&
            Math.abs(U.cross(eaveDir, U.sub(mid, eaveA))) < 6) continue;
        // find a wall this edge dies INTO: coincident in plan AND its top rises
        // above the roof plane here (the roof bears against a TALLER wall — the
        // classic ledger condition, whether the edge is level or raking).
        let best = null, bestOff = 6;
        for (const L of wallLines) {
          const om = onLine(mid, L), oa = onLine(a, L), ob = onLine(b, L);
          if (om > bestOff || oa > 6 || ob > 6) continue;
          if (L.top < Math.max(zAt(a), zAt(b)) + 1) continue; // wall must rise ABOVE the roof here
          best = L; bestOff = om;
        }
        if (!best) continue;
        // de-dupe (a merged plane can present the same wall edge twice)
        const key = Math.round(mid.x / 3) + ',' + Math.round(mid.y / 3);
        if (ledgerSeen.has(key)) continue;
        ledgerSeen.add(key);
        // LEDGER: a 2x (wall-stud thick) fastened to the wall at the bearing line.
        // Follows the roof's rake — endpoints carry their own seat z, so on a shed
        // it climbs the wall with the rafters; on a level bearing it stays flat.
        const dir = U.norm(U.sub(b, a));
        // pull the ledger ends in half a stud bay so it stops at the inside
        // corner framing instead of overrunning the wall ends
        const la = U.add(a, U.mul(dir, 0.75));
        const lb = U.sub(b, U.mul(dir, 0.75));
        out.push(mem(
          { x: la.x, y: la.y, z: seatZ(zAt(la)) },
          { x: lb.x, y: lb.y, z: seatZ(zAt(lb)) },
          best.sw, bD, 'ledger'));
        // BLOCKING: short 2x pieces THROUGH the wall behind the ledger between
        // studs (~16" o.c.) for nailing/backing — depth matches the ledger, run
        // perpendicular to the wall, each at its own local seat height on the rake.
        const perp = { x: -dir.y, y: dir.x };
        const wallStud = best.sw;
        const segLen = U.dist(la, lb);
        const blkSpacing = model.settings.studSpacing || 16;
        for (let sx = blkSpacing / 2; sx < segLen; sx += blkSpacing) {
          const c = U.add(la, U.mul(dir, sx));
          const bz = seatZ(zAt(c));
          const bk0 = U.add(c, U.mul(perp, -wallStud / 2));
          const bk1 = U.add(c, U.mul(perp, wallStud / 2));
          out.push(mem(
            { x: bk0.x, y: bk0.y, z: bz },
            { x: bk1.x, y: bk1.y, z: bz },
            1.5, bD, 'blocking'));
        }
      }
    }

    /* ---------------- GABLE-END framing + RAKE structure (AUDIT #21/#22) ----
       (a) GABLE STUDS: 16" o.c. angle-cut studs from the top plate up to the
       roof underside inside every vertical gable triangle — the framing view
       showed an empty triangle with the end rafters floating.
       (b) RAKE OVERHANG: a BARGE rafter along the rake edge (the roof skin
       cantilevered `rake` outboard of the gable face with nothing under it)
       plus flat 2x4 OUTLOOKERS at 24" o.c. running from over the gable end out
       to the barge — real rake construction (outlookers over a dropped gable). */
    for (const f of (roofData.faces || [])) {
      if (f.kind !== 'gable' || !f.pts3 || f.pts3.length < 3 || !f.edge) continue;
      const e = f.edge;
      const org = f.pts3[0];
      const plateZ = Math.min(f.pts3[0].z, f.pts3[f.pts3.length - 1].z);
      const stAt = (p) => (p.x - org.x) * e.dir.x + (p.y - org.y) * e.dir.y;
      const prof = f.pts3.map((p) => ({ s: stAt(p), z: p.z })).sort((u, v) => u.s - v.s);
      const sMax = prof[prof.length - 1].s;
      if (!(sMax > 8)) continue;
      const topAt = (sD) => {
        for (let i = 0; i < prof.length - 1; i++) {
          if (sD >= prof[i].s - 1e-6 && sD <= prof[i + 1].s + 1e-6) {
            const t = (sD - prof[i].s) / Math.max(1e-6, prof[i + 1].s - prof[i].s);
            return prof[i].z + (prof[i + 1].z - prof[i].z) * t;
          }
        }
        return plateZ;
      };
      const gsw = HA.wallStud ? HA.wallStud(e.wall) : 3.5;
      const gSip = !!((HA.WALL_TYPES[(e.wall || {}).type] || {}).sip);
      if (gSip) {
        // (a-SIP) gable-end PANELS — the factory fills the triangle with 48"
        // modules stepped under the rake (coarse honest approximation: each
        // module rises to the LOWER of its two end heights). No gable studs.
        for (let s0 = 0; s0 < sMax - 1.5; s0 += 48) {
          const s1 = Math.min(sMax, s0 + 48);
          const zTop = Math.min(topAt(s0), topAt(s1));
          if (zTop - plateZ < 3) continue;
          const p = { x: org.x + e.dir.x * (s0 + s1) / 2, y: org.y + e.dir.y * (s0 + s1) / 2 };
          const gm = mem(P3(p, plateZ + 0.25), P3(p, zTop - 0.5), s1 - s0, gsw, 'sip_panel');
          gm.ax = e.dir;
          out.push(gm);
        }
      } else {
        // (a) gable studs — plate top to the roof underside at each station
        for (let sD = 16; sD < sMax - 1.5; sD += 16) {
          const zTop = topAt(sD);
          if (zTop - plateZ < 3) continue;
          const p = { x: org.x + e.dir.x * sD, y: org.y + e.dir.y * sD };
          const gm = mem(P3(p, plateZ + 0.25), P3(p, zTop - 0.5), 1.5, gsw, 'stud');
          gm.ax = e.dir;
          out.push(gm);
        }
      }
      // (b) rake barge + outlookers — only when there IS a rake overhang
      const rake = Math.max((model.roof && model.roof.rake) || 0, HA.wallT(e.wall) / 2 + 2);
      if (rake >= 4) {
        const outv = { x: -e.inN.x, y: -e.inN.y };   // outboard of the gable face
        // barge rafter: the profile's sloped segments translated `rake` outboard
        // (roof z is constant moving along the ridge direction), same axis-lift
        // convention as the common rafters so the planes align.
        for (let i = 0; i < prof.length - 1; i++) {
          const p0 = prof[i], p1 = prof[i + 1];
          if (Math.max(p0.z, p1.z) <= plateZ + 0.25) continue;   // skip flat plate segments
          if (p1.s - p0.s < 4) continue;
          const A = { x: org.x + e.dir.x * p0.s + outv.x * rake, y: org.y + e.dir.y * p0.s + outv.y * rake };
          const B = { x: org.x + e.dir.x * p1.s + outv.x * rake, y: org.y + e.dir.y * p1.s + outv.y * rake };
          out.push(mem(P3(A, p0.z + lift), P3(B, p1.z + lift), 1.5, rD, 'rafter'));
        }
        // outlookers: flat 2x4s at 24" o.c., from 46" inboard (over the gable
        // framing, nailed to the first inboard rafter) out to the barge; top
        // flush with the rafter tops (axis at plane + rD*plumb - 0.75).
        for (let sD = 12; sD < sMax - 4; sD += 24) {
          const zTop = topAt(sD);
          if (zTop - plateZ < 1) continue;
          const pin = { x: org.x + e.dir.x * sD + e.inN.x * 46, y: org.y + e.dir.y * sD + e.inN.y * 46 };
          const pout = { x: org.x + e.dir.x * sD + outv.x * (rake - 0.75), y: org.y + e.dir.y * sD + outv.y * (rake - 0.75) };
          const oz = zTop + rD * plumb - 0.75;
          out.push(mem(P3(pin, oz), P3(pout, oz), 3.5, 1.5, 'blocking'));
        }
      }
    }
    return out;
  };

  /* PLUMB CUT (rafter ↔ ridge/hip/valley board), pure + testable so the math
     is locked here rather than buried in the un-tested 3D renderer.
     A rafter member box is capped SQUARE (perpendicular to its sloped axis) by
     the renderer. For the end that lands on a board (m.cutA / m.cutB) we want a
     PLUMB cut instead: a VERTICAL end face through the axis endpoint. Each of
     that end's four box corners `c` is slid ALONG the member axis `dir` until it
     reaches the vertical plane through the endpoint `end` — i.e. its horizontal
     (x,y) offset from `end` is cancelled. With t = -(horizontal offset · dirH)
     / |dirH|², the corner moves to c + t·dir. dir is the UNIT member axis
     (world; z up). Returns the shifted corner {x,y,z}; horizontal coords equal
     `end`'s, so the cap becomes vertical. A near-horizontal axis (|dirH|≈0) is
     left unchanged (no meaningful plumb cut). */
  F.plumbCutCorner = (c, end, dir) => {
    const hx = c.x - end.x, hy = c.y - end.y;
    const dh2 = dir.x * dir.x + dir.y * dir.y;
    if (dh2 < 1e-9) return { x: c.x, y: c.y, z: c.z };
    const t = -(hx * dir.x + hy * dir.y) / dh2;
    return { x: c.x + dir.x * t, y: c.y + dir.y * t, z: c.z + dir.z * t };
  };

  /* ---------------- ceiling joists (top level, under the roof) ----------
     Levels under another level's floor are framed by F.floor; only the
     TOP level needs ceiling joists. 2x6 @ 16" o.c. (2x8 when the clear
     span between bearing walls exceeds ~12'), running parallel to the
     rafters (perpendicular to the ridge), spanning between the exterior
     bearing walls and lapping over interior walls. The joists bear ON TOP
     of the wall top plate: underside elevation == plate height. */
  const ceilingCalc = (model, levelIdx, roofData) => {
    const loop = HA.exteriorLoop(model, levelIdx);
    if (!loop) return null;
    const lvl = model.levels[levelIdx];
    const elev = HA.levelElev(model, levelIdx);
    const plate = elev +
      Math.max(...loop.walls.map((w) => w.height || model.settings.wallHeight));
    const pts = loop.pts;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // run direction: parallel to the rafters — the inward normal of the
    // dominant (largest) roof slope face; falls back to the short bbox dim
    let runY = (maxX - minX) >= (maxY - minY);
    if (roofData && roofData.ok) {
      let bestA = 0, bestN = null;
      for (const f of roofData.faces) {
        if (f.kind !== 'slope' || !f.edge) continue;
        const a2 = Math.abs(U.polyArea(f.poly2));
        if (a2 > bestA) { bestA = a2; bestN = f.edge.inN; }
      }
      if (bestN) runY = Math.abs(bestN.y) >= Math.abs(bestN.x);
    }
    // interior full-height walls perpendicular to the run are mid-span bearing
    const bearing = (lvl.walls || []).filter((w) =>
      !HA.isExt(w) && !HA.isLow(w) && HA.wallLen(w) > 12);
    const spacing = F.spacingFor(model, 'joistSpacing', 'ceilingJoistSpacing', 16, { level: levelIdx });
    const runs = [];
    const station = (a, b) => {
      for (const [t0, t1] of U.clipSegToPoly(a, b, pts)) {
        const A = U.lerp(a, b, t0), B = U.lerp(a, b, t1);
        const len = U.dist(A, B);
        if (len < 12) continue;
        const d = U.norm(U.sub(B, A));
        // split where an interior bearing wall crosses the run
        const cuts = [];
        for (const w of bearing) {
          if (Math.abs(U.dot(HA.wallDir(w), d)) > 0.7) continue; // parallel-ish
          const hit = U.lineLine(A, U.sub(B, A), HA.wallA(w), U.sub(HA.wallB(w), HA.wallA(w)));
          if (hit && hit.t > 0.03 && hit.t < 0.97 && hit.u > -0.001 && hit.u < 1.001)
            cuts.push(hit.t * len);
        }
        cuts.sort((p, q) => p - q);
        runs.push({ a: A, dir: d, len, cuts });
      }
    };
    if (runY) {
      for (let x = minX + spacing; x < maxX; x += spacing)
        station({ x, y: minY - 2 }, { x, y: maxY + 2 });
    } else {
      for (let y = minY + spacing; y < maxY; y += spacing)
        station({ x: minX - 2, y }, { x: maxX + 2, y });
    }
    let maxSpan = 0;
    for (const r of runs) {
      const bounds = [0, ...r.cuts, r.len];
      for (let i = 0; i < bounds.length - 1; i++)
        maxSpan = Math.max(maxSpan, bounds[i + 1] - bounds[i]);
    }
    const depth = maxSpan > 144 ? 7.25 : 5.5; // 2x8 over ~12' clear spans
    return {
      loop, plate, runY, spacing, depth, runs,
      size: depth > 6 ? '2x8' : '2x6',
    };
  };

  F.ceiling = (model, levelIdx, roofData) => {
    const out = [];
    const C = ceilingCalc(model, levelIdx, roofData);
    if (!C) return out;
    const zMid = C.plate + C.depth / 2; // underside bears ON the plate top
    // rim board around the perimeter, on edge on the plates — caps the
    // joist ends and gives the rafter tails their blocking line
    const rim = C.loop.pts;
    for (let i = 0; i < rim.length; i++)
      out.push(mem(P3(rim[i], zMid), P3(rim[(i + 1) % rim.length], zMid), 1.5, C.depth, 'rim'));
    const lap = 3;                      // lapped splice over bearing walls
    for (const r of C.runs) {
      const bounds = [0, ...r.cuts, r.len];
      const perp = { x: -r.dir.y, y: r.dir.x };
      for (let i = 0; i < bounds.length - 1; i++) {
        const s0 = Math.max(0, bounds[i] - (i > 0 ? lap : 0));
        const s1 = Math.min(r.len, bounds[i + 1] + (i + 1 < bounds.length - 1 ? lap : 0));
        if (s1 - s0 < 6) continue;
        const off = i % 2 ? 1.6 : 0; // sister the lapped piece alongside
        const A = U.add(U.add(r.a, U.mul(r.dir, s0)), U.mul(perp, off));
        const B = U.add(U.add(r.a, U.mul(r.dir, s1)), U.mul(perp, off));
        out.push(mem(P3(A, zMid), P3(B, zMid), 1.5, C.depth, 'cjoist'));
      }
    }
    return out;
  };

  /* ---------------- framing metadata for plan annotation ----------------
     Per-level member callouts (size / spacing / direction) so the 2D
     annotation layer can label plans without re-deriving the framing. */
  HA.framingInfo = (model, roofData) => {
    if (roofData === undefined) {
      try { roofData = model.roof && model.roof.enabled ? HA.buildRoof(model) : null; }
      catch (e) { roofData = null; }
    }
    const nominal = (d) =>
      d <= 3.6 ? '2x4' : d <= 5.6 ? '2x6' : d <= 7.3 ? '2x8' : d <= 9.3 ? '2x10' : '2x12';
    const top = HA.roofLevelIdx(model);
    const info = {
      rafters: roofData && roofData.ok
        ? {
            size: '2x10',
            spacing: model.settings.rafterSpacing || 24,
            pitch: (model.roof.pitch || 6) + '/12',
          }
        : null,
      ceilingJoists: null,
      floorJoists: [],
      deckJoists: [],
    };
    const C = ceilingCalc(model, top, roofData);
    if (C) {
      info.ceilingJoists = {
        level: top, size: C.size, spacing: C.spacing,
        dir: C.runY ? 'y' : 'x', plate: C.plate,
      };
    }
    for (let i = 0; i < model.levels.length; i++) {
      // upper floors + the RAISED ground floor (mirrors F.floor's guard)
      const raisedGround = i === 0 && model.foundation && model.foundation.type === 'raised';
      if (i < 1 && !raisedGround) continue;
      const loop = HA.exteriorLoop(model, i);
      if (!loop) continue;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const p of loop.pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const alongX = (maxX - minX) >= (maxY - minY); // mirrors F.floor
      const span = alongX ? (maxY - minY) : (maxX - minX);
      info.floorJoists.push({
        level: i, size: nominal((model.settings.platformDepth || 12) - 0.75),
        spacing: model.settings.floorJoistSpacing || 16, dir: alongX ? 'y' : 'x',
        girder: span > 168,   // a mid-span girder is added beyond ~14'
      });
    }
    for (let i = 0; i < model.levels.length; i++) {
      for (const d of model.levels[i].decks || []) {
        const wX = d.x2 - d.x1, wY = d.y2 - d.y1;
        if (wX < 12 || wY < 12) continue; // F.deck skips these too
        const alongX = d.joistDir === 'x' ? true : d.joistDir === 'y' ? false : wX <= wY;
        info.deckJoists.push({
          deckId: d.id, level: i, size: '2x8', spacing: 16,
          dir: alongX ? 'x' : 'y',
        });
      }
    }
    return info;
  };

  /* ---------------- decks (Chief auto-deck defaults) ---------------- */
  F.deck = (model, deck, elev) => {
    const out = [];
    const x0 = deck.x1, y0 = deck.y1, x1 = deck.x2, y1 = deck.y2;
    const wX = x1 - x0, wY = y1 - y0;
    if (wX < 12 || wY < 12) return out;
    const top = elev - (deck.drop || 0);     // top of decking
    const plankT = 1, plankW = 5.5, gap = 0.5;
    const joistD = 7.25;                      // 2x8
    const joistTop = top - plankT;
    const zJoist = joistTop - joistD / 2;
    // LEDGER-AWARE direction: joists span PERPENDICULAR to the house edge the deck attaches
    // to, so the BEAM (below) can run PARALLEL to that edge at the FREE outer edge and carry
    // the joist ends. The old code keyed off the short dimension, so a deck attached along its
    // LONG edge got a beam PARALLEL to its joists on a SIDE edge and the auto-posts landed off
    // the real load line (Steve: "the auto post for longer decks shoots outside the beam").
    let _dLvl = 0;
    for (let _li = 0; _li < model.levels.length; _li++) {
      if ((model.levels[_li].decks || []).indexOf(deck) >= 0) { _dLvl = _li; break; }
    }
    const _loop = HA.exteriorLoop(model, _dLvl);
    const _nearHouse = (mx, my) => {
      if (!_loop) return false;
      for (let i = 0; i < _loop.pts.length; i++)
        if (U.distToSeg({ x: mx, y: my }, _loop.pts[i], _loop.pts[(i + 1) % _loop.pts.length]) < 10) return true;
      return false;
    };
    let _ledgerY0 = _nearHouse((x0 + x1) / 2, y0), _ledgerY1 = _nearHouse((x0 + x1) / 2, y1);
    let _ledgerX0 = _nearHouse(x0, (y0 + y1) / 2), _ledgerX1 = _nearHouse(x1, (y0 + y1) / 2);
    // EXPLICIT ledger override (deck.ledgerEdge = 'x0'|'x1'|'y0'|'y1'): the HOUSE edge.
    // A porch deck attaches to an INTERIOR house wall that isn't on the exterior loop,
    // so _nearHouse can't see it — the porch classifies the bearing edge and passes it
    // here. The beam + posts go to the OPPOSITE (free/open) edge, as always.
    if (deck.ledgerEdge) {
      _ledgerY0 = deck.ledgerEdge === 'y0'; _ledgerY1 = deck.ledgerEdge === 'y1';
      _ledgerX0 = deck.ledgerEdge === 'x0'; _ledgerX1 = deck.ledgerEdge === 'x1';
    }
    // alongX === joists parallel to X. Manual deck.joistDir wins; else perpendicular to the
    // attached (ledger) edge; else (freestanding) span the short dim.
    let alongX;
    if (deck.joistDir === 'x') alongX = true;
    else if (deck.joistDir === 'y') alongX = false;
    else if (_ledgerY0 || _ledgerY1) alongX = false;   // horizontal ledger → joists span Y
    else if (_ledgerX0 || _ledgerX1) alongX = true;    // vertical ledger → joists span X
    else alongX = wX <= wY;                            // freestanding → span the short dim
    // STRUCTURAL AUTHORITY: deck joist o.c. (was hardcoded 16) honors settings.deckJoistSpacing.
    const spacing = (model.settings && model.settings.deckJoistSpacing > 0) ? model.settings.deckJoistSpacing : 16;

    // rim
    for (const [a, b] of [
      [{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }],
      [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }],
    ]) out.push(mem(P3(a, zJoist), P3(b, zJoist), 1.5, joistD, 'rim'));

    if (alongX) {
      for (let y = y0 + spacing; y < y1 - 2; y += spacing)
        out.push(mem(P3({ x: x0 + 1.5, y }, zJoist), P3({ x: x1 - 1.5, y }, zJoist), 1.5, joistD, 'joist'));
    } else {
      for (let x = x0 + spacing; x < x1 - 2; x += spacing)
        out.push(mem(P3({ x, y: y0 + 1.5 }, zJoist), P3({ x, y: y1 - 1.5 }, zJoist), 1.5, joistD, 'joist'));
    }

    // beam 16" in from the FREE outer edge (the one OPPOSITE the ledger), PERPENDICULAR to
    // the joists so it carries their ends; posts to grade under it.
    const beamZ = joistTop - joistD - 3.75; // 4x8 beam below joists
    const BI = 16;
    const beam = alongX
      // joists span X → beam runs along Y at the free X-edge (opposite the vertical ledger)
      ? (() => { const fx = _ledgerX1 ? x0 + BI : x1 - BI; return [{ x: fx, y: y0 + 2 }, { x: fx, y: y1 - 2 }]; })()
      // joists span Y → beam runs along X at the free Y-edge (opposite the horizontal ledger)
      : (() => { const fy = _ledgerY1 ? y0 + BI : y1 - BI; return [{ x: x0 + 2, y: fy }, { x: x1 - 2, y: fy }]; })();
    out.push(mem(P3(beam[0], beamZ), P3(beam[1], beamZ), 3.5, 7.25, 'beam'));
    const bl = U.dist(beam[0], beam[1]);
    const bd = U.norm(U.sub(beam[1], beam[0]));
    const nPosts = Math.max(2, Math.ceil(bl / 96) + 1);
    // each post runs to ITS OWN grade point (R507.3) — was hardcoded z0=-8, which
    // floated posts on a drop-away and buried them uphill (AUDIT #18). Same
    // heightAtInches + gradeY + offsetIn composition as every view3d consumer.
    const _gradeY = -((model.foundation && model.foundation.stemHeight) || 8);
    const _offIn = (model.site && model.site.terrain && model.site.terrain.offsetIn) || 0;
    const _seatY = (p) => {
      if (HA.terrain && typeof HA.terrain.heightAtInches === 'function') {
        const h = HA.terrain.heightAtInches(model, p.x, p.y);
        if (h != null && isFinite(h)) return h + _gradeY + _offIn;
      }
      return _gradeY;
    };
    for (let i = 0; i < nPosts; i++) {
      const p = U.add(beam[0], U.mul(bd, (bl / (nPosts - 1)) * i));
      const z0 = Math.min(_seatY(p), beamZ - 3.66), z1 = beamZ - 3.65;
      out.push(mem(P3(p, z0), P3(p, z1), 5.5, 5.5, 'post'));
      out.push(mem(P3(p, z0 - 2), P3(p, z0 + 2), 12, 12, 'footing'));
    }

    // decking planks (perpendicular to joists)
    const step = plankW + gap;
    if (alongX) {
      for (let x = x0; x < x1; x += step) {
        const w = Math.min(plankW, x1 - x);
        out.push(mem(
          P3({ x: x + w / 2, y: y0 }, top - plankT / 2),
          P3({ x: x + w / 2, y: y1 }, top - plankT / 2), w, plankT, 'decking'));
      }
    } else {
      for (let y = y0; y < y1; y += step) {
        const w = Math.min(plankW, y1 - y);
        out.push(mem(
          P3({ x: x0, y: y + w / 2 }, top - plankT / 2),
          P3({ x: x1, y: y + w / 2 }, top - plankT / 2), w, plankT, 'decking'));
      }
    }

    // railing on edges not against the house
    if (deck.railing) {
      // test against THIS deck's own level footprint, not a hardcoded level 0,
      // so a second-floor (balcony) deck drops its railing on the right edges
      // (the house side) instead of against the ground-floor outline. Derive the
      // level from which model.levels[].decks array owns this deck; fall back to 0.
      let dLvl = 0;
      for (let li = 0; li < model.levels.length; li++) {
        if ((model.levels[li].decks || []).indexOf(deck) >= 0) { dLvl = li; break; }
      }
      const loop = HA.exteriorLoop(model, dLvl);
      const edges = [
        [{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }],
        [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }],
      ];
      for (const [a, b] of edges) {
        const mid = U.lerp(a, b, 0.5);
        if (loop) {
          let nearHouse = false;
          for (let i = 0; i < loop.pts.length; i++) {
            if (U.distToSeg(mid, loop.pts[i], loop.pts[(i + 1) % loop.pts.length]) < 8) { nearHouse = true; break; }
          }
          if (nearHouse) continue;
        }
        const len = U.dist(a, b);
        const dd = U.norm(U.sub(b, a));
        const railZ = top + 36;
        out.push(mem(P3(U.add(a, U.mul(dd, 2)), railZ - 0.75), P3(U.add(b, U.mul(dd, -2)), railZ - 0.75), 5.5, 1.5, 'rail'));
        const nP = Math.max(2, Math.ceil(len / 72) + 1);
        for (let i = 0; i < nP; i++) {
          const p = U.add(a, U.mul(dd, 2 + ((len - 4) / (nP - 1)) * i));
          out.push(mem(P3(p, top), P3(p, railZ - 1.5), 3.5, 3.5, 'railpost'));
        }
        for (let s = 6; s < len - 4; s += 5) {
          const p = U.add(a, U.mul(dd, s));
          out.push(mem(P3(p, top + 1), P3(p, railZ - 2.5), 1.5, 1.5, 'baluster'));
        }
      }
    }
    return out;
  };

  /* ---------------- braced wall panels (drafting aid) ----------------
     HA.bracewalls(model, levelIdx) -> [{wallId, x1, y1, x2, y2, len, label}]
     Panel segments ALONG the wall centerline, len in inches, label like
     'WSP 48"'. Auto-placement on EXTERIOR walls: a 48" panel at each end
     of the run (inset ~6" past corner framing), plus intermediate panels
     so adjacent panel CENTERS sit <= 25' apart. Panels land on solid wall
     between openings; a clear stretch under 48" hosts a full-stretch
     panel when >= 32" (labeled at true length), otherwise it is skipped.
     A wall carrying a manual `brace` array ([{pos,len}], pos = inches
     from wall start to panel start) uses exactly those panels instead.
     DRAFTING level only — visual + labeled, no IRC bracing math. */
  const BR = { PANEL: 48, MIN: 32, INSET: 6, CLEAR: 3, MAX_GAP: 300 };
  F.BRACE = BR;

  /* clear (solid-wall) stretches along a wall: full run inset from both
     ends, minus every opening +/- a king-stud clearance */
  const braceClear = (wall) => {
    const len = HA.wallLen(wall);
    let spans = [[BR.INSET, len - BR.INSET]];
    for (const o of wall.openings || []) {
      const a = o.pos - o.width / 2 - BR.CLEAR;
      const b = o.pos + o.width / 2 + BR.CLEAR;
      const next = [];
      for (const [s0, s1] of spans) {
        if (b <= s0 || a >= s1) { next.push([s0, s1]); continue; }
        if (a > s0) next.push([s0, a]);
        if (b < s1) next.push([b, s1]);
      }
      spans = next;
    }
    return spans.filter(([s0, s1]) => s1 - s0 >= BR.MIN);
  };
  F.braceClear = braceClear;

  /* Place braced panels so EVERY clear span is fully braced: a panel at each
     span edge (which flanks a corner or an opening) plus intermediates so
     within-span panel CENTERS stay <= MAX_GAP. The only gap that can then
     exceed MAX_GAP is a CROSS-OPENING gap — physically unbracable when the
     opening is wider than the 25' rule allows (e.g. a 16'+ garage door). Rather
     than silently emit that non-compliant spacing, we FLAG the wall (overGap):
     it needs engineered bracing / a portal frame (IRC R602.10.6.2). Returns the
     panel array with `.overGap` + `.maxGapIn` attached. */
  const autoPanels = (wall) => {
    const spans = braceClear(wall);
    const panels = [];
    panels.overGap = false; panels.maxGapIn = 0;
    if (!spans.length) return panels;
    const addPanel = (c, plen) => {
      const s = c - plen / 2, e = c + plen / 2;
      for (const p of panels) if (!(e <= p[0] + 0.5 || s >= p[1] - 0.5)) return; // skip a coincident panel
      panels.push([s, e]);
    };
    for (const sp of spans) {
      const L = sp[1] - sp[0];
      // A span up to TWO panels wide is braced by ONE continuous panel covering
      // it end-to-end (continuous-sheathing WSP): both edges are flanked, with no
      // overlap and no extra symbol. (Was: a single 48" panel at one edge — which
      // left up to ~47" of the pier, right beside an opening/corner, UNbraced on
      // any 49-95" span, since the two intended edge panels overlapped and the
      // second was dropped.)
      if (L <= 2 * BR.PANEL) { addPanel((sp[0] + sp[1]) / 2, L); continue; }
      // longer span: 48" panels at BOTH edges + evenly-spaced intermediates so
      // within-span panel CENTERS stay <= MAX_GAP.
      const plen = BR.PANEL, half = plen / 2;
      const lo = sp[0] + half, hi = sp[1] - half;
      const n = Math.max(1, Math.ceil((hi - lo) / BR.MAX_GAP));
      for (let k = 0; k <= n; k++) addPanel(lo + (hi - lo) * (k / n), plen);
    }
    panels.sort((p, q) => p[0] - q[0]);
    // the largest center-to-center gap; any excess is a cross-opening gap that
    // can't be bracketed at <= MAX_GAP -> flag for engineered bracing.
    let maxGapIn = 0;
    for (let i = 1; i < panels.length; i++) {
      const g = (panels[i][0] + panels[i][1]) / 2 - (panels[i - 1][0] + panels[i - 1][1]) / 2;
      if (g > maxGapIn) maxGapIn = g;
    }
    panels.overGap = maxGapIn > BR.MAX_GAP + 0.5;
    panels.maxGapIn = Math.round(maxGapIn);
    return panels;
  };

  HA.bracewalls = (model, levelIdx) => {
    const out = [];
    const L = model.levels && model.levels[levelIdx];
    if (!L) return out;
    for (const wall of L.walls || []) {
      const len = HA.wallLen(wall);
      if (len < BR.MIN) continue;
      // SIP walls: no WSP panels — the panel itself is the shear element, per
      // the manufacturer's ICC-ES report (braceAssess labels the line, and the
      // eng-flags add the SDC D/E engineered-design requirement).
      if ((HA.WALL_TYPES[wall.type] || {}).sip) continue;
      const manual = Array.isArray(wall.brace) && wall.brace.length > 0;
      if (!manual && !HA.isExt(wall)) continue;
      let segs;
      if (manual) {
        segs = wall.brace
          .filter((p) => p && Number.isFinite(p.pos) && Number.isFinite(p.len) &&
            p.len > 0 && p.pos >= -0.01 && p.pos + p.len <= len + 0.01)
          .map((p) => [Math.max(0, p.pos), Math.min(len, p.pos + p.len)])
          .sort((a, b) => a[0] - b[0]);
      } else {
        segs = autoPanels(wall);
      }
      // a wide opening can make <=25' panel spacing physically impossible; the
      // auto-placer flags it so we can mark those panels ENGINEERED rather than
      // imply the wall is compliantly braced (IRC R602.10.6.2 portal frame).
      const overGap = !!(segs && segs.overGap);
      const gapIn = (segs && segs.maxGapIn) || 0;
      const A = HA.wallA(wall);
      const d = HA.wallDir(wall);
      for (const [s, e] of segs) {
        const p0 = U.add(A, U.mul(d, s));
        const p1 = U.add(A, U.mul(d, e));
        const item = {
          wallId: wall.id,
          x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y,
          len: e - s,
          label: 'WSP ' + Math.round(e - s) + '"',
        };
        if (overGap) { item.overGap = true; item.gapIn = gapIn; }
        out.push(item);
      }
    }
    return out;
  };

  /* ---------------- braced wall LINE adequacy (CRC R602.10) ----------------
     HA.braceAssess(model, levelIdx) -> { lines:[{ axis, pos, lineLen,
        requiredLF, providedLF, spacingIn, ok, overGap }], ok }
     Groups the level's EXTERIOR walls into braced wall LINES — walls sharing a
     dominant axis ('x' or 'y') AND a common perpendicular offset (collinear
     within a tolerance) form one line (CRC R602.10.1.1). For each line:
       • lineLen  = plan extent of the line (end-to-end) in inches
       • providedLF = total braced-panel length on that line (from HA.bracewalls),
                      in FEET
       • requiredLF = lineLen(ft) × SDC-D bracing percentage. Sacramento is
                      Seismic Design Category D; CRC Table R602.10.3(3) gives a
                      minimum braced % of the braced-wall-line length that scales
                      with stories above. We use a CONSERVATIVE simplification
                      (BRACE_PCT below, per story carried) — a real design uses
                      the full table w/ wall-height, dead-load + method
                      adjustment factors. Honest + conservative by intent.
       • spacingIn = the widest panel center-to-center gap on the line
       • ok       = providedLF >= requiredLF AND spacing within the 25' limit
     DRAFT / prescriptive-screen only; a failing line is surfaced by
     HA.compliance.engineering() as REQUIRES ENGINEERED DESIGN (SSD). */
  const BRACE_PCT = 0.24;   // SDC D, WSP continuous-sheathing, per story carried
                            // (conservative stand-in for CRC Table R602.10.3)
  const LINE_TOL = 24;      // walls within 24" perpendicular are one line
  HA.braceAssess = (model, levelIdx) => {
    const result = { lines: [], ok: true };
    const L = model.levels && model.levels[levelIdx];
    if (!L) return result;
    // stories carried at this level = levels at or above it (roof load + floors
    // above bear on this line); a 2-story house's ground line carries 2.
    const stories = Math.max(1, (model.levels.length - levelIdx));
    // panels on this level, grouped later by their host wall's line
    const panels = (typeof HA.bracewalls === 'function') ? (HA.bracewalls(model, levelIdx) || []) : [];
    // collect exterior walls with their axis + perpendicular offset.
    // SIP walls are assessed separately below — their shear capacity is the
    // panel itself (mfr ICC-ES), not WSP percentage math.
    const allExt = (L.walls || []).filter((w) => HA.isExt(w) && HA.wallLen(w) >= BR.MIN);
    const sipWalls = allExt.filter((w) => (HA.WALL_TYPES[w.type] || {}).sip);
    const walls = allExt.filter((w) => !(HA.WALL_TYPES[w.type] || {}).sip);
    const lines = [];  // {axis, pos, walls:[], min, max}
    for (const w of walls) {
      const d = HA.wallDir(w);
      const axis = Math.abs(d.x) >= Math.abs(d.y) ? 'x' : 'y';
      // perpendicular offset of the line: the constant coord (y for an x-line)
      const pos = axis === 'x' ? (w.y1 + w.y2) / 2 : (w.x1 + w.x2) / 2;
      // the along-axis extent this wall covers
      const lo = axis === 'x' ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2);
      const hi = axis === 'x' ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
      let line = lines.find((ln) => ln.axis === axis && Math.abs(ln.pos - pos) <= LINE_TOL);
      if (!line) { line = { axis, pos, walls: [], min: lo, max: hi }; lines.push(line); }
      line.walls.push(w);
      line.min = Math.min(line.min, lo); line.max = Math.max(line.max, hi);
    }
    for (const ln of lines) {
      const wallIds = new Set(ln.walls.map((w) => w.id));
      const linePanels = panels.filter((p) => wallIds.has(p.wallId));
      const providedIn = linePanels.reduce((s, p) => s + (p.len || 0), 0);
      const lineLenIn = Math.max(0, ln.max - ln.min);
      const requiredIn = lineLenIn * BRACE_PCT * stories;
      // widest panel center-to-center gap on the line (spacing check, 25' limit)
      let spacingIn = 0;
      const overGap = linePanels.some((p) => p.overGap);
      if (linePanels.length > 1) {
        const centers = linePanels
          .map((p) => (ln.axis === 'x' ? (p.x1 + p.x2) / 2 : (p.y1 + p.y2) / 2))
          .sort((a, b) => a - b);
        for (let i = 1; i < centers.length; i++)
          spacingIn = Math.max(spacingIn, centers[i] - centers[i - 1]);
      } else {
        spacingIn = lineLenIn;  // a single panel spanning a whole line
      }
      const providedLF = Math.round((providedIn / 12) * 10) / 10;
      const requiredLF = Math.round((requiredIn / 12) * 10) / 10;
      const ok = providedIn >= requiredIn - 0.5 && spacingIn <= 300 + 0.5 && !overGap;
      if (!ok) result.ok = false;
      result.lines.push({
        axis: ln.axis, pos: Math.round(ln.pos),
        lineLen: Math.round(lineLenIn),
        requiredLF, providedLF,
        spacingIn: Math.round(spacingIn),
        stories, ok, overGap,
      });
    }
    // SIP braced-wall lines: the panels ARE the shear walls — capacity comes
    // from the manufacturer's ICC-ES report / engineered design, not the CRC
    // WSP tables, so these lines carry an honest label and never fail the WSP
    // percentage math (the SDC D/E engineered-design requirement is flagged by
    // HA.compliance.engineering as SIP-ENG).
    if (sipWalls.length) {
      const sLines = [];
      for (const w of sipWalls) {
        const dw = HA.wallDir(w);
        const axis = Math.abs(dw.x) >= Math.abs(dw.y) ? 'x' : 'y';
        const pos = axis === 'x' ? (w.y1 + w.y2) / 2 : (w.x1 + w.x2) / 2;
        const lo = axis === 'x' ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2);
        const hi = axis === 'x' ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
        let line = sLines.find((ln) => ln.axis === axis && Math.abs(ln.pos - pos) <= LINE_TOL);
        if (!line) { line = { axis, pos, min: lo, max: hi }; sLines.push(line); }
        line.min = Math.min(line.min, lo); line.max = Math.max(line.max, hi);
      }
      for (const ln of sLines) {
        result.lines.push({
          axis: ln.axis, pos: Math.round(ln.pos),
          lineLen: Math.round(Math.max(0, ln.max - ln.min)),
          requiredLF: 0, providedLF: 0,
          spacingIn: 0, stories, ok: true, overGap: false,
          sip: true, label: 'SIP SHEAR — PER MFR/ICC-ES',
        });
      }
    }
    return result;
  };

  /* every framing member — the canonical list (consumed by the material
     takeoff). The 2D/3D renderers build framing element-by-element, so this is
     NOT used for drawing; decks are included here so the BOM counts their
     PT joists/beams/posts/rim (the renderers draw decks via F.deck directly). */
  /* ---------------- STAIR CARRIAGES (IRC R311.7.3) --------------------------
     The first use of HA.stairs by the application. Until now the engine — 1931
     lines of it — was dead code: nothing in js/*.js called build/solids, and what
     rendered was a stack of tread boxes in fixtures.js. So a stair drew treads
     and a handrail while contributing NO structure: no carriages under it, and
     nothing in the lumber takeoff.

     Only the STRUCTURAL tags are taken. A stair returns 185 solids, of which 136
     are balusters — which is why wiring the whole thing looked expensive and was
     deferred. Framing needs 5 of them: the stringers and the skirt. The finish
     parts stay with the fixture renderer where they belong.

     Stringers come back RAKED: a centre point plus `rot` (yaw) and `tilt` (pitch),
     matching the raked() builder in stairs.js. mem() wants two endpoints, so the
     centre is expanded back along the rake:
         L  = d·cos(tilt)          horizontal run of the member
         dx = −sin(rot)·L ,  dy = cos(rot)·L        (raked(): rot = −atan2(dx,dy))
         dz = −tan(tilt)·L                          (raked(): tilt = −atan2(dz,L))
     Everything is derived from the engine's own convention rather than guessed. */
  const STAIR_STRUCTURAL = ['stringer', 'skirt', 'landing_frame'];
  F.stairs = (model, levelIdx) => {
    const out = [];
    if (!HA.stairs || typeof HA.stairs.build !== 'function') return out;   // engine absent -> no framing, never a throw
    const lvl = (model.levels || [])[levelIdx];
    if (!lvl) return out;
    const elev = HA.levelElev(model, levelIdx);
    for (const f of lvl.fixtures || []) {
      if (f.type !== 'stairs') continue;
      const floorToFloor = (lvl.height || 96)
        + (levelIdx + 1 < model.levels.length ? (model.settings.platformDepth || 12) : 0);
      /* CARRIAGES MUST MATCH THE STAIR YOU CAN SEE.

         R88 handed build() only the rise and let it solve its own run, but the
         rendered stair comes from HA.stairLayout, which fits the flight to the
         drawn footprint f.d. The two solvers disagreed: measured on a 132" box
         the treads spanned 132" while the carriages came back 160" — 28" of
         stringer hanging past the last tread, and a takeoff cutting stringers
         to a length no tread sits on.

         Feeding the layout's own tread depth and riser height back in pins the
         engine to the drawn stair. targetRiser drives the riser COUNT
         (risers = round(ftf / target)), so passing lay.riser reproduces
         lay.treads + 1 exactly; treadDepth then reproduces the run. Both stay
         subject to the engine's code floors, so an illegally shallow stair
         still frames legally rather than framing something unbuildable — and
         the drag clamp (HA.stairMinDepth) is what keeps you out of that state. */
      let built = null;
      try {
        const lay = HA.stairLayout ? HA.stairLayout(f, floorToFloor) : null;
        built = HA.stairs.build(Object.assign({
          floorToFloor, widthIn: f.w,
          anchor: { x: f.x, y: f.y, rot: f.rot || 0, d: f.d },
        }, lay ? { treadDepth: lay.treadD, targetRiser: lay.riser } : {}));
      } catch (e) { built = null; }                 // a stair that cannot be solved frames nothing
      for (const s of (built && built.solids) || []) {
        if (!STAIR_STRUCTURAL.includes(s.stair)) continue;
        const rot = ((s.rot || 0) * Math.PI) / 180;
        const tilt = ((s.tilt || 0) * Math.PI) / 180;
        const L = (s.d || 0) * Math.cos(tilt);
        const dx = -Math.sin(rot) * L, dy = Math.cos(rot) * L, dz = -Math.tan(tilt) * L;
        const zc = elev + (s.z || 0);
        out.push(mem(
          { x: s.x - dx / 2, y: s.y - dy / 2, z: zc - dz / 2 },
          { x: s.x + dx / 2, y: s.y + dy / 2, z: zc + dz / 2 },
          s.w || 1.5, s.h || 9.25,
          s.stair === 'stringer' ? 'stringer' : s.stair,
        ));
      }
    }
    return out;
  };

  F.all = (model, roofData) => {
    const out = [];
    for (let i = 0; i < model.levels.length; i++) {
      const elev = HA.levelElev(model, i);
      for (const w of model.levels[i].walls) out.push(...F.wall(model, w, elev));
      // level 0 included too: F.floor self-guards a slab ground floor to [] and a
      // RAISED foundation's platform (PT mudsill/rim/joists/girder/anchors) is often
      // the biggest lumber package on the job — it was drawn but never billed (AUDIT #1).
      out.push(...F.floor(model, i));
      for (const d of (model.levels[i].decks || [])) out.push(...F.deck(model, d, elev));
      // WOOD-FRAMED porch floors (slab-floored porches pour with the house slab → no lumber)
      for (const pc of (model.levels[i]._porches || [])) out.push(...F.porchFloor(model, pc, i, elev));
      // STRUCTURAL AUTHORITY: user-placed hold-down hardware (uplift/shear).
      out.push(...F.holddownMembers(model, i));
      // stair carriages — billed here so the takeoff finally counts them; a stair
      // drew treads but contributed no lumber at all before this.
      out.push(...F.stairs(model, i));
    }
    out.push(...F.ceiling(model, HA.roofLevelIdx(model), roofData));
    out.push(...F.roof(model, roofData));
    return out;
  };

  /* ---- STRUCTURAL AUTHORITY: hold-down schedule rows (S1.0 / BOM) ----
     Groups user-placed hold-downs by model number for a hardware-schedule line
     and the S1.0 callouts. DRAFT count — the engineer sets the real device. */
  HA.userHoldDowns = (model) => {
    const by = {};
    for (const L of (model.levels || []))
      for (const h of (L.holddowns || [])) {
        const k = h.model || 'HDU (typ.)';
        by[k] = (by[k] || 0) + 1;
      }
    return Object.keys(by).map((k) => ({ type: k + ' — placed', model: k, qty: by[k] }));
  };
})();
