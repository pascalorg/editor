import { describe, expect, test } from 'bun:test'
import type { RevealPhase } from '@pascal-app/core'
import {
  planRetract,
  planReveal,
  RETRACT_TIMING,
  REVEAL_TIMING,
  type RevealCandidate,
} from './reveal-schedule'

let seq = 0
function candidate(
  id: string,
  phase: RevealPhase,
  level: number,
  overrides: Partial<RevealCandidate> = {},
): RevealCandidate {
  return {
    id,
    phase,
    style: phase === 'structure' ? 'rise' : 'scale',
    height: 0,
    levelId: `level_${level}`,
    levelIndex: level,
    depth: 2,
    seq: seq++,
    ...overrides,
  }
}

describe('reveal schedule', () => {
  test('phase after phase, every floor at once, hosts before what they host', () => {
    const plan = planReveal(
      [
        candidate('sofa', 'furnishing', 0),
        candidate('wall_up', 'structure', 1),
        candidate('door', 'openings', 0, { depth: 3 }),
        candidate('wall_a', 'structure', 0),
        candidate('slab', 'foundation', 0),
        candidate('slab_up', 'foundation', 1),
        candidate('book', 'furnishing', 0, { depth: 3 }),
        candidate('shelf', 'furnishing', 0),
        candidate('roof', 'roof', 1),
        candidate('wall_b', 'structure', 0),
      ],
      0,
    )
    const start = (id: string) => plan.find((entry) => entry.id === id)!.startMs
    const starts = plan.map((entry) => entry.startMs)
    expect(starts).toEqual([...starts].sort((left, right) => left - right))

    // Each phase starts once the one before has started everywhere, after a pause.
    const last = (ids: string[]) => Math.max(...ids.map(start))
    const first = (ids: string[]) => Math.min(...ids.map(start))
    expect(first(['wall_a', 'wall_b', 'wall_up'])).toBe(
      last(['slab', 'slab_up']) + REVEAL_TIMING.groupGapMs,
    )
    expect(first(['door'])).toBeGreaterThan(last(['wall_a', 'wall_b', 'wall_up']))
    expect(first(['roof'])).toBeGreaterThan(first(['door']))
    expect(first(['sofa', 'shelf', 'book'])).toBeGreaterThan(first(['roof']))
    // The upper floor does not wait for the lower one: its wall starts with the first walls below.
    expect(start('wall_up')).toBeLessThan(last(['wall_a', 'wall_b']))
    expect(start('slab_up')).toBeLessThan(start('slab') + REVEAL_TIMING.nodeGapMs)
    // What stands on something starts after it.
    expect(start('book')).toBeGreaterThan(start('shelf'))
  })

  test('within a floor the starts scatter, evenly spaced, the same way every time', () => {
    const walls = Array.from({ length: 20 }, (_, index) =>
      candidate(`wall_${index}`, 'structure', 0),
    )
    const plan = planReveal(walls, 0)
    const order = plan.map((entry) => entry.id)
    expect(order).not.toEqual(walls.map((wall) => wall.id))
    expect(planReveal([...walls].reverse(), 0).map((entry) => entry.id)).toEqual(order)
    expect(plan.map((entry) => entry.startMs)).toEqual(
      walls.map((_, index) => index * REVEAL_TIMING.nodeGapMs),
    )
  })

  test('a thousand nodes all start, in order, within the cap and spread over frames', () => {
    const candidates = Array.from({ length: 1000 }, (_, index) =>
      candidate(`node_${index}`, index % 2 ? 'structure' : 'furnishing', index % 3),
    )
    const startMs = 500
    const plan = planReveal(candidates, startMs)

    expect(new Set(plan.map((entry) => entry.id)).size).toBe(1000)
    const longest = Math.max(...Object.values(REVEAL_TIMING.durationMs))
    const lastStart = Math.max(...plan.map((entry) => entry.startMs))
    expect(lastStart - startMs + longest).toBeLessThanOrEqual(REVEAL_TIMING.capMs)

    // At 50 fps the starts land a few per frame, never all at once.
    const frameMs = 20
    const perFrame = new Map<number, number>()
    for (const entry of plan) {
      const frame = Math.floor((entry.startMs - startMs) / frameMs)
      perFrame.set(frame, (perFrame.get(frame) ?? 0) + 1)
    }
    const frames = (REVEAL_TIMING.capMs - longest) / frameMs
    expect(Math.max(...perFrame.values())).toBeLessThanOrEqual(Math.ceil(1000 / frames) + 1)
  })

  test('a small build keeps its natural pace', () => {
    const plan = planReveal([candidate('a', 'structure', 0), candidate('b', 'structure', 0)], 1000)
    expect(plan.map((entry) => entry.startMs)).toEqual([1000, 1000 + REVEAL_TIMING.nodeGapMs])
    expect(plan.map((entry) => entry.id).sort()).toEqual(['a', 'b'])
  })
})

