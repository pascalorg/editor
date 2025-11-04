/**
 * Building Engine - Public API
 *
 * ECS-based runtime for the building editor.
 * Derived from the canonical node tree.
 */

// Adapters
export {
  buildWorldFromNodes,
  rebuildWorld,
  removeEntityFromWorld,
  updateEntityFromNode,
} from './adapters/nodes-to-world'
export type {
  Attachment,
  Bounds,
  ElementTag,
  Footprint,
  Hierarchy,
  PhysicsBody,
  SnapBehavior,
  Socket,
  SocketDefinition,
  Surface,
  SurfaceDefinition,
  TransformGrid,
  Visibility,
} from './components'
// Components
export {
  ATTACHMENT,
  BOUNDS,
  createElement,
  createHierarchy,
  createTransformGrid,
  createVisibility,
  ELEMENT,
  FOOTPRINT,
  HIERARCHY,
  SNAP_BEHAVIOR,
  SOCKET,
  SURFACE,
  TRANSFORM_GRID,
  VISIBILITY,
} from './components'
export type { Component, ComponentStore, ComponentType, EntityId } from './core'
// Core
export { gridToMeters, metersToGrid, World } from './core'
// Element Registry (spec lookups for rendering)
export { elementRegistry, getElementSpec, registerElementSpec } from './element-registry'
export type { CreationContext, ElementDefinition } from './registry'
// Registry
export {
  getAllDefinitions,
  getAllTypes,
  getDefinition,
  register,
} from './registry'
export type { BoundsStrategy, ElementSpec, FootprintStrategy, GeometryType, SelectionStyle } from './spec'
// Spec
export {
  canBeChildOfType,
  ELEMENT_SPEC_VERSION,
  getDefaultRotation,
  getDefaultSize,
  getParentRules,
  validateElementSpec,
} from './spec'
// Spec Registry
export {
  canTypeBeChildOf,
  getAllNodeExtensions,
  registerFromSpec,
  registerNodeTypeExtension,
  registerSpecs,
} from './spec-registry'

// Strategies
export { aabbFromPoints, aabbIntersects, boundsFromStrategy, expandAABB } from './strategies/bounds'
export {
  computePolygonArea,
  footprintFromStrategy,
  pointInPolygon,
  polygonsIntersect,
} from './strategies/footprint'
// Systems
export {
  clearBounds,
  computeBoundsForEntity,
  getBounds,
  recomputeBounds,
  runBoundsSystem,
} from './systems/bounds-system'
export {
  clearFootprints,
  computeFootprintForEntity,
  getFootprint,
  recomputeFootprints,
  runFootprintSystem,
} from './systems/footprint-system'
