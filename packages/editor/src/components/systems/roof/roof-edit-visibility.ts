export function getRoofEditVisibility(input: { isMoving: boolean; isReveal: boolean }): {
  merged: boolean
  segments: boolean
} {
  return {
    merged: true,
    segments: input.isReveal,
  }
}
