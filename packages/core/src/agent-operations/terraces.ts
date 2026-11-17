import { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import { addTerracesTool } from '../agent-tools/terraforming'
import { GROUND_SUPPORT_ID } from '../hooks/spatial-grid/support-host-id'
import { groundLevelOf } from '../lib/ground-level'
import { heightAt, quantize } from '../lib/terrain-field'
import { isLevelAtSiteDatum } from '../lib/terrain-support-query'
import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, AnyNodeId, BuildingNode } from '../schema'
import { StairNode } from '../schema'
import { TerrainBreakNode } from '../schema/nodes/terrain-break'
import { levelPlaneWorldY } from '../services/storey'
import { createDefaultStairSegment } from '../systems/stair/stair-flight'
import { pointInPolygon, type Vec2 } from './plan-geometry'
import { requireNearLot, requireSampleBudget, STEP } from './terraforming'
import {
  editingField,
  groundOf,
  parseInput,
  pointOf,
  propertyOf,
  samplingOf,
  terrainWriteOutcome,
} from './terrain'
import { validateTerrainBreakPlacement } from './terrain-break'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

const terracesInput = z.strictObject(addTerracesTool.input)

const MIN_TREAD_M = 1.5
const MIN_LINE_M = 3
const MAX_LINE_M = 200
/** How far beyond a terrace its bank is looked for. */
const BANK_REACH_M = 12

const round = (value: number, digits = 2) => {
  const k = 10 ** digits
  return Math.round(value * k) / k
}

/**
 * `add_terraces`: a slope cut into level terraces that touch. Two closed breaks may not touch, so
 * the terraces alternate: every second one is a closed retaining break at its exact height, the
 * ones between are level ground on the lattice. Each face between two neighbours is then one
 * edge of one break, vertical and exact, with no strip of ground left between them.
 */
