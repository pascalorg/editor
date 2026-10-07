import type { AnyNode, AnyNodeId, UnitNode, ZoneNode } from '@pascal-app/core'

type ResolveNode = (id: AnyNodeId) => AnyNode | undefined

/**
 * Units under the building that owns this zone's level. Units are building
 * children, so this walks that short list instead of scanning every node
 * the way `unitsForZone` does — cheap enough for per-zone store selectors.
 */
export function buildingUnitsForZone(
  zone: Pick<ZoneNode, 'parentId'>,
  resolve: ResolveNode,
): UnitNode[] {
  const level = zone.parentId ? resolve(zone.parentId as AnyNodeId) : undefined
  const building = level?.parentId ? resolve(level.parentId as AnyNodeId) : undefined
  if (building?.type !== 'building') return []
  const units: UnitNode[] = []
  for (const childId of building.children) {
    const child = resolve(childId)
    if (child?.type === 'unit') units.push(child)
  }
  return units
}

/** The unit whose colour and name a member zone wears: the first one listing it. */
export function owningUnitForZone(
  zone: Pick<ZoneNode, 'id' | 'parentId'>,
  resolve: ResolveNode,
): UnitNode | null {
  return buildingUnitsForZone(zone, resolve).find((unit) => unit.members.includes(zone.id)) ?? null
}
