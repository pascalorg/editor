import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'

/**
 * Throw a structured MCP error. The SDK translates `McpError` into a
 * JSON-RPC error response automatically.
 */
export function throwMcpError(code: ErrorCode, message: string, data?: unknown): never {
  throw new McpError(code, message, data)
}

/**
 * Return a non-throwing tool error payload — used for structured failures that
 * we want the client to see inline in `content` rather than as a protocol
 * error. Sets `isError: true` so SDK clients treat it as a failure.
 */
export function toolError(
  message: string,
  data?: Record<string, unknown>,
): {
  content: { type: 'text'; text: string }[]
  isError: true
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message, ...(data ?? {}) }),
      },
    ],
    isError: true,
  }
}

/**
 * A core operation's refusal (`AgentRefusal`) as the same `{ error, code, ...details }` answer the
 * hosted chat returns; anything else is a real failure and is rethrown.
 */
export function refusalResult(error: unknown) {
  if (isAgentRefusal(error)) return toolError(error.message, { code: error.code, ...error.details })
  throw error
}

export { ErrorCode, McpError }
