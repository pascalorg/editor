import { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'

/**
 * Validates a SceneGraph at an untrusted API boundary. Re-runs
 * `AnyNode.safeParse` on every node, which enforces the `AssetUrl`
 * allowlist in core (closes the Phase 3 SSRF / arbitrary-URL risk on
 * scan/guide/item/material fields).
 *
 * Shared between `POST /api/scenes` and `PUT /api/scenes/[id]` so neither
 * route can silently accept malicious URLs via the `graph` payload.
 *
 * Phase 8 P4 found the POST bypass; Phase 10 A2 found the PUT bypass.
 */
export const apiGraphSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()),
    rootNodeIds: z.array(z.string()),
    collections: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    for (const [nodeId, node] of Object.entries(value.nodes)) {
      const res = AnyNode.safeParse(node)
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
