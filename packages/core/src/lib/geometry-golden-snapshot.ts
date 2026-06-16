import type {
  PrimitiveGeometryBrief,
  PrimitiveShapeInput,
  ResolvedPrimitiveTransform,
  Vec3,
} from './primitive-compose'
import { resolvePrimitiveWorldTransforms } from './primitive-compose'
import {
  buildPrimitiveGeometryFacts,
  type PrimitiveGeometryFacts,
  type PrimitiveShapeFact,
} from './primitive-facts'
import { assessPrimitiveVisualQuality } from './primitive-visual-quality'

export interface GeometryGoldenSnapshotOptions {
  id: string
  prompt?: string
  geometryBrief?: PrimitiveGeometryBrief
  maxShapes?: number
  precision?: number
}

export interface GeometryGoldenShapeSnapshot {
  index: number
  kind: string
  name?: string
  role?: string
  source?: string
  center: Vec3
  size: Vec3
}

export interface GeometryGoldenSnapshot {
  id: string
  family: string
  shapeCount: number
  dimensions: Vec3
  roles: Record<string, number>
  sources: Record<string, number>
  visualQuality: {
    family: string
    score: number
    issueCount: number
    warningCount: number
  }
  shapes: GeometryGoldenShapeSnapshot[]
}

function round(value: number, precision: number) {
  return Number(value.toFixed(precision))
}

function roundVec(value: Vec3, precision: number): Vec3 {
  return [round(value[0], precision), round(value[1], precision), round(value[2], precision)]
}

function sortedRecord(record: Record<string, number>) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

function factToSnapshot(fact: PrimitiveShapeFact, precision: number): GeometryGoldenShapeSnapshot {
  return {
    index: fact.index,
    kind: fact.kind,
    name: fact.name,
    role: fact.semanticRole,
    source: fact.sourcePartKind,
    center: roundVec(fact.center, precision),
    size: roundVec(
      [fact.halfExtents[0] * 2, fact.halfExtents[1] * 2, fact.halfExtents[2] * 2],
      precision,
    ),
  }
}

function selectGoldenShapes(facts: PrimitiveGeometryFacts, maxShapes: number) {
  return facts.shapes
    .filter(
      (fact, index) =>
        index < maxShapes ||
        Boolean(fact.semanticRole) ||
        /body|base|frame|blade|grill|port|flange|panel|door|wheel|window|casing|hatch|seam/.test(
          fact.name?.toLowerCase() ?? '',
        ),
    )
    .slice(0, maxShapes)
}

function isResolvedTransformArray(
  value: readonly ResolvedPrimitiveTransform[] | GeometryGoldenSnapshotOptions | undefined,
): value is readonly ResolvedPrimitiveTransform[] {
  return Array.isArray(value)
}

export function createGeometryGoldenSnapshot(
  shapes: readonly PrimitiveShapeInput[],
  transformsOrOptions?: readonly ResolvedPrimitiveTransform[] | GeometryGoldenSnapshotOptions,
  maybeOptions?: GeometryGoldenSnapshotOptions,
): GeometryGoldenSnapshot {
  let transforms: readonly ResolvedPrimitiveTransform[]
  let options: GeometryGoldenSnapshotOptions

  if (isResolvedTransformArray(transformsOrOptions)) {
    transforms = transformsOrOptions
    options = maybeOptions ?? { id: 'geometry' }
  } else {
    transforms = resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' })
    options = transformsOrOptions ?? { id: 'geometry' }
  }
  const precision = options.precision ?? 4
  const maxShapes = options.maxShapes ?? 32
  const facts = buildPrimitiveGeometryFacts(shapes, transforms)
  const quality = assessPrimitiveVisualQuality(shapes, transforms, {
    prompt: options.prompt,
    geometryBrief: options.geometryBrief,
  })

  return {
    id: options.id,
    family: options.geometryBrief?.category ?? quality.family,
    shapeCount: facts.shapeCount,
    dimensions: roundVec(facts.dimensions, precision),
    roles: sortedRecord(facts.roles),
    sources: sortedRecord(facts.sourcePartKinds),
    visualQuality: {
      family: quality.family,
      score: round(quality.score, precision),
      issueCount: quality.issues.length,
      warningCount: quality.warnings.length,
    },
    shapes: selectGoldenShapes(facts, maxShapes).map((fact) => factToSnapshot(fact, precision)),
  }
}

export function stringifyGeometryGoldenSnapshot(snapshot: GeometryGoldenSnapshot) {
  return JSON.stringify(snapshot, null, 2)
}
