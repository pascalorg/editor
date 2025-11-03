/**
 * Element Specification
 *
 * JSON-friendly schema for defining building elements.
 * Used by both built-in elements and remote catalog items.
 */

// ============================================================================
// SPEC TYPES
// ============================================================================

export const ELEMENT_SPEC_VERSION = '1.0'

/**
 * Strategy for computing bounding boxes
 */
export type BoundsStrategy =
  | 'orientedRectFromSize' // Use size from TransformGrid
  | 'aabbFromModelXY' // Compute AABB from 3D model (XY projection)
  | 'convexHullFromModelXY' // Compute convex hull from model (XY projection)

/**
 * Strategy for computing 2D footprints
 */
export type FootprintStrategy =
  | 'rectFromSize' // Rectangle from size
  | 'polygon' // Custom polygon (specified in spec)
  | 'hullFromModelXY' // Convex hull from 3D model (XY projection)

/**
 * Main element specification
 */
export interface ElementSpec {
  // Metadata
  schemaVersion: '1.0'
  type: string // Unique type identifier (e.g., 'core.wall', 'vendor.chair')
  label: string // Display name
  category?: string // Category for UI grouping
  version?: string // Spec version
  vendor?: string // Vendor identifier

  // Node-layer configuration
  node: {
    gridItem: boolean // Whether this element has grid positioning
    defaults?: {
      size_m?: [number, number] // Default size in meters
      rotation_rad?: number // Default rotation in radians
    }
    parentRules?: string[] // Allowed parent types
  }

  // Rendering configuration
  render?: {
    model?: {
      url: string // URL to GLB/GLTF model
      scale?: number // Scale multiplier
      upAxis?: 'Y' | 'Z' // Up axis of the model
    }
    anchor?: 'center' | 'back' | 'front' | 'left' | 'right' // Anchor point
    color?: string // Default color (CSS color)
  }

  // Bounds computation
  bounds?: {
    strategy: BoundsStrategy
  }

  // Footprint computation
  footprint?: {
    strategy: FootprintStrategy
    polygon?: Array<[number, number]> // For 'polygon' strategy (in meters, relative to origin)
  }

  // Snapping behavior
  snap?: {
    gridStep_m?: number // Grid step size in meters
    allowedAngles_rad?: number[] // Allowed rotation angles
    anchors?: Array<{
      name: string
      offset_m: [number, number, number]
    }>
    targets?: Array<'gridFloor' | 'wallMount' | 'ceilingHang' | 'stackOnto' | 'free'>
    radius_m?: number // Search radius in meters
    priority?: Array<'socket' | 'surface' | 'wallLine' | 'gridPoint'>
    masks?: number // Bitmask for filtering
  }

  // Socket definitions (attachment points)
  sockets?: Array<{
    type: 'surface.top' | 'wall.mount' | 'ceiling.hang'
    localPose: {
      position_m: [number, number, number]
      rotationY_rad?: number
    }
    capacity?: number // 0 = unlimited
    mask?: number
  }>

  // Physics configuration (stub)
  physics?: {
    shape?: 'box' | 'mesh'
    mass?: number // 0 = static
  }

  // Parameters (for catalog items with variants)
  parameters?: Array<{
    key: string
    type: 'number' | 'enum' | 'bool'
    default?: any
    mapsTo?: string // Which component property this affects
  }>
}

// ============================================================================
// SPEC VALIDATION
// ============================================================================

/**
 * Validate an element spec
 */
export function validateElementSpec(spec: any): spec is ElementSpec {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Spec must be an object')
  }

  if (spec.schemaVersion !== ELEMENT_SPEC_VERSION) {
    throw new Error(`Invalid schema version: ${spec.schemaVersion}`)
  }

  if (!spec.type || typeof spec.type !== 'string') {
    throw new Error('Spec must have a valid type string')
  }

  if (!spec.label || typeof spec.label !== 'string') {
    throw new Error('Spec must have a valid label string')
  }

  if (!spec.node || typeof spec.node !== 'object') {
    throw new Error('Spec must have a node configuration object')
  }

  if (typeof spec.node.gridItem !== 'boolean') {
    throw new Error('Spec node.gridItem must be a boolean')
  }

  // Validate defaults if present
  if (spec.node.defaults) {
    if (spec.node.defaults.size_m && !Array.isArray(spec.node.defaults.size_m)) {
      throw new Error('Spec node.defaults.size_m must be an array')
    }
    if (spec.node.defaults.rotation_rad && typeof spec.node.defaults.rotation_rad !== 'number') {
      throw new Error('Spec node.defaults.rotation_rad must be a number')
    }
  }

  // Validate parent rules if present
  if (spec.node.parentRules && !Array.isArray(spec.node.parentRules)) {
    throw new Error('Spec node.parentRules must be an array')
  }

  return true
}

// ============================================================================
// SPEC UTILITIES
// ============================================================================

/**
 * Get default size from spec (in meters)
 */
export function getDefaultSize(spec: ElementSpec): [number, number] | undefined {
  return spec.node.defaults?.size_m
}

/**
 * Get default rotation from spec (in radians)
 */
export function getDefaultRotation(spec: ElementSpec): number {
  return spec.node.defaults?.rotation_rad ?? 0
}

/**
 * Get parent rules from spec
 */
export function getParentRules(spec: ElementSpec): string[] {
  return spec.node.parentRules ?? []
}

/**
 * Check if spec allows parent type
 */
export function canBeChildOfType(spec: ElementSpec, parentType: string): boolean {
  const rules = getParentRules(spec)
  return rules.length === 0 || rules.includes(parentType)
}
