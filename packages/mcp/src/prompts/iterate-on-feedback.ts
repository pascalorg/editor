import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'

const PREAMBLE = [
  'You are iterating on an existing Pascal scene based on user feedback.',
  'Given the current state (read via the `pascal://scene/current` resource) and the user feedback below, propose the MINIMUM set of `apply_patch` operations that satisfies the feedback.',
  'Rules:',
  '  - Prefer updates over create+delete pairs when a field change will do.',
  '  - Do not re-create nodes that already exist.',
  '  - Do not touch nodes that are unrelated to the feedback.',
  '  - Bundle related mutations into a single `apply_patch` call so they share one undo step.',
  '  - Respond ONLY with tool calls. No prose.',
].join('\n')

/**
 * Build the user-facing prompt text for `iterate_on_feedback`.
 * Pure function for testability.
 */
export function buildIterateOnFeedbackPrompt(args: { feedback: string }): string {
  return [PREAMBLE, '', '## User feedback', args.feedback.trim()].join('\n')
}

export function registerIterateOnFeedback(server: McpServer, _bridge: SceneBridge): void {
  server.registerPrompt(
    'iterate_on_feedback',
    {
      title: 'Iterate on a scene from user feedback',
      description:
        'Produces a minimal-diff plan of apply_patch calls in response to user feedback on the current scene.',
      argsSchema: {
        feedback: z.string(),
      },
    },
    async ({ feedback }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: buildIterateOnFeedbackPrompt({ feedback }),
          },
        },
      ],
    }),
  )
}
