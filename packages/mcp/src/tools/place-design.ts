import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DesignPlacementError, planDesignPlacement } from '@pascal-app/core/procedural-items'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { measurement } from './measurement'
import { assertPatchKeepsIdentity, PatchRefusedError } from './patch-guards'
import { NodeIdSchema, Vec3Schema } from './schemas'
import { validateDesignInput } from './validate-design'

export const placeDesignInput = {
  design: validateDesignInput.design,
  hostId: NodeIdSchema.describe(
    'Floor designs: a level, or a slab or zone on it, or a placed design with surfaceId. Wall-side designs: a straight wall. Ceiling designs: a ceiling.',
  ),
  position: Vec3Schema.describe(
    'Metres. Floor: level-local [x, y, z], y above the floor. Wall-side: [along, height, offset] of the mounting reference from the wall start. Ceiling: plan [x, 0, z] of the reference. Surface: [x, 0, z] in the surface frame.',
  ),
  rotation: measurement('angle', 'rad', {
    description: 'Yaw. Not for wall-side designs; use side to face the other way.',
  }).optional(),
  side: z.enum(['front', 'back']).optional().describe('Wall face for wall-side designs.'),
  surfaceId: z
    .string()
    .optional()
    .describe(
      'Named surface of the host design to rest on (see validate_design measurements.surfaces).',
    ),
  parameters: validateDesignInput.parameters,
  slots: z
    .record(z.string(), z.string())
    .optional()
    .describe('Slot id to "#rrggbb" or a scene:/library: material reference.'),
  name: z.string().optional(),
  id: z
    .string()
    .optional()
    .describe(
      'Optional new id ("procedural-item_…"). Refused if it exists: this tool only creates.',
    ),
}

export const placeDesignOutput = {
  designId: z.string(),
  parentId: z.string(),
  surfaceId: z.string().nullable(),
  ...liveSyncOutput,
}

export function registerPlaceDesign(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'place_design',
    {
      title: 'Place design',
      description:
        'Create one instance of a design (procedural item recipe, object or JSON string) in the scene. The design must pass validate_design. Its mounting picks the host: floor designs go on a level (or a slab or zone of it) or on a named surface of a placed design; wall-side designs on a straight wall face; ceiling designs under a ceiling. Only creates: refusals are tool errors whose JSON carries a code (invalid_design with diagnostics, design_too_large above 24 KiB, invalid_placement, node_exists, host_not_found, wrong_host, unknown_surface, does_not_fit, or an apply_patch guard code) and change nothing.',
      inputSchema: placeDesignInput,
      outputSchema: placeDesignOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async (args) => {
      const refuse = (refusal: Record<string, unknown>) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(refusal) }],
        isError: true as const,
      })
      let placement: ReturnType<typeof planDesignPlacement>
      try {
        placement = planDesignPlacement(bridge.getNodes(), {
          ...args,
          position: args.position as [number, number, number],
        })
      } catch (error) {
        if (!(error instanceof DesignPlacementError)) throw error
        return refuse({
          code: error.code,
          message: error.message,
          ...(error.diagnostics.length > 0 && { diagnostics: error.diagnostics.slice(0, 8) }),
        })
      }
      const { node, parentId, hostUpdate } = placement
      const patches: Patch[] = [
        { op: 'create', node: node as unknown as AnyNode, parentId: parentId as AnyNodeId },
        ...(hostUpdate
          ? [
              {
                op: 'update' as const,
                id: hostUpdate.id as AnyNodeId,
                data: { attachments: hostUpdate.attachments } as Partial<AnyNode>,
              },
            ]
          : []),
      ]
      // The same identity guards as apply_patch: an explicit id must be new.
      try {
        const planDeletion = (bridge as { planDeletion?: SceneOperations['planDeletion'] })
          .planDeletion
        assertPatchKeepsIdentity(
          patches,
          bridge.getNodes(),
          bridge.getRootNodeIds(),
          typeof planDeletion === 'function' ? planDeletion.bind(bridge) : undefined,
        )
      } catch (error) {
        if (!(error instanceof PatchRefusedError)) throw error
        return refuse({ code: error.code, id: error.nodeId, message: error.message })
      }
      bridge.applyPatch(patches)
      const persistence = await publishLiveSceneSnapshot(bridge, 'place_design')
      const payload = {
        designId: node.id,
        parentId,
        surfaceId: args.surfaceId ?? null,
        ...persistencePayload(persistence),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
