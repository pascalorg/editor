// Batch-A acceptance deliverable (GENERATION_REDESIGN.md §8): run the
// deterministic partitioner over the typical intents and emit coordinate
// listings + SVG floor plans for human review of layout quality.
//
//   bun run scripts/preview-layouts.ts [outDir]
//
// Writes one SVG per intent to outDir (default: layout-previews/) and prints
// the coordinate/validation summary to stdout.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LayoutIntent, LayoutPlan } from '../src/layout-plan'
import { longestSharedEdge, polygonArea, polygonBounds } from '../src/layout-plan'
import { partitionLayout } from '../src/layout-partitioner'
import { validateLayoutPlan } from '../src/plan-validator'

const INTENTS: Array<{ slug: string; title: string; intent: LayoutIntent }> = [
  {
    slug: '01-single-room',
    title: '单间 20㎡',
    intent: {
      targetTotalAreaSqm: 20,
      rooms: [{ id: 'room-1', name: '单间', type: 'other' }],
    },
  },
  {
    slug: '02-studio',
    title: 'Studio 35㎡（开放式厨房）',
    intent: {
      targetTotalAreaSqm: 35,
      rooms: [
        { id: 'lk-1', name: '客厅/开放式厨房', type: 'living_kitchen', targetAreaSqm: 30 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
      ],
    },
  },
  {
    slug: '03-one-bedroom',
    title: '一居 50㎡',
    intent: {
      targetTotalAreaSqm: 50,
      rooms: [
        { id: 'bedroom-1', name: '卧室', type: 'bedroom', targetAreaSqm: 13 },
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 22 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 6 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 4 },
      ],
    },
  },
  {
    slug: '04-two-bedroom',
    title: '两居 75㎡',
    intent: {
      targetTotalAreaSqm: 75,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 15 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 11 },
        { id: 'living-1', name: '客厅', type: 'living' },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen' },
        { id: 'bath-1', name: '卫生间', type: 'bathroom' },
      ],
    },
  },
  {
    slug: '05-three-bedroom',
    title: '三居 110㎡（两卫）',
    intent: {
      targetTotalAreaSqm: 110,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 16 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
        { id: 'bedroom-3', name: '儿童房', type: 'bedroom', targetAreaSqm: 10 },
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 28 },
        { id: 'dining-1', name: '餐厅', type: 'dining' },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen' },
        { id: 'bath-1', name: '客卫', type: 'bathroom' },
        { id: 'bath-2', name: '主卫', type: 'bathroom' },
      ],
    },
  },
  {
    slug: '06-open-kitchen-two-bedroom',
    title: '开放厨房两居 80㎡',
    intent: {
      targetTotalAreaSqm: 80,
      rooms: [
        { id: 'lk-1', name: '客厅/开放式厨房', type: 'living_kitchen', targetAreaSqm: 34 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 15 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 11 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom' },
      ],
    },
  },
]

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

function renderSvg(title: string, plan: LayoutPlan): string {
  const SCALE = 60
  const PAD = 40
  const W = plan.footprint.width * SCALE + PAD * 2
  const H = plan.footprint.depth * SCALE + PAD * 2 + 30
  const px = (x: number) => PAD + x * SCALE
  // Flip z so the entry side (z=0) renders at the bottom.
  const pz = (z: number) => PAD + (plan.footprint.depth - z) * SCALE

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

  // Door markers on each connection's longest shared edge.
  for (const conn of plan.connections) {
    const a = roomById.get(conn.from)
    const b = roomById.get(conn.to)
    if (!a || !b) continue
    const { midpoint, length } = longestSharedEdge(a.polygon, b.polygon)
    if (length <= 0) continue
    parts.push(`<circle cx="${px(midpoint[0])}" cy="${pz(midpoint[1])}" r="6" fill="#c0392b"/>`)
  }

  // Entry marker.
  const entryRoom = roomById.get(plan.entry.roomId)
  if (entryRoom) {
    const bounds = polygonBounds(entryRoom.polygon)
    const ex = px((bounds.minX + bounds.maxX) / 2)
    const ez = pz(Math.min(...entryRoom.polygon.map(([, z]) => z)))
    parts.push(`<text x="${ex}" y="${ez + 16}" font-size="12" text-anchor="middle" fill="#c0392b" font-weight="bold">▲ 入户</text>`)
  }

  parts.push(`<text x="${PAD}" y="${H - 8}" font-size="10" fill="#888">红点=门（位置由执行器按共享墙段中点计算） ⊞=需外窗</text>`)
  parts.push('</svg>')
  return parts.join('\n')
}

const outDir = process.argv[2] ?? join(import.meta.dir, '..', 'layout-previews')
mkdirSync(outDir, { recursive: true })

for (const { slug, title, intent } of INTENTS) {
  const result = partitionLayout(intent)
  console.log(`\n=== ${title} ===`)
  if (!result.ok) {
    console.log(`✗ 分区失败：${result.reason}`)
    continue
  }
  const { plan } = result
  const validation = validateLayoutPlan(plan, { totalAreaSqm: intent.targetTotalAreaSqm })
  console.log(`footprint: ${plan.footprint.width}m × ${plan.footprint.depth}m = ${(plan.footprint.width * plan.footprint.depth).toFixed(1)}㎡（目标 ${intent.targetTotalAreaSqm}㎡）`)
  console.log(`validation: fatal=${validation.fatal.length} warnings=${validation.warnings.length} score=${validation.score}`)
  for (const message of [...validation.fatal, ...validation.warnings]) console.log(`  - ${message}`)
  for (const note of result.notes) console.log(`  note: ${note}`)
  for (const room of plan.rooms) {
    const area = polygonArea(room.polygon)
    const coords = room.polygon.map(([x, z]) => `(${x},${z})`).join(' ')
    console.log(`  ${room.name.padEnd(10)} ${room.type.padEnd(14)} ${area.toFixed(1).padStart(5)}㎡  ${coords}`)
  }
  console.log(`  connections: ${plan.connections.map(c => `${c.from}↔${c.to}`).join(', ') || '（无）'}`)
  console.log(`  entry: ${plan.entry.roomId}`)
  const file = join(outDir, `${slug}.svg`)
  writeFileSync(file, renderSvg(title, plan))
  console.log(`  svg: ${file}`)
}
