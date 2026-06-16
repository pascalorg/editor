import type {
  GeneratedGeometryArtifact,
  GeneratedGeometryEdit,
} from '../ai-generated-geometry-core'
import type { AiChatHarnessMessage } from './context-builder'
import { classifyPrimitiveRepairIssue } from './primitive-repair-skill'

export interface PrimitiveRevisionMemory {
  artifactId: string
  title: string
  version: number
  family?: string
  routeMemory: string[]
  approvedTraits: string[]
  activeConstraints: string[]
  rejectedApproaches: string[]
  recentFeedback: string[]
  failureLearnings: string[]
}

function uniquePush(target: string[], value: string | undefined, limit = 8) {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized || target.includes(normalized) || target.length >= limit) return
  target.push(normalized)
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(textOf).join(' ')
  return ''
}

function short(value: string, limit = 180) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function roleCounts(artifact: GeneratedGeometryArtifact) {
  const roles = new Map<string, number>()
  const sourcePartKinds = new Map<string, number>()
  const colors = new Map<string, number>()
  for (const shape of artifact.shapes) {
    if (shape.semanticRole) roles.set(shape.semanticRole, (roles.get(shape.semanticRole) ?? 0) + 1)
    if (shape.sourcePartKind) {
      sourcePartKinds.set(
        shape.sourcePartKind,
        (sourcePartKinds.get(shape.sourcePartKind) ?? 0) + 1,
      )
    }
    const color = shape.material?.properties?.color
    if (typeof color === 'string') colors.set(color, (colors.get(color) ?? 0) + 1)
  }
  return { roles, sourcePartKinds, colors }
}

