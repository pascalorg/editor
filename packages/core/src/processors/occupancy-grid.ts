/**
 * 2D Occupancy Grid for flood fill-based room detection
 * Used to determine which side of walls face interior (room) vs exterior space
 */

export interface BoundingBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export class OccupancyGrid {
  // Cell states
  static EMPTY = 0
  static WALL = 1
  static EXTERIOR = 2
  static ROOM_BASE = 3 // Rooms are 3, 4, 5, etc.

  private grid: Uint8Array
  public readonly width: number
  public readonly height: number
  private originX: number
  private originZ: number
  private cellSize: number

  constructor(bounds: BoundingBox, cellSize = 0.1) {
    // Add padding for exterior flood fill
    const padding = 1.0 // 1 meter padding
    this.originX = bounds.minX - padding
    this.originZ = bounds.minZ - padding
    this.cellSize = cellSize
    this.width = Math.ceil((bounds.maxX - bounds.minX + 2 * padding) / cellSize)
    this.height = Math.ceil((bounds.maxZ - bounds.minZ + 2 * padding) / cellSize)
    this.grid = new Uint8Array(this.width * this.height)
  }

  /**
   * Convert world coordinates to grid indices
   */
  worldToGrid(x: number, z: number): [number, number] {
    const gx = Math.floor((x - this.originX) / this.cellSize)
    const gz = Math.floor((z - this.originZ) / this.cellSize)
    return [gx, gz]
  }

  /**
   * Convert grid indices to world coordinates (center of cell)
   */
  gridToWorld(gx: number, gz: number): [number, number] {
    const x = this.originX + (gx + 0.5) * this.cellSize
    const z = this.originZ + (gz + 0.5) * this.cellSize
    return [x, z]
  }

  /**
   * Check if grid indices are within bounds
   */
  isInBounds(gx: number, gz: number): boolean {
    return gx >= 0 && gx < this.width && gz >= 0 && gz < this.height
  }

  /**
   * Get cell value at grid indices
   */
  get(gx: number, gz: number): number {
    if (!this.isInBounds(gx, gz)) return OccupancyGrid.EXTERIOR
    return this.grid[gz * this.width + gx]
  }

  /**
   * Set cell value at grid indices
   */
  set(gx: number, gz: number, value: number): void {
    if (!this.isInBounds(gx, gz)) return
    this.grid[gz * this.width + gx] = value
  }

  /**
   * Rasterize a wall line segment with thickness onto the grid
   */
  rasterizeWall(start: [number, number], end: [number, number], thickness: number): void {
    const halfT = thickness / 2

    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const len = Math.sqrt(dx * dx + dz * dz)

    if (len < 0.001) return

    // Normal perpendicular to wall direction
    const nx = -dz / len
    const nz = dx / len

    // 4 corners of the wall rectangle
    const corners: [number, number][] = [
      [start[0] + nx * halfT, start[1] + nz * halfT],
      [start[0] - nx * halfT, start[1] - nz * halfT],
      [end[0] - nx * halfT, end[1] - nz * halfT],
      [end[0] + nx * halfT, end[1] + nz * halfT],
    ]

    // Fill the polygon
    this.fillPolygon(corners, OccupancyGrid.WALL)
  }

