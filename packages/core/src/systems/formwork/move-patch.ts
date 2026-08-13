import { z } from 'zod'
import type { FormworkResequence, ResequenceAnswer, ResequenceMove } from './resequence'

/**
 * Naming one resequencing proposal, so a caller can come back and take it.
 *
 * `resequence.ts` proposes; nothing until now could accept. Every surface printed "push
 * formwork-assembly_2 eight days" and then left the user to open the shutter's inspector and
 * retype the date — which is the one place in this feature where the answer was further from
 * being actionable than the arithmetic behind it was.
 *
 * ## Why the days are in the key
 *
 * This is the opposite decision from `findingKey`, and the difference is worth reading. A
 * finding's key holds no figures deliberately: a fix that moves a joint from 4.00 m to 2.67 m
 * and leaves it crossing the opening is the same defect unfixed, and a key carrying the
 * elevation would report it cleared. A *move* is the reverse — the figure is the decision. A
 * proposal to push a pour 35 days and a proposal to push it 30 are two different acts, and
 * the second one is what the engine now says after somebody dated another pour.
 *
 * So a key that outlived its own arithmetic is refused rather than applied: the caller re-reads
 * the takeoff and takes the move the current programme offers. A stale key applied silently
 * would write a date measured against a float that no longer exists, which is exactly the
 * "these moves cannot be taken together" caveat being broken by the tool that prints it.
 *
 * ## Why the catalog id is in it too
 *
 * A pour standing in two overlaps is offered twice, once per short item, and the two entries
 * can carry the same shift. They are the same write and not the same decision: the reader
 * accepted a move to relieve *panels*, and whether that worked is a question about panels. The
 * id is what the second measurement is taken on, so it belongs to the key rather than to the
 * caller's memory of which row was clicked.
 *
 * ## Why there is no `committed` flag here
 *
 * For `schedule-patch.ts`'s reason, one step further along. Accepting a proposal and agreeing
 * the new day with a hire desk are two acts, and the pour has just moved — so a call that did
 * both would book plant against a date nobody has taken to the hire company yet. Applying a
 * move leaves the new date an intent, which is what it is, and `commit_pour` is the second
 * decision made second.
 */

/**
 * The handle for one proposal: which shortage, which pour, how far.
 *
 * Sorted members are deliberately *not* in it. A monolithic pour's membership is a property
 * of the scene rather than of the proposal, so a key holding it would go stale on an edit
 * that does not change the move at all — and the members are re-read from the current
 * programme when the move is planned, which is where a changed group has to be caught.
 */
export function moveKey(catalogId: string, move: ResequenceMove): string {
  return `${catalogId}|${move.pourId}|${move.days}`
}

/** The proposal a caller named, with the shortage it is against, or nothing. */
export function resequenceMoveByKey(
  resequence: FormworkResequence,
  key: string,
): { answer: ResequenceAnswer; move: ResequenceMove } | undefined {
  for (const answer of resequence.answers) {
    for (const move of answer.moves) {
      if (moveKey(answer.catalogId, move) === key) return { answer, move }
    }
  }
  return undefined
}

/**
 * The refusal for a key the current proposals do not carry.
 *
 * Its own sentence, and it names the likeliest cause rather than reporting a missing record:
 * the move was real when it was read and the programme has moved since — somebody dated a
 * pour, committed one, or took an earlier proposal — so the engine now offers a different
 * shift for the same pour. Shared, so both AI surfaces say it once.
 */
export function noSuchMove(key: string): string {
  return `Error: no current resequencing proposal keyed ${key}. That is usually a proposal that has been superseded rather than a bad key: every move's shift was measured against the other pours' stated dates, so dating or moving any pour re-measures all of them. Read inspect_project_formwork again and take a key from moveInsteadOfBuying in that reply.`
}

/**
 * The whole write, as a tool's input shape.
 *
 * One field, because everything else about the move is the engine's: the pour, the shift, the
 * members and the new date all come off the proposal. A tool that also took a date would let a
 * caller apply its own figure under the proposal's name, which is `fix_formwork_finding`'s
 * reason for taking a key and no values.
 */
export const applyPourMoveInput = {
  moveKey: z
    .string()
    .min(1)
    .describe(
      "the move to take, from inspect_project_formwork's moveInsteadOfBuying[].moves[].key — not composed by hand. Read the proposals in the same call you apply from: a key from an earlier reply may name a shift the current programme no longer offers",
    ),
}

export const ApplyPourMovePatch = z.object(applyPourMoveInput)
export type ApplyPourMovePatch = z.infer<typeof ApplyPourMovePatch>

export const APPLY_POUR_MOVE_DESCRIPTION =
  "Take one resequencing proposal: re-date every shutter in the pour it names, then re-solve and report whether the shortage it was against actually cleared. This is the write that closes the loop inspect_project_formwork opens — moveInsteadOfBuying says which pour to move to stop being short of plant, and until this was called the user had to go to each shutter and retype the date. Pass the key from a move in that reply and nothing else: the pour, the shift, the members and the new date are all the engine's, and a call that also took a date would apply your figure under the proposal's name. Three things to carry back from the answer rather than assuming them. It reports the peak a second sweep of the written programme actually measured against the peak the proposal predicted, because the proposal was computed on a copy of the programme and the write lands in the real one — where those two disagree, the proposal is what was wrong and the measurement is the answer. It reports what the move raised elsewhere, since relieving panels by landing a pour beside another can leave the job short of props instead, and a move that traded one shortage for another is a move somebody wants to know about before they order anything. And it applies exactly one move: every other proposal in that reply had its float measured against this pour's old date, so they are all stale now — re-read the takeoff before taking a second one, and never apply two keys from the same reply. The new date is an intent and not a booking: applying a move does not commit anything, so call commit_pour separately once the user has agreed the new day with the hire company and the following trades. A proposal against a pour somebody has already committed is refused rather than applied, because moving booked plant is a phone call rather than an edit."
