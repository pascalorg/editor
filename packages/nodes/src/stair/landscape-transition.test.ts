import { expect, test } from 'bun:test'
import { StairNode } from '@pascal-app/core'
import { landscapeTransitionProfile } from './landscape-transition'

const stair = StairNode.parse({ position: [0, 0, -3.5], rotation: 0,
  width: 1, totalRise: 0.35, landscapeSurfaceId: 'patio_1' })

test('bridges the gap from a straight stair to a circular patio', () => {
  const profile = landscapeTransitionProfile(stair, {
    position: [0, 0, 0], width: 4, depth: 4, shape: 'circle',
  }, 1.5)
  expect(profile).not.toBeNull()
  expect(profile!.frontZ).toBe(0)
  expect(profile!.samples[0]![1]).toBeGreaterThan(0)
  expect(Math.abs(profile!.samples.find(([x]) => Math.abs(x) < 1e-6)![1])).toBeLessThan(0.01)
  expect(profile!.samples.at(-1)![1]).toBeCloseTo(profile!.samples[0]![1])
  expect(profile!.samples.length).toBeGreaterThan(3)
})

test('follows a custom polygon and skips a disconnected edge', () => {
  const custom = { position: [0, 0, 0] as [number, number, number], width: 4,
    depth: 4, shape: 'custom', outline: [[-0.5, -0.5], [0, -0.45],
      [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as [number, number][] }
  expect(landscapeTransitionProfile(stair, custom, 1.5)?.samples.find(([x]) => x === 0)?.[1]).toBeCloseTo(0.2)
  expect(landscapeTransitionProfile(stair, custom, 0.5)).toBeNull()
})

test('keeps the same boundary after the stair becomes a rotated surface child', () => {
  const surface = { position: [4, 0, 3] as [number, number, number],
    rotation: [0, Math.PI / 2, 0] as [number, number, number],
    width: 4, depth: 4, shape: 'circle' }
  const levelStair = StairNode.parse({ ...stair, position: [5, 0, 2],
    rotation: Math.PI / 2 })
  const childStair = StairNode.parse({ ...levelStair, parentId: 'patio_1',
    position: [1, 0, 1], rotation: 0 })
  expect(landscapeTransitionProfile(childStair, surface, 1.5)?.samples)
    .toEqual(landscapeTransitionProfile(levelStair, surface, 1.5)?.samples)
})
