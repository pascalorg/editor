import type { McpServer } from '@modelcontextprotocol/server'
import { createZone, generateId } from '@pascal-app/core'
import { roofLevelRefusal, unknownMaterialPresetRefusal } from '@pascal-app/core/agent-operations'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { measurement } from './measurement'
import { NodeIdSchema, Vec2Schema } from './schemas'

export const createStoryShellInput = {
  levelId: NodeIdSchema,
  footprint: z.array(Vec2Schema).min(3),
  wallHeight: measurement('length', 'm', {
    positive: true,
    description: 'Explicit wall height override. Omit for level-plane-bound walls.',
  }).optional(),
  wallThickness: measurement('length', 'm', {
    positive: true,
    description: 'Wall thickness.',
  }).default(0.16),
  createSlab: z
    .boolean()
    .default(true)
    .describe('Floor intent for the rooms inside the shell. False records hasFloor: false.'),
  createCeiling: z
    .boolean()
    .default(true)
    .describe('Ceiling intent for the rooms inside the shell. False records hasCeiling: false.'),
  slabElevation: measurement('length', 'm', {
    description: "Walking surface of the derived plate, stored as the room's floor elevation.",
  }).default(0.1),
  ceilingHeight: measurement('length', 'm', {
    positive: true,
    description: 'Ceiling height.',
  }).optional(),
  namePrefix: z.string().optional(),
  wallMaterialPreset: z.string().optional(),
  slabMaterialPreset: z.string().optional(),
  ceilingMaterialPreset: z.string().optional(),
}

export const createStoryShellOutput = {
  levelId: z.string(),
  wallIds: z.array(z.string()),
  /** Zones the reconciler derived for the enclosed faces. */
  zoneIds: z.array(z.string()),
  /** Derived floor plate. `null` when floors were declined or nothing reconciled. */
  slabId: z.string().nullable(),
  /** Derived ceiling. `null` when ceilings were declined or nothing reconciled. */
  ceilingId: z.string().nullable(),
  createdIds: z.array(z.string()),
  ...liveSyncOutput,
}

function textResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

function assertNode(bridge: SceneOperations, id: string, type: AnyNode['type']): AnyNode {
  const node = bridge.getNode(id as AnyNodeId)
  if (!node) throw new Error(`${type} not found: ${id}`)
  if (node.type !== type) throw new Error(`Node ${id} is a ${node.type}, expected ${type}`)
  return node
}

/** Room zones that appeared on the level while this tool call ran. */
function newRoomZoneIds(bridge: SceneOperations, levelId: string, before: ReadonlySet<string>) {
  return Object.values(bridge.getNodes())
    .filter(
      (node) =>
        node.type === 'zone' &&
        node.parentId === levelId &&
        node.spaceRole === 'room' &&
        !before.has(node.id),
    )
    .map((node) => node.id)
    .sort()
}

function derivedShellSurfaces(bridge: SceneOperations, levelId: string, zoneIds: string[]) {
  const children = Object.values(bridge.getNodes()).filter((node) => node.parentId === levelId)
  const plate = children
    .filter((node) => node.type === 'slab')
    .sort((a, b) => Number(a.plateRole === 'base') - Number(b.plateRole === 'base'))
    .find(
      (node) =>
        node.type === 'slab' &&
        node.boundary === 'auto' &&
        (node.zoneIds ?? []).some((id) => zoneIds.includes(id)),
    )
  const ceiling = children.find(
    (node) =>
      node.type === 'ceiling' && node.boundary === 'auto' && zoneIds.includes(node.zoneId ?? ''),
  )
  return { slabId: plate?.id ?? null, ceilingId: ceiling?.id ?? null }
}

