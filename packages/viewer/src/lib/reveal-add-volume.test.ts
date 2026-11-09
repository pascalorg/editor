import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  BuildingNode,
  CeilingNode,
  DoorNode,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  type RevealLayout,
  RoofNode,
  RoofSegmentNode,
  type SceneCommit,
  SiteNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import { Group } from 'three'
import addVolumeCommit from './__fixtures__/add-volume-commit.json'
import { commitDeleteCandidates, commitRevealCandidates } from './reveal-candidates'
import { FRAMING_PACE, LAZY_REVEAL_TIMING, planLazyReveal } from './reveal-schedule'

// The owner's case (14 Oct): an add_volume build "pulsed too fast, a bit of a mess". One commit
// makes a whole volume, its storeys, rooms (zones), walls, slabs and roof: at the framing level
// it plays room by room, wall by wall, floors offset, never in one pulse.

type Nodes = Record<string, AnyNode>
const kind = (
  type: string,
  schema: unknown,
  category: string,
  reveal?: unknown,
  revealLayout?: RevealLayout,
) =>
  ({
    kind: type,
    schemaVersion: 1,
    schema,
    category,
    defaults: () => ({}),
    capabilities: { ...(reveal ? { reveal } : {}), ...(revealLayout ? { revealLayout } : {}) },
    geometry: () => new Group(),
  }) as unknown as AnyNodeDefinition

let restore: () => void = () => {}
beforeAll(async () => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({
    id: 'fixture:add-volume',
    apiVersion: 1,
    nodes: [
      kind('site', SiteNode, 'site'),
      kind('building', BuildingNode, 'site'),
      kind('level', LevelNode, 'site'),
      kind('zone', ZoneNode, 'site', undefined, {
        room: (node) => (node.type === 'zone' ? node.polygon : null),
      }),
      kind(
        'wall',
        WallNode,
        'structure',
        { phase: 'structure', style: 'rise' },
        {
          line: (node) => (node.type === 'wall' ? [node.start, node.end] : null),
        },
      ),
      kind('slab', SlabNode, 'structure', { phase: 'foundation', style: 'settle', height: 0.08 }),
      kind('ceiling', CeilingNode, 'structure', { phase: 'roof', style: 'settle', height: 0.08 }),
      kind('door', DoorNode, 'structure', { phase: 'openings', style: 'cut' }),
      kind('window', WindowNode, 'structure', { phase: 'openings', style: 'cut' }),
      kind('roof', RoofNode, 'structure', { phase: 'roof', style: 'assemble', height: 4 }),
      kind('roof-segment', RoofSegmentNode, 'structure'),
    ],
  })
})
afterAll(() => restore())

/**
 * The commit R&D's add_volume makes for the owner's case, frozen as data (a rectangle block of two
 * storeys, a hip roof, three rooms below, a door): this tree has no add_volume, and the plan only
 * reads the commit's nodes.
 */
function volume(): SceneCommit {
  return {
    before: { nodes: addVolumeCommit.before },
    current: { nodes: addVolumeCommit.after },
    author: 'agent',
  } as unknown as SceneCommit
}

/** The commit, staged and planned (once the kinds are registered). */
function staged() {
  const commit = volume()
  const created = Object.values(commit.current.nodes).filter(
    (node) => !commit.before.nodes[node.id as keyof typeof commit.before.nodes],
  )
  const candidates = commitRevealCandidates(commit, 'framing')
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const plan = planLazyReveal(candidates, 0)
  const at = new Map(plan.map((entry) => [entry.id, entry.startMs]))
  const wallsOf = (levelId: string) =>
    created.filter((node) => node.type === 'wall' && node.parentId === levelId)
  return { created, byId, plan, at, wallsOf }
}

