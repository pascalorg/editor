import type { FURNISHED_ROOM_TYPES } from '../agent-tools/furnish-room'
import type { PlanLabelPlace } from './plan-labels'

/**
 * The question furnish_from_plan puts to the host's fast judge (L53): what a label names. It
 * never asks what a drawing is: a text judge does not recognise drawings from words about them
 * (3 of 20 symbols on the 290); the agent picks from the marked plan. Code measures and gives the facts; the judge picks
 * one choice and says how sure it is; below the threshold code abstains and the agent decides.
 * Core stays provider-free: the host answers (Jev behind a server key), and a judge that fails, or
 * none at all, leaves every choice to the agent.
 */

/** One question: the judge reads `state` and picks one of `choices` (key → what it means). */
export type PlanQuestion = {
  id: string
  state: Record<string, string | string[]>
  question: string
  choices: Readonly<Record<string, string>>
}
/** The judge's pick and its probability. */
export type PlanAnswer = { choice: string; sure: number }
/** One answer per question, in order; null where it could not judge. */
export type PlanJudge = (questions: readonly PlanQuestion[]) => Promise<(PlanAnswer | null)[]>

type FurnishedRoomType = (typeof FURNISHED_ROOM_TYPES)[number]
export type LabelRoomType = FurnishedRoomType | 'not_a_room'

/** furnish_room's room types, what is no room, and the room of another kind the judge may not force. */
export const ROOM_LABEL_CHOICES = {
  bedroom: 'A bedroom.',
  kitchen: 'A kitchen.',
  bathroom: 'A room with a WC, a shower, a bath or a basin: a bathroom, an ensuite, a powder room.',
  living: 'A living room: a lounge, a family room, a media room.',
  dining: 'A dining room or a meals area.',
  hallway: 'A hallway or a corridor.',
  entry: 'An entry: a foyer or an entrance hall.',
  laundry: 'A laundry.',
  storage:
    'A storage room one walks into: a walk-in robe or closet, a walk-in pantry, a store room.',
  not_a_room:
    'No room: a cupboard or a robe built into a wall, an appliance or a fixture, a note, a level or a dimension.',
  other: 'A room of a kind not listed here: a garage, a study, an outdoor room, or another.',
} as const satisfies Record<LabelRoomType | 'other', string>

/** Below this, code keeps no answer: the label names the room and the agent decides its type. */
export const LABEL_SURE = 0.6

const m = (value: number) => value.toFixed(1)
const size = ([a, b]: readonly number[]) => `${m(a!)} × ${m(b!)} m`
const piece = (p: { size: [number, number]; parts: number; rounds: number }) =>
  `a ${size(p.size)} piece${p.parts > 1 ? ` of ${p.parts} parts` : ''}${p.rounds ? ` (${p.rounds} drawn round)` : ''}`
const quoted = (names: readonly string[]) => names.map((name) => `"${name}"`).join(', ')

/** What code measured about the label, in words; it names no type. */
function labelFacts(place: PlanLabelPlace): string[] {
  const { room } = place
  return [
    room
      ? `It is printed in a room of ${m(room.area)} m², about ${size(room.size)}.`
      : // What code knows: no outline round it. A vectoriser fills some rooms only, so the label
        // may still name a room.
        'The plan draws no room outline round it, so its size is unknown.',
    ...(place.printed ? [`The plan prints a size with it: ${size(place.printed)}.`] : []),
    ...(place.on ? [`It is printed on a drawn piece: ${piece(place.on)}.`] : []),
    ...(place.alsoIn.length ? [`Also printed in the same room: ${quoted(place.alsoIn)}.`] : []),
    ...(place.neighbours.length ? [`Next to it: ${quoted(place.neighbours)}.`] : []),
    ...(room
      ? [
          place.holds.length
            ? `Drawn in it: ${place.holds.slice(0, 6).map(piece).join('; ')}.`
            : 'Nothing is drawn in it.',
        ]
      : []),
  ]
}

export function labelQuestion(id: string, place: PlanLabelPlace): PlanQuestion {
  return {
    id,
    state: { plan_label: place.name, facts: labelFacts(place) },
    question:
      'On this house plan, what does `plan_label` name? `facts` say where it is printed and what is drawn around it.',
    choices: ROOM_LABEL_CHOICES,
  }
}

/** The room type the answer names, `not_a_room`, or null: no answer, unsure, or another kind. */
export function roomTypeOf(answer: PlanAnswer | null, sure = LABEL_SURE): LabelRoomType | null {
  if (!answer || answer.sure < sure || answer.choice === 'other') return null
  return answer.choice in ROOM_LABEL_CHOICES ? (answer.choice as LabelRoomType) : null
}
