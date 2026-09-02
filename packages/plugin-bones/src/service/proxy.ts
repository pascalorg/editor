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
