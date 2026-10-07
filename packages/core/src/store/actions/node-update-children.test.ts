import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../../registry/registry'
import { nodeFixtures } from '../../schema/__fixtures__/node-fixtures'
import { BaseNode, nodeType, objectId } from '../../schema/base'
import {
  compiledNodeParsersEnabled,
  enableCompiledNodeParsers,
} from '../../schema/compiled-node-parsers'
import { ItemNode } from '../../schema/nodes/item'
import { SlabNode } from '../../schema/nodes/slab'
import type { AnyNode } from '../../schema/types'
import useScene from '../use-scene'

let restoreRegistry: () => void
let savedScene: ReturnType<typeof useScene.getState>
let compiled: boolean
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame
beforeEach(() => {
  savedScene = useScene.getState()
  compiled = compiledNodeParsersEnabled()
  savedRaf = globalThis.requestAnimationFrame
  savedCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set(), readOnly: false })
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useScene.setState(savedScene)
  useScene.temporal.getState().clear()
  restoreRegistry()
  enableCompiledNodeParsers(compiled)
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})

const writers = {
  updateNode: (node: AnyNode, data: Partial<AnyNode>) =>
    useScene.getState().updateNode(node.id, data),
  updateNodes: (node: AnyNode, data: Partial<AnyNode>) =>
    useScene.getState().updateNodes([{ id: node.id, data }]),
  applyNodeChanges: (node: AnyNode, data: Partial<AnyNode>) =>
    useScene.getState().applyNodeChanges({ update: [{ id: node.id, data }] }),
}
const child = ItemNode.parse({
  asset: { id: 'child', name: 'Child', category: 'decor', thumbnail: '', src: '/child.glb' },
})
function seed(node: AnyNode) {
  useScene.setState({
    nodes: { [node.id]: node, [child.id]: { ...child, parentId: node.id } },
    rootNodeIds: [node.id],
  })
}
function children(node: AnyNode) {
  return (useScene.getState().nodes[node.id] as AnyNode & { children?: string[] }).children
}

for (const [writer, write] of Object.entries(writers)) {
  describe.each([false, true])(`${writer}, compiled parser = %s`, (enabled) => {
    test.each([
      ...nodeFixtures(),
    ])('%s keeps existing children when the patch omits them', (_kind, fixture) => {
      enableCompiledNodeParsers(enabled)
      const node = { ...fixture, children: [child.id] } as AnyNode
      seed(node)
      write(node, { name: 'Edited host' })
      expect(children(node)).toEqual([child.id])
      expect(useScene.getState().nodes[node.id]!.name).toBe('Edited host')
      expect(useScene.getState().nodes[child.id]!.parentId).toBe(node.id)
    })
  })
}

test.each([
  { elevation: 0.0525 },
  { thickness: 0.0525 },
  { elevation: 0.0525, thickness: 0.0525 },
  { slots: { surface: 'library:concrete' } },
])('slab edit %j preserves the saved subtree, undo and descendant deletion', (patch) => {
  const slab = {
    ...SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
    }),
    children: [child.id],
  }
  seed(slab)
  useScene.getState().updateNode(slab.id, patch)
  expect(children(slab)).toEqual([child.id])
  expect(JSON.parse(JSON.stringify(useScene.getState().nodes))[slab.id].children).toEqual([
    child.id,
  ])
  useScene.temporal.getState().undo()
  expect(children(slab)).toEqual([child.id])
  useScene.temporal.getState().redo()
  expect(children(slab)).toEqual([child.id])
  useScene.getState().deleteNode(slab.id)
  expect(useScene.getState().nodes[child.id]).toBeUndefined()
})

test('explicit children clearing still uses the schema', () => {
  const host = ItemNode.parse({ asset: child.asset, children: [child.id] })
  seed(host)
  expect(children(host)).toEqual([child.id])
  useScene.getState().updateNode(host.id, { children: [] })
  expect(children(host)).toEqual([])
})

test('an explicit children removal on a schema without children does not restore the old array', () => {
  const slab = { ...SlabNode.parse({ polygon: [] }), children: [child.id] }
  seed(slab)
  useScene.getState().updateNode(slab.id, { children: undefined })
  expect(children(slab)).toBeUndefined()
})

test('strict plugin updates preserve children while still rejecting invalid own fields', () => {
  const schema = BaseNode.extend({
    id: objectId('test-host'),
    type: nodeType('test-host'),
    width: z.number().positive(),
  }).meta({ strictMutations: true })
  registerNode({
    kind: 'test-host',
    schemaVersion: 1,
    schema,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {},
  })
  const host = { ...schema.parse({ width: 1 }), children: [child.id] } as unknown as AnyNode
  seed(host)
  for (const write of Object.values(writers)) {
    write(host, { name: 'Strict host' })
    expect(children(host)).toEqual([child.id])
    expect(() => write(host, { width: -1 } as Partial<AnyNode>)).toThrow()
    expect(children(host)).toEqual([child.id])
  }
})
