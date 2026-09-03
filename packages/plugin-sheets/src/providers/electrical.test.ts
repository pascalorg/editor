import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { FloorplanGeometry } from '@pascal-app/core'
import { nodeRegistry, registerNode } from '@pascal-app/core'
import * as nodes from '@pascal-app/nodes'
import fixture from '../__fixtures__/plancrafters-cottage.json'
import {
  type ProviderArgs,
  registerSheetDrawingProvider,
  resolveViewport,
} from '../drawings'
import type { NodeMap } from '../model'
import type { PlanSetContext } from '../plans/context'
import { mepPlans } from '../plans/mep-set'
import { DEFAULT_VIEWPORT_LAYERS, ViewportNode } from '../schema'
import {
  buildElectricalDrawing,
  capWarnings,
  panelScheduleTable,
  registerElectricalProvider,
  runEnds,
  symbolFor,
} from './electrical'
import { drawingToSvg } from './mep/debug-svg'
import { electricalAppliances } from './mep/items'
import { mepModel, utilitiesMeterAnchor } from './mep/model'

/**
 * The scene is the document, so the tests read the FIXTURE rather than a
 * hand-built scene: 27 walls, 12 doors, 10 windows and a site service point,
 * exported from PlanCrafters. Whatever the fixture grows next (zones, items)
 * the assertions here still hold, because they assert the RULE — one panel,
 * one meter, the meter on the service point — not a count of receptacles that
 * a new interior wall would change.
 */
const SCENE: NodeMap = (fixture as unknown as { graph: { nodes: NodeMap } }).graph.nodes
const LEVEL = Object.values(SCENE).find((n) => n.type === 'level') as NodeMap[string]

const OUT_DIR =
  'C:/Users/steve/AppData/Local/Temp/claude/C--Dev-Pascal/a595fb05-e3d2-4d5c-afdf-c017ab20e61b/scratchpad'

/**
 * `collectSheetGeometry` reads the host's node REGISTRY, which a bare test
 * process has none of — without this the architectural background silently
 * comes back empty and the eyeball SVG shows devices floating in space. The
 * registry is a module singleton shared by every test FILE in the package, so
 * the snapshot is restored afterwards (registry.ts `_snapshot`).
 */
const restoreRegistry = nodeRegistry._snapshot()
for (const definition of [
  nodes.wallDefinition,
  nodes.doorDefinition,
  nodes.windowDefinition,
  nodes.slabDefinition,
  nodes.levelDefinition,
  nodes.zoneDefinition,
]) {
  // Another test file in this process may have registered it already; the
  // registry logs an HMR notice on a re-register, so check first.
  if (!nodeRegistry.get((definition as { kind: string }).kind)) {
    registerNode(definition as never)
  }
}
afterAll(restoreRegistry)

/** Every text mark on a plate, joined — what a reader would see. */
function plateText(plate: readonly FloorplanGeometry[]): string {
  return plate
    .filter((g): g is Extract<FloorplanGeometry, { kind: 'text' }> => g.kind === 'text')
    .map((g) => g.text)
    .join(' ')
}

/** The legend's symbol keys, read back off the label marks' metadata. */
function legendKeysOf(plate: readonly FloorplanGeometry[]): string[] {
  return plate
    .filter((g): g is Extract<FloorplanGeometry, { kind: 'text' }> => g.kind === 'text')
    .map((g) => (g.metadata as { mepLegendKey?: string } | undefined)?.mepLegendKey)
    .filter((k): k is string => typeof k === 'string')
}

function args(overrides: Partial<ProviderArgs> = {}): ProviderArgs {
  return {
    levelId: LEVEL?.id,
    layers: { ...DEFAULT_VIEWPORT_LAYERS, electrical: true, furniture: false },
    viewport: { x: 1, y: 1, w: 20, h: 14, scale: 48 },
    ...overrides,
  }
}

