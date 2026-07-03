// Pure schema + helpers for the human-review workflow layered on top of the
// automated eval runs. No I/O here (so it's unit-testable and importable by
// both run-eval.ts and review.ts without triggering a CLI); the review.ts
// harness does the file reads/writes around these functions.

export type ReviewVerdict = 'GOOD' | 'PASS' | 'BORDERLINE' | 'FAIL'
export const REVIEW_VERDICTS: ReviewVerdict[] = ['GOOD', 'PASS', 'BORDERLINE', 'FAIL']

export type IssueSeverity = 'minor' | 'major' | 'critical'
export const ISSUE_SEVERITIES: IssueSeverity[] = ['minor', 'major', 'critical']

// The six 1–5 quality dimensions a reviewer scores. Kept as a const tuple so
// the type, the template, and the aggregation all stay in lockstep.
export const SCORE_KEYS = [
  'requirementFit',
  'layout',
  'circulation',
  'doorsAndWindows',
  'furniture',
  'overallRealism',
] as const
export type ScoreKey = (typeof SCORE_KEYS)[number]
export type ReviewScores = Record<ScoreKey, number>

export type ReviewIssue = {
  tag: string
  severity: IssueSeverity
  target?: string
  note?: string
}

export type Review = {
  caseId: string
  repeatIndex: number
  sceneId: string | null
  verdict: ReviewVerdict
  scores: ReviewScores
  issues: ReviewIssue[]
  reviewerNote?: string
  reviewedAt: string
}

export type ReviewMeta = {
  caseId: string
  repeatIndex: number
  sceneId: string | null
}

/**
 * A blank review pre-filled with the run's identity. Scores/verdict/reviewedAt
 * are left null so `validateReview` can tell a not-yet-reviewed template apart
 * from a completed review. The `_instructions` array is a self-documenting
 * hint; deleting it is part of "I filled this in".
 */
export function buildReviewTemplate(meta: ReviewMeta): Record<string, unknown> {
  return {
    _instructions: [
      '【填写步骤】对照编辑器里打开的场景（sceneId 见下）和 raw/ 里的机器诊断，逐项填写，完成后删除本 _instructions 字段。',
      '',
      '【verdict 怎么选】',
      'GOOD：可作为回归基准。需求全部满足，结构/动线/门窗/家具都合理，几乎不用返工；无 critical、无 major 问题，overallRealism ≥ 4。',
      'PASS：可用。核心需求满足，只有少量 minor 问题；无 critical，major 至多 1 个。',
      'BORDERLINE：基本成型但有明显问题（如动线不畅、家具重叠/越界），需人工返工才能用；有 major 但结构没崩。',
      'FAIL：不可用。核心需求未满足或有结构性错误（缺房间、封闭房间、卧室动线不通、大量越界），或生成本身失败。',
      '',
      '【scores 每项 1-5 的整数，评分基准】',
      '5=优秀，无可挑剔；4=良好，个别小瑕疵；3=合格，有可接受的问题；2=较差，多处问题需返工；1=不可用/该项严重错误或缺失。',
      '',
      '【六个维度分别看什么】',
      'requirementFit：是否满足用户需求——面积、房间数量、明确点名的功能空间（卧室/客厅/厨房/卫生间等）。',
      'layout：房间尺寸与比例是否合理，有无过窄（<约1.8m）或畸形长条房间，有无无用碎空间。',
      'circulation：动线是否合理——每个卧室能否只经公共区域（客厅/玄关/走廊）到达，不必穿卫生间/厨房/其他卧室。',
      'doorsAndWindows：门窗数量与位置——窗只开在外墙、门开启方向不互相/与家具冲突、每个房间有门可进。',
      'furniture：家具是否齐全且摆放合理——无重叠、无越界、朝向与通行合理（注意机器只做粗略重叠检测）。',
      'overallRealism：整体是否像一个真实、可住的户型。',
      '',
      '【issues】逐条列出问题：severity 用 minor / major / critical；tag 用简短英文标签（如 poor_circulation、furniture_overlap、missing_room）；可带 target（房间/节点）和 note（简述）。',
      '【reviewedAt】填 ISO 时间，例如 2026-07-03T12:00:00+09:00。',
    ],
    caseId: meta.caseId,
    repeatIndex: meta.repeatIndex,
    sceneId: meta.sceneId,
    verdict: null,
    scores: {
      requirementFit: null,
      layout: null,
      circulation: null,
      doorsAndWindows: null,
      furniture: null,
      overallRealism: null,
    },
    issues: [],
    reviewerNote: '',
    reviewedAt: null,
  }
}

