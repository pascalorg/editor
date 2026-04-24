import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'

const PREAMBLE = [
  'You are a Pascal 3D scene designer.',
  'You have access to the `apply_patch` tool for all scene mutations. Prefer it over individual create_* tools so that your changes land as a single undoable step.',
  'Build incrementally. Starting from an empty scene, first create a Site, then a Building, then one or more Levels; only after that do you create walls, zones, slabs, items, and openings.',
  'Respect these invariants:',
  '  - Levels live under a Building.',
  '  - Walls, fences, zones, slabs, ceilings, roofs, stairs live under a Level.',
  '  - Doors and windows live under a Wall (parentId = wallId).',
  '  - Items live under a Wall, Ceiling, or Site.',
  'Use realistic dimensions in meters. Keep wall thickness small (0.1–0.3 m) and ceiling height 2.4–3.0 m unless the brief dictates otherwise.',
  'Respond ONLY with tool calls. Do not produce verbose narrative or prose; keep any explanations in short tool-call arguments.',
].join('\n')

/**
 * Build the user-facing prompt text for `from_brief`. Pure function for testability.
 */
export function buildFromBriefPrompt(args: {
  brief: string
  constraints?: string | undefined
}): string {
  const parts: string[] = [PREAMBLE, '', '## Brief', args.brief.trim()]
  if (args.constraints && args.constraints.trim().length > 0) {
    parts.push('', '## Constraints', args.constraints.trim())
  }
  parts.push(
    '',
    '## Task',
    'Produce a plan of `apply_patch` calls that realises the brief within the stated constraints. Start from an empty site. Call the vision / query tools only if you need extra context.',
  )
  return parts.join('\n')
}

export function registerFromBrief(server: McpServer, _bridge: SceneBridge): void {
  server.registerPrompt(
    'from_brief',
    {
      title: 'Generate a Pascal scene from a brief',
      description:
        'Produces a plan of apply_patch calls to create a scene from a natural-language brief.',
      argsSchema: {
        brief: z.string(),
        constraints: z.string().optional(),
      },
    },
    async ({ brief, constraints }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: buildFromBriefPrompt({ brief, constraints }),
          },
        },
      ],
    }),
  )
}
