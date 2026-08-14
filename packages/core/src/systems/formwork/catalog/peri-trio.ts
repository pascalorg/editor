import type {
  CornerType,
  FillerType,
  FormworkSystem,
  PanelType,
  PermissiblePressure,
  TieHoleGrid,
  TieType,
} from './types'

/**
 * PERI TRIO — steel-frame panel formwork, 120 mm frame depth throughout, on a
 * 30 cm width grid with a 72 cm oddity carried over from the Multi Panel.
 *
 * Transcribed from `wiki/formwork/reference/products.md` §1.1, which quotes
 * PERI's own component list. Weights are the brochure's; a dealer list gives
 * 80.30 kg for item 022550 where PERI says 87.400, which is why every entry
 * names the list it came from.
 */

const SOURCE = 'PERI TRIO Panel Formwork brochure — component list'
const CATALOG = 'PERI TRIO brochure (undated edition)'

/**
 * TRIO wall panels are rated 80 kN/m² on the panel body and TRS column panels
 * 100 kN/m², but the brochure's own stop-end and brace-frame design rules are
 * worked at 60 kN/m². Both numbers are true of different things: 80 is what the
 * frame carries, 60 is what the system carries once the accessories are in the
 * load path. The engine checks against the panel body and reports the practical
 * rating alongside it, because a form passing at 78 kN/m² is passing on a
 * component the brochure never sized for that.
 */
const TRIO_PRESSURE: PermissiblePressure = {
  wallsKnM2: 80,
  columnsKnM2: 100,
  pressureStandard: 'DIN 18218:2010',
  basis: 'permissible',
  sourceRef: 'perionline.com panel data; brochure design rules quote 60 kN/m² with accessories',
}

/**
 * The practical rating: what the brochure actually designs stop-ends and brace
 * frames to. Layout treats this as the working ceiling.
 */
export const TRIO_PRACTICAL_PRESSURE_KN_M2 = 60

/**
 * Tie levels come from the panel's dimension chain, not from a spacing rule. The
 * 270 panel's chain reads 575 / 1550 / 575, so its holes are at 575 and 2125 —
 * a 1550 mm gap that no tie calculation is free to subdivide.
 */
const TIE_HOLES_270: Omit<TieHoleGrid, 'columnsMm'> = {
  levelsMm: [575, 2125],
  sourceRef: 'PERI TRIO panel dimension chain 575 / 1550 / 575',
}

const TIE_HOLES_330: Omit<TieHoleGrid, 'columnsMm'> = {
  levelsMm: [475, 1075, 1650, 2725],
  sourceRef: 'PERI TRIO/4 panel dimension chain 475 / 600 / 575 / 1075 / 575',
}

const TIE_HOLES_120: Omit<TieHoleGrid, 'columnsMm'> = {
  levelsMm: [875],
  sourceRef: 'PERI TRIO 120 panel dimension chain 25 / 850 / 325',
}

/**
 * TRIO 60 has no published chain. One centred level is the reading that matches
 * the panel's proportions, and it is flagged rather than presented as read off a
 * table.
 */
const TIE_HOLES_60: Omit<TieHoleGrid, 'columnsMm'> = {
  levelsMm: [300],
  sourceRef: 'inferred — no published dimension chain for TRIO 60',
}

/**
 * Horizontal hole positions. Narrow panels tie on the centreline; the 240 panel's
 * chain 540 / 1320 / 540 puts two columns at 540 and 1860, which is the whole of
 * the "large panels need only two tie positions" economy.
 */
function tieColumnsMm(widthMm: number): number[] {
  if (widthMm >= 2400) return [540, 1860]
  return [widthMm / 2]
}

function panel(
  label: string,
  itemNo: string,
  widthMm: number,
  heightMm: number,
  weightKg: number,
  holes: Omit<TieHoleGrid, 'columnsMm'>,
): PanelType {
  return {
    id: `peri-trio-panel-${itemNo}`,
    manufacturer: 'PERI',
    systemFamily: 'TRIO',
    label,
    itemNo,
    weightKg,
    catalogSource: CATALOG,
    verification: 'secondary',
    widthMm,
    heightMm,
    frameDepthMm: 120,
    tieHoles: { ...holes, columnsMm: tieColumnsMm(widthMm) },
    pressure: TRIO_PRESSURE,
  }
}

