/* ============================================================
   PlanCrafters — roomcode.js  (HA.roomcode)   R183

   ROOM CODE: houses as code. The authoring layer of the new
   framework (Steve, Aug 15-16): a plan is AUTHORED as a small
   document — rooms with real dimensions, adjacency attachments
   with connector kinds, a front door, and declared INTENT
   (roof form/pitch, ceilings, style, HVAC) — and the ENGINE
   derives the rest exactly as it does for a generated plan:
   walls, seated doors, egress windows, fixtures, kitchen/bath
   programs, porch, foundation, roof, palette, MEP.

   THE FRAMEWORK PRINCIPLE — declare intent, derive engineering:
     L1 rooms & envelope   (authored here: rooms/attach/front door)
     L2 systems intent     (authored here: roof/style/hvac/ceiling)
     L3 derived engineering (the engine: framing, egress, MEP, roof
                            geometry — never authored)
     L4 pins               (per-room ceiling/cathedral overrides)

   THE CONTRACT — JSON plan document v1 (Python's roomcode.py emits
   this; anything that speaks it can author plans). The FULL annotated
   schema lives in roomcode/SCHEMA.md — this sketch is the shape only:
     {
       "roomcode": 1,
       "name": "cottage-32",
       "units": "ft" | "in",              // room coords only; default ft
       "mode": "1story" | "adu",
       "style": "farmhouse" | ... ,       // engine style pack
       "ceiling": 9,                      // plan ceiling, ALWAYS ft
       "hvac": "minisplit"|"ducted"|"heatpump"|"none",
       "roof": { "form", "pitch", "overhang", "cathedral",
                 "gables": ["front", ...] },        // per-edge gable pins
       "rooms": [ { "name", "kind",       // kind optional (inferred from name)
                    "x", "y", "w", "d",   // x from plan LEFT, y from plan FRONT
                    "ceiling", "cathedral", "open", "primary",
                    "doorW",              // garages only: overhead door ft
                    "floor",              // finish-schedule text (v2.1)
                    "windows": {"type","grid"},     // per-room override (v2.1)
                    "bath": "full"|"master" } ],    // bath tier (v2.2)
       "attach": [ ["A", "B", "door"|"open"|"zone"] ],  // zone = NO wall
       "frontDoor": "FOYER",
       "finishes":   { "palette", "siding", "roofMat", "trim", "door", "shutter" },
       "windows":    { "type", "grid" },                // plan-wide (v2.1)
       "doors":      { "front", "interior", "french": ["OFFICE"] },  // v2.5
       "kitchen":    { "scheme", "island", "diagonal", "tier", "seed" },
       "electrical": { "main": "auto"|100..400, "underground": bool },
       "solar":      { "kw", "count" },
       "backyard":   { "archetype", "pool", "scheme", "seed" },
       "carport":    { "x","y","w","d","height","roof","sides","type" }
     }

   Public API:
     HA.roomcode.normalize(docIn)      -> normalized doc (inches, rects,
                                          canonical kinds). Throws on
                                          malformed structure.
     HA.roomcode.validate(docIn)       -> { ok, errors[], warnings[] } —
                                          never throws; room-name language.
     HA.roomcode.build(model, docIn, opts) -> { ok, warnings[], stats } —
                                          validates, generates through
                                          HA.generator (the _roomcode
                                          authored path), then applies the
                                          intent passes (roof form/pitch/
                                          overhang/cathedral, per-room
                                          ceilings). Throws on errors.

   Conventions match the rest of HA: plan units are INCHES once
   normalized; authored y runs from the plan FRONT (street side).
   Absence-safe: loads headless without plan2d/three.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;

  const RC = (HA.roomcode = {});
  RC.VERSION = 1;

  /* ---------- vocabulary ---------- */
  // canonical room kinds the engine programs against (gen.js PROG + designers)
  const KIND_SET = ['living', 'kitchen', 'dining', 'bed', 'bath', 'entry', 'hall',
    'closet', 'pantry', 'laundry', 'office', 'garage', 'stair'];
  // name → kind inference, checked IN ORDER (BATH before BED so "PRIMARY BATH"
  // never reads as a bedroom).
  const NAME_KINDS = [
    [/BATH|POWDER|ENSUITE/, 'bath'],
    [/KITCHEN/, 'kitchen'],
    [/DINING|NOOK|BREAKFAST/, 'dining'],
    [/GREAT|LIVING|FAMILY|STUDIO|LOUNGE/, 'living'],
    [/BED|SUITE|PRIMARY|MASTER/, 'bed'],
    [/FOYER|ENTRY|VESTIBULE/, 'entry'],
    [/HALL|CORRIDOR|GALLERY/, 'hall'],
    [/CLOSET|WIC|WARDROBE|LINEN/, 'closet'],
    [/PANTRY/, 'pantry'],
    [/LAUNDRY|UTILITY|MUD/, 'laundry'],
    [/OFFICE|DEN|STUDY|FLEX/, 'office'],
    [/GARAGE/, 'garage'],
    [/STAIR/, 'stair'],
  ];
  const ROOF_FORMS = ['auto', 'gable', 'hip', 'shed'];
  const HVACS = ['minisplit', 'ducted', 'heatpump', 'none'];
  const MODES = ['1story', 'adu'];
  const WIN_TYPES = ['double_hung', 'casement', 'slider', 'picture', 'fixed', 'awning'];
  const WIN_GRIDS = ['colonial', 'prairie', 'craftsman', 'none'];
  // door SLAB styles that render distinct geometry (HA.DOOR_STYLES minus the
  // overhead 'garage' sectional — that one is the garage room's doorW job)
  const DOOR_STYLES = ['panel', 'flush', 'glass', 'full_glass', 'craftsman', 'plank'];
  RC.KINDS = KIND_SET.slice();

  const kindOf = (name, explicit) => {
    if (explicit) {
      if (KIND_SET.indexOf(explicit) < 0)
        throw new Error('roomcode: unknown kind "' + explicit + '" on room "' + name + '" — kinds are ' + KIND_SET.join(', ') + '.');
      return explicit;
    }
    const N = String(name || '').toUpperCase();
    for (const [re, k] of NAME_KINDS) if (re.test(N)) return k;
    return 'living';   // an unnamed-purpose room builds as generic habitable space
  };

  /* ---------- normalize: authored document -> engine inches ---------- */
  RC.normalize = (docIn) => {
    if (typeof docIn === 'string') docIn = JSON.parse(docIn);   // a JSON string is a plan too
    if (!docIn || typeof docIn !== 'object') throw new Error('roomcode: the plan document must be an object.');
    const units = docIn.units || 'ft';
    if (units !== 'ft' && units !== 'in') throw new Error('roomcode: units must be "ft" or "in".');
    const S = units === 'ft' ? 12 : 1;
    if (!Array.isArray(docIn.rooms) || !docIn.rooms.length) throw new Error('roomcode: the document has no rooms.');

    const rooms = docIn.rooms.map((r) => {
      if (!r || !r.name) throw new Error('roomcode: every room needs a name.');
      const name = String(r.name).toUpperCase();
      const kind = kindOf(name, r.kind);
      let u0, v0, u1, v1;
      if (Number.isFinite(r.u0) && Number.isFinite(r.v0) &&
          Number.isFinite(r.u1) && Number.isFinite(r.v1)) {
        u0 = r.u0 * S; v0 = r.v0 * S; u1 = r.u1 * S; v1 = r.v1 * S;
      } else {
        if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !(r.w > 0) || !(r.d > 0))
          throw new Error('roomcode: room "' + name + '" needs x, y, w, d (or u0/v0/u1/v1).');
        u0 = r.x * S; v0 = r.y * S; u1 = (r.x + r.w) * S; v1 = (r.y + r.d) * S;
      }
      const out = { name, kind, u0, v0, u1, v1 };
      if (r.open) out.open = true;
      if (r.primary || (kind === 'bed' && /PRIMARY|MASTER/.test(name))) out.primary = true;
      if (Number.isFinite(r.ceiling)) out.ceil = Math.round(r.ceiling * 12);   // ceilings author in FEET always
      if (r.cathedral) out.cathedral = true;
      if (Number.isFinite(r.doorW)) out.doorW = Math.round(r.doorW * 12);      // garage doors author in FEET
      if (r.floor) out.floor = String(r.floor);                                 // finish-schedule text (v2.1)
      if (r.windows) out.windows = { type: r.windows.type || null, grid: r.windows.grid || null };
      if (r.bath) out.bath = String(r.bath).toLowerCase();                      // per-bath tier (v2.2)
      return out;
    });

    const attach = docIn.attach || docIn.edges || [];
    const edges = attach.map((e) => {
      const a = Array.isArray(e) ? e[0] : e.a, b = Array.isArray(e) ? e[1] : e.b;
      const kind = (Array.isArray(e) ? e[2] : e.kind) || 'door';
      if (!a || !b) throw new Error('roomcode: every attach needs two room names.');
      if (kind !== 'door' && kind !== 'open' && kind !== 'zone')
        throw new Error('roomcode: attach connector must be "door", "open", or "zone" (got "' + kind + '").');
      return { a: String(a).toUpperCase(), b: String(b).toUpperCase(), kind };
    });

    const roofIn = docIn.roof || {};
    const doc = {
      roomcode: 1,
      name: docIn.name || 'plan',
      mode: docIn.mode || '1story',
      style: docIn.style || 'farmhouse',
      hvac: docIn.hvac || null,
      ceiling: Number.isFinite(docIn.ceiling) ? Math.round(docIn.ceiling * 12) : null,
      roof: {
        form: roofIn.form || 'auto',
        pitch: Number.isFinite(roofIn.pitch) ? roofIn.pitch : null,
        overhang: Number.isFinite(roofIn.overhang) ? Math.round(roofIn.overhang * 12) : null,
        cathedral: !!roofIn.cathedral,
        gables: Array.isArray(roofIn.gables) ? roofIn.gables.map((g) => String(g).toLowerCase()) : [],
      },
      rooms, edges,
      frontDoorRoom: (docIn.frontDoor || docIn.frontDoorRoom || null) &&
        String(docIn.frontDoor || docIn.frontDoorRoom).toUpperCase(),
    };
    // FINISHES + WINDOW TYPES (v2.1): palette index (the style's curated
    // sets) OR explicit channels; window type/grid plan-wide, overridable
    // per room. All optional — absent means the style pack decides.
    const finIn = docIn.finishes || {};
    doc.finishes = {
      palette: Number.isFinite(finIn.palette) ? (finIn.palette | 0) : null,
      siding: finIn.siding || null,
      roofMat: finIn.roofMat || finIn.roof_mat || null,
      trim: finIn.trim || null, door: finIn.door || null, shutter: finIn.shutter || null,
    };
    const winIn = docIn.windows || {};
    doc.windows = { type: winIn.type || null, grid: winIn.grid || null };
    // DOOR slab styles (v2.5): front + interior, plus French pairs on named
    // rooms. WIDTHS stay engine-derived (32" swung / 48" cased / egress and
    // headers are code) — this is the slab vocabulary only.
    const dIn = docIn.doors;
    doc.doors = dIn ? {
      front: dIn.front || null,
      interior: dIn.interior || null,
      french: Array.isArray(dIn.french) ? dIn.french.map((n) => String(n).toUpperCase()) : [],
    } : null;
    // KITCHEN selection (v2.2): scheme (a named cabinet/counter/appliance
    // set, or an index), island, tier, plus a seed for layout variety.
    const kIn = docIn.kitchen;
    doc.kitchen = kIn ? {
      scheme: kIn.scheme != null ? kIn.scheme : null,
      island: kIn.island || null,
      diagonal: !!kIn.diagonal,
      tier: kIn.tier || null,
      seed: Number.isFinite(kIn.seed) ? (kIn.seed >>> 0) : null,
    } : null;
    // SYSTEMS (v2.3): electrical service size + solar target
    const eIn = docIn.electrical;
    doc.electrical = eIn ? {
      main: eIn.main != null ? eIn.main : 'auto',      // 'auto' or a standard frame
      underground: !!eIn.underground,
    } : null;
    const sIn = docIn.solar;
    doc.solar = sIn ? {
      kw: Number.isFinite(sIn.kw) ? sIn.kw : null,
      count: Number.isFinite(sIn.count) ? (sIn.count | 0) : null,
      // v2.6: WHICH roof planes (author's own plan edges) + pack alignment
      faces: Array.isArray(sIn.faces) ? sIn.faces.map((f) => String(f).toLowerCase()) : [],
      align: sIn.align || null,
    } : null;
    // BACKYARD package (v2.4): the parametric yard designer — archetype +
    // pool shape + scheme + seed. Placement stays the designer's job
    // (keep-outs, aprons, poolside lounge); item-level x/y is roadmap.
    const yIn = docIn.backyard;
    doc.backyard = yIn ? {
      archetype: yIn.archetype || null,
      pool: yIn.pool === true ? 'auto' : (yIn.pool || null),
      scheme: yIn.scheme != null ? yIn.scheme : null,
      seed: Number.isFinite(yIn.seed) ? (yIn.seed >>> 0) : null,
    } : null;
    // site-composed CARPORT / DETACHED GARAGE (R186): authored in the SAME
    // coordinates as the rooms (feet, x from plan left, y from plan front),
    // but composed on the lot by the carport engine — kept in FEET here
    // (that engine's API surface is feet).
    const cpIn = docIn.carport || docIn.detachedGarage || null;
    if (cpIn) {
      doc.carport = {
        x: cpIn.x, y: cpIn.y, w: cpIn.w, d: cpIn.d,
        height: Number.isFinite(cpIn.height) ? cpIn.height : null,
        roof: cpIn.roof || 'gable',
        sides: Number.isFinite(cpIn.sides) ? cpIn.sides : (docIn.detachedGarage ? 3 : 0),
        type: cpIn.type || null,
      };
    }
    return doc;
  };

  /* ---------- geometry helpers (validation lives in room-name language) ---------- */
  const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
  const sharedLen = (A, B) => {
    // length of shared edge between two rects (6" alignment tolerance)
    if (Math.abs(A.u1 - B.u0) <= 6 || Math.abs(B.u1 - A.u0) <= 6) return Math.max(0, ov(A.v0, A.v1, B.v0, B.v1));
    if (Math.abs(A.v1 - B.v0) <= 6 || Math.abs(B.v1 - A.v0) <= 6) return Math.max(0, ov(A.u0, A.u1, B.u0, B.u1));
    return 0;
  };
  // how much of room A's given side is abutted by other rooms (egress check)
  const sideCovered = (A, rooms, side) => {
    const span = side === 'v0' || side === 'v1' ? [A.u0, A.u1] : [A.v0, A.v1];
    let cov = 0;
    for (const B of rooms) {
      if (B === A) continue;
      let touches = false;
      if (side === 'v0') touches = Math.abs(B.v1 - A.v0) <= 6;
      else if (side === 'v1') touches = Math.abs(B.v0 - A.v1) <= 6;
      else if (side === 'u0') touches = Math.abs(B.u1 - A.u0) <= 6;
      else touches = Math.abs(B.u0 - A.u1) <= 6;
      if (!touches) continue;
      const o = side[0] === 'v' ? ov(A.u0, A.u1, B.u0, B.u1) : ov(A.v0, A.v1, B.v0, B.v1);
      if (o > 0) cov += o;
    }
    return cov / Math.max(1, span[1] - span[0]);
  };

  /* ---------- validate: the L1/L2 contract report ---------- */
  RC.validate = (docIn) => {
    const errors = [], warnings = [];
    let doc = null;
    try { doc = RC.normalize(docIn); } catch (e) {
      return { ok: false, errors: [String(e.message || e)], warnings };
    }
    const R = doc.rooms;
    const byName = {};
    for (const r of R) {
      if (byName[r.name]) errors.push('two rooms are both named "' + r.name + '" — names must be unique.');
      byName[r.name] = r;
      if (r.u1 - r.u0 < 24 || r.v1 - r.v0 < 24)
        errors.push('room "' + r.name + '" is under 2ft on a side — give it real dimensions.');
    }
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
      if (ov(R[i].u0, R[i].u1, R[j].u0, R[j].u1) > 6 && ov(R[i].v0, R[i].v1, R[j].v0, R[j].v1) > 6)
        errors.push('rooms "' + R[i].name + '" and "' + R[j].name + '" overlap — rooms tile, never stack.');
    }
    // adjacency connectivity: the rooms must form ONE mass (islands can't build)
    if (R.length > 1) {
      const seen = new Set([R[0].name]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of R) {
          if (seen.has(r.name)) continue;
          for (const s of R) if (seen.has(s.name) && sharedLen(r, s) > 6) { seen.add(r.name); grew = true; break; }
        }
      }
      for (const r of R) if (!seen.has(r.name))
        errors.push('room "' + r.name + '" does not touch the rest of the plan — every room must share a wall with the body of the house.');
    }
    // attachments must reference real, actually-adjacent rooms
    for (const e of doc.edges) {
      const A = byName[e.a], B = byName[e.b];
      if (!A || !B) { errors.push('attach references unknown room "' + (A ? e.b : e.a) + '".'); continue; }
      const sl = sharedLen(A, B);
      if (sl <= 6) errors.push('"' + e.a + '" and "' + e.b + '" are attached but share no wall — move them together or drop the attach.');
      else if (sl < 30 && e.kind === 'door') warnings.push('"' + e.a + '"–"' + e.b + '" share under 2\'-6" of wall — a door will be tight there.');
    }
    // front door: must exist and should touch the plan front (y = 0 line)
    if (doc.frontDoorRoom) {
      const F = byName[doc.frontDoorRoom];
      if (!F) errors.push('frontDoor names unknown room "' + doc.frontDoorRoom + '".');
      else {
        let minV = Infinity;
        for (const r of R) minV = Math.min(minV, r.v0);
        if (F.v0 - minV > 6) warnings.push('the front-door room "' + F.name + '" does not touch the plan front — the entry will land on whatever exterior wall it has.');
      }
    } else if (doc.mode !== 'adu') {
      warnings.push('no frontDoor declared — the engine will use the entry/living room it finds.');
    }
    // egress: every bedroom needs at least one exterior wall
    for (const r of R) {
      if (r.kind !== 'bed') continue;
      const buried = ['v0', 'v1', 'u0', 'u1'].every((s) => sideCovered(r, R, s) >= 0.95);
      if (buried) errors.push('bedroom "' + r.name + '" is fully interior — an egress window is impossible. Give it an exterior wall.');
    }
    // reachability over authored connectors (the engine punches missing doors, but say so)
    const start = doc.frontDoorRoom || (R.find((r) => r.kind === 'entry' || r.kind === 'living') || R[0]).name;
    if (byName[start]) {
      const reach = new Set([start]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of doc.edges) {
          if (reach.has(e.a) && !reach.has(e.b)) { reach.add(e.b); grew = true; }
          if (reach.has(e.b) && !reach.has(e.a)) { reach.add(e.a); grew = true; }
        }
      }
      for (const r of R) {
        if (reach.has(r.name) || r.kind === 'garage') continue;
        warnings.push('room "' + r.name + '" has no authored door path from "' + start + '" — the engine will punch one through an adjacent wall.');
      }
    }
    // garage: wants a man-door into the house
    const g = R.find((r) => r.kind === 'garage');
    if (g && !doc.edges.some((e) => e.a === g.name || e.b === g.name))
      warnings.push('the garage has no authored man-door — the engine will punch one into the nearest service room.');
    // L2 intent legality
    if (MODES.indexOf(doc.mode) < 0) errors.push('mode must be one of ' + MODES.join(', ') + '.');
    if (doc.hvac && HVACS.indexOf(doc.hvac) < 0) errors.push('hvac must be one of ' + HVACS.join(', ') + '.');
    if (ROOF_FORMS.indexOf(doc.roof.form) < 0) errors.push('roof.form must be one of ' + ROOF_FORMS.join(', ') + '.');
    for (const g of (doc.roof.gables || []))
      if (['front', 'back', 'left', 'right'].indexOf(g) < 0)
        errors.push('roof.gables entries are plan edges — front, back, left, right (got "' + g + '").');
    if (doc.roof.pitch != null && (doc.roof.pitch < 0.5 || doc.roof.pitch > 18)) errors.push('roof.pitch is rise:12 — use 0.5 to 18.');
    if (doc.roof.overhang != null && (doc.roof.overhang < 0 || doc.roof.overhang > 48)) errors.push('roof.overhang is in feet — use 0 to 4.');
    if (doc.ceiling != null && (doc.ceiling < 84 || doc.ceiling > 240)) errors.push('ceiling is in feet — use 7 to 20.');
    if (doc.carport) {
      const cp = doc.carport;
      if (!Number.isFinite(cp.x) || !Number.isFinite(cp.y) || !(cp.w > 0) || !(cp.d > 0))
        errors.push('the carport needs x, y, w, d (feet, same axes as the rooms).');
      else {
        if (cp.w < 8 || cp.w > 40 || cp.d < 8 || cp.d > 40)
          errors.push('carport w/d are 8 to 40 feet (the structural engine’s span limits).');
        if (['gable', 'shed', 'flat'].indexOf(cp.roof) < 0)
          errors.push('carport roof must be gable, shed, or flat.');
        if (!(cp.sides >= 0 && cp.sides <= 3))
          errors.push('carport sides (enclosed walls) is 0 to 3 — the open face is the bay.');
        // it is DETACHED — overlapping the house is an authoring error
        const cu0 = cp.x * 12, cv0 = cp.y * 12, cu1 = (cp.x + cp.w) * 12, cv1 = (cp.y + cp.d) * 12;
        for (const r of R) {
          if (ov(cu0, cu1, r.u0, r.u1) > 6 && ov(cv0, cv1, r.v0, r.v1) > 6) {
            errors.push('the carport overlaps room "' + r.name + '" — a carport/detached garage stands CLEAR of the house.');
            break;
          }
        }
      }
    }
    for (const r of R) if (r.ceil != null && (r.ceil < 84 || r.ceil > 240))
      errors.push('room "' + r.name + '" ceiling is in feet — use 7 to 20.');
    // v2.1: window enums (plan-wide + per-room) + the palette index range
    const winCheck = (spec, where) => {
      if (!spec) return;
      if (spec.type && WIN_TYPES.indexOf(spec.type) < 0)
        errors.push(where + ' windows.type must be one of ' + WIN_TYPES.join(', ') + '.');
      if (spec.grid && WIN_GRIDS.indexOf(spec.grid) < 0)
        errors.push(where + ' windows.grid must be one of ' + WIN_GRIDS.join(', ') + '.');
    };
    winCheck(doc.windows, 'plan');
    for (const r of R) winCheck(r.windows, 'room "' + r.name + '"');
    if (doc.finishes && doc.finishes.palette != null) {
      // honest per-style bound: each style ships a REAL number of curated
      // sets (4 or 5) — validate against the generator's own list, not a
      // one-size guess (the old check passed 5 while the message said 0-4).
      const PALS = HA.generator && HA.generator.PALETTES;
      const list = PALS ? (PALS[doc.style] || PALS.farmhouse) : null;
      const n = (list && list.length) || 5;
      if (doc.finishes.palette < 0 || doc.finishes.palette >= n)
        errors.push('finishes.palette for ' + doc.style + ' is an index into its ' +
          n + ' curated sets — use 0 to ' + (n - 1) + '.');
    }
    // v2.5: door slab styles + French pairs
    if (doc.doors) {
      for (const key of ['front', 'interior']) {
        const v = doc.doors[key];
        if (v && DOOR_STYLES.indexOf(v) < 0)
          errors.push('doors.' + key + ' must be one of ' + DOOR_STYLES.join(', ') + '.');
      }
      for (const n of doc.doors.french) if (!R.some((r) => r.name === n))
        errors.push('doors.french names unknown room "' + n + '".');
    }
    // v2.2: kitchen options + per-bath tiers
    if (doc.kitchen) {
      if (doc.kitchen.island && ['auto', 'none', 'seating'].indexOf(doc.kitchen.island) < 0)
        errors.push('kitchen.island must be auto, none, or seating.');
      if (doc.kitchen.tier && ['kitchenette', 'grand'].indexOf(doc.kitchen.tier) < 0)
        errors.push('kitchen.tier must be kitchenette or grand.');
      if (!R.some((r) => r.kind === 'kitchen'))
        warnings.push('kitchen options declared but the plan has no KITCHEN room.');
    }
    for (const r of R) {
      if (!r.bath) continue;
      if (r.kind !== 'bath') errors.push('room "' + r.name + '" declares bath="' + r.bath + '" but is not a bath.');
      else if (['full', 'master'].indexOf(r.bath) < 0)
        errors.push('bath tier on "' + r.name + '" must be full or master.');
    }
    // v2.3: electrical main frame + solar target sanity
    const STD_MAINS = [100, 125, 150, 200, 225, 300, 400];
    if (doc.electrical && doc.electrical.main !== 'auto' && STD_MAINS.indexOf(doc.electrical.main) < 0)
      errors.push('electrical.main must be "auto" or a standard frame: ' + STD_MAINS.join('/') + ' A.');
    if (doc.solar) {
      if (doc.solar.kw != null && (doc.solar.kw < 1 || doc.solar.kw > 30))
        errors.push('solar.kw is the DC target in kilowatts — use 1 to 30.');
      if (doc.solar.count != null && (doc.solar.count < 1 || doc.solar.count > 80))
        errors.push('solar.count is the module count — use 1 to 80.');
      for (const f of doc.solar.faces || [])
        if (['front', 'back', 'left', 'right'].indexOf(f) < 0)
          errors.push('solar.faces entries are plan edges — front, back, left, right (got "' + f + '").');
      if (doc.solar.align && ['left', 'center', 'right'].indexOf(doc.solar.align) < 0)
        errors.push('solar.align must be left, center, or right.');
    }
    // v2.4: the backyard package
    if (doc.backyard) {
      const ARCH = ['resort', 'entertainer', 'garden', 'zen', 'family'];
      const POOLS = ['auto', 'rect', 'lap', 'lshape', 'kidney', 'freeform', 'above_ground', 'waterfall'];
      if (doc.backyard.archetype && ARCH.indexOf(doc.backyard.archetype) < 0)
        errors.push('backyard.archetype must be one of ' + ARCH.join(', ') + '.');
      if (doc.backyard.pool && POOLS.indexOf(doc.backyard.pool) < 0)
        errors.push('backyard.pool must be true/auto or a shape: ' + POOLS.slice(1).join(', ') + '.');
    }
    return { ok: !errors.length, errors, warnings };
  };

  /* ---------- intent passes (run AFTER generate) ---------- */
  /* per-edge GABLE PINS (R185): force a gable on the NAMED plan edges (front/
     back/left/right — the author's own axes). Runs AFTER the form pass, which
     re-flags walls, so a pin always wins: form:"hip" + gables:["front"] is a
     hip roof with one front gable. Matching happens in WORLD space against
     the segments gen.js stamped at build time (model._rcEdges) — same-world-
     orientation wall nearest the segment midline, the setGableOnEdge lesson. */
  const pinGables = (model, gables) => {
    const segs = model._rcEdges;
    const notes = [];
    if (!gables || !gables.length) return notes;
    if (!segs) { notes.push('gable pins need a Room Code build (no stamped edges).'); return notes; }
    const U = HA.U;
    const walls = ((model.levels[0] && model.levels[0].walls) || []).filter((w) => HA.isExt && HA.isExt(w));
    for (const name of gables) {
      let hit = null, hitD = 25;
      for (const s of (segs[name] || [])) {
        const mid = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
        const sHoriz = Math.abs(s.x2 - s.x1) >= Math.abs(s.y2 - s.y1);
        for (const w of walls) {
          const wHoriz = Math.abs(w.x2 - w.x1) >= Math.abs(w.y2 - w.y1);
          if (wHoriz !== sHoriz) continue;
          const A = { x: w.x1, y: w.y1 }, B = { x: w.x2, y: w.y2 };
          const t = U.clamp(U.projT(mid, A, B), 0, 1);
          const p = U.lerp(A, B, t);
          const d = Math.hypot(mid.x - p.x, mid.y - p.y);
          if (d < hitD) { hitD = d; hit = w; }
        }
      }
      if (hit) hit.gable = true;
      else notes.push('gable pin "' + name + '" found no matching exterior wall.');
    }
    return notes;
  };

  const applyRoofIntent = (model, roof) => {
    if (!roof) return [];
    // form first (a preset re-flags gables), then pins, then numeric overrides
    if (roof.form && roof.form !== 'auto') {
      try { if (HA.roofStyle) HA.roofStyle(model, roof.form); } catch (e) { /* keep the massing-aware default */ }
    }
    const notes = pinGables(model, roof.gables);
    model.roof = model.roof || {};
    if (roof.pitch != null) model.roof.pitch = roof.pitch;
    if (roof.overhang != null) model.roof.overhang = roof.overhang;
    if (roof.cathedral) model.roof.cathedral = true;
    return notes;
  };

  /* site-composed CARPORT / DETACHED GARAGE (R186): place the authored
     structure on the lot with the carport engine, in the author's own
     coordinates via the stamped transform. sides:3 = the detached-garage
     program (three enclosed walls, the open face is the bay). NOTE: the
     carport engine composes axis-aligned — on a rotated lot frame the
     structure keeps world axes (documented; rotation support is roadmap). */
  const applyCarport = (model, doc) => {
    const cp = doc.carport;
    if (!cp) return [];
    if (!(HA.carport && HA.carport.design && HA.carport.applyToModel))
      return ['carport engine unavailable — the carport declaration was skipped.'];
    const X = model._rcXform;
    if (!X) return ['no authored transform stamped — the carport declaration was skipped.'];
    const au = cp.x * 12 + X.du, av = cp.y * 12 + X.dv;
    const origin = { x: X.o.x + X.eu.x * au + X.ev.x * av, y: X.o.y + X.eu.y * au + X.ev.y * av };
    const notes = [];
    // honesty check: warn (never block) when the composed structure leaves the
    // setback envelope — the room validator can't know the lot, but build can.
    try {
      const sb = HA.site && HA.site.setbackLines ? HA.site.setbackLines(model) : null;
      if (sb && sb.poly && sb.poly.length >= 3 && HA.U && HA.U.pointInPoly) {
        const corners = [[0, 0], [cp.w * 12, 0], [cp.w * 12, cp.d * 12], [0, cp.d * 12]];
        const out = corners.some(([dx, dy]) => !HA.U.pointInPoly(
          { x: origin.x + X.eu.x * dx + X.ev.x * dy, y: origin.y + X.eu.y * dx + X.ev.y * dy }, sb.poly));
        if (out) notes.push('the carport sits partly OUTSIDE the setback envelope — check its x/y against the lot.');
      }
    } catch (e) { /* the envelope check is best-effort */ }
    try {
      const d = HA.carport.design({
        widthFt: cp.w, depthFt: cp.d,
        heightFt: cp.height || undefined,
        roof: cp.roof, sides: cp.sides, type: cp.type || undefined,
      });
      HA.carport.applyToModel(model, d, { originXIn: origin.x, originYIn: origin.y });
      return notes;
    } catch (e) {
      notes.push('carport composition failed: ' + (e.message || e));
      return notes;
    }
  };

  const applyRoomCeilings = (model, doc) => {
    /* CATHEDRAL is a CEILING TREATMENT (open to the rafters — the section's
       batt-between-rafters detail), NEVER a plate change. R186 verification
       found the old cathedral-implies-(+24") raise solved the roof into giant
       clerestory WEDGES when the room sits mid-plan (browser snap probe:
       identical doc without the flag = a clean cross-gabled roof). Only an
       EXPLICIT per-room ceiling raises walls — the author owns that massing. */
    if (doc.roof.cathedral || doc.rooms.some((r) => r.cathedral)) {
      model.roof = model.roof || {};
      model.roof.cathedral = true;
    }
    const wants = doc.rooms.filter((r) => r.ceil != null);
    if (!wants.length) return [];
    const notes = [];
    if (!(HA.rooms && HA.rooms.detectRooms && HA.rooms.setRoomCeiling)) {
      notes.push('per-room ceilings need the room engine (browser build) — plan-level ceiling still applied.');
      return notes;
    }
    const gen0 = (model._genRooms && model._genRooms[0]) || [];
    for (const w of wants) {
      const gr = gen0.find((r) => r.name === w.name);
      if (!gr) { notes.push('room "' + w.name + '" not found for its ceiling override.'); continue; }
      const cx = (gr.x0 + gr.x1) / 2, cy = (gr.y0 + gr.y1) / 2;
      const H = w.ceil;
      try {
        let region = null;
        for (const rg of (HA.rooms.detectRooms(model, 0) || []))
          if (rg.poly && HA.U.pointInPoly({ x: cx, y: cy }, rg.poly)) { region = rg; break; }
        if (region) HA.rooms.setRoomCeiling(model, 0, region, H);
        else notes.push('room "' + w.name + '" region not detected — ceiling override skipped.');
      } catch (e) { notes.push('ceiling override failed on "' + w.name + '": ' + (e.message || e)); }
    }
    return notes;
  };

  /* FINISHES (v2.1): palette-as-a-unit (the style's curated sets, same as
     Generate's seeded roll) or explicit channels; per-room floors land on
     the stored room records the FINISH SCHEDULE reads. */
  const applyFinishes = (model, doc) => {
    const F = doc.finishes || {};
    const wants = doc.rooms.filter((r) => r.floor);
    const any = F.palette != null || F.siding || F.roofMat || F.trim || F.door || F.shutter || wants.length;
    if (!any) return [];
    const notes = [];
    model.settings.surfaces = model.settings.surfaces || {};
    model.settings.colors = model.settings.colors || {};
    if (F.palette != null && HA.generator && HA.generator.pickPalette) {
      const pal = HA.generator.pickPalette(doc.style, F.palette);
      if (pal) {
        model.settings.surfaces.exteriorWall = pal.siding;
        model.settings.colors.trim = pal.trim;
        model.settings.colors.door = pal.door;
        model.settings.colors.shutter = pal.shutter;
      }
    }
    const matOk = (id) => { try { return !!(HA.matById && HA.matById(model, id, null)); } catch (e) { return true; } };
    if (F.siding) {
      if (matOk(F.siding)) model.settings.surfaces.exteriorWall = F.siding;
      else notes.push('unknown siding id "' + F.siding + '" — kept the style siding.');
    }
    if (F.roofMat) {
      if (matOk(F.roofMat)) model.settings.surfaces.roof = F.roofMat;
      else notes.push('unknown roof material id "' + F.roofMat + '" — kept the style roofing.');
    }
    if (F.trim) model.settings.colors.trim = F.trim;
    if (F.door) model.settings.colors.door = F.door;
    if (F.shutter) model.settings.colors.shutter = F.shutter;
    if (HA.clearTextureCaches) { try { HA.clearTextureCaches(); } catch (e) {} }
    if (wants.length) {
      if (!(HA.rooms && HA.rooms.detectRooms && HA.rooms.upsertRoomForRegion)) {
        notes.push('per-room floors need the room engine (browser build).');
      } else {
        const gen0 = (model._genRooms && model._genRooms[0]) || [];
        for (const w of wants) {
          const gr = gen0.find((r) => r.name === w.name);
          if (!gr) { notes.push('room "' + w.name + '" not found for its floor finish.'); continue; }
          const cx = (gr.x0 + gr.x1) / 2, cy = (gr.y0 + gr.y1) / 2;
          try {
            let region = null;
            for (const rg of (HA.rooms.detectRooms(model, 0) || []))
              if (rg.poly && HA.U.pointInPoly({ x: cx, y: cy }, rg.poly)) { region = rg; break; }
            if (!region) { notes.push('room "' + w.name + '" region not detected — floor finish skipped.'); continue; }
            const room = HA.rooms.upsertRoomForRegion(model, 0, region, {});
            if (room) room.finishes = Object.assign({}, room.finishes, { floor: w.floor });
          } catch (e) { notes.push('floor finish failed on "' + w.name + '": ' + (e.message || e)); }
        }
      }
    }
    return notes;
  };

  /* WINDOW TYPES (v2.1): re-stamp the generated windows — plan-wide
     type/grid, overridable per room. Small privacy lights keep their plain
     treatment under a PLAN-wide override (the style rule); an explicit
     per-room spec wins everywhere in that room. SIZES stay engine-derived
     (egress guaranteed) — this is type/grid only. */
  const applyWindows = (model, doc) => {
    const P = doc.windows || {};
    const wants = doc.rooms.filter((r) => r.windows);
    if (!P.type && !P.grid && !wants.length) return [];
    const gen0 = (model._genRooms && model._genRooms[0]) || [];
    const roomSpecs = [];
    for (const w of wants) {
      const gr = gen0.find((r) => r.name === w.name);
      if (gr) roomSpecs.push({ gr, spec: w.windows });
    }
    const stamp = (o, spec) => {
      if (spec.type) o.winType = spec.type;
      if (spec.grid) { o.grid = spec.grid; o.muntins = spec.grid !== 'none'; }
      if (o.winType === 'slider') o.slide = (o.pos % 2 < 1) ? 'left' : 'right';
    };
    for (const L of model.levels) {
      for (const w of (L.walls || [])) {
        for (const o of (w.openings || [])) {
          if (o.kind !== 'window') continue;
          const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy) || 1;
          const px = w.x1 + (dx * (o.pos || 0)) / len, py = w.y1 + (dy * (o.pos || 0)) / len;
          let spec = null;
          for (const rs of roomSpecs) {
            const g = rs.gr;
            if (px > g.x0 - 9 && px < g.x1 + 9 && py > g.y0 - 9 && py < g.y1 + 9) { spec = rs.spec; break; }
          }
          if (!spec) {
            if (o.width <= 30 && o.height <= 36) continue;   // privacy lights stay plain
            if (P.type || P.grid) spec = P; else continue;
          }
          stamp(o, spec);
        }
      }
    }
    return [];
  };

  /* DOOR STYLES (v2.5): re-stamp the generated door slabs. Front-door slab
     via the wall gen marked (_frontDoorWallId); interior swung doors found
     geometrically — a door is interior when BOTH sides of its wall land
     inside generated rooms. French pairs (doubleDoor, full-glass leaves) go
     on the named rooms' swung doors, widened to 60" where the wall allows —
     everything else keeps engine-derived widths. */
  const applyDoors = (model, doc) => {
    const D = doc.doors;
    if (!D) return [];
    const notes = [];
    const gen0 = (model._genRooms && model._genRooms[0]) || [];
    const inRoom = (px, py) => gen0.some((g) => px > g.x0 - 2 && px < g.x1 + 2 && py > g.y0 - 2 && py < g.y1 + 2);
    const frenchRects = [];
    for (const n of D.french) {
      const g = gen0.find((r) => r.name === n);
      if (g) frenchRects.push(g);
      else notes.push('doors.french: room "' + n + '" is not in the generated plan.');
    }
    for (const L of model.levels) {
      for (const w of (L.walls || [])) {
        if (!w.openings || !w.openings.length) continue;
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        for (const o of w.openings) {
          if (o.kind !== 'door' || (o.doorType && o.doorType !== 'hinged')) continue;
          const px = w.x1 + (dx * (o.pos || 0)) / len, py = w.y1 + (dy * (o.pos || 0)) / len;
          const interior = inRoom(px + nx * 9, py + ny * 9) && inRoom(px - nx * 9, py - ny * 9);
          if (interior) {
            if (D.interior) o.style = D.interior;
            if (frenchRects.some((g) => px > g.x0 - 9 && px < g.x1 + 9 && py > g.y0 - 9 && py < g.y1 + 9)) {
              o.doubleDoor = true;
              o.style = 'full_glass';                        // a French pair reads as glass
              o.width = Math.max(o.width, Math.min(60, (HA.wallLen ? HA.wallLen(w) : len) - 12));
              if (HA.clampOpening) HA.clampOpening(w, o);
            }
          } else if (D.front && w.id === L._frontDoorWallId) {
            o.style = D.front;
          }
        }
      }
    }
    return notes;
  };

  /* KITCHEN selection (v2.2): re-run the kitchen designer with the authored
     scheme (named cabinet/counter/appliance set or index), island, tier and
     seed. The designer clears its prior pass, so this is a clean re-theme. */
  const applyKitchen = (model, doc) => {
    const K = doc.kitchen;
    if (!K) return { notes: [], report: null };
    if (!(HA.kitchen && HA.kitchen.design))
      return { notes: ['kitchen designer unavailable (browser build).'], report: null };
    try {
      const opts = {};
      if (K.scheme != null) opts.scheme = K.scheme;
      if (K.island) opts.island = K.island;
      if (K.diagonal) opts.islandDiagonal = true;
      if (K.tier) opts.tier = K.tier;
      if (K.seed != null) opts.seed = K.seed;
      const rep = HA.kitchen.design(model, 0, opts);
      if (!rep || rep.ok === false)
        return { notes: ['kitchen design: ' + ((rep && rep.reason) || 'failed') + '.'], report: null };
      return { notes: [], report: { layout: rep.layout || rep.layoutName || null, scheme: rep.scheme || null, tier: rep.tier || null } };
    } catch (e) { return { notes: ['kitchen design failed: ' + (e.message || e)], report: null }; }
  };

  /* PER-BATH TIERS (v2.2): probe-before-commit — the R182 lesson. The
     master program only applies when the room can actually host it; a
     refusal keeps the standard bath and says so honestly. */
  const applyBaths = (model, doc) => {
    const wants = doc.rooms.filter((r) => r.bath);
    if (!wants.length) return { notes: [], reports: [] };
    if (!(HA.bathroom && HA.bathroom.design && HA.bathroom.variants))
      return { notes: ['bath designer unavailable (browser build).'], reports: [] };
    const notes = [], reports = [];
    for (const w of wants) {
      try {
        const probe = HA.bathroom.variants(model, 0, { room: w.name, scheme: 0, tier: w.bath });
        if (!probe || probe.ok === false || !Array.isArray(probe.list) || !probe.list.length) {
          notes.push('the ' + w.bath + ' program doesn\'t fit "' + w.name + '" — kept the standard bath.');
          continue;
        }
        const rep = HA.bathroom.design(model, 0, { room: w.name, variant: 0, scheme: 0, tier: w.bath });
        if (rep && rep.ok !== false) reports.push({ room: w.name, tier: w.bath });
        else notes.push('bath design failed on "' + w.name + '".');
      } catch (e) { notes.push('bath design failed on "' + w.name + '": ' + (e.message || e)); }
    }
    return { notes, reports };
  };

  /* ELECTRICAL SERVICE (v2.3): the full auto pass (code-spaced devices +
     circuits + panel), then the main frame — 'auto' load-sizes it, an
     explicit frame is honored with an honest under-size warning from the
     NEC load calc. UNDERGROUND service is recorded as the service spec
     (the engine doesn't model the lateral geometry yet — honest note). */
  const applyElectrical = (model, doc) => {
    const E = doc.electrical;
    if (!E) return { notes: [], report: null };
    const notes = [];
    if (!(HA.autoplace && HA.autoplace.applyAutoElectrical && HA.electrical))
      return { notes: ['electrical engine unavailable (browser build).'], report: null };
    try {
      HA.autoplace.applyAutoElectrical(model);
      // the device pass alone doesn't create the SERVICE record — ensure does
      if (!(model.electrical && model.electrical.service) && HA.electrical.ensure)
        HA.electrical.ensure(model);
      if (!(model.electrical && model.electrical.service))
        return { notes: ['electrical service could not be created.'], report: null };
      let amps = null;
      if (E.main === 'auto') {
        const r = HA.electrical.autoSizeMain(model);
        amps = (r && r.amps) || (model.electrical && model.electrical.service && model.electrical.service.mainAmps) || null;
      } else {
        const calc = HA.electrical.loadCalc ? HA.electrical.loadCalc(model) : null;
        if (calc && calc.requiredAmps > E.main)
          notes.push('the NEC load calc wants ≥' + Math.ceil(calc.requiredAmps) + 'A — a ' + E.main + 'A main is undersized for this house.');
        if (model.electrical && model.electrical.service) {
          model.electrical.service.mainAmps = E.main;
          const p = (model.electrical.panels && model.electrical.panels[0]) || null;
          if (p) { p.amps = E.main; p.name = E.main + 'A MAIN'; }
        }
        amps = E.main;
      }
      if (E.underground && model.electrical && model.electrical.service) {
        model.electrical.service.serviceDrop = 'underground';
        notes.push('underground service recorded as the service spec — the lateral itself isn\'t drawn yet (roadmap).');
      }
      return { notes, report: { mainAmps: amps, underground: !!E.underground } };
    } catch (e) { return { notes: ['electrical design failed: ' + (e.message || e)], report: null }; }
  };

  /* SOLAR (v2.3): the PV designer places a real array on the ranked roof
     faces. kw converts to a module count at the designer's nameplate watt;
     an explicit count wins; neither = the T24 mandate target. */
  const applySolar = (model, doc) => {
    const S = doc.solar;
    if (!S) return { notes: [], report: null };
    if (!(HA.solar && HA.solar.autoDesign))
      return { notes: ['solar designer unavailable (browser build).'], report: null };
    try {
      const watt = (HA.solar.config && HA.solar.config.PANEL_WATT) || 400;
      const notes = [];
      const opts = {};
      if (S.count != null) opts.count = S.count;
      else if (S.kw != null) opts.count = Math.max(1, Math.round((S.kw * 1000) / watt));
      if (S.align) opts.align = S.align;
      // v2.6 FACES PIN: resolve the author's plan edges (front/back/left/
      // right) to WORLD shed-directions via the R185 edge stamps — centroid
      // toward the named side's midpoint, so a street-rotated frame still
      // aims true. The engine excludes every unpinned plane.
      if (S.faces && S.faces.length) {
        const cls = model._rcEdges;
        let cx = 0, cy = 0, n = 0;
        for (const k of ['front', 'back', 'left', 'right'])
          for (const s of (cls && cls[k]) || []) { cx += (s.x1 + s.x2) / 2; cy += (s.y1 + s.y2) / 2; n++; }
        if (n) { cx /= n; cy /= n; }
        const pins = [];
        for (const w of S.faces) {
          const segs = cls && cls[w];
          if (!n || !segs || !segs.length) { notes.push('solar.faces: no "' + w + '" plan edge to aim at — pin skipped.'); continue; }
          let mx = 0, my = 0;
          for (const s of segs) { mx += (s.x1 + s.x2) / 2; my += (s.y1 + s.y2) / 2; }
          mx /= segs.length; my /= segs.length;
          const L = Math.hypot(mx - cx, my - cy) || 1;
          pins.push({ dir: { x: (mx - cx) / L, y: (my - cy) / L } });
        }
        if (pins.length) opts.faces = pins;
      }
      const design = HA.solar.autoDesign(model, opts);
      if (!design || !Array.isArray(design.panels) || !design.panels.length)
        return { notes: notes.concat(['solar: no eligible roof face fit an array' + (design && design.meta && design.meta.reason ? ' (' + design.meta.reason + ')' : '') + '.']), report: null };
      design.enabled = true;
      model.solar = design;
      if (design.meta && design.meta.capacityLimited && S.faces && S.faces.length)
        notes.push('solar: the pinned faces hold ' + design.panels.length + ' of the ' + (design.meta.requested || '?') + ' requested modules.');
      const kw = (design.meta && Number.isFinite(design.meta.systemKw)) ? design.meta.systemKw
        : Math.round((design.panels.length * watt) / 100) / 10;
      return { notes, report: {
        panels: design.panels.length, kw,
        planes: [...new Set(design.panels.map((p) => p.faceId))].length,
        align: (design.meta && design.meta.align) || 'left',
      } };
    } catch (e) { return { notes: ['solar design failed: ' + (e.message || e)], report: null }; }
  };

  /* BACKYARD package (v2.4): the parametric yard designer lays the whole
     rear yard — archetype furniture/beds/trees, the pool with its apron +
     poolside lounge, keep-outs respected. Idempotent (clears its prior
     pass); hand-placed features are never touched. */
  const applyYard = (model, doc) => {
    const Y = doc.backyard;
    if (!Y) return { notes: [], report: null };
    if (!(HA.backyard && HA.backyard.design))
      return { notes: ['backyard designer unavailable (browser build).'], report: null };
    try {
      const rep = HA.backyard.design(model, {
        seed: Y.seed != null ? Y.seed : 7,
        pool: Y.pool || 'off',
        archetype: Y.archetype || undefined,
        scheme: Y.scheme != null ? Y.scheme : undefined,
      });
      if (!rep || rep.ok === false)
        return { notes: ['backyard design: ' + ((rep && rep.reason) || 'failed') + '.'], report: null };
      const feats = ((model.site && model.site.features) || []).filter((f) => f && f._gen && (f.backyard || f.poolside));
      return { notes: (rep.warnings || []).map((w) => 'backyard: ' + w), report: {
        archetype: rep.archetype || Y.archetype || null,
        pool: !!rep.pool, features: feats.length,
      } };
    } catch (e) { return { notes: ['backyard design failed: ' + (e.message || e)], report: null }; }
  };

  /* ---------- build: document -> house ---------- */
  RC.build = (model, docIn, opts) => {
    opts = opts || {};
    const rep = RC.validate(docIn);
    if (!rep.ok) throw new Error('roomcode: ' + rep.errors.join(' · '));
    const doc = RC.normalize(docIn);
    // deterministic per-document seed (same plan = same house), opts.seed wins
    let seed = opts.seed;
    if (!Number.isFinite(seed)) {
      seed = 0;
      const s = doc.name + ':' + doc.rooms.length;
      for (let i = 0; i < s.length; i++) seed = ((seed * 31) + s.charCodeAt(i)) >>> 0;
    }
    if (doc.ceiling) model.settings.wallHeight = doc.ceiling;
    const beds = doc.rooms.filter((r) => r.kind === 'bed').length;
    const baths = doc.rooms.filter((r) => r.kind === 'bath').length;
    HA.generator.generate(model, Object.assign({}, opts, {
      mode: doc.mode, style: doc.style, seed,
      beds: Math.max(doc.mode === 'adu' ? 0 : 2, beds), baths: Math.max(1, baths),
      garage: 'none',                       // an authored garage is a ROOM, not a reservation
      hvac: doc.hvac || opts.hvac,
      _roomcode: doc,
    }));
    const roofNotes = applyRoofIntent(model, doc.roof);
    const ceilNotes = applyRoomCeilings(model, doc);
    const cpNotes = applyCarport(model, doc);
    const finNotes = applyFinishes(model, doc);
    const winNotes = applyWindows(model, doc);
    const doorNotes = applyDoors(model, doc);
    const kit = applyKitchen(model, doc);
    const bathRes = applyBaths(model, doc);
    const elec = applyElectrical(model, doc);
    const sol = applySolar(model, doc);
    const yard = applyYard(model, doc);
    const warnings = rep.warnings.concat(roofNotes, ceilNotes, cpNotes, finNotes, winNotes,
      doorNotes, kit.notes, bathRes.notes, elec.notes, sol.notes, yard.notes);
    const stats = {
      plan: doc.name, rooms: doc.rooms.length, beds, baths,
      seed, style: doc.style, mode: doc.mode,
      hvac: (model.mech && model.mech.system) || null,
      roof: { form: doc.roof.form, pitch: model.roof && model.roof.pitch },
      kitchen: kit.report, bathUpgrades: bathRes.reports,
      electrical: elec.report, solar: sol.report, backyard: yard.report,
      doors: doc.doors ? { front: doc.doors.front, interior: doc.doors.interior,
        french: doc.doors.french.length } : null,
    };
    return { ok: true, warnings, stats };
  };
})();
