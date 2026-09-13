import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { FloorplanGeometry } from '@pascal-app/core'
import fixture from '../__fixtures__/plancrafters-cottage.json'
import type { ProviderArgs } from '../drawings'
import type { AnyNodeLike, NodeMap } from '../model'
import { plateToSvg } from '../notes/debug-svg'
import {
  bearingOf,
  computeEnvelope,
  orientationOf,
  outwardNormal,
  SQFT_PER_SQM,
} from '../notes/envelope'
import { resolveJurisdiction } from '../notes/jurisdiction'
import {
  compliancePathNote,
  energyCodeLabel,
  prescriptiveRequirements,
} from '../notes/prescriptive'
import { DEFAULT_VIEWPORT_LAYERS } from '../schema'
import { buildEnergyDrawing } from './energy'

const SCENE: NodeMap = (fixture as unknown as { graph: { nodes: NodeMap } }).graph.nodes
const LEVEL = Object.values(SCENE).find((n) => n.type === 'level') as AnyNodeLike

/** The drawable field of an ARCH D sheet, less the strip EN1.0 reserves. */
const FIELD = { x: 0.6, y: 1.0, w: 31.4, h: 22.2 }

const OUT_DIR =
  'C:/Users/steve/AppData/Local/Temp/claude/C--Dev-Pascal/a595fb05-e3d2-4d5c-afdf-c017ab20e61b/scratchpad'

function args(): ProviderArgs {
  return {
    levelId: LEVEL.id,
    layers: { ...DEFAULT_VIEWPORT_LAYERS },
    viewport: { ...FIELD, scale: 48 },
  }
}

function textOf(plate: readonly FloorplanGeometry[] | undefined): string {
  return (plate ?? [])
    .filter((g): g is Extract<FloorplanGeometry, { kind: 'text' }> => g.kind === 'text')
    .map((g) => g.text)
    .join(' ')
}

const sqft = (sqm: number) => sqm * SQFT_PER_SQM

/* --------------------------------------------------------- orientation */

describe('which way a wall faces', () => {
  test('the outward normal is the exterior side of perp(end − start)', () => {
    // frontSide is the +normal side; the cottage's north wall carries the
    // exterior on its BACK, so the outward normal is −normal.
    const north = outwardNormal(SCENE.wall_rc00000000000005 as AnyNodeLike)
    expect(north?.[0]).toBeCloseTo(0, 9)
    expect(north?.[1]).toBeCloseTo(-1, 9)
    const south = outwardNormal(SCENE.wall_rc0000000000000s as AnyNodeLike)
    expect(south?.[0]).toBeCloseTo(0, 9)
    expect(south?.[1]).toBeCloseTo(1, 9)
    // An interior wall has no exterior face at all.
    expect(outwardNormal(SCENE.wall_rc00000000000007 as AnyNodeLike)).toBeNull()
  })

  test('plan −z is north until the site says otherwise', () => {
    expect(bearingOf(0, -1, 0)).toBeCloseTo(0, 6)
    expect(bearingOf(1, 0, 0)).toBeCloseTo(90, 6)
    expect(bearingOf(0, 1, 0)).toBeCloseTo(180, 6)
    expect(bearingOf(-1, 0, 0)).toBeCloseTo(270, 6)
    expect(orientationOf(0)).toBe('N')
    expect(orientationOf(90)).toBe('E')
    expect(orientationOf(180)).toBe('S')
    expect(orientationOf(270)).toBe('W')
    // A 90° site north rotation swings every face one quarter turn.
    expect(orientationOf(bearingOf(0, -1, 90))).toBe('W')
  })
})

/* ------------------------------------------------------------ envelope */

