import type { FloorplanGeometry, FloorplanPoint } from '@pascal-app/core'
import { floorplanGeometryMetadata } from '@pascal-app/editor'

/**
 * PERMIT-SET PLAN SYMBOLS for items — what a sheet draws instead of the
 * asset's raster sprite: real fixtures (sinks …) with fixture labels, as a
 * full plan set shows them.
 *
 * A plans examiner reads plumbing fixtures and appliances off the floor plan,
 * so those draw as crisp linework at true size with the standard label (WC,
 * LAV, TUB, SHWR, W, D, WH, REF, R, DW …). Furniture is thin light-grey
 * outline, a car a light dashed outline, and ceiling-mounted items, wall
 * devices and decor are left off — the lights go on the electrical plan.
 *
 * Symbols are built in the item's LOCAL plan frame, true size: x across the
 * width, y along the depth, the BACK (the wall it stands against) at
 * y = -depth / 2 and the front at +depth / 2. The caller maps the points.
 */

/**
 * Metadata key on a drafted item's group naming what it is (`fixture`,
 * `furniture`, `car`) — how a sheet tells a WC it must keep text off from a
 * bed it may overlap, without re-classifying the asset itself.
 */
export const PLAN_SYMBOL_METADATA_KEY = 'pascal:sheet/plan-symbol'

export type PlanFixtureKind =
  | 'wc'
  | 'lav'
  | 'tub'
  | 'shower'
  | 'washer'
  | 'dryer'
  | 'washer-dryer'
  | 'water-heater'
  | 'ref'
  | 'range'
  | 'cooktop'
  | 'oven'
  | 'dw'
  | 'mw'
  | 'sink'
  | 'fireplace'
  | 'ev'
  | 'condenser'

export type PlanItemClass =
  | { kind: 'fixture'; fixture: PlanFixtureKind; label: string }
  | { kind: 'casework' }
  | { kind: 'car' }
  | { kind: 'furniture'; shape: 'bed' | 'sofa' | 'plain' }
  | { kind: 'omit' }

type AssetLike = {
  id?: string
  name?: string
  category?: string
  tags?: readonly string[]
  attachTo?: string
}

const FIXTURES: ReadonlyArray<{ test: RegExp; fixture: PlanFixtureKind; label: string }> = [
  { test: /\btoilet\b(?!-paper)|water-?closet|\bwc\b/, fixture: 'wc', label: 'WC' },
  { test: /bathroom-sink|lavatory|\blav\b|\bvanity\b|wash-?basin/, fixture: 'lav', label: 'LAV' },
  { test: /\bbathtub\b|\bbath-?tub\b|^bath$|\btub\b/, fixture: 'tub', label: 'TUB' },
  { test: /\bshower\b(?!-rug|-curtain|-caddy)/, fixture: 'shower', label: 'SHWR' },
  {
    test: /washer-?dryer|washer\/dryer|laundry-?pair|stacked-?laundry/,
    fixture: 'washer-dryer',
    label: 'W/D',
  },
  { test: /washing-?machine|(?<!dish)\bwasher\b|clothes-?washer/, fixture: 'washer', label: 'W' },
  { test: /(?<!hair-)\bdryer\b|clothes-?dryer|tumble/, fixture: 'dryer', label: 'D' },
  { test: /water-?heater|\bboiler\b|tankless/, fixture: 'water-heater', label: 'WH' },
  { test: /fridge|refrigerator|freezer/, fixture: 'ref', label: 'REF' },
  { test: /dishwasher/, fixture: 'dw', label: 'DW' },
  { test: /microwave/, fixture: 'mw', label: 'MW' },
  { test: /cooktop|\bhob\b/, fixture: 'cooktop', label: 'CT' },
  { test: /\bstove\b|\brange\b(?!-hood)/, fixture: 'range', label: 'R' },
  { test: /\boven\b/, fixture: 'oven', label: 'OV' },
  {
    test: /kitchen-?sink|bar-?sink|utility-?sink|laundry-?sink|\bsink\b/,
    fixture: 'sink',
    label: 'SINK',
  },
  { test: /fireplace|wood-?stove/, fixture: 'fireplace', label: 'FP' },
  { test: /ev-?(wall-)?charger|\bevse\b/, fixture: 'ev', label: 'EV' },
  { test: /ac-block|condenser|condensing-unit|heat-pump/, fixture: 'condenser', label: 'A/C' },
]

