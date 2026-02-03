import type { WallNode } from '../schema'

// ============================================================================
// TYPES
// ============================================================================

export type Space = {
  id: string
  levelId: string
  polygon: Array<[number, number]>
  wallIds: string[]
  isExterior: boolean
}

// ============================================================================
// SYNC INITIALIZATION
// ============================================================================

/**
 * Initializes space detection sync with scene and editor stores
 * Call this once during app initialization
 */
export function initSpaceDetectionSync(
  sceneStore: any, // useScene store
  editorStore: any, // useEditor store
): () => void {
  const prevWallsByLevel = new Map<string, Set<string>>()
  let isProcessing = false // Prevent re-entrant calls

  // Subscribe to scene changes (standard Zustand subscribe, not selector-based)
  const unsubscribe = sceneStore.subscribe((state: any) => {
    // Skip if already processing to avoid infinite loops
    if (isProcessing) return

    const nodes = state.nodes
    const currentWallsByLevel = new Map<string, Set<string>>()

    // Group walls by level
    for (const node of Object.values(nodes)) {
      if ((node as any).type === 'wall' && (node as any).parentId) {
        const levelId = (node as any).parentId
        if (!currentWallsByLevel.has(levelId)) {
          currentWallsByLevel.set(levelId, new Set())
        }
        currentWallsByLevel.get(levelId)!.add((node as any).id)
      }
    }

    // Check each level for changes
    const levelsToUpdate = new Set<string>()

    // Check for new walls (created)
    for (const [levelId, wallIds] of currentWallsByLevel.entries()) {
      const prevWallIds = prevWallsByLevel.get(levelId)

      if (!prevWallIds) {
        // New level with walls - run detection if there are multiple walls
        if (wallIds.size > 1) {
          levelsToUpdate.add(levelId)
        }
        continue
      }

      // Find newly added walls
      for (const wallId of wallIds) {
        if (!prevWallIds.has(wallId)) {
          // Wall was added - check if it touches other walls
          const wall = nodes[wallId as keyof typeof nodes] as WallNode
          const otherWalls = Array.from(wallIds)
            .filter((id) => id !== wallId)
            .map((id) => nodes[id as keyof typeof nodes] as WallNode)
            .filter(Boolean)

          if (wallTouchesOthers(wall, otherWalls)) {
            levelsToUpdate.add(levelId)
            break
          }
        }
      }
    }

    // Check for deleted walls
    for (const [levelId, prevWallIds] of prevWallsByLevel.entries()) {
      const currentWallIds = currentWallsByLevel.get(levelId)

      if (!currentWallIds) {
        // All walls deleted from level - clear spaces
        if (prevWallIds.size > 0) {
          levelsToUpdate.add(levelId)
        }
        continue
      }

      // Check if any walls were deleted
      for (const wallId of prevWallIds) {
        if (!currentWallIds.has(wallId)) {
          // Wall was deleted - run detection
          levelsToUpdate.add(levelId)
          break
        }
      }
    }

    // Run detection for affected levels
    if (levelsToUpdate.size > 0) {
      isProcessing = true
      try {
        runSpaceDetection(Array.from(levelsToUpdate), sceneStore, editorStore, nodes)
      } finally {
        isProcessing = false
      }
    }

    // Update previous walls reference
    prevWallsByLevel.clear()
    for (const [levelId, wallIds] of currentWallsByLevel.entries()) {
      prevWallsByLevel.set(levelId, wallIds)
    }
  })

  return unsubscribe
}

/**
 * Runs space detection for the given levels
 * Updates wall nodes and editor spaces
 */
function runSpaceDetection(
  levelIds: string[],
  sceneStore: any,
  editorStore: any,
  nodes: any,
): void {
  const { updateNode } = sceneStore.getState()
  const { setSpaces } = editorStore.getState()

  const allSpaces: Record<string, any> = {}

  for (const levelId of levelIds) {
    // Get walls for this level
    const walls = Object.values(nodes).filter(
      (node: any) => node.type === 'wall' && node.parentId === levelId,
    ) as WallNode[]

    if (walls.length === 0) {
      // No walls - clear any spaces for this level
      continue
    }

    // Run detection
    const { wallUpdates, spaces } = detectSpacesForLevel(levelId, walls)

    // Update wall nodes (only if values changed to avoid infinite loop)
    for (const update of wallUpdates) {
      const wall = nodes[update.wallId as keyof typeof nodes] as WallNode
      if (wall.frontSide !== update.frontSide || wall.backSide !== update.backSide) {
        updateNode(update.wallId as any, {
          frontSide: update.frontSide,
          backSide: update.backSide,
        })
      }
    }

    // Store spaces
    for (const space of spaces) {
      allSpaces[space.id] = space
    }
  }

  // Update editor spaces
  setSpaces(allSpaces)
}

