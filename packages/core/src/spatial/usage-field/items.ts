import { itemLevelPose } from '../../agent-operations/item-space'
import { resolveLevelId } from '../../lib/node-ancestry'
import { wallSupportForNodes } from '../../lib/opening-floor-datum'
import type { AnyNode, GeometryShape, ItemNode, WallNode } from '../../schema'
import { getScaledDimensions } from '../../schema/nodes/item'
import { getLevelElevations } from '../../services/storey'
import {
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
} from '../../systems/wall/wall-curve'
import { getWallBodyCenterOffset, getWallLocalFaceZ } from '../../systems/wall/wall-frame'
import { catalogueShape } from './catalogue'
import { floorUnder, isHidden, type SupportCache } from './support'
import type { Prism, Ring, Skipped } from './types'
import type { Nodes } from './walls'

type Point = [number, number]
type Band = GeometryShape['bands'][number]

/** A stored shape no looser than this is read as the build's own outline. */
export const EXACT_SHAPE_TOLERANCE_M = 0.02
const ROTATION_EPSILON = 1e-9

export type ItemShapes = { itemId: string; levelId: string | null; prisms: Prism[] }

/** A band list in its own frame, with how far to trust it. */
type Local = { bands: Band[]; frame: 'artifact' | 'node'; shape: 'exact' | 'approx'; why?: string }

const rectangle = (x0: number, z0: number, x1: number, z1: number): Ring => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

function boxBand(min: readonly number[], max: readonly number[]): Band {
  return {
    y0: min[1]!,
    y1: max[1]!,
    polygons: [{ outer: rectangle(min[0]!, min[2]!, max[0]!, max[2]!) }],
  }
}

/**
 * What an item occupies in its own frame. A script compiled with usage checks on carries the
 * outline it traced from its meshes; one compiled before has only its parts' and its bounds, which
 * are drawn as boxes and marked approximate; a library model has the outline baked from its GLB, and
 * one without is its box.
 */
function localShape(item: ItemNode): Local {
  const manifest = item.source?.manifest
  if (manifest?.shape) {
    const coarse = manifest.shape.tolerance > EXACT_SHAPE_TOLERANCE_M
    return {
      bands: manifest.shape.bands,
      frame: 'artifact',
      shape: coarse ? 'approx' : 'exact',
      ...(coarse ? { why: 'a script outline simplified to fit its manifest' } : {}),
    }
  }
  if (manifest) {
    const parts = manifest.parts.filter((part) => part.bounds)
    if (parts.length >= 2)
      return {
        bands: parts.map((part) => boxBand(part.bounds!.min, part.bounds!.max)),
        frame: 'artifact',
        shape: 'approx',
        why: 'a script compiled without a usage outline: its parts as boxes',
      }
    return {
      bands: [boxBand(manifest.bounds.min, manifest.bounds.max)],
      frame: 'artifact',
      shape: 'approx',
      why: 'a script compiled without a usage outline: its bounds box',
    }
  }
  const baked = catalogueShape(item.asset.src)
  if (baked) {
    const coarse = baked.tolerance > EXACT_SHAPE_TOLERANCE_M
    return {
      bands: baked.bands,
      frame: 'artifact',
      shape: coarse ? 'approx' : 'exact',
      ...(coarse ? { why: 'a library model outlined to within a few centimetres' } : {}),
    }
  }
  const [w, h, d] = item.asset.dimensions
  return {
    bands: [boxBand([-w / 2, 0, -d / 2], [w / 2, h, d / 2])],
    frame: 'node',
    shape: 'approx',
    why: 'a catalogue model: its box',
  }
}

const turn = (x: number, z: number, angle: number): Point => [
  x * Math.cos(angle) + z * Math.sin(angle),
  -x * Math.sin(angle) + z * Math.cos(angle),
]

const flat = (rotation: readonly number[]) =>
  Math.abs(rotation[0] ?? 0) < ROTATION_EPSILON && Math.abs(rotation[2] ?? 0) < ROTATION_EPSILON

const orientation = (ring: Ring) => {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1]
  return a
}

