/**
 * Node-based Architecture Type Definitions
 *
 * This file contains BASE types that all nodes inherit from.
 * Specific node types are defined in their respective component files.
 */

// Re-export NodeIndexes from indexes for convenience
export type { NodeIndexes } from './indexes'
// Re-export base types and schemas
export type { BaseNode, GridItem, GridPoint, SceneGraph } from './schema'
export {
  BaseNodeSchema,
  baseNodeSchema as BaseNodeSchemaCore,
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
} from './schema'

// ============================================================================
// UTILITY TYPES (kept for backward compatibility)
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

// Re-export BaseNode for use throughout the codebase
import type { BaseNode, GridItem } from './schema'