type Grid = {
  cells: Map<string, 'empty' | 'wall' | 'exterior' | 'interior'>
  resolution: number
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  width: number
  height: number
}

type WallSideUpdate = {
  wallId: string
  frontSide: 'interior' | 'exterior' | 'unknown'
  backSide: 'interior' | 'exterior' | 'unknown'
}

// ============================================================================
// MAIN DETECTION FUNCTION
// ============================================================================

/**
 * Detects spaces for a level by flood-filling a grid from the edges
 * Returns wall side updates and detected spaces
 */
export function detectSpacesForLevel(
  levelId: string,
  walls: WallNode[],
  gridResolution: number = 0.5, // Match spatial grid cell size
): {
  wallUpdates: WallSideUpdate[]
  spaces: Space[]
} {
  if (walls.length === 0) {
    return { wallUpdates: [], spaces: [] }
  }

  // Build grid from walls
  const grid = buildGrid(walls, gridResolution)

  // Flood fill from edges to mark exterior
  floodFillFromEdges(grid)

  // Find interior spaces
  const interiorSpaces = findInteriorSpaces(grid, levelId)

  // Assign wall sides
  const wallUpdates = assignWallSides(walls, grid)

  return {
    wallUpdates,
    spaces: interiorSpaces,
  }
}

// ============================================================================
// GRID BUILDING
// ============================================================================

/**
 * Builds a discrete grid and marks cells occupied by walls
 */
function buildGrid(walls: WallNode[], resolution: number): Grid {
  // Find bounds
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const wall of walls) {
    minX = Math.min(minX, wall.start[0], wall.end[0])
    minZ = Math.min(minZ, wall.start[1], wall.end[1])
    maxX = Math.max(maxX, wall.start[0], wall.end[0])
    maxZ = Math.max(maxZ, wall.start[1], wall.end[1])
  }

  // Add padding around bounds
  const padding = 2 // meters
  minX -= padding
  minZ -= padding
  maxX += padding
  maxZ += padding

  const width = Math.ceil((maxX - minX) / resolution)
  const height = Math.ceil((maxZ - minZ) / resolution)

  const grid: Grid = {
    cells: new Map(),
    resolution,
    minX,
    minZ,
    maxX,
    maxZ,
    width,
    height,
  }

  // Mark wall cells
  for (const wall of walls) {
    markWallCells(grid, wall)
  }

  return grid
}

/**
 * Marks all grid cells occupied by a wall using line rasterization
 * Uses denser sampling to ensure continuous barriers
 */
function markWallCells(grid: Grid, wall: WallNode): void {
  const thickness = wall.thickness ?? 0.2
  const halfThickness = thickness / 2

  const [x1, z1] = wall.start
  const [x2, z2] = wall.end

  // Wall direction vector
  const dx = x2 - x1
  const dz = z2 - z1
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 0.001) return

  // Normalized direction and perpendicular
  const dirX = dx / len
  const dirZ = dz / len
  const perpX = -dirZ
  const perpZ = dirX

  // Denser sampling along wall length (at least 2x resolution)
  const steps = Math.max(Math.ceil(len / (grid.resolution * 0.5)), 2)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = x1 + dx * t
    const z = z1 + dz * t

    // Denser sampling across wall thickness
    const thicknessSteps = Math.max(Math.ceil(thickness / (grid.resolution * 0.5)), 2)
    for (let j = 0; j <= thicknessSteps; j++) {
      const offset = (j / thicknessSteps - 0.5) * thickness
      const wx = x + perpX * offset
      const wz = z + perpZ * offset

      const key = getCellKey(grid, wx, wz)
      if (key) {
        grid.cells.set(key, 'wall')
      }
    }
  }
}

