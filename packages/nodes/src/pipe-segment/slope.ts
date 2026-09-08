type Point = readonly [number, number, number]

export function pipeGrade(start: Point, end: Point): number | null {
  const horizontal = Math.hypot(end[0] - start[0], end[2] - start[2])
  return horizontal < 1e-6 ? null : (start[1] - end[1]) / horizontal
}

export function applyPipeGrade(start: Point, end: Point, grade: number): [number, number, number] {
  const horizontal = Math.hypot(end[0] - start[0], end[2] - start[2])
  if (horizontal < 1e-6 || !Number.isFinite(grade)) return [...end]
  return [end[0], start[1] - horizontal * grade, end[2]]
}