const PANELS: PanelType[] = [
  panel('Panel TR 270 x 240', '022570', 2400, 2700, 330.0, TIE_HOLES_270),
  panel('Panel TR 270 x 120', '022510', 1200, 2700, 162.0, TIE_HOLES_270),
  panel('Panel TR 270 x 90', '022520', 900, 2700, 114.0, TIE_HOLES_270),
  panel('Panel TR 270 x 72', '022530', 720, 2700, 97.2, TIE_HOLES_270),
  panel('Panel TR 270 x 60', '022550', 600, 2700, 87.4, TIE_HOLES_270),
  panel('Panel TR 270 x 30', '022560', 300, 2700, 59.5, TIE_HOLES_270),
  panel('Panel TR/4 330 x 240', '054304', 2400, 3300, 399.0, TIE_HOLES_330),
  panel('Panel TR/4 330 x 120', '054314', 1200, 3300, 196.0, TIE_HOLES_330),
  panel('Panel TR/4 330 x 90', '054324', 900, 3300, 138.0, TIE_HOLES_330),
  panel('Panel TR/4 330 x 72', '054334', 720, 3300, 118.0, TIE_HOLES_330),
  panel('Panel TR/4 330 x 60', '054354', 600, 3300, 106.0, TIE_HOLES_330),
  panel('Panel TR/4 330 x 30', '054364', 300, 3300, 73.4, TIE_HOLES_330),
  panel('Panel TR 120 x 240', '022514', 2400, 1200, 162.0, TIE_HOLES_120),
  panel('Panel TR 120 x 120', '022600', 1200, 1200, 76.1, TIE_HOLES_120),
  panel('Panel TR 120 x 90', '022610', 900, 1200, 58.3, TIE_HOLES_120),
  panel('Panel TR 120 x 72', '022620', 720, 1200, 48.6, TIE_HOLES_120),
  panel('Panel TR 120 x 60', '022640', 600, 1200, 43.5, TIE_HOLES_120),
  panel('Panel TR 120 x 30', '022650', 300, 1200, 28.4, TIE_HOLES_120),
  panel('Panel TR 60 x 90', '022790', 900, 600, 34.5, TIE_HOLES_60),
  panel('Panel TR 60 x 72', '022800', 720, 600, 28.6, TIE_HOLES_60),
  panel('Panel TR 60 x 60', '022810', 600, 600, 25.7, TIE_HOLES_60),
  panel('Panel TR 60 x 30', '022820', 300, 600, 15.6, TIE_HOLES_60),
]

/**
 * Multi Panels take the oblique angles and the wall connections, so they are the
 * T-junction and skew panel — drilled with a continuous grid (holes every 30 mm
 * over 570 mm) rather than the run panels' two fixed levels.
 */
const MULTI_PANELS: PanelType[] = [
  {
    ...panel('Multi Panel TRM 270 x 72', '022540', 720, 2700, 103.0, TIE_HOLES_270),
    universal: true,
    tieHoles: {
      levelsMm: Array.from({ length: 20 }, (_, i) => 75 + i * 30),
      columnsMm: [360],
      sourceRef: 'PERI TRIO — TRM drilled grid 19 × 30 = 570 mm plus 75 mm end margins',
    },
  },
  {
    ...panel('Multi Panel TRM 120 x 72', '022630', 720, 1200, 56.3, TIE_HOLES_120),
    universal: true,
  },
  {
    ...panel('Multi Panel TRM/4 330 x 72', '054344', 720, 3300, 134.0, TIE_HOLES_330),
    universal: true,
  },
]

/**
 * Only the TE 270-2's legs are published — 180 × 300 mm — and every other TRIO
 * corner is the same part at another height, so they carry the same geometry. The
 * unequal legs are the point: the shorter one is the inside face of the wall it
 * belongs to, the longer one reaches across the neighbour it turns onto.
 */
function corner(
  label: string,
  itemNo: string,
  heightMm: number,
  weightKg: number,
  side: 'inside' | 'outside',
  legAMm: number,
  legBMm: number,
  angleRangeDeg: { minDeg: number; maxDeg: number },
  hinged?: boolean,
): CornerType {
  return {
    id: `peri-trio-corner-${itemNo}`,
    manufacturer: 'PERI',
    systemFamily: 'TRIO',
    label,
    itemNo,
    weightKg,
    catalogSource: CATALOG,
    verification: 'secondary',
    side,
    heightMm,
    legs: { kind: 'fixed', legAMm, legBMm },
    angleRangeDeg,
    ...(hinged ? { hinged } : {}),
  }
}

