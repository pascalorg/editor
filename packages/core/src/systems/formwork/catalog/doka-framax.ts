import type {
  CornerType,
  FillerType,
  FormworkSystem,
  PanelType,
  PermissiblePressure,
  TieType,
} from './types'

/**
 * Doka Framax Xlife — a five-width system on a 15 cm grid, which is what makes it
 * behave differently from TRIO in a layout: 0.30 / 0.45 / 0.60 / 0.90 / 1.35 m
 * (plus a 0.55 special) tile far more wall lengths exactly, so the make-up piece
 * appears less often.
 *
 * Panels from the official item list `doka.com/_ext/downloads/itemlists/me/91.pdf`;
 * pressures from Framax Xlife User Information via
 * `wiki/formwork/reference/design.md` §2.6.
 */

const SOURCE = 'Doka item list me/91.pdf; Framax Xlife User Information'
const CATALOG = 'Doka item list me/91.pdf'

/**
 * Framax's rating is conditional on the panel you picked, which is why this is a
 * per-panel field rather than a system constant: 80 kN/m² across the board, but
 * 100 kN/m² on the narrow panels only — 105, 75, 60, 45 and 30 cm, explicitly not
 * 240, 135, 122 or 90. A layout that swaps a 0.90 panel for two 0.45s has changed
 * the wall's permissible pressure.
 *
 * 80 kN/m² is 3.20 m of hydrostatic head at 25 kN/m³, and the 90 kN/m² column
 * rating is 3.60 m — which is the number the pour-rate inversion actually uses.
 */
const FRAMAX_PRESSURE: PermissiblePressure = {
  wallsKnM2: 80,
  columnsKnM2: 90,
  upratedKnM2: 100,
  upratedWidthsMm: [1050, 750, 600, 450, 300],
  pressureStandard: 'DIN 18218:2010',
  basis: 'permissible',
  sourceRef:
    'Doka Framax S Xlife User Information — walls 80 kN/m² (1,650 psf) per DIN 18218, uprated to 100 kN/m² for widths 105/75/60/45/30 cm only; columns 90 kN/m²',
}

/**
 * Turning a Framax corner with ordinary panels rather than the system's own
 * corner drops the wall rating to 80 kN/m² even on a panel that would otherwise
 * be uprated — the corner, not the panel, governs.
 */
export const FRAMAX_OUTSIDE_CORNER_PRESSURE_KN_M2 = 80

/** Rated against ACI 347 Table 3.1 Class of surface B, and DIN 18202 Table 3 Line 6. */
export const FRAMAX_SURFACE_CLASS = 'ACI 347 Table 3.1 Class B'

/**
 * Horizontal tie spacing is 1.35 m — one panel width on the widest panel, so the
 * ties land on the panel joints and a run of 1.35s needs no tie inside a panel at
 * all.
 */
const TIE_SPACING_MM = 1350

function panel(
  label: string,
  articleNo: string,
  widthMm: number,
  heightMm: number,
  weightKg: number,
  extra: Partial<PanelType> = {},
): PanelType {
  return {
    id: `doka-framax-panel-${articleNo}`,
    manufacturer: 'Doka',
    systemFamily: 'Framax Xlife',
    label,
    itemNo: articleNo,
    weightKg,
    catalogSource: CATALOG,
    verification: 'certified',
    widthMm,
    heightMm,
    frameDepthMm: 120,
    tieHoles: {
      // Doka publishes the 1.35 m spacing rather than a hole schedule, so the
      // levels are derived from it: a row every 1.35 m up the panel, offset half
      // a spacing so the bottom row sits where the pressure is highest rather
      // than on the base rail.
      levelsMm: Array.from({ length: Math.max(1, Math.floor(heightMm / TIE_SPACING_MM)) }, (_, i) =>
        Math.round(TIE_SPACING_MM / 2 + i * TIE_SPACING_MM),
      ),
      columnsMm: [widthMm / 2],
      sourceRef: 'derived from Doka Framax Xlife published tie spacing 1.35 m',
    },
    pressure: FRAMAX_PRESSURE,
    ...extra,
  }
}

