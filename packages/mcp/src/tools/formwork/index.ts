import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../../operations'
import { registerInspectProjectFormwork } from './inspect-project-formwork'
import { registerValidateFormwork } from './validate-formwork'

/**
 * The two formwork questions an outside agent could not ask.
 *
 * Every other MCP tool reads or edits the scene graph, which is enough to describe a
 * building and not enough to say anything about forming it: what a floor's shutters
 * weigh is a function of a solved panel layout, and whether they can be erected is a
 * function of a pressure solve and a drilled tie grid. Neither survives into the node
 * graph, so an agent holding the whole scene still cannot derive either.
 *
 * Both are the same functions the editor's own AI and the Buildability and Takeoff
 * panels call, through `@pascal-app/nodes/formwork-assembly/headless` — a narrow entry
 * point rather than the barrel, because the barrel carries the panels and this process
 * renders nothing. A second implementation for the server is how the MCP answer comes
 * to differ from the user's screen.
 *
 * Deliberately read-only. `attach_formwork` and `set_formwork_part` exist in chat and
 * are not here: they mutate through the store and want the live-snapshot publish the
 * construction tools do, which is its own piece of work.
 */
export function registerFormworkTools(server: McpServer, operations: SceneOperations): void {
  registerInspectProjectFormwork(server, operations)
  registerValidateFormwork(server, operations)
}

export { inspectProjectFormworkOutput } from './inspect-project-formwork'
export { validateFormworkOutput } from './validate-formwork'
