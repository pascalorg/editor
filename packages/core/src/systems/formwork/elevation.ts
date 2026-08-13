import type { FaceRole } from './coverage/types'

/**
 * One shutter face as a shop elevation: what is set where, in one frame.
 *
 * Every figure here was already solved — `courses.ts` stands the panels up, `strip-pack.ts`
 * divides each course along the run, `tie-grid.ts` says where the frames are drilled, and
 * `parts.ts` marks all of it. What was missing is the only form of that answer somebody can
 * set a shutter out from: a face of the wall with its panels drawn on it, each carrying the
 * mark that is painted on it, and the tie holes and the joints in the same picture. A parts
 * table is a list of positions and nobody erects from a list.
 *
 * ## One frame, and which one
 *
 * The inputs arrive in four. A course elevation is absolute metres in the level, a drilled
 * hole is absolute metres along the element, a packed piece is millimetres from its own run's
 * start, and a `PartLocus` is millimetres from the pour's start. Mixing any two of those puts
 * a tie in the wrong panel, which is the one error on this drawing that reads as correct.
 *
 * So everything here is **millimetres from the pour unit's own origin** — along from
 * `startAlong`, up from the pour's base — because that is the frame a mark already encodes.
 * `P-A-1-01250` is at 1250 on this drawing by construction rather than by agreement, and a
 * wall cast in three lifts is three drawings each starting at zero, which is also how three
 * lifts are set out on site.
 *
 * ## What a mark is here, and why it is carried rather than derived
 *
 * A mark comes in as an opaque string. It is not recomputed from the rectangle, because the
 * two are not the same measurement: a corner unit's mark carries the leg's station along the
 * *element* while its rectangle is placed in the pour's frame, and a panel crossed by a
 * window is one panel off the rack drawn as two bands. So `mark` is not unique in `pieces` —
 * two bands of one panel share it, exactly as they share it in the 3D shutter — and a table
 * that counted rectangles would count that panel twice.
 *
 * ## What the drawing says by leaving out
 *
 * Unlike a cut sheet, this has a reader who already has one: a shop elevation is compared
 * against the engineer's, so an absence is read as a decision. That is why `tiesDropped` is
 * here. A station the drilled grid offers and the wall cannot use — it lands in a void, or
 * over a corner unit that ties through its own holes — is a rod on the engineer's drawing and
 * no rod on this one, and the band it leaves untied is the query somebody will raise. Naming
 * them is cheaper than answering the query.
 */

/** One piece of shutter as a rectangle on the face. */
export interface ElevationPiece {
  mark: string
  /** Three lines on a bill and two processes on site — see `pieceSpec`. */
  kind: 'panel' | 'filler' | 'cut' | 'corner'
  /** mm along from the pour's start. */
  xMm: number
  /** mm above the pour's base — the bottom edge of the piece as drawn. */
  yMm: number
  widthMm: number
  heightMm: number
  /** 0-based course up the lift; a corner leg spans them all and has none. */
  courseIndex?: number
}

export interface ElevationFace {
  role: FaceRole
  pieces: ElevationPiece[]
}

/** Where a tie the grid offered could not go, which is what leaves a band untied. */
export type TieBlockedBy = 'opening' | 'corner'

export interface ShutterElevation {
  /** Length of the pour along the wall, mm — the drawing's own width. */
  runMm: number
  /** Where the panels start: the kicker's top, or 0 at a lift joint where there is none. */
  formBaseMm: number
  /** Where the concrete stops. Not the top of the drawing. */
  concreteTopMm: number
  /**
   * Where the panels stop, which is proud of the concrete by the freeboard.
   *
   * Both are on the drawing because the difference is the part a reader gets wrong: a
   * shutter drawn to its own top looks like a pour to the top of the panels, and the last
   * 100 mm of a steel-framed course holds nothing back.
   */
  formTopMm: number
  /** Horizontal joints: one entry per course, base and top mm above the pour base. */
  courses: Array<{ baseMm: number; topMm: number }>
  openings: Array<{ id: string; xMm: number; yMm: number; widthMm: number; heightMm: number }>
  /** Ties as drawn — a rod passes here, through both skins. */
  ties: Array<{ xMm: number; yMm: number; mark: string }>
  tiesDropped: Array<{ xMm: number; yMm: number; because: TieBlockedBy }>
  /**
   * Where the tie stations came from, which decides whether they may be moved.
   *
   * A drilled grid is the factory's and a rod passes nowhere else on the wall; a solved
   * spacing is the calculation's and the carpenter bores the ply to it. A reader who takes
   * the first for the second sets a tie 25 mm off a hole and drills a steel frame.
   */
  tiesFrom: 'drilled-holes' | 'solved-spacing' | 'none'
  faces: ElevationFace[]
}

/**
 * What this drawing is, and is not, in words.
 *
 * Shared by the panel, the printed sheet and both AI surfaces, because a shop elevation is
 * checked against the engineer's by somebody holding both — and a caveat present on the
 * screen and absent from the file that was emailed on is a caveat that did not arrive.
 *
 * Leads with the frame. Every other sentence here is about something the drawing shows, and
 * the frame is the one thing about it a reader assumes: a lift's drawing starting at zero is
 * read as the wall starting at zero, and then every figure on it is out by the pour below.
 */