  /**
   * Fill a polygon using scan-line algorithm
   */
  private fillPolygon(corners: [number, number][], value: number): void {
    // Convert corners to grid coordinates
    const gridCorners = corners.map(([x, z]) => this.worldToGrid(x, z))

    // Find bounding box in grid space
    let minGx = Number.POSITIVE_INFINITY,
      maxGx = Number.NEGATIVE_INFINITY
    let minGz = Number.POSITIVE_INFINITY,
      maxGz = Number.NEGATIVE_INFINITY

    for (const [gx, gz] of gridCorners) {
      minGx = Math.min(minGx, gx)
      maxGx = Math.max(maxGx, gx)
      minGz = Math.min(minGz, gz)
      maxGz = Math.max(maxGz, gz)
    }

    // Clamp to grid bounds
    minGx = Math.max(0, minGx)
    maxGx = Math.min(this.width - 1, maxGx)
    minGz = Math.max(0, minGz)
    maxGz = Math.min(this.height - 1, maxGz)

    // Scan-line fill using point-in-polygon test
    for (let gz = minGz; gz <= maxGz; gz++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const [wx, wz] = this.gridToWorld(gx, gz)
        if (this.pointInPolygon(wx, wz, corners)) {
          this.set(gx, gz, value)
        }
      }
    }
  }

  /**
   * Check if a point is inside a polygon using ray casting
   */
  private pointInPolygon(x: number, z: number, polygon: [number, number][]): boolean {
    let inside = false
    const n = polygon.length

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, zi] = polygon[i]
      const [xj, zj] = polygon[j]

      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
        inside = !inside
      }
    }

    return inside
  }

  /**
   * Flood fill from a world coordinate
   */
  floodFill(startX: number, startZ: number, fillValue: number): number {
    const [gx, gz] = this.worldToGrid(startX, startZ)
    return this.floodFillGrid(gx, gz, fillValue)
  }

  /**
   * Flood fill from grid coordinates using BFS
   */
  floodFillGrid(startGx: number, startGz: number, fillValue: number): number {
    if (!this.isInBounds(startGx, startGz)) return 0
    if (this.get(startGx, startGz) !== OccupancyGrid.EMPTY) return 0

    // BFS flood fill for efficiency (avoids stack overflow on large grids)
    const queue: [number, number][] = [[startGx, startGz]]
    let filledCount = 0

    // Mark starting cell immediately to prevent re-adding
    this.set(startGx, startGz, fillValue)
    filledCount++

    while (queue.length > 0) {
      const [gx, gz] = queue.shift()!

      // 4-connected neighbors
      const neighbors: [number, number][] = [
        [gx + 1, gz],
        [gx - 1, gz],
        [gx, gz + 1],
        [gx, gz - 1],
      ]

      for (const [nx, nz] of neighbors) {
        if (this.isInBounds(nx, nz) && this.get(nx, nz) === OccupancyGrid.EMPTY) {
          this.set(nx, nz, fillValue)
          filledCount++
          queue.push([nx, nz])
        }
      }
    }

    return filledCount
  }

  /**
   * Flood fill exterior from all grid edges
   */
  floodFillExterior(): void {
    // Fill from top and bottom edges
    for (let gx = 0; gx < this.width; gx++) {
      if (this.get(gx, 0) === OccupancyGrid.EMPTY) {
        this.floodFillGrid(gx, 0, OccupancyGrid.EXTERIOR)
      }
      if (this.get(gx, this.height - 1) === OccupancyGrid.EMPTY) {
        this.floodFillGrid(gx, this.height - 1, OccupancyGrid.EXTERIOR)
      }
    }

    // Fill from left and right edges
    for (let gz = 0; gz < this.height; gz++) {
      if (this.get(0, gz) === OccupancyGrid.EMPTY) {
        this.floodFillGrid(0, gz, OccupancyGrid.EXTERIOR)
      }
      if (this.get(this.width - 1, gz) === OccupancyGrid.EMPTY) {
        this.floodFillGrid(this.width - 1, gz, OccupancyGrid.EXTERIOR)
      }
    }
  }

  /**
   * Detect rooms by flood filling remaining EMPTY cells
   * Returns the number of rooms detected
   */
  detectRooms(): number {
    let roomId = OccupancyGrid.ROOM_BASE
    let roomCount = 0

    // Scan grid for remaining EMPTY cells - each contiguous region is a room
    for (let gz = 0; gz < this.height; gz++) {
      for (let gx = 0; gx < this.width; gx++) {
        if (this.get(gx, gz) === OccupancyGrid.EMPTY) {
          const filled = this.floodFillGrid(gx, gz, roomId)
          if (filled > 0) {
            roomId++
            roomCount++
          }
        }
      }
    }

    return roomCount
  }

  /**
   * Get the cell state on a specific side of a wall
   * Samples multiple points along the wall and returns the first room found,
   * or EXTERIOR if no room is found
   * @param wallStart Start point of wall [x, z]
   * @param wallEnd End point of wall [x, z]
   * @param side 'front' or 'back'
   * @param wallThickness thickness of the wall (default 0.2m)
   * @returns The cell state (EXTERIOR, ROOM_BASE+N)
   */
  getSideState(
    wallStart: [number, number],
    wallEnd: [number, number],
    side: 'front' | 'back',
    wallThickness = 0.2,
  ): number {
    // Calculate wall direction
    const dx = wallEnd[0] - wallStart[0]
    const dz = wallEnd[1] - wallStart[1]
    const len = Math.sqrt(dx * dx + dz * dz)

    if (len < 0.001) return OccupancyGrid.EXTERIOR

    // Calculate normal direction (perpendicular to wall)
    // Front normal points in the direction of positive local Z
    let normalX = -dz / len
    let normalZ = dx / len

    if (side === 'back') {
      normalX = -normalX
      normalZ = -normalZ
    }

    // Sample distance from wall center line (past the wall surface)
    const sampleDist = wallThickness / 2 + this.cellSize * 2

    // Sample at multiple points along the wall (start, middle, end)
    // This handles cases where part of the wall is near other walls
    const samplePoints = [0.2, 0.5, 0.8] // 20%, 50%, 80% along wall length

    for (const t of samplePoints) {
      const pointX = wallStart[0] + dx * t
      const pointZ = wallStart[1] + dz * t

      const sampleX = pointX + normalX * sampleDist
      const sampleZ = pointZ + normalZ * sampleDist

      const [gx, gz] = this.worldToGrid(sampleX, sampleZ)

      // Skip if out of bounds
      if (!this.isInBounds(gx, gz)) continue

      const state = this.get(gx, gz)

      // If we find a room, return it immediately
      if (state >= OccupancyGrid.ROOM_BASE) {
        return state
      }
    }

    // No room found at any sample point - check if any point is EXTERIOR vs WALL
    // Sample again to determine if it's exterior or just hitting walls
    const midX = (wallStart[0] + wallEnd[0]) / 2
    const midZ = (wallStart[1] + wallEnd[1]) / 2
    const sampleX = midX + normalX * sampleDist
    const sampleZ = midZ + normalZ * sampleDist
    const [gx, gz] = this.worldToGrid(sampleX, sampleZ)

    if (!this.isInBounds(gx, gz)) {
      return OccupancyGrid.EXTERIOR
    }

    return this.get(gx, gz)
  }

  /**
   * Check if a cell state represents a room (interior space)
   */
  static isRoom(state: number): boolean {
    return state >= OccupancyGrid.ROOM_BASE
  }

  /**
   * Debug: Print a visual representation of the grid to console
   */
  debugPrint(): void {
    const chars: Record<number, string> = {
      [OccupancyGrid.EMPTY]: '.',
      [OccupancyGrid.WALL]: '#',
      [OccupancyGrid.EXTERIOR]: ' ',
    }

    console.log(`Grid ${this.width}x${this.height}:`)
    for (let gz = this.height - 1; gz >= 0; gz--) {
      let row = ''
      for (let gx = 0; gx < this.width; gx++) {
        const state = this.get(gx, gz)
        if (state >= OccupancyGrid.ROOM_BASE) {
          // Show room ID as a letter (A, B, C, ...)
          row += String.fromCharCode(65 + (state - OccupancyGrid.ROOM_BASE))
        } else {
          row += chars[state] ?? '?'
        }
      }
      console.log(row)
    }
  }
}
