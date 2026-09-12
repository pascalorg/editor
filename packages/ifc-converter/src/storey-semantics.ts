export type StoreyElevation = {
  expressId: number
  elevation: number
}

export function selectStoreyForElevation(
  candidates: StoreyElevation[],
  elementElevation: number,
): number | null {
  const ordered = [...candidates].sort((a, b) => a.elevation - b.elevation)
  const atOrBelow = ordered.filter((candidate) => candidate.elevation <= elementElevation + 0.1)
  return atOrBelow.at(-1)?.expressId ?? ordered.at(0)?.expressId ?? null
}
