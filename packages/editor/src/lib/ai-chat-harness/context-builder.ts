import type { GeneratedGeometryArtifact } from '../ai-generated-geometry-core'
import { formatSelectionCapabilities, type ObjectCapabilityProfile } from '../object-capabilities'
import { planGeometryCapabilities } from './capability-planner'
import { buildPrimitiveRevisionMemory, formatPrimitiveRevisionMemory } from './revision-memory'

export type AiChatHarnessMessage = {
  role: string
  content: string
  isToolResult?: boolean
  geometryArtifact?: GeneratedGeometryArtifact
}

export type AiChatHarnessContextPolicy = {
  recentTurnLimit: number
  messageTextLimit: number
  artifactJsonLimit: number
}

export type GeometryContextRelationship =
  | 'modify_previous'
  | 'regenerate_previous'
  | 'different_object'
  | 'new_unrelated_object'
  | 'ambiguous'

export type GeometryContextPolicy = 'none' | 'summary_only' | 'include_full_artifact'

export type GeometryContextRecommendedRoute =
  | 'revise_geometry'
  | 'fresh_replacement'
  | 'new_geometry'
  | 'model_decide'

export type GeometryContextDecision = {
  relationshipToLatestArtifact: GeometryContextRelationship
  contextPolicy: GeometryContextPolicy
  recommendedRoute: GeometryContextRecommendedRoute
  confidence: number
  reason: string
  editIntent?: {
    type?: string
    target?: string
    dimension?: string
    strength?: string
  }
}

export const DEFAULT_AI_CHAT_HARNESS_CONTEXT_POLICY: AiChatHarnessContextPolicy = {
  recentTurnLimit: 8,
  messageTextLimit: 900,
  artifactJsonLimit: 45_000,
}

export function latestGeneratedGeometryArtifact(messages: readonly AiChatHarnessMessage[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.geometryArtifact && !message.geometryArtifact.supersededBy)
      ?.geometryArtifact ?? null
  )
}

export function truncateHarnessContext(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...<truncated ${value.length - limit} chars>`
}

function normalizeIntentText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function hasRevisionReference(text: string) {
  return /\b(it|this|that|same|previous|last)\b/.test(text)
}

function hasRevisionAttributeChange(text: string) {
  return (
    /\b(new|different)\s+(color|colour|material|texture|finish|style|look|appearance)\b/.test(
      text,
    ) ||
    /\b(change|make|turn|set|paint|recolor)\b.*\b(color|colour|material|texture|finish|style|look|appearance)\b/.test(
      text,
    ) ||
    /\b(color|colour|material|texture|finish|style|look|appearance)\b.*\b(change|different|new)\b/.test(
      text,
    )
  )
}

function hasExplicitNewObjectIntent(text: string) {
  if (
    /\b(something else|anything else|other (object|item|thing|model|asset)|another (object|item|thing|model|asset))\b/.test(
      text,
    )
  ) {
    return true
  }
  if (
    /\b(generate|create|make|build|add|produce)\b.*\b(new|another|different|fresh|next)\b.*\b(object|item|thing|model|asset|geometry|shape|part)\b/.test(
      text,
    ) ||
    /\b(new|another|different|fresh|next)\b.*\b(object|item|thing|model|asset|geometry|shape|part)\b/.test(
      text,
    )
  ) {
    return true
  }
  return /\u65b0\u5efa|\u91cd\u65b0\u751f\u6210|\u6362\u4e00\u4e2a|\u53e6\u5916\u751f\u6210|\u518d\u751f\u6210|\u518d\u6765|\u518d\u505a|\u518d\u521b\u5efa|\u53e6\u4e00\u4e2a|\u53e6\u4e2a|\u522b\u7684|\u5176\u4ed6|\u5176\u5b83|\u65b0\u7269\u54c1|\u65b0\u5bf9\u8c61|\u65b0\u6a21\u578b/.test(
    text,
  )
}

export function isLikelyGeometryRevisionRequest(
  userRequest: string,
  latestArtifact: GeneratedGeometryArtifact | null,
) {
  if (!latestArtifact) return false
  const text = normalizeIntentText(userRequest)
  if (!text) return false
  if (hasRevisionReference(text) && hasRevisionAttributeChange(text)) {
    return true
  }
  if (hasExplicitNewObjectIntent(text)) {
    return false
  }
  return (
    /\b(it|this|that|same|previous|last|bigger|smaller|wider|narrower|taller|shorter|wrong|ugly|detached|separate|proportion|color|material|adjust|revise|fix|improve|smooth)\b/.test(
      text,
    ) ||
    /\u4e0d\u50cf|\u4e0d\u5bf9|\u4e0d\u597d\u770b|\u4e11|\u5206\u5f00|\u8131\u79bb|\u6bd4\u4f8b|\u989c\u8272|\u6750\u8d28|\u6539|\u8c03\u6574|\u4fee|\u52a0\u957f|\u53d8\u957f|\u62c9\u957f|\u957f\u4e00\u70b9|\u77ed\u4e86|\u592a\u77ed|\u52a0\u7c97|\u53d8\u7c97|\u7c97\u4e00\u70b9|\u7ec6\u4e00\u70b9|\u5927\u4e00\u70b9|\u5c0f\u4e00\u70b9|\u9ad8\u4e00\u70b9|\u77ee\u4e00\u70b9/.test(
      text,
    )
  )
}

function formatRecentChatContext(
  messages: readonly AiChatHarnessMessage[],
  policy: AiChatHarnessContextPolicy,
) {
  const relevant = messages
    .filter((message) => !message.isToolResult)
    .slice(-policy.recentTurnLimit)
    .map((message, index) => {
      const tags = [
        message.geometryArtifact
          ? `geometry=${message.geometryArtifact.title}#v${message.geometryArtifact.version}`
          : undefined,
      ]
        .filter(Boolean)
        .join(', ')
      const content = truncateHarnessContext(
        message.content.replace(/\s+/g, ' ').trim(),
        policy.messageTextLimit,
      )
      return `${index + 1}. ${message.role}${tags ? ` (${tags})` : ''}: ${content}`
    })

  return relevant.length ? relevant.join('\n') : 'No prior visible chat turns.'
}