const PANELS: PanelType[] = [
  panel('Framax Xlife panel 1.35 x 2.70 m', '588100500', 1350, 2700, 210.0),
  panel('Framax Xlife panel 0.90 x 2.70 m', '588102500', 900, 2700, 126.5),
  panel('Framax Xlife panel 0.60 x 2.70 m', '588104500', 600, 2700, 91.5),
  panel('Framax Xlife panel 0.55 x 2.70 m', '588105500', 550, 2700, 87.0),
  panel('Framax Xlife panel 0.45 x 2.70 m', '588106500', 450, 2700, 77.7),
  panel('Framax Xlife panel 0.30 x 2.70 m', '588108500', 300, 2700, 61.5),
  panel('Framax Xlife panel 1.35 x 1.35 m', '588110500', 1350, 1350, 106.3),
  panel('Framax Xlife panel 0.90 x 1.35 m', '588112500', 900, 1350, 68.5),
  panel('Framax Xlife panel 0.60 x 1.35 m', '588114500', 600, 1350, 50.5),
  panel('Framax Xlife panel 0.55 x 1.35 m', '588115500', 550, 1350, 46.5),
  panel('Framax Xlife panel 0.45 x 1.35 m', '588116500', 450, 1350, 41.0),
  panel('Framax Xlife panel 0.30 x 1.35 m', '588118500', 300, 1350, 31.8),
  panel('Framax Xlife panel 1.35 x 3.30 m', '588221500', 1350, 3300, 259.3),
  panel('Framax Xlife panel 0.90 x 3.30 m', '588222500', 900, 3300, 154.5),
  panel('Framax Xlife panel 0.60 x 3.30 m', '588223500', 600, 3300, 114.7),
  panel('Framax Xlife panel 0.55 x 3.30 m', '588131500', 550, 3300, 107.5),
  panel('Framax Xlife panel 0.45 x 3.30 m', '588224500', 450, 3300, 97.9),
  panel('Framax Xlife panel 0.30 x 3.30 m', '588225500', 300, 3300, 78.5),
  panel('Framax Xlife large-area panel 2.40 x 2.70 m', '588103500', 2400, 2700, 370.0),
  panel('Framax Xlife large-area panel 2.40 x 3.30 m', '588606500', 2400, 3300, 484.9),
  panel('Framax Xlife large-area panel 2.70 x 2.70 m', '588109500', 2700, 2700, 416.0),
  panel('Framax Xlife large-area panel 2.70 x 3.30 m', '588608500', 2700, 3300, 514.2),
]

/**
 * Universal panels — Doka marks their corners blue — take the T-junctions, the
 * stop-ends and the wall-thickness compensation. They cost and weigh more than a
 * run panel of the same size (0.90 × 2.70: 148.0 kg against 126.5), so spending
 * one where an ordinary panel would do is a real loss.
 */
const UNIVERSAL_PANELS: PanelType[] = [
  panel('Framax Xlife universal panel 0.90 x 0.90 m', '588120500', 900, 900, 63.0, {
    universal: true,
  }),
  panel('Framax Xlife universal panel 0.90 x 1.35 m', '588124500', 900, 1350, 79.3, {
    universal: true,
  }),
  panel('Framax Xlife universal panel 0.90 x 2.70 m', '588122500', 900, 2700, 148.0, {
    universal: true,
  }),
  panel('Framax Xlife universal panel 0.90 x 3.30 m', '588228500', 900, 3300, 182.6, {
    universal: true,
  }),
  panel('Framax Xlife universal panel 1.20 x 0.90 m', '588604500', 1200, 900, 91.5, {
    universal: true,
  }),
  panel('Framax Xlife universal panel 1.20 x 1.35 m', '588603500', 1200, 1350, 116.7, {
    universal: true,
  }),
  panel('Framax Xlife universal panel 1.20 x 2.70 m', '588601500', 1200, 2700, 225.8, {
    universal: true,
  }),
  panel('Framax Xlife universal panel 1.20 x 3.30 m', '588671500', 1200, 3300, 276.7, {
    universal: true,
  }),
  panel('Framax Xlife universal panel SCC 0.90 x 2.70 m', '588119500', 900, 2700, 170.3, {
    universal: true,
    selfCompacting: true,
  }),
]

/**
 * Doka publishes corner weights but not leg lengths, so the legs are derived
 * from the core the corner turns onto rather than asserted as fixed geometry.
 * That keeps the outside-longer-than-inside relationship correct at any wall
 * thickness instead of hardcoding a dimension nobody published.
 *
 * Every corner shares one 300 mm base leg, inside and outside alike: an outside
 * unit's extra length is the core it wraps, so giving the two sides different
 * bases would break the relationship rather than describe it.
 */
const BASE_LEG_MM = 300

