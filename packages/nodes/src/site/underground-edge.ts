import type { UndergroundEdge } from '@pascal-app/viewer'

/**
 * The hole's edge looks (`UndergroundEdge`), as numbers: the ground's mask and its rim read them
 * as uniforms and the pit's walls as uniforms and a CPU contour, so changing the look compiles
 * nothing. `noise` is the shipped one; the others are variants to choose from.
 */
export type EdgeLook = {
  /** The hole's base margin around the footprint, in metres. */
  margin: number
  /** How far the noise moves the edge in or out of the margin, in metres (0: a constant offset). */
  erode: number
  /** Noise cells per metre on the ground, of the broadest octave. */
  scale: number
  /** The soft shade on the ground side of the cut: its width in metres and how dark it gets. */
  featherWidth: number
  featherStrength: number
  /** The thin line along the cut: its width in metres and colour. */
  lineWidth: number
  lineColor: string
  /** How far (m) the pit's walls are roughened sideways in depth. */
  crumble: number
  /** 1: the wall is a flat section face with a line at grade, not strata under a topsoil layer. */
  section: number
}

export const EDGE_LOOKS: Record<UndergroundEdge, EdgeLook> = {
  noise: {
    margin: 1.6,
    erode: 0.9,
    scale: 0.6,
    featherWidth: 0.55,
    featherStrength: 0.6,
    lineWidth: 0.09,
    lineColor: '#f4f4f4',
    crumble: 0.9,
    section: 0,
  },
  quiet: {
    margin: 1.6,
    erode: 0.15,
    scale: 2.4,
    featherWidth: 0.55,
    featherStrength: 0.6,
    lineWidth: 0.09,
    lineColor: '#f4f4f4',
    crumble: 0.25,
    section: 0,
  },
  section: {
    margin: 0.6,
    erode: 0,
    scale: 0.6,
    featherWidth: 0.25,
    featherStrength: 0.4,
    lineWidth: 0.07,
    lineColor: '#2b2b2b',
    crumble: 0,
    section: 1,
  },
  'section-earth': {
    margin: 0.6,
    erode: 0,
    scale: 0.6,
    featherWidth: 0.25,
    featherStrength: 0.4,
    lineWidth: 0.07,
    lineColor: '#2b2b2b',
    crumble: 0.25,
    section: 0,
  },
}
