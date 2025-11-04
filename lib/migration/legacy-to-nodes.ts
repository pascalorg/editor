/**
 * Legacy to Nodes Migration
 *
 * Converts the old component-based structure to the new node-based tree structure.
 */

import type {
  Component,
  ComponentGroup,
  ReferenceImage,
  RoofSegment,
  Scan,
  WallSegment,
} from '../../hooks/use-editor'

import type {
  BaseNode,
  ColumnNode,
  DoorNode,
  LevelNode,
  ReferenceImageNode,
  RoofNode,
  RoofSegmentNode,
  ScanNode,
  WallNode,
  WindowNode,
} from '../nodes/types'

// ============================================================================
// CONSTANTS
// ============================================================================

const WALL_THICKNESS = 0.2 // meters

// ============================================================================
// MAIN CONVERSION FUNCTION
// ============================================================================

/**
 * Convert legacy component structure to node tree
 */
export function componentsToNodeTree(
  components: Component[],
  groups: ComponentGroup[],
  images: ReferenceImage[],
  scans: Scan[],
): LevelNode[] {
  // Group components by floor/level
  const componentsByGroup = new Map<string, Component[]>()
  const imagesByLevel = new Map<number, ReferenceImage[]>()
  const scansByLevel = new Map<number, Scan[]>()

  // Organize components by group
  for (const component of components) {
    const groupId = component.group || 'level_0'
    if (!componentsByGroup.has(groupId)) {
      componentsByGroup.set(groupId, [])
    }
    componentsByGroup.get(groupId)!.push(component)
  }

  // Organize images by level
  for (const image of images) {
    const level = image.level ?? 0
    if (!imagesByLevel.has(level)) {
      imagesByLevel.set(level, [])
    }
    imagesByLevel.get(level)!.push(image)
  }

  // Organize scans by level
  for (const scan of scans) {
    const level = scan.level ?? 0
    if (!scansByLevel.has(level)) {
      scansByLevel.set(level, [])
    }
    scansByLevel.get(level)!.push(scan)
  }

  // Convert each group to a LevelNode
  const levelNodes: LevelNode[] = groups.map((group) => {
    const groupComponents = componentsByGroup.get(group.id) || []
    const level = group.level ?? 0
    const levelImages = imagesByLevel.get(level) || []
    const levelScans = scansByLevel.get(level) || []

    return groupToLevelNode(group, groupComponents, levelImages, levelScans)
  })

  return levelNodes
}

// ============================================================================
// GROUP TO LEVEL NODE
// ============================================================================

/**
 * Convert a ComponentGroup to a LevelNode with all its children
 */
function groupToLevelNode(
  group: ComponentGroup,
  components: Component[],
  images: ReferenceImage[],
  scans: Scan[],
): LevelNode {
  const children: BaseNode[] = []

  // Convert components to nodes
  for (const component of components) {
    switch (component.type) {
      case 'wall':
        // Each wall segment becomes a WallNode
        if (component.data && 'segments' in component.data) {
          const wallNodes = wallSegmentsToWallNodes(component.data.segments, group.id)
          children.push(...wallNodes)
        }
        break

      case 'roof':
        // Convert roof component to RoofNode with segment children
        if (component.data && 'segments' in component.data) {
          const roofNode = roofComponentToRoofNode(component, group.id)
          if (roofNode) {
            children.push(roofNode)
          }
        }
        break

      case 'door':
        // Doors will be added as children to walls later
        // For now, convert to standalone DoorNode
        if (component.data && 'position' in component.data) {
          const doorNode = doorComponentToDoorNode(component, group.id)
          children.push(doorNode)
        }
        break

      case 'window':
        // Windows will be added as children to walls later
        // For now, convert to standalone WindowNode
        if (component.data && 'position' in component.data) {
          const windowNode = windowComponentToWindowNode(component, group.id)
          children.push(windowNode)
        }
        break

      case 'column':
        // Each column in the columns array becomes a ColumnNode
        if (component.data && 'columns' in component.data) {
          const columnNodes = columnsToColumnNodes(component.data.columns, group.id)
          children.push(...columnNodes)
        }
        break
    }
  }

  // Convert images to nodes
  for (const image of images) {
    children.push(imageToReferenceImageNode(image, group.id))
  }

  // Convert scans to nodes
  for (const scan of scans) {
    children.push(scanToScanNode(scan, group.id))
  }

  // Create LevelNode
  const levelNode: LevelNode = {
    id: group.id,
    type: 'level',
    name: group.name,
    level: group.level ?? 0,
    visible: group.visible,
    opacity: group.opacity,
    children: children as LevelNode['children'],
    metadata: {
      groupType: group.type,
      color: group.color,
    },
  }

  return levelNode
}

// ============================================================================
// WALL CONVERSION
// ============================================================================

