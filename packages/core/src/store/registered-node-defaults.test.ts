import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../registry/registry'
import { AnyNode, nodeKindOf } from '../schema/types'
import { materializeRegisteredNodeDefaults } from './registered-node-defaults'
import useScene, { clearSceneHistory } from './use-scene'

type RawNode = Record<string, unknown>

const node = (id: string, type: string, parentId: string | null, extra: RawNode = {}): RawNode => ({
  object: 'node',
  id,
  type,
  parentId,
  visible: true,
  metadata: {},
  ...extra,
})

const square: Array<[number, number]> = [
  [0, 0],
  [6, 0],
  [6, 6],
  [0, 6],
]

// A legacy two-storey scene as production stores it: no level heights, and a
// raised first-floor slab without `thickness`, which the loader reads as a
// solid from the level base up to its top (the facade band between storeys).
function legacyScene() {
  const walls = (levelId: string, prefix: string, height: number) =>
    square.map((start, index) =>
      node(`wall_${prefix}${index}`, 'wall', levelId, {
        start,
        end: square[(index + 1) % square.length],
        children: [],
        height,
      }),
    )
  const ground = walls('level_ground', 'g', 2.5)
  const first = walls('level_first', 'f', 3)
  const nodes: Record<string, RawNode> = {
    site_a: node('site_a', 'site', null, { children: ['building_a'] }),
    building_a: node('building_a', 'building', 'site_a', {
      children: ['level_ground', 'level_first'],
    }),
    level_ground: node('level_ground', 'level', 'building_a', {
      level: 0,
      children: [...ground.map((wall) => wall.id), 'slab_ground'],
    }),
    level_first: node('level_first', 'level', 'building_a', {
      level: 1,
      children: [...first.map((wall) => wall.id), 'slab_raised'],
    }),
    slab_ground: node('slab_ground', 'slab', 'level_ground', { polygon: square, elevation: 0.05 }),
    slab_raised: node('slab_raised', 'slab', 'level_first', { polygon: square, elevation: 0.8 }),
  }
  for (const wall of [...ground, ...first]) nodes[wall.id as string] = wall
  return { nodes, rootNodeIds: ['site_a'] }
}

function load(nodes: Record<string, unknown>, rootNodeIds: string[]) {
  clearSceneHistory()
  useScene.getState().setScene(structuredClone(nodes) as never, rootNodeIds as never)
  return structuredClone(useScene.getState().nodes) as Record<string, any>
}

describe('materializeRegisteredNodeDefaults', () => {
  let restoreRegistry: () => void
  beforeEach(() => {
    restoreRegistry = nodeRegistry._snapshot()
  })
  afterEach(() => restoreRegistry())

  test('materializes registered schema defaults for kinds the loader does not own', () => {
    registerNode({
      kind: 'test-scene-normalization',
      schema: z.object({
        id: z.string(),
        position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
        rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
        type: z.literal('test-scene-normalization'),
      }),
      schemaVersion: 1,
    } as never)

    expect(
      materializeRegisteredNodeDefaults({
        test: { id: 'test', type: 'test-scene-normalization' },
        unknown: { id: 'unknown', type: 'unknown-kind', custom: true },
      }),
    ).toEqual({
      test: {
        id: 'test',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        type: 'test-scene-normalization',
      },
      unknown: { id: 'unknown', type: 'unknown-kind', custom: true },
    })
  })

  test('the editor loads a legacy scene exactly like the viewer, raised slab body included', () => {
    // The app registers every built-in kind with its core schema (`@pascal-app/nodes`).
    for (const option of AnyNode.options) {
      const kind = nodeKindOf(option)
      if (!nodeRegistry.get(kind)) registerNode({ kind, schema: option, schemaVersion: 1 } as never)
    }
    const scene = legacyScene()
    const editor = load(materializeRegisteredNodeDefaults(scene.nodes), scene.rootNodeIds)
    const viewer = load(scene.nodes, scene.rootNodeIds)

    expect(editor.slab_raised.thickness).toBe(0.8)
    expect(editor.slab_raised.elevation).toBe(0.8)
    expect(editor).toEqual(viewer)
  })
})
