import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../../operations'
import { registerInspectFormworkParts } from './inspect-formwork-parts'
import { registerInspectFormworkSettings } from './inspect-formwork-settings'
import { registerInspectProjectFormwork } from './inspect-project-formwork'
import { registerSetFormworkPart } from './set-formwork-part'
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
 * ## Why the parts pair comes next, and what is different about it
 *
 * The settings pair states the project's *inputs*; this one records a decision about an
 * *output*. That makes it the first write here whose input cannot be checked against a
 * schema: a mark names a position in a layout that exists nowhere in the scene graph, so
 * `set_formwork_part` has to solve the element and look before it can refuse. Reading
 * the marks is half of it — a bill line says 34 panels and a substitution is made about
 * one of them, so `inspect_formwork_parts` is the only read from which the write can be
 * called at all, and shipping one without the other leaves an agent guessing handles.
 *
 * Still absent: `attach_formwork`, which builds the layout rather than editing it, and
 * `set_pour_limits`, which decides how many of them there are.
 */
export function registerFormworkTools(server: McpServer, operations: SceneOperations): void {
  registerInspectProjectFormwork(server, operations)
  registerValidateFormwork(server, operations)
  registerInspectFormworkSettings(server, operations)
  registerSetFormworkSettings(server, operations)
  registerInspectFormworkParts(server, operations)
  registerSetFormworkPart(server, operations)
}

export { inspectFormworkPartsOutput } from './inspect-formwork-parts'
export { inspectFormworkSettingsOutput } from './inspect-formwork-settings'
export { inspectProjectFormworkOutput } from './inspect-project-formwork'
export { setFormworkPartOutput } from './set-formwork-part'
export { setFormworkSettingsOutput } from './set-formwork-settings'
export { validateFormworkOutput } from './validate-formwork'
