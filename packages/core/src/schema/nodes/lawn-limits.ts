export const LAWN_LIMITS = {
  minPoints: 3,
  maxPoints: 200,
  maxCoordinate: 100000,
  minArea: 0.25,
  maxArea: 2500,
  minHeight: 0.01,
  maxHeight: 1000,
  minBladeWidth: 0.002,
  maxBladeWidth: 0.03,
  minDensity: 1,
  maxDensity: 100,
  maxEdgeFade: 0.5,
  maxFlowerDensity: 2,
  maxSpecies: 3,
  /** Shared by every saved stroke on one lawn, including single-point dabs. */
  maxStrokePoints: 20000,
  minStrokeRadius: 0.05,
  maxStrokeRadius: 1000,
  maxCandidates: 250000,
  maxBaseTriangles: 131072,
  maxFlowers: 1024,
} as const

export const LAWN_STROKE_BUDGET_MESSAGE =
  'A lawn has a shared budget of 20,000 brush points across all strokes. Remove older strokes or use fewer points.'

export function lawnStrokePointCount(strokes: readonly { points: readonly unknown[] }[]): number {
  return strokes.reduce((count, stroke) => count + stroke.points.length, 0)
}