describe('add_volume at the framing level', () => {
  test('every wall, slab, room and roof it makes goes through the timeline', () => {
    const { created, byId } = staged()
    const kinds = new Set(created.map((node) => node.type))
    for (const type of ['wall', 'slab', 'zone', 'roof']) expect(kinds.has(type)).toBe(true)
    // A roof's segments are not staged on their own at this level: its covering is laid over
    // its frame in place, the whole shell at once (`cover`), so they ride with the roof.
    for (const node of created) {
      if (['wall', 'slab', 'zone', 'roof', 'door', 'window', 'ceiling'].includes(node.type))
        expect(byId.has(node.id)).toBe(true)
      if (node.type === 'roof-segment') expect(byId.has(node.id)).toBe(false)
      if (node.type === 'roof') expect(byId.get(node.id)?.style).toBe('cover')
    }
  })

  test('its walls are grouped by the rooms it makes, and the rooms of a floor go up side by side', () => {
    const { created, byId, at, wallsOf } = staged()
    const zoneIds = new Set(created.filter((node) => node.type === 'zone').map((node) => node.id))
    const ground = wallsOf('level_0')
    expect(ground.length).toBeGreaterThan(6)
    for (const wall of ground) expect(zoneIds.has(byId.get(wall.id)!.cluster ?? '')).toBe(true)
    const rooms = new Map<string, number[]>()
    for (const wall of ground) {
      const cluster = byId.get(wall.id)!.cluster!
      rooms.set(cluster, [...(rooms.get(cluster) ?? []), at.get(wall.id)!])
    }
    expect(rooms.size).toBe(3)
    const spans = [...rooms.values()].map(
      (starts) => [Math.min(...starts), Math.max(...starts)] as const,
    )
    spans.sort((left, right) => left[0] - right[0])
    // Each room starts after the one before, while it is still going up.
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index]![0]).toBeGreaterThan(spans[index - 1]![0])
      expect(spans[index]![0]).toBeLessThan(spans[index - 1]![1])
    }
  })

  test('slabs first, the floors offset, the roof once the walls are up; never a pulse', () => {
    const { created, plan, at, wallsOf } = staged()
    const slabs = created.filter((node) => node.type === 'slab' && node.parentId === 'level_0')
    const ground = wallsOf('level_0').map((wall) => at.get(wall.id)!)
    for (const slab of slabs) expect(at.get(slab.id)!).toBeLessThan(Math.min(...ground))
    const upperLevel = created.find(
      (node) => node.type === 'level' && (node as { level?: number }).level === 1,
    )
    const upper = upperLevel ? wallsOf(upperLevel.id).map((wall) => at.get(wall.id)!) : []
    if (upper.length > 0) {
      expect(Math.min(...upper)).toBeGreaterThan(Math.min(...ground))
      expect(Math.min(...upper)).toBeLessThan(Math.max(...ground))
    }
    const roof = created.find((node) => node.type === 'roof')!
    const walls = created.filter((node) => node.type === 'wall').map((wall) => at.get(wall.id)!)
    expect(at.get(roof.id)!).toBeGreaterThan(Math.max(...walls))
    const perFrame = new Map<number, number>()
    for (const entry of plan) {
      const frame = Math.floor(entry.startMs / (1000 / 60))
      perFrame.set(frame, (perFrame.get(frame) ?? 0) + 1)
    }
    expect(Math.max(...perFrame.values())).toBeLessThanOrEqual(2)
    const end = Math.max(
      ...plan.map((entry) => entry.startMs + LAZY_REVEAL_TIMING.durationMs[entry.style]),
    )
    // Not a pulse: at least 6 s at the original pace, stretched with it.
    expect(end).toBeGreaterThan(6000 * FRAMING_PACE)
    expect(end).toBeLessThan(LAZY_REVEAL_TIMING.capMs)
    console.log(
      `add_volume (2 storeys, 3 rooms below): ${plan.length} pieces, ${created.filter((n) => n.type === 'wall').length} walls, plays ${Math.round(end)} ms`,
    )
  })
})

describe('deleting what add_volume made', () => {
  const derived = (node: AnyNode) =>
    (node.type === 'slab' || node.type === 'ceiling') &&
    ((node as { boundary?: string }).boundary === 'auto' ||
      (node as { autoFromWalls?: boolean }).autoFromWalls === true)

  test('a floor or a room that goes takes its derived plates and ceilings, in the plan, with it', () => {
    const made = volume()
    const gone: SceneCommit = {
      origin: 'local',
      before: made.current,
      current: made.before,
    } as unknown as SceneCommit
    const candidates = commitDeleteCandidates(gone, 'framing')
    const ids = new Set(candidates.map((candidate) => candidate.id))
    const plates = Object.values(made.current.nodes).filter(derived)
    expect(plates.length).toBeGreaterThan(0)
    for (const plate of plates) expect(ids.has(plate.id)).toBe(true)
    // And every wall of it, in the same plan, each at its room.
    for (const node of Object.values(made.current.nodes))
      if (node.type === 'wall') expect(ids.has(node.id)).toBe(true)
  })

  test('a plate the reconciler derives anew, with no wall or room going, is not a deletion', () => {
    const made = volume()
    const plates = Object.values(made.current.nodes).filter(derived)
    const nodes = { ...made.current.nodes } as Record<string, AnyNode>
    for (const plate of plates) delete nodes[plate.id]
    const restructured: SceneCommit = {
      origin: 'local',
      before: made.current,
      current: { ...made.current, nodes },
      derivedWrites: new Map(plates.map((plate) => [plate.id, 'all' as const])),
    } as unknown as SceneCommit
    expect(commitDeleteCandidates(restructured, 'framing')).toEqual([])
  })
})
