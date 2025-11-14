import type React from 'react'
import { z } from 'zod'
import { getNodeSchema } from './schema'
import type { BaseNode } from './types'

// ============================================================================
// COMPONENT CONFIG SCHEMA & TYPES
// ============================================================================

/**
 * Schema for component configuration
 * Uses Zod for runtime validation and type inference
 */
export const ComponentConfigSchema = z.object({
  // Node type identifier (must match node.type in the node tree)
  nodeType: z.string(),

  // Human-readable name for the component
  nodeName: z.string(),

  // Editor mode where this component is active
  editorMode: z.enum(['select', 'delete', 'building', 'guide']),

  // Tool name (for building mode)
  toolName: z.string().optional(),

  // Tool icon component (React component type)
  toolIcon: z.any().optional(),

  // Zod schema for the node itself (from lib/nodes/schema.ts)
  // This is the full node schema used for validation and type inference
  nodeSchema: z.instanceof(z.ZodType).optional(),

  // Zod schema for renderer component props (not the full node)
  // This validates the props passed to the 3D renderer component
  rendererPropsSchema: z.instanceof(z.ZodType).optional(),

  // Editor logic that maps user actions to scene graph node operations
  // This is the builder logic (add/update/delete nodes) - not a visual component
  nodeEditor: z.any().optional(), // React.FC - uses useEditor hooks to manage nodes

  // Renderer component (renders the 3D representation of the node)
  nodeRenderer: z.any(), // React.FC<{ node: BaseNode }>
})

export type ComponentConfig = z.infer<typeof ComponentConfigSchema>

// ============================================================================
// REGISTRY ENTRY
// ============================================================================

export interface RegistryEntry {
  config: ComponentConfig
}

// ============================================================================
// COMPONENT REGISTRY
// ============================================================================

/**
 * Global registry mapping node types to their configurations
 */
class ComponentRegistry {
  private readonly registry = new Map<string, RegistryEntry>()

  /**
   * Register a new component type
   */
  register(config: ComponentConfig): void {
    // Validate config with Zod
    const validatedConfig = ComponentConfigSchema.parse(config)

    if (this.registry.has(validatedConfig.nodeType)) {
      console.warn(
        `[Registry] Overwriting existing registration for type: ${validatedConfig.nodeType}`,
      )
    }

    this.registry.set(validatedConfig.nodeType, {
      config: validatedConfig,
    })

    console.log(`[Registry] Registered component: ${validatedConfig.nodeType}`)
  }

  /**
   * Get configuration for a node type
   */
  get(nodeType: string): RegistryEntry | undefined {
    return this.registry.get(nodeType)
  }

  /**
   * Check if a node type is registered
   */
  has(nodeType: string): boolean {
    return this.registry.has(nodeType)
  }

  /**
   * Get all registered node types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.registry.keys())
  }

  /**
   * Get all registry entries
   */
  getAll(): Map<string, RegistryEntry> {
    return new Map(this.registry)
  }

  /**
   * Get components by editor mode
   */
  getByMode(mode: 'select' | 'delete' | 'building' | 'guide'): RegistryEntry[] {
    return Array.from(this.registry.values()).filter((entry) => entry.config.editorMode === mode)
  }

  /**
   * Get component by tool name (for building mode)
   */
  getByTool(toolName: string): RegistryEntry | undefined {
    return Array.from(this.registry.values()).find(
      (entry) => entry.config.toolName === toolName && entry.config.editorMode === 'building',
    )
  }

  /**
   * Get node schema for a node type (from registry or fallback to lib/nodes/schema)
   */
  getNodeSchema(nodeType: string): z.ZodType | null {
    const entry = this.registry.get(nodeType)
    // Return schema from registry if available
    if (entry?.config.nodeSchema) {
      return entry.config.nodeSchema
    }
    // Fallback to default schema from lib/nodes/schema
    return getNodeSchema(nodeType)
  }

  /**
   * Validate node data against registered schema
   */
  validateNode(nodeType: string, data: unknown): boolean {
    const schema = this.getNodeSchema(nodeType)
    if (!schema) return false

    const result = schema.safeParse(data)
    return result.success
  }

  /**
   * Parse node data with registered schema
   */
  parseNode(nodeType: string, data: unknown): unknown {
    const schema = this.getNodeSchema(nodeType)
    if (!schema) {
      throw new Error(`No schema found for node type: ${nodeType}`)
    }

    return schema.parse(data)
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.registry.clear()
  }
}

// Export singleton instance
export const componentRegistry = new ComponentRegistry()

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper function to register a component
 * This is the main API for component authors
 */
export function registerComponent(config: ComponentConfig): void {
  componentRegistry.register(config)
}

/**
 * Get renderer component for a node type
 */
export function getRenderer(nodeType: string): React.FC<{ node: BaseNode }> | undefined {
  const entry = componentRegistry.get(nodeType)
  return entry?.config.nodeRenderer
}

/**
 * Get node editor (builder logic) for a tool name
 */
export function getNodeEditor(toolName: string): React.FC | undefined {
  const entry = componentRegistry.getByTool(toolName)
  return entry?.config.nodeEditor
}

/**
 * Get all building tools (for building menu)
 */
export function getBuildingTools(): Array<{
  nodeType: string
  toolName: string
  nodeName: string
  toolIcon?: React.ComponentType
}> {
  const buildingComponents = componentRegistry.getByMode('building')
  return buildingComponents
    .filter((entry) => entry.config.toolName)
    .map((entry) => ({
      nodeType: entry.config.nodeType,
      toolName: entry.config.toolName!,
      nodeName: entry.config.nodeName,
      toolIcon: entry.config.toolIcon,
    }))
}

/**
 * Validate renderer props against registered schema
 */
export function validateRendererProps(nodeType: string, props: unknown): boolean {
  const entry = componentRegistry.get(nodeType)
  if (!entry?.config.rendererPropsSchema) return true // No schema = always valid

  try {
    entry.config.rendererPropsSchema.parse(props)
    return true
  } catch (error) {
    console.error(`[Registry] Validation failed for ${nodeType}:`, error)
    return false
  }
}
