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
import { rockFormV2 } from './rock-form-v2'
import { ROCK_EMBED, type RockSpan } from './rock-ground'
import { rockInputProblem } from './rock-outline'
import { ROCK_RINGS, rockCentre, rockRings } from './rock-shape'

/** Generator 1 uses exactly the original rings, fans, ordering and Float32 conversion. */
const rockFormV1: RockForm = {
  gen: 1,
  estimate(input) {
    const centre = rockCentre(input.polygon)
    const angles = [
      ...input.polygon.map(([x, z]) => Math.atan2(z - centre[1], x - centre[0])),
      ...Array.from({ length: 32 }, (_, i) => (i / 32) * 2 * Math.PI - Math.PI),
    ].sort((a, b) => a - b)
    const samples = angles.filter((a, i) => i === 0 || a - angles[i - 1]! > 1e-9).length
    const near = {
      triangles: 2 * (ROCK_RINGS + 1) * samples,
      vertices: (ROCK_RINGS + 1) * samples + 2,
    }
    return { near, far: { triangles: 0, vertices: 0 }, ...near, meshes: 1 }
  },
  build(input, level) {
    if (level === 'far') return null
    const rings = rockRings(input)
    const samples = rings[0]!.length
    const positions: number[] = []
    rings.forEach((ring, i) => {
      const y = input.footY + ((input.topY - input.footY) * i) / ROCK_RINGS
      for (const [x, z] of ring) positions.push(x, y, z)
    })
    for (const [ring, y] of [
      [rings[0]!, input.footY],
      [rings.at(-1)!, input.topY],
    ] as const) {
      const sum = ring.reduce<[number, number]>(
        (total, [x, z]) => [total[0] + x, total[1] + z],
        [0, 0],
      )
      positions.push(sum[0] / ring.length, y, sum[1] / ring.length)
    }
    const indices: number[] = []
    for (let ring = 0; ring < ROCK_RINGS; ring++)
      for (let i = 0; i < samples; i++) {
        const a = ring * samples + i
        const b = ring * samples + ((i + 1) % samples)
        indices.push(a, a + samples, b, b, a + samples, b + samples)
      }
    const foot = (ROCK_RINGS + 1) * samples
    for (let i = 0; i < samples; i++) {
      indices.push(foot, i, (i + 1) % samples)
      indices.push(foot + 1, ROCK_RINGS * samples + ((i + 1) % samples), ROCK_RINGS * samples + i)
    }
    return { position: new Float32Array(positions), index: new Uint16Array(indices) }
  },
}

const forms: ReadonlyMap<number, RockForm> = new Map([
  [1, rockFormV1],
  [2, rockFormV2],
])

export function rockCurrentGen(): 1 | 2 {
  return 2
}

/** An unsupported stored generator must never silently become another rock. */
export function rockFormFor(gen: number): RockForm {
  const form = forms.get(gen)
  if (!form) throw new Error(`Unsupported rock generator ${gen}.`)
  return form
}

export type RockPlan = {
  gen: 1 | 2
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
  const form = rockFormFor(node.gen ?? 1)
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
    : form.estimate(input)
  return {
    gen: form.gen,
    input,
    form,
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
