/**
 * Node Type Extensions Registry
 *
 * Registry for dynamic node types that aren't defined in the core types.
 * Allows catalog items and custom elements to define parent/child rules.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extension definition for a dynamic node type
 */
export interface NodeTypeExtension {
  /** Check if this type can be a child of the given parent type */
  canBeChildOf: (parentType: string) => boolean

  /** Optional display name */
  label?: string

  /** Optional category */
  category?: string
}

// ============================================================================
// REGISTRY
// ============================================================================

class NodeExtensionsRegistry {
  private readonly extensions = new Map<string, NodeTypeExtension>()

  /**
   * Register an extension for a node type
   */
  register(type: string, extension: NodeTypeExtension): void {
    if (this.extensions.has(type)) {
      console.warn(`Node type extension "${type}" is already registered. Overwriting.`)
    }
    this.extensions.set(type, extension)
  }

  /**
   * Get an extension by type
   */
  get(type: string): NodeTypeExtension | undefined {
    return this.extensions.get(type)
  }

  /**
   * Check if a type has an extension
   */
  has(type: string): boolean {
    return this.extensions.has(type)
  }

  /**
   * Check if a child type can be a child of a parent type
   */
  canTypeBeChildOf(childType: string, parentType: string): boolean {
    const extension = this.extensions.get(childType)
    return extension?.canBeChildOf(parentType) ?? false
  }

  /**
   * Get all registered types
   */
  getAllTypes(): string[] {
    return Array.from(this.extensions.keys())
  }

  /**
   * Get all extensions
   */
  getAllExtensions(): Map<string, NodeTypeExtension> {
    return new Map(this.extensions)
  }

  /**
   * Clear all extensions
   */
  clear(): void {
    this.extensions.clear()
  }

  /**
   * Unregister a type extension
   */
  unregister(type: string): boolean {
    return this.extensions.delete(type)
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/** Global node extensions registry */
export const nodeExtensionsRegistry = new NodeExtensionsRegistry()

/**
 * Register a node type extension (convenience function)
 */
export function registerNodeTypeExtension(type: string, extension: NodeTypeExtension): void {
  nodeExtensionsRegistry.register(type, extension)
}

/**
 * Check if a type can be a child of a parent type (convenience function)
 */
export function canTypeBeChildOf(childType: string, parentType: string): boolean {
  return nodeExtensionsRegistry.canTypeBeChildOf(childType, parentType)
}

/**
 * Get all registered node type extensions
 */
export function getAllNodeExtensions(): Map<string, NodeTypeExtension> {
  return nodeExtensionsRegistry.getAllExtensions()
}

/**
 * Check if a type has an extension registered
 */
export function hasTypeExtension(type: string): boolean {
  return nodeExtensionsRegistry.has(type)
}
