import type { ROOM_OPERATIONS } from '@pascal-app/core/agent-operations'
import { z } from 'zod'
import { ADDITIVE_TOOL_ANNOTATIONS, DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { liveSyncOutput } from './live-sync'

// The MCP's side of the room and floor-construction tools, whose contracts and operations are
// core's (shared-tools.ts registers them): which ones only add, and what their answers hold.

export type RoomToolName = keyof typeof ROOM_OPERATIONS

export const ROOM_TOOL_ANNOTATIONS: Record<
  RoomToolName,
  typeof ADDITIVE_TOOL_ANNOTATIONS | typeof DESTRUCTIVE_TOOL_ANNOTATIONS
> = {
  cut_floor_opening: ADDITIVE_TOOL_ANNOTATIONS,
  remove_floor_opening: DESTRUCTIVE_TOOL_ANNOTATIONS,
  set_floor_foundation: ADDITIVE_TOOL_ANNOTATIONS,
  set_room_floor_construction: ADDITIVE_TOOL_ANNOTATIONS,
  rebase_floor_reference: DESTRUCTIVE_TOOL_ANNOTATIONS,
  create_mezzanine: ADDITIVE_TOOL_ANNOTATIONS,
  move_zone: DESTRUCTIVE_TOOL_ANNOTATIONS,
  duplicate_zone: DESTRUCTIVE_TOOL_ANNOTATIONS,
  rotate_zone: DESTRUCTIVE_TOOL_ANNOTATIONS,
  lock_outside_faces: DESTRUCTIVE_TOOL_ANNOTATIONS,
  set_zone_intent: ADDITIVE_TOOL_ANNOTATIONS,
  divide_zone: DESTRUCTIVE_TOOL_ANNOTATIONS,
  merge_zones: DESTRUCTIVE_TOOL_ANNOTATIONS,
  delete_zone: DESTRUCTIVE_TOOL_ANNOTATIONS,
}

export const structureOutput = {
  zoneId: z.string().optional(),
  openingId: z.string().optional(),
  openingIds: z.array(z.string()).optional(),
  hints: z
    .array(
      z.object({
        code: z.literal('manual-ceiling'),
        openingId: z.string(),
        surfaceIds: z.array(z.string()),
        message: z.string(),
      }),
    )
    .optional(),
  idMap: z.record(z.string(), z.array(z.string())).optional(),
  changes: z.number(),
  separatorId: z.string().optional(),
  separatorIds: z.array(z.string()).optional(),
  zoneIds: z.array(z.string()).optional(),
  payload: z
    .object({
      zoneId: z.string(),
      name: z.string(),
      mode: z.enum(['delete', 'merge', 'blocked']),
      mergedIntoZoneId: z.string().optional(),
      contents: z.enum(['delete', 'keep']),
      wallIds: z.array(z.string()),
      keptSharedWallIds: z.array(z.string()),
      separatorIds: z.array(z.string()),
      keptSharedSeparatorIds: z.array(z.string()),
      openingIds: z.array(z.string()),
      itemIds: z.array(z.string()),
      opensZoneIds: z.array(z.string()),
    })
    .optional(),
  conflicts: z
    .array(z.object({ code: z.string(), nodeIds: z.array(z.string()), message: z.string() }))
    .optional(),
  ...liveSyncOutput,
}
