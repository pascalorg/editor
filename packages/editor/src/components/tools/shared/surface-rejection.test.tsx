import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  ItemNode,
  nodeRegistry,
  registerNode,
  resolveSurfacePlacement,
  type SceneApi,
  type SurfaceProvider,
  type SurfaceRejectReason,
} from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSurfaceRejectionFeedback, SurfaceRejectionLabel } from './surface-rejection'

let restore: () => void
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
})
afterEach(() => restore())

for (const [reason, wording] of [
  ['footprint-outside-surface', "Doesn't fit this surface"],
  ['footprint-exceeds-host', "Doesn't fit this surface"],
  ['surface-cutout', 'Over a sink or hob cutout'],
  ['child-not-accepted', "This host doesn't accept this kind of object"],
  ['host-not-eligible', "This host doesn't accept this kind of object"],
  ['no-surface', 'No supporting surface here'],
  ['invalid-hit', 'No supporting surface here'],
] as const) {
  test(`${reason} reaches the preview's status wording from onReject`, () => {
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
    registerNode({
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
        childFootprint: {
          size: reason === 'footprint-outside-surface' ? [3, 1, 3] : [0.3, 0.3, 0.3],
          rotationY: 0,
        },
        hit: { point: [0, reason === 'invalid-hit' ? NaN : 1, 0], normalWorldY: 1 },
        scene: { get: () => undefined, nodes: () => ({}) } as unknown as SceneApi,
        onReject: (r) => feedback.reject(r),
      }),
    ).toBeNull()
    expect(feedback.reason).toBe(reason)
    const label = SurfaceRejectionLabel({ reason: feedback.reason, position: [0, 1, 0] })!
    expect(label.props.children.props.children).toBe(wording)
    expect(renderToStaticMarkup(label.props.children)).toContain('role="status"')
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
  expect(SurfaceRejectionLabel({ reason: feedback.reason, position: [0, 0, 0] })).toBeNull()
  feedback.reject('surface-cutout', event)
  feedback.clear()
  expect(changes).toEqual(['footprint-exceeds-host', null, 'surface-cutout', null])
})
