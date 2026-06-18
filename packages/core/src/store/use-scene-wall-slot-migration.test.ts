import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import useScene from './use-scene'

type WallNode = Extract<AnyNode, { type: 'wall' }>

function sceneWithWall(wall: Record<string, unknown>): Record<string, AnyNode> {
  return {
    site_test: {
      object: 'node',
      id: 'site_test',
      type: 'site',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['level_test'],
    },
    level_test: {
      object: 'node',
      id: 'level_test',
      type: 'level',
      parentId: 'site_test',
      visible: true,
      metadata: {},
      children: ['wall_test'],
      level: 0,
    },
    wall_test: {
      object: 'node',
      id: 'wall_test',
      type: 'wall',
      parentId: 'level_test',
      visible: true,
      metadata: {},
      children: [],
      start: [0, 0],
      end: [4, 0],
      ...wall,
    },
  } as unknown as Record<string, AnyNode>
}

function sceneWithNode(node: Record<string, unknown>): Record<string, AnyNode> {
  return {
    site_test: {
      object: 'node',
      id: 'site_test',
      type: 'site',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['level_test'],
    },
    level_test: {
      object: 'node',
      id: 'level_test',
      type: 'level',
      parentId: 'site_test',
      visible: true,
      metadata: {},
      children: ['node_test'],
      level: 0,
    },
    node_test: {
      object: 'node',
      id: 'node_test',
      visible: true,
      metadata: {},
      parentId: 'level_test',
      ...node,
    },
  } as unknown as Record<string, AnyNode>
}

function resetScene() {
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
  } as never)
  useScene.temporal.getState().clear()
}

describe('wall surface-material → slots migration', () => {
  beforeEach(() => {
    resetScene()
  })

  test('moves legacy library presets into slots and clears the inline fields', () => {
    useScene.getState().setScene(
      sceneWithWall({
        interiorMaterialPreset: 'library:concrete-plate',
        exteriorMaterialPreset: 'library:wood-woodplank48',
      }),
      ['site_test'] as never,
    )

    const wall = useScene.getState().nodes.wall_test as WallNode
    expect(wall.slots).toEqual({
      interior: 'library:concrete-plate',
      exterior: 'library:wood-woodplank48',
    })
    expect(wall.interiorMaterialPreset).toBeUndefined()
    expect(wall.exteriorMaterialPreset).toBeUndefined()
  })

  test('mints a scene material for an inline legacy material and references it', () => {
    useScene.getState().setScene(
      sceneWithWall({
        interiorMaterial: { properties: { color: '#abcdef' } },
      }),
      ['site_test'] as never,
    )

    const wall = useScene.getState().nodes.wall_test as WallNode
    const interiorRef = wall.slots?.interior
    expect(interiorRef?.startsWith('scene:')).toBe(true)
    expect(wall.interiorMaterial).toBeUndefined()

    const materials = useScene.getState().materials
    const id = interiorRef!.slice('scene:'.length)
    expect(materials[id as keyof typeof materials]?.material).toEqual({
      properties: { color: '#abcdef' },
    } as never)
  })

  test('legacy catch-all material applies to both faces; identical inline customs share one scene material', () => {
    useScene.getState().setScene(
      sceneWithWall({
        material: { properties: { color: '#112233' } },
      }),
      ['site_test'] as never,
    )

    const wall = useScene.getState().nodes.wall_test as WallNode
    expect(wall.slots?.interior).toBeDefined()
    expect(wall.slots?.interior).toBe(wall.slots?.exterior as string)
    expect(wall.material).toBeUndefined()
    // One minted datablock shared across both faces.
    expect(Object.keys(useScene.getState().materials)).toHaveLength(1)
  })

  test('leaves an already slot-modelled wall untouched and mints nothing for unpainted walls', () => {
    useScene
      .getState()
      .setScene(sceneWithWall({ slots: { interior: 'library:concrete-drywall' } }), [
        'site_test',
      ] as never)

    const migratedWall = useScene.getState().nodes.wall_test as WallNode
    expect(migratedWall.slots).toEqual({ interior: 'library:concrete-drywall' })
    expect(Object.keys(useScene.getState().materials)).toHaveLength(0)

    useScene.getState().setScene(sceneWithWall({}), ['site_test'] as never)
    const plainWall = useScene.getState().nodes.wall_test as WallNode
    expect(plainWall.slots).toBeUndefined()
    expect(Object.keys(useScene.getState().materials)).toHaveLength(0)
  })
})

type SlottedNode = AnyNode & { slots?: Record<string, string>; material?: unknown }

describe('procedural kind surface-material → slots migration', () => {
  beforeEach(resetScene)

  test('slab: legacy preset → slots.surface, legacy cleared', () => {
    useScene.getState().setScene(
      sceneWithNode({
        type: 'slab',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
        materialPreset: 'library:flooring-tiles3',
      }),
      ['site_test'] as never,
    )

    const slab = (useScene.getState().nodes as Record<string, SlottedNode>).node_test!
    expect(slab.slots).toEqual({ surface: 'library:flooring-tiles3' })
    expect((slab as { materialPreset?: unknown }).materialPreset).toBeUndefined()
  })

  test('ceiling: inline custom material mints a scene material on slots.surface', () => {
    useScene.getState().setScene(
      sceneWithNode({
        type: 'ceiling',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
        ],
        material: { properties: { color: '#ddeeff' } },
      }),
      ['site_test'] as never,
    )

    const ceiling = (useScene.getState().nodes as Record<string, SlottedNode>).node_test!
    const ref = ceiling.slots?.surface
    expect(ref?.startsWith('scene:')).toBe(true)
    expect(ceiling.material).toBeUndefined()
    expect(Object.keys(useScene.getState().materials)).toHaveLength(1)
  })

  test('fence: legacy preset fans out to every slot id (one shared ref)', () => {
    useScene.getState().setScene(
      sceneWithNode({
        type: 'fence',
        start: [0, 0],
        end: [4, 0],
        materialPreset: 'library:wood-woodplank48',
      }),
      ['site_test'] as never,
    )

    const fence = (useScene.getState().nodes as Record<string, SlottedNode>).node_test!
    expect(fence.slots).toEqual({
      posts: 'library:wood-woodplank48',
      infill: 'library:wood-woodplank48',
      base: 'library:wood-woodplank48',
      rail: 'library:wood-woodplank48',
    })
  })

  test('stair: per-role legacy fields map tread→treads, side→body, railing→railing', () => {
    useScene.getState().setScene(
      sceneWithNode({
        type: 'stair',
        treadMaterialPreset: 'library:wood-woodplank48',
        sideMaterialPreset: 'library:concrete-plate',
        railingMaterialPreset: 'library:metal-chrome',
      }),
      ['site_test'] as never,
    )

    const stair = (useScene.getState().nodes as Record<string, SlottedNode>).node_test!
    expect(stair.slots?.treads).toBe('library:wood-woodplank48')
    expect(stair.slots?.body).toBe('library:concrete-plate')
    expect(stair.slots?.railing).toBe('library:metal-chrome')
    expect((stair as { treadMaterialPreset?: unknown }).treadMaterialPreset).toBeUndefined()
  })

  test('unpainted procedural node mints nothing and stays slot-less', () => {
    useScene.getState().setScene(
      sceneWithNode({
        type: 'slab',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
        ],
      }),
      ['site_test'] as never,
    )

    const slab = (useScene.getState().nodes as Record<string, SlottedNode>).node_test!
    expect(slab.slots).toBeUndefined()
    expect(Object.keys(useScene.getState().materials)).toHaveLength(0)
  })
})
