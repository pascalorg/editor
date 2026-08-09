import { z } from 'zod'
import type { FormworkPartOverride } from '../../schema/nodes/formwork-assembly'
import { isStockableCatalogId } from './catalog'
import { mergeFormworkPartOverride } from './parts'

/**
 * The two decisions a yard makes about a solved shutter, as an *agent* states them —
 * one write contract for every AI surface, and one reading of it.
 *
 * `parts.ts` owns what an override means once a patch has been formed. This owns the
 * step before it: what an agent may say about a part, what it means by `null`, and
 * which catalog ids are real. `settings-patch.ts` exists for the same reason one level
 * up, and the hazard here is the same one: a description that warns a substituted panel
 * will not line up with this system's tie holes, present on one surface and absent on
 * the other, is a bill that does not fit the wall on whichever surface lacks it.
 *
 * ## What this deliberately cannot do
 *
 * It cannot resolve the mark. A mark is a position in a *solved* layout, and the solve
 * lives in `@pascal-app/nodes` behind the geometry builders — core has no access to it
 * and should not. So each surface resolves the mark against its own live solve and
 * calls this with the assembly's current overrides; `unknownPartMark` is here so the two
 * refuse a mark the model misremembered in the same words.
 *
 * It also does not write. The overrides come back and the caller applies them, because
 * the callers apply them differently — the chat tools mutate a plain graph on the
 * server, MCP goes through the store's `updateNode`.
 */

/** What an agent may ask for when reading a shutter's parts. */
export const formworkPartsQueryInput = {
  elementId: z.string().min(1),
  kind: z
    .string()
    .max(40)
    .optional()
    .describe(
      'restrict the part list to one kind — panel, filler, corner, stop-end, waler, joist, tie, ply-piece, prop, brace, accessory, consumable. The bill always covers everything; this only trims the itemised list',
    ),
}

/**
 * The whole write, as a tool's input shape.
 *
 * A raw shape rather than a `z.object` so an MCP `inputSchema` can take it directly and
 * the AI SDK's `tool()` can wrap it, without either surface restating a field. Each
 * write is `.nullable().optional()` because an agent needs three states where the
 * override record has two: set it, leave it alone, or hand it back.
 */
export const formworkPartPatchInput = {
  elementId: z.string().min(1),
  mark: z
    .string()
    .max(120)
    .describe("the part's mark, e.g. P-A-1-01800 — from inspect_formwork_parts"),
  catalogId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(
      'the catalog item to use instead. Must be an id that exists in the catalog, and must be the same sort of thing as the part it replaces — a prop for a prop, a beam for a beam',
    ),
  omitted: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'true leaves the part off the bill and off the weight total. The 3D shutter still draws it, because it is still in the shutter — somebody else supplied it',
    ),
  note: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .describe('why, so the decision is on the drawing rather than only in this conversation'),
}

export const FormworkPartPatch = z.object(formworkPartPatchInput)
export type FormworkPartPatch = z.infer<typeof FormworkPartPatch>

/** The description every surface's read tool carries, so the guidance cannot diverge either. */
export const INSPECT_FORMWORK_PARTS_DESCRIPTION =
  "What a wall, column or slab's shutter is actually made of, and the bill of materials for it. Every part carries a mark derived from its own position (P-A-1-01800 is the panel on face A, first course, 1800 mm along), so a mark is a stable handle you can quote to the user and pass to set_formwork_part. Read this before answering any question about panel counts, tie counts, prop counts, weights or what to order — the parts are solved from the same pass that draws the 3D shutter, so this is the only figure that agrees with what the user sees. Reports the hardest-worked part and anything beyond capacity: a bill for a shutter that does not stand up is not an order to place. An element nobody has formed has no parts at all rather than a bill of nothing, and inspect_project_formwork lists it under unshuttered. One element is rarely the question a yard is asking, either — for a floor, a project or anything to be ordered, call inspect_project_formwork instead, because the same panel type on two walls is one line on a delivery note and two per-element bills of it cannot be added together afterwards."

/** The description every surface's write tool carries. */
export const SET_FORMWORK_PART_DESCRIPTION =
  "Record a decision about one part of a shutter: substitute a different catalog item for it, or leave it off the order because it is already on site. Identify the part by the mark inspect_formwork_parts reported. These are the two things a yard actually changes about a solved layout, and they are recorded against the mark rather than against the solve, so they survive the wall being re-solved. You cannot edit a size, a length, a spacing or a utilisation — those are outputs of the design, and a panel width typed over the top of one produces a bill that does not fit the wall; to change those, change the design inputs with set_formwork_settings and read the parts again. Pass false or null to clear a field. Ask before substituting: a panel from another manufacturer's system will not line up with this system's tie holes."

