import { describe, expect, test } from 'bun:test'
import {
  LevelNode,
  type OpenWallEnd,
  type SceneCommit,
  subscribeSceneCommits,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  collapseMutualOpenWallEnds,
  formatOpenWallEndDistance,
  joinOpenWallEnd,
  openWallEndLabel,
  openWallEndsSummary,
  visibleOpenWallEnds,
} from './open-wall-ends'

const end = (overrides: Partial<OpenWallEnd>): OpenWallEnd => ({
  wallId: 'wall_a',
  end: 'end',
  point: [0, 0],
  reason: 'gap',
  ...overrides,
})

describe('open wall end labels', () => {
  test('name the problem with the distance a person would say', () => {
    expect(openWallEndLabel(end({ reason: 'gap', gap: 0.04 }), 'metric')).toBe('4 cm gap')
    expect(openWallEndLabel(end({ reason: 'gap', gap: 0.004 }), 'metric')).toBe('4 mm gap')
    expect(
      openWallEndLabel(
        end({
          reason: 'crosses',
          point: [0, 0],
          candidate: { wallId: 'wall_b', point: [0.12, 0], kind: 'body' },
        }),
        'metric',
      ),
    ).toBe('Overlaps by 12 cm')
    expect(openWallEndLabel(end({ reason: 'parallel', gap: 0.05 }), 'metric')).toBe(
      'Parallel, 5 cm apart',
    )
    expect(openWallEndLabel(end({ reason: 'rejected' }), 'metric')).toBe('Not joined')
    expect(openWallEndLabel(end({ reason: 'isolated' }), 'metric')).toBeNull()
  })

  test('falls back to the distance to the candidate when the gap is not given', () => {
    const label = openWallEndLabel(
      end({ reason: 'gap', candidate: { wallId: 'wall_b', point: [0, 0.03], kind: 'endpoint' } }),
      'metric',
    )
    expect(label).toBe('3 cm gap')
  })

  test('imperial distances read in inches below a foot', () => {
    expect(formatOpenWallEndDistance(0.0381, 'imperial')).toBe('1.5"')
    expect(formatOpenWallEndDistance(0.2, 'imperial')).toBe('7.9"')
    expect(formatOpenWallEndDistance(1.2, 'metric')).toBe('1.2m')
  })
})

describe('which open ends the floor plan marks', () => {
  const nearMissRoomless = end({
    wallId: 'roomless',
    candidate: { wallId: 'x', point: [0.04, 0], kind: 'endpoint' },
  })
  const nearMissInRoom = end({
    wallId: 'in_room',
    candidate: { wallId: 'x', point: [0.04, 0], kind: 'endpoint' },
  })
  const isolatedRoomless = end({ wallId: 'roomless', end: 'start', reason: 'isolated' })
  const ends = [nearMissRoomless, nearMissInRoom, isolatedRoomless]
  const roomWallIds = new Set(['in_room'])

  test('outside drawing, only near misses on walls that bound no room', () => {
    expect(visibleOpenWallEnds(ends, roomWallIds, false)).toEqual([nearMissRoomless])
  })

  test('while drawing, every near miss and the loose ends of room-less walls', () => {
    expect(visibleOpenWallEnds(ends, roomWallIds, true)).toEqual(ends)
  })

  test('a summary only when something is left to join', () => {
    expect(openWallEndsSummary(0)).toBeNull()
    expect(openWallEndsSummary(2)).toBe("2 wall ends aren't joined — rooms can't close")
  })
})

test("two ends that are each other's candidate show once, on the wall that slides straight", () => {
  // Horizontal wall_a ends at (0, 1); vertical wall_b starts 9 cm above it.
  const a = end({
    wallId: 'wall_a',
    end: 'end',
    point: [0, 1],
    candidate: { wallId: 'wall_b', point: [0, 1.09], kind: 'endpoint' },
  })
  const b = end({
    wallId: 'wall_b',
    end: 'start',
    point: [0, 1.09],
    candidate: { wallId: 'wall_a', point: [0, 1], kind: 'endpoint' },
  })
  const lone = end({
    wallId: 'wall_c',
    candidate: { wallId: 'wall_a', point: [2, 1], kind: 'body' },
  })
  const directions: Record<string, [number, number]> = {
    wall_a: [4.5, 0],
    wall_b: [0, 4.41],
    wall_c: [1, 0],
  }
  expect(collapseMutualOpenWallEnds([a, b, lone], (id) => directions[id] ?? null)).toEqual([
    b,
    lone,
  ])
})

test('Join emits one scene commit and one undo step, restoring both wall endpoints on undo', () => {
  const before = useScene.getState()
  const history = useScene.temporal.getState()
  const source = WallNode.parse({
    id: 'wall_join_source',
    parentId: 'level_join',
    start: [0, 0],
    end: [2, 0],
  })
  const target = WallNode.parse({
    id: 'wall_join_target',
    parentId: 'level_join',
    start: [2.09, 0],
    end: [2.09, 2],
  })
  const level = LevelNode.parse({ id: 'level_join', children: [source.id, target.id] })
  useScene.setState({
    nodes: { [level.id]: level, [source.id]: source, [target.id]: target },
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const commits: SceneCommit[] = []
  const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
  try {
    const diagnostic = {
      wallId: source.id,
      end: 'end',
      point: source.end,
      reason: 'gap',
      candidate: { wallId: target.id, point: target.start, kind: 'endpoint' },
    } satisfies OpenWallEnd
    expect(joinOpenWallEnd(diagnostic)).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(commits).toHaveLength(1)
    expect(commits[0]?.origin).toBe('local')
    expect(commits[0]?.current.nodes[source.id]).toMatchObject({ end: target.start })
    expect(useScene.getState().nodes[source.id]).toMatchObject({ end: target.start })
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[source.id]).toMatchObject({
      start: source.start,
      end: source.end,
    })
    expect(useScene.getState().nodes[target.id]).toEqual(target)
    commits.length = 0
    expect(joinOpenWallEnd({ ...diagnostic, point: [1, 0] })).toBe('This wall end has changed')
    expect(joinOpenWallEnd({ ...diagnostic, candidate: undefined })).toBe(
      'The other wall has moved or is no longer available',
    )
    expect(commits).toHaveLength(0)
    useScene.setState({ readOnly: true })
    expect(joinOpenWallEnd(diagnostic)).toBe('This scene is read-only')
    expect(useScene.getState().nodes[source.id]).toMatchObject({ end: source.end })
    expect(commits).toHaveLength(0)
  } finally {
    unsubscribe()
    useScene.setState(before)
    useScene.temporal.setState(history)
  }
})
