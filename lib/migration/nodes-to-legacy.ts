/**
 * Nodes to Legacy Migration
 *
 * Converts the new node-based tree structure back to the old component-based structure.
 * Used for backward compatibility and dual-state synchronization.
 */

import type {
  ColumnComponentData,
  Component,
  ComponentGroup,
  DoorComponentData,
  ReferenceImage,
  RoofComponentData,
  RoofSegment,
  Scan,
  WallComponentData,
  WallSegment,
  WindowComponentData,
} from '../../hooks/use-editor'

import type {
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

import { traverseTree } from '../nodes/utils'

// ============================================================================
// MAIN CONVERSION FUNCTION
// ============================================================================

/**
 * Convert node tree to legacy component structure
 */
export function nodeTreeToComponents(levels: LevelNode[]): {
  components: Component[]
  groups: ComponentGroup[]
  images: ReferenceImage[]
  scans: Scan[]
} {
  const components: Component[] = []
  const groups: ComponentGroup[] = []
  const images: ReferenceImage[] = []
  const scans: Scan[] = []

  for (const level of levels) {
    // Convert level to group
    groups.push(levelNodeToGroup(level))

    // Convert level children to components
    const levelComponents = levelNodeToComponents(level)
    components.push(...levelComponents.components)
    images.push(...levelComponents.images)
    scans.push(...levelComponents.scans)
  }

  return { components, groups, images, scans }
}

// ============================================================================
// LEVEL TO GROUP
// ============================================================================

/**
 * Convert LevelNode to ComponentGroup
 */
function levelNodeToGroup(level: LevelNode): ComponentGroup {
  return {
    id: level.id,
    name: level.name,
    type: (level.metadata?.groupType as 'room' | 'floor' | 'outdoor') || 'floor',
    color: (level.metadata?.color as string) || '#ffffff',
    level: level.level,
    visible: level.visible,
    opacity: level.opacity,
  }
}

// ============================================================================
// LEVEL CHILDREN TO COMPONENTS
// ============================================================================

/**
 * Convert all children of a level to components
 */
function levelNodeToComponents(level: LevelNode): {
  components: Component[]
  images: ReferenceImage[]
  scans: Scan[]
} {
  const components: Component[] = []
  const images: ReferenceImage[] = []
  const scans: Scan[] = []

  // Collect all walls and their children (doors/windows)
  const walls: WallNode[] = []
  const doors: DoorNode[] = []
  const windows: WindowNode[] = []
  const columns: ColumnNode[] = []
  const roofs: RoofNode[] = []

  for (const child of level.children) {
    switch (child.type) {
      case 'wall':
        walls.push(child as WallNode)
        // Extract doors and windows from wall children
        for (const wallChild of (child as WallNode).children) {
          if (wallChild.type === 'door') {
            doors.push(wallChild as DoorNode)
          } else if (wallChild.type === 'window') {
            windows.push(wallChild as WindowNode)
          }
        }
        break

      case 'column':
        columns.push(child as ColumnNode)
        break

      case 'roof':
        roofs.push(child as RoofNode)
        break

      case 'reference-image':
        images.push(referenceImageNodeToImage(child as ReferenceImageNode))
        break

      case 'scan':
        scans.push(scanNodeToScan(child as ScanNode))
        break

      case 'group':
        // TODO: Handle nested groups if needed
        break
    }
  }

  // Convert walls to single wall component
  if (walls.length > 0) {
    components.push(wallNodesToWallComponent(walls, level.id))
  }

  // Convert each door to a component
  for (const door of doors) {
    components.push(doorNodeToDoorComponent(door, level.id))
  }

  // Convert each window to a component
  for (const window of windows) {
    components.push(windowNodeToWindowComponent(window, level.id))
  }

  // Convert columns to single column component
  if (columns.length > 0) {
    components.push(columnNodesToColumnComponent(columns, level.id))
  }

  // Convert each roof to a component
  for (const roof of roofs) {
    components.push(roofNodeToRoofComponent(roof, level.id))
  }

  return { components, images, scans }
}

// ============================================================================
// WALL CONVERSION
// ============================================================================

/**
 * Convert WallNode array to a single wall Component
 */
function wallNodesToWallComponent(walls: WallNode[], groupId: string): Component {
  const segments: WallSegment[] = walls.map((wall) => wallNodeToWallSegment(wall))

  return {
    id: `walls-${groupId}`,
    type: 'wall',
    label: `Walls - ${groupId}`,
    group: groupId,
    data: {
      segments,
    },
    createdAt: new Date().toISOString(),
  }
}

/**
 * Convert single WallNode to WallSegment
 */
export function wallNodeToWallSegment(wall: WallNode): WallSegment {
  const [x1, y1] = wall.position
  const [length] = wall.size
  const rotation = wall.rotation

  // Calculate end point from position, length, and rotation
  const x2 = x1 + length * Math.cos(rotation)
  const y2 = y1 + length * Math.sin(rotation)

  // Determine if horizontal (tolerance for floating point)
  const isHorizontal = Math.abs(Math.sin(rotation)) < 0.1

  // Generate ID from coordinates
  const id =
    wall.metadata?.legacyId || `${x1.toFixed(1)},${y1.toFixed(1)}-${x2.toFixed(1)},${y2.toFixed(1)}`

  return {
    id,
    start: [x1, y1],
    end: [x2, y2],
    isHorizontal,
    visible: wall.visible,
    opacity: wall.opacity,
  }
}

// ============================================================================
// ROOF CONVERSION
// ============================================================================

/**
 * Convert RoofNode to roof Component
 */
function roofNodeToRoofComponent(roof: RoofNode, groupId: string): Component {
  const segments: RoofSegment[] = roof.children.map((child) =>
    roofSegmentNodeToRoofSegment(child as RoofSegmentNode),
  )

  return {
    id: roof.id,
    type: 'roof',
    label: roof.name,
    group: groupId,
    data: {
      segments,
    },
    createdAt: new Date().toISOString(),
  }
}

/**
 * Convert RoofSegmentNode to RoofSegment
 */
function roofSegmentNodeToRoofSegment(segment: RoofSegmentNode): RoofSegment {
  const [x1, y1] = segment.position
  const [length] = segment.size
  const rotation = segment.rotation

  const x2 = x1 + length * Math.cos(rotation)
  const y2 = y1 + length * Math.sin(rotation)

  const id =
    segment.metadata?.legacyId ||
    `${x1.toFixed(1)},${y1.toFixed(1)}-${x2.toFixed(1)},${y2.toFixed(1)}`

  return {
    id,
    start: [x1, y1],
    end: [x2, y2],
    height: segment.height,
    leftWidth: segment.leftWidth,
    rightWidth: segment.rightWidth,
    visible: segment.visible,
    opacity: segment.opacity,
  }
}

// ============================================================================
// DOOR/WINDOW CONVERSION
// ============================================================================

/**
 * Convert DoorNode to door Component
 */
function doorNodeToDoorComponent(door: DoorNode, groupId: string): Component {
  return {
    id: door.id,
    type: 'door',
    label: door.name,
    group: groupId,
    data: {
      position: door.position,
      rotation: door.rotation,
      width: door.width || door.size[0],
    },
    createdAt: new Date().toISOString(),
  }
}

/**
 * Convert WindowNode to window Component
 */
function windowNodeToWindowComponent(window: WindowNode, groupId: string): Component {
  return {
    id: window.id,
    type: 'window',
    label: window.name,
    group: groupId,
    data: {
      position: window.position,
      rotation: window.rotation,
      width: window.width || window.size[0],
    },
    createdAt: new Date().toISOString(),
  }
}

// ============================================================================
// COLUMN CONVERSION
// ============================================================================

/**
 * Convert ColumnNode array to single column Component
 */
function columnNodesToColumnComponent(columns: ColumnNode[], groupId: string): Component {
  const columnData = columns.map((col) => ({
    id: col.id,
    position: col.position,
    visible: col.visible,
    opacity: col.opacity,
  }))

  return {
    id: `columns-${groupId}`,
    type: 'column',
    label: `Columns - ${groupId}`,
    group: groupId,
    data: {
      columns: columnData,
    },
    createdAt: new Date().toISOString(),
  }
}

// ============================================================================
// IMAGE/SCAN CONVERSION
// ============================================================================

/**
 * Convert ReferenceImageNode to ReferenceImage
 */
function referenceImageNodeToImage(node: ReferenceImageNode): ReferenceImage {
  // Extract level from parent
  const level = 0 // Will be set correctly based on parent level

  return {
    id: node.id,
    url: node.url,
    name: node.name,
    createdAt: node.createdAt,
    position: node.position,
    rotation: node.rotation,
    scale: node.scale,
    level, // This should be extracted from parent LevelNode
    visible: node.visible,
    opacity: node.opacity,
  }
}

/**
 * Convert ScanNode to Scan
 */
function scanNodeToScan(node: ScanNode): Scan {
  const level = 0 // Will be set correctly based on parent level

  return {
    id: node.id,
    url: node.url,
    name: node.name,
    createdAt: node.createdAt,
    position: node.position,
    rotation: node.rotation,
    scale: node.scale,
    level, // This should be extracted from parent LevelNode
    yOffset: node.yOffset,
    visible: node.visible,
    opacity: node.opacity,
  }
}

// ============================================================================
// LEVEL EXTRACTION FOR IMAGES/SCANS
// ============================================================================

/**
 * Convert node tree with proper level assignment for images/scans
 */
export function nodeTreeToComponentsWithLevels(levels: LevelNode[]): {
  components: Component[]
  groups: ComponentGroup[]
  images: ReferenceImage[]
  scans: Scan[]
} {
  const components: Component[] = []
  const groups: ComponentGroup[] = []
  const images: ReferenceImage[] = []
  const scans: Scan[] = []

  for (const level of levels) {
    groups.push(levelNodeToGroup(level))

    const levelComponents = levelNodeToComponents(level)
    components.push(...levelComponents.components)

    // Add level information to images and scans
    const levelImages = levelComponents.images.map((img) => ({
      ...img,
      level: level.level,
    }))

    const levelScans = levelComponents.scans.map((scan) => ({
      ...scan,
      level: level.level,
    }))

    images.push(...levelImages)
    scans.push(...levelScans)
  }

  return { components, groups, images, scans }
}
