import type {
  PrimitiveMaterialInput,
  PrimitiveShapeInput,
  Vec3,
} from '@pascal-app/core/lib/primitive-compose'
import type {
  PrimitiveRevisionEdge,
  PrimitiveRevisionOperation,
  PrimitiveShapeSelector,
} from '@pascal-app/core/lib/primitive-revision'
import type {
  ArtifactComponentInstanceFacts,
  ArtifactFacts,
  ArtifactPartFact,
} from './artifact-facts'
import type { RevisionIntent, RevisionSubject } from './geometry-intent'

export type RevisionPlanResult = {
  operations: PrimitiveRevisionOperation[]
  issues: string[]
  metadata?: Record<string, unknown>
}

export type RevisionOperationDefinition = {
  kind: RevisionIntent['operation']['kind']
  compile: (intent: RevisionIntent, facts: ArtifactFacts) => RevisionPlanResult
}

export type RevisionOperationRegistry = Map<string, RevisionOperationDefinition>

function normalizeToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value
        .trim()
        .replace(/[\s-]+/g, '_')
        .toLowerCase()
    : undefined
}

function matchesSubject(part: ArtifactPartFact, subject: RevisionSubject | undefined) {
  if (!subject) return true
  const role = normalizeToken(subject.semanticRole)
  const group = normalizeToken(subject.semanticGroup)
  const sourcePartKind = normalizeToken(subject.sourcePartKind)
  const sourcePartId = normalizeToken(subject.sourcePartId)
  if (role && part.semanticRole !== role) return false
  if (group && part.semanticGroup !== group) return false
  if (sourcePartKind && part.sourcePartKind !== sourcePartKind) return false
  if (sourcePartId && part.sourcePartId !== sourcePartId) return false
  return true
}

function subjectComponent(subject: RevisionSubject | undefined): string | undefined {
  const explicit = normalizeToken(subject?.component)
  if (explicit) return explicit
  const role = normalizeToken(subject?.semanticRole)
  if (role && /_(tire|rim|hub|spoke|wheel)$/.test(role)) return 'wheel'
  return undefined
}

function selectorForPart(part: ArtifactPartFact): PrimitiveShapeSelector {
  return { index: part.index }
}

function selectorForSubject(subject: RevisionSubject | undefined): PrimitiveShapeSelector {
  return {
    semanticRole: normalizeToken(subject?.semanticRole),
    semanticGroup: normalizeToken(subject?.semanticGroup),
    sourcePartKind: normalizeToken(subject?.sourcePartKind),
    sourcePartId: normalizeToken(subject?.sourcePartId),
  }
}

function matchedParts(facts: ArtifactFacts, subject: RevisionSubject | undefined) {
  return facts.parts.filter((part) => matchesSubject(part, subject))
}

function subjectNotFound(subject: RevisionSubject | undefined) {
  const component = subjectComponent(subject)
  return component ? `subject_not_found: component "${component}"` : 'subject_not_found'
}

function primitiveShapes(value: unknown): PrimitiveShapeInput[] {
  return Array.isArray(value) ? (value as PrimitiveShapeInput[]) : []
}

function removeOperationsForParts(
  parts: readonly ArtifactPartFact[],
): PrimitiveRevisionOperation[] {
  return parts
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((part) => ({ op: 'remove', selector: selectorForPart(part) }))
}

function partsForComponent(facts: ArtifactFacts, component: ArtifactComponentInstanceFacts) {
  const shapeIds = new Set(component.shapeIds)
  return facts.parts.filter((part) => shapeIds.has(part.shapeId))
}

function compileSetCount(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  const desiredCount =
    intent.operation.kind === 'set_count'
      ? intent.operation.desiredCount
      : intent.operation.kind === 'remove_duplicate'
        ? 1
        : undefined
  if (desiredCount == null) return { operations: [], issues: ['set_count requires desiredCount.'] }
  const component = subjectComponent(intent.subject)
  if (component) {
    const instances = facts.components.filter((entry) => entry.component === component)
    if (instances.length === 0) {
      return { operations: [], issues: [`subject_not_found: component "${component}"`] }
    }
    if (instances.length <= desiredCount) {
      return {
        operations: [],
        issues: [],
        metadata: { unchanged: true, currentCount: instances.length },
      }
    }
    const sorted = instances.slice().sort((a, b) => a.center[0] - b.center[0])
    const removeInstances = sorted.slice(desiredCount)
    const removeParts = removeInstances.flatMap((entry) => partsForComponent(facts, entry))
    return {
      operations: removeOperationsForParts(removeParts),
      issues: [],
      metadata: {
        operation: 'set_count',
        component,
        previousCount: instances.length,
        desiredCount,
      },
    }
  }

  const matched = facts.parts.filter((part) => matchesSubject(part, intent.subject))
  if (matched.length === 0) return { operations: [], issues: ['subject_not_found'] }
  if (matched.length <= desiredCount) {
    return {
      operations: [],
      issues: [],
      metadata: { unchanged: true, currentCount: matched.length },
    }
  }
  return {
    operations: removeOperationsForParts(matched.slice(desiredCount)),
    issues: [],
    metadata: { operation: 'set_count', previousCount: matched.length, desiredCount },
  }
}

