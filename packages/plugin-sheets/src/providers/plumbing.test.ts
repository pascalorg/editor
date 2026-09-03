import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { FloorplanGeometry } from '@pascal-app/core'
import { nodeRegistry, registerNode } from '@pascal-app/core'
import * as nodes from '@pascal-app/nodes'
import fixture from '../__fixtures__/plancrafters-cottage.json'
import type { ProviderArgs } from '../drawings'
import type { NodeMap } from '../model'
import { DEFAULT_VIEWPORT_LAYERS } from '../schema'
import { buildFixtureSchedule, fixtureMarks as scheduleFixtureMarks } from '../schedule-fixtures'
import { itemPlanTransform, placedPlumbingItems, serviceLetters } from './mep/items'
import { drawingToSvg } from './mep/debug-svg'
import { mepModel } from './mep/model'
import { buildPlumbingDrawing, pipeStyle } from './plumbing'

const SCENE: NodeMap = (fixture as unknown as { graph: { nodes: NodeMap } }).graph.nodes
const LEVEL = Object.values(SCENE).find((n) => n.type === 'level') as NodeMap[string]

const OUT_DIR =
  'C:/Users/steve/AppData/Local/Temp/claude/C--Dev-Pascal/a595fb05-e3d2-4d5c-afdf-c017ab20e61b/scratchpad'

/** See the note in electrical.test.ts — the registry is a shared singleton. */
const restoreRegistry = nodeRegistry._snapshot()
for (const definition of [
  nodes.wallDefinition,
  nodes.doorDefinition,
  nodes.windowDefinition,
  nodes.slabDefinition,
  nodes.levelDefinition,
  nodes.zoneDefinition,
]) {
  if (!nodeRegistry.get((definition as { kind: string }).kind)) {
    registerNode(definition as never)
  }
}
afterAll(restoreRegistry)

function plateText(plate: readonly FloorplanGeometry[]): string {
  return plate
    .filter((g): g is Extract<FloorplanGeometry, { kind: 'text' }> => g.kind === 'text')
    .map((g) => g.text)
    .join(' ')
}

function args(overrides: Partial<ProviderArgs> = {}): ProviderArgs {
  return {
    levelId: LEVEL?.id,
    layers: { ...DEFAULT_VIEWPORT_LAYERS, plumbing: true, furniture: false },
    viewport: { x: 1, y: 1, w: 20, h: 14, scale: 48 },
    ...overrides,
  }
}

