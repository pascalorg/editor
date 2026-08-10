import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../../operations'
import { registerAttachFormwork } from './attach-formwork'
import { registerInspectFormworkParts } from './inspect-formwork-parts'
import { registerInspectFormworkSettings } from './inspect-formwork-settings'
import { registerInspectPourUnits } from './inspect-pour-units'
import { registerInspectProjectFormwork } from './inspect-project-formwork'
import { registerListCastableElements } from './list-castable-elements'
import { registerSetElementConstruction } from './set-element-construction'
import { registerSetFormworkPart } from './set-formwork-part'
import { registerSetFormworkSettings } from './set-formwork-settings'
import { registerSetPourDate } from './set-pour-date'
import { registerSetPourLimits } from './set-pour-limits'
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
 * ## Why the pour pair ships together, and why it is the riskiest write here
 *
 * `set_pour_limits` decides how many shutters an element needs; `attach_formwork` builds
 * them. Neither is usable alone. A limit change builds nothing, so an agent that could
 * only set limits would leave the element cast in three pours and formed for one, with
 * every figure it then quoted short by the difference — and an agent that could only
 * attach could never reach the split that makes the second and third shutters exist.
 *
 * `attach_formwork` is also the first write on this surface that can *discard* recorded
 * work rather than edit it. It builds the layout, so a second call has to reconcile:
 * appending would double every shutter and quietly re-order a part somebody marked as
 * already on site, and rebuilding wholesale would throw away every per-part decision the
 * pair above just made recordable. The reply names what it removed and what that cost,
 * because an orphaned shutter's overrides die with the node and the count is the only
 * trace the user will get.
 *
 * Both replies are core's sentences (`pour-patch.ts`), shared with the editor's chat
 * tools for the reason the whole module exists: a short takeoff reported in two wordings
 * reads as two faults, and a discarded-decision count phrased two ways is a user
 * believing two different things were lost.
 *
 * ## Why the last three close the surface rather than extend it
 *
 * `set_element_construction` is what every tool above is solved from, and until it shipped
 * the refusals here pointed at it by name with no such tool to call — an agent handed
 * "call set_element_construction first" and nothing to call it with is one that will guess
 * a formwork system instead. `list_castable_elements` is how the element ids in every
 * other call are found without a `get_node` per wall, and it names the unformed elements
 * before a total is quoted rather than after. `inspect_pour_units` is why a joint is where
 * it is, in core's own cut labels, because a host with no system prompt has nothing to
 * translate `MAX_POUR_VOLUME` with.
 *
 * With these an outside agent can find the elements, state how each is built, state how it
 * is cast, raise the shutters, read the parts and the bill, record the yard's decisions
 * about them, and check that any of it can be erected — without a single question it can
 * only answer by guessing.
 *
 * ## Why `set_pour_date` is last, and why it is addressed differently from every other write
 *
 * Everything above answers "what" and "how much". None of it can say "when", and a bill
 * that cannot name a day is a bill nobody can book a delivery against: the striking tables
 * say a wall form comes off in 12 hours, and only a pour date says which morning the plant
 * is wanted and which afternoon it is free for the next pour.
 *
 * It is the only write here that addresses a shutter rather than an element, and that is
 * forced by the thing being recorded. A date is per *pour* — a 9 m wall in three lifts is
 * three dates a week apart — so a tool taking an element id would have to pick one of them
 * silently. It is also the only input in the whole feature with neither a code nor a
 * product behind it: a period has a published table, a rate at least has an invoice, and a
 * date has only the programme somebody wrote. So nothing is derived from a sequence, and a
 * project that has dated nothing gets no calendar at all rather than one inferred from the
 * order the shutters were built in.
 */
export function registerFormworkTools(server: McpServer, operations: SceneOperations): void {
  registerListCastableElements(server, operations)
  registerSetElementConstruction(server, operations)
  registerInspectProjectFormwork(server, operations)
  registerValidateFormwork(server, operations)
  registerInspectFormworkSettings(server, operations)
  registerSetFormworkSettings(server, operations)
  registerInspectFormworkParts(server, operations)
  registerSetFormworkPart(server, operations)
  registerSetPourLimits(server, operations)
  registerInspectPourUnits(server, operations)
  registerAttachFormwork(server, operations)
  registerSetPourDate(server, operations)
}

export { attachFormworkOutput } from './attach-formwork'
export { inspectFormworkPartsOutput } from './inspect-formwork-parts'
export { inspectFormworkSettingsOutput } from './inspect-formwork-settings'
export { inspectPourUnitsOutput } from './inspect-pour-units'
export { inspectProjectFormworkOutput } from './inspect-project-formwork'
export { listCastableElementsOutput } from './list-castable-elements'
export { setElementConstructionOutput } from './set-element-construction'
export { setFormworkPartOutput } from './set-formwork-part'
export { setFormworkSettingsOutput } from './set-formwork-settings'
export { setPourDateOutput } from './set-pour-date'
export { setPourLimitsOutput } from './set-pour-limits'
export { validateFormworkOutput } from './validate-formwork'
