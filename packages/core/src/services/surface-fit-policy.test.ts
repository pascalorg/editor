import { afterEach, beforeEach, expect, test } from 'bun:test'
import { nodeRegistry } from '../registry/registry'
import type { SceneApi } from '../registry/types'
import { ShelfNode } from '../schema/nodes/shelf'
import type { AnyNode } from '../schema/types'
import { registerHostingTestNode } from './__fixtures__/hosting'
import { resolveSurfacePlacement, shelfSurfaceProvider } from './surface-hosting'

const scene = { nodes: () => ({}), get: () => undefined } as unknown as SceneApi
let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerHostingTestNode({
    kind: 'shelf',
    schemaVersion: 1,
    schema: ShelfNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: { surfaces: { custom: () => [{ position: [0, 1, 0], normal: [0, 1, 0] }] } },
  })
})
afterEach(() => restore())

test('a generated design larger than the actual shelf board is accepted at its centre', () => {
  const host = ShelfNode.parse({ width: 1.2, depth: 0.5 })
  expect(
    resolveSurfacePlacement({
      host,
      childKind: 'procedural-item',
      childId: 'procedural-item_fit-probe',
      childFootprint: { size: [2, 0.3, 1], rotationY: 0 },
      hit: { point: [0, 1, 0], normalWorldY: 1 },
      scene,
    }),
  ).not.toBeNull()
})

test('a centre on the board boundary accepts floating point noise but refuses a centre outside', () => {
  const host = ShelfNode.parse({ width: 1.2, depth: 0.5 })
  const region = shelfSurfaceProvider.surfaces!(host, { scene })[0]!.region!
  expect(region).toBeDefined()
  for (const [offset, fits] of [
    [0, true],
    [1e-7, true],
    [1e-4, false],
  ] as const) {
    expect(
      resolveSurfacePlacement({
        host,
        childKind: 'item',
        childId: 'item_fit-probe',
        childFootprint: { size: [region.size![0] * 2, 0.2, region.size![1] * 2], rotationY: 0 },
        hit: { point: [region.size![0] + offset, 1, 0], normalWorldY: 1 },
        scene,
      }) !== null,
    ).toBe(fits)
  }
})

test('a hit-derived host accepts rotated overhang while the centre remains on it', () => {
  registerHostingTestNode({
    kind: 'plugin-host',
    schemaVersion: 1,
    schema: ShelfNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: { dragBounds: () => ({ size: [1, 1, 0.5] }) },
  })
  const host = { id: 'plugin_host', type: 'plugin-host' } as unknown as AnyNode
  for (const [size, yaw, fits] of [
    [[0.8, 0.2, 0.4], 0, true],
    [[0.8, 0.2, 0.4], Math.PI / 2, true],
    [[0.4, 0.2, 0.8], 0, true],
    [[0.4, 0.2, 0.8], Math.PI / 2, true],
  ] as const) {
    expect(
      resolveSurfacePlacement({
        host,
        childKind: 'item',
        childId: 'item_fit-probe',
        childFootprint: { size, rotationY: yaw },
        hit: { point: [0.49, 0.8, 0.24], normalWorldY: 1 },
        scene,
      }) !== null,
    ).toBe(fits)
  }
})

test('a malformed declared provider fails loudly even for an unchecked preview', () => {
  registerHostingTestNode({
    kind: 'broken-host',
    schemaVersion: 1,
    schema: ShelfNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: {
      surfaces: {
        hosting: {
          childFrame: 'host-local',
          // Simulate an untyped plugin violating the declaration contract.
          resolveHit: () => ({ id: 'top', position: [0, 1, 0], normal: [0, 1, 0] }) as never,
        },
      },
    },
  })
  for (const checkFootprint of [true, false]) {
    expect(() =>
      resolveSurfacePlacement({
        host: { id: 'broken_host', type: 'broken-host' } as unknown as AnyNode,
        childKind: 'item',
        childId: 'item_fit-probe',
        childFootprint: { size: [0.1, 0.1, 0.1], rotationY: 0 },
        hit: { point: [0, 1, 0], normalWorldY: 1 },
        scene,
        checkFootprint,
      }),
    ).toThrow('Declared surface broken-host:top must publish a region')
  }
})

