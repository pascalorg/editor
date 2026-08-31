import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'

/**
 * Stair footprint geometry shared by the slab-opening sync and the
 * alignment-anchor adapters. A stair has no single box footprint: straight
 * stairs are a cumulative chain of `stair-segment` children, curved / spiral
 * stairs are an annular sector stored entirely on the parent. Both reduce to
 * an XZ bounding box here so callers that only need "where does the stair sit
 * in plan" (alignment guides) don't have to re-walk the geometry.
 *
 * All math is in the building-local XZ frame, matching `node.position`.
 */

export type StairFootprintAABB = { minX: number; minZ: number; maxX: number; maxZ: number }

type SegmentTransform = {
  position: [number, number, number]
  rotation: number
}

/**
 * XZ rotation in the stair geometry convention (equivalent to rotating by
 * `-angle` in standard math): positive `angle` turns local +Z toward +X. Every
 * stair helper — slab openings, floor-plan emitter, this footprint — shares it,
 * so anchors line up with the rendered stair.
 */
export function rotateXZ(x: number, z: number, angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

/**
 * Cumulative per-segment transforms for a straight (segment-chained) stair.
 * Each flight attaches to the previous segment's end; `attachmentSide` rotates
 * the chain ±90° (left / right) or continues straight (front). Positions are in
 * the stair's local frame (before the stair's own `position` / `rotation`).
 */
export function computeSegmentTransforms(segments: StairSegmentNode[]): SegmentTransform[] {
  const transforms: SegmentTransform[] = []
  let currentX = 0
  let currentY = 0
  let currentZ = 0
  let currentRot = 0

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!segment) continue

    if (index === 0) {
      transforms.push({ position: [currentX, currentY, currentZ], rotation: currentRot })
      continue
    }

    const previous = segments[index - 1]
    if (!previous) continue

    let attachX = 0
    let attachZ = 0
    let rotationDelta = 0

    switch (segment.attachmentSide) {
      case 'front':
        attachX = 0
        attachZ = previous.length
        break
      case 'left':
        attachX = previous.width / 2
        attachZ = previous.length / 2
        rotationDelta = Math.PI / 2
        break
      case 'right':
        attachX = -previous.width / 2
        attachZ = previous.length / 2
        rotationDelta = -Math.PI / 2
        break
    }

    const [deltaX, deltaZ] = rotateXZ(attachX, attachZ, currentRot)
    currentX += deltaX
    currentY += previous.height
    currentZ += deltaZ
    currentRot += rotationDelta

    transforms.push({ position: [currentX, currentY, currentZ], rotation: currentRot })
  }

  return transforms
}

