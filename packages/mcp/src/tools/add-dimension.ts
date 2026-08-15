import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import {
  ConstructionDimensionNode,
  constructionDimensionRequiredAnchorCount,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ErrorCode, throwMcpError } from './errors'
import { publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema, Vec2Schema } from './schemas'

/**
 * Put a dimension string on the floor plan.
 *
 * `measure` answers "how far" as a number; nothing left an annotation behind,
 * so an agent could survey a plan but not deliver a dimensioned one. The kind
 * was reachable through `apply_patch`, but two things stood between the schema
 * and a usable dimension. The `baseline` is an independently placed line the
 * witness origins project onto — get its direction or offset wrong and the
 * dimension lands on top of what it measures. And an anchor may either be a
 * free point or a reference to a node feature; only the second kind follows the
 * wall when the wall moves, which is the whole point of an associative
 * dimension and is invisible from the field list.
 *
 * So this derives the baseline from the run being measured, and anchors to
 * `wall:start` / `wall:end` whenever it is given walls rather than points.
 */

/** Below this the run has no direction to speak of. Matches the editor's drafting tool. */
const MIN_RUN_LENGTH = 0.001

/** Metres between the measured run and the dimension line. The schema's own default. */
const DEFAULT_OFFSET = 0.6

type PlanPoint = [number, number, number]

/** A witness point plus, when it came from a wall, the feature it should follow. */
type Witness = { point: PlanPoint; anchor: unknown }

function wallWitnesses(wall: AnyNode & { start: number[]; end: number[] }): Witness[] {
  const at = (xz: number[], featureId: string): Witness => {
    const point: PlanPoint = [xz[0] as number, 0, xz[1] as number]
    return {
      point,
      anchor: { kind: 'feature', reference: { nodeId: wall.id, featureId }, fallback: point },
    }
  }
  return [at(wall.start, 'wall:start'), at(wall.end, 'wall:end')]
}

/** Drop a witness that repeats the previous one — connected walls share a corner. */
function dedupeConsecutive(witnesses: Witness[]): Witness[] {
  return witnesses.filter((witness, index) => {
    if (index === 0) return true
    const previous = witnesses[index - 1]!.point
    return (
      Math.hypot(witness.point[0] - previous[0], witness.point[2] - previous[2]) > MIN_RUN_LENGTH
    )
  })
}

export const addDimensionInput = {
  levelId: NodeIdSchema.describe('Level the dimension belongs to.'),
  wallIds: z
    .array(NodeIdSchema)
    .min(1)
    .optional()
    .describe(
      "Walls to dimension, in order along the run. Anchors bind to each wall's endpoints, so the dimension follows the wall when it is moved. Shared corners are collapsed, so a chain of walls gives one continuous string.",
    ),
  points: z
    .array(Vec2Schema)
    .min(2)
    .optional()
    .describe('Plan points to dimension instead of walls. These do not follow anything.'),
  offset: z
    .number()
    .optional()
    .describe(
      `Metres from the measured run to the dimension line (default ${DEFAULT_OFFSET}). Negative puts it on the other side.`,
    ),
  // `.unwrap()` strips the node schema's own default before making the field
  // optional: `.default(x).optional()` still resolves `undefined` to `x`, which
  // would make an omitted argument indistinguishable from an explicit one and
  // silently beat the rules below.
  mode: ConstructionDimensionNode.shape.mode.unwrap().optional(),
  chainMode: ConstructionDimensionNode.shape.chainMode
    .unwrap()
    .optional()
    .describe('Defaults to continuous for more than two anchors, point-to-point otherwise.'),
  drawingType: ConstructionDimensionNode.shape.drawingType.unwrap().optional(),
  prefix: z.string().max(40).optional(),
  suffix: z.string().max(40).optional(),
  textOverride: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Replaces the measured text. The geometry is unchanged.'),
}

export const addDimensionOutput = {
  dimensionId: z.string(),
  anchorCount: z.number(),
  spanMeters: z.number().describe('Length of the run along the dimension line.'),
}

