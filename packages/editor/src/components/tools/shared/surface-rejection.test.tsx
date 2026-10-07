import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  ItemNode,
  nodeRegistry,
  resolveSurfacePlacement,
  type SceneApi,
  type SurfaceProvider,
  type SurfaceRejectReason,
} from '@pascal-app/core'
import { registerHostingTestNode } from '../__fixtures__/hosting'
import { createSurfaceRejectionFeedback } from './surface-rejection'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
})
afterEach(() => restore())

for (const reason of [
  'footprint-outside-surface',
  'footprint-exceeds-host',
  'surface-cutout',
  'child-not-accepted',
  'host-not-eligible',
  'no-surface',
  'invalid-hit',
] as const) {
  test(`${reason}: eligible-host diagnostics remain available; ineligible hosts defer silently`, () => {
    const provider: SurfaceProvider = {
      childFrame: 'host-local',
      resolveHit: () =>
        reason === 'no-surface'
          ? null
          : {
              id: 'top',
              position: [0, 1, 0],
              normal: [0, 1, 0],
              region: {
                kind: 'rect',
                size: [1, 1],
                ...(reason === 'surface-cutout'
                  ? {
                      holes: [
                        [
                          [-0.2, -0.2],
                          [0.2, -0.2],
                          [0.2, 0.2],
                          [-0.2, 0.2],
                        ],
                      ],
                    }
                  : {}),
              },
            },
      accepts: () => reason !== 'child-not-accepted',
    }
    registerHostingTestNode({
      kind: 'test-host',
      schemaVersion: 1,
      schema: ItemNode,
      category: 'furnish',
      defaults: () => ({}),
      capabilities:
        reason === 'footprint-exceeds-host'
          ? { dragBounds: () => ({ size: [0.1, 1, 0.1] }) }
          : { surfaces: { hosting: provider } },
    })
    const feedback = createSurfaceRejectionFeedback()
    expect(
      resolveSurfacePlacement({
        host: {
          id: 'test_host',
          type: reason === 'host-not-eligible' ? 'guide' : 'test-host',
        } as unknown as AnyNode,
        childKind: 'item',
        childId: 'item_existing',
        childFootprint: {
          size: reason === 'footprint-outside-surface' ? [3, 1, 3] : [0.3, 0.3, 0.3],
          rotationY: 0,
        },
        hit: {
          point: [reason.startsWith('footprint-') ? 2 : 0, reason === 'invalid-hit' ? NaN : 1, 0],
          normalWorldY: 1,
        },
        scene: { get: () => undefined, nodes: () => ({}) } as unknown as SceneApi,
        onReject: (r) => feedback.reject(r),
      }),
    ).toBeNull()
    expect(feedback.reason).toBe(reason === 'host-not-eligible' ? null : reason)
  })
}

test('the paired grid cannot erase a refusal; a new floor move and cleanup clear it', () => {
  const changes: (SurfaceRejectReason | null)[] = []
  const feedback = createSurfaceRejectionFeedback((r) => changes.push(r))
  const event = {}
  feedback.reject('footprint-exceeds-host', event)
  feedback.grid(event)
  expect(feedback.reason).toBe('footprint-exceeds-host')
  feedback.grid({})
  expect(feedback.reason).toBeNull()
  feedback.reject('surface-cutout', event)
  feedback.clear()
  expect(changes).toEqual(['footprint-exceeds-host', null, 'surface-cutout', null])
})
