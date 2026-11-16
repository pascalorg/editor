import type { WallNode, ZoneNode } from '../schema'

type Vec2 = [number, number]

/** How far beyond a wall's half thickness a room's edge still lies along it (m). */
const EDGE_REACH = 0.15

/** The stretches of a room's edges lying along a wall line, as distances along that line. */
function stretchesAlong(zone: ZoneNode, [sx, sz]: Vec2, [ex, ez]: Vec2, reach: number) {
  const length = Math.hypot(ex - sx, ez - sz)
  if (!length) return []
  const [ux, uz] = [(ex - sx) / length, (ez - sz) / length]
  const off = ([x, z]: Vec2) => Math.abs((x - sx) * uz - (z - sz) * ux)
  const at = ([x, z]: Vec2) => (x - sx) * ux + (z - sz) * uz
  return zone.polygon.flatMap((p, i) => {
    const q = zone.polygon[(i + 1) % zone.polygon.length] ?? p
    if (off(p) > reach || off(q) > reach) return []
    const from = Math.max(0, Math.min(at(p), at(q)))
    const to = Math.min(length, Math.max(at(p), at(q)))
    return to - from > 0.05 ? [[from, to] as const] : []
  })
}

/** The stretches of a room's edges lying along a wall, within its half thickness and a margin. */
export const stretchesAlongWall = (zone: ZoneNode, wall: WallNode) =>
  stretchesAlong(zone, wall.start, wall.end, (wall.thickness ?? 0.2) / 2 + EDGE_REACH)