type Placement = {
  /** The item's origin in the host frame: plan x, z and the absolute height of its base. */
  origin: [number, number, number]
  /** Turn, about the vertical, from the host frame. */
  yaw: number
  /** Host-frame plan point to building plan. */
  plan: (x: number, z: number) => Point
  host?: Prism['host']
  approx?: string
}

/** One local band as a prism in building metres, through the corrective, node and host transforms. */
function bandPrisms(item: ItemNode, local: Local, place: Placement, id: string): Prism[] {
  const assetScale = item.asset.scale ?? [1, 1, 1]
  const offset = item.asset.offset
  const corrective = local.frame === 'artifact'
  const scale = item.scale
  const asset = corrective ? item.asset.rotation[1]! : 0
  const out: Prism[] = []
  for (const [index, band] of local.bands.entries()) {
    const heightAt = (y: number) =>
      place.origin[2] + (corrective ? assetScale[1]! * y + offset[1]! : y) * scale[1]!
    const [z0, z1] = [heightAt(band.y0), heightAt(band.y1)].sort((a, b) => a - b) as [
      number,
      number,
    ]
    for (const [k, polygon] of band.polygons.entries()) {
      const ring = (points: Ring): Ring => {
        const moved = points.map(([x, z]) => {
          let px = x
          let pz = z
          if (corrective) {
            ;[px, pz] = turn(x * assetScale[0]!, z * assetScale[2]!, asset)
            px += offset[0]!
            pz += offset[2]!
          }
          ;[px, pz] = turn(px * scale[0]!, pz * scale[2]!, place.yaw)
          return place.plan(px + place.origin[0], pz + place.origin[1])
        })
        // A mirrored item (a negative scale) reverses the winding; keep each ring's as it was.
        return orientation(moved) * orientation(points) < 0 ? moved.reverse() : moved
      }
      out.push({
        id: `${id}.${index}.${k}`,
        nodeId: item.id,
        kind: 'item',
        z0,
        z1,
        outer: ring(polygon.outer),
        holes: (polygon.holes ?? []).map(ring),
        shape: local.shape === 'exact' && !place.approx ? 'exact' : 'approx',
        ...(local.why || place.approx ? { why: local.why ?? place.approx } : {}),
        ...(place.host ? { host: place.host } : {}),
      })
    }
  }
  return out
}

/** The box a tilted or oddly scaled item fills, as one approximate prism. */
function tiltedPrism(item: ItemNode, place: Placement, id: string): Prism[] {
  const [sx, sy, sz] = item.scale
  const [w, h, d] = item.asset.dimensions
  const half: Ring = rectangle((-w / 2) * sx, (-d / 2) * sz, (w / 2) * sx, (d / 2) * sz)
  const moved = half.map(([x, z]) => {
    const [px, pz] = turn(x, z, place.yaw)
    return place.plan(px + place.origin[0], pz + place.origin[1])
  })
  return [
    {
      id,
      nodeId: item.id,
      kind: 'item',
      z0: place.origin[2],
      z1: place.origin[2] + h * sy,
      outer: moved,
      holes: [],
      shape: 'approx',
      why: 'an item turned about a horizontal axis: its box',
      ...(place.host ? { host: place.host } : {}),
    },
  ]
}

/** Where a wall's local frame (x along the wall, z across, toward its left) lands in plan. */
function wallPlan(wall: WallNode): Placement['plan'] {
  const length = getWallCurveLength(wall)
  return (x, z) => {
    const frame = getWallCurveFrameAt(
      wall,
      length > 1e-9 ? Math.min(1, Math.max(0, x / length)) : 0,
    )
    return [frame.point.x + frame.normal.x * z, frame.point.y + frame.normal.y * z]
  }
}

export type ItemContext = {
  nodes: Nodes
  byId: Map<string, AnyNode>
  elevations: ReturnType<typeof getLevelElevations>
  supportCache: SupportCache
}

export const itemContext = (nodes: Nodes): ItemContext => ({
  nodes,
  byId: new Map(Object.entries(nodes)),
  elevations: getLevelElevations(nodes as never),
  supportCache: new Map(),
})

