import { expect, test } from 'bun:test'
import { StairNode, type AnyNode } from '@pascal-app/core'
import { resolveLandscapeStairSnap } from './landscape-snap'

const stair = StairNode.parse({ parentId: 'level_1', position: [0, 0, -2], width: 1 })
const surface = (type: string, extra: Record<string, unknown> = {}) => ({
  id: `${type}_1`, type, parentId: 'level_1', position: [0, 0, 0], rotation: [0, 0, 0],
  width: 4, depth: 3, thickness: 0.35, shape: 'rectangle', ...extra,
}) as unknown as AnyNode

test('connects native stairs to a deck and sizes the flight', () => {
  const deck = surface('landscape:deck')
  const result = resolveLandscapeStairSnap(stair, { [deck.id]: deck }, [0, 0, -2], 3)
  expect(result).not.toBeNull()
  expect(result!.position[2] + result!.length).toBeCloseTo(-1.5)
  expect(result!.rotation).toBeCloseTo(0)
  expect(result!.totalRise).toBeCloseTo(0.35)
  expect(result!.stepCount).toBe(2)
  expect(result!.length).toBeGreaterThanOrEqual(0.56)
})

test('reads patio elevation and rotates toward a landing', () => {
  const patio = surface('landscape:patio', { thickness: 0.12, elevation: 0.2 })
  expect(resolveLandscapeStairSnap(stair, { [patio.id]: patio }, [0, 0, -2], 3)?.totalRise)
    .toBeCloseTo(0.36)
  const landing = surface('landscape:landing', { rotation: [0, Math.PI / 2, 0] })
  const result = resolveLandscapeStairSnap(stair, { [landing.id]: landing }, [-2, 0, 0], 3)
  expect(result?.rotation).toBeCloseTo(Math.PI / 2)
  expect(result!.position[0] + result!.length).toBeCloseTo(-1.5)
})

test('does not pull stairs across the scene', () => {
  const deck = surface('landscape:deck')
  expect(resolveLandscapeStairSnap(stair, { [deck.id]: deck }, [20, 0, 20], 3)).toBeNull()
})

test('connects to a concrete slab and accepts a cursor on its edge', () => {
  const slab = surface('landscape:concrete-slab', { thickness: 0.18 })
  const result = resolveLandscapeStairSnap(stair, { [slab.id]: slab }, [0, 0, -1.5], 3)
  expect(result?.totalRise).toBeCloseTo(0.18)
  expect(result!.position[2] + result!.length).toBeCloseTo(-1.5)
})

test('per-stair switch disables magnetic attachment', () => {
  const deck = surface('landscape:deck')
  const disabled = StairNode.parse({ ...stair, autoLandscapeSnap: false })
  expect(resolveLandscapeStairSnap(disabled, { [deck.id]: deck }, [0, 0, -2], 3)).toBeNull()
  expect(StairNode.parse({}).autoLandscapeSnap).toBe(true)
})

test('reconnects a placed stair after its deck height changes', () => {
  const deck = surface('landscape:deck', { thickness: 0.35 })
  const first = resolveLandscapeStairSnap(stair, { [deck.id]: deck }, [0, 0, -2], 3)!
  const placed = StairNode.parse({ ...stair, position: first.position, rotation: first.rotation,
    landscapeSurfaceId: deck.id, totalRise: first.totalRise, stepCount: first.stepCount })
  const tallerDeck = surface('landscape:deck', { thickness: 1.2 })
  const result = resolveLandscapeStairSnap(placed, { [tallerDeck.id]: tallerDeck },
    [first.position[0], 0, first.position[2] - 0.4], first.length)
  expect(result?.totalRise).toBeCloseTo(1.2)
  expect(result?.stepCount).toBe(8)
  expect(result?.length).toBeGreaterThan(first.length)
  expect(result!.position[2] + result!.length).toBeCloseTo(-1.5)
})

test('reconnects by the rotated high end of an existing stair', () => {
  const deck = surface('landscape:deck', { thickness: 0.8 })
  const rotated = StairNode.parse({ ...stair, rotation: Math.PI / 2,
    landscapeSurfaceId: deck.id })
  const result = resolveLandscapeStairSnap(rotated, { [deck.id]: deck }, [-2.3, 0, 0], 0.8)
  expect(result?.totalRise).toBeCloseTo(0.8)
  expect(result?.rotation).toBeCloseTo(Math.PI / 2)
})

test('fits from the supported stair base when the deck height changes', () => {
  const deck = surface('landscape:deck', { thickness: 1.2 })
  const result = resolveLandscapeStairSnap(stair, { [deck.id]: deck }, [0, 0, -2], 3, 0.2)
  expect(result?.totalRise).toBeCloseTo(1)
  expect(result?.stepCount).toBe(6)
})


test('aligns to the actual curved edge of a circular patio', () => {
  const patio = surface('landscape:patio', { shape: 'circle', width: 4, depth: 4 })
  const result = resolveLandscapeStairSnap(stair, { [patio.id]: patio }, [0, 0, -2.2], 1)
  expect(result).not.toBeNull()
  expect(result!.position[2] + result!.length).toBeCloseTo(-2, 2)
  expect(result!.rotation).toBeCloseTo(0, 1)
})
