import {
  type AnyNode,
  type AnyNodeId,
  closestMeasurementFeatureBinding,
  type GeometryContext,
  type MeasurementAnchor,
  type MeasurementFeature,
  type MeasurementFeatureReference,
  type MeasurementNode,
  type MeasurementPayload,
  type MeasurementPoint,
  measurementAnchorFallback,
  nodeRegistry,
  remapMeasurementReferences,
} from '@pascal-app/core'

export type ResolvedMeasurementPayload =
  | { kind: 'distance'; points: [MeasurementPoint, MeasurementPoint] }
  | { kind: 'angle'; points: [MeasurementPoint, MeasurementPoint, MeasurementPoint] }
  | { kind: 'area'; base: MeasurementPoint[] }
  | { kind: 'perimeter'; base: MeasurementPoint[] }
  | { kind: 'volume'; base: MeasurementPoint[]; extrusion: MeasurementPoint }

export type ResolvedMeasurement = {
  payload: ResolvedMeasurementPayload
  dangling: MeasurementFeatureReference[]
  dependencies: AnyNodeId[]
  anchorNormals: Array<MeasurementPoint | null>
}

type NodeResolver = (id: AnyNodeId) => AnyNode | undefined

export type MeasurementFeatureMatch = {
  feature: MeasurementFeature
  point: MeasurementPoint
  t: number
  parameters: Record<string, string | number | boolean>
  distance: number
}

function childIds(node: AnyNode): AnyNodeId[] {
  return 'children' in node && Array.isArray(node.children) ? (node.children as AnyNodeId[]) : []
}

function geometryContext(node: AnyNode, resolve: NodeResolver): GeometryContext {
  const parent = node.parentId ? (resolve(node.parentId as AnyNodeId) ?? null) : null
  const children = childIds(node)
    .map(resolve)
    .filter((child): child is AnyNode => child !== undefined)
  const siblings = parent
    ? childIds(parent)
        .map(resolve)
        .filter(
          (sibling): sibling is AnyNode => sibling !== undefined && sibling.type === node.type,
        )
    : []

  const contextResolve: GeometryContext['resolve'] = <N = AnyNode>(id: AnyNodeId) =>
    resolve(id) as N | undefined
  return { resolve: contextResolve, parent, children, siblings }
}

export function measurementFeaturesForNode(node: AnyNode, resolve: NodeResolver) {
  const contribution = nodeRegistry.get(node.type)?.measurement
  return contribution ? contribution.features(node, geometryContext(node, resolve)) : []
}

export function matchMeasurementFeatureForNode(
  node: AnyNode,
  resolve: NodeResolver,
  point: MeasurementPoint,
  maxDistance: number,
): MeasurementFeatureMatch | null {
  const contribution = nodeRegistry.get(node.type)?.measurement
  if (!contribution) return null
  const context = geometryContext(node, resolve)
  const custom = contribution.match?.(node, context, point, maxDistance)
  if (custom) {
    const reference: MeasurementFeatureReference = {
      nodeId: node.id,
      featureId: custom.featureId,
      parameters: custom.parameters,
    }
    const feature =
      contribution.resolve?.(node, context, reference) ??
      contribution.features(node, context).find((candidate) => candidate.id === custom.featureId) ??
      null
    if (feature) {
      const t = typeof custom.parameters?.t === 'number' ? custom.parameters.t : 0.5
      return {
        feature,
        point: custom.point,
        t,
        parameters: custom.parameters ?? { t },
        distance: custom.distance,
      }
    }
  }
  return closestMeasurementFeature(contribution.features(node, context), point, maxDistance)
}

export function closestMeasurementFeature(
  features: readonly MeasurementFeature[],
  point: MeasurementPoint,
  maxDistance: number,
): MeasurementFeatureMatch | null {
  const binding = closestMeasurementFeatureBinding(features, point, maxDistance)
  if (!binding) return null
  const feature = features.find((candidate) => candidate.id === binding.featureId)
  if (!feature) return null
  const t = typeof binding.parameters?.t === 'number' ? binding.parameters.t : 0.5
  return {
    feature,
    point: binding.point,
    t,
    parameters: binding.parameters ?? { t },
    distance: binding.distance,
  }
}

function pointOnPath(points: readonly MeasurementPoint[], t: number, closed: boolean) {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]!

  const segmentCount = closed ? points.length : points.length - 1
  const lengths: number[] = []
  let total = 0
  for (let index = 0; index < segmentCount; index++) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
    lengths.push(length)
    total += length
  }
  if (total <= 1e-9) return points[0]!

  let remaining = Math.max(0, Math.min(1, t)) * total
  for (let index = 0; index < segmentCount; index++) {
    const length = lengths[index]!
    if (remaining <= length || index === segmentCount - 1) {
      const start = points[index]!
      const end = points[(index + 1) % points.length]!
      const localT = length <= 1e-9 ? 0 : remaining / length
      return [
        start[0] + (end[0] - start[0]) * localT,
        start[1] + (end[1] - start[1]) * localT,
        start[2] + (end[2] - start[2]) * localT,
      ] satisfies MeasurementPoint
    }
    remaining -= length
  }
  return points[points.length - 1]!
}

