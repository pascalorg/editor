import { type AnyNode, nodeRegistry } from '@pascal-app/core'
import { sceneViewBounds, sceneViewFacing } from '@pascal-app/core/agent-operations'
import type { RevealEvent } from '@pascal-app/viewer'
import type { Box, FollowWant } from './follow-pascal'

type Nodes = Readonly<Record<string, AnyNode>>

/**
 * The box `view_scene` would frame for `id`, in the site (a building away from the origin is framed
 * where it stands): the same bounds the agent's own views take, so the person sees what the agent
 * would look at. Null for a node there is nothing to frame of.
 */
function boxOf(nodes: Nodes, id: string): Box | null {
  try {
    const { min, max } = sceneViewBounds(nodes, id)
    return { min, max }
  } catch {
    return null
  }
}

function unionOf(boxes: readonly (Box | null)[]): Box | null {
  const known = boxes.filter((box): box is Box => box !== null)
  const first = known[0]
  if (!first) return null
  const min: Box['min'] = [...first.min]
  const max: Box['max'] = [...first.max]
  for (const box of known) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!)
      max[axis] = Math.max(max[axis]!, box.max[axis]!)
    }
  }
  return { min, max }
}

function buildingOf(nodes: Nodes, id: string): string | null {
  let node = nodes[id]
  for (let guard = 0; node && guard < 32; guard += 1) {
    if (node.type === 'building') return node.id
    node = node.parentId ? nodes[node.parentId] : undefined
  }
  return null
}

/** A roof that lifts for the furniture is looked down through: the eye clears its lifted top by this. */
const LIFTED_ROOF_MARGIN = 1.5

/**
 * How high the eye must stand to look at something in a building: above every roof of it that lifts
 * out of the way of the furnishing, where it is lifted to. Undefined when nothing lifts.
 */
function clearanceAbove(nodes: Nodes, id: string): number | undefined {
  const building = buildingOf(nodes, id)
  if (!building) return undefined
  let highest: number | undefined
  for (const node of Object.values(nodes)) {
    if (node.type !== 'roof' || buildingOf(nodes, node.id) !== building) continue
    const clears = nodeRegistry.get(node.type)?.capabilities?.reveal?.clears
    const box = boxOf(nodes, node.id)
    if (!(clears && box)) continue
    highest = Math.max(highest ?? Number.NEGATIVE_INFINITY, box.max[1] + clears.height)
  }
  return highest === undefined ? undefined : highest + LIFTED_ROOF_MARGIN
}

/** The building `id` is in, roof and all, seen as a group; the eye clears a roof that is lifted. */
function wholeHouse(nodes: Nodes, id: string, at: number): FollowWant | null {
  const building = buildingOf(nodes, id)
  if (!building) return null
  const roofs = Object.values(nodes).filter(
    (node) => node.type === 'roof' && buildingOf(nodes, node.id) === building,
  )
  const box = unionOf([boxOf(nodes, building), ...roofs.map((roof) => boxOf(nodes, roof.id))])
  if (!box) return null
  const eyeAbove = clearanceAbove(nodes, id)
  return { kind: 'group', box, ...(eyeAbove === undefined ? {} : { eyeAbove }), at }
}

/**
 * What the camera should look at for something the reveal said, or null when it says nothing about
 * where to look. A floor, whole, when its slabs and walls start (the walls are not targets one by
 * one: the floor already is); each opening close up from outside; each piece of furniture from above;
 * the roof from the group that assembles it; the whole house, roof and all, when it is finished. An
 * undo's reverse play is followed the same way, group by group, on what goes.
 */
export function wantFromEvent(event: RevealEvent, nodes: Nodes, at: number): FollowWant | null {
  switch (event.type) {
    case 'start': {
      if (event.phase === 'roof') {
        const box = unionOf(event.nodeIds.map((id) => boxOf(nodes, id)))
        return box ? { kind: 'roof', box, at } : null
      }
      if (
        event.phase !== 'foundation' &&
        event.phase !== 'structure' &&
        event.phase !== 'circulation'
      )
        return null
      const box =
        (event.levelId ? boxOf(nodes, event.levelId) : null) ??
        unionOf(event.nodeIds.map((id) => boxOf(nodes, id)))
      return box ? { kind: 'floor', box, at } : null
    }
    case 'node-start': {
      if (event.phase === 'openings') {
        const box = boxOf(nodes, event.id)
        if (!box) return null
        const normal = sceneViewFacing(nodes, event.id)
        return { kind: 'detail', box, ...(normal ? { normal } : {}), at }
      }
      if (event.phase === 'furnishing') {
        const box = boxOf(nodes, event.id)
        if (!box) return null
        const eyeAbove = clearanceAbove(nodes, event.id)
        return { kind: 'furnish', box, ...(eyeAbove === undefined ? {} : { eyeAbove }), at }
      }
      return null
    }
    case 'settle': {
      // A piece the agent moved: nothing is coming down on the camera, it stays on the piece.
      if (event.changed) return null
      // The furniture has landed: pull back to the whole house while the roof is still up, so the
      // roof does not come down on a camera that is close above it.
      const id = event.phase === 'furnishing' ? event.nodeIds[0] : undefined
      return id ? wholeHouse(nodes, id, at) : null
    }
    case 'finale':
      return wholeHouse(nodes, event.id, at)
    case 'retract-start': {
      // An undo plays the build backwards: the camera is on what goes, a phase at a time.
      const box = unionOf(event.nodeIds.map((id) => boxOf(nodes, id)))
      if (!box) return null
      if (event.phase === 'roof') return { kind: 'roof', box, at }
      if (event.phase === 'furnishing') {
        const eyeAbove = clearanceAbove(nodes, event.nodeIds[0] ?? '')
        return { kind: 'furnish', box, ...(eyeAbove === undefined ? {} : { eyeAbove }), at }
      }
      return { kind: event.phase === 'openings' ? 'group' : 'floor', box, at }
    }
    default:
      return null
  }
}
