import { AnyNode, AssetUrl, BaseNode, SceneMaterial } from '@pascal-app/core/schema'
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
 *
 * Nodes minted by plugins (`trees:tree`, plus anything a third-party pack
 * registers) are outside `AnyNode`, and their schemas live in packages that
 * pull in renderer/UI code a route handler must not import — the node registry
 * is empty in this process regardless, since nothing registers kinds
 * server-side. Such a node is validated the way `validate-build-json` treats a
 * kind it cannot resolve: as a foreign node, held to the `BaseNode` envelope
 * plus the same `AssetUrl` allowlist applied to every URL-shaped string it
 * carries. That keeps the Phase 3 posture on a branch that must accept unknown
 * fields without resorting to a denylist, which would have to enumerate every
 * hostile scheme where `AssetUrl` already enumerates the safe ones.
 */

const KNOWN_TYPES = new Set<string>(
  AnyNode.options.map((o) => o.shape.type.parse(undefined) as string),
)

/** The envelope every persisted node satisfies, builtin or foreign. */
const ForeignNodeEnvelope = BaseNode.extend({
  type: z.string().min(1),
  children: z.array(z.string()).optional(),
}).loose()

// A walk over attacker-shaped JSON needs both bounds: depth, so a nest of
// arrays can't overflow the stack (an exception thrown past `safeParse` is a
// 500, not the 400 the caller is owed), and a visit count, so a wide-but-flat
// body can't burn the request budget.
const MAX_SCAN_DEPTH = 48
const MAX_SCAN_VALUES = 50_000

/**
 * Whether a string is trying to be a URL, and so has to satisfy `AssetUrl`.
 *
 * C0 controls are stripped first: browsers ignore them inside a scheme, so
 * `java\tscript:alert(1)` navigates while reading as free text to a naive
 * prefix match. The scheme must be followed immediately by a non-space — that
 * is what separates `ftp://host/x` from prose like `FTP: north bed`, which a
 * plugin is entitled to store in a node name. The two-character minimum on the
 * scheme leaves Windows drive paths (`C:\…`) as free text; every scheme worth
 * rejecting is longer than one letter.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping C0 controls is the point — browsers ignore them mid-scheme.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
const SCHEME = /^[a-z][a-z0-9+.-]+:[^\s]/i
function isUrlShaped(value: string): boolean {
  const bare = value.replace(CONTROL_CHARS, '').trimStart()
  return SCHEME.test(bare) || bare.startsWith('//')
}

type ScanResult = { path: (string | number)[]; reason: 'url' | 'too-complex' }

/**
 * First URL-shaped string `AssetUrl` rejects, or a breach of the walk bounds.
 *
 * The node's own `type` is exempt: a namespaced kind (`trees:tree`) is
 * scheme-shaped by construction, and the envelope has already validated it.
 */
function findRejectedUrl(root: unknown): ScanResult | null {
  let budget = MAX_SCAN_VALUES
  const walk = (value: unknown, path: (string | number)[], depth: number): ScanResult | null => {
    if (depth > MAX_SCAN_DEPTH || budget-- <= 0) return { path, reason: 'too-complex' }
    if (typeof value === 'string') {
      if (isUrlShaped(value) && !AssetUrl.safeParse(value).success) return { path, reason: 'url' }
      return null
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const hit = walk(value[i], [...path, i], depth + 1)
        if (hit) return hit
      }
      return null
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (depth === 0 && key === 'type') continue
        const hit = walk(child, [...path, key], depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(root, [], 0)
}

export const apiGraphSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()),
    rootNodeIds: z.array(z.string()),
    collections: z.unknown().optional(),
    // `unknown` here, validated in `superRefine` below — the same split the
    // nodes get, and for the same reason: the routes persist this schema's
    // *output*, so a validating shape would also rewrite what gets stored.
    // `SceneMaterial` injects `MaterialProperties` defaults and drops unknown
    // keys, which would make every save silently normalize the caller's
    // palette. Materials still have to be checked, because they carry texture
    // URLs that `MaterialSchema` routes through `AssetUrl` — this schema is
    // where that allowlist is enforced.
    materials: z.record(z.string(), z.unknown()).optional(),
    installedPlugins: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    const addIssues = (nodeId: string, error: z.ZodError) => {
      for (const issue of error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', nodeId, ...issue.path],
          message: issue.message,
        })
      }
    }

    for (const [materialId, material] of Object.entries(value.materials ?? {})) {
      const res = SceneMaterial.safeParse(material)
      if (res.success) continue
      for (const issue of res.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['materials', materialId, ...issue.path],
          message: issue.message,
        })
      }
    }

    // Ids of foreign nodes in this graph. Builtin container schemas name the
    // child kinds they accept (`BuildingNode.children`, `RoofNode.children`),
    // so a container holding a plugin child fails against `AnyNode` even
    // though the relationship is legitimate. Those ids are dropped from a
    // *copy* handed to `AnyNode`; the stored graph keeps them, and each
    // foreign node is still validated on its own.
    const foreignIds = new Set<string>()
    for (const [nodeId, node] of Object.entries(value.nodes)) {
      const type = (node as { type?: unknown } | null)?.type
      if (typeof type === 'string' && !KNOWN_TYPES.has(type)) foreignIds.add(nodeId)
    }

    for (const [nodeId, node] of Object.entries(value.nodes)) {
      const type = (node as { type?: unknown } | null)?.type

      if (typeof type === 'string' && !KNOWN_TYPES.has(type)) {
        const res = ForeignNodeEnvelope.safeParse(node)
        if (!res.success) {
          addIssues(nodeId, res.error)
          continue
        }
        const rejected = findRejectedUrl(node)
        if (rejected) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, ...rejected.path],
            message:
              rejected.reason === 'url'
                ? 'URL is not in the allowed scheme list'
                : 'Node is too deeply nested to validate',
          })
        }
        continue
      }

      const children = (node as { children?: unknown } | null)?.children
      const candidate =
        foreignIds.size > 0 && Array.isArray(children)
          ? { ...(node as object), children: children.filter((c) => !foreignIds.has(c as string)) }
          : node
      const res = AnyNode.safeParse(candidate)
      if (!res.success) addIssues(nodeId, res.error)
    }
  })