function compileSetMaterial(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  if (intent.operation.kind !== 'set_material') return { operations: [], issues: [] }
  const matched = matchedParts(facts, intent.subject)
  if (matched.length === 0) return { operations: [], issues: ['subject_not_found'] }
  if (!intent.operation.color && !intent.operation.material && !intent.operation.materialPreset) {
    return { operations: [], issues: ['set_material requires color, material, or materialPreset.'] }
  }
  return {
    operations: matched.map((part) => ({
      op: 'setMaterial',
      selector: selectorForPart(part),
      color: intent.operation.kind === 'set_material' ? intent.operation.color : undefined,
      material:
        intent.operation.kind === 'set_material'
          ? (intent.operation.material as PrimitiveMaterialInput | undefined)
          : undefined,
      materialPreset:
        intent.operation.kind === 'set_material' ? intent.operation.materialPreset : undefined,
    })),
    issues: [],
    metadata: { operation: 'set_material', changedCount: matched.length },
  }
}

function compileScaleSubject(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  if (intent.operation.kind !== 'scale_subject' && intent.operation.kind !== 'scale_semantic') {
    return { operations: [], issues: [] }
  }
  const operation = intent.operation as {
    kind: 'scale_subject' | 'scale_semantic'
    dimension?: string
    factor: number
  }
  const matched = matchedParts(facts, intent.subject)
  if (matched.length === 0) return { operations: [], issues: ['subject_not_found'] }
  return {
    operations: matched.map((part) => ({
      op: 'scaleSemantic',
      selector: selectorForPart(part),
      dimension: operation.dimension,
      factor: operation.factor,
    })),
    issues: [],
    metadata: { operation: operation.kind, changedCount: matched.length },
  }
}

function compileRemoveSubject(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  if (intent.operation.kind !== 'remove_subject') return { operations: [], issues: [] }
  const matched = matchedParts(facts, intent.subject)
  if (matched.length === 0) return { operations: [], issues: [subjectNotFound(intent.subject)] }
  return {
    operations: removeOperationsForParts(matched),
    issues: [],
    metadata: { operation: 'remove_subject', changedCount: matched.length },
  }
}

function compileAddShapes(intent: RevisionIntent): RevisionPlanResult {
  if (intent.operation.kind !== 'add_shapes') return { operations: [], issues: [] }
  const shapes = primitiveShapes(intent.operation.shapes)
  if (shapes.length === 0) return { operations: [], issues: ['add_shapes requires shapes.'] }
  return {
    operations: [{ op: 'add', shapes }],
    issues: [],
    metadata: { operation: 'add_shapes', changedCount: shapes.length },
  }
}

function compileReplaceSubject(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  if (intent.operation.kind !== 'replace_subject') return { operations: [], issues: [] }
  const matched = matchedParts(facts, intent.subject)
  if (matched.length === 0) return { operations: [], issues: [subjectNotFound(intent.subject)] }
  const shapes = primitiveShapes(intent.operation.shapes)
  if (shapes.length === 0) return { operations: [], issues: ['replace_subject requires shapes.'] }
  return {
    operations: [
      {
        op: 'replace',
        selector: selectorForSubject(intent.subject),
        shapes,
      },
    ],
    issues: [],
    metadata: {
      operation: 'replace_subject',
      replacedCount: matched.length,
      replacementCount: shapes.length,
    },
  }
}

function compileTransformSubject(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  if (intent.operation.kind !== 'transform_subject') return { operations: [], issues: [] }
  const matched = matchedParts(facts, intent.subject)
  if (matched.length === 0) return { operations: [], issues: [subjectNotFound(intent.subject)] }
  const { position, delta, rotation, scale } = intent.operation
  if (!position && !delta && !rotation && !scale) {
    return {
      operations: [],
      issues: ['transform_subject requires position, delta, rotation, or scale.'],
    }
  }
  return {
    operations: [
      {
        op: 'transform',
        selector: selectorForSubject(intent.subject),
        position: position as Vec3 | undefined,
        delta: delta as Vec3 | undefined,
        rotation: rotation as Vec3 | undefined,
        scale: scale as Vec3 | undefined,
      },
    ],
    issues: [],
    metadata: { operation: 'transform_subject', changedCount: matched.length },
  }
}

