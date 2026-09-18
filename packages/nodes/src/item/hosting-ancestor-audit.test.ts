import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  createSceneApi,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSurfacePlacement,
  type SceneApi,
  useScene,
} from '@pascal-app/core'
import { nodeLevelFrame } from '@pascal-app/core/procedural-items'
import { builtinPlugin } from '../index'
import { buildItemFloorplan } from './floorplan'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  for (const def of builtinPlugin.nodes!) registerNode(def)
})
afterEach(() => restore())
const asset = {
  id: 'box',
  name: 'Box',
  category: 'furniture',
  src: '/box.glb',
  thumbnail: '',
  dimensions: [0.2, 0.2, 0.2],
}
for (const type of ['slab', 'environment:ground-cover', 'trees:tree', 'plugin:geometry'])
  test(`audit: legacy ${type} ancestor never throws or changes data`, () => {
    const level = LevelNode.parse({})
    const parent = {
      id: `${type}_legacy`,
      type,
      parentId: level.id,
      position: [2, 3, 4],
      rotation: [0, 0.7, 0],
      children: [],
    }
    const child = ItemNode.parse({ parentId: parent.id, asset, position: [1, 0.5, 2] })
    const nodes = { [level.id]: level, [parent.id]: parent, [child.id]: child } as never
    const before = JSON.stringify(nodes)
    expect(() => nodeLevelFrame(child.id, nodes)).not.toThrow()
    expect(() =>
      buildItemFloorplan(child, { resolve: (id: string) => nodes[id] } as never),
    ).not.toThrow()
    expect(JSON.stringify(nodes)).toBe(before)
  })

test('audit: generic geometry plugin hosts without frame declarations', () => {
  registerNode({
    ...nodeRegistry.get('shelf')!,
    kind: 'plugin:geometry',
    renderer: undefined,
    geometry: nodeRegistry.get('shelf')!.geometry,
    schema: ItemNode,
    capabilities: {},
  } as never)
  const host = { ...ItemNode.parse({ asset }), type: 'plugin:geometry' } as never
  expect(
    resolveSurfacePlacement({
      host,
      childKind: 'item',
      childFootprint: { size: [0.2, 0.2, 0.2], rotationY: 0 },
      hit: { point: [0, 1, 0], normalWorldY: 1 },
      scene: createSceneApi(useScene),
    }),
  ).not.toBeNull()
})

const size = [0.5, 1, 0.5] as const
const scene = { nodes: () => ({}), get: () => undefined } as unknown as SceneApi

test('schema retention probes one real id and never caches a rejected sibling', () => {
  const def = nodeRegistry.get('item')!
  let parses = 0
  const schema = ItemNode.extend({
    children: ItemNode.shape.children.refine((ids) => {
      parses += 1
      expect(ids).toHaveLength(1)
      return !ids.includes('item_blocked')
    }),
  })
  registerNode({ ...def, schema })
  const reasons: string[] = []
  const args = {
    host: ItemNode.parse({ asset }),
    childKind: 'item',
    childId: 'item_accepted',
    childFootprint: { size, rotationY: 0 },
    hit: { point: [0, 1, 0] as const, normalWorldY: 1 },
    scene,
    onReject: (reason: string) => reasons.push(reason),
  }
  expect(resolveSurfacePlacement(args)).not.toBeNull()
  expect(resolveSurfacePlacement(args)).not.toBeNull()
  expect(parses).toBe(2)
  const hostWithChildren = {
    ...args.host,
    children: Array.from({ length: 1000 }, (_, i) => `item_existing${i}`),
  }
  expect(resolveSurfacePlacement({ ...args, host: hostWithChildren })).not.toBeNull()
  expect(parses).toBe(3)
  expect(resolveSurfacePlacement({ ...args, childKind: 'procedural-item' })).not.toBeNull()
  expect(parses).toBe(4)
  expect(resolveSurfacePlacement({ ...args, childId: 'item_blocked' })).toBeNull()
  expect(resolveSurfacePlacement(args)).not.toBeNull()
  expect(reasons).toEqual([])
  registerNode({ ...def, schema: ItemNode.omit({ children: true }) })
  expect(resolveSurfacePlacement(args)).toBeNull()
})

test('a renderable host below a generic parent remains eligible', () => {
  const parent = nodeRegistry.get('column')!.schema.parse({}) as AnyNode
  const host = ItemNode.parse({ asset, parentId: parent.id })
  const reasons: string[] = []
  expect(
    resolveSurfacePlacement({
      host,
      childKind: 'item',
      childFootprint: { size, rotationY: 0 },
      hit: { point: [0, 1, 0], normalWorldY: 1 },
      scene: {
        get: () => parent,
        nodes: () => ({ [host.id]: host, [parent.id]: parent }),
      } as unknown as SceneApi,
      onReject: (reason) => reasons.push(reason),
    }),
  ).not.toBeNull()
  expect(reasons).toEqual([])
})
