import { z } from 'zod'

/**
 * Grid positioning mixin schema
 * Nodes that exist on the grid should merge this schema
 */
export const gridItemSchema = z.object({
  position: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  size: z.tuple([z.number(), z.number()]),
  canPlace: z.boolean().optional(),
})

/**
 * Grid point schema
 */
export const gridPointSchema = z.object({
  x: z.number(),
  z: z.number(),
})

// ============================================================================
// TYPE INFERENCE (Base types only)
// ============================================================================

export type BaseNode = z.infer<typeof BaseNode>
export type GridItem = z.infer<typeof GridItemSchema>
export type GridPoint = z.infer<typeof GridPointSchema>

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

/**
 * Global registry for node schemas
 * Components register their schemas here during initialization
 */
class NodeSchemaRegistry {
  private readonly schemas = new Map<string, z.ZodType<any>>()

  /**
   * Register a schema for a node type
   */
  register(nodeType: string, schema: z.ZodType<any>): void {
    if (this.schemas.has(nodeType)) {
      console.warn(`[NodeSchemaRegistry] Overwriting schema for type: ${nodeType}`)
    }
    this.schemas.set(nodeType, schema)
  }

  /**
   * Get schema for a node type
   */
  get(nodeType: string): z.ZodType<any> | null {
    return this.schemas.get(nodeType) || null
  }

  /**
   * Check if a node type has a registered schema
   */
  has(nodeType: string): boolean {
    return this.schemas.has(nodeType)
  }

  /**
   * Get all registered node types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.schemas.keys())
  }

  /**
   * Parse node data with registered schema
   */
  parse(nodeType: string, data: unknown): any {
    const schema = this.get(nodeType)
    if (!schema) {
      throw new Error(`No schema registered for node type: ${nodeType}`)
    }
    return schema.parse(data)
  }

  /**
   * Safely parse node data
   */
  safeParse(nodeType: string, data: unknown): any | null {
    const schema = this.get(nodeType)
    if (!schema) return null

    const result = schema.safeParse(data)
    return result.success ? result.data : null
  }

  /**
   * Validate node data
   */
  validate(nodeType: string, data: unknown): boolean {
    const schema = this.get(nodeType)
    if (!schema) return false

    return schema.safeParse(data).success
  }

  /**
   * Create a union schema of all registered node types
   * This is computed dynamically based on registered schemas
   */
  createUnionSchema(): z.ZodType<any> {
    const schemas = Array.from(this.schemas.values())
    if (schemas.length === 0) {
      return BaseNodeSchema
    }
    if (schemas.length === 1) {
      return schemas[0]
    }
    return z.union([schemas[0], schemas[1], ...schemas.slice(2)])
  }

  /**
   * Clear all registered schemas (useful for testing)
   */
  clear(): void {
    this.schemas.clear()
  }
}

// Export singleton instance
export const nodeSchemaRegistry = new NodeSchemaRegistry()

// ============================================================================
// GENERIC VALIDATION HELPERS
// ============================================================================

/**
 * Parse and validate a node using registered schemas
 */
export function parseNode(data: unknown): BaseNode {
  // Try to infer type from data
  if (typeof data === 'object' && data !== null && 'type' in data) {
    const nodeType = (data as any).type
    if (typeof nodeType === 'string' && nodeSchemaRegistry.has(nodeType)) {
      return nodeSchemaRegistry.parse(nodeType, data)
    }
  }

  // Fallback to base schema
  return BaseNodeSchema.parse(data)
}

/**
 * Safely parse a node (returns null on error)
 */
export function safeParseNode(data: unknown): BaseNode | null {
  try {
    return parseNode(data)
  } catch {
    return null
  }
}

/**
 * Validate that a value is a valid node
 */
export function isValidNode(data: unknown): data is BaseNode {
  return safeParseNode(data) !== null
}

/**
 * Get schema for a specific node type from registry
 */
export function getNodeSchema(type: string): z.ZodType<any> | null {
  return nodeSchemaRegistry.get(type)
}

/**
 * Register a node schema
 */
export function registerNodeSchema(nodeType: string, schema: z.ZodType<any>): void {
  nodeSchemaRegistry.register(nodeType, schema)
}

// ============================================================================
// SCENE GRAPH SCHEMA
// ============================================================================

/**
 * Scene graph schema - the root structure for persisting the entire scene
 * Uses dynamic union of registered node schemas for levels
 */
export const SceneGraphSchema = z.object({
  version: z.string().default('2.0'),
  grid: z.object({
    size: z.number().default(61),
  }),
  levels: z.array(
    z.lazy(() => {
      // Dynamically get level schema from registry
      const levelSchema = nodeSchemaRegistry.get('level')
      return levelSchema || BaseNodeSchema
    }),
  ),
})

export type SceneGraph = z.infer<typeof SceneGraphSchema>

/**
 * Parse and validate a scene graph
 */
export function parseSceneGraph(data: unknown): SceneGraph {
  return SceneGraphSchema.parse(data)
}

/**
 * Safely parse a scene graph (returns null on error)
 */
export function safeParseSceneGraph(data: unknown): SceneGraph | null {
  const result = SceneGraphSchema.safeParse(data)
  return result.success ? result.data : null
}

/**
 * Validate that a value is a valid scene graph
 */
export function isValidSceneGraph(data: unknown): data is SceneGraph {
  return SceneGraphSchema.safeParse(data).success
}

// ============================================================================
// HELPER TO CREATE NODE SCHEMAS
// ============================================================================

/**
 * Helper to create a node schema that extends BaseNodeSchema
 * This ensures all node schemas have the base properties
 */
export function createNodeSchema<T extends z.ZodRawShape>(
  nodeType: string,
  extensions: T,
  options?: {
    /**
     * Schema for children (default: empty array)
     */
    childrenSchema?: z.ZodType<any>
    /**
     * Whether this node can have grid positioning
     */
    withGrid?: boolean
  },
): z.ZodObject<any> {
  let schema = baseNodeSchema.extend({
    type: z.literal(nodeType),
    ...extensions,
  })

  // Add grid positioning if requested
  if (options?.withGrid) {
    schema = schema.merge(GridItemSchema) as any
  }

  // Add children schema
  const childrenSchema = options?.childrenSchema || z.array(z.never()).default([])
  schema = schema.extend({
    children: childrenSchema,
  }) as any

  return schema
}
