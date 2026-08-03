import { warehousePlugin } from '@ovurrsl/plugin-warehouse'
import { AnyNode } from '@pascal-app/core/schema'
import { treesPlugin } from '@pascal-app/plugin-trees'
import { z } from 'zod'

/**
 * Validates a SceneGraph at an untrusted API boundary. Re-runs schema
 * validation on every node, which enforces the `AssetUrl` allowlist in core
 * (closes the Phase 3 SSRF / arbitrary-URL risk on scan/guide/item/material
 * fields).
 *
 * Shared between `POST /api/scenes` and `PUT /api/scenes/[id]` so neither
 * route can silently accept malicious URLs via the `graph` payload.
 *
 * Phase 8 P4 found the POST bypass; Phase 10 A2 found the PUT bypass.
 *
 * `AnyNode` is a hand-maintained union of the HOST's kinds — by construction
 * it cannot know a plugin's, and validating a `warehouse:*` node against it
 * rejects every save containing one. Plugin kinds are therefore validated
 * against the plugin's own `def.schema`, exactly as the runtime registry
 * does; `AnyNode` remains the verdict for everything unclaimed, so an
 * unknown kind is still refused. The plugin barrels are the same modules the
 * client bootstrap imports during SSR, so they are server-safe by contract.
 */
const pluginNodeSchemas = new Map<string, z.ZodType>()
for (const plugin of [treesPlugin, warehousePlugin]) {
  for (const def of plugin.nodes ?? []) {
    pluginNodeSchemas.set(def.kind, def.schema)
  }
}

function validateNode(node: unknown): z.ZodSafeParseResult<unknown> {
  const kind = (node as { type?: unknown } | null)?.type
  const pluginSchema = typeof kind === 'string' ? pluginNodeSchemas.get(kind) : undefined
  if (pluginSchema) return pluginSchema.safeParse(node)
  return AnyNode.safeParse(node)
}

/**
 * Parses a node with its owning schema and returns the schema's output —
 * i.e. with every defaulted field materialised. The editor's `setScene`
 * stores nodes verbatim without parsing, so a hand-built node missing a
 * defaulted field (e.g. a pallet without `supportSlabId`) reaches kind
 * systems in a shape they never see from editor-created nodes, and crashes
 * them. Writers that synthesise nodes outside the editor (the legacy scene
 * migrator) run each node through this before saving.
 */
export function parseNodeWithDefaults(node: unknown): unknown {
  const result = validateNode(node)
  if (!result.success) {
    throw new Error(
      `node failed schema parse: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  }
  return result.data
}

export const apiGraphSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()),
    rootNodeIds: z.array(z.string()),
    collections: z.unknown().optional(),
    installedPlugins: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    for (const [nodeId, node] of Object.entries(value.nodes)) {
      const res = validateNode(node)
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, ...issue.path],
            message: issue.message,
          })
        }
      }
    }
  })
