import type { WallNode } from '../../schema'
import type { WallSlabSupportSegment } from '../slab/slab-support'
import { getWallCurveFrameAt } from './wall-curve'

export function wallDoorStepRuns(
  wall: WallNode,
  opening: { type: string; width?: number; height?: number; position?: [number, number, number] },
  faceBase: { a: readonly WallSlabSupportSegment[]; b: readonly WallSlabSupportSegment[] },
  elevation: number,
): Array<{ start: number; end: number; bottom: number; top: number }> {
  if ((opening.type !== 'door' && opening.type !== 'window') || !opening.position) return []
  const sill = opening.position[1] - (opening.height ?? 0) / 2
  if (sill > 0.01) return []
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return []
  const station = (t: number) => {
    const { point } = getWallCurveFrameAt(wall, t)
    return ((point.x - wall.start[0]) * dx + (point.y - wall.start[1]) * dy) / length
  }
  const runs: Array<{ start: number; end: number; bottom: number; top: number }> = []
  for (const a of faceBase.a)
    for (const b of faceBase.b) {
      const from = Math.max(a.start, b.start)
      const to = Math.min(a.end, b.end)
      const low = Math.min(
        a.elevation,
        a.endElevation ?? a.elevation,
        b.elevation,
        b.endElevation ?? b.elevation,
      )
      const high = Math.max(
        a.elevation,
        a.endElevation ?? a.elevation,
        b.elevation,
        b.endElevation ?? b.elevation,
      )
      if (to <= from || high - low < 1e-6) continue
      const start = Math.max(station(from), opening.position[0] - (opening.width ?? 0) / 2)
      const end = Math.min(station(to), opening.position[0] + (opening.width ?? 0) / 2)
      if (end > start)
        runs.push({ start, end, bottom: low - elevation, top: Math.max(sill, high - elevation) })
    }
  return runs
}
