import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getCatalogMaterialById, parseMaterialRef, surfaceSlotsFor } from '@pascal-app/core'
import type { AnyNode, AnyNodeId, SceneMaterialId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch as BridgePatch } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import { ErrorCode, throwMcpError } from './errors'
import { publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema } from './schemas'

/**
 * Write a finish onto a node's paintable surface.
 *
 * Appearance is stored per node as `slots[slotId] = ref` — the same field the
 * editor's paint tool writes. An agent could already reach it through
 * `apply_patch`, but only by knowing both halves it has no way to learn: which
 * slot ids a kind exposes, and which material refs exist. This validates both
 * against the editor's own tables, so a wrong guess comes back as an error
 * naming the valid options rather than as a silent no-op.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Kinds whose surfaces come from their GLB rather than a static declaration. */
function hasDeclaredSlots(node: AnyNode): boolean {
  return surfaceSlotsFor(node).length > 0
}

function assertMaterialExists(material: string, bridge: SceneOperations): void {
  if (HEX_COLOR.test(material)) return

  const parsed = parseMaterialRef(material)
  if (!parsed) {
    throwMcpError(
      ErrorCode.InvalidParams,
      `Not a material: ${material}. Expected a catalog ref from list_materials ("library:<id>"), a scene material ref ("scene:mat_<id>"), or a "#rrggbb" colour.`,
    )
  }
  if (parsed.kind === 'library' && !getCatalogMaterialById(parsed.id)) {
    throwMcpError(
      ErrorCode.InvalidParams,
      `Unknown catalog material: ${material}. Call list_materials to get real refs.`,
    )
  }
  if (parsed.kind === 'scene' && !bridge.getSceneMaterials()[parsed.id as SceneMaterialId]) {
    throwMcpError(
      ErrorCode.InvalidParams,
      `This scene has no material ${material}. list_materials reports the scene's own palette under sceneMaterials.`,
    )
  }
}

export const paintSurfacesInput = {
  nodeIds: z.array(NodeIdSchema).min(1).describe('Nodes to paint. All get the same slot/material.'),
  slotId: z
    .string()
    .describe(
      'Which surface to paint, e.g. "interior" / "exterior" on a wall, "surface" / "side" on a slab, "panel" / "frame" / "glass" on a door. describe_node_type lists a kind\'s slots.',
    ),
  material: z
    .string()
    .describe('A ref from list_materials ("library:<id>"), "scene:mat_<id>", or "#rrggbb".'),
}

export const paintSurfacesOutput = {
  painted: z.array(z.string()).describe('Node ids whose slot now holds the material.'),
  skipped: z.array(z.object({ nodeId: z.string(), reason: z.string() })),
}

export function registerPaintSurfaces(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'paint_surfaces',
    {
      title: 'Paint surfaces',
      description:
        'Apply a material to a surface of one or more nodes — wall faces, floor slabs, ceilings, doors, windows, stairs, columns, fences, cabinets, shelves, elevators, ducts. Get material refs from list_materials and slot ids from describe_node_type. The whole call is one undo step. Nodes whose surfaces come from a GLB (items) accept any slot id; read their existing `slots` with get_node to see which ones they use.',
      inputSchema: paintSurfacesInput,
      outputSchema: paintSurfacesOutput,
    },
    async ({ nodeIds, slotId, material }) => {
      assertMaterialExists(material, bridge)

      const patches: BridgePatch[] = []
      const painted: string[] = []
      const skipped: Array<{ nodeId: string; reason: string }> = []

      for (const rawId of nodeIds) {
        const id = rawId as AnyNodeId
        const node = bridge.getNode(id)
        if (!node) {
          skipped.push({ nodeId: rawId, reason: 'not found' })
          continue
        }

        if (hasDeclaredSlots(node)) {
          const declared = surfaceSlotsFor(node)
          if (!declared.some((slot) => slot.slotId === slotId)) {
            skipped.push({
              nodeId: rawId,
              reason: `${node.type} has no "${slotId}" surface; it exposes ${declared
                .map((slot) => slot.slotId)
                .join(', ')}`,
            })
            continue
          }
        }

        const existing = (node as { slots?: Record<string, string> }).slots ?? {}
        patches.push({
          op: 'update',
          id,
          data: { slots: { ...existing, [slotId]: material } } as Partial<AnyNode>,
        })
        painted.push(rawId)
      }

      if (patches.length > 0) {
        try {
          bridge.applyPatch(patches)
        } catch (err) {
          throwMcpError(ErrorCode.InvalidParams, err instanceof Error ? err.message : String(err))
        }
        await publishLiveSceneSnapshot(bridge, 'paint_surfaces')
      }

      const payload = { painted, skipped }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
