import type { GeneratedGeometryArtifact } from '../ai-generated-geometry-core'
import { type ArtifactFacts, buildArtifactFacts } from './artifact-facts'
import { type CreateCapabilityPlan, planCreateGeometry } from './create-capability-registry'
import type { GeometryIntent } from './geometry-intent'
import { planRevisionGeometry, type RevisionPlanResult } from './revision-operation-registry'

export type GeometryIntentPlan =
  | ({ action: 'create' } & CreateCapabilityPlan)
  | ({
      action: 'revise'
      tool: 'revise_geometry'
      args: Record<string, unknown>
      facts: ArtifactFacts
    } & RevisionPlanResult)

export function planGeometryIntent(
  intent: GeometryIntent,
  context: { revisionTarget?: GeneratedGeometryArtifact | null } = {},
): GeometryIntentPlan {
  if (intent.action === 'create') {
    return { action: 'create', ...planCreateGeometry(intent) }
  }

  const target = context.revisionTarget
  if (!target) {
    return {
      action: 'revise',
      tool: 'revise_geometry',
      args: {},
      facts: {
        artifactId: '',
        summary: {},
        shapeCount: 0,
        bounds: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
        parts: [],
        roles: {},
        groups: {},
        materials: {},
        components: [],
      },
      operations: [],
      issues: ['missing_revision_target'],
    }
  }

  const facts = buildArtifactFacts(target)
  const revisionPlan = planRevisionGeometry(intent, facts)
  return {
    action: 'revise',
    tool: 'revise_geometry',
    args: {
      targetArtifactId: target.id,
      operations: revisionPlan.operations,
      intent: intent.operation.kind,
      userVisiblePlan: `Apply ${intent.operation.kind} using deterministic ArtifactFacts.`,
    },
    facts,
    ...revisionPlan,
  }
}
