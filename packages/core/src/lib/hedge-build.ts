import type { HedgeNode } from '../schema'
import type { GroundRead } from './ground-read'
import {
  HEDGE_MAX_TRIANGLES,
  type HedgeEstimate,
  type HedgeForm,
  type HedgeFormInput,
  type HedgeMesh,
} from './hedge-form'
import { hedgeFormV1 } from './hedge-form-v1'
import { hedgeFormV2 } from './hedge-form-v2'
import { type HedgeFootRun, standHedgeLine } from './hedge-ground'
import { type HedgeLine, hedgeLine } from './hedge-line'

const forms = new Map<number, HedgeForm>([
  [hedgeFormV1.gen, hedgeFormV1],
  [hedgeFormV2.gen, hedgeFormV2],
])

let currentGen = hedgeFormV2.gen

/** The generator a hedge added now is drawn by. A stored hedge keeps the one it names. */
export function hedgeCurrentGen(): number {
  return currentGen
}

/**
 * Adds a generator under its `gen`, and draws new hedges with it when it is the newest. A `gen`
 * already taken is refused: a stored garden's form does not change under it.
 */
export function registerHedgeForm(form: HedgeForm): void {
  if (forms.has(form.gen)) throw new Error(`Hedge generator ${form.gen} is already registered.`)
  forms.set(form.gen, form)
  currentGen = Math.max(currentGen, form.gen)
}

/** The form a `gen` names; the newest one for a `gen` this build does not know. */
export function hedgeFormFor(gen: number): HedgeForm {
  return forms.get(gen) ?? (forms.get(currentGen) as HedgeForm)
}

export type HedgePlan = {
  line: HedgeLine
  runs: HedgeFootRun[]
  input: HedgeFormInput
  form: HedgeForm
  estimate: HedgeEstimate
  /** False when the form's own estimate is over the cap: nothing is built. */
  withinBudget: boolean
}

/**
 * What a hedge would be built as, on a ground: its line, its runs standing on that ground, and
 * the form's count of what it would emit. Allocates only the stations (bounded by
 * `HEDGE_MAX_STATIONS`); no mesh.
 */
export function planHedge(node: HedgeNode, ground: GroundRead): HedgePlan {
  const line = hedgeLine(node)
  const runs = standHedgeLine(line, node.width, ground)
  const input: HedgeFormInput = {
    height: node.height,
    width: node.width,
    clip: node.clip,
    leafSize: node.leafSize,
    leafColor: node.leafColor,
    seed: node.seed,
    runs,
    endRadius: line.endRadius,
  }
  const form = hedgeFormFor(node.gen)
  const estimate = form.estimate(input)
  return {
    line,
    runs,
    input,
    form,
    estimate,
    withinBudget: estimate.triangles <= HEDGE_MAX_TRIANGLES,
  }
}

/** The hedge's meshes on a ground, in its Site's frame; none when its plan is over the cap. */
export function buildHedge(
  node: HedgeNode,
  ground: GroundRead,
): { plan: HedgePlan; meshes: HedgeMesh[] } {
  const plan = planHedge(node, ground)
  return { plan, meshes: plan.withinBudget ? plan.form.build(plan.input) : [] }
}
