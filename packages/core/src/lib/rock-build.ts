import type { RockNode } from '../schema'
import {
  ROCK_MAX_FAR_TRIANGLES,
  ROCK_MAX_NEAR_TRIANGLES,
  ROCK_MAX_TRIANGLES,
  type RockEstimate,
  type RockForm,
  type RockFormInput,
  type RockMesh,
} from './rock-form'
import { rockForm } from './rock-form-builder'
import { ROCK_EMBED, type RockSpan } from './rock-ground'
import { rockInputProblem } from './rock-outline'

export type RockPlan = {
  gen: 1
  input: RockFormInput
  form: RockForm
  estimate: RockEstimate
  withinBudget: boolean
  problem: string | null
}

/** Validate and count before any field evaluation or mesh allocation. Ground sampling is the caller's job. */
export function planRock(
  node: RockNode,
  span: RockSpan = { footY: -ROCK_EMBED, topY: node.height },
): RockPlan {
  const input: RockFormInput = { ...node, ...span }
  const problem = rockInputProblem(input)
  const estimate = problem
    ? {
        near: { triangles: 0, vertices: 0 },
        far: { triangles: 0, vertices: 0 },
        triangles: 0,
        vertices: 0,
        meshes: 0,
      }
    : rockForm.estimate(input)
  return {
    gen: rockForm.gen,
    input,
    form: rockForm,
    estimate,
    problem,
    withinBudget:
      !problem &&
      estimate.near.triangles <= ROCK_MAX_NEAR_TRIANGLES &&
      estimate.far.triangles <= ROCK_MAX_FAR_TRIANGLES &&
      estimate.triangles <= ROCK_MAX_TRIANGLES,
  }
}

export function buildRock(
  node: RockNode,
  span?: RockSpan,
): { plan: RockPlan; near: RockMesh | null; far: RockMesh | null } {
  const plan = planRock(node, span)
  return {
    plan,
    near: plan.withinBudget ? plan.form.build(plan.input, 'near') : null,
    far: plan.withinBudget ? plan.form.build(plan.input, 'far') : null,
  }
}
