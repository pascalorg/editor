import { AnyNode, BaseNode } from '@pascal-app/core/schema'
import { z } from 'zod'

/**
 * Validates a SceneGraph at an untrusted API boundary. Re-runs
 * `AnyNode.safeParse` on every node, which enforces the `AssetUrl`
 * allowlist in core (closes the Phase 3 SSRF / arbitrary-URL risk on
 * scan/guide/item/material fields).
 *
 * Plugin node kinds (namespaced `type`, e.g. `trees:tree`) are not part of
 * the static `AnyNode` union and their full schemas live in packages that
 * pull in renderer/UI code, which an API route must not import. They are
 * validated against the `BaseNode` envelope plus a deep scan that rejects
 * dangerous URL schemes anywhere in the node, preserving the same SSRF /
 * script-URL posture without knowing which plugin fields hold URLs.
 *
 * Shared between `POST /api/scenes` and `PUT /api/scenes/[id]` so neither
 * route can silently accept malicious URLs via the `graph` payload.
 *
 * Phase 8 P4 found the POST bypass; Phase 10 A2 found the PUT bypass.
 */

const PLUGIN_KIND = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/

const PluginNodeEnvelope = BaseNode.extend({
  type: z.string().regex(PLUGIN_KIND),
  children: z.array(z.string()).optional(),
}).passthrough()

const DANGEROUS_STRING = /^\s*(?:javascript|vbscript|file|ftp):|^\s*data:(?!image\/)/i

function findDangerousString(
  value: unknown,
  path: (string | number)[],
): (string | number)[] | null {
  if (typeof value === 'string') {
    return DANGEROUS_STRING.test(value) ? path : null
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findDangerousString(value[i], [...path, i])
      if (hit) return hit
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const hit = findDangerousString(child, [...path, key])
      if (hit) return hit
    }
  }
  return null
}

export const apiGraphSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()),
    rootNodeIds: z.array(z.string()),
    collections: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    // Ids of plugin-kind nodes in this graph. Builtin container schemas
    // (e.g. LevelNode.children) only accept builtin typed-id patterns, so
    // plugin child ids are stripped from the copy handed to AnyNode below —
    // the plugin nodes themselves are still validated individually.
    const pluginIds = new Set<string>()
    for (const [nodeId, node] of Object.entries(value.nodes)) {
      const kind = (node as { type?: unknown } | null)?.type
      if (typeof kind === 'string' && PLUGIN_KIND.test(kind)) pluginIds.add(nodeId)
    }

    for (const [nodeId, node] of Object.entries(value.nodes)) {
      const kind = (node as { type?: unknown } | null)?.type
      const isPluginKind = typeof kind === 'string' && PLUGIN_KIND.test(kind)

      if (isPluginKind) {
        const res = PluginNodeEnvelope.safeParse(node)
        if (!res.success) {
          for (const issue of res.error.issues) {
            ctx.addIssue({
              code: 'custom',
              path: ['nodes', nodeId, ...issue.path],
              message: issue.message,
            })
          }
          continue
        }
        const dangerous = findDangerousString(node, [])
        if (dangerous) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, ...dangerous],
            message: 'URL scheme not allowed in plugin node fields',
          })
        }
        continue
      }

      const children = (node as { children?: unknown } | null)?.children
      const candidate =
        pluginIds.size > 0 && Array.isArray(children)
          ? { ...(node as object), children: children.filter((c) => !pluginIds.has(c as string)) }
          : node
      const res = AnyNode.safeParse(candidate)
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
