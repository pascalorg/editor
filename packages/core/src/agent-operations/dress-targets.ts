import { refuse } from '../agent-tools/refusal'
import type { AnyNode, CabinetModuleNode, WallNode } from '../schema'
import { runLocalToPlan } from '../systems/cabinet/run-coordinates'
import { getRunSpans } from '../systems/cabinet/run-spans'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import { inspectItemPlanFootprint, itemNodePlanCorners } from './door-clearance'
import { itemLevelPose } from './item-space'
import type { RoomWallFace } from './room-faces'
import type { SceneNodes } from './types'

type Plan = [number, number]

/** What a layer is laid against: the plan corners of a fixture or a cabinet run, and the worktop of a run. */
export type DressTarget = { id: string; corners: Plan[]; worktop?: number }

/** How far a footprint's edge may stand from a face and still stand against it, metres. */
export const STANDS_AGAINST_M = 0.15

/** The slack a footprint may sink into a face before it stands behind it instead, metres. */
const SINK_M = 0.03

const millimetre = (metres: number) => Math.round(metres * 1000) / 1000

/** Validate ancestry before using helpers that assume a well-formed level-local scene. */
function ancestors(nodes: SceneNodes, id: string): AnyNode[] {
  const chain: AnyNode[] = []
  const seen = new Set<string>([id])
  let parentId = nodes[id]?.parentId
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = nodes[parentId]
    if (!parent) break
    chain.push(parent)
    if (parent.type === 'level') return chain
    parentId = parent.parentId
  }
  return refuse('target_frame_unsupported', `${id} has missing or cyclic level ancestry.`, {
    target: id,
  })
}

export function dressLevel(nodes: SceneNodes, id: string): string {
  return ancestors(nodes, id).at(-1)!.id
}

function targetAncestors(nodes: SceneNodes, id: string, levelId: string): AnyNode[] {
  const chain = ancestors(nodes, id)
  if (chain.at(-1)!.id !== levelId)
    refuse('target_level_mismatch', `${id} is not on the room's level ${levelId}.`, {
      target: id,
      levelId,
    })
  return chain.slice(0, -1)
}

/** Keep oriented corners: an enclosing AABB can cross a diagonal wall behind the fixture. */
export function fixtureTarget(nodes: SceneNodes, id: string, levelId: string): DressTarget {
  const item = nodes[id]
  if (item?.type !== 'item')
    refuse('target_not_found', `${id} is not an item in the scene: nothing was changed.`, {
      target: id,
    })
  const chain = targetAncestors(nodes, id, levelId)
  for (const parent of chain)
    if (
      !['item', 'slab', 'ceiling'].includes(parent.type) ||
      (parent.type === 'item' &&
        (parent.rotation[0] !== 0 ||
          parent.rotation[2] !== 0 ||
          parent.scale.some((scale) => scale !== 1)))
    )
      refuse(
        'target_frame_unsupported',
        `${id} has an unsupported fixture host ${parent.id}; name its walls instead.`,
        { target: id },
      )
  const pose = itemLevelPose(item, new Map(chain.map((node) => [node.id, node])))
  if (!pose)
    refuse(
      'invalid_layer',
      `${item.name || id} is hosted on a wall and has no footprint on the floor: name its walls in where.walls instead.`,
      { target: id },
    )
  const posed = {
    ...item,
    position: pose.position,
    rotation: [item.rotation[0], pose.yawDeg, item.rotation[2]] as [number, number, number],
  }
  const footprint = inspectItemPlanFootprint(posed)
  if (!footprint.ok)
    refuse(
      'target_frame_unsupported',
      `${id} has no supported plan footprint: ${footprint.reason}.`,
      {
        target: id,
      },
    )
  return { id, corners: itemNodePlanCorners(posed).map(([x, z]): Plan => [x, z]) }
}

/** Native contiguous module spans preserve worktop steps, depth changes and gaps. */
export function runTargets(nodes: SceneNodes, id: string, levelId: string): DressTarget[] {
  const run = nodes[id]
  if (run?.type !== 'cabinet')
    refuse('target_not_found', `${id} is not a cabinet run in the scene: nothing was changed.`, {
      target: id,
    })
  if (run.runTier !== 'base')
    refuse(
      'invalid_layer',
      `${run.name || id} is a ${run.runTier} run: a worktop is on a base run.`,
      {
        target: id,
      },
    )
  let position = run.position
  let rotation = run.rotation
  for (const parent of targetAncestors(nodes, id, levelId)) {
    if (parent.type !== 'cabinet' && parent.type !== 'cabinet-module')
      refuse('target_frame_unsupported', `${id} has an unsupported cabinet host ${parent.id}.`, {
        target: id,
      })
    position = runLocalToPlan(parent, position)
    rotation += parent.rotation
  }
  const modules = run.children
    .map((child) => nodes[child])
    .filter((node): node is CabinetModuleNode => node?.type === 'cabinet-module')
  const spans = getRunSpans(modules, { runTier: run.runTier }).filter((span) => span.hasCountertop)
  if (!spans.length)
    refuse('invalid_layer', `${run.name || id} has no base modules to dress.`, {
      target: id,
    })
  return spans.map((span) => ({
    id,
    corners: (
      [
        [span.minX, span.minZ],
        [span.maxX, span.minZ],
        [span.maxX, span.maxZ],
        [span.minX, span.maxZ],
      ] as const
    ).map(([x, z]): Plan => {
      const [px, , pz] = runLocalToPlan({ position, rotation }, [x, 0, z])
      return [px, pz]
    }),
    // Module Y already contains its plinth/lift, exactly as the native countertop layout reads.
    worktop: position[1] + span.topY + (run.withCountertop ? run.countertopThickness : 0),
  }))
}

/**
 * The stretch of a face a target stands against, widened by `margin` and held to the stretch the room
 * stands on, in metres along the wall; undefined when the target is not at the face. A target stands
 * against a face when its nearest corner is within `STANDS_AGAINST_M` of the face's plane on the room's
 * side. A curved face has no straight plane to measure: the caller skips it.
 */
export function standsAgainst(
  wall: WallNode,
  stretch: RoomWallFace,
  corners: readonly Plan[],
  margin: number,
): { u0: number; u1: number } | undefined {
  const length = stretch.length
  const dx = (wall.end[0] - wall.start[0]) / length
  const dz = (wall.end[1] - wall.start[1]) / length
  // Face a is on the left of start to end; both normals point into the room.
  const sign = stretch.face === 'a' ? 1 : -1
  const plane = sign * getWallFaceOffsets(wall)[stretch.face]
  const along = corners.map(([x, z]) => (x - wall.start[0]) * dx + (z - wall.start[1]) * dz)
  const into = corners.map(
    ([x, z]) => sign * (-(x - wall.start[0]) * dz + (z - wall.start[1]) * dx),
  )
  const gap = Math.min(...into) - plane
  if (gap > STANDS_AGAINST_M || gap < -SINK_M) return undefined
  const u0 = Math.max(stretch.u0, millimetre(Math.min(...along) - margin))
  const u1 = Math.min(stretch.u1, millimetre(Math.max(...along) + margin))
  return u1 - u0 > 1e-6 ? { u0, u1 } : undefined
}