/** One item as prisms in absolute building metres; or `unshaped` with what it is hosted by, or `skipped` with why. */
export function itemShapesOf(
  item: ItemNode,
  { nodes, byId, elevations, supportCache }: ItemContext,
): { shapes: ItemShapes } | { unshaped: string } | { skipped: Skipped } {
  try {
    if (item.asset.attachTo === 'ceiling') return { unshaped: 'ceiling item' }
    if (item.roofSegmentId || item.blockFaceId) return { unshaped: 'item on a roof or a block' }
    const levelId = resolveLevelId(item, nodes as Record<string, AnyNode>)
    const baseY = elevations.get(levelId)?.baseY ?? 0
    const parent = item.parentId ? nodes[item.parentId] : undefined
    const local = localShape(item)
    let place: Placement
    if (parent?.type === 'wall') {
      if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side')
        return { unshaped: 'item on a wall that is not wall-mounted' }
      const wall = parent
      const across =
        item.asset.attachTo === 'wall-side'
          ? getWallLocalFaceZ(wall, item.side === 'front' ? 'a' : 'b')
          : item.position[2] + getWallBodyCenterOffset(wall)
      const base = baseY + wallSupportForNodes(wall, nodes).elevation
      place = {
        origin: [item.position[0], across, base + item.position[1]],
        yaw: item.rotation[1]!,
        plan: wallPlan(wall),
        host: { wallId: wall.id, face: across >= 0 ? 'a' : 'b' },
        ...(isCurvedWall(wall) ? { approx: 'an item on a curved wall' } : {}),
      }
    } else {
      const pose = itemLevelPose(item, byId)
      if (!pose) return { unshaped: 'item hosted where its pose cannot be read' }
      const [x, y, z] = pose.position
      const root = rootOf(item, nodes)
      const floor =
        root.parentId === levelId || !root.parentId
          ? floorUnder(
              root,
              {
                position: [root.position[0], 0, root.position[2]],
                dimensions: getScaledDimensions(root),
                rotation: root.rotation,
              },
              nodes,
              levelId,
              supportCache,
            )
          : 0
      place = {
        origin: [x, z, baseY + floor + y],
        // `yawDeg` is the sum of the hosts' `rotation[1]`, which is in radians
        yaw: pose.yawDeg,
        plan: (px, pz) => [px, pz],
      }
    }
    const id = `${item.id}#shape`
    const tilted = !flat(item.rotation) || !flat(item.asset.rotation)
    const degenerate = [...item.scale, ...(item.asset.scale ?? [1, 1, 1])].some((v) => v === 0)
    const prisms =
      tilted || degenerate ? tiltedPrism(item, place, id) : bandPrisms(item, local, place, id)
    return { shapes: { itemId: item.id, levelId, prisms } }
  } catch (error) {
    return {
      skipped: { nodeId: item.id, why: error instanceof Error ? error.message : String(error) },
    }
  }
}

/**
 * Every item as prisms in absolute building metres, filed under its level. An item stands on the
 * floor under it, on the item that hosts it, or on a wall; one hosted by a ceiling, a roof or a block
 * is counted in `unshaped`. Its outline is its script's stored shape when it has one, else a box.
 */
export function itemBodies(nodes: Nodes): {
  items: ItemShapes[]
  skipped: Skipped[]
  unshaped: Record<string, number>
} {
  const items: ItemShapes[] = []
  const skipped: Skipped[] = []
  const unshaped: Record<string, number> = {}
  const context = itemContext(nodes)
  for (const node of Object.values(nodes) as AnyNode[]) {
    if (node.type !== 'item' || isHidden(node, nodes)) continue
    const shaped = itemShapesOf(node, context)
    if ('shapes' in shaped) items.push(shaped.shapes)
    else if ('skipped' in shaped) skipped.push(shaped.skipped)
    else unshaped[shaped.unshaped] = (unshaped[shaped.unshaped] ?? 0) + 1
  }
  return { items, skipped, unshaped }
}

function rootOf(item: ItemNode, nodes: Nodes): ItemNode {
  let root = item
  for (let parent = root.parentId ? nodes[root.parentId] : undefined; parent?.type === 'item'; ) {
    root = parent
    parent = root.parentId ? nodes[root.parentId] : undefined
  }
  return root
}
