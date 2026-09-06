/* ============================================================
   Home Architect — products.js
   REAL-PRODUCT CATALOG (Steve, Jul 2: "bring all real products
   in the system… Sherwin-Williams and all their colors…
   CertainTeed cool rated roofs… the full suite"). Curated,
   text/spec data only — manufacturer names + product lines +
   color codes are nominative facts we can print on drawings;
   product IMAGERY is NOT bundled (licensing — media-kit
   permission first, see the roadmap).

   Drives: section/elevation labels (roofSpec/paintSpec/
   sidingSpec), keynote legends, and later the estimate lines +
   material pickers. Selections persist on model.finishes:
   { paintSW, trimSW, roofProduct, sidingProduct, cabinetLine,
     counterLine }.

   NOTE ON RATINGS: cool-roof numbers are typical published
   CRRC-style initial values for the line — the sheet prints
   them with the product so the plan reads like a submittal;
   verify the exact color's rating at crrc.org before permit.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;

  const P = {};
  HA.products = P;

  /* ---- SHERWIN-WILLIAMS exterior-popular palette (code, name, hex) ---- */
  P.SW = [
    { code: 'SW 7008', name: 'Alabaster', hex: '#EDEAE0' },
    { code: 'SW 7005', name: 'Pure White', hex: '#EDECE6' },
    { code: 'SW 7042', name: 'Shoji White', hex: '#E6E0D4' },
    { code: 'SW 7029', name: 'Agreeable Gray', hex: '#D1CBC1' },
    { code: 'SW 7015', name: 'Repose Gray', hex: '#CCC9C0' },
    { code: 'SW 7016', name: 'Mindful Gray', hex: '#BCB7AC' },
    { code: 'SW 7019', name: 'Gauntlet Gray', hex: '#79746B' },
    { code: 'SW 7048', name: 'Urbane Bronze', hex: '#54504A' },
    { code: 'SW 7069', name: 'Iron Ore', hex: '#434341' },
    { code: 'SW 6258', name: 'Tricorn Black', hex: '#2F2F30' },
    { code: 'SW 7006', name: 'Extra White', hex: '#EEEFEA' },
    { code: 'SW 9140', name: 'Blustery Sky', hex: '#7A8A94' },
    { code: 'SW 6244', name: 'Naval', hex: '#2F3D4C' },
    { code: 'SW 7602', name: 'Indigo Batik', hex: '#3E4C63' },
    { code: 'SW 6204', name: 'Sea Salt', hex: '#CDD6CA' },
    { code: 'SW 6207', name: 'Retreat', hex: '#788576' },
    { code: 'SW 7735', name: 'Palm Leaf', hex: '#7B7D5F' },
    { code: 'SW 2846', name: 'Roycroft Bronze Green', hex: '#575449' },
    { code: 'SW 7522', name: 'Meadowlark', hex: '#D5C7A8' },
    { code: 'SW 6106', name: 'Kilim Beige', hex: '#D7C5AC' },
    { code: 'SW 7568', name: 'Neutral Ground', hex: '#E4DCC9' },
    { code: 'SW 6083', name: 'Sable', hex: '#6A5A4E' },
    { code: 'SW 7675', name: 'Sealskin', hex: '#4A423C' },
    { code: 'SW 6385', name: 'Dover White', hex: '#F0E8D4' },
  ];
  P.swByCode = (code) => P.SW.find((c) => c.code === code) || null;

  /* ---- ROOFING (asphalt + cool-rated + metal) ---- */
  P.roofing = [
    { id: 'ct_landmark', mfr: 'CertainTeed', line: 'Landmark', type: 'asphalt comp shingle', cool: null },
    { id: 'ct_landmark_pro', mfr: 'CertainTeed', line: 'Landmark PRO', type: 'asphalt comp shingle', cool: null },
    { id: 'ct_presidential', mfr: 'CertainTeed', line: 'Presidential Shake', type: 'luxury asphalt shingle', cool: null },
    { id: 'ct_landmark_solaris', mfr: 'CertainTeed', line: 'Landmark Solaris', type: 'COOL asphalt shingle', cool: { sri: 21, reflectance: 0.25 } },
    { id: 'ct_solaris_gold', mfr: 'CertainTeed', line: 'Solaris Gold', type: 'COOL asphalt shingle', cool: { sri: 29, reflectance: 0.30 } },
    { id: 'mcelroy_ss', mfr: 'McElroy Metal', line: 'Medallion-Lok standing seam', type: 'metal roof', cool: { sri: 38, reflectance: 0.35 } },
    { id: 'mbci_ss', mfr: 'MBCI', line: 'LokSeam standing seam', type: 'metal roof', cool: { sri: 38, reflectance: 0.35 } },
    { id: 'decra_tile', mfr: 'DECRA', line: 'Villa Tile stone-coated', type: 'metal tile', cool: null },
  ];

  /* ---- SIDING ---- */
  P.siding = [
    { id: 'hardie_lap', mfr: 'James Hardie', line: 'HardiePlank lap siding', type: 'fiber cement lap' },
    { id: 'hardie_panel', mfr: 'James Hardie', line: 'HardiePanel vertical + battens', type: 'fiber cement board & batten' },
    { id: 'hardie_shingle', mfr: 'James Hardie', line: 'HardieShingle', type: 'fiber cement shingle' },
    { id: 'lp_lap', mfr: 'LP SmartSide', line: 'ExpertFinish lap', type: 'engineered wood lap' },
    { id: 'stucco_3coat', mfr: 'generic', line: '3-coat stucco system', type: 'stucco' },
  ];

  /* ---- CABINETS + COUNTERTOPS ---- */
  P.cabinets = [
    { id: 'kraftmaid', mfr: 'KraftMaid', line: 'Vantage semi-custom' },
    { id: 'diamond', mfr: 'Diamond', line: 'Distinction' },
    { id: 'shenandoah', mfr: 'Shenandoah', line: 'Breckenridge' },
  ];
  P.counters = [
    { id: 'cambria_quartz', mfr: 'Cambria', line: 'Quartz (US-made)' },
    { id: 'silestone', mfr: 'Silestone', line: 'Quartz / hybrid mineral' },
    { id: 'msi_q', mfr: 'MSI', line: 'Q Premium quartz' },
  ];

  /* ---- spec-string helpers: labels pull straight from the model so they
     can never go stale (Steve: "variables into the labels for everything") */
  const fin = (model) => (model && model.finishes) || {};
  P.roofSpec = (model) => {
    const p = P.roofing.find((r) => r.id === fin(model).roofProduct);
    if (!p) return null;
    let s = (p.mfr + ' ' + p.line).toUpperCase();
    if (p.cool) s += ' — COOL RATED SRI ' + p.cool.sri + ' (VERIFY CRRC)';
    return s;
  };
  P.sidingSpec = (model) => {
    const p = P.siding.find((r) => r.id === fin(model).sidingProduct);
    return p ? (p.mfr + ' ' + p.line).toUpperCase() : null;
  };
  P.paintSpec = (model, which) => {
    const code = which === 'trim' ? fin(model).trimSW : fin(model).paintSW;
    const c = code && P.swByCode(code);
    return c ? ('PAINT: ' + c.code + ' ' + c.name.toUpperCase()).trim() : null;
  };
})();
