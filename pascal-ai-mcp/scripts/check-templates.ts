// Reference-template health check（户型参照库体检，docs/TEMPLATES.md）。
//
//   bun run scripts/check-templates.ts [templatesDir] [--no-artifacts]
//
// --no-artifacts (CI mode): skip SVG output. Exit code is non-zero when a
// template fails to parse or a "good" reference has validator fatals; the
// partitioner-comparison failing is a known quality gap (TEMPLATES.md #4),
// not a check failure.
//
// For every template in templates/:
//   1. run it through the REAL validator (jp profile) — a "good" reference
//      that our rules reject means the rules are miscalibrated, not the
//      market;
//   2. compute the scorer's view of it (footprint aspect / room aspects /
//      corridor share / penalty) — a "bad" example scoring better than a
//      "good" one exposes a missing penalty term;
//   3. build the SAME room program through our partitioner and put the two
//      side by side (score + SVG) — the visual gap IS the quality gap the
//      user perceives.
// SVGs land in layout-previews/templates/. Zero model calls.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LayoutIntent, LayoutPlan } from '../src/layout-plan'
import { polygonArea, polygonBounds } from '../src/layout-plan'
import { partitionLayout, scoreCandidate } from '../src/layout-partitioner'
import { resolveNormProfile } from '../src/norms/profile'
import { validateLayoutPlan } from '../src/plan-validator'
import { deriveStrategy } from '../src/strategy'
import { templateFilePaths } from '../src/template-seed'
import { renderPlanSvg } from './render-plan-svg'

type Template = {
  id: string
  meta: {
    market: string
    label: string
    source: string
    quality: 'good' | 'bad'
    badReasons: string[]
    typology?: string
    notes?: string
  }
  plan: LayoutPlan
}

function planMetrics(plan: LayoutPlan, profile: ReturnType<typeof resolveNormProfile>) {
  const { width, depth } = plan.footprint
  const roomAspects = plan.rooms
    .filter(room => room.type !== 'hallway' && room.type !== 'storage')
    .map(room => {
      const b = polygonBounds(room.polygon)
      const w = b.maxX - b.minX
      const d = b.maxZ - b.minZ
      return Math.max(w, d) / Math.min(w, d)
    })
  const corridorArea = plan.rooms
    .filter(room => room.type === 'hallway')
    .reduce((sum, room) => sum + polygonArea(room.polygon), 0)
  const corridorRatio = corridorArea / (width * depth)
  const penalty = scoreCandidate({
    footprintW: width,
    footprintD: depth,
    roomAspects,
    corridorRatio,
  }, profile.scoring)
  return { maxRoomAspect: Math.max(...roomAspects), corridorRatio, penalty }
}

const args = process.argv.slice(2)
const noArtifacts = args.includes('--no-artifacts')
const templatesDir = args.filter(arg => !arg.startsWith('--'))[0] ?? join(import.meta.dir, '..', 'templates')
const problems: string[] = []
// Previews mirror the library layout: good/ and bad/ hold the reference
// renders, ours/ holds the partitioner-comparison renders — mixing 参照 and
// --ours in one flat folder kept getting the comparison mistaken for a
// template (2026-07-17 用户反馈).
const outDir = join(import.meta.dir, '..', 'layout-previews', 'templates')
if (!noArtifacts) {
  for (const sub of ['good', 'bad', 'ours']) {
    const subDir = join(outDir, sub)
    mkdirSync(subDir, { recursive: true })
    // Stale-output guard: a template whose partitioner comparison succeeded
    // last run but fails now would otherwise keep its old ours/ SVG around and
    // pass for a fresh result.
    for (const file of readdirSync(subDir)) {
      if (file.endsWith('.svg')) rmSync(join(subDir, file))
    }
  }
}

