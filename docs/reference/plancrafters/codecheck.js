/* ============================================================
   codecheck.js — HA.codecheck  (LIFE-SAFETY / CODE CHECKER)
   A "surprise" feature: a pure, read-only sweep of the model
   against the IRC residential life-safety basics, returning a
   structured issue list. Callers render it (sheet note, panel,
   chat). NOTHING here mutates the model or touches the DOM.

   check(model) -> { issues:[{code, severity, where, msg, ...}],
                     pass, fail, warn, summary, draft }

   Every value here is DRAFT / preliminary [STAMP] — a code
   sweep, NOT a plan-check. A licensed designer / building
   official has the final word. Each issue cites its IRC
   section so Steve can defend it on the phone.

   Code sections implemented (2021 IRC, mirrors CRC ch.3):
     R310  Emergency escape & rescue opening (egress window):
           net clear >= 5.7 sf (>= 5.0 sf at grade-floor), min
           clear H 24", min clear W 20", sill <= 44" AFF.
           https://codes.iccsafe.org/s/IRC2021P2 R310.2.1
     R305  Min ceiling height 7'-0" (84") for habitable space,
           halls, baths.  R305.1
     R303  Natural light: aggregate glazing >= 8% of floor area;
           natural ventilation openable >= 4% of floor area, per
           habitable room.  R303.1
     R311  Means of egress: hall width >= 36"; egress door >= 32"
           clear (>=36" leaf rule-of-thumb); interior door widths.
           R311.6 (hall), R311.2 (egress door)
     R314  Smoke alarms: each sleeping room, outside each sleeping
           area, each story.  R314.3
     R315  Carbon-monoxide alarms: outside each sleeping area in
           the immediate vicinity of bedrooms (+ in a bedroom with
           a fuel-burning appliance).  R315.3
     R306  Sanitation: every dwelling needs a water closet, a
           lavatory, a tub or shower, and a kitchen sink.  R306.1/2
     R307  Toilet clearances: >= 15" centerline to any side wall
           or fixture; >= 21" clear in front of the bowl.  R307.1
     R308  Safety glazing: glazing whose bottom edge is < 60" above
           the floor within 60" horizontally of a tub/shower
           standing surface must be tempered.  R308.4.5
     R311.7 Stairways: >= 36" clear width (R311.7.1), risers
           <= 7-3/4" (R311.7.5.1), treads >= 10" (R311.7.5.2).
   Sources: iccsafe.org/IRC2021P2, up.codes/s/* (see comments).
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;
  const U = HA.U;

  /* ---- thresholds (inches / square-feet, IRC 2021) ---- */
  const EGRESS_MIN_SF = 5.7;        // R310.2.1 net clear opening
  const EGRESS_GRADE_SF = 5.0;      // R310.2.1 exception — grade-floor
  const EGRESS_MIN_H = 24;          // R310.2.1 min clear opening height
  const EGRESS_MIN_W = 20;          // R310.2.1 min clear opening width
  const EGRESS_MAX_SILL = 44;       // R310.2.2 sill <= 44" AFF
  const CEIL_MIN = 84;              // R305.1  7'-0"
  const LIGHT_PCT = 0.08;           // R303.1  glazing >= 8% floor area
  const VENT_PCT = 0.04;            // R303.1  openable >= 4% floor area
  const HALL_MIN = 36;              // R311.6  hallway >= 3'-0"
  const DOOR_EGRESS_CLEAR = 32;     // R311.2  >= 32" clear at the door
  const DOOR_EGRESS_LEAF = 36;      // a 36" leaf yields the 32" clear
  const BED_REACH = 168;            // 14' — a bed's window/alarm "within reach"
  const WC_SIDE_MIN = 15;           // R307.1 toilet centerline to side wall/fixture
  const WC_FRONT_MIN = 21;          // R307.1 clear in front of the bowl
  const GLAZE_TUB_ZONE = 60;        // R308.4.5 within 60" of a tub/shower, glass < 60" AFF
  const STAIR_MIN_W = 36;           // R311.7.1 min clear stair width
  const RISER_MAX = 7.75;           // R311.7.5.1 max riser
  const TREAD_MIN = 10;             // R311.7.5.2 min tread depth

  /* net clear opening of a window, in square feet. Same rule-of-thumb
     HA.schedules uses to flag 'EGRESS OK': the rough frame loses ~2" per
     jamb and ~3.5" at head+sill to the operable sash, so net clear is
     (w-4)(h-7)/144. Conservative vs. the catalog clear, which is fine for
     a pre-check. */
  const netClearSf = (o) =>
    Math.max(0, (o.width - 4)) * Math.max(0, ((o.height || 0) - 7)) / 144;
  const netClearH = (o) => Math.max(0, (o.height || 0) - 7);
  const netClearW = (o) => Math.max(0, (o.width || 0) - 4);

  const isExtWall = (w) =>
    HA.isExt ? HA.isExt(w) : !!((HA.WALL_TYPES || {})[w.type] || {}).ext;
  const isBed = (f) => f && typeof f.type === 'string' && /^bed_/.test(f.type);
  const isBathFx = (f) => f && ['toilet', 'tub', 'shower', 'pedestal_sink', 'corner_shower', 'tub_shower_combo'].includes(f.type);
  const isTubShower = (f) => f && ['tub', 'shower', 'corner_shower', 'tub_shower_combo', 'glass_shower', 'bathtub'].includes(f.type);
  const isLav = (f) => f && ['vanity', 'pedestal_sink'].includes(f.type);
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const r2 = (v) => Math.round(v * 100) / 100;

  /* fixture footprint as an axis-aligned box (matches validate_design) */
  const fxBox = (f) => {
    const def = (HA.FIXTURES || {})[f.type] || {};
    const w = f.w || def.w || 24, d = f.d || def.d || 24;
    const rot = ((f.rot || 0) % 360 + 360) % 360;
    const [bw, bd] = (rot === 90 || rot === 270) ? [d, w] : [w, d];
    return { x0: f.x - bw / 2, y0: f.y - bd / 2, x1: f.x + bw / 2, y1: f.y + bd / 2 };
  };

  /* ray → wall-segment clear distance: distance from p along unit dir u to
     the CENTERLINE of wall w, minus half the wall thickness (face proxy).
     Infinity when the ray misses the segment. */
  const rayWallDist = (p, u, w) => {
    const ex = w.x2 - w.x1, ey = w.y2 - w.y1;
    const den = u.x * ey - u.y * ex;
    if (Math.abs(den) < 1e-9) return Infinity;              // parallel
    const dx = w.x1 - p.x, dy = w.y1 - p.y;
    const t = (dx * ey - dy * ex) / den;                    // along the ray
    const s = (dx * u.y - dy * u.x) / den;                  // along the wall 0..1
    if (t < 0 || s < -1e-9 || s > 1 + 1e-9) return Infinity;
    return Math.max(0, t - (HA.wallT ? HA.wallT(w) : 4.5) / 2);
  };

  /* ray → axis-aligned box entry distance (slab test); Infinity on miss.
     Rays starting inside the box return 0. */
  const rayBoxDist = (p, u, b) => {
    let lo = -Infinity, hi = Infinity;
    for (const [pc, uc, mn, mx] of [[p.x, u.x, b.x0, b.x1], [p.y, u.y, b.y0, b.y1]]) {
      if (Math.abs(uc) < 1e-9) { if (pc < mn || pc > mx) return Infinity; continue; }
      const t1 = (mn - pc) / uc, t2 = (mx - pc) / uc;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    }
    if (hi < lo || hi < 0) return Infinity;
    return Math.max(0, lo);
  };

  /* nearest obstruction (wall face or another fixture's box) from point p
     along unit dir u on level L, ignoring fixture ids in `skip`. */
  const clearDist = (L, p, u, skip) => {
    let best = Infinity;
    for (const w of (L.walls || [])) best = Math.min(best, rayWallDist(p, u, w));
    for (const f of (L.fixtures || [])) {
      if (!f || skip.has(f.id) || f.type === 'room_label' || f.type === 'stairs') continue;
      best = Math.min(best, rayBoxDist(p, u, fxBox(f)));
    }
    return best;
  };

  /* horizontal distance from a point to a fixture's box edge (0 if inside) */
  const distToBox = (p, b) => {
    const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
    const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
    return Math.hypot(dx, dy);
  };

  /* world-space center of an opening on its wall */
  const openingCenter = (w, o) => {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy) || 1;
    return { x: w.x1 + (dx / len) * o.pos, y: w.y1 + (dy / len) * o.pos };
  };

  /* closed-exterior-loop area for a level, in square feet (0 if open).
     This is the level FOOTPRINT — our floor-area proxy when we lack true
     per-room polygons (PlanCrafters has no room-decomposition helper). */
  const levelFootprintSf = (model, li) => {
    const loop = HA.exteriorLoop ? HA.exteriorLoop(model, li) : null;
    if (!loop || !loop.pts || loop.pts.length < 3) return 0;
    const a = (U && U.polyArea) ? Math.abs(U.polyArea(loop.pts)) : shoelace(loop.pts);
    return a / 144;
  };
  const shoelace = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a / 2);
  };

  /* all window openings on a level, with their world center + a "grade"
     flag (level 0 == grade floor for the R310 5.0 sf exception). */
  const levelWindows = (model, li) => {
    const L = model.levels[li];
    const out = [];
    for (const w of (L.walls || [])) {
      for (const o of (w.openings || [])) {
        if (o.kind !== 'window') continue;
        out.push({ wall: w, o, c: openingCenter(w, o), ext: isExtWall(w) });
      }
    }
    return out;
  };

  /* is window `o` an R310 emergency-escape opening?  (grade floor relaxes
     the area floor to 5.0 sf). Width/height/sill all gate independently so
     we can report WHICH dimension fails. */
  const egressEval = (o, grade) => {
    const sf = netClearSf(o);
    const minSf = grade ? EGRESS_GRADE_SF : EGRESS_MIN_SF;
    return {
      sf: r2(sf), minSf,
      h: r2(netClearH(o)), w: r2(netClearW(o)), sill: o.sill == null ? null : o.sill,
      okArea: sf >= minSf - 1e-6,
      okH: netClearH(o) >= EGRESS_MIN_H - 1e-6,
      okW: netClearW(o) >= EGRESS_MIN_W - 1e-6,
      okSill: o.sill == null || o.sill <= EGRESS_MAX_SILL + 1e-6,
    };
  };
  const egressPasses = (e) => e.okArea && e.okH && e.okW && e.okSill;

  /* ============================================================
     check(model) — the whole sweep. Pure; returns plain data.
     ============================================================ */
  HA.codecheck = {
    EGRESS_MIN_SF, EGRESS_GRADE_SF, EGRESS_MIN_H, EGRESS_MIN_W, EGRESS_MAX_SILL,
    CEIL_MIN, LIGHT_PCT, VENT_PCT, HALL_MIN, DOOR_EGRESS_CLEAR,
    WC_SIDE_MIN, WC_FRONT_MIN, GLAZE_TUB_ZONE, STAIR_MIN_W, RISER_MAX, TREAD_MIN,

    netClearSf, egressEval, levelFootprintSf,

    check(model) {
      const issues = [];
      const add = (code, severity, where, msg, extra) =>
        issues.push(Object.assign({ code, severity, where, msg }, extra || {}));

      if (!model || !Array.isArray(model.levels) || !model.levels.length) {
        add('MODEL', 'fail', 'model', 'No levels in the model — nothing to check.');
        return finalize(issues);
      }

      model.levels.forEach((L, li) => {
        const where = `level ${li}${L && L.name ? ' (' + L.name + ')' : ''}`;
        const fx = (L.fixtures || []).filter((f) => f.type !== 'room_label');
        const beds = fx.filter(isBed);
        const wins = levelWindows(model, li);
        const grade = li === 0; // grade floor → R310 grade-floor area exception
        const closed = !!(HA.exteriorLoop && HA.exteriorLoop(model, li));
        const hasHabitable = closed || beds.length > 0 || fx.length > 0;

        /* ---------- R310 — bedroom emergency escape windows ----------
           Each sleeping room needs an egress-sized openable within reach.
           We can't decompose rooms, so we tie egress to each BED fixture:
           find the closest egress-qualifying window; report the nearest
           candidate's failing dimension when none qualifies. */
        const egressWins = wins.filter((wn) => wn.ext);
        beds.forEach((bed, bi) => {
          const cands = egressWins
            .map((wn) => ({ wn, d: U.dist(wn.c, { x: bed.x, y: bed.y }), e: egressEval(wn.o, grade) }))
            .sort((a, b) => a.d - b.d);
          const inReach = cands.filter((c) => c.d <= BED_REACH);
          const good = inReach.find((c) => egressPasses(c.e));
          const label = `${where} · ${bed.type} #${bi + 1}`;
          if (good) {
            // pass — record an info so the report shows coverage
            add('R310', 'pass', label,
              `Egress OK — net clear ${good.e.sf} sf, ${good.e.w}"W × ${good.e.h}"H, sill ${good.e.sill == null ? '?' : good.e.sill}".`,
              { sf: good.e.sf });
          } else if (inReach.length) {
            // a window is near the bed but undersized — say which dim fails
            const best = inReach.sort((a, b) => b.e.sf - a.e.sf)[0].e;
            const bad = [];
            if (!best.okArea) bad.push(`net clear ${best.sf} sf < ${best.minSf} sf`);
            if (!best.okH) bad.push(`clear H ${best.h}" < ${EGRESS_MIN_H}"`);
            if (!best.okW) bad.push(`clear W ${best.w}" < ${EGRESS_MIN_W}"`);
            if (!best.okSill) bad.push(`sill ${best.sill}" > ${EGRESS_MAX_SILL}"`);
            add('R310', 'fail', label,
              `Bedroom egress window undersized: ${bad.join(', ')} (IRC R310.2.1).`,
              { detail: best });
          } else {
            add('R310', 'fail', label,
              `No emergency escape window within ${Math.round(BED_REACH / 12)}' of this bed — every sleeping room needs one (≥${grade ? EGRESS_GRADE_SF : EGRESS_MIN_SF} sf net clear, ≥${EGRESS_MIN_H}"H, ≥${EGRESS_MIN_W}"W, sill ≤${EGRESS_MAX_SILL}") per IRC R310.`);
          }
        });

        /* ---------- R305 — minimum ceiling height ----------
           Habitable level wall height must be >= 84". We read the level
           height (the wall plate height) as the ceiling proxy. */
        if (hasHabitable) {
          const h = L.height || (model.settings && model.settings.wallHeight) || 0;
          if (h < CEIL_MIN - 1e-6)
            add('R305', 'fail', where,
              `Ceiling height ${Math.round(h)}" is under the ${CEIL_MIN}" (7'-0") minimum for habitable space (IRC R305.1).`,
              { height: h });
          else
            add('R305', 'pass', where, `Ceiling height ${Math.round(h)}" ≥ ${CEIL_MIN}" min (IRC R305.1).`);
        }

        /* ---------- R303 — natural light + ventilation ----------
           Aggregate glazing >= 8% of floor area; openable >= 4%. We lack
           per-room polygons, so we check this at the LEVEL footprint
           level: total window glass vs. level floor area. Honest note:
           this is a whole-level proxy, not per-room.  R303.1 */
        const floorSf = levelFootprintSf(model, li);
        if (floorSf > 0 && (beds.length > 0 || fx.length > 0)) {
          let glassSf = 0, openableSf = 0;
          for (const wn of wins) {
            if (!wn.ext) continue;
            const gsf = (wn.o.width * (wn.o.height || 0)) / 144;
            glassSf += gsf;
            // single/double-hung & sliders are ~50% openable; assume 50%
            // operable unless a fixed flag says otherwise. Conservative.
            openableSf += wn.o.fixed ? 0 : gsf * 0.5;
          }
          const needLight = floorSf * LIGHT_PCT;
          const needVent = floorSf * VENT_PCT;
          if (glassSf < needLight - 1e-6)
            add('R303', 'warn', where,
              `Natural light low: ${r2(glassSf)} sf glazing < ${r2(needLight)} sf (8% of ${r2(floorSf)} sf floor). Whole-level proxy — verify per habitable room (IRC R303.1).`,
              { glassSf: r2(glassSf), needLight: r2(needLight), floorSf: r2(floorSf) });
          else
            add('R303', 'pass', where,
              `Natural light OK: ${r2(glassSf)} sf glazing ≥ 8% of ${r2(floorSf)} sf (IRC R303.1).`);
          if (openableSf < needVent - 1e-6)
            add('R303', 'warn', where,
              `Natural ventilation low: ${r2(openableSf)} sf openable < ${r2(needVent)} sf (4% of ${r2(floorSf)} sf). Whole-level proxy; a whole-house mech-vent system is an R303.1 alternative (verify per room).`,
              { openableSf: r2(openableSf), needVent: r2(needVent), floorSf: r2(floorSf) });
          else
            add('R303', 'pass', where,
              `Ventilation OK: ${r2(openableSf)} sf openable ≥ 4% of ${r2(floorSf)} sf (IRC R303.1).`);
        }

        /* ---------- R311 — hallway width + door widths ----------
           Hall corridor walls: PlanCrafters has no room graph, so we proxy
           hall width by the closest spacing between facing interior wall
           pairs. We check door leaf widths directly (the load-bearing R311
           item we CAN measure): the main entry & egress doors. */
        // door widths — bathroom doors handled below; here, flag any
        // egress/interior door narrower than its rule-of-thumb leaf.
        for (const w of (L.walls || [])) {
          for (const o of (w.openings || [])) {
            if (o.kind !== 'door') continue;
            // entry/exterior egress door: need a 36" leaf (32" clear). R311.2
            if (isExtWall(w) && o.width < DOOR_EGRESS_LEAF - 1e-6 && (o.doorType || 'hinged') === 'hinged')
              add('R311', 'warn', where,
                `Exterior door is ${Math.round(o.width)}" — a primary egress door should be ≥ ${DOOR_EGRESS_LEAF}" leaf to give the ${DOOR_EGRESS_CLEAR}" clear width (IRC R311.2).`,
                { width: o.width });
          }
        }
        // hallway proxy: narrowest gap between parallel interior walls that
        // face each other. Pure geometry — flag any < 36" clear corridor.
        const hall = narrowestCorridor(L);
        if (hall && hall.clear < HALL_MIN - 1e-6)
          add('R311', 'warn', where,
            `Possible hallway only ${Math.round(hall.clear)}" clear — corridors serving habitable rooms should be ≥ ${HALL_MIN}" (IRC R311.6). Verify; auto-detected from facing interior walls.`,
            { clear: r2(hall.clear) });

        /* ---------- bathroom door width (R311 family) ----------
           Each bathroom door should be >= 30" (2'-6"). Tie a door to a
           bathroom by proximity to a bath fixture. */
        const baths = fx.filter(isBathFx);
        if (baths.length) {
          for (const w of (L.walls || [])) {
            for (const o of (w.openings || [])) {
              if (o.kind !== 'door') continue;
              const c = openingCenter(w, o);
              const serves = baths.some((b) => U.dist(c, { x: b.x, y: b.y }) <= 84);
              if (serves && o.width < 30 - 1e-6)
                add('R311', 'warn', `${where} · bathroom door`,
                  `Bathroom door is ${Math.round(o.width)}" — bathroom doors should be ≥ 2'-6" (30") clear (IRC R311.2 family).`,
                  { width: o.width });
            }
          }
        }

        /* ---------- R307 — toilet clearances ----------
           Direct geometric measurement per toilet: centerline must sit
           >= 15" from any side wall/fixture; >= 21" clear in front of the
           bowl. Front = local +d (the tank sits at -d in the 3D build);
           sides = local ±w. Ray-cast against wall faces + fixture boxes.
           R307.1 (fig. R307.1). */
        const toilets = fx.filter((f) => f.type === 'toilet');
        toilets.forEach((t, ti) => {
          const rot = ((t.rot || 0) % 360 + 360) % 360;
          const ar = rot * Math.PI / 180, ca = Math.cos(ar), sa = Math.sin(ar);
          const front = { x: -sa, y: ca };                 // local +d
          const skip = new Set([t.id]);
          const c = { x: t.x, y: t.y };
          const sideR = clearDist(L, c, { x: ca, y: sa }, skip);
          const sideL = clearDist(L, c, { x: -ca, y: -sa }, skip);
          const halfD = (t.d || 28) / 2;
          const bowlFront = { x: t.x + front.x * halfD, y: t.y + front.y * halfD };
          const frontClear = clearDist(L, bowlFront, front, skip);
          const label = `${where} · toilet #${ti + 1}`;
          const side = Math.min(sideR, sideL);
          const bad = [];
          if (side < WC_SIDE_MIN - 1e-6)
            bad.push(`${r2(side)}" centerline-to-side < ${WC_SIDE_MIN}"`);
          if (frontClear < WC_FRONT_MIN - 1e-6)
            bad.push(`${r2(frontClear)}" in front of the bowl < ${WC_FRONT_MIN}"`);
          if (bad.length)
            add('R307', 'fail', label,
              `Toilet clearance short: ${bad.join(', ')} — IRC R307.1 requires ≥ ${WC_SIDE_MIN}" from centerline to side walls/fixtures and ≥ ${WC_FRONT_MIN}" clear in front.`,
              { side: r2(side), front: r2(frontClear) });
          else
            add('R307', 'pass', label,
              `Toilet clearances OK — ${side === Infinity ? 'open' : r2(side) + '"'} side, ${frontClear === Infinity ? 'open' : r2(frontClear) + '"'} front (IRC R307.1).`);
        });

        /* ---------- R308 — safety glazing at tubs / showers ----------
           Any window whose glass starts < 60" above the floor within 60"
           (horizontal) of a tub/shower standing surface needs tempered
           glazing. We can't read the glazing spec, so WARN to verify.
           R308.4.5. */
        const wetFx = fx.filter(isTubShower);
        if (wetFx.length) {
          for (const wn of wins) {
            const sill = wn.o.sill == null ? 0 : wn.o.sill;   // unknown sill → assume low
            if (sill >= GLAZE_TUB_ZONE - 1e-6) continue;      // glass starts above the zone
            const nearWet = wetFx.find((f) => distToBox(wn.c, fxBox(f)) <= GLAZE_TUB_ZONE + 1e-6);
            if (nearWet)
              add('R308', 'warn', `${where} · window near ${nearWet.type}`,
                `Window (sill ${r2(sill)}") sits within ${GLAZE_TUB_ZONE}" of a ${nearWet.type.replace(/_/g, ' ')} — glazing below 60" AFF here must be SAFETY (tempered) glazing per IRC R308.4.5. Verify the glazing spec.`,
                { sill: r2(sill) });
          }
        }

        /* ---------- R311.7 — stair geometry ----------
           Real measurement off the shared stair solver (HA.stairLayout —
           the same math the 3D build + 2D symbol use): clear width >= 36",
           risers <= 7-3/4", treads >= 10". Rise = this level's plate height
           + the platform (floor-pack) depth, the model's floor-to-floor. */
        const stairFx = (L.fixtures || []).filter((f) => f.type === 'stairs');
        if (stairFx.length && li < model.levels.length - 1 && HA.stairLayout) {
          const rise = (L.height || (model.settings && model.settings.wallHeight) || 96) +
            ((model.settings && model.settings.platformDepth) || 13);
          stairFx.forEach((f, si) => {
            const lay = HA.stairLayout(f, rise);
            const label = `${where} · stair #${si + 1}`;
            const bad = [];
            if ((f.w || 0) < STAIR_MIN_W - 1e-6)
              bad.push(`width ${r2(f.w || 0)}" < ${STAIR_MIN_W}" (R311.7.1)`);
            if (lay.riser > RISER_MAX + 1e-6)
              bad.push(`riser ${r2(lay.riser)}" > ${RISER_MAX}" (R311.7.5.1)`);
            if (lay.treadD < TREAD_MIN - 1e-6)
              bad.push(`tread ${r2(lay.treadD)}" < ${TREAD_MIN}" — stretch the flight (R311.7.5.2)`);
            if (bad.length)
              add('R311', 'fail', label,
                `Stair out of code: ${bad.join('; ')} — IRC R311.7 over a ${r2(rise)}" floor-to-floor rise (${lay.treads + 1} risers).`,
                { riser: r2(lay.riser), tread: r2(lay.treadD), width: r2(f.w || 0) });
            else
              add('R311', 'pass', label,
                `Stair OK — ${r2(f.w || 0)}" wide, ${lay.treads + 1} risers @ ${r2(lay.riser)}", ${r2(lay.treadD)}" treads (IRC R311.7).`);
          });
        }

        /* ---------- R314 — smoke alarms ----------
           Required IN each sleeping room, OUTSIDE each sleeping area, and
           on EACH story. We model alarms as the 'smoke' electrical device
           (free-placed at x,y). Check: at least one per story, plus one
           within reach of each bed (the in-room requirement). R314.3 */
        const alarms = (L.electrical || []).filter((e) => e.type === 'smoke' && num(e.x) && num(e.y));
        if (hasHabitable) {
          if (!alarms.length)
            add('R314', 'fail', where,
              `No smoke alarm on this story — IRC R314.3 requires a smoke alarm on each story (and in/outside sleeping areas).`);
          else
            add('R314', 'pass', where,
              `${alarms.length} smoke/CO alarm device(s) on this story (IRC R314.3).`);
          // in-room: each bed should have an alarm within reach
          beds.forEach((bed, bi) => {
            const near = alarms.some((a) => U.dist({ x: a.x, y: a.y }, { x: bed.x, y: bed.y }) <= BED_REACH);
            if (!near)
              add('R314', 'fail', `${where} · ${bed.type} #${bi + 1}`,
                `No smoke alarm within ${Math.round(BED_REACH / 12)}' of this sleeping room — a smoke alarm is required IN each sleeping room (IRC R314.3).`);
          });
        }

        /* ---------- R315 — carbon-monoxide alarms ----------
           Required outside each sleeping area in the immediate vicinity of
           the bedrooms. PlanCrafters' 'smoke' device is a COMBO smoke/CO
           ("Smoke / CO alarm" in HA.ELECTRICAL), so one device satisfies
           both — but only where there ARE bedrooms. Warn (not fail) when a
           level has beds but the placement can't be confirmed near the
           sleeping area corridor. R315.3 */
        if (beds.length) {
          if (!alarms.length)
            add('R315', 'fail', where,
              `No CO alarm on a level with sleeping rooms — IRC R315.3 requires a CO alarm outside each sleeping area (combo smoke/CO device counts).`);
          else {
            // at least one alarm reasonably "outside but near" the cluster of
            // beds (within reach of a bed but not on top of it). Soft check.
            const bedCentroid = centroid(beds.map((b) => ({ x: b.x, y: b.y })));
            const nearCluster = alarms.some((a) => U.dist({ x: a.x, y: a.y }, bedCentroid) <= BED_REACH * 1.5);
            if (!nearCluster)
              add('R315', 'warn', where,
                `Confirm a CO alarm sits in the corridor outside the bedrooms (immediate vicinity) per IRC R315.3 — nearest device is far from the sleeping cluster.`);
            else
              add('R315', 'pass', where,
                `CO coverage present near the sleeping area (combo smoke/CO device, IRC R315.3).`);
          }
        }
      });

      /* ---------- R306 — required sanitation fixtures ----------
         Dwelling-wide completeness: a water closet, a lavatory, a tub OR
         shower (R306.1) and a kitchen sink (R306.2). Checked across ALL
         levels; skipped on bare shells with no fixtures at all (nothing
         placed yet ≠ a sanitation finding). WARN, not fail — the model
         may be one building of several or still in progress. */
      const allFx = model.levels.flatMap((L) => (L.fixtures || []).filter((f) => f && f.type !== 'room_label'));
      if (allFx.length) {
        const missing = [];
        if (!allFx.some((f) => f.type === 'toilet')) missing.push('water closet (toilet) — R306.1');
        if (!allFx.some(isLav)) missing.push('lavatory (vanity/pedestal sink) — R306.1');
        if (!allFx.some(isTubShower)) missing.push('bathtub or shower — R306.1');
        if (!allFx.some((f) => f.type === 'kitchen_sink')) missing.push('kitchen sink — R306.2');
        if (missing.length)
          add('R306', 'warn', 'dwelling',
            `Sanitation fixtures missing: ${missing.join('; ')}. Every dwelling unit needs all four per IRC R306.1/R306.2.`,
            { missing });
        else
          add('R306', 'pass', 'dwelling',
            'Sanitation complete — water closet, lavatory, tub/shower and kitchen sink all present (IRC R306).');
      }

      return finalize(issues);
    },
  };

  /* narrowest facing interior-wall corridor on a level. Returns the
     smallest clear gap between two parallel, overlapping interior walls,
     measuring face-to-face (gap minus half each wall thickness). Coarse
     hall proxy; null if none found. Pure geometry, O(n^2) over interior
     walls (small n on a residential plan). */
  function narrowestCorridor(L) {
    const walls = (L.walls || []).filter((w) => !isExtWall(w) && HA.wallLen && HA.wallLen(w) > 12);
    let best = null;
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i], b = walls[j];
        const da = dir(a), db = dir(b);
        // parallel?
        if (Math.abs(da.x * db.y - da.y * db.x) > 0.05) continue;
        // perpendicular center-to-center distance along a's normal
        const n = { x: -da.y, y: da.x };
        const ca = { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 };
        const cb = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
        const sep = Math.abs((cb.x - ca.x) * n.x + (cb.y - ca.y) * n.y);
        if (sep < 1 || sep > 96) continue; // ignore coincident & non-corridor gaps (>8')
        // do they overlap along their shared direction? project endpoints
        const t = (p) => (p.x - ca.x) * da.x + (p.y - ca.y) * da.y;
        const aLo = Math.min(t({ x: a.x1, y: a.y1 }), t({ x: a.x2, y: a.y2 }));
        const aHi = Math.max(t({ x: a.x1, y: a.y1 }), t({ x: a.x2, y: a.y2 }));
        const bLo = Math.min(t({ x: b.x1, y: b.y1 }), t({ x: b.x2, y: b.y2 }));
        const bHi = Math.max(t({ x: b.x1, y: b.y1 }), t({ x: b.x2, y: b.y2 }));
        const overlap = Math.min(aHi, bHi) - Math.max(aLo, bLo);
        if (overlap < 24) continue; // need >=2' of facing run to be a corridor
        const ta = (HA.wallT ? HA.wallT(a) : 4.5) / 2;
        const tb = (HA.wallT ? HA.wallT(b) : 4.5) / 2;
        const clear = sep - ta - tb;
        if (clear > 0 && (!best || clear < best.clear)) best = { clear, a, b };
      }
    }
    return best;
  }
  const dir = (w) => {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };
  const centroid = (pts) => {
    if (!pts.length) return { x: 0, y: 0 };
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  };

  /* roll the issue list into a pass/fail summary. `pass` is true only when
     there are ZERO fail-severity issues (warnings don't fail the sweep). */
  function finalize(issues) {
    const fail = issues.filter((i) => i.severity === 'fail').length;
    const warn = issues.filter((i) => i.severity === 'warn').length;
    const passN = issues.filter((i) => i.severity === 'pass').length;
    return {
      issues,
      pass: fail === 0,
      fail, warn, passed: passN,
      draft: true, // ALWAYS draft — a code sweep, not a stamped plan-check
      summary: fail === 0
        ? (warn ? `DRAFT code sweep: no failures, ${warn} warning(s) to review.` : 'DRAFT code sweep: all life-safety checks pass.')
        : `DRAFT code sweep: ${fail} life-safety FAIL(s) — fix before plan-check.`,
      note: 'Preliminary IRC life-safety sweep [STAMP DRAFT] — not a substitute for a licensed plan-check. Light/vent & hallway checks use whole-level proxies (no per-room polygons in the model).',
    };
  }
})();