/** Built-in cabinets and counters placed as items: casework, drawn in ink like a cabinet run. */
const CASEWORK =
  /kitchen-counter|kitchen-cabinet|kitchen-island|kitchen-bar|^kitchen$|base-cabinet|^cabinet$|modular-cabinet/

/** Decor, loose kitchenware and wall devices: not drawn on a permit floor plan. */
const OMIT =
  /plant|cactus|\btree\b|\bbush\b|\bpalm\b|carpet|\brug\b|picture|mirror|lamp|light|toilet-?paper|laundry-?bag|\bbooks?\b|\btoy\b|\bball\b|skate|scooter|kettle|toaster|frying|fruit|wine|utensil|cutting-?board|coffee-?machine|\biron\b|ironing|computer|speaker|guitar|easel|sewing|barbell|outlet|thermostat|keypad|detector|sprinkler|exit-?sign|electric-?panel|alarm|umbrella|hydrant|basket|drying-?rack|coat-?rack|\bhood\b|television|\btv\b(?!-stand)|air-?conditioning|parking-?spot|kitchen-?shelf/

const CAR = /\bcar\b(?!-toy)|tesla|camaro|chevrolet|\btruck\b|sedan|\bsuv\b|vehicle/

const BED = /\bbed\b|bunkbed|double-bed|single-bed/
const SOFA = /sofa|couch|sectional|loveseat/

/** What a sheet draws for an item, from its asset. */
export function classifyPlanItem(asset: AssetLike): PlanItemClass {
  if (asset.attachTo === 'ceiling') return { kind: 'omit' }
  const id = (asset.id ?? '').toLowerCase()
  const name = (asset.name ?? '').toLowerCase().replace(/\s+/g, '-')
  // the id first: it is the catalog's own word for the thing
  for (const text of [id, name]) {
    if (!text) continue
    for (const entry of FIXTURES) {
      if (!entry.test.test(text)) continue
      // a tub with a shower over it is the TUB/SHWR a plan labels
      if (entry.fixture === 'tub' && /shower/.test(`${id} ${name}`)) {
        return { kind: 'fixture', fixture: 'tub', label: 'TUB/SHWR' }
      }
      return { kind: 'fixture', fixture: entry.fixture, label: entry.label }
    }
  }
  const words = `${id} ${name}`
  if (CASEWORK.test(id) || CASEWORK.test(name)) return { kind: 'casework' }
  if (CAR.test(words)) return { kind: 'car' }
  if (OMIT.test(words)) return { kind: 'omit' }
  if (asset.attachTo === 'wall' || asset.attachTo === 'wall-side') {
    // shelves, cabinets and the like hang on a wall inside the cut: outline them
    return { kind: 'furniture', shape: 'plain' }
  }
  if (BED.test(words)) return { kind: 'furniture', shape: 'bed' }
  if (SOFA.test(words)) return { kind: 'furniture', shape: 'sofa' }
  return { kind: 'furniture', shape: 'plain' }
}

/* ------------------------------------------------------------ styles */

/** Fixture linework — the weight casework draws in, near-black. */
export const FIXTURE_STROKE = '#1f2937'
export const FIXTURE_STROKE_WIDTH = 0.012
const FIXTURE_DETAIL_WIDTH = 0.008
/** Furniture: thin, light grey — present, never competing with the walls. */
export const FURNITURE_STROKE = '#9ca3af'
export const FURNITURE_STROKE_WIDTH = 0.006
const LABEL_FILL = '#111827'
/** Fixture label size on the paper, points, and its plan-metre size at 1/4" = 1'-0". */
export const FIXTURE_LABEL_PT = 6.5
export const FIXTURE_LABEL_SIZE = 0.11

export type PlanSymbolFrame = {
  /** Local (x across, y along the depth; back = -depth / 2) → plan point. */
  map: (x: number, y: number) => FloorplanPoint
  width: number
  depth: number
}

/**
 * The drafting symbol for an item, in plan coordinates. Empty for `omit`.
 */
