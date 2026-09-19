import { getFloorPlacedFootprints } from '../hooks/spatial-grid/floor-placed-footprints'
import { itemOverlapsPolygon } from '../lib/item-polygon-overlap'
import {
  pointInPolygon as containsPoint,
  type Point2D,
  polygonsOverlap,
} from '../lib/polygon-relations'
import { getRenderableSlabPolygon } from '../lib/slab-polygon'
import { levelBaseElevationAt } from '../lib/terrain-support'
import { nodeRegistry } from '../registry/registry'
import { getBlockFaceFrame } from '../schema/nodes/block'
import type { ItemNode } from '../schema/nodes/item'
import { getRoofWallFaceFrame, roofFacePointToSegment } from '../schema/nodes/roof-segment-walls'
import type { SlabNode } from '../schema/nodes/slab'
import type { WallNode } from '../schema/nodes/wall'
import type { AnyNode } from '../schema/types'
import { resolveCeilingHeight } from '../services/level-height'
import { getStoredLevelHeight } from '../services/storey'
import { surfaceRegionContainsPoint } from '../services/surface-region'
import { computeWallSlabSupport, pointInPolygon } from '../systems/slab/slab-support'
import { getWallThickness } from '../systems/wall/wall-footprint'
import type { ProceduralItemNode } from './node'
import { evaluateRecipe, type Surface, type Vec3 } from './recipe'
import {
  boundsOf,
  boxCorners,
  composeFrames,
  type Frame,
  frame,
  IDENTITY_FRAME,
  transformPoint,
} from './spatial'