/**
 * The refusal for a mark the solve does not produce — shared, because both surfaces
 * resolve a mark against a live solve and both will be handed one the model
 * misremembered. Written blind it would become a stale edit against a part nobody
 * touched, reported as somebody's forgotten decision for the rest of the project.
 */
export function unknownPartMark(elementId: string, mark: string, partCount: number): string {
  return `Error: no part ${mark} on ${elementId}. Call inspect_formwork_parts for the marks this shutter actually has (${partCount} parts).`
}

/**
 * The refusal for an element nobody has formed.
 *
 * Distinct from `unknownPartMark` on purpose, and it is the distinction that makes the
 * reply actionable: a mark that is wrong on a shuttered wall is a lookup the agent
 * should redo, where a wall with no shutter at all needs two other calls first, and one
 * merged message sends the agent to the wrong one of those. Named for the read as well
 * as the write, because an empty parts list is the same silence — a bill of nothing
 * reads as an element that needs nothing.
 */
export function noFormworkAssembly(elementId: string, forMark?: string): string {
  return forMark === undefined
    ? `Error: ${elementId} has no formwork assembly, so there are no parts. Call set_element_construction then attach_formwork first.`
    : `Error: ${elementId} has no formwork assembly, so there is no part ${forMark}. Call attach_formwork first.`
}

export type FormworkPartPatchResult =
  | { error: string; overrides?: undefined; recorded?: undefined }
  | {
      error?: undefined
      /** The assembly's whole `partOverrides` record, as it should now stand. */
      overrides: Record<string, FormworkPartOverride>
      /** What the call recorded, in the words a reply reads back to the user. */
      recorded: string[]
    }

/**
 * What a stated part edit does to an assembly's overrides — the record, or the refusal.
 *
 * The catalog id is checked even though a bad one does not fail loudly, and that is
 * exactly why: the design chain falls back to its own default part, so a hallucinated
 * `peri-h20` would leave the project believing it had specified a beam while every span
 * was solved against another. One flat catalog check rather than a per-kind list,
 * because the question is only "does this name a real product" — whether a beam is a
 * sensible stand-in for a beam is the substitution list the panel offers, and a tighter
 * check would reject the legitimate case of a column form standing in for a wall panel
 * on a blade.
 */
export function applyFormworkPartPatch(
  current: Readonly<Record<string, FormworkPartOverride>> | undefined,
  patch: Omit<FormworkPartPatch, 'elementId'>,
): FormworkPartPatchResult {
  const { catalogId, mark, note, omitted } = patch
  if (catalogId === undefined && omitted === undefined && note === undefined) {
    return { error: 'Error: nothing to set — pass catalogId, omitted or note' }
  }
  if (typeof catalogId === 'string' && !isStockableCatalogId(catalogId)) {
    return {
      error: `Error: no catalog item "${catalogId}". Read inspect_formwork_settings for the systems in scope, or pass null to go back to what the layout solved.`,
    }
  }

  // `null` from a model means "unstate this", which `mergeFormworkPartOverride` spells
  // as `undefined`. An absent key means "leave it alone", so the two cannot be
  // collapsed — a key present holding undefined would clear a field nobody mentioned.
  const fields: Record<string, unknown> = {}
  if (catalogId !== undefined) fields.catalogId = catalogId ?? undefined
  if (omitted !== undefined) fields.omitted = omitted ?? undefined
  if (note !== undefined) fields.note = note ?? undefined

  const recorded: string[] = []
  if (catalogId !== undefined) {
    recorded.push(catalogId === null ? 'substitution cleared' : `now ${catalogId}`)
  }
  if (omitted !== undefined) recorded.push(omitted ? 'left off the order' : 'back on the order')
  if (note !== undefined) {
    // An empty string clears the note the same way null does — the merge deletes both,
    // and a reply reading "note recorded" over a field that was just emptied is the one
    // sentence that would leave the user believing the drawing carries something.
    recorded.push(note === null || note === '' ? 'note cleared' : 'note recorded')
  }

  return {
    overrides: mergeFormworkPartOverride(current, mark, fields as Partial<FormworkPartOverride>),
    recorded,
  }
}