describe('the schedule in reverse', () => {
  const house = () => [
    candidate('slab', 'foundation', 0),
    candidate('wall_a', 'structure', 0),
    candidate('wall_b', 'structure', 0),
    candidate('wall_c', 'structure', 0),
    candidate('door', 'openings', 0, { style: 'cut', depth: 3 }),
    candidate('roof', 'roof', 1, { style: 'assemble', height: 4 }),
    candidate('sofa', 'furnishing', 0, { style: 'drop', height: 0.3 }),
    candidate('lamp', 'furnishing', 0, { style: 'drop', height: 0.3 }),
  ]

  test('the last thing built comes away first, phase by phase back to the slab', () => {
    const plan = planRetract(house(), 1000)
    const byId = new Map(plan.map((entry) => [entry.id, entry]))
    expect(plan).toHaveLength(8)
    const starts = (...ids: string[]) => ids.map((id) => byId.get(id)!.startMs)
    const latest = (...ids: string[]) => Math.max(...starts(...ids))
    const earliest = (...ids: string[]) => Math.min(...starts(...ids))
    expect(latest('sofa', 'lamp')).toBeLessThanOrEqual(
      earliest('roof') + RETRACT_TIMING.nodeGapMs * 4,
    )
    expect(earliest('roof')).toBeLessThan(earliest('door'))
    expect(earliest('door')).toBeLessThan(earliest('wall_a', 'wall_b', 'wall_c'))
    expect(latest('wall_a', 'wall_b', 'wall_c')).toBeLessThan(earliest('slab') + 200)
    expect(earliest('slab')).toBeGreaterThan(latest('door'))
  })

  test('it is a rewind: quicker than the build, and always a plan in order', () => {
    const forward = planReveal(house(), 0)
    const forwardEnd = Math.max(
      ...forward.map((entry) => entry.startMs + REVEAL_TIMING.durationMs[entry.style]),
    )
    const plan = planRetract(house(), 0)
    const end = Math.max(...plan.map((entry) => entry.startMs + entry.durationMs))
    expect(end).toBeLessThan(forwardEnd)
    for (let index = 1; index < plan.length; index += 1)
      expect(plan[index]!.startMs).toBeGreaterThanOrEqual(plan[index - 1]!.startMs)
    for (const entry of plan) expect(entry.durationMs).toBeGreaterThan(0)
  })

  test('a whole build goes within the cap, however many pieces', () => {
    const candidates = Array.from({ length: 1000 }, (_, index) =>
      candidate(`node_${index}`, index % 2 ? 'structure' : 'furnishing', index % 3),
    )
    const plan = planRetract(candidates, 500)
    expect(new Set(plan.map((entry) => entry.id)).size).toBe(1000)
    const end = Math.max(...plan.map((entry) => entry.startMs + entry.durationMs))
    expect(end - 500).toBeLessThanOrEqual(RETRACT_TIMING.capMs)
  })

  test('a lone piece goes at once', () => {
    const [only] = planRetract([candidate('a', 'structure', 0)], 700)
    expect(only!.startMs).toBe(700)
  })

  test('the pieces that read the same way share one group key per phase and level', () => {
    const plan = planRetract(house(), 0)
    const keys = new Set(plan.map((entry) => entry.group))
    expect(keys).toEqual(
      new Set([
        'foundation:level_0',
        'structure:level_0',
        'openings:level_0',
        'roof:level_1',
        'furnishing:level_0',
      ]),
    )
  })
})
