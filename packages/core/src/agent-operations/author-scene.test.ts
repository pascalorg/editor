import { describe, expect, test } from 'bun:test'
import type { AuthorScenePayload } from '../agent-tools/author-scene'
import { authorScenePayload } from '../agent-tools/author-scene'
import { cloneNodesInto } from '../registry/subtree'
import type { AnyNode, CompiledGeometryScript, SceneMaterial } from '../schema'
import { CEILING_DRAW_OFFSET, resolveCeilingHeight } from '../services'
import {
  applySceneChanges,
  authorScene,
  authorSceneCeilingPoints,
  authorSceneFaceScripts,
  authorSceneFloorScripts,
} from './index'

/** A site, a building and the empty level a new project starts with. */
function scaffold(): Record<string, AnyNode> {
  return {
    site_1: {
      id: 'site_1',
      object: 'node',
      type: 'site',
      name: 'Site',
      parentId: null,
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      children: ['building_1'],
    } as unknown as AnyNode,
    building_1: {
      id: 'building_1',
      object: 'node',
      type: 'building',
      name: 'Building',
      parentId: 'site_1',
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      children: ['level_0'],
    } as unknown as AnyNode,
    level_0: {
      id: 'level_0',
      object: 'node',
      type: 'level',
      name: 'Level 0',
      parentId: 'building_1',
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      level: 0,
      children: [],
    } as unknown as AnyNode,
  }
}

/** What a host's compile of a 1.6 × 0.5 × 2 m box returns. */
const bed: CompiledGeometryScript = {
  sha256: 'a'.repeat(64),
  script: 'b'.repeat(64),
  language: 'three',
  mount: 'floor',
  params: {},
  manifest: {
    bounds: { min: [-0.8, 0, -1], max: [0.8, 0.5, 1] },
    parts: [],
    slots: [{ id: 'wood', color: '#8a6a4a' }],
    lights: [],
    animations: [],
    params: [],
    triangles: 12,
    cutout: false,
    surfaces: [],
  } as unknown as CompiledGeometryScript['manifest'],
}

/** A host's compile of a 1 × 2.1 m door module, mount 'wall'. */
const arch: CompiledGeometryScript = {
  ...bed,
  mount: 'wall',
  manifest: {
    ...bed.manifest,
    bounds: { min: [-0.5, 0, -0.1], max: [0.5, 2.1, 0.1] },
    slots: [{ id: 'wood', color: '#8a6a4a' }],
    cutout: true,
  } as unknown as CompiledGeometryScript['manifest'],
}

/** A host's compile of a baseboard, 2 m long, 12 cm high, 1.5 cm deep. */
const baseboard: CompiledGeometryScript = {
  ...bed,
  manifest: {
    ...bed.manifest,
    bounds: { min: [-1, 0, -0.0075], max: [1, 0.12, 0.0075] },
  } as unknown as CompiledGeometryScript['manifest'],
}

const run = (
  payload: AuthorScenePayload,
  compiled: Record<string, CompiledGeometryScript>,
  materials?: Record<string, SceneMaterial>,
) =>
  authorScene(
    scaffold(),
    { payload, compiled },
    { activeLevelId: 'level_0', ...(materials ? { materials } : {}) },
  )

const nodesOf = (outcome: ReturnType<typeof authorScene>) =>
  outcome.changes!.create!.map((c) => c.node)
/** The scene once the outcome is applied, as the host reads it. */
const sceneOf = (outcome: ReturnType<typeof authorScene>) => ({
  ...scaffold(),
  ...Object.fromEntries(nodesOf(outcome).map((n) => [n.id, n])),
})
const byAuthorId = (outcome: ReturnType<typeof authorScene>, id: string) =>
  nodesOf(outcome).find((n) => n.id === outcome.result.ids[id]) as AnyNode & Record<string, any>

const bedroom: AuthorScenePayload = authorScenePayload.parse({
  levels: [
    {
      name: 'Ground floor',
      walls: [
        {
          id: 'north',
          start: [-2, -2.5],
          end: [2, -2.5],
          height: 2.7,
          thickness: 0.12,
          color: '#f1ece4',
        },
        {
          id: 'east',
          start: [2, -2.5],
          end: [2, 2.5],
          height: 2.7,
          thickness: 0.12,
          openings: [{ kind: 'window', along: 2.5, width: 1.4, height: 1.3, sill: 0.9 }],
        },
        {
          id: 'south',
          start: [2, 2.5],
          end: [-2, 2.5],
          height: 2.7,
          thickness: 0.12,
          openings: [
            { kind: 'door', along: 1.2, width: 0.9, height: 2.1, hinge: 'start', swing: 'front' },
          ],
        },
        // Ends 10 cm short of the north wall: the join rule closes the room.
        { id: 'west', start: [-2, 2.5], end: [-2, -2.4], height: 2.7, thickness: 0.12 },
      ],
      rooms: [{ name: 'Bedroom', seed: [0, 0], floor: 'library:wood-floorplank1' }],
      items: [
        {
          id: 'bed',
          name: 'Bed',
          category: 'bed',
          code: 'export default function build() {}',
          position: [0, 0, -1],
        },
        {
          id: 'lamp',
          name: 'Lamp',
          category: 'lamp',
          code: 'export default function build() {}',
          position: [1.2, 0.5, -2],
          host: 'bed',
        },
      ],
      lights: [
        { position: [1.2, 1.1, -2], fixture: 'lamp' },
        { position: [0, 2.5, 1], fixture: 'bed' },
      ],
    },
  ],
  notes: ['The rug was left out.'],
})