function compileResizeSubject(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  if (intent.operation.kind !== 'resize_subject') return { operations: [], issues: [] }
  const matched = matchedParts(facts, intent.subject)
  if (matched.length === 0) return { operations: [], issues: [subjectNotFound(intent.subject)] }
  const {
    length,
    width,
    height,
    depth,
    thickness,
    radius,
    radiusTop,
    radiusBottom,
    majorRadius,
    tubeRadius,
  } = intent.operation
  const hasDimension = [
    length,
    width,
    height,
    depth,
    thickness,
    radius,
    radiusTop,
    radiusBottom,
    majorRadius,
    tubeRadius,
  ].some((value) => value != null)
  if (!hasDimension) return { operations: [], issues: ['resize_subject requires a dimension.'] }
  return {
    operations: [
      {
        op: 'resize',
        selector: selectorForSubject(intent.subject),
        length,
        width,
        height,
        depth,
        thickness,
        radius,
        radiusTop,
        radiusBottom,
        majorRadius,
        tubeRadius,
      },
    ],
    issues: [],
    metadata: { operation: 'resize_subject', changedCount: matched.length },
  }
}

function compileMaterialFrom(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  if (intent.operation.kind !== 'material_from') return { operations: [], issues: [] }
  const matched = matchedParts(facts, intent.subject)
  if (matched.length === 0) return { operations: [], issues: [subjectNotFound(intent.subject)] }
  const source = matchedParts(facts, intent.operation.from)
  if (source.length === 0) {
    return { operations: [], issues: [`source_${subjectNotFound(intent.operation.from)}`] }
  }
  return {
    operations: [
      {
        op: 'materialFrom',
        selector: selectorForSubject(intent.subject),
        from: selectorForSubject(intent.operation.from),
      },
    ],
    issues: [],
    metadata: { operation: 'material_from', changedCount: matched.length },
  }
}

function compileAlignSubject(intent: RevisionIntent, facts: ArtifactFacts): RevisionPlanResult {
  if (intent.operation.kind !== 'align_subject') return { operations: [], issues: [] }
  const matched = matchedParts(facts, intent.subject)
  if (matched.length === 0) return { operations: [], issues: [subjectNotFound(intent.subject)] }
  const target = matchedParts(facts, intent.operation.to)
  if (target.length === 0)
    return { operations: [], issues: [`target_${subjectNotFound(intent.operation.to)}`] }
  return {
    operations: [
      {
        op: 'align',
        selector: selectorForSubject(intent.subject),
        to: selectorForSubject(intent.operation.to),
        edge: intent.operation.edge as PrimitiveRevisionEdge,
        toEdge: intent.operation.toEdge as PrimitiveRevisionEdge | undefined,
        offset: intent.operation.offset,
      },
    ],
    issues: [],
    metadata: { operation: 'align_subject', changedCount: matched.length },
  }
}

export const revisionOperationRegistry: RevisionOperationRegistry = new Map([
  ['set_count', { kind: 'set_count', compile: compileSetCount }],
  ['remove_duplicate', { kind: 'remove_duplicate', compile: compileSetCount }],
  ['remove_subject', { kind: 'remove_subject', compile: compileRemoveSubject }],
  ['add_shapes', { kind: 'add_shapes', compile: compileAddShapes }],
  ['replace_subject', { kind: 'replace_subject', compile: compileReplaceSubject }],
  ['transform_subject', { kind: 'transform_subject', compile: compileTransformSubject }],
  ['resize_subject', { kind: 'resize_subject', compile: compileResizeSubject }],
  ['set_material', { kind: 'set_material', compile: compileSetMaterial }],
  ['scale_subject', { kind: 'scale_subject', compile: compileScaleSubject }],
  ['scale_semantic', { kind: 'scale_semantic', compile: compileScaleSubject }],
  ['material_from', { kind: 'material_from', compile: compileMaterialFrom }],
  ['align_subject', { kind: 'align_subject', compile: compileAlignSubject }],
])

export function planRevisionGeometry(
  intent: RevisionIntent,
  facts: ArtifactFacts,
  registry: RevisionOperationRegistry = revisionOperationRegistry,
): RevisionPlanResult {
  const definition = registry.get(intent.operation.kind)
  if (!definition)
    return { operations: [], issues: [`unknown_operation: ${intent.operation.kind}`] }
  return definition.compile(intent, facts)
}
