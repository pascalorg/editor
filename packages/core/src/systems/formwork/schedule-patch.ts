import { z } from 'zod'
import { isCalendarDate } from './schedule'

/**
 * When a pour happens, as an *agent* states it — one write contract for every AI surface,
 * and one reading of it.
 *
 * `schedule.ts` owns what a date means once it is recorded. This owns the step before it:
 * what an agent may say, what it means by `null`, and which strings are dates. It exists
 * for the reason `settings-patch.ts` and `part-patch.ts` do, and the hazard is sharper
 * here than for either: the assembly's own schema validates a date with a regex, so
 * `2026-02-30` passes it, and `Date.UTC` rolls it forward to 1 March without complaint. A
 * surface missing that check does not fail — it programmes a pour for a day the user never
 * typed, and prints it beside the strike date derived from it.
 *
 * ## Why the write is per shutter and not per element
 *
 * Because a pour is. A 9 m wall in three lifts is three pours a week apart, and a date on
 * the wall could only be one of them — which is the same reason the assembly node exists
 * at all. So the tool addresses an assembly id, and a caller that has only an element id
 * has to read the shutters first. That is a real cost in tool calls and it buys the one
 * thing a programme cannot do without: a row per pour.
 *
 * ## What this deliberately does not do
 *
 * It does not derive. No dependency, no float, no lag from the pour before it — a stated
 * date is the whole input, and there is no `set_pour_date` variant that dates the next
 * lift from this one. A derived programme would sit beside geometry that really is derived
 * and read with the same authority, and nothing in the model records what a pour waits on.
 *
 * It does not write, for the reason the sibling patches do not: the chat tools mutate a
 * plain graph on the server, MCP goes through the store's `updateNode`, and both spell
 * "unstate this" as an explicit `undefined`.
 *
 * ## Two writes, because stating a date and agreeing one are different acts
 *
 * `applyPourDatePatch` records what the project intends and `applyCommitPourPatch` records
 * that somebody has agreed to it. One tool with a `committed` flag would let a single call
 * do both, which is the one combination worth making impossible: a model that has been
 * asked to move a pour would carry the commitment along with it, and a booking would follow
 * a date it was never made against.
 */

/**
 * The whole write, as a tool's input shape.
 *
 * A raw shape rather than a `z.object` so an MCP `inputSchema` takes it directly and the
 * AI SDK's `tool()` wraps it, without either surface restating a field. `pourAt` is
 * `.nullable()` and *required*, unlike the sibling patches' optional fields: there is one
 * field here, so an absent one leaves nothing to do, and `null` is how a date is taken
 * back off a pour that is no longer programmed.
 */
export const pourDatePatchInput = {
  assemblyId: z
    .string()
    .min(1)
    .describe(
      "the shutter's own id, from inspect_project_formwork's schedule.pours — not the wall's id. A wall cast in three lifts has three shutters and three dates",
    ),
  pourAt: z
    .string()
    .max(10)
    .nullable()
    .describe(
      'the day this pour is cast, YYYY-MM-DD. Null takes the date off, so the pour goes back to unprogrammed and carries no dates at all. Ask the user for it — nothing in this model derives a pour date from anything, and a date you inferred from the order the shutters were built is a programme nobody agreed to',
    ),
}

export const PourDatePatch = z.object(pourDatePatchInput)
export type PourDatePatch = z.infer<typeof PourDatePatch>

/** The description every surface's write tool carries, so the guidance cannot diverge. */
export const SET_POUR_DATE_DESCRIPTION =
  "Record the day one pour is cast, which is what turns the striking periods into a programme: a delivery date to book the plant against, a strike date, and the day the set is free for the next pour. It is per shutter rather than per element, because a pour is — a 9 m wall capped at 3 m lifts is three pours on three days, and a date on the wall could only be one of them — so pass the assembly id from inspect_project_formwork's schedule.pours, not the element id. Ask the user for the date and never infer one. Nothing in this model computes a programme from dependencies or float, so there is no sequence to read a date off, and a date you derived from the order the shutters happen to be in would print beside geometry that genuinely is derived and carry the same authority. Two lead times go with it and are set once for the project with set_formwork_settings schedule: how many days before a pour the plant is wanted on site, and how many after striking before it is back with the hire company. Without the first there is no delivery date at all; without the second the takeoff shows the set free the day it is struck, which is a floor rather than an answer. Pass null to take a date off. One thing to carry back to the user when you read the programme afterwards: under ACI 347 the strike dates are the earliest the forms could come off rather than the dates, because the code counts qualifying hours above 10 °C and nothing here knows the weather."

/**
 * The refusal for an assembly id that names no shutter.
 *
 * Shared because both surfaces resolve the id against a live scene and both will be handed
 * one a model built out of an element id — `wall_1` where it wanted `fwasm_…`, which is the
 * likeliest mistake this tool invites. Named separately from the element-scoped refusals so
 * the remedy in the sentence is the read that actually lists pours.
 */
export function unknownAssembly(assemblyId: string): string {
  return `Error: no formwork assembly with id ${assemblyId}. A pour date goes on a shutter rather than on an element, so pass an id from inspect_project_formwork's schedule.pours — an element id will not resolve.`
}