function corner(
  label: string,
  articleNo: string,
  heightMm: number,
  weightKg: number,
  side: 'inside' | 'outside',
  insideLegMm: number,
  angleRangeDeg: { minDeg: number; maxDeg: number },
  hinged?: boolean,
): CornerType {
  return {
    id: `doka-framax-corner-${articleNo}`,
    manufacturer: 'Doka',
    systemFamily: 'Framax Xlife',
    label,
    itemNo: articleNo,
    weightKg,
    catalogSource: CATALOG,
    verification: 'certified',
    side,
    heightMm,
    legs: { kind: 'derived-from-core', insideLegMm },
    angleRangeDeg,
    ...(hinged ? { hinged } : {}),
  }
}

const RIGHT_ANGLE = { minDeg: 90, maxDeg: 90 }
/** The hinged corners' published range: obtuse and acute either side of square. */
const HINGED_INSIDE = { minDeg: 60, maxDeg: 180 }
const HINGED_OUTSIDE = { minDeg: 180, maxDeg: 300 }

const CORNERS: CornerType[] = [
  corner(
    'Framax Xlife inside corner 1.35 m',
    '588132500',
    1350,
    51.2,
    'inside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
  corner(
    'Framax Xlife inside corner 2.70 m',
    '588130500',
    2700,
    97.0,
    'inside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
  corner(
    'Framax Xlife inside corner 3.30 m',
    '588229500',
    3300,
    117.9,
    'inside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
  corner(
    'Framax Xlife outside corner 1.35 m',
    '588128000',
    1350,
    23.5,
    'outside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
  corner(
    'Framax Xlife outside corner 2.70 m',
    '588126000',
    2700,
    47.0,
    'outside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
  corner(
    'Framax Xlife outside corner 3.30 m',
    '588227000',
    3300,
    58.0,
    'outside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
  corner(
    'Framax Xlife hinged inside corner I 1.35 m',
    '588137000',
    1350,
    55.4,
    'inside',
    BASE_LEG_MM,
    HINGED_INSIDE,
    true,
  ),
  corner(
    'Framax Xlife hinged inside corner I 2.70 m',
    '588136000',
    2700,
    102.3,
    'inside',
    BASE_LEG_MM,
    HINGED_INSIDE,
    true,
  ),
  corner(
    'Framax Xlife hinged inside corner I 3.30 m',
    '588610000',
    3300,
    125.5,
    'inside',
    BASE_LEG_MM,
    HINGED_INSIDE,
    true,
  ),
  corner(
    'Framax Xlife hinged outside corner A 1.35 m',
    '588135000',
    1350,
    27.4,
    'outside',
    BASE_LEG_MM,
    HINGED_OUTSIDE,
    true,
  ),
  corner(
    'Framax Xlife hinged outside corner A 2.70 m',
    '588134000',
    2700,
    52.8,
    'outside',
    BASE_LEG_MM,
    HINGED_OUTSIDE,
    true,
  ),
  // The stripping corner carries a spindle that pulls the form off the concrete,
  // so it is the shaft and lift-shaft answer — three times the weight of a plain
  // inside corner, and only worth it where there is no room to strike outwards.
  corner(
    'Framax Xlife stripping corner I 1.35 m',
    '588614000',
    1350,
    90.0,
    'inside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
  corner(
    'Framax Xlife stripping corner I 2.70 m',
    '588675000',
    2700,
    171.0,
    'inside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
  corner(
    'Framax Xlife stripping corner I 3.30 m',
    '588676000',
    3300,
    209.9,
    'inside',
    BASE_LEG_MM,
    RIGHT_ANGLE,
  ),
]

function filler(
  label: string,
  articleNo: string,
  heightMm: number,
  weightKg: number,
  width: FillerType['width'],
  madeFrom: FillerType['madeFrom'],
): FillerType {
  return {
    id: `doka-framax-filler-${articleNo}`,
    manufacturer: 'Doka',
    systemFamily: 'Framax Xlife',
    label,
    itemNo: articleNo,
    weightKg,
    catalogSource: CATALOG,
    verification: 'certified',
    heightMm,
    width,
    madeFrom,
  }
}

/**
 * Framax makes up gaps with steel plates in two widths and then with fitting
 * timber (`Passholz`) in 2, 3, 5 and 10 cm — the timber is a stock item here
 * rather than something cut on site, which is why it is `timber` and not
 * `site-cut`.
 */
const FILLERS: FillerType[] = [
  filler(
    'Framax steel closure plate 5 cm, 1.35 m',
    '588272000',
    1350,
    7.9,
    {
      kind: 'fixed',
      widthMm: 50,
    },
    'system-plate',
  ),
  filler(
    'Framax steel closure plate 5 cm, 2.70 m',
    '588273000',
    2700,
    14.0,
    {
      kind: 'fixed',
      widthMm: 50,
    },
    'system-plate',
  ),
  filler(
    'Framax steel closure plate 5 cm, 3.30 m',
    '588274000',
    3300,
    17.2,
    {
      kind: 'fixed',
      widthMm: 50,
    },
    'system-plate',
  ),
  filler(
    'Framax closure plate R30, 0.90 m',
    '588144000',
    900,
    14.4,
    {
      kind: 'fixed',
      widthMm: 380,
    },
    'system-plate',
  ),
  filler(
    'Framax closure plate R30, 1.35 m',
    '588142000',
    1350,
    21.4,
    {
      kind: 'fixed',
      widthMm: 380,
    },
    'system-plate',
  ),
  filler(
    'Framax closure plate R30, 2.70 m',
    '588140000',
    2700,
    43.0,
    {
      kind: 'fixed',
      widthMm: 380,
    },
    'system-plate',
  ),
  filler(
    'Fitting timber 2 x 12 cm, 2.70 m',
    '176020000',
    2700,
    3.1,
    {
      kind: 'fixed',
      widthMm: 20,
    },
    'timber',
  ),
  filler(
    'Fitting timber 3 x 12 cm, 2.70 m',
    '176021000',
    2700,
    4.6,
    {
      kind: 'fixed',
      widthMm: 30,
    },
    'timber',
  ),
  filler(
    'Fitting timber 5 x 12 cm, 2.70 m',
    '176022000',
    2700,
    7.7,
    {
      kind: 'fixed',
      widthMm: 50,
    },
    'timber',
  ),
  filler(
    'Fitting timber 10 x 12 cm, 2.70 m',
    '176023000',
    2700,
    15.5,
    {
      kind: 'fixed',
      widthMm: 100,
    },
    'timber',
  ),
]

/**
 * Doka's tie components, with the pieces that actually govern. The published
 * design rule is
 * `F_tie ≤ min(rod, anchor plate/wing nut, panel borehole, waling connection)`,
 * and the borehole at 25 kN and the tie-holder bracket at 15 kN are both well
 * below the DW 15 rod's 90 kN — so a check that only sees the rod is out by a
 * factor of six.
 */
const TIES: TieType[] = [
  {
    id: 'doka-framax-tie-dw15',
    manufacturer: 'Doka',
    systemFamily: 'Framax Xlife',
    label: 'Tie rod DW 15 (through-tie)',
    weightKg: 1.1,
    catalogSource: CATALOG,
    verification: 'certified',
    system: 'DW 15',
    capacityKn: 90,
    capacityBasis: 'permissible',
    componentCapacitiesKn: {
      'panel borehole': 25,
      'tie-holder bracket': 15,
      'adjustable clamp (tensile)': 10,
      'foundation clamp + perforated tape': 12,
    },
    sourceRef: 'wiki/formwork/reference/design.md §2.5 — Doka published component capacities',
  },
  {
    id: 'doka-framax-tie-588681000',
    manufacturer: 'Doka',
    systemFamily: 'Framax Xlife',
    label: 'Framax combination nut 15.0 (one-sided tying)',
    itemNo: '588681000',
    weightKg: 5.2,
    catalogSource: CATALOG,
    verification: 'certified',
    system: 'Monotec 15.0',
    capacityKn: 90,
    capacityBasis: 'permissible',
    wallRangeMm: { minMm: 150, maxMm: 350 },
    oneSided: true,
    watertight: true,
    sourceRef:
      'Doka item list me/91.pdf — "Tying from one side only"; Monotec conical tie covers 15–35 cm wall with two tie types',
  },
]

export const DOKA_FRAMAX_XLIFE: FormworkSystem = {
  id: 'doka-framax-xlife',
  manufacturer: 'Doka',
  label: 'Doka Framax Xlife (steel)',
  seeded: true,
  frameDepthMm: 120,
  panels: [...PANELS, ...UNIVERSAL_PANELS],
  corners: CORNERS,
  fillers: FILLERS,
  ties: TIES,
  // Framax's own holes are 1.35 m apart, which is wider than the 0.9 m rule of
  // thumb — the system is stiffer, so its published spacing governs rather than
  // the practical cap.
  maxPracticalTieSpacingMm: TIE_SPACING_MM,
  verification: 'certified',
  sourceRef: SOURCE,
}