describe('author_scene', () => {
  test('repeated wall ids across storeys refuse before replacing any scene nodes', () => {
    const scene = scaffold()
    const before = structuredClone(scene)
    const payload = authorScenePayload.parse({
      levels: [bedroom.levels[0], { ...bedroom.levels[0], name: 'Upper floor', elevation: 2.8 }],
    })
    expect(() =>
      authorScene(scene, { payload, compiled: { bed, lamp: bed } }, { activeLevelId: null }),
    ).toThrow('Source id')
    expect(scene).toEqual(before)
  })

  test('item ids cannot overwrite another item or a generated source mapping', () => {
    for (const id of ['bed', 'room/0/0']) {
      const scene = scaffold()
      const before = structuredClone(scene)
      const payload = structuredClone(bedroom)
      payload.levels[0]!.items!.push({ ...payload.levels[0]!.items![0]!, id })
      expect(() =>
        authorScene(scene, { payload, compiled: { bed, lamp: bed } }, { activeLevelId: null }),
      ).toThrow('Source id')
      expect(scene).toEqual(before)
    }
  })

  test('a copied baseline cannot authorize replacement of another building', () => {
    const first = run(bedroom, { bed, lamp: bed })
    const saved = applySceneChanges(scaffold(), first.changes)
    const copied = cloneNodesInto(
      Object.values(saved).filter((node) => node.type !== 'site'),
      {
        rootId: 'building_1',
        parentId: 'site_1',
      },
    )
    const nodes = { ...saved, ...Object.fromEntries(copied.nodes.map((node) => [node.id, node])) }
    expect(() =>
      authorScene(
        nodes,
        {
          payload: bedroom,
          compiled: { bed, lamp: bed },
          buildingId: copied.root.id,
          replace: true,
        },
        { activeLevelId: null },
      ),
    ).toThrow()
    expect(nodes.building_1).toEqual(saved.building_1)
  })
  test('an existing building and unrelated buildings are never erased on a first conversion', () => {
    const scene = scaffold()
    const first = run(bedroom, { bed, lamp: bed })
    const authored = applySceneChanges(scene, first.changes)
    const foreign = Object.fromEntries(
      Object.entries(authored).map(([id, node]) => [
        `other_${id}`,
        {
          ...node,
          id: `other_${id}`,
          parentId: node.parentId ? `other_${node.parentId}` : null,
          ...('children' in node ? { children: node.children.map((id) => `other_${id}`) } : {}),
        },
      ]),
    ) as Record<string, AnyNode>
    const combined = { ...scene, ...foreign }
    const outcome = authorScene(
      combined,
      { payload: bedroom, compiled: { bed, lamp: bed } },
      { activeLevelId: 'level_0' },
    )
    const saved = applySceneChanges(combined, outcome.changes)
    for (const [id, node] of Object.entries(foreign)) expect(saved[id]).toEqual(node)
    const manual = { ...authored, building_1: { ...authored.building_1!, metadata: {} } }
    expect(() =>
      authorScene(
        manual,
        { payload: bedroom, compiled: { bed, lamp: bed }, replace: true },
        { activeLevelId: null },
      ),
    ).toThrow()
  })

  test('regeneration keeps a manual move, an added object and a deleted object, and refuses an overlapping move', () => {
    const first = run(bedroom, { bed, lamp: bed })
    const saved = applySceneChanges(scaffold(), first.changes)
    const bedId = first.result.ids.bed!
    const lampId = first.result.ids.lamp!
    const moved = { ...saved[bedId]!, position: [0.4, 0, -1] } as AnyNode
    const manual = applySceneChanges(saved, {
      update: [{ id: bedId, data: moved }],
      delete: [lampId],
      create: [
        {
          node: {
            ...saved[bedId],
            id: 'item_manual',
            children: [],
            parentId: first.result.ids['level/0'],
          } as AnyNode,
        },
      ],
    })
    const repeat = authorScene(
      manual,
      { payload: bedroom, compiled: { bed, lamp: bed }, replace: true },
      { activeLevelId: null },
    )
    const after = applySceneChanges(manual, repeat.changes)
    expect(after[bedId]).toEqual(manual[bedId])
    expect(after.item_manual).toEqual(manual.item_manual)
    expect(after[lampId]).toBeUndefined()
    const changed = structuredClone(bedroom)
    changed.levels[0]!.items![0]!.position = [0.8, 0, -1]
    expect(() =>
      authorScene(
        manual,
        { payload: changed, compiled: { bed, lamp: bed }, replace: true },
        { activeLevelId: null },
      ),
    ).toThrow()
  })

  test('writes the design as native nodes and reports what it did', () => {
    const outcome = authorScene(
      scaffold(),
      { payload: bedroom, compiled: { bed, lamp: bed } },
      { activeLevelId: 'level_0' },
    )
    const r = outcome.result
    expect(r.levels).toBe(1)
    expect(r.walls).toBe(4)
    expect(r.doors).toBe(1)
    expect(r.windows).toBe(1)
    expect(r.rooms).toBe(1)
    expect(r.roomsNamed).toBe(1)
    expect(r.items).toBe(2)
    expect(r.lights).toBe(2)
    expect(r.defects).toEqual([])
    expect(r.snapped).toEqual([{ id: 'west', end: 'end', movedM: 0.1 }])
    expect(r.notes).toContain('The rug was left out.')
    expect(outcome.changes?.delete).toEqual(['level_0'])
    const created = outcome.changes!.create!.map((c) => c.node)
    const byType = (t: string) => created.filter((n) => n.type === t)
    expect(byType('level')).toHaveLength(1)
    expect(byType('wall')).toHaveLength(4)
    // Each wall knows which face looks into the room, from the plan: never both the same.
    for (const wall of byType('wall') as Array<AnyNode & { frontSide: string; backSide: string }>)
      expect([wall.frontSide, wall.backSide].sort()).toEqual(['exterior', 'interior'])
    expect(byType('zone')).toHaveLength(1)
    const zone = byType('zone')[0] as AnyNode & { name: string; floor?: { finish?: string } }
    expect(zone.name).toBe('Bedroom')
    expect(zone.floor?.finish).toBe('library:wood-floorplank1')
    // The room got a floor plate from the structure reconcile.
    expect(byType('slab').length).toBeGreaterThan(0)
    const lamp = byType('item').find((n) => (n as { name?: string }).name === 'Lamp') as AnyNode & {
      parentId: string
      interactive?: { effects: unknown[] }
    }
    const bedNode = byType('item').find((n) => (n as { name?: string }).name === 'Bed')!
    expect(lamp.parentId).toBe(bedNode.id)
    expect(
      (lamp as unknown as { asset: { interactive?: { effects: unknown[] } } }).asset.interactive
        ?.effects,
    ).toHaveLength(1)
    expect(r.ids.bed).toBe(bedNode.id)
    const painted = byType('wall').find(
      (w) =>
        (w as { metadata: { authorScene: { id: string } } }).metadata.authorScene.id === 'north',
    ) as AnyNode & { slots?: Record<string, string> }
    expect(Object.keys(painted.slots ?? {}).length).toBeGreaterThan(0)
  })

  test('a light without a fixture gets a flush authored ceiling point in its room, with its effect', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [{ position: [0.5, 2.4, -0.75], color: '#ffeedd', intensity: 2 }],
        },
      ],
    })
    const points = authorSceneCeilingPoints(payload)
    expect(points.map((point) => point.id)).toEqual(['light/0/0'])
    const compiled = {
      ...bed,
      mount: 'ceiling',
      manifest: { ...bed.manifest, bounds: { min: [-0.03, -0.008, -0.03], max: [0.03, 0, 0.03] } },
    } as CompiledGeometryScript
    const outcome = run(payload, { [points[0]!.id]: compiled }, {})
    expect(outcome.result.defects).toEqual([])
    expect(outcome.result.lights).toBe(1)
    expect(outcome.result.items).toBe(1)
    expect(outcome.result.defaults).toContain(
      'light at [0.5, 2.4, -0.75] has no fixture: a ceiling point in Bedroom',
    )
    const point = byAuthorId(outcome, 'light/0/0')
    const ceiling = nodesOf(outcome).find((node) => node.id === point.parentId)!
    expect(ceiling.type).toBe('ceiling')
    expect((ceiling as { zoneId?: string }).zoneId).toBe(outcome.result.ids['room/0/0'])
    expect((ceiling as { children?: string[] }).children).toContain(point.id)
    expect(point.asset.category).toBe('light')
    expect(point.asset.attachTo).toBe('ceiling')
    expect(point.position).toEqual([0.5, 0, -0.75])
    expect(point.asset.interactive.controls).toContainEqual({
      kind: 'toggle',
      label: 'Lights',
      default: true,
    })
    expect(point.asset.interactive.effects).toEqual([
      {
        kind: 'light',
        color: '#ffeedd',
        intensityRange: [0, 2],
        offset: [0, expect.any(Number), 0],
      },
    ])
    expect(point.asset.interactive.effects[0].offset[1]).toBeCloseTo(
      2.4 -
        resolveCeilingHeight(
          ceiling as never,
          Object.fromEntries(nodesOf(outcome).map((n) => [n.id, n])),
        ) +
        CEILING_DRAW_OFFSET,
      9,
    )
    expect(authorSceneCeilingPoints(bedroom)).toEqual([])
  })

  test('a light outside any room falls back to the nearest item on its own level and says why', () => {
    const payload = authorScenePayload.parse({
      levels: [
        {
          name: 'Lower',
          items: [
            {
              id: 'lower',
              name: 'Lower bed',
              category: 'bed',
              code: '// bed',
              position: [0, 0, 0],
            },
          ],
        },
        {
          name: 'Upper',
          items: [
            {
              id: 'upper',
              name: 'Upper bed',
              category: 'bed',
              code: '// bed',
              position: [3, 0, 0],
            },
          ],
          lights: [{ position: [0, 2, 0] }],
        },
      ],
    })
    const outcome = run(payload, { lower: bed, upper: bed }, {})
    expect(outcome.result.lights).toBe(1)
    expect(outcome.result.defects).toEqual([])
    expect(byAuthorId(outcome, 'lower').asset.interactive).toBeUndefined()
    expect(byAuthorId(outcome, 'upper').asset.interactive.effects).toEqual([
      { kind: 'light', color: '#ffffff', intensityRange: [0, 1], offset: [-3, 2, 0] },
    ])
    expect(outcome.result.defaults).toContain(
      'light at [0, 2, 0] has no fixture: no room contains its point; hosted on the nearest item upper (3.00 m away); moving that item moves the light',
    )
  })

  test('a ceiling point whose module failed is reported by the light id', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [{ ...bedroom.levels[0], items: [], lights: [{ position: [0, 2.4, 0] }] }],
    })
    const outcome = authorScene(
      scaffold(),
      { payload, compiled: {}, compileErrors: { 'light/0/0': 'Compiler unavailable' } },
      { activeLevelId: null, materials: {} },
    )
    expect(outcome.result.lights).toBe(0)
    expect(outcome.result.defects).toEqual([
      { id: 'light/0/0', code: 'compile_failed', message: 'Compiler unavailable' },
    ])
  })

  test('the same payload writes the same ids', () => {
    const a = authorScene(
      scaffold(),
      { payload: bedroom, compiled: { bed, lamp: bed } },
      { activeLevelId: 'level_0' },
    )
    const b = authorScene(
      scaffold(),
      { payload: bedroom, compiled: { bed, lamp: bed } },
      { activeLevelId: 'level_0' },
    )
    expect(a.changes!.create!.map((c) => c.node.id)).toEqual(
      b.changes!.create!.map((c) => c.node.id),
    )
  })

  test('a failed compile and a missing host are reported, not dropped silently', () => {
    const outcome = authorScene(
      scaffold(),
      { payload: bedroom, compiled: { bed }, compileErrors: { lamp: 'Unsupported import' } },
      { activeLevelId: 'level_0' },
    )
    expect(outcome.result.items).toBe(1)
    expect(outcome.result.defects.map((d) => d.code)).toEqual(['compile_failed'])
  })

  test('refuses to write over a conversion unless told to', () => {
    const first = authorScene(
      scaffold(),
      { payload: bedroom, compiled: { bed, lamp: bed } },
      { activeLevelId: 'level_0' },
    )
    const scene = applySceneChanges(scaffold(), first.changes)
    expect(() =>
      authorScene(
        scene,
        { payload: bedroom, compiled: { bed, lamp: bed } },
        { activeLevelId: null },
      ),
    ).toThrow()
    const again = authorScene(
      scene,
      { payload: bedroom, compiled: { bed, lamp: bed }, replace: true },
      { activeLevelId: null },
    )
    expect(again.result.walls).toBe(4)
    expect(again.result.ids).toEqual(first.result.ids)
    expect(again.changes!.create).toEqual([])
    expect(again.changes!.delete).toEqual([])
    expect(applySceneChanges(scene, again.changes)).toEqual(scene)
  })

  test('an opening takes its type, style, leaves and a handle opposite the hinge', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          walls: bedroom.levels[0]!.walls!.map((w) =>
            w.id === 'south'
              ? {
                  ...w,
                  openings: [
                    {
                      kind: 'door',
                      along: 1.2,
                      width: 1.5,
                      height: 2.1,
                      type: 'french',
                      style: 'modern',
                      hinge: 'end',
                    },
                    { kind: 'door', along: 3, width: 0.9, height: 2.1, leaves: 2 },
                  ],
                }
              : w.id === 'east'
                ? {
                    ...w,
                    openings: [
                      {
                        kind: 'window',
                        along: 1.2,
                        width: 1,
                        height: 1.2,
                        sill: 0.9,
                        type: 'casement',
                        style: 'grid',
                      },
                      {
                        kind: 'window',
                        along: 3.5,
                        width: 1,
                        height: 1.2,
                        sill: 0.9,
                        style: 'grid',
                      },
                    ],
                  }
                : w,
          ),
        },
      ],
    })
    const outcome = run(payload, {})
    const r = outcome.result
    expect(r.defects).toEqual([])
    const french = byAuthorId(outcome, 'south/0')
    expect(french.doorType).toBe('french')
    expect(french.leafCount).toBe(2)
    expect(french.hingesSide).toBe('right')
    expect(french.handleSide).toBe('left')
    // The style's leaf over the type's: a modern French door is one flush slab.
    expect(french.segments).toHaveLength(1)
    expect(byAuthorId(outcome, 'south/1').leafCount).toBe(2)
    expect(byAuthorId(outcome, 'south/1').handleSide).toBe('right')
    const casement = byAuthorId(outcome, 'east/0')
    expect(casement.windowType).toBe('casement')
    expect(casement.columnRatios).toEqual([1])
    const grid = byAuthorId(outcome, 'east/1')
    expect(grid.windowType).toBe('fixed')
    expect(grid.columnRatios).toEqual([0.5, 0.5])
    expect(r.defaults).toContain('door south/0: handle set opposite the hinge (left)')
    expect(r.defaults).toContain(
      'window east/0: style grid dropped, a casement window draws its own sashes',
    )
    expect(r.defaults).toContain('1 window has no type: written fixed (cannot open); give type')
  })

  test('an opening with code is the scripted door or window add_door writes, by its own id', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          walls: bedroom.levels[0]!.walls!.map((w) =>
            w.id === 'south'
              ? {
                  ...w,
                  openings: [
                    { kind: 'door', along: 1, width: 0.9, height: 2.1, code: '// arch' },
                    { kind: 'window', along: 3, width: 0.9, height: 1, code: '// round' },
                  ],
                }
              : w,
          ),
        },
      ],
    })
    const outcome = authorScene(
      scaffold(),
      { payload, compiled: { 'south/0': arch }, compileErrors: { 'south/1': 'Syntax error' } },
      { activeLevelId: 'level_0', materials: {} },
    )
    const door = byAuthorId(outcome, 'south/0')
    expect(door.source.kind).toBe('script')
    expect(door.source.artifact).toBe(arch.sha256)
    expect(door.slots.wood).toStartWith('scene:')
    expect([door.width, door.height]).toEqual([1, 2.1])
    expect(outcome.result.defects).toEqual([
      { id: 'south/1', code: 'compile_failed', message: 'Syntax error' },
    ])
    expect(outcome.result.windows).toBe(1)
  })

  test('authored slot colours stay exact and share materials with walls; unhinted slots keep their default', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          lights: [],
          items: [bedroom.levels[0]!.items![0]],
        },
      ],
    })
    const compiled = {
      ...bed,
      manifest: {
        ...bed.manifest,
        slots: [
          { id: 'wood', color: '#8a6a4a' },
          { id: 'book', color: '#ff0000' },
          { id: 'rod', color: '#000000' },
          { id: 'curtain', color: '#f1ece4' },
          { id: 'unhinted' },
        ],
      },
    } as CompiledGeometryScript
    const outcome = run(payload, { bed: compiled }, {})
    const item = byAuthorId(outcome, 'bed')
    const materials = outcome.changes!.materials!
    for (const slot of compiled.manifest.slots.filter((s) => s.color)) {
      const material = materials.find((m) => `scene:${m.id}` === item.slots[slot.id])!
      expect(material.material.properties.color).toBe(slot.color!)
    }
    expect(item.slots.curtain).toBe(byAuthorId(outcome, 'north').slots.a)
    expect(item.slots.unhinted).toBeUndefined()
    expect(outcome.result.defaults.some((s) => s.includes('colour'))).toBe(false)
    expect(outcome.result.defects).toEqual([])
  })

  // The living room's glazed balcony door and the house's casements and privacy glass (opacity
  // 0.64, under the compiler's transparent cut-off but named glass) rendered opaque once exact.
  test('a glass slot, by its name or a transparent hint, stays glass on items, scripted doors and scripted windows', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          lights: [],
          items: [bedroom.levels[0]!.items![0]],
          walls: bedroom.levels[0]!.walls!.map((w) =>
            w.id === 'south'
              ? {
                  ...w,
                  openings: [
                    {
                      kind: 'door',
                      along: 1,
                      width: 1,
                      height: 2.1,
                      code: '// glazed leaves',
                      color: '#f5f4ef',
                    },
                    {
                      kind: 'window',
                      along: 3,
                      width: 0.9,
                      height: 1.2,
                      sill: 0.9,
                      code: '// casement',
                    },
                  ],
                }
              : w,
          ),
        },
      ],
    })
    const withSlots = (base: CompiledGeometryScript, slots: object[]) =>
      ({ ...base, manifest: { ...base.manifest, slots } }) as CompiledGeometryScript
    const casement = {
      ...arch,
      manifest: { ...arch.manifest, bounds: { min: [-0.45, 0, -0.1], max: [0.45, 1.2, 0.1] } },
    } as CompiledGeometryScript
    const outcome = run(
      payload,
      {
        bed: withSlots(bed, [
          { id: 'glass', color: '#d8e4dc', roughness: 0.55, metalness: 0, transparent: false },
          { id: 'pane', color: '#bfd6d3', roughness: 0.12, metalness: 0, transparent: true },
          { id: 'wood', color: '#8a6a4a' },
        ]),
        'south/0': withSlots(arch, [
          { id: 'glass', color: '#bfd6d3', roughness: 0.12, metalness: 0, transparent: true },
          { id: 'f5f4ef', color: '#f5f4ef' },
        ]),
        'south/1': withSlots(casement, [
          { id: 'frame', color: '#f1ece4' },
          { id: 'glass', color: '#bfd6d3', roughness: 0.12, metalness: 0, transparent: true },
        ]),
      },
      {},
    )
    expect(outcome.result.defects).toEqual([])
    const item = byAuthorId(outcome, 'bed')
    const door = byAuthorId(outcome, 'south/0')
    const window = byAuthorId(outcome, 'south/1')
    expect(item.slots.glass).toBe('library:preset-glass')
    expect(item.slots.pane).toBe('library:preset-glass')
    expect(door.slots.glass).toBe('library:preset-glass')
    expect(window.slots.glass).toBe('library:preset-glass')
    expect([item.slots.wood, door.slots.f5f4ef, window.slots.frame]).toEqual([
      expect.stringMatching(/^scene:/),
      expect.stringMatching(/^scene:/),
      expect.stringMatching(/^scene:/),
    ])
    const colours = outcome.changes!.materials!.map((m) => m.material.properties!.color)
    expect(colours).not.toContain('#bfd6d3')
    expect(colours).not.toContain('#d8e4dc')
    expect(outcome.changes!.materials!.every((m) => !m.material.properties!.transparent)).toBe(true)
  })

  test("an exact slot keeps its module's roughness and metalness, one material per colour and surface", () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [{ ...bedroom.levels[0], lights: [], items: [bedroom.levels[0]!.items![0]] }],
    })
    const compiled = {
      ...bed,
      manifest: {
        ...bed.manifest,
        slots: [
          { id: 'brass', color: '#ba9860', roughness: 0.34, metalness: 0.72 },
          { id: 'oak', color: '#8a6a4a', roughness: 1, metalness: 0 },
          { id: 'oakSatin', color: '#8a6a4a', roughness: 0.4, metalness: 0 },
          { id: 'oakTwin', color: '#8a6a4a', roughness: 1, metalness: 0 },
          { id: 'plain', color: '#f1ece4' },
        ],
      },
    } as CompiledGeometryScript
    const outcome = run(payload, { bed: compiled }, {})
    const item = byAuthorId(outcome, 'bed')
    const material = (ref: string) =>
      outcome.changes!.materials!.find((m) => `scene:${m.id}` === ref)!
    expect(material(item.slots.brass)).toMatchObject({
      name: '#ba9860, roughness 0.34, metalness 0.72',
      material: { properties: { color: '#ba9860', roughness: 0.34, metalness: 0.72 } },
    })
    expect(material(item.slots.oak).material.properties).toMatchObject({
      roughness: 1,
      metalness: 0,
    })
    expect(material(item.slots.oakSatin).material.properties).toMatchObject({ roughness: 0.4 })
    expect(item.slots.oak).not.toBe(item.slots.oakSatin)
    expect(item.slots.oakTwin).toBe(item.slots.oak)
    // No hint: the matte paint a payload colour gets, shared with the wall in that colour.
    expect(material(item.slots.plain).material.properties).toMatchObject({
      roughness: 0.9,
      metalness: 0,
    })
    expect(item.slots.plain).toBe(byAuthorId(outcome, 'north').slots.a)
  })

  // A scene material has no emission: an emissive slot keeps the module's own material.
  test("a bulb's emissive slot keeps the module's lit material and its fixture keeps the light", () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [
            {
              id: 'pendant',
              name: 'Pendant',
              category: 'lamp',
              code: 'export default function build() {}',
              position: [0, 2, 0],
            },
          ],
          lights: [{ position: [0, 2.1, 0], fixture: 'pendant', color: '#ffd27a', intensity: 1.5 }],
        },
      ],
    })
    const pendant = {
      ...bed,
      manifest: {
        ...bed.manifest,
        bounds: { min: [-0.1, 0, -0.1], max: [0.1, 0.3, 0.1] },
        slots: [
          { id: 'filament', color: '#ffd27a', roughness: 0.4, metalness: 0, emissive: true },
          { id: 'cord', color: '#222222', roughness: 0.5, metalness: 0 },
        ],
      },
    } as CompiledGeometryScript
    const outcome = run(payload, { pendant }, {})
    expect(outcome.result.defects).toEqual([])
    const item = byAuthorId(outcome, 'pendant')
    expect(item.slots.filament).toBeUndefined()
    expect(item.slots.cord).toStartWith('scene:')
    expect(
      item.source.manifest.slots.find((s: { id: string }) => s.id === 'filament').emissive,
    ).toBe(true)
    expect(outcome.changes!.materials!.map((m) => m.material.properties!.color)).not.toContain(
      '#ffd27a',
    )
    expect(item.asset.interactive.effects).toEqual([
      expect.objectContaining({ kind: 'light', color: '#ffd27a', intensityRange: [0, 1.5] }),
    ])
  })

  test('opening colours paint panel and frame exactly, with an optional different frame', () => {
    const payload = authorScenePayload.parse({
      levels: [
        {
          name: 'Ground',
          walls: [
            {
              id: 'wall',
              start: [0, 0],
              end: [8, 0],
              height: 3,
              thickness: 0.2,
              openings: [
                { kind: 'door', along: 1, width: 1, height: 2, color: '#123456' },
                {
                  kind: 'door',
                  along: 3,
                  width: 1,
                  height: 2,
                  color: '#123456',
                  frameColor: '#abcdef',
                },
                { kind: 'window', along: 5, width: 1, height: 1, color: '#123456' },
                {
                  kind: 'window',
                  along: 7,
                  width: 1,
                  height: 1,
                  color: '#123456',
                  frameColor: '#abcdef',
                },
              ],
            },
          ],
        },
      ],
    })
    const outcome = run(payload, {}, {})
    const materials = outcome.changes!.materials!
    const ref = (color: string) =>
      `scene:${materials.find((m) => m.material.properties.color === color)!.id}`
    expect(materials).toHaveLength(2)
    expect(byAuthorId(outcome, 'wall/0').slots).toEqual({
      panel: ref('#123456'),
      frame: ref('#123456'),
    })
    expect(byAuthorId(outcome, 'wall/1').slots).toEqual({
      panel: ref('#123456'),
      frame: ref('#abcdef'),
    })
    expect(byAuthorId(outcome, 'wall/2').slots).toEqual({ frame: ref('#123456') })
    expect(byAuthorId(outcome, 'wall/3').slots).toEqual({ frame: ref('#abcdef') })
    expect(outcome.result.defects).toEqual([])
  })

  test('scripted openings retain their declared type and report only an ignored style', () => {
    const payload = authorScenePayload.parse({
      levels: [
        {
          name: 'Ground',
          walls: [
            {
              id: 'wall',
              start: [0, 0],
              end: [4, 0],
              height: 3,
              thickness: 0.2,
              openings: [
                {
                  kind: 'door',
                  along: 1,
                  width: 1,
                  height: 2,
                  code: '// door',
                  type: 'french',
                  style: 'modern',
                  color: '#123456',
                },
                {
                  kind: 'window',
                  along: 3,
                  width: 1,
                  height: 1,
                  code: '// window',
                  type: 'casement',
                  frameColor: '#123456',
                },
              ],
            },
          ],
        },
      ],
    })
    const outcome = run(payload, { 'wall/0': arch, 'wall/1': arch }, {})
    expect(byAuthorId(outcome, 'wall/0').doorType).toBe('french')
    expect(byAuthorId(outcome, 'wall/1').windowType).toBe('casement')
    expect(byAuthorId(outcome, 'wall/0').slots.panel).toBe(
      byAuthorId(outcome, 'wall/1').slots.frame,
    )
    expect(outcome.result.defaults).toEqual(['door wall/0: style ignored, its module builds it'])
    expect(outcome.result.defects).toEqual([])
  })

  test('a hex colour is one exact scene material per colour, a wall face each its own', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          walls: bedroom.levels[0]!.walls!.map((w) =>
            w.id === 'north'
              ? { ...w, color: '#8f9e8a' }
              : w.id === 'east'
                ? { ...w, colorLeft: '#8f9e8a', colorRight: 'library:preset-white' }
                : w,
          ),
          rooms: [
            {
              name: 'Bedroom',
              seed: [0, 0],
              floor: '#8f9e8a',
              floorRegions: [
                {
                  polygon: [
                    [-1, -1],
                    [1, -1],
                    [1, 1],
                  ],
                  finish: '#223344',
                },
              ],
            },
          ],
          slabs: [
            {
              name: 'Terrace',
              polygon: [
                [3, -2],
                [6, -2],
                [6, 2],
                [3, 2],
              ],
              finish: '#8f9e8a',
            },
          ],
        },
      ],
    })
    const outcome = run(payload, {}, {})
    const materials = outcome.changes!.materials!
    expect(materials.map((m) => m.name).sort()).toEqual(['#223344', '#8f9e8a'])
    const sage = `scene:${materials.find((m) => m.name === '#8f9e8a')!.id}`
    expect(materials[0]!.material.properties).toMatchObject({ roughness: 0.9, metalness: 0 })
    const north = byAuthorId(outcome, 'north')
    expect(north.slots.a).toBe(sage)
    expect(north.slots.b).toBe(sage)
    const east = byAuthorId(outcome, 'east')
    expect(east.slots.a).toBe(sage)
    expect(east.slots.b).toBe('library:preset-white')
    expect(byAuthorId(outcome, 'room/0/0').floor.finish).toBe(sage)
    expect(byAuthorId(outcome, 'room/0/0').floor.regions[0].finish).toBe(
      `scene:${materials.find((m) => m.name === '#223344')!.id}`,
    )
    expect(byAuthorId(outcome, 'slab/0/0').slots.surface).toBe(sage)
    expect(outcome.result.defects).toEqual([])
    // A host that keeps no scene materials gets the nearest library colour, and is told.
    const plain = run(payload, {})
    expect(plain.changes!.materials).toBeUndefined()
    expect(byAuthorId(plain, 'north').slots.a).toStartWith('library:')
    expect(plain.result.defaults).toContain(
      'this host keeps no scene materials: colours written as the nearest library colour',
    )
  })

  test('an item hosted by a wall is fixed to the face nearest its point and faces the room', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          lights: [],
          items: [
            {
              id: 'skirting',
              name: 'Baseboard',
              category: 'trim',
              code: '// baseboard',
              position: [0, 0, -2.4],
              host: 'north',
            },
          ],
        },
      ],
    })
    const outcome = run(payload, { skirting: baseboard })
    expect(outcome.result.defects).toEqual([])
    const trim = byAuthorId(outcome, 'skirting')
    const wall = byAuthorId(outcome, 'north')
    expect(trim.parentId).toBe(wall.id)
    expect(trim.wallId).toBe(wall.id)
    // The north wall runs +x at z = -2.5; a point at z = -2.4 is on its left, its front (+z face).
    expect(trim.side).toBe('front')
    expect(trim.position[0]).toBeCloseTo(2, 6)
    expect(trim.position[1]).toBe(0)
    expect(trim.position[2]).toBeCloseTo(0.1, 6)
    expect(trim.wallT).toBeCloseTo(0.5, 6)
    expect(trim.rotation[1]).toBe(0)
    expect(trim.asset.attachTo).toBe('wall-side')
    expect(wall.children).toContain(trim.id)
  })

  test('a wall curtain keeps its 4 cm face offset; points inside the wall move to the face', () => {
    for (const [position, side, z] of [
      [[0, 0, -2.4], 'front', 0.1],
      [[0, 0, -2.6], 'back', -0.1],
      [[0, 0, -2.48], 'front', 0.06],
      [[0, 0, -2.44], 'front', 0.06],
    ] as const) {
      const payload = authorScenePayload.parse({
        ...bedroom,
        levels: [
          {
            ...bedroom.levels[0],
            lights: [],
            items: [
              {
                id: 'curtain',
                name: 'Curtain',
                category: 'curtain',
                code: '// curtain',
                position,
                host: 'north',
              },
            ],
          },
        ],
      })
      const curtain = {
        ...bed,
        manifest: { ...bed.manifest, bounds: { min: [-1, 0, -0.035], max: [1, 2.4, 0.035] } },
      } as CompiledGeometryScript
      const outcome = run(payload, { curtain })
      expect(outcome.result.defects).toEqual([])
      expect(byAuthorId(outcome, 'curtain').side).toBe(side)
      expect(byAuthorId(outcome, 'curtain').position[2]).toBeCloseTo(z, 6)
      const corrections = outcome.result.defaults.filter((s) => s.startsWith('curtain:'))
      expect(corrections).toEqual(
        position[2] === -2.48
          ? ['curtain: point inside wall north, moved to its nearest face']
          : [],
      )
    }
  })

  test('warns about thin and many slabs and many regions, refuses a slab that would cap a wall', () => {
    const slab = (top: number, thickness: number, polygon: number[][], name: string) => ({
      name,
      top,
      thickness,
      polygon,
    })
    const across = [
      [-1, -2.7],
      [1, -2.7],
      [1, -2.3],
      [-1, -2.3],
    ]
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          rooms: [
            {
              name: 'Bedroom',
              seed: [0, 0],
              floorRegions: Array.from({ length: 25 }, (_, i) => ({
                polygon: [
                  [-1 + i * 0.05, -1],
                  [-0.95 + i * 0.05, -1],
                  [-0.95 + i * 0.05, 1],
                ],
                finish: '#ffffff',
              })),
            },
          ],
          slabs: [
            // A cap on the north wall: refused.
            slab(2.662, 0.012, across, 'Wall cap'),
            // A terrace under the same wall's footprint at floor level: a slab.
            slab(0, 0.15, across, 'Terrace'),
            // A platform flush against the wall's inside face: not over it.
            slab(
              2.0,
              0.2,
              [
                [-1, -2.44],
                [1, -2.44],
                [1, -1],
                [-1, -1],
              ],
              'Shelf',
            ),
            slab(
              0.3,
              0.01,
              [
                [3, 3],
                [4, 3],
                [4, 4],
              ],
              'Film',
            ),
            ...Array.from({ length: 18 }, (_, i) =>
              slab(
                0,
                0.15,
                [
                  [5 + i, 5],
                  [5.5 + i, 5],
                  [5.5 + i, 5.5],
                ],
                `Step ${i}`,
              ),
            ),
          ],
        },
      ],
    })
    const outcome = run(payload, {})
    const r = outcome.result
    expect(r.defects).toEqual([
      {
        id: 'slab/0/0',
        code: 'slab_over_wall',
        message: expect.stringContaining('"Wall cap" overlaps wall north with its top at 2.66 m'),
      },
    ])
    expect(r.ids['slab/0/0']).toBeUndefined()
    expect(r.ids['slab/0/1']).toBeDefined()
    expect(r.ids['slab/0/2']).toBeDefined()
    expect(r.slabs).toBe(21)
    expect(r.warnings).toEqual([
      { id: 'level/0', code: 'many_slabs', message: expect.stringContaining('22 slabs') },
      { id: 'slab/0/3', code: 'thin_slab', message: expect.stringContaining('10 mm') },
      {
        id: 'room/0/0',
        code: 'many_regions',
        message: expect.stringContaining('25 floor regions'),
      },
    ])
  })

  test("a wall's skirting is native on the wall, on its room's face, in its exact colour", () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          walls: bedroom.levels[0]!.walls!.map((w) =>
            w.id === 'north'
              ? { ...w, skirting: { color: '#fafafa' } }
              : w.id === 'east'
                ? { ...w, skirting: { height: 0.14, depth: 0.02 } }
                : w,
          ),
        },
      ],
    })
    const outcome = run(payload, {}, {})
    expect(outcome.result.defects).toEqual([])
    const white = outcome.changes!.materials!.find((m) => m.name === '#fafafa')!
    // The room is south of the north wall, on its left looking from start to end: face a.
    const north = byAuthorId(outcome, 'north')
    expect(north.skirting).toMatchObject({ enabled: true, sides: 'a', height: 0.1, proud: 0.012 })
    expect(north.slots.aSkirting).toBe(`scene:${white.id}`)
    expect(north.slots.bSkirting).toBeUndefined()
    const east = byAuthorId(outcome, 'east')
    expect(east.skirting).toMatchObject({ enabled: true, height: 0.14, proud: 0.02 })
    expect(east.slots?.aSkirting).toBeUndefined()
    // A payload without skirting writes walls without one, as before.
    expect(payload.levels[0]!.walls!.find((w) => w.id === 'south')).not.toHaveProperty('skirting')
    expect(byAuthorId(outcome, 'south').skirting).toBeUndefined()
  })

  test('a skirting with no room on either face of its wall is a defect naming the wall', () => {
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          walls: [
            ...bedroom.levels[0]!.walls!,
            { id: 'garden', start: [4, 4], end: [7, 4], height: 1.2, thickness: 0.2, skirting: {} },
          ],
        },
      ],
    })
    const outcome = run(payload, {})
    expect(outcome.result.defects).toEqual([
      {
        id: 'garden',
        code: 'skirting_refused',
        message: 'No room stands on either face of wall garden: its skirting was not written.',
      },
    ])
    expect(byAuthorId(outcome, 'garden').skirting).toBeUndefined()
  })

  test('rooms with a floor module are listed by their zone for the host to compile', () => {
    const floorCode = 'export default function build({ THREE }) { return new THREE.Group() }'
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          rooms: [
            { name: 'Bedroom', seed: [0, 0], floor: 'library:wood-floorplank1', floorCode },
            { name: 'Garden', seed: [9, 9], floorCode },
          ],
        },
      ],
    })
    const outcome = run(payload, {})
    expect(authorSceneFloorScripts(payload, outcome.result)).toEqual([
      { roomId: 'room/0/0', zoneId: outcome.result.ids['room/0/0']!, code: floorCode },
    ])
    expect(outcome.result.floorScripts).toBe(0)
    expect(outcome.result.defects.map((d) => [d.id, d.code])).toEqual([
      ['room/0/1', 'room_not_enclosed'],
    ])
    // The room keeps its floor finish as the fallback until the host writes the script.
    expect(byAuthorId(outcome, 'room/0/0').floor.finish).toBe('library:wood-floorplank1')
    expect(authorSceneFloorScripts(bedroom, outcome.result)).toEqual([])
  })

  test("wall face modules are listed by face; a room's wallCode covers the faces it looks into, a wall's own module over it", () => {
    const tiles = 'export default function build({ THREE }) { return new THREE.Group() }'
    const panels = 'export default function build({ THREE }) { return new THREE.Mesh() }'
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          walls: bedroom.levels[0]!.walls!.map((w) =>
            w.id === 'east' ? { ...w, faceLeft: { code: tiles } } : w,
          ),
          rooms: [{ ...bedroom.levels[0]!.rooms[0]!, wallCode: panels, wallToHeight: '120cm' }],
        },
      ],
    })
    const outcome = run(payload, {})
    expect(outcome.result.defects).toEqual([])
    expect(outcome.result.faceScripts).toBe(0)
    const ids = outcome.result.ids
    // The room stands on each wall's left face (face a), the walls running round it.
    expect(authorSceneFaceScripts(payload, outcome.result, sceneOf(outcome))).toEqual([
      { wallId: 'east', face: 'a', nodeId: ids.east!, code: tiles },
      { wallId: 'north', face: 'a', nodeId: ids.north!, code: panels, toHeight: 1.2 },
      { wallId: 'south', face: 'a', nodeId: ids.south!, code: panels, toHeight: 1.2 },
      { wallId: 'west', face: 'a', nodeId: ids.west!, code: panels, toHeight: 1.2 },
    ])
    // The faces keep their paint until the host writes the scripts; old payloads list none.
    expect(byAuthorId(outcome, 'north').slots.a).toEqual(expect.any(String))
    expect(byAuthorId(outcome, 'east').finishScripts).toBeUndefined()
    const plain = run(bedroom, {})
    expect(authorSceneFaceScripts(bedroom, plain.result, sceneOf(plain))).toEqual([])
  })

  test('a face module on a face no room looks into is a no_face defect naming the wall and face', () => {
    const tiles = 'export default function build({ THREE }) { return new THREE.Group() }'
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          walls: [
            ...bedroom.levels[0]!.walls!.map((w) =>
              w.id === 'north' ? { ...w, faceRight: { code: tiles } } : w,
            ),
            {
              id: 'garden',
              start: [4, 4],
              end: [7, 4],
              height: 1.2,
              thickness: 0.2,
              faceLeft: { code: tiles },
            },
          ],
        },
      ],
    })
    const outcome = run(payload, {})
    expect(outcome.result.defects).toEqual([
      {
        id: 'north/b',
        code: 'no_face',
        message:
          'No room looks into the right face of wall north (left and right as seen from its start to its end): its face script was not written.',
      },
      {
        id: 'garden/a',
        code: 'no_face',
        message:
          'No room looks into the left face of wall garden (left and right as seen from its start to its end): its face script was not written.',
      },
    ])
    expect(authorSceneFaceScripts(payload, outcome.result, sceneOf(outcome))).toEqual([])
  })

  test("two rooms on one face: the first room's wallCode builds it and the other is warned", () => {
    const [west, east] = ['export default () => 1', 'export default () => 2']
    const payload = authorScenePayload.parse({
      ...bedroom,
      levels: [
        {
          ...bedroom.levels[0],
          items: [],
          lights: [],
          walls: [
            ...bedroom.levels[0]!.walls!,
            { id: 'middle', start: [0, -2.5], end: [0, 2.5], height: 2.7, thickness: 0.1 },
          ],
          rooms: [
            { name: 'Study', seed: [-1, 0], wallCode: west },
            { name: 'Nursery', seed: [1, 0], wallCode: east },
          ],
        },
      ],
    })
    const outcome = run(payload, {})
    expect(outcome.result.defects).toEqual([])
    // The north and south walls run past the partition: one face each, seen from both rooms.
    expect(outcome.result.warnings.map((w) => [w.id, w.code])).toEqual([
      ['north/a', 'face_shared'],
      ['south/a', 'face_shared'],
    ])
    const listed = authorSceneFaceScripts(payload, outcome.result, sceneOf(outcome))
    expect(listed.map((f) => [f.wallId, f.face, f.code])).toEqual([
      ['north', 'a', west],
      ['south', 'a', west],
      ['west', 'a', west],
      ['middle', 'a', west],
      ['east', 'a', east],
      ['middle', 'b', east],
    ])
  })
})
