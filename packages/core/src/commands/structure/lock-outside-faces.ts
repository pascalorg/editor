import { justificationForFaceOnLine, planWallJustification } from '../../systems/wall/wall-frame'
import { roomSideFaces } from '../../systems/wall/wall-room-sides'
import { requireZone, roomFace, type StructureNodes, type StructurePlan } from './shared'

export type LockOutsideFacesInput =
  | { levelId: string; zoneIds?: never }
  | { zoneIds: string[]; levelId?: never }

export function lockOutsideFaces(
  nodes: StructureNodes,
  input: LockOutsideFacesInput,
): StructurePlan & { wallIds: string[] } {
  if (input.levelId && nodes[input.levelId]?.type !== 'level')
    throw Error('Select an editable floor.')
  const zones =
    input.zoneIds?.map((id) => requireZone(nodes, id)) ??
    Object.values(nodes).filter(
      (node) =>
        node.type === 'zone' && node.spaceRole === 'room' && node.parentId === input.levelId,
    )
  const targets = new Set<string>(
    input.levelId
      ? Object.values(nodes)
          .filter((node) => node.type === 'wall' && node.parentId === input.levelId)
          .map((node) => node.id)
      : [],
  )
  for (const zone of zones) {
    if (zone.type !== 'zone') continue
    for (const span of roomFace(nodes, zone)?.spans ?? [])
      if (span.kind === 'wall') targets.add(span.boundaryId)
  }
  const patches: ReturnType<typeof planWallJustification> = []
  for (const wallId of targets) {
    const { outside } = roomSideFaces(nodes, wallId)
    if (!outside) continue
    patches.push(...planWallJustification(nodes, wallId, justificationForFaceOnLine(outside)))
  }
  return {
    changes: patches.map((patch) => ({ op: 'update', ...patch })),
    wallIds: patches.map((patch) => patch.id),
  }
}
