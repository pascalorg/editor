/**
 * Element Definition Registry
 *
 * Central registry for element type definitions.
 * Defines how to create entities from nodes and compute their properties.
 */

import type { BaseNode } from '../nodes/types'
import type { Component, EntityId, World } from './core'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context provided during entity creation
 */
export interface CreationContext {
  world: World
  gridSizeMeters: number
  node: BaseNode
}

/**
 * Element definition - describes how to handle an element type
 */
export interface ElementDefinition {
  /** Element type identifier */
  type: string

  /** Create components for this element from a node */
  create: (node: BaseNode, ctx: CreationContext) => Record<string, Component>

  /** Optional: Compute bounds for this element */
  computeBounds?: (entityId: EntityId, world: World) => Component | null

  /** Optional: Compute footprint for this element */
  computeFootprint?: (entityId: EntityId, world: World) => Component | null

  /** Optional: Compute surfaces for this element */
  computeSurfaces?: (entityId: EntityId, world: World) => Component | null

  /** Optional: Custom update logic */
  onUpdate?: (entityId: EntityId, world: World) => void
}

// ============================================================================
// REGISTRY
// ============================================================================

class ElementRegistry {
  private definitions = new Map<string, ElementDefinition>()

  /**
   * Register an element definition
   */
  register(definition: ElementDefinition): void {
    if (this.definitions.has(definition.type)) {
      console.warn(`Element type "${definition.type}" is already registered. Overwriting.`)
    }
    this.definitions.set(definition.type, definition)
  }

  /**
   * Get an element definition by type
   */
  get(type: string): ElementDefinition | undefined {
    return this.definitions.get(type)
  }

  /**
   * Check if a type is registered
   */
  has(type: string): boolean {
    return this.definitions.has(type)
  }

  /**
   * Get all registered types
   */
  getAllTypes(): string[] {
    return Array.from(this.definitions.keys())
  }

  /**
   * Get all definitions
   */
  getAllDefinitions(): ElementDefinition[] {
    return Array.from(this.definitions.values())
  }

  /**
   * Clear all definitions
   */
  clear(): void {
    this.definitions.clear()
  }

  /**
   * Unregister a type
   */
  unregister(type: string): boolean {
    return this.definitions.delete(type)
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/** Global element registry */
export const elementRegistry = new ElementRegistry()

/**
 * Register an element definition (convenience function)
 */
export function register(definition: ElementDefinition): void {
  elementRegistry.register(definition)
}

/**
 * Get an element definition (convenience function)
 */
export function getDefinition(type: string): ElementDefinition | undefined {
  return elementRegistry.get(type)
}

/**
 * Get all registered element types
 */
export function getAllTypes(): string[] {
  return elementRegistry.getAllTypes()
}

/**
 * Get all element definitions
 */
export function getAllDefinitions(): ElementDefinition[] {
  return elementRegistry.getAllDefinitions()
}