export function buildPlanItemSymbol(
  cls: PlanItemClass,
  frame: PlanSymbolFrame,
): FloorplanGeometry[] {
  switch (cls.kind) {
    case 'omit':
      return []
    case 'car':
      return [carOutline(frame)]
    case 'casework': {
      const hw = frame.width / 2
      const hd = frame.depth / 2
      return [
        polygon(frame, rect(-hw, -hd, hw, hd), {
          ...OUTLINE,
          strokeWidth: FIXTURE_DETAIL_WIDTH * 1.25,
        }),
      ]
    }
    case 'furniture':
      return furnitureSymbol(cls.shape, frame)
    case 'fixture':
      return fixtureSymbol(cls.fixture, cls.label, frame)
  }
}

/* ------------------------------------------------------------ helpers */

type Stroke = { stroke: string; strokeWidth: number; fill?: string; strokeDasharray?: string }

const OUTLINE: Stroke = {
  stroke: FIXTURE_STROKE,
  strokeWidth: FIXTURE_STROKE_WIDTH,
  fill: '#ffffff',
}
const DETAIL: Stroke = { stroke: FIXTURE_STROKE, strokeWidth: FIXTURE_DETAIL_WIDTH, fill: 'none' }
const FURNITURE: Stroke = {
  stroke: FURNITURE_STROKE,
  strokeWidth: FURNITURE_STROKE_WIDTH,
  fill: 'none',
}

function polygon(
  frame: PlanSymbolFrame,
  points: ReadonlyArray<readonly [number, number]>,
  style: Stroke,
): FloorplanGeometry {
  return {
    kind: 'polygon',
    points: points.map(([x, y]) => frame.map(x, y)),
    fill: style.fill ?? 'none',
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDasharray: style.strokeDasharray,
    strokeLinejoin: 'round',
  }
}

function line(
  frame: PlanSymbolFrame,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: Stroke,
): FloorplanGeometry {
  const [ax, ay] = frame.map(x1, y1)
  const [bx, by] = frame.map(x2, y2)
  return {
    kind: 'line',
    x1: ax,
    y1: ay,
    x2: bx,
    y2: by,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDasharray: style.strokeDasharray,
  }
}

function circle(
  frame: PlanSymbolFrame,
  x: number,
  y: number,
  r: number,
  style: Stroke,
): FloorplanGeometry {
  const [cx, cy] = frame.map(x, y)
  return {
    kind: 'circle',
    cx,
    cy,
    r,
    fill: style.fill ?? 'none',
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
  }
}

function rect(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
}

function roundedRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): Array<[number, number]> {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
  if (r < 1e-4) return rect(x0, y0, x1, y1)
  const out: Array<[number, number]> = []
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 4; i++) {
      const a = from + (i / 4) * (Math.PI / 2)
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  }
  corner(x1 - r, y0 + r, -Math.PI / 2)
  corner(x1 - r, y1 - r, 0)
  corner(x0 + r, y1 - r, Math.PI / 2)
  corner(x0 + r, y0 + r, Math.PI)
  return out
}

function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  segments = 32,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return out
}

/**
 * A fixture label. Text is an annotation on a sheet, printed at a fixed paper
 * size (`FIXTURE_LABEL_PT`) whatever the scale; `fontSize` is its plan-metre
 * size at 1/4" = 1'-0" for any view that draws it in plan units. Each label
 * is its own group so two labels that share an x (a double vanity's LAVs)
 * are never read as one stacked block and re-spaced together.
 */
function label(frame: PlanSymbolFrame, text: string, x: number, y: number): FloorplanGeometry {
  const [px, py] = frame.map(x, y)
  return {
    kind: 'group',
    children: [
      {
        kind: 'text',
        x: px,
        y: py,
        text,
        fontSize: FIXTURE_LABEL_SIZE,
        fill: LABEL_FILL,
        fontWeight: 700,
        fontFamily: 'Helvetica, Arial, sans-serif',
        textAnchor: 'middle',
        dominantBaseline: 'central',
        upright: true,
        metadata: floorplanGeometryMetadata({ textSizePt: FIXTURE_LABEL_PT }),
      },
    ],
  }
}

/* ------------------------------------------------------------ symbols */

