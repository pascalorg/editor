import { type InferLingoObject, type LingoObjectShape, lingoObject } from '../ai'

/**
 * Minimal MCP tool descriptor returned by `lingoTool()`. It deliberately does
 * not import an MCP SDK; consumers pass the pieces to their server instance.
 * @example
 * ```ts
 * import { quantityField } from '@pascal-app/lingo/ai'
 * import { lingoTool, type McpTool } from '@pascal-app/lingo/mcp'
 *
 * const t: McpTool = lingoTool({
 *   name: 'quote_shipping',
 *   description: 'Quote shipping for a package.',
 *   input: { weight: quantityField({ kind: 'mass', unit: 'kg' }) },
 *   handler: ({ weight }) => ({ quoteCents: Math.ceil(weight * 499) }),
 * })
 * server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, t.callback)
 * ```
 */
export interface McpTool {
  /** Accepts raw arguments or an MCP request envelope with `params.arguments`. */
  callback: (raw: unknown) => Promise<{
    content: { type: 'text'; text: string }[]
    isError?: boolean
  }>
  description: string
  inputSchema: Record<string, unknown>
  name: string
}

/**
 * Build an MCP tool descriptor from a `lingoObject` shape. The generated JSON
 * Schema is closed by default, and callback input is unwrapped from MCP's
 * `params.arguments` envelope and canonicalized before the handler runs so
 * model repair sees lingo's `[CODE] message` failures.
 * @example
 * ```ts
 * import { quantityField } from '@pascal-app/lingo/ai'
 * import { lingoTool } from '@pascal-app/lingo/mcp'
 *
 * const t = lingoTool({
 *   name: 'quote_shipping',
 *   description: 'Quote shipping for a package.',
 *   input: { weight: quantityField({ kind: 'mass', unit: 'kg' }) },
 *   handler: ({ weight }) => ({ quoteCents: Math.ceil(weight * 499) }),
 * })
 * server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, t.callback)
 * ```
 */
export function lingoTool<Shape extends LingoObjectShape>(def: {
  name: string
  description: string
  input: Shape
  passthrough?: boolean
  handler: (args: InferLingoObject<Shape>) => unknown | Promise<unknown>
}): McpTool {
  const schema = lingoObject(def.input, { passthrough: def.passthrough })
  return {
    name: def.name,
    description: def.description,
    inputSchema: schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    async callback(raw) {
      const params = (raw as { params?: { arguments?: unknown; name?: unknown } })?.params
      const parsed = schema.safeParse(params?.name && params.arguments ? params.arguments : raw)
      if (!('value' in parsed)) {
        return {
          isError: true,
          content: [{ type: 'text', text: parsed.issues.map((issue) => issue.message).join('\n') }],
        }
      }

      try {
        const out = await def.handler(parsed.value)
        return {
          content: [
            { type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) || '' },
          ],
        }
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        }
      }
    },
  }
}
