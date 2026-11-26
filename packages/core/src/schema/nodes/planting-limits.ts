/** Stored bounds keep outlining, scatter and geometry work finite before any mesh is made. */
export const PLANTING_LIMITS = {
  minPoints: 3,
  maxPoints: 64,
  maxCoordinate: 10_000,
  maxExtent: 200,
  minArea: 0.25,
  maxArea: 2500,
  minHeight: 0.05,
  maxHeight: 1000,
  minSpread: 0.1,
  maxSpread: 1000,
  minSpacing: 0.12,
  maxSpacing: 1000,
  maxSpecies: 8,
  maxPlants: 512,
  maxOutlinePoints: 192,
  maxAttempts: 40_000,
} as const
