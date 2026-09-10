/**
 * BONES' EXTERIOR EQUIPMENT ON THE ELEVATIONS.
 *
 * The sections builder draws the scene's items as boxes where they stand;
 * Bones' equipment is not a scene item, it is derived — so the elevations
 * never showed the water heater's enclosure outside the wall, the meter
 * socket, the service mast and its pole, or the condenser on its pad. This
 * turns the derived members that stand OUTSIDE the house into the same
 * item solids (`ItemSolid` in plugin-sections' scene model, matched
 * structurally — this package does not depend on plugin-sections) so the
 * elevation provider can push them onto the model it draws (Steve,
 * 2026-09-09: "your fixture schedule should have the fixtures from bones and
 * be shown in the elevations correctly like if the wh is on the wall
 * outside").
 *
 * WHAT COUNTS AS OUTSIDE. The water-heater family (`wh`, `wh-head`, the
 * enclosure panels, the pad) when the heater's own label says it stands
 * outside / outdoors; the service entrance's mast, weatherhead, pole or pad
 * transformer (never the drop wire); the HVAC condenser cabinets; and the
 * electric-meter socket on the wall face. Everything else Bones derives is
 * inside the walls and is the walls' business.
 */
import type { Fixture, Member } from '../../../../plugin-bones/src/core/types'
import { isPhysicalMember, isUtilityPlant } from '../../../../plugin-bones/src/framing/physical'
import type { NodeMap } from '../../model'
import { mepModel } from './model'

/** Structurally the sections' `ItemSolid` — a plan polygon between two heights. */
export type ExteriorItemSolid = {
  kind: 'item'
  id: string
  name: string
  assetId: string
  category: string
  polygon: [number, number][]
  baseY: number
  topY: number
  levelId: string | null
}

/** A member's plan rectangle turned by its yaw (three.js Y rotation: x' = x cos + z sin, z' = −x sin + z cos). */
function footprint(
  position: readonly [number, number, number],
  dims: readonly [number, number, number],
  yaw: number,
): [number, number][] {
  const hx = Math.max(dims[0], 0.02) / 2
  const hz = Math.max(dims[2], 0.02) / 2
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const corners: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ]
  return corners.map(([x, z]) => [position[0] + x * c + z * s, position[2] - x * s + z * c])
}

/** The label up to its first dash or bracket — the name the elevation carries. */
function shortName(label: string | undefined, fallback: string): string {
  const head = (label ?? '').split(/ — | \(/)[0]?.trim()
  return head && head.length > 0 ? head : fallback
}

/**
 * The finished house's physical set (plugin-bones framing/physical.ts) — one
 * definition for the 3D and the paper — less the utility's plant at the lot
 * line (the pole, its drop, the pad transformer): the 3D house shows them,
 * a drawing of the house does not.
 */
const isExteriorMember = (m: Parameters<typeof isPhysicalMember>[0]): boolean =>
  isPhysicalMember(m) && !isUtilityPlant(m)

/**
 * Bones' exterior equipment on `levels` (each with its base elevation in the
 * building's frame) as item solids in that frame. Levels without a Bones
 * model contribute nothing.
 */
export function bonesExteriorItems(
  nodes: NodeMap,
  levels: readonly { id: string; baseY: number }[],
): ExteriorItemSolid[] {
  const out: ExteriorItemSolid[] = []
  for (const level of levels) {
    const model = mepModel(nodes, level.id)
    if (!model) continue
    let n = 0
    for (const m of model.members) {
      if (!isExteriorMember(m)) continue
      out.push({
        kind: 'item',
        id: `bones-ext-${level.id}-${n++}`,
        name: shortName(m.label, m.sourceId),
        assetId: `bones:${m.sourceId}`,
        category: 'equipment',
        polygon: footprint(m.position, m.dims, m.rotation[1]),
        baseY: level.baseY + m.position[1] - m.dims[1] / 2,
        topY: level.baseY + m.position[1] + m.dims[1] / 2,
        levelId: level.id,
      })
    }
    const meter = model.fixtures.find((f: Fixture) => f.kind === 'electric-meter')
    if (meter) {
      const dims: readonly [number, number, number] = [0.3, 0.4, 0.12]
      out.push({
        kind: 'item',
        id: `bones-ext-${level.id}-meter`,
        name: 'Electric meter',
        assetId: 'bones:electric-meter',
        category: 'equipment',
        polygon: footprint(meter.position, dims, meter.rotationY),
        baseY: level.baseY + meter.position[1] - dims[1] / 2,
        topY: level.baseY + meter.position[1] + dims[1] / 2,
        levelId: level.id,
      })
    }
  }
  return out
}

/** Structurally the sections' `PrismSolid` of kind 'equipment'. */
export type EquipmentPrism = {
  kind: 'equipment'
  id: string
  polygon: [number, number][]
  bottomY: number
  topY: number
  levelId: string | null
}

/** A member's plan box: a run lying on its side (a round run, `rotation[2]` ≈ ±90°) carries its length in dims[1]. */
function memberFootprint(m: Member): { polygon: [number, number][]; bottomY: number; topY: number } {
  const onSide = Math.abs(m.rotation[2]) > 1
  const dims: readonly [number, number, number] = onSide ? [m.dims[1], m.dims[0], m.dims[2]] : m.dims
  return {
    polygon: footprint(m.position, dims, m.rotation[1]),
    bottomY: m.position[1] - dims[1] / 2,
    topY: m.position[1] + dims[1] / 2,
  }
}

/**
 * Bones' equipment on `levels` as prisms for the BUILDING SECTIONS: every
 * HVAC member (the ducts and their elbows, the boots, the plenum riser, the
 * air handler, the condenser) and the finished house's physical set, in the
 * building's frame — cut where the plane passes, shown beyond it (Steve,
 * 2026-09-09: "i need the ducts and things shown in the building sections,
 * true to life as they are drawn").
 */
export function bonesSectionPrisms(
  nodes: NodeMap,
  levels: readonly { id: string; baseY: number }[],
): EquipmentPrism[] {
  const out: EquipmentPrism[] = []
  for (const level of levels) {
    const model = mepModel(nodes, level.id)
    if (!model) continue
    let n = 0
    for (const m of model.members) {
      if (!(m.system === 'hvac' || isExteriorMember(m))) continue
      const fp = memberFootprint(m)
      out.push({
        kind: 'equipment',
        id: `bones-sec-${level.id}-${n++}`,
        polygon: fp.polygon,
        bottomY: level.baseY + fp.bottomY,
        topY: level.baseY + fp.topY,
        levelId: level.id,
      })
    }
  }
  return out
}
