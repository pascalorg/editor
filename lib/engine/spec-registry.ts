/**
 * Spec Registry
 *
 * Registers element specs and converts them to element definitions.
 * This is the primary way to add new element types to the engine.
 */

import {
  BOUNDS,
  createElement,
  createHierarchy,
  createTransformGrid,
  createVisibility,
  ELEMENT,
  FOOTPRINT,
  HIERARCHY,
  SNAP_BEHAVIOR,
  TRANSFORM_GRID,
  VISIBILITY,
} from './components'
import { metersToGrid } from './core'
import { elementRegistry } from './element-registry'
import type { CreationContext, ElementDefinition } from './registry'
import { register } from './registry'
import type { ElementSpec } from './spec'
import { getDefaultRotation, getDefaultSize, getParentRules, validateElementSpec } from './spec'
import { boundsFromStrategy } from './strategies/bounds'
import { footprintFromStrategy } from './strategies/footprint'

// ============================================================================
// SPEC REGISTRATION
// ============================================================================

/**
 * Register an element from a spec
 */
export function registerFromSpec(spec: ElementSpec): void {
  // Validate the spec
  validateElementSpec(spec)

  // Create element definition
  const definition: ElementDefinition = {
    type: spec.type,

    create: (node, ctx) => {
      // Get defaults from spec
      const defaultSize_m = getDefaultSize(spec)
      const defaultRotation = getDefaultRotation(spec)

      // Convert node data to components
      const components: Record<string, any> = {}

      // TransformGrid (if it's a grid item)
      if (spec.node.gridItem && 'position' in node && 'rotation' in node && 'size' in node) {
        const size =
          node.size ??
          (defaultSize_m
            ? (metersToGrid(defaultSize_m, ctx.gridSizeMeters) as [number, number])
            : [1, 1])
        const rotation = typeof node.rotation === 'number' ? node.rotation : defaultRotation

        components[TRANSFORM_GRID] = createTransformGrid(
          node.position as [number, number],
          rotation,
          size as [number, number],
        )
      }

      // Visibility
      components[VISIBILITY] = createVisibility(
        node.visible ?? true,
        node.opacity ?? 100,
        node.locked ?? false,
      )

      // Element tag
      components[ELEMENT] = createElement(spec.type, node.name, {
        spec,
        ...node.metadata,
      })

      // Hierarchy
      components[HIERARCHY] = createHierarchy(
        node.parent,
        node.children.map((child) => child.id),
        'level' in node ? (node as any).level : undefined,
      )

      // SnapBehavior (if snapping is configured)
      if (spec.snap) {
        const gridStep_m = spec.snap.gridStep_m ?? 0.5
        const radius_m = spec.snap.radius_m ?? 1.0

        components[SNAP_BEHAVIOR] = {
          gridStep: metersToGrid(gridStep_m, ctx.gridSizeMeters) as number,
          allowedAngles: spec.snap.allowedAngles_rad ?? [0, Math.PI / 4, Math.PI / 2],
          radius: metersToGrid(radius_m, ctx.gridSizeMeters) as number,
          priority: spec.snap.priority ?? ['socket', 'surface', 'wallLine', 'gridPoint'],
          custom: {
            anchors: spec.snap.anchors,
            targets: spec.snap.targets,
            masks: spec.snap.masks,
          },
        }
      }

      return components
    },

    computeBounds: spec.bounds
      ? (id, world) => boundsFromStrategy(spec.bounds!.strategy, id, world, spec)
      : undefined,

    computeFootprint: spec.footprint
      ? (id, world) => footprintFromStrategy(spec.footprint!.strategy, id, world, spec)
      : undefined,
  }

  // Register the definition with the engine
  register(definition)

  // Register the spec in the element registry for rendering
  elementRegistry.register(spec)

  // Register node extensions if parent rules are specified
  if (spec.node.parentRules && spec.node.parentRules.length > 0) {
    registerNodeTypeExtension(spec.type, {
      canBeChildOf: (parentType) => getParentRules(spec).includes(parentType),
    })
  }
}

/**
 * Register multiple specs at once
 */
export function registerSpecs(specs: ElementSpec[]): void {
  for (const spec of specs) {
    registerFromSpec(spec)
  }
}

// ============================================================================
// NODE EXTENSIONS (temporary - will be moved to separate file)
// ============================================================================

interface NodeTypeExtension {
  canBeChildOf: (parentType: string) => boolean
}

const nodeExtensions = new Map<string, NodeTypeExtension>()

/**
 * Register node type extension for dynamic types
 */
export function registerNodeTypeExtension(type: string, extension: NodeTypeExtension): void {
  nodeExtensions.set(type, extension)
}

/**
 * Check if a dynamic type can be a child of a parent type
 */
export function canTypeBeChildOf(childType: string, parentType: string): boolean {
  const extension = nodeExtensions.get(childType)
  return extension?.canBeChildOf(parentType) ?? false
}

/**
 * Get all registered node type extensions
 */
export function getAllNodeExtensions(): Map<string, NodeTypeExtension> {
  return nodeExtensions
}
