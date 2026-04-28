import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { SCENE_DESIGN_GUIDANCE } from './scene-guidance'

const PREAMBLE = [
  'You are a Pascal 3D scene designer.',
  'You have access to semantic scene tools and the lower-level `apply_patch` tool. Prefer semantic construction/room/opening/furnishing tools for architectural work, and use `apply_patch` for bulk graph edits that need exact control.',
  'Build incrementally with visible progress. Starting from an empty scene, first create/load a Site and Building, then create occupied Levels and `create_story_shell` once per story before detailed rooms, openings, furniture, a dedicated roof level via `create_roof`, and landscaping.',
  'Respect these invariants:',
  '  - Levels live under a Building.',
  '  - Walls, fences, zones, slabs, ceilings, roofs, stairs live under a Level.',
  '  - Multi-story exterior walls are per-level story walls; never make lower-level walls taller to stand in for upper-level walls.',
  '  - Doors and windows live under a Wall (parentId = wallId).',
  '  - Floor items live under a Level; wall/ceiling-attached items live under their target Wall or Ceiling; outdoor items can live under a Site.',
  'Use realistic dimensions in meters. Keep wall thickness small (0.1–0.3 m) and ceiling height 2.4–3.0 m unless the brief dictates otherwise.',
  SCENE_DESIGN_GUIDANCE,
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
    'Produce tool calls that realise the brief within the stated constraints. Start from an empty site. Prefer create_story_shell/create_room/add_door/add_window/create_stair_between_levels/create_roof/furnish_room for architectural layout, use apply_patch for exact bulk graph work, and call validate_scene plus verify_scene after complex layouts.',
  )
  return parts.join('\n')
}

export function registerFromBrief(server: McpServer, _bridge: SceneOperations): void {
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
