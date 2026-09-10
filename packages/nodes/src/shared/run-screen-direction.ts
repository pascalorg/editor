type Point2 = readonly [number, number]

export function screenDirectionScore(origin: Point2, tip: Point2, pointer: Point2): number {
  const dx = tip[0] - origin[0],
    dy = tip[1] - origin[1]
  const length = Math.hypot(dx, dy)
  if (length < 2) return Infinity
  const px = pointer[0] - origin[0],
    py = pointer[1] - origin[1]
  const distance = Math.hypot(px, py)
  if (px * dx + py * dy <= 0 || distance < 4) return Infinity
  return (
    Math.hypot(px / distance - dx / length, py / distance - dy / length) * Math.min(distance, 100)
  )
}

export function chooseScreenDirection(scores: readonly number[], previous: number): number {
  let best = -1
  for (let i = 0; i < scores.length; i++) {
    if (Number.isFinite(scores[i]) && (best < 0 || scores[i]! < scores[best]!)) best = i
  }
  if (
    best >= 0 &&
    previous >= 0 &&
    Number.isFinite(scores[previous]) &&
    scores[previous]! <= scores[best]! + 4
  )
    return previous
  return best
}
