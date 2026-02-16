type WallSide = 'front' | 'back'
type AttachType = 'wall' | 'wall-side'

// Small tolerance for floating point comparison to allow adjacent items
const EPSILON = 0.001

// Margin from ceiling/floor when auto-snapping items
const AUTO_SNAP_MARGIN = 0.05

interface WallItemPlacement {
  itemId: string
  wallId: string
  tStart: number // 0-1 parametric position along wall
  tEnd: number
  yStart: number // height range
  yEnd: number
  attachType?: AttachType // 'wall' blocks both sides, 'wall-side' blocks one side (undefined = 'wall' for legacy)
  side?: WallSide // Which side for 'wall-side' items (undefined means both for 'wall')
}

/**
 * Auto-adjust Y position to fit item within wall bounds
 * Returns the adjusted Y position (bottom of item)
 */
function autoAdjustYPosition(
  yBottom: number,
  itemHeight: number,
  wallHeight: number,
): { adjustedY: number; wasAdjusted: boolean } {
  const yTop = yBottom + itemHeight

  // If fits perfectly, no adjustment needed
  if (yBottom >= 0 && yTop <= wallHeight) {
    return { adjustedY: yBottom, wasAdjusted: false }
  }

  // If too high (top exceeds wall height), snap down from ceiling
  if (yTop > wallHeight) {
    const adjustedY = wallHeight - itemHeight - AUTO_SNAP_MARGIN
    return { adjustedY: Math.max(0, adjustedY), wasAdjusted: true }
  }

  // If too low (bottom below floor), snap up from floor
  if (yBottom < 0) {
    return { adjustedY: AUTO_SNAP_MARGIN, wasAdjusted: true }
  }

  return { adjustedY: yBottom, wasAdjusted: false }
}

export class WallSpatialGrid {
  private wallItems = new Map<string, WallItemPlacement[]>() // wallId -> placements
  private itemToWall = new Map<string, string>() // itemId -> wallId (reverse lookup)

  /**
   * Check if an item can be placed on a wall with auto-adjustment for vertical position
   * @param wallId - The wall to place on
   * @param wallLength - Length of the wall
   * @param wallHeight - Height of the wall
   * @param tCenter - Parametric center position (0-1) along wall
   * @param itemWidth - Width of the item
   * @param yBottom - Bottom Y position of the item
   * @param itemHeight - Height of the item
   * @param attachType - 'wall' (blocks both sides) or 'wall-side' (blocks one side)
   * @param side - Which side for 'wall-side' items
   * @param ignoreIds - Item IDs to ignore in conflict check
   * @returns Validation result with auto-adjusted Y position if needed
   */
  canPlaceOnWall(
    wallId: string,
    wallLength: number,
    wallHeight: number,
    tCenter: number,
    itemWidth: number,
    yBottom: number,
    itemHeight: number,
    attachType: AttachType = 'wall',
    side?: WallSide,
    ignoreIds: string[] = [],
  ): { valid: boolean; conflictIds: string[]; adjustedY: number; wasAdjusted: boolean } {
    const halfW = itemWidth / wallLength / 2
    const tStart = tCenter - halfW
    const tEnd = tCenter + halfW

    // Check horizontal boundaries (still reject if item exceeds wall width)
    if (tStart < 0 || tEnd > 1) {
      return { valid: false, conflictIds: [], adjustedY: yBottom, wasAdjusted: false }
    }

    // Auto-adjust vertical position to fit within wall bounds
    const { adjustedY, wasAdjusted } = autoAdjustYPosition(yBottom, itemHeight, wallHeight)
    const yStart = adjustedY
    const yEnd = adjustedY + itemHeight

    const existing = this.wallItems.get(wallId) ?? []
    const ignoreSet = new Set(ignoreIds)
    const conflicts: string[] = []

    for (const placement of existing) {
      if (ignoreSet.has(placement.itemId)) continue

      // Use EPSILON tolerance to allow items to be exactly adjacent
      const tOverlap = tStart < placement.tEnd - EPSILON && tEnd > placement.tStart + EPSILON
      const yOverlap = yStart < placement.yEnd - EPSILON && yEnd > placement.yStart + EPSILON

      if (tOverlap && yOverlap) {
        // Check side conflicts based on attach types
        const hasConflict = this.checkSideConflict(attachType, side, placement)
        if (hasConflict) {
          conflicts.push(placement.itemId)
        }
      }
    }

    return { valid: conflicts.length === 0, conflictIds: conflicts, adjustedY, wasAdjusted }
  }

  /**
   * Check if two items conflict based on their attach types and sides
   * - 'wall' items block both sides, so they conflict with everything
   * - 'wall-side' items only conflict if they're on the same side or if the other is a 'wall' item
   */
  private checkSideConflict(
    newAttachType: AttachType,
    newSide: WallSide | undefined,
    existing: WallItemPlacement,
  ): boolean {
    // Treat undefined/legacy attachType as 'wall' (blocks both sides)
    const existingAttachType = existing.attachType ?? 'wall'

    // If new item is 'wall' type, it conflicts with everything (needs both sides)
    if (newAttachType === 'wall') {
      return true
    }

    // If existing item is 'wall' type, it blocks both sides
    if (existingAttachType === 'wall') {
      return true
    }

    // Both are 'wall-side' - only conflict if they're on the same side
    // If either side is undefined, be conservative and assume conflict
    if (!newSide || !existing.side) {
      return true
    }
    return newSide === existing.side
  }

  insert(placement: WallItemPlacement) {
    const { wallId, itemId } = placement

    if (!this.wallItems.has(wallId)) {
      this.wallItems.set(wallId, [])
    }
    this.wallItems.get(wallId)!.push(placement)
    this.itemToWall.set(itemId, wallId)
  }

  remove(wallId: string, itemId: string) {
    const items = this.wallItems.get(wallId)
    if (items) {
      const idx = items.findIndex((p) => p.itemId === itemId)
      if (idx !== -1) items.splice(idx, 1)
    }
    this.itemToWall.delete(itemId)
  }

  removeByItemId(itemId: string) {
    const wallId = this.itemToWall.get(itemId)
    if (wallId) {
      this.remove(wallId, itemId)
    }
  }

  // Useful for when a wall is deleted - remove all items on it
  removeWall(wallId: string): string[] {
    const items = this.wallItems.get(wallId) ?? []
    const removedIds = items.map((p) => p.itemId)

    for (const itemId of removedIds) {
      this.itemToWall.delete(itemId)
    }
    this.wallItems.delete(wallId)

    return removedIds // Return removed item IDs in case you need to delete them from scene
  }

  // Get which wall an item is on
  getWallForItem(itemId: string): string | undefined {
    return this.itemToWall.get(itemId)
  }

  clear() {
    this.wallItems.clear()
    this.itemToWall.clear()
  }
}
