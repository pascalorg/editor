import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'
import { StairDesignTargets } from '../../schema/nodes/stair'
import { measureStairHeadroom } from './stair-clearance'
import { resolveStairConstruction } from './stair-construction'
import { measureStairDetail } from './stair-detail-budget'
import {
  createDefaultStairSegment,
  createStairFlightFromStair,
  type StairFlightOverrides,
} from './stair-flight'
import { resolveStairArcDimensions } from './stair-layout'
import { resolveStairRailPaths } from './stair-rail-path'
import { resolveStairTotalRise } from './stair-rise-query'
import { resolveStairWinder } from './stair-winder'

export const DEFAULT_STAIR_DESIGN_TARGETS = StairDesignTargets.parse({})

export function planStairSizing(
  rise: number,
  options: { stepCount?: number; runLength?: number; targets?: Partial<StairDesignTargets> } = {},
) {
  const targets = StairDesignTargets.parse(options.targets ?? {})
  if (!(Number.isFinite(rise) && rise > 0)) throw new RangeError('Rise must be positive')
  const ratio = rise / targets.maxRiserHeight
  const stepCount = options.stepCount ?? Math.max(2, Math.ceil(ratio - Number.EPSILON * ratio))
  if (!Number.isSafeInteger(stepCount) || stepCount < 2)
    throw new RangeError('Use at least two whole risers')
  const length =
    options.runLength ?? stepCount * Math.max(targets.minimumGoing, targets.targetGoing)
  if (!(Number.isFinite(length) && length > 0)) throw new RangeError('Run must be positive')
  return { stepCount, length, riserHeight: rise / stepCount, going: length / stepCount }
}

export function createSizedStairFlight(
  rise: number,
  overrides: Omit<StairFlightOverrides, 'height'> = {},
  targets?: Partial<StairDesignTargets>,
) {
  const sizing = planStairSizing(rise, {
    stepCount: overrides.stepCount,
    runLength: overrides.length,
    targets,
  })
  return createDefaultStairSegment({
    ...overrides,
    height: rise,
    length: sizing.length,
    stepCount: sizing.stepCount,
  })
}

/** Resolves support and arrival against each proposed run before returning a new flight. */
export function planStairCreation(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  dimensions: Omit<StairFlightOverrides, 'height'> = {},
  baseElevation?: number,
) {
  const resolveRise = (candidate: StairNode, prospective: Record<string, AnyNode>) =>
    resolveStairTotalRise(
      candidate,
      prospective,
      baseElevation === undefined ? undefined : () => baseElevation,
    )
  let flight = createSizedStairFlight(
    resolveRise({ ...stair, children: [] }, nodes),
    dimensions,
    stair.designTargets,
  )
  for (let iteration = 0; ; iteration++) {
    const candidate = { ...stair, stepCount: flight.stepCount, children: [flight.id] }
    const rise = resolveRise(candidate, {
      ...nodes,
      [candidate.id]: candidate,
      [flight.id]: { ...flight, parentId: candidate.id },
    })
    if (Math.abs(rise - flight.height) < 1e-6) return { stair: candidate, flight }
    if (iteration === 15)
      throw new RangeError(
        'Stair support and arrival do not converge; choose an explicit rise or run',
      )
    flight = { ...createSizedStairFlight(rise, dimensions, stair.designTargets), id: flight.id }
  }
}

export type StairDiagnostic = {
  code: string
  severity: 'error' | 'warning'
  nodeId: string
  message: string
}

