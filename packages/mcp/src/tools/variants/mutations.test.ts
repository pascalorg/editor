import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  FenceNode,
  LevelNode,
  SiteNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { applyMutation, mulberry32 } from './mutations'

function nodesById(nodes: AnyNode[]): SceneGraph['nodes'] {
  const out: SceneGraph['nodes'] = {}
  for (const node of nodes) out[node.id] = node
  return out
}

function makeBaseGraph(): SceneGraph {
  const site = SiteNode.parse({
    id: 'site_a',
    parentId: null,
    polygon: {
      type: 'polygon',
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    },
    children: [],
  })
  const building = BuildingNode.parse({
    id: 'building_a',
    parentId: 'site_a',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: ['level_a'],
  })
  const level = LevelNode.parse({
    id: 'level_a',
    parentId: 'building_a',
    children: ['wall_n', 'wall_s', 'wall_e', 'wall_w', 'wall_mid', 'zone_kitchen', 'zone_living'],
  })
  const wallN = WallNode.parse({
    id: 'wall_n',
    parentId: 'level_a',
    start: [-10, 10],
    end: [10, 10],
    thickness: 0.1,
    height: 2.5,
    children: [],
  })
  const wallS = WallNode.parse({
    id: 'wall_s',
    parentId: 'level_a',
    start: [-10, -10],
    end: [10, -10],
    thickness: 0.1,
    height: 2.5,
    children: [],
  })
  const wallE = WallNode.parse({
    id: 'wall_e',
    parentId: 'level_a',
    start: [10, -10],
    end: [10, 10],
    thickness: 0.1,
    height: 2.5,
    children: [],
  })
  const wallW = WallNode.parse({
    id: 'wall_w',
    parentId: 'level_a',
    start: [-10, -10],
    end: [-10, 10],
    thickness: 0.1,
    height: 2.5,
    children: [],
  })
  const wallMid = WallNode.parse({
    id: 'wall_mid',
    parentId: 'level_a',
    start: [-5, 0],
    end: [5, 0],
    thickness: 0.1,
    height: 2.5,
    children: ['door_mid'],
  })
  const doorMid = DoorNode.parse({
    id: 'door_mid',
    parentId: 'wall_mid',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    wallId: 'wall_mid',
    width: 0.9,
    height: 2.1,
    frameThickness: 0.05,
    frameDepth: 0.07,
    threshold: true,
    thresholdHeight: 0.02,
    hingesSide: 'left',
    swingDirection: 'inward',
    segments: [],
    handle: true,
    handleHeight: 1.05,
    handleSide: 'right',
    contentPadding: [0.04, 0.04],
    doorCloser: false,
    panicBar: false,
    panicBarHeight: 1.0,
  })
  const zoneKitchen = ZoneNode.parse({
    id: 'zone_kitchen',
    parentId: 'level_a',
    name: 'Kitchen',
    polygon: [
      [-5, 0],
      [5, 0],
      [5, 10],
      [-5, 10],
    ],
    color: '#ff0000',
  })
  const zoneLiving = ZoneNode.parse({
    id: 'zone_living',
    parentId: 'level_a',
    name: 'Living',
    polygon: [
      [-5, -10],
      [5, -10],
      [5, 0],
      [-5, 0],
    ],
    color: '#00ff00',
  })
  const fence = FenceNode.parse({
    id: 'fence_1',
    parentId: 'site_a',
    start: [-8, -8],
    end: [8, -8],
    height: 1.8,
    thickness: 0.08,
    baseHeight: 0.22,
    postSpacing: 2,
    postSize: 0.1,
    topRailHeight: 0.04,
    groundClearance: 0,
    edgeInset: 0.015,
    baseStyle: 'grounded',
    color: '#ffffff',
    style: 'slat',
  })
  return {
    nodes: nodesById([
      site,
      building,
      level,
      wallN,
      wallS,
      wallE,
      wallW,
      wallMid,
      doorMid,
      zoneKitchen,
      zoneLiving,
      fence,
    ]),
    rootNodeIds: [site.id],
  }
}

