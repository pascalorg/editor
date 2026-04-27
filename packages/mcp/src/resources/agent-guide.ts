import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../bridge/scene-bridge'

export const AGENT_GUIDE = [
  '# Pascal MCP agent guide',
  '',
  'Use this guide before inspecting application source code. The MCP surface is intended to expose the construction contract an agent needs for normal scene editing.',
  '',
  '## Fast visible-progress workflow',
  '',
  '1. Query `pascal://scene/current/summary` or `list_levels` to orient yourself.',
  '2. Create visible massing first: `create_level` as needed, then `create_story_shell` once per story.',
  '3. Add room semantics next: zones/rooms, interior walls, slabs, and ceilings. Prefer `create_room` for simple rooms and `apply_patch` only for exact multi-room partitions.',
  '4. Add circulation and envelope details: `create_stair_between_levels`, then `add_door` and `add_window`.',
  '5. Add `create_roof`, furniture with `furnish_room`/`place_item`, and exterior features such as fences, patios, driveways, lawns, and garden zones.',
  '6. Run `validate_scene` and `verify_scene`; fix issues before handing off.',
  '',
  'This sequence lets users see a recognizable building quickly instead of waiting for one large hidden planning pass.',
  '',
  '## Construction rules',
  '',
  '- Levels live under a Building.',
  '- Walls, fences, zones, slabs, ceilings, roofs, and stairs live under a Level.',
  '- Doors and windows live under their Wall. Use `add_door`/`add_window`; their `t` or `position` is 0..1 along the wall.',
  '- Floor items live under a Level; wall/ceiling-attached items live under their target Wall or Ceiling.',
  '- For multi-story buildings, create separate level-owned exterior walls for each story. Do not make first-story walls taller to represent upper-story bearing walls.',
  '- Use `create_story_shell` once per floor/story to avoid cross-level wall ownership mistakes.',
  '- Use `create_stair_between_levels` for stairs. It creates a straight stair and one rectangular manual slab/ceiling opening while disabling automatic stair-opening mode, avoiding duplicate or irregular holes.',
  '- Roofs are containers with roof segments and should be isolated on a dedicated roof level for solo/exploded level views. Use `create_roof`; by default it creates a roof level above the reference occupied level. Do not attach roofs directly to the top occupied floor unless explicitly requested.',
  '- Story count means occupied stories, not raw level count. A two-story house may correctly have three levels when the third level has metadata role `roof`; do not delete roof/support levels to satisfy a requested story count.',
  '- Use `pascal://constraints/{levelId}` when you need existing slab holes or wall footprints for precise placement.',
  '',
  '## Scene model facts exposed here so agents do not need repo inspection',
  '',
  '- X/Z are floor-plan axes and Y is vertical; dimensions are meters.',
  '- A story wall height is normally 2.4-3.0m; wall thickness is normally 0.1-0.3m.',
  '- Slab and ceiling holes are polygon arrays. Manual stair openings should have `holeMetadata` with source `manual` and a single rectangular polygon.',
  '- Dedicated roof levels use metadata role `roof` and normally contain the roof only; the top occupied level keeps its own walls, rooms, slabs, and ceiling.',
  '- `verify_scene` reports `occupiedStoryCount`, `supportLevelCount`, and `roofLevelIds`; use those fields instead of `levelCount` when checking story-count requirements.',
  '- Saved site children can contain embedded building objects for compatibility, but tools handle parent/child bookkeeping. Prefer tools over raw graph surgery for common construction.',
  '- `validate_scene` checks schema correctness. `verify_scene` checks practical layout issues such as empty levels, missing rooms/floors/doors, bad openings, stair obstructions, and suspicious multi-story wall heights.',
  '',
  '## Tool preference',
  '',
  '- Prefer semantic tools first: `create_story_shell`, `create_room`, `add_door`, `add_window`, `create_stair_between_levels`, `create_roof`, `furnish_room`, `place_item`.',
  '- Use `apply_patch` for bulk exact edits after semantic tools have established the main structure.',
].join('\n')

export function registerAgentGuide(server: McpServer, _bridge: SceneBridge): void {
  server.registerResource(
    'agent-guide',
    'pascal://agent/guide',
    {
      title: 'Agent construction guide',
      description:
        'MCP-first construction workflow, scene invariants, and tool preferences so agents do not need to inspect the Pascal codebase.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: AGENT_GUIDE,
        },
      ],
    }),
  )
}
