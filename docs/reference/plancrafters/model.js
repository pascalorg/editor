/* ============================================================
   Home Architect — model.js  (schema v2)
   The single source of truth. A project is a stack of LEVELS
   (each with walls, posts, decks), a materials library, an
   automatic roof + foundation, plan SHEETS, CAD BLOCKS and
   project notes. The 2D plan, the 3D solids, the framing
   engine, the sheet renderer and the AI tool API all derive
   from this one structure.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;
  const U = HA.U;

  HA.WALL_TYPES = {
    ext2x6: { label: '2×6 Exterior', t: 6.5, ext: true, stud: 5.5 },
    ext2x4: { label: '2×4 Exterior', t: 4.5, ext: true, stud: 3.5 },
    int2x4: { label: '2×4 Interior', t: 4.5, ext: false, stud: 3.5 },
    int2x6: { label: '2×6 Interior (plumbing)', t: 6.5, ext: false, stud: 5.5 },
    porch: { label: 'Porch / pony wall', t: 5.5, ext: false, stud: 3.5, low: true, defH: 36 },
    /* STRUCTURAL INSULATED PANELS (SIP) — "replace the wood with SIPs". ADDITIVE
       types only (never rename/remove: old saves self-heal on type lookup).
       `stud` = the FULL structural panel thickness (7/16" OSB skin + EPS core +
       7/16" OSB skin) so every dim / foundation / exteriorLoop consumer that
       rides the stud reference is untouched — the panel face IS the "stud face".
       `t` = stud + 1/2" gyp + 3/4" cladding (skins live INSIDE `stud`; there is
       no separate sheathing layer, and the cladding — factory-applied stucco on
       the reference GENII panels — is part of the wall box, see HA.wallT/wallClad).
       Sizes per ANSI/APA PRS 610.1 family: 6-1/2" (5-1/2" core, replaces 2x6)
       and 4-1/2" (3-1/2" core, replaces 2x4). */
    ext_sip65: { label: '6-1/2" SIP Exterior', t: 7.625, ext: true, stud: 6.375, sip: true, core: 5.5, skin: 0.4375 },
    ext_sip45: { label: '4-1/2" SIP Exterior', t: 5.625, ext: true, stud: 4.375, sip: true, core: 3.5, skin: 0.4375 },
  };
  /* nominal whole-panel R for a SIP type (EPS core ~R-3.8/in + 2 OSB skins
     ~R-0.55 ea). 6.5" → R-22, 4.5" → R-14 — matches energy.js EXT_WALL_ASSEMBLY
     ci values and assemblies.rValue so schedule/energy/stack never disagree. */
  HA.sipPanelR = (T) => Math.round((T.core || 0) * 3.8 + 2 * 0.55);
  /* schedule/detail note for a SIP wall type — single source of truth so the
     wall schedule, details and tools all print the same language. */
  HA.sipNote = (T) => {
    const frac = (v) => {
      const whole = Math.floor(v), r = v - whole;
      const f = r > 0.6 ? '3/4' : r > 0.4 ? '1/2' : r > 0.1 ? '1/4' : '';
      return whole + (f ? '-' + f : '') + '"';
    };
    return frac(T.stud + 2 * 0.0625) + ' SIP — 7/16" OSB / EPS CORE (R-' + HA.sipPanelR(T) +
      ') / 7/16" OSB, PER ANSI/APA PRS 610.1 + MFR ICC-ES REPORT. ' +
      'JOINTS: SURFACE SPLINE W/ SIP SEALANT + TAPE EA. SIDE.';
  };

  HA.TRIM_STYLES = { none: 'None', modern: 'Modern flat', colonial: 'Colonial', craftsman: 'Craftsman' };
  HA.TRIM_CASING = { none: 0, modern: 3.5, colonial: 3.5, craftsman: 4.5 };
  HA.DOOR_STYLES = {
    panel: '6-Panel', flush: 'Flush', glass: 'Half glass', full_glass: 'Full glass',
    craftsman: 'Craftsman 3-lite', plank: 'Modern plank', garage: 'Garage sectional',
  };
  HA.DOOR_TYPES = { hinged: 'Hinged', slider: 'Sliding glass', accordion: 'Accordion / bifold', garage: 'Garage overhead' };
  HA.DOOR_HANDLES = { lever: 'Lever', knob: 'Knob', bar: 'Bar pull', none: 'None' };

  /* WINDOW operation TYPES (Steve: "windows need more options — like left
     sliding, and without lites"). Each renders a distinct sash arrangement in
     3D + a distinct abstract 2D symbol. */
  HA.WINDOW_TYPES = {
    double_hung: 'Double-hung', single_hung: 'Single-hung', slider: 'Slider',
    casement: 'Casement', awning: 'Awning', picture: 'Picture / fixed',
  };
  /* GRID (muntin/lite) PATTERNS — an OPTION, not everywhere-by-default (Steve:
     "do lites go in everything?"). craftsman = divided UPPER sash only (the
     "upper lite with the middle one" Steve likes), clear lower. */
  HA.WINDOW_GRIDS = {
    none: 'None (no lites)', colonial: 'Colonial (6-lite)',
    prairie: 'Prairie (perimeter)', craftsman: 'Craftsman (upper sash)',
  };
  HA.WINDOW_SLIDE = { left: 'Left-sliding', right: 'Right-sliding' };
  /* Resolve a window's grid, honoring the legacy boolean o.muntins so old
     saves render identically: explicit o.grid wins; else muntins===true maps to
     the old 6-lite colonial look, muntins===false / unset maps to none. */
  HA.windowGrid = (o) => (o && o.grid) ? o.grid
    : (o && o.muntins === true) ? 'colonial' : 'none';
  HA.windowType = (o) => (o && o.winType) || 'double_hung';
  /* Per-STYLE fenestration defaults. Steve's honest answer: colonial grids on
     EVERYTHING is NOT normal — grids follow the architectural style. Craftsman
     gets the divided upper sash; modern/ranch run grid-free sliders/picture;
     farmhouse/cottage/traditional carry true colonial grids. */
  HA.STYLE_WINDOWS = {
    craftsman:     { winType: 'double_hung', grid: 'craftsman' },
    farmhouse:     { winType: 'double_hung', grid: 'colonial' },
    cottage:       { winType: 'double_hung', grid: 'colonial' },
    traditional:   { winType: 'double_hung', grid: 'colonial' },
    ranch:         { winType: 'slider',      grid: 'none' },
    modern:        { winType: 'slider',      grid: 'none' },
    'modern-mono': { winType: 'picture',     grid: 'none' },
    contemporary:  { winType: 'picture',     grid: 'none' },
  };
  HA.windowDefaultsFor = (style) =>
    HA.STYLE_WINDOWS[style] || { winType: 'double_hung', grid: 'colonial' };
  /* Stamp ONE window record with the style-appropriate fenestration — the same
     rules gen.js applies to every generated window (winType + grid + muntins,
     picture for a wide/low great-room light, plain slider for small privacy
     lights, slide handing by position). Used by the AI tool paths (tools.js
     add_opening, floorplan.js solver) so a tool-built window carries the SAME
     normalized record a generator-built one does — no more colonial-grid
     double-hungs on a modern house from the AI path. `style` may be omitted;
     it resolves via HA.modelStyle(model) (view3d) with a settings fallback. */
  HA.stampWindowStyle = (model, o, style) => {
    if (!o || o.kind !== 'window') return o;
    const key = style || (HA.modelStyle ? HA.modelStyle(model) : null)
      || (model && model._genOpts && model._genOpts.style) || 'farmhouse';
    const wd = HA.windowDefaultsFor(key);
    o.winType = wd.winType;
    o.grid = wd.grid;
    o.muntins = !!(wd.grid && wd.grid !== 'none');
    // a wide, low-sill living/great light reads best as a fixed picture.
    if (o.width >= 60 && o.height >= 72) o.winType = 'picture';
    // small privacy lights (bath) — keep them plain and grid-free.
    if (o.width <= 30 && o.height <= 36) { o.grid = 'none'; o.muntins = false; o.winType = 'slider'; }
    if (o.winType === 'slider') o.slide = (o.pos % 2 < 1) ? 'left' : 'right';
    return o;
  };
  /* the door tool's picker — selecting a preset swaps the whole slab,
     Chief-style */
  HA.DOOR_PRESETS = [
    { key: 'entry_panel', label: 'Entry — 6-panel', w: 36, props: { style: 'panel', handle: 'lever', trim: 'modern' } },
    { key: 'entry_craftsman', label: 'Entry — craftsman 3-lite', w: 36, props: { style: 'craftsman', handle: 'lever', trim: 'craftsman' } },
    { key: 'entry_glass', label: 'Entry — half glass', w: 36, props: { style: 'glass', handle: 'lever', trim: 'modern' } },
    { key: 'entry_plank', label: 'Entry — modern plank', w: 42, props: { style: 'plank', handle: 'bar', trim: 'modern' } },
    { key: 'int_flush', label: 'Interior — flush', w: 30, props: { style: 'flush', handle: 'knob', trim: 'modern' } },
    { key: 'int_panel', label: 'Interior — 6-panel', w: 32, props: { style: 'panel', handle: 'knob', trim: 'modern' } },
    { key: 'closet_bypass', label: 'Closet — sliding bypass (slab)', w: 60, props: { doorType: 'slider', panels: 2, style: 'flush', handle: 'none', trim: 'modern' } },
    { key: 'slider2', label: 'Sliding glass — 2 panel', w: 72, props: { doorType: 'slider', panels: 2, style: 'full_glass', handle: 'none' } },
    { key: 'slider4', label: 'Sliding glass — 4 panel', w: 144, props: { doorType: 'slider', panels: 4, style: 'full_glass', handle: 'none' } },
    { key: 'accordion', label: 'Accordion glass wall', w: 108, props: { doorType: 'accordion', style: 'full_glass', handle: 'none' } },
    { key: 'garage8', label: "Garage — 8'-0\"", w: 96, props: { doorType: 'garage', style: 'garage', height: 84, handle: 'none', trim: 'none' } },
    { key: 'garage16', label: "Garage — 16'-0\"", w: 192, props: { doorType: 'garage', style: 'garage', height: 84, handle: 'none', trim: 'none' } },
  ];

  /* Header (lintel) sizes — conventional residential lookup by clear span */
  HA.HEADERS = ['auto', '4x4', '4x6', '4x8', '4x10', '4x12'];
  HA.headerForSpan = (span) =>
    span <= 24 ? '4x4' : span <= 36 ? '4x6' : span <= 60 ? '4x8' : span <= 84 ? '4x10' : '4x12';
  HA.headerDepth = (label) =>
    ({ '4x4': 3.5, '4x6': 5.5, '4x8': 7.25, '4x10': 9.25, '4x12': 11.25 }[label] || 7.25);
  HA.openingHeader = (o) =>
    (!o.header || o.header === 'auto') ? HA.headerForSpan(o.width) : o.header;
  /* LEGAL head height for an opening on a wall: wall height − 3" of top plates
     − the header depth the framer will use for this span. A window head above
     this buries the header in the plate zone (framing.js clamps headerZ1 to
     studTop and the glass runs into the plates). Accepts a wall object or a
     numeric wall height. Shared by kitchendesign's sink-window clamp, gen's
     window creation and validate_design's window-head flag. */
  HA.legalHeadFor = (wallOrH, width) => {
    const wallH = (typeof wallOrH === 'object' && wallOrH)
      ? (wallOrH.height || 96) : (wallOrH || 96);
    return wallH - 3 - HA.headerDepth(HA.headerForSpan(width || 48));
  };

  /* ---------- material library ---------- */
  HA.MAT_KINDS = {
    lap: 'Lap siding', batten: 'Board & batten', brick: 'Brick', stucco: 'Stucco',
    stone: 'Stone', shingle: 'Roof shingle', metal: 'Standing-seam metal',
    concrete: 'Concrete', wood: 'Wood planks', flat: 'Flat color',
    // road / pavement aggregates + concrete finishes (Steve: "aggregate options for
    // road, pavement, and concrete"). Generators live in textures.js.
    asphalt: 'Asphalt (AC)', chipseal: 'Chip seal', gravel: 'Gravel', stamped: 'Stamped concrete',
  };

  HA.defaultMaterials = () => {
    const M = {};
    const add = (id, name, kind, color, accent, scale, category) => {
      M[id] = { id, name, kind, color, accent: accent || null, scale: scale || 1, category };
    };
    add('lap_sage', 'Lap Siding — Sage', 'lap', '#b9c2ad', '#9aa48e', 1, 'Siding');
    add('lap_white', 'Lap Siding — White', 'lap', '#e8e6df', '#cfccc2', 1, 'Siding');
    add('lap_navy', 'Lap Siding — Navy', 'lap', '#3d4f63', '#2f3e4f', 1, 'Siding');
    add('lap_gray', 'Lap Siding — Dove Gray', 'lap', '#aeb4b8', '#94999d', 1, 'Siding');
    add('lap_black', 'Lap Siding — Iron Black', 'lap', '#2e3236', '#222528', 1, 'Siding');
    add('lap_yellow', 'Lap Siding — Buttercream', 'lap', '#e9d9a8', '#d2c28f', 1, 'Siding');
    add('batten_cream', 'Board & Batten — Cream', 'batten', '#e5dfd0', '#cfc8b6', 1, 'Siding');
    add('batten_charcoal', 'Board & Batten — Charcoal', 'batten', '#4a4f55', '#3a3f45', 1, 'Siding');
    add('batten_white', 'Board & Batten — White', 'batten', '#eceae2', '#d8d5cb', 1, 'Siding');
    add('batten_olive', 'Board & Batten — Olive', 'batten', '#8e9678', '#79805f', 1, 'Siding');
    add('brick_red', 'Brick — Red Common', 'brick', '#9e5b48', '#b8b0a4', 1, 'Masonry');
    add('brick_tan', 'Brick — Buff', 'brick', '#b59a76', '#c4bcae', 1, 'Masonry');
    add('stucco_sand', 'Stucco — Sand', 'stucco', '#d8cdb8', null, 1, 'Stucco');
    add('stucco_white', 'Stucco — White', 'stucco', '#e9e7e0', null, 1, 'Stucco');
    add('stucco_adobe', 'Stucco — Adobe', 'stucco', '#cfa57e', null, 1, 'Stucco');
    add('stucco_gray', 'Stucco — Smoke', 'stucco', '#aeaca4', null, 1, 'Stucco');
    add('stucco_sage', 'Stucco — Sage', 'stucco', '#b9bda6', null, 1, 'Stucco');
    add('tile_terra', 'Tile — Terracotta', 'shingle', '#b06a44', null, 1, 'Roofing');
    add('cedar_plank', 'Cedar Plank Siding', 'wood', '#9c7250', '#7d5a3e', 1, 'Siding');
    add('wood_cherry', 'Wood — Cherry Stained', 'wood', '#7c3a28', '#612c1e', 1, 'Siding');
    add('wood_natural', 'Wood — Natural', 'wood', '#b08d5f', '#96754b', 1, 'Siding');
    add('paint_white', 'Painted Wood — White', 'flat', '#f2efe8', null, 1, 'Siding');
    add('lumber_natural', 'Lumber — Natural', 'lumber', '#b08d5f', '#8a6b45', 1, 'Structure');
    add('lumber_cedar', 'Lumber — Cedar', 'lumber', '#9c7250', '#7b573b', 1, 'Structure');
    add('lumber_cherry', 'Lumber — Cherry Stained', 'lumber', '#7c3a28', '#5e2b1d', 1, 'Structure');
    add('stucco_smooth', 'Stucco — Santa Barbara Smooth', 'stucco', '#e8e2d6', null, 1, 'Stucco');
    add('stucco_dash', 'Stucco — Rough Dash', 'stucco', '#d9d2c2', null, 1, 'Stucco');
    add('walnut_plank', 'Walnut Plank Siding', 'wood', '#6b4e36', '#543c2a', 1, 'Siding');
    add('stone_gray', 'Ledger Stone — Gray', 'stone', '#8e8a82', '#6f6b64', 1, 'Masonry');
    add('stone_tan', 'Fieldstone — Tan', 'stone', '#b3a285', '#94835f', 1, 'Masonry');
    add('brick_white', 'Brick — Painted White', 'brick', '#e3ded4', '#cfc9bd', 1, 'Masonry');
    add('shingle_charcoal', 'Comp Shingle — Charcoal', 'shingle', '#59616c', null, 1, 'Roofing');
    add('shingle_brown', 'Comp Shingle — Weathered', 'shingle', '#6e6256', null, 1, 'Roofing');
    add('shingle_green', 'Comp Shingle — Forest', 'shingle', '#4c5a4c', null, 1, 'Roofing');
    add('shingle_slate', 'Slate — Blue Black', 'shingle', '#3b4148', null, 1, 'Roofing');
    add('metal_gray', 'Standing Seam — Gray', 'metal', '#7d858d', null, 1, 'Roofing');
    add('metal_black', 'Standing Seam — Matte Black', 'metal', '#2b2e32', null, 1, 'Roofing');
    add('metal_copper', 'Standing Seam — Copper', 'metal', '#9a6a44', null, 1, 'Roofing');
    add('concrete', 'Concrete', 'concrete', '#9b958a', null, 1, 'Structure');
    // --- PAVING: road/pavement aggregates + concrete finishes + unit/permeable pavers.
    // ids + kinds + colors MUST match view3d._pathSlab3d's SURF_LIB (its inline fallback
    // builds the identical material when the library entry is missing). ---
    add('road_ac', 'Road — Asphalt (AC)', 'asphalt', '#33353a', '#26282c', 1, 'Paving');
    add('road_chipseal', 'Road — Chip Seal', 'chipseal', '#5b574e', '#3f3c35', 1, 'Paving');
    add('road_gravel', 'Road — Gravel', 'gravel', '#a89a7c', '#7d7358', 1, 'Paving');
    add('conc_colored', 'Concrete — Colored', 'stamped', '#a9765a', '#8c5f47', 1, 'Paving');
    add('conc_stamped', 'Concrete — Stamped', 'stamped', '#9c8570', '#7d6a58', 1, 'Paving');
    add('drive_permeable', 'Driveway — Permeable Pavers', 'permeable', '#9a988f', '#5f8a4a', 1, 'Paving');
    add('drive_pavers', 'Driveway — Unit Pavers', 'pavers', '#a08a72', '#8a8078', 1, 'Paving');
    add('deck_cedar', 'Decking — Cedar', 'wood', '#a9805a', '#8d6a4a', 1, 'Decking');
    add('deck_gray', 'Decking — Composite Gray', 'wood', '#8b8e8f', '#737677', 1, 'Decking');
    add('deck_walnut', 'Decking — Composite Walnut', 'wood', '#7a5a40', '#65492f', 1, 'Decking');
    add('floor_walnut', 'Flooring — Walnut', 'wood', '#7a5a40', '#62482f', 1, 'Interior');
    add('floor_tile', 'Flooring — Porcelain Tile', 'flat', '#cfc9bd', null, 1, 'Interior');
    add('floor_carpet', 'Flooring — Carpet Greige', 'flat', '#b8b0a2', null, 1, 'Interior');
    add('counter_quartz', 'Counter — White Quartz', 'flat', '#e8e6e0', null, 1, 'Interior');
    add('counter_granite', 'Counter — Granite', 'stone', '#5d5a55', '#4a4744', 0.4, 'Interior');
    add('int_white', 'Interior — Warm White', 'flat', '#e9e5dc', null, 1, 'Interior');
    add('gypsum', 'Gypsum Board — 1/2"', 'flat', '#d7d7d3', null, 1, 'Interior');
    add('floor_oak', 'Flooring — Oak', 'wood', '#c29a6c', '#a98352', 1, 'Interior');
    // --- expanded palette (more styles: modern, Mediterranean/Spanish, natural) ---
    add('lap_greige', 'Lap Siding — Greige', 'lap', '#c4bdae', '#a9a293', 1, 'Siding');
    add('lap_clay', 'Lap Siding — Clay', 'lap', '#b98c6a', '#9c7352', 1, 'Siding');
    add('lap_forest', 'Lap Siding — Hunter Green', 'lap', '#3c4a3c', '#2e3a2e', 1, 'Siding');
    add('batten_black', 'Board & Batten — Iron', 'batten', '#2c2f33', '#1f2225', 1, 'Siding');
    add('batten_sand', 'Board & Batten — Sand', 'batten', '#d9cdb4', '#c2b69c', 1, 'Siding');
    add('stucco_cream', 'Stucco — Santa Barbara Cream', 'stucco', '#e6dcc4', null, 1, 'Stucco');
    add('stucco_terracotta', 'Stucco — Terracotta', 'stucco', '#c98a63', null, 1, 'Stucco');
    add('stucco_ochre', 'Stucco — Tuscan Ochre', 'stucco', '#c9a15c', null, 1, 'Stucco');
    add('brick_slate', 'Brick — Charcoal', 'brick', '#54524e', '#6a655c', 1, 'Masonry');
    add('brick_limewash', 'Brick — Limewash', 'brick', '#dcd6c8', '#c9c2b2', 1, 'Masonry');
    add('stone_charcoal', 'Ledger Stone — Charcoal', 'stone', '#514f4b', '#3d3b38', 1, 'Masonry');
    add('stone_cream', 'Limestone — Cream', 'stone', '#cfc3a6', '#b3a684', 1, 'Masonry');
    add('cedar_shake', 'Cedar Shake — Natural', 'wood', '#a17a54', '#836043', 1, 'Siding');
    add('redwood_plank', 'Redwood Plank Siding', 'wood', '#8a4f38', '#6e3d2b', 1, 'Siding');
    add('tile_clay', 'Roof Tile — Clay Barrel', 'shingle', '#bd6f47', '#9c5836', 1, 'Roofing');
    add('metal_bronze', 'Standing Seam — Bronze', 'metal', '#6e5a44', null, 1, 'Roofing');
    // --- kitchen finishes (cabinet boxes + countertops; used by HA.kitchen schemes) ---
    add('cab_white', 'Cabinet — Classic White', 'flat', '#e9e7e1', null, 1, 'Interior');
    add('cab_cherry', 'Cabinet — Dark Cherry', 'wood', '#5e3226', '#47251c', 1, 'Interior');
    add('cab_walnut', 'Cabinet — Walnut', 'wood', '#6b4e36', '#543c2a', 1, 'Interior');
    add('cab_navy', 'Cabinet — Navy Blue', 'flat', '#33445c', null, 1, 'Interior');
    add('cab_sage', 'Cabinet — Sage Green', 'flat', '#8e9678', null, 1, 'Interior');
    add('cab_black', 'Cabinet — Matte Black', 'flat', '#2e3236', null, 1, 'Interior');
    add('counter_marble', 'Counter — Carrara Marble', 'stone', '#e6e4e2', '#c9c7c9', 0.5, 'Interior');
    add('counter_butcher', 'Counter — Butcher Block', 'wood', '#b98c5a', '#9c7348', 1, 'Interior');
    add('counter_black', 'Counter — Absolute Black', 'flat', '#26282a', null, 1, 'Interior');
    add('counter_concrete', 'Counter — Poured Concrete', 'concrete', '#9b958a', null, 1, 'Interior');
    return M;
  };

  /* ---------- basic accessors ---------- */
  // PARAMETRIC wall thickness: the WALL_TYPES.t is the BASE (at the 0.5" gyp / 0.5" sheathing
  // default). When the user edits the finish thicknesses, wallT grows by the DELTA from that
  // default — so at defaults every base_t is byte-identical (ext2x6 6.5, ext2x4 4.5, porch 5.5,
  // int2x4 4.5, int2x6 6.5) and only changes when a thickness is edited. The STUD never moves.
  // Framed types obey t = stud + 1.0 (0.5 gyp + 0.5 sheathing, or gyp both faces); ext2x4 was
  // 5.0 for years (audit: faces drawn 1/4" off the stud) — t is DERIVED here, never stored, so
  // old saves self-heal on load. Porch is a capped pony wall and intentionally reads 5.5.
  // Set HA.ASSEMBLY_PARAMETRIC=false to hard-revert to the pure table lookup (current build).
  HA.ASSEMBLY_PARAMETRIC = true;
  HA.wallT = (w) => {
    const wt = HA.WALL_TYPES[w.type] || HA.WALL_TYPES.int2x4;
    if (!HA.ASSEMBLY_PARAMETRIC) return wt.t;
    const gypD = (HA.GYP != null ? HA.GYP : 0.5) - 0.5;
    const shD = (HA.SHEATHING != null ? HA.SHEATHING : 0.5) - 0.5;
    // SIP: t = panel + interior gyp + cladding. The OSB skins live INSIDE `stud`
    // (no separate sheathing layer — a SHEATHING edit never moves a SIP wall) and
    // the cladding (factory-applied on the reference panels) is INSIDE t, so
    // wallClad() returns 0 for SIP and nothing double-draws/bills. At the
    // 0.5/0.75 defaults this equals wt.t byte-identically.
    if (wt.sip)
      return wt.stud + (HA.GYP != null ? HA.GYP : 0.5) + (HA.CLADDING != null ? HA.CLADDING : 0.75);
    // exterior t hides interior gyp + exterior sheathing; interior t hides gyp both faces
    return wt.t + (wt.ext ? (gypD + shD) : (gypD + gypD));
  };
  HA.isExt = (w) => !!(HA.WALL_TYPES[w.type] || {}).ext;
  HA.isLow = (w) => !!(HA.WALL_TYPES[w.type] || {}).low;

  /* ---- UNDER-ROOF PORCH (Steve: "turn a room into a covered porch under the
     roof line") ----
     An under-roof porch is a footprint zone the MAIN roof still covers, but whose
     exterior edges are OPEN air — the solid wall is replaced by 6x6 posts carrying
     a beam at plate height. The representation is deliberately minimal + additive:
       • wall.porchOpen === true  — a boolean flag on an EXTERIOR loop wall segment.
         The wall KEEPS its ext2x6 type, so HA.exteriorLoop (which filters on isExt)
         still traces it → the roof envelope is byte-identical to a solid-wall house
         (the roof never reads the flag). view3d/framing branch on the flag to draw
         posts+beam instead of studs+sheathing. The porch's INTERIOR-facing edges are
         normal interior walls (int2x6) — NOT ext — so they never corrupt the loop.
       • level._porches[] — serializable world-AABB records {x0,y0,x1,y1,drop,deck,
         floor} so the floor renderer holes the finish floor over the porch + lays
         its floor, and re-derives on a reload. `floor` is 'slab' (monolithic concrete
         poured with the house slab) or 'deck' (wood-framed via the deck logic — the
         default for raised foundations); `deck` mirrors floor==='deck'. The porch is
         NOT conditioned space (a 'porch'-kind room label; egress/room designers
         ignore it). The porch's interior boundary walls are int2x6 flagged
         `porchBearing` — bearing walls that always keep a continuous footing.
     Both survive a JSON round trip (plain booleans/objects/arrays).
     KEY: the wall is NEVER SPLIT — it stays ONE exterior loop wall so the roof solver
     sees a byte-identical loop (a split would inject collinear vertices that the roof's
     straight-skeleton can choke on). The open portion is a SUB-RANGE along the wall:
       • wall.porchSpan = [t0, t1]  — inches from wallA; that span renders as posts+beam,
         the rest of the wall stays solid (a porch that opens only part of a rear wall).
       • wall.porchOpen === true    — the WHOLE wall is open (roomToPorch on a full edge).
     HA.porchOpenRange returns the open [t0,t1]; HA.wallSubSegment cuts a solid/open
     sub-wall so the renderer + framing reuse the normal wall paths on each piece. */
  HA.PORCH_FLOOR_DROP = 4;                    // porch slab steps 4" below interior FF (a real step-down)
  HA.isPorchOpen = (w) => !!(w && (w.porchOpen || (Array.isArray(w.porchSpan) && w.porchSpan.length === 2)));
  HA.porchOpenRange = (w) => {
    const len = HA.wallLen(w);
    if (Array.isArray(w.porchSpan) && w.porchSpan.length === 2)
      return [Math.max(0, Math.min(w.porchSpan[0], w.porchSpan[1])), Math.min(len, Math.max(w.porchSpan[0], w.porchSpan[1]))];
    return [0, len];                          // porchOpen === true → whole wall
  };
  // a shallow sub-wall of `wall` spanning [ta,tb] inches from wallA — porch flags
  // cleared (so it renders/frames as a plain wall), openings in-range re-posed. Used to
  // render/frame the solid + open pieces of a partially-open porch wall WITHOUT ever
  // mutating the real (whole) loop wall.
  HA.wallSubSegment = (wall, ta, tb, keepOpenings) => {
    const d = HA.wallDir(wall), A = HA.wallA(wall);
    const pa = { x: A.x + d.x * ta, y: A.y + d.y * ta };
    const pb = { x: A.x + d.x * tb, y: A.y + d.y * tb };
    const w = Object.assign({}, wall, { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, openings: [] });
    delete w.porchOpen; delete w.porchSpan;
    if (keepOpenings) for (const o of (wall.openings || []))
      if (o.pos >= ta - 1 && o.pos <= tb + 1) w.openings.push(Object.assign({}, o, { pos: o.pos - ta }));
    return w;
  };
  HA.porchList = (model, li) => {
    const lvl = model && model.levels && model.levels[li == null ? 0 : li];
    return (lvl && Array.isArray(lvl._porches)) ? lvl._porches : [];
  };

  /* ---- PORCH FOUNDATION reasoning (Steve, "think it through") ----
     A covered porch carves a zone out of the great room; the MAIN roof still spans
     over it (the exterior loop is unchanged). That leaves three foundation facts the
     next reader must not lose:

       1. EVERY exterior loop wall ALWAYS keeps its continuous perimeter footing —
          including the wall segment that a porchSpan opens to posts+beam. The wall
          is never removed from the loop (porchOpen is a flag, not a delete), so the
          3D + plan perimeter footing already runs under it. Nothing to add there.
       2. The porch's INTERIOR boundary — the wall now standing between conditioned
          space and the open porch — is the OLD exterior wall of the house. It is a
          BEARING wall (carries wall + ceiling/roof) AND the thermal-envelope edge,
          so it ALWAYS keeps a continuous footing under it, exactly like an exterior
          wall. In our model that wall is an int2x6 flagged `w.porchBearing = true`
          (it can't be an ext wall or it would corrupt the roof loop). The foundation
          renderer + plan draw a continuous footing under every porchBearing wall:
            • SLAB house  → a turned-down THICKENED EDGE / grade beam (the porch slab
                            is poured MONOLITHIC with the house slab, so this is one
                            continuous pour with a deepened bearing line).
            • RAISED house→ its own continuous stem wall + spread footing (the crawl
                            stops at this line).
       3. The porch POSTS carry the roof beam; each lands on a sized square PAD
          footing (HA.PORCH_POST_PAD), NOT the continuous perimeter footing. */

  /* PORCH POST PAD FOOTING SIZE. Square pad under each 6x6 porch post, sized from
     the tributary roof load it carries — a builder's rule of thumb: tributary area
     (sf) ≈ post spacing (ft) × porch depth (ft). e.g. 8' o.c. × 12' deep ≈ 96 sf →
     an 18" pad; a small 8'×8' porch → 16"; a deep/wide porch → 20-24". Returns the
     pad side in INCHES. One source of truth shared by framing (F.porchWall), the 3D
     pads + the foundation-plan callout so all three always agree. */
  HA.PORCH_POST_PAD = (spacingIn, depthIn) => {
    const trib = (Math.max(48, spacingIn || 96) / 12) * (Math.max(48, depthIn || 96) / 12);
    if (trib >= 140) return 24;
    if (trib >= 100) return 20;
    if (trib >= 70) return 18;
    return 16;
  };

  /* Which AABB edge of a porch rect holds its house-side (bearing) wall → the edge
     a WOOD-DECK porch floor ledgers to. Returns 'x0'|'x1'|'y0'|'y1' or null. The
     porch's house side is an INTERIOR wall (not on the exterior loop), so the deck
     framer can't find it via the loop — this classifies it from the porchBearing
     flag. Falls back to any non-open wall on an edge. */
  HA.porchLedgerEdge = (model, li, pc) => {
    const lvl = model && model.levels && model.levels[li == null ? 0 : li];
    if (!lvl || !pc) return null;
    const TOL = 12;
    const onEdge = (w, key) => {
      const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
      if (key === 'y0') return Math.abs(my - pc.y0) < TOL && mx > pc.x0 - TOL && mx < pc.x1 + TOL;
      if (key === 'y1') return Math.abs(my - pc.y1) < TOL && mx > pc.x0 - TOL && mx < pc.x1 + TOL;
      if (key === 'x0') return Math.abs(mx - pc.x0) < TOL && my > pc.y0 - TOL && my < pc.y1 + TOL;
      if (key === 'x1') return Math.abs(mx - pc.x1) < TOL && my > pc.y0 - TOL && my < pc.y1 + TOL;
      return false;
    };
    const keys = ['y0', 'y1', 'x0', 'x1'];
    // 1st pass: the flagged bearing (house-side) wall
    for (const w of lvl.walls || []) {
      if (!w.porchBearing || HA.isPorchOpen(w)) continue;
      for (const k of keys) if (onEdge(w, k)) return k;
    }
    // 2nd pass: any solid (non-open) wall on an edge = the house side
    for (const w of lvl.walls || []) {
      if (HA.isPorchOpen(w) || HA.isLow(w)) continue;
      for (const k of keys) if (onEdge(w, k)) return k;
    }
    return null;
  };

  /* ---------- wall ASSEMBLY (Chief-style layers) ----------
     Every wall is a STUD core wrapped in finish layers. The STUD is the reference —
     dimensions and the foundation line up to the stud face. The existing wall thickness
     t already accounts for gyp + stud + sheathing (t = stud + 1.0"); CLADDING (siding OR
     stucco, treated as ONE thickness) is added OUTSIDE that on the exterior, so the stud
     stays put and the wall reads correct. Layers z-offset from the wall CENTERLINE (z =
     along the wall +normal; HA.interiorSign picks the interior side). */
  // Layer thicknesses — module globals so 2D/3D/IFC read them WITHOUT a model arg. They are
  // SYNCED from model.settings.assembly by HA.syncAssembly(model) on every load/edit (below),
  // so editing a thickness flows everywhere on the next render. Defaults = current build.
  HA.GYP = 0.5;         // interior finish (drywall)
  HA.SHEATHING = 0.5;   // exterior sheathing — already inside the current wall t
  HA.CLADDING = 0.75;   // siding OR stucco — ONE thickness (kept identical, per Steve)
  HA.WRB = 0.02;        // weather-resistive barrier ("plastic wrap") — a hair, drawn as a line
  // STUD = the fixed reference. Read the explicit lumber size (never wallT-1, which goes stale
  // under the parametric formula). Dims + foundation ride wallStudHalf — the stud never moves.
  HA.wallStud = (w) => (HA.WALL_TYPES[w.type] || HA.WALL_TYPES.int2x4).stud;
  HA.wallStudHalf = (w) => HA.wallStud(w) / 2;   // centerline -> stud face (symmetric stud ref)
  // Per-side stud FACES for asymmetric finishes (drywall ≠ sheathing → stud not centered on the
  // wall centerline). At the 0.5/0.5 default both equal wallStudHalf. Used for the DRAWN
  // sheathing/drywall bands; DIMS keep using wallStudHalf so the foundation line stays put.
  // SIP walls: the structural face band is the OSB SKIN face inside the (in-t)
  // cladding, not a sheathing face — extFace + intFace still close EXACTLY on the
  // panel (t − clad − gyp === stud), the same invariant the framed types obey.
  HA.wallExtFaceDist = (w) => ((HA.WALL_TYPES[w.type] || {}).sip
    ? HA.wallT(w) / 2 - (HA.CLADDING != null ? HA.CLADDING : 0.75)
    : HA.wallT(w) / 2 - (HA.SHEATHING != null ? HA.SHEATHING : 0.5));
  HA.wallIntFaceDist = (w) => HA.wallT(w) / 2 - (HA.GYP != null ? HA.GYP : 0.5);
  // exterior cladding thickness (0 interior). SIP: 0 — the cladding (factory
  // stucco on the reference panels) is INSIDE wallT, so no extra shell is drawn
  // or offset outboard (wallT/2 already IS the cladding face for a SIP).
  HA.wallClad = (w) => (HA.isExt(w) && !(HA.WALL_TYPES[w.type] || {}).sip ? HA.CLADDING : 0);
  // Centerline -> STUD FACE: the concrete/foundation + dimension reference (cad-map.md
  // A4). Real construction sets the mudsill/bottom plate FLUSH with the concrete edge
  // and the sheathing hangs PAST it — so the foundation line is the stud face, NOT the
  // sheathing face (wallT/2, which drew the permit foundation 1/2" proud). Rides
  // wallStudHalf (like dims and the 3D foundation) so editing a finish thickness can
  // NEVER move the foundation line.
  HA.studEdgeOffset = (w) => HA.wallStudHalf(w);
  /* Sync the layer-thickness globals from a model's settings.assembly (defaults 0.5/0.5/0.75).
     Call BEFORE any render/export that reads the globals (model load, New/open, deserialize,
     assembly-setting edit). Idempotent + cheap. Backfills settings.assembly on the model so it
     serializes. Keeps the STUD fixed; only the finish thicknesses change. */
  HA.syncAssembly = (model) => {
    // READ-ONLY on the model: default any missing field, never write back (a legacy model with
    // no settings.assembly stays untouched — no silent mutation; newModel seeds it for fresh
    // models and the settings UI creates it lazily when the user first edits a thickness).
    const A = (model && model.settings && model.settings.assembly) || {};
    HA.GYP = (A.drywall != null) ? A.drywall : 0.5;
    HA.SHEATHING = (A.sheathing != null) ? A.sheathing : 0.5;
    HA.CLADDING = (A.cladding != null) ? A.cladding : 0.75;
    return { drywall: HA.GYP, sheathing: HA.SHEATHING, cladding: HA.CLADDING };
  };
  HA.wallLen = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
  HA.wallDir = (w) => U.norm({ x: w.x2 - w.x1, y: w.y2 - w.y1 });
  HA.wallA = (w) => ({ x: w.x1, y: w.y1 });
  HA.wallB = (w) => ({ x: w.x2, y: w.y2 });

  /* R4 (Steve): move the WHOLE HOUSE at once — every plan-space coordinate on
     every level shifts by (dx,dy) inches. The SITE (lot, geoXform, terrain,
     features, streets) stays put: the building moves ON the lot, exactly like
     dragging it on the site plan. Fail-soft on unknown shapes. */
  /* ---- ANCILLARY RIDE-ALONG (Aaron: "the solar panels don't move with the
     house") ----
     Every collection pinned to the BUILDING beyond walls/posts/decks/
     fixtures/solids — the bits the four whole-house transforms kept
     forgetting one at a time (solar was missed by moveModel + rotateModel,
     mech by everything except the 2D site drag, holddowns by everything
     except rotateDesign...). ONE list, four callers, no more drift.
     PT mutates a {x,y} point in place; SEG a {x1,y1,x2,y2} segment; both
     must be nil-safe. rotAdvance (deg, op's own sign convention) advances
     stored .rot fields — 0 for a pure translation. */
  HA.transformAncillary = (model, PT, SEG, rotAdvance) => {
    const turn = Number.isFinite(rotAdvance) ? rotAdvance : 0;
    for (const lvl of model.levels || []) {
      for (const sp of lvl.separators || []) SEG(sp);
      for (const hd of lvl.holddowns || []) PT(hd);
    }
    // SOLAR — panels + the whole balance of system (main, battery, legacy
    // subpanel, equipment chain, wiring run anchors)
    const S = model.solar;
    if (S) {
      for (const p of S.panels || []) {
        PT(p);
        if (turn && Number.isFinite(p.rot)) p.rot = ((p.rot + turn) % 360 + 360) % 360;
      }
      PT(S.main); PT(S.subpanel);
      if (S.battery) PT(S.battery);
      for (const eq of S.equipment || []) PT(eq);
      if (S.wiring) for (const r of S.wiring.runs || []) if (r) PT(r.from);
    }
    // HVAC — equipment/registers are points, duct runs are segments
    const M = model.mech;
    if (M) {
      for (const eq of M.equipment || []) PT(eq);
      for (const rg of M.registers || []) PT(rg);
      for (const du of M.ducts || []) SEG(du);
    }
    // manual roof edits — absolute point PAIRS, both ends move
    if (model.roof && Array.isArray(model.roof.overrides)) {
      for (const o of model.roof.overrides) {
        if (!o) continue;
        if (Number.isFinite(o.fx) && Number.isFinite(o.fy)) { const p = { x: o.fx, y: o.fy }; PT(p); o.fx = p.x; o.fy = p.y; }
        if (Number.isFinite(o.tx) && Number.isFinite(o.ty)) { const p = { x: o.tx, y: o.ty }; PT(p); o.tx = p.x; o.ty = p.y; }
      }
    }
    // utility HOUSE-ends ride the building; curb ends stay on the lot
    const taps = model.site && model.site.utilTaps;
    if (taps) {
      PT(taps.house);
      for (const k of ['sewer', 'water', 'electric', 'gas']) if (taps[k]) PT(taps[k].house);
    }
  };

  HA.moveModel = (model, dx, dy) => {
    if (!model || !Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return false;
    const P = (o) => { if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) { o.x += dx; o.y += dy; } };
    const SEG = (o) => {
      if (!o) return;
      if (Number.isFinite(o.x1)) { o.x1 += dx; o.y1 += dy; }
      if (Number.isFinite(o.x2)) { o.x2 += dx; o.y2 += dy; }
    };
    for (const lvl of model.levels || []) {
      for (const w of lvl.walls || []) SEG(w);
      for (const p of lvl.posts || []) P(p);
      for (const d of lvl.decks || []) SEG(d);
      for (const e of lvl.entrances || []) P(e.pos);
      for (const f of lvl.fixtures || []) P(f);
      for (const el of lvl.electrical || []) P(el);
      for (const dm of lvl.dims || []) SEG(dm);
      for (const s of lvl.solids || []) { P(s); if (Array.isArray(s.pts)) s.pts.forEach(P); if (Array.isArray(s.poly)) s.poly.forEach(P); }
      for (const dr of lvl.drafts || []) { P(dr); SEG(dr); if (Array.isArray(dr.pts)) dr.pts.forEach(P); if (Array.isArray(dr.verts)) dr.verts.forEach(P); }
    }
    HA.transformAncillary(model, P, SEG, 0);   // solar / mech / separators / holddowns / roof edits / taps
    try { if (model.site && model.site._contourCache) delete model.site._contourCache; } catch (e) {}
    /* R64 — the carport's SOLIDS moved with the loop above, but its graded pad
       is a terrain feature (model.site.features) and its slab elevation was
       derived from the grade it used to stand on. Without this the slab walks
       away from its own cut: measured 77" of hillside through the concrete
       after a 20' house drag on a 20% lot. */
    try {
      if (HA.carport && HA.carport.reseat && model.carport && Number.isFinite(model.carport.originXIn)) {
        model.carport.originXIn += dx; model.carport.originYIn += dy;
        HA.carport.reseat(model);
      }
    } catch (e) {}
    return true;
  };

  /* HA.rotateModel — rotate the WHOLE HOUSE 90° (quarter-turns) about its footprint
     centre, on the lot. The SITE (lot, geoXform, terrain, features, streets, driveway,
     pad) stays put — the building spins on the lot exactly like the rotate button on the
     site plan; derived bits (datum, pad, generated driveway) re-derive on the next sync
     because they key off HA.garageInfo, whose rect/man-door/steps are stored as OFFSET
     vectors from the (now-rotated) label anchor.

     Quarter-turns ONLY (90° multiples) so every wall stays axis-aligned (the hard rule).
     Every plan point snaps to the 6" grid after rotating so nothing drifts off-grid.
     Fail-soft on unknown shapes; returns false when nothing rotated. */
  HA.rotateModel = (model, quarters) => {
    if (!model) return false;
    let q = ((Math.round(quarters) % 4) + 4) % 4;   // 0..3 clockwise quarter-turns
    if (q === 0) return false;
    // footprint centre = bbox of every plan coordinate on every level
    const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    let any = false;
    const acc = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { any = true; if (x < bb.minX) bb.minX = x; if (y < bb.minY) bb.minY = y; if (x > bb.maxX) bb.maxX = x; if (y > bb.maxY) bb.maxY = y; } };
    for (const lvl of model.levels || []) {
      // a DETACHED carport is not part of the house footprint — letting its
      // infill walls into this bbox drags the pivot off the house and the whole
      // plan walks sideways on every quarter-turn.
      for (const w of lvl.walls || []) { if (w && w.carport) continue; acc(w.x1, w.y1); acc(w.x2, w.y2); }
      for (const p of lvl.posts || []) acc(p.x, p.y);
      for (const d of lvl.decks || []) { acc(d.x1, d.y1); acc(d.x2, d.y2); }
      for (const e of lvl.entrances || []) if (e.pos) acc(e.pos.x, e.pos.y);
      for (const f of lvl.fixtures || []) acc(f.x, f.y);
    }
    if (!any) return false;
    const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    // ONE clockwise 90° quarter-turn about (cx,cy) in plan space (screen coords,
    // y-down): (dx,dy) -> (dy, -dx). Compose q of them, then snap to the 6" grid.
    const SNAP = 6;
    const snap = (v) => Math.round(v / SNAP) * SNAP;
    const rot1 = (x, y) => { const dx = x - cx, dy = y - cy; return { x: cx + dy, y: cy - dx }; };
    const rotPt = (x, y) => { let p = { x, y }; for (let i = 0; i < q; i++) p = rot1(p.x, p.y); return p; };
    // rotate a plan point IN PLACE, snapping to grid
    const RP = (o) => { if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) { const p = rotPt(o.x, o.y); o.x = snap(p.x); o.y = snap(p.y); } };
    // rotate a wall/deck segment (x1,y1)-(x2,y2)
    const RSEG = (o) => {
      if (!o) return;
      if (Number.isFinite(o.x1) && Number.isFinite(o.y1)) { const p = rotPt(o.x1, o.y1); o.x1 = snap(p.x); o.y1 = snap(p.y); }
      if (Number.isFinite(o.x2) && Number.isFinite(o.y2)) { const p = rotPt(o.x2, o.y2); o.x2 = snap(p.x); o.y2 = snap(p.y); }
    };
    // rotate a DIRECTION vector (no translation, no snap): (vx,vy) -> per quarter
    const rotVec1 = (v) => ({ x: v.y, y: -v.x });
    const RVEC = (v) => { if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) { let r = { x: v.x, y: v.y }; for (let i = 0; i < q; i++) r = rotVec1(r); v.x = r.x; v.y = r.y; } };
    const degTurn = -90 * q;   // clockwise plan turn = negative math-angle (rot degrees CCW+)
    for (const lvl of model.levels || []) {
      for (const w of lvl.walls || []) RSEG(w);
      for (const p of lvl.posts || []) RP(p);
      for (const d of lvl.decks || []) RSEG(d);
      for (const e of lvl.entrances || []) { if (e.pos) RP(e.pos); if (e.facing) RVEC(e.facing); }
      for (const f of lvl.fixtures || []) {
        RP(f);
        if (Number.isFinite(f.rot)) f.rot = ((f.rot + degTurn) % 360 + 360) % 360;
        // garage LABEL carries stored OFFSET vectors (rect corners + man-door +
        // its normal) that must spin with the label so garageInfo re-derives right.
        if (f.garageRect && Number.isFinite(f.garageRect.dx0)) {
          const gr = f.garageRect;
          const c0 = { x: gr.dx0, y: gr.dy0 }, c1 = { x: gr.dx1, y: gr.dy1 };
          RVEC(c0); RVEC(c1);
          gr.dx0 = c0.x; gr.dy0 = c0.y; gr.dx1 = c1.x; gr.dy1 = c1.y;
        }
        if (f.manDoor) {
          if (Number.isFinite(f.manDoor.dx)) { const d = { x: f.manDoor.dx, y: f.manDoor.dy }; RVEC(d); f.manDoor.dx = d.x; f.manDoor.dy = d.y; }
          if (Number.isFinite(f.manDoor.nx)) { const n = { x: f.manDoor.nx, y: f.manDoor.ny }; RVEC(n); f.manDoor.nx = n.x; f.manDoor.ny = n.y; }
        }
      }
      for (const el of lvl.electrical || []) RP(el);
      for (const dm of lvl.dims || []) RSEG(dm);
      for (const s of lvl.solids || []) { RP(s); if (Number.isFinite(s.rot)) s.rot = ((s.rot + degTurn) % 360 + 360) % 360; if (Array.isArray(s.pts)) s.pts.forEach(RP); if (Array.isArray(s.poly)) s.poly.forEach(RP); }
      for (const dr of lvl.drafts || []) { RP(dr); RSEG(dr); if (Array.isArray(dr.pts)) dr.pts.forEach(RP); if (Array.isArray(dr.verts)) dr.verts.forEach(RP); }
    }
    // Ancillary rides RIGIDLY (no 6" snap): the building snaps to keep walls
    // on-grid, but a 90° rigid turn preserves axis alignment by itself — and
    // snapping panel centers/duct ends would jitter the array's 1.5" gaps
    // and pull duct endpoints off their registers.
    const RPF = (o) => { if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) { const p = rotPt(o.x, o.y); o.x = p.x; o.y = p.y; } };
    const RSEGF = (o) => {
      if (!o) return;
      if (Number.isFinite(o.x1) && Number.isFinite(o.y1)) { const p = rotPt(o.x1, o.y1); o.x1 = p.x; o.y1 = p.y; }
      if (Number.isFinite(o.x2) && Number.isFinite(o.y2)) { const p = rotPt(o.x2, o.y2); o.x2 = p.x; o.y2 = p.y; }
    };
    HA.transformAncillary(model, RPF, RSEGF, degTurn);
    try { if (model.site && model.site._contourCache) delete model.site._contourCache; } catch (e) {}
    /* R64 — this turns the HOUSE; the site stays put (see the header). The loops
       above cannot know that, so they spin the detached carport's solids and
       infill walls about the house centre and leave its graded pad behind on the
       lot. Re-deriving from the stored origin puts the whole carport — frame,
       slab and terrain cut — back where it belongs, square to the lot. */
    try { if (HA.carport && HA.carport.reseat) HA.carport.reseat(model); } catch (e) {}
    return true;
  };

  /* ============================================================
     HA.rotateDesign — rotate the HOUSE **and the whole yard** by an
     ARBITRARY angle about one shared pivot, preserving the design.

     Steve (R45): "when i rotate the house front with the front
     button, it regenerates the house completely... the yard stuff
     paving and yard flowers and all the yard pools and trellises
     and everything those dont rotate, they stay out front and new
     ones generate... we dont want it changing designs on rotate."

     This is a MOVE, never a rebuild. Nothing is swept, re-seeded or
     re-generated, so hand edits and anything the AI authored survive
     intact. Regenerate stays a separate, explicit user action.

     Scope — what moves, and what deliberately does NOT:
       MOVES: every level (walls, posts, decks, entrances + facing
         vectors, fixtures incl. rot + garage/man-door offset
         vectors, electrical, holddowns, dims, solids, drafts),
         roof.overrides, solar panels + subpanel, and EVERY
         site.features[] entry via SF.rotateFeature.
       STAYS: site.lot, geoXform, northRot, settings.orientation,
         terrain, parcels, streets, site.dev. The ground and the
         world do not move — the design turns ON the lot. (This is
         why north/geo are NOT offset here: offsetting them would be
         right for spinning the whole site, and wrong for this.)

     SIGN CONVENTION (the thing most likely to silently break):
     plan space is y-down. One clockwise quarter-turn in rotateModel
     above is (dx,dy) -> (dy,-dx), which equals this rotation with
     deg = -90, and it advances a `rot` field by the same -90. So a
     single `deg` drives geometry AND every angle field, and matches
     SF.rotateFeature exactly — house and yard cannot drift apart.

     Grid: LOSSLESS — deliberately no 6" snap, unlike rotateModel.
     A transform must not re-round the design: snapping every turn
     drifts geometry (measured: 4x90 moved a wall 2", and it kept
     drifting), and a design that was already valid must come back
     byte-exact. Quarter turns use exact IEEE cos/sin (0 and ±1), so
     axis-aligned walls stay axis-aligned regardless; only floating
     fuzz is cleaned. Snapping belongs to DRAWING, not to moving.

     opts.cx/cy pivot (default: lot centroid, else footprint centre).
     Returns {ok, deg, pivot, features, note} — fail-soft, never throws.
     ============================================================ */
  HA.rotateDesign = (model, deg, opts) => {
    const out = { ok: false, deg: 0, pivot: null, features: 0, note: '' };
    if (!model || !Number.isFinite(deg)) { out.note = 'no model or angle'; return out; }
    // normalize to (-180,180] so a 350° request turns -10°, not the long way
    let d = ((deg % 360) + 360) % 360; if (d > 180) d -= 360;
    if (Math.abs(d) < 1e-6) { out.note = 'nothing to rotate (0°)'; return out; }
    out.deg = d;

    /* ---- pivot ---- */
    let px = opts && opts.cx, py = opts && opts.cy;
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      const lot = model.site && Array.isArray(model.site.lot) ? model.site.lot : null;
      if (lot && lot.length >= 3) {
        let sx = 0, sy = 0, n = 0;
        for (const p of lot) if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { sx += p.x; sy += p.y; n++; }
        if (n) { px = sx / n; py = sy / n; }
      }
    }
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      // no lot — fall back to the footprint bbox centre (rotateModel's pivot)
      let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity, any = false;
      for (const lvl of model.levels || []) for (const w of lvl.walls || []) {
        for (const p of [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          any = true;
          if (p.x < a) a = p.x; if (p.y < b) b = p.y;
          if (p.x > c) c = p.x; if (p.y > e) e = p.y;
        }
      }
      if (!any) { out.note = 'nothing to rotate (no lot, no walls)'; return out; }
      px = (a + c) / 2; py = (b + e) / 2;
    }
    out.pivot = { x: px, y: py };

    /* ---- primitives ---- */
    const rad = d * Math.PI / 180, C = Math.cos(rad), S = Math.sin(rad);
    // Clean floating fuzz only (and -0), never re-grid: see the Grid note above.
    const fix = (v) => { const r = Math.round(v); return Math.abs(v - r) < 1e-9 ? r + 0 : v; };
    const norm = (a) => ((a % 360) + 360) % 360;
    const XY = (x, y) => {
      const lx = x - px, ly = y - py;
      return { x: px + lx * C - ly * S, y: py + lx * S + ly * C };
    };
    const RP = (o) => { if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) { const p = XY(o.x, o.y); o.x = fix(p.x); o.y = fix(p.y); } };
    const RSEG = (o) => {
      if (!o) return;
      if (Number.isFinite(o.x1) && Number.isFinite(o.y1)) { const p = XY(o.x1, o.y1); o.x1 = fix(p.x); o.y1 = fix(p.y); }
      if (Number.isFinite(o.x2) && Number.isFinite(o.y2)) { const p = XY(o.x2, o.y2); o.x2 = fix(p.x); o.y2 = fix(p.y); }
    };
    // DIRECTION vectors carry no position: rotate about the origin, never snap.
    const RVEC = (v) => {
      if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return;
      const nx = v.x * C - v.y * S, ny = v.x * S + v.y * C;
      v.x = nx; v.y = ny;
    };
    const RROT = (o) => { if (o && Number.isFinite(o.rot)) o.rot = norm(o.rot + d); };

    /* ---- 1. the building, level by level ---- */
    for (const lvl of model.levels || []) {
      for (const w of lvl.walls || []) RSEG(w);
      for (const p of lvl.posts || []) RP(p);
      for (const dk of lvl.decks || []) RSEG(dk);
      for (const en of lvl.entrances || []) { if (en.pos) RP(en.pos); if (en.facing) RVEC(en.facing); }
      for (const f of lvl.fixtures || []) {
        RP(f); RROT(f);
        // the garage LABEL stores corner + man-door OFFSET vectors that must
        // spin with it, or garageInfo re-derives a garage facing the old way
        if (f.garageRect && Number.isFinite(f.garageRect.dx0)) {
          const gr = f.garageRect;
          const c0 = { x: gr.dx0, y: gr.dy0 }, c1 = { x: gr.dx1, y: gr.dy1 };
          RVEC(c0); RVEC(c1);
          gr.dx0 = c0.x; gr.dy0 = c0.y; gr.dx1 = c1.x; gr.dy1 = c1.y;
        }
        if (f.manDoor) {
          if (Number.isFinite(f.manDoor.dx)) { const v = { x: f.manDoor.dx, y: f.manDoor.dy }; RVEC(v); f.manDoor.dx = v.x; f.manDoor.dy = v.y; }
          if (Number.isFinite(f.manDoor.nx)) { const v = { x: f.manDoor.nx, y: f.manDoor.ny }; RVEC(v); f.manDoor.nx = v.x; f.manDoor.ny = v.y; }
        }
      }
      for (const el of lvl.electrical || []) RP(el);
      for (const dm of lvl.dims || []) RSEG(dm);
      for (const s of lvl.solids || []) {
        RP(s); RROT(s);
        if (Array.isArray(s.pts)) s.pts.forEach(RP);
        if (Array.isArray(s.poly)) s.poly.forEach(RP);
      }
      for (const dr of lvl.drafts || []) {
        RP(dr); RSEG(dr);
        if (Array.isArray(dr.pts)) dr.pts.forEach(RP);
        if (Array.isArray(dr.verts)) dr.verts.forEach(RP);
      }
    }

    /* ---- 2+3. everything else pinned to the building — solar (panels + the
       full balance of system), mech, separators, holddowns (R45), manual
       roof edits, utility house-ends — via the SHARED ride-along, so this
       op can never drift from moveModel/rotateModel again. (Re-running
       solar autoDesign would re-lay the array — that is a regenerate, and
       regenerating is the whole thing we're fixing.) ---- */
    HA.transformAncillary(model, RP, RSEG, d);

    /* ---- 4. THE YARD — every feature, one shared pivot.
       site.features is FLAT: walkway/pool children (parentId / walkId) are
       their own entries, so a single pass moves them exactly once. Do NOT
       also cascade parent->child or they double-rotate. ---- */
    const SF = HA.sitefeatures;
    if (SF && typeof SF.rotateFeature === 'function' &&
        model.site && Array.isArray(model.site.features)) {
      for (const f of model.site.features) {
        if (!f) continue;
        try { SF.rotateFeature(f, d, { cx: px, cy: py }); out.features++; }
        catch (err) { /* one odd feature must not abort the rotation */ }
      }
    }

    /* ---- 5. caches that key off pose ---- */
    try { if (model._terrainCache) delete model._terrainCache; } catch (e) {}
    try { if (model.site && model.site._contourCache) delete model.site._contourCache; } catch (e) {}
    try { if (model.site && model.site.terrain && model.site.terrain.cache) delete model.site.terrain.cache; } catch (e) {}

    out.ok = true;
    return out;
  };

  HA.levelElev = (model, idx) => {
    let z = 0;
    for (let i = 0; i < idx && i < model.levels.length; i++)
      z += (model.levels[i].height || model.settings.wallHeight) + model.settings.platformDepth;
    return z;
  };
  HA.levelOf = (model, wall) => {
    for (let i = 0; i < model.levels.length; i++)
      if (model.levels[i].walls.includes(wall)) return i;
    return 0;
  };
  /* topmost level with a closed exterior loop hosts the roof */
  HA.roofLevelIdx = (model) => {
    for (let i = model.levels.length - 1; i >= 0; i--)
      if (HA.exteriorLoop(model, i)) return i;
    return model.levels.length - 1;
  };

  HA.endExtension = (model, wall, end) => {
    const li = HA.levelOf(model, wall);
    const p = end === 0 ? HA.wallA(wall) : HA.wallB(wall);
    let ext = 0;
    for (const w of model.levels[li].walls) {
      if (w.id === wall.id) continue;
      // collinear continuations butt, they don't extend
      const sameLine = Math.abs(U.cross(HA.wallDir(w), HA.wallDir(wall))) < 0.02;
      if (sameLine) continue;
      for (const q of [HA.wallA(w), HA.wallB(w)]) {
        if (U.dist(p, q) < 1.0) ext = Math.max(ext, HA.wallT(w) / 2);
      }
    }
    return ext;
  };

  /* Per-FACE mitered end geometry for a wall corner. At a clean L-corner (exactly
     ONE non-collinear wall sharing this endpoint) each of the wall's two long faces
     extends to meet the neighbor's matching face, so adjacent walls form a proper
     45°-style MITER instead of overlapping. Returns the wall-LOCAL x for the +normal
     face (posZ) and -normal face (negZ) at this end (local x runs 0..len along
     wallDir; local +z = +normal = (-dir.y, dir.x)). At a T (NO wall shares this endpoint
     but the endpoint is buried inside another wall's poché) each face is TRIMMED BACK to
     the host wall's near face, so the wall closes ON the face instead of running to the
     host's centerline. Free ends / straight runs / glancing-angle T's / complex junctions
     return the square end (posZ = negZ = the endpoint's local x). */
  HA.wallEndMiter = (model, wall, end) => {
    const li = HA.levelOf(model, wall);
    const len = HA.wallLen(wall);
    const endX = end === 1 ? len : 0;
    const pB = end === 0 ? HA.wallA(wall) : HA.wallB(wall);
    const dw = HA.wallDir(wall);
    const nw = { x: -dw.y, y: dw.x };                       // wall +normal (local +z)
    const ht = HA.wallT(wall) / 2;
    const dOut = end === 1 ? dw : { x: -dw.x, y: -dw.y };   // points OUT of the wall at this end
    const low = HA.isLow ? HA.isLow(wall) : false;
    const nbrs = [];
    for (const w of model.levels[li].walls) {
      if (w.id === wall.id) continue;
      if (HA.isLow && HA.isLow(w) !== low) continue;        // don't miter a solid wall into a railing
      if (Math.abs(U.cross(HA.wallDir(w), dw)) < 0.02) continue;   // collinear continuations butt
      for (const we of [0, 1]) {
        const q = we === 0 ? HA.wallA(w) : HA.wallB(w);
        if (U.dist(pB, q) < 1.0) { nbrs.push({ w, we }); break; }
      }
    }
    /* T-JUNCTION BUTT (Aaron Meilich, GJ Gardner, his #1 take-away off the client Zoom:
       "A couple of take aways might be to connect lines in the plan" — with a screenshot
       of interior walls running INTO an exterior wall and stopping in the MIDDLE of it).
       Nothing SHARES this endpoint, but the endpoint sits INSIDE another wall's poché, so
       the square end below lands on the HOST'S CENTERLINE and overshoots its near face.
       Measured on 30 generated ranches: 515 such ends, 47.2% of every wall end, mean
       2.667" of overshoot, 3.82 LF per house, every one of them at 90°. Trim each FACE
       of this wall back to the host's near face so the drawn end closes ON the face.
       TRIM ONLY — the endpoint must already be buried in the host (|perp| <= htN), so
       this can never lengthen a wall or invent a join that isn't already drawn through. */
    if (nbrs.length === 0) {
      let bestBack = 0, bestFace = null;
      for (const w of model.levels[li].walls) {
        if (w.id === wall.id) continue;
        if (HA.isLow && HA.isLow(w) !== low) continue;      // a railing doesn't stop a wall
        const lenN = HA.wallLen(w);
        if (lenN < 2) continue;
        const aN = HA.wallA(w), dN = HA.wallDir(w);
        const along = (pB.x - aN.x) * dN.x + (pB.y - aN.y) * dN.y;
        if (along < 1 || along > lenN - 1) continue;        // must land MID-span; an END is the L case above
        const nN = { x: -dN.y, y: dN.x };
        const perp = (pB.x - aN.x) * nN.x + (pB.y - aN.y) * nN.y;
        const htN = HA.wallT(w) / 2;
        if (Math.abs(perp) > htN + 0.001) continue;         // not buried in this host's poché
        // the face to close on is the one our BODY comes from (body runs -dOut off pB)
        const sN = ((nN.x * -dOut.x + nN.y * -dOut.y) >= 0) ? 1 : -1;
        const dot = dOut.x * nN.x + dOut.y * nN.y;          // signed: dOut vs the host normal
        // NON-ORTHOGONAL SAFETY: the measured population is all 90°, but the solve below is
        // derived from the host's own direction, so 45°/30° cut correctly too. A glancing
        // wall (near-parallel to its host) divides by ~0 — refuse it and fall through to
        // today's square end rather than guess a runaway miter.
        if (Math.abs(dot) < 0.2) continue;
        // per FACE: offset this wall's face line by ±ht, then solve where it crosses the
        // host's near-face line. At 90° both faces give the same x (a square butt); off
        // 90° they differ and the end reads as a cut along the host face — which is right.
        const faceX = (zsign) => {
          const perpF = perp + zsign * ht * (nw.x * nN.x + nw.y * nN.y);
          return (sN * htN - perpF) / dot;                  // ext outward along dOut (<= 0)
        };
        const e1 = faceX(1), e2 = faceX(-1);
        const back = Math.max(-e1, -e2);
        // same runaway bound the L-miter clamps at, but as a REFUSAL: past it we don't know
        // what the user meant, so leave the end exactly as it drew yesterday.
        if (!(back > 0.001) || back > ht + htN + 2) continue;
        // several hosts overlapping this end (rare): stop clear of the outermost face
        if (back > bestBack) {
          bestBack = back;
          bestFace = { posZ: end === 1 ? len + e1 : 0 - e1, negZ: end === 1 ? len + e2 : 0 - e2 };
        }
      }
      if (bestFace) return bestFace;
    }
    if (nbrs.length !== 1) return { posZ: endX, negZ: endX };
    const nb = nbrs[0];
    const dN0 = HA.wallDir(nb.w);
    const dN = nb.we === 0 ? dN0 : { x: -dN0.x, y: -dN0.y };  // away from pB, into the neighbor
    const nN = { x: -dN.y, y: dN.x };                         // neighbor +normal = LEFT of dN
    const htN = HA.wallT(nb.w) / 2;
    const leftDOut = { x: -dOut.y, y: dOut.x };
    const sideZ = (nw.x * leftDOut.x + nw.y * leftDOut.y) >= 0 ? 1 : -1; // is +z LEFT(+1)/RIGHT(-1) of dOut
    const face = (zsign) => {
      // dOut and dN both point AWAY from the shared corner, so a face on the RIGHT
      // of dOut pairs with the neighbor face on the RIGHT of dN (+nN = LEFT = +1).
      const s = zsign * sideZ;
      const Pw = { x: pB.x + nw.x * zsign * ht, y: pB.y + nw.y * zsign * ht };
      const Pn = { x: pB.x + nN.x * s * htN, y: pB.y + nN.y * s * htN };
      const hit = U.lineLine(Pw, dOut, Pn, dN);
      if (!hit || !hit.pt) return endX;
      let ext = (hit.pt.x - pB.x) * dOut.x + (hit.pt.y - pB.y) * dOut.y;  // outward along dOut
      ext = Math.max(-(ht + htN + 2), Math.min(ht + htN + 2, ext));       // clamp runaway miters
      return end === 1 ? len + ext : 0 - ext;
    };
    return { posZ: face(1), negZ: face(-1) };
  };

  HA.interiorSign = (model, wall) => {
    // R58: carport infill walls aren't part of any closed exterior loop, so the
    // loop probe below can't orient them (siding ended up on the INSIDE — Steve).
    // Their interior is simply "toward the carport center".
    if (wall && wall.carport && model && model.carport && Number.isFinite(model.carport.originXIn)) {
      const cp = model.carport;
      const cx = cp.originXIn + (cp.input.widthFt * 12) / 2, cy = cp.originYIn + (cp.input.depthFt * 12) / 2;
      const d = HA.wallDir(wall), n = { x: -d.y, y: d.x };
      const mid = U.lerp(HA.wallA(wall), HA.wallB(wall), 0.5);
      return ((cx - mid.x) * n.x + (cy - mid.y) * n.y) > 0 ? 1 : -1;
    }
    const lp = HA.exteriorLoop(model, HA.levelOf(model, wall));
    if (!lp) return 1;
    const d = HA.wallDir(wall);
    const n = { x: -d.y, y: d.x };
    const mid = U.lerp(HA.wallA(wall), HA.wallB(wall), 0.5);
    const probe = U.add(mid, U.mul(n, HA.wallT(wall) / 2 + 4));
    return U.pointInPoly(probe, lp.pts) ? 1 : -1;
  };

  HA.findWall = (model, id) => {
    for (const L of model.levels)
      for (const w of L.walls) if (w.id === id) return w;
    return null;
  };
  HA.findOpening = (model, id) => {
    for (const L of model.levels)
      for (const w of L.walls)
        for (const o of w.openings || [])
          if (o.id === id) return { wall: w, opening: o };
    return null;
  };
  HA.findDormer = (model, id) =>
    (model.roof.dormers || []).find((d) => d.id === id) || null;
  HA.findDeck = (model, id) => {
    for (const L of model.levels)
      for (const d of L.decks || []) if (d.id === id) return d;
    return null;
  };
  HA.findEntrance = (model, id) => {
    for (const L of model.levels)
      for (const e of L.entrances || []) if (e.id === id) return e;
    return null;
  };
  HA.findPost = (model, id) => {
    for (const L of model.levels)
      for (const p of L.posts || []) if (p.id === id) return p;
    return null;
  };
  HA.findBlock = (model, id) => (model.blocks || []).find((b) => b.id === id) || null;
  HA.findSheet = (model, id) => (model.sheets || []).find((s) => s.id === id) || null;

  HA.clampOpening = (wall, o) => {
    const L = HA.wallLen(wall);
    const m = o.width / 2 + 3;
    o.pos = U.clamp(o.pos, Math.min(m, L / 2), Math.max(L - m, L / 2));
  };

  /* Clamp an opening's WIDTH so it fits inside the wall (used when the user
     TYPES a new window/door width in Properties): never wider than the wall
     minus a 3" jamb at each end, never below a 12" sane minimum, and capped at
     192" (16'). Re-clamps the opening's position afterwards so it stays seated.
     Mutates + returns the clamped width. */
  HA.clampOpeningWidth = (wall, o, want) => {
    const L = HA.wallLen(wall);
    const maxFit = Math.max(12, Math.min(192, L - 6));  // 3" jamb each end
    o.width = U.clamp(want, 12, maxFit);
    HA.clampOpening(wall, o);
    return o.width;
  };

  /* Resize a wall to an EXACT length by sliding ONE end along the wall's
     current direction (its angle is preserved); the other (fixedEnd) stays
     put. Any wall endpoints coincident with the moved end are dragged along
     too, so a closed loop / connected walls stay connected. fixedEnd: 0 keeps
     A (x1,y1) and moves B; 1 keeps B and moves A. Openings are re-clamped.
     Returns the new moved-end point, or null on bad input (used by the
     dimension editor + wall-properties Length field). */
  HA.setWallLength = (model, wall, fixedEnd, lengthIn) => {
    if (!wall || !(lengthIn > 0.5) || !isFinite(lengthIn)) return null;
    const dir = HA.wallDir(wall);
    if (!isFinite(dir.x) || !isFinite(dir.y) || (dir.x === 0 && dir.y === 0)) return null;
    fixedEnd = fixedEnd === 1 ? 1 : 0;
    const fixed = fixedEnd === 0 ? HA.wallA(wall) : HA.wallB(wall);
    const movingEnd = fixedEnd === 0 ? 1 : 0;            // the end we slide
    const oldP = movingEnd === 0 ? HA.wallA(wall) : HA.wallB(wall);
    const sgn = fixedEnd === 0 ? 1 : -1;                 // A->B points +dir
    const np = { x: fixed.x + sgn * dir.x * lengthIn, y: fixed.y + sgn * dir.y * lengthIn };
    // capture coincident mates at the OLD moving-end position BEFORE mutating
    const li = HA.levelOf(model, wall);
    const mates = [];
    const lv = model.levels[li];
    if (lv) for (const w of lv.walls) {
      if (w === wall || w.id === wall.id) continue;
      if (U.dist(HA.wallA(w), oldP) < 0.75) mates.push({ w, end: 0 });
      else if (U.dist(HA.wallB(w), oldP) < 0.75) mates.push({ w, end: 1 });
    }
    if (movingEnd === 0) { wall.x1 = np.x; wall.y1 = np.y; } else { wall.x2 = np.x; wall.y2 = np.y; }
    for (const o of wall.openings || []) HA.clampOpening(wall, o);
    for (const m of mates) {
      if (m.end === 0) { m.w.x1 = np.x; m.w.y1 = np.y; } else { m.w.x2 = np.x; m.w.y2 = np.y; }
      for (const o of m.w.openings || []) HA.clampOpening(m.w, o);
    }
    return np;
  };

  /* wall angle in DEGREES, folded to [0,180) (direction-agnostic). */
  HA.wallAngleDeg = (w) => {
    const a = Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180 / Math.PI;
    return ((a % 180) + 180) % 180;
  };
  /* The blessed ANGLE FAMILY, in degrees. Every 15° multiple reads as a drawn
     intention (0/90 ortho, 15/30/45/60/75 splays + bays); anything else is an
     accident. wallIsCrooked and straightenWall MUST share this constant — they
     are inverses of each other, and #56 was exactly what happens when they do
     not (crooked said "not on 15s", straighten said "go to 0/90", so a 32° wall
     was flagged and then slammed 32° to 0). */
  const WALL_ANGLE_STEP = 15;
  /* Snap a full-circle angle onto the family, keeping the A→B DIRECTION (never
     folds, so straighten can never flip a wall end-for-end). `base` rotates the
     whole family — see the level-rotation note on wallIsCrooked. */
  const snapWallAngle = (deg, base) => {
    const b = Number.isFinite(base) ? base : 0;
    return b + Math.round((deg - b) / WALL_ANGLE_STEP) * WALL_ANGLE_STEP;
  };
  /* A wall is "CROOKED" when its angle is NOT within `tol`° of a 15° multiple
     (0/15/30/45/60/75/90/...). The 0/90 and 15/30/45 family read as intentional;
     an odd angle (7°, 52°, ...) is flagged so the user can spot + fix it (Steve:
     "a cancel circle if a wall isnt 90/0 etc — 15/30/45 are fine, anything else").
     tol default 1.2°. Walls under 2" are ignored.

     `base` (deg, default 0) turns the family with the BUILDING. Rotate-to-street-
     front (HA.rotateDesign) is a shipped move and real street bearings are never
     multiples of 15, so an absolute family badges an entire clean plan the moment
     it turns: measured, rotateDesign(model, 7°) takes a 4-wall rectangle from 0/4
     crooked to 4/4, and 12° / 22.5° / 63.4° do the same. Crooked means "off the
     building's own module", not "off the world axis". base is INERT until the
     plan's pose is recorded and passed in (see the report on #56) — it must be
     switched on for wallIsCrooked and straightenWall together or the badge would
     flag a wall that straighten then refuses to move. */
  HA.wallIsCrooked = (w, tol, base) => {
    if (!w || HA.wallLen(w) < 2) return false;
    tol = tol == null ? 1.2 : tol;
    const d = HA.wallAngleDeg(w);
    const nearest = snapWallAngle(d, base);    // 0..180 (180 == 0)
    return Math.abs(d - nearest) > tol;
  };
  /* One-click STRAIGHTEN a wall onto the NEAREST MEMBER OF THE ANGLE FAMILY above
     — 32° goes to 30, not to 0 — keeping end A + the length fixed, swinging end B
     round and DRAGGING any coincident mates with it (mirrors setWallLength).
     Returns true if it moved.

     #56 (data loss): this used to snap to the nearest horizontal/vertical only,
     while wallIsCrooked blessed the whole 15° family. So the ⊘ badge invited the
     click and the click destroyed the wall — measured 32°→0° (a 32° jump) and
     52°→90° (38°). A user with a splayed entry, a bay or an angled wing wall lost
     it in one click, from BOTH callers (canvas badge + Properties button).
     Sharing one family bounds the move at half a step (7.5°) by construction, and
     makes straighten idempotent and a no-op on a wall already on the family.

     ANCHOR: end A never moves. Stable and deliberate — the badge is clicked at the
     midpoint with no drag direction to infer, and A-anchored matches setWallLength
     and snapEndpointToWall so repeated edits do not walk the wall around. */
  HA.straightenWall = (model, wall, base) => {
    if (!wall) return false;
    const len = HA.wallLen(wall);
    if (!(len > 0.5)) return false;
    const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
    const a = snapWallAngle(Math.atan2(dy, dx) * 180 / Math.PI, base) * Math.PI / 180;
    const np = { x: wall.x1 + Math.cos(a) * len, y: wall.y1 + Math.sin(a) * len };
    const oldB = HA.wallB(wall);
    if (U.dist(np, oldB) < 0.01) return false;    // already on the family
    const li = HA.levelOf(model, wall);
    const lv = model.levels[li];
    const mates = [];
    if (lv) for (const w of lv.walls) {
      if (w === wall || w.id === wall.id) continue;
      if (U.dist(HA.wallA(w), oldB) < 0.75) mates.push({ w, end: 0 });
      else if (U.dist(HA.wallB(w), oldB) < 0.75) mates.push({ w, end: 1 });
    }
    wall.x2 = np.x; wall.y2 = np.y;
    for (const o of wall.openings || []) HA.clampOpening(wall, o);
    for (const m of mates) {
      if (m.end === 0) { m.w.x1 = np.x; m.w.y1 = np.y; } else { m.w.x2 = np.x; m.w.y2 = np.y; }
      for (const o of m.w.openings || []) HA.clampOpening(m.w, o);
    }
    return true;
  };

  /* Auto-snap a wall's endpoint onto the nearest roughly-PERPENDICULAR wall within
     `maxDist` (default 12") — a forgiving T-junction connect so an interior wall
     latches to the wall it reaches toward (Steve #23: "auto-snap to the nearest
     perpendicular wall within 1', otherwise use an opening"). Moves the endpoint
     (+ coincident mates) to the perpendicular foot on that wall. Never latches a
     PARALLEL wall (|cos| filter). Returns true if it snapped. */
  HA.snapEndpointToWall = (model, wall, endIdx, maxDist) => {
    maxDist = maxDist == null ? 12 : maxDist;
    if (!wall) return false;
    const p = endIdx === 1 ? HA.wallB(wall) : HA.wallA(wall);
    const li = HA.levelOf(model, wall);
    const lv = model.levels[li];
    if (!lv) return false;
    const myDir = HA.wallDir(wall);
    let best = null, bestD = maxDist;
    for (const w of lv.walls) {
      if (w === wall || w.id === wall.id) continue;
      if (HA.wallLen(w) < 1) continue;
      if (Math.abs(U.dot(myDir, HA.wallDir(w))) > 0.5) continue;   // perpendicular only
      const a = HA.wallA(w), b = HA.wallB(w), ab = U.sub(b, a), L2 = U.dot(ab, ab) || 1;
      const t = U.clamp(U.dot(U.sub(p, a), ab) / L2, 0, 1);
      const foot = U.lerp(a, b, t);
      const d = U.dist(p, foot);
      if (d < bestD && d > 0.01) { bestD = d; best = foot; }
    }
    if (!best) return false;
    const np = best, oldP = p, mates = [];
    for (const w of lv.walls) {
      if (w === wall || w.id === wall.id) continue;
      if (U.dist(HA.wallA(w), oldP) < 0.75) mates.push({ w, end: 0 });
      else if (U.dist(HA.wallB(w), oldP) < 0.75) mates.push({ w, end: 1 });
    }
    if (endIdx === 1) { wall.x2 = np.x; wall.y2 = np.y; } else { wall.x1 = np.x; wall.y1 = np.y; }
    for (const o of wall.openings || []) HA.clampOpening(wall, o);
    for (const m of mates) {
      if (m.end === 0) { m.w.x1 = np.x; m.w.y1 = np.y; } else { m.w.x2 = np.x; m.w.y2 = np.y; }
      for (const o of m.w.openings || []) HA.clampOpening(m.w, o);
    }
    return true;
  };

  /* Split a wall at distance `at` along it. Openings stay with the
     segment that contains them; each piece keeps independent props
     afterwards (type, gable, material, height...). Returns new wall. */
  HA.splitWall = (model, wall, at) => {
    const len = HA.wallLen(wall);
    if (at < 6 || at > len - 6) return null;
    const li = HA.levelOf(model, wall);
    const d = HA.wallDir(wall);
    const p = U.add(HA.wallA(wall), U.mul(d, at));
    const w2 = Object.assign({}, wall, {
      id: U.uid(),
      x1: p.x, y1: p.y,
      openings: [],
    });
    const keep = [], move = [];
    for (const o of wall.openings || []) {
      if (o.pos <= at) keep.push(o);
      else { o.pos -= at; move.push(o); }
    }
    wall.openings = keep;
    w2.openings = move;
    wall.x2 = p.x; wall.y2 = p.y;
    for (const o of wall.openings) HA.clampOpening(wall, o);
    for (const o of w2.openings) HA.clampOpening(w2, o);
    const walls = model.levels[li].walls;
    walls.splice(walls.indexOf(wall) + 1, 0, w2);
    return w2;
  };

  /* ---------- factories ---------- */
  HA.makeWall = (x1, y1, x2, y2, type, settings) => ({
    id: U.uid(),
    x1, y1, x2, y2,
    type: type || 'ext2x6',
    height: (HA.WALL_TYPES[type] || {}).defH || (settings ? settings.wallHeight : 96),
    gable: false,
    material: null,      // material id override for the exterior face
    openings: [],
  });

  HA.makeWindow = (pos, w, h, sill) => ({
    id: U.uid(), kind: 'window', pos,
    width: w || 36, height: h || 48, sill: sill == null ? 32 : sill,
    trim: 'craftsman', trimColor: '#f4f1ea', muntins: true,
    // operation type + grid pattern (see HA.WINDOW_TYPES / HA.WINDOW_GRIDS).
    // grid defaults null so legacy muntins:true keeps the old colonial look
    // until gen/UI stamps a style-appropriate value.
    winType: 'double_hung', grid: null, slide: 'right',
    header: 'auto',
  });

  HA.makeDoor = (pos, w, opts) => Object.assign({
    id: U.uid(), kind: 'door', pos,
    width: w || 36, height: 80,
    hinge: 'left', swing: 'in',
    doorType: 'hinged', style: 'panel', panels: 2, handle: 'lever',
    trim: 'modern', trimColor: '#f4f1ea',
    header: 'auto',
  }, opts || {});

  HA.makeDormer = (wallId, offset) => ({
    id: U.uid(), wallId, offset, width: 72, inset: 30, sideH: 48,
    window: true, winW: null, winH: null, sill: 8, // null = fit to dormer
  });

  HA.makeDeck = (x1, y1, x2, y2) => ({
    id: U.uid(),
    x1: Math.min(x1, x2), y1: Math.min(y1, y2),
    x2: Math.max(x1, x2), y2: Math.max(y1, y2),
    drop: 1,            // deck surface sits this far below level floor
    railing: true,
    covered: false,     // shed roof + posts (porch)
    joistDir: 'auto',   // 'auto' | 'x' | 'y'
    material: 'deck_cedar',
    // ---- house-attach metadata is ADDITIVE + ABSENT by default (mirrors
    //   wall.brace): a plain rect deck carries NO attach/anchorWallId/wrap/
    //   enclosed keys, so it serializes byte-identically to a legacy deck and
    //   the area schedule / 2D / 3D render are unchanged. The keys appear ONLY
    //   when attach-on-finish detects a ledger ('attach':'back' + 'anchorWallId')
    //   or the enclosure detector fires ('enclosed':true). Reserved 'wrap' (a
    //   future multi-leg renderer) is likewise absent until used. Every reader
    //   guards with (d.attach||'free') / !!d.enclosed.
  });

  /* The 4 axis-aligned edges of a rectangular deck, each as {a,b,axis,mid}.
     axis 'h' = horizontal (constant y), 'v' = vertical (constant x). */
  const deckEdges = (d) => {
    const x0 = Math.min(d.x1, d.x2), x1 = Math.max(d.x1, d.x2);
    const y0 = Math.min(d.y1, d.y2), y1 = Math.max(d.y1, d.y2);
    const E = (a, b, axis) => ({ a, b, axis, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
    return [
      E({ x: x0, y: y0 }, { x: x1, y: y0 }, 'h'), // top
      E({ x: x1, y: y0 }, { x: x1, y: y1 }, 'v'), // right
      E({ x: x1, y: y1 }, { x: x0, y: y1 }, 'h'), // bottom
      E({ x: x0, y: y1 }, { x: x0, y: y0 }, 'v'), // left
    ];
  };

  /* ATTACH-ON-FINISH detector. Tests whether a rectangular deck has an edge
     lying ALONG / NEAR an exterior wall of the house (HA.exteriorLoop), so the
     deck reads as ledgered to the back of the house.

     Returns null (no host wall found) or:
       { wallId, edgeIndex, axis, line:<world coord the edge should snap to>,
         dir:'x'|'y', sign:+1|-1 }  where snapping moves the matched edge onto
     `line` (an exact translate of that one edge along its perpendicular axis,
     keeping the rectangle axis-aligned). The caller mutates the deck +1/-1 edge
     to `line` and sets attach='back'+anchorWallId. Conservative: only edges
     that are PARALLEL to and within `tol` of a colinear exterior-wall segment,
     with meaningful overlap, qualify — so a deck merely *near* a corner won't
     wrongly latch. */
  HA.deckAttachDetect = (model, deck, levelIdx, tol) => {
    if (!HA.exteriorLoop) return null;
    const loop = HA.exteriorLoop(model, levelIdx == null ? 0 : levelIdx);
    if (!loop || !loop.pts || loop.pts.length < 3) return null;
    tol = tol == null ? 18 : tol;             // within 18" (1.5') reads as "along the wall"
    const edges = deckEdges(deck);
    let best = null;
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      const eLen = U.dist(e.a, e.b);
      if (eLen < 24) continue;                 // ignore stubby edges
      for (let i = 0; i < loop.pts.length; i++) {
        const wa = loop.pts[i], wb = loop.pts[(i + 1) % loop.pts.length];
        const wDx = wb.x - wa.x, wDy = wb.y - wa.y;
        // wall must be axis-aligned + parallel to the edge (deck rects are AA)
        const wHoriz = Math.abs(wDy) < 1e-6, wVert = Math.abs(wDx) < 1e-6;
        if (e.axis === 'h' && !wHoriz) continue;
        if (e.axis === 'v' && !wVert) continue;
        if (!wHoriz && !wVert) continue;       // skip non-AA walls (defensive)
        // perpendicular distance edge<->wall line + overlap along the shared axis
        let perp, line, dir, sign;
        if (e.axis === 'h') {                  // both run in x; compare y
          perp = Math.abs(e.mid.y - wa.y);
          line = wa.y; dir = 'y';
          // overlap in x
          const ex0 = Math.min(e.a.x, e.b.x), ex1 = Math.max(e.a.x, e.b.x);
          const wx0 = Math.min(wa.x, wb.x), wx1 = Math.max(wa.x, wb.x);
          const ov = Math.min(ex1, wx1) - Math.max(ex0, wx0);
          if (ov < Math.min(eLen, U.dist(wa, wb)) * 0.5) continue;
          sign = e.mid.y < wa.y ? -1 : 1;
        } else {                               // both run in y; compare x
          perp = Math.abs(e.mid.x - wa.x);
          line = wa.x; dir = 'x';
          const ey0 = Math.min(e.a.y, e.b.y), ey1 = Math.max(e.a.y, e.b.y);
          const wy0 = Math.min(wa.y, wb.y), wy1 = Math.max(wa.y, wb.y);
          const ov = Math.min(ey1, wy1) - Math.max(ey0, wy0);
          if (ov < Math.min(eLen, U.dist(wa, wb)) * 0.5) continue;
          sign = e.mid.x < wa.x ? -1 : 1;
        }
        if (perp > tol) continue;
        if (!best || perp < best.perp)
          best = { wallId: loop.walls[i] && loop.walls[i].id || null, edgeIndex: ei, axis: e.axis, line, dir, perp, sign };
      }
    }
    if (!best) return null;
    return { wallId: best.wallId, edgeIndex: best.edgeIndex, axis: best.axis, line: best.line, dir: best.dir };
  };

  /* Snap the deck's matched edge EXACTLY onto the host wall line (the result of
     deckAttachDetect), keeping the rectangle axis-aligned. Mutates + returns the
     deck; also sets attach='back' + anchorWallId. The framing ledger + railing
     drop are then handled by the EXISTING nearHouse test in HA.framing.deck. */
  HA.deckApplyAttach = (deck, det) => {
    if (!det) return deck;
    if (det.dir === 'y') {                     // move the y-edge closest to det.line
      if (Math.abs(deck.y1 - det.line) <= Math.abs(deck.y2 - det.line)) deck.y1 = det.line;
      else deck.y2 = det.line;
    } else {                                   // move the x-edge closest to det.line
      if (Math.abs(deck.x1 - det.line) <= Math.abs(deck.x2 - det.line)) deck.x1 = det.line;
      else deck.x2 = det.line;
    }
    // keep corners sorted (makeDeck invariant the area schedule relies on)
    if (deck.x1 > deck.x2) { const t = deck.x1; deck.x1 = deck.x2; deck.x2 = t; }
    if (deck.y1 > deck.y2) { const t = deck.y1; deck.y1 = deck.y2; deck.y2 = t; }
    deck.attach = 'back';
    deck.anchorWallId = det.wallId || null;
    return deck;
  };

  /* ENCLOSURE DETECTOR — the "it knows" part. Tests whether the deck closes off
     a CONCAVE POCKET of the exterior loop: i.e. the deck rectangle bridges across
     a notch of the house so that deck∪house bound a region that is OUTSIDE the
     house yet hemmed in on 3+ sides. Returns true/false.

     Conservative, false-positive-safe strategy:
       1. The deck must be ATTACHED on at least TWO opposite-ish house edges
          (its rectangle straddles a notch): we count how many of the deck's 4
          edges lie along the exterior loop (reuse the same colinear test). A
          single ledger (normal back deck) => at most 1 attached edge => NOT
          enclosed. A deck spanning a U/L notch touches the loop on >=2 edges.
       2. AND the deck must actually OVERLAP the loop's bounding span on the open
          axis (it caps the mouth of the pocket), with a non-trivial pocket area
          between the deck's inner edge and the notch.
     If either test fails we return false — a plain back deck never trips it. */
  HA.deckEnclosureDetect = (model, deck, levelIdx) => {
    if (!HA.exteriorLoop) return false;
    const loop = HA.exteriorLoop(model, levelIdx == null ? 0 : levelIdx);
    if (!loop || !loop.pts || loop.pts.length < 4) return false; // need a non-rect (notched) house
    // a strictly rectangular house has no concave pocket -> never enclosed
    const ptsKeyN = new Set(loop.pts.map((p) => Math.round(p.x) + ',' + Math.round(p.y))).size;
    if (ptsKeyN <= 4) return false;
    const tol = 18;
    const edges = deckEdges(deck);
    // count how many deck edges lie ALONG an exterior-wall segment (colinear,
    // within tol, with real overlap) — the same colinear test as attach.
    let touching = 0;
    const touchAxes = { h: 0, v: 0 };
    for (const e of edges) {
      const eLen = U.dist(e.a, e.b);
      if (eLen < 24) continue;
      let hit = false;
      for (let i = 0; i < loop.pts.length; i++) {
        const wa = loop.pts[i], wb = loop.pts[(i + 1) % loop.pts.length];
        const wHoriz = Math.abs(wb.y - wa.y) < 1e-6, wVert = Math.abs(wb.x - wa.x) < 1e-6;
        if (e.axis === 'h' && !wHoriz) continue;
        if (e.axis === 'v' && !wVert) continue;
        if (e.axis === 'h') {
          if (Math.abs(e.mid.y - wa.y) > tol) continue;
          const ex0 = Math.min(e.a.x, e.b.x), ex1 = Math.max(e.a.x, e.b.x);
          const wx0 = Math.min(wa.x, wb.x), wx1 = Math.max(wa.x, wb.x);
          if (Math.min(ex1, wx1) - Math.max(ex0, wx0) < eLen * 0.4) continue;
        } else {
          if (Math.abs(e.mid.x - wa.x) > tol) continue;
          const ey0 = Math.min(e.a.y, e.b.y), ey1 = Math.max(e.a.y, e.b.y);
          const wy0 = Math.min(wa.y, wb.y), wy1 = Math.max(wa.y, wb.y);
          if (Math.min(ey1, wy1) - Math.max(ey0, wy0) < eLen * 0.4) continue;
        }
        hit = true; break;
      }
      if (hit) { touching++; touchAxes[e.axis]++; }
    }
    // A normal back deck touches the loop on exactly ONE edge => not enclosed.
    // A courtyard-capping deck spans the notch and touches on >=2 edges,
    // including at least one PAIR on the SAME axis (the two jambs of the pocket)
    // OR two different axes that wrap a corner of the notch.
    if (touching < 2) return false;
    // require the pocket to have real interior: the deck centroid must sit
    // OUTSIDE the house (it's an open-air court, not a roofed room) AND the
    // midpoint just inside the deck's far edge must ALSO be outside the loop.
    const cx = (deck.x1 + deck.x2) / 2, cy = (deck.y1 + deck.y2) / 2;
    if (U.pointInPoly && U.pointInPoly({ x: cx, y: cy }, loop.pts)) return false;
    // a pair of jambs on one axis (U-notch) OR a wrapped corner (both axes) —
    // either way >=2 touches with at least one axis-pair or cross-axis wrap.
    const wrapsCorner = touchAxes.h >= 1 && touchAxes.v >= 1;
    const spansNotch = touchAxes.h >= 2 || touchAxes.v >= 2;
    return wrapsCorner || spansNotch;
  };

  /* A covered/uncovered ENTRANCE landing — a stoop/porch parented to an
     exterior wall (and optionally a door opening). Like a deck, but ATTACHED
     and outward-facing: pos is the world plan point of the landing's CENTER on
     the wall's exterior face; facing is the OUTWARD unit normal {x,y} so the
     landing + steps extend away from the building. preset names the catalog
     entry it was last built from (so the props panel can offer a swap). The
     2D plan symbol, 3D landing/cover and the AI add/set_entrance tools all
     read this one record. Mirrors the makeDeck idiom (no auto-framing yet). */
  HA.makeEntrance = (x, y, facing) => ({
    id: U.uid(),
    kind: 'entrance',
    wallId: null,            // host exterior wall (optional, for re-anchoring)
    doorId: null,            // host door opening (optional)
    pos: { x: x || 0, y: y || 0 }, // landing center on the wall exterior face (world inches)
    facing: facing && isFinite(facing.x) && isFinite(facing.y)
      ? { x: facing.x, y: facing.y } : { x: 0, y: 1 }, // OUTWARD normal (default south/+y)
    preset: 'small',
    width: 48,              // along the wall (inches)
    depth: 48,              // outward from the wall (inches)
    landing: 'concrete',    // 'concrete' (extrudes to grade + steps) | 'wood' (raised platform)
    steps: 2,               // step treads down to grade (auto from stem height in 3D too)
    ceilingH: 96,           // post/cover height above the finish floor (inches)
    roofType: 'gable',      // 'shed' | 'gable' | 'hip' | 'flat' | 'none'
    ceiling: 'closed',      // 'closed' (flat ceiling + ceiling joists) | 'cathedral' (open to the rafters)
    ceilingMaterial: null,  // null = default (drywall/soffit); else a material id for the underside
    pillarStyle: 'square',  // 'square' | 'round' | 'gothic' | 'tapered' | 'craftsman'
    pillarSize: 5.5,        // post nominal size (inches)
    railing: false,
    railHeight: 36,         // guard rail height above the landing top (inches; code min 36")
    railInfill: 'baluster', // 'baluster' (vertical, <=4" gap) | 'cable' (horizontal runs)
    railPost: 3.5,          // guard post nominal size (inches; default 4x4 = 3.5")
    railPostSpacing: 72,    // max guard-post spacing where there are NO decorative posts (inches)
    doorGap: 42,            // clear opening kept rail-free at the door (inches)
    stairWidth: 60,         // centered stair flight width (inches); rest of the front is railed
    joistMode: 'hung',      // wood-deck joists: 'hung' (hang from the beam, flush) | 'below' (beam under joists)
    ceilJoistDir: 'house',  // porch CEILING joists: 'house' (to the wall ledger + hanger clips) | 'side' (side-to-side, on the beams)
    material: 'concrete',   // landing surface material id
    roofMaterial: null,     // null = plan-default roof material
  });

  /* Resolve an entrance's plan geometry from its pos + facing + width/depth.
     Returns the outward unit normal (out), the along-wall unit vector (along),
     the 4 landing corners (CCW: inner-left, inner-right, outer-right, outer-left)
     and the four post points at the OUTER + (covered) inner-outer corners. The
     inner edge sits AT the wall face (pos); the landing extends `depth` outward.
     Shared by the 2D plan symbol and the 3D render so they always agree. */
  HA.entranceGeom = (e) => {
    let out = e.facing && isFinite(e.facing.x) && isFinite(e.facing.y) ? { x: e.facing.x, y: e.facing.y } : { x: 0, y: 1 };
    let m = Math.hypot(out.x, out.y);
    if (!(m > 1e-6)) { out = { x: 0, y: 1 }; m = 1; }
    out = { x: out.x / m, y: out.y / m };
    const along = { x: -out.y, y: out.x };       // perpendicular, along the wall
    const hw = (e.width || 48) / 2, dp = e.depth || 48;
    const c = e.pos || { x: 0, y: 0 };
    const P = (a, o) => ({ x: c.x + along.x * a + out.x * o, y: c.y + along.y * a + out.y * o });
    const corners = [P(-hw, 0), P(hw, 0), P(hw, dp), P(-hw, dp)]; // inner-L, inner-R, outer-R, outer-L
    const inset = Math.min(6, hw / 3, dp / 3);
    const posts = [P(-hw + inset, dp - inset), P(hw - inset, dp - inset)]; // front (outer) posts
    return { out, along, hw, dp, corners, posts, center: c };
  };

  /* TRUE entrance stair flight — the ONE solver shared by the 3D build and the 2D
     plan symbol so the drawn stair always matches the built stair (AUDIT batch D:
     the plan drew e.steps||2 decorative lines regardless of the real riser count).
     topY   = landing top == finish floor (level elev).
     datum  = the WALKING surface the flight hangs from: a wood landing's decking is
              dropped 1" below the threshold (sheds water), concrete is flush.
     gradeY = grade under the flight: -stemHeight by default, then LOWERED (never
              raised) by sampling the terrain across the full flight footprint —
              identical 2-pass sampling to the 3D build (AUDIT #19).
     Risers: nR = ceil(rise/7.75) then relaxed while still <= the 7.75" IRC max;
     tread run fixed at 11". */
  HA.entranceFlight = (model, li, e) => {
    const g = HA.entranceGeom(e);
    const elev = HA.levelElev(model, li || 0);
    const topY = elev;
    const fd = model.foundation || {};
    let gradeY = li ? elev : -(fd.stemHeight || 0);
    const stairHalf = Math.min(g.hw - 2, Math.max(18, (e.stairWidth || 60) / 2));
    if (!li && HA.terrain && typeof HA.terrain.heightAtInches === 'function') {
      try {
        const offIn = (HA.terrain && typeof HA.terrain.effectiveOffsetIn === 'function')
          ? HA.terrain.effectiveOffsetIn(model)                 // auto datum + user delta (spec A)
          : ((model.site && model.site.terrain && model.site.terrain.offsetIn) || 0);
        const sampleAt = (a, o) => {
          const h = HA.terrain.heightAtInches(model,
            e.pos.x + g.along.x * a + g.out.x * o,
            e.pos.y + g.along.y * a + g.out.y * o);
          return (h != null && isFinite(h)) ? (h - (fd.stemHeight || 0) + offIn) : null;
        };
        const g0 = sampleAt(0, g.dp);
        let gY = (g0 != null) ? Math.min(gradeY, g0) : gradeY;
        const nEst = Math.max(1, Math.ceil(Math.max(0, topY - gY) / 7.75));
        const fLen = Math.max(11, (nEst - 1) * 11);
        for (const a of [-stairHalf, 0, stairHalf])
          for (const o of [g.dp, g.dp + fLen / 2, g.dp + fLen]) {
            const h = sampleAt(a, o);
            if (h != null) gY = Math.min(gY, h);
          }
        gradeY = Math.min(gradeY, gY);
      } catch (err) { /* terrain optional — never break a render */ }
    }
    // WALKING-SURFACE drop below the finish floor: user-settable per entrance
    // (e.floorDrop, Steve Jul 1); defaults keep the long-standing behavior —
    // wood decking 1" below the threshold (sheds water), concrete flush.
    const drop = Math.min(24, Math.max(0,
      Number.isFinite(e.floorDrop) ? e.floorDrop : (e.landing === 'wood' ? 1 : 0)));
    const datum = topY - drop;
    const rise = Math.max(0, datum - gradeY);
    // RISER solve (CRC R311.7.5.1, max 7-3/4"): start at the code minimum count
    // ceil(rise/7.75), then DROP a riser only while the remainder still passes the
    // 7.75" max — this nudges toward a comfortable ~7" without ever emitting an
    // illegal riser. The while-guard makes an over-7.75 riser unreachable, but we
    // still CLAMP + flag defensively so a future edit can't leak a bad value.
    let nR = Math.max(1, Math.ceil(rise / 7.75));
    while (nR > 1 && rise / (nR - 1) <= 7.75) nR--;
    let riser = nR ? rise / nR : 0;
    const MAX_RISER = 7.75, MIN_TREAD = 10, MIN_WIDTH = 36, TREAD = 11; // CRC R311.7
    let riserWarn = null;
    if (riser > MAX_RISER + 1e-6) {          // defensive clamp — re-solve to satisfy the max
      nR = Math.max(1, Math.ceil(rise / MAX_RISER));
      riser = nR ? rise / nR : 0;
      riserWarn = 'RISER CLAMPED TO 7-3/4" MAX PER CRC R311.7.5.1';
    }
    // WIDTH (CRC R311.7.1, 36" clear min). stairHalf is half the flight width; on a
    // narrow entrance it can clamp below 18" → sub-36" clear. Surface it (flag) so the
    // plan symbol prints RED and callers can warn — the geometry stays as-drawn.
    const width = stairHalf * 2;
    const widthOk = width >= MIN_WIDTH - 1e-6;
    const treadOk = TREAD >= MIN_TREAD - 1e-6;   // fixed 11" run — always true, pinned for the notes tie
    // FRAMING TRUTH: 2x12 cut carriage stringers @ ≤18" o.c. (matches the 3D @16"
    // build). Count = ceil(width/16)+1 edges+interior so the ACTUAL o.c. never
    // exceeds 16" (a plain floor(width/16)+1 left a 56" flight at 18.7" o.c.).
    const stringerN = Math.max(2, Math.ceil(width / 16) + 1);
    const stringerOC = width / (stringerN - 1);   // actual o.c. (≤16 by construction)
    // SLAB/GRADE PAD (CRC R507.3-style bearing pad) under the bottom of the flight —
    // present whenever the flight lands on grade (li 0, i.e. exterior at grade). The
    // 3D build pours an 8"-thick pad the full stair width + 4" each side, 22" deep.
    const landsAtGrade = !li && nR > 1;
    const pad = landsAtGrade
      ? { width: width + 8, depth: 22, thickness: 8, unit: 'in' }
      : null;
    // FRAMING NOTES payload the parametric stair DETAIL reads verbatim (strings +
    // numbers). Shape is a CONTRACT — see dev-staircode-test.cjs.
    const notes = {
      stringers: stringerN + 'x 2x12 cut carriage stringers @ ' +
        (stringerOC <= 16.5 ? '16"' : '18"') + ' o.c. max',
      riser: 'RISER ' + (Math.round(riser * 16) / 16).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') +
        '" (7-3/4" MAX — CRC R311.7.5.1)',
      tread: 'TREAD ' + TREAD + '" RUN (10" MIN — CRC R311.7.5.2)',
      width: (widthOk ? '' : '** ') + width + '" CLR — 36" MIN PER CRC R311.7.1' + (widthOk ? '' : ' — UNDER MIN'),
      hanger: 'TOP OF STRINGER HANGS FROM RIM/LEDGER W/ JOIST HANGER; BOTTOM BEARS ON PAD',
      fire: '1/2" GYP BD @ ENCLOSED USABLE SPACE UNDER STAIR (CRC R302.7)',
      pad: pad ? (pad.width + '"W x ' + pad.depth + '"D x ' + pad.thickness + '" CONC PAD AT BOTTOM BEARING') : 'N/A (RAISED/DECK BEARING)',
    };
    return {
      topY, datum, drop, gradeY, rise, nR, riser,
      tread: TREAD, stairHalf, flightLen: (nR - 1) * TREAD,
      // --- code-truth additions (CRC R311.7) ---
      width, widthOk, treadOk, riserOk: riser <= MAX_RISER + 1e-6,
      riserWarn, stringerN, stringerOC, pad, notes,
    };
  };

  /* ---- GARAGE FLOOR ELEVATION (Steve, garage-site-spec B/C/D) ----
     The garage slab sits BELOW the house finish floor — 8" on a slab-on-grade
     house (a curb between the house slab + the lower garage slab), ~18" on a
     raised-floor house (the house rides the crawlspace, the garage sits into
     grade). The DEFAULT drop is picked from foundation.type; the user may pin a
     custom value on the garage room label (fixture.floorDrop). This is the ONE
     place every consumer (terrain pad, foundation stem step, 3D floor, the
     house→garage steps, tests) reads the garage elevation truth, so a moved
     house re-derives correctly (the label fixture + its stored rect ride the
     move; nothing bakes an absolute world coord here).

     Returns null when the level-0 plan has no garage. Otherwise:
       { label, floorDrop, ffY (=0, house finish floor on L0), slabY (=-drop),
         rect:{x0,y0,x1,y1} (WORLD plan inches, re-derived from the LIVE label
         position + its stored corner offsets — moves with the house),
         steps:{material,dir}, manDoor:{x,y} | null }
     `rect` is null when the label carries no stored garageRect (an old file /
     hand-placed label) — consumers then fall back to their prior behavior. */
  HA.GARAGE_DROP_SLAB = 8;
  HA.GARAGE_DROP_RAISED = 18;
  /* GRADE-DRIVEN default drop (Steve redline Jul 6: "NEVER drop the garage slab 18
     inch like a raised" — i.e. the slab founds at ITS OWN GRADE, never a fixed dig
     below FF). The garage slab tops out AT the natural grade line: world grade sits
     at −stemHeight, so on FLAT/off terrain floorDrop == stemHeight — which equals
     the legacy 8 (slab) / 18 (raised) constants for the default stems, so existing
     models render byte-identically. With LIVE terrain the local natural grade under
     the garage refines it: an uphill garage RISES with grade (drop shrinks — the
     slab is never buried), a downhill one follows grade down. The FF−slab difference
     is then made up at the man door by the landing+steps (garageStepFlight), however
     big it computes. Uses terrain.naturalHeightAt (raw grade — NOT heightAtInches,
     whose garage pad derives from THIS function; that would recurse). */
  HA.garageDefaultDrop = (model, rect) => {
    const fd = (model && model.foundation) || {};
    const stem = Number.isFinite(fd.stemHeight) ? fd.stemHeight
      : (fd.type === 'raised' ? HA.GARAGE_DROP_RAISED : HA.GARAGE_DROP_SLAB);
    let rise = 0;
    if (rect && HA.terrain && typeof HA.terrain.naturalHeightAt === 'function') {
      try {
        const h = HA.terrain.naturalHeightAt(model, (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2);
        if (h != null && isFinite(h)) rise = h;
      } catch (e) { rise = 0; }
    }
    // slab top at local natural grade: drop = stem − rise, kept in a sane band
    return Math.min(48, Math.max(2, stem - rise));
  };
  HA.garageInfo = (model) => {
    const lvl = model && model.levels && model.levels[0];
    if (!lvl) return null;
    const label = (lvl.fixtures || []).find(
      (f) => f && f.type === 'room_label' && f.garage === true && /garage/i.test(f.text || ''));
    if (!label) return null;
    // WORLD rect re-derived from the LIVE label anchor + stored corner OFFSETS
    // (dx0,dy0,dx1,dy1). moveHouse translates label.x/.y, so the rect follows the
    // house with no baked absolute coord (spec D: "everything derives from the
    // garage geometry … if the house/garage MOVES, the pad re-derives").
    let rect = null;
    const gr = label.garageRect;
    if (gr && Number.isFinite(gr.dx0)) {
      rect = {
        x0: label.x + Math.min(gr.dx0, gr.dx1), y0: label.y + Math.min(gr.dy0, gr.dy1),
        x1: label.x + Math.max(gr.dx0, gr.dx1), y1: label.y + Math.max(gr.dy0, gr.dy1),
      };
    }
    // GRADE-DRIVEN drop (needs the rect for the local grade sample); a user-pinned
    // label.floorDrop still overrides. Clamped: never above FF, never a full wall.
    const def = HA.garageDefaultDrop(model, rect);
    const floorDrop = Math.min(48, Math.max(0,
      Number.isFinite(label.floorDrop) ? label.floorDrop : def));
    const steps = {
      material: (label.stepMaterial === 'wood') ? 'wood' : 'concrete',
      dir: (['straight', 'left', 'right'].includes(label.stepDir)) ? label.stepDir : 'straight',
    };
    // man-door re-derived from the LIVE label anchor + stored OFFSET (dx,dy) so it
    // follows a moved house (moveHouse translates the label). Old files that stored
    // an absolute {x,y} still resolve.
    let manDoor = null;
    if (label.manDoor) {
      if (Number.isFinite(label.manDoor.dx))
        manDoor = { x: label.x + label.manDoor.dx, y: label.y + label.manDoor.dy, nx: label.manDoor.nx, ny: label.manDoor.ny };
      else if (Number.isFinite(label.manDoor.x))
        manDoor = { x: label.manDoor.x, y: label.manDoor.y, nx: label.manDoor.nx, ny: label.manDoor.ny };
    }
    return { label, floorDrop, ffY: 0, slabY: -floorDrop, rect, steps, manDoor };
  };

  /* HA.garageWallDrop(model, wall[, gi]) — how far (inches, >=0) a wall's BASE drops
     BELOW the house finish floor because it bounds the garage. Steve (Jul 5): "garages
     should sit at same ceiling height as the house, not drop down into … garage ceiling
     heights are always higher than the adjacent rooms." The garage TOP PLATE aligns with
     the house plate (walls carry lvl.height like every other L0 wall), but the garage
     FLOOR is floorDrop lower — so a garage perimeter wall must extend DOWN to its own
     slab (base at slabY), making it TALLER than a house wall by exactly floorDrop while
     the plate stays put. This returns that base drop so the renderer/framing can lower
     the wall bottom without touching the plate. 0 for any non-garage wall / no garage.
     A wall bounds the garage when BOTH endpoints lie on the garage rect perimeter (the
     shared house↔garage wall counts — it's the fire-sep curb wall). Pure; re-derives
     from the LIVE garage rect (moves with the house). */
  HA.garageWallDrop = (model, wall, gi) => {
    gi = gi || HA.garageInfo(model);
    if (!gi || !gi.rect || !gi.floorDrop) return 0;
    const a = HA.wallA(wall), b = HA.wallB(wall);
    if (!a || !b) return 0;
    const r = gi.rect, T = 3;   // 3" tolerance for grid/miter slop
    const onRect = (p) =>
      (Math.abs(p.x - r.x0) <= T || Math.abs(p.x - r.x1) <= T || Math.abs(p.y - r.y0) <= T || Math.abs(p.y - r.y1) <= T) &&
      p.x >= r.x0 - T && p.x <= r.x1 + T && p.y >= r.y0 - T && p.y <= r.y1 + T;
    // also require the wall MIDPOINT on the rect boundary (rejects a wall that only
    // touches a single garage corner, e.g. a house wall meeting the garage at a corner)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return (onRect(a) && onRect(b) && onRect(mid)) ? gi.floorDrop : 0;
  };

  /* HA.wallOpeningCut(model, wall, o) — the opening's CUT rectangle in wall-local
     coords (y measured up from the WALL BASE — which is the garage slab on a dropped
     garage wall, the finish floor everywhere else). ONE source of truth for the 3D
     wall-face hole so the structural face / gyp / cladding all subtract identically.
     Steve redlines (Jul 6):
       "siding is going through garage here" → the OVERHEAD garage door (doorType/
         style 'garage') cuts to the base EXACTLY (y0 = 0): its bottom meets the slab
         (the driveway rides 1" below just outside), no siding strip below it.
       "the door shoots through the floor … down into the garage" → the MAN DOOR (a
         regular swing door in the dropped SHARED house↔garage wall) serves the HOUSE
         side: its SILL sits at house FF — floorDrop ABOVE the wall base — with the
         step flight (HA.garageStepFlight) making up the drop below it on the garage
         side. Cutting it to the slab opened an 18" hole through the house floor edge.
       So on a dropped wall: overhead door → y0 = 0; any other door → y0 = drop + the
       legacy 0.05" sliver, head at drop + height (a normal house door above FF).
     On a normal wall doors keep the legacy 0.05" sliver. Windows keep their sill
     (base-relative on a dropped wall — the slab-relative dimension a garage window
     is speced with). Pure + move-safe (reads garageWallDrop → the live rect). */
  HA.wallOpeningCut = (model, wall, o) => {
    const drop = (HA.garageWallDrop ? HA.garageWallDrop(model, wall) : 0) || 0;
    if (o.kind === 'door') {
      const overhead = (o.doorType === 'garage' || o.style === 'garage');
      if (drop > 0 && overhead) return { y0: 0, y1: o.height };
      // sillAtSlab: an EXTERIOR person door serving the GARAGE side of a dropped
      // wall (the ADU corner garage's out-facing man door) — it lands on the slab,
      // not up at house FF.
      if (drop > 0 && o.sillAtSlab) return { y0: 0.05, y1: o.height };
      if (drop > 0) return { y0: drop + 0.05, y1: drop + o.height };
      return { y0: 0.05, y1: o.height };
    }
    return { y0: o.sill, y1: o.sill + o.height };
  };

  /* HA.garageFloorHole(model) — the polygon to HOLE out of the L0 FINISH floor (and
     any other FF-level deck) over the garage, or null when there's no garage. ONE
     source of truth shared by the renderer + tests. Per-side insets (Steve redlines
     Jul 6: "raised floor wood inside the garage" + "floor from house comes out
     through garage"):
       - EXTERIOR rect edges (on the exterior loop) inset 3": the finish floor is
         drawn on the loop offset −2" and its hole-containment guard DROPS any hole
         not strictly inside — a 3" inset passes the guard and the 3" finish sliver
         hides under the exterior wall plates.
       - INTERIOR edges (the shared house↔garage seam) inset 0": the hole reaches the
         full rect line so NO finish-floor edge protrudes past the shared wall into
         the garage (the seam is far from the loop, so the guard passes at 0).
     Pure + move-safe (live garageInfo rect + live exterior loop). */
  HA.garageFloorHole = (model) => {
    const gi = HA.garageInfo(model);
    if (!gi || !gi.rect) return null;
    const loop = HA.exteriorLoop ? HA.exteriorLoop(model, 0) : null;
    if (!loop || !loop.pts || loop.pts.length < 3) return null;
    const r = gi.rect;
    // the finish floor is drawn on the exterior loop OFFSET −2"; a THREE.Shape hole
    // must lie strictly inside that outline or the renderer drops it. Start from the
    // FULL rect (seam sides flush — nothing protrudes past the shared wall) and pull
    // ONLY the violating vertices (the rect corners/edges that sit ON the exterior
    // loop) just inside the −2" poly. A clamped vertex ends ~2.1" inside the loop —
    // under the exterior wall plates and behind their ~2.2" gyp face — while every
    // interior (seam) vertex stays AT the rect line (the seam wall can be a thin
    // int2x4 whose gyp face is only ~1.7" out; a uniform >2" inset would poke past
    // it, which is exactly the wood edge Steve saw from inside the garage).
    const poly = (U.offsetPoly ? U.offsetPoly(loop.pts, loop.pts.map(() => -2)) : null);
    if (!poly || poly.length < 3) return null;
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    // pull a violating vertex INTO the rect until it clears the −2" poly: try the
    // single-axis moves first (keeps the other axis FLUSH on a seam side), then the
    // diagonal (convex loop corners need both; reflex corners — where the house
    // steps past the garage rear — also resolve on the diagonal INTO the rect).
    // Probe depths start just past the 2" outline offset and stay ≤ 3" so the
    // clamped vertex always hides under the wall it sits in.
    const clamp = (p) => {
      if (U.pointInPoly(p, poly)) return p;
      const sx = p.x < cx ? 1 : -1, sy = p.y < cy ? 1 : -1;
      for (const t of [2.05, 2.2, 2.5, 3]) {
        const cands = [
          { x: p.x + sx * t, y: p.y }, { x: p.x, y: p.y + sy * t },
          { x: p.x + sx * t, y: p.y + sy * t }];
        for (const c of cands) if (U.pointInPoly(c, poly)) return c;
      }
      return null;   // unclampable — caller drops the hole (legacy fallback)
    };
    const hole = [
      { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }].map(clamp);
    if (hole.some((p) => p == null)) return null;
    let area = 0;
    for (let i = 0; i < hole.length; i++) {
      const a = hole[i], b = hole[(i + 1) % hole.length];
      area += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(area / 2) < 400) return null;
    return hole;
  };

  /* HA.garageFloorPieces(model, outline) — the given FF-level floor OUTLINE minus
     the garage rect, as up to 4 rectilinear tiles (Steve redline Jul 6, "you still
     have some floor edge coming out into the garage door"): a Shape HOLE must stay
     strictly inside its outline, which always leaves a hairline finish-floor RIBBON
     between outline and hole — hidden at walls but EXPOSED across the overhead-door
     span (the wall there is cut to the slab). Building the FF decks (oak finish +
     raised plywood subfloor) from these pieces instead leaves NO floor anywhere in
     the garage rect — nothing to show through any door opening.

     REWORK (Steve Jul 6, "i can see the floor coming out angled over to the
     garage"): v1 clipped the RAW loop and per-edge-OFFSET the pieces afterwards
     (stud-edge outward on loop edges, −0.05 on cut lines). At T-vertices where a
     loop edge continues collinearly into a cut line, offsetting adjacent collinear
     edges by DIFFERENT amounts makes offsetPoly miter two parallel lines — the
     intersection runs away and extrudes a long angled deck SPIKE outside the wall.
     v2 clips the ALREADY-OFFSET outline (the same offsetPoly(loop,−2) / slabOuter
     polygon the legacy single slab used) by the rect half-planes directly — no
     post-offsetting at all, so every piece is ⊆ outline BY CONSTRUCTION (a
     Sutherland–Hodgman clip only ever shrinks) and the tile cuts land exactly
     0.05" inside the rect lines (flush under the seam/exterior walls, clear of
     door panels; nothing within the rect or any door span).
       tiles: A x≤x0−G | B x≥x1+G | C x0..x1, y≤y0−G | D x0..x1, y≥y1+G
     `outline` defaults to the raw exterior loop. Returns an array of polygons, or
     null when there's no garage / nothing survives (callers keep the legacy
     single-slab path). Pure + move-safe (live rect + caller-supplied outline). */
  HA.garageFloorPieces = (model, outline) => {
    const gi = HA.garageInfo(model);
    if (!gi || !gi.rect) return null;
    let O = outline;
    if (!O) { const loop = HA.exteriorLoop ? HA.exteriorLoop(model, 0) : null; O = loop && loop.pts; }
    if (!O || O.length < 3) return null;
    const r = gi.rect, G = 0.05;   // tile cuts land 0.05" inside the rect lines
    const clip = (planes) => {
      let p = O.slice();
      for (const pl of planes) {
        p = U.clipHalfPlane(p, pl[0], pl[1], pl[2]);
        if (!p || p.length < 3) return [];
      }
      return p;
    };
    const tiles = [
      clip([[-1, 0, r.x0 - G]]),                                          // x ≤ x0−G
      clip([[1, 0, -(r.x1 + G)]]),                                        // x ≥ x1+G
      clip([[1, 0, -(r.x0 - G)], [-1, 0, r.x1 + G], [0, -1, r.y0 - G]]),  // mid, y ≤ y0−G
      clip([[1, 0, -(r.x0 - G)], [-1, 0, r.x1 + G], [0, 1, -(r.y1 + G)]]),// mid, y ≥ y1+G
    ].filter((t) => t.length >= 3 && Math.abs(U.polyArea(t)) > 144);
    return tiles.length ? tiles : null;
  };

  /* HA.garageStepFlight — the house→garage step flight at the man-door. REUSES the
     entrance-flight vocabulary (landing + code risers) rather than a new stair
     engine: it solves the SAME riser math HA.entranceFlight uses (ceil(rise/7.75)
     then relaxed, 11" tread, CRC R311.7.5.1 max 7-3/4"). The rise is the interior
     step down from house FF to the garage slab (floorDrop), so 8" → 2 risers of 4",
     18" → 3 risers of 6" — always code-legal, 1-3 risers for a real garage drop.
     Returns null when there is no garage / no man-door. Geometry is at the man-door
     inside the garage, laid along the door normal (dir turns the landing). */
  HA.garageStepFlight = (model, gi) => {
    gi = gi || HA.garageInfo(model);
    if (!gi || !gi.manDoor) return null;
    const rise = gi.floorDrop;
    const MAX_RISER = 7.75, TREAD = 11;
    let nR = Math.max(1, Math.ceil(rise / MAX_RISER));
    while (nR > 1 && rise / (nR - 1) <= MAX_RISER) nR--;
    let riser = nR ? rise / nR : 0;
    let riserWarn = null;
    if (riser > MAX_RISER + 1e-6) {
      nR = Math.max(1, Math.ceil(rise / MAX_RISER));
      riser = nR ? rise / nR : 0;
      riserWarn = 'RISER CLAMPED TO 7-3/4" MAX PER CRC R311.7.5.1';
    }
    // the flight descends INTO the garage (opposite the door's outward normal —
    // manDoor.nx/ny points OUT of the garage toward the house). dir rotates the
    // run 90° for a turned landing.
    // AXIS-SNAP + UNIT (Steve priority redline Jul 6, the "randomly 3d crooked"
    // steps): the old `ny || 1` default fired on a LEGITIMATE ny === 0 (e.g.
    // manDoor {nx:−1, ny:0} → run {1,−1}, a √2 DIAGONAL): treads staggered
    // sideways off the door axis and the handrail sliced diagonally through the
    // landing. Default to +y only when BOTH components are missing, then snap to
    // the dominant axis as a unit vector — these are axis-aligned houses (HARD
    // RULE), so the run is always exactly ±x or ±y.
    let nx = Number.isFinite(gi.manDoor.nx) ? gi.manDoor.nx : 0;
    let ny = Number.isFinite(gi.manDoor.ny) ? gi.manDoor.ny : 0;
    if (!nx && !ny) ny = 1;
    if (Math.abs(nx) >= Math.abs(ny)) { nx = Math.sign(nx) || 1; ny = 0; }
    else { ny = Math.sign(ny) || 1; nx = 0; }
    let dx = -nx, dy = -ny;                          // into the garage
    if (gi.steps.dir === 'left') { const t = dx; dx = dy; dy = -t; }
    else if (gi.steps.dir === 'right') { const t = dx; dx = -dy; dy = t; }
    // LANDING RULE (Steve, Jul 6): "2 steps no landing required, over two steps
    // needs 3 foot landing then steps." ≤2 risers → the steps come STRAIGHT OUT
    // from the door (landing 0); 3+ risers → a 36" (CRC R311.3) landing at door/FF
    // level first, THEN the flight. A slab house (~8" drop → 2 risers) steps right
    // out; a raised house (~18" → 3 risers) gets the landing + flight.
    const LANDING = nR >= 3 ? 36 : 0;
    // HANDRAIL (Steve, Jul 6): a raised-house man-door flight gets a standard rail
    // ("34-38 on posts, wood posts fine, just needs to look good") whenever it has
    // a landing + 3-riser flight; a 1-2 step exit needs none.
    const handrail = nR >= 3;
    return {
      material: gi.steps.material, dir: gi.steps.dir,
      topY: gi.ffY, bottomY: gi.slabY, rise, nR, riser, tread: TREAD,
      landing: LANDING, handrail, flightLen: (nR - 1) * TREAD, run: { x: dx, y: dy },
      // x,y = the man-door world point; the landing (when present) starts here at
      // FF, the first riser drops at (x + run*LANDING) — landing 0 → right at the door.
      x: gi.manDoor.x, y: gi.manDoor.y,
      riserOk: riser <= MAX_RISER + 1e-6, riserWarn,
    };
  };

  /* ---- GARAGE FOUNDATION (TERRAIN-DATUM-SPEC B) ----
     The garage ALWAYS founds as a SLAB on a perimeter STEM (~6" above its grade)
     over a 12" continuous FOOTING — REGARDLESS of the house foundation type. A
     raised house still gets a slab garage; the rev-557 8"/18" house-FF→garage-slab
     drop stands (steps make up the difference), now expressed as: garage slab per
     its own stem/grade rule. This is the ONE source of truth for the garage stem/
     footing so the foundation PLAN, SECTIONS and TAKEOFF (concrete volume) all
     agree — like the house foundation. Returns null when there's no garage.
       { rect, perimLf, stemHeight (6), stemWidth, footingWidth (12), footingDepth,
         slabThickness, slabSf, concreteCuYd, slabY }
     Derives entirely from the LIVE garage geometry (HA.garageInfo), so a moved or
     resized garage re-derives with no baked world coords. */
  HA.GARAGE_STEM_HEIGHT = 6;      // 6" perimeter stem above garage grade (spec B)
  HA.GARAGE_FOOTING_WIDTH = 12;   // 12" continuous footing under the stem (spec B)
  HA.garageFoundation = (model) => {
    const gi = HA.garageInfo(model);
    if (!gi || !gi.rect) return null;
    const fd = model.foundation || {};
    const r = gi.rect;
    const w = Math.max(0, r.x1 - r.x0), h = Math.max(0, r.y1 - r.y0);
    const perimIn = 2 * (w + h);
    const perimLf = perimIn / 12;
    const stemHeight = HA.GARAGE_STEM_HEIGHT;
    const stemWidth = 8;                                   // 8" nominal stem/curb
    const footingWidth = HA.GARAGE_FOOTING_WIDTH;
    const footingDepth = fd.footingDepth || 12;
    const slabThickness = fd.slabThickness || 4;
    const slabSf = (w * h) / 144;
    // concrete volume (cu yd): slab + perimeter stem + perimeter footing.
    const CUYD = 46656;                                   // in³ per cu-yd
    const slabVol = w * h * slabThickness;
    const stemVol = perimIn * stemWidth * stemHeight;
    const footVol = perimIn * footingWidth * footingDepth;
    const concreteCuYd = (slabVol + stemVol + footVol) / CUYD;
    return {
      rect: r, perimLf, stemHeight, stemWidth, footingWidth, footingDepth,
      slabThickness, slabSf, concreteCuYd, slabY: gi.slabY, floorDrop: gi.floorDrop,
    };
  };

  HA.makePost = (x, y, size, height) => ({
    id: U.uid(), x, y, size: size || 5.5, height: height || 96,
  });

  // Structural hold-down (add_holddown). Anchors a wall/post base to the foundation
  // for uplift/shear (HDU2/HDU5/HDU8/generic). {x,y} = world plan point at the wall base.
  HA.makeHolddown = (x, y, model, opts) => Object.assign({
    id: U.uid(), x, y, model: model || 'HDU2', wallId: null, pos: null, tag: null,
  }, opts || {});
  HA.findHolddown = (m, id) => {
    for (const L of m.levels)
      for (const h of L.holddowns || []) if (h.id === id) return h;
    return null;
  };

  HA.makeLevel = (name, height) => ({
    id: U.uid(), name: name || 'Level', height: height || 96,
    walls: [], posts: [], decks: [], entrances: [], fixtures: [], electrical: [],
    holddowns: [], // structural hold-downs at wall bases (add_holddown): {id, wallId, pos, x, y, model, tag}
    drafts: [],   // CAD drafting entities (lines/rects/clouds/text/freehand) on layers
    dims: [],     // manual dimension strings (world inches; render via HA.manualdims)
    solids: [],   // 3D polysolids (boxes) for massing/details
  });

  /* a MANUAL dimension string — two world points; the label is the measured
     length unless `override` is set. Rendered by HA.manualdims (which reuses the
     sitedims painter) on the 2D plan AND the A1.0 site sheet. */
  HA.makeDim = (x1, y1, x2, y2) => ({ id: U.uid(), kind: 'dim', x1, y1, x2, y2, override: null });
  HA.findDim = (model, id) => {
    for (const L of model.levels) for (const d of L.dims || []) if (d.id === id) return d;
    return null;
  };

  /* CAD drafting entity — pure 2D linework that lives on a named layer
     (plumbing, electrical, foundation, notes…) and prints with the plan */
  HA.makeDraft = (kind, layer, x1, y1, x2, y2) => ({
    id: U.uid(), kind, layer: layer || 'notes',
    x1, y1, x2, y2, text: kind === 'text' ? 'NOTE' : undefined,
  });
  HA.DRAFT_LAYERS = {
    notes: 'Notes / general',
    plumbing: 'Plumbing',
    electrical: 'Electrical',
    foundation: 'Foundation',
  };

  /* polysolid — a 3D box you can place, size, rotate, texture, break */
  HA.makeSolid = (x, y, w, d) => ({
    id: U.uid(), x, y, w: w || 24, d: d || 24, h: 36, z: 0,
    rot: 0, material: null,
  });
  /* break a solid into two along its longest plan axis */
  HA.splitSolid = (model, solid, li) => {
    const s2 = Object.assign({}, solid, { id: U.uid() });
    const a = (solid.rot || 0) * Math.PI / 180;
    const c = Math.cos(a), sn = Math.sin(a);
    if (solid.w >= solid.d) {
      solid.w /= 2; s2.w = solid.w;
      const off = solid.w / 2;
      solid.x -= off * c; solid.y -= off * sn;
      s2.x += off * c; s2.y += off * sn;
    } else {
      solid.d /= 2; s2.d = solid.d;
      const off = solid.d / 2;
      solid.x += off * sn; solid.y -= off * c;
      s2.x -= off * sn; s2.y += off * c;
    }
    model.levels[li].solids.push(s2);
    return s2;
  };
  HA.findSolid = (model, id) => {
    for (const L of model.levels)
      for (const s of L.solids || []) if (s.id === id) return s;
    return null;
  };
  HA.findDraft = (model, id) => {
    for (const L of model.levels)
      for (const d of L.drafts || []) if (d.id === id) return d;
    return null;
  };

  /* merge a wall back together with a collinear neighbor that shares an
     endpoint and matching properties (undo of splitWall / Break) */
  HA.mergeWall = (model, wall) => {
    const li = HA.levelOf(model, wall);
    const walls = model.levels[li].walls;
    const dir = HA.wallDir(wall);
    for (const other of walls) {
      if (other === wall) continue;
      if (Math.abs(U.cross(dir, HA.wallDir(other))) > 0.02) continue; // not collinear
      if (other.type !== wall.type || !!other.gable !== !!wall.gable ||
          (other.material || null) !== (wall.material || null) ||
          (other.height || 0) !== (wall.height || 0)) continue;
      // which ends touch?
      if (U.dist(HA.wallB(wall), HA.wallA(other)) < 1) {
        const shift = HA.wallLen(wall);
        for (const o of other.openings || []) { o.pos += shift; wall.openings.push(o); }
        wall.x2 = other.x2; wall.y2 = other.y2;
        walls.splice(walls.indexOf(other), 1);
        return wall;
      }
      if (U.dist(HA.wallA(wall), HA.wallB(other)) < 1) {
        const shift = HA.wallLen(other);
        for (const o of wall.openings || []) o.pos += shift;
        wall.openings = (other.openings || []).concat(wall.openings);
        wall.x1 = other.x1; wall.y1 = other.y1;
        walls.splice(walls.indexOf(other), 1);
        return wall;
      }
    }
    return null;
  };

  /* fixtures: parametric furniture/casework/plumbing placed on a level.
     rot in degrees; w = width along local x at rot 0, d = depth. */
  HA.makeFixture = (type, x, y, rot) => {
    const def = HA.FIXTURES[type] || { w: 24, d: 24 };
    return {
      id: U.uid(), type, x, y, rot: rot || 0,
      w: def.w, d: def.d,
    };
  };

  /* electrical devices live ON walls: pos along wall, side = +1/-1 of
     the wall's local normal (which face the device mounts to).
     Ceiling/floor devices (recessed cans, smoke alarms, floor outlets…)
     are FREE-placed at x,y instead. `mount` overrides the default height. */
  HA.makeElectrical = (type, wallId, pos, side) => ({
    id: U.uid(), type, wallId, pos, side: side || 1, mount: null,
  });
  HA.makeElectricalFree = (type, x, y) => ({
    id: U.uid(), type, x, y, mount: null,
  });

  HA.findFixture = (model, id) => {
    for (const L of model.levels)
      for (const f of L.fixtures || []) if (f.id === id) return f;
    return null;
  };
  HA.findElectrical = (model, id) => {
    for (const L of model.levels)
      for (const e of L.electrical || []) if (e.id === id) return e;
    return null;
  };

  /* world-space footprint corners of a fixture (plan) */
  HA.fixtureCorners = (f) => {
    if (f.type === 'stairs' && HA.stairCorners) return HA.stairCorners(f);
    const a = (f.rot || 0) * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const hw = f.w / 2, hd = f.d / 2;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => ({
      x: f.x + x * c - y * s,
      y: f.y + x * s + y * c,
    }));
  };

  /* Fixtures (furniture / casework / plumbing) whose FOOTPRINT sits AGAINST
     `wall` — so they ride with it when the wall is dragged (Steve: "furniture
     and fixtures and cabinets slide with the wall ... they are locked to the
     wall"). Footprint-based (nearest of the 4 corners + the centre to the wall
     span) so a DEEP piece counts even though its centre is well off the wall.
     Excludes room labels (the room solver owns those) + stairs (structural).
     `fixtures` is a level's fixtures array. Pure → unit-testable. */
  HA.fixturesAgainstWall = (fixtures, wall) => {
    const out = [];
    if (!Array.isArray(fixtures) || !wall) return out;
    const a = HA.wallA(wall), b = HA.wallB(wall), len = HA.wallLen(wall);
    if (!(len > 1)) return out;
    const band = HA.wallT(wall) / 2 + 8;           // within ~8" of the wall face
    const endMargin = Math.min(0.5, 24 / len);     // a little past each end (corner pieces)
    for (const f of fixtures) {
      if (!f || f.type === 'room_label' || f.type === 'stairs') continue;
      if (f.x == null || f.y == null) continue;
      let md = U.distToSeg({ x: f.x, y: f.y }, a, b);
      const cs = HA.fixtureCorners(f);
      if (cs) for (const c of cs) { const d = U.distToSeg(c, a, b); if (d < md) md = d; }
      if (md > band) continue;                     // not against this wall
      const t = U.projT({ x: f.x, y: f.y }, a, b);
      if (t < -endMargin || t > 1 + endMargin) continue;   // off the wall's ends
      out.push(f);
    }
    return out;
  };

  /* Wall-backed fixture types: items that belong flush against a wall (so they
     re-align when moved). Freestanding items (island, beds, tables, chairs, nightstand)
     are deliberately NOT here — they stay where placed. */
  HA.WALL_BACKED_FIXTURES = new Set(['fridge', 'range', 'dishwasher', 'base_cabinet',
    'drawer_base', 'cabinet_filler', 'corner_cabinet', 'tray_cabinet',
    'tall_pantry', 'oven_micro_tower',
    'upper_cabinet', 'kitchen_sink', 'utility_sink', 'vanity', 'toilet', 'washer', 'dryer',
    'water_heater', 'hpwh', 'dresser', 'bookcase', 'tv_console', 'desk',
    // bathroom library v2 — plumbing/casework/accessories that belong flush to a wall
    'glass_shower', 'bathtub', 'tub', 'tub_shower_combo', 'shower', 'pedestal_sink',
    'linen_cabinet', 'wall_mirror', 'towel_bar', 'tp_holder', 'robe_hook', 'bath_shelf']);
  HA.isWallBackedFixture = (t) => HA.WALL_BACKED_FIXTURES.has(t);

  /* FURNITURE-class fixtures (soft goods / FF&E: sofa, table, chair, bed, rug, decor …):
     cat === 'Furniture' in the library. Steve: "the inside furniture … remove the
     resizing, it causes mistakes; allow them to resize in the settings of every item,
     then they can just pull it around." So the 3D selection cage on these pieces drops
     its stretch GRIPS (keeps move + rotate); resizing moves to the properties panel W/D/H
     fields. Building elements (kitchen cabinets/appliances, bath casework, structure) are
     deliberately NOT here — their drag-resize is unchanged. */
  HA.isFurnitureFixture = (t) => !!(HA.FIXTURES && HA.FIXTURES[t] && HA.FIXTURES[t].cat === 'Furniture');

  /* Snap a wall-backed fixture to the nearest wall: seat its BACK flush against the
     wall face and face it into the room. Used when a fridge/range/cabinet is MOVED so it
     re-aligns cleanly (Steve: "if the user moves something it stays aligned on the wall
     correctly like fridge or range"). Returns true if it snapped, false if no wall was
     near enough (so a piece dragged into the middle of the room is left alone). */
  HA.snapFixtureToWall = (model, li, f, opts) => {
    opts = opts || {};
    const lvl = model.levels && model.levels[li];
    if (!lvl || !Array.isArray(lvl.walls) || f.x == null || f.y == null) return false;
    const def = HA.FIXTURES[f.type] || { d: 24 };
    const d = f.d || def.d || 24;
    let best = null;
    for (const w of lvl.walls) {
      const a = HA.wallA(w), b = HA.wallB(w), len = HA.wallLen(w);
      if (!(len > 1)) continue;
      const t = U.clamp(U.projT({ x: f.x, y: f.y }, a, b), 0, 1);
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      const dist = Math.hypot(f.x - px, f.y - py);
      if (!best || dist < best.dist) best = { w, px, py, dist, len, a, b };
    }
    const maxSnap = opts.maxSnap != null ? opts.maxSnap : (d / 2 + 30);
    if (!best || best.dist > maxSnap) return false;
    const gap = HA.wallT(best.w) / 2 + 0.5;                 // half wall + finish → back flush
    let nx = f.x - best.px, ny = f.y - best.py, nl = Math.hypot(nx, ny);
    if (nl < 1) {                                           // fixture sits ON the wall line → pick a perpendicular
      const dx = (best.b.x - best.a.x) / best.len, dy = (best.b.y - best.a.y) / best.len;
      nx = -dy; ny = dx; nl = 1;
    }
    nx /= nl; ny /= nl;
    // INTERIOR-SIDE lock: the flush side used to be "whichever side of the
    // centerline the fixture currently sits on" — one fast pointermove across an
    // exterior wall seated a fridge OUTSIDE the house. If the chosen seat lands
    // outside the level's exterior loop and the opposite seat lands inside, flip.
    // Interior walls (both seats inside) keep the cursor-chosen side. opts.loop
    // lets drag handlers pass a cached loop (computing it per pointermove is waste).
    try {
      const loop = opts.loop !== undefined ? opts.loop
        : (HA.exteriorLoop ? (HA.exteriorLoop(model, li) || {}).pts : null);
      if (loop && loop.length >= 3 && U.pointInPoly) {
        const off = gap + d / 2;
        if (!U.pointInPoly({ x: best.px + nx * off, y: best.py + ny * off }, loop) &&
            U.pointInPoly({ x: best.px - nx * off, y: best.py - ny * off }, loop)) {
          nx = -nx; ny = -ny;
        }
      }
    } catch (e) { /* loop is best-effort; the plain seat still applies */ }
    f.x = best.px + nx * (gap + d / 2);                    // seat the BACK flush on the wall
    f.y = best.py + ny * (gap + d / 2);
    if (!opts.keepRot) f.rot = Math.round(Math.atan2(-nx, ny) * 180 / Math.PI); // front faces the room
    return true;
  };

  /* AUTO-TEMPERED (CRC/IRC R308.4(2)): glazing within a 24" arc of either
     vertical edge of a door, with its bottom edge (sill) under 60" AFF, must be
     tempered. Geometry-current: computed from where doors/windows sit NOW (the
     schedule calls this at generation time), not where they were created.
     Manual o.tempered === true is sticky — auto only ever ADDS the flag. */
  HA.temperedAuto = (level, wall, o) => {
    if (!level || !wall || !o || o.kind !== 'window') return false;
    if ((o.sill == null ? 0 : o.sill) >= 60) return false;   // bottom edge ≥ 60" AFF
    // window's two vertical edges, in plan
    const ptOn = (w, pos) => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy) || 1;
      return { x: w.x1 + (dx / len) * pos, y: w.y1 + (dy / len) * pos };
    };
    const we = [ptOn(wall, o.pos - o.width / 2), ptOn(wall, o.pos + o.width / 2)];
    for (const w2 of level.walls || []) {
      for (const d of w2.openings || []) {
        if (d.kind !== 'door') continue;
        const de = [ptOn(w2, d.pos - d.width / 2), ptOn(w2, d.pos + d.width / 2)];
        for (const a of we) for (const b of de)
          if (Math.hypot(a.x - b.x, a.y - b.y) <= 24) return true;
      }
    }
    return false;
  };
  /* effective tempered state for one window — manual yes wins, auto adds */
  HA.temperedFor = (level, wall, o) =>
    o.tempered === true || (o.sill != null && o.sill < 18) || HA.temperedAuto(level, wall, o);

  /* ---------- door & window schedules (automated) ---------- */
  HA.schedules = (model) => {
    const doors = new Map(), windows = new Map();
    const markOf = new Map();
    for (const L of model.levels) {
      for (const w of L.walls) {
        for (const o of w.openings || []) {
          if (o.kind === 'door') {
            const t = o.doorType && o.doorType !== 'hinged' ? (HA.DOOR_TYPES[o.doorType] || '') + ' · ' : '';
            const key = [o.width, o.height, o.style || 'panel', o.doorType || 'hinged'].join('|');
            if (!doors.has(key)) {
              doors.set(key, {
                width: o.width, height: o.height,
                type: t + (HA.DOOR_STYLES[o.style] || '6-Panel') + (HA.isExt(w) ? ' / EXT' : ''),
                header: HA.openingHeader(o), count: 0, ids: [], note: '—',
              });
            }
            const row = doors.get(key);
            row.count++; row.ids.push(o.id);
          } else {
            // tempered recomputed from CURRENT geometry every schedule build
            // (R308.4(2) door proximity + low-sill rule of thumb + manual yes);
            // part of the row KEY so tempered/untempered same-size windows
            // never merge onto one row.
            const temp = HA.temperedFor(L, w, o);
            const key = [o.width, o.height, o.sill, o.muntins ? 1 : 0, temp ? 'T' : ''].join('|');
            if (!windows.has(key)) {
              windows.set(key, {
                width: o.width, height: o.height, sill: o.sill,
                type: o.muntins ? 'SH / GRILLES' : 'SH / CLEAR',
                header: HA.openingHeader(o), count: 0, ids: [], flags: [],
              });
            }
            const row = windows.get(key);
            row.count++; row.ids.push(o.id);
            // code flags (IRC R310 / R308 rules of thumb)
            const clearSf = ((o.width - 4) * (o.height - 7)) / 144;
            if (clearSf >= 5.7 && o.sill <= 44 && !row.flags.includes('EGRESS OK'))
              row.flags.push('EGRESS OK');
            if (temp && !row.flags.includes('TEMPERED'))
              row.flags.push('TEMPERED');
          }
        }
      }
    }
    const finish = (map, prefix) => [...map.values()].map((r, i) => {
      r.mark = prefix + (i + 1);
      for (const id of r.ids) markOf.set(id, r.mark);
      r.size = `${U.fmtLen(r.width)} × ${U.fmtLen(r.height)}`;
      if (r.flags) r.note = r.flags.join(', ') || '—';
      return r;
    });
    return { doors: finish(doors, 'D'), windows: finish(windows, 'W'), markOf };
  };

  /* WALL SCHEDULE (Steve, Jul 2): live rows per distinct wall assembly in the
     model — stud, spacing, TOTAL thickness (stud + assembly layers, so an odd
     wall reads thicker), and the FIRE note on rows whose walls sit <5' from
     the property line (compliance.js measured). markOf: wallId → letter tag
     for the plan. Everything variable-driven — change the assembly or spacing
     and the schedule follows. */
  HA.wallSchedule = (model) => {
    const rows = new Map(), markOf = new Map();
    let fireIds = new Set();
    try {
      const comp = HA.compliance && HA.compliance.setbacks ? HA.compliance.setbacks(model) : null;
      if (comp && comp.ok) fireIds = new Set(comp.walls.filter((w) => w.fireRated).map((w) => w.id));
    } catch (e) { /* fire column optional */ }
    const asm = (model.settings && model.settings.assembly) || { drywall: 0.5, sheathing: 0.5, cladding: 0.75 };
    for (const L of model.levels) {
      for (const w of L.walls || []) {
        const T = HA.WALL_TYPES[w.type] || HA.WALL_TYPES.ext2x6;
        const fire = fireIds.has(w.id) || !!w.fireSep;
        const key = (w.type || 'ext2x6') + (fire ? '|fire' : '');
        if (!rows.has(key)) {
          // SIP: skins live inside T.stud (no separate sheathing layer) — THK =
          // panel + gyp + cladding, which equals HA.wallT + 0 extra cladding and
          // the assemblies.stack sum exactly (the three never disagree).
          const thick = T.sip
            ? T.stud + asm.drywall + asm.cladding
            : T.ext
              ? T.stud + asm.drywall + asm.sheathing + asm.cladding
              : T.stud + asm.drywall * 2;
          rows.set(key, {
            key, type: w.type || 'ext2x6', label: T.label,
            stud: T.sip ? 'SIP' : '2X' + (T.stud > 4 ? 6 : 4),
            // SIP walls have no studs — the O.C. column reads the 48" panel module
            spacing: T.sip ? 48 : (model.settings.studSpacing || 16),
            // 3-decimal precision: every framed THK is exact at 2 decimals, but
            // a SIP reads 7.625 — rounding to 7.63 would disagree with wallT
            thick: Math.round(thick * 1000) / 1000,
            fire, count: 0, lf: 0, ids: [],
          });
        }
        const r = rows.get(key);
        r.count++; r.lf += Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / 12; r.ids.push(w.id);
      }
    }
    // stable letter marks: exterior first, then interior; fire rows after base
    const list = [...rows.values()].sort((a, b) =>
      ((HA.WALL_TYPES[b.type] || {}).ext ? 1 : 0) - ((HA.WALL_TYPES[a.type] || {}).ext ? 1 : 0) ||
      a.type.localeCompare(b.type) || (a.fire ? 1 : 0) - (b.fire ? 1 : 0));
    list.forEach((r, i) => {
      r.mark = String.fromCharCode(65 + i);   // A, B, C…
      for (const id of r.ids) markOf.set(id, r.mark);
      r.lf = Math.round(r.lf);
      const _T = HA.WALL_TYPES[r.type] || {};
      r.note = r.fire
        ? '1-HR RATED — 5/8" TYPE X GYP — SEE A6.0 (CRC R302.1)'
        : _T.sip ? HA.sipNote(_T)
        : (_T.ext ? 'SHTG + WRB + CLADDING PER ELEVATIONS' : '1/2" GYP EA. SIDE');
    });
    return { rows: list, markOf };
  };

  /* R66 — does this model contain an actual HOUSE? A detached carport's infill
     walls are tagged `carport` and must not count, or every carport reads as a
     dwelling and picks up floor plans, a service panel and a Title-24 envelope
     for a building that isn't there. Shared by the sheet-set gate and the
     project-type derive so there is one answer, not two. */
  HA.hasHouse = (model) => {
    for (const lvl of ((model && model.levels) || []))
      for (const w of (lvl.walls || []))
        if (w && !w.carport && Number.isFinite(w.x1)) return true;
    return false;
  };

  HA.makeSheet = (number, title, type) => ({
    id: U.uid(), number, title, type: type || 'custom',
    numberLocked: false, items: [],
  });

  /* blocks are CAD details measured in PAPER inches */
  HA.makeBlock = (name, description) => ({
    id: U.uid(), name: name || 'Block', description: description || '',
    w: 6, h: 4.5, entities: [],
  });

  /* ---------- project ---------- */
  HA.newModel = () => ({
    app: 'HomeArchitect',
    version: 2,
    name: 'Untitled Plan',
    project: {
      address1: '', address2: '', owner: '', designer: 'Home Architect Studio',
      date: '', jurisdiction: '', apn: '',
      state: 'CA',          // energy-code provider selector (HA.energy.resolveProvider); CA = Title-24
      climateZone: null,    // CA Title-24 climate zone (1..16) for solar PV sizing; null = unset
      mode: 'addressed',    // intake fork: 'addressed' (default; real site/address) | 'master' (Development/Master Plan, NOT FOR CONSTRUCTION)
      type: 'adu',          // project type (e.g. 'adu'); default ADU. additive, gates nothing existing
    },
    settings: {
      units: 'imperial',     // display units: 'imperial' (default) | 'metric'; geometry always internal inches
      wallHeight: 96,
      gridSpacing: 12,
      snapGrid: true,
      platformDepth: 13,     // 2×12 joists + subfloor between stories
      // wall construction system: 'stick' (conventional 2x framing, default) |
      // 'sip' (structural insulated panels — exterior walls generate/retype as
      // ext_sip65/ext_sip45). Additive: gen.js + tools.set_construction read it.
      construction: 'stick',
      studSpacing: 16,
      rafterSpacing: 24,
      floorJoistSpacing: 16,  // raised-foundation / upper-level floor joists o.c. (F.floor + framingInfo + plan labels)
      // --- STRUCTURAL AUTHORITY (set_framing / set_anchors) — additive, absence-safe. ---
      ceilingJoistSpacing: 16, // ceiling joists o.c. (was hardcoded 16 in ceilingCalc)
      deckJoistSpacing: 16,    // deck joists o.c. (was hardcoded 16 in F.deck)
      floorJoistDir: 'auto',   // 'auto' | 'ns' (joists span N-S) | 'ew' (joists span E-W)
      anchorSpacing: 72,       // max anchor-bolt o.c. (IRC R403.1.6 default ≤72")
      anchorEdge: 12,          // anchor-bolt end inset from plate ends (in)
      // per-level / per-area framing overrides. Each: {level?, bbox?{x0,y0,x1,y1},
      // studSpacing?, rafterSpacing?, joistSpacing?, joistDir?}. Area (bbox) wins over
      // level, which wins over these settings.* globals. Empty = pure global.
      framingScopes: [],
      // Chief-style wall-assembly layer thicknesses (inches). The STUD is fixed; these grow the
      // wall outward from the stud face. Defaults = the current build (byte-identical). Editable
      // in the Wall assembly settings; synced to the layer globals by HA.syncAssembly.
      assembly: { drywall: 0.5, sheathing: 0.5, cladding: 0.75 },
      orientation: 0,        // plan->true-north rotation (deg, CW) for solar azimuth; 0 = plan north is true north
      surfaces: {
        exteriorWall: 'lap_sage',
        roof: 'shingle_charcoal',
        interiorWall: 'gypsum',
        floor: 'floor_oak',
        foundation: 'concrete',
        road: 'road_ac',       // dev-mode access-road default aggregate (Paving)
      },
      colors: { trim: '#f4f1ea', door: '#6f5136', shutter: '#33413a' },
      // INTERIOR TRIM (baseboard + crown) — DEFAULT ON for every design (Steve).
      // Themeable: style/paint changes + AI tools may reseed base/crownColor; the
      // view reads this and falls back to white when absent (old saves load ON).
      trim: { base: true, crown: true, baseColor: '#f4f4f0', crownColor: '#f4f4f0' },
      // default device mount heights (inches AFF) — editable in Project
      elecHeights: {
        outlet: 13, outlet_220: 13, gfci: 42, outlet_floor: 0,
        switch: 46, switch_3way: 46, sconce: 66,
        panel: 48, meter: 56,
      },
      // object-snap toggles for the plan-draw input path (HA.snap.solve).
      // Absence-safe: a missing key falls back to the existing endpoint/
      // ortho/grid logic, so this never changes today's drawing behavior.
      snaps: {
        endpoint: true, midpoint: true, intersection: true,
        projection: true, ortho: false, grid: true,
      },
    },
    materials: HA.defaultMaterials(),
    // REAL-PRODUCT selections (products.js catalog) — drive the never-stale
    // section/elevation spec labels + keynote legends. Old saves without this
    // fall back to generic labels in every reader.
    finishes: { roofProduct: 'ct_landmark', sidingProduct: 'hardie_lap', paintSW: 'SW 7008', trimSW: 'SW 7005' },
    levels: [HA.makeLevel('Level 1', 96)],
    roof: {
      enabled: true, pitch: 6, lowerPitch: 0, overhang: 16, rake: 12, thickness: 8, dormers: [],
      // ROOF PLANE CONTINUATION over shallow gable-end pop-outs (Steve, ROOF-CONTINUATION-SPEC):
      // when a small addition/pop-out sticks out of a gable end, continue the roof line
      // straight across it and keep the wider mass gable (the pop-out walls become covered,
      // a siding pediment fills the step). DEFAULT ON; false → byte-identical legacy roofs.
      continuePopouts: true,
      // eave finish (whole-house): 'closed' = fascia + boxed soffit; 'exposed' =
      // visible plumb-cut rafter tails at the eave; 'open' = bare edge, no fascia/soffit.
      eaveStyle: 'closed',
      // manual roof-edit pull points: each {fx,fy,tx,ty} moves any auto-roof vertex
      // near (fx,fy) to (tx,ty), keeping it on its face plane (z follows the pitch).
      overrides: [],
    },
    foundation: {
      // footing hugs the slab edge and runs INWARD (not centered):
      // 12"x12" standard, 18" deep for two-story — all adjustable
      // type: 'slab' (default; grade slab) | 'raised' (perimeter stemwall + floor
      //   platform). 'raised' REUSES stemHeight as the floor-above-grade height.
      type: 'slab',
      enabled: true, slabThickness: 4, footingWidth: 12, footingDepth: 12, stemHeight: 8,
      // stepped footing (raised fnd): terrain-driven step-downs quantized to 24" —
      // renders in the S1.0 foundation plan, sections, + 3D. set_footing toggles it.
      stepped: false,
      // engineer-recorded explicit step plan (set_footing stepped:[{at,drop}]). Reference
      // only for the stamping engineer + a plan callout; the DRAWN steps follow site terrain.
      steppedPlan: null,
    },
    // LIVE cost-as-you-draw budget (HA.pricing). One editable source of truth:
    //   zone   — location cost multiplier; mode 'auto' resolves from the project
    //            address/state, else a pinned custom factor.
    //   overrides — { priceBookKey: {mat,labor} } user edits to the standard-US book.
    //   markups   — implied / non-drawn lines (permits, dumpster, GC, contingency, O&P, tax).
    pricing: {
      enabled: true,
      zone: { mode: 'auto', factor: null },
      overrides: {},
      markups: {},          // empty = use HA.pricing.DEFAULT_MARKUPS
      showRibbon: true,     // live total banner on the drafting page
    },
    sheets: [],
    blocks: [],
    notes: [],
    camera: null,   // Chief-style plan camera {x,y,tx,ty,h,th} — never printed
    // PINNED MEASUREMENTS (HA.measure / the 3D tape). Each is a world-space
    // polyline the user chose to keep: { id, pts:[{x,y,z}], kind:'linear'|'area',
    // label } in scene coords (x, y=height, z). Ephemeral tape lives only in
    // view3d; pinning pushes here so it saves with the plan + can go to a sheet.
    // Absence-safe: old saves load with none.
    measurements: [],
    solar: null,    // rooftop PV design from HA.solar.autoDesign(model); null = no solar
    underlay: null, // trace/underlay image descriptor {src,wIn,hIn,x,y,opacity,locked} from HA.importUnderlay; null = none
  });

  /* Starter plan: L-shaped two-story with porch, deck, dormer, gable */
  HA.sampleModel = () => {
    const m = HA.newModel();
    m.name = 'Cedar Ridge Cottage';
    const S = m.settings;
    const L1 = m.levels[0];
    const W = (lvl, x1, y1, x2, y2, type) => {
      const w = HA.makeWall(x1, y1, x2, y2, type, S);
      lvl.walls.push(w);
      return w;
    };
    // ---- level 1: main block 38' x 28', wing 16' x 10' at front-right
    const back = W(L1, 0, 0, 456, 0, 'ext2x6');
    const right = W(L1, 456, 0, 456, 456, 'ext2x6');
    const wingFront = W(L1, 456, 456, 264, 456, 'ext2x6');
    const wingSide = W(L1, 264, 456, 264, 336, 'ext2x6');
    const front = W(L1, 264, 336, 0, 336, 'ext2x6');
    const left = W(L1, 0, 336, 0, 0, 'ext2x6');
    const bed1 = W(L1, 192, 0, 192, 216, 'int2x4');
    W(L1, 192, 216, 0, 216, 'int2x4');

    front.openings.push(HA.makeDoor(132, 36, { swing: 'in', hinge: 'right' }));
    front.openings.push(HA.makeWindow(216, 48, 48, 32));
    back.openings.push(HA.makeWindow(96, 36, 48, 32));
    back.openings.push(HA.makeWindow(300, 36, 48, 32));
    // sliding glass from the great room out to the rear deck
    wingFront.openings.push(HA.makeDoor(114, 72, {
      doorType: 'slider', panels: 2, style: 'full_glass', handle: 'none',
    }));
    wingSide.openings.push(HA.makeDoor(60, 32, { swing: 'in', hinge: 'left' }));
    left.openings.push(HA.makeWindow(120, 36, 48, 32));
    left.openings.push(HA.makeWindow(240, 36, 48, 32));
    right.openings.push(HA.makeWindow(336, 48, 48, 32));
    bed1.openings.push(HA.makeDoor(180, 32, { swing: 'in', hinge: 'left' }));
    wingFront.material = 'batten_cream';

    // covered porch at the door: open railings with a clear walk path
    const pw1 = W(L1, 72, 336, 72, 408, 'porch');
    const pw2a = W(L1, 72, 408, 108, 408, 'porch');   // gap 108..156 = walk path
    const pw2b = W(L1, 156, 408, 192, 408, 'porch');
    const pw3 = W(L1, 192, 408, 192, 336, 'porch');
    pw1.height = pw2a.height = pw2b.height = pw3.height = 36;
    L1.posts.push(HA.makePost(75, 405, 5.5, 96));
    L1.posts.push(HA.makePost(189, 405, 5.5, 96));
    L1.decks.push(Object.assign(HA.makeDeck(72, 336, 192, 408), { railing: false, covered: true }));

    // rear deck — flush with the wing's west face, slider opens onto it
    L1.decks.push(HA.makeDeck(264, 456, 420, 576));

    // ---- level 2 over the main block
    const L2 = HA.makeLevel('Level 2', 96);
    m.levels.push(L2);
    const b2 = W(L2, 0, 0, 456, 0, 'ext2x6');
    W(L2, 456, 0, 456, 336, 'ext2x6');
    const f2 = W(L2, 456, 336, 0, 336, 'ext2x6');
    const l2 = W(L2, 0, 336, 0, 0, 'ext2x6');
    l2.gable = true;
    W(L2, 228, 0, 228, 336, 'int2x4');
    b2.openings.push(HA.makeWindow(96, 36, 48, 32));
    b2.openings.push(HA.makeWindow(360, 36, 48, 32));
    f2.openings.push(HA.makeWindow(120, 36, 48, 32));
    f2.openings.push(HA.makeWindow(330, 36, 48, 32));
    l2.openings.push(HA.makeWindow(168, 36, 48, 32));

    m.roof.dormers.push(HA.makeDormer(b2.id, 300));

    // furnish + wire (light touch — the showcase designs go further)
    const FX = (type, x, y, rot, w) => {
      const f = HA.makeFixture(type, x, y, rot || 0);
      if (w) f.w = w;
      L1.fixtures.push(f);
    };
    FX('base_cabinet', 330, 14, 0, 220);
    FX('upper_cabinet', 330, 14, 0, 220);
    FX('kitchen_sink', 300, 14, 0);
    FX('range', 396, 15, 0);
    FX('fridge', 232, 18, 0);
    FX('island', 330, 84, 0);
    FX('dining_table', 350, 200, 0);
    FX('sofa', 90, 280, 90);
    FX('coffee_table', 140, 280, 90);
    FX('bed_queen', 90, 80, 0);
    FX('dresser', 14, 160, 90);
    // stairs to level 2 + room labels
    const st = HA.makeFixture('stairs', 228, 152, 0);
    st.d = 132;
    L1.fixtures.push(st);
    for (const [text, x, y] of [
      ['PRIMARY BEDROOM', 96, 150], ['KITCHEN', 330, 50],
      ['GREAT ROOM', 340, 260], ['ENTRY', 184, 312],
    ]) {
      const lb = HA.makeFixture('room_label', x, y, 0);
      lb.text = text;
      L1.fixtures.push(lb);
    }
    if (HA.snapElectrical) {
      for (const [t, x, y] of [
        ['meter', 6, 100], ['panel', 10, 130],
        ['outlet', 96, 6], ['outlet', 300, 330], ['switch', 150, 330],
        ['outlet_220', 396, 6],
      ]) {
        const snap = HA.snapElectrical(m, 0, { x, y }, t);
        if (snap) L1.electrical.push(HA.makeElectrical(t, snap.wallId, snap.pos, snap.side));
      }
    }
    return m;
  };

  /* ---------- serialization & migration ---------- */
  /* Serialize the model to JSON. 🍌 RENDERINGS are heavy base64 image blobs
     (~0.3MB each even after downscale). They live in ONE place — model.renderings[]
     — and the R-series sheet items are ALWAYS rebuilt from that on load
     (S.syncRenderingSheets), so we NEVER persist the baked sheet-item copy
     (that was doubling every image on disk/cloud/undo). opts.light ALSO drops
     the renderings[] pixels themselves — used for the 100-deep undo stack and
     the localStorage autosave, which must never carry multi-MB image data
     (undo memory blow-up + localStorage QuotaExceededError silently losing
     work). Full serialize (cloud save + file export) keeps renderings[] pixels
     so the gallery survives a reopen. Detach-stringify-reattach: the live model
     is byte-identical afterward (no deep clone). */
  HA.serialize = (model, opts) => {
    const light = !!(opts && opts.light);
    const stash = [];
    if (model && Array.isArray(model.sheets)) {
      for (const sh of model.sheets) {
        if (sh && sh.type === 'renderings' && Array.isArray(sh.items)) {
          for (const it of sh.items) if (it && it.dataUrl) { stash.push([it, 'dataUrl', it.dataUrl]); it.dataUrl = ''; }
        }
      }
    }
    if (light && model && Array.isArray(model.renderings)) {
      for (const r of model.renderings) if (r && r.dataUrl) { stash.push([r, 'dataUrl', r.dataUrl]); r.dataUrl = ''; }
    }
    /* R163 (Aaron: "autosave might be causing the freezes - every time he
       changes something it holds it up") - the TRACE UNDERLAY image is the
       OTHER multi-MB payload, and unlike renderings it was never stripped:
       one imported floor-plan photo rode EVERY undo snapshot (100-deep =
       hundreds of MB of retained strings, major-GC-pause territory) and
       EVERY synchronous localStorage autosave write, on every single edit.
       Measured: a 3MB underlay inflates the light snapshot 79KB -> 3.2MB
       (41x). Light snapshots carry the underlay's PLACEMENT only; the
       pixels rehydrate from the live model / session cache / the once-per-
       image autosave side-store (app.js). Full serializes (cloud, file
       export) keep the pixels - the plan still round-trips anywhere. */
    if (light && model && model.underlay && model.underlay.src) {
      stash.push([model.underlay, 'src', model.underlay.src]);
      model.underlay.src = '';
    }
    try {
      /* R31 — COMPACT by default. The indent-1 pretty-print more than DOUBLED
         every snapshot (587,981 pretty vs 280,255 compact bytes on a 204-lot
         model) and made stringify ~2.4x slower. That cost lands on the hottest
         paths there are: the 100-deep undo stack (0.7-1.8MB x 100 = 70-180MB of
         retained strings at dev scale — major-GC-pause territory, and a
         multi-second GC is exactly what raises the browser's unresponsive-page
         dialog), the synchronous localStorage autosave (whose QuotaExceededError
         is swallowed, so outgrowing the halved quota silently stops autosaving),
         the cloud upload, and view3d._sceneStampOf on every mid-drain coalesce
         check. Nothing machine-side reads the indentation. The human-facing
         .haplan file export opts back in via { pretty: true }. */
      return JSON.stringify(model, (k, v) => (k === '_terrainCache' || k === '_parcelLoading' || k === '_contourCache' ? undefined : v),
        (opts && opts.pretty) ? 1 : undefined);
    } finally {
      for (let i = 0; i < stash.length; i++) stash[i][0][stash[i][1]] = stash[i][2];
    }
  };

  HA.deserialize = (text) => {
    let m = JSON.parse(text);
    if (!m || m.app !== 'HomeArchitect') throw new Error('Not a Home Architect plan file');
    const fresh = HA.newModel();
    if (!m.version || m.version < 2) {
      // v1 -> v2: walls lived at the root, single story
      const lvl = HA.makeLevel('Level 1', (m.settings && m.settings.wallHeight) || 96);
      lvl.walls = m.walls || [];
      m.levels = [lvl];
      delete m.walls;
      m.version = 2;
      const oldColors = (m.settings && m.settings.colors) || {};
      m.materials = HA.defaultMaterials();
      if (oldColors.siding) m.materials.lap_sage.color = oldColors.siding;
      if (oldColors.roof) m.materials.shingle_charcoal.color = oldColors.roof;
    }
    if (!Array.isArray(m.levels) || !m.levels.length)
      throw new Error('Plan file has no levels');
    m.settings = Object.assign({}, fresh.settings, m.settings || {});
    if (!Array.isArray(m.settings.framingScopes)) m.settings.framingScopes = [];
    m.settings.surfaces = Object.assign({}, fresh.settings.surfaces, m.settings.surfaces || {});
    m.settings.colors = Object.assign({}, fresh.settings.colors, m.settings.colors || {});
    // old saves predate interior trim → load with defaults ON; partial user trim merges
    m.settings.trim = Object.assign({}, fresh.settings.trim, m.settings.trim || {});
    m.project = Object.assign({}, fresh.project, m.project || {});
    m.materials = Object.assign({}, fresh.materials, m.materials || {});
    m.roof = Object.assign({}, fresh.roof, m.roof || {});
    m.roof.dormers = m.roof.dormers || [];
    m.roof.overrides = m.roof.overrides || [];
    m.foundation = Object.assign({}, fresh.foundation, m.foundation || {});
    // product selections (products.js): seed legacy saves with the defaults so
    // section/elevation spec labels read real products, keep any user picks
    m.finishes = Object.assign({}, fresh.finishes, m.finishes || {});
    m.pricing = Object.assign({}, fresh.pricing, m.pricing || {});
    m.pricing.zone = Object.assign({}, fresh.pricing.zone, m.pricing.zone || {});
    m.pricing.overrides = (m.pricing.overrides && typeof m.pricing.overrides === 'object') ? m.pricing.overrides : {};
    m.pricing.markups = (m.pricing.markups && typeof m.pricing.markups === 'object') ? m.pricing.markups : {};
    m.sheets = m.sheets || [];
    m.blocks = m.blocks || [];
    m.notes = m.notes || [];
    for (const L of m.levels) {
      L.walls = L.walls || [];
      L.posts = L.posts || [];
      L.holddowns = Array.isArray(L.holddowns) ? L.holddowns : [];
      L.decks = L.decks || [];
      // deck house-attach metadata: additive + absence-safe (mirrors wall.brace).
      // Legacy decks have NO attach/anchorWallId/wrap/enclosed keys — we DELIBERATELY
      // leave those absent so a legacy deck serializes byte-identically. We only
      // normalize keys that are actually PRESENT (a partial/corrupt save), dropping
      // any that hold an inert default so the record stays minimal.
      for (const d of L.decks) {
        // attach: keep only the meaningful 'back'; 'free'/garbage -> drop the key
        if ('attach' in d && d.attach !== 'back') delete d.attach;
        // anchorWallId is meaningless without attach:'back'
        if ('anchorWallId' in d && d.attach !== 'back') delete d.anchorWallId;
        // enclosed: only `true` is meaningful — drop false/garbage
        if ('enclosed' in d && d.enclosed !== true) delete d.enclosed;
        // wrap: null/garbage is the default single-rect — drop it (reserved key)
        if ('wrap' in d && d.wrap == null) delete d.wrap;
      }
      // entrances: additive, absence-safe — older saved plans + the in-repo
      // showcase designs have NO entrances key, so seed an empty array (mirrors
      // posts/decks). Every read elsewhere is guarded `(L.entrances||[])`.
      L.entrances = L.entrances || [];
      L.fixtures = L.fixtures || [];
      L.electrical = L.electrical || [];
      L.drafts = L.drafts || [];
      L.dims = L.dims || [];
      L.solids = L.solids || [];
      for (const w of L.walls) {
        w.openings = w.openings || [];
        // manual braced-wall panels: optional [{pos,len}] — keep only
        // well-formed entries (mirrors how openings persist); an empty
        // or invalid array means "automatic", so drop the key entirely
        if (w.brace != null) {
          w.brace = (Array.isArray(w.brace) ? w.brace : [])
            .filter((p) => p && Number.isFinite(p.pos) && Number.isFinite(p.len) && p.len > 0)
            .map((p) => ({ pos: p.pos, len: p.len }))
            .sort((a, b) => a.pos - b.pos);
          if (!w.brace.length) delete w.brace;
        }
      }
    }
    m.camera = m.camera || null;
    m.settings.elecHeights = Object.assign({}, fresh.settings.elecHeights, m.settings.elecHeights || {});
    // object-snap toggles — additive, absence-safe: merge over fresh defaults
    // so older files (no snaps key) and partial saves both normalize cleanly
    m.settings.snaps = Object.assign({}, fresh.settings.snaps,
      (m.settings.snaps && typeof m.settings.snaps === 'object') ? m.settings.snaps : {});
    // solar / orientation / climate zone — additive, absence-safe defaults
    if (m.solar === undefined) m.solar = null;          // null = no solar (treat null/!enabled as no PV)
    if (m.underlay === undefined) m.underlay = null;    // trace/underlay image descriptor; null = none (older files have no key)
    if (m.site && m.site._contourCache) delete m.site._contourCache;   // R165 - computed memo, never restored
    // display units — absence-safe; older files (no units key) read as imperial, the default
    if (m.settings.units !== 'metric' && m.settings.units !== 'imperial')
      m.settings.units = fresh.settings.units;          // 'imperial'
    // construction system — additive, absence-safe: older files (no/invalid key)
    // default 'stick', keeping every legacy plan byte-identical in behavior
    if (m.settings.construction !== 'stick' && m.settings.construction !== 'sip')
      m.settings.construction = fresh.settings.construction; // 'stick'
    if (m.settings.orientation == null) m.settings.orientation = fresh.settings.orientation; // plan->true-north (deg)
    if (m.project.state == null) m.project.state = fresh.project.state; // energy-code provider selector; default CA
    if (m.project.climateZone === undefined) m.project.climateZone = fresh.project.climateZone; // CA T24 zone or null
    // intake-fork mode — additive, absence-safe: older files (no/invalid mode) default 'addressed'
    if (m.project.mode !== 'addressed' && m.project.mode !== 'master')
      m.project.mode = fresh.project.mode; // 'addressed'
    // project type — additive, absence-safe: older files (no type) default 'adu'
    if (m.project.type == null) m.project.type = fresh.project.type; // 'adu'
    // foundation type — additive, absence-safe: older files (no/invalid type) default 'slab',
    // keeping the existing grade-slab render path byte-identical for every legacy plan
    if (m.foundation.type !== 'slab' && m.foundation.type !== 'raised')
      m.foundation.type = fresh.foundation.type; // 'slab'
    // 3D terrain (roadmap #21) — OFF by default, additive + absence-safe, mirroring
    // the deck.attach idiom: we NEVER seed site.terrain. We only normalize keys
    // that are actually PRESENT, so a legacy plan (no terrain key) serializes
    // BYTE-IDENTICALLY and the flat-ground render is unchanged. For a plan that
    // DOES carry terrain we preserve the meaningful flags AND a valid persisted
    // elevation sample (terrain.cache) so the 3D mesh survives a reload instead
    // of re-fetching every time (Steve: "cache the terrain … it stays in place").
    // The runtime-only _terrainCache is never part of a saved plan.
    if (m.site && typeof m.site === 'object') {
      if ('terrain' in m.site) {
        const t = m.site.terrain;
        if (t && typeof t === 'object' && (t.enabled === true || t.userOff === true)) {
          const out = {};
          if (t.enabled === true) out.enabled = true;
          if (t.userOff === true) out.userOff = true;          // explicit-off persists
          if (typeof t.offsetIn === 'number' && isFinite(t.offsetIn) && t.offsetIn !== 0)
            out.offsetIn = t.offsetIn;                          // terrain-puller height offset (#6)
          if (t.flat === true) out.flat = true;                 // flatten (keep the lot)
          if (typeof t.color === 'number' && isFinite(t.color)) out.color = t.color;   // grass tone
          if (typeof t.soil === 'number' && isFinite(t.soil)) out.soil = t.soil;       // soil tone
          if (t.contours3d === true) out.contours3d = true;     // R165 — 3D contour lines chip
          if (typeof t.contourIntervalIn === 'number' && isFinite(t.contourIntervalIn) && t.contourIntervalIn > 0)
            out.contourIntervalIn = t.contourIntervalIn;        // R165 — the dropdown's interval
          if (t.cache && t.cache.key && t.cache.sample && t.cache.sample.ok)
            out.cache = t.cache;                                // persisted elevation grid
          // BACKYARD BENCH (HILLS/DECKS A2): a level yard behind the house held by a
          // retaining "terrain wall". Preserve only when enabled; depthIn is the
          // level-yard depth behind the rear wall (default 20' applied by terrain.js).
          if (t.backyardBench && t.backyardBench.enabled === true) {
            const bb = { enabled: true };
            if (typeof t.backyardBench.depthIn === 'number' && isFinite(t.backyardBench.depthIn) && t.backyardBench.depthIn > 0)
              bb.depthIn = Math.round(t.backyardBench.depthIn);
            out.backyardBench = bb;
          }
          m.site.terrain = out;
        } else {
          delete m.site.terrain;   // enabled:false / garbage → terrain-OFF by default
        }
      }
      if ('_terrainCache' in m.site) delete m.site._terrainCache;
      // R152 - a pre-fix save may carry the committed loading ghost; heal it
      if ('_parcelLoading' in m.site) delete m.site._parcelLoading;
    }
    // T0 — LIVING TEMPLATE migration: top-up a saved TEMPLATE model with newer template
    // pieces when HA.template.REV advances. Absence-safe: a model without
    // site.templateApplied (hand-drawn / older designs / golden test files) passes through
    // byte-identical (HA.template.migrate returns it untouched). Fail-soft.
    if (HA.template && typeof HA.template.migrate === 'function') { try { HA.template.migrate(m); } catch (e) { /* never break a load */ } }
    // 🍌 RENDERINGS: the R-series sheet image dataUrls are never persisted (see
    // HA.serialize), so rebuild them from m.renderings on load. Also drop any
    // ghost entries whose pixels are gone (a light/localStorage-only reload
    // strips renderings[] pixels; those can't be shown, so don't keep them).
    if (Array.isArray(m.renderings)) {
      m.renderings = m.renderings.filter((r) => r && r.dataUrl);
      try { if (HA.sheets && HA.sheets.syncRenderingSheets) HA.sheets.syncRenderingSheets(m); } catch (e) { /* additive */ }
    }
    U.seedUid(m);
    return m;
  };
})();
