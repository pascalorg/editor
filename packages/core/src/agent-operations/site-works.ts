import { refuse } from '../agent-tools/refusal'
import type { SITE_SURFACE_KINDS } from '../agent-tools/site-works'
import { FenceNode, SlabNode, StairNode } from '../schema'
import { getLevelFloorToFloorHeight } from '../services/storey'
import { createDefaultStairSegment } from '../systems/stair/stair-flight'
import { refuseRoofLevel } from './add-wall'
import { type LevelTargetInput, targetLevel } from './level-target'
import type { AgentOperation, SceneNodes } from './types'

type Pt = [number, number]
const count = (nodes: SceneNodes, type: string) =>
  Object.values(nodes).filter((node) => node.type === type).length
const round = (value: number) => Math.round(value * 100) / 100

/** A fence side shorter than this is a slip, not a fence. */
const FENCE_MIN_SIDE = 0.1

type AddFenceInput = LevelTargetInput & {
  points: number[][]
  closed?: boolean
  height?: number
  style?: string
  baseStyle?: string
  materialPreset?: string
}

/**
 * `add_fence`: one fence per side along the points, privacy unless asked (L37: one made with no
 * style came out as open rails). Fences stand on the level, as the editor's fence tool puts them.
 */
export const addFence: AgentOperation<AddFenceInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, level.id, 'a fence')
  const points = input.points as Pt[]
  const sides: [Pt, Pt][] = points.slice(1).map((point, i) => [points[i]!, point])
  if (input.closed && points.length > 2) sides.push([points.at(-1)!, points[0]!])
  const short = sides.find(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) < FENCE_MIN_SIDE)
  if (short)
    refuse(
      'fence_too_short',
      `The side from [${short[0]}] to [${short[1]}] is shorter than ${FENCE_MIN_SIDE * 100} cm: drop the repeated point.`,
      { start: short[0], end: short[1] },
    )
  const first = count(nodes, 'fence')
  const fences = sides.map(([start, end], i) =>
    FenceNode.parse({
      name: `Fence ${first + i + 1}`,
      parentId: level.id,
      start,
      end,
      style: input.style ?? 'privacy',
      ...(input.height === undefined ? {} : { height: input.height }),
      ...(input.baseStyle === undefined ? {} : { baseStyle: input.baseStyle }),
      ...(input.materialPreset === undefined ? {} : { materialPreset: input.materialPreset }),
    }),
  )
  const length = sides.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0)
  return {
    result: {
      ok: true,
      count: fences.length,
      fenceIds: fences.map((fence) => fence.id),
      levelId: level.id,
      length: round(length),
    },
    changes: { create: fences.map((node) => ({ node, parentId: level.id })) },
  }
}

type SiteSurfaceKind = (typeof SITE_SURFACE_KINDS)[number]

/**
 * What each surface is made of unless asked, and how far above the ground it lies: paving a few
 * centimetres proud, a lawn just above it (L38: the site rendered white, run 2 had no grass).
 */
const SURFACES: Record<SiteSurfaceKind, { material: string; elevation: number; name: string }> = {
  driveway: { material: 'library:concrete-raw', elevation: 0.05, name: 'Driveway' },
  path: { material: 'library:flooring-rusticbrick', elevation: 0.03, name: 'Path' },
  patio: { material: 'library:flooring-wallstone1', elevation: 0.05, name: 'Patio' },
  lawn: { material: 'library:preset-lawn', elevation: 0.01, name: 'Lawn' },
}

/** The editor's site plan reads these as paving (driveway, walk, patio) or open ground (lawn). */
const FLATWORK: Record<SiteSurfaceKind, string> = {
  driveway: 'driveway',
  path: 'walk',
  patio: 'patio',
  lawn: 'lawn',
}

type AddSiteSurfaceInput = LevelTargetInput & {
  kind: SiteSurfaceKind
  polygon?: number[][]
  corners?: number[][]
  materialPreset?: string
  name?: string
}

const shoelace = (ring: Pt[]) =>
  Math.abs(
    ring.reduce((sum, [x, z], i) => {
      const [nx, nz] = ring[(i + 1) % ring.length]!
      return sum + x * nz - nx * z
    }, 0) / 2,
  )

/** `add_site_surface`: a driveway, path, patio or lawn at grade, as a slab the site plan reads. */
export const addSiteSurface: AgentOperation<AddSiteSurfaceInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, level.id, `a ${input.kind}`)
  const [a, b] = (input.corners ?? []) as Pt[]
  const polygon: Pt[] =
    a && b
      ? [
          [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
          [Math.max(a[0], b[0]), Math.min(a[1], b[1])],
          [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
          [Math.min(a[0], b[0]), Math.max(a[1], b[1])],
        ]
      : ((input.polygon ?? []) as Pt[])
  const area = polygon.length >= 3 ? shoelace(polygon) : 0
  if (area < 0.01)
    refuse(
      'surface_degenerate',
      `The ${input.kind} has no area: give at least three corners that are not in a line, or two opposite corners.`,
    )
  const surface = SURFACES[input.kind]
  const slab = SlabNode.parse({
    name: input.name ?? surface.name,
    parentId: level.id,
    polygon,
    elevation: surface.elevation,
    materialPreset: input.materialPreset ?? surface.material,
    metadata: { flatwork: FLATWORK[input.kind] },
  })
  return {
    result: { ok: true, slabId: slab.id, kind: input.kind, area: round(area), levelId: level.id },
    changes: { create: [{ node: slab, parentId: level.id }] },
  }
}

/** A riser of an outside flight; its tread (going) is the stair segment's default. */
const RISER = 0.17

type AddStepsInput = LevelTargetInput & {
  x: number
  z: number
  rise: number
  width?: number
  rotation?: number
}

/**
 * `add_steps`: a short outside flight of its own rise, from the ground up to a porch or a door
 * sill. Unlike create_stair it makes no storey above (fromLevel only, explicit totalRise), and it
 * cuts no floor.
 */
export const addSteps: AgentOperation<AddStepsInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, level.id, 'steps')
  const storey = getLevelFloorToFloorHeight(level.id, nodes as never)
  if (input.rise >= Math.min(storey, 2))
    refuse(
      'steps_too_tall',
      `A rise of ${input.rise} m is a flight between storeys: use create_stair. add_steps climbs to a porch or a sill, under 2 m.`,
      { rise: input.rise },
    )
  const stepCount = Math.max(1, Math.round(input.rise / RISER))
  const width = input.width ?? 1.2
  const segment = createDefaultStairSegment({
    width,
    height: input.rise,
    stepCount,
    attachmentSide: 'front',
    fillToFloor: true,
  })
  const stair = StairNode.parse({
    name: `Steps ${count(nodes, 'stair') + 1}`,
    parentId: level.id,
    position: [input.x, 0, input.z],
    rotation: ((input.rotation ?? 0) * Math.PI) / 180,
    stairType: 'straight',
    fromLevelId: level.id,
    toLevelId: null,
    totalRise: input.rise,
    width,
    stepCount,
    railingMode: stepCount > 3 ? 'both' : 'none',
    children: [segment.id],
  })
  return {
    result: {
      ok: true,
      stairId: stair.id,
      stepCount,
      rise: input.rise,
      levelId: level.id,
    },
    changes: {
      create: [
        { node: stair, parentId: level.id },
        { node: { ...segment, parentId: stair.id }, parentId: stair.id },
      ],
    },
  }
}