export function registerAddDimension(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'add_dimension',
    {
      title: 'Add dimension',
      description:
        'Place a construction dimension on the floor plan — the annotation a drawing is delivered with, not a one-off reading (that is `measure`). Give it walls and the dimension binds to their endpoints and follows them when they move; give it points for a free dimension. The dimension line is offset from the run automatically. A chain of connected walls becomes one continuous dimension string.',
      inputSchema: addDimensionInput,
      outputSchema: addDimensionOutput,
    },
    async ({
      levelId,
      wallIds,
      points,
      offset,
      mode,
      chainMode,
      drawingType,
      prefix,
      suffix,
      textOverride,
    }) => {
      if ((wallIds && points) || (!wallIds && !points)) {
        throwMcpError(ErrorCode.InvalidParams, 'Give either wallIds or points, not both.')
      }

      const level = bridge.getNode(levelId as AnyNodeId)
      if (!level) throwMcpError(ErrorCode.InvalidParams, `Level not found: ${levelId}`)
      if (level.type !== 'level') {
        throwMcpError(ErrorCode.InvalidParams, `Node ${levelId} is a ${level.type}, expected level`)
      }

      let witnesses: Witness[] = []
      if (wallIds) {
        for (const wallId of wallIds) {
          const wall = bridge.getNode(wallId as AnyNodeId)
          if (!wall) throwMcpError(ErrorCode.InvalidParams, `Wall not found: ${wallId}`)
          if (wall.type !== 'wall') {
            throwMcpError(
              ErrorCode.InvalidParams,
              `Node ${wallId} is a ${wall.type}, expected wall. Use points for anything else.`,
            )
          }
          witnesses.push(...wallWitnesses(wall as never))
        }
        witnesses = dedupeConsecutive(witnesses)
      } else {
        witnesses = (points as Array<[number, number]>).map((xz) => {
          const point: PlanPoint = [xz[0], 0, xz[1]]
          return { point, anchor: point }
        })
      }

      const required = constructionDimensionRequiredAnchorCount(mode ?? 'linear')
      if (witnesses.length < required) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `A ${mode ?? 'linear'} dimension needs at least ${required} anchors; got ${witnesses.length}.`,
        )
      }

      // The baseline direction comes from the first witness pair, the way the
      // editor's drafting tool derives it, so a dimension made here reads the
      // same as one drawn by hand.
      const [first, second] = [witnesses[0]!.point, witnesses[1]!.point]
      const dx = second[0] - first[0]
      const dz = second[2] - first[2]
      const magnitude = Math.hypot(dx, dz)
      if (magnitude <= MIN_RUN_LENGTH) {
        throwMcpError(
          ErrorCode.InvalidParams,
          'The first two anchors are in the same place, so the dimension has no direction.',
        )
      }
      const direction: [number, number] = [dx / magnitude, dz / magnitude]
      const normal: [number, number] = [-direction[1], direction[0]]
      const distance = offset ?? DEFAULT_OFFSET
      const origin: [number, number] = [
        first[0] + normal[0] * distance,
        first[2] + normal[1] * distance,
      ]

      // How far the run reaches along the dimension line — what the label reads
      // for a point-to-point dimension, and the full string for a continuous one.
      const projections = witnesses.map(
        (witness) => witness.point[0] * direction[0] + witness.point[2] * direction[1],
      )
      const spanMeters = Math.max(...projections) - Math.min(...projections)

      const parsed = ConstructionDimensionNode.safeParse({
        anchors: witnesses.map((witness) => witness.anchor),
        baseline: { origin, direction },
        chainMode: chainMode ?? (witnesses.length > 2 ? 'continuous' : 'point-to-point'),
        ...(mode ? { mode } : {}),
        ...(drawingType ? { drawingType } : {}),
        ...(prefix ? { prefix } : {}),
        ...(suffix ? { suffix } : {}),
        ...(textOverride ? { textOverride } : {}),
      })
      if (!parsed.success) {
        throwMcpError(ErrorCode.InvalidParams, parsed.error.issues.map((i) => i.message).join('; '))
      }

      const id = bridge.createNode(parsed.data as AnyNode, levelId as AnyNodeId)
      await publishLiveSceneSnapshot(bridge, 'add_dimension')

      const payload = {
        dimensionId: id as string,
        anchorCount: witnesses.length,
        spanMeters: Number(spanMeters.toFixed(4)),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
