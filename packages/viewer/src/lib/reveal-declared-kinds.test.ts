import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type Capabilities,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  RoofNode,
  type SceneCommit,
  SlabNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { Group } from 'three'
import { commitDeleteCandidates, commitRevealCandidates } from './reveal-candidates'

// The reveal asks the registry what a kind is (an assembled host, a room, a line in a plan) and
// never names a kind: a plugin kind that declares what a built-in declares is staged exactly as the
// built-in is. Each case builds the same scene with the built-in and with the plugin's kinds.

const kind = (type: string, schema: unknown, category: string, capabilities: Capabilities = {}) =>
  ({
    kind: type,
    schemaVersion: 1,
    schema,
    category,
    defaults: () => ({}),
    capabilities,
    geometry: () => new Group(),
  }) as unknown as AnyNodeDefinition

const roomOf = (node: AnyNode) =>
  (node as unknown as { polygon?: [number, number][] }).polygon ?? null
const lineOf = (node: AnyNode) => {
  const { start, end } = node as unknown as { start?: [number, number]; end?: [number, number] }
  return start && end ? ([start, end] as const) : null
}

let restore: () => void = () => {}
beforeAll(async () => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({
    id: 'fixture:declared',
    apiVersion: 1,
    nodes: [
      kind('level', LevelNode, 'site'),
      kind('roof', RoofNode, 'structure', {
        reveal: { phase: 'roof', style: 'assemble', height: 4 },
      }),
      kind('zone', ZoneNode, 'site', {
        revealLayout: { room: (n) => (n.type === 'zone' ? n.polygon : null) },
      }),
      kind('wall', WallNode, 'structure', {
        reveal: { phase: 'structure', style: 'rise' },
        revealLayout: { line: (n) => (n.type === 'wall' ? [n.start, n.end] : null) },
      }),
      kind('slab', SlabNode, 'structure', {
        reveal: { phase: 'foundation', style: 'settle', height: 0.08 },
      }),
      // A plugin's kinds, declaring what the three above declare.
      kind('x:assembly', RoofNode, 'structure', {
        reveal: { phase: 'roof', style: 'assemble', height: 4 },
      }),
      kind('x:part', RoofNode, 'structure'),
      kind('x:room', ZoneNode, 'site', { revealLayout: { room: roomOf } }),
      kind('x:beam', WallNode, 'structure', {
        reveal: { phase: 'structure', style: 'rise' },
        revealLayout: { line: lineOf },
      }),
      // No declaration: a node that stands on a line by its own fields, and no more.
      kind('x:rail', WallNode, 'structure', { reveal: { phase: 'structure', style: 'rise' } }),
    ],
  })
})
afterAll(() => restore())

const level = LevelNode.parse({ id: 'level_x', level: 0 })
const raw = (fields: Record<string, unknown>) => fields as unknown as AnyNode
const square: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const room = (type: string, id: string) => raw({ id, type, parentId: level.id, polygon: square })
const along = (type: string, id: string, start: [number, number], end: [number, number]) =>
  raw({ id, type, parentId: level.id, start, end })

function commitOf(created: AnyNode[], existing: AnyNode[] = []): SceneCommit {
  const nodes = (list: AnyNode[]) =>
    Object.fromEntries(
      [{ ...level, children: list.map((node) => node.id) } as AnyNode, ...list].map((node) => [
        node.id,
        node,
      ]),
    ) as SceneCommit['before']['nodes']
  return {
    before: { nodes: nodes(existing) },
    current: { nodes: nodes([...existing, ...created]) },
    author: 'agent',
  } as unknown as SceneCommit
}

/** The layout of one candidate, without the ids, which differ between the two scenes. */
function layoutOf(commit: SceneCommit, id: string, rooms: Record<string, string>) {
  const found = commitRevealCandidates(commit, 'framing').find((candidate) => candidate.id === id)!
  return {
    phase: found.phase,
    style: found.style,
    cluster: rooms[found.cluster ?? ''] ?? found.cluster?.replace(/^[^:]+/, 'level'),
    sweep: found.sweep,
    order: found.order,
  }
}