describe('the envelope, measured off the cottage', () => {
  const model = computeEnvelope(SCENE, LEVEL.id)

  test('conditioned floor area is the rooms, and the roof is the same footprint', () => {
    // 32' × 46' = 1,472 sf, whether it is summed from the twelve room
    // polygons or read off the slab.
    expect(sqft(model.conditionedFloorSqM)).toBeCloseTo(1472, 1)
    expect(sqft(model.ceilingSqM)).toBeCloseTo(1472, 1)
    expect(model.floorAreaBasis).toBe(
      Object.values(SCENE).some((n) => n.type === 'zone') ? 'zones' : 'slab',
    )
    expect(model.levelHeightM).toBeCloseTo(2.7432, 6)
    // 1,472 sf × 9'-0" = 13,248 cf.
    expect(model.volumeCuM * 35.31466672148859).toBeCloseTo(13248, 0)
  })

  test('gross wall area is the four exterior walls at the level height', () => {
    // 2 × (32' + 46') × 9'-0" = 1,404 sf.
    expect(sqft(model.grossWallSqM)).toBeCloseTo(1404, 1)
    const byFace = Object.fromEntries(
      model.byOrientation.map((entry) => [entry.orientation, entry]),
    )
    expect(byFace.N?.wallCount).toBe(1)
    expect(byFace.E?.wallCount).toBe(1)
    expect(byFace.S?.wallCount).toBe(1)
    expect(byFace.W?.wallCount).toBe(1)
    expect(sqft(byFace.N?.grossWallSqM ?? 0)).toBeCloseTo(288, 1) // 32' × 9'
    expect(sqft(byFace.S?.grossWallSqM ?? 0)).toBeCloseTo(288, 1)
    expect(sqft(byFace.E?.grossWallSqM ?? 0)).toBeCloseTo(414, 1) // 46' × 9'
    expect(sqft(byFace.W?.grossWallSqM ?? 0)).toBeCloseTo(414, 1)
  })

  test('the ten windows and the one exterior door land on the right faces', () => {
    const byFace = Object.fromEntries(
      model.byOrientation.map((entry) => [entry.orientation, entry]),
    )
    // Five windows west, four east, one south; the front door is north.
    expect(sqft(byFace.W?.windowSqM ?? 0)).toBeCloseTo(85.25, 1)
    expect(sqft(byFace.E?.windowSqM ?? 0)).toBeCloseTo(68, 1)
    expect(sqft(byFace.S?.windowSqM ?? 0)).toBeCloseTo(20, 1)
    expect(sqft(byFace.N?.windowSqM ?? 0)).toBeCloseTo(0, 6)
    expect(sqft(byFace.N?.doorSqM ?? 0)).toBeCloseTo(20, 1)

    expect(sqft(model.windowSqM)).toBeCloseTo(173.25, 1)
    expect(sqft(model.doorSqM)).toBeCloseTo(20, 1)
    // Net wall = gross − windows − doors, face by face and in total.
    expect(sqft(model.netWallSqM)).toBeCloseTo(1404 - 173.25 - 20, 1)
    for (const entry of model.byOrientation) {
      expect(entry.netWallSqM).toBeCloseTo(entry.grossWallSqM - entry.windowSqM - entry.doorSqM, 9)
    }
    // Glazing is 173.25 / 1,472 = 11.8 % of the conditioned floor area.
    expect(model.glazingRatio * 100).toBeCloseTo(11.77, 1)
  })

  test('the fenestration schedule carries the window schedule’s marks', () => {
    const marks = new Map<string, string>()
    for (const [i, node] of Object.values(SCENE)
      .filter((n) => n.type === 'window')
      .entries()) {
      marks.set(node.id, `W${i}`)
    }
    const marked = computeEnvelope(SCENE, LEVEL.id, { window: marks })
    expect(marked.fenestration).toHaveLength(10)
    for (const row of marked.fenestration) {
      expect(row.mark).not.toBe('')
      // Nothing in the model carries a rated U-factor, so nothing is invented.
      expect(row.uFactor).toBe('')
      expect(row.shgc).toBe('')
    }
    expect(marked.fenestration.filter((r) => r.orientation === 'W')).toHaveLength(5)
    expect(marked.fenestration.filter((r) => r.orientation === 'E')).toHaveLength(4)
    expect(marked.fenestration.filter((r) => r.orientation === 'S')).toHaveLength(1)
  })

  test('every assumption is returned rather than buried', () => {
    const warnings = model.warnings.join(' ')
    expect(warnings).toContain('no exterior face marked')
    expect(warnings).toContain('PER NFRC LABEL')
    expect(warnings).toContain('north rotation')
  })

  test('an empty scene measures nothing and says why', () => {
    const empty = computeEnvelope({}, undefined)
    expect(empty.conditionedFloorSqM).toBe(0)
    expect(empty.grossWallSqM).toBe(0)
    expect(empty.warnings.join(' ')).toContain('no conditioned floor area')
  })
})

/* -------------------------------------------------------- requirements */

