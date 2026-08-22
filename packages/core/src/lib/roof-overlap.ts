export type RoofOverlapEntry = {
  roofId: string
  segmentId: string
  width: number
  depth: number
}

export type RoofPlanBounds = {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export type RoofPlanSegment = {
  position: readonly [number, number, number]
  rotation?: number
  width: number
  depth: number
}

export type RoofPlan = {
  position: readonly [number, number, number]
  rotation?: number
  segments: readonly RoofPlanSegment[]
}

export function compareRoofOverlapIdentity(a: RoofOverlapEntry, b: RoofOverlapEntry): number {
  const roofOrder = a.roofId.localeCompare(b.roofId)
  return roofOrder !== 0 ? roofOrder : a.segmentId.localeCompare(b.segmentId)
}

export function roofOverlapEntryOwns(
  candidate: RoofOverlapEntry,
  current: RoofOverlapEntry,
  epsilon = 1e-6,
): boolean {
  const candidateArea = candidate.width * candidate.depth
  const currentArea = current.width * current.depth
  return (
    candidateArea > currentArea + epsilon ||
    (Math.abs(candidateArea - currentArea) <= epsilon &&
      compareRoofOverlapIdentity(candidate, current) < 0)
  )
}

export function getRoofPlanBounds(roof: RoofPlan): RoofPlanBounds | null {
  if (roof.segments.length === 0) return null
  const roofRotation = roof.rotation ?? 0
  const roofCos = Math.cos(roofRotation)
  const roofSin = Math.sin(roofRotation)
  const bounds: RoofPlanBounds = {
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }

  for (const segment of roof.segments) {
    const segmentRotation = segment.rotation ?? 0
    const segmentCos = Math.cos(segmentRotation)
    const segmentSin = Math.sin(segmentRotation)
    const halfWidth = Math.max(0, segment.width) / 2
    const halfDepth = Math.max(0, segment.depth) / 2
    for (const [x, z] of [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
    ] as const) {
      const roofX = segment.position[0] + x * segmentCos + z * segmentSin
      const roofZ = segment.position[2] - x * segmentSin + z * segmentCos
      const worldX = roof.position[0] + roofX * roofCos + roofZ * roofSin
      const worldZ = roof.position[2] - roofX * roofSin + roofZ * roofCos
      bounds.minX = Math.min(bounds.minX, worldX)
      bounds.minZ = Math.min(bounds.minZ, worldZ)
      bounds.maxX = Math.max(bounds.maxX, worldX)
      bounds.maxZ = Math.max(bounds.maxZ, worldZ)
    }
  }
  return bounds
}

export function roofPlanBoundsOverlap(
  a: RoofPlanBounds,
  b: RoofPlanBounds,
  epsilon = 1e-6,
): boolean {
  return !(
    a.maxX < b.minX - epsilon ||
    b.maxX < a.minX - epsilon ||
    a.maxZ < b.minZ - epsilon ||
    b.maxZ < a.minZ - epsilon
  )
}