export function measureStair(stair: StairNode, nodes: Record<string, AnyNode>) {
  const totalRise = resolveStairTotalRise(stair, nodes)
  const targets = stair.designTargets ?? DEFAULT_STAIR_DESIGN_TARGETS
  const diagnostics: StairDiagnostic[] = []
  const report = (
    code: string,
    nodeId: string,
    message: string,
    severity: 'error' | 'warning' = 'warning',
  ) => diagnostics.push({ code, severity, nodeId, message })
  if (!(totalRise > 0))
    report('invalid-rise', stair.id, 'The destination must be above the stair base.', 'error')
  const arc = resolveStairArcDimensions(stair, totalRise)
  if (
    stair.stairType === 'spiral' &&
    stair.topLandingMode === 'integrated' &&
    stair.topLandingDepth > 2 * Math.PI * arc.walkingRadius
  )
    report(
      'landing-overlap',
      stair.id,
      'Landing depth exceeds a full circle at the walking line; the visible landing is limited to one circle.',
    )
  const segments = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  const segmentsById = new Map(segments.map((segment) => [segment.id as string, segment]))
  const detail = measureStairDetail(stair, segments)
  if (detail.error) report('geometry-unresolved', stair.id, detail.error, 'error')
  const flights =
    stair.stairType !== 'straight'
      ? [
          {
            nodeId: stair.id,
            count: arc.stepCount,
            rise: totalRise,
            length: Math.abs(arc.sweepAngle) * arc.walkingRadius,
            width: arc.width,
            innerGoing: Math.abs(arc.stepSweep) * arc.innerRadius,
          },
        ]
      : (segments.length
          ? segments.filter((segment) => segment.segmentType === 'stair')
          : [createStairFlightFromStair(stair, nodes)]
        ).map((segment) => {
          let winder = null
          try {
            winder = resolveStairWinder(segment)
          } catch (error) {
            report(
              'invalid-winder',
              segment.id,
              error instanceof Error ? error.message : String(error),
              'error',
            )
          }
          if (winder && winder.narrowEndGoing < 0.1)
            report(
              'narrow-winder-end',
              segment.id,
              'The narrow end of a winder tread is below 0.10 m; check the intended stair use.',
            )
          return {
            nodeId: segments.length ? segment.id : stair.id,
            count: segment.stepCount,
            rise: segment.height,
            length: winder
              ? 2 * (segment.winder!.innerGap + segment.winder!.walkingLineOffset)
              : segment.length,
            ...(winder ? { minimumGoing: winder.going } : {}),
            width: segment.width,
            innerGoing: winder?.narrowEndGoing ?? null,
          }
        })
  const measurements = flights.map((flight) => {
    const valid =
      Number.isInteger(flight.count) &&
      flight.count > 0 &&
      flight.length > 0 &&
      flight.rise > 0 &&
      flight.width > 0
    if (!valid)
      report(
        'invalid-flight',
        flight.nodeId,
        'Flight dimensions and integer riser count must be positive.',
        'error',
      )
    const riserHeight = valid ? flight.rise / flight.count : null
    const going = valid
      ? 'minimumGoing' in flight
        ? (flight.minimumGoing ?? flight.length / flight.count)
        : flight.length / flight.count
      : null
    if (riserHeight !== null && riserHeight > targets.maxRiserHeight + 1e-6)
      report('riser-target', flight.nodeId, 'Riser height exceeds the design target.')
    if (going !== null && going < targets.minimumGoing - 1e-6)
      report('going-target', flight.nodeId, 'Going is below the design target.')
    const comfort = riserHeight !== null && going !== null ? 2 * riserHeight + going : null
    if (comfort !== null && (comfort < 0.6 || comfort > 0.65))
      report(
        'comfort-target',
        flight.nodeId,
        'Two risers plus going is outside the 0.60–0.65 m design range.',
      )
    return {
      ...flight,
      construction: resolveStairConstruction(segmentsById.get(flight.nodeId) ?? stair, stair),
      riserHeight,
      going,
      comfort,
      slope: valid ? Math.atan2(flight.rise, flight.length) : null,
    }
  })
  const risers = measurements.flatMap((flight) =>
    flight.riserHeight === null ? [] : [flight.riserHeight],
  )
  const uniformity = risers.length ? Math.max(...risers) - Math.min(...risers) : 0
  if (uniformity > 1e-4)
    report(
      'nonuniform-risers',
      stair.id,
      'Flight riser heights differ. Use uniform-riser repair only if this is a proposed design.',
    )
  for (const landing of segments.filter(
    (segment) =>
      stair.stairType === 'straight' && segment.segmentType === 'landing' && segment.height !== 0,
  ))
    report(
      'raised-landing',
      landing.id,
      'A landing has a stored rise; inspect its transition before repair.',
    )
  const chainRise = segments.reduce((sum, segment) => sum + segment.height, 0)
  if (stair.stairType === 'straight' && segments.length && Math.abs(chainRise - totalRise) > 1e-4)
    report(
      'arrival-mismatch',
      stair.id,
      'The flight chain does not reach the declared destination.',
    )
  const headroom = measureStairHeadroom(stair, nodes)
  if (headroom.status === 'unresolved')
    report(
      'headroom-unresolved',
      stair.id,
      'Detailed headroom could not be evaluated: check riser counts and the surface query budget.',
    )
  else if (headroom.obstructions.length)
    report('headroom-target', stair.id, 'Overhead surfaces leave less than the target headroom.')
  return {
    totalRise,
    targets,
    detail,
    headroom,
    railings: {
      layout:
        segments.some((segment) => segment.winder) ||
        stair.railingStyle === 'glass' ||
        stair.railingStyle === 'metal'
          ? 'continuous'
          : (stair.railingPath ?? 'original'),
      style: stair.railingStyle ?? 'balusters',
      guardHeight: stair.railingHeight,
      handrail: stair.handrail ?? null,
      paths: detail.error
        ? null
        : segments.some((segment) => segment.winder) ||
            stair.railingPath === 'continuous' ||
            stair.railingStyle === 'glass' ||
            stair.railingStyle === 'metal'
          ? resolveStairRailPaths(stair, nodes).map((path) => ({
              side: path.side,
              nodeIds: path.nodeIds,
              length: path.points
                .slice(1)
                .reduce(
                  (sum, point, i) =>
                    sum +
                    Math.hypot(
                      point[0] - path.points[i]![0],
                      point[1] - path.points[i]![1],
                      point[2] - path.points[i]![2],
                    ),
                  0,
                ),
            }))
          : null,
    },
    flights: measurements,
    riserCount: flights.reduce((sum, flight) => sum + flight.count, 0),
    uniformity,
    diagnostics,
  }
}

