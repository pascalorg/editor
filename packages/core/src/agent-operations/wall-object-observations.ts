import { getOpeningWallCut, wallSupportForNodes } from '../lib/opening-floor-datum'
import {
  area,
  difference,
  intersection,
  type MultiPolygon,
  type Ring,
  union,
} from '../lib/polygon-boolean'
import {
  boundsOf,
  boxCorners,
  frame,
  rotateVector,
  transformPoint,
} from '../procedural-items/spatial'
import type { AnyNode, ItemNode, WallNode } from '../schema'
import { getLevelElevations, getWallTop } from '../services/storey'
import { getWallBodyCenterOffset, getWallLocalFaceZ } from '../systems/wall/wall-frame'

type Vec3 = [number, number, number]
export type WallObjectFace = { normal: Vec3; depth: number; polygon: Ring }
/** Geometry evidence in the host wall's local frame, after all corrective model transforms. */
export type WallObjectGeometry = { corners: Vec3[]; faces: WallObjectFace[] }
type Evidence = {
  severity?: 'info'
  itemId: string
  wallId: string
  levelId: string
  side: 'front' | 'back'
  coordinateFrame: 'building'
  bounds?: { min: Vec3; max: Vec3 }
  evidence: 'script_bounds' | 'rendered_bounds' | 'rendered_faces' | 'mount_orientation'
}
export type WallObjectObservation = Evidence & {
  type:
    | 'item_wall_body_overlap'
    | 'item_through_wall'
    | 'item_faces_wall'
    | 'item_wall_coplanar_face'
    | 'item_wall_object_coplanar_face'
  message: string
  overlapDepthMeters?: number
  beyondOppositeFaceMeters?: number
  overlapAreaSquareMeters?: number
  frontDotOutward?: number
  otherItemId?: string
  separationMeters?: number
  toleranceMeters?: number
}

const TOLERANCE = 0.001
const MIN_FACE_AREA = 0.04
const finiteVector = (v: readonly number[]) => v.length === 3 && v.every(Number.isFinite)
const rectangle = (left: number, bottom: number, right: number, top: number): Ring => [
  [left, bottom],
  [right, bottom],
  [right, top],
  [left, top],
]

