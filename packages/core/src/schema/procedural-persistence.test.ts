import { afterEach, describe, expect, test } from 'bun:test'
import { shelfRecipe } from '../procedural-items/fixtures'
import { ProceduralItemNode } from '../procedural-items/node'
import useScene from '../store/use-scene'
import { NODE_REQUIRED_FIELDS } from './__fixtures__/node-fixtures'
import {
  compiledNodeParsersEnabled,
  enableCompiledNodeParsers,
  parseNode,
} from './compiled-node-parsers'
import { ItemNode } from './nodes/item'
import { AnyNode, nodeKindOf } from './types'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const child = ProceduralItemNode.parse({ recipe: shelfRecipe })
const host = {
  ...ItemNode.parse(NODE_REQUIRED_FIELDS.item),
  children: [child.id],
}

test('AnyNode persists procedural items with a bare discriminator and mutation metadata', () => {
  expect(AnyNode.parse(child)).toEqual(child)
  const member = AnyNode.options.find((option) => nodeKindOf(option) === 'procedural-item')
  expect(member?.meta()).toEqual(ProceduralItemNode.meta())
})

test('ItemNode.parse accepts a procedural child alongside catalog children', () => {
  const catalogChild = ItemNode.parse(NODE_REQUIRED_FIELDS.item)
  const candidate = { ...host, children: [catalogChild.id, child.id] }
  expect(ItemNode.parse(candidate)).toEqual(candidate)
})

test('AnyNode retains procedural recipe and node refinements', () => {
  for (const patch of [
    { recipe: {} },
    { parameters: { width: -1 } },
    { slots: { missing: '#ffffff' } },
    { children: [host.id], attachments: { [host.id]: 'missing-surface' } },
  ]) {
    expect(AnyNode.safeParse({ ...child, ...patch }).success).toBe(false)
  }
})

describe.each([false, true])('procedural host updates with compiled parsers = %s', (compiled) => {
  const previousCompiled = compiledNodeParsersEnabled()
  afterEach(() => enableCompiledNodeParsers(previousCompiled))

  test('parseNode validates the updated catalog host', () => {
    enableCompiledNodeParsers(compiled)
    const candidate = { ...host, name: 'Updated host' }
    const parsed = parseNode(candidate)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(candidate)
  })

  test('updateNode takes the successful parse path and fills legacy asset defaults', () => {
    enableCompiledNodeParsers(compiled)
    const previous = useScene.getState()
    const { source: _source, ...legacyAsset } = host.asset
    useScene.setState({
      nodes: {
        [host.id]: { ...host, asset: legacyAsset } as ItemNode,
        [child.id]: { ...child, parentId: host.id },
      },
      rootNodeIds: [host.id],
      dirtyNodes: new Set(),
      collections: {},
      readOnly: false,
    })
    try {
      useScene.getState().updateNode(host.id, { name: 'Updated host' })
      const updated = useScene.getState().nodes[host.id] as ItemNode
      expect(updated.name).toBe('Updated host')
      expect(updated.children).toEqual([child.id])
      // Only a successful parse fills this default; the fallback keeps it absent.
      expect(updated.asset.source).toBe('library')
    } finally {
      useScene.setState(previous)
      useScene.temporal.getState().clear()
    }
  })
})
