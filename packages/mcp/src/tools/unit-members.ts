import type { AnyNodeId, ZoneNode } from '@pascal-app/core/schema'
import type { SceneOperations } from '../operations'
import { ProtocolErrorCode, throwMcpError } from './errors'

export function validateUnitMembers(
  bridge: SceneOperations,
  buildingId: string,
  memberZoneIds: string[],
): ZoneNode['id'][] {
  const building = bridge.getNode(buildingId as AnyNodeId)
  if (!building) {
    throwMcpError(ProtocolErrorCode.InvalidParams, `Building not found: ${buildingId}`)
  }
  if (building.type !== 'building') {
    throwMcpError(
      ProtocolErrorCode.InvalidParams,
      `Node ${buildingId} is a ${building.type}, expected building`,
    )
  }

  return memberZoneIds.map((zoneId) => {
    const zone = bridge.getNode(zoneId as AnyNodeId)
    if (!zone) {
      throwMcpError(ProtocolErrorCode.InvalidParams, `Zone not found: ${zoneId}`)
    }
    if (zone.type !== 'zone') {
      throwMcpError(
        ProtocolErrorCode.InvalidParams,
        `Node ${zoneId} is a ${zone.type}, expected zone`,
      )
    }
    const [, level, parent] = bridge.getAncestry(zone.id)
    if (level?.type !== 'level' || parent?.id !== building.id) {
      throwMcpError(
        ProtocolErrorCode.InvalidParams,
        `Zone ${zoneId} must belong to a level in building ${buildingId}`,
      )
    }
    return zone.id
  })
}
