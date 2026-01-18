type CellKey = `${number},${number}`;

interface GridCell {
  itemIds: Set<string>;
}

interface SpatialGridConfig {
  cellSize: number; // e.g., 0.5 meters = Sims-style half-tile
}

export class SpatialGrid {
  private cells = new Map<CellKey, GridCell>();
  private itemCells = new Map<string, Set<CellKey>>(); // reverse lookup

  constructor(private config: SpatialGridConfig) {}

  private posToCell(x: number, z: number): [number, number] {
    return [
      Math.floor(x / this.config.cellSize),
      Math.floor(z / this.config.cellSize),
    ];
  }

  private cellKey(cx: number, cz: number): CellKey {
    return `${cx},${cz}`;
  }

  // Get all cells an item occupies based on its AABB
  private getItemCells(
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ): CellKey[] {
    // Simplified: axis-aligned bounding box
    // For full rotation support, compute rotated corners
    const [x, , z] = position;
    const [w, , d] = dimensions;
    const yRot = rotation[1]; // Y-axis rotation

    // Compute rotated footprint (simplified for 90° increments)
    const cos = Math.abs(Math.cos(yRot));
    const sin = Math.abs(Math.sin(yRot));
    const rotatedW = w * cos + d * sin;
    const rotatedD = w * sin + d * cos;

    const minX = x - rotatedW / 2;
    const maxX = x + rotatedW / 2;
    const minZ = z - rotatedD / 2;
    const maxZ = z + rotatedD / 2;

    const [minCx, minCz] = this.posToCell(minX, minZ);
    const [maxCx, maxCz] = this.posToCell(maxX, maxZ);

    const keys: CellKey[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        keys.push(this.cellKey(cx, cz));
      }
    }
    return keys;
  }

  // Register an item
  insert(
    itemId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ) {
    const cellKeys = this.getItemCells(position, dimensions, rotation);

    this.itemCells.set(itemId, new Set(cellKeys));

    for (const key of cellKeys) {
      if (!this.cells.has(key)) {
        this.cells.set(key, { itemIds: new Set() });
      }
      this.cells.get(key)!.itemIds.add(itemId);
    }
  }

  // Remove an item
  remove(itemId: string) {
    const cellKeys = this.itemCells.get(itemId);
    if (!cellKeys) return;

    for (const key of cellKeys) {
      const cell = this.cells.get(key);
      if (cell) {
        cell.itemIds.delete(itemId);
        if (cell.itemIds.size === 0) {
          this.cells.delete(key);
        }
      }
    }
    this.itemCells.delete(itemId);
  }

  // Update = remove + insert
  update(
    itemId: string,
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
  ) {
    this.remove(itemId);
    this.insert(itemId, position, dimensions, rotation);
  }

  // Query: is this placement valid?
  canPlace(
    position: [number, number, number],
    dimensions: [number, number, number],
    rotation: [number, number, number],
    ignoreIds: string[] = [],
  ): { valid: boolean; conflictIds: string[] } {
    const cellKeys = this.getItemCells(position, dimensions, rotation);
    const ignoreSet = new Set(ignoreIds);
    const conflicts = new Set<string>();

    for (const key of cellKeys) {
      const cell = this.cells.get(key);
      if (cell) {
        for (const id of cell.itemIds) {
          if (!ignoreSet.has(id)) {
            conflicts.add(id);
          }
        }
      }
    }

    return {
      valid: conflicts.size === 0,
      conflictIds: [...conflicts],
    };
  }

  // Query: get all items near a point (for snapping, selection, etc.)
  queryRadius(x: number, z: number, radius: number): string[] {
    const cellRadius = Math.ceil(radius / this.config.cellSize);
    const [cx, cz] = this.posToCell(x, z);
    const found = new Set<string>();

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const cell = this.cells.get(this.cellKey(cx + dx, cz + dz));
        if (cell) {
          for (const id of cell.itemIds) {
            found.add(id);
          }
        }
      }
    }
    return [...found];
  }

  getItemCount(): number {
    return this.itemCells.size;
  }
}