export type PourDatePatchResult =
  | { error: string; writes?: undefined; recorded?: undefined }
  | {
      error?: undefined
      /** The fields to write. An explicit `undefined` clears rather than stores. */
      writes: { pourAt: string | undefined }
      /** What the call recorded, in the words a reply reads back. */
      recorded: string
    }

/**
 * What a stated pour date does to a shutter — the write, or the refusal.
 *
 * The calendar check is the whole reason this is a function rather than a schema. A regex
 * cannot tell February from March, so `2026-02-30` would be stored, silently read as 1
 * March by every date in the programme derived from it, and reported back to the user as
 * the date they gave. Refused with the date quoted, because a model that has been told
 * "ok" will tell the user the pour is programmed for the 30th.
 */
export function applyPourDatePatch(patch: Omit<PourDatePatch, 'assemblyId'>): PourDatePatchResult {
  const { pourAt } = patch
  if (pourAt === null) return { writes: { pourAt: undefined }, recorded: 'pour date cleared' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pourAt)) {
    return {
      error: `Error: "${pourAt}" is not a date in YYYY-MM-DD form. A pour date is a day rather than a timestamp, because every period it is added to is tabulated in days.`,
    }
  }
  if (!isCalendarDate(pourAt)) {
    return {
      error: `Error: there is no such day as ${pourAt}. Stored, it would be read as the day it rolls forward to and the whole programme would be a day out.`,
    }
  }
  return { writes: { pourAt }, recorded: `pour date ${pourAt}` }
}

/**
 * Committing a pour — the write that turns a stated date into an agreed one.
 *
 * `pourAt` is required here and `committed` is the boolean, which is the opposite way round
 * from how it is stored, and deliberately. A caller commits *a pour*, not *a day*: it has
 * the programme in front of it and the question is whether this pour's date is agreed. Being
 * asked to restate the date it is committing to would let it commit to a different one by
 * typing, which is a booking nobody made — and an agent that had misread the programme could
 * commit a pour to a day the programme does not have. So the day comes off the pour and the
 * caller says yes or no.
 */
export const commitPourInput = {
  assemblyId: z
    .string()
    .min(1)
    .describe(
      "the shutter's own id, from inspect_project_formwork's schedule.pours — not the wall's id",
    ),
  committed: z
    .boolean()
    .describe(
      'true to commit this pour to the day it is currently dated, false to release the commitment. Committing does not change the date — it records that somebody has agreed to it, which is what stops the resequencing proposals offering to move it. Only ever pass true when the user has actually agreed the date with whoever is affected: a commitment is a hire booking and a following trade being told, not a level of confidence',
    ),
}

export const CommitPourPatch = z.object(commitPourInput)
export type CommitPourPatch = z.infer<typeof CommitPourPatch>

export const COMMIT_POUR_DESCRIPTION =
  'Record that a pour date has been agreed rather than merely intended — the plant is booked against it and the following trades have been told. Every date in this model is a stated intent until this is called: free for anybody to move, and offered up by the resequencing proposals as a candidate to shift to save hiring plant. Committing a pour takes it out of that pool, so the proposals only ever suggest moves somebody can still make. It does not change the date and it is not a confidence level: only pass committed: true when the user says the date is agreed with the hire company and the trades that follow, and pass false to release it. Ask rather than infer — an agent that commits a pour on its own has told the takeoff that a booking exists, and the next proposal it makes will route around a phone call nobody made. One consequence worth reading back afterwards: moving a committed pour with set_pour_date is allowed and is not an error, because sites do move booked pours, but the takeoff will then report the pour as having drifted off its booking, which is a call to the hire desk rather than a state to leave standing.'

/** The refusal for committing a pour nobody has dated. */
export function commitWithoutDate(assemblyId: string): string {
  return `Error: ${assemblyId} has no pour date, so there is nothing to commit to. A commitment is an agreement about a *day* — set the date with set_pour_date first, and commit it once the user has agreed it with the hire company and the following trades.`
}

export type CommitPourPatchResult =
  | { error: string; writes?: undefined; recorded?: undefined }
  | {
      error?: undefined
      writes: { committedPourAt: string | undefined }
      recorded: string
    }

/**
 * What committing does to a shutter, given the date it currently carries.
 *
 * Takes `pourAt` from the caller rather than the patch for the reason above: the day
 * committed to is the day the pour *has*, so it cannot be typed and cannot disagree. A
 * commit against an undated pour is refused rather than stored as a commitment to nothing.
 */
export function applyCommitPourPatch(
  patch: Omit<CommitPourPatch, 'assemblyId'>,
  pourAt: string | undefined,
  assemblyId: string,
): CommitPourPatchResult {
  if (!patch.committed) {
    return { writes: { committedPourAt: undefined }, recorded: 'commitment released' }
  }
  if (pourAt === undefined) return { error: commitWithoutDate(assemblyId) }
  return { writes: { committedPourAt: pourAt }, recorded: `committed to ${pourAt}` }
}
