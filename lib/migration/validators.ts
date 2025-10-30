/**
 * Migration Validators
 *
 * Functions to validate data integrity during and after migration between
 * legacy and node-based formats.
 */

import type { Component, ComponentGroup, ReferenceImage, Scan } from '../../hooks/use-editor'
import { validateNodeTree } from '../nodes/guards'
import type { BaseNode, LevelNode } from '../nodes/types'
import { countNodes, countNodesByType, traverseTree } from '../nodes/utils'

// ============================================================================
// VALIDATION RESULTS
// ============================================================================

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  stats?: {
    nodeCount?: number
    componentCount?: number
    typeBreakdown?: Record<string, number>
  }
}

// ============================================================================
// LEGACY FORMAT VALIDATION
// ============================================================================

/**
 * Validate legacy component structure
 */
export function validateLegacyFormat(
  components: Component[],
  groups: ComponentGroup[],
  images: ReferenceImage[],
  scans: Scan[],
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate groups
  if (groups.length === 0) {
    errors.push('No groups found - at least one floor/level is required')
  }

  const groupIds = new Set(groups.map((g) => g.id))

  // Validate group IDs are unique
  if (groupIds.size !== groups.length) {
    errors.push('Duplicate group IDs found')
  }

  // Validate components reference valid groups
  for (const component of components) {
    if (component.group && !groupIds.has(component.group)) {
      errors.push(`Component ${component.id} references non-existent group ${component.group}`)
    }

    // Validate component data structure
    switch (component.type) {
      case 'wall':
        if (!(component.data && 'segments' in component.data)) {
          errors.push(`Wall component ${component.id} missing segments data`)
        }
        break
      case 'roof':
        if (!(component.data && 'segments' in component.data)) {
          errors.push(`Roof component ${component.id} missing segments data`)
        }
        break
      case 'door':
      case 'window':
        if (
          !(
            component.data &&
            'position' in component.data &&
            'rotation' in component.data &&
            'width' in component.data
          )
        ) {
          errors.push(`${component.type} component ${component.id} missing required data`)
        }
        break
      case 'column':
        if (!(component.data && 'columns' in component.data)) {
          errors.push(`Column component ${component.id} missing columns data`)
        }
        break
    }
  }

  // Validate images have valid levels
  for (const image of images) {
    if (image.level === undefined) {
      warnings.push(`Image ${image.id} missing level property`)
    }
  }

  // Validate scans have valid levels
  for (const scan of scans) {
    if (scan.level === undefined) {
      warnings.push(`Scan ${scan.id} missing level property`)
    }
  }

  // Calculate stats
  const stats = {
    componentCount: components.length,
    typeBreakdown: components.reduce(
      (acc, c) => {
        acc[c.type] = (acc[c.type] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    ),
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats,
  }
}

// ============================================================================
// NODE FORMAT VALIDATION
// ============================================================================

/**
 * Validate node tree structure
 */
export function validateNodeFormat(levels: LevelNode[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (levels.length === 0) {
    errors.push('No levels found - at least one level is required')
  }

  // Validate each level
  for (const level of levels) {
    // Validate level structure
    if (!validateNodeTree(level)) {
      errors.push(`Level ${level.id} has invalid tree structure`)
    }

    // Check for level number uniqueness
    const levelNumbers = levels.map((l) => l.level)
    if (new Set(levelNumbers).size !== levelNumbers.length) {
      errors.push('Duplicate level numbers found')
    }

    // Validate children types
    traverseTree(level, (node, parent) => {
      // Validate parent references
      if (parent && node.parent !== parent.id) {
        errors.push(
          `Node ${node.id} has incorrect parent reference (expected ${parent.id}, got ${node.parent})`,
        )
      }

      // Validate visibility
      if (node.visible !== undefined && typeof node.visible !== 'boolean') {
        errors.push(`Node ${node.id} has invalid visibility value`)
      }

      // Validate opacity
      if (
        node.opacity !== undefined &&
        (typeof node.opacity !== 'number' || node.opacity < 0 || node.opacity > 100)
      ) {
        errors.push(`Node ${node.id} has invalid opacity value (must be 0-100)`)
      }

      // Validate grid items
      if ('position' in node) {
        const gridNode = node as any
        if (!Array.isArray(gridNode.position) || gridNode.position.length !== 2) {
          errors.push(`Node ${node.id} has invalid position`)
        }
        if (typeof gridNode.rotation !== 'number') {
          errors.push(`Node ${node.id} has invalid rotation`)
        }
        if (!Array.isArray(gridNode.size) || gridNode.size.length !== 2) {
          errors.push(`Node ${node.id} has invalid size`)
        }
      }

      // Validate wall nodes
      if (node.type === 'wall') {
        const wall = node as any
        for (const child of wall.children) {
          if (child.type !== 'door' && child.type !== 'window') {
            warnings.push(`Wall ${node.id} has non-door/window child: ${child.type}`)
          }
        }
      }

      // Validate roof nodes
      if (node.type === 'roof') {
        const roof = node as any
        for (const child of roof.children) {
          if (child.type !== 'roof-segment') {
            warnings.push(`Roof ${node.id} has non-segment child: ${child.type}`)
          }
        }
      }
    })
  }

  // Calculate stats
  const stats = {
    nodeCount: levels.reduce((sum, level) => sum + countNodes(level), 0),
    typeBreakdown: levels.reduce(
      (acc, level) => {
        const counts = countNodesByType(level)
        for (const [type, count] of Object.entries(counts)) {
          acc[type] = (acc[type] || 0) + count
        }
        return acc
      },
      {} as Record<string, number>,
    ),
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats,
  }
}

// ============================================================================
// MIGRATION VALIDATION
// ============================================================================

/**
 * Validate that a round-trip conversion preserves data
 */
export function validateRoundTrip(
  originalComponents: Component[],
  originalGroups: ComponentGroup[],
  originalImages: ReferenceImage[],
  originalScans: Scan[],
  convertedLevels: LevelNode[],
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Count entities in original
  const originalCounts = {
    groups: originalGroups.length,
    components: originalComponents.length,
    images: originalImages.length,
    scans: originalScans.length,
  }

  // Count entities in converted
  const convertedCounts = {
    levels: convertedLevels.length,
    nodes: convertedLevels.reduce((sum, level) => sum + countNodes(level), 0),
  }

  // Validate group/level count matches
  if (originalCounts.groups !== convertedCounts.levels) {
    errors.push(
      `Group count mismatch: ${originalCounts.groups} groups vs ${convertedCounts.levels} levels`,
    )
  }

  // Count node types
  const nodeTypeCounts = convertedLevels.reduce(
    (acc, level) => {
      const counts = countNodesByType(level)
      for (const [type, count] of Object.entries(counts)) {
        acc[type] = (acc[type] || 0) + count
      }
      return acc
    },
    {} as Record<string, number>,
  )

  // Validate wall segments converted correctly
  const wallComponentSegmentCount = originalComponents
    .filter((c) => c.type === 'wall')
    .reduce((sum, c) => {
      if (c.data && 'segments' in c.data) {
        return sum + c.data.segments.length
      }
      return sum
    }, 0)

  const wallNodeCount = nodeTypeCounts['wall'] || 0
  if (wallComponentSegmentCount !== wallNodeCount) {
    warnings.push(
      `Wall segment count changed: ${wallComponentSegmentCount} segments became ${wallNodeCount} wall nodes`,
    )
  }

  // Validate doors and windows
  const doorComponentCount = originalComponents.filter((c) => c.type === 'door').length
  const doorNodeCount = nodeTypeCounts['door'] || 0
  if (doorComponentCount !== doorNodeCount) {
    errors.push(`Door count mismatch: ${doorComponentCount} vs ${doorNodeCount}`)
  }

  const windowComponentCount = originalComponents.filter((c) => c.type === 'window').length
  const windowNodeCount = nodeTypeCounts['window'] || 0
  if (windowComponentCount !== windowNodeCount) {
    errors.push(`Window count mismatch: ${windowComponentCount} vs ${windowNodeCount}`)
  }

  // Validate images
  const imageNodeCount = nodeTypeCounts['reference-image'] || 0
  if (originalCounts.images !== imageNodeCount) {
    errors.push(`Image count mismatch: ${originalCounts.images} vs ${imageNodeCount}`)
  }

  // Validate scans
  const scanNodeCount = nodeTypeCounts['scan'] || 0
  if (originalCounts.scans !== scanNodeCount) {
    errors.push(`Scan count mismatch: ${originalCounts.scans} vs ${scanNodeCount}`)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats: {
      nodeCount: convertedCounts.nodes,
      componentCount: originalCounts.components,
      typeBreakdown: nodeTypeCounts,
    },
  }
}

// ============================================================================
// DATA INTEGRITY CHECKS
// ============================================================================

/**
 * Check for orphaned nodes (nodes without valid parent references)
 */
export function findOrphanedNodes(levels: LevelNode[]): BaseNode[] {
  const orphans: BaseNode[] = []
  const allNodeIds = new Set<string>()

  // Collect all node IDs
  for (const level of levels) {
    traverseTree(level, (node) => {
      allNodeIds.add(node.id)
    })
  }

  // Find nodes with parent references to non-existent nodes
  for (const level of levels) {
    traverseTree(level, (node) => {
      if (node.parent && !allNodeIds.has(node.parent)) {
        orphans.push(node)
      }
    })
  }

  return orphans
}

/**
 * Check for duplicate node IDs
 */
export function findDuplicateNodeIds(levels: LevelNode[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const level of levels) {
    traverseTree(level, (node) => {
      if (seen.has(node.id)) {
        duplicates.add(node.id)
      }
      seen.add(node.id)
    })
  }

  return Array.from(duplicates)
}

/**
 * Comprehensive data integrity check
 */
export function validateDataIntegrity(levels: LevelNode[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check for orphaned nodes
  const orphans = findOrphanedNodes(levels)
  if (orphans.length > 0) {
    errors.push(`Found ${orphans.length} orphaned nodes: ${orphans.map((n) => n.id).join(', ')}`)
  }

  // Check for duplicate IDs
  const duplicates = findDuplicateNodeIds(levels)
  if (duplicates.length > 0) {
    errors.push(`Found duplicate node IDs: ${duplicates.join(', ')}`)
  }

  // Validate each level
  for (const level of levels) {
    const levelValidation = validateNodeFormat([level])
    errors.push(...levelValidation.errors)
    warnings.push(...levelValidation.warnings)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
