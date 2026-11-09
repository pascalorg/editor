import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  nodeRegistry,
  registerNode,
  StairNode,
} from '@pascal-app/core'
import { z } from 'zod'
import { surfaceTransitionProfile } from './surface-transition'

function surfaceFixture(
  pose: { position: [number, number, number]; rotation?: [number, number, number] },
  points: [number, number][],
): AnyNode {
  const type = 'test:curved-platform'
  if (!nodeRegistry.has(type))
    registerNode({
      kind: type,
      schemaVersion: 1,
      schema: z.object({ type: z.literal(type) }),
      defaults: () => ({}),
      category: 'site',
      capabilities: {
        surfaces: {
          top: {
            height: 0.35,
            boundary: (node: AnyNode) => {
              const surface = node as AnyNode & {
                edge: [number, number][]
                position: [number, number, number]
                rotation?: [number, number, number]
              }
              const c = Math.cos(surface.rotation?.[1] ?? 0),
                s = Math.sin(surface.rotation?.[1] ?? 0)
              return surface.edge.map(
                ([x, z]) =>
                  [surface.position[0] + x * c + z * s, surface.position[2] - x * s + z * c] as [
                    number,
                    number,
                  ],
              )
            },
          },
        },
      },
    } as AnyNodeDefinition)
  return { id: 'patio_1', type, ...pose, edge: points } as unknown as AnyNode
}
const circle = Array.from({ length: 128 }, (_, i): [number, number] => [
  2 * Math.cos((i * Math.PI) / 64),
  2 * Math.sin((i * Math.PI) / 64),
])

const stair = StairNode.parse({
  position: [0, 0, -3.5],
  rotation: 0,
  width: 1,
  totalRise: 0.35,
  destinationSurfaceId: 'patio_1',
})

test('bridges the gap from a straight stair to a circular patio', () => {
  const profile = surfaceTransitionProfile(
    stair,
    surfaceFixture({ position: [0, 0, 0] }, circle),
    1.5,
  )
  expect(profile).not.toBeNull()
  expect(profile!.frontZ).toBe(0)
  expect(profile!.samples[0]![1]).toBeGreaterThan(0)
  expect(Math.abs(profile!.samples.find(([x]) => Math.abs(x) < 1e-6)![1])).toBeLessThan(0.01)
  expect(profile!.samples.at(-1)![1]).toBeCloseTo(profile!.samples[0]![1])
  expect(profile!.samples.length).toBeGreaterThan(3)
})

test('follows a custom polygon and skips a disconnected edge', () => {
  const custom = surfaceFixture({ position: [0, 0, 0] }, [
    [-2, -2],
    [0, -1.8],
    [2, -2],
    [2, 2],
    [-2, 2],
  ])
  expect(
    surfaceTransitionProfile(stair, custom, 1.5)?.samples.find(([x]) => x === 0)?.[1],
  ).toBeCloseTo(0.2)
  expect(surfaceTransitionProfile(stair, custom, 0.5)).toBeNull()
})

test('keeps the same boundary after the stair becomes a rotated surface child', () => {
  const surface = surfaceFixture({ position: [4, 0, 3], rotation: [0, Math.PI / 2, 0] }, circle)
  const levelStair = StairNode.parse({ ...stair, position: [5, 0, 2], rotation: Math.PI / 2 })
  const childStair = StairNode.parse({
    ...levelStair,
    parentId: 'patio_1',
    position: [1, 0, 1],
    rotation: 0,
  })
  expect(surfaceTransitionProfile(childStair, surface, 1.5)?.samples).toEqual(
    surfaceTransitionProfile(levelStair, surface, 1.5)?.samples,
  )
})
