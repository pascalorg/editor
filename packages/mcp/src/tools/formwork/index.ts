import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../../operations'
import { registerInspectFormworkSettings } from './inspect-formwork-settings'
import { registerInspectProjectFormwork } from './inspect-project-formwork'
import { registerSetFormworkSettings } from './set-formwork-settings'
import { registerValidateFormwork } from './validate-formwork'

/**
 * The formwork questions an outside agent could not ask, and the one decision it could
 * not state.
 *
 * Every other MCP tool reads or edits the scene graph, which is enough to describe a
 * building and not enough to say anything about forming it: what a floor's shutters
 * weigh is a function of a solved panel layout, and whether they can be erected is a
 * function of a pressure solve and a drilled tie grid. Neither survives into the node
 * graph, so an agent holding the whole scene still cannot derive either.
 *
 * The reads are the same functions the editor's own AI and the Buildability and Takeoff
 * panels call, through `@pascal-app/nodes/formwork-assembly/headless` — a narrow entry
 * point rather than the barrel, because the barrel carries the panels and this process
 * renders nothing. A second implementation for the server is how the MCP answer comes
 * to differ from the user's screen.
 *
 * ## Why the settings pair belongs here rather than being deferred with the rest
 *
 * The reads were shipped alone, and that left this surface able to *quote* a bill it
 * could not state the pour for: every figure it returned was designed against DIN's
 * fastest covered rise rate at its own reference temperature, because those are the
 * shipped conservative defaults and nothing here could say otherwise. An agent could
 * tell a yard what to order and had no way to record the 2 m/h the job actually pours
 * at, or the 5 °C it cures at — which is the input the whole hire period hangs off.
 * Reading a design nobody can correct is the narrower half of the feature.
 *
 * The write shares core's schema, validation and merge (`settings-patch.ts`) with the
 * editor's chat tools rather than restating them. Two AI surfaces that disagree about
 * what `null` means, or about which catalog ids are real, disagree about whether the
 * design report says "assumed" or "project" — the one distinction the settings node
 * exists to carry.
 *
 * Still absent: `attach_formwork` and `set_formwork_part`, which mutate a solved layout
 * rather than the project's inputs, and `set_pour_limits`.
 */
export function registerFormworkTools(server: McpServer, operations: SceneOperations): void {
  registerInspectProjectFormwork(server, operations)
  registerValidateFormwork(server, operations)
  registerInspectFormworkSettings(server, operations)
  registerSetFormworkSettings(server, operations)
}

export { inspectFormworkSettingsOutput } from './inspect-formwork-settings'
export { inspectProjectFormworkOutput } from './inspect-project-formwork'
export { setFormworkSettingsOutput } from './set-formwork-settings'
export { validateFormworkOutput } from './validate-formwork'
