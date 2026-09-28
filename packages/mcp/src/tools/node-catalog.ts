import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getNodePluginId, nodeRegistry } from '@pascal-app/core/registry'
import { AnyNode, nodeKindOf } from '@pascal-app/core/schema'
import { z } from 'zod'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, throwMcpError } from './errors'
import { doorPropertiesSchema, windowPropertiesSchema } from './opening-properties'

const nativeSchemas = new Map<string, z.ZodObject>(
  AnyNode.options.map((schema) => [nodeKindOf(schema), schema]),
)

const kindSummarySchema = z.object({
  kind: z.string(),
  label: z.string(),
  description: z.string().optional(),
  source: z.enum(['core-schema', 'node-registry']),
  pluginId: z.string().optional(),
  schemaVersion: z.number().optional(),
  mutationSupported: z.boolean(),
})

export const nodeCatalogInput = {
  kind: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Omit to list kinds; pass a returned kind for its full input schema and defaults.'),
}

export const nodeCatalogOutput = {
  kinds: z.array(kindSummarySchema),
  detail: z
    .object({
      kind: z.string(),
      jsonSchema: z.record(z.string(), z.unknown()),
      defaults: z.record(z.string(), z.unknown()),
      openingPropertiesSchema: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  note: z.string(),
}

function serializeSchema(schema: z.ZodType): Record<string, unknown> {
  return JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })))
}

export function registerNodeCatalog(server: McpServer): void {
  server.registerTool(
    'get_node_catalog',
    {
      title: 'Get node catalog',
      description:
        'Discover native and host-registered node kinds. Pass a kind to read its complete parameter schema, enums and defaults before choosing a shape or operation family. These are schema choices, not saved catalog presets. mutationSupported states whether the standalone MCP bridge accepts that kind.',
      inputSchema: nodeCatalogInput,
      outputSchema: nodeCatalogOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ kind }) => {
      const schemas = new Map(nativeSchemas)
      for (const [registeredKind, definition] of nodeRegistry.entries()) {
        schemas.set(registeredKind, definition.schema)
      }
      if (kind && !schemas.has(kind)) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Unknown node kind "${kind}". Call get_node_catalog without kind to list available kinds.`,
        )
      }
      const kinds = [...schemas.entries()]
        .filter(([name]) => !kind || name === kind)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, schema]) => {
          const definition = nodeRegistry.get(name)
          const description =
            definition?.mcp?.description ??
            definition?.presentation?.description ??
            schema.description
          const pluginId = getNodePluginId(name)
          return {
            kind: name,
            label: definition?.presentation?.label ?? name,
            ...(description ? { description } : {}),
            source: definition ? ('node-registry' as const) : ('core-schema' as const),
            ...(pluginId ? { pluginId } : {}),
            ...(definition ? { schemaVersion: definition.schemaVersion } : {}),
            mutationSupported: nativeSchemas.has(name),
          }
        })

      let detail: z.infer<z.ZodObject<typeof nodeCatalogOutput>>['detail']
      if (kind) {
        const jsonSchema = serializeSchema(schemas.get(kind)!)
        const properties = jsonSchema.properties as
          | Record<string, Record<string, unknown>>
          | undefined
        // Generated identity is not a reusable schema default.
        if (properties?.id) delete properties.id.default
        const defaults = Object.fromEntries(
          Object.entries(properties ?? {})
            .filter(([, field]) => 'default' in field)
            .map(([key, field]) => [key, field.default]),
        )
        const openingSchema =
          kind === 'door'
            ? doorPropertiesSchema
            : kind === 'window'
              ? windowPropertiesSchema
              : undefined
        detail = {
          kind,
          jsonSchema,
          defaults,
          ...(openingSchema ? { openingPropertiesSchema: serializeSchema(openingSchema) } : {}),
        }
      }
      const payload = {
        kinds,
        ...(detail ? { detail } : {}),
        note: 'Prefer semantic placement tools. For add_door/add_window, pass design choices in properties and placement/size in the top-level arguments. Native kinds also support apply_patch. Registered plugin kinds with mutationSupported=false require their host placement path; discovery does not install plugins or add mutation support. Saved catalog presets are separate from these schemas. Runtime schema validation remains authoritative.',
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
