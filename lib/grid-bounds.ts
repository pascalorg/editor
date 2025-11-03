import type { Bounds } from '@/components/editor/bounded-grid'
import type { Component } from '@/hooks/use-editor'

/**
 * Calculate the bounding box for all elements on a specific floor
 * Returns bounds in grid units (not world units)
 *
 * @deprecated Use calculateLevelBoundsById from @/lib/nodes/bounds instead
 * This function is kept for backward compatibility with legacy component-based code
 */
export function calculateFloorBounds(
  components: Component[],
  floorId: string,
  minSize = 6, // Minimum bounds size (6x6 grid units)
): Bounds | null {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let hasElements = false

  // Check walls
  const wallComponent = components.find((c) => c.type === 'wall' && c.group === floorId)
  if (wallComponent && wallComponent.type === 'wall') {
    for (const segment of wallComponent.data.segments) {
      if (segment.visible === false) continue
      hasElements = true
      const [x1, z1] = segment.start
      const [x2, z2] = segment.end
      minX = Math.min(minX, x1, x2)
      maxX = Math.max(maxX, x1, x2)
      minZ = Math.min(minZ, z1, z2)
      maxZ = Math.max(maxZ, z1, z2)
    }
  }

  // Check roofs
  const roofComponent = components.find((c) => c.type === 'roof' && c.group === floorId)
  if (roofComponent && roofComponent.type === 'roof') {
    for (const segment of roofComponent.data.segments) {
      if (segment.visible === false) continue
      hasElements = true
      const [x1, z1] = segment.start
      const [x2, z2] = segment.end

      // For roofs, also consider the width on either side
      const leftWidth = segment.leftWidth || 0
      const rightWidth = segment.rightWidth || 0
      const TILE_SIZE = 0.5

      // Convert widths from meters to grid units
      const leftWidthGrid = leftWidth / TILE_SIZE
      const rightWidthGrid = rightWidth / TILE_SIZE

      // Calculate perpendicular direction
      const dx = x2 - x1
      const dz = z2 - z1
      const length = Math.sqrt(dx * dx + dz * dz)
      if (length > 0) {
        const perpX = -dz / length
        const perpZ = dx / length

        // Expand bounds to include roof width
        const leftExtentX1 = x1 + perpX * leftWidthGrid
        const leftExtentZ1 = z1 + perpZ * leftWidthGrid
        const leftExtentX2 = x2 + perpX * leftWidthGrid
        const leftExtentZ2 = z2 + perpZ * leftWidthGrid
        const rightExtentX1 = x1 - perpX * rightWidthGrid
        const rightExtentZ1 = z1 - perpZ * rightWidthGrid
        const rightExtentX2 = x2 - perpX * rightWidthGrid
        const rightExtentZ2 = z2 - perpZ * rightWidthGrid

        minX = Math.min(minX, x1, x2, leftExtentX1, leftExtentX2, rightExtentX1, rightExtentX2)
        maxX = Math.max(maxX, x1, x2, leftExtentX1, leftExtentX2, rightExtentX1, rightExtentX2)
        minZ = Math.min(minZ, z1, z2, leftExtentZ1, leftExtentZ2, rightExtentZ1, rightExtentZ2)
        maxZ = Math.max(maxZ, z1, z2, leftExtentZ1, leftExtentZ2, rightExtentZ1, rightExtentZ2)
      } else {
        minX = Math.min(minX, x1, x2)
        maxX = Math.max(maxX, x1, x2)
        minZ = Math.min(minZ, z1, z2)
        maxZ = Math.max(maxZ, z1, z2)
      }
    }
  }

  // Check doors
  const doorComponents = components.filter((c) => c.type === 'door' && c.group === floorId)
  for (const doorComponent of doorComponents) {
    if (doorComponent.type === 'door') {
      hasElements = true
      const [x, z] = doorComponent.data.position
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
  }

  // If no elements found, return null
  if (!hasElements) {
    return null
  }

  // Ensure minimum size
  const width = maxX - minX
  const depth = maxZ - minZ
  if (width < minSize) {
    const expansion = (minSize - width) / 2
    minX -= expansion
    maxX += expansion
  }
  if (depth < minSize) {
    const expansion = (minSize - depth) / 2
    minZ -= expansion
    maxZ += expansion
  }

  return { minX, maxX, minZ, maxZ }
}