function projectedHull(corners: Vec3[]): Ring {
  const points = corners
    .map(([x, y]): [number, number] => [x, y])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((p, i, all) => !i || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1])
  const cross = (a: Ring[number], b: Ring[number], c: Ring[number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (input: Ring) => {
    const hull: Ring = []
    for (const p of input) {
      while (hull.length > 1 && cross(hull.at(-2)!, hull.at(-1)!, p) <= 0) hull.pop()
      hull.push(p)
    }
    hull.pop()
    return hull
  }
  return [...half(points), ...half([...points].reverse())]
}

function scriptGeometry(item: ItemNode, wall: WallNode): WallObjectGeometry | undefined {
  const bounds = item.source?.manifest.bounds
  const assetScale = item.asset.scale ?? [1, 1, 1]
  if (
    !bounds ||
    item.source?.manifest.animations?.length ||
    ![
      bounds.min,
      bounds.max,
      item.position,
      item.rotation,
      item.scale,
      item.asset.offset,
      item.asset.rotation,
      assetScale,
    ].every(finiteVector) ||
    bounds.min.some((v, axis) => v > bounds.max[axis]!) ||
    [...item.scale, ...assetScale].some((v) => v <= 0)
  )
    return
  const z =
    item.asset.attachTo === 'wall-side'
      ? getWallLocalFaceZ(wall, item.side === 'front' ? 'a' : 'b')
      : item.position[2] + getWallBodyCenterOffset(wall)
  const pose = frame([item.position[0], item.position[1], z], item.rotation)
  const corners = boxCorners(bounds.min, bounds.max).map((point) => {
    const rotated = rotateVector(
      point.map((v, axis) => v * assetScale[axis]!) as Vec3,
      item.asset.rotation,
    )
    return transformPoint(
      pose,
      rotated.map((v, axis) => (v + item.asset.offset[axis]!) * item.scale[axis]!) as Vec3,
    )
  })
  return corners.every(finiteVector) ? { corners, faces: [] } : undefined
}

function wallSolid(
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
): MultiPolygon | undefined {
  const support = wallSupportForNodes(wall, nodes).elevation
  const height = getWallTop(wall, wall.parentId!, nodes, support) - support
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (
    ![height, length, support, wall.thickness ?? 0.1].every(Number.isFinite) ||
    height <= 0 ||
    length <= 0
  )
    return
  const holes: Ring[] = []
  for (const child of Object.values(nodes)) {
    if (child.parentId !== wall.id) continue
    // Wall cutters have no persisted XY outline: their bounds cannot prove solid contact.
    if (
      (child.type === 'item' || child.type === 'door' || child.type === 'window') &&
      child.source?.manifest.cutout
    )
      return
    if (child.type !== 'door' && child.type !== 'window') continue
    const cut = getOpeningWallCut(wall, child, nodes)
    // For shaped openings the enclosing rectangle conservatively withholds evidence.
    holes.push(
      rectangle(
        child.position[0] - child.width / 2,
        cut.bottom - support,
        child.position[0] + child.width / 2,
        cut.top - support,
      ),
    )
  }
  return difference(rectangle(0, 0, length, height), union(holes))
}

function facePatches(faces: WallObjectFace[]) {
  const patches: { depth: number; sign: number; rings: Ring[] }[] = []
  for (const face of faces) {
    if (
      !finiteVector(face.normal) ||
      !Number.isFinite(face.depth) ||
      Math.abs(face.normal[2]) < 0.999 ||
      face.polygon.length < 3 ||
      face.polygon.some((p) => !p.every(Number.isFinite))
    )
      continue
    const sign = Math.sign(face.normal[2])
    const existing = patches.find(
      (patch) => patch.sign === sign && Math.abs(patch.depth - face.depth) < 1e-5,
    )
    if (existing) existing.rings.push(face.polygon)
    else patches.push({ depth: face.depth, sign, rings: [face.polygon] })
  }
  return patches
    .map(({ rings, ...patch }) => ({ ...patch, polygons: union(rings) }))
    .filter((patch) => area(patch.polygons) >= MIN_FACE_AREA)
}

/** Bounds contact is not exact mesh intersection; rendered face patches are assessed only when supplied. */
export function wallObjectObservations(
  nodes: Readonly<Record<string, AnyNode>>,
  rendered: Readonly<Record<string, WallObjectGeometry>> = {},
): WallObjectObservation[] {
  const observations: WallObjectObservation[] = []
  const elevations = getLevelElevations(nodes)
  const solids = new Map<string, MultiPolygon | undefined>()
  const peers: { evidence: Evidence; patches: ReturnType<typeof facePatches> }[] = []
  for (const item of Object.values(nodes)) {
    if (
      item.type !== 'item' ||
      !item.visible ||
      item.roofSegmentId ||
      item.blockFaceId ||
      (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') ||
      item.source?.manifest.animations?.length ||
      item.source?.manifest.cutout
    )
      continue
    const wall = item.parentId ? nodes[item.parentId] : undefined
    const level = wall?.parentId ? nodes[wall.parentId] : undefined
    if (
      wall?.type !== 'wall' ||
      !wall.visible ||
      wall.curveOffset ||
      level?.type !== 'level' ||
      !level.visible ||
      !finiteVector(item.rotation) ||
      !finiteVector(item.scale) ||
      item.scale.some((v) => v <= 0) ||
      ![...wall.start, ...wall.end, wall.thickness ?? 0.1, elevations.get(level.id)?.baseY].every(
        Number.isFinite,
      ) ||
      (wall.thickness ?? 0.1) <= 0
    )
      continue
    if (!solids.has(wall.id)) solids.set(wall.id, wallSolid(wall, nodes))
    const solid = solids.get(wall.id)
    const geometry = rendered[item.id] ?? scriptGeometry(item, wall)
    // A wall-side item with no `side` is drawn on the back face (the item system and the plan
    // symbols read `side === 'front' ? a : b`): observed where it is drawn.
    const side = item.side === 'front' ? 'front' : 'back'
    const sign = side === 'front' ? 1 : -1
    const hostFace = getWallLocalFaceZ(wall, sign > 0 ? 'a' : 'b')
    const oppositeFace = getWallLocalFaceZ(wall, sign > 0 ? 'b' : 'a')
    const evidence: Evidence = {
      itemId: item.id,
      wallId: wall.id,
      levelId: level.id,
      side,
      coordinateFrame: 'building',
      evidence: geometry
        ? rendered[item.id]
          ? 'rendered_bounds'
          : 'script_bounds'
        : 'mount_orientation',
    }
    if (geometry?.corners.length && geometry.corners.every(finiteVector)) {
      const local = boundsOf(geometry.corners)
      const projection = projectedHull(geometry.corners)
      const solidArea = solid ? area(intersection(projection, solid)) : undefined
      // Entirely in a cutout (or outside the finite host) is not wall contact evidence.
      if (solidArea !== undefined && solidArea <= 1e-6) continue
      const support = wallSupportForNodes(wall, nodes).elevation
      const wallPose = frame(
        [wall.start[0], (elevations.get(level.id)?.baseY ?? 0) + support, wall.start[1]],
        [0, -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]), 0],
      )
      const world = boundsOf(geometry.corners.map((p) => transformPoint(wallPose, p)))
      evidence.bounds = { min: world.min, max: world.max }
      const overlap =
        Math.min(local.max[2], Math.max(hostFace, oppositeFace)) -
        Math.max(local.min[2], Math.min(hostFace, oppositeFace))
      if (solidArea !== undefined && overlap > TOLERANCE) {
        observations.push({
          ...evidence,
          type: 'item_wall_body_overlap',
          overlapDepthMeters: overlap,
          overlapAreaSquareMeters: solidArea,
          toleranceMeters: TOLERANCE,
          message: `Object ${item.id} transformed bounds overlap wall ${wall.id} body by ${overlap.toFixed(3)} m in depth over ${solidArea.toFixed(3)} m² in projection; bounds overlap is not an exact mesh intersection`,
        })
      }
      const beyond = sign > 0 ? oppositeFace - local.min[2] : local.max[2] - oppositeFace
      if (solidArea !== undefined && beyond > TOLERANCE)
        observations.push({
          ...evidence,
          type: 'item_through_wall',
          beyondOppositeFaceMeters: beyond,
          toleranceMeters: TOLERANCE,
          message: `Object ${item.id} transformed bounds extend ${beyond.toFixed(3)} m beyond the opposite face of wall ${wall.id}`,
        })
      const patches = facePatches(geometry.faces)
      peers.push({ evidence, patches })
      if (solid)
        for (const patch of patches) {
          // Opposed normals describe hidden back-to-wall contact, not two competing visible faces.
          if (patch.sign !== sign || Math.abs(patch.depth - hostFace) > TOLERANCE) continue
          const overlapArea = area(intersection(patch.polygons, solid))
          if (overlapArea < MIN_FACE_AREA) continue
          observations.push({
            ...evidence,
            evidence: 'rendered_faces',
            type: 'item_wall_coplanar_face',
            overlapAreaSquareMeters: overlapArea,
            separationMeters: Math.abs(patch.depth - hostFace),
            toleranceMeters: TOLERANCE,
            message: `Object ${item.id} has ${overlapArea.toFixed(3)} m² of rendered outward face within ${TOLERANCE} m of host wall ${wall.id} face; coplanar visible faces can depth-fight`,
          })
        }
    }
    if (item.source && !finiteVector(item.asset.rotation)) continue
    const correctedFront = item.source
      ? rotateVector([0, 0, 1], item.asset.rotation)
      : ([0, 0, 1] as Vec3)
    const front = rotateVector(
      correctedFront.map((v, axis) => v * item.scale[axis]!) as Vec3,
      item.rotation,
    )
    const dot = (front[2] * sign) / Math.hypot(...front)
    if (dot < -0.5)
      observations.push({
        ...evidence,
        type: 'item_faces_wall',
        evidence: 'mount_orientation',
        frontDotOutward: dot,
        message: `Object ${item.id} mounted on wall ${wall.id} ${side} side has its corrected +Z front toward the wall (front·outward ${dot.toFixed(3)})`,
      })
  }
  for (let i = 0; i < peers.length; i++)
    for (const other of peers.slice(i + 1)) {
      const item = peers[i]!
      if (item.evidence.wallId !== other.evidence.wallId) continue
      for (const a of item.patches)
        for (const b of other.patches) {
          if (a.sign !== b.sign || Math.abs(a.depth - b.depth) > TOLERANCE) continue
          const overlap = area(intersection(a.polygons, b.polygons))
          if (overlap < MIN_FACE_AREA) continue
          observations.push({
            ...item.evidence,
            evidence: 'rendered_faces',
            type: 'item_wall_object_coplanar_face',
            otherItemId: other.evidence.itemId,
            overlapAreaSquareMeters: overlap,
            separationMeters: Math.abs(a.depth - b.depth),
            toleranceMeters: TOLERANCE,
            message: `Wall-mounted objects ${item.evidence.itemId} and ${other.evidence.itemId} have ${overlap.toFixed(3)} m² of same-facing rendered faces within ${TOLERANCE} m; coplanar visible faces can depth-fight`,
          })
        }
    }
  return observations
}
