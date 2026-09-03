/**
 * Keeping the tags apart.
 *
 * Devices on a real plan crowd: two receptacles on opposite faces of one
 * partition stand 200 mm apart, and their circuit tags land on top of each
 * other. The SYMBOLS must not move — a construction document locates them —
 * so the TAGS move instead, to the first candidate spot that is clear of
 * everything already placed, and a hairline leader is drawn when a tag has
 * travelled far enough that its device is no longer obvious.
 *
 * This is the same de-collision idea Bones' own plan-set uses for its device
 * bubbles (`plans/plan-set.ts`), in plan metres rather than SVG pixels.
 */
import type { FloorplanGeometry } from '@pascal-app/core'

export type Spot = { x: number; y: number }

export class TagField {
  private readonly taken: Spot[] = []

  constructor(
    /** Two tags closer than this collide, metres. */
    private readonly clearance: number,
    /** Ring radii to try, metres, nearest first. */
    private readonly rings: readonly number[],
  ) {}

  /** Reserve a point so later tags dodge it (device glyphs, for instance). */
  reserve(x: number, y: number): void {
    this.taken.push({ x, y })
  }

  private crowding(spot: Spot): number {
    let worst = Number.POSITIVE_INFINITY
    for (const other of this.taken) {
      const d = Math.hypot(other.x - spot.x, other.y - spot.y)
      if (d < worst) worst = d
    }
    return worst
  }

  /**
   * A clear spot for a tag anchored at (x, y). Returns the spot and how far
   * it moved; the caller draws a leader when that is more than it likes.
   * A spot that cannot fully clear keeps the LEAST crowded candidate — a tag
   * must always print, so the honest failure is a tight tag, never a missing
   * one.
   */
  place(x: number, y: number): { x: number; y: number; moved: number } {
    const home: Spot = { x, y }
    if (this.crowding(home) >= this.clearance) {
      this.taken.push(home)
      return { x, y, moved: 0 }
    }
    let best = home
    let bestScore = this.crowding(home)
    for (const radius of this.rings) {
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4
        const candidate: Spot = {
          x: x + radius * Math.cos(angle),
          y: y + radius * Math.sin(angle),
        }
        const score = this.crowding(candidate)
        if (score >= this.clearance) {
          this.taken.push(candidate)
          return { ...candidate, moved: radius }
        }
        if (score > bestScore) {
          bestScore = score
          best = candidate
        }
      }
    }
    this.taken.push(best)
    return { ...best, moved: Math.hypot(best.x - x, best.y - y) }
  }
}

/** A hairline from a device to its displaced tag. */
export function leader(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  color: string,
): FloorplanGeometry {
  return {
    kind: 'line',
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    stroke: color,
    strokeWidth: width,
    opacity: 0.45,
  }
}
