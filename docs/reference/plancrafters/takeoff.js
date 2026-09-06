/* ============================================================
   PlanCrafters — takeoff.js  (HA.takeoff)
   MATERIAL QUANTITY TAKEOFF derived from the REAL generated
   framing (HA.framing.all → members {a,b,w,h,kind} with 3D
   axes in INCHES). We count the ACTUAL members the assembly
   produced — studs/plates/headers/joists/rafters/etc are
   already laid out to the wall CENTERLINES at 16"/24" o.c.,
   so we do NOT re-estimate piece counts; we bin them by
   nominal size + stock length and sum board-feet. Sheathing,
   drywall and fasteners ARE derived (sheet/area/spacing math)
   because the framing layer carries no panel objects.

   Every number is DRAFT / preliminary [STAMP] — a real
   estimate needs a takeoff-by-a-human against stamped plans
   with local waste/coverage factors. Notes flag the rules of
   thumb and the code sections behind each derived count.

   Sources / conventions cited inline:
   - Board feet = (T_in × W_in × L_in) / 144  (T×W×L_ft/12).
     omnicalculator.com/construction/board-foot;
     inchcalculator.com/board-footage-calculator
   - Sheathing/drywall: 4×8 sheet = 32 sf; sheets = area/32 + waste.
     iambuilders.com/.../how-to-calculate-lumber-quantities-...;
     ibeam.ai/blog/lumber-takeoff-estimation-steps
   - Anchor bolts: IRC R403.1.6 — 1/2"Ø max 6'-0" o.c., ≥2 per
     plate section, ≤12" from each end → bolts/run = ceil(L/72)+1.
     up.codes/s/foundation-anchorage; codes.iccsafe.org IRC2021 R403.1.6
   - Hold-downs: at braced-wall-panel ends (HA.bracewalls) — DRAFT
     placement aid, NOT an IRC/ASCE lateral design.
   - Framing nails ≈ 22 lb per 1000 bf framed (trade rule of thumb).
     contractortalk.com Estimating Fasteners; armyengineer EN5155
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;
  const U = HA.U;

  const API = (HA.takeoff = {});

  /* ---- constants ---- */
  const SHEET_SF = 32;           // 4'×8' panel = 32 sf coverage
  const WASTE_SHEATHING = 1.10;  // +10% cut/waste on panel goods
  const WASTE_DRYWALL = 1.10;
  const NAIL_LB_PER_MBF = 22;    // ~22 lb framing nails / 1000 bf (rule of thumb)
  const SHEATHING_NAILS_PER_SHEET = 60; // ~6" edge / 12" field pattern
  const STOCK_FT = [8, 10, 12, 14, 16, 20]; // common dimensional lumber lengths

  /* true 3D member length in inches (members carry z on a/b) */
  const memLenIn = (m) => {
    const dz = (m.b.z || 0) - (m.a.z || 0);
    return Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y, dz);
  };

  /* nominal lumber size from the member cross-section (w×h in inches).
     The framing layer uses dressed dims: 1.5 (2x), 3.5 (4x/2x4 face),
     5.5 (2x6), 7.25 (2x8), 9.25 (2x10), 11.25 (2x12). We map the two
     dressed dims to a nominal "AxB" by snapping each to its nominal. */
  const NOM = [
    [1.5, 2], [3.5, 4], [5.5, 6], [7.25, 8], [9.25, 10], [11.25, 12],
  ];
  const nomOf = (dressed) => {
    let best = 2, bd = 1e9;
    for (const [d, n] of NOM) {
      const e = Math.abs(dressed - d);
      if (e < bd) { bd = e; best = n; }
    }
    return best;
  };
  /* canonical "2x4" style label, smaller nominal first (lumber convention) */
  const sizeLabel = (m) => {
    const a = nomOf(m.w), b = nomOf(m.h);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return lo + 'x' + hi;
  };
  /* dressed cross-section area (sq in) for board-feet (true volume) */
  const xsecSqIn = (m) => m.w * m.h;

  /* round a member length UP to the next stock length (ft), capped at 20.
     A 17' rafter buys a 20' stick; we record both ordered + actual bf. */
  const stockFtFor = (lenFt) => {
    for (const s of STOCK_FT) if (lenFt <= s + 1e-6) return s;
    return STOCK_FT[STOCK_FT.length - 1]; // long members: longest stock (splice IRL)
  };

  /* board feet of a single member from its DRESSED volume:
     bf = (w_in × h_in × L_in) / 144. (Trade convention prices nominal,
     but volume billed off dressed here keeps it tied to real geometry;
     we expose nominal size separately for ordering.) */
  const memBoardFt = (m) => (xsecSqIn(m) * memLenIn(m)) / 144;

  /* member kinds that are dimensional LUMBER we bin into the lumber list.
     Excludes panel/footing/decking/rail cosmetic members. */
  const LUMBER_KINDS = new Set([
    'plate', 'stud', 'cripple', 'king', 'trimmer', 'header', 'sill',
    'mudsill', 'rim', 'joist', 'cjoist', 'girder', 'rafter', 'ridge', 'hip', 'valley',
    'beam', 'post', 'ledger', 'blocking',
  ]);

  /* ---- gross exterior wall surface area (sf) for wall sheathing ----
     Centerline length × wall height, summed over all exterior walls,
     all levels. Openings are NOT deducted (sheathing is installed over
     openings then cut out — conventional takeoff keeps gross). */
  const wallSheathingSf = (model) => {
    let sf = 0;
    for (let i = 0; i < model.levels.length; i++) {
      const H = model.levels[i].height || model.settings.wallHeight || 96;
      for (const w of model.levels[i].walls || []) {
        if (!HA.isExt(w)) continue;
        if (HA.isLow && HA.isLow(w)) continue; // pony walls: skip
        // SIP walls: the OSB skins ARE the panel — no site sheathing to buy
        if ((HA.WALL_TYPES[w.type] || {}).sip) continue;
        sf += (HA.wallLen(w) * H) / 144;
      }
    }
    return sf;
  };

  /* ---- SIP panel takeoff ----
     Panels are bought as blanks covering the GROSS wall face (openings are
     factory-cut out — same sheathe-over convention as wall sheathing), in 4'
     modules × wall height. Splines come from the drawn kind:'spline' members
     (surface-spline OSB stock — NOT dimensional lumber, so they are billed
     here, not in the lumber bins). Screws/sealant/tape are trade allowances:
       • SIP screws @ 12" o.c. top+bottom plate rows (2 rows × wall LF) +10%
       • sealant: continuous beads both sides of both plates (4 × wall LF)
         + 2 beads per spline joint (2 × spline LF)
       • tape: every joint, interior + exterior (2 × spline LF) + plate line */
  const sipTakeoff = (model, members) => {
    let panelSf = 0, wallLf = 0, panelCount = 0;
    for (let i = 0; i < model.levels.length; i++) {
      const H = model.levels[i].height || model.settings.wallHeight || 96;
      for (const w of model.levels[i].walls || []) {
        if (!((HA.WALL_TYPES[w.type] || {}).sip)) continue;
        if (HA.isLow && HA.isLow(w)) continue;
        const len = HA.wallLen(w);
        panelSf += (len * H) / 144;
        wallLf += len / 12;
        panelCount += Math.ceil(len / 48);      // 4'-wide factory modules
      }
    }
    if (!(panelSf > 0)) return null;
    let splineLf = 0;
    for (const m of members) if (m.kind === 'spline') splineLf += memLenIn(m) / 12;
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      panelSf: Math.round(panelSf),
      panelCount,
      wallLf: r1(wallLf),
      splineLf: r1(splineLf),
      screwsEa: Math.ceil(wallLf * 2 * 1.10),
      sealantLf: r1(wallLf * 4 + splineLf * 2),
      tapeLf: r1(wallLf + splineLf * 2),
    };
  };

  /* interior partition surface (BOTH faces) + ceiling area for drywall.
     Interior walls get gyp on two sides; exterior walls get one interior
     face. Ceiling = top-level exterior loop footprint. */
  const drywallSf = (model) => {
    let wallFaces = 0;
    for (let i = 0; i < model.levels.length; i++) {
      const H = model.levels[i].height || model.settings.wallHeight || 96;
      for (const w of model.levels[i].walls || []) {
        if (HA.isLow && HA.isLow(w)) continue;
        const oneFace = (HA.wallLen(w) * H) / 144;
        wallFaces += HA.isExt(w) ? oneFace : oneFace * 2; // int = 2 faces
      }
    }
    // ceiling at every level's footprint (lid of each story)
    let ceilSf = 0;
    for (let i = 0; i < model.levels.length; i++) {
      const loop = HA.exteriorLoop && HA.exteriorLoop(model, i);
      if (loop && loop.pts && loop.pts.length >= 3)
        ceilSf += Math.abs(U.polyArea(loop.pts)) / 144;
    }
    return { wallFaces, ceilSf, total: wallFaces + ceilSf };
  };

  /* sloped roof-plane area (sf) for roof sheathing — true rake area
     (footprint × √(1+slope²)) over the merged slope faces. */
  const roofSheathingSf = (model, roofData) => {
    if (!roofData || !roofData.ok) return 0;
    const faces = (HA.mergeRoofPlanes ? HA.mergeRoofPlanes(roofData) : roofData.faces) || [];
    let sf = 0;
    for (const f of faces) {
      if (f.kind !== 'slope' || !f.poly2 || f.poly2.length < 3) continue;
      const flat = Math.abs(U.polyArea(f.poly2)) / 144;
      const slope = Math.hypot(f.coef ? f.coef.A : 0, f.coef ? f.coef.B : 0);
      sf += flat * Math.sqrt(1 + slope * slope);
    }
    return sf;
  };

  /* elevated floor-platform sheathing (subfloor) for levels >= 1, plus the
     ground-floor footprint as a slab/subfloor allowance. Footprint area. */
  const floorSheathingSf = (model) => {
    let sf = 0;
    for (let i = 0; i < model.levels.length; i++) {
      const loop = HA.exteriorLoop && HA.exteriorLoop(model, i);
      if (loop && loop.pts && loop.pts.length >= 3)
        sf += Math.abs(U.polyArea(loop.pts)) / 144;
    }
    return sf;
  };

  const sheetsFromSf = (sf, waste) =>
    sf <= 0 ? 0 : Math.ceil((sf * (waste || 1)) / SHEET_SF);

  /* ---- anchor bolts + washers (IRC R403.1.6) ----
     Counted DIRECTLY from the drawn 'anchor' members (framing.js emits them via
     the shared F.anchorPositions rule for both the raised mudsill and slab bottom
     plates), so the BOM always matches the plan exactly — the old re-estimate
     from plate lengths could disagree with the drawing (AUDIT #8). Each bolt
     carries one nut + plate washer (square-plate per CRC for shear walls). */
  const anchorsFromPlates = (model, members) => {
    let anchors = 0;
    for (const m of members) if (m.kind === 'anchor') anchors++;
    return { anchorsQty: anchors, washersQty: anchors, plateRuns: 0 };
  };

  /* ---- hold-downs at braced-wall-panel ends (DRAFT placement aid) ----
     One hold-down at each END of every braced panel HA.bracewalls placed.
     This is a drafting count, NOT an engineered lateral schedule. */
  const holdDownsFrom = (model) => {
    let ends = 0;
    if (typeof HA.bracewalls === 'function') {
      for (let i = 0; i < model.levels.length; i++) {
        const panels = HA.bracewalls(model, i) || [];
        ends += panels.length * 2; // a HDU at each panel end
      }
    }
    // typical residential mix: model all as HDU5-class for the draft BOM
    return ends > 0
      ? [{ type: 'HDU (typ.) — DRAFT', qty: ends }]
      : [];
  };

  /* ---- flooring sf by "room" ----
     The model carries no room polygons, so we approximate per-level finished
     floor as the exterior footprint MINUS exterior-wall thickness band is
     out of scope; we report finished floor per LEVEL (the unit the model can
     actually give) keyed 'Level N'. Honest: not a room-by-room plan takeoff. */
  const flooringByRoom = (model) => {
    const out = {};
    for (let i = 0; i < model.levels.length; i++) {
      const loop = HA.exteriorLoop && HA.exteriorLoop(model, i);
      if (loop && loop.pts && loop.pts.length >= 3) {
        const name = (model.levels[i].name) || ('Level ' + (i + 1));
        out[name] = Math.round((Math.abs(U.polyArea(loop.pts)) / 144) * 10) / 10;
      }
    }
    return out;
  };

  /* ============================================================
     materialTakeoff(model[, roofData]) → full BOM
     ============================================================ */
  API.materialTakeoff = (model, roofData) => {
    if (!model || !Array.isArray(model.levels))
      return { ok: false, reason: 'no model', draft: true };

    // resolve roof (build if not supplied + enabled)
    if (roofData === undefined) {
      try {
        roofData = model.roof && model.roof.enabled && HA.buildRoof
          ? HA.buildRoof(model) : null;
      } catch (e) { roofData = null; }
    }

    // REAL framing members (includes deck framing — see F.all)
    let members = [];
    try { members = HA.framing.all(model, roofData) || []; }
    catch (e) { members = []; }

    /* ---- lumber list: bin by (size, stock length) ---- */
    const bin = new Map(); // key size|stockFt -> {size,lengthFt,qty,boardFt}
    let totalBf = 0;
    for (const m of members) {
      if (!LUMBER_KINDS.has(m.kind)) continue;
      const Lin = memLenIn(m);
      if (Lin < 1.5) continue; // skip degenerate
      const lenFt = Lin / 12;
      const stock = stockFtFor(lenFt);
      // Headers are billed as a conventional built-up 4x assembly (3.5" wide,
      // depth by span) so the BOM label + board-feet match the door/window
      // schedule's HA.openingHeader (4x6/4x8/4x10). Without this, a header in a
      // 2×6 wall (member w=5.5") binned as 6x* and over-billed bf ~57% high.
      const isHeader = m.kind === 'header';
      // bill a header from its SCHEDULED nominal depth (m.hdr, tagged in
      // framing.js) so the BOM matches the door/window schedule + plan callout;
      // m.h is the wall-clipped member depth and would under-bill a tall opening
      // in a standard-height wall. Fall back to the member depth if untagged.
      const hDepth = isHeader ? (m.hdr && HA.headerDepth ? HA.headerDepth(m.hdr) : m.h) : 0;
      const size = isHeader ? (m.hdr || ('4x' + nomOf(hDepth))) : sizeLabel(m);
      const key = size + '|' + stock;
      if (!bin.has(key))
        bin.set(key, { size, lengthFt: stock, qty: 0, boardFt: 0 });
      const row = bin.get(key);
      row.qty++;
      const bf = isHeader ? (3.5 * hDepth * Lin) / 144 : memBoardFt(m);
      row.boardFt += bf;
      totalBf += bf;
    }
    /* ---- fire / solid BLOCKING linear feet ----
       Solid 2x blocking between floor-joist bays (CRC R302.11 fireblocking /
       R502.7 lateral restraint) + roof ledger backing blocking + gable-end
       outlookers are all kind:'blocking'. Report their true 3D run as LINEAR
       FEET (the trade orders blocking by LF, cut from stock) IN ADDITION to the
       board-feet already binned into the lumber list above. */
    let blockingLf = 0;
    for (const m of members)
      if (m.kind === 'blocking') blockingLf += memLenIn(m) / 12;
    blockingLf = Math.round(blockingLf * 10) / 10;

    const lumber = [...bin.values()]
      .map((r) => ({ ...r, boardFt: Math.round(r.boardFt * 10) / 10 }))
      .sort((a, b) =>
        a.size === b.size ? a.lengthFt - b.lengthFt
          : (nomOf2(a.size) - nomOf2(b.size)) || a.size.localeCompare(b.size));

    /* ---- sheathing ---- */
    const wallSf = wallSheathingSf(model);
    const roofSf = roofSheathingSf(model, roofData);
    const floorSf = floorSheathingSf(model);
    const sheathing = {
      wallSheets: sheetsFromSf(wallSf, WASTE_SHEATHING),
      roofSheets: sheetsFromSf(roofSf, WASTE_SHEATHING),
      floorSheets: sheetsFromSf(floorSf, WASTE_SHEATHING),
      wallSf: Math.round(wallSf),
      roofSf: Math.round(roofSf),
      floorSf: Math.round(floorSf),
    };
    const totalSheets =
      sheathing.wallSheets + sheathing.roofSheets + sheathing.floorSheets;

    /* ---- drywall ---- */
    const dw = drywallSf(model);
    const drywall = {
      sheets: sheetsFromSf(dw.total, WASTE_DRYWALL),
      sqft: Math.round(dw.total),
      wallSf: Math.round(dw.wallFaces),
      ceilingSf: Math.round(dw.ceilSf),
    };

    /* ---- fasteners ---- */
    const framingNailsLb =
      Math.round(((totalBf / 1000) * NAIL_LB_PER_MBF) * 10) / 10;
    const anchors = anchorsFromPlates(model, members);
    const fasteners = {
      framingNailsLb,
      sheathingNails: (totalSheets * SHEATHING_NAILS_PER_SHEET),
      anchorsQty: anchors.anchorsQty,
      washersQty: anchors.washersQty,
    };

    /* ---- hold-downs + flooring ---- */
    const holdDowns = holdDownsFrom(model);
    const flooringSqftByRoom = flooringByRoom(model);

    /* ---- SIP panels (walls typed WALL_TYPES[..].sip) ---- */
    const sip = sipTakeoff(model, members);

    /* ---- grand bill of materials (flat orderable list) ---- */
    const bom = [];
    for (const r of lumber)
      bom.push({
        item: r.size + ' × ' + r.lengthFt + "' lumber",
        qty: r.qty, unit: 'pcs', boardFt: r.boardFt,
      });
    if (sheathing.wallSheets)
      bom.push({ item: 'Wall sheathing (7/16" OSB 4×8)', qty: sheathing.wallSheets, unit: 'sheets' });
    if (sheathing.roofSheets)
      bom.push({ item: 'Roof sheathing (1/2" CDX 4×8)', qty: sheathing.roofSheets, unit: 'sheets' });
    if (sheathing.floorSheets)
      bom.push({ item: 'Subfloor (3/4" T&G 4×8)', qty: sheathing.floorSheets, unit: 'sheets' });
    if (drywall.sheets)
      bom.push({ item: 'Drywall (1/2" gyp 4×8)', qty: drywall.sheets, unit: 'sheets' });
    if (fasteners.framingNailsLb)
      bom.push({ item: 'Framing nails (16d)', qty: fasteners.framingNailsLb, unit: 'lb' });
    if (fasteners.sheathingNails)
      bom.push({ item: 'Sheathing nails (8d)', qty: fasteners.sheathingNails, unit: 'ea' });
    if (fasteners.anchorsQty)
      bom.push({ item: 'Anchor bolts 1/2"Ø (IRC R403.1.6)', qty: fasteners.anchorsQty, unit: 'ea' });
    if (fasteners.washersQty)
      bom.push({ item: 'Plate washers + nuts', qty: fasteners.washersQty, unit: 'ea' });
    for (const h of holdDowns)
      bom.push({ item: 'Hold-down ' + h.type, qty: h.qty, unit: 'ea' });
    if (blockingLf)
      bom.push({ item: 'Fire / solid blocking (2x, CRC R302.11 / R502.7)', qty: blockingLf, unit: 'lf' });
    if (sip) {
      bom.push({ item: 'SIP wall panels (7/16" OSB / EPS / 7/16" OSB) — ' + sip.panelCount + ' modules @ 4\' w', qty: sip.panelSf, unit: 'sf' });
      if (sip.splineLf)
        bom.push({ item: 'SIP surface splines (OSB stock, pairs) + 8d @ 6" o.c.', qty: sip.splineLf, unit: 'lf' });
      bom.push({ item: 'SIP screws (panel-to-plate, per mfr schedule)', qty: sip.screwsEa, unit: 'ea' });
      bom.push({ item: 'SIP sealant (continuous beads, plates + joints)', qty: sip.sealantLf, unit: 'lf' });
      bom.push({ item: 'SIP tape (joints, int + ext per climate/mfr)', qty: sip.tapeLf, unit: 'lf' });
    }

    /* ---- subtotals ---- */
    const subtotals = {
      lumberPieces: lumber.reduce((s, r) => s + r.qty, 0),
      lumberBoardFt: Math.round(totalBf),
      sheathingSheets: totalSheets,
      drywallSheets: drywall.sheets,
      anchorsQty: fasteners.anchorsQty,
      holdDownsQty: holdDowns.reduce((s, h) => s + h.qty, 0),
      blockingLf,
      memberCount: members.length,
    };
    if (sip) {
      subtotals.sipPanelSf = sip.panelSf;
      subtotals.sipSplineLf = sip.splineLf;
    }

    const out = {
      ok: true,
      draft: true,
      stamp: 'DRAFT — preliminary takeoff, not for bid. Verify against '
        + 'stamped plans + local waste/coverage factors.',
      lumber,
      sheathing,
      drywall,
      fasteners,
      holdDowns,
      flooringSqftByRoom,
      bom,
      subtotals,
      notes: [
        'Lumber piece counts come from the ACTUAL framing the model '
          + 'generated (studs/plates/headers/joists/rafters at 16"/24" '
          + 'o.c. to wall CENTERLINES) — not re-estimated.',
        'Board feet billed off DRESSED member volume (w×h×L/144); order '
          + 'by the nominal size + stock length shown.',
        'Lengths rounded UP to common stock (8–20 ft); members >20 ft '
          + 'assume a field splice.',
        'Sheathing = surface area / 32 sf per 4×8 sheet, +10% waste; '
          + 'openings NOT deducted (sheathe-over-then-cut).',
        'Drywall counts interior partitions on BOTH faces + ceilings.',
        'Framing nails ≈ ' + NAIL_LB_PER_MBF + ' lb / 1000 bf (rule of thumb).',
        'Anchor bolts per IRC R403.1.6: 1/2"Ø, ≤6\'-0" o.c., ≥2/plate, '
          + '≤12" from ends — DRAFT count from sole plates.',
        'Hold-downs placed at braced-wall-panel ends (HA.bracewalls) — '
          + 'a DRAFTING aid, NOT an engineered lateral schedule.',
        'Fire / solid blocking (2x) between floor-joist bays at <=8\'-0" o.c. '
          + 'per CRC R302.11 (fireblocking) / R502.7 (lateral restraint); '
          + 'reported as blockingLf linear feet (also in the lumber board-feet).',
        'flooringSqftByRoom is per-LEVEL footprint (model carries no room '
          + 'polygons); not a room-by-room finish takeoff.',
      ],
    };
    if (sip) {
      out.sip = sip;
      out.notes.push(
        'SIP walls: panel SF is GROSS wall face (openings factory-cut from '
          + 'blanks); wall sheathing + batt insulation are EXCLUDED for SIP '
          + 'walls (the OSB skins + EPS core are part of the panel). Splines '
          + 'billed as OSB surface-spline stock, not dimensional lumber. '
          + 'Screw/sealant/tape counts are trade allowances — final fastening '
          + 'per the SIP manufacturer\'s engineered shop drawings.');
    }
    return out;
  };

  /* ---- compact roll-up view over a materialTakeoff result ----
     ADDITIVE read-only helper for the Developer-Mode per-variant costing
     (HA.devhomes.variantCost): the headline quantities a development
     roll-up carries per plan, without dragging the full BOM around.
     Same DRAFT standing as the takeoff it summarizes. */
  API.summary = (to) => {
    if (!to || to.ok !== true || !to.subtotals) return null;
    const s = to.subtotals;
    return {
      draft: true,
      lumberBoardFt: s.lumberBoardFt || 0,
      lumberPieces: s.lumberPieces || 0,
      sheathingSheets: s.sheathingSheets || 0,
      drywallSheets: s.drywallSheets || 0,
      anchorsQty: s.anchorsQty || 0,
      memberCount: s.memberCount || 0,
    };
  };

  /* helper used in the lumber sort: leading nominal of a "2x4" label */
  function nomOf2(label) {
    const n = parseInt(String(label).split('x')[0], 10);
    return Number.isFinite(n) ? n : 99;
  }
})();