test('a mug may overhang two table edges until its centre crosses either edge', () => {
  registerHostingTestNode({
    kind: 'table',
    schemaVersion: 1,
    schema: ShelfNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: { dragBounds: () => ({ size: [1, 1, 1] }) },
  })
  const host = { id: 'table_test', type: 'table' } as unknown as AnyNode
  for (const [x, accepted] of [
    [0.49, true],
    [0.5, true],
    [0.5000001, true],
    [0.5001, false],
  ] as const) {
    const reasons: string[] = []
    const result = resolveSurfacePlacement({
      host,
      childKind: 'item',
      childId: 'item_fit-probe',
      childFootprint: { size: [0.2, 0.1, 0.2], rotationY: Math.PI / 4 },
      hit: { point: [x, 1, 0.49], normalWorldY: 1 },
      scene,
      onReject: (reason) => reasons.push(reason),
    })
    expect(result !== null).toBe(accepted)
    if (result) expect(result.position).toEqual([x, 1, 0.49])
    else expect(reasons).toEqual(['footprint-exceeds-host'])
  }
})

test('fit follows the snapped centre without moving it back onto the board', () => {
  const host = ShelfNode.parse({ width: 1.2, depth: 0.5 })
  const halfWidth = shelfSurfaceProvider.surfaces!(host, { scene })[0]!.region.size![0]
  for (const [x, accepted] of [
    [halfWidth, true],
    [halfWidth + 0.01, false],
  ] as const) {
    const result = resolveSurfacePlacement({
      host,
      childKind: 'item',
      childId: 'item_fit-probe',
      childFootprint: { size: [2, 0.1, 2], rotationY: 0 },
      hit: { point: [halfWidth - 0.01, 1, 0.1], normalWorldY: 1 },
      scene,
      snapScalar: (p) => (p === 0.1 ? 0 : x),
    })
    expect(result !== null).toBe(accepted)
    if (result) expect(result.position[0]).toBe(x)
  }
})

test('the rotated bounds midpoint, including pitch and an offset origin, decides fit', () => {
  const host = ShelfNode.parse({ width: 1.2, depth: 0.5 })
  const localBounds = { min: [0.3, 0, -0.1], max: [0.5, 1, 0.1] } as const
  for (const [rotation, accepted] of [
    [[0, 0, 0], true],
    [[0, Math.PI / 2, 0], false],
    [[Math.PI / 2, 0, 0], false],
  ] as const) {
    expect(
      resolveSurfacePlacement({
        host,
        childKind: 'procedural-item',
        childId: 'procedural-item_fit-probe',
        childFootprint: { size: [0.2, 1, 0.2], rotationY: rotation[1], rotation, localBounds },
        hit: { point: [0, 1, 0], normalWorldY: 1 },
        scene,
      }) !== null,
    ).toBe(accepted)
  }
})

test('hit-derived bounds retain an offset host centre', () => {
  registerHostingTestNode({
    kind: 'offset-table',
    schemaVersion: 1,
    schema: ShelfNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: { dragBounds: () => ({ size: [1, 1, 1], center: [2, 0.5, -1] }) },
  })
  for (const [x, accepted] of [
    [2.49, true],
    [0, false],
    [2.51, false],
  ] as const) {
    expect(
      resolveSurfacePlacement({
        host: { id: 'offset_table', type: 'offset-table' } as unknown as AnyNode,
        childKind: 'item',
        childId: 'item_fit-probe',
        childFootprint: { size: [4, 1, 4], rotationY: 0 },
        hit: { point: [x, 1, -1], normalWorldY: 1 },
        scene,
      }) !== null,
    ).toBe(accepted)
  }
})
