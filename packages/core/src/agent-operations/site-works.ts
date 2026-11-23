import { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import { addSiteSurfaceTool } from '../agent-tools/site-works'
import { GROUND_SUPPORT_ID } from '../hooks/spatial-grid/support-host-id'
import { buildLawn, LawnBuildError, type LawnFacts } from '../lib/lawn'
import { plantingArea } from '../lib/planting-outline'
import { levelLocalToWorldXZ } from '../lib/terrain-support-query'
import { queryNodes } from '../runtime/node-queries'
import {
  type AnyNode,
  type BuildingNode,
  LawnNode,
  type SiteNode,
  SlabNode,
  StairNode,
} from '../schema'
import { getLevelFloorToFloorHeight } from '../services/storey'
import { pointInPolygon } from '../systems/slab/slab-support'
import { createDefaultStairSegment } from '../systems/stair/stair-flight'
import { type LevelTargetInput, targetLevel } from './level-target'
import { honestNodePatch } from './node-patch'
import { refuseRoofLevel } from './roof-writes'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

type Pt = [number, number]
const count = (nodes: SceneNodes, type: AnyNode['type']) => queryNodes(nodes, { type }).length
const round = (value: number) => Math.round(value * 100) / 100

type PavingKind = 'driveway' | 'path' | 'patio'
const surfaceInput = z.strictObject(addSiteSurfaceTool.input)
type AddSiteSurfaceInput = z.output<typeof surfaceInput>

const SURFACES: Record<PavingKind, { material: string; elevation: number; name: string }> = {
  driveway: { material: 'library:concrete-raw', elevation: 0.05, name: 'Driveway' },
  path: { material: 'library:flooring-rusticbrick', elevation: 0.03, name: 'Path' },
  patio: { material: 'library:flooring-wallstone1', elevation: 0.05, name: 'Patio' },
}

const FLATWORK: Record<PavingKind, string> = {
  driveway: 'driveway',
  path: 'walk',
  patio: 'patio',
}

function lawnSite(nodes: SceneNodes, id?: string): SiteNode {
  if (id) {
    const site = nodes[id]
    if (site?.type !== 'site') refuse('no_site', `No Site found for lawn: ${id}.`)
    return site
  }
  const sites = queryNodes(nodes, { type: 'site' }).filter((node) => node.type === 'site')
  if (sites.length > 1) refuse('ambiguous_site', 'Choose the lawn’s owning Site with siteId.')
  const site = sites[0]
  if (!site) refuse('no_site', 'Add a Site before adding lawn.')
  return site
}

function lawnFrame(nodes: SceneNodes, input: AddSiteSurfaceInput, context: AgentContext) {
  if (input.siteId) {
    if (input.levelId || input.level || input.buildingId)
      refuse(
        'lawn_target_conflict',
        'With siteId, supply Site-space coordinates without a level or building target.',
      )
    return { site: lawnSite(nodes, input.siteId), building: null }
  }
  let buildingId = input.buildingId
  if (!buildingId && !input.levelId && !input.level && !context.activeLevelId) lawnSite(nodes)
  const useLevel =
    input.levelId ||
    input.level ||
    (!buildingId && (context.activeLevelId || queryNodes(nodes, { type: 'level' }).length > 0))
  if (useLevel) {
    const level = targetLevel(nodes, input, context)
    refuseRoofLevel(nodes, level.id, 'a lawn')
    if (buildingId && buildingId !== level.parentId)
      refuse(
        'lawn_target_conflict',
        'The level and building must name the same lawn coordinate frame.',
      )
    buildingId = level.parentId ?? undefined
    if (!buildingId) refuse('no_site', 'The lawn’s level must belong to a building on a Site.')
  }
  if (!buildingId) return { site: lawnSite(nodes), building: null }
  const building = nodes[buildingId]
  if (building?.type !== 'building')
    refuse('building_not_found', `No building found for lawn: ${buildingId}.`)
  if (Math.abs(building.rotation[0]) > 1e-9 || Math.abs(building.rotation[2]) > 1e-9)
    refuse(
      'lawn_transform_unsupported',
      'A tipped building cannot supply a lawn plan frame; give Site coordinates instead.',
    )
  if (!building.parentId) refuse('no_site', 'The lawn’s building must belong to a Site.')
  return { site: lawnSite(nodes, building.parentId), building }
}

function surfacePolygon(input: AddSiteSurfaceInput): Pt[] {
  const [a, b] = (input.corners ?? []) as Pt[]
  return a && b
    ? [
        [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
        [Math.max(a[0], b[0]), Math.min(a[1], b[1])],
        [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
        [Math.min(a[0], b[0]), Math.max(a[1], b[1])],
      ]
    : ((input.polygon ?? []) as Pt[])
}

function lawnFields(input: AddSiteSurfaceInput, building: BuildingNode | null) {
  const {
    kind: _kind,
    polygon: _polygon,
    corners: _corners,
    siteId: _siteId,
    buildingId: _buildingId,
    levelId: _levelId,
    level: _level,
    materialPreset: _materialPreset,
    ...fields
  } = input
  return {
    ...fields,
    outline: surfacePolygon(input).map(([x, z]) => levelLocalToWorldXZ(building, x, z)),
    strokes: input.strokes?.map((stroke) => ({
      ...stroke,
      points: stroke.points.map(([x, z]) => levelLocalToWorldXZ(building, x, z)),
    })),
  }
}

function addLawn(nodes: SceneNodes, raw: AddSiteSurfaceInput, context: AgentContext) {
  const parsed = surfaceInput.safeParse(raw)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  const input = parsed.data
  if ((input.polygon !== undefined) === (input.corners !== undefined))
    refuse('lawn_outline_required', 'Give exactly one lawn polygon or two opposite corners.')
  if (input.materialPreset !== undefined)
    refuse(
      'lawn_material_unsupported',
      'A lawn uses blade and flower colours, not a paving materialPreset.',
    )
  const { site, building } = lawnFrame(nodes, input, context)
  const fields = lawnFields(input, building)
  if (Math.abs(plantingArea(fields.outline)) < 0.01)
    refuse(
      'surface_degenerate',
      'The lawn has no area; give a non-degenerate polygon or rectangle.',
    )
  const validated = LawnNode.safeParse({
    name: 'Lawn',
    ...fields,
    parentId: site.id,
  })
  if (!validated.success) refuse('invalid_input', validated.error.message)
  const node = validated.data
  const facts = generatedLawnFacts(node, nodes)
  return {
    result: { ok: true, kind: 'lawn', lawnId: node.id, siteId: site.id, ...facts },
    changes: { create: [{ node, parentId: site.id }] },
  }
}

function generatedLawnFacts(node: LawnNode, nodes: SceneNodes): LawnFacts {
  try {
    return buildLawn(node, nodes).facts
  } catch (error) {
    if (error instanceof LawnBuildError) refuse(error.code, error.message)
    throw error
  }
}

/** Both generic edit adapters preflight before writing and return these same measured facts. */
export function lawnPatchFacts(
  current: AnyNode,
  data: Readonly<Record<string, unknown>>,
  nodes: SceneNodes,
): LawnFacts | null {
  if (current.type !== 'lawn') return null
  const patch = honestNodePatch(current, data)
  const merged: Record<string, unknown> = { ...current, ...patch }
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete merged[key]
  const parsed = LawnNode.safeParse(merged)
  if (!parsed.success) refuse('invalid_input', parsed.error.message)
  if (!parsed.data.parentId) refuse('no_site', 'A lawn must remain a child of its owning Site.')
  lawnSite(nodes, parsed.data.parentId)
  return generatedLawnFacts(parsed.data, nodes)
}

/** Paving stays level-owned; lawns are authored once in the Site frame. */
export const addSiteSurface: AgentOperation<AddSiteSurfaceInput> = (nodes, input, context) => {
  if (input.kind === 'lawn') return addLawn(nodes, input, context)
  const level = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, level.id, `a ${input.kind}`)
  const polygon = surfacePolygon(input)
  const area = polygon.length >= 3 ? Math.abs(plantingArea(polygon)) : 0
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

/** A riser of an outside flight. */
const RISER = 0.17
/** Its going: two risers and a going make a comfortable step (0.63 m), within what a foot needs. */
const GOING = { comfort: 0.63, min: 0.25, max: 0.35 }

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
  // The run follows the rise, not the segment's default length.
  const going = Math.min(
    GOING.max,
    Math.max(GOING.min, GOING.comfort - (2 * input.rise) / stepCount),
  )
  const segment = createDefaultStairSegment({
    width,
    height: input.rise,
    length: stepCount * going,
    stepCount,
    attachmentSide: 'front',
    fillToFloor: true,
  })
  // "From the ground": a foot with no slab under it stands on the ground; a foot on a slab (a
  // patio) stands on it.
  const footOnSlab = queryNodes(nodes, { type: 'slab', parentId: level.id }).some(
    (slab) =>
      slab.type === 'slab' && !slab.recessed && pointInPolygon(input.x, input.z, slab.polygon),
  )
  const stair = StairNode.parse({
    name: `Steps ${count(nodes, 'stair') + 1}`,
    parentId: level.id,
    position: [input.x, 0, input.z],
    rotation: ((input.rotation ?? 0) * Math.PI) / 180,
    ...(footOnSlab ? {} : { supportSlabId: GROUND_SUPPORT_ID }),
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
    result: { ok: true, stairId: stair.id, stepCount, rise: input.rise, levelId: level.id },
    changes: {
      create: [
        { node: stair, parentId: level.id },
        { node: { ...segment, parentId: stair.id }, parentId: stair.id },
      ],
    },
  }
}