const files = templateFilePaths(templatesDir)
for (const file of files) {
  let template: Template
  try {
    template = JSON.parse(readFileSync(file, 'utf8')) as Template
    if (!template?.meta?.quality || !Array.isArray(template?.plan?.rooms)) {
      throw new Error('缺少 meta.quality 或 plan.rooms')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    problems.push(`${file}: 模板加载失败 —— ${message}`)
    console.log(`\n=== ${file}\n  LOAD FAIL  ${message}`)
    continue
  }
  const profile = resolveNormProfile(template.meta.market)
  const plan = template.plan
  const lotArea = plan.footprint.width * plan.footprint.depth

  console.log(`\n=== ${template.id} · ${template.meta.label} [${template.meta.quality}]`)

  // 1. Our validator's verdict on the reference.
  const validation = validateLayoutPlan(plan, { totalAreaSqm: Math.round(lotArea * 10) / 10 }, profile)
  console.log(`validator: fatal=${validation.fatal.length} warnings=${validation.warnings.length} score=${validation.score}`)
  for (const message of validation.fatal) console.log(`  FATAL  ${message}`)
  for (const message of validation.warnings) console.log(`  warn   ${message}`)
  if (template.meta.quality === 'good' && validation.fatal.length > 0) {
    problems.push(`${template.id}: good 参照存在 ${validation.fatal.length} 个 validator fatal`)
  }

  // 2. Scorer's view.
  const metrics = planMetrics(plan, profile)
  console.log(`scorer: penalty=${metrics.penalty.toFixed(2)} maxRoomAspect=${metrics.maxRoomAspect.toFixed(2)} corridorShare=${(metrics.corridorRatio * 100).toFixed(1)}%`)
  if (template.meta.quality === 'bad') {
    console.log(`  badReasons: ${template.meta.badReasons.join('；')}`)
  }

  if (!noArtifacts) {
    writeFileSync(
      join(outDir, template.meta.quality === 'bad' ? 'bad' : 'good', `${template.id}.svg`),
      renderPlanSvg(`${template.meta.label} [参照]`, plan),
    )
  }

  // 3. Same program through our generator (good references only).
  if (template.meta.quality !== 'good') continue
  const intent: LayoutIntent = {
    targetTotalAreaSqm: Math.round(lotArea * 10) / 10,
    rooms: plan.rooms
      .filter(room => room.type !== 'hallway')
      .map(room => ({
        id: room.id,
        name: room.name,
        type: room.type,
        targetAreaSqm: Math.round(polygonArea(room.polygon) * 10) / 10,
      })),
  }
  const requiredRooms = [...intent.rooms.reduce((acc, room) => {
    acc.set(room.type, (acc.get(room.type) ?? 0) + 1)
    return acc
  }, new Map<string, number>())].map(([type, count]) => ({ type: type as never, count }))
  const strategy = deriveStrategy({
    ...(template.meta.typology === 'narrow_lot'
      ? { siteHint: { widthM: plan.footprint.width, depthM: plan.footprint.depth } }
      : {}),
  }, { totalAreaSqm: intent.targetTotalAreaSqm, requiredRooms }, profile)
  const generated = partitionLayout(intent, profile, strategy)
  if (!generated.ok) {
    console.log(`OURS: 分区失败 —— ${generated.reason}`)
    continue
  }
  const ourValidation = validateLayoutPlan(generated.plan, { totalAreaSqm: intent.targetTotalAreaSqm }, profile)
  const ourMetrics = planMetrics(generated.plan, profile)
  console.log(`OURS(${strategy.typology}): validator score=${ourValidation.score} fatal=${ourValidation.fatal.length} penalty=${ourMetrics.penalty.toFixed(2)} maxRoomAspect=${ourMetrics.maxRoomAspect.toFixed(2)} corridorShare=${(ourMetrics.corridorRatio * 100).toFixed(1)}%`)
  if (!noArtifacts) {
    writeFileSync(join(outDir, 'ours', `${template.id}.svg`), renderPlanSvg(`${template.meta.label} [我们的生成]`, generated.plan))
  }
}

if (!noArtifacts) console.log(`\nSVG 输出目录：${outDir}`)

if (problems.length > 0) {
  console.error(`\n体检未通过（${problems.length} 项）：`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`\n体检通过：${files.length} 份模板。`)