export const addTerraces: AgentOperation<z.infer<typeof terracesInput>> = (nodes, raw) => {
  const input = parseInput(terracesInput, raw)
  const { site, field: persisted } = groundOf(nodes)
  const property = propertyOf(site)
  const [top, bottom] = input.line.map(pointOf) as [Vec2, Vec2]
  // Bounds first: nothing below is sized from a coordinate or a count before these.
  requireNearLot([top, bottom], property, 'The line')
  const lengthM = Math.hypot(bottom[0] - top[0], bottom[1] - top[1])
  if (!(lengthM >= MIN_LINE_M && lengthM <= MAX_LINE_M))
    refuse(
      'invalid_input',
      `The line is ${lengthM.toFixed(1)} m long; terraces run along ${MIN_LINE_M} to ${MAX_LINE_M} m.`,
    )
  const count = input.count
  const treadM = lengthM / count
  if (treadM < MIN_TREAD_M)
    refuse(
      'invalid_input',
      `${count} terraces along ${lengthM.toFixed(1)} m are ${treadM.toFixed(2)} m deep each; a terrace is ${MIN_TREAD_M} m deep or more: at most ${Math.floor(lengthM / MIN_TREAD_M)} here.`,
    )
  const run = input.run ?? 2
  const half = input.widthM / 2
  const along: Vec2 = [(bottom[0] - top[0]) / lengthM, (bottom[1] - top[1]) / lengthM]
  const across: Vec2 = [-along[1], along[0]]
  const at = (s: number, t: number): Vec2 => [
    top[0] + along[0] * s + across[0] * t,
    top[1] + along[1] * s + across[1] * t,
  ]
  /** A terrace's rectangle, counter-clockwise in the site frame. */
  const outlineOf = (index: number): Vec2[] => {
    const ring = [
      at(index * treadM, -half),
      at((index + 1) * treadM, -half),
      at((index + 1) * treadM, half),
      at(index * treadM, half),
    ]
    const area = ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % 4] as Vec2
      return sum + a[0] * b[1] - b[0] * a[1]
    }, 0)
    return area < 0 ? ring.reverse() : ring
  }
  const whole = [at(0, -half), at(lengthM, -half), at(lengthM, half), at(0, half)]
  if (input.scope !== 'context' && !whole.every((corner) => pointInPolygon(corner, property)))
    refuse('outside_property', 'The terraces reach outside the site polygon; nothing was written.')
  const bounds = {
    minX: Math.min(...whole.map((p) => p[0])),
    minZ: Math.min(...whole.map((p) => p[1])),
    maxX: Math.max(...whole.map((p) => p[0])),
    maxZ: Math.max(...whole.map((p) => p[1])),
  }
  requireSampleBudget(bounds, BANK_REACH_M + 0.5)
  const field = editingField(
    site,
    nodes,
    {
      kind: 'polygon',
      polygon: [
        [bounds.minX, bounds.minZ],
        [bounds.maxX, bounds.minZ],
        [bounds.maxX, bounds.maxZ],
        [bounds.minX, bounds.maxZ],
      ],
    },
    BANK_REACH_M + 0.5,
  )
  const inside = (point: Vec2) => input.scope === 'context' || pointInPolygon(point, property)

  // The ground under each terrace before, read on a grid of its own (half a metre, 40 lines a
  // side at most): its mean sets the level where none is stated.
  const groundBefore = (point: Vec2) => (persisted ? heightAt(persisted, point[0], point[1]) : 0)
  const before = Array.from({ length: count }, (_, index) => {
    const rows = Math.min(40, Math.max(2, Math.ceil(treadM / 0.5)))
    const cols = Math.min(40, Math.max(2, Math.ceil(input.widthM / 0.5)))
    let sum = 0
    let lowest = Number.POSITIVE_INFINITY
    let highest = Number.NEGATIVE_INFINITY
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const height = groundBefore(
          at((index + (row + 0.5) / rows) * treadM, ((col + 0.5) / cols - 0.5) * input.widthM),
        )
        sum += height
        lowest = Math.min(lowest, height)
        highest = Math.max(highest, height)
      }
    return { mean: sum / (rows * cols), lowest, highest }
  })
  const place = (point: Vec2) => {
    const dx = point[0] - top[0]
    const dz = point[1] - top[1]
    return { s: dx * along[0] + dz * along[1], t: dx * across[0] + dz * across[1] }
  }
  const means = before.map((terrace) => terrace.mean)
  const first = means[0] as number
  const last = means[count - 1] as number
  const levels = means.map(
    (mean, index) =>
      quantize(
        field,
        input.topM !== undefined && input.bottomM !== undefined
          ? input.topM + ((input.bottomM - input.topM) * index) / (count - 1)
          : input.topM !== undefined
            ? input.topM + (mean - first)
            : input.bottomM !== undefined
              ? input.bottomM + (mean - last)
              : mean,
      ) * field.step,
  )
  /** Every second terrace from the first is a break; the ones between are lattice ground. */
  const isBreak = (index: number) => index % 2 === 0

  const heights = new Int16Array(field.heights)
  const cellM2 = field.spacing * field.spacing
  let cutVolumeM3 = 0
  let fillVolumeM3 = 0
  let changedSamples = 0
  let visited = 0
  for (let index = 0; index < field.heights.length; index++) {
    const point: Vec2 = [
      field.origin[0] + (index % field.cols) * field.spacing,
      field.origin[1] + Math.floor(index / field.cols) * field.spacing,
    ]
    const { s, t } = place(point)
    const beyond = Math.hypot(Math.max(0, -s, s - lengthM), Math.max(0, Math.abs(t) - half))
    if (beyond > BANK_REACH_M) continue
    visited++
    const terrace = Math.max(0, Math.min(count - 1, Math.floor(s / treadM)))
    const level = levels[terrace] as number
    const beforeQ = field.heights[index] ?? 0
    const beforeM = beforeQ * field.step
    let target = beforeM
    if (beyond === 0) target = level
    // A break holds the ground beside it with a face; lattice ground meets it with a bank.
    else if (!isBreak(terrace))
      target =
        beforeM > level
          ? Math.min(beforeM, level + beyond / run)
          : Math.max(beforeM, level - beyond / run)
    const nextQ = quantize(field, target)
    if (nextQ === beforeQ || !inside(point)) continue
    heights[index] = nextQ
    changedSamples++
    const movedM = (nextQ - beforeQ) * field.step
    if (movedM < 0) cutVolumeM3 += -movedM * cellM2
    else fillVolumeM3 += movedM * cellM2
  }

  // The breaks, each placed against the scene and the ones before it.
  let withBreaks = nodes
  const breaks = new Map<number, TerrainBreakNode>()
  for (let index = 0; index < count; index++) {
    if (!isBreak(index)) continue
    const ring = outlineOf(index)
    const node = TerrainBreakNode.parse({
      parentId: site.id,
      line: [...ring, ring[0]],
      kind: 'retaining',
      left: levels[index],
      right: 'ground',
      metadata: { source: 'add_terraces' },
    })
    validateTerrainBreakPlacement(withBreaks, site, node, input.scope)
    withBreaks = { ...withBreaks, [node.id]: node } as SceneNodes
    breaks.set(index, node)
  }

  const groundAt = groundBefore
  const edges = [
    {
      at: 'top',
      heightM: round(groundAt(at(-0.6, 0)) - (levels[0] as number)),
      heldBy: 'wall' as const,
    },
    ...levels.slice(1).map((level, index) => ({
      at: `between ${index} and ${index + 1}`,
      heightM: round((levels[index] as number) - level),
      heldBy: 'wall' as const,
    })),
    {
      at: 'bottom',
      heightM: round((levels[count - 1] as number) - groundAt(at(lengthM + 0.6, 0))),
      heldBy: isBreak(count - 1) ? ('wall' as const) : ('bank' as const),
    },
  ]

  // Flights: one from each terrace up to the one above, where the two differ by a step or more.
  const steps: {
    stairId: string
    fromTerrace: number
    toTerrace: number
    riseM: number
    stepCount: number
  }[] = []
  const creates: NonNullable<SceneChanges['create']> = [...breaks.values()].map((node) => ({
    node,
    parentId: site.id,
  }))
  let stepsNote: string | undefined
  if (input.stepsAt !== undefined) {
    const record = nodes as Record<AnyNodeId, AnyNode>
    const buildings = queryNodes<BuildingNode>(nodes, { type: 'building' }).filter(
      (building) => Math.abs(building.rotation[0]) < 1e-9 && Math.abs(building.rotation[2]) < 1e-9,
    )
    const building = buildings[0]
    const level = building ? groundLevelOf(record, building.id)?.level : undefined
    const plane = level ? levelPlaneWorldY(record, level.id) : null
    if (!building || !level || plane === null)
      stepsNote =
        'No flight was made: a flight belongs to a level of a building, and the scene has none to hold it.'
    else {
      const cos = Math.cos(building.rotation[1])
      const sin = Math.sin(building.rotation[1])
      const toLocal = ([x, z]: Vec2): Vec2 => [
        cos * (x - building.position[0]) - sin * (z - building.position[2]),
        sin * (x - building.position[0]) + cos * (z - building.position[2]),
      ]
      const carried = isLevelAtSiteDatum(record, level.id)
      const t = (input.stepsAt - 0.5) * (input.widthM - 1.2)
      for (let lower = 1; lower < count; lower++) {
        const upperM = levels[lower - 1] as number
        const lowerM = levels[lower] as number
        // The flight stands on whichever of the two is lower, and climbs to the other.
        const rise = Math.abs(upperM - lowerM)
        if (rise < 0.05) continue
        const stepCount = Math.max(1, Math.ceil(rise / STEP.maxRiser - 1e-9))
        const going = Math.min(
          STEP.maxGoing,
          Math.max(STEP.minGoing, STEP.comfort - (2 * rise) / stepCount),
        )
        const runM = Math.min(stepCount * going, treadM - 0.6)
        const down = upperM > lowerM ? 1 : -1
        const face = lower * treadM
        const foot = toLocal(at(face + down * runM, t))
        const climb: Vec2 = [-down * along[0], -down * along[1]]
        const turned: Vec2 = [cos * climb[0] - sin * climb[1], sin * climb[0] + cos * climb[1]]
        const segment = createDefaultStairSegment({
          width: 1.2,
          height: rise,
          length: runM,
          stepCount,
          attachmentSide: 'front',
          fillToFloor: true,
        })
        const stair = StairNode.parse({
          name: `Steps between terraces ${lower - 1} and ${lower}`,
          parentId: level.id,
          position: [
            foot[0],
            // A level the ground carries stands its flights on the ground; any other states it.
            carried ? 0 : round(Math.min(upperM, lowerM) - plane, 4),
            foot[1],
          ],
          rotation: Math.atan2(turned[0], turned[1]),
          supportSlabId: GROUND_SUPPORT_ID,
          stairType: 'straight',
          fromLevelId: level.id,
          toLevelId: null,
          totalRise: rise,
          width: 1.2,
          stepCount,
          railingMode: stepCount > 3 ? 'both' : 'none',
          children: [segment.id],
        })
        creates.push(
          { node: stair, parentId: level.id },
          { node: { ...segment, parentId: stair.id }, parentId: stair.id },
        )
        steps.push({
          stairId: stair.id,
          fromTerrace: down === 1 ? lower : lower - 1,
          toTerrace: down === 1 ? lower - 1 : lower,
          riseM: round(rise, 3),
          stepCount,
        })
      }
    }
  }

  return terrainWriteOutcome(
    site,
    nodes,
    field,
    heights,
    {
      terraces: levels.map((level, index) => ({
        index,
        levelM: round(level),
        outline: outlineOf(index).map(([x, z]) => [round(x, 3), round(z, 3)]),
        heldAs: isBreak(index) ? 'break' : 'lattice',
        ...(breaks.get(index) ? { breakId: breaks.get(index)?.id } : {}),
        groundBeforeM: {
          lowest: round((before[index] as (typeof before)[number]).lowest),
          highest: round((before[index] as (typeof before)[number]).highest),
        },
      })),
      edges,
      ...(steps.length ? { steps } : {}),
      ...(stepsNote ? { stepsNote } : {}),
      cutVolumeM3,
      fillVolumeM3,
      netM3: cutVolumeM3 - fillVolumeM3,
      changedSamples,
      sampling: samplingOf(field, 'field_samples_in_terraces', visited),
    },
    { create: creates },
  )
}
