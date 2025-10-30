/**
 * Migration Library
 *
 * Public API for migrating between legacy and node-based formats.
 */

// Re-export conversion functions
export {
  componentsToNodeTree,
  wallSegmentToWallNode,
  associateDoorsAndWindowsWithWalls,
} from './legacy-to-nodes'

export {
  nodeTreeToComponents,
  nodeTreeToComponentsWithLevels,
  wallNodeToWallSegment,
} from './nodes-to-legacy'

// Re-export validators
export type { ValidationResult } from './validators'

export {
  findDuplicateNodeIds,
  findOrphanedNodes,
  validateDataIntegrity,
  validateLegacyFormat,
  validateNodeFormat,
  validateRoundTrip,
} from './validators'