describe('E1.0 derives itself from the scene', () => {
  const drawing = buildElectricalDrawing(SCENE, args())

  test('draws something', () => {
    expect(drawing).not.toBeNull()
    expect(drawing?.primitives.length).toBeGreaterThan(0)
    expect(drawing?.plate?.length ?? 0).toBeGreaterThan(0)
  })

  test('receptacles come out of the 6-ft walk, not a stored list', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    const receptacles = (model?.fixtures ?? []).filter((f) => f.kind.startsWith('receptacle'))
    expect(receptacles.length).toBeGreaterThan(0)
    // Every one lands on a wall of this level, at a mountable height.
    for (const r of receptacles) {
      expect(Number.isFinite(r.position[0])).toBe(true)
      expect(r.position[1]).toBeGreaterThan(0)
      expect(r.position[1]).toBeLessThan(2)
    }
  })

  test('exactly one panel and exactly one meter', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    const electrical = (model?.fixtures ?? []).filter((f) => f.system === 'electrical')
    expect(electrical.filter((f) => f.kind === 'panel')).toHaveLength(1)
    expect(electrical.filter((f) => f.kind === 'electric-meter')).toHaveLength(1)
  })

  test('the meter sits on the site service point', () => {
    const anchor = utilitiesMeterAnchor(SCENE, LEVEL?.id ?? '')
    expect(anchor).not.toBeNull()
    const wall = SCENE[anchor?.wallId ?? ''] as
      | { start: [number, number]; end: [number, number] }
      | undefined
    expect(wall).toBeDefined()
    const t = anchor?.wallT ?? 0
    const spot = [
      (wall?.start[0] ?? 0) + ((wall?.end[0] ?? 0) - (wall?.start[0] ?? 0)) * t,
      (wall?.start[1] ?? 0) + ((wall?.end[1] ?? 0) - (wall?.start[1] ?? 0)) * t,
    ]
    const model = mepModel(SCENE, LEVEL?.id)
    const meter = model?.fixtures.find((f) => f.kind === 'electric-meter')
    expect(meter).toBeDefined()
    // Within 0.15 m: the fixture mounts on the wall FACE, half a wall
    // thickness off the centreline the service point is anchored to.
    const distance = Math.hypot(
      (meter?.position[0] ?? 0) - (spot[0] ?? 0),
      (meter?.position[2] ?? 0) - (spot[1] ?? 0),
    )
    expect(distance).toBeLessThan(0.15)
    // …and the mount height is the service point's own.
    expect(Math.abs((meter?.position[1] ?? 0) - (anchor?.heightAff ?? 0))).toBeLessThan(0.01)
  })

  test('the panel lands beside the meter, not across the house', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    const meter = model?.fixtures.find((f) => f.kind === 'electric-meter')
    const panel = model?.fixtures.find((f) => f.kind === 'panel')
    expect(panel).toBeDefined()
    const distance = Math.hypot(
      (meter?.position[0] ?? 0) - (panel?.position[0] ?? 0),
      (meter?.position[2] ?? 0) - (panel?.position[2] ?? 0),
    )
    // Not a code number — a sanity bound. A panel more than 12 m from its
    // meter means the service chain broke, which is worth failing on.
    expect(distance).toBeLessThan(12)
  })

  test('the panel schedule has rows, and every row is read off a fixture', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    const electrical = (model?.fixtures ?? []).filter((f) => f.system === 'electrical')
    const circuits = new Set(
      electrical
        .map((f) => f.meta?.circuit)
        .filter((c): c is string => typeof c === 'string' && c.length > 0),
    )
    const table = panelScheduleTable(
      [...circuits].map((circuit) => ({
        circuit,
        breakerA: 15,
        gaugeAwg: 14,
        devices: 1,
        va: 180,
        afci: true,
        gfci: false,
      })),
      100,
    )
    expect(table.rows.length).toBeGreaterThan(0)
    expect(table.rows.length).toBe(circuits.size)
    for (const row of table.rows) {
      expect(circuits.has(String(row.circuit))).toBe(true)
      expect(String(row.description).length).toBeGreaterThan(0)
    }
  })

  test('the legend lists every symbol on the drawing, and nothing else', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    const electrical = (model?.fixtures ?? []).filter((f) => f.system === 'electrical')
    const drawnKeys = new Set(
      electrical.map((f) => symbolFor(f)?.key).filter((k): k is string => Boolean(k)),
    )
    // …plus the appliance symbols, which come from placed items rather than
    // from Bones.
    for (const appliance of electricalAppliances(SCENE, LEVEL?.id ?? '').items) {
      drawnKeys.add(appliance.fan ? 'ceiling-fan' : 'appliance')
    }
    expect(drawnKeys.size).toBeGreaterThan(3)
    // Legend rows stamp their symbol key on the label text, so the legend can
    // be read back exactly rather than string-matched.
    const legendKeys = new Set(legendKeysOf(drawing?.plate ?? []))
    expect([...legendKeys].sort()).toEqual([...drawnKeys].sort())
  })

  test('a symbol that is NOT on this level never reaches the legend', () => {
    const legendKeys = new Set(legendKeysOf(drawing?.plate ?? []))
    const model = mepModel(SCENE, LEVEL?.id)
    const kinds = new Set((model?.fixtures ?? []).map((f) => f.kind))
    // The cottage has no attached garage, so Bones places no CO alarm; the
    // legend must not print one.
    expect(kinds.has('co-alarm')).toBe(false)
    expect(legendKeys.has('co-alarm')).toBe(false)
  })

  test('the notes print their citations', () => {
    const notesOnly = buildElectricalDrawing(
      SCENE,
      args({ system: 'notes', viewport: { x: 1, y: 1, w: 7, h: 14, scale: 48 } }),
    )
    const text = plateText(notesOnly?.plate ?? [])
    for (const citation of [
      '210.52',
      '210.8(A)',
      '210.12(A)',
      '406.12',
      'R314',
      'R315',
      '110.26(A)',
      '230.79(C)',
      '230.24(B)',
      '220.41',
    ]) {
      expect(text).toContain(citation)
    }
    // The one requirement not carried by the rules data is flagged, not faked.
    expect(text).toContain('verify:')
  })

  test('the service size printed is the one Bones reports, not an invented 200 A', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    const panel = model?.fixtures.find((f) => f.kind === 'panel')
    const amps = Number(panel?.meta?.minServiceAmps ?? 0)
    expect(amps).toBeGreaterThan(0)
    // On the drawing viewport: the panel schedule's own caption. The caption
    // wraps, so the assertion is on a fragment that survives the wrap.
    expect(plateText(drawing?.plate ?? [])).toContain(`Service ${amps} A minimum (NEC`)
    // In the notes: the citation, and the honest "not a calculated load".
    const notes = buildElectricalDrawing(
      SCENE,
      args({ system: 'notes', viewport: { x: 1, y: 1, w: 7, h: 14, scale: 48 } }),
    )
    const text = plateText(notes?.plate ?? [])
    expect(text).toContain(`${amps} A minimum`)
    expect(text).toContain('230.79(C)')
    expect(text).toContain('not a calculated load')
    expect(text).not.toContain('200 A service')
  })

  test('the engine’s warnings reach the paper', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    for (const warning of (model?.warnings ?? []).slice(0, 3)) {
      // Either printed verbatim, or folded into the "+N further" line.
      const printed =
        (drawing?.warnings ?? []).includes(warning) ||
        (drawing?.warnings ?? []).some((w) => w.startsWith('+'))
      expect(printed).toBe(true)
    }
  })
})

