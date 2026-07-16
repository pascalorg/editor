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
import { partitionLayout, type PartitionStrategyHint } from '../src/layout-partitioner'
import { renderPlanSvg } from './render-plan-svg'
import { validateLayoutPlan } from '../src/plan-validator'

const INTENTS: Array<{ slug: string; title: string; intent: LayoutIntent; strategy?: PartitionStrategyHint }> = [
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
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 36 },
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
  {
    slug: '07-narrow-lot',
    title: '狭长地块两居 5×18m（case-06）',
    intent: {
      targetTotalAreaSqm: 90,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 26 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 16 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 8 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
      ],
    },
    strategy: { typology: 'narrow_lot', footprintHint: { widthM: 5, depthM: 18 } },
  },
  {
    slug: '08-tanoji',
    title: '田の字 2LDK 62㎡',
    intent: {
      targetTotalAreaSqm: 62,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 26 },
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom', targetAreaSqm: 12 },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom', targetAreaSqm: 10 },
        { id: 'bath-1', name: '浴室', type: 'bathroom', targetAreaSqm: 4 },
        { id: 'entry-1', name: '玄関', type: 'entry', targetAreaSqm: 2.5 },
      ],
    },
    strategy: { typology: 'tanoji' },
  },
  {
    slug: '09-l-shape',
    title: 'L 形三居 95㎡',
    intent: {
      targetTotalAreaSqm: 95,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 30 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 15 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
        { id: 'bedroom-3', name: '客卧', type: 'bedroom', targetAreaSqm: 10 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
        { id: 'storage-1', name: '储物间', type: 'storage', targetAreaSqm: 3 },
      ],
    },
    strategy: { typology: 'l_shape' },
  },
]

const outDir = process.argv[2] ?? join(import.meta.dir, '..', 'layout-previews')
mkdirSync(outDir, { recursive: true })

for (const { slug, title, intent, strategy } of INTENTS) {
  const result = partitionLayout(intent, undefined, strategy)
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
  writeFileSync(file, renderPlanSvg(title, plan))
  console.log(`  svg: ${file}`)
}