export type ReviewValidation = {
  /** Structural problems — a filled field with the wrong type/range/value. */
  errors: string[]
  /** True when the review is still an untouched/partial template (not an error). */
  pending: boolean
}

function isFilledScore(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validate a parsed review object. Separates two concerns:
 *  - `pending`: the review hasn't been filled in yet (verdict/score/date still
 *    null, or the `_instructions` hint is still present). Not an error — just
 *    "no human verdict yet".
 *  - `errors`: fields that ARE present but malformed (bad verdict value, a
 *    score outside 1–5 or non-integer, a bad severity, missing identity).
 * A review can be both pending and error-free (a clean template) or complete
 * with errors (a filled-in review with a typo).
 */
export function validateReview(value: unknown): ReviewValidation {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { errors: ['review 不是一个对象'], pending: true }
  }
  const review = value as Record<string, unknown>

  if (typeof review.caseId !== 'string' || !review.caseId) errors.push('caseId 缺失或不是字符串')
  if (typeof review.repeatIndex !== 'number' || !Number.isInteger(review.repeatIndex)) {
    errors.push('repeatIndex 缺失或不是整数')
  }
  if (review.sceneId !== null && typeof review.sceneId !== 'string') {
    errors.push('sceneId 必须是字符串或 null')
  }

  let pending = false
  if ('_instructions' in review) pending = true

  // Verdict
  if (review.verdict === null || review.verdict === undefined) {
    pending = true
  } else if (!REVIEW_VERDICTS.includes(review.verdict as ReviewVerdict)) {
    errors.push(`verdict "${String(review.verdict)}" 不合法，应为 ${REVIEW_VERDICTS.join(' / ')}`)
  }

  // Scores
  const scores = review.scores
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    errors.push('scores 缺失或不是对象')
    pending = true
  } else {
    const scoreObj = scores as Record<string, unknown>
    for (const key of SCORE_KEYS) {
      const raw = scoreObj[key]
      if (raw === null || raw === undefined) {
        pending = true
        continue
      }
      if (!isFilledScore(raw) || !Number.isInteger(raw) || (raw as number) < 1 || (raw as number) > 5) {
        errors.push(`scores.${key} 必须是 1-5 的整数`)
      }
    }
    for (const key of Object.keys(scoreObj)) {
      if (!(SCORE_KEYS as readonly string[]).includes(key)) {
        errors.push(`scores 里有未知维度 "${key}"`)
      }
    }
  }

  // Issues
  if (review.issues !== undefined) {
    if (!Array.isArray(review.issues)) {
      errors.push('issues 必须是数组')
    } else {
      review.issues.forEach((issue, index) => {
        if (!issue || typeof issue !== 'object') {
          errors.push(`issues[${index}] 不是对象`)
          return
        }
        const it = issue as Record<string, unknown>
        if (typeof it.tag !== 'string' || !it.tag) errors.push(`issues[${index}].tag 缺失`)
        if (!ISSUE_SEVERITIES.includes(it.severity as IssueSeverity)) {
          errors.push(`issues[${index}].severity 不合法，应为 ${ISSUE_SEVERITIES.join(' / ')}`)
        }
        if (it.target !== undefined && typeof it.target !== 'string') errors.push(`issues[${index}].target 必须是字符串`)
        if (it.note !== undefined && typeof it.note !== 'string') errors.push(`issues[${index}].note 必须是字符串`)
      })
    }
  }

  // reviewedAt
  if (review.reviewedAt === null || review.reviewedAt === undefined || review.reviewedAt === '') {
    pending = true
  } else if (typeof review.reviewedAt !== 'string' || Number.isNaN(Date.parse(review.reviewedAt))) {
    errors.push('reviewedAt 不是合法的时间字符串')
  }

  if (review.reviewerNote !== undefined && typeof review.reviewerNote !== 'string') {
    errors.push('reviewerNote 必须是字符串')
  }

  return { errors, pending }
}

