import { pointInPolygon } from '../lib/polygon-relations'
import { distanceToSegment } from '../lib/room-topology-index'
import { polygonAreaAbs } from '../lib/setback-envelope'
import type { PlanLabel, PlanRoom, PlanShape, PlanSymbol } from './plan-symbols'
import { symbolFrame } from './reference-props'

/**
 * What code knows about each label a plan prints (L53): the room it sits in and that room's size,
 * the drawn piece it is printed on, the rooms next door, what is drawn in it. A fast judge reads
 * these facts to name the room type ("WIR" beside "BED 1", 2.8 × 1.8 m, nothing drawn in it); code
 * never guesses a type from the text itself.
 */

type Pt = [number, number]

export type PlanPhrase = { text: string; at: Pt; lines: PlanLabel[] }

/**
 * Lines printed under each other, a short step apart and roughly aligned, are one phrase ("STUDY"
 * over "NOOK", "BED 1" over its size). The step is a share of the plan's extent, so it holds at
 * any scale. Given the plan's shapes, two lines of words printed in different outlines name
 * different things ("KITCHEN" on the floor, "FR" in the bench drawn round the fridge); a printed
 * size still joins its name.
 */
export function labelPhrases(
  labels: readonly PlanLabel[],
  [width, height]: readonly [number, number],
  shapes?: readonly PlanShape[],
): PlanPhrase[] {
  const [dxMax, dyMax] = [width * 0.04, height * 0.04]
  const holders = (at: Pt) =>
    (shapes ?? [])
      .filter((shape) => shape.points.length >= 3 && pointInPolygon(at, shape.points))
      .map((shape) => shape.id)
      .join(' ')
  const together = (a: PlanLabel, b: PlanLabel) =>
    !shapes || !!printedSize(a.text) || !!printedSize(b.text) || holders(a.at) === holders(b.at)
  const sorted = [...labels].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0])
  const groups: PlanLabel[][] = []
  for (const label of sorted) {
    const group = groups.find((lines) => {
      const last = lines.at(-1)!
      const dy = label.at[1] - last.at[1]
      return (
        dy > 0 &&
        dy <= dyMax &&
        Math.abs(label.at[0] - last.at[0]) <= dxMax &&
        together(last, label)
      )
    })
    if (group) group.push(label)
    else groups.push([label])
  }
  return groups.map((lines) => ({
    text: lines.map((line) => line.text).join(' '),
    at: lines[0]!.at,
    lines,
  }))
}

const DIMENSION = /(\d+(?:\.\d+)?)\s*m{0,2}\s*[x×]\s*(\d+(?:\.\d+)?)/i

/** "3.8m x 4.4" → [3.8, 4.4]; millimetres ("3800 x 4400") read as metres. */
function printedSize(text: string): [number, number] | null {
  const match = DIMENSION.exec(text)
  if (!match) return null
  const [a, b] = [Number(match[1]), Number(match[2])]
  return a > 100 || b > 100 ? [a / 1000, b / 1000] : [a, b]
}

/** A drawn piece as a judge reads it: its size, its parts, how many are round. */
export type PlanPiece = { size: [number, number]; parts: number; rounds: number }

export type PlanLabelPlace = {
  /** The words it prints, its lines joined; a printed size is kept apart, in `printed`. */
  name: string
  at: Pt
  /** The room size printed with it, in metres. */
  printed: [number, number] | null
  room: { id: string; area: number; size: [number, number] } | null
  /** The drawn piece it is printed on: a label may name it (FR on a fridge), not the room. */
  on: PlanPiece | null
  /** The other labels printed in its room. */
  alsoIn: string[]
  /** The labels of the rooms a wall's thickness away. */
  neighbours: string[]
  /** What is drawn in its room, largest first. */
  holds: PlanPiece[]
}

/** Rooms this close are next to each other: a wall between them. */
const NEXT_DOOR = 0.4

const toEdge = (polygon: readonly Pt[], point: Pt) =>
  Math.min(
    ...polygon.map((a, i) => distanceToSegment(point, a, polygon[(i + 1) % polygon.length]!)),
  )
const nextDoor = (a: readonly Pt[], b: readonly Pt[]) =>
  a.some((point) => toEdge(b, point) <= NEXT_DOOR) ||
  b.some((point) => toEdge(a, point) <= NEXT_DOOR)

const piece = (symbol: PlanSymbol): PlanPiece => ({
  size: symbol.size,
  parts: symbol.parts,
  rounds: symbol.rounds,
})

export function planLabels({
  contours,
  labels,
  rooms,
  symbols,
}: {
  contours: readonly PlanShape[]
  labels: readonly PlanLabel[]
  rooms: readonly PlanRoom[]
  symbols: readonly PlanSymbol[]
}): PlanLabelPlace[] {
  const points = contours.flatMap((shape) => shape.points)
  const extent: [number, number] = [
    Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])),
  ]
  const shapes = new Map(contours.map((shape) => [shape.id, shape.points]))
  const phrases = labelPhrases(labels, extent, contours)
    .map((phrase) => {
      const words = phrase.lines.filter((line) => !printedSize(line.text))
      const on = symbols.find((symbol) =>
        symbol.ids.some((id) => {
          const outline = shapes.get(id)
          return outline && outline.length >= 3 && pointInPolygon(phrase.at, outline)
        }),
      )
      return {
        name: words.map((line) => line.text).join(' '),
        at: phrase.at,
        printed: phrase.lines.map((line) => printedSize(line.text)).find(Boolean) ?? null,
        room: rooms.find((room) => pointInPolygon(phrase.at, room.polygon as Pt[])) ?? null,
        on: on ?? null,
      }
    })
    .filter((phrase) => /\p{L}/u.test(phrase.name))
  // A room is known next door by the names printed in it, not by what a piece in it is labelled.
  const namesIn = (room: PlanRoom) =>
    phrases.filter((other) => other.room === room && !other.on).map((other) => other.name)
  return phrases.map(
    ({ room, on, ...phrase }): PlanLabelPlace => ({
      ...phrase,
      on: on ? piece(on) : null,
      room: room
        ? {
            id: room.id,
            area: polygonAreaAbs(room.polygon),
            size: symbolFrame(room.polygon, 0).size,
          }
        : null,
      alsoIn: room
        ? phrases
            .filter((other) => other.room === room && other.name !== phrase.name)
            .map((other) => other.name)
        : [],
      neighbours: room
        ? rooms
            .filter((other) => other !== room && nextDoor(room.polygon, other.polygon))
            .flatMap((other) => namesIn(other))
        : [],
      // The piece it is printed on is in its room, wherever the piece's centre falls.
      holds: room
        ? symbols
            .filter((symbol) => symbol.room?.id === room.id || symbol === on)
            .sort((a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1])
            .map(piece)
        : [],
    }),
  )
}
