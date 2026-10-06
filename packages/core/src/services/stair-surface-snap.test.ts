import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  nodeRegistry,
  registerNode,
  resolveStairSurfaceSnap,
  StairNode,
} from '@pascal-app/core'
import { z } from 'zod'

const stair = StairNode.parse({ parentId: 'level_1', position: [0, 0, -2], width: 1 })
type FixtureSurface = {
  position: number[]
  rotation: number[]
  width: number
  depth: number
  thickness: number
  elevation?: number
  shape: string
}
const surface = (type: string, extra: Record<string, unknown> = {}) => {
  if (!nodeRegistry.has(type))
    registerNode({
      kind: type,
      schemaVersion: 1,
      schema: z.object({ type: z.literal(type) }),
      category: 'site',
      defaults: () => ({}),
      capabilities: {
        surfaces: {
          top: {
            height: (raw: AnyNode) => {
              const node = raw as unknown as FixtureSurface
              return (
                node.thickness +
                (type === 'landscape:patio'
                  ? (node.elevation ?? 0) + Math.min(0.045, node.thickness / 3)
                  : 0)
              )
            },
            boundary: (raw: AnyNode) => {
              const node = raw as unknown as FixtureSurface
              const local: [number, number][] =
                node.shape === 'circle'
                  ? Array.from({ length: 128 }, (_, i) => [
                      (Math.cos((i * Math.PI * 2) / 128) * node.width) / 2,
                      (Math.sin((i * Math.PI * 2) / 128) * node.width) / 2,
                    ])
                  : [
                      [-node.width / 2, -node.depth / 2],
                      [node.width / 2, -node.depth / 2],
                      [node.width / 2, node.depth / 2],
                      [-node.width / 2, node.depth / 2],
                    ]
              const c = Math.cos(node.rotation[1]!),
                s = Math.sin(node.rotation[1]!)
              return local.map(([x, z]): [number, number] => [
                node.position[0]! + x * c + z * s,
                node.position[2]! - x * s + z * c,
              ])
            },
          },
        },
      },
    } as AnyNodeDefinition)
  return {
    id: `${type}_1`,
    type,
    parentId: 'level_1',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    width: 4,
    depth: 3,
    thickness: 0.35,
    shape: 'rectangle',
    ...extra,
  } as unknown as AnyNode
}

test('connects native stairs to a deck and sizes the flight', () => {
  const deck = surface('landscape:deck')
  const result = resolveStairSurfaceSnap(stair, { [deck.id]: deck }, [0, 0, -2], 3)
  expect(result).not.toBeNull()
  expect(result!.position[2] + result!.length).toBeCloseTo(-1.5)
  expect(result!.rotation).toBeCloseTo(0)
  expect(result!.totalRise).toBeCloseTo(0.35)
  expect(result!.stepCount).toBe(2)
  expect(result!.length).toBeGreaterThanOrEqual(0.56)
})

test('reads patio elevation and rotates toward a landing', () => {
  const patio = surface('landscape:patio', { thickness: 0.12, elevation: 0.2 })
  expect(
    resolveStairSurfaceSnap(stair, { [patio.id]: patio }, [0, 0, -2], 3)?.totalRise,
  ).toBeCloseTo(0.36)
  const landing = surface('landscape:landing', { rotation: [0, Math.PI / 2, 0] })
  const result = resolveStairSurfaceSnap(stair, { [landing.id]: landing }, [-2, 0, 0], 3)
  expect(result?.rotation).toBeCloseTo(Math.PI / 2)
  expect(result!.position[0] + result!.length).toBeCloseTo(-1.5)
})

test('does not pull stairs across the scene', () => {
  const deck = surface('landscape:deck')
  expect(resolveStairSurfaceSnap(stair, { [deck.id]: deck }, [20, 0, 20], 3)).toBeNull()
})

test('connects to a concrete slab and accepts a cursor on its edge', () => {
  const slab = surface('landscape:concrete-slab', { thickness: 0.18 })
  const result = resolveStairSurfaceSnap(stair, { [slab.id]: slab }, [0, 0, -1.5], 3)
  expect(result?.totalRise).toBeCloseTo(0.18)
  expect(result!.position[2] + result!.length).toBeCloseTo(-1.5)
})

test('per-stair switch disables magnetic attachment', () => {
  const deck = surface('landscape:deck')
  const disabled = StairNode.parse({ ...stair, autoLandscapeSnap: false })
  expect(resolveStairSurfaceSnap(disabled, { [deck.id]: deck }, [0, 0, -2], 3)).toBeNull()
  expect(StairNode.parse({}).autoLandscapeSnap).toBeUndefined()
})

test('reconnects a placed stair after its deck height changes', () => {
  const deck = surface('landscape:deck', { thickness: 0.35 })
  const first = resolveStairSurfaceSnap(stair, { [deck.id]: deck }, [0, 0, -2], 3)!
  const placed = StairNode.parse({
    ...stair,
    position: first.position,
    rotation: first.rotation,
    landscapeSurfaceId: deck.id,
    totalRise: first.totalRise,
    stepCount: first.stepCount,
  })
  const tallerDeck = surface('landscape:deck', { thickness: 1.2 })
  const result = resolveStairSurfaceSnap(
    placed,
    { [tallerDeck.id]: tallerDeck },
    [first.position[0], 0, first.position[2] - 0.4],
    first.length,
  )
  expect(result?.totalRise).toBeCloseTo(1.2)
  expect(result?.stepCount).toBe(8)
  expect(result?.length).toBeGreaterThan(first.length)
  expect(result!.position[2] + result!.length).toBeCloseTo(-1.5)
})

test('reconnects by the rotated high end of an existing stair', () => {
  const deck = surface('landscape:deck', { thickness: 0.8 })
  const rotated = StairNode.parse({ ...stair, rotation: Math.PI / 2, landscapeSurfaceId: deck.id })
  const result = resolveStairSurfaceSnap(rotated, { [deck.id]: deck }, [-2.3, 0, 0], 0.8)
  expect(result?.totalRise).toBeCloseTo(0.8)
  expect(result?.rotation).toBeCloseTo(Math.PI / 2)
})

test('fits from the supported stair base when the deck height changes', () => {
  const deck = surface('landscape:deck', { thickness: 1.2 })
  const result = resolveStairSurfaceSnap(stair, { [deck.id]: deck }, [0, 0, -2], 3, 0.2)
  expect(result?.totalRise).toBeCloseTo(1)
  expect(result?.stepCount).toBe(6)
})

test('aligns to the actual curved edge of a circular patio', () => {
  const patio = surface('landscape:patio', { shape: 'circle', width: 4, depth: 4 })
  const result = resolveStairSurfaceSnap(stair, { [patio.id]: patio }, [0, 0, -2.2], 1)
  expect(result).not.toBeNull()
  expect(result!.position[2] + result!.length).toBeCloseTo(-2, 2)
  expect(result!.rotation).toBeCloseTo(0, 1)
})
