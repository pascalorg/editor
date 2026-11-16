import { describe, expect, test } from 'bun:test'
import { createTerrainField, encodeTerrainField } from '@pascal-app/core'
import { AGENT_OPERATIONS } from '@pascal-app/core/agent-operations'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  TerrainBreakNode,
  WallNode,
} from '@pascal-app/core/schema'

type Nodes = Record<string, AnyNode>
type BreakIssue = {
  type: string
  nodeId: string
  breakId: string
  sides: string[]
  sideHeightRanges: { left: { minM: number; maxM: number }; right: { minM: number; maxM: number } }
  dropM: { minM: number; maxM: number }
  coordinateFrame: string
}
const context = { activeLevelId: null }

function fixture() {
  const field = createTerrainField({ cols: 41, rows: 41, spacing: 1 })
  const edge = TerrainBreakNode.parse({
    id: 'terrain-break_observed',
    parentId: 'site_observed',
    kind: 'cliff',
    line: [
      [10, 0],
      [10, 40],
    ],
    left: 5,
    right: 2,
  })
  const site = SiteNode.parse({
    id: 'site_observed',
    children: ['building_observed', edge.id],
    terrain: encodeTerrainField(field),
  })
  // +90° about Y maps level-local (x,z) to Site (10+z,20-x).
  const building = BuildingNode.parse({
    id: 'building_observed',
    parentId: site.id,
    children: ['level_observed'],
    position: [10, 0, 20],
    rotation: [0, Math.PI / 2, 0],
  })
  const level = LevelNode.parse({
    id: 'level_observed',
    parentId: building.id,
    level: 0,
    children: ['slab_observed', 'wall_observed'],
  })
  const slab = SlabNode.parse({
    id: 'slab_observed',
    parentId: level.id,
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
    elevation: 5,
    thickness: 0.2,
  })
  // The centreline lies ON the break. The solid wall footprint straddles it.
  const wall = WallNode.parse({
    id: 'wall_observed',
    parentId: level.id,
    start: [-2, 0],
    end: [2, 0],
    thickness: 0.5,
  })
  const nodes: Nodes = Object.fromEntries(
    [site, building, level, slab, wall, edge].map((node) => [node.id, node]),
  )
  return { nodes, edge, site, slab, wall }
}

function issues(nodes: Nodes): BreakIssue[] {
  const result = AGENT_OPERATIONS.verify_scene(nodes, {}, context).result
  return (result.issues as BreakIssue[]).filter((issue) => issue.type === 'terrain_break_straddled')
}

// Expectations are Site-space solid intersection facts, not building-local
// centreline tests or a decision to reject/repair the authored scene.
describe('verify_scene terrain break observations', () => {
  test('reports transformed slab solid and wall footprint with both side ranges and drop facts', () => {
    const { nodes, edge } = fixture()
    const frozen = JSON.stringify(nodes)
    const observations = issues(nodes)
    expect(observations.map((issue) => issue.nodeId).sort()).toEqual([
      'slab_observed',
      'wall_observed',
    ])
    for (const issue of observations) {
      expect(issue).toMatchObject({
        type: 'terrain_break_straddled',
        breakId: edge.id,
        sides: ['left', 'right'],
        sideHeightRanges: { left: { minM: 5, maxM: 5 }, right: { minM: 2, maxM: 2 } },
        dropM: { minM: 3, maxM: 3 },
        coordinateFrame: 'site',
      })
    }
    expect(JSON.stringify(nodes)).toBe(frozen)
  })

  test('touching the break is not straddling it, for either slab boundary or wall face', () => {
    const { nodes, slab, wall } = fixture()
    nodes[slab.id] = SlabNode.parse({
      ...slab,
      polygon: [
        [-2, 0],
        [2, 0],
        [2, 2],
        [-2, 2],
      ],
    })
    nodes[wall.id] = WallNode.parse({ ...wall, start: [-2, 0.25], end: [2, 0.25] })
    expect(issues(nodes)).toEqual([])
  })

  test('a closed break entirely within a slab courtyard hole is not an occupied-slab observation', () => {
    const { nodes, edge, slab, wall } = fixture()
    nodes[edge.id] = TerrainBreakNode.parse({
      ...edge,
      kind: 'retaining',
      line: [
        [9, 19],
        [11, 19],
        [11, 21],
        [9, 21],
        [9, 19],
      ],
    })
    nodes[slab.id] = SlabNode.parse({
      ...slab,
      holes: [
        [
          [-1.5, -1.5],
          [-1.5, 1.5],
          [1.5, 1.5],
          [1.5, -1.5],
        ],
      ],
    })
    delete nodes[wall.id]
    nodes.level_observed = LevelNode.parse({ ...nodes.level_observed, children: [slab.id] })
    expect(issues(nodes)).toEqual([])
  })

  test('old no-break scenes produce no terrain-break observation', () => {
    const { nodes, edge, site } = fixture()
    delete nodes[edge.id]
    nodes[site.id] = SiteNode.parse({
      ...site,
      children: site.children.filter((id) => id !== edge.id),
    })
    expect(issues(nodes)).toEqual([])
  })
})