describe('P1.0 reads the fixtures the user placed', () => {
  const drawing = buildPlumbingDrawing(SCENE, args())
  const placed = placedPlumbingItems(SCENE, LEVEL?.id ?? '')

  test('draws something', () => {
    expect(drawing).not.toBeNull()
    expect(drawing?.primitives.length).toBeGreaterThan(0)
    expect(drawing?.plate?.length ?? 0).toBeGreaterThan(0)
  })

  test('every plumbing-connected item on the level is plotted', () => {
    expect(placed.items.length).toBeGreaterThan(0)
    // Nothing silently dropped: what the scene has, the sheet has or names.
    const plumbingItems = Object.values(SCENE).filter(
      (n) =>
        n?.type === 'item' &&
        ['toilet', 'bathroom-sink', 'shower-square', 'kitchen', 'washing-machine', 'fridge'].includes(
          String((n.asset as { id?: string } | undefined)?.id ?? ''),
        ),
    )
    expect(placed.items.length).toBeGreaterThanOrEqual(plumbingItems.length)
  })

  test('each fixture carries its plumbing key letters', () => {
    for (const item of placed.items) {
      const letters = serviceLetters(item.cls.service)
      expect(letters.length).toBeGreaterThan(0)
      // Waste implies a drain size; a supply-only fixture (an ice maker) has none.
      if (item.cls.service.w) expect(item.cls.drainIn).not.toBeNull()
    }
    const toilet = placed.items.find((i) => i.cls.description === 'Toilet')
    expect(toilet).toBeDefined()
    // A toilet is cold-only: waste and cold, never hot (IRC fixture classes).
    expect(serviceLetters(toilet?.cls.service ?? { w: false, h: false, c: false, g: false, t: false })).toBe('W,C')
    const shower = placed.items.find((i) => i.cls.glyph === 'shower')
    expect(shower).toBeDefined()
    // A shower carries the mixing-valve letter.
    expect(serviceLetters(shower?.cls.service ?? { w: false, h: false, c: false, g: false, t: false })).toContain('T')
  })

  test('the marks on the plan ARE the fixture schedule’s marks', () => {
    // The schedule owns the labels; the plan must not mint its own.
    const scheduled = scheduleFixtureMarks(SCENE, LEVEL?.id ?? '')
    expect(scheduled.size).toBeGreaterThan(0)
    for (const item of placed.items) {
      const fromSchedule = scheduled.get(item.id)
      if (fromSchedule) expect(item.mark).toBe(fromSchedule)
    }
    // Every fixture on this plan is on the schedule — nothing falls back.
    expect(placed.unscheduled).toBe(0)
    // And the marks agree with the printed table, row for row.
    const table = buildFixtureSchedule(SCENE, LEVEL?.id ?? '')
    const marksInTable = new Set(table.rows.map((row) => String(row.mark)))
    for (const item of placed.items) expect(marksInTable.has(item.mark)).toBe(true)
    // Re-deriving gives the same answer.
    const again = placedPlumbingItems(SCENE, LEVEL?.id ?? '')
    expect(again.items.map((i) => `${i.id}:${i.mark}`)).toEqual(
      placed.items.map((i) => `${i.id}:${i.mark}`),
    )
  })

  test('two different fixtures never share a mark', () => {
    const byMark = new Map<string, Set<string>>()
    for (const item of placed.items) {
      const set = byMark.get(item.mark) ?? new Set<string>()
      set.add(item.cls.description)
      byMark.set(item.mark, set)
    }
    for (const [mark, descriptions] of byMark) {
      // A mark may cover several IDENTICAL fixtures (the schedule's QTY
      // column), never two different ones.
      expect({ mark, descriptions: [...descriptions] }).toEqual({
        mark,
        descriptions: [[...descriptions][0] as string],
      })
    }
  })

  test('a wall-hosted item is placed through the wall frame, not at raw coordinates', () => {
    // The scene's electric panel hangs on a wall; the same transform serves
    // every wall-hung fixture. Its plan point must land ON its host wall.
    const panelItem = Object.values(SCENE).find(
      (n) => n?.type === 'item' && String((n.asset as { id?: string } | undefined)?.id) === 'electric-panel',
    )
    expect(panelItem).toBeDefined()
    const transform = itemPlanTransform(SCENE, panelItem as Record<string, unknown>)
    expect(transform).not.toBeNull()
    expect(transform?.wallHosted).toBe(true)
    const wall = SCENE[String(panelItem?.parentId)] as
      | { start: [number, number]; end: [number, number] }
      | undefined
    const distance = distanceToSegment(
      [transform?.x ?? 0, transform?.y ?? 0],
      wall?.start ?? [0, 0],
      wall?.end ?? [0, 0],
    )
    // Within a wall thickness of the wall centreline — i.e. it is ON the wall.
    expect(distance).toBeLessThan(0.4)
  })

  test('the engine’s rough-ins, stack, cleanouts and meter reach the drawing', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    const plumbing = (model?.fixtures ?? []).filter((f) => f.system === 'plumbing')
    expect(plumbing.some((f) => f.kind === 'stub-out')).toBe(true)
    expect(plumbing.some((f) => f.kind === 'cleanout')).toBe(true)
    // The DWV stack is a vertical MEMBER, not a fixture — it has to be
    // drawn from the member or the plan loses its vent through the roof.
    expect((model?.members ?? []).some((m) => m.system === 'plumbing' && m.role === 'vent-stack')).toBe(
      true,
    )
    expect(plumbing.some((f) => f.kind === 'water-meter')).toBe(true)
  })

  test('pipes take their colour from the engine’s own sourceId, not a guess', () => {
    const model = mepModel(SCENE, LEVEL?.id)
    const pipes = (model?.members ?? []).filter((m) => m.system === 'plumbing')
    const keys = new Set(
      pipes.map((m) => pipeStyle(m)?.key).filter((k): k is string => typeof k === 'string'),
    )
    expect(keys.has('cold')).toBe(true)
    expect(keys.has('hot')).toBe(true)
    expect(keys.has('dwv')).toBe(true)
    expect(keys.has('vent')).toBe(true)
  })

  test('the notes print their IRC citations', () => {
    const notes = buildPlumbingDrawing(
      SCENE,
      args({ system: 'notes', viewport: { x: 1, y: 1, w: 7, h: 14, scale: 48 } }),
    )
    const text = plateText(notes?.plate ?? [])
    for (const citation of [
      'P3005.3',
      'P2705.1',
      'P2708.1',
      'P2801.6',
      'P2803.1',
      'P2801.8',
      'P2603.2.1',
      'P2903.7',
      'P3105.1',
      'P3005.2',
    ]) {
      expect(text).toContain(citation)
    }
    // What the data does not carry is flagged, never faked.
    expect(text).toContain('verify:')
    // The key is on the notes plate too — and it claims only the letters
    // this level's fixtures actually carry.
    expect(text).toContain('Hot water from the water heater')
    expect(text).not.toContain('Gas supply')
  })

  test('the key lists only letters that are on the drawing', () => {
    const text = plateText(drawing?.plate ?? [])
    const used = new Set(placed.items.flatMap((i) => serviceLetters(i.cls.service).split(',')))
    expect(used.has('W')).toBe(true)
    // No gas appliance is placed in this scene, so G must not be claimed.
    expect(used.has('G')).toBe(false)
    expect(text).not.toContain('Gas supply')
  })
})

