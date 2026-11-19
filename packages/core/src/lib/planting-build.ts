import { PlantingNode } from '../schema/nodes/planting'
import type { GroundRead } from './ground-read'
import {
  PLANTING_MAX_TRIANGLES,
  type PlantingEstimate,
  type PlantingForm,
  type PlantingFormInput,
  type PlantingMesh,
} from './planting-form'
import { plantingFormV1 } from './planting-form-v1'
import { plantingGroundGeometry } from './planting-ground'
import {
  type PlantingPoint,
  plantingArea,
  plantingAreaOutline,
  plantingOrganicOutline,
} from './planting-outline'
import { type PlantingAccept, type PlantingPlacement, scatterPlanting } from './planting-scatter'

const forms = new Map<number, PlantingForm>([[plantingFormV1.gen, plantingFormV1]])
let currentGen = plantingFormV1.gen

export function plantingCurrentGen(): number {
  return currentGen
}

/** A stored version is immutable; registration cannot replace an existing garden's form. */
export function registerPlantingForm(form: PlantingForm): void {
  if (forms.has(form.gen)) throw new Error(`Planting generator ${form.gen} is already registered.`)
  forms.set(form.gen, form)
  currentGen = Math.max(currentGen, form.gen)
}

export function plantingFormFor(gen: number): PlantingForm {
  return forms.get(gen) ?? (forms.get(currentGen) as PlantingForm)
}

export type PlantingPlan = {
  outline: PlantingPoint[]
  placements: PlantingPlacement[]
  area: number
  /** Nominal projected crown area / bed area, capped at one; not a union of overlapping leaves. */
  cover: number
  groundTriangles: number
  estimate: PlantingEstimate
  withinBudget: boolean
  gen: number
  input: PlantingFormInput
  form: PlantingForm
}

/** Validate before computation; plan bounded outline/placements, never mesh attribute buffers. */
export function planPlanting(
  node: PlantingNode,
  ground: GroundRead,
  accept?: PlantingAccept,
): PlantingPlan {
  const parsed = PlantingNode.parse(node)
  const outline = plantingOrganicOutline(
    parsed.outline ?? plantingAreaOutline(parsed.area as number, parsed.center),
    parsed.seed,
  )
  const area = Math.abs(plantingArea(outline))
  const placements = scatterPlanting(parsed, outline, ground, accept)
  const groundTriangles = plantingGroundGeometry(parsed, outline, ground)
  const input: PlantingFormInput = { node: parsed, outline, placements, ground, groundTriangles }
  const form = plantingFormFor(parsed.gen)
  const estimate = form.estimate(input)
  let crownArea = 0
  for (const placement of placements) {
    const spread = parsed.plants[placement.species]?.spread ?? 0
    crownArea += Math.PI * ((spread * placement.scale) / 2) ** 2
  }
  return {
    outline,
    placements,
    area,
    cover: Math.min(1, crownArea / area),
    groundTriangles,
    input,
    form,
    estimate,
    withinBudget: estimate.triangles <= PLANTING_MAX_TRIANGLES,
    gen: form.gen,
  }
}

/** New arrays owned by the caller, with body-only far levels in each mesh's index prefix. */
export function buildPlanting(
  node: PlantingNode,
  ground: GroundRead,
  accept?: PlantingAccept,
): { plan: PlantingPlan; meshes: PlantingMesh[] } {
  const plan = planPlanting(node, ground, accept)
  return { plan, meshes: plan.withinBudget ? plan.form.build(plan.input) : [] }
}
