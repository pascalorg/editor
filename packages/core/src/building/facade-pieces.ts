import type { AnyNode } from '../schema'

type Pt = readonly [number, number] | readonly number[]

/** A line of a building's face: one axis whichever way its walls were drawn, and its offset. */
export type FaceLine = { axis: [number, number]; offset: number; key: string }

/** A straight piece of a face on one storey: the walls on its line, end to end. */
export type FacePiece = { levelId: string; from: number; to: number }

/** The face line through two points: its axis, flipped so walls drawn either way read alike. */
export function faceLine(a: Pt, b: Pt): FaceLine | null {
  const length = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!)
  if (!length) return null
  const ux = (b[0]! - a[0]!) / length
  const uz = (b[1]! - a[1]!) / length
  const flip = ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uz < 0)
  const axis: [number, number] = flip ? [-ux, -uz] : [ux, uz]
  const offset = axis[0] * a[1]! - axis[1] * a[0]!
  return {
    axis,
    offset,
    key: `${Math.round(axis[0] * 100)}:${Math.round(axis[1] * 100)}:${Math.round(offset * 20)}`,
  }
}

/** Where a point falls along a face line. */
export const alongLine = (line: FaceLine, p: Pt) => p[0]! * line.axis[0] + p[1]! * line.axis[1]

/**
 * Every storey's pieces of one face line: the walls lying on it, merged where they meet. A recess
 * or a balcony step leaves the line, so it splits the face into pieces.
 */
export function facePieces(
  nodes: Readonly<Record<string, AnyNode>>,
  line: FaceLine,
  tolerance = 0.05,
): FacePiece[] {
  const off = (p: Pt) => Math.abs(line.axis[0] * p[1]! - line.axis[1] * p[0]! - line.offset)
  const spans = new Map<string, [number, number][]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall' || !node.parentId) continue
    if (off(node.start) > tolerance || off(node.end) > tolerance) continue
    const a = alongLine(line, node.start)
    const b = alongLine(line, node.end)
    spans.set(node.parentId, [
      ...(spans.get(node.parentId) ?? []),
      [Math.min(a, b), Math.max(a, b)],
    ])
  }
  const pieces: FacePiece[] = []
  for (const [levelId, list] of spans) {
    list.sort((p, q) => p[0] - q[0])
    let [from, to] = list[0]!
    for (const [a, b] of list.slice(1)) {
      if (a <= to + tolerance) to = Math.max(to, b)
      else {
        pieces.push({ levelId, from, to })
        ;[from, to] = [a, b]
      }
    }
    pieces.push({ levelId, from, to })
  }
  return pieces
}

const extentKey = (piece: { from: number; to: number }) =>
  `${Math.round(piece.from * 100)}:${Math.round(piece.to * 100)}`

/**
 * The piece a storey's piece takes its columns from: of the pieces overlapping it on the line, the
 * extent the most storeys share; then the one overlapping it most, then the longest. A piece the
 * typical storeys share is its own; a set-back or longer storey follows the typical one.
 */
export function typicalPiece(pieces: readonly FacePiece[], own: FacePiece): FacePiece {
  const overlap = (piece: FacePiece) => Math.min(piece.to, own.to) - Math.max(piece.from, own.from)
  const counts = new Map<string, number>()
  for (const piece of pieces) counts.set(extentKey(piece), (counts.get(extentKey(piece)) ?? 0) + 1)
  return pieces
    .filter((piece) => overlap(piece) > 0)
    .sort(
      (a, b) =>
        counts.get(extentKey(b))! - counts.get(extentKey(a))! ||
        overlap(b) - overlap(a) ||
        b.to - b.from - (a.to - a.from),
    )[0]!
}

/**
 * The pieces a storey's piece takes its columns from: itself when no overlapping piece is shared by
 * more storeys; else the more shared pieces over it, most shared first, never two that overlap.
 */
export function typicalPieces(pieces: readonly FacePiece[], own: FacePiece): FacePiece[] {
  const overlap = (piece: FacePiece) => Math.min(piece.to, own.to) - Math.max(piece.from, own.from)
  const counts = new Map<string, number>()
  for (const piece of pieces) counts.set(extentKey(piece), (counts.get(extentKey(piece)) ?? 0) + 1)
  const ownCount = counts.get(extentKey(own))!
  const seen = new Set<string>()
  const more = pieces
    .filter((piece) => overlap(piece) > 0 && counts.get(extentKey(piece))! > ownCount)
    .filter((piece) => !seen.has(extentKey(piece)) && seen.add(extentKey(piece)))
    .sort(
      (a, b) =>
        counts.get(extentKey(b))! - counts.get(extentKey(a))! ||
        overlap(b) - overlap(a) ||
        b.to - b.from - (a.to - a.from),
    )
  if (!more.length) return [own]
  const chosen: FacePiece[] = []
  for (const piece of more)
    if (!chosen.some((other) => other.from < piece.to && piece.from < other.to)) chosen.push(piece)
  return chosen
}

/** Whether two pieces span the same stretch of their line. */
export const samePiece = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  extentKey(a) === extentKey(b)
