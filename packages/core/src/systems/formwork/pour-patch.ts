import { z } from 'zod'
import type { CastableKind } from './coverage/elements'
import type { PourUnit } from './pours'

/**
 * How an element is cast, and how a shutter set is rebuilt to match — one contract for
 * every AI surface, because these two are the same conversation.
 *
 * `pours/` owns where the cuts fall and `attach.ts` in `@pascal-app/nodes` owns which
 * shutters survive a rebuild. This owns the layer above both: what an agent may state
 * about the split, what it means by `null`, and — the part that actually costs money if
 * it diverges — what a reply says about what a rebuild *removed*.
 *
 * ## Why the two ship as one module
 *
 * A pour limit and an attach are one decision reached in two calls. Capping a 9 m wall
 * at 3 m lifts turns one pour unit into three and builds nothing, so between the two
 * calls the element is cast in three pours and formed for one, and every quantity read
 * in that window is a third of the truth with nothing in the numbers marking it. So the
 * limit write has to name the re-attach, and the re-attach has to report what it
 * discarded — and both sentences have to be the same on both surfaces, because a
 * discarded-decision count phrased two ways is a user believing two different things
 * were lost.
 *
 * ## What this deliberately cannot do
 *
 * It cannot split anything or reconcile anything. The split needs the element's
 * geometry and its joints; the reconciliation needs the solved layout, which lives in
 * `@pascal-app/nodes`. So each surface runs its own solve and calls this with the
 * results — counts for the prose, values for the writes.
 *
 * It also does not write. The writes come back and the caller applies them, because the
 * callers apply them differently: the chat tools mutate a plain graph on the server,
 * MCP goes through the store's `updateNode`. Both spell "unstate this" as an explicit
 * `undefined`, which is why `null` from a model becomes one here.
 */

/**
 * The pour limits, as a tool's input shape.
 *
 * A raw shape rather than a `z.object` so an MCP `inputSchema` takes it directly and the
 * AI SDK's `tool()` wraps it, without either surface restating a field. Each limit is
 * `.nullable().optional()` because an agent needs three states where the node has two:
 * cap it, leave the cap alone, or take it off.
 */
export const pourLimitsPatchInput = {
  elementId: z.string().min(1),
  maxLiftHeight: z
    .number()
    .finite()
    .positive()
    .nullable()
    .optional()
    .describe(
      'meters — splits the element vertically into lifts. Comes from tie capacity and the pressure envelope, so ask the engineer rather than picking a round number',
    ),
  maxPourLength: z
    .number()
    .finite()
    .positive()
    .nullable()
    .optional()
    .describe(
      'meters — splits it along its length for shrinkage control; water-retaining practice caps a bay at about 7.5 m',
    ),
  maxPourVolume: z
    .number()
    .finite()
    .positive()
    .nullable()
    .optional()
    .describe(
      'cubic meters — splits it by what the batch plant can deliver before the first concrete placed reaches initial set',
    ),
}

export const PourLimitsPatch = z.object(pourLimitsPatchInput)
export type PourLimitsPatch = z.infer<typeof PourLimitsPatch>

/** The description every surface's pour-limit write carries. */
export const SET_POUR_LIMITS_DESCRIPTION =
  'Set the pour limits that split a wall or column into separately cast units. maxLiftHeight splits it vertically (a 9 m wall capped at 3 m is poured in three lifts); maxPourLength splits it along its length for shrinkage control (water-retaining practice caps a bay at about 7.5 m); maxPourVolume splits it by what the batch plant can deliver before the first concrete reaches initial set. A slab is always one pour unit and none of these three split it — both cuts run along a centreline and a slab has none, so dividing a slab into bays is a polygon partition this model does not do yet. Each split unit needs its own shutter and changing a limit does not build them, so on an already-shuttered element you must call attach_formwork afterwards — until you do, the element is cast in more pours than it is formed for and its takeoff is short by the difference. Pass null to clear a limit. Ask the engineer for these values rather than guessing — they come from tie capacity, the pressure envelope, and the supply rate.'

/** The description every surface's attach carries. */
export const ATTACH_FORMWORK_DESCRIPTION =
  "Generate or update the formwork for a wall, column or slab, built for that kind: two tied faces for a wall, a clamped box or wrapped shaft for a column, a propped soffit deck plus edge forms for a slab. Only the faces the pour sequence actually leaves exposed are formed. An element with a lift cap or an expansion joint gets one assembly per pour unit, since each is erected, poured and struck separately. Call this after set_element_construction once formworkType is not 'none' — the user wants to see the formwork, not just set the properties. Safe to call again on an element that is already shuttered: it reconciles rather than duplicating, so a pour unit that still exists keeps its existing shutter and every per-part decision on it, only genuinely new pour units are built, and shutters whose pour unit has gone are removed. Call it again after any change to the pour limits, and read back what it reports — if it says decisions were discarded, tell the user which."

/**
 * The refusal for an element nothing is formed on yet.
 *
 * Shared because both surfaces reach it the same way — a user asks for the shutter
 * before saying what system it is — and because the remedy is a specific other call.
 * `formworkType` absent is not a wall awaiting a default: nothing is shuttered on the
 * user's behalf, so an attach that quietly picked plywood would put a bill on the job
 * nobody specified.
 */
export function noFormworkTypeSet(elementId: string): string {
  return `Error: ${elementId} has no formworkType set, so nothing is formed. Call set_element_construction first.`
}

const POUR_LIMIT_UNITS = {
  maxLiftHeight: 'm',
  maxPourLength: 'm',
  maxPourVolume: 'm³',
} as const

type PourLimitField = keyof typeof POUR_LIMIT_UNITS