export type QueryNodes = Readonly<Record<string, AnyNode | ProceduralItemNode>>
export function isProceduralItem(node: unknown): node is ProceduralItemNode {
  return Boolean(
    node && typeof node === 'object' && 'type' in node && node.type === 'procedural-item',
  )
}
function levelSurfaces(nodes: QueryNodes, levelId: string) {
  const siblings = Object.values(nodes).filter((n) => n.parentId === levelId)
  return {
    slabs: siblings.filter((n): n is SlabNode => n.type === 'slab'),
    walls: siblings.filter((n): n is WallNode => n.type === 'wall'),
  }
}
export function proceduralLocalPose(node: ProceduralItemNode, nodes: QueryNodes) {
  const position = [...node.position] as Vec3,
    rotation = [...node.rotation] as Vec3
  if (
    node.recipe.mounting?.attachTo === 'ceiling' &&
    node.parentId &&
    nodes[node.parentId]?.type === 'ceiling'
  ) {
    const reference = evaluateRecipe(node.recipe, node.parameters).surfaces.find(
      (s) => s.id === node.recipe.mounting?.reference,
    )
    if (!reference) throw new Error('Missing mounting reference')
    const offset = transformPoint(frame([0, 0, 0], rotation), reference.position)
    for (let i = 0; i < 3; i++) position[i] = position[i]! - offset[i]!
    return { position, rotation }
  }
  if (!node.wallId) return { position, rotation }
  const wall = nodes[node.wallId]
  if (wall?.type !== 'wall') throw new Error('Missing wall host')
  const reference = evaluateRecipe(node.recipe, node.parameters).surfaces.find(
    (s) => s.id === node.recipe.mounting?.reference,
  )
  if (!reference) throw new Error('Missing mounting reference')
  const sign = node.side === 'back' ? -1 : 1
  rotation[1] = sign < 0 ? Math.PI : 0
  position[0] -= reference.position[0] * sign
  position[1] -= reference.position[1]
  position[2] = sign * (getWallThickness(wall) / 2 - reference.position[2] + node.position[2])
  return { position, rotation }
}
export function proceduralFootprint(node: ProceduralItemNode) {
  const e = evaluateRecipe(node.recipe, node.parameters)
  const center = e.min.map((v, i) => (v + e.max[i]!) / 2) as Vec3
  const position = transformPoint(frame(node.position, node.rotation), center)
  return { position, rotation: node.rotation, dimensions: e.dimensions }
}
function floorLift(node: AnyNode | ProceduralItemNode, nodes: QueryNodes): number {
  if (!node.parentId || nodes[node.parentId]?.type !== 'level' || !('position' in node)) return 0
  const position = node.position as Vec3
  const supportSlabId = (node as { supportSlabId?: string }).supportSlabId
  const capability = nodeRegistry.get(node.type)?.capabilities.floorPlaced
  const { slabs, walls } = levelSurfaces(nodes, node.parentId)
  const ground = levelBaseElevationAt(
    nodes as Record<string, AnyNode>,
    node.parentId,
    position[0],
    position[2],
  )
  if (supportSlabId === 'ground') return ground
  if (capability || node.type === 'cabinet' || node.type === 'cabinet-module') {
    const footprints = capability
      ? getFloorPlacedFootprints(capability, node, { nodes: nodes as Record<string, AnyNode> })
      : []
    const candidatesFor = (footprint: (typeof footprints)[number]) =>
      slabs.filter((slab) => {
        const footprintPosition = footprint.position ?? position
        return (
          itemOverlapsPolygon(
            footprintPosition,
            footprint.dimensions,
            footprint.rotation,
            getRenderableSlabPolygon(slab, { walls, siblingSlabs: slabs }),
            0.005,
          ) &&
          !(slab.holes ?? []).some((hole) =>
            pointInPolygon(footprintPosition[0], footprintPosition[2], hole),
          )
        )
      })
    const candidates = footprints.map(candidatesFor)
    const pinned = candidates.flat().find((slab) => slab.id === supportSlabId)
    if (pinned) return pinned.elevation ?? 0.05
    return candidates.length
      ? Math.max(
          ...candidates.map((slabs) =>
            slabs.length ? Math.max(...slabs.map((slab) => slab.elevation ?? 0.05)) : ground,
          ),
        )
      : ground
  }
  if (!(isProceduralItem(node) || node.type === 'item' || node.type === 'shelf')) return 0
  const footprint = isProceduralItem(node)
    ? proceduralFootprint(node)
    : {
        position: position,
        dimensions:
          node.type === 'shelf'
            ? ([node.width, node.height, node.depth] as Vec3)
            : (node.asset.dimensions.map((v, i) => v * node.scale[i]!) as Vec3),
        rotation: node.rotation,
      }
  const candidates = slabs.filter((s) => {
    const polygon = getRenderableSlabPolygon(s, { walls, siblingSlabs: slabs })
    return (
      itemOverlapsPolygon(
        footprint.position,
        footprint.dimensions,
        footprint.rotation,
        polygon,
        0.005,
      ) &&
      !(s.holes ?? []).some((h) => pointInPolygon(footprint.position[0], footprint.position[2], h))
    )
  })
  const pinned = candidates.find((s) => s.id === supportSlabId)
  return pinned
    ? (pinned.elevation ?? 0.05)
    : candidates.length
      ? Math.max(...candidates.map((s) => s.elevation ?? 0.05))
      : ground
}
function nodeParentFrame(node: AnyNode | ProceduralItemNode, nodes: QueryNodes, seen: Set<string>) {
  if (!node.parentId) return IDENTITY_FRAME
  let parentFrame = nodeLevelFrame(node.parentId, nodes, seen)
  const parent = nodes[node.parentId]
  if (isProceduralItem(parent) && parent.attachments[node.id] !== undefined) {
    const surface = evaluateRecipe(parent.recipe, parent.parameters).surfaces.find(
      (s) => s.id === parent.attachments[node.id],
    )
    if (!surface) throw new Error('Missing attachment surface')
    parentFrame = composeFrames(parentFrame, frame(surface.position, surface.rotation))
  }
  return parentFrame
}
export function nodeLevelFrame(id: string, nodes: QueryNodes, seen = new Set<string>()): Frame {
  if (seen.has(id) || seen.size > 32) throw new Error('Cyclic or excessively deep hosting graph')
  const node = nodes[id]
  if (!node) throw new Error(`Missing node ${id}`)
  if (node.type === 'level') return IDENTITY_FRAME
  seen.add(id)
  if (node.type === 'ceiling') {
    // Match the ceiling renderer's underside frame, including its 1 cm inset.
    return frame(
      [0, resolveCeilingHeight(node, nodes as Record<string, AnyNode>) - 0.01, 0],
      [0, 0, 0],
    )
  }
  if (node.type === 'wall') {
    const { slabs, walls } = levelSurfaces(nodes, node.parentId ?? '')
    const ground = levelBaseElevationAt(
      nodes as Record<string, AnyNode>,
      node.parentId ?? '',
      node.start[0],
      node.start[1],
    )
    const support = computeWallSlabSupport(
      node,
      slabs,
      walls,
      node.supportSlabId,
      undefined,
      ground,
    )
    return frame(
      [node.start[0], support.elevation + (node.supportOffset ?? 0), node.start[1]],
      [0, -Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0]), 0],
    )
  }
  if (
    !(
      isProceduralItem(node) ||
      node.type === 'item' ||
      node.type === 'shelf' ||
      node.type === 'cabinet' ||
      node.type === 'cabinet-module'
    )
  ) {
    const transform = node as { position?: Vec3; rotation?: Vec3 | number }
    const rotation =
      typeof transform.rotation === 'number'
        ? ([0, transform.rotation, 0] as Vec3)
        : transform.rotation
    const position = [...(transform.position ?? [0, 0, 0])] as Vec3
    const capability = nodeRegistry.get(node.type)?.capabilities.floorPlaced
    if (!capability?.applies || capability.applies(node as AnyNode)) {
      position[1] += floorLift(node, nodes)
    }
    const local = node.type === 'slab' ? IDENTITY_FRAME : frame(position, rotation ?? [0, 0, 0])
    return node.parentId ? composeFrames(nodeParentFrame(node, nodes, seen), local) : local
  }
  const pose = isProceduralItem(node)
    ? proceduralLocalPose(node, nodes)
    : {
        position: [...node.position] as Vec3,
        rotation:
          typeof node.rotation === 'number' ? ([0, node.rotation, 0] as Vec3) : node.rotation,
      }
  const parent = node.parentId ? nodes[node.parentId] : undefined
  if (!node.parentId) return frame(pose.position, pose.rotation)
  if (node.type === 'item' && parent?.type === 'roof-segment' && node.roofFace) {
    const face = getRoofWallFaceFrame(parent, node.roofFace)
    const local = frame(roofFacePointToSegment(parent, node.roofFace, pose.position), pose.rotation)
    local.axes = composeFrames(
      frame([0, 0, 0], [0, face.yaw, 0]),
      frame([0, 0, 0], pose.rotation),
    ).axes
    return composeFrames(nodeLevelFrame(parent.id, nodes, seen), local)
  }
  if (node.type === 'item' && parent?.type === 'block' && node.blockFaceId) {
    const face = getBlockFaceFrame(parent.topology, node.blockFaceId)
    if (face) {
      const host = nodeLevelFrame(parent.id, nodes, seen)
      return composeFrames(
        host,
        composeFrames(
          { position: face.origin, axes: [face.xAxis, face.yAxis, face.normal] },
          frame(pose.position, pose.rotation),
        ),
      )
    }
  }
  const parentFrame = nodeParentFrame(node, nodes, seen)
  if (parent?.type === 'level') pose.position[1] += floorLift(node, nodes)
  return composeFrames(parentFrame, frame(pose.position, pose.rotation))
}
function localBounds(node: ProceduralItemNode | ItemNode) {
  if (isProceduralItem(node)) return evaluateRecipe(node.recipe, node.parameters)
  const d = node.asset.dimensions.map((v, i) => v * node.scale[i]!) as Vec3
  return { min: [-d[0] / 2, 0, -d[2] / 2] as Vec3, max: [d[0] / 2, d[1], d[2] / 2] as Vec3 }
}
export function attachmentBounds(child: ProceduralItemNode | ItemNode) {
  const b = localBounds(child)
  return boundsOf(
    boxCorners(b.min, b.max).map((p) => transformPoint(frame(child.position, child.rotation), p)),
  )
}
export function attachmentRegionsOverlap(
  a: ReturnType<typeof attachmentBounds>,
  b: ReturnType<typeof attachmentBounds>,
) {
  return (
    a.min[0] < b.max[0] - 1e-6 &&
    a.max[0] > b.min[0] + 1e-6 &&
    a.min[2] < b.max[2] - 1e-6 &&
    a.max[2] > b.min[2] + 1e-6
  )
}
function ceilingContainsFootprint(outer: Point2D[], footprint: Point2D[]) {
  if (!footprint.every((p) => containsPoint(p, outer))) return false
  // A concave boundary can cross a footprint whose corners all lie inside.
  // Clip each boundary segment against the open, convex footprint interior.
  return !outer.some((a, i) => {
    const b = outer[(i + 1) % outer.length]!
    let enter = 0
    let exit = 1
    for (let j = 0; j < footprint.length; j++) {
      const c = footprint[j]!,
        d = footprint[(j + 1) % footprint.length]!
      const distance = (p: Point2D) =>
        ((d[0] - c[0]) * (p[1] - c[1]) - (d[1] - c[1]) * (p[0] - c[0])) /
          Math.hypot(d[0] - c[0], d[1] - c[1]) -
        1e-6
      const start = distance(a),
        end = distance(b)
      if (start <= 0 && end <= 0) return false
      if (start <= 0) enter = Math.max(enter, -start / (end - start))
      else if (end <= 0) exit = Math.min(exit, start / (start - end))
      if (enter >= exit) return false
    }
    return enter < exit
  })
}
export function validateProceduralRelations(raw: AnyNode | ProceduralItemNode, nodes: QueryNodes) {
  if (!isProceduralItem(raw)) return
  const node = raw,
    evaluation = evaluateRecipe(node.recipe, node.parameters)
  const draft = node.metadata as { isNew?: boolean; isTransient?: boolean } | undefined
  const awaitingHost =
    (draft?.isNew || draft?.isTransient) &&
    !node.wallId &&
    node.parentId &&
    nodes[node.parentId]?.type === 'level'
  if (node.recipe.mounting?.attachTo === 'ceiling' && !awaitingHost) {
    const ceiling = node.parentId ? nodes[node.parentId] : undefined
    if (ceiling?.type !== 'ceiling' || node.wallId || node.side)
      throw new Error('This design needs a ceiling host')
    if (Math.abs(node.rotation[0]) > 1e-8 || Math.abs(node.rotation[2]) > 1e-8)
      throw new Error('Ceiling designs allow Y rotation only')
    if (Math.abs(node.position[1]) > 1e-6)
      throw new Error('The top reference must be flush with the ceiling')
    const pose = proceduralLocalPose(node, nodes)
    const f = frame(pose.position, pose.rotation)
    const b = boundsOf(boxCorners(evaluation.min, evaluation.max).map((p) => transformPoint(f, p)))
    const height = nodeLevelFrame(ceiling.id, nodes).position[1]
    const level = ceiling.parentId ? nodes[ceiling.parentId] : undefined
    if (
      b.min[1] + height < -1e-6 ||
      b.max[1] > 1e-6 ||
      b.max[1] + height > getStoredLevelHeight(level?.type === 'level' ? level : {}) + 1e-6
    )
      throw new Error('The hanging design must fit below the ceiling within the level height')
    const footprint: Point2D[] = [
      [evaluation.min[0], evaluation.min[2]],
      [evaluation.max[0], evaluation.min[2]],
      [evaluation.max[0], evaluation.max[2]],
      [evaluation.min[0], evaluation.max[2]],
    ].map(([x, z]) => {
      const p = transformPoint(f, [x!, 0, z!])
      return [p[0], p[2]]
    })
    if (
      !ceilingContainsFootprint(ceiling.polygon, footprint) ||
      ceiling.holes.some((hole) => polygonsOverlap(hole, footprint))
    )
      throw new Error('The hanging design must fit inside the ceiling, outside its holes')
  } else if (node.recipe.mounting?.attachTo === 'wall-side' && !awaitingHost) {
    const wall = node.wallId ? nodes[node.wallId] : undefined
    if (wall?.type !== 'wall' || node.parentId !== wall.id)
      throw new Error('This design needs a wall host')
    if (wall.curveOffset) throw new Error('Curved wall mounting is not supported yet')
    if (node.rotation.some((v) => Math.abs(v) > 1e-8))
      throw new Error('Move the item onto a wall face or press R to flip it')
    const pose = proceduralLocalPose(node, nodes)
    const b = boundsOf(
      boxCorners(evaluation.min, evaluation.max).map((p) =>
        transformPoint(frame(pose.position, pose.rotation), p),
      ),
    )
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const level = wall.parentId ? nodes[wall.parentId] : undefined
    const height = wall.height ?? (level?.type === 'level' ? level.height : 2.5) ?? 2.5
    if (
      b.min[0] < -1e-6 ||
      b.max[0] > length + 1e-6 ||
      b.min[1] < -1e-6 ||
      b.max[1] > height + 1e-6 ||
      node.position[2] < 0
    )
      throw new Error('The mounted item must fit on the wall')
  } else if (
    node.wallId ||
    (node.parentId && ['wall', 'ceiling'].includes(nodes[node.parentId]?.type ?? ''))
  )
    throw new Error('A floor design cannot be attached to a wall or ceiling')
  const regions = new Map<string, ReturnType<typeof attachmentBounds>[]>()
  for (const childId of node.children) {
    const child = nodes[childId]
    if (!child || child.parentId !== node.id) throw new Error('Invalid hosted child link')
    if (!(isProceduralItem(child) || child.type === 'item'))
      throw new Error('Unsupported hosted child')
    if (node.attachments[childId] === undefined) continue
    const surface = evaluation.surfaces.find((s) => s.id === node.attachments[childId])
    if (!surface) throw new Error('Choose a named attachment surface for the child')
    const b = attachmentBounds(child)
    if (
      !surfaceRegionContainsPoint(
        { kind: 'rect', size: [surface.size[0] / 2, surface.size[1] / 2] },
        [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2],
      ) ||
      Math.abs(b.min[1]) > 1e-6
    )
      throw new Error(`The hosted item does not fit on ${surface.label}`)
    // A fresh duplicate initially overlaps its source; only committed children occupy a surface.
    if (child.metadata?.isNew === true) continue
    const occupied = regions.get(surface.id) ?? []
    if (occupied.some((a) => attachmentRegionsOverlap(a, b)))
      throw new Error(`Another item occupies ${surface.label}`)
    occupied.push(b)
    regions.set(surface.id, occupied)
  }
}
export function queryProceduralItem(node: ProceduralItemNode, nodes: QueryNodes) {
  const e = evaluateRecipe(node.recipe, node.parameters),
    f = nodeLevelFrame(node.id, nodes[node.id] === node ? nodes : { ...nodes, [node.id]: node })
  const bounds = boundsOf(boxCorners(e.min, e.max).map((p) => transformPoint(f, p)))
  return {
    id: node.id,
    kind: node.type,
    classification: node.recipe.classification ?? null,
    hostId: node.parentId,
    wallId: node.wallId ?? null,
    parameters: e.parameters,
    localBounds: { min: e.min, max: e.max, dimensions: e.dimensions },
    levelBounds: bounds,
    frame: f,
    footprint: [
      [bounds.min[0], bounds.min[2]],
      [bounds.max[0], bounds.min[2]],
      [bounds.max[0], bounds.max[2]],
      [bounds.min[0], bounds.max[2]],
    ],
    surfaces: e.surfaces.map((s: Surface) => ({
      ...s,
      frame: composeFrames(f, frame(s.position, s.rotation)),
    })),
    children: node.children,
  }
}
