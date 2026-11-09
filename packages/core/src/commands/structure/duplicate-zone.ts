import { type Point, requireZone, type StructureNodes } from './shared'
import { planZoneTransform, type TransformZoneInput } from './transform-zone'

export type DuplicateZoneInput = Omit<TransformZoneInput, 'translate'> & { translate: Point }

export function duplicateZone(nodes: StructureNodes, input: DuplicateZoneInput) {
  const zone = requireZone(nodes, input.zoneId)
  const first = planZoneTransform(nodes, input, true)
  if (zone.floor?.support !== 'open' || !first.conflicts?.length) return first
  const xs = zone.polygon.map(([x]) => x),
    zs = zone.polygon.map(([, z]) => z)
  const width = Math.max(...xs) - Math.min(...xs),
    depth = Math.max(...zs) - Math.min(...zs)
  for (const translate of [
    [width, 0],
    [0, depth],
    [-width, 0],
    [0, -depth],
  ] as Point[]) {
    const plan = planZoneTransform(nodes, { ...input, translate }, true)
    if (!plan.conflicts?.length) return plan
  }
  return first
}
