import {
  type AnyNode,
  type AnyNodeId,
  buildRoofElementNode,
  buildRoofSegmentCoveringTriangles,
  getRoofSegmentCoveringSeat,
  type RoofElementKind,
  type RoofElementNode,
  type RoofElementOptions,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  resolveRidgeSnap,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import * as THREE from 'three'
import {
  geometryContainsPoint,
  ROOF_HIT_TOLERANCE,
  type RoofHitWitness,
  validateRoofHitWitness,
} from './roof-hit-witness'

export type { RoofHitWitness } from './roof-hit-witness'
export function roofEventWitness(event: RoofEvent): RoofHitWitness | undefined {
  return event.nativeEvent?.object ? event.nativeEvent : undefined
}

export type RoofSegmentHit = {
  segment: RoofSegmentNode
  localX: number
  localY: number
  localZ: number
}

let cachedNodes: Readonly<Record<string, AnyNode>> | undefined
const nativeGeometry = new Map<string, THREE.BufferGeometry>()
const witnessedCoveringHits = new WeakSet<RoofSegmentHit>()

function renderedSegmentGeometry(segment: RoofSegmentNode, nodes: Record<string, AnyNode>) {
  // Exceptional side/CSG hits alone need native solid geometry; reuse it during pointer motion.
  if (cachedNodes !== nodes || nativeGeometry.size >= 32) {
    for (const geometry of nativeGeometry.values()) geometry.dispose()
    nativeGeometry.clear()
    cachedNodes = nodes
  }
  let geometry = nativeGeometry.get(segment.id)
  if (!geometry) {
    geometry = generateRoofSegmentGeometry(segment, nodes)
    nativeGeometry.set(segment.id, geometry)
  }
  return geometry
}

/** Attribute an actual hit to its physical supplier, never a nominal slope or first segment. */
export function resolveRoofSegmentHit(
  roof: RoofNode,
  wx: number,
  wy: number,
  wz: number,
  witness?: RoofHitWitness,
): RoofSegmentHit | null {
  if (![wx, wy, wz].every(Number.isFinite)) return null
  const world = new THREE.Vector3(wx, wy, wz)
  const nodes = useScene.getState().nodes
  const storedRoof = nodes[roof.id]
  if (storedRoof?.type !== 'roof') return null
  const witnessed = witness ? validateRoofHitWitness(roof, world, witness, nodes) : undefined
  if (witness && !witnessed) return null
  const candidates: { hit: RoofSegmentHit; local: THREE.Vector3 }[] = []
  let best: { hit: RoofSegmentHit; distance: number } | undefined
  const triangle = new THREE.Triangle()
  const nearest = new THREE.Vector3()
  for (const childId of roof.children) {
    const segment = nodes[childId as AnyNodeId]
    if (
      segment?.type !== 'roof-segment' ||
      segment.parentId !== roof.id ||
      !storedRoof.children.includes(segment.id) ||
      (witnessed?.segmentId && witnessed.segmentId !== segment.id)
    )
      continue
    const object = sceneRegistry.nodes.get(segment.id)
    if (!object) continue
    object.updateWorldMatrix(true, false)
    const local = object.worldToLocal(world.clone())
    const hit = { segment, localX: local.x, localY: local.y, localZ: local.z }
    candidates.push({ hit, local })
    if (!witnessed) {
      const seat = getRoofSegmentCoveringSeat(roof, segment, [local.x, local.z], nodes)
      if (seat.status !== 'supported') continue
      const distance = Math.abs(seat.value.position[1] - local.y)
      if (distance <= ROOF_HIT_TOLERANCE && (!best || distance < best.distance - 1e-9))
        best = { hit, distance }
      continue
    }
    // A real rendered triangle can establish surviving CSG support which the pure reader
    // intentionally labels unmeasured. Keep the segment supplying the matching geometry.
    for (const face of buildRoofSegmentCoveringTriangles(roof, segment, nodes)) {
      triangle.a.set(...face.vertices[0])
      triangle.b.set(...face.vertices[1])
      triangle.c.set(...face.vertices[2])
      triangle.closestPointToPoint(local, nearest)
      const distance = nearest.distanceTo(local)
      if (distance <= ROOF_HIT_TOLERANCE && (!best || distance < best.distance - 1e-9)) {
        if (witnessed.upward) witnessedCoveringHits.add(hit)
        best = { hit, distance }
      }
    }
  }
  if (best) return best.hit
  if (!witnessed) return null
  // Vertical fascia/walls and CSG hole walls have no upward covering seat. A real
  // witnessed face must also lie on this segment's native solid, including its cuts.
  for (const { hit, local } of candidates) {
    if (geometryContainsPoint(renderedSegmentGeometry(hit.segment, nodes), local)) return hit
  }
  return null
}

/** Shared preview/commit support check at the achieved native ridge snap. */
export function roofRidgeSnapAtHit(roof: RoofNode, hit: RoofSegmentHit) {
  const snap = resolveRidgeSnap(hit.segment, hit.localX, hit.localZ)
  if (!snap) return null
  const seat = getRoofSegmentCoveringSeat(
    roof,
    hit.segment,
    [snap.localX, snap.localZ],
    useScene.getState().nodes,
  )
  if (seat.status === 'supported') return { ...snap, localY: seat.value.position[1] }
  // A surviving rendered covering certifies its own location, not a moved snap.
  // Allow only double-precision frame roundoff, never the Float32 hit allowance.
  if (
    seat.status === 'unmeasured' &&
    witnessedCoveringHits.has(hit) &&
    Math.hypot(snap.localX - hit.localX, snap.localZ - hit.localZ) <= 1e-9
  )
    return { ...snap, localY: hit.localY }
  return null
}

export function roofElementAtClick(
  kind: RoofElementKind,
  roof: RoofNode,
  [wx, wy, wz]: readonly [number, number, number],
  options?: RoofElementOptions,
  witness?: RoofHitWitness,
): { node: RoofElementNode; segmentId: RoofSegmentNode['id'] } | null {
  const hit = resolveRoofSegmentHit(roof, wx, wy, wz, witness)
  if (!hit || (kind === 'ridge-vent' && !roofRidgeSnapAtHit(roof, hit))) return null
  const node = buildRoofElementNode(
    kind,
    hit.segment,
    [hit.localX, hit.localY, hit.localZ],
    options,
  )
  return node ? { node, segmentId: hit.segment.id } : null
}
