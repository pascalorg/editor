import type { AnyNode, StairSegmentNode as Segment, StairNode as Stair } from '../../schema'
import { StairNode } from '../../schema/nodes/stair'
import { StairSegmentNode } from '../../schema/nodes/stair-segment'
import { stairFootprintAABB } from './stair-footprint'
import { resolveStairTotalRise } from './stair-rise-query'
import { planStairSizing } from './stair-sizing'

export type StairLayoutPreset = 'straight' | 'l' | 'u'
export type StairPresetOptions = {
  layout: StairLayoutPreset
  turn?: 'left' | 'right'
  width?: number
  landingDepth?: number
  turningStrategy?: 'landing' | 'winder'
  innerGap?: number
  walkingLineOffset?: number
  division?: 'equal-going' | 'equal-angle'
}

/** Proposes a replacement chain, retaining flight/landing identities and finishes by role. */
export function planStairPreset(
  original: Stair,
  nodes: Record<string, AnyNode>,
  options: StairPresetOptions,
) {
  const width = options.width ?? original.width
  const landingDepth = options.landingDepth ?? width
  if (!(Number.isFinite(width) && width > 0)) throw new RangeError('Width must be positive')
  if (!(Number.isFinite(landingDepth) && landingDepth >= width))
    throw new RangeError('A turning landing must be at least as deep as the stair is wide')
  const old = original.children
    .map((id) => nodes[id])
    .filter((node): node is Segment => node?.type === 'stair-segment')
  const flights = old.filter((node) => node.segmentType === 'stair' && !node.winder)
  const landings = old.filter((node) => node.segmentType === 'landing')
  const turn = options.turn ?? 'left'
  let rise = resolveStairTotalRise(original, nodes)
  for (let iteration = 0; iteration < 16; iteration++) {
    const sizing = planStairSizing(rise, { targets: original.designTargets })
    const count = Math.max(options.layout === 'straight' ? 2 : 4, sizing.stepCount)
    const winding = options.turningStrategy === 'winder' && options.layout !== 'straight'
    const quarterCount = options.layout === 'u' ? 2 : 1
    const walkingLineOffset = options.walkingLineOffset ?? width / 2
    const innerGap = options.innerGap ?? 0
    if (!(walkingLineOffset > 0 && walkingLineOffset <= width && innerGap >= 0))
      throw new RangeError(
        'The walking line must lie within the winder width and gap must be nonnegative',
      )
    const winderCount = Math.max(1, Math.round((2 * (innerGap + walkingLineOffset)) / sizing.going))
    if (winding && quarterCount * winderCount > count - 2)
      throw new RangeError('The selected winder gap needs more risers than this stair permits')
    const counts =
      options.layout === 'straight'
        ? [count]
        : [
            Math.ceil((count - (winding ? quarterCount * winderCount : 0)) / 2),
            Math.floor((count - (winding ? quarterCount * winderCount : 0)) / 2),
          ]
    let flightIndex = 0
    let landingIndex = 0
    const make = (segmentType: 'stair' | 'landing', attachmentSide: Segment['attachmentSide']) => {
      const prior = segmentType === 'stair' ? flights[flightIndex] : landings[landingIndex]
      const stepCount = segmentType === 'stair' ? counts[flightIndex++]! : 0
      if (segmentType === 'landing') landingIndex++
      return StairSegmentNode.parse({
        ...prior,
        winder: undefined,
        parentId: original.id,
        segmentType,
        visible: true,
        position: [0, 0, 0],
        rotation: 0,
        attachmentSide,
        width,
        length: segmentType === 'stair' ? stepCount * sizing.going : landingDepth,
        height: segmentType === 'stair' ? (rise * stepCount) / count : 0,
        stepCount,
        fillToFloor: prior?.fillToFloor ?? original.fillToFloor,
        thickness: prior?.thickness ?? original.thickness,
      })
    }
    const segments = [make('stair', 'front')]
    if (options.layout !== 'straight') {
      if (winding) {
        for (let quarter = 0; quarter < quarterCount; quarter++) {
          const prior = old.filter((flight) => flight.winder)[quarter]
          segments.push(
            StairSegmentNode.parse({
              ...prior,
              id: prior?.id,
              parentId: original.id,
              width,
              visible: true,
              length: 2 * (innerGap + walkingLineOffset),
              height: (rise * winderCount) / count,
              stepCount: winderCount,
              attachmentSide: 'front',
              winder: {
                turn,
                innerGap,
                walkingLineOffset,
                division: options.division ?? 'equal-going',
              },
              fillToFloor: prior?.fillToFloor ?? original.fillToFloor,
              thickness: prior?.thickness ?? original.thickness,
            }),
          )
        }
      } else {
        segments.push(make('landing', 'front'))
        if (options.layout === 'u') segments.push(make('landing', turn))
      }
      segments.push(make('stair', winding ? 'front' : turn))
    }
    const stair = StairNode.parse({
      ...original,
      stairType: 'straight',
      width,
      stepCount: count,
      uniformRisers: true,
      children: segments.map((segment) => segment.id),
    })
    const proposed = { ...nodes, [stair.id]: stair }
    for (const segment of segments) proposed[segment.id] = segment
    const nextRise = resolveStairTotalRise(stair, proposed)
    if (Math.abs(nextRise - rise) < 1e-6) {
      const box = stairFootprintAABB({ ...stair, position: [0, 0, 0], rotation: 0 }, proposed)!
      return {
        stair,
        segments,
        removeIds: old.filter((node) => !stair.children.includes(node.id)).map((node) => node.id),
        footprint: { width: box.maxX - box.minX, length: box.maxZ - box.minZ },
      }
    }
    rise = nextRise
  }
  throw new RangeError('Stair support and arrival do not converge for this layout')
}

/** Footprints in the stair's local axes; no scene writes and no automatic replacement. */
export function proposeStairLayouts(
  stair: Stair,
  nodes: Record<string, AnyNode>,
  available?: { width: number; length: number },
) {
  if (available && (!(available.width > 0) || !(available.length > 0)))
    throw new RangeError('Available footprint must be positive')
  return (
    [
      { layout: 'straight', turn: 'left' },
      { layout: 'l', turn: 'left' },
      { layout: 'l', turn: 'right' },
      { layout: 'u', turn: 'left' },
      { layout: 'u', turn: 'right' },
    ] as const
  ).map(({ layout, turn }) => {
    try {
      const plan = planStairPreset(stair, nodes, { layout, turn })
      return {
        layout,
        turn,
        footprint: plan.footprint,
        fits: available
          ? plan.footprint.width <= available.width + 1e-8 &&
            plan.footprint.length <= available.length + 1e-8
          : null,
        error: null,
      }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      return { layout, turn, footprint: null, fits: false, error: error.message }
    }
  })
}
