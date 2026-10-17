import { describe, expect, test } from 'bun:test'
import type { AuthorScenePayload } from '../agent-tools/author-scene'
import { authorScenePayload } from '../agent-tools/author-scene'
import type { AnyNode, CompiledGeometryScript } from '../schema'
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
    expect(lamp.interactive?.effects).toHaveLength(1)
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
    expect(again.changes!.create!.some((c) => firstIds.has(c.node.id))).toBe(false)
  })
})
