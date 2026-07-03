#!/usr/bin/env bun
// Human-review harness for eval reports. Two modes:
//
//   bun run eval:review --init            # scaffold reviews/ templates + guide
//   bun run eval:review                   # validate reviews + merge into final report
//
// Both default to the most recent report under eval/report/; pass
// --report=<dir> to target a specific one. `--init` never overwrites an
// existing review (so it won't clobber work in progress).
//
// The pure schema/merge/aggregation logic lives in review-schema.ts (unit
// tested); this file is just the I/O around it.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  REVIEW_GUIDE_MD,
  buildReviewTemplate,
  mergeReviewWithRaw,
  reviewFileNameFor,
  summarizeReviews,
  validateReview,
  type MergedCase,
} from './review-schema'

const REPORT_ROOT = join(import.meta.dir, 'report')

function parseArgs(): { init: boolean; reportDir?: string } {
  let init = false
  let reportDir: string | undefined
  for (const arg of process.argv.slice(2)) {
    if (arg === '--init') init = true
    if (arg.startsWith('--report=')) reportDir = arg.slice('--report='.length)
  }
  return { init, reportDir }
}

function latestReportDir(): string | undefined {
  if (!existsSync(REPORT_ROOT)) return undefined
  const dirs = readdirSync(REPORT_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
  const last = dirs.at(-1)
  return last ? join(REPORT_ROOT, last) : undefined
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function rawFiles(reportDir: string): string[] {
  const rawDir = join(reportDir, 'raw')
  if (!existsSync(rawDir)) return []
  return readdirSync(rawDir).filter(f => f.endsWith('.json')).sort()
}

// Exported so run-eval.ts can scaffold templates + guide right after a run,
// without duplicating the logic or importing this file's CLI entry point.
export function scaffoldReviews(reportDir: string): { created: string[]; skipped: string[] } {
  const reviewsDir = join(reportDir, 'reviews')
  mkdirSync(reviewsDir, { recursive: true })
  writeFileSync(join(reportDir, 'REVIEW_GUIDE.md'), REVIEW_GUIDE_MD)
  const created: string[] = []
  const skipped: string[] = []
  for (const file of rawFiles(reportDir)) {
    const reviewName = reviewFileNameFor(file)
    const reviewPath = join(reviewsDir, reviewName)
    if (existsSync(reviewPath)) {
      skipped.push(reviewName)
      continue
    }
    const raw = readJson(join(reportDir, 'raw', file)) as {
      caseId: string
      repeatIndex: number
      sceneId?: string | null
    }
    const template = buildReviewTemplate({
      caseId: raw.caseId,
      repeatIndex: raw.repeatIndex,
      sceneId: raw.sceneId ?? null,
    })
    writeFileSync(reviewPath, `${JSON.stringify(template, null, 2)}\n`)
    created.push(reviewName)
  }
  return { created, skipped }
}

function merge(reportDir: string): number {
  const reviewsDir = join(reportDir, 'reviews')
  const cases: MergedCase[] = []
  let hardErrors = 0

  for (const file of rawFiles(reportDir)) {
    const raw = readJson(join(reportDir, 'raw', file)) as Parameters<typeof mergeReviewWithRaw>[0]
    const reviewPath = join(reviewsDir, reviewFileNameFor(file))
    let reviewValue: unknown = undefined
    if (existsSync(reviewPath)) {
      try {
        reviewValue = readJson(reviewPath)
      } catch (error) {
        console.error(`[review] ${basename(reviewPath)} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
        hardErrors++
      }
    }
    const merged = mergeReviewWithRaw(raw, reviewValue)
    if (merged.reviewErrors.length > 0) {
      hardErrors++
      console.error(`[review] ${reviewFileNameFor(file)} 校验失败：`)
      for (const err of merged.reviewErrors) console.error(`          - ${err}`)
    }
    cases.push(merged)
  }

  const summary = summarizeReviews(cases)
  const final = { reportDir, generatedAt: new Date().toISOString(), summary, cases }
  writeFileSync(join(reportDir, 'final-report.json'), `${JSON.stringify(final, null, 2)}\n`)
  writeFileSync(join(reportDir, 'final-report.md'), renderFinalMarkdown(final))
  writeFileSync(join(reportDir, 'baselines.json'), `${JSON.stringify(summary.baselines, null, 2)}\n`)

  console.log(
    `\n[review] 合并完成：共 ${summary.total}，已评审 ${summary.reviewed}，待评审 ${summary.pending}，校验失败 ${summary.invalid}。`,
  )
  console.log(`[review] 报告已写入 ${join(reportDir, 'final-report.md')}`)
  if (summary.baselines.length > 0) {
    console.log(`[review] GOOD 基准 ${summary.baselines.length} 个 → baselines.json`)
  }
  return hardErrors
}

function renderFinalMarkdown(final: {
  reportDir: string
  generatedAt: string
  summary: ReturnType<typeof summarizeReviews>
  cases: MergedCase[]
}): string {
  const s = final.summary
  const lines = [
    '# pascal-ai-mcp 评测最终报告（自动诊断 + 人工评审）',
    '',
    `- 报告目录：${final.reportDir}`,
    `- 生成时间：${final.generatedAt}`,
    `- 用例总数：${s.total}；已评审 ${s.reviewed}；待评审 ${s.pending}；校验失败 ${s.invalid}`,
    `- verdict 分布：${Object.entries(s.verdictCounts).map(([v, n]) => `${v}×${n}`).join('，') || '（无）'}`,
    `- 平均分：${Object.entries(s.avgScores).map(([k, v]) => `${k}=${v}`).join('，') || '（暂无评审）'}`,
    `- GOOD 基准：${s.baselines.map(b => `${b.caseId}#${b.repeatIndex}(${b.sceneId})`).join('，') || '（无）'}`,
    '',
    '## 逐用例',
    '',
  ]
  for (const c of final.cases) {
    lines.push(`### ${c.caseId} · run ${c.repeatIndex}`)
    lines.push(
      `- 自动：ok=${c.auto.ok}，phase=${c.auto.finalPhase ?? '?'}，remaining=${c.auto.remainingIssueCount ?? '?'}${c.auto.failureCode ? `，failureCode=${c.auto.failureCode}` : ''}${c.auto.modelAttempts !== undefined ? `，modelAttempts=${c.auto.modelAttempts}` : ''}`,
    )
    if (c.reviewErrors.length > 0) {
      lines.push(`- 人工：**校验失败** — ${c.reviewErrors.join('；')}`)
    } else if (!c.review) {
      lines.push('- 人工：待评审')
    } else {
      const r = c.review
      lines.push(
        `- 人工：verdict=${r.verdict}，分数=${Object.entries(r.scores).map(([k, v]) => `${k}:${v}`).join(' ')}`,
      )
      if (r.issues.length > 0) {
        lines.push(`- 问题：${r.issues.map(i => `[${i.severity}]${i.tag}${i.target ? `(${i.target})` : ''}${i.note ? ` ${i.note}` : ''}`).join('；')}`)
      }
      if (r.reviewerNote) lines.push(`- 评语：${r.reviewerNote}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function main(): void {
  const { init, reportDir: explicit } = parseArgs()
  const reportDir = explicit ?? latestReportDir()
  if (!reportDir || !existsSync(reportDir)) {
    console.error('找不到报告目录。先运行 `bun run eval` 生成一次报告，或用 --report=<dir> 指定。')
    process.exit(1)
  }

  if (init) {
    const { created, skipped } = scaffoldReviews(reportDir)
    console.log(`[review] 模板已生成：新增 ${created.length}，已存在跳过 ${skipped.length}。`)
    console.log(`[review] 手顺已写入 ${join(reportDir, 'REVIEW_GUIDE.md')}`)
    process.exit(0)
  }

  const hardErrors = merge(reportDir)
  // Non-zero exit when any review failed schema validation, so CI / a human
  // notices a malformed review instead of it silently dropping out.
  process.exit(hardErrors > 0 ? 1 : 0)
}

// Only run the CLI when invoked directly, so run-eval.ts can import
// `scaffoldReviews` without triggering argument parsing / process.exit.
if (import.meta.main) {
  main()
}
