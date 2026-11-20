import { afterEach, beforeEach, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, nodeRegistry, type SceneGraph } from '@pascal-app/core'
import { familyForNode, sceneFamilies } from '../index'
import { resolveFamilyVisibility } from './scene-families'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  for (const [kind, family] of [
    ['container', null],
    ['wall', 'walls'],
    ['slab', 'floors'],
    ['item', 'items'],
  ] as const) {
    nodeRegistry._register({
      kind,
      schemaVersion: 1,
      extensions: { 'pascal:viewer': { family } },
    } as never)
  }
  nodeRegistry._register({ kind: 'test:mesh', schemaVersion: 1, geometry: {} } as never)
})
afterEach(() => restore())

function graph(): SceneGraph {
  const nodes = [
    { id: 'root', type: 'container', children: ['wall', 'slab', 'hidden', 'plugin'] },
    { id: 'wall', type: 'wall', children: ['item'] },
    { id: 'item', type: 'item' },
    { id: 'slab', type: 'slab' },
    { id: 'hidden', type: 'container', visible: false, children: ['hidden-item'] },
    { id: 'hidden-item', type: 'item' },
    { id: 'plugin', type: 'test:mesh' },
    { id: 'unreachable', type: 'item' },
  ]
  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: ['root'],
  } as unknown as SceneGraph
}

test('families follow taxonomy order, omit empty families and ignore hidden or unreachable branches', () => {
  const scene = graph()
  expect(sceneFamilies(scene)).toEqual(['floors', 'walls', 'items', 'other'])
  delete scene.nodes.item
  expect(sceneFamilies(scene)).toEqual(['floors', 'walls', 'other'])
  expect(sceneFamilies({ nodes: {}, rootNodeIds: [] })).toEqual([])
  expect(familyForNode({ type: 'test:mesh' } as AnyNode)).toBe('other')
})

test('a hosted child retains its family and an excluded container never imposes one', () => {
  const scene = graph()
  expect([...resolveFamilyVisibility(scene, 'items')].sort()).toEqual(['item', 'root'])
  expect([...resolveFamilyVisibility(scene, 'walls')].sort()).toEqual(['root', 'wall'])
  expect([...resolveFamilyVisibility(scene, null)].sort()).toEqual([
    'item',
    'plugin',
    'root',
    'slab',
    'wall',
  ])
  scene.nodes.root!.children = ['root', 'wall', 'slab', 'hidden', 'plugin'] as AnyNodeId[]
  expect(resolveFamilyVisibility(scene, 'items').has('item' as AnyNodeId)).toBe(true)
})

test('a hidden site hides only its own family, preserving its visible buildings', () => {
  nodeRegistry._register({
    kind: 'site',
    schemaVersion: 1,
    extensions: { 'pascal:viewer': { family: 'site' } },
  } as never)
  const scene = graph()
  scene.nodes.root = { ...scene.nodes.root!, type: 'site', visible: false } as AnyNode
  expect(sceneFamilies(scene)).toEqual(['floors', 'walls', 'items', 'other'])
})

test('published unknown kinds are offered as other without loading their plugin', () => {
  const scene = {
    nodes: { tree: { id: 'tree', type: 'trees:tree' } },
    rootNodeIds: ['tree'],
  } as unknown as SceneGraph
  expect(sceneFamilies(scene)).toEqual(['other'])
  expect(resolveFamilyVisibility(scene, 'walls').size).toBe(0)
  expect([...resolveFamilyVisibility(scene, 'other')]).toEqual(['tree'])
})
