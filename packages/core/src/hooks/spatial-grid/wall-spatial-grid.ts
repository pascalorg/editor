interface WallItemPlacement {
  itemId: string;
  wallId: string;
  tStart: number; // 0-1 parametric position along wall
  tEnd: number;
  yStart: number; // height range
  yEnd: number;
}

export class WallSpatialGrid {
  private wallItems = new Map<string, WallItemPlacement[]>(); // wallId -> placements
  private itemToWall = new Map<string, string>(); // itemId -> wallId (reverse lookup)

  canPlaceOnWall(
    wallId: string,
    wallLength: number,
    wallHeight: number,
    tCenter: number,
    itemWidth: number,
    yBottom: number,
    itemHeight: number,
    ignoreIds: string[] = [],
  ): { valid: boolean; conflictIds: string[] } {
    const halfW = itemWidth / wallLength / 2;
    const tStart = tCenter - halfW;
    const tEnd = tCenter + halfW;
    // yBottom is the bottom of the item, so yEnd = yBottom + itemHeight
    const yStart = yBottom;
    const yEnd = yBottom + itemHeight;

    // Check wall boundaries
    if (tStart < 0 || tEnd > 1 || yStart < 0 || yEnd > wallHeight) {
      return { valid: false, conflictIds: [] };
    }

    const existing = this.wallItems.get(wallId) ?? [];
    const ignoreSet = new Set(ignoreIds);
    const conflicts: string[] = [];

    for (const placement of existing) {
      if (ignoreSet.has(placement.itemId)) continue;

      const tOverlap = tStart < placement.tEnd && tEnd > placement.tStart;
      const yOverlap = yStart < placement.yEnd && yEnd > placement.yStart;

      if (tOverlap && yOverlap) {
        conflicts.push(placement.itemId);
      }
    }

    return { valid: conflicts.length === 0, conflictIds: conflicts };
  }

  insert(placement: WallItemPlacement) {
    const { wallId, itemId } = placement;

    if (!this.wallItems.has(wallId)) {
      this.wallItems.set(wallId, []);
    }
    this.wallItems.get(wallId)!.push(placement);
    this.itemToWall.set(itemId, wallId);
  }

  remove(wallId: string, itemId: string) {
    const items = this.wallItems.get(wallId);
    if (items) {
      const idx = items.findIndex((p) => p.itemId === itemId);
      if (idx !== -1) items.splice(idx, 1);
    }
    this.itemToWall.delete(itemId);
  }

  removeByItemId(itemId: string) {
    const wallId = this.itemToWall.get(itemId);
    if (wallId) {
      this.remove(wallId, itemId);
    }
  }

  // Useful for when a wall is deleted - remove all items on it
  removeWall(wallId: string): string[] {
    const items = this.wallItems.get(wallId) ?? [];
    const removedIds = items.map((p) => p.itemId);

    for (const itemId of removedIds) {
      this.itemToWall.delete(itemId);
    }
    this.wallItems.delete(wallId);

    return removedIds; // Return removed item IDs in case you need to delete them from scene
  }

  // Get which wall an item is on
  getWallForItem(itemId: string): string | undefined {
    return this.itemToWall.get(itemId);
  }

  clear() {
    this.wallItems.clear();
    this.itemToWall.clear();
  }
}
