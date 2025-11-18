/**
 * Node-based Architecture Type Definitions
 *
 * This file contains all type definitions for the new node-based architecture.
 * Nodes form a tree structure where each node can have children and a parent reference.
 */

// ============================================================================
// BASE NODE TYPES
// ============================================================================

/**
 * Base interface that all nodes inherit from
 */
export interface BaseNode {
  id: string
  type:
    | 'root'
    | 'building'
    | 'level'
    | 'slab'
    | 'wall'
    | 'door'
    | 'window'
    | 'column'
    | 'roof'
    | 'reference-image'
    | 'scan'
    | 'group'
    | 'item'
  name: string
  visible?: boolean
  opacity?: number // 0-100, defaults to 100
  locked?: boolean
  preview?: boolean // True for nodes being actively placed (not yet committed)
  children: BaseNode[]
  parent?: string // parent id for bi-directional traversal
  metadata?: Record<string, any>
}

/**
 * Interface for nodes that exist on the grid with position, rotation, and size
 */
export interface GridItem {
  position: [number, number] // x, z in grid coordinates
  rotation: number // radians
  size: [number, number] // width, depth in grid units
  canPlace?: boolean // Whether the item can be placed at its current position
  elevation?: number // Y offset from base (vertical position in meters)
}

export interface GridPoint {
  x: number
  z: number
}

// ============================================================================
// SCENE HIERARCHY NODES
// ============================================================================

/**
 * Root node of the entire scene graph
 * Contains one or more buildings
 */
export interface RootNode extends BaseNode {
  type: 'root'
  children: BuildingNode[]
}

/**
 * Building node containing all levels/floors
 * Child of root node
 */
export interface BuildingNode extends BaseNode {
  type: 'building'
  children: LevelNode[]
}

// ============================================================================
// LEVEL NODE
// ============================================================================

export interface LevelNode extends BaseNode {
  type: 'level'
  level: number // Floor number (0 = ground floor, 1 = first floor, etc.)
  height?: number // Height of this level in meters (calculated by processor)
  elevation?: number // Y offset from ground (calculated based on previous levels' heights)
  children: (
    | WallNode
    | RoofNode
    | ColumnNode
    | ReferenceImageNode
    | ScanNode
    | GroupNode
    | SlabNode
    | ItemNode
  )[]
}

// ============================================================================
// BUILDING ELEMENT NODES
// ============================================================================

export interface WallNode extends BaseNode, GridItem {
  type: 'wall'
  children: (DoorNode | WindowNode)[]
  start: GridPoint // Start point of the wall
  end: GridPoint // End point of the wall
  // Position represents the start point of the wall
  // Size[0] = length, Size[1] = thickness (0.2m)
  // Rotation determines wall direction
}

export interface SlabNode extends BaseNode, GridItem {
  type: 'slab'
}

export interface DoorNode extends BaseNode, GridItem {
  type: 'door'
  children: [] // Doors don't have children
  width?: number // Door width in meters (for legacy compatibility)
}

export interface WindowNode extends BaseNode, GridItem {
  type: 'window'
  children: [] // Windows don't have children
  width?: number // Window width in meters (for legacy compatibility)
}

export interface ColumnNode extends BaseNode, GridItem {
  type: 'column'
  children: [] // Columns don't have children
}

// ============================================================================
// ROOF NODES
// ============================================================================

export interface RoofNode extends BaseNode, GridItem {
  type: 'roof'
  children: []
}

// ============================================================================
// REFERENCE CONTENT NODES
// ============================================================================

export interface ReferenceImageNode extends BaseNode, GridItem {
  type: 'reference-image'
  url: string // Data URL for image
  scale: number
  createdAt: string
  children: [] // Images don't have children
}

export interface ScanNode extends BaseNode, GridItem {
  type: 'scan'
  url: string // Data URL for 3D model
  scale: number
  yOffset?: number // Additional Y offset from floor level
  createdAt: string
  children: [] // Scans don't have children
}

// ============================================================================
// GROUP NODE
// ============================================================================

export interface GroupNode extends BaseNode, GridItem {
  type: 'group'
  groupType?: 'room' | 'floor' | 'outdoor' // Type of grouping
  color?: string // CSS color for visualization
  children: (WallNode | RoofNode | ColumnNode | DoorNode | WindowNode | GroupNode | SlabNode)[]
}

// ============================================================================
// ITEM NODE
// ============================================================================

export interface ItemNode extends BaseNode, GridItem {
  type: 'item'
  category?: 'furniture' | 'appliance' | 'decoration' | 'lighting' | 'plumbing' | 'electric'
  modelUrl: string // URL to the 3D model (GLTF/GLB)
  scale?: [number, number, number] // Scale factor for the 3D model [x, y, z]
  modelPosition?: [number, number, number] // Fine-tune position offset for GLB [x, y, z]
  modelRotation?: [number, number, number] // Fine-tune rotation for GLB [x, y, z] in radians
}

// ============================================================================
// UNION TYPES
// ============================================================================

/**
 * Union of all possible node types
 */
export type AnyNode =
  | RootNode
  | BuildingNode
  | LevelNode
  | WallNode
  | DoorNode
  | WindowNode
  | ColumnNode
  | RoofNode
  | ReferenceImageNode
  | ScanNode
  | GroupNode
  | SlabNode

/**
 * Union of all building element nodes (walls, doors, windows, columns, roofs)
 */
export type BuildingElementNode = WallNode | DoorNode | WindowNode | ColumnNode | RoofNode

/**
 * Union of nodes that can be direct children of a level
 */
export type LevelChildNode =
  | WallNode
  | RoofNode
  | ColumnNode
  | ReferenceImageNode
  | ScanNode
  | GroupNode

/**
 * Union of nodes that can be children of a wall
 */
export type WallChildNode = DoorNode | WindowNode

/**
 * Union of nodes that have grid positioning
 */
export type GridNode =
  | WallNode
  | DoorNode
  | WindowNode
  | ColumnNode
  | RoofNode
  | ReferenceImageNode
  | ScanNode
  | GroupNode

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Extract node type from node type string
 */
export type NodeTypeMap = {
  level: LevelNode
  wall: WallNode
  door: DoorNode
  window: WindowNode
  column: ColumnNode
  roof: RoofNode
  'reference-image': ReferenceImageNode
  scan: ScanNode
  group: GroupNode
}

/**
 * Node type string literals
 */
export type NodeType = keyof NodeTypeMap
