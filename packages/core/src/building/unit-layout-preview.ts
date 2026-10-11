import { type RoomType, roomArea, type UnitLayout, type UnitSpace } from './unit-layout'
import { drawnWalls, outlineSegments } from './unit-layout-plan-score'

/** A layout as a plan drawing (SVG): what a person and a vision model look at to choose. */

const FILL: Record<RoomType, string> = {
  living: '#f6e3a8',
  kitchen: '#f7c3a8',
  hall: '#e6e6e6',
  entry: '#cfe8ea',
  bedroom: '#cfe6c4',
  bathroom: '#bcd8f2',
  walk_in: '#e2c6d0',
  closet: '#e2c6d0',
  pantry: '#f7c3a8',
  laundry: '#d2cbe8',
}
const LABEL: Record<RoomType, string> = {
  living: 'Living',
  kitchen: 'Kitchen',
  hall: 'Hall',
  entry: 'Entry',
  bedroom: 'Bedroom',
  bathroom: 'Bath',
  walk_in: 'Walk-in',
  closet: 'Closet',
  pantry: 'Pantry',
  laundry: 'Laundry',
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function layoutPreviewSvg(layout: UnitLayout, space: UnitSpace, pxPerMetre = 40) {
  const xs = space.outline.map((p) => p[0])
  const zs = space.outline.map((p) => p[1])
  const x0 = Math.min(...xs)
  const z0 = Math.min(...zs)
  const pad = 0.4
  const w = (Math.max(...xs) - x0 + 2 * pad) * pxPerMetre
  const h = (Math.max(...zs) - z0 + 2 * pad) * pxPerMetre
  const X = (x: number) => ((x - x0 + pad) * pxPerMetre).toFixed(1)
  const Z = (z: number) => ((z - z0 + pad) * pxPerMetre).toFixed(1)
  const parts: string[] = []
  const counts = new Map<RoomType, number>()
  for (const room of layout.rooms) counts.set(room.type, (counts.get(room.type) ?? 0) + 1)
  const seen = new Map<RoomType, number>()
  for (const room of layout.rooms) {
    for (const [rx0, rz0, rx1, rz1] of room.rects)
      parts.push(
        `<rect x="${X(rx0)}" y="${Z(rz0)}" width="${((rx1 - rx0) * pxPerMetre).toFixed(1)}" height="${((rz1 - rz0) * pxPerMetre).toFixed(1)}" fill="${FILL[room.type]}"/>`,
      )
    const n = (seen.get(room.type) ?? 0) + 1
    seen.set(room.type, n)
    const [bx0, bz0, bx1, bz1] = room.rects.reduce((p, q) =>
      (q[2] - q[0]) * (q[3] - q[1]) > (p[2] - p[0]) * (p[3] - p[1]) ? q : p,
    )
    const name = `${LABEL[room.type]}${(counts.get(room.type) ?? 0) > 1 ? ` ${n}` : ''}`
    const cx = X((bx0 + bx1) / 2)
    const cz = Number(Z((bz0 + bz1) / 2))
    parts.push(
      `<text x="${cx}" y="${(cz - 2).toFixed(1)}" font-size="11" text-anchor="middle">${esc(name)}</text>`,
      `<text x="${cx}" y="${(cz + 11).toFixed(1)}" font-size="9" text-anchor="middle" fill="#555">${roomArea(room).toFixed(1)} m²</text>`,
    )
  }
  for (const { a, b } of drawnWalls(layout))
    parts.push(
      `<line x1="${X(a[0])}" y1="${Z(a[1])}" x2="${X(b[0])}" y2="${Z(b[1])}" stroke="#222" stroke-width="3"/>`,
    )
  for (const { a, b } of outlineSegments(space.outline))
    parts.push(
      `<line x1="${X(a[0])}" y1="${Z(a[1])}" x2="${X(b[0])}" y2="${Z(b[1])}" stroke="#111" stroke-width="5"/>`,
    )
  const [ex, ez] = layout.entry.at
  parts.push(`<circle cx="${X(ex)}" cy="${Z(ez)}" r="5" fill="#c0392b"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`
}
