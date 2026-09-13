/* ============================================================
   Home Architect — assemblies.js  (HA.assemblies)
   Wall sandwich (layer-stack) derivation + garage fire
   separation (CRC R302.6) tagging. PURELY ADDITIVE: this module
   READS HA.WALL_TYPES / the wall shape / room-label fixtures and
   derives an ordered outside->inside LAYER list whose thicknesses
   SUM to the wall type's nominal thickness `t`. It NEVER touches
   framing.js or the core wall geometry. A wall may carry an
   OPTIONAL `wall.assembly` override; absence -> derive from type.
   An OPTIONAL `wall.fireSep` bool flags a 1-HR / Type X garage
   separation wall.

   Every layer is { name, material, thickness(in), r,
     struct?:bool, fireRated?:bool }. Exterior 2x6 defaults to the
   MAX cavity insulation (R-21 batt). All functions are pure and
   defensive — bad input yields [] / 0 rather than throwing.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;
  const A = (HA.assemblies = {});

  /* nominal cavity R by stud depth (filled batt, outside-in default).
     2x6 -> R-21, 2x4 -> R-13. Keyed by stud thickness in inches. */
  const CAVITY_R = { 5.5: 21, 3.5: 13 };
  /* gypsum board R per layer (1/2" ~0.45, 5/8" ~0.56) — small but real */
  const GYP_R = { 0.5: 0.45, 0.625: 0.56 };

  /* resolve the wall TYPE key from a wall object OR a bare type string */
  const typeKey = (wall) =>
    (typeof wall === 'string') ? wall : (wall && wall.type) || 'int2x4';

  /* the wall-type record (defensive: unknown -> interior 2x4) */
  const typeDef = (wall) =>
    HA.WALL_TYPES[typeKey(wall)] || HA.WALL_TYPES.int2x4;

  const isExtType = (wall) => !!typeDef(wall).ext;

  /* a single layer record */
  const layer = (name, material, thickness, r, extra) =>
    Object.assign({ name, material, thickness: thickness, r: r || 0 }, extra || {});

  /* ------------------------------------------------------------
     HA.assemblies.stack(wall|wallType, model?) -> [layer,...]
     Ordered outside -> inside. Thicknesses SUM to the type's `t`.
     ------------------------------------------------------------ */
  A.stack = (wall, model) => {
    const def = typeDef(wall);
    const t = def.t;
    const stud = def.stud || 3.5;
    const ext = !!def.ext;

    // explicit per-wall override wins (already a layer list)
    if (wall && typeof wall === 'object' && Array.isArray(wall.assembly) && wall.assembly.length) {
      // defensive copy; trust caller's layer shapes but fill r/thickness
      return wall.assembly.map((l) =>
        layer(l.name || 'Layer', l.material || null,
          Number.isFinite(l.thickness) ? l.thickness : 0, l.r || 0,
          { struct: !!l.struct, fireRated: !!l.fireRated }));
    }

    const cavityR = CAVITY_R[stud] || 0;
    const layers = [];

    if (def.sip) {
      /* SIP sandwich (outside -> inside): cladding (factory-applied on the
         reference panels — INSIDE the type's t, unlike framed walls) | WRB |
         7/16" OSB skin | EPS core | 7/16" OSB skin | 1/2" gyp. Skins + core
         are the structural panel (= def.stud); thicknesses sum EXACTLY to t
         (7.625 = 0.75 + 0 + 0.4375 + 5.5 + 0.4375 + 0.5 for the 6-1/2").
         EPS ~R-3.8/in, OSB skin ~R-0.55 ea — 6.5" panel reads ~R-23 whole
         assembly (honest: mfr sheets quote R-21..24). */
      const clad = 0.75;
      const gyp = 0.5;
      const skin = def.skin || 0.4375;
      const core = def.core || (def.stud - 2 * skin);
      const coreR = Math.round(core * 3.8 * 10) / 10;
      layers.push(layer('Cladding (factory-applied)', 'stucco', clad, 0.6));
      layers.push(layer('Weather-resistive barrier', null, 0, 0));
      layers.push(layer('OSB skin 7/16"', null, skin, 0.55, { struct: true }));
      layers.push(layer('EPS core ' + core + '" — R-' + coreR, null, core, coreR, { struct: true }));
      layers.push(layer('OSB skin 7/16"', null, skin, 0.55, { struct: true }));
      layers.push(layer('Gypsum board 1/2"', 'gypsum', gyp, GYP_R[0.5]));
      if (wall && typeof wall === 'object' && wall.fireSep)
        return A.withFireProtection(layers, def);
      return layers;
    }

    if (ext) {
      /* Exterior sandwich (outside -> inside):
         siding ~0.5, WRB (0), OSB sheathing 0.5, cavity (stud, MAX
         insulation), 1/2" gypsum. Non-cavity solid layers consume
         0.5 + 0.5 + 0.5 = 1.5"; the cavity takes the remainder so the
         total equals `t` exactly (2x6: 6.5 -> cavity 5.0 incl. board
         faces — i.e. exactly the stud depth here, since 0.5+0.5+5.5+0.5=7.0
         would overshoot, we balance the cavity to t - solids). */
      const siding = 0.5;
      const sheath = 0.5;
      const gyp = 0.5;
      const wrb = 0; // weather-resistive barrier — a membrane, ~0 thickness
      const cavity = t - (siding + sheath + gyp + wrb); // balance to total t
      layers.push(layer('Siding', 'lap_sage', siding, 0.6));
      layers.push(layer('Weather-resistive barrier', null, wrb, 0));
      layers.push(layer('OSB sheathing', null, sheath, 0.5, { struct: true }));
      layers.push(layer('2x' + (stud > 4 ? '6' : '4') + ' cavity — R-' + (cavityR || '?') + ' batt',
        null, cavity, cavityR, { struct: true }));
      layers.push(layer('Gypsum board 1/2"', 'gypsum', gyp, GYP_R[0.5]));
    } else {
      /* Interior sandwich: 1/2" gypsum, stud cavity, 1/2" gypsum.
         (2x4: 0.5 + 3.5 + 0.5 = 4.5 == t.) Cavity balances to total. */
      const gyp = 0.5;
      const cavity = t - gyp * 2;
      layers.push(layer('Gypsum board 1/2"', 'gypsum', gyp, GYP_R[0.5]));
      layers.push(layer('2x' + (stud > 4 ? '6' : '4') + ' cavity',
        null, cavity, 0, { struct: true }));
      layers.push(layer('Gypsum board 1/2"', 'gypsum', gyp, GYP_R[0.5]));
    }

    // if this wall is tagged for garage fire separation, ensure a 5/8"
    // Type X gypsum layer is present on the (inside) garage side.
    if (wall && typeof wall === 'object' && wall.fireSep)
      return A.withFireProtection(layers, def);

    return layers;
  };

  /* Insert / upgrade the garage-side gypsum to 5/8" Type X (fireRated)
     per CRC R302.6. Pure: returns a NEW layer list. Idempotent — if a
     Type X layer is already present it is left as-is. The inside face
     (last layer) is the garage-facing finish for an exterior wall and
     either face for a partition; we protect the LAST layer. */
  A.withFireProtection = (layers, def) => {
    const out = layers.map((l) => Object.assign({}, l));
    const last = out[out.length - 1];
    const already = out.some((l) => l.fireRated);
    if (already) return out;
    if (last && /gypsum/i.test(last.name)) {
      // upgrade the existing inside gypsum to 5/8" Type X
      const delta = 0.625 - (last.thickness || 0);
      last.name = 'Gypsum board 5/8" Type X';
      last.thickness = 0.625;
      last.r = GYP_R[0.625];
      last.fireRated = true;
      // keep the assembly thickness consistent by absorbing the delta
      // into the cavity (the structural layer), defensively.
      const cav = out.find((l) => l.struct && /cavity/i.test(l.name));
      if (cav) cav.thickness = Math.max(0, (cav.thickness || 0) - delta);
    } else {
      // no gypsum face — append a Type X layer (additive)
      out.push(layer('Gypsum board 5/8" Type X', 'gypsum', 0.625, GYP_R[0.625],
        { fireRated: true }));
    }
    return out;
  };

  /* ------------------------------------------------------------
     HA.assemblies.rValue(wall|type, model?) -> summed nominal R
     ------------------------------------------------------------ */
  A.rValue = (wall, model) => {
    const layers = A.stack(wall, model);
    let r = 0;
    for (const l of layers) r += (Number.isFinite(l.r) ? l.r : 0);
    return Math.round(r * 100) / 100;
  };

  /* ============================================================
     GARAGE FIRE SEPARATION (CRC R302.6)
     ============================================================ */

  /* collect garage room-label centroids on every level:
     [{ level, x, y, text }] for labels matching /garage/i, plus a
     level/room `garage` flag if present. Best-effort. */
  const garageLabels = (model) => {
    const out = [];
    if (!model || !Array.isArray(model.levels)) return out;
    for (let li = 0; li < model.levels.length; li++) {
      const lvl = model.levels[li];
      if (!lvl) continue;
      // explicit level/room flag
      if (lvl.garage === true || lvl.room === 'garage') out.push({ level: li, x: null, y: null, text: 'GARAGE', flag: true });
      for (const f of lvl.fixtures || []) {
        if (f && f.type === 'room_label' && /garage/i.test(f.text || '')) {
          out.push({ level: li, x: f.x, y: f.y, text: f.text });
        }
        if (f && f.garage === true) out.push({ level: li, x: f.x, y: f.y, text: f.text || 'GARAGE', flag: true });
      }
    }
    return out;
  };

  /* non-garage room-label centroids on a level (conditioned candidates) */
  const conditionedLabels = (lvl) =>
    (lvl && lvl.fixtures || []).filter((f) =>
      f && f.type === 'room_label' && !/garage/i.test(f.text || ''));

  /* which side of a wall a point lies on: signed perpendicular distance.
     Returns +1 / -1 (0 treated as +1). */
  const sideOf = (wall, p) => {
    const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
    const s = (p.x - wall.x1) * dy - (p.y - wall.y1) * dx;
    return s >= 0 ? 1 : -1;
  };

  /* perpendicular distance from a point to the (infinite) wall line, and
     whether the foot of the perpendicular lands within the segment span */
  const nearWall = (wall, p, tol) => {
    // U.distToSeg gives clamped distance to the SEGMENT (what we want)
    const U = HA.U;
    return U.distToSeg(p, HA.wallA(wall), HA.wallB(wall)) <= tol;
  };

  /* ------------------------------------------------------------
     HA.assemblies.garageSeparationWalls(model) -> [wallId,...]
     Exterior/partition walls that separate a GARAGE room from
     conditioned space. Best-effort via room labels + adjacency.
     Returns [] if none.
     ------------------------------------------------------------ */
  A.garageSeparationWalls = (model) => {
    const ids = [];
    if (!model || !Array.isArray(model.levels)) return ids;
    const seen = new Set();

    /* R195 (Steve's floor plan: "1-HR / TYPE X" strung along walls far from
       the garage): the label-centroid heuristic below reaches 20ft and
       tagged the garage's own exterior shell plus nearby house walls.
       CRC R302.6 wants the walls SEPARATING the garage from the RESIDENCE —
       and generated/authored models carry the exact garage rect
       (model._genRooms), so use it: tag ONLY interior walls lying on that
       rect's boundary (the seam). The garage's exterior perimeter is
       garage↔outdoors — no separation required there (lot-line proximity
       is compliance.js's own R302.1 concern). The label heuristic remains
       the fallback for hand-drawn models with no generated room map. */
    const doneLevels = new Set();
    for (let li = 0; li < model.levels.length; li++) {
      const gr = ((model._genRooms && model._genRooms[li]) || []).find((r) => r && r.kind === 'garage');
      if (!gr) continue;
      doneLevels.add(li);
      const T = 4;
      const onRect = (x, y) => {
        const inX = x > gr.x0 - T && x < gr.x1 + T, inY = y > gr.y0 - T && y < gr.y1 + T;
        if (!inX || !inY) return false;
        return Math.abs(x - gr.x0) < T || Math.abs(x - gr.x1) < T ||
               Math.abs(y - gr.y0) < T || Math.abs(y - gr.y1) < T;
      };
      for (const wall of model.levels[li].walls || []) {
        if (seen.has(wall.id) || HA.isExt(wall)) continue;
        if (onRect(wall.x1, wall.y1) && onRect(wall.x2, wall.y2)) { ids.push(wall.id); seen.add(wall.id); }
      }
    }

    const labels = garageLabels(model).filter((g) => !doneLevels.has(g.level));
    if (!labels.length) return ids;

    // adjacency tolerance: a label within ~1/2 a typical room of the wall.
    // We treat a wall as "bounding the garage" when the garage centroid is
    // the closest room-label centroid to that wall (best-effort).
    const TOL = 240; // inches (~20 ft reach) — generous, best-effort

    for (const g of labels) {
      const lvl = model.levels[g.level];
      if (!lvl) continue;
      const gp = (g.x == null || g.y == null) ? null : { x: g.x, y: g.y };
      const cond = conditionedLabels(lvl).map((f) => ({ x: f.x, y: f.y }));

      for (const wall of lvl.walls || []) {
        if (seen.has(wall.id)) continue;
        const exterior = HA.isExt(wall);

        if (gp) {
          // wall must be reasonably near the garage centroid
          if (!nearWall(wall, gp, TOL)) continue;
          if (exterior) {
            // an exterior wall the garage abuts IS a separation surface
            // between the (unconditioned) garage and the outside-of-house;
            // R302.6 cares about the house side, but the garage perimeter
            // commonly carries Type X too — flag it as a candidate.
            // To stay best-effort and avoid over-tagging the whole shell,
            // only flag exterior walls when the garage shares this level
            // with conditioned rooms (an attached garage).
            if (cond.length) { ids.push(wall.id); seen.add(wall.id); }
            continue;
          }
          // interior partition: separates garage from conditioned space if a
          // conditioned label sits on the OPPOSITE side of this wall from the
          // garage centroid.
          const gSide = sideOf(wall, gp);
          const splits = cond.some((c) => sideOf(wall, c) !== gSide && nearWall(wall, c, TOL));
          if (splits) { ids.push(wall.id); seen.add(wall.id); }
        } else {
          // flagged garage with no centroid (level/room flag): the common
          // garage→house wall is any interior partition on the level; flag
          // interior walls that also border a conditioned label.
          if (exterior) continue;
          const splits = cond.some((c) => nearWall(wall, c, TOL));
          if (splits) { ids.push(wall.id); seen.add(wall.id); }
        }
      }
    }
    return ids;
  };

  /* ------------------------------------------------------------
     HA.assemblies.applyGarageProtection(model) -> {count, wallIds}
     Tags each separation wall wall.fireSep=true and gives wall.assembly
     a 5/8" Type X gypsum layer on the garage side (CRC R302.6).
     Idempotent.
     ------------------------------------------------------------ */
  A.applyGarageProtection = (model) => {
    const wallIds = A.garageSeparationWalls(model);
    let count = 0;
    for (const id of wallIds) {
      const wall = HA.findWall(model, id);
      if (!wall) continue;
      const wasSep = wall.fireSep === true;
      wall.fireSep = true;
      // bake the Type X assembly override so it persists with the wall.
      // Derive a fresh stack (which, with fireSep set, includes Type X) and
      // store it as the explicit per-wall assembly. Idempotent: if the wall
      // already carries a fireRated layer, leave its assembly untouched.
      const hasFireLayer = Array.isArray(wall.assembly) &&
        wall.assembly.some((l) => l && l.fireRated);
      if (!hasFireLayer) {
        const baseDef = typeDef(wall);
        // build from a clean (override-free) stack, then protect it
        const clean = A.stack(wall.type, model);
        wall.assembly = A.withFireProtection(clean, baseDef);
      }
      if (!wasSep || !hasFireLayer) count++;
    }
    return { count, wallIds };
  };
})();
