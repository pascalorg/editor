import { describe, expect, test } from 'bun:test'
import type { AuthorScenePayload } from '../agent-tools/author-scene'
import { authorScenePayload } from '../agent-tools/author-scene'
import type { AnyNode, CompiledGeometryScript, SceneMaterial } from '../schema'
import { authorScene } from './author-scene'

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
      lights: [{ position: [1.2, 1.1, -2], fixture: 'lamp' }, { position: [0, 2.5, 1] }],
    },
  ],
  notes: ['The rug was left out.'],
})

describe('author_scene', () => {
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
    const scene = scaffold()
    delete scene.level_0
    for (const { node } of first.changes!.create!) scene[node.id] = node
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
    // Written over itself, the same payload gets fresh ids, so nothing is created and then deleted.
    const firstIds = new Set(first.changes!.create!.map((c) => c.node.id))
    expect(again.changes!.create!.length).toBe(first.changes!.create!.length)
    expect(again.changes!.create!.some((c) => firstIds.has(c.node.id))).toBe(false)
    expect(again.changes!.delete).toEqual([
      first.changes!.create!.find((c) => c.node.type === 'level')!.node.id,
    ])
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
      { activeLevelId: 'level_0' },
    )
    const door = byAuthorId(outcome, 'south/0')
    expect(door.source.kind).toBe('script')
    expect(door.source.artifact).toBe(arch.sha256)
    expect(door.slots.wood).toStartWith('library:wood-')
    expect([door.width, door.height]).toEqual([1, 2.1])
    expect(outcome.result.defects).toEqual([
      { id: 'south/1', code: 'compile_failed', message: 'Syntax error' },
    ])
    expect(outcome.result.windows).toBe(1)
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
    expect(trim.position[2]).toBeCloseTo(0.06, 6)
    expect(trim.wallT).toBeCloseTo(0.5, 6)
    expect(trim.rotation[1]).toBe(0)
    expect(trim.asset.attachTo).toBe('wall-side')
    expect(wall.children).toContain(trim.id)
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
})