// ============================================================================
// FLOOD FILL
// ============================================================================

/**
 * Flood fills from all edge cells to mark exterior space
 */
function floodFillFromEdges(grid: Grid): void {
  const queue: string[] = []

  // Add all edge cells to queue
  for (let x = 0; x < grid.width; x++) {
    for (let z = 0; z < grid.height; z++) {
      // Only process edge cells
      if (x === 0 || x === grid.width - 1 || z === 0 || z === grid.height - 1) {
        const key = getCellKeyFromIndex(x, z, grid.width)
        const cell = grid.cells.get(key)
        if (cell !== 'wall') {
          grid.cells.set(key, 'exterior')
          queue.push(key)
        }
      }
    }
  }

  // Flood fill
  while (queue.length > 0) {
    const key = queue.shift()!
    const [x, z] = parseCellKey(key)

    // Check 4 neighbors
    const neighbors = [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ]

    for (const [nx, nz] of neighbors) {
      if (nx < 0 || nx >= grid.width || nz < 0 || nz >= grid.height) continue

      const nKey = getCellKeyFromIndex(nx, nz, grid.width)
      const cell = grid.cells.get(nKey)

      if (cell !== 'wall' && cell !== 'exterior') {
        grid.cells.set(nKey, 'exterior')
        queue.push(nKey)
      }
    }
  }
}

// ============================================================================
// INTERIOR SPACE DETECTION
// ============================================================================

/**
 * Finds all interior spaces (connected regions not marked as exterior or wall)
 */
function findInteriorSpaces(grid: Grid, levelId: string): Space[] {
  const spaces: Space[] = []
  const visited = new Set<string>()

  // Scan grid for interior cells
  for (let x = 0; x < grid.width; x++) {
    for (let z = 0; z < grid.height; z++) {
      const key = getCellKeyFromIndex(x, z, grid.width)
      if (visited.has(key)) continue

      const cell = grid.cells.get(key)
      if (cell === 'wall' || cell === 'exterior') {
        visited.add(key)
        continue
      }

      // Found interior cell - flood fill to find full space
      const spaceCells = new Set<string>()
      const queue = [key]
      visited.add(key)
      spaceCells.add(key)
      // Mark the seed cell as interior in the grid
      grid.cells.set(key, 'interior')

      while (queue.length > 0) {
        const curKey = queue.shift()!
        const [cx, cz] = parseCellKey(curKey)

        const neighbors = [
          [cx + 1, cz],
          [cx - 1, cz],
          [cx, cz + 1],
          [cx, cz - 1],
        ]

        for (const [nx, nz] of neighbors) {
          if (nx < 0 || nx >= grid.width || nz < 0 || nz >= grid.height) continue

          const nKey = getCellKeyFromIndex(nx, nz, grid.width)
          if (visited.has(nKey)) continue

          const nCell = grid.cells.get(nKey)
          if (nCell === 'wall' || nCell === 'exterior') {
            visited.add(nKey)
            continue
          }

          visited.add(nKey)
          spaceCells.add(nKey)
          // Mark as interior in grid
          grid.cells.set(nKey, 'interior')
          queue.push(nKey)
        }
      }

      // Create space from cells
      const polygon = extractPolygonFromCells(spaceCells, grid)
      spaces.push({
        id: `space-${spaces.length}`,
        levelId,
        polygon,
        wallIds: [],
        isExterior: false,
      })
    }
  }

  return spaces
}

/**
 * Extracts a simplified polygon from a set of grid cells
 * Returns bounding box for now (can be improved to trace actual boundary)
 */
function extractPolygonFromCells(cells: Set<string>, grid: Grid): Array<[number, number]> {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const key of cells) {
    const [x, z] = parseCellKey(key)
    const worldX = grid.minX + x * grid.resolution
    const worldZ = grid.minZ + z * grid.resolution

    minX = Math.min(minX, worldX)
    minZ = Math.min(minZ, worldZ)
    maxX = Math.max(maxX, worldX)
    maxZ = Math.max(maxZ, worldZ)
  }

  // Return bounding box as polygon
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

// ============================================================================
// WALL SIDE ASSIGNMENT
// ============================================================================