describe('mulberry32', () => {
  test('is deterministic for the same seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b())
    }
  })
  test('produces values in [0, 1)', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('applyMutation: wall-thickness', () => {
  test('assigns every wall a thickness from the fixed set', () => {
    const rng = mulberry32(1)
    const out = applyMutation(makeBaseGraph(), rng, 'wall-thickness')
    const allowed = new Set([0.1, 0.15, 0.2, 0.25])
    let walls = 0
    for (const node of Object.values(out.nodes)) {
      if (node.type !== 'wall') continue
      walls++
      expect(allowed.has((node as { thickness: number }).thickness)).toBe(true)
    }
    expect(walls).toBeGreaterThan(0)
  })

  test('does not mutate the input graph', () => {
    const base = makeBaseGraph()
    const before = JSON.stringify(base)
    applyMutation(base, mulberry32(5), 'wall-thickness')
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('applyMutation: wall-height', () => {
  test('assigns every wall a height from the fixed set', () => {
    const rng = mulberry32(2)
    const out = applyMutation(makeBaseGraph(), rng, 'wall-height')
    const allowed = new Set([2.4, 2.6, 2.7, 3.0])
    for (const node of Object.values(out.nodes)) {
      if (node.type !== 'wall') continue
      expect(allowed.has((node as { height: number }).height)).toBe(true)
    }
  })
})

describe('applyMutation: zone-labels', () => {
  test('shuffles labels but preserves the set', () => {
    const base = makeBaseGraph()
    const rng = mulberry32(3)
    const out = applyMutation(base, rng, 'zone-labels')
    const before = new Set<string>()
    for (const node of Object.values(base.nodes)) {
      if (node.type === 'zone') before.add((node as { name: string }).name)
    }
    const after = new Set<string>()
    for (const node of Object.values(out.nodes)) {
      if (node.type === 'zone') after.add((node as { name: string }).name)
    }
    expect(after).toEqual(before)
  })
})

describe('applyMutation: room-proportions', () => {
  test('only nudges interior walls, leaves perimeter alone', () => {
    const base = makeBaseGraph()
    const rng = mulberry32(4)
    const out = applyMutation(base, rng, 'room-proportions')
    // Perimeter wall should be unchanged.
    const n = out.nodes.wall_n as { start: [number, number]; end: [number, number] }
    expect(n.start).toEqual([-10, 10])
    expect(n.end).toEqual([10, 10])
    // Interior wall should (usually) be different.
    const mid = out.nodes.wall_mid as { start: [number, number]; end: [number, number] }
    const midBase = base.nodes.wall_mid as { start: [number, number]; end: [number, number] }
    const changed =
      mid.start[0] !== midBase.start[0] ||
      mid.start[1] !== midBase.start[1] ||
      mid.end[0] !== midBase.end[0] ||
      mid.end[1] !== midBase.end[1]
    expect(changed).toBe(true)
  })
})

describe('applyMutation: open-plan', () => {
  test('removes exactly one interior wall and its attached openings', () => {
    const base = makeBaseGraph()
    const baseWallCount = Object.values(base.nodes).filter((n) => n.type === 'wall').length
    const rng = mulberry32(5)
    const out = applyMutation(base, rng, 'open-plan')
    const afterWallCount = Object.values(out.nodes).filter((n) => n.type === 'wall').length
    expect(afterWallCount).toBe(baseWallCount - 1)
    // Interior wall `wall_mid` had a door — both should be gone.
    expect(out.nodes.wall_mid).toBeUndefined()
    expect(out.nodes.door_mid).toBeUndefined()
  })

  test('skips gracefully when there are no interior walls', () => {
    const site = SiteNode.parse({
      id: 'site_a',
      parentId: null,
      polygon: {
        type: 'polygon',
        points: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      },
      children: [],
    })
    const wallN = WallNode.parse({
      id: 'wall_n',
      parentId: 'site_a',
      start: [-10, 10],
      end: [10, 10],
      thickness: 0.1,
      height: 2.5,
      children: [],
    })
    const graph: SceneGraph = {
      nodes: nodesById([site, wallN]),
      rootNodeIds: [site.id],
    }
    const out = applyMutation(graph, mulberry32(9), 'open-plan')
    expect(Object.keys(out.nodes)).toEqual(Object.keys(graph.nodes))
  })
})

describe('applyMutation: door-positions', () => {
  test('sets every door wallT in [0.2, 0.8]', () => {
    const rng = mulberry32(6)
    const out = applyMutation(makeBaseGraph(), rng, 'door-positions')
    for (const node of Object.values(out.nodes)) {
      if (node.type !== 'door') continue
      const t = (node as { wallT?: number }).wallT
      expect(typeof t).toBe('number')
      expect(t as number).toBeGreaterThanOrEqual(0.2)
      expect(t as number).toBeLessThanOrEqual(0.8)
    }
  })
})

describe('applyMutation: fence-style', () => {
  test('sets every fence style to one of privacy/slat/rail', () => {
    const rng = mulberry32(7)
    const out = applyMutation(makeBaseGraph(), rng, 'fence-style')
    const allowed = new Set(['privacy', 'slat', 'rail'])
    for (const node of Object.values(out.nodes)) {
      if (node.type !== 'fence') continue
      expect(allowed.has((node as { style: string }).style)).toBe(true)
    }
  })
})

describe('applyMutation: no-op behaviour', () => {
  test('wall-thickness on a graph with no walls leaves nodes unchanged', () => {
    const site = SiteNode.parse({
      id: 'site_a',
      parentId: null,
      polygon: {
        type: 'polygon',
        points: [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      },
      children: [],
    })
    const graph: SceneGraph = {
      nodes: nodesById([site]),
      rootNodeIds: [site.id],
    }
    const out = applyMutation(graph, mulberry32(8), 'wall-thickness')
    expect(JSON.stringify(out.nodes)).toBe(JSON.stringify(graph.nodes))
  })
})
