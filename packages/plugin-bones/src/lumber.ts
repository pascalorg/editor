/**
 * Dimensional lumber catalog. Nominal US sizes with *actual* (dressed)
 * dimensions in meters — a "2x4" is really 1.5" × 3.5". Pascal scenes are
 * metric, so everything downstream (renderer, footprints, future takeoffs)
 * works off these actual dimensions.
 */

export const LUMBER_SIZES = [
  '1x8',
  '2x4',
  '2x6',
  '2x8',
  '2x10',
  '2x12',
  '4x4',
  '4x6',
  '4x8',
  '4x10',
  '4x12',
  '6x6',
] as const

export type LumberSize = (typeof LUMBER_SIZES)[number]

const INCH = 0.0254

/** Actual (dressed) cross-section per nominal size: [thickness, width] in meters. */
export const LUMBER_CROSS_SECTIONS: Record<LumberSize, readonly [number, number]> = {
  '1x8': [0.75 * INCH, 7.25 * INCH],
  '2x4': [1.5 * INCH, 3.5 * INCH],
  '2x6': [1.5 * INCH, 5.5 * INCH],
  '2x8': [1.5 * INCH, 7.25 * INCH],
  '2x10': [1.5 * INCH, 9.25 * INCH],
  '2x12': [1.5 * INCH, 11.25 * INCH],
  '4x4': [3.5 * INCH, 3.5 * INCH],
  '4x6': [3.5 * INCH, 5.5 * INCH],
  '4x8': [3.5 * INCH, 7.25 * INCH],
  '4x10': [3.5 * INCH, 9.25 * INCH],
  '4x12': [3.5 * INCH, 11.25 * INCH],
  '6x6': [5.5 * INCH, 5.5 * INCH],
}

/** Standard stock length default — 8 ft. */
export const DEFAULT_LENGTH = 8 * 12 * INCH // 2.4384 m

/**
 * How a loose member lies in space:
 * - `stud`   — vertical, like a wall stud (length along Y).
 * - `flat`   — horizontal on its wide face, like a plate or mudsill.
 * - `edge`   — horizontal on its narrow edge, like a joist or rafter stock.
 */
export const LUMBER_ORIENTATIONS = ['stud', 'flat', 'edge'] as const
export type LumberOrientation = (typeof LUMBER_ORIENTATIONS)[number]

/**
 * Axis-aligned box dimensions [x, y, z] for a member of `size` × `length` in
 * the given orientation, before the node's Y rotation is applied. Length runs
 * along X for horizontal members and along Y for studs.
 */
export function lumberBoxDims(
  size: LumberSize,
  length: number,
  orientation: LumberOrientation,
): [number, number, number] {
  const [t, w] = LUMBER_CROSS_SECTIONS[size]
  switch (orientation) {
    case 'stud':
      return [w, length, t]
    case 'flat':
      return [length, t, w]
    case 'edge':
      return [length, w, t]
  }
}

/** SPF framing lumber look. */
export const LUMBER_COLOR = '#d8b98c'
