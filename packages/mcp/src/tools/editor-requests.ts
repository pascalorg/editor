import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ErrorCode, throwMcpError } from './errors'

/**
 * The channel that puts the prompt box inside the editor.
 *
 * MCP is client-driven: a server cannot start a conversation, so the editor has
 * no way to "send a message to Claude". The issue this closes assumed the way
 * round it was **sampling** — the server borrowing the client's model through
 * `createMessage` — and was blocked on whether any shipping client advertises
 * that capability.
 *
 * It does not have to be. A conversation that is *already running* asks this
 * tool for work; the editor's prompt comes back as tool output, and the agent
 * acts on it with the same tools it already has. That needs no capability
 * beyond ordinary tool calling, works on any MCP client, and — unlike sampling,
 * which returns a single completion with no tool access — leaves the model able
 * to actually do the thing it was asked for.
 *
 * The cost is one sentence of setup: the user tells their client to watch the
 * editor once, and the agent loops. The editor writes to the same database the
 * live-sync events already flow through, so no new transport is involved.
 */

/** Long-poll ceiling. Past this the agent should call again, so it stays interruptible. */
const MAX_WAIT_SECONDS = 120
const DEFAULT_WAIT_SECONDS = 60
const POLL_INTERVAL_MS = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const awaitEditorRequestInput = {
  sceneId: z
    .string()
    .optional()
    .describe(
      'Only take prompts for this scene. Omit to take the next one from any scene — then act on the scene the request names.',
    ),
  timeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_WAIT_SECONDS)
    .optional()
    .describe(`How long to wait for a prompt (default ${DEFAULT_WAIT_SECONDS}).`),
}

export const awaitEditorRequestOutput = {
  timedOut: z.boolean().describe('True when nothing arrived. Call again to keep watching.'),
  requestId: z.number().optional(),
  sceneId: z.string().optional(),
  prompt: z.string().optional().describe('What the user typed in the editor. Act on it.'),
}

export const answerEditorRequestInput = {
  requestId: z.number().int().describe('From await_editor_request.'),
  answer: z
    .string()
    .min(1)
    .max(4000)
    .describe("What you did or found, in the user's language. This is shown in the editor."),
}

export const answerEditorRequestOutput = {
  requestId: z.number(),
  status: z.string(),
}

export function registerEditorRequestTools(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'await_editor_request',
    {
      title: 'Await editor request',
      description:
        "Wait for the user to type something in the Pascal editor's agent box, and return it. This is how a prompt written in the editor reaches you — the editor cannot message you directly. When the user asks you to watch the editor, call this, act on whatever comes back using the other tools, report with answer_editor_request, then call this again to keep watching. A timeout is normal and means nothing arrived; just call again.",
      inputSchema: awaitEditorRequestInput,
      outputSchema: awaitEditorRequestOutput,
    },
    async ({ sceneId, timeoutSeconds }) => {
      if (!bridge.canServeAgentRequests) {
        throwMcpError(
          ErrorCode.InvalidRequest,
          'This server has no scene store, so the editor has nowhere to leave a prompt.',
        )
      }

      const deadline = Date.now() + (timeoutSeconds ?? DEFAULT_WAIT_SECONDS) * 1000
      // Polling rather than a notification: the editor writes through an HTTP
      // route in a different process, and SQLite is the only thing the two
      // share. At half a second the user does not perceive the wait.
      for (;;) {
        const claimed = await bridge.claimNextAgentRequest(sceneId)
        if (claimed) {
          const payload = {
            timedOut: false,
            requestId: claimed.requestId,
            sceneId: claimed.sceneId as string,
            prompt: claimed.prompt,
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
            structuredContent: payload,
          }
        }
        if (Date.now() >= deadline) break
        await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())))
      }

      const payload = { timedOut: true }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )

  server.registerTool(
    'answer_editor_request',
    {
      title: 'Answer editor request',
      description:
        'Report back on a prompt you took with await_editor_request. The text lands in the editor next to what the user typed, so write it for them: what you changed, or what you found. Scene edits already reach the editor on their own — this is the sentence explaining them.',
      inputSchema: answerEditorRequestInput,
      outputSchema: answerEditorRequestOutput,
    },
    async ({ requestId, answer }) => {
      if (!bridge.canServeAgentRequests) {
        throwMcpError(ErrorCode.InvalidRequest, 'This server has no scene store.')
      }

      const answered = await bridge.answerAgentRequest(requestId, answer)
      if (!answered) {
        throwMcpError(ErrorCode.InvalidParams, `No editor request with id ${requestId}`)
      }

      const payload = { requestId: answered.requestId, status: answered.status }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
