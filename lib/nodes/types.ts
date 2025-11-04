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
    | 'level'
    | 'wall'
    | 'door'
    | 'window'
    | 'column'
    | 'roof'
    | 'roof-segment'
    | 'reference-image'
    | 'scan'
    | 'group'
  name: string
  visible?: boolean
  opacity?: number // 0-100, defaults to 100
  locked?: boolean
  children: BaseNode[]
  parent?: string // parent id for bi-directional traversal
  metadata?: Record<string, any>
}

/**
 * Interface for nodes that exist on the grid with position, rotation, and size
 */
export interface GridItem {
  position: [number, number] // x, y in grid coordinates
  rotation: number // radians
  size: [number, number] // width, depth in grid units
}

// ============================================================================
// LEVEL NODE
// ============================================================================

export interface LevelNode extends BaseNode {
  type: 'level'
  level: number // Floor number (0 = ground floor, 1 = first floor, etc.)
  children: (WallNode | RoofNode | ColumnNode | ReferenceImageNode | ScanNode | GroupNode)[]
}

// ============================================================================
// BUILDING ELEMENT NODES
// ============================================================================

export interface WallNode extends BaseNode, GridItem {
  type: 'wall'
  children: (DoorNode | WindowNode)[]
  // Position represents the start point of the wall
  // Size[0] = length, Size[1] = thickness (0.2m)
  // Rotation determines wall direction
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
  children: RoofSegmentNode[]
}

export interface RoofSegmentNode extends BaseNode, GridItem {
  type: 'roof-segment'
  height: number // Peak height above base (meters)
  leftWidth?: number // Distance from ridge to left edge
  rightWidth?: number // Distance from ridge to right edge
  children: [] // Roof segments don't have children
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

export interface GroupNode extends BaseNode {
  type: 'group'
  groupType?: 'room' | 'floor' | 'outdoor' // Type of grouping
  color?: string // CSS color for visualization
  children: (WallNode | RoofNode | ColumnNode | DoorNode | WindowNode | GroupNode)[]
}

// ============================================================================
// UNION TYPES
// ============================================================================

/**
 * Union of all possible node types
 */
export type AnyNode =
  | LevelNode
  | WallNode
  | DoorNode
  | WindowNode
  | ColumnNode
  | RoofNode
  | RoofSegmentNode
  | ReferenceImageNode
  | ScanNode
  | GroupNode

/**
 * Union of all building element nodes (walls, doors, windows, columns, roofs)
 */
export type BuildingElementNode =
  | WallNode
  | DoorNode
  | WindowNode
  | ColumnNode
  | RoofNode
  | RoofSegmentNode

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
  | RoofSegmentNode
  | ReferenceImageNode
  | ScanNode

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
  'roof-segment': RoofSegmentNode
  'reference-image': ReferenceImageNode
  scan: ScanNode
  group: GroupNode
}

/**
 * Node type string literals
 */
export type NodeType = keyof NodeTypeMap

/**
 * Helper type to get node type from type string
 */
export type GetNodeType<T extends NodeType> = NodeTypeMap[T]

// ============================================================================
// NODE CREATION HELPERS
// ============================================================================

/**
 * Options for creating a new node
 */
export interface CreateNodeOptions<T extends BaseNode> {
  id?: string // Auto-generated if not provided
  name?: string // Auto-generated if not provided
  visible?: boolean
  opacity?: number
  locked?: boolean
  parent?: string
  metadata?: Record<string, any>
}

/**
 * Options for creating a grid item node
 */
export interface CreateGridNodeOptions<T extends BaseNode & GridItem> extends CreateNodeOptions<T> {
  position?: [number, number]
  rotation?: number
  size?: [number, number]
}
