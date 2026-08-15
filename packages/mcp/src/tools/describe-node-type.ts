import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { surfaceSlotsForKind } from '@pascal-app/core'
import { AnyNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import { ErrorCode, throwMcpError } from './errors'

/**
 * Tell an agent the shape of a node kind.
 *
 * Roughly nine of the scene's node kinds have a purpose-built tool —
 * `create_wall`, `create_room`, `add_door` and friends. The other forty
 * (column, skylight, chimney, fence, elevator, cabinet, gutter, solar panel,
 * the vents, all the MEP runs, structural grids, section planes, dimensions)
 * are reachable only through `apply_patch`, whose `node` input is deliberately
 * a free-form object: the bridge re-parses it, so the schema is enforced but
 * never *published*. An agent therefore had to guess field names, and guessing
 * a forty-field parametric column is not a thing a model should be asked to do.
 *
 * This publishes what was already there. The schemas are read out of the
 * `AnyNode` union at call time rather than transcribed, so the answer cannot
 * drift from what `apply_patch` will actually accept — a hand-written table
 * would be wrong the first time a kind gained a field.
 */

/** Total bytes of schema returned in one call — see `MAX_RETURNED_SEGMENTS`'s reasoning in `read-cad-drawing.ts`. */
const MAX_SCHEMA_BYTES = 24_000

type UnionOption = {
  shape?: Record<string, unknown>
  _def?: { shape?: Record<string, unknown> }
}

/**
 * The literal value of a member's `type` field — the kind's name.
 *
 * `nodeType()` wraps `z.literal(...)` in a `.default(...)`, and zod moved the
 * internals between majors, so the value sits behind either an `innerType` or
 * the def itself and under either `_def` or `def`. Probing all four is uglier
 * than one accessor but survives a zod bump, which matters for a lookup whose
 * whole promise is that it cannot go stale.
 */
function kindOf(option: UnionOption): string | null {
  const shape = option.shape ?? option._def?.shape
  const typeField = shape?.type as { _def?: unknown; def?: unknown } | undefined
  if (!typeField) return null
  const def = (typeField._def ?? typeField.def) as
    | {
        values?: unknown[]
        innerType?: { _def?: { values?: unknown[] }; def?: { values?: unknown[] } }
      }
    | undefined
  const value =
    def?.values?.[0] ?? def?.innerType?._def?.values?.[0] ?? def?.innerType?.def?.values?.[0]
  return typeof value === 'string' ? value : null
}

function unionOptions(): Array<{ kind: string; option: UnionOption }> {
  const options = (AnyNode as unknown as { options?: UnionOption[] }).options ?? []
  const resolved: Array<{ kind: string; option: UnionOption }> = []
  for (const option of options) {
    const kind = kindOf(option)
    if (kind) resolved.push({ kind, option })
  }
  return resolved.sort((a, b) => a.kind.localeCompare(b.kind))
}

function jsonSchemaFor(option: UnionOption): Record<string, unknown> {
  // `io: 'input'` because the agent is *writing* a node: a field with a default
  // is optional to supply, and the output view would wrongly list it as
  // required. `unrepresentable: 'any'` keeps `z.json()` metadata fields from
  // failing the whole conversion.
  return z.toJSONSchema(option as never, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >
}

export const describeNodeTypeInput = {
  types: z
    .array(z.string())
    .optional()
    .describe(
      'Node kinds to describe in full. Omit to get the index of every kind first — do that, then ask for the two or three you actually need.',
    ),
}

export const describeNodeTypeOutput = {
  types: z.array(
    z.object({
      type: z.string(),
      fieldCount: z.number(),
      required: z.array(z.string()),
      /** True when the kind has paintable surfaces — ask for it to see them. */
      paintable: z.boolean(),
      /** Present only for kinds named in `types`. Slot ids `paint_surfaces` accepts. */
      slots: z
        .array(z.object({ slotId: z.string(), label: z.string(), default: z.string().optional() }))
        .optional(),
      /** Present only for kinds named in `types`. JSON Schema for one node object. */
      schema: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  omitted: z
    .array(z.string())
    .describe('Kinds asked for but dropped because the byte budget ran out. Ask for them next.'),
}

export function registerDescribeNodeType(server: McpServer): void {
  server.registerTool(
    'describe_node_type',
    {
      title: 'Describe node type',
      description:
        "Get the field schema for a scene node kind, as JSON Schema, plus the paintable surfaces it exposes. Read this before using `apply_patch` to create a kind that has no dedicated tool — column, skylight, chimney, fence, elevator, cabinet, gutter, solar panel, vents, duct and pipe runs, structural grids, section planes, dimensions — and before `paint_surfaces`, for the kind's slot ids. Call with no arguments first for the index of every kind, then ask for the specific ones you need. Everything is read from the editor's own definitions, so it matches exactly what `apply_patch` and `paint_surfaces` accept.",
      inputSchema: describeNodeTypeInput,
      outputSchema: describeNodeTypeOutput,
    },
    async ({ types }) => {
      const all = unionOptions()
      if (all.length === 0) {
        throwMcpError(ErrorCode.InternalError, 'node_schemas_unavailable')
      }

      const wanted = new Set(types ?? [])
      const unknown = [...wanted].filter((t) => !all.some((entry) => entry.kind === t))
      if (unknown.length > 0) {
        throwMcpError(ErrorCode.InvalidRequest, 'unknown_node_type', {
          unknown,
          available: all.map((entry) => entry.kind),
        })
      }

      let budget = MAX_SCHEMA_BYTES
      const omitted: string[] = []
      const result = all.map((entry) => {
        const schema = jsonSchemaFor(entry.option)
        const properties = (schema.properties ?? {}) as Record<string, unknown>
        const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
        const slots = surfaceSlotsForKind(entry.kind)
        const base = {
          type: entry.kind,
          fieldCount: Object.keys(properties).length,
          required,
          paintable: slots.length > 0,
        }
        if (!wanted.has(entry.kind)) return base

        const detail = slots.length > 0 ? { ...base, slots } : base
        const cost = JSON.stringify(schema).length
        if (cost > budget) {
          omitted.push(entry.kind)
          return detail
        }
        budget -= cost
        return { ...detail, schema }
      })

      const payload = { types: result, omitted }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
