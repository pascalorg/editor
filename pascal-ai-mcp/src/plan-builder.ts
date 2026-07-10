// ---------------------------------------------------------------------------
// Plan builder (GENERATION_REDESIGN.md §1 steps ①–③): the only place a model
// appears between brief confirmation and scene construction.
//
// The model outputs a LayoutIntent (semantics only, no coordinates); the
// deterministic partitioner turns it into a LayoutPlan; the validator judges
// the plan. Fatal findings — parse defects, partitioner dead-ends, validator
// violations — are quoted back in a correction prompt and the model retries,
// up to `maxRounds` total attempts. Everything here runs BEFORE any Pascal
// scene exists, so a failed build costs prompts, never abandoned scenes.
//
// The experimental `llmGeometry` switch asks the model for LayoutPlan
// geometry directly (skipping the partitioner) and pushes it through the
// same validator — a comparison path for measuring partitioner-vs-LLM layout
// quality. Off by default; never the main path.
// ---------------------------------------------------------------------------

import {
  parseLayoutIntent,
  ROOM_TYPES,
  type IssueL10n,
  type LayoutIntent,
  type LayoutPlan,
  type RoomType,
} from './layout-plan'
import { partitionLayout } from './layout-partitioner'
import { DEFAULT_NORM_PROFILE, type NormProfile } from './norms/profile'
import { validateLayoutPlan, type PlanTargets, type PlanValidation } from './plan-validator'
import { applyStrategy, strategyPromptLines, type StrategyDecision } from './strategy'
import type { ChatMessage } from './types'

// One plain-text completion (no tools). The agent wires this to its model
// client with fallback + call budgeting; tests inject a stub.
export type CompleteText = (messages: ChatMessage[], tag: string) => Promise<string>

export type PlanBuildOptions = {
  // Total model attempts (1 initial + corrections). §9 budgets "Intent 1–3".
  maxRounds?: number
  // Experimental: model emits LayoutPlan geometry directly (§2, 意见②).
  llmGeometry?: boolean
  // Rebuild path (§5 失败分流): acceptance failures from the previous build,
  // quoted into the FIRST prompt so the replan avoids them from round one.
  priorFailures?: string[]
  // Market/regulation parameters for the partitioner (NORMS_PROFILE_DESIGN.md).
  profile?: NormProfile
  // Strategy decision (LAYOUT_STRATEGY_DESIGN.md): injected into the Intent
  // prompt and enforced on the parsed intent before partitioning.
  strategy?: StrategyDecision
}

export type PlanBuildSuccess = {
  ok: true
  intent: LayoutIntent | null // null on the llmGeometry path
  plan: LayoutPlan
  validation: PlanValidation
  modelCalls: number
}

export type PlanBuildFailure = {
  ok: false
  // Last round's blocking findings, for the failure reply / eval report.
  // zh canonical (correction prompts quote these verbatim).
  failures: string[]
  // Aligned with `failures`: template refs so the planRejected reply can
  // re-render each line in the user's language; null = zh passthrough.
  failuresL10n: Array<IssueL10n | null>
  modelCalls: number
}

export type PlanBuildResult = PlanBuildSuccess | PlanBuildFailure

const DEFAULT_MAX_ROUNDS = 3

const INTENT_SYSTEM_PROMPT = `你是户型规划器。只返回一个 JSON 对象，不要任何解释或 Markdown 代码块。
JSON 结构（LayoutIntent，只有语义，没有任何坐标）：
{
  "targetTotalAreaSqm": <目标总面积，数字，㎡>,
  "rooms": [
    {
      "id": "<唯一 id，如 bedroom-1>",
      "name": "<展示名，如 主卧>",
      "type": "<${ROOM_TYPES.join('|')}>",
      "targetAreaSqm": <可选，目标面积>,
      "requiresExteriorWindow": <可选，布尔>
    }
  ],
  "adjacency": [ { "a": "<房间id>", "b": "<房间id>" } ]  // 可选，仅超出常规动线的额外邻接意愿
}

规则：
- 房间清单必须完整覆盖需求里明确要求的房间；需求描述为完整住宅时补齐必要配套（厨房、卫生间、客厅/餐厅、玄关等），只要求 N 间卧室时不要自作主张加配套。
- 需求要求开放式厨房时，输出一间 type 为 living_kitchen 的房间代替独立的 living + kitchen，不要再单独输出厨房。
- 动线空间（走廊/玄关）不需要你规划——分区器会按需自动加，除非需求明确要求。
- targetAreaSqm 缺省时按房型默认值分配，各房间面积之和不必精确等于总面积，分区器会整体缩放。
- 卧室/客厅/书房默认需要外窗，不需要重复声明；只在需求特别要求（或明确不要窗）时设置 requiresExteriorWindow。\n- 房间的 name 使用用户需求所用的语言（中文需求用中文名、日本語なら日本語、英语用英语）；id 一律用英文小写。`

