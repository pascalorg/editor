import { afterEach, describe, expect, test } from 'bun:test'
import useScene from '../store/use-scene'
import { authoredNodeSchemas, NODE_KINDS, NODE_REQUIRED_FIELDS } from './__fixtures__/node-fixtures'
import baseline from './__fixtures__/pre-host-children.json'
import { generateId } from './base'
import {
  compiledNodeParsersEnabled,
  enableCompiledNodeParsers,
  parseNode,
} from './compiled-node-parsers'
import { ColumnNode } from './nodes/column'
import { AnyNode } from './types'

const hosts = ['shelf', 'cabinet', 'cabinet-module', 'block', 'item', 'column'] as const
const schemas = authoredNodeSchemas()
const previous = useScene.getState()
const previousCompiled = compiledNodeParsersEnabled()
afterEach(() => {
  useScene.setState(previous)
  useScene.temporal.getState().clear()
  enableCompiledNodeParsers(previousCompiled)
})
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

function node(kind: string) {
  return AnyNode.parse(schemas.get(kind)!.parse(NODE_REQUIRED_FIELDS[kind] ?? {}))
}
function load(nodes: Record<string, unknown>, rootId: string) {
  useScene.getState().setScene(JSON.parse(JSON.stringify(nodes)), [rootId as AnyNode['id']])
  return JSON.parse(JSON.stringify(useScene.getState().nodes))
}

test('frozen pre-slice corpus covers every existing kind', () => {
  expect(baseline.map((n) => n.type).sort()).toEqual([...NODE_KINDS].sort())
})
test.each(baseline)('pre-slice $type parses and load migrations are stable', (saved) => {
  const expected = saved.type === 'column' ? { ...saved, children: [] } : saved
  expect(JSON.parse(JSON.stringify(AnyNode.parse(saved)))).toEqual(expected)
  const loaded = load({ [saved.id]: saved }, saved.id)
  expect(load(loaded, saved.id)).toEqual(loaded)
})

describe.each([false, true])('host children with compiled parsers = %s', (compiled) => {
  test.each(hosts)('%s accepts every built-in child id and an undeclared plugin id', (kind) => {
    enableCompiledNodeParsers(compiled)
    const host = node(kind)
    const children = [...baseline.map((n) => n.id), generateId('fixture:plugin')]
    const candidate = { ...host, children }
    expect(schemas.get(kind)!.parse(candidate)).toEqual(candidate)
    expect(AnyNode.parse(candidate)).toEqual(candidate)
    expect(parseNode(candidate)).toMatchObject({ success: true, data: candidate })
  })

  test.each(hosts)('legacy %s without children gains an empty array on load', (kind) => {
    enableCompiledNodeParsers(compiled)
    const host = node(kind)
    const legacy = { ...host } as Record<string, unknown>
    delete legacy.children
    expect(AnyNode.parse(legacy)).toEqual({ ...host, children: [] })
    expect(load({ [host.id]: legacy }, host.id)[host.id]).toEqual({ ...host, children: [] })
  })

  test.each(hosts)('%s load keeps unknown-kind children and their order', (kind) => {
    enableCompiledNodeParsers(compiled)
    const host = node(kind)
    const child = node('procedural-item')
    const foreign = {
      ...node('item'),
      id: generateId('fixture'),
      type: 'fixture:plugin',
      parentId: host.id,
    }
    const graph = {
      [host.id]: { ...host, children: [foreign.id, child.id] },
      [foreign.id]: foreign,
      [child.id]: { ...child, parentId: host.id },
    }
    const saved = JSON.parse(JSON.stringify(graph))
    if (kind === 'shelf') delete saved[host.id].rows
    expect(load(saved, host.id)).toEqual(graph)
  })
})

test.each(hosts)('%s still rejects malformed own ids and non-string children', (kind) => {
  const host = node(kind)
  for (const patch of [
    { id: 'wrong-prefix' },
    { children: [null] },
    { children: [42] },
    { children: {} },
  ]) {
    expect(AnyNode.safeParse({ ...host, ...patch }).success).toBe(false)
  }
})

test('block topology, shelf dimensions, cabinet compartments and item URLs remain validated', () => {
  for (const [kind, patch] of [
    [
      'block',
      {
        topology: {
          vertices: [],
          edges: [],
          faces: [{ id: 'face', vertexIds: ['missing', 'also-missing', 'third'] }],
        },
      },
    ],
    ['shelf', { width: -1 }],
    ['cabinet', { stack: [{ id: 'hob', type: 'cooktop-gas', cooktopLayout: 'induction-2zone' }] }],
    [
      'item',
      { asset: { ...(node('item') as { asset: object }).asset, src: 'javascript:alert(1)' } },
    ],
  ] as const) {
    expect(AnyNode.safeParse({ ...node(kind), ...patch }).success).toBe(false)
  }
})

test.each([
  ['shelf', 'procedural-item'],
  ['cabinet', 'item'],
])('%s hosting %s passes the core schema', (hostKind, childKind) => {
  const host = node(hostKind)
  const child = { ...node(childKind), parentId: host.id }
  const candidate = { ...host, children: [child.id] }
  expect(AnyNode.parse(candidate)).toEqual(candidate)
  expect(load({ [host.id]: candidate, [child.id]: child }, host.id)).toEqual({
    [host.id]: candidate,
    [child.id]: child,
  })
})

test.each([
  ['shelf', 'item'],
  ['block', 'item'],
  ['item', 'item'],
  ['item', 'procedural-item'],
  ['cabinet', 'cabinet'],
  ['cabinet', 'cabinet-module'],
  ['cabinet-module', 'cabinet'],
  ['cabinet-module', 'cabinet-module'],
])('previously accepted %s → %s still round-trips', (hostKind, childKind) => {
  const host = node(hostKind)
  const child = { ...node(childKind), parentId: host.id }
  const candidate = { ...host, children: [child.id] }
  expect(AnyNode.parse(candidate)).toEqual(candidate)
  const graph = { [host.id]: candidate, [child.id]: child }
  expect(load(graph, host.id)).toEqual(graph)
})

test('column children is now validated rather than discarded as an unknown field', () => {
  const legacySchema = ColumnNode.omit({ children: true })
  const malformed = { ...node('column'), children: 42 }
  expect(legacySchema.safeParse(malformed).success).toBe(true)
  expect(ColumnNode.safeParse(malformed).success).toBe(false)
})
