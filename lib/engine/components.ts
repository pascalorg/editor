/**
 * ECS Component Definitions
 *
 * Standard components used across the building editor.
 */

import type { Component } from './core'

// ============================================================================
// COMPONENT TYPE CONSTANTS
// ============================================================================

export const TRANSFORM_GRID = 'TransformGrid'
export const VISIBILITY = 'Visibility'
export const ELEMENT = 'Element'
export const BOUNDS = 'Bounds'
export const FOOTPRINT = 'Footprint'
export const SURFACE = 'Surface'
export const SOCKET = 'Socket'
export const SNAP_BEHAVIOR = 'SnapBehavior'
export const ATTACHMENT = 'Attachment'
export const HIERARCHY = 'Hierarchy'

// ============================================================================
// CORE COMPONENTS
// ============================================================================

/**
 * Grid-based transform (position, rotation, size in grid units)
 */
export interface TransformGrid extends Component {
  position: [number, number] // Grid coordinates
  rotation: number // Radians
  size: [number, number] // Width, depth in grid units
}

/**
 * Visibility and opacity
 */
export interface Visibility extends Component {
  visible: boolean
  opacity: number // 0-100
  locked?: boolean
}

/**
 * Element metadata and type information
 */
export interface ElementTag extends Component {
  kind: string // Element type (e.g., 'core.wall', 'core.door', 'catalog.chair')
  name: string
  metadata?: {
    spec?: any // Reference to ElementSpec for catalog items
    [key: string]: any
  }
}

/**
 * Hierarchy information (parent/children relationships)
 */
export interface Hierarchy extends Component {
  parent?: string // Parent entity ID
  children: string[] // Child entity IDs
  level?: number // Floor level (for level entities)
}

// ============================================================================
// GEOMETRIC COMPONENTS
// ============================================================================

/**
 * 3D Bounding box (axis-aligned or oriented)
 */
export interface Bounds extends Component {
  // Axis-aligned bounding box (AABB) in world coordinates
  aabb: {
    min: [number, number, number]
    max: [number, number, number]
  }
  // Oriented bounding box (OBB) for rotated elements
  obb?: {
    center: [number, number, number]
    halfExtents: [number, number, number]
    rotation: number // Radians (Y-axis rotation)
  }
}

/**
 * 2D Footprint (ground plane projection)
 */
export interface Footprint extends Component {
  // Polygon vertices in world coordinates (clockwise or counter-clockwise)
  polygon: Array<[number, number]>
  // Area in square meters
  area?: number
}

/**
 * Surface definitions (for snapping)
 */
export interface Surface extends Component {
  surfaces: SurfaceDefinition[]
}

export interface SurfaceDefinition {
  type: 'floorTop' | 'ceilingBottom' | 'wallFace' | 'roofFace'
  // Surface pose in world coordinates
  position: [number, number, number]
  normal: [number, number, number] // Unit vector
  // Bitmask for filtering
  mask?: number
  // Optional polygon boundary
  boundary?: Array<[number, number, number]>
}

/**
 * Socket (attachment point for other elements)
 */
export interface Socket extends Component {
  sockets: SocketDefinition[]
}

export interface SocketDefinition {
  type: 'surface.top' | 'wall.mount' | 'ceiling.hang'
  // Socket pose in world coordinates
  position: [number, number, number]
  rotationY?: number // Radians
  // Capacity (how many items can attach, 0 = unlimited)
  capacity?: number
  // Current occupancy
  occupancy?: number
  // Bitmask for filtering
  mask?: number
}

// ============================================================================
// SNAPPING COMPONENTS
// ============================================================================

/**
 * Snapping behavior configuration
 */
export interface SnapBehavior extends Component {
  // Grid step size in grid units
  gridStep: number
  // Allowed rotation angles in radians
  allowedAngles: number[]
  // Search radius for snap targets (grid units)
  radius: number
  // Priority order for snap target evaluation
  priority: Array<'socket' | 'surface' | 'wallLine' | 'gridPoint'>
  // Custom snapping data from spec
  custom?: {
    anchors?: Array<{ name: string; offset_m: [number, number, number] }>
    targets?: Array<'gridFloor' | 'wallMount' | 'ceilingHang' | 'stackOnto' | 'free'>
    masks?: number
  }
}

/**
 * Computed attachment state (result of snap evaluation)
 */
export interface Attachment extends Component {
  // The target entity being snapped to (if any)
  targetEntity?: string
  // Target type
  targetType?: 'socket' | 'surface' | 'wallLine' | 'gridPoint'
  // Computed pose
  pose: {
    position: [number, number, number]
    rotationY: number
  }
  // Snap score (higher is better)
  score?: number
}

// ============================================================================
// PHYSICS COMPONENTS (STUB FOR FUTURE)
// ============================================================================

/**
 * Physics body configuration (stub for future physics integration)
 */
export interface PhysicsBody extends Component {
  shape: 'box' | 'mesh' | 'plane'
  mass: number // 0 = static
  velocity?: [number, number, number]
  angularVelocity?: [number, number, number]
}

// ============================================================================
// COMPONENT UTILITIES
// ============================================================================

/**
 * Create a TransformGrid component from node data
 */
export function createTransformGrid(
  position: [number, number],
  rotation: number,
  size: [number, number],
): TransformGrid {
  return { position, rotation, size }
}

/**
 * Create a Visibility component
 */
export function createVisibility(visible = true, opacity = 100, locked = false): Visibility {
  return { visible, opacity, locked }
}

/**
 * Create an ElementTag component
 */
export function createElement(
  kind: string,
  name: string,
  metadata?: ElementTag['metadata'],
): ElementTag {
  return { kind, name, metadata }
}

/**
 * Create a Hierarchy component
 */
export function createHierarchy(
  parent?: string,
  children: string[] = [],
  level?: number,
): Hierarchy {
  return { parent, children, level }
}
