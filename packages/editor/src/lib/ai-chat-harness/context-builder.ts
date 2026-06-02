import type { GeneratedGeometryArtifact } from '../ai-generated-geometry-core'
import { planGeometryCapabilities } from './capability-planner'

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

export function buildGeometryHarnessContext({
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
  const capabilityPlan = planGeometryCapabilities(userRequest)
  const parts = [
    'Current user request:',
    userRequest,
    '',
    'Capability planner:',
    JSON.stringify(capabilityPlan),
    '',
    'Recent visible conversation context:',
    formatRecentChatContext(messages, policy),
  ]

  if (latestArtifact) {
    const artifactJson = JSON.stringify(geometryArtifactForPrompt(latestArtifact))
    parts.push(
      '',
      'Latest generated geometry artifact for continuity:',
      'Use this artifact as the previous model when the current request is a follow-up, vague feedback, size/proportion/material adjustment, or says things like "again", "bigger", "unclear", "not right", etc.',
      'If the current request clearly asks for a completely new unrelated object, ignore this artifact and create the new object instead.',
      'Prefer revise_geometry for follow-up edits so placed canvas nodes can be replaced; prefer compose_* only for new objects or full replacements.',
      truncateHarnessContext(artifactJson, policy.artifactJsonLimit),
    )
  } else {
    parts.push('', 'No generated geometry artifact is currently available.')
  }

  return parts.join('\n')
}
