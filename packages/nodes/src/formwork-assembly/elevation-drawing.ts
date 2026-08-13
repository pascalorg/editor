import {
  type ElevationPiece,
  elevationCaveats,
  type ShutterElevation,
} from '@pascal-app/core/formwork'
import { FACE_ROLE_LABELS } from './face-labels'

/**
 * The shutter elevation as something a crew sets out from.
 *
 * The arithmetic finished before this file starts: the wall builder emits `ShutterElevation`
 * from the same pass that places the meshes, in the pour's own frame. What was missing is the
 * only form of that answer somebody can work to — a face of the wall with the panels drawn on
 * it, each carrying its mark, the tie holes on the same picture and the freeboard visible as a
 * band above the concrete. A parts table already says a panel is at 1250 mm; it cannot say
 * which panel is beside it, and that is what erecting needs.
 *
 * ## Shapes, and the same reason as the cut sheet
 *
 * This emits drawn shapes rather than markup or an element tree, because there are two
 * consumers and neither may decide independently what an elevation looks like: the panel draws
 * it in the sidebar and `elevationSvg` writes the file that is printed, issued and checked
 * against the engineer's. A second implementation of the layout would be a printed drawing
 * that disagrees with the screen about which course a tie is in.
 *
 * ## Millimetres up the wall, and Y measured the way a wall is
 *
 * The coordinates are the elevation's own, unscaled, so a reader who measures the drawing gets
 * the setting-out. One inversion happens here and nowhere else: `ShutterElevation` measures Y
 * *up* from the pour base, because that is how a wall is dimensioned, and SVG measures it
 * down. Flipping at the shape layer rather than with a transform on the group is deliberate —
 * a `scale(1 -1)` would mirror the text with the rectangles, and a mark painted backwards on a
 * shop drawing is worse than no mark.
 *
 * ## What is on it, and what is deliberately not
 *
 * The shutter face only: no walers, no rakers, no scaffold. They are all in the parts list and
 * a face carrying them is a face whose marks cannot be read. The two things drawn that are not
 * shutter are the ones an absence would be read as a decision — the concrete line, so a pour
 * is not quoted to the top of the panels, and the dropped tie stations, because a rod on the
 * engineer's drawing and nothing here is what somebody queries.
 */

/** Concrete colours, because a printed SVG carries no stylesheet. */
export const ELEVATION_COLORS = {
  ground: '#0c0c0d',
  panel: '#1e3a5f',
  panelEdge: '#60a5fa',
  filler: '#4c1d95',
  fillerEdge: '#a78bfa',
  cut: '#78350f',
  cutEdge: '#fbbf24',
  corner: '#134e4a',
  cornerEdge: '#2dd4bf',
  opening: '#0c0c0d',
  openingEdge: '#6b7280',
  tie: '#f87171',
  tieDropped: '#fbbf24',
  concrete: '#4ade80',
  course: '#6b7280',
  mark: '#e5e7eb',
  dim: '#9ca3af',
  title: '#e5e7eb',
} as const

/** Text heights in millimetres, since the drawing is in millimetres. */
const MARK_MM = 70
const DIM_MM = 46
const TITLE_MM = 60

/** A tie hole is drawn at a readable size rather than at the rod's own 20-odd mm. */
const TIE_RADIUS_MM = 26

/** Under this a piece cannot hold a horizontal mark, so the label turns with the piece. */
const MIN_HORIZONTAL_LABEL_MM = 300

