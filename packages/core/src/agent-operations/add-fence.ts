import { refuse } from '../agent-tools/refusal'
import { FenceNode } from '../schema'
import { type LevelTargetInput, targetLevel } from './level-target'
import { finishSurface, requireMaterialRef } from './material-refs'
import { refuseRoofLevel } from './roof-writes'
import type { AgentOperation } from './types'

type Pt = [number, number]

/** A fence side shorter than this is a slip, not a fence. */
const FENCE_MIN_SIDE = 0.1

type AddFenceInput = LevelTargetInput & {
  points: number[][]
  closed?: boolean
  height?: number
  style?: FenceNode['style']
  baseStyle?: FenceNode['baseStyle']
  materialPreset?: string
}

const round = (value: number) => Math.round(value * 100) / 100

/**
 * `add_fence`: one fence per side along the points, privacy unless asked (one made with no style
 * came out as open rails). Fences stand on the level, as the editor's fence tool puts them.
 */
export const addFence: AgentOperation<AddFenceInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  refuseRoofLevel(nodes, level.id, 'a fence')
  const materialPreset =
    input.materialPreset === undefined
      ? undefined
      : requireMaterialRef(input.materialPreset, 'materialPreset', finishSurface('fence'))
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
  const first = Object.values(nodes).filter((node) => node.type === 'fence').length
  const fences = sides.map(([start, end], i) =>
    FenceNode.parse({
      name: `Fence ${first + i + 1}`,
      parentId: level.id,
      start,
      end,
      style: input.style ?? 'privacy',
      ...(input.height === undefined ? {} : { height: input.height }),
      ...(input.baseStyle === undefined ? {} : { baseStyle: input.baseStyle }),
      ...(materialPreset === undefined ? {} : { materialPreset }),
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