export function isCompleteReview(value: unknown): value is Review {
  const { errors, pending } = validateReview(value)
  return errors.length === 0 && !pending
}

// Map a raw run file name to its paired review file name (only adds .review).
export function reviewFileNameFor(rawFileName: string): string {
  return rawFileName.replace(/\.json$/, '.review.json')
}

export type MergedCase = {
  caseId: string
  repeatIndex: number
  sceneId: string | null
  auto: {
    ok: boolean
    workflowCompleted: boolean
    assertionsPassed: boolean
    finalPhase?: string
    remainingIssueCount?: number
    failureCode?: string
    modelAttempts?: number
  }
  review: Review | null
  reviewPending: boolean
  reviewErrors: string[]
}

type RawRunLike = {
  caseId: string
  repeatIndex: number
  sceneId?: string | null
  ok?: boolean
  workflowCompleted?: boolean
  assertionsPassed?: boolean
  finalPhase?: string
  failureCode?: string
  modelAttempts?: number
  sceneResult?: { remainingIssueCount?: number } | null
}

export function mergeReviewWithRaw(raw: RawRunLike, reviewValue: unknown): MergedCase {
  const { errors, pending } = validateReview(reviewValue)
  const complete = errors.length === 0 && !pending
  return {
    caseId: raw.caseId,
    repeatIndex: raw.repeatIndex,
    sceneId: raw.sceneId ?? null,
    auto: {
      ok: Boolean(raw.ok),
      workflowCompleted: Boolean(raw.workflowCompleted),
      assertionsPassed: Boolean(raw.assertionsPassed),
      finalPhase: raw.finalPhase,
      remainingIssueCount: raw.sceneResult?.remainingIssueCount,
      failureCode: raw.failureCode,
      modelAttempts: raw.modelAttempts,
    },
    review: complete ? (reviewValue as Review) : null,
    reviewPending: pending,
    reviewErrors: errors,
  }
}

export type ReviewSummary = {
  total: number
  reviewed: number
  pending: number
  invalid: number
  verdictCounts: Record<string, number>
  avgScores: Partial<Record<ScoreKey, number>>
  baselines: Array<{ caseId: string; repeatIndex: number; sceneId: string | null }>
}

export function summarizeReviews(cases: MergedCase[]): ReviewSummary {
  const reviewedCases = cases.filter(c => c.review)
  const verdictCounts: Record<string, number> = {}
  for (const c of reviewedCases) {
    const v = c.review!.verdict
    verdictCounts[v] = (verdictCounts[v] ?? 0) + 1
  }
  const avgScores: Partial<Record<ScoreKey, number>> = {}
  if (reviewedCases.length > 0) {
    for (const key of SCORE_KEYS) {
      const sum = reviewedCases.reduce((acc, c) => acc + c.review!.scores[key], 0)
      avgScores[key] = Math.round((sum / reviewedCases.length) * 100) / 100
    }
  }
  const baselines = reviewedCases
    .filter(c => c.review!.verdict === 'GOOD' && c.sceneId)
    .map(c => ({ caseId: c.caseId, repeatIndex: c.repeatIndex, sceneId: c.sceneId }))
  return {
    total: cases.length,
    reviewed: reviewedCases.length,
    pending: cases.filter(c => c.reviewPending && c.reviewErrors.length === 0).length,
    invalid: cases.filter(c => c.reviewErrors.length > 0).length,
    verdictCounts,
    avgScores,
    baselines,
  }
}