describe('the sheet holds up when the scene does not', () => {
  test('a scene with no walls returns a plate note and does not throw', () => {
    const bare: NodeMap = {
      site_1: { id: 'site_1', type: 'site', parentId: null as unknown as string },
      building_1: { id: 'building_1', type: 'building', parentId: 'site_1', children: ['level_1'] },
      level_1: { id: 'level_1', type: 'level', parentId: 'building_1', level: 0, children: [] },
    }
    const drawing = buildElectricalDrawing(bare, args({ levelId: 'level_1' }))
    expect(drawing).not.toBeNull()
    expect(drawing?.primitives).toHaveLength(0)
    expect((drawing?.plate ?? []).length).toBeGreaterThan(0)
    const text = plateText(drawing?.plate ?? [])
    expect(text).toContain('ELECTRICAL PLAN')
    // The notes still print — the rules do not depend on the geometry.
    expect(text).toContain('210.52')
  })

  test('a scene with no level at all says so', () => {
    const drawing = buildElectricalDrawing({}, args({ levelId: undefined }))
    expect(drawing?.plate?.length ?? 0).toBeGreaterThan(0)
    expect(drawing?.primitives).toHaveLength(0)
  })

  test('a narrow viewport stacks the plates instead of dropping them', () => {
    const narrow = buildElectricalDrawing(SCENE, args({ viewport: { x: 1, y: 1, w: 7, h: 10, scale: 96 } }))
    expect((narrow?.plate ?? []).length).toBeGreaterThan(0)
  })
})