function emptyBox(): StairFootprintAABB {
  return {
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
}

/** Grow `box` to include the world-plan point produced by rotating the
 *  stair-local point by the stair's rotation and offsetting by its position. */
function extendByLocal(box: StairFootprintAABB, stair: StairNode, localX: number, localZ: number) {
  const [wx, wz] = rotateXZ(localX, localZ, stair.rotation ?? 0)
  const x = stair.position[0] + wx
  const z = stair.position[2] + wz
  if (x < box.minX) box.minX = x
  if (x > box.maxX) box.maxX = x
  if (z < box.minZ) box.minZ = z
  if (z > box.maxZ) box.maxZ = z
}

function finiteBox(box: StairFootprintAABB): StairFootprintAABB | null {
  return Number.isFinite(box.minX) && Number.isFinite(box.minZ) ? box : null
}

/** Bounding box of a straight stair's segment chain, walking the children. */
function straightStairAABB(
  stair: StairNode,
  nodes: Readonly<Record<string, AnyNode>>,
): StairFootprintAABB | null {
  const segments = (stair.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter(
      (segment): segment is StairSegmentNode =>
        segment?.type === 'stair-segment' && segment.visible !== false,
    )
  if (segments.length === 0) return null

  const transforms = computeSegmentTransforms(segments)
  const box = emptyBox()
  segments.forEach((segment, index) => {
    const transform = transforms[index]
    if (!transform) return
    const halfWidth = segment.width / 2
    // Segment-local footprint: X across the flight, Z along the run from the
    // attachment edge (0) to the far edge (length).
    for (const [cornerX, cornerZ] of [
      [-halfWidth, 0],
      [halfWidth, 0],
      [halfWidth, segment.length],
      [-halfWidth, segment.length],
    ] as const) {
      const [offsetX, offsetZ] = rotateXZ(cornerX, cornerZ, transform.rotation)
      extendByLocal(box, stair, transform.position[0] + offsetX, transform.position[2] + offsetZ)
    }
  })
  return finiteBox(box)
}

const ARC_SAMPLES = 48

function getSpiralLandingSweep(stair: StairNode, sweepAngle: number) {
  if ((stair.topLandingMode ?? 'none') !== 'integrated') return 0

  const innerRadius = Math.max(0.05, stair.innerRadius ?? 0.9)
  const width = Math.max(stair.width ?? 1, 0.4)
  const landingDepth = Math.max(0.3, stair.topLandingDepth ?? Math.max(width * 0.9, 0.8))

  return (
    Math.min(Math.PI * 0.75, landingDepth / Math.max(innerRadius + width / 2, 0.1)) *
    Math.sign(sweepAngle || 1)
  )
}

/** Bounding box of a curved / spiral stair's annular sector (plus the
 *  integrated spiral top landing when present). */
function arcStairAABB(stair: StairNode): StairFootprintAABB | null {
  const isSpiral = stair.stairType === 'spiral'
  const minInnerRadius = isSpiral ? 0.05 : 0.2
  const innerRadius = Math.max(minInnerRadius, stair.innerRadius ?? (isSpiral ? 0.2 : 0.9))
  const width = Math.max(stair.width ?? 1, 0.4)
  const outerRadius = innerRadius + width

  const rawSweep = stair.sweepAngle ?? (isSpiral ? Math.PI * 2 : Math.PI / 2)
  let sweep = rawSweep
  // A full revolution would make the arc degenerate; clamp just under 2π the
  // same way the floor-plan emitter does so the sampled box stays correct.
  if (Math.abs(sweep) >= Math.PI * 2) sweep = Math.sign(sweep || 1) * (Math.PI * 2 - 0.001)
  const half = sweep / 2

  const box = emptyBox()
  // Sample both rims across the sweep — the extremes can fall on either the
  // arc ends or an axis crossing in between, so we need the full sweep.
  for (let step = 0; step <= ARC_SAMPLES; step += 1) {
    const angle = -half + (sweep * step) / ARC_SAMPLES
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    extendByLocal(box, stair, cos * innerRadius, sin * innerRadius)
    extendByLocal(box, stair, cos * outerRadius, sin * outerRadius)
  }

  // Integrated spiral top landing renders as an angular extension of the
  // annular stair body, not as a rectangular box outside the outer rim.
  if (isSpiral && stair.topLandingMode === 'integrated') {
    const landingSweep = getSpiralLandingSweep(stair, rawSweep)
    const landingSteps = Math.max(1, Math.ceil(Math.abs(landingSweep) / (Math.PI / 24)))
    for (let step = 0; step <= landingSteps; step += 1) {
      const angle = rawSweep / 2 + (landingSweep * step) / landingSteps
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      extendByLocal(box, stair, cos * innerRadius, sin * innerRadius)
      extendByLocal(box, stair, cos * outerRadius, sin * outerRadius)
    }
  }

  return finiteBox(box)
}

/**
 * XZ bounding box of a stair's plan footprint, or null when it can't be
 * determined (a straight stair whose segment children aren't in `nodes`).
 * Straight stairs need the children to walk the flight chain; curved / spiral
 * stairs are derived from the parent alone, so `nodes` is optional for them.
 */
export function stairFootprintAABB(
  stair: StairNode,
  nodes?: Readonly<Record<string, AnyNode>>,
): StairFootprintAABB | null {
  if ((stair.stairType ?? 'straight') === 'straight') {
    return nodes ? straightStairAABB(stair, nodes) : null
  }
  return arcStairAABB(stair)
}