/**
 * Assigns front/back side classification to each wall based on grid
 */
function assignWallSides(walls: WallNode[], grid: Grid): WallSideUpdate[] {
  const updates: WallSideUpdate[] = []

  for (const wall of walls) {
    const thickness = wall.thickness ?? 0.2
    const [x1, z1] = wall.start
    const [x2, z2] = wall.end

    // Wall direction and perpendicular
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len < 0.001) continue

    const perpX = -dz / len
    const perpZ = dx / len

    // Sample point on front side (perpendicular direction)
    const midX = (x1 + x2) / 2
    const midZ = (z1 + z2) / 2
    // Sample beyond wall thickness + one full grid cell to ensure we're in the next cell
    const offset = thickness / 2 + grid.resolution

    const frontX = midX + perpX * offset
    const frontZ = midZ + perpZ * offset
    const backX = midX - perpX * offset
    const backZ = midZ - perpZ * offset

    // Check what space each side faces
    const frontKey = getCellKey(grid, frontX, frontZ)
    const backKey = getCellKey(grid, backX, backZ)

    const frontCell = frontKey ? grid.cells.get(frontKey) : undefined
    const backCell = backKey ? grid.cells.get(backKey) : undefined

    const frontSide = classifySide(frontCell)
    const backSide = classifySide(backCell)

    updates.push({
      wallId: wall.id,
      frontSide,
      backSide,
    })
  }

  return updates
}

/**
 * Classifies a cell as interior, exterior, or unknown
 */
function classifySide(cell: string | undefined): 'interior' | 'exterior' | 'unknown' {
  if (cell === 'exterior') return 'exterior'
  if (cell === 'interior') return 'interior'
  // Wall cells or out-of-bounds (undefined) are unknown
  return 'unknown'
}

// ============================================================================
// GRID UTILITIES
// ============================================================================

/**
 * Gets grid cell key from world coordinates
 */
function getCellKey(grid: Grid, x: number, z: number): string | null {
  const cellX = Math.floor((x - grid.minX) / grid.resolution)
  const cellZ = Math.floor((z - grid.minZ) / grid.resolution)

  if (cellX < 0 || cellX >= grid.width || cellZ < 0 || cellZ >= grid.height) {
    return null
  }

  return `${cellX},${cellZ}`
}

/**
 * Gets cell key from grid indices
 */
function getCellKeyFromIndex(x: number, z: number, width: number): string {
  return `${x},${z}`
}

/**
 * Parses cell key back to indices
 */
function parseCellKey(key: string): [number, number] {
  const parts = key.split(',')
  return [Number.parseInt(parts[0]!, 10), Number.parseInt(parts[1]!, 10)]
}

// ============================================================================
// WALL CONNECTIVITY DETECTION
// ============================================================================

/**
 * Checks if a wall touches any other walls
 * Used to determine if space detection should run
 */
export function wallTouchesOthers(wall: WallNode, otherWalls: WallNode[]): boolean {
  const threshold = 0.1 // 10cm connection threshold

  for (const other of otherWalls) {
    if (other.id === wall.id) continue

    // Check if any endpoint of wall is close to any endpoint or segment of other
    if (
      distanceToSegment(wall.start, other.start, other.end) < threshold ||
      distanceToSegment(wall.end, other.start, other.end) < threshold ||
      distanceToSegment(other.start, wall.start, wall.end) < threshold ||
      distanceToSegment(other.end, wall.start, wall.end) < threshold
    ) {
      return true
    }
  }

  return false
}

/**
 * Distance from point to line segment
 */
function distanceToSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): number {
  const [px, pz] = point
  const [x1, z1] = segStart
  const [x2, z2] = segEnd

  const dx = x2 - x1
  const dz = z2 - z1
  const lenSq = dx * dx + dz * dz

  if (lenSq < 0.0001) {
    // Segment is a point
    const dpx = px - x1
    const dpz = pz - z1
    return Math.sqrt(dpx * dpx + dpz * dpz)
  }

  // Project point onto line
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq))
  const projX = x1 + t * dx
  const projZ = z1 + t * dz

  const distX = px - projX
  const distZ = pz - projZ

  return Math.sqrt(distX * distX + distZ * distZ)
}
