import { CONDENSER_PAD_THICKNESS, CONDENSER_UNIT_DIMS } from '../engines/hvac'
import { computeLevel } from '../framing/compute'
import type { FramingNode } from '../framing/schema'
import { levelFramingNode, type ServicePlacementNode } from './placement'

/**
 * HEAT-PUMP PICK PROXY resolution (Julien 2026-08-23: "I want to be able to
 * select the heat pump… it highlights when I mouse over it… a similar
 * experience to the kitchen island") — pure and headlessly testable; the
 * ServiceRenderer mounts the mesh.
 *
 * THE GAP IT CLOSES: in X-ray the heat-pump service node's placeholder body
 * yields to the hvac engine's render (the AC-block asset), and EVERY mesh
 * the framing renderer draws is raycast-disabled by convention (A6/F2 — the
 * X-ray never intercepts the host's event raycast). That left the sign
 * plate as the only pick handle — a by-design day-10 trade Julien now
 * overrules. The fix follows the shipped `bones:device` proxy pattern
 * (device/renderer.tsx, editor #665): a NEAR-INVISIBLE box inside the
 * service node's registered group, sized to the ENGINE cabinet's own
 * footprint, standing exactly where the unit renders. Hover/click/move all
 * ride the existing service-node machinery — useNodeEvents on the group,
 * useRegistry → host SelectionManager → merged-outline pass (which
 * re-renders silhouettes with its own mask material, so a colorWrite:false
 * mesh still outlines) — zero cross-renderer coupling, and the framing meshes
 * keep their raycast no-op (the proxy is a SERVICE mesh: the one stated
 * exception to "bones meshes never raycast", documented at the mount).
 *
 * POSITION/ROTATION PARITY: unit #1 sits AT the service node verbatim (A4),
 * so the proxy's plan point is the node's own — it rides the group and
 * follows live drags for free. Height and yaw are ENGINE truths (pad top +
 * half cabinet; unit #1's bearing from the equipment room), read from the
 * memoized computeLevel result exactly like the device proxy reads its
 * fixture (same store snapshot ⇒ cache hit, zero extra derivation). No
 * unit-#1 condenser fixture (engine honesty: no served rooms ⇒ no unit, or
 * hvac errored) ⇒ null — no phantom hover volume where nothing renders; the
 * sign plate stays the handle there (the stated engine-silence trade).
 */

/** The proxy box exceeds the cabinet by 4%: a slightly generous grab
 * volume, with the hover outline still hugging the unit within ~2 cm.
 * (The original anti-coplanar rationale — a 0.03-alpha shimmer class —
 * died with the colorWrite:false material, QA round 2026-08-23; the
 * inflate stays for the grab tolerance.) */
export const HP_PROXY_INFLATE = 1.04

export type HeatPumpProxySpec = {
  /** Inflated cabinet dims [w, h, d] (m). */
  dims: readonly [number, number, number]
  /** Unit center height (level-local y) — pad top + cabinet h/2. */
  centerY: number
  /** Unit #1's world yaw (the cabinet's bearing from the equipment room). */
  rotationY: number
}

type LooseNodes = Record<string, Record<string, unknown>>

/**
 * Resolve the proxy geometry for a heat-pump service node, or null when the
 * engine renders no unit #1 on this level. Mode/toggle gating is NOT here —
 * `servicePresentation(...).pickProxy` owns it (one suppression matrix);
 * callers combine both, and the renderer does.
 */
export function resolveHeatPumpProxy(
  nodes: LooseNodes,
  node: Pick<ServicePlacementNode, 'serviceType' | 'parentId'>,
): HeatPumpProxySpec | null {
  if (node.serviceType !== 'heat-pump') return null
  const config = levelFramingNode(nodes, node.parentId)
  if (!config) return null
  const result = computeLevel(nodes, config as unknown as FramingNode)
  const unit1 = result.fixtures.find(
    (f) => f.meta?.equipment === 'condenser' && f.meta?.unit === 1,
  )
  if (!unit1) return null
  return {
    dims: [
      CONDENSER_UNIT_DIMS[0] * HP_PROXY_INFLATE,
      CONDENSER_UNIT_DIMS[1] * HP_PROXY_INFLATE,
      CONDENSER_UNIT_DIMS[2] * HP_PROXY_INFLATE,
    ],
    centerY: CONDENSER_PAD_THICKNESS + CONDENSER_UNIT_DIMS[1] / 2,
    rotationY: unit1.rotationY,
  }
}

