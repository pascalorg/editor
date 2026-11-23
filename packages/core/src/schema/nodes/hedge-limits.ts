// In a file with no dependency: the agent tool contract reads the same bounds without loading the node schemas.

/** Bounds of a stored hedge. Every builder and tool reads these; nothing else bounds a hedge. */
export const HEDGE_LIMITS = {
  minPoints: 2,
  maxPoints: 64,
  /** A coordinate farther than this from the Site's origin is not a garden. */
  maxCoordinate: 10_000,
  minHeight: 0.1,
  maxHeight: 1000,
  minWidth: 0.1,
  maxWidth: 1000,
  minLeafSize: 0.03,
  maxLeafSize: 0.3,
  maxGaps: 16,
  minGapWidth: 0.1,
  maxGapWidth: 1000,
} as const