const PLAN_SYSTEM_PROMPT = `你是户型规划器。只返回一个 JSON 对象，不要任何解释或 Markdown 代码块。
JSON 结构（LayoutPlan，含坐标，单位米，原点 (0,0)，轴对齐）：
{
  "footprint": { "width": <宽>, "depth": <深> },
  "entry": { "roomId": "<入户房间 id>" },
  "rooms": [
    {
      "id": "<唯一 id>", "name": "<展示名>",
      "type": "<${ROOM_TYPES.join('|')}>",
      "polygon": [[x,z], ...],  // 轴对齐多边形，全部房间精确铺满 footprint、互不重叠
      "requiresExteriorWindow": <布尔>
    }
  ],
  "connections": [ { "from": "<房间id>", "to": "<房间id>", "type": "door" } ]
}
要求：铺满无缝隙、无重叠；需要外窗的房间至少一条边贴 footprint 边界（≥0.9m）；每条 connection 的两房间共享边 ≥0.9m；全部房间经门从入户房间可达；卧室不得只能穿过厨房/卫生间/其他卧室到达公共空间。`

function correctionPrompt(findings: string[]): string {
  return `上一轮的规划存在以下必须修正的问题：\n${findings.map(f => `- ${f}`).join('\n')}\n请重新输出完整修正后的 JSON（只返回 JSON 对象本身），针对每条问题调整房间清单、房型或面积，不要重复同样的错误。`
}

// Tolerant parse for the experimental LLM-geometry path. Deliberately
// minimal: shape defects surface as validator fatals, which feed the same
// correction loop.
export function parseLayoutPlanJson(raw: string): { plan: LayoutPlan | null; errors: string[] } {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return { plan: null, errors: ['回复中找不到 JSON 对象'] }
  let data: unknown
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    return { plan: null, errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { plan: null, errors: ['LayoutPlan 必须是 JSON 对象'] }
  }
  const value = data as Record<string, unknown>
  const errors: string[] = []
  const footprint = value.footprint as { width?: unknown; depth?: unknown; polygon?: unknown } | undefined
  const width = typeof footprint?.width === 'number' ? footprint.width : undefined
  const depth = typeof footprint?.depth === 'number' ? footprint.depth : undefined
  if (width === undefined || depth === undefined || width <= 0 || depth <= 0) {
    errors.push('footprint.width/depth 缺失或不是正数')
  }
  // Optional non-rectangular outline (S5) — keep it, or the validator loses
  // the very shape it's supposed to check against.
  const footprintPolygon = Array.isArray(footprint?.polygon)
    ? footprint.polygon.filter((point): point is [number, number] =>
        Array.isArray(point) && point.length === 2
        && typeof point[0] === 'number' && typeof point[1] === 'number')
    : []
  const entryRoomId = (value.entry as { roomId?: unknown } | undefined)?.roomId
  if (typeof entryRoomId !== 'string' || !entryRoomId) errors.push('entry.roomId 缺失')
  const roomsRaw = Array.isArray(value.rooms) ? value.rooms : []
  if (roomsRaw.length === 0) errors.push('rooms 缺失或为空')
  const rooms: LayoutPlan['rooms'] = []
  for (let i = 0; i < roomsRaw.length; i++) {
    const entry = roomsRaw[i] as Record<string, unknown>
    const polygon = Array.isArray(entry?.polygon)
      ? entry.polygon.filter((p): p is [number, number] =>
          Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
      : []
    if (typeof entry?.id !== 'string' || polygon.length < 3) {
      errors.push(`rooms[${i}] 缺少 id 或合法 polygon`)
      continue
    }
    const type = (ROOM_TYPES as readonly string[]).includes(entry.type as string)
      ? entry.type as RoomType
      : 'other'
    rooms.push({
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
      type,
      polygon,
      requiresExteriorWindow: entry.requiresExteriorWindow === true,
    })
  }
  const connections: LayoutPlan['connections'] = []
  if (Array.isArray(value.connections)) {
    for (const item of value.connections) {
      const conn = item as Record<string, unknown>
      if (typeof conn?.from === 'string' && typeof conn?.to === 'string') {
        connections.push({ from: conn.from, to: conn.to, type: 'door' })
      }
    }
  }
  if (errors.length > 0 || rooms.length === 0) return { plan: null, errors }
  return {
    plan: {
      footprint: {
        width: width!,
        depth: depth!,
        ...(footprintPolygon.length >= 4 ? { polygon: footprintPolygon } : {}),
      },
      entry: { roomId: entryRoomId as string },
      rooms,
      connections,
    },
    errors: [],
  }
}

export async function buildLayoutPlan(
  inputs: {
    // Confirmed brief text, authoritative for room list / area / constraints.
    briefSummary: string
    targets: PlanTargets
  },
  complete: CompleteText,
  options: PlanBuildOptions = {},
): Promise<PlanBuildResult> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS
  const llmGeometry = options.llmGeometry === true
  const profile = options.profile ?? DEFAULT_NORM_PROFILE
  const messages: ChatMessage[] = [
    { role: 'system', content: llmGeometry ? PLAN_SYSTEM_PROMPT : INTENT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `已确认的结构化需求（房间清单、面积和硬性约束以此为准）：\n${inputs.briefSummary}`,
        inputs.targets.totalAreaSqm !== undefined
          ? `目标总面积：${inputs.targets.totalAreaSqm}㎡（±10% 内）`
          : undefined,
        inputs.targets.requiredRooms?.length
          ? `必须包含的房型：${inputs.targets.requiredRooms.map(r => `${r.type}×${r.count}`).join('、')}`
          : undefined,
        options.strategy && !llmGeometry ? strategyPromptLines(options.strategy) : undefined,
        options.priorFailures?.length
          ? `上一次按规划建成的场景验收失败，原因如下，这次规划必须规避：\n${options.priorFailures.map(f => `- ${f}`).join('\n')}`
          : undefined,
      ].filter(Boolean).join('\n'),
    },
  ]

  let modelCalls = 0
  let lastFailures: string[] = []
  let lastFailuresL10n: Array<IssueL10n | null> = []
  for (let round = 0; round < maxRounds; round++) {
    modelCalls++
    const reply = await complete(messages, `plan:${llmGeometry ? 'geometry' : 'intent'}:${round}`)
    messages.push({ role: 'assistant', content: reply })

    const attempt = llmGeometry
      ? evaluateGeometryReply(reply, inputs.targets, profile)
      : evaluateIntentReply(reply, inputs.targets, profile, options.strategy)
    if (attempt.ok) return { ...attempt.result, modelCalls }

    lastFailures = attempt.failures
    lastFailuresL10n = attempt.failuresL10n
    messages.push({ role: 'user', content: correctionPrompt(attempt.failures) })
  }
  return { ok: false, failures: lastFailures, failuresL10n: lastFailuresL10n, modelCalls }
}