/** Explicit repair; existing measured flight proportions remain untouched until requested. */
export function planStairSizingEdit(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  fitRun = false,
) {
  const rise = resolveStairTotalRise(stair, nodes)
  const targets = stair.designTargets ?? DEFAULT_STAIR_DESIGN_TARGETS
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  if (stair.stairType !== 'straight') {
    const sizing = planStairSizing(rise, { targets })
    const arc = resolveStairArcDimensions(stair, rise)
    updates.push({
      id: stair.id,
      data: {
        stepCount: sizing.stepCount,
        uniformRisers: true,
        ...(fitRun
          ? { sweepAngle: (Math.sign(arc.sweepAngle || 1) * sizing.length) / arc.walkingRadius }
          : {}),
      },
    })
    return updates
  }
  const segments = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  const flights = segments.filter((segment) => segment.segmentType === 'stair')
  if (segments.length && !flights.length)
    throw new RangeError('Add a flight before sizing a stair with only landings')
  const flightRise =
    rise -
    segments
      .filter((segment) => segment.segmentType === 'landing')
      .reduce((sum, segment) => sum + segment.height, 0)
  const sizing = planStairSizing(flightRise, { targets })
  if (!flights.length) {
    if (fitRun) throw new RangeError('Add a flight before fitting the run')
    return [{ id: stair.id, data: { stepCount: sizing.stepCount, uniformRisers: true } }]
  }
  const count = Math.max(2 * flights.length, sizing.stepCount)
  const available = count - 2 * flights.length
  const run = (flight: StairSegmentNode) =>
    flight.winder ? 2 * (flight.winder.innerGap + flight.winder.walkingLineOffset) : flight.length
  for (const flight of flights) resolveStairWinder(flight)
  const weight = flights.reduce((sum, flight) => sum + Math.max(0, run(flight)), 0)
  const shares = flights.map((flight, index) => ({
    index,
    value: weight ? (available * Math.max(0, run(flight))) / weight : available / flights.length,
  }))
  const counts = shares.map((share) => 2 + Math.floor(share.value))
  let remaining = count - counts.reduce((sum, value) => sum + value, 0)
  for (const share of [...shares].sort((a, b) => (b.value % 1) - (a.value % 1))) {
    if (remaining-- <= 0) break
    counts[share.index]! += 1
  }
  updates.push({ id: stair.id, data: { uniformRisers: true, stepCount: count } })
  for (const [index, flight] of flights.entries()) {
    const stepCount = counts[index]!
    updates.push({
      id: flight.id,
      data: {
        stepCount,
        height: (flightRise * stepCount) / count,
        ...(fitRun && !flight.winder ? { length: stepCount * sizing.going } : {}),
      },
    })
  }
  return updates
}
