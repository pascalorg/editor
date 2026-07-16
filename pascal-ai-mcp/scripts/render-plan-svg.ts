// Shared SVG floor-plan renderer for human review — used by
// preview-layouts.ts (partitioner output) and check-templates.ts (reference
// templates). Pure function: LayoutPlan in, SVG string out.

import type { LayoutPlan } from '../src/layout-plan'
import { longestSharedEdge, pointInPolygon, polygonArea, polygonBounds } from '../src/layout-plan'
import { entryDoorSegment } from '../src/scene-executor'

const FILL: Record<string, string> = {
  living: '#fde9c8',
  living_kitchen: '#fde9c8',
  dining: '#fdf3dc',
  kitchen: '#f9d9a6',
  bedroom: '#cfe3f5',
  study: '#d9e8d4',
  bathroom: '#d4ecec',
  hallway: '#eeeeee',
  entry: '#e8e2d4',
  storage: '#e5ddee',
  balcony: '#e3f0d8',
  other: '#f0f0f0',
}

export function renderPlanSvg(title: string, plan: LayoutPlan): string {
  const SCALE = 60
  const PAD = 40
  // Extra headroom so a top-edge entry marker clears the title line.
  const PAD_TOP = 64
  const W = plan.footprint.width * SCALE + PAD * 2
  const H = plan.footprint.depth * SCALE + PAD_TOP + PAD + 30
  const px = (x: number) => PAD + x * SCALE
  // Flip z so the entry side (z=0) renders at the bottom.
  const pz = (z: number) => PAD_TOP + (plan.footprint.depth - z) * SCALE

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">`)
  parts.push(`<rect width="${W}" height="${H}" fill="white"/>`)
  parts.push(`<text x="${PAD}" y="24" font-size="16" font-weight="bold">${title}  （${plan.footprint.width}m × ${plan.footprint.depth}m）</text>`)

  const roomById = new Map(plan.rooms.map(room => [room.id, room]))
  for (const room of plan.rooms) {
    const points = room.polygon.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')
    parts.push(`<polygon points="${points}" fill="${FILL[room.type] ?? '#f0f0f0'}" stroke="#444" stroke-width="2"/>`)
    const bounds = polygonBounds(room.polygon)
    const cx = px((bounds.minX + bounds.maxX) / 2)
    const cz = pz((bounds.minZ + bounds.maxZ) / 2)
    const area = polygonArea(room.polygon)
    parts.push(`<text x="${cx}" y="${cz - 4}" font-size="12" text-anchor="middle">${room.name}${room.requiresExteriorWindow ? ' ⊞' : ''}</text>`)
    parts.push(`<text x="${cx}" y="${cz + 12}" font-size="10" text-anchor="middle" fill="#666">${area.toFixed(1)}㎡</text>`)
  }

  for (const conn of plan.connections) {
    const a = roomById.get(conn.from)
    const b = roomById.get(conn.to)
    if (!a || !b) continue
    const { midpoint, length } = longestSharedEdge(a.polygon, b.polygon)
    if (length <= 0) continue
    parts.push(`<circle cx="${px(midpoint[0])}" cy="${pz(midpoint[1])}" r="6" fill="#c0392b"/>`)
  }

  const entryRoom = roomById.get(plan.entry.roomId)
  if (entryRoom) {
    const host = entryDoorSegment(entryRoom, plan.footprint)
    if (host) {
      const mx = (host.start[0] + host.end[0]) / 2
      const mz = (host.start[1] + host.end[1]) / 2
      const X = px(mx)
      const Y = pz(mz)
      // Outward side = the side of the wall that falls OUTSIDE the footprint
      // polygon. A bounds-center comparison flips on concave (L/凹) edges,
      // where the room's box center can sit on the exterior side.
      const footprintPoly: Array<[number, number]> = plan.footprint.polygon
        ?? [[0, 0], [plan.footprint.width, 0], [plan.footprint.width, plan.footprint.depth], [0, plan.footprint.depth]]
      const EPS = 0.05
      const vertical = Math.abs(host.start[0] - host.end[0]) < 1e-6
      const label = (x: number, y: number, rotate: number) =>
        `<text x="${x}" y="${y}" ${rotate ? `transform="rotate(${rotate} ${x} ${y})" ` : ''}font-size="12" text-anchor="middle" fill="#c0392b" font-weight="bold">入户</text>`
      if (vertical) {
        const outwardLeft = !pointInPolygon(mx - EPS, mz, footprintPoly)
        if (outwardLeft) {
          parts.push(`<polygon points="${X - 14},${Y - 6} ${X - 14},${Y + 6} ${X - 4},${Y}" fill="#c0392b"/>`, label(X - 22, Y, -90))
        } else {
          parts.push(`<polygon points="${X + 14},${Y - 6} ${X + 14},${Y + 6} ${X + 4},${Y}" fill="#c0392b"/>`, label(X + 22, Y, 90))
        }
      } else {
        const outwardBottom = !pointInPolygon(mx, mz - EPS, footprintPoly)
        if (outwardBottom) {
          parts.push(`<polygon points="${X - 6},${Y + 14} ${X + 6},${Y + 14} ${X},${Y + 4}" fill="#c0392b"/>`, label(X, Y + 28, 0))
        } else {
          parts.push(`<polygon points="${X - 6},${Y - 14} ${X + 6},${Y - 14} ${X},${Y - 4}" fill="#c0392b"/>`, label(X, Y - 20, 0))
        }
      }
    }
  }

  parts.push(`<text x="${PAD}" y="${H - 8}" font-size="10" fill="#888">红点=门（位置由执行器按共享墙段中点计算） ⊞=需外窗</text>`)
  parts.push('</svg>')
  return parts.join('\n')
}