/**
 * Convert wall segments to WallNode array
 */
function wallSegmentsToWallNodes(segments: WallSegment[], parentId: string): WallNode[] {
  return segments.map((segment) => wallSegmentToWallNode(segment, parentId))
}

/**
 * Convert a single WallSegment to WallNode
 */
export function wallSegmentToWallNode(segment: WallSegment, parentId: string): WallNode {
  const [x1, z1] = segment.start
  const [x2, z2] = segment.end

  // Calculate length and rotation
  const length = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)
  const rotation = Math.atan2(z2 - z1, x2 - x1)

  return {
    id: `wall-${segment.id}`,
    type: 'wall',
    name: `Wall ${segment.id}`,
    start: { x: x1, z: z1 },
    end: { x: x2, z: z2 },
    position: [x1, z1],
    rotation,
    size: [length, WALL_THICKNESS],
    visible: segment.visible,
    opacity: segment.opacity,
    children: [], // Doors and windows will be added later
    parent: parentId,
    metadata: {
      isHorizontal: segment.isHorizontal,
      legacyId: segment.id,
    },
  }
}

// ============================================================================
// ROOF CONVERSION
// ============================================================================

/**
 * Convert roof component to RoofNode
 */
function roofComponentToRoofNode(component: Component, parentId: string): RoofNode | null {
  if (component.type !== 'roof' || !('segments' in component.data)) {
    return null
  }

  const segments = component.data.segments as RoofSegment[]

  // Calculate bounding box of all segments for roof position
  if (segments.length === 0) {
    return null
  }

  const segmentNodes = segments.map((seg) => roofSegmentToRoofSegmentNode(seg, component.id))

  // Use first segment position as roof position
  const firstSeg = segments[0]

  return {
    id: component.id,
    type: 'roof',
    name: component.label,
    position: firstSeg.start,
    rotation: 0,
    size: [0, 0], // Will be calculated from segments
    visible: true,
    opacity: 100,
    children: segmentNodes,
    parent: parentId,
  }
}

/**
 * Convert RoofSegment to RoofSegmentNode
 */
function roofSegmentToRoofSegmentNode(segment: RoofSegment, parentId: string): RoofSegmentNode {
  const [x1, y1] = segment.start
  const [x2, y2] = segment.end

  const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
  const rotation = Math.atan2(y2 - y1, x2 - x1)

  return {
    id: `roof-segment-${segment.id}`,
    type: 'roof-segment',
    name: `Roof Segment ${segment.id}`,
    position: [x1, y1],
    rotation,
    size: [length, 0],
    height: segment.height,
    leftWidth: segment.leftWidth,
    rightWidth: segment.rightWidth,
    visible: segment.visible,
    opacity: segment.opacity,
    children: [],
    parent: parentId,
    metadata: {
      legacyId: segment.id,
    },
  }
}

// ============================================================================
// DOOR/WINDOW CONVERSION
// ============================================================================

/**
 * Convert door component to DoorNode
 */
function doorComponentToDoorNode(component: Component, parentId: string): DoorNode {
  if (component.type !== 'door') {
    throw new Error('Component is not a door')
  }

  const data = component.data as { position: [number, number]; rotation: number; width: number }

  return {
    id: component.id,
    type: 'door',
    name: component.label,
    position: data.position,
    rotation: data.rotation,
    size: [data.width, WALL_THICKNESS],
    width: data.width,
    visible: true,
    opacity: 100,
    children: [],
    parent: parentId,
  }
}

/**
 * Convert window component to WindowNode
 */
function windowComponentToWindowNode(component: Component, parentId: string): WindowNode {
  if (component.type !== 'window') {
    throw new Error('Component is not a window')
  }

  const data = component.data as { position: [number, number]; rotation: number; width: number }

  return {
    id: component.id,
    type: 'window',
    name: component.label,
    position: data.position,
    rotation: data.rotation,
    size: [data.width, WALL_THICKNESS],
    width: data.width,
    visible: true,
    opacity: 100,
    children: [],
    parent: parentId,
  }
}

// ============================================================================
// COLUMN CONVERSION
// ============================================================================

/**
 * Convert columns array to ColumnNode array
 */
function columnsToColumnNodes(
  columns: Array<{ id: string; position: [number, number]; visible?: boolean; opacity?: number }>,
  parentId: string,
): ColumnNode[] {
  return columns.map((col) => ({
    id: col.id,
    type: 'column',
    name: `Column ${col.id}`,
    position: col.position,
    rotation: 0,
    size: [0.3, 0.3], // Default column size
    visible: col.visible,
    opacity: col.opacity,
    children: [],
    parent: parentId,
  }))
}

// ============================================================================
// IMAGE/SCAN CONVERSION
// ============================================================================

/**
 * Convert ReferenceImage to ReferenceImageNode
 */
