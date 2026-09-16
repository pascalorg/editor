import { afterEach, beforeEach, expect, test } from 'bun:test'
import { nodeRegistry, registerNode } from '../registry/registry'
import type { SceneApi } from '../registry/types'
import { ShelfNode } from '../schema/nodes/shelf'
import type { AnyNode } from '../schema/types'
import { resolveSurfacePlacement, shelfSurfaceProvider } from './surface-hosting'

const scene = { nodes: () => ({}), get: () => undefined } as unknown as SceneApi
let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerNode({
    kind: 'shelf',
    schemaVersion: 1,
    schema: ShelfNode,
    category: 'furnish',
    defaults: () => ({}),
    capabilities: { surfaces: { custom: () => [{ position: [0, 1, 0], normal: [0, 1, 0] }] } },
  })
})
afterEach(() => restore())

test('a generated design deeper than the actual shelf board is refused', () => {
  const host = ShelfNode.parse({ width: 1.2, depth: 0.5 })
  expect(
    resolveSurfacePlacement({
      host,
      childKind: 'procedural-item',
      childFootprint: { size: [0.4, 0.3, 0.499], rotationY: 0 },
      hit: { point: [0, 1, 0], normalWorldY: 1 },
      scene,
    }),
  ).toBeNull()
})

test('a centred exact board fit accepts floating point noise but refuses genuine overhang', () => {
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
        childFootprint: { size: [region.size![0] * 2, 0.2, region.size![1] * 2], rotationY: 0 },
        hit: { point: [offset, 1, 0], normalWorldY: 1 },
        scene,
      }) !== null,
    ).toBe(fits)
  }
})

test('a hit-derived host judges rotated extents in both directions, independently of the hit position', () => {
  registerNode({
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
    [[0.8, 0.2, 0.4], Math.PI / 2, false],
    [[0.4, 0.2, 0.8], 0, false],
    [[0.4, 0.2, 0.8], Math.PI / 2, true],
  ] as const) {
    expect(
      resolveSurfacePlacement({
        host,
        childKind: 'item',
        childFootprint: { size, rotationY: yaw },
        hit: { point: [0.49, 0.8, 0.24], normalWorldY: 1 },
        scene,
      }) !== null,
    ).toBe(fits)
  }
})

test('a malformed declared provider fails loudly even for an unchecked preview', () => {
  registerNode({
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
        childFootprint: { size: [0.1, 0.1, 0.1], rotationY: 0 },
        hit: { point: [0, 1, 0], normalWorldY: 1 },
        scene,
        checkFootprint,
      }),
    ).toThrow('Declared surface broken-host:top must publish a region')
  }
})
