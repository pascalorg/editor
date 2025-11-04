/**
 * Element Registry
 * 
 * Central registry for looking up element specifications by type.
 * Specs are registered at app startup via initializeEngine().
 */

import type { ElementSpec } from './spec'

/**
 * Registry class for managing element specifications
 */
class ElementRegistry {
  private specs = new Map<string, ElementSpec>()

  /**
   * Register an element spec
   */
  register(spec: ElementSpec): void {
    if (this.specs.has(spec.type)) {
      console.warn(`[ElementRegistry] Overwriting existing spec for type: ${spec.type}`)
    }
    this.specs.set(spec.type, spec)
  }

  /**
   * Get a spec by type
   */
  getSpec(type: string): ElementSpec | undefined {
    return this.specs.get(type)
  }

  /**
   * Check if a spec exists
   */
  hasSpec(type: string): boolean {
    return this.specs.has(type)
  }

  /**
   * Get all registered specs
   */
  getAllSpecs(): ElementSpec[] {
    return Array.from(this.specs.values())
  }

  /**
   * Get specs by category
   */
  getSpecsByCategory(category: string): ElementSpec[] {
    return this.getAllSpecs().filter(spec => spec.category === category)
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    const categories = new Set<string>()
    for (const spec of this.specs.values()) {
      if (spec.category) {
        categories.add(spec.category)
      }
    }
    return Array.from(categories)
  }

  /**
   * Clear all specs (for testing)
   */
  clear(): void {
    this.specs.clear()
  }

  /**
   * Get registry stats
   */
  getStats() {
    return {
      totalSpecs: this.specs.size,
      categories: this.getCategories().length,
      types: Array.from(this.specs.keys()),
    }
  }
}

/**
 * Global element registry instance
 */
export const elementRegistry = new ElementRegistry()

/**
 * Register a spec (convenience function)
 */
export function registerElementSpec(spec: ElementSpec): void {
  elementRegistry.register(spec)
}

/**
 * Get a spec by type (convenience function)
 */
export function getElementSpec(type: string): ElementSpec | undefined {
  return elementRegistry.getSpec(type)
}

