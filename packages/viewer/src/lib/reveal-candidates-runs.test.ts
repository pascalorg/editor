import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  WallNode,
} from '@pascal-app/core'
import { Group } from 'three'
import { layoutRevealCandidates, type StagedCandidate } from './reveal-candidates'

// Walls in no room are laid out in runs along the outline they make: a run is a stretch of it, not
// every wall of the same distance from where the walk began.

let restore: () => void = () => {}
beforeAll(async () => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({
    id: 'fixture:runs',
    apiVersion: 1,
    nodes: [
      {
        kind: 'wall',
        schemaVersion: 1,
        schema: WallNode,
        category: 'structure',
        defaults: () => ({}),
        capabilities: {
          reveal: { phase: 'structure', style: 'rise' },
          revealLayout: {
            line: (node: AnyNode) => {
              const { start, end } = node as unknown as WallNode
              return [start, end] as const
            },
          },
        },
        geometry: () => new Group(),
      } as unknown as AnyNodeDefinition,
    ],
  })
})
afterAll(() => restore())

/** A closed outline of `side` metres a side, a wall to each metre, walked from its corner. */
function ring(side: number) {
  const points: [number, number][] = []
  for (let i = 0; i < side; i += 1) points.push([i, 0])
  for (let i = 0; i < side; i += 1) points.push([side, i])
  for (let i = 0; i < side; i += 1) points.push([side - i, side])
  for (let i = 0; i < side; i += 1) points.push([0, side - i])
  return points.map((start, index) => {
    const end = points[(index + 1) % points.length]!
    return WallNode.parse({ id: `wall_ring${index}`, parentId: 'level_ring', start, end })
  })
}

function laidOut(walls: WallNode[]) {
  const level = LevelNode.parse({ id: 'level_ring', level: 0, children: walls.map((w) => w.id) })
  const nodes = Object.fromEntries([level, ...walls].map((n) => [n.id, n])) as Record<
    AnyNodeId,
    AnyNode
  >
  const candidates: StagedCandidate[] = walls.map((wall, seq) => ({
    id: wall.id,
    phase: 'structure',
    style: 'rise',
    height: 0,
    levelId: level.id,
    levelIndex: 0,
    depth: 1,
    seq,
  }))
  layoutRevealCandidates(candidates, nodes)
  return candidates
}

const meets = (a: WallNode, b: WallNode) =>
  [a.start, a.end].some((p) => [b.start, b.end].some((q) => p[0] === q[0] && p[1] === q[1]))

describe('walls in no room, in runs along their outline', () => {
  for (const side of [3, 6]) {
    test(`each run of a closed outline of ${side * 4} walls is one stretch of it`, () => {
      const walls = ring(side)
      const byId = new Map(walls.map((wall) => [wall.id, wall]))
      const runs = new Map<string, StagedCandidate[]>()
      for (const candidate of laidOut(walls)) {
        const list = runs.get(candidate.cluster!) ?? []
        list.push(candidate)
        runs.set(candidate.cluster!, list)
      }
      expect(runs.size).toBeGreaterThan(1)
      for (const [, run] of runs) {
        run.sort((a, b) => a.order! - b.order!)
        for (let i = 1; i < run.length; i += 1)
          expect(meets(byId.get(run[i - 1]!.id)!, byId.get(run[i]!.id)!)).toBe(true)
      }
    })
  }

  test('an open chain is walked from one of its ends, so no run straddles its middle', () => {
    const walls = Array.from({ length: 12 }, (_, index) =>
      WallNode.parse({
        id: `wall_row${index}`,
        parentId: 'level_ring',
        start: [index, 0],
        end: [index + 1, 0],
      }),
    )
    const run = (candidate: StagedCandidate) => candidate.cluster!
    const candidates = laidOut(walls)
    const first = candidates.filter((c) => run(c) === run(candidates[0]!))
    const xs = first.map((c) => walls.find((w) => w.id === c.id)!.start[0])
    expect(xs.length).toBe(6)
    expect(Math.max(...xs) - Math.min(...xs)).toBe(5)
    expect([0, 6]).toContain(Math.min(...xs))
  })
})