function geometryArtifactForPrompt(artifact: GeneratedGeometryArtifact) {
  return {
    id: artifact.id,
    title: artifact.title,
    sourceTool: artifact.sourceTool,
    sourceArgs: artifact.sourceArgs,
    userPrompt: artifact.userPrompt,
    revisionOf: artifact.revisionOf,
    version: artifact.version,
    createdAt: artifact.createdAt,
    shapes: artifact.shapes,
    transforms: artifact.transforms,
    assemblyName: artifact.assemblyName,
    assemblyPosition: artifact.assemblyPosition,
    createdNames: artifact.createdNames,
    shapeDetails: artifact.shapeDetails,
    geometryBrief: artifact.geometryBrief,
    semanticSummary: artifact.semanticSummary,
    visualQualitySummary: artifact.visualQualitySummary,
    editHistory: artifact.editHistory,
    placedNodeIds: artifact.placedNodeIds,
    placedAt: artifact.placedAt,
  }
}

export function buildGeometryArtifactSummary(artifact: GeneratedGeometryArtifact) {
  const roles = new Map<string, number>()
  const sourcePartKinds = new Map<string, number>()
  for (const shape of artifact.shapes) {
    if (shape.semanticRole) roles.set(shape.semanticRole, (roles.get(shape.semanticRole) ?? 0) + 1)
    if (shape.sourcePartKind) {
      sourcePartKinds.set(
        shape.sourcePartKind,
        (sourcePartKinds.get(shape.sourcePartKind) ?? 0) + 1,
      )
    }
  }
  const summarizeMap = (values: Map<string, number>) =>
    [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 24)
      .map(([key, count]) => `${key}:${count}`)
      .join(', ')

  return [
    `id=${artifact.id}`,
    `title=${artifact.title}`,
    `sourceTool=${artifact.sourceTool}`,
    `version=${artifact.version}`,
    `shapeCount=${artifact.shapes.length}`,
    `semanticRoles=${summarizeMap(roles) || 'none'}`,
    `sourcePartKinds=${summarizeMap(sourcePartKinds) || 'none'}`,
    artifact.semanticSummary ? `semanticSummary=${artifact.semanticSummary}` : undefined,
    artifact.visualQualitySummary
      ? `visualQualitySummary=${artifact.visualQualitySummary}`
      : undefined,
    artifact.editHistory?.length
      ? `editHistory=${artifact.editHistory.slice(-4).join(' | ')}`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildGeometryContextResolverPrompt({
  messages,
  latestArtifact,
  userRequest,
  policy = DEFAULT_AI_CHAT_HARNESS_CONTEXT_POLICY,
}: {
  messages: readonly AiChatHarnessMessage[]
  latestArtifact: GeneratedGeometryArtifact | null
  userRequest: string
  policy?: AiChatHarnessContextPolicy
}) {
  return [
    'Resolve how the current user request relates to the latest generated geometry artifact.',
    'Return strict JSON only with keys: relationshipToLatestArtifact, contextPolicy, recommendedRoute, confidence, reason, editIntent.',
    '',
    'Allowed relationshipToLatestArtifact values: modify_previous, regenerate_previous, different_object, new_unrelated_object, ambiguous.',
    'Allowed contextPolicy values: none, summary_only, include_full_artifact.',
    'Allowed recommendedRoute values: revise_geometry, fresh_replacement, new_geometry, model_decide.',
    '',
    'Decision rules:',
    '- Use include_full_artifact only when the current request likely edits, regenerates, or replaces the latest artifact.',
    '- Use summary_only when the latest artifact may be useful conversation context but should not be a direct revision target.',
    '- Use none only when the current request explicitly rejects or is unrelated to the latest artifact.',
    '- Do not treat phrases like "generate again", "再生成", or "重新生成" as unrelated by themselves; decide from the full request and prior artifact summary.',
    '',
    'Current user request:',
    userRequest,
    '',
    'Latest generated artifact summary:',
    latestArtifact ? buildGeometryArtifactSummary(latestArtifact) : 'No latest generated artifact.',
    '',
    'Recent visible conversation context:',
    formatRecentChatContext(messages, policy),
  ].join('\n')
}

export function buildGeometryHarnessContext({
  messages,
  latestArtifact,
  userRequest,
  policy = DEFAULT_AI_CHAT_HARNESS_CONTEXT_POLICY,
  contextDecision,
  selectionCapabilities,
}: {
  messages: readonly AiChatHarnessMessage[]
  latestArtifact: GeneratedGeometryArtifact | null
  userRequest: string
  policy?: AiChatHarnessContextPolicy
  contextDecision?: GeometryContextDecision | null
  selectionCapabilities?: readonly ObjectCapabilityProfile[]
}) {
  return buildGeometryHarnessContextInternal({
    messages,
    latestArtifact,
    userRequest,
    policy,
    includeRevisionArtifactJson: true,
    contextDecision,
    selectionCapabilities,
  })
}

export function buildGeometryAnalysisContext({
  messages,
  latestArtifact,
  userRequest,
  policy = DEFAULT_AI_CHAT_HARNESS_CONTEXT_POLICY,
  contextDecision,
  selectionCapabilities,
}: {
  messages: readonly AiChatHarnessMessage[]
  latestArtifact: GeneratedGeometryArtifact | null
  userRequest: string
  policy?: AiChatHarnessContextPolicy
  contextDecision?: GeometryContextDecision | null
  selectionCapabilities?: readonly ObjectCapabilityProfile[]
}) {
  return buildGeometryHarnessContextInternal({
    messages,
    latestArtifact,
    userRequest,
    policy,
    includeRevisionArtifactJson: false,
    contextDecision,
    selectionCapabilities,
  })
}

function buildGeometryHarnessContextInternal({
  messages,
  latestArtifact,
  userRequest,
  policy,
  includeRevisionArtifactJson,
  contextDecision,
  selectionCapabilities,
}: {
  messages: readonly AiChatHarnessMessage[]
  latestArtifact: GeneratedGeometryArtifact | null
  userRequest: string
  policy: AiChatHarnessContextPolicy
  includeRevisionArtifactJson: boolean
  contextDecision?: GeometryContextDecision | null
  selectionCapabilities?: readonly ObjectCapabilityProfile[]
}) {
  const capabilityPlan = planGeometryCapabilities(userRequest)
  const contextPolicy = contextDecision?.contextPolicy
  const likelyRevision =
    contextPolicy == null ? isLikelyGeometryRevisionRequest(userRequest, latestArtifact) : false
  const revisionArtifact =
    latestArtifact && (contextPolicy === 'include_full_artifact' || likelyRevision)
      ? latestArtifact
      : null
  const summaryArtifact =
    latestArtifact && (revisionArtifact || contextPolicy === 'summary_only') ? latestArtifact : null
  const parts = [
    'Current user request:',
    userRequest,
    '',
    'Capability planner:',
    JSON.stringify(capabilityPlan),
    '',
    'Canvas selection capability context:',
    selectionCapabilities?.length
      ? formatSelectionCapabilities(selectionCapabilities)
      : 'No canvas object is selected.',
    '',
    'Conversation mode hint:',
    revisionArtifact
      ? contextDecision
        ? `Context resolver selected ${contextDecision.contextPolicy}: ${contextDecision.relationshipToLatestArtifact}; recommended route=${contextDecision.recommendedRoute}; confidence=${contextDecision.confidence}.`
        : 'Likely follow-up revision: preserve the existing artifact and call revise_geometry unless the user explicitly asks for a full replacement.'
      : summaryArtifact
        ? `Context resolver selected summary_only: ${contextDecision?.relationshipToLatestArtifact ?? 'ambiguous'}; recommended route=${contextDecision?.recommendedRoute ?? 'model_decide'}. Use the summary as context only; do not call revise_geometry unless the generation stage receives full artifact context.`
        : latestArtifact
          ? contextDecision
            ? `Context resolver selected ${contextDecision.contextPolicy}: ${contextDecision.relationshipToLatestArtifact}; recommended route=${contextDecision.recommendedRoute}. Prior generated artifact details are intentionally omitted.`
            : 'Treat this as a new-object request. Prior generated artifacts are intentionally omitted so they do not bias the new object.'
          : 'No prior artifact: create a new complete object with the most specific supported tool.',
    '',
    'Recent visible conversation context:',
    revisionArtifact || summaryArtifact
      ? formatRecentChatContext(messages, policy)
      : 'Prior visible chat turns are omitted for this new-object request.',
  ]

  if (contextDecision) {
    parts.push('', 'Context resolver decision:', JSON.stringify(contextDecision))
  }

  if (revisionArtifact) {
    parts.push(
      '',
      'Latest generated geometry artifact for continuity:',
      buildGeometryArtifactSummary(revisionArtifact),
      '',
      'Primitive multi-turn revision memory:',
      formatPrimitiveRevisionMemory(
        buildPrimitiveRevisionMemory({
          artifact: revisionArtifact,
          messages,
          currentUserRequest: userRequest,
        }),
      ),
      '',
      'Use this artifact as the previous model when the current request is a follow-up, vague feedback, size/proportion/material adjustment, or says things like "again", "bigger", "unclear", "not right", etc.',
      'If the current request clearly asks for a completely new unrelated object, ignore this artifact and create the new object instead.',
      'Prefer revise_geometry for follow-up edits so placed canvas nodes can be replaced; prefer compose_* only for new objects or full replacements.',
      'For local semantic size feedback (longer/shorter/bigger/smaller/thicker/thinner; 加长/变长/短了/加粗/变粗), use revise_geometry scaleSemantic with selector.semanticRole or selector.semanticGroup, dimension:"primary" when editableHints is present, and a factor such as 1.2-1.35.',
    )
    if (includeRevisionArtifactJson) {
      parts.push(
        '',
        'Full latest generated geometry artifact JSON for precise revision operations:',
        truncateHarnessContext(
          JSON.stringify(geometryArtifactForPrompt(revisionArtifact)),
          policy.artifactJsonLimit,
        ),
      )
    } else {
      parts.push(
        '',
        'Full latest generated geometry artifact JSON is intentionally omitted from this analysis context. Use the summary and revision memory only; the generation stage receives the full artifact if a precise revise_geometry operation is needed.',
      )
    }
  } else {
    if (summaryArtifact) {
      parts.push(
        '',
        'Latest generated geometry artifact summary for context only:',
        buildGeometryArtifactSummary(summaryArtifact),
        '',
        'Full latest generated geometry artifact JSON is intentionally omitted at this stage.',
      )
    }
    parts.push(
      '',
      latestArtifact
        ? summaryArtifact
          ? 'A previous generated geometry artifact summary is included, but the artifact is not a direct revision target.'
          : 'A previous generated geometry artifact exists but is not included because this request asks for a different/new object.'
        : 'No generated geometry artifact is currently available.',
    )
  }

  return parts.join('\n')
}
