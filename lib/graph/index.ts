/**
 * Node Library - Main Exports
 *
 * This file provides a centralized export point for the node library.
 * Specific node types are defined in their respective component files.
 */

// ============================================================================
// BASE TYPES & SCHEMAS
// ============================================================================

// Export base types
export type {
  BaseNode,
  CreateGridNodeOptions,
  CreateNodeOptions,
  GridItem,
  GridPoint,
  NodeIndexes,
  SceneGraph,
} from './types'

// Export base schemas and helpers
export {
  BaseNodeSchema,
  BaseNodeSchemaCore,
  createNodeSchema,
  GridItemSchema,
  GridPointSchema,
  getNodeSchema,
  isValidNode,
  isValidSceneGraph,
  nodeSchemaRegistry,
  parseNode,
  parseSceneGraph,
  registerNodeSchema,
  SceneGraphSchema,
  safeParseNode,
  safeParseSceneGraph,
} from './types'

// ============================================================================
// GUARDS
// ============================================================================

export {
  assertNode,
  assertNodeType,
  canBeChildOf,
  getTypedNode,
  isGridNode,
  isNode,
  validateGridItem,
  validateNode,
  validateNodeTree,
} from './guards'

// ============================================================================
// GENERIC OPERATIONS
// ============================================================================

export {
  addLevel,
  getLevel,
  getLevelByNumber,
  removeLevel,
  replaceWallsInLevel,
  setNodeOpacity,
  setNodeVisibility,
  updateLevel,
} from './operations'

// ============================================================================
// UTILITIES
// ============================================================================

export {
  addNode,
  findNodeById,
  findNodesByType,
  findParentNode,
  getNodePath,
  mapTree,
  moveNode,
  removeNode,
  traverseTree,
  traverseTreeBreadthFirst,
  updateNode,
} from './utils'

// ============================================================================
// INDEXES
// ============================================================================

export {
  buildNodeIndex,
  buildNodeIndexes,
  getChildrenOfNode,
  getNodeById,
  getNodesByType,
  getNodesInLevel,
} from './indexes'

// ============================================================================
// BOUNDS
// ============================================================================

export { calculateLevelBounds } from './bounds'

// ============================================================================
// REGISTRY
// ============================================================================

export {
  type ComponentConfig,
  componentRegistry,
  getBuildingTools,
  getNodeEditor,
  getRenderer,
  type RegistryEntry,
  registerComponent,
  validateRendererProps,
} from './registry'
