import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'

export const AGENT_GUIDE = [
  '# Pascal MCP Agent Guide',
  '',
  'You are editing Pascal architectural projects. Use MCP tools only; do not inspect the Pascal repository unless the user explicitly asks.',
  '',
  '## Standard Workflow',
  '',
  '1. Read this guide or call `get_capabilities` if available.',
  '2. If the user asks for a new project, call `create_project` first.',
  '3. For quick starts, call `create_house_from_brief`. For precise edits, build with semantic tools: `create_story_shell`, `create_room`, `add_door`, `add_window`, `furnish_room`, `create_roof`, `place_item`.',
  '4. Let semantic tools update the browser-visible draft. Call `save_scene` with `saveMode: "draft"` for autosave-style progress, or `saveMode: "checkpoint"` only for meaningful milestones.',
  '5. Call `validate_scene`, `verify_scene`, then `get_project_status`.',
  '6. Return the final `editorUrl` from tool output. Do not infer routes.',
  '',
  '## Important Concepts',
  '',
  '- A project is the browser-visible container.',
  '- A scene graph is the architectural model.',
  '- A draft is the browser-visible working model and may be overwritten many times.',
  '- A version/checkpoint is a meaningful saved model revision.',
  '- The browser editor opens the current draft when one exists, otherwise the published version.',
  '- Always return the `editorUrl`, not an internal API URL.',
  '',
  '## URLs',
  '',
  '- Use `editorUrl` returned by tools.',
  '- If a tool returns only an id, call `get_project_status` to get the browser URL.',
  '- Hosted editor URLs use `/editor/<projectId>`.',
  '',
  '## Scene Creation Rules',
  '',
  '- Prefer semantic tools over raw graph patches.',
  '- Do not hand-write node graphs unless no semantic tool exists.',
  '- For rooms, use `create_room` -> `add_door` -> `add_window` -> `furnish_room`.',
  '- For complete homes, create exterior shell, interior rooms, openings, roof, furniture, then landscaping.',
  '- For doors/windows, use `t` or `position` from 0 to 1 along the wall unless a tool explicitly says otherwise.',
  '- X/Z are floor-plan axes and Y is vertical; dimensions are meters.',
  '- Use `create_roof` for roofs. A dedicated roof support level is valid and should not count as an occupied story.',
  '',
  '## Required Final Checks',
  '',
  '- `save_scene` must succeed. Use `saveMode: "checkpoint"` before final handoff only if the user asked for a durable version.',
  '- `verify_scene.hasIssues` should be false; otherwise explain remaining issues.',
  '- `get_project_status.nodeCount` must be greater than 0 for a non-empty design.',
  '- Return `editorUrl` in the final user response.',
  '',
  '## If Something Looks Empty',
  '',
  '1. Call `get_project_status`.',
  '2. Compare `publishedVersion`, `latestVersion`, `browserVisibleVersion`, `nodeCount`, and `graphHash`.',
  '3. If the graph is non-empty but the browser appears empty, call `get_project_status` to re-bind the session, then `save_scene` with `saveMode: "draft"`.',
  '4. Re-run `verify_scene`.',
  '',
  '## Output Contract',
  '',
  'Final user response should include: project name, `editorUrl`, version, node/room summary, and any known limitations.',
].join('\n')

export function registerAgentGuide(server: McpServer, _bridge: SceneOperations): void {
  server.registerResource(
    'agent-guide',
    'pascal://agent-guide',
    {
      title: 'Pascal MCP agent guide',
      description:
        'Short MCP-first project creation, save/publish, validation, and output workflow for external agents.',
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

  server.registerResource(
    'agent-guide-legacy',
    'pascal://agent/guide',
    {
      title: 'Pascal MCP agent guide',
      description: 'Legacy URI for the Pascal MCP agent guide. Prefer pascal://agent-guide.',
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
