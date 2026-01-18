import { AnyNode, ItemNode, WallNode } from "../../schema";
import { SpatialGrid } from "./spatial-grid";
import { WallSpatialGrid } from "./wall-spatial-grid";

export class SpatialGridManager {
  private floorGrids = new Map<string, SpatialGrid>(); // levelId -> grid
  private wallGrids = new Map<string, WallSpatialGrid>(); // levelId -> wall grid
  private walls = new Map<string, WallNode>(); // wallId -> wall data (for length calculations)

  constructor(private cellSize = 0.5) {}

  private getFloorGrid(levelId: string): SpatialGrid {
    if (!this.floorGrids.has(levelId)) {
      this.floorGrids.set(
        levelId,
        new SpatialGrid({ cellSize: this.cellSize }),
      );
    }
    return this.floorGrids.get(levelId)!;
  }

  private getWallGrid(levelId: string): WallSpatialGrid {
    if (!this.wallGrids.has(levelId)) {
      this.wallGrids.set(levelId, new WallSpatialGrid());
    }
    return this.wallGrids.get(levelId)!;
  }

  private getWallLength(wallId: string): number {
    const wall = this.walls.get(wallId);
    if (!wall) return 0;
    const dx = wall.end[0] - wall.start[0];
    const dy = wall.end[1] - wall.start[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Called when nodes change
  handleNodeCreated(node: AnyNode, levelId: string) {
    if (node.type === "wall") {
      const wall = node as WallNode;
      this.walls.set(wall.id, wall);
    } else if (node.type === "item") {
      const item = node as ItemNode;
      if (
        item.asset.attachTo === "wall" ||
        item.asset.attachTo === "wall-side"
      ) {
        // Wall-attached item
        if (item.wallId && item.wallT !== undefined) {
          const wallLength = this.getWallLength(item.wallId);
          if (wallLength > 0) {
            const [width, height] = item.asset.dimensions;
            const halfW = width / wallLength / 2;
            const halfH = height / 2;
            this.getWallGrid(levelId).insert({
              itemId: item.id,
              wallId: item.wallId,
              tStart: item.wallT - halfW,
              tEnd: item.wallT + halfW,
              yStart: item.position[1] - halfH,
              yEnd: item.position[1] + halfH,
            });
          }
        }
      } else if (!item.asset.attachTo) {
        // Floor item
        this.getFloorGrid(levelId).insert(
          item.id,
          item.position,
          item.asset.dimensions,
          item.rotation,
        );
        console.log(
          "inserting floor item",
          item.id,
          item.position,
          item.asset.dimensions,
        );
      }
    }
  }

  handleNodeUpdated(node: AnyNode, levelId: string) {
    if (node.type === "wall") {
      const wall = node as WallNode;
      this.walls.set(wall.id, wall);
    } else if (node.type === "item") {
      const item = node as ItemNode;
      if (
        item.asset.attachTo === "wall" ||
        item.asset.attachTo === "wall-side"
      ) {
        // Remove old placement and re-insert
        this.getWallGrid(levelId).removeByItemId(item.id);
        if (item.wallId && item.wallT !== undefined) {
          const wallLength = this.getWallLength(item.wallId);
          if (wallLength > 0) {
            const [width, height] = item.asset.dimensions;
            const halfW = width / wallLength / 2;
            const halfH = height / 2;
            this.getWallGrid(levelId).insert({
              itemId: item.id,
              wallId: item.wallId,
              tStart: item.wallT - halfW,
              tEnd: item.wallT + halfW,
              yStart: item.position[1] - halfH,
              yEnd: item.position[1] + halfH,
            });
          }
        }
      } else if (!item.asset.attachTo) {
        this.getFloorGrid(levelId).update(
          item.id,
          item.position,
          item.asset.dimensions,
          item.rotation,
        );
      }
    }
  }

  handleNodeDeleted(nodeId: string, nodeType: string, levelId: string) {
    if (nodeType === "wall") {
      this.walls.delete(nodeId);
      // Remove all items attached to this wall from the spatial grid
      const removedItemIds = this.getWallGrid(levelId).removeWall(nodeId);
      return removedItemIds; // Caller can use this to delete the items from scene
    } else if (nodeType === "item") {
      this.getFloorGrid(levelId).remove(nodeId);
      this.getWallGrid(levelId).removeByItemId(nodeId);
    }
    return [];
  }

  // Query methods
  canPlaceOnFloor(
    levelId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    ignoreIds?: string[],
  ) {
    const grid = this.getFloorGrid(levelId);
    console.log("canPlaceOnFloor - grid item count:", grid.getItemCount());
    return grid.canPlace(
      position,
      dimensions,
      rotation,
      ignoreIds,
    );
  }

  canPlaceOnWall(
    levelId: string,
    wallId: string,
    tCenter: number,
    itemWidth: number,
    yCenter: number,
    itemHeight: number,
    ignoreIds?: string[],
  ) {
    const wallLength = this.getWallLength(wallId);
    if (wallLength === 0) {
      return { valid: false, conflictIds: [] };
    }
    return this.getWallGrid(levelId).canPlaceOnWall(
      wallId,
      wallLength,
      tCenter,
      itemWidth,
      yCenter,
      itemHeight,
      ignoreIds,
    );
  }

  getWallForItem(levelId: string, itemId: string): string | undefined {
    return this.getWallGrid(levelId).getWallForItem(itemId);
  }

  clearLevel(levelId: string) {
    this.floorGrids.delete(levelId);
    this.wallGrids.delete(levelId);
  }

  clear() {
    this.floorGrids.clear();
    this.wallGrids.clear();
    this.walls.clear();
  }
}

// Singleton instance
export const spatialGridManager = new SpatialGridManager();