type Attempt =
  | { ok: true; result: Omit<PlanBuildSuccess, 'modelCalls'> }
  | { ok: false; failures: string[]; failuresL10n: Array<IssueL10n | null> }

const noL10n = (failures: string[]): Array<IssueL10n | null> => failures.map(() => null)

function evaluateIntentReply(
  reply: string,
  targets: PlanTargets,
  profile: NormProfile,
  strategy?: StrategyDecision,
): Attempt {
  const parsed = parseLayoutIntent(reply)
  const errors = parsed.errors
  if (!parsed.intent) {
    const failures = errors.length > 0 ? errors : ['LayoutIntent 解析失败']
    return { ok: false, failures, failuresL10n: noL10n(failures) }
  }
  // Tier-1 strategy enforcement (LAYOUT_STRATEGY_DESIGN.md §4): silent
  // deterministic corrections instead of a model correction round. The
  // applied intent is what gets partitioned AND what the caller persists.
  const applied = strategy ? applyStrategy(parsed.intent, strategy) : { intent: parsed.intent, notes: [] }
  const intent = applied.intent
  // Recoverable parse defects (dropped fields, renamed ids) don't block on
  // their own — the partitioned plan is judged on its merits below.
  const partition = partitionLayout(intent, profile, strategy)
  if (!partition.ok) {
    const details = partition.details ?? []
    return {
      ok: false,
      failures: [
        ...errors,
        `分区器无法排布该意图：${partition.reason}`,
        ...details.map(detail => detail.message),
      ],
      failuresL10n: [
        ...noL10n(errors),
        partition.l10n ?? null,
        ...details.map(detail => detail.l10n ?? null),
      ],
    }
  }
  const validation = validateLayoutPlan(partition.plan, targets, profile)
  if (validation.fatal.length > 0) {
    return {
      ok: false,
      failures: [...errors, ...validation.fatal],
      failuresL10n: [...noL10n(errors), ...validation.fatalL10n],
    }
  }
  const plan = applied.notes.length > 0
    ? { ...partition.plan, notes: [...(partition.plan.notes ?? []), ...applied.notes] }
    : partition.plan
  return { ok: true, result: { ok: true, intent, plan, validation } }
}

function evaluateGeometryReply(reply: string, targets: PlanTargets, profile: NormProfile): Attempt {
  const { plan, errors } = parseLayoutPlanJson(reply)
  if (!plan) return { ok: false, failures: errors, failuresL10n: noL10n(errors) }
  const validation = validateLayoutPlan(plan, targets, profile)
  if (validation.fatal.length > 0) {
    return { ok: false, failures: validation.fatal, failuresL10n: validation.fatalL10n }
  }
  return { ok: true, result: { ok: true, intent: null, plan, validation } }
}