describe('the drawing arithmetic', () => {
  test('a horizontal wire run projects to its two plan ends', () => {
    const ends = runEnds({ position: [0, 0.45, 0], dims: [4, 0.0127, 0.0127], rotation: [0, 0, 0] })
    expect(ends).not.toBeNull()
    expect(ends?.[0]?.[0]).toBeCloseTo(-2, 6)
    expect(ends?.[1]?.[0]).toBeCloseTo(2, 6)
    expect(ends?.[0]?.[1]).toBeCloseTo(0, 6)
  })

  test('a vertical riser projects to a point and is skipped', () => {
    expect(runEnds({ position: [0, 1, 0], dims: [0.0127, 2, 0.0127], rotation: [0, 0, 0] })).toBeNull()
  })

  test('a run rotated 90 deg runs along +z', () => {
    const ends = runEnds({
      position: [1, 0.45, 2],
      dims: [2, 0.0127, 0.0127],
      rotation: [0, -Math.PI / 2, 0],
    })
    expect(ends?.[1]?.[0]).toBeCloseTo(1, 6)
    expect(ends?.[1]?.[1]).toBeCloseTo(3, 6)
  })

  test('warnings past the host’s six fold into a counted line', () => {
    const capped = capWarnings(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(capped).toHaveLength(6)
    expect(capped[5]).toContain('3 further')
  })
})

describe('the sheet the plan-set module lays out', () => {
  const ctx: PlanSetContext = {
    nodes: SCENE,
    frame: { x: 0.5, y: 0.5, w: 31.5, h: 23 },
    gap: 0.5,
    planScale: 48,
    elevationScale: 48,
    levels: [LEVEL as never],
    hasBones: false,
    archScales: [],
    civilScales: [],
  }
  const plans = mepPlans(ctx)

  test('E1.0 and P1.0 are both planned, and E1.0 replaces the generic fallback', () => {
    expect(plans.map((p) => p.number)).toEqual(['E1.0', 'P1.0'])
    // Not `extend` — the generic E1.0 plan viewport is REPLACED, not added to.
    for (const plan of plans) expect(plan.extend).toBeUndefined()
  })

  test('E1.0 carries a drawing viewport and a notes viewport, inside the frame', () => {
    const e1 = plans.find((p) => p.number === 'E1.0')
    const kinds = (e1?.viewports ?? []).map((v) => `${v.kind}:${v.system ?? '-'}`)
    expect(kinds).toEqual(['electrical:plan', 'electrical:notes'])
    for (const vp of e1?.viewports ?? []) {
      expect(vp.x ?? 0).toBeGreaterThanOrEqual(ctx.frame.x)
      expect((vp.x ?? 0) + (vp.w ?? 0)).toBeLessThanOrEqual(ctx.frame.x + ctx.frame.w + 1e-6)
      expect((vp.y ?? 0) + (vp.h ?? 0)).toBeLessThanOrEqual(ctx.frame.y + ctx.frame.h + 1e-6)
    }
  })

  test('P1.0 carries the plan, the notes and the fixture schedule', () => {
    const p1 = plans.find((p) => p.number === 'P1.0')
    const kinds = (p1?.viewports ?? []).map((v) => `${v.kind}:${v.system ?? v.scheduleOf ?? '-'}`)
    expect(kinds).toEqual(['plumbing:plan', 'plumbing:notes', 'schedule:fixtures'])
  })

  test('a scene with no levels plans no MEP sheets', () => {
    expect(mepPlans({ ...ctx, levels: [] })).toEqual([])
  })
})

describe('the whole viewport resolves through the host', () => {
  test('an electrical viewport becomes a live window plus a plate', () => {
    registerElectricalProvider(registerSheetDrawingProvider)
    const vp = ViewportNode.parse({
      sheetId: 'sheet_e1',
      kind: 'electrical',
      system: 'plan',
      levelId: LEVEL?.id,
      scale: 48,
      x: 0.5,
      y: 0.9,
      w: 20,
      h: 14,
      layers: { ...DEFAULT_VIEWPORT_LAYERS, electrical: true, furniture: false },
    })
    const drawn = resolveViewport(vp, { nodes: SCENE })
    expect(drawn.live).not.toBeNull()
    expect(drawn.live?.model).not.toBeNull()
    expect(drawn.plate.length).toBeGreaterThan(0)
    // The window is the viewport's own size in world metres at its scale…
    expect(drawn.live?.view.width ?? 0).toBeCloseTo((20 * 48) / 39.3700787401575, 3)
    // …and the drawing is pushed left of the plate column, so the plates do
    // not sit on top of the plan.
    const buildingCentreX = 0
    const windowCentreX = (drawn.live?.view.x ?? 0) + (drawn.live?.view.width ?? 0) / 2
    expect(windowCentreX).toBeGreaterThan(buildingCentreX)
  })
})

/**
 * The eyeball. Not an assertion — a file to open. Written every run so the
 * drawing can be inspected as it changes.
 */
test('writes an SVG of E1.0 for inspection', () => {
  mkdirSync(OUT_DIR, { recursive: true })
  // The viewport boxes E1.0 actually uses on ARCH D (plans/mep-set.ts).
  const plan = { x: 0.6, y: 1.0, w: 20.5, h: 22.2, scale: 48 }
  const notes = { x: 21.6, y: 1.0, w: 10.4, h: 22.2, scale: 48 }
  const drawing = buildElectricalDrawing(SCENE, args({ system: 'plan', viewport: plan }))
  expect(drawing).not.toBeNull()
  writeFileSync(`${OUT_DIR}/mep-electrical.svg`, drawingToSvg(drawing as never, plan), 'utf8')
  const notesDrawing = buildElectricalDrawing(SCENE, args({ system: 'notes', viewport: notes }))
  writeFileSync(
    `${OUT_DIR}/mep-electrical-notes.svg`,
    drawingToSvg(notesDrawing as never, notes),
    'utf8',
  )
})
