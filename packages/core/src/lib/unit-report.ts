import type { AnyNode, AnyNodeId, LevelNode, UnitNode, ZoneNode } from '../schema'
import { measurementArea } from './measurement-geometry'
import { resolveAutoZonePolygon } from './space-detection'

export type UnitReport = {
  memberCount: number
  levelSpan: { minOrdinal: number; maxOrdinal: number; count: number } | null
  grossAreaM2: number
  members: Array<{
    zoneId: ZoneNode['id']
    name: string
    levelId: LevelNode['id'] | null
    levelOrdinal: number | null
    areaM2: number
  }>
}

export function buildUnitReport(
  unit: UnitNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): UnitReport {
  const levels = new Map<LevelNode['id'], number>()
  const members = [...new Set(unit.members)].flatMap((id) => {
    const zone = nodes[id]
    if (zone?.type !== 'zone') return []
    const level = zone.parentId ? nodes[zone.parentId as AnyNodeId] : undefined
    if (level?.type === 'level') levels.set(level.id, level.level)
    const polygon = resolveAutoZonePolygon(zone, (nodeId) => nodes[nodeId])
    return [
      {
        zoneId: zone.id,
        name: zone.name,
        levelId: level?.type === 'level' ? level.id : null,
        levelOrdinal: level?.type === 'level' ? level.level : null,
        areaM2: measurementArea(polygon.map(([x, z]) => [x, 0, z])),
      },
    ]
  })
  const ordinals = [...levels.values()]
  return {
    memberCount: members.length,
    levelSpan:
      levels.size > 0
        ? {
            minOrdinal: Math.min(...ordinals),
            maxOrdinal: Math.max(...ordinals),
            count: levels.size,
          }
        : null,
    grossAreaM2: members.reduce((sum, member) => sum + member.areaM2, 0),
    members,
  }
}
