import { describe, expect, it } from 'bun:test'
import { LevelNode, StairNode } from '../../schema'
import { resolveStairTotalRise } from './stair-rise'

function buildScene(levelHeight: number | undefined, totalRise: number | undefined) {
  const stair = StairNode.parse({
    id: 'stair_1',
    type: 'stair',
    position: [0, 0, 0],
    ...(totalRise !== undefined ? { totalRise } : {}),
  })
  const level = LevelNode.parse({
    id: 'level_1',
    type: 'level',
    level: 0,
    children: ['stair_1'],
    ...(levelHeight !== undefined ? { height: levelHeight } : {}),
  })
  return { stair, nodes: { level_1: level, stair_1: stair } }
}

describe('resolveStairTotalRise', () => {
  it('derives the rise from the containing level stored height when absent', () => {
    const { stair, nodes } = buildScene(3.2, undefined)
    expect(resolveStairTotalRise(stair, nodes)).toBe(3.2)
  })

  it('tracks a storey height change without any stair write', () => {
    const { stair, nodes } = buildScene(2.55, undefined)
    expect(resolveStairTotalRise(stair, nodes)).toBe(2.55)
    const level = nodes.level_1
    if (level.type !== 'level') throw new Error('expected level')
    const updated = { ...nodes, level_1: { ...level, height: 3.0 } }
    expect(resolveStairTotalRise(stair, updated)).toBe(3.0)
  })

  it('prefers an explicit totalRise over the storey height', () => {
    const { stair, nodes } = buildScene(3.2, 2.5)
    expect(resolveStairTotalRise(stair, nodes)).toBe(2.5)
  })

  it('falls back to the default when the stair has no containing level', () => {
    const { stair } = buildScene(3.2, undefined)
    expect(resolveStairTotalRise(stair, {})).toBe(2.5)
  })
})