export function registerConstructionTools(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'create_story_shell',
    {
      title: 'Create story shell',
      description:
        'Create one level-owned building shell from a footprint: the perimeter walls. The floor plate and the ceiling are DERIVED from the rooms the walls enclose — never author a slab or a ceiling here, and never pass boundary/autoFromWalls; createSlab / createCeiling / slabElevation are recorded as room intent instead. Use once per story; do not make first-floor walls span multiple stories.',
      inputSchema: z.object(createStoryShellInput),
      outputSchema: z.object(createStoryShellOutput),
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({
      levelId,
      footprint,
      wallHeight,
      wallThickness,
      createSlab,
      createCeiling,
      slabElevation,
      ceilingHeight,
      namePrefix,
      wallMaterialPreset,
      slabMaterialPreset,
      ceilingMaterialPreset,
    }) => {
      const preset = unknownMaterialPresetRefusal({
        wallMaterialPreset,
        slabMaterialPreset,
        ceilingMaterialPreset,
      })
      if (preset) throw new Error(preset)
      assertNode(bridge, levelId, 'level')
      const onRoofLevel = roofLevelRefusal(bridge.getNodes(), levelId, 'a story shell')
      if (onRoofLevel) return refusalResult(onRoofLevel)
      const points = footprint as [number, number][]
      const before = new Set(Object.keys(bridge.getNodes()))
      const plan = createZone(bridge.getNodes(), {
        levelId,
        polygon: points,
        name: namePrefix ?? 'Room',
        enclose: true,
        mintId: generateId,
        wall: {
          thickness: wallThickness,
          ...(wallHeight !== undefined ? { height: wallHeight } : {}),
        },
        intent: {
          floor: { elevation: slabElevation },
          hasFloor: createSlab,
          hasCeiling: createCeiling,
        },
      })
      const wallIds = plan.changes.flatMap((change) =>
        change.op === 'create' && change.node.type === 'wall' ? [change.node.id] : [],
      )
      bridge.runAsSingleHistoryStep(() => {
        bridge.applyPatch(
          plan.changes.map((change) =>
            change.op === 'create'
              ? {
                  ...change,
                  parentId: change.node.parentId as AnyNodeId,
                  node:
                    change.node.type === 'wall'
                      ? {
                          ...change.node,
                          ...(namePrefix
                            ? { name: `${namePrefix} Wall ${wallIds.indexOf(change.node.id) + 1}` }
                            : {}),
                          ...(wallMaterialPreset ? { materialPreset: wallMaterialPreset } : {}),
                          metadata: { role: 'exterior', storyShell: true },
                        }
                      : change.node,
                }
              : change,
          ),
        )
        bridge.deriveStructure([levelId as AnyNodeId])
      })
      const zoneIds = newRoomZoneIds(bridge, levelId, before)

      // Finishes and an explicit ceiling height stay editable on derived
      // construction, so they are applied to whatever the reconciler built.
      const derived = derivedShellSurfaces(bridge, levelId, zoneIds)
      const explicitCeilingHeight = ceilingHeight ?? wallHeight
      const finishes = [
        ...(derived.slabId && slabMaterialPreset
          ? [
              {
                op: 'update' as const,
                id: derived.slabId as AnyNodeId,
                data: {
                  ...(slabMaterialPreset ? { materialPreset: slabMaterialPreset } : {}),
                } as Partial<AnyNode>,
              },
            ]
          : []),
        ...(derived.ceilingId && (ceilingMaterialPreset || explicitCeilingHeight !== undefined)
          ? [
              {
                op: 'update' as const,
                id: derived.ceilingId as AnyNodeId,
                data: {
                  ...(ceilingMaterialPreset ? { materialPreset: ceilingMaterialPreset } : {}),
                  ...(explicitCeilingHeight !== undefined ? { height: explicitCeilingHeight } : {}),
                } as Partial<AnyNode>,
              },
            ]
          : []),
      ]
      if (finishes.length > 0) bridge.applyPatch(finishes)

      const persistence = await publishLiveSceneSnapshot(bridge, 'create_story_shell')
      return textResult({
        levelId,
        wallIds,
        zoneIds,
        slabId: derived.slabId,
        ceilingId: derived.ceilingId,
        createdIds: Object.keys(bridge.getNodes()).filter((id) => !before.has(id)),
        ...persistencePayload(persistence),
      })
    },
  )
}