export type ElevationShape =
  | {
      kind: 'piece'
      piece: ElevationPiece['kind']
      xMm: number
      yMm: number
      widthMm: number
      heightMm: number
    }
  | { kind: 'opening'; xMm: number; yMm: number; widthMm: number; heightMm: number }
  | { kind: 'tie'; xMm: number; yMm: number; dropped: boolean }
  /** A horizontal joint between courses, or the concrete line. */
  | { kind: 'course'; yMm: number; toXMm: number }
  | { kind: 'concrete'; yMm: number; toXMm: number }
  | {
      kind: 'label'
      xMm: number
      yMm: number
      text: string
      role: 'mark' | 'dim' | 'concrete'
      /** Set where the label runs up the piece rather than across it. */
      turned?: true
    }

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * The shapes one face draws as, in paint order.
 *
 * Pieces first, then the openings over them — a void is drawn *over* the boards because the
 * boards stop at it and the hole is what a reader is looking for — then the joints, and the
 * ties last of all: a tie sits on a panel joint as often as not, and a rod hidden under the
 * line it shares with a joint is the one thing on this drawing that must not be ambiguous.
 */
export function elevationShapes(
  elevation: ShutterElevation,
  face: { pieces: readonly ElevationPiece[] },
): ElevationShape[] {
  const shapes: ElevationShape[] = []
  const topMm = Math.max(elevation.formTopMm, elevation.concreteTopMm)
  /** SVG counts down and a wall is dimensioned up, so every Y is flipped here. */
  const flip = (yMm: number) => round(topMm - yMm)

  for (const piece of face.pieces) {
    shapes.push({
      kind: 'piece',
      piece: piece.kind,
      xMm: round(piece.xMm),
      yMm: flip(piece.yMm + piece.heightMm),
      widthMm: round(piece.widthMm),
      heightMm: round(piece.heightMm),
    })
  }
  for (const opening of elevation.openings) {
    shapes.push({
      kind: 'opening',
      xMm: round(opening.xMm),
      yMm: flip(opening.yMm + opening.heightMm),
      widthMm: round(opening.widthMm),
      heightMm: round(opening.heightMm),
    })
  }
  // Between the courses only. A line at the base and the top of the stack would draw over the
  // shutter's own outline and read as two more joints than the wall has.
  for (const course of elevation.courses.slice(0, -1)) {
    shapes.push({ kind: 'course', yMm: flip(course.topMm), toXMm: round(elevation.runMm) })
  }
  // The concrete line, where it is not the top of the drawing: the band above it is hired
  // panel holding nothing back, and a pour quoted to the top of the shutter is quoted high.
  if (elevation.formTopMm > elevation.concreteTopMm) {
    shapes.push({
      kind: 'concrete',
      yMm: flip(elevation.concreteTopMm),
      toXMm: round(elevation.runMm),
    })
  }
  for (const tie of elevation.ties) {
    shapes.push({ kind: 'tie', xMm: round(tie.xMm), yMm: flip(tie.yMm), dropped: false })
  }
  for (const tie of elevation.tiesDropped) {
    shapes.push({ kind: 'tie', xMm: round(tie.xMm), yMm: flip(tie.yMm), dropped: true })
  }

  // Marks last, over everything, because the mark is what the drawing is for. One label per
  // rectangle rather than per mark: a panel crossed by a window is two bands of one panel and
  // a crew reads the band in front of them.
  for (const piece of face.pieces) {
    const turned = piece.widthMm < MIN_HORIZONTAL_LABEL_MM
    const cx = round(piece.xMm + piece.widthMm / 2)
    const cy = flip(piece.yMm + piece.heightMm / 2)
    const room = turned ? piece.heightMm : piece.widthMm
    const depth = turned ? piece.widthMm : piece.heightMm
    if (room < MARK_MM * 2 || depth < MARK_MM) continue
    shapes.push({
      kind: 'label',
      xMm: cx,
      yMm: cy,
      text: piece.mark,
      role: 'mark',
      ...(turned ? { turned: true } : {}),
    })
    // The size on the piece, because the one thing a crew checks before setting a panel is
    // that the rectangle in front of them is the size the drawing claims.
    if (room > MARK_MM * 5 && depth > MARK_MM + DIM_MM * 2) {
      shapes.push({
        kind: 'label',
        xMm: turned ? round(cx + MARK_MM * 0.9) : cx,
        yMm: turned ? cy : round(cy + MARK_MM * 0.9),
        text: `${Math.round(piece.widthMm)} × ${Math.round(piece.heightMm)}`,
        role: 'dim',
        ...(turned ? { turned: true } : {}),
      })
    }
  }
  if (elevation.formTopMm > elevation.concreteTopMm) {
    shapes.push({
      kind: 'label',
      xMm: round(elevation.runMm / 2),
      yMm: round(flip(elevation.concreteTopMm) - DIM_MM * 0.5),
      text: `concrete ${Math.round(elevation.concreteTopMm)} — ${Math.round(elevation.formTopMm - elevation.concreteTopMm)} mm freeboard over`,
      role: 'concrete',
    })
  }
  return shapes
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The two colours a piece kind draws in — fill, then edge. */
export function pieceColors(kind: ElevationPiece['kind']): { fill: string; edge: string } {
  const c = ELEVATION_COLORS
  if (kind === 'panel') return { fill: c.panel, edge: c.panelEdge }
  if (kind === 'filler') return { fill: c.filler, edge: c.fillerEdge }
  if (kind === 'corner') return { fill: c.corner, edge: c.cornerEdge }
  return { fill: c.cut, edge: c.cutEdge }
}

function fontMm(role: 'mark' | 'dim' | 'concrete'): number {
  return role === 'mark' ? MARK_MM : DIM_MM
}

function shapeMarkup(shape: ElevationShape): string {
  const c = ELEVATION_COLORS
  if (shape.kind === 'piece') {
    const { fill, edge } = pieceColors(shape.piece)
    return `<rect x="${shape.xMm}" y="${shape.yMm}" width="${shape.widthMm}" height="${shape.heightMm}" fill="${fill}" stroke="${edge}" stroke-width="6"/>`
  }
  if (shape.kind === 'opening') {
    return `<rect x="${shape.xMm}" y="${shape.yMm}" width="${shape.widthMm}" height="${shape.heightMm}" fill="${c.opening}" stroke="${c.openingEdge}" stroke-width="5" stroke-dasharray="40 24"/>`
  }
  if (shape.kind === 'tie') {
    return shape.dropped
      ? `<g stroke="${c.tieDropped}" stroke-width="7"><line x1="${shape.xMm - TIE_RADIUS_MM}" y1="${shape.yMm - TIE_RADIUS_MM}" x2="${shape.xMm + TIE_RADIUS_MM}" y2="${shape.yMm + TIE_RADIUS_MM}"/><line x1="${shape.xMm - TIE_RADIUS_MM}" y1="${shape.yMm + TIE_RADIUS_MM}" x2="${shape.xMm + TIE_RADIUS_MM}" y2="${shape.yMm - TIE_RADIUS_MM}"/></g>`
      : `<circle cx="${shape.xMm}" cy="${shape.yMm}" r="${TIE_RADIUS_MM}" fill="${c.ground}" stroke="${c.tie}" stroke-width="8"/>`
  }
  if (shape.kind === 'course') {
    return `<line x1="0" y1="${shape.yMm}" x2="${shape.toXMm}" y2="${shape.yMm}" stroke="${c.course}" stroke-width="5"/>`
  }
  if (shape.kind === 'concrete') {
    return `<line x1="0" y1="${shape.yMm}" x2="${shape.toXMm}" y2="${shape.yMm}" stroke="${c.concrete}" stroke-width="7" stroke-dasharray="60 30"/>`
  }
  const fill = shape.role === 'mark' ? c.mark : shape.role === 'concrete' ? c.concrete : c.dim
  const turn = shape.turned ? ` transform="rotate(-90 ${shape.xMm} ${shape.yMm})"` : ''
  return `<text x="${shape.xMm}" y="${shape.yMm}" fill="${fill}" font-size="${fontMm(shape.role)}" font-family="monospace" text-anchor="middle" dominant-baseline="middle"${turn}>${escapeXml(shape.text)}</text>`
}

/** Where one face's block starts, and the gap between blocks. */
const BLOCK_PAD_MM = 140
const LINE_MM = 66
/** So the caveats are not clipped by a pour shorter than its own sentences. */
const MIN_PAGE_WIDTH_MM = 4000

export interface ElevationPage {
  /** How the pour is named on the sheet — "Pour 1, lift 2" — so three lifts are three titles. */
  title: string
  elevation: ShutterElevation
}

/**
 * Every face of every pour as one printable drawing.
 *
 * One file rather than one per face, and stacked rather than tiled, because it is issued as a
 * drawing and read against the engineer's: both faces of a wall are checked together — a tie
 * passes through both, and a station that is on one skin and not the other is the error being
 * looked for — and the lifts are read in the order they are poured. The caveats are on the
 * sheet rather than only on screen for the same reason the cut sheet's are: this is the
 * document that gets emailed on, and the frame it is set out in has to travel with it.
 */
export function elevationSvg(pages: readonly ElevationPage[], subject: string): string {
  const pageWidthMm = Math.max(MIN_PAGE_WIDTH_MM, ...pages.map((page) => page.elevation.runMm))
  const c = ELEVATION_COLORS
  const blocks: string[] = []
  let yMm = BLOCK_PAD_MM
  for (const { elevation, title } of pages) {
    const heightMm = Math.max(elevation.formTopMm, elevation.concreteTopMm)
    for (const face of elevation.faces) {
      blocks.push(
        [
          `<g transform="translate(0 ${yMm})">`,
          `<text x="0" y="0" fill="${c.title}" font-size="${TITLE_MM}" font-family="monospace">${escapeXml(title)} — ${escapeXml(FACE_ROLE_LABELS[face.role])}, ${Math.round(elevation.runMm)} mm long, ${face.pieces.length} ${face.pieces.length === 1 ? 'piece' : 'pieces'}</text>`,
          `<g transform="translate(0 ${TITLE_MM})">`,
          ...elevationShapes(elevation, face).map(shapeMarkup),
          '</g>',
          '</g>',
        ].join('\n'),
      )
      yMm += TITLE_MM + heightMm + BLOCK_PAD_MM
    }
    for (const line of elevationCaveats(elevation)) {
      blocks.push(
        `<text x="0" y="${yMm}" fill="${c.dim}" font-size="${DIM_MM}" font-family="monospace">${escapeXml(line)}</text>`,
      )
      yMm += LINE_MM
    }
    yMm += BLOCK_PAD_MM
  }

  const totalMm = yMm + BLOCK_PAD_MM
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-BLOCK_PAD_MM} ${-BLOCK_PAD_MM} ${pageWidthMm + BLOCK_PAD_MM * 2} ${totalMm + BLOCK_PAD_MM}" width="${pageWidthMm + BLOCK_PAD_MM * 2}" height="${totalMm + BLOCK_PAD_MM}">`,
    `<rect x="${-BLOCK_PAD_MM}" y="${-BLOCK_PAD_MM}" width="${pageWidthMm + BLOCK_PAD_MM * 2}" height="${totalMm + BLOCK_PAD_MM}" fill="${c.ground}"/>`,
    `<text x="0" y="0" fill="${c.title}" font-size="${TITLE_MM}" font-family="monospace">Shutter elevation — ${escapeXml(subject)}</text>`,
    `<text x="0" y="${TITLE_MM}" fill="${c.dim}" font-size="${DIM_MM}" font-family="monospace">The shutter face as it is set. Circles are tie holes; a cross is a station the grid offers that this wall cannot use. The dashed green line is the top of the concrete — the panels above it are freeboard.</text>`,
    ...blocks,
    '</svg>',
  ].join('\n')
}