export function elevationCaveats(elevation: ShutterElevation): string[] {
  const out: string[] = [
    'Set out in millimetres from this pour’s own start and its own base, not the wall’s and not the level’s. A wall cast in three lifts is three of these drawings, each starting at zero, which is how three lifts are set out on site — so a figure here is only a figure on the wall once the pours below it are added back.',
  ]
  const freeboardMm = Math.round(elevation.formTopMm - elevation.concreteTopMm)
  if (freeboardMm > 0) {
    out.push(
      `The concrete stops at ${Math.round(elevation.concreteTopMm)} mm and the panels run to ${Math.round(elevation.formTopMm)} mm, so the top ${freeboardMm} mm of shutter is freeboard and holds nothing back. A course is set whole: the panels are not cut down to the lift.`,
    )
  }
  if (elevation.formBaseMm > 0) {
    out.push(
      `The shutter starts at ${Math.round(elevation.formBaseMm)} mm, on the kicker cast with the slab. The kicker is part of the wall rather than part of the form, so nothing below that line is drawn here and it is not an unformed strip.`,
    )
  }
  if (elevation.tiesFrom === 'drilled-holes') {
    out.push(
      'The ties are at the panels’ own drilled holes, where a hole on one skin meets a hole on the other — not at the calculated spacing. So these stations cannot be moved to suit a setting-out grid: a rod asked for 25 mm off a hole goes through a steel frame. The spacing they work out to is checked against the calculation rather than set by it.',
    )
  } else if (elevation.tiesFrom === 'solved-spacing') {
    out.push(
      'This is a carpenter’s shutter, so the ties are at the solved spacing and the ply is bored where the calculation asks. The rows are graded — tighter at the base, where the head is greatest — and the run is divided into equal bays at each row rather than stepped along from one end, which is what keeps the shutter symmetrical and puts a tie at each end of the run.',
    )
  }
  if (elevation.tiesDropped.length > 0) {
    const voids = elevation.tiesDropped.filter((tie) => tie.because === 'opening').length
    const corners = elevation.tiesDropped.length - voids
    const reasons = [
      voids > 0 ? `${voids} inside an opening` : '',
      corners > 0 ? `${corners} over a corner unit, which ties through its own holes` : '',
    ].filter(Boolean)
    out.push(
      `${elevation.tiesDropped.length} station${elevation.tiesDropped.length === 1 ? '' : 's'} the grid offers ${elevation.tiesDropped.length === 1 ? 'is' : 'are'} not tied — ${reasons.join(' and ')}. They are on the drawing as dropped rather than left off it, because a rod on the engineer’s drawing and no rod here is what somebody queries, and the band it leaves untied is the reason to look.`,
    )
  }
  if (elevation.courses.length > 1) {
    out.push(
      `${elevation.courses.length} courses, and their vertical joints line up rather than staggering. That is deliberate and the reverse of masonry: a tie has to pass through holes that coincide on both skins, a waler coupler clamps across the joint and needs matching frame profiles, and the panels are craned as gangs. A staggered joint up this wall would be the error.`,
    )
  }
  out.push(
    'The shutter face only. The walers behind it, the rakers holding it on line and the working scaffold are in the parts list and not on this drawing — a face carrying all of them is a face where the panel marks cannot be read. Nothing here is a quantity either: a panel crossed by an opening is drawn as a band above it and a band below and is one panel off the rack, so the rectangles do not count.',
  )
  return out
}

/**
 * The description every AI surface's elevation tool carries.
 *
 * Leads with what the drawing is for rather than with its contents, because the contents are
 * the part a model will paraphrase into a list of coordinates — and it is already holding a
 * list of coordinates in `inspect_formwork_parts`. What it cannot get anywhere else is which
 * rectangle each mark is, and what is deliberately not on the sheet.
 */
export const FORMWORK_ELEVATION_DESCRIPTION =
  'The shop elevation of a wall’s shutter: every panel, filler and cut board as a rectangle on the face, each carrying its own mark, plus the tie holes, the course joints, the openings and the freeboard. Use it for setting out and for checking a layout against an engineer’s drawing — inspect_formwork_parts says what the parts are and this says where they are in one frame. Everything is millimetres from that pour’s own start and its own base, so a wall in three lifts returns three drawings each starting at zero, and a figure only becomes a figure on the wall once the pours below are added back. Four things to pass on rather than reword. The concrete stops at concreteTopMm and the panels run to formTopMm: the difference is freeboard and a pour quoted to the top of the shutter is quoted too high. Where tiesFrom is drilled-holes the tie stations are the factory’s and cannot be moved to suit a grid — never restate them as the calculated spacing, and never offer to shift one. tiesDropped is on the drawing on purpose: those are stations the grid offers that the wall cannot use, and the band each one leaves untied is what somebody queries against the engineer’s drawing. And the vertical joints lining up rather than staggering is correct here for a reason worth giving — the ties pass through holes that must coincide on both skins — so it is never a defect to report. A rectangle is not a quantity: a panel crossed by a window is drawn as two bands and is one panel, so quote counts from the parts list. Only walls have this drawing; a slab is decked to a plan and a column is clamped to a schedule, and neither is an elevation of a face.'
