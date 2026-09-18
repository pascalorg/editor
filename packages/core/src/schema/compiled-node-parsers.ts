import z from 'zod'
import { AnyNode, type AnyNodeOption, nodeKindOf } from './types'

/**
 * AOT-compiled per-kind node parsers.
 *
 * `z.compile()` trades a one-off codegen pass for a faster warm parse. Two
 * properties of that trade decide the shape of this module:
 *
 * - **Per kind, never the union.** One compiled function covering all 48
 *   `AnyNode` members is megamorphic at the call site and can run slower than
 *   the interpreter. Each kind gets its own compiled clone instead, and
 *   dispatch stays a `Map` lookup on the discriminator.
 * - **Lazily.** Compiling every kind up front pays codegen for kinds a session
 *   never touches and retains their generated code for the process lifetime. A
 *   kind is compiled on its first parse and only then.
 *
 * Off by default; a host opts in via {@link enableCompiledNodeParsers}. While
 * off — and in any environment without a usable `Function` constructor (a
 * CSP-restricted embedder) or with `z.config({ jitless: true })` set — every
 * entry point returns the interpreted schema it was handed, so parses behave
 * exactly as they do without this module.
 */

let enabled = false

/**
 * Opt this process into compiled per-kind node parsers. Call at host startup.
 *
 * Compiled and interpreted parsers agree on both successful output and error
 * issues (`compiled-node-parsers.test.ts` asserts that for every node kind), so
 * this only ever changes throughput.
 */
export function enableCompiledNodeParsers(value = true): void {
  enabled = value
}

/** Whether {@link enableCompiledNodeParsers} is currently on. */
export function compiledNodeParsersEnabled(): boolean {
  return enabled
}

/**
 * `z.core.util.allowsEval` is zod's own cached `new Function` probe. Reusing it
 * rather than probing ourselves means a CSP-restricted page reports at most one
 * `securitypolicyviolation` for the whole process, and `jitless` short-circuits
 * before any probe runs at all.
 */
function canCompile(): boolean {
  return z.core.util.allowsEval.value
}

const compiledBySchema = new WeakMap<z.ZodType, z.ZodType>()

/**
 * The compiled clone of a single node kind's schema, or `schema` itself when
 * compilation is off or unavailable.
 *
 * Memoized per schema instance, so the codegen for a kind runs once per
 * process. Never pass `AnyNode` — see the module note on megamorphism.
 */
export function compiledNodeSchema<T extends z.ZodType>(schema: T): T {
  if (!(enabled && canCompile())) return schema

  const memo = compiledBySchema.get(schema)
  if (memo) return memo as T

  // `z.compile` never throws by default: a schema its codegen cannot model
  // comes back as the original, which memoizes as "do not try again".
  const compiled = z.compile(schema)
  compiledBySchema.set(schema, compiled)
  return compiled
}

let optionsByKind: Map<string, AnyNodeOption> | undefined

/**
 * The `AnyNode` member that accepts `kind`, compiled when enabled.
 *
 * Returns `null` for anything the union does not discriminate on — an unknown
 * kind, a plugin-registered kind, a missing or non-string `type`. Callers fall
 * back to parsing the union so the failure path (and its `invalid_union` issue
 * at `['type']`) stays byte-identical.
 */
export function nodeSchemaForKind(kind: unknown): AnyNodeOption | null {
  if (typeof kind !== 'string') return null

  optionsByKind ??= new Map(AnyNode.options.map((option) => [nodeKindOf(option), option]))
  const option = optionsByKind.get(kind)

  return option ? compiledNodeSchema(option) : null
}

/**
 * Parse a node against the member for its own `type`, or against the whole
 * union when the kind is one `AnyNode` does not discriminate on.
 *
 * Drop-in for `AnyNode.safeParse(node)`: a discriminated union delegates to the
 * member anyway, so success values and failure issues are the same either way —
 * and the union fallback keeps the `invalid_union` issue at `['type']` for a
 * missing, unknown, or plugin-registered kind.
 */
export function parseNode(node: unknown): z.ZodSafeParseResult<AnyNode> {
  const schema = nodeSchemaForKind((node as { type?: unknown } | null | undefined)?.type)

  return (schema ?? AnyNode).safeParse(node) as z.ZodSafeParseResult<AnyNode>
}