describe('a kind that declares what a built-in declares is staged as the built-in is', () => {
  test('a node on an assembled host falls onto it, whatever the host is called', () => {
    const staged = (host: string, part: string) => {
      const hostNode = raw({ id: `${host}_h`, type: host, parentId: level.id, children: [] })
      const partNode = raw({ id: `${part}_p`, type: part, parentId: hostNode.id })
      const [candidate] = commitRevealCandidates(commitOf([partNode], [hostNode]), 'full')
      return (
        candidate && { phase: candidate.phase, style: candidate.style, height: candidate.height }
      )
    }
    expect(staged('roof', 'x:part')).toEqual({ phase: 'roof', style: 'drop', height: 2 })
    expect(staged('x:assembly', 'x:part')).toEqual(staged('roof', 'x:part'))
  })

  test('a node on a line in a room comes in with its room, around the room’s centre', () => {
    const builtIn = commitOf([room('zone', 'zone_a'), along('wall', 'wall_a', [0, 0], [4, 0])])
    const plugin = commitOf([room('x:room', 'room_a'), along('x:beam', 'beam_a', [0, 0], [4, 0])])
    const expected = layoutOf(builtIn, 'wall_a', { zone_a: 'room' })
    expect(expected.cluster).toBe('room')
    expect(layoutOf(plugin, 'beam_a', { room_a: 'room' })).toEqual(expected)
  })

  test('lines in no room run along the lines they meet, as walls do', () => {
    const lines: [number, number][][] = [
      [
        [10, 0],
        [14, 0],
      ],
      [
        [14, 0],
        [14, 4],
      ],
      [
        [14, 4],
        [10, 4],
      ],
    ]
    const builtIn = commitOf(lines.map(([a, b], i) => along('wall', `wall_${i}`, a, b)))
    const plugin = commitOf(lines.map(([a, b], i) => along('x:beam', `beam_${i}`, a, b)))
    const was = commitRevealCandidates(builtIn, 'framing')
    const now = commitRevealCandidates(plugin, 'framing')
    expect(was.every((c) => c.cluster?.includes(':run:'))).toBe(true)
    expect(now.map(({ cluster, sweep, order }) => ({ cluster, sweep, order }))).toEqual(
      was.map(({ cluster, sweep, order }) => ({ cluster, sweep, order })),
    )
  })

  test('without the declaration a loose line is not linked into runs', () => {
    const loose = commitOf([
      along('x:rail', 'rail_a', [10, 0], [14, 0]),
      along('x:rail', 'rail_b', [14, 0], [14, 4]),
    ])
    for (const candidate of commitRevealCandidates(loose, 'framing'))
      expect(candidate.cluster).toBeUndefined()
  })

  test('a derived plate goes with the line or the room a commit takes off its level', () => {
    const plate = SlabNode.parse({
      id: 'slab_auto',
      parentId: level.id,
      polygon: square,
      autoFromWalls: true,
    }) as AnyNode
    const goes = (leaving: AnyNode) => {
      const before = commitOf([plate, leaving])
      const commit = { ...before, before: before.current, current: commitOf([]).current }
      return commitDeleteCandidates(commit as SceneCommit, 'framing').some(
        (candidate) => candidate.id === plate.id,
      )
    }
    for (const type of ['wall', 'x:beam', 'zone', 'x:room'])
      expect(
        goes(
          type.endsWith('room') || type === 'zone'
            ? room(type, 'a')
            : along(type, 'a', [0, 0], [4, 0]),
        ),
      ).toBe(true)
    // A kind that declares nothing about plans does not take a plate with it.
    expect(goes(along('x:rail', 'a', [0, 0], [4, 0]))).toBe(false)
  })
})