function imageToReferenceImageNode(image: ReferenceImage, parentId: string): ReferenceImageNode {
  return {
    id: image.id,
    type: 'reference-image',
    name: image.name,
    url: image.url,
    position: image.position,
    rotation: image.rotation,
    size: [1, 1], // Size will be determined by scale and actual image dimensions
    scale: image.scale,
    visible: image.visible,
    opacity: image.opacity,
    children: [],
    parent: parentId,
    createdAt: image.createdAt,
  }
}

/**
 * Convert Scan to ScanNode
 */
function scanToScanNode(scan: Scan, parentId: string): ScanNode {
  return {
    id: scan.id,
    type: 'scan',
    name: scan.name,
    url: scan.url,
    position: scan.position,
    rotation: scan.rotation,
    size: [1, 1], // Size will be determined by scale and actual scan bounds
    scale: scan.scale,
    yOffset: scan.yOffset,
    visible: scan.visible,
    opacity: scan.opacity,
    children: [],
    parent: parentId,
    createdAt: scan.createdAt,
  }
}

// ============================================================================
// DOOR/WINDOW TO WALL ASSOCIATION
// ============================================================================

/**
 * Associate doors and windows with their parent walls
 * This should be called after initial conversion to attach doors/windows to walls
 */
export function associateDoorsAndWindowsWithWalls(levels: LevelNode[]): LevelNode[] {
  return levels.map((level) => {
    // Cast to BaseNode[] because during migration, children may temporarily include doors/windows
    const children = level.children as BaseNode[]
    const walls = children.filter((child) => child.type === 'wall') as WallNode[]
    const doors = children.filter((child) => child.type === 'door') as DoorNode[]
    const windows = children.filter((child) => child.type === 'window') as WindowNode[]
    const others = children.filter(
      (child) => child.type !== 'wall' && child.type !== 'door' && child.type !== 'window',
    )

    // For each door/window, find the wall it belongs to
    const wallsMap = new Map(walls.map((w) => [w.id, { ...w, children: [...w.children] }]))

    for (const door of doors) {
      const parentWall = findWallForDoorOrWindow(door, walls)
      if (parentWall) {
        const wall = wallsMap.get(parentWall.id)
        if (wall) {
          wall.children.push({ ...door, parent: parentWall.id })
        }
      }
    }

    for (const window of windows) {
      const parentWall = findWallForDoorOrWindow(window, walls)
      if (parentWall) {
        const wall = wallsMap.get(parentWall.id)
        if (wall) {
          wall.children.push({ ...window, parent: parentWall.id })
        }
      }
    }

    // Rebuild children list without standalone doors/windows
    const updatedChildren = [...Array.from(wallsMap.values()), ...others]

    return {
      ...level,
      children: updatedChildren as LevelNode['children'],
    }
  })
}

/**
 * Find which wall a door or window belongs to
 * Based on position and rotation matching
 */
function findWallForDoorOrWindow(
  element: DoorNode | WindowNode,
  walls: WallNode[],
): WallNode | null {
  const [ex, ey] = element.position
  const threshold = 0.1 // 10cm tolerance

  for (const wall of walls) {
    const [wx, wy] = wall.position
    const [length] = wall.size
    const rotation = wall.rotation

    // Calculate wall end point
    const endX = wx + length * Math.cos(rotation)
    const endY = wy + length * Math.sin(rotation)

    // Check if element is on the wall line
    const isOnWall = isPointOnLineSegment([ex, ey], [wx, wy], [endX, endY], threshold)

    // Check if rotation matches (door/window perpendicular to wall or aligned)
    const rotationDiff = Math.abs(element.rotation - rotation)
    const rotationMatches = rotationDiff < 0.1 || Math.abs(rotationDiff - Math.PI / 2) < 0.1

    if (isOnWall && rotationMatches) {
      return wall
    }
  }

  return null
}

/**
 * Check if a point is on a line segment
 */
function isPointOnLineSegment(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number],
  threshold: number,
): boolean {
  const [px, py] = point
  const [x1, y1] = lineStart
  const [x2, y2] = lineEnd

  // Calculate distance from point to line
  const A = px - x1
  const B = py - y1
  const C = x2 - x1
  const D = y2 - y1

  const dot = A * C + B * D
  const lenSq = C * C + D * D

  if (lenSq === 0) {
    // Line segment is a point
    return Math.sqrt(A * A + B * B) <= threshold
  }

  const param = dot / lenSq

  // Check if point is within segment bounds
  if (param < 0 || param > 1) {
    return false
  }

  // Calculate closest point on line
  const xx = x1 + param * C
  const yy = y1 + param * D

  // Calculate distance
  const dist = Math.sqrt((px - xx) ** 2 + (py - yy) ** 2)

  return dist <= threshold
}