function carOutline(frame: PlanSymbolFrame): FloorplanGeometry {
  const hw = frame.width / 2
  const hd = frame.depth / 2
  return polygon(frame, roundedRect(-hw, -hd, hw, hd, Math.min(hw, hd) * 0.35), {
    stroke: FURNITURE_STROKE,
    strokeWidth: FURNITURE_STROKE_WIDTH * 1.2,
    fill: 'none',
    strokeDasharray: '0.18 0.12',
  })
}

function furnitureSymbol(
  shape: 'bed' | 'sofa' | 'plain',
  frame: PlanSymbolFrame,
): FloorplanGeometry[] {
  const hw = frame.width / 2
  const hd = frame.depth / 2
  const out: FloorplanGeometry[] = [polygon(frame, rect(-hw, -hd, hw, hd), FURNITURE)]
  if (shape === 'bed' && frame.depth > 1.2) {
    // pillows at the head (the back), the turned-down sheet across
    const pillows = frame.width >= 1.2 ? 2 : 1
    const gap = 0.06
    const pw = (frame.width - gap * (pillows + 1)) / pillows
    for (let i = 0; i < pillows; i++) {
      const x0 = -hw + gap + i * (pw + gap)
      out.push(
        polygon(frame, roundedRect(x0, -hd + gap, x0 + pw, -hd + gap + 0.2, 0.05), FURNITURE),
      )
    }
    out.push(line(frame, -hw, -hd + 0.5, hw, -hd + 0.5, FURNITURE))
  } else if (shape === 'sofa' && frame.depth > 0.5 && frame.width > 1) {
    const back = -hd + Math.min(0.22, frame.depth * 0.25)
    const arm = Math.min(0.2, frame.width * 0.12)
    out.push(line(frame, -hw, back, hw, back, FURNITURE))
    out.push(line(frame, -hw + arm, back, -hw + arm, hd, FURNITURE))
    out.push(line(frame, hw - arm, back, hw - arm, hd, FURNITURE))
  }
  return out
}

