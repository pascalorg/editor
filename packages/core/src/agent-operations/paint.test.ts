import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { AGENT_TOOL_CONTRACTS, isAgentRefusal } from '../agent-tools'
import { slotPaintMaterial } from '../lib/slots'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  ColumnNode,
  DoorNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  type SceneMaterial,
  SiteNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import {
  buildWallFinishLayout,
  getWallLevelZones,
  resolveWallFinish,
} from '../systems/wall/wall-finish'
import { achievedChanges } from './achieved'
import { applySceneChanges } from './apply-changes'
import { AGENT_OPERATIONS } from './index'
import type { AgentContext, SceneChanges, SceneNodes } from './types'

// `paint` as both surfaces run it: the contract parses the input, the operation plans the change,
// and the scene and its materials after the change are what a host saves.

const TIMBER_NAME = 'Mountain house, warm timber'
const TIMBER = { preset: 'custom', properties: { color: '#71503a', roughness: 0.86, metalness: 0 } }
/** The timber as the material schema keeps it. */
const KEPT_TIMBER = {
  preset: 'custom',
  properties: {
    color: '#71503a',
    roughness: 0.86,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
}
const DRYWALL = 'library:concrete-drywall'

/** A 6 × 4 m room of four walls; the south one runs east, so its face a is in, b out. */
function room() {
  const south = WallNode.parse({
    id: 'wall_south',
    parentId: 'level_paint',
    start: [0, 0],
    end: [6, 0],
    slots: { a: DRYWALL, b: 'library:concrete-raw' },
    faceRegions: [{ id: 'stripe', face: 'a', u0: 0, u1: 2, v0: 0, v1: 1, finish: '#fffafa' }],
    children: ['window_south', 'door_south'],
  })
  const walls = [
    south,
    WallNode.parse({ id: 'wall_east', parentId: 'level_paint', start: [6, 0], end: [6, 4] }),
    WallNode.parse({ id: 'wall_north', parentId: 'level_paint', start: [6, 4], end: [0, 4] }),
    WallNode.parse({ id: 'wall_west', parentId: 'level_paint', start: [0, 4], end: [0, 0] }),
  ]
  const ceiling = CeilingNode.parse({
    id: 'ceiling_paint',
    parentId: 'level_paint',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    regions: [
      {
        id: 'accent',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        finish: DRYWALL,
      },
    ],
    slots: { surface: 'library:preset-nearblack', retained: DRYWALL },
    materialPreset: 'white',
    material: { preset: 'custom', properties: { color: '#123456' } },
  })
  const slab = SlabNode.parse({
    id: 'slab_paint',
    parentId: 'level_paint',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
  })
  const nodes: AnyNode[] = [
    SiteNode.parse({ id: 'site_paint', children: ['building_paint'] }),
    BuildingNode.parse({ id: 'building_paint', parentId: 'site_paint', children: ['level_paint'] }),
    LevelNode.parse({
      id: 'level_paint',
      parentId: 'building_paint',
      level: 0,
      children: [...walls.map((wall) => wall.id), ceiling.id, slab.id],
    }),
    ...walls,
    WindowNode.parse({ id: 'window_south', parentId: south.id, position: [4, 1.5, 0] }),
    DoorNode.parse({ id: 'door_south', parentId: south.id, position: [1, 1, 0] }),
    ceiling,
    slab,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, AnyNode>
}

const parse = (input: unknown) =>
  z.object(AGENT_TOOL_CONTRACTS.find((tool) => tool.name === 'paint')!.input).parse(input)

function paint(
  nodes: SceneNodes,
  input: Record<string, unknown>,
  materials?: Readonly<Record<string, SceneMaterial>>,
) {
  const context: AgentContext = {
    activeLevelId: 'level_paint',
    ...(materials ? { materials } : {}),
  }
  return AGENT_OPERATIONS.paint(nodes, parse(input) as never, context)
}

/** The scene and its materials once a host has applied the change. */
function applied(
  nodes: SceneNodes,
  materials: Readonly<Record<string, SceneMaterial>>,
  changes: SceneChanges | undefined,
) {
  return {
    nodes: applySceneChanges(nodes, changes) as Record<string, AnyNode>,
    materials: {
      ...materials,
      ...Object.fromEntries((changes?.materials ?? []).map((material) => [material.id, material])),
    },
  }
}

function refusal(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  throw new Error('expected a refusal')
}

const timberOutside = (targets = ['wall_south']) => ({
  targets,
  role: 'exterior',
  material: TIMBER,
  materialName: TIMBER_NAME,
})

describe('paint with a native material', () => {
  test("keeps it as a scene material, on the wall's outside face only", () => {
    const nodes = room()
    const before = structuredClone(nodes)
    const outcome = paint(nodes, timberOutside(), {})
    const after = applied(nodes, {}, outcome.changes)
    const wall = after.nodes.wall_south as WallNode
    const ref = wall.slots?.b
    expect(ref).toMatch(/^scene:/)
    const kept = after.materials[ref!.slice('scene:'.length)]!
    expect(kept).toMatchObject({ name: TIMBER_NAME, material: KEPT_TIMBER })
    expect(outcome.result).toMatchObject({ ok: true, finish: ref, materialId: kept.id })
    // The inside face, its paint regions and the openings are untouched.
    expect(wall.slots?.a).toBe(DRYWALL)
    expect(wall.faceRegions).toEqual((before.wall_south as WallNode).faceRegions)
    expect(after.nodes.window_south).toEqual(before.window_south)
    expect(after.nodes.door_south).toEqual(before.door_south)
    expect(nodes).toEqual(before)
    // What the editor's eyedropper reads back is the exact material.
    expect(slotPaintMaterial(ref, after.materials)).toEqual({
      material: KEPT_TIMBER as never,
      materialPreset: undefined,
    })
  })

  test('reuses the equal material already in the scene, whatever the order of its keys', () => {
    const first = paint(room(), timberOutside(), {})
    const once = applied(room(), {}, first.changes)
    const second = paint(
      once.nodes,
      {
        ...timberOutside(['wall_east']),
        material: {
          properties: { metalness: 0, roughness: 0.86, color: '#71503a' },
          preset: 'custom',
        },
      },
      once.materials,
    )
    expect(second.changes?.materials).toBeUndefined()
    const twice = applied(once.nodes, once.materials, second.changes)
    expect((twice.nodes.wall_east as WallNode).slots?.b).toBe(
      (twice.nodes.wall_south as WallNode).slots?.b,
    )
    expect(Object.keys(twice.materials)).toHaveLength(1)
  })

  test('a different texture is a different material', () => {
    const texture = { url: '/material/wood/existing-timber.jpg', repeat: [2, 3], scale: 0.5 }
    const first = paint(room(), { ...timberOutside(), material: { ...TIMBER, texture } }, {})
    expect(first.changes?.materials?.[0]?.material).toEqual({ ...KEPT_TIMBER, texture } as never)
    const once = applied(room(), {}, first.changes)
    const second = paint(
      once.nodes,
      {
        ...timberOutside(['wall_east']),
        material: { ...TIMBER, texture: { ...texture, repeat: [1, 1] } },
      },
      once.materials,
    )
    expect(second.changes?.materials).toHaveLength(1)
  })

  test('a scene ref paints as it is, and one the scene lacks is refused', () => {
    const once = applied(room(), {}, paint(room(), timberOutside(), {}).changes)
    const ref = (once.nodes.wall_south as WallNode).slots!.b!
    const again = paint(
      once.nodes,
      { targets: ['wall_east'], role: 'b', material: ref },
      once.materials,
    )
    expect(again.changes?.materials).toBeUndefined()
    expect(applied(once.nodes, once.materials, again.changes).nodes.wall_east).toMatchObject({
      slots: { b: ref },
    })
    expect(
      refusal(() =>
        paint(room(), { targets: ['wall_south'], role: 'b', material: 'scene:mat_missing' }, {}),
      ),
    ).toBe('unknown_material')
  })

  test('a host that cannot keep scene materials refuses a native one, and paints the rest', () => {
    expect(refusal(() => paint(room(), timberOutside()))).toBe('materials_unavailable')
    const library = paint(room(), { targets: ['wall_south'], role: 'b', material: 'concrete-raw' })
    expect(library.result.finish).toBe('library:concrete-raw')
    const colour = paint(room(), { targets: ['wall_south'], role: 'b', color: '#71503a' })
    expect(colour.result.finish).toMatch(/^library:/)
    expect(String(colour.result.note)).toMatch(/nearest/)
  })

  test('the contract bounds a material and its name before the operation runs', () => {
    expect(() => parse({ ...timberOutside(), materialName: 'M'.repeat(120) })).not.toThrow()
    for (const bad of [
      { ...timberOutside(), materialName: 'M'.repeat(121) },
      { ...timberOutside(), materialName: '   ' },
      { ...timberOutside(), material: { properties: { roughness: 1.01 } } },
      { ...timberOutside(), material: { properties: { metalness: -0.01 } } },
      { ...timberOutside(), material: { properties: { roughness: '0.86' } } },
      { ...timberOutside(), material: null },
    ])
      expect(() => parse(bad)).toThrow()
  })
})

describe('a wall in a room with a wall finish', () => {
  const WHITE = 'library:preset-white'

  /** The room, its walls given one finish as the editor's "paint this room's walls" leaves them. */
  function finished() {
    const nodes = room()
    const zone = ZoneNode.parse({
      id: 'zone_paint',
      parentId: 'level_paint',
      name: 'Living room',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      boundaryWallIds: ['wall_south', 'wall_east', 'wall_north', 'wall_west'],
      wallMaterial: WHITE,
    })
    const level = nodes.level_paint as LevelNode
    return {
      ...nodes,
      level_paint: { ...level, children: [...level.children, zone.id] },
      [zone.id]: zone,
    } as Record<string, AnyNode>
  }

  /** The finish the renderer draws at station `u`, 2 m up face `face` of `wallId`. */
  function shownAt(nodes: Record<string, AnyNode>, wallId: string, face: 'a' | 'b', u: number) {
    const wall = nodes[wallId] as WallNode
    return resolveWallFinish(
      buildWallFinishLayout(wall, getWallLevelZones(wall, nodes)),
      face,
      u,
      2,
    )
  }

  test("its inside face shows the paint over the room's finish; the room's other walls keep it", () => {
    const nodes = finished()
    expect(shownAt(nodes, 'wall_south', 'a', 3)).toMatchObject({ source: 'zone', ref: WHITE })
    const outcome = paint(nodes, {
      targets: ['wall_south'],
      role: 'interior',
      material: 'library:concrete-raw',
    })
    expect(outcome.result).toMatchObject({ painted: [{ id: 'wall_south', roles: ['a'] }] })
    const after = applied(nodes, {}, outcome.changes).nodes
    for (const u of [0.5, 3, 5.5])
      expect(shownAt(after, 'wall_south', 'a', u)).toMatchObject({ ref: 'library:concrete-raw' })
    expect(after.zone_paint).toMatchObject({
      wallMaterial: WHITE,
      wallOverrides: [{ wallId: 'wall_south', face: 'a', finish: 'library:concrete-raw' }],
    })
    // The painted stripe on that face keeps its own finish, and the result says so.
    expect(String(outcome.result.note)).toContain('wall_south a: stripe')
  })

  test("erasing it shows the face's own default, not the room's finish", () => {
    const nodes = finished()
    const once = applied(
      nodes,
      {},
      paint(nodes, { targets: ['wall_south'], role: 'a', material: 'library:concrete-raw' })
        .changes,
    ).nodes
    const erased = applied(
      once,
      {},
      paint(once, { targets: ['wall_south'], role: 'a', erase: true }).changes,
    ).nodes
    expect((erased.wall_south as WallNode).slots?.a).toBeUndefined()
    expect(shownAt(erased, 'wall_south', 'a', 3).source).not.toBe('zone')
    expect(shownAt(erased, 'wall_east', 'a', 2)).toEqual(shownAt(nodes, 'wall_east', 'a', 2))
  })
})

describe('paint refuses the whole call', () => {
  for (const [label, input, code] of [
    ['a target not in the scene', timberOutside(['wall_south', 'wall_gone']), 'target_not_found'],
    [
      'a role a later target lacks',
      { ...timberOutside(['wall_south', 'door_south']), role: 'a' },
      'unknown_role',
    ],
    [
      'a material the library lacks',
      { targets: ['wall_south'], material: 'library:corrugated' },
      'unknown_material',
    ],
    ['two finishes', { targets: ['wall_south'], color: '#ffffff', erase: true }, 'finish_required'],
    ['a kind with no finish', { targets: ['level_paint'], color: '#ffffff' }, 'not_paintable'],
  ] as const) {
    test(label, () => {
      const nodes = room()
      const before = structuredClone(nodes)
      expect(refusal(() => paint(nodes, input, {}))).toBe(code)
      expect(nodes).toEqual(before)
    })
  }

  test("a curtain wall's exterior: it has frame, glass and panels, no faces", () => {
    const nodes = room()
    nodes.wall_east = { ...(nodes.wall_east as WallNode), wallType: 'curtain' }
    expect(
      refusal(() =>
        paint(nodes, { targets: ['wall_south', 'wall_east'], role: 'exterior', color: '#ffffff' }),
      ),
    ).toBe('unknown_role')
  })

  test('a scripted column with no shaft names the surfaces it has', () => {
    const column = ColumnNode.parse({
      id: 'column_script',
      parentId: 'level_paint',
      source: {
        kind: 'script',
        script: 'a'.repeat(64),
        artifact: 'b'.repeat(64),
        manifest: {
          bounds: { min: [-0.2, 0, -0.2], max: [0.2, 3, 0.2] },
          triangles: 12,
          slots: [
            { id: 'stone', color: '#dddddd' },
            { id: 'band', color: '#555555' },
          ],
        },
      },
    })
    const nodes = { ...room(), [column.id]: column }
    expect(refusal(() => paint(nodes, { targets: [column.id], material: TIMBER }, {}))).toBe(
      'unknown_role',
    )
    const stone = paint(nodes, { targets: [column.id], role: 'stone', material: DRYWALL }, {})
    expect(applied(nodes, {}, stone.changes).nodes[column.id]).toMatchObject({
      slots: { stone: DRYWALL },
    })
  })
})

describe('a ceiling', () => {
  test('takes its finish on its surface; regions, other slots and other nodes untouched', () => {
    const nodes = room()
    const before = structuredClone(nodes)
    for (const role of [undefined, 'surface']) {
      const outcome = paint(nodes, {
        targets: ['ceiling_paint'],
        material: 'library:concrete-raw',
        ...(role ? { role } : {}),
      })
      expect(outcome.result).toMatchObject({
        painted: [{ id: 'ceiling_paint', roles: ['surface'] }],
      })
      const after = applied(nodes, {}, outcome.changes).nodes
      expect(after.ceiling_paint).toEqual({
        ...before.ceiling_paint!,
        slots: { surface: 'library:concrete-raw', retained: DRYWALL },
      } as AnyNode)
      for (const id of Object.keys(before).filter((id) => id !== 'ceiling_paint'))
        expect(after[id]).toBe(nodes[id]!)
    }
  })

  test('erasing removes the slot as the editor does, keeping its legacy material', () => {
    const nodes = room()
    const after = applied(
      nodes,
      {},
      paint(nodes, { targets: ['ceiling_paint'], erase: true }).changes,
    )
    const ceiling = after.nodes.ceiling_paint as CeilingNode
    expect(ceiling.slots).toEqual({ retained: DRYWALL })
    expect(ceiling.material).toEqual((nodes.ceiling_paint as CeilingNode).material)
    expect(ceiling.materialPreset).toBe('white')
  })
})

describe('what paint reports', () => {
  test('a finish already there is no change', () => {
    const nodes = room()
    const outcome = paint(nodes, { targets: ['wall_south'], role: 'a', material: DRYWALL })
    expect(outcome.changes?.update).toEqual([])
    expect(achievedChanges(nodes, outcome.changes!)).toMatchObject({ updated: 0, unchanged: true })
  })

  test('of two targets, only the one that changed counts', () => {
    const nodes = room()
    const outcome = paint(nodes, {
      targets: ['wall_south', 'wall_east'],
      role: 'a',
      material: DRYWALL,
    })
    expect(outcome.changes?.update?.map(({ id }) => id)).toEqual(['wall_east'])
    expect(achievedChanges(nodes, outcome.changes!)).toEqual({
      created: {},
      updated: 1,
      deleted: {},
    })
  })
})

describe('a roof', () => {
  function roofed(segment: Record<string, unknown> = {}) {
    const nodes = room()
    const roof = RoofNode.parse({
      id: 'roof_paint',
      parentId: 'level_paint',
      topMaterial: { preset: 'custom', properties: { color: '#000000' } },
      children: ['rseg_paint'],
    })
    const rseg = RoofSegmentNode.parse({ id: 'rseg_paint', parentId: roof.id, ...segment })
    return { ...nodes, [roof.id]: roof, [rseg.id]: rseg } as Record<string, AnyNode>
  }

  test('paints its top by default, in place of the inline material it had', () => {
    const nodes = roofed()
    const after = applied(
      nodes,
      {},
      paint(nodes, { targets: ['roof_paint'], material: 'library:roof-claytiles' }).changes,
    )
    const roof = after.nodes.roof_paint as RoofNode
    expect(roof.topMaterialPreset).toBe('library:roof-claytiles')
    expect(roof.topMaterial).toBeUndefined()
  })

  test("is refused when a segment's own finish would hide it", () => {
    for (const own of [
      { topMaterialPreset: 'library:roof-claytiles' },
      { materialPreset: 'library:roof-claytiles' },
    ])
      expect(refusal(() => paint(roofed(own), { targets: ['roof_paint'], color: '#336699' }))).toBe(
        'shadowed_field',
      )
    const edge = paint(roofed({ topMaterialPreset: 'library:roof-claytiles' }), {
      targets: ['roof_paint'],
      role: 'edge',
      color: '#336699',
    })
    expect(edge.result).toMatchObject({ painted: [{ id: 'roof_paint', roles: ['edge'] }] })
  })
})