const CORNERS: CornerType[] = [
  corner('Inside Corner TE 270-2', '022580', 2700, 70.0, 'inside', 180, 300, {
    minDeg: 90,
    maxDeg: 90,
  }),
  corner('Inside Corner TE 120-2', '022660', 1200, 32.9, 'inside', 180, 300, {
    minDeg: 90,
    maxDeg: 90,
  }),
  corner('Inside Corner TE 60-2', '022840', 600, 18.0, 'inside', 180, 300, {
    minDeg: 90,
    maxDeg: 90,
  }),
  corner('Inside Corner TE/4 330', '054374', 3300, 85.8, 'inside', 180, 300, {
    minDeg: 90,
    maxDeg: 90,
  }),
  // Articulated corners hinge in both directions, so one part answers both an
  // inside and an outside skew. Listed twice, once per side, because the layout
  // asks "what turns this sector" and the answer is the same item number.
  corner(
    'Articulated Corner TGE 270',
    '023200',
    2700,
    94.9,
    'inside',
    300,
    300,
    { minDeg: 75, maxDeg: 180 },
    true,
  ),
  corner(
    'Articulated Corner TGE 270 (outside)',
    '023200',
    2700,
    94.9,
    'outside',
    300,
    300,
    { minDeg: 180, maxDeg: 285 },
    true,
  ),
  corner(
    'Articulated Corner TGE 120',
    '023300',
    1200,
    43.6,
    'inside',
    300,
    300,
    { minDeg: 75, maxDeg: 180 },
    true,
  ),
  corner(
    'Articulated Corner TGE/4 330',
    '054414',
    3300,
    119.0,
    'inside',
    300,
    300,
    { minDeg: 75, maxDeg: 180 },
    true,
  ),
  corner('Outside Corner TEA 270/135°', '103337', 2700, 76.5, 'outside', 290, 290, {
    minDeg: 135,
    maxDeg: 135,
  }),
  corner('Outside Corner TEA 120/135°', '103330', 1200, 35.9, 'outside', 290, 290, {
    minDeg: 135,
    maxDeg: 135,
  }),
  corner('Internal Corner TEI 270/135°', '103317', 2700, 56.9, 'inside', 189, 189, {
    minDeg: 135,
    maxDeg: 135,
  }),
  corner('Internal Corner TEI 120/135°', '103284', 1200, 26.4, 'inside', 189, 189, {
    minDeg: 135,
    maxDeg: 135,
  }),
]

/**
 * The compensation cascade, in the order it costs. Discrete WDA plates first,
 * then the LA filler plate — the one part that covers anything from 6 to 36 cm
 * continuously — then a profile holding a site-cut 21 mm board, which is a
 * carpenter rather than a stores issue.
 */
function filler(
  label: string,
  itemNo: string,
  heightMm: number,
  weightKg: number,
  width: FillerType['width'],
  madeFrom: FillerType['madeFrom'],
): FillerType {
  return {
    id: `peri-trio-filler-${itemNo}`,
    manufacturer: 'PERI',
    systemFamily: 'TRIO',
    label,
    itemNo,
    weightKg,
    catalogSource: CATALOG,
    verification: 'secondary',
    heightMm,
    width,
    madeFrom,
  }
}

