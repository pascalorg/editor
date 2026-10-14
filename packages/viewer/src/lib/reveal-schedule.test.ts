import { describe, expect, test } from 'bun:test'
import type { RevealPhase } from '@pascal-app/core'
import {
  LAZY_REVEAL_TIMING,
  planLazyReveal,
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
})

describe('the lazy, nested schedule (framing)', () => {
  /** A floor of `rooms` rooms of `walls` walls each, with a slab, a door a room and `items` a room. */
  function floor(level: number, rooms: number, walls = 4, items = 3, prerollMs = 0) {
    const nodes: RevealCandidate[] = [
      candidate(`slab_${level}`, 'foundation', level, { style: 'settle', height: 0.08 }),
    ]
    for (let room = 0; room < rooms; room += 1) {
      const cluster = `zone_${level}_${room}`
      const inRoom = { cluster, sweep: room }
      for (let wall = 0; wall < walls; wall += 1)
        nodes.push(
          candidate(`wall_${level}_${room}_${wall}`, 'structure', level, {
            ...inRoom,
            order: wall,
            ...(prerollMs ? { prerollMs } : {}),
          }),
        )
      nodes.push(
        candidate(`door_${level}_${room}`, 'openings', level, {
          ...inRoom,
          style: 'cut',
          depth: 3,
        }),
      )
      for (let item = 0; item < items; item += 1)
        nodes.push(
          candidate(`item_${level}_${room}_${item}`, 'furnishing', level, {
            ...inRoom,
            style: 'drop',
            height: 0.3,
          }),
        )
    }
    return nodes
  }
  const startsOf = (plan: ReturnType<typeof planLazyReveal>) => {
    const byId = new Map(plan.map((entry) => [entry.id, entry.startMs]))
    return (id: string) => byId.get(id)!
  }
  const endOf = (plan: ReturnType<typeof planLazyReveal>) =>
    Math.max(...plan.map((entry) => entry.startMs + LAZY_REVEAL_TIMING.durationMs[entry.style]))

  test('a floor builds phase after phase, its rooms side by side a beat apart, each room wall by wall', () => {
    const plan = planLazyReveal(floor(0, 3), 0)
    const at = startsOf(plan)
    const walls = (room: number) => [0, 1, 2, 3].map((wall) => at(`wall_0_${room}_${wall}`))
    // The slab, then every wall, then the doors, then the furniture.
    expect(Math.min(...walls(0))).toBeGreaterThan(at('slab_0'))
    const lastWall = Math.max(...[0, 1, 2].flatMap(walls))
    for (const room of [0, 1, 2]) expect(at(`door_0_${room}`)).toBeGreaterThan(lastWall)
    // A room's walls go up one after the other, around it.
    for (const room of [0, 1, 2]) {
      const own = walls(room)
      for (let index = 1; index < own.length; index += 1)
        expect(own[index]!).toBeGreaterThan(own[index - 1]!)
    }
    // The next room starts a beat after the first, while the first is still going up: side by side.
    expect(Math.min(...walls(1))).toBeGreaterThan(Math.min(...walls(0)))
    expect(Math.min(...walls(1))).toBeLessThan(Math.max(...walls(0)))
  })

  test('floors go up side by side, offset; roofs wait for every floor; furniture comes last', () => {
    const roof = candidate('roof', 'roof', 2, { style: 'assemble', height: 4 })
    const plan = planLazyReveal([...floor(0, 3), ...floor(1, 3), roof], 0)
    const at = startsOf(plan)
    const walls = (level: number) =>
      plan.filter((entry) => entry.id.startsWith(`wall_${level}_`)).map((entry) => entry.startMs)
    expect(Math.min(...walls(1))).toBeGreaterThan(Math.min(...walls(0)))
    expect(Math.min(...walls(1))).toBeLessThan(Math.max(...walls(0)))
    const stageA = plan.filter((entry) => entry.phase !== 'roof' && entry.phase !== 'furnishing')
    expect(at('roof')).toBeGreaterThan(Math.max(...stageA.map((entry) => entry.startMs)))
    const items = plan.filter((entry) => entry.phase === 'furnishing').map((entry) => entry.startMs)
    expect(Math.min(...items)).toBeGreaterThan(at('roof'))
  })

  test('a big build takes proportionally longer, never in one pulse, and ends by the cap', () => {
    const house = planLazyReveal([...floor(0, 4), ...floor(1, 4)], 0)
    const big = planLazyReveal([...floor(0, 12, 6, 6), ...floor(1, 12, 6, 6)], 0)
    expect(endOf(big)).toBeGreaterThan(endOf(house) * 1.8)
    const huge = Array.from({ length: 4 }, (_, level) => floor(level, 60, 8, 8)).flat()
    const plan = planLazyReveal(huge, 1000)
    expect(plan).toHaveLength(huge.length)
    expect(endOf(plan) - 1000).toBeLessThanOrEqual(LAZY_REVEAL_TIMING.capMs + 1e-6)
    expect(endOf(plan) - 1000).toBeGreaterThan(LAZY_REVEAL_TIMING.capMs * 0.9)
    // 4,000 pieces over the cap: a few start in a frame at 60 fps, never a crowd.
    const perFrame = new Map<number, number>()
    for (const entry of plan) {
      const frame = Math.floor((entry.startMs - 1000) / (1000 / 60))
      perFrame.set(frame, (perFrame.get(frame) ?? 0) + 1)
    }
    expect(Math.max(...perFrame.values())).toBeLessThanOrEqual(12)
  })

  test('a preroll plays before its node, and the room’s next phase waits for it', () => {
    const preroll = 2000
    const plain = planLazyReveal(floor(0, 2), 0)
    const plan = planLazyReveal(floor(0, 2, 4, 3, preroll), 0)
    const at = startsOf(plan)
    for (const entry of plan.filter((entry) => entry.phase === 'structure')) {
      expect(entry.prerollMs).toBe(preroll)
      expect(entry.startMs).toBeGreaterThanOrEqual(at('slab_0') + preroll)
    }
    const lastWall = Math.max(
      ...plan.filter((entry) => entry.phase === 'structure').map((entry) => entry.startMs),
    )
    expect(at('door_0_0')).toBeGreaterThan(lastWall)
    expect(endOf(plan)).toBeGreaterThan(endOf(plain) + preroll * 0.9)
  })

  test('the same build plans the same way every time, jittered but never before its phase', () => {
    const one = planLazyReveal(floor(0, 3), 0)
    const timesOf = (plan: typeof one) => plan.map((entry) => [entry.id, entry.startMs])
    expect(timesOf(planLazyReveal(floor(0, 3), 0))).toEqual(timesOf(one))
    const at = startsOf(one)
    const gaps = [1, 2, 3].map((wall) => at(`wall_0_0_${wall}`) - at(`wall_0_0_${wall - 1}`))
    // Jittered: the walls of a room are not evenly spaced.
    expect(new Set(gaps.map((gap) => Math.round(gap))).size).toBeGreaterThan(1)
  })
})
