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

/** Preserve each leg's grade, including vertical rises, while anchoring one endpoint. */
export function preservePipeGrades(
  initial: readonly Point[],
  proposed: readonly Point[],
  movedIndex: number,
): [number, number, number][] | null {
  if (initial.length !== proposed.length || initial.length < 2) return null
  const path = proposed.map((p) => [...p] as [number, number, number])
  const original = initial[movedIndex]
  const moved = path[movedIndex]
  if (!original || !moved || path.some((p) => p.some((v) => !Number.isFinite(v)))) return null
  if (Math.hypot(moved[0] - original[0], moved[2] - original[2]) < 1e-8) {
    const dy = moved[1] - original[1]
    return initial.map((p) => [p[0], p[1] + dy, p[2]])
  }
  const drops: number[] = []
  for (let i = 1; i < path.length; i++) {
    const grade = pipeGrade(initial[i - 1]!, initial[i]!)
    const length = Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![2] - path[i - 1]![2])
    if (grade === null && length > 1e-6) return null
    if (grade !== null && length < 0.001) return null
    drops.push(grade === null ? initial[i - 1]![1] - initial[i]![1] : grade * length)
  }
  if (movedIndex === 0) {
    path.at(-1)![1] = initial.at(-1)![1]
    for (let i = path.length - 2; i >= 0; i--) path[i]![1] = path[i + 1]![1] + drops[i]!
  } else {
    path[0]![1] = initial[0]![1]
    for (let i = 1; i < path.length; i++) path[i]![1] = path[i - 1]![1] - drops[i - 1]!
  }
  return path
}

export function pipeGradesMatch(initial: readonly Point[], next: readonly Point[]): boolean {
  if (
    initial.length !== next.length ||
    next.some((point) => point.some((value) => !Number.isFinite(value)))
  )
    return false
  for (let i = 1; i < initial.length; i++) {
    const before = pipeGrade(initial[i - 1]!, initial[i]!)
    const after = pipeGrade(next[i - 1]!, next[i]!)
    if (before === null ? after !== null : after === null || Math.abs(before - after) > 1e-6)
      return false
  }
  return true
}

export function pipeGradeLabel(start: Point, end: Point): string {
  if (Math.hypot(...start.map((v, i) => v - end[i]!)) < 1e-6) return 'Choose an endpoint'
  const grade = pipeGrade(start, end)
  if (grade === null)
    return `Vertical · ${start[1] > end[1] ? 'start → end' : 'end → start'} (down)`
  if (Math.abs(grade) < 1e-6) return 'Level · no gravity fall'
  return `${(Math.abs(grade) * 100).toFixed(2)}% · 1:${(1 / Math.abs(grade)).toFixed(1)} · ${grade > 0 ? 'start → end' : 'end → start'} (down)`
}