describe('the prescriptive table', () => {
  const j = resolveJurisdiction(SCENE)

  test('names the Florida energy code from the adoption row', () => {
    const code = energyCodeLabel(j)
    expect(code.short).toBe('FBC-EC 2023')
    expect(code.long).toContain('Florida Building Code, Energy Conservation')
  })

  test('prints a value only where this repository can cite it', () => {
    const { rows, zone } = prescriptiveRequirements(j)
    expect(zone).toBe('2A')
    const byComponent = Object.fromEntries(rows.map((row) => [row.component, row]))

    // Citable: ceiling R and wall R from the repo's own data files.
    expect(byComponent['Ceiling / attic']?.value).toBe('R-49')
    expect(byComponent['Ceiling / attic']?.cited).toBe(true)
    expect(byComponent['Wood-frame wall']?.value).toContain('R-13 cavity')
    expect(byComponent['Wood-frame wall']?.source).toContain('IECC Table R402.1.3')
    // Zone 2 is inside the zones 1–3 SHGC maximum the data file cites.
    expect(byComponent['Glazed fenestration SHGC']?.value).toBe('≤ 0.25')
    // the rest of Table R402.1.2 for zone 2: floor R-13, no slab requirement, U 0.40 / 0.65
    expect(byComponent.Floor?.value).toBe('R-13')
    expect(byComponent['Slab edge (R-value / depth)']?.value).toBe('NR (no requirement)')
    expect(byComponent['Fenestration U-factor']?.value).toBe('≤ 0.40')
    expect(byComponent['Skylight U-factor']?.value).toBe('≤ 0.65')

    // Not citable: printed as a blank the reader must fill.
    for (const component of ['Mass wall']) {
      expect(byComponent[component]?.cited).toBe(false)
      expect(byComponent[component]?.value).toBe('per FBC-EC 2023 Table R402.1.2 (verify)')
    }
  })

  test('a state with no climate zone gets no invented values at all', () => {
    const unknown = resolveJurisdiction({})
    const { rows } = prescriptiveRequirements(unknown)
    expect(rows.every((row) => !row.cited)).toBe(true)
    expect(rows[0]?.value).toContain('(verify)')
  })

  test('the compliance path refuses to claim compliance', () => {
    const note = compliancePathNote(j, energyCodeLabel(j)).join(' ')
    expect(note).toContain('NOT COMPUTED BY PASCAL')
    expect(note).toContain('Form R402')
    expect(note).toContain('Form R405')
    expect(note).not.toContain('complies')
  })
})

/* -------------------------------------------------------------- plate */

describe('the EN1.0 plate', () => {
  const drawing = buildEnergyDrawing(SCENE, args())

  test('is a plate only, and says the areas are computed', () => {
    expect(drawing).not.toBeNull()
    expect(drawing?.primitives).toHaveLength(0)
    expect(drawing?.noLabel).toBe(true)
    expect(drawing?.title).toBe('Energy compliance')
    if (process.env.PASCAL_SHEET_SVG) {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(`${OUT_DIR}/notes-energy.svg`, plateToSvg(drawing?.plate ?? [], FIELD), 'utf8')
    }
  })

  test('prints the measured envelope, the climate zone and the fenestration', () => {
    const body = textOf(drawing?.plate)
    expect(body).toContain('ENERGY COMPLIANCE')
    expect(body).toContain('OPAQUE & GLAZED SURFACES BY ORIENTATION')
    expect(body).toContain('CONDITIONED SPACE')
    expect(body).toContain('PRESCRIPTIVE ENVELOPE REQUIREMENTS')
    expect(body).toContain('FENESTRATION SCHEDULE')
    expect(body).toContain('CLIMATE ZONE & DESIGN DATA')
    // Computed numbers, not placeholders.
    expect(body).toContain('1,472 SF') // conditioned floor area
    expect(body).toContain('1,404') // gross exterior wall area
    expect(body).toContain('13,248 CF') // conditioned volume
    expect(body).toContain('11.8 %') // glazing ratio
    expect(body).toContain('2A (1A Miami/Keys)')
    expect(body).toContain('PER NFRC LABEL')
    expect(body).toContain('R-49')
    expect(body).toContain('per FBC-EC 2023 Table R402.1.2 (verify)')
  })

  test('never declares a compliance result', () => {
    const body = textOf(drawing?.plate).toUpperCase()
    expect(body).not.toContain('COMPLIES')
    expect(body).not.toContain('PASS')
    expect(body).toContain('NOT COMPUTED BY PASCAL')
    expect((drawing?.warnings ?? []).join(' ')).toContain('does not run an energy compliance')
  })

  test('fits inside its viewport', () => {
    expect((drawing?.warnings ?? []).join(' ')).not.toContain('taller than this viewport')
  })
})
