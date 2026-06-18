import { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'

export interface GraphValidationDiagnostic {
  nodeId: string
  type: string | null
  name: string | null
  path: string
  message: string
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function formatIssuePath(path: readonly (string | number | symbol)[]) {
  return path.map((part) => String(part)).join('.')
}

export function diagnoseApiGraph(value: unknown, limit = 20): GraphValidationDiagnostic[] {
  const graph = readRecord(value)
  const nodes = readRecord(graph?.nodes)
  if (!nodes) {
    return [
      {
        nodeId: '(graph)',
        type: null,
        name: null,
        path: 'nodes',
        message: 'Scene graph nodes must be an object.',
      },
    ]
  }

  const diagnostics: GraphValidationDiagnostic[] = []
  for (const [nodeId, node] of Object.entries(nodes)) {
    const nodeRecord = readRecord(node)
    const parsed = AnyNode.safeParse(node)
    if (parsed.success) continue

    for (const issue of parsed.error.issues) {
      diagnostics.push({
        nodeId,
        type: typeof nodeRecord?.type === 'string' ? nodeRecord.type : null,
        name: typeof nodeRecord?.name === 'string' ? nodeRecord.name : null,
        path: formatIssuePath(issue.path),
        message: issue.message,
      })
      if (diagnostics.length >= limit) return diagnostics
    }
  }

  return diagnostics
}

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
