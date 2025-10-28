import type { Bounds } from '@/components/editor/bounded-grid'
import type { Component } from '@/hooks/use-editor'

/**
 * Calculate the bounding box for all elements on a specific floor
 * Returns bounds in grid units (not world units)
 */
export function calculateFloorBounds(
  components: Component[],
  floorId: string,
  minSize = 6, // Minimum bounds size (6x6 grid units)
): Bounds | null {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let hasElements = false

  // Check walls
  const wallComponent = components.find((c) => c.type === 'wall' && c.group === floorId)
  if (wallComponent && wallComponent.type === 'wall') {
    for (const segment of wallComponent.data.segments) {
      if (segment.visible === false) continue
      hasElements = true
      const [x1, y1] = segment.start
      const [x2, y2] = segment.end
      minX = Math.min(minX, x1, x2)
      maxX = Math.max(maxX, x1, x2)
      minY = Math.min(minY, y1, y2)
      maxY = Math.max(maxY, y1, y2)
    }
  }

  // Check roofs
  const roofComponent = components.find((c) => c.type === 'roof' && c.group === floorId)
  if (roofComponent && roofComponent.type === 'roof') {
    for (const segment of roofComponent.data.segments) {
      if (segment.visible === false) continue
      hasElements = true
      const [x1, y1] = segment.start
      const [x2, y2] = segment.end

      // For roofs, also consider the width on either side
      const leftWidth = segment.leftWidth || 0
      const rightWidth = segment.rightWidth || 0
      const TILE_SIZE = 0.5

      // Convert widths from meters to grid units
      const leftWidthGrid = leftWidth / TILE_SIZE
      const rightWidthGrid = rightWidth / TILE_SIZE

      // Calculate perpendicular direction
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.sqrt(dx * dx + dy * dy)
      if (length > 0) {
        const perpX = -dy / length
        const perpY = dx / length

        // Expand bounds to include roof width
        const leftExtentX1 = x1 + perpX * leftWidthGrid
        const leftExtentY1 = y1 + perpY * leftWidthGrid
        const leftExtentX2 = x2 + perpX * leftWidthGrid
        const leftExtentY2 = y2 + perpY * leftWidthGrid
        const rightExtentX1 = x1 - perpX * rightWidthGrid
        const rightExtentY1 = y1 - perpY * rightWidthGrid
        const rightExtentX2 = x2 - perpX * rightWidthGrid
        const rightExtentY2 = y2 - perpY * rightWidthGrid

        minX = Math.min(minX, x1, x2, leftExtentX1, leftExtentX2, rightExtentX1, rightExtentX2)
        maxX = Math.max(maxX, x1, x2, leftExtentX1, leftExtentX2, rightExtentX1, rightExtentX2)
        minY = Math.min(minY, y1, y2, leftExtentY1, leftExtentY2, rightExtentY1, rightExtentY2)
        maxY = Math.max(maxY, y1, y2, leftExtentY1, leftExtentY2, rightExtentY1, rightExtentY2)
      } else {
        minX = Math.min(minX, x1, x2)
        maxX = Math.max(maxX, x1, x2)
        minY = Math.min(minY, y1, y2)
        maxY = Math.max(maxY, y1, y2)
      }
    }
  }

  // Check doors
  const doorComponents = components.filter((c) => c.type === 'door' && c.group === floorId)
  for (const doorComponent of doorComponents) {
    if (doorComponent.type === 'door') {
      hasElements = true
      const [x, y] = doorComponent.data.position
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }

  // If no elements found, return null
  if (!hasElements) {
    return null
  }

  // Ensure minimum size
  const width = maxX - minX
  const height = maxY - minY
  if (width < minSize) {
    const expansion = (minSize - width) / 2
    minX -= expansion
    maxX += expansion
  }
  if (height < minSize) {
    const expansion = (minSize - height) / 2
    minY -= expansion
    maxY += expansion
  }

  return { minX, maxX, minY, maxY }
}