export type PourLimitsPatchResult =
  | { error: string; writes?: undefined; changed?: undefined; caveat?: undefined }
  | {
      error?: undefined
      /** The fields to write. An explicit `undefined` clears rather than stores. */
      writes: Record<string, number | undefined>
      /** What the call changed, in the words a reply reads back. */
      changed: string[]
      /** Set when the limits were recorded on something they cannot split. */
      caveat?: string
    }

/**
 * What a stated set of pour limits does to an element — the writes, or the refusal.
 *
 * The slab caveat is the reason `kind` is a parameter. A slab accepts all three fields,
 * because the schema shares `CastableFields` across the three castable kinds, and the
 * splitter ignores every one of them — so a limit set on a slab is a silent no-op, and
 * "ok" over it reads as a slab about to be poured in bays. Reported rather than refused,
 * because the intent is legitimate and outlives this phase: the field records what the
 * engineer wants the day a polygon partition exists to act on it.
 */
export function applyPourLimitsPatch(
  kind: CastableKind,
  patch: Omit<PourLimitsPatch, 'elementId'>,
): PourLimitsPatchResult {
  const stated = (Object.keys(POUR_LIMIT_UNITS) as PourLimitField[]).filter(
    (field) => patch[field] !== undefined,
  )
  if (stated.length === 0) {
    return { error: 'Error: nothing to set — pass maxLiftHeight, maxPourLength or maxPourVolume' }
  }

  const writes: Record<string, number | undefined> = {}
  const changed: string[] = []
  for (const field of stated) {
    const value = patch[field]
    // `null` from a model means "take this cap off", which both callers spell as an
    // explicit `undefined`. An absent key means "leave it alone", so the two cannot be
    // collapsed — a key holding undefined would clear a cap nobody mentioned.
    writes[field] = value ?? undefined
    changed.push(
      value === null ? `${field} cleared` : `${field} ${value} ${POUR_LIMIT_UNITS[field]}`,
    )
  }

  const caps = stated.some((field) => patch[field] !== null)
  return {
    writes,
    changed,
    caveat:
      kind === 'slab' && caps
        ? 'A slab is cast as one pour, so this does not split it — the limit is recorded, not acted on'
        : undefined,
  }
}

/** Millimetre-ish resolution, the same figure every formwork reply rounds to. */
const round = (value: number): number => Math.round(value * 1000) / 1000

/** A one-line summary of the split an LLM can read back without re-deriving it. */
function describePourUnits(units: readonly PourUnit[]): string {
  const segments = new Set(units.map((unit) => unit.segmentIndex)).size
  const lifts = new Set(units.map((unit) => unit.liftIndex)).size
  const parts: string[] = []
  if (segments > 1) parts.push(`${segments} bays along it`)
  if (lifts > 1) parts.push(`${lifts} lifts up it`)
  const volume = units.reduce((sum, unit) => sum + unit.volumeCuM, 0)
  return `${parts.join(' × ')}, ${round(volume)} m³ total`
}

/**
 * How the element is cast, as one clause. Shared so a split reported on one surface and
 * re-read on the other is the same sentence about the same concrete.
 */
export function describePourSplit(units: readonly PourUnit[]): string {
  return units.length <= 1
    ? 'cast in one pour'
    : `cast in ${units.length} pours: ${describePourUnits(units)}`
}

/** What a reconcile did, in counts — everything the reply needs and no solve. */
export interface FormworkReconciliationCounts {
  /** Shutters on the host before the call. Zero means this is the first attach. */
  existing: number
  /** Kept untouched, part decisions and all. */
  keep: number
  /** Built, because their pour unit had no shutter. */
  create: number
  /** Removed, because their pour unit no longer exists. */
  orphan: number
  /** Per-part decisions recorded on the removed shutters, which die with them. */
  discardedPartDecisions: number
  /** Construction joints the split created that were not already in the scene. */
  joints: number
}

/**
 * What the rebuild did, in the words both surfaces say it in.
 *
 * The wording carries three distinctions the counts alone do not. A first attach is not
 * a rebuild, so it does not talk about keeping anything. A re-attach that changed
 * nothing has to say so outright — otherwise a model reports work it did not do, and
 * the user believes a shutter was replaced when it was left alone. And a removal has to
 * name what it cost: the discarded count is the only trace of a decision somebody
 * recorded and this call just deleted, which is why the sentence tells the model to
 * pass it on rather than leaving it as one number among six.
 */
export function describeFormworkReconciliation(counts: FormworkReconciliationCounts): string {
  const { create, discardedPartDecisions: discarded, existing, joints, keep, orphan } = counts
  const total = keep + create
  if (existing === 0) {
    return total === 1
      ? 'ok'
      : `ok — ${total} assemblies, one per pour unit, and ${joints} construction ${joints === 1 ? 'joint' : 'joints'} between them`
  }
  if (create === 0 && orphan === 0) {
    return `ok — already shuttered to match the pour: ${total} ${total === 1 ? 'assembly' : 'assemblies'}, unchanged. Every part decision on ${total === 1 ? 'it' : 'them'} is intact.`
  }
  const parts = [`now ${total} ${total === 1 ? 'assembly' : 'assemblies'}, one per pour unit`]
  if (create > 0) parts.push(`${create} added`)
  if (keep > 0) parts.push(`${keep} kept with ${keep === 1 ? 'its' : 'their'} part decisions`)
  if (orphan > 0) {
    parts.push(
      `${orphan} removed as ${orphan === 1 ? 'its pour unit' : 'their pour units'} no longer ${orphan === 1 ? 'exists' : 'exist'}${discarded > 0 ? `, discarding ${discarded} part ${discarded === 1 ? 'decision' : 'decisions'} recorded on ${orphan === 1 ? 'it' : 'them'} — say so` : ''}`,
    )
  }
  return `ok — ${parts.join('; ')}`
}