const FILLERS: FillerType[] = [
  filler(
    'Wall Thickness Compensation WDA-2 270 x 5',
    '023182',
    2700,
    16.2,
    {
      kind: 'fixed',
      widthMm: 50,
    },
    'system-plate',
  ),
  filler(
    'Wall Thickness Compensation WDA-2 270 x 6',
    '023192',
    2700,
    17.2,
    {
      kind: 'fixed',
      widthMm: 60,
    },
    'system-plate',
  ),
  filler(
    'Wall Thickness Compensation WDA 270 x 10 Alu',
    '023995',
    2700,
    10.1,
    {
      kind: 'fixed',
      widthMm: 100,
    },
    'aluminium',
  ),
  filler(
    'Wall Thickness Compensation WDA-2 120 x 5',
    '023282',
    1200,
    7.61,
    {
      kind: 'fixed',
      widthMm: 50,
    },
    'system-plate',
  ),
  filler(
    'Wall Thickness Compensation WDA-2 120 x 6',
    '023292',
    1200,
    8.09,
    {
      kind: 'fixed',
      widthMm: 60,
    },
    'system-plate',
  ),
  filler(
    'Wall Thickness Compensation WDA 120 x 10 Alu',
    '023990',
    1200,
    4.68,
    {
      kind: 'fixed',
      widthMm: 100,
    },
    'aluminium',
  ),
  filler(
    'Wall Thickness Compensation WDA-2 330 x 5',
    '054391',
    3300,
    20.1,
    {
      kind: 'fixed',
      widthMm: 50,
    },
    'system-plate',
  ),
  filler(
    'Wall Thickness Compensation WDA-2 330 x 6',
    '054401',
    3300,
    21.4,
    {
      kind: 'fixed',
      widthMm: 60,
    },
    'system-plate',
  ),
  filler(
    'Wall Thickness Compensation WDA 330 x 10 Alu',
    '054435',
    3300,
    12.4,
    {
      kind: 'fixed',
      widthMm: 100,
    },
    'aluminium',
  ),
  filler(
    'Filler Plate LA 270 x 36',
    '023170',
    2700,
    48.9,
    {
      kind: 'range',
      minMm: 60,
      maxMm: 360,
    },
    'system-plate',
  ),
  filler(
    'Filler Plate LA 120 x 36',
    '023270',
    1200,
    24.5,
    {
      kind: 'range',
      minMm: 60,
      maxMm: 360,
    },
    'system-plate',
  ),
  filler(
    'Filler Plate LA/4 330 x 36',
    '054384',
    3300,
    62.2,
    {
      kind: 'range',
      minMm: 60,
      maxMm: 360,
    },
    'system-plate',
  ),
  // The profile and its support are the catalog part; the board they hold is a
  // cut-list line, so this entry's weight excludes it.
  filler(
    'Filler Profile TPP 270 Alu + Filler Support TPA 270',
    '101813',
    2700,
    12.75,
    {
      kind: 'range',
      minMm: 20,
      maxMm: 600,
    },
    'site-cut',
  ),
  filler(
    'Filler Profile TPP 120 Alu + Filler Support TPA 120',
    '101823',
    1200,
    5.65,
    {
      kind: 'range',
      minMm: 20,
      maxMm: 600,
    },
    'site-cut',
  ),
  filler(
    'Filler Profile TPP 330 Alu + Filler Support TPA 330',
    '101829',
    3300,
    16.22,
    {
      kind: 'range',
      minMm: 20,
      maxMm: 600,
    },
    'site-cut',
  ),
]

/**
 * The bulkhead tie and the panel coupler are both rated 20.0 kN, and both are
 * ties in the sense that matters here: they are what the pour pulls on. The
 * coupler is the system's one connecting part — it aligns, clamps and tensions —
 * so a panel joint's capacity is its capacity, not the rod's.
 */
const TIES: TieType[] = [
  {
    id: 'peri-trio-tie-023640',
    manufacturer: 'PERI',
    systemFamily: 'TRIO',
    label: 'Bulkhead Tie TS (DW 15)',
    itemNo: '023640',
    weightKg: 1.14,
    catalogSource: CATALOG,
    verification: 'secondary',
    system: 'DW 15',
    capacityKn: 20.0,
    capacityBasis: 'permissible',
    sourceRef: 'PERI TRIO brochure — "permissible tension force 20.0 kN"',
  },
  {
    id: 'peri-trio-tie-023500',
    manufacturer: 'PERI',
    systemFamily: 'TRIO',
    label: 'Alignment Coupler BFD',
    itemNo: '023500',
    weightKg: 4.58,
    catalogSource: CATALOG,
    verification: 'secondary',
    system: 'BFD',
    capacityKn: 20.0,
    capacityBasis: 'permissible',
    wallRangeMm: { minMm: 55, maxMm: 220 },
    sourceRef:
      'PERI TRIO brochure — "For all panel connections … Fillers up to 10 cm. Permissible tension force 20.0 kN", clamping range 55–220 mm',
  },
]

export const PERI_TRIO: FormworkSystem = {
  id: 'peri-trio',
  manufacturer: 'PERI',
  label: 'PERI TRIO (steel)',
  seeded: true,
  supports: { walls: true, columns: true, slabs: false },
  frameDepthMm: 120,
  panels: [...PANELS, ...MULTI_PANELS],
  corners: CORNERS,
  fillers: FILLERS,
  ties: TIES,
  maxPracticalTieSpacingMm: 900,
  verification: 'secondary',
  sourceRef: SOURCE,
}