function fixtureSymbol(
  fixture: PlanFixtureKind,
  text: string,
  frame: PlanSymbolFrame,
): FloorplanGeometry[] {
  const w = frame.width
  const d = frame.depth
  const hw = w / 2
  const hd = d / 2
  const out: FloorplanGeometry[] = []
  switch (fixture) {
    case 'wc': {
      // tank against the wall, elongated bowl in front of it
      const tank = Math.min(0.22, Math.max(0.15, d * 0.3))
      out.push(polygon(frame, roundedRect(-hw, -hd, hw, -hd + tank, 0.03), OUTLINE))
      const bowlLength = Math.max(0.2, d - tank - 0.02)
      const cy = -hd + tank + bowlLength / 2
      const rx = Math.min(hw * 0.92, 0.2)
      out.push(polygon(frame, ellipse(0, cy, rx, bowlLength / 2), OUTLINE))
      out.push(
        polygon(frame, ellipse(0, cy + bowlLength * 0.04, rx * 0.68, bowlLength * 0.34), DETAIL),
      )
      out.push(label(frame, text, 0, cy + bowlLength * 0.04))
      return out
    }
    case 'lav': {
      out.push(polygon(frame, rect(-hw, -hd, hw, hd), OUTLINE))
      // a double vanity from 48 in wide: a basin per sink, each labelled
      const basins = w >= 1.2 ? 2 : 1
      const pitch = w / basins
      const rx = Math.min(0.22, pitch * 0.34)
      const ry = Math.min(0.17, d * 0.3)
      for (let i = 0; i < basins; i++) {
        const cx = -hw + pitch * (i + 0.5)
        const cy = d * 0.04
        out.push(polygon(frame, ellipse(cx, cy, rx, ry), DETAIL))
        out.push(circle(frame, cx, cy - ry - 0.05, 0.018, DETAIL))
        out.push(label(frame, 'LAV', cx, cy))
      }
      return out
    }
    case 'tub': {
      out.push(polygon(frame, rect(-hw, -hd, hw, hd), OUTLINE))
      const inset = Math.min(0.08, Math.min(w, d) * 0.1)
      // the long axis carries the drain at one end
      const long = w >= d
      out.push(
        polygon(
          frame,
          roundedRect(-hw + inset, -hd + inset, hw - inset, hd - inset, Math.min(w, d) * 0.22),
          DETAIL,
        ),
      )
      if (long) out.push(circle(frame, -hw + inset + 0.14, 0, 0.03, DETAIL))
      else out.push(circle(frame, 0, -hd + inset + 0.14, 0.03, DETAIL))
      out.push(label(frame, text, 0, 0))
      return out
    }
    case 'shower': {
      out.push(polygon(frame, rect(-hw, -hd, hw, hd), OUTLINE))
      const inset = Math.min(0.05, Math.min(w, d) * 0.08)
      out.push(polygon(frame, rect(-hw + inset, -hd + inset, hw - inset, hd - inset), DETAIL))
      // the drain, and the diagonals a shower pan is drawn with, stopped short of the label
      out.push(circle(frame, 0, d * 0.22, 0.035, DETAIL))
      out.push(line(frame, -hw + inset, hd - inset, -0.08, d * 0.22 + 0.06, DETAIL))
      out.push(line(frame, hw - inset, hd - inset, 0.08, d * 0.22 + 0.06, DETAIL))
      out.push(label(frame, text, 0, -d * 0.08))
      return out
    }
    case 'washer':
    case 'dryer':
    case 'washer-dryer': {
      out.push(polygon(frame, rect(-hw, -hd, hw, hd), OUTLINE))
      if (fixture === 'washer') out.push(circle(frame, 0, 0, Math.min(w, d) * 0.32, DETAIL))
      if (fixture === 'washer-dryer') out.push(line(frame, -hw, hd - 0.06, hw, hd - 0.06, DETAIL))
      out.push(label(frame, text, 0, 0))
      return out
    }
    case 'water-heater': {
      const r = Math.min(w, d) / 2
      out.push(circle(frame, 0, 0, r, OUTLINE))
      out.push(label(frame, text, 0, 0))
      return out
    }
    case 'ref': {
      out.push(polygon(frame, rect(-hw, -hd, hw, hd), OUTLINE))
      // the door's swing line across the front
      out.push(
        line(frame, -hw, hd - Math.min(0.06, d * 0.1), hw, hd - Math.min(0.06, d * 0.1), DETAIL),
      )
      out.push(label(frame, text, 0, -d * 0.05))
      return out
    }
    case 'range':
    case 'cooktop': {
      out.push(polygon(frame, rect(-hw, -hd, hw, hd), OUTLINE))
      const r = Math.min(0.08, w * 0.13, d * 0.14)
      for (const [x, y] of [
        [-w * 0.26, -d * 0.2],
        [w * 0.26, -d * 0.2],
        [-w * 0.26, d * 0.18],
        [w * 0.26, d * 0.18],
      ] as const) {
        out.push(circle(frame, x, y, r, DETAIL))
      }
      out.push(label(frame, text, 0, 0))
      return out
    }
    case 'sink': {
      out.push(polygon(frame, rect(-hw, -hd, hw, hd), OUTLINE))
      const inset = Math.min(0.06, Math.min(w, d) * 0.12)
      out.push(
        polygon(
          frame,
          roundedRect(-hw + inset, -hd + inset * 1.8, hw - inset, hd - inset, 0.04),
          DETAIL,
        ),
      )
      out.push(label(frame, text, 0, 0))
      return out
    }
    case 'fireplace': {
      out.push(
        polygon(frame, rect(-hw, -hd, hw, hd), {
          ...OUTLINE,
          strokeWidth: FIXTURE_STROKE_WIDTH * 1.4,
        }),
      )
      if (d > 0.3) {
        // the firebox, splayed toward the room
        const back = -hd + d * 0.25
        out.push(
          polygon(
            frame,
            [
              [-w * 0.2, back],
              [w * 0.2, back],
              [w * 0.32, hd],
              [-w * 0.32, hd],
            ],
            DETAIL,
          ),
        )
      }
      out.push(label(frame, text, 0, 0))
      return out
    }
    default: {
      // DW, MW, OV, EV: the box and its label
      out.push(polygon(frame, rect(-hw, -hd, hw, hd), OUTLINE))
      out.push(label(frame, text, 0, 0))
      return out
    }
  }
}
