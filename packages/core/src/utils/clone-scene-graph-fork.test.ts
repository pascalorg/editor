import { afterEach, expect, test } from 'bun:test'
import { mezzanineFixture } from '../lib/__fixtures__/mezzanine'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  SiteNode,
  StairNode,
  StairSegmentNode,
  WallNode,
} from '../schema'
import type { AnyNodeId } from '../schema/types'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { forkSceneGraph } from './clone-scene-graph'

const previous = useScene.getState()
afterEach(() => {
  useScene.setState(previous, true)
  clearSceneHistory()
})

function load(nodes: Record<string, unknown>, rootNodeIds: string[]) {
  clearSceneHistory()
  useScene.getState().setScene(structuredClone(nodes) as never, rootNodeIds as never)
  return JSON.parse(JSON.stringify(useScene.getState().nodes)) as Record<string, AnyNode>
}

/**
 * A two-storey building as the editor saves it: a mezzanine room on the ground
 * floor, a room upstairs, and a stair between them that cuts its opening
 * through the upper floor.
 */
function savedScene() {
  const { nodes: ground } = mezzanineFixture()
  let serial = 0
  const mintId = (kind: string) => `${kind}_fork${++serial}`
  const ring: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ]
  const upper = LevelNode.parse({ id: 'level_upper', level: 1, height: 3 })
  const walls = ring.map((start, i) =>
    WallNode.parse({
      id: mintId('wall'),
      parentId: upper.id,
      start,
      end: ring[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  upper.children = walls.map((wall) => wall.id)
  const stair = StairNode.parse({
    id: 'stair_fork',
    parentId: 'level_mezz',
    fromLevelId: 'level_mezz',
    toLevelId: upper.id,
    slabOpeningMode: 'destination',
    position: [6, 0, 3],
  })
  const segment = StairSegmentNode.parse({
    id: 'sseg_fork',
    parentId: stair.id,
    height: 5,
    length: 4,
    width: 1,
  })
  stair.children = [segment.id]
  const site = SiteNode.parse({ id: 'site_fork', children: ['building_fork'] })
  const building = BuildingNode.parse({
    id: 'building_fork',
    parentId: site.id,
    children: ['level_mezz', upper.id],
  })
  const level = ground.level_mezz as LevelNode
  const nodes: Record<string, AnyNode> = {
    ...ground,
    level_mezz: { ...level, parentId: building.id, children: [...level.children, stair.id] },
    [site.id]: site,
    [building.id]: building,
    [upper.id]: upper,
    [stair.id]: stair,
    [segment.id]: segment,
  }
  for (const wall of walls) nodes[wall.id] = wall
  const reconciled = reconcileSceneStructure({ nodes, mintId }).nodes
  // What autosave stores after the first open.
  return { nodes: load(reconciled, [site.id]), rootNodeIds: [site.id] }
}

/** Every string value and object key anywhere in a node, except its own id. */
function references(node: AnyNode): string[] {
  const out: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) for (const entry of value) walk(entry)
    else if (value && typeof value === 'object')
      for (const [key, entry] of Object.entries(value)) {
        out.push(key)
        walk(entry)
      }
  }
  for (const [key, value] of Object.entries(node)) if (key !== 'id') walk(value)
  return out
}

test('a forked scene keeps no reference to the source ids and opens as a no-op', () => {
  const saved = savedScene()
  // The fixture carries the references a fork has to rewrite.
  const kinds = Object.values(saved.nodes)
  expect(
    kinds.some(
      (node) =>
        (node.type === 'slab' || node.type === 'ceiling') &&
        node.holeMetadata?.some((entry) => entry.source === 'stair' || entry.openingId),
    ) || kinds.some((node) => node.type === 'floor-opening' && node.ownerId === 'stair_fork'),
  ).toBe(true)
  expect(kinds.some((node) => node.type === 'zone' && node.hostZoneId)).toBe(true)
  expect(kinds.some((node) => node.type === 'zone' && node.boundaryWallIds?.length)).toBe(true)
  // The saved scene is canonical: opening it again changes nothing.
  expect(load(saved.nodes, saved.rootNodeIds)).toEqual(saved.nodes)

  const fork = forkSceneGraph({
    nodes: saved.nodes as Record<AnyNodeId, AnyNode>,
    rootNodeIds: saved.rootNodeIds as AnyNodeId[],
  })
  const sourceIds = new Set(Object.keys(saved.nodes))
  const leaked = Object.values(fork.nodes).flatMap((node) =>
    references(node)
      .filter((value) => sourceIds.has(value))
      .map((value) => `${node.type}: ${value}`),
  )
  expect(leaked).toEqual([])
  expect(Object.keys(fork.nodes).length).toBe(sourceIds.size)

  // First open of the fork: reconcile has nothing to write.
  expect(load(fork.nodes, fork.rootNodeIds)).toEqual(
    JSON.parse(JSON.stringify(fork.nodes)) as Record<string, AnyNode>,
  )
})

/** Slab and ceiling cuts and floor openings, without ids: what a viewer sees. */
function openingShapes(nodes: Record<string, AnyNode>) {
  const round = (value: unknown): unknown =>
    typeof value === 'number'
      ? Math.round(value * 1e4) / 1e4
      : Array.isArray(value)
        ? value.map(round)
        : value
  const shapes: string[] = []
  for (const node of Object.values(nodes)) {
    if (node.type === 'slab' || node.type === 'ceiling')
      shapes.push(
        JSON.stringify([
          node.type,
          round(node.polygon),
          round(node.holes ?? []),
          (node.holeMetadata ?? []).map((m) => m.source),
        ]),
      )
    if (node.type === 'floor-opening')
      shapes.push(JSON.stringify([node.type, round(node.polygon), node.source]))
  }
  return shapes.sort()
}

test('a fork of a legacy scene with a stair cut opens with the same cuts as its source', () => {
  // As production stores it: no level heights, and the stair's cut kept as
  // slab and ceiling holes tagged with the stair id.
  const node = (
    id: string,
    type: string,
    parentId: string | null,
    extra: Record<string, unknown> = {},
  ) => ({
    object: 'node',
    id,
    type,
    parentId,
    visible: true,
    metadata: {},
    ...extra,
  })
  const outline = [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ]
  // Wider than the stair's own footprint, as saved cuts often are.
  const cut = [
    [4.5, 1.5],
    [7.5, 1.5],
    [7.5, 5.5],
    [4.5, 5.5],
  ]
  const nodes: Record<string, Record<string, unknown>> = {
    site_legacy: node('site_legacy', 'site', null, { children: ['building_legacy'] }),
    building_legacy: node('building_legacy', 'building', 'site_legacy', {
      children: ['level_legacy0', 'level_legacy1'],
    }),
    level_legacy0: node('level_legacy0', 'level', 'building_legacy', {
      level: 0,
      children: ['slab_legacy0', 'ceiling_legacy0', 'stair_legacy'],
    }),
    level_legacy1: node('level_legacy1', 'level', 'building_legacy', {
      level: 1,
      children: ['slab_legacy1'],
    }),
    slab_legacy0: node('slab_legacy0', 'slab', 'level_legacy0', {
      polygon: outline,
      elevation: 0.05,
    }),
    slab_legacy1: node('slab_legacy1', 'slab', 'level_legacy1', {
      polygon: outline,
      elevation: 0.05,
      holes: [cut],
      holeMetadata: [{ source: 'stair', stairId: 'stair_legacy' }],
    }),
    ceiling_legacy0: node('ceiling_legacy0', 'ceiling', 'level_legacy0', {
      polygon: outline,
      height: 2.5,
      holes: [cut],
      holeMetadata: [{ source: 'stair', stairId: 'stair_legacy' }],
    }),
    stair_legacy: node('stair_legacy', 'stair', 'level_legacy0', {
      position: [6, 0, 2],
      rotation: 0,
      fromLevelId: 'level_legacy0',
      toLevelId: 'level_legacy1',
      slabOpeningMode: 'destination',
      children: ['sseg_legacy'],
    }),
    sseg_legacy: node('sseg_legacy', 'stair-segment', 'stair_legacy', {
      width: 2,
      length: 3,
      height: 2.5,
      stepCount: 14,
      segmentType: 'stair',
      attachmentSide: 'front',
      position: [0, 0, 0],
      rotation: 0,
    }),
  }
  const source = load(nodes, ['site_legacy'])
  const fork = forkSceneGraph({
    nodes: nodes as unknown as Record<AnyNodeId, AnyNode>,
    rootNodeIds: ['site_legacy' as AnyNodeId],
  })
  const forkStair = Object.values(fork.nodes).find((n) => n.type === 'stair')!
  const forkSlab = Object.values(fork.nodes).find((n) => n.type === 'slab' && n.holes?.length)!
  expect(forkSlab.type === 'slab' && forkSlab.holeMetadata?.[0]).toEqual({
    source: 'stair',
    stairId: forkStair.id,
  })
  expect(openingShapes(load(fork.nodes, fork.rootNodeIds))).toEqual(openingShapes(source))
})
