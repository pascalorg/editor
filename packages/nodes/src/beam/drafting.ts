import {
  type AnyNode,
  type AnyNodeId,
  BeamNode,
  beamTopReferencePatch,
  createBeam,
  getWallFaceLine,
  type WallNode,
} from '@pascal-app/core'
import {
  getSegmentGridStep,
  isAngleSnapActive,
  isMagneticSnapActive,
  snapBuildingLocalToWorldGrid,
  snapWallDraftPointDetailed,
  type WallDraftSnapKind,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { type BeamDraftChoices, useBeamDraft } from './draft-settings'

type Nodes = Readonly<Record<AnyNodeId, AnyNode>>

/** A segment as the wall snap reads a wall: its ends, its middle and its body catch a point. */
function reference(
  id: string,
  parentId: string | null,
  start: WallPlanPoint,
  end: WallPlanPoint,
): WallNode {
  return {
    object: 'node',
    id: id as WallNode['id'],
    type: 'wall',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

const targetsMemo = new WeakMap<object, Map<string, WallNode[]>>()

/**
 * What a beam drawn on `levelId` snaps to, through the wall snap (`snapWallDraftPoint`): the
 * level's wall centrelines and both faces of each straight wall (so a beam end lands on a wall's
 * face or its corner), other beams' centrelines (their ends, middles and runs), and every post
 * and column centre (a segment of no length). Kept per scene, so a pointer move asks once.
 */
export function beamSnapTargets(
  nodes: Nodes,
  levelId: string,
  ignoreIds: readonly string[] = [],
): WallNode[] {
  const key = `${levelId}|${ignoreIds.join(',')}`
  let byKey = targetsMemo.get(nodes)
  if (!byKey) {
    byKey = new Map()
    targetsMemo.set(nodes, byKey)
  }
  const cached = byKey.get(key)
  if (cached) return cached
  const targets: WallNode[] = []
  for (const node of Object.values(nodes)) {
    if (node.parentId !== levelId || node.visible === false || ignoreIds.includes(node.id)) continue
    if (node.type === 'wall') {
      targets.push(node)
      if (Math.abs(node.curveOffset ?? 0) > 1e-6) continue
      for (const face of ['a', 'b'] as const) {
        const line = getWallFaceLine(node, face)
        targets.push(
          reference(
            `${node.id}:${face}`,
            node.parentId,
            [line.start.x, line.start.y],
            [line.end.x, line.end.y],
          ),
        )
      }
    } else if (node.type === 'beam') {
      targets.push(reference(node.id, node.parentId, node.start, node.end))
    } else if (node.type === 'column') {
      const centre: WallPlanPoint = [node.position[0], node.position[2]]
      targets.push(reference(node.id, node.parentId, centre, centre))
    }
  }
  byKey.set(key, targets)
  return targets
}

/** A snapped plan point and what caught it (null: the grid, an angle step, or nothing). */
export type BeamPlanSnap = { point: WallPlanPoint; snap: WallDraftSnapKind | null }

/**
 * A beam point snapped as the beam tool snaps: wall and beam ends, faces, middles and crossings,
 * post centres, the grid, and from `start` the angle steps. `free` (Alt) places it as it is.
 */
export function snapBeamPoint(args: {
  point: WallPlanPoint
  nodes: Nodes
  levelId: string
  start?: WallPlanPoint | null
  ignoreIds?: readonly string[]
  free?: boolean
}): BeamPlanSnap {
  if (args.free) return { point: args.point, snap: null }
  const step = getSegmentGridStep()
  const angleSnap = !!args.start && isAngleSnapActive()
  const result = snapWallDraftPointDetailed({
    point: args.point,
    walls: beamSnapTargets(args.nodes, args.levelId, args.ignoreIds),
    start: args.start ?? undefined,
    angleSnap,
    magnetic: isMagneticSnapActive(),
    gridSnap: (point) => snapBuildingLocalToWorldGrid(point, step),
  })
  return { point: result.point, snap: result.snap }
}

/**
 * The beam a draft makes from `start` to `end` on `levelId` with the tool's choices, its top set
 * from the chosen reference; `seed` (a preset the host armed the tool with) overrides them.
 */
export function draftBeam(
  start: WallPlanPoint,
  end: WallPlanPoint,
  levelId: string,
  nodes: Nodes,
  choices: BeamDraftChoices = useBeamDraft.getState(),
  seed?: Readonly<Record<string, unknown>> | null,
  fields: Partial<BeamNode> = {},
): BeamNode {
  const base = createBeam({
    start,
    end,
    preset: choices.preset,
    material: choices.material,
    levelId,
  })
  const placed = { ...base, ...beamTopReferencePatch(nodes, base, choices.top) }
  return BeamNode.parse({
    ...placed,
    ...(seed ?? {}),
    ...fields,
    id: base.id,
    type: 'beam',
    start,
    end,
    parentId: levelId,
  })
}