// The "手顺" dropped into every report directory so a reviewer knows exactly
// what to do without hunting for docs.
export const REVIEW_GUIDE_MD = `# 户型评测 · 人工评审手顺

本目录是一次评测运行的产物。结构如下：

- \`raw/\`：程序自动生成的机器诊断结果，**不要手改**。
- \`reviews/\`：人工评审结果。文件名与 \`raw/\` 一一对应，只多一个 \`.review\`。
- \`summary.json\` / \`summary.md\`：自动诊断汇总。
- \`final-report.json\` / \`final-report.md\`：运行 \`eval:review\` 后生成的「自动 + 人工」合并报告。
- \`baselines.json\`：verdict = GOOD 的案例及其 sceneId，可作为以后的固定基准。

## 评审步骤

1. 打开 \`reviews/\` 里的每个 \`*.review.json\` 模板（若不存在，先运行 \`bun run eval:review --init\` 生成）。
2. 对照 \`raw/\` 里对应的机器结果，以及编辑器里打开的场景（sceneId 在文件里）。
3. 填写：
   - \`verdict\`：见下方「verdict 判定基准」。
   - \`scores\`：六个维度各打 1-5 的整数，见下方「评分基准」和「维度含义」。
   - \`issues\`：逐条列出问题，\`severity\` 用 \`minor\` / \`major\` / \`critical\`，\`tag\` 用简短英文标签，可带 \`target\` 和 \`note\`。
   - \`reviewerNote\`：一句话总结。
   - \`reviewedAt\`：ISO 时间。
   - 删除 \`_instructions\` 字段。

### verdict 判定基准

- **GOOD**：可作为回归基准。需求全部满足，结构/动线/门窗/家具都合理，几乎不用返工；无 critical、无 major，overallRealism ≥ 4。
- **PASS**：可用。核心需求满足，只有少量 minor 问题；无 critical，major 至多 1 个。
- **BORDERLINE**：基本成型但有明显问题（动线不畅、家具重叠/越界等），需人工返工才能用；有 major 但结构没崩。
- **FAIL**：不可用。核心需求未满足或有结构性错误（缺房间、封闭房间、卧室动线不通、大量越界），或生成本身失败。

### 评分基准（每项 1-5 的整数）

| 分 | 含义 |
|----|------|
| 5 | 优秀，无可挑剔 |
| 4 | 良好，个别小瑕疵 |
| 3 | 合格，有可接受的问题 |
| 2 | 较差，多处问题需返工 |
| 1 | 不可用／该项严重错误或缺失 |

### 六个维度分别看什么

- **requirementFit**：是否满足用户需求——面积、房间数量、明确点名的功能空间。
- **layout**：房间尺寸与比例是否合理，有无过窄（<约 1.8m）或畸形长条房间、无用碎空间。
- **circulation**：动线是否合理——每个卧室能否只经公共区域（客厅/玄关/走廊）到达，不必穿卫生间/厨房/其他卧室。
- **doorsAndWindows**：窗只开在外墙、门开启方向不冲突、每个房间有门可进。
- **furniture**：家具齐全且摆放合理——无重叠、无越界、朝向与通行合理（机器只做粗略重叠检测，需人工核对）。
- **overallRealism**：整体是否像一个真实、可住的户型。
4. 运行 \`bun run eval:review\` 校验并合并：
   - 校验所有 \`*.review.json\`（字段类型、分数范围、verdict/severity 取值）。
   - 生成 \`final-report.json\` / \`final-report.md\`（机器诊断 + 人工评分）。
   - 把 GOOD 案例写入 \`baselines.json\`。

## 常用命令

\`\`\`bash
# 为最新一次报告生成评审模板 + 本手顺
bun run eval:review --init

# 指定某次报告
bun run eval:review --report=eval/report/2026-07-03T02-07-04-731Z --init

# 校验 + 汇总（默认对最新报告）
bun run eval:review
\`\`\`

## 该提交什么到 Git

- **提交**：\`reviews/*.review.json\`（人工评审）、精选的基准报告（\`baselines.json\` 及对应说明）。
- **忽略**：\`raw/\` 大体积机器结果、\`summary.*\`、\`final-report.*\` 等每次临时运行产物（见本目录上层的 \`.gitignore\`）。
`
