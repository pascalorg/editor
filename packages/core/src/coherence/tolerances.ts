/**
 * The numbers the coherence checker measures against, in one place. They test topology and ratios,
 * not structure: a message built from them says so.
 */
export const COHERENCE_TOLERANCES = {
  /** Elements that meet are within this of each other (m). */
  contact: 0.02,
  /** A wall rises past a roof as a parapet by at least this above the roof's covering (m). */
  upstand: 0.15,
  /** Measured heights are read to the millimetre: a top exactly at the upstand reads as clearing it. */
  rounding: 0.001,
  /** Distance between the points sampled along a wall (m). */
  sampleSpacing: 0.25,
  /** A wall is sampled at most this often, however long: the spacing widens instead. */
  maxSamplesPerWall: 400,
  /** A wall is under a roof when at least this much of it is (m, or half the wall if shorter). */
  minCoveredLength: 0.5,
  /** A roof reaches past its supports by at most this share of the span they hold it by (provisional). */
  cantileverRatio: 0.25,
  /** Material left above an opening's head, and beside its jambs, under a roof or a dormer eave (m). */
  lintel: 0.05,
  /** Resting this close above its support is placement imprecision (a check); farther, it floats (m). */
  seated: 0.15,
  /** A roof with supports closer together than this on an axis has no span to take a quarter of (m). */
  minBackspan: 1,
  /** A reach this short is an eave, not a cantilever, whatever the span (m). */
  eaveAllowance: 0.5,
  /** A disputed measurement has moved, and the item is open again, past this (m). */
  disputeDrift: 0.005,
} as const

/** The levels a write rechecks around the ones it touched: those directly above and below. */
export const COHERENCE_LEVEL_NEIGHBOURS = 1
