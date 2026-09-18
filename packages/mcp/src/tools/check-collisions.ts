import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ItemNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { inspectItemPlanFootprint, resolveNodeLevelId } from './door-clearance'
import { ErrorCode, throwMcpError } from './errors'
import { findItemItemCollisions } from './layout-clearance'
import { measurement } from './measurement'
import { computeGraphHash } from './scene-lifecycle/metadata'
import { NodeIdSchema } from './schemas'

const candidatePosition = measurement('length', 'm', {
  description: 'Candidate position coordinate.',
})
const candidateDimension = measurement('length', 'm', {
  positive: true,
  description: 'Candidate declared size.',
})
const vector3 = (component: ReturnType<typeof measurement>) =>
  z
    .array(component)
    .length(3)
    .transform((values, ctx): [number, number, number] => {
      const [x, y, zValue] = values
      if (x === undefined || y === undefined || zValue === undefined) {
        ctx.addIssue({ code: 'custom', message: 'Expected exactly three values.' })
        return z.NEVER
      }
      return [x, y, zValue]
    })
const outputVector3 = z.array(z.number()).length(3)

export const checkCollisionsInput = {
  levelId: NodeIdSchema.optional(),
  minimumClearance: measurement('length', 'm', {
    min: 0,
    description: 'Minimum free plan-space required between item footprints.',
  }).default(0),
  floorOnly: z
    .boolean()
    .default(false)
    .describe('When true, wall-, wall-side-, and ceiling-attached items are excluded.'),
  candidate: z
    .object({
      id: z.string().min(1).max(120).default('candidate'),
      name: z.string().min(1).max(200).default('Candidate item'),
      levelId: NodeIdSchema,
      position: vector3(candidatePosition),
      dimensions: vector3(candidateDimension),
      rotationY: measurement('angle', 'rad', {
        description: 'Candidate yaw around the vertical axis.',
      }).default(0),
      source: z
        .object({
          assetId: z.string().min(1).optional(),
          uri: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional()
    .describe(
      'Read-only prospective furniture item. It is checked against the target level but never added to the scene.',
    ),
}

export const checkCollisionsOutput = {
  status: z.enum(['checked', 'partial', 'insufficient_evidence']),
  units: z.literal('meters'),
  method: z.literal('rotation-aware-plan-aabb'),
  assessmentGraphHash: z.string(),
  minimumClearanceMeters: z.number(),
  floorOnly: z.boolean(),
  candidateItemId: z.string().nullable(),
  checkedItems: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      levelId: z.string().nullable(),
      positionMeters: outputVector3,
      rotationYRadians: z.number(),
      source: z.object({
        assetId: z.string(),
        uri: z.string(),
        catalog: z.string(),
      }),
      sourceDimensionsMeters: outputVector3,
      effectiveDimensionsMeters: outputVector3,
      footprintBoundsMeters: z.object({
        minX: z.number(),
        maxX: z.number(),
        minZ: z.number(),
        maxZ: z.number(),
      }),
    }),
  ),
  skippedItems: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      reason: z.string(),
    }),
  ),
  unsupportedChecks: z.array(
    z.object({
      check: z.string(),
      reason: z.string(),
    }),
  ),
  collisions: z.array(
    z.object({
      aId: z.string(),
      bId: z.string(),
      kind: z.string(),
      violation: z.enum(['overlap', 'clearance']),
      minimumClearanceMeters: z.number(),
    }),
  ),
}

const unsupportedChecks = [
  {
    check: 'vertical_clearance',
    reason: 'This check uses the X/Z plan footprint only and does not prove height clearance.',
  },
  {
    check: 'room_boundary_clearance',
    reason: 'The tool compares items with other items and does not prove containment in a room.',
  },
  {
    check: 'door_swing_envelope',
    reason: 'Door swing geometry is not evaluated by check_collisions.',
  },
  {
    check: 'delivery_path',
    reason: 'No route, turning-radius, stair, or opening traversal is evaluated.',
  },
  {
    check: 'mesh_geometry',
    reason: 'Asset meshes are not loaded; the check uses declared rectangular dimensions.',
  },
  {
    check: 'hosted_item_world_transform',
    reason: 'Items positioned in a non-level parent frame are skipped instead of approximated.',
  },
] as const