/**
 * The heat-pump assembly's CURRENT world yaw — the base the host rotate
 * gestures step from (R/T + the ⌘-drag rotate arc write `yawOverride`
 * RELATIVE to what the user sees; stepping from 0 would make the first
 * keypress jump a wall-square unit to 45° absolute):
 *   1. an explicit finite `yawOverride` — the stored user rotation;
 *   2. else the ENGINE's unit-#1 fixture rotationY (the derived wall-square
 *      orientation), read from the memoized computeLevel exactly like the
 *      pick proxy (same store snapshot ⇒ cache hit);
 *   3. else 0 (no framing node / no unit — the gesture still works on the
 *      placeholder body, which renders unrotated).
 */
export function resolveHeatPumpAssemblyYaw(
  nodes: LooseNodes,
  node: Pick<ServicePlacementNode, 'serviceType' | 'parentId'> & { yawOverride?: unknown },
): number {
  if (typeof node.yawOverride === 'number' && Number.isFinite(node.yawOverride)) {
    return node.yawOverride
  }
  const config = levelFramingNode(nodes, node.parentId)
  if (config) {
    const result = computeLevel(nodes, config as unknown as FramingNode)
    const unit1 = result.fixtures.find(
      (f) => f.meta?.equipment === 'condenser' && f.meta?.unit === 1,
    )
    if (unit1) return unit1.rotationY
  }
  return 0
}

/**
 * The pick proxy of any engine-drawn service point: the box the ENGINE's
 * equipment occupies (its member or fixture), so a click on the tank, the
 * socket, the pole, the panel door, the water entry or the thermostat
 * selects and drags the POINT — never the wall behind it (Steve,
 * 2026-09-09: "if i try to click the water heater ... it clicks the wall
 * and moves it"). `at` is the equipment's level-local plan centre; the
 * renderer stands the proxy there, offset from the point's own anchor.
 */
export type ServiceProxySpec = HeatPumpProxySpec & { at?: readonly [number, number] }

export function resolveServiceProxy(
  nodes: LooseNodes,
  node: Pick<ServicePlacementNode, 'serviceType' | 'parentId'>,
): ServiceProxySpec | null {
  if (node.serviceType === 'heat-pump') return resolveHeatPumpProxy(nodes, node)
  const config = levelFramingNode(nodes, node.parentId)
  if (!config) return null
  const result = computeLevel(nodes, config as unknown as FramingNode)
  const grow = 0.08
  const fromFixture = (kind: string, dims: readonly [number, number, number]): ServiceProxySpec | null => {
    const f = result.fixtures.find((x) => x.kind === kind)
    if (!f) return null
    return { dims: [dims[0] + grow, dims[1] + grow, dims[2] + grow], centerY: f.position[1], rotationY: f.rotationY, at: [f.position[0], f.position[2]] }
  }
  switch (node.serviceType) {
    case 'water-heater': {
      const tank = result.members.find((m) => m.role === 'water-heater' && m.sourceId === 'wh')
      if (!tank) return null
      const head = result.members.find((m) => m.sourceId === 'wh-head')
      const h = tank.dims[1] + (head?.dims[1] ?? 0)
      return {
        dims: [tank.dims[0] + grow, h + grow, tank.dims[2] + grow],
        centerY: tank.position[1] - tank.dims[1] / 2 + h / 2,
        rotationY: tank.rotation[1],
        at: [tank.position[0], tank.position[2]],
      }
    }
    case 'utility-pole': {
      const pole = result.members.find((m) => m.sourceId === 'service-entrance' && m.role === 'post')
      if (!pole) return null
      return { dims: [pole.dims[0] + 0.2, pole.dims[1], pole.dims[2] + 0.2], centerY: pole.position[1], rotationY: 0, at: [pole.position[0], pole.position[2]] }
    }
    case 'electric-meter':
      return fromFixture('electric-meter', [0.3, 0.4, 0.2])
    case 'panel':
      return fromFixture('panel', [0.3556, 0.762, 0.1])
    case 'water-entry':
      return fromFixture('water-meter', [0.2, 0.2, 0.14])
    case 'thermostat':
      return fromFixture('thermostat', [0.09, 0.12, 0.03])
    default:
      return null
  }
}

/** The proxy's position in the point's own (yawed) frame: the equipment's plan centre less the anchor, turned back by the yaw (world = R(yaw)·local). */
export function proxyLocalOffset(
  at: readonly [number, number] | undefined,
  anchor: readonly [number, number],
  rotationY: number,
): [number, number] {
  if (!at) return [0, 0]
  const dx = at[0] - anchor[0]
  const dz = at[1] - anchor[1]
  const c = Math.cos(rotationY)
  const s = Math.sin(rotationY)
  return [dx * c - dz * s, dx * s + dz * c]
}