export function measurementFeaturePoint(
  feature: MeasurementFeature,
  reference: MeasurementFeatureReference,
): MeasurementPoint | null {
  const tValue = reference.parameters?.t
  const t = typeof tValue === 'number' ? tValue : 0.5
  switch (feature.geometry.kind) {
    case 'point':
      return feature.geometry.point
    case 'segment':
      return pointOnPath([feature.geometry.start, feature.geometry.end], t, false)
    case 'path':
      return pointOnPath(feature.geometry.points, t, feature.geometry.closed === true)
    case 'polygon':
      return pointOnPath(feature.geometry.points, t, true)
  }
}

export function resolveMeasurementAnchor(
  anchor: MeasurementAnchor,
  resolve: NodeResolver,
): {
  point: MeasurementPoint
  normal: MeasurementPoint | null
  dangling: MeasurementFeatureReference | null
} {
  if (Array.isArray(anchor)) return { point: anchor, normal: null, dangling: null }

  const referencedNode = resolve(anchor.reference.nodeId as AnyNodeId)
  const contribution = referencedNode
    ? nodeRegistry.get(referencedNode.type)?.measurement
    : undefined
  if (!referencedNode || !contribution) {
    return { point: anchor.fallback, normal: null, dangling: anchor.reference }
  }

  const context = geometryContext(referencedNode, resolve)
  const feature =
    contribution.resolve?.(referencedNode, context, anchor.reference) ??
    contribution
      .features(referencedNode, context)
      .find((candidate) => candidate.id === anchor.reference.featureId) ??
    null
  const point = feature ? measurementFeaturePoint(feature, anchor.reference) : null
  return point
    ? { point, normal: feature?.normal ?? null, dangling: null }
    : { point: anchor.fallback, normal: null, dangling: anchor.reference }
}

function anchorsFor(payload: MeasurementPayload): readonly MeasurementAnchor[] {
  return payload.kind === 'distance' || payload.kind === 'angle' ? payload.points : payload.base
}

export function measurementDependencyIds(
  measurement: MeasurementPayload,
  resolve?: NodeResolver,
): AnyNodeId[] {
  const ids = new Set<AnyNodeId>()
  for (const anchor of anchorsFor(measurement)) {
    if (Array.isArray(anchor)) continue
    const nodeId = anchor.reference.nodeId as AnyNodeId
    ids.add(nodeId)
    const node = resolve?.(nodeId)
    if (node?.parentId) ids.add(node.parentId as AnyNodeId)
  }
  return [...ids]
}

export function resolveMeasurementNode(
  node: Pick<MeasurementNode, 'measurement'>,
  resolve: NodeResolver,
): ResolvedMeasurement {
  const dangling: MeasurementFeatureReference[] = []
  const anchorNormals: Array<MeasurementPoint | null> = []
  const point = (anchor: MeasurementAnchor) => {
    const result = resolveMeasurementAnchor(anchor, resolve)
    if (result.dangling) dangling.push(result.dangling)
    anchorNormals.push(result.normal)
    return result.point
  }
  const measurement = node.measurement
  let payload: ResolvedMeasurementPayload

  switch (measurement.kind) {
    case 'distance':
      payload = {
        kind: 'distance',
        points: [point(measurement.points[0]), point(measurement.points[1])],
      }
      break
    case 'angle':
      payload = {
        kind: 'angle',
        points: [
          point(measurement.points[0]),
          point(measurement.points[1]),
          point(measurement.points[2]),
        ],
      }
      break
    case 'area':
      payload = { kind: 'area', base: measurement.base.map(point) }
      break
    case 'perimeter':
      payload = { kind: 'perimeter', base: measurement.base.map(point) }
      break
    case 'volume':
      payload = {
        kind: 'volume',
        base: measurement.base.map(point),
        extrusion: measurement.extrusion,
      }
      break
  }

  return {
    payload,
    dangling,
    dependencies: measurementDependencyIds(measurement, resolve),
    anchorNormals,
  }
}

export function detachMeasurementPayload(
  node: Pick<MeasurementNode, 'measurement'>,
  resolve: NodeResolver,
): MeasurementPayload {
  return resolveMeasurementNode(node, resolve).payload
}

export function freeMeasurementPoint(anchor: MeasurementAnchor): MeasurementPoint {
  return measurementAnchorFallback(anchor)
}

export { remapMeasurementReferences }