export function registerCheckCollisions(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'check_collisions',
    {
      title: 'Check collisions',
      description:
        'Assess declared item footprints with a rotation-aware plan AABB test. Supports an explicit minimum clearance and reports units, source dimensions, skipped evidence, and unsupported checks. Optionally scope to one level or floor-standing items.',
      inputSchema: checkCollisionsInput,
      outputSchema: checkCollisionsOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ levelId, minimumClearance, floorOnly, candidate }) => {
      const sceneNodes = Object.values(bridge.getNodes())
      if (candidate && levelId && candidate.levelId !== levelId) {
        throwMcpError(
          ErrorCode.InvalidParams,
          'candidate.levelId must match levelId when both are provided',
        )
      }
      const scopeLevelId = candidate?.levelId ?? levelId
      if (scopeLevelId) {
        const target = sceneNodes.find((node) => node.id === scopeLevelId)
        if (target?.type !== 'level') {
          throwMcpError(ErrorCode.InvalidParams, `Level not found: ${scopeLevelId}`)
        }
      }
      if (candidate) {
        if (sceneNodes.some((node) => node.id === candidate.id)) {
          throwMcpError(ErrorCode.InvalidParams, `Candidate id already exists: ${candidate.id}`)
        }
      }

      const candidateNode = candidate
        ? ItemNode.parse({
            object: 'node',
            type: 'item',
            parentId: candidate.levelId,
            visible: true,
            metadata: {},
            name: candidate.name,
            position: candidate.position,
            rotation: [0, candidate.rotationY, 0],
            scale: [1, 1, 1],
            children: [],
            asset: {
              id: candidate.source?.assetId ?? 'supplied-dimensions',
              name: candidate.name,
              category: 'furniture',
              thumbnail: '',
              source: 'library',
              src: 'asset://supplied-dimensions',
              dimensions: candidate.dimensions,
              offset: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          })
        : null
      const nodes = candidateNode ? [...sceneNodes, candidateNode] : sceneNodes
      const byId = new Map<string, (typeof nodes)[number]>(
        nodes.map((node) => [node.id, node] as const),
      )
      const scoped = nodes.filter((node) => {
        if (node.type !== 'item' || !scopeLevelId) return true
        return resolveNodeLevelId(node.id, byId) === scopeLevelId
      })
      const checkedItems: Array<{
        id: string
        name: string
        levelId: string | null
        positionMeters: [number, number, number]
        rotationYRadians: number
        source: { assetId: string; uri: string; catalog: string }
        sourceDimensionsMeters: [number, number, number]
        effectiveDimensionsMeters: [number, number, number]
        footprintBoundsMeters: { minX: number; maxX: number; minZ: number; maxZ: number }
      }> = []
      const skippedItems: Array<{ id: string; name: string; reason: string }> = []

      for (const node of scoped) {
        if (node.type !== 'item') continue
        const resolvedLevelId =
          node === candidateNode ? candidate!.levelId : bridge.resolveLevelId(node.id)
        if (!resolvedLevelId) {
          skippedItems.push({
            id: node.id,
            name: node.name ?? node.asset.name ?? node.id,
            reason: 'unresolved_level',
          })
          continue
        }
        const immediateParent =
          node === candidateNode ? byId.get(candidate!.levelId) : bridge.getAncestry(node.id)[1]
        if (immediateParent && immediateParent.type !== 'level') {
          skippedItems.push({
            id: node.id,
            name: node.name ?? node.asset.name ?? node.id,
            reason: floorOnly ? 'unsupported_attachment' : 'parent_local_coordinates',
          })
          continue
        }
        const inspected = inspectItemPlanFootprint(node, { floorOnly })
        const name = node.name ?? node.asset.name ?? node.id
        if (!inspected.ok) {
          skippedItems.push({ id: node.id, name, reason: inspected.reason })
          continue
        }
        checkedItems.push({
          id: node === candidateNode ? candidate!.id : node.id,
          name,
          levelId: resolvedLevelId,
          positionMeters: node.position,
          rotationYRadians: inspected.rotationY,
          source: {
            assetId:
              node === candidateNode
                ? (candidate!.source?.assetId ?? 'supplied-dimensions')
                : node.asset.id,
            uri:
              node === candidateNode
                ? (candidate!.source?.uri ?? 'supplied://dimensions')
                : node.asset.src,
            catalog: node === candidateNode ? 'supplied' : (node.asset.source ?? 'unknown'),
          },
          sourceDimensionsMeters: inspected.sourceDimensions,
          effectiveDimensionsMeters: inspected.effectiveDimensions,
          footprintBoundsMeters: inspected.aabb,
        })
      }

      const checkedItemIds = new Set(
        checkedItems.map((item) => (item.id === candidate?.id ? candidateNode!.id : item.id)),
      )
      const found = findItemItemCollisions({
        nodes: scoped.filter((node) => (node.type === 'item' ? checkedItemIds.has(node.id) : true)),
        gap: minimumClearance,
      })
      const collisions = found.map((c) => ({
        aId: c.aId === candidateNode?.id ? candidate!.id : c.aId,
        bId: c.bId === candidateNode?.id ? candidate!.id : c.bId,
        kind: c.kind,
        violation: c.violation,
        minimumClearanceMeters: c.minimumClearanceMeters,
      }))

      const payload = {
        status:
          checkedItems.length === 0 && skippedItems.length > 0
            ? ('insufficient_evidence' as const)
            : skippedItems.length > 0
              ? ('partial' as const)
              : ('checked' as const),
        units: 'meters' as const,
        method: 'rotation-aware-plan-aabb' as const,
        assessmentGraphHash: computeGraphHash(bridge.exportJSON()),
        minimumClearanceMeters: minimumClearance,
        floorOnly,
        candidateItemId: candidate?.id ?? null,
        checkedItems,
        skippedItems,
        unsupportedChecks: [...unsupportedChecks],
        collisions,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