function dominantColor(colors: Map<string, number>) {
  return [...colors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

function recordArtifactTraits(
  memory: PrimitiveRevisionMemory,
  artifact: GeneratedGeometryArtifact,
) {
  const { roles, sourcePartKinds, colors } = roleCounts(artifact)
  const color = dominantColor(colors)
  if (color) uniquePush(memory.approvedTraits, `dominant material color ${color}`)
  for (const [role, count] of roles) {
    if (count >= 2) uniquePush(memory.approvedTraits, `${count} x ${role}`)
  }
  if (sourcePartKinds.has('propeller_blade_set') || sourcePartKinds.has('mixer_blades')) {
    uniquePush(
      memory.routeMemory,
      'shaft + hub + blades are represented by compose_parts propeller/mixer blade kernels, not raw rectangles',
    )
  }
  if (sourcePartKinds.has('vehicle_body')) {
    uniquePush(memory.routeMemory, 'vehicle proportions use reusable vehicle_body/vehicle_* parts')
  }
  if (sourcePartKinds.has('protective_grill')) {
    uniquePush(
      memory.routeMemory,
      'fan guards use protective_grill cage rings/spokes instead of one torus',
    )
  }
  if (sourcePartKinds.has('rounded_machine_body')) {
    uniquePush(
      memory.routeMemory,
      'industrial shells use rounded_machine_body service panels/seams',
    )
  }
}

function recordConstraintsFromText(memory: PrimitiveRevisionMemory, raw: string) {
  const text = textOf(raw)
  if (!text) return
  if (
    /same\s+(horizontal\s+)?level|same\s+height|same\s+plane|horizontal|同一水平|同一高度|同一平面|水平/.test(
      text,
    )
  ) {
    uniquePush(memory.activeConstraints, 'keep related blades/parts on the same horizontal level')
  }
  if (/do not|don't|不要|别|不是|不能|不应该/.test(text)) {
    uniquePush(memory.rejectedApproaches, short(raw))
  }
  if (/recipe|配方/.test(text) && /不要|not|avoid|别/.test(text)) {
    uniquePush(
      memory.rejectedApproaches,
      'avoid switching this object family back to a whole-object recipe',
    )
  }
  if (/rectangular|box|长方形|方块|盒子/.test(text) && /blade|叶片|桨叶|扇叶/.test(text)) {
    uniquePush(
      memory.rejectedApproaches,
      'avoid rectangular blade approximations for curved blade requests',
    )
  }
  if (/angle|orientation|pitch|角度|方向|倾斜/.test(text)) {
    uniquePush(
      memory.activeConstraints,
      'preserve corrected orientation/angle constraints during revisions',
    )
  }
  if (/proportion|ratio|比例|车厢|车体|cabin|body/.test(text)) {
    uniquePush(
      memory.activeConstraints,
      'preserve user-approved body/cabin proportions unless asked otherwise',
    )
  }
}

function recordEdit(memory: PrimitiveRevisionMemory, edit: GeneratedGeometryEdit) {
  for (const value of [edit.feedback, edit.intent, edit.summary]) {
    if (value) {
      uniquePush(memory.recentFeedback, short(value), 6)
      recordConstraintsFromText(memory, value)
    }
  }
  if (edit.operations?.length) {
    uniquePush(
      memory.approvedTraits,
      `last revision used operations: ${edit.operations.map((operation) => operation.op).join(', ')}`,
    )
  }
}

function recordRecentMessages(
  memory: PrimitiveRevisionMemory,
  messages: readonly AiChatHarnessMessage[],
) {
  for (const message of messages.slice(-8)) {
    if (message.role === 'user') {
      recordConstraintsFromText(memory, message.content)
      uniquePush(memory.recentFeedback, short(message.content), 6)
    }
    if (
      /invalid geometry tool call|生成已停止|nothing was created|required semantic role/i.test(
        message.content,
      )
    ) {
      const issue = classifyPrimitiveRepairIssue(message.content)
      uniquePush(memory.failureLearnings, `${issue.title}: ${issue.nextAction}`, 6)
    }
  }
}

export function buildPrimitiveRevisionMemory({
  artifact,
  messages,
  currentUserRequest,
}: {
  artifact: GeneratedGeometryArtifact
  messages: readonly AiChatHarnessMessage[]
  currentUserRequest?: string
}): PrimitiveRevisionMemory {
  const memory: PrimitiveRevisionMemory = {
    artifactId: artifact.id,
    title: artifact.title,
    version: artifact.version,
    family: artifact.geometryBrief?.category,
    routeMemory: [],
    approvedTraits: [],
    activeConstraints: [],
    rejectedApproaches: [],
    recentFeedback: [],
    failureLearnings: [],
  }

  recordArtifactTraits(memory, artifact)
  for (const edit of artifact.editHistory ?? []) recordEdit(memory, edit)
  recordRecentMessages(memory, messages)
  if (currentUserRequest) {
    recordConstraintsFromText(memory, currentUserRequest)
    uniquePush(memory.recentFeedback, short(currentUserRequest), 6)
  }
  if (artifact.semanticSummary) uniquePush(memory.approvedTraits, artifact.semanticSummary)
  if (artifact.visualQualitySummary)
    uniquePush(memory.approvedTraits, artifact.visualQualitySummary)
  return memory
}

function bullet(label: string, values: string[]) {
  if (!values.length) return undefined
  return `${label}:\n${values.map((value) => `- ${value}`).join('\n')}`
}

export function formatPrimitiveRevisionMemory(memory: PrimitiveRevisionMemory) {
  return [
    `artifact=${memory.title}#v${memory.version} (${memory.artifactId})`,
    memory.family ? `family=${memory.family}` : undefined,
    bullet('Route memory', memory.routeMemory),
    bullet('Approved traits to preserve', memory.approvedTraits),
    bullet('Active user constraints', memory.activeConstraints),
    bullet('Rejected approaches / do-not-repeat', memory.rejectedApproaches),
    bullet('Recent feedback', memory.recentFeedback),
    bullet('Failure learnings', memory.failureLearnings),
  ]
    .filter(Boolean)
    .join('\n')
}