describe('the sheet holds up when the scene does not', () => {
  test('a scene with no fixtures returns a plate note and does not throw', () => {
    const bare: NodeMap = {
      site_1: { id: 'site_1', type: 'site', parentId: null as unknown as string },
      building_1: { id: 'building_1', type: 'building', parentId: 'site_1', children: ['level_1'] },
      level_1: { id: 'level_1', type: 'level', parentId: 'building_1', level: 0, children: [] },
    }
    const drawing = buildPlumbingDrawing(bare, args({ levelId: 'level_1' }))
    expect(drawing).not.toBeNull()
    expect(drawing?.primitives).toHaveLength(0)
    const text = plateText(drawing?.plate ?? [])
    expect(text).toContain('PLUMBING PLAN')
    expect(text).toContain('P3005.3')
  })

  test('a scene with no level at all says so', () => {
    const drawing = buildPlumbingDrawing({}, args({ levelId: undefined }))
    expect(drawing?.plate?.length ?? 0).toBeGreaterThan(0)
    expect(drawing?.primitives).toHaveLength(0)
  })

  test('an item hosted on a frame this mirror cannot resolve is named, not dropped', () => {
    const scene: NodeMap = {
      level_1: { id: 'level_1', type: 'level', parentId: 'b', level: 0, children: [] },
      shelf_1: { id: 'shelf_1', type: 'shelf', parentId: 'level_1', position: [0, 0, 0] },
      item_1: {
        id: 'item_1',
        type: 'item',
        parentId: 'shelf_1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        asset: { id: 'bathroom-sink', category: 'bathroom', name: 'Basin', dimensions: [0.5, 0.8, 0.4] },
      },
    }
    const { items, skipped } = placedPlumbingItems(scene, 'level_1')
    expect(items).toHaveLength(0)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toContain('Basin')
  })
})

function distanceToSegment(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** The eyeball — see electrical.test.ts. */
test('writes an SVG of P1.0 for inspection', () => {
  mkdirSync(OUT_DIR, { recursive: true })
  const plan = { x: 0.6, y: 1.0, w: 20.5, h: 22.2, scale: 48 }
  const notes = { x: 21.6, y: 1.0, w: 10.4, h: 12.4, scale: 48 }
  const drawing = buildPlumbingDrawing(SCENE, args({ system: 'plan', viewport: plan }))
  expect(drawing).not.toBeNull()
  writeFileSync(`${OUT_DIR}/mep-plumbing.svg`, drawingToSvg(drawing as never, plan), 'utf8')
  const notesDrawing = buildPlumbingDrawing(SCENE, args({ system: 'notes', viewport: notes }))
  writeFileSync(
    `${OUT_DIR}/mep-plumbing-notes.svg`,
    drawingToSvg(notesDrawing as never, notes),
    'utf8',
  )
})
