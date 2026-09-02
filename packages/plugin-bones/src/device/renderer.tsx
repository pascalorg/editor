'use client'

import { useLiveNodeOverrides, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import { inches } from '../core/units'
import { computeLevel } from '../framing/compute'
import type { FramingNode } from '../framing/schema'
import {
  isMovedPosition,
  nearestUsableWall,
  usableWall,
  wallAngle,
  wallPointAt,
} from '../service/placement'
import type { DeviceNode } from './schema'

/**
 * Renderer for a `bones:device` node: an INVISIBLE raycast proxy sized like
 * the device box, standing exactly where the box renders — the visible box
 * itself comes from the existing fixture path (FramingRenderer instances it
 * with every other derived fixture), and the hover outline comes from the
 * host (selectable capability + useNodeEvents + useRegistry, the same trio
 * bones:service rides — editor #665). No sign plate: outlets are small and
 * everywhere; the hover rim is the affordance.
 *
 * Position parity: the proxy resolves through the SAME compute the boxes
 * render from — it finds the level's bones:framing config and looks its own
 * deviceId up in the memoized computeLevel result (identical store snapshot
 * = cache hit, zero extra derivation), so a moved node whose box the engine
 * stud-snapped shows its hover rim ON the snapped box, never on the raw
 * anchor. During a parentFrame drag the live position override rides the
 * wall axis instead (the box follows on commit, when the engines re-run).
 * Fallbacks (electrical off, no X-ray node): the node's own wall lerp.
 */

const PROXY_INFLATE = 1.35
const PROXY_DIMS: [number, number, number] = [
  inches(3) * PROXY_INFLATE,
  inches(4.5) * PROXY_INFLATE,
  inches(2.5) * PROXY_INFLATE,
]
/** Default device-center heights when the node carries none (engine AFFs). */
const DEFAULT_AFF: Record<string, number> = {
  switch: inches(48),
  receptacle: inches(15),
  'receptacle-gfci': inches(15),
  'receptacle-wr-gfci': inches(15),
}

type Placement = { position: readonly [number, number, number]; rotationY: number }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The level's X-ray config node (lowest id when duplicated — deterministic). */
function framingConfigFor(
  nodes: Record<string, Record<string, unknown>>,
  levelId: string | null | undefined,
): FramingNode | null {
  let best: Record<string, unknown> | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'bones:framing' || node.parentId !== levelId) continue
    if (!best || String(node.id ?? '') < String(best.id ?? '')) best = node
  }
  return best as FramingNode | null
}

export function resolveDevicePlacement(
  nodes: Record<string, Record<string, unknown>>,
  node: DeviceNode,
): Placement | null {
  const y = finite(node.heightAff) ? node.heightAff : (DEFAULT_AFF[node.deviceKind] ?? inches(15))

  // Live drag / manual escape hatch: the position override rides the wall.
  if (isMovedPosition(node.position)) {
    const [px, , pz] = node.position
    const hit = nearestUsableWall(nodes, node, [px, pz])
    if (hit) {
      const [x, z] = wallPointAt(hit.geom, hit.t)
      return { position: [x, y, z], rotationY: wallAngle(hit.geom) }
    }
    return { position: [px, y, pz], rotationY: 0 }
  }

  // Engine parity: the box the fixture path actually renders (memo-shared).
  const config = framingConfigFor(nodes, node.parentId)
  if (config && config.showElectrical !== false) {
    const result = computeLevel(nodes, config)
    const fixture = result.fixtures.find((f) => f.meta?.deviceId === node.deviceId)
    if (fixture) return { position: fixture.position, rotationY: fixture.rotationY }
  }

  // Fallback: the node's own wall anchor (electrical off / no X-ray node).
  const wall = node.wallId ? usableWall(nodes[node.wallId], node) : null
  if (wall) {
    const t = Math.max(0, Math.min(1, finite(node.wallT) ? node.wallT : 0.5))
    const [x, z] = wallPointAt(wall, t)
    return { position: [x, y, z], rotationY: wallAngle(wall) }
  }
  return null
}

export const DeviceRenderer = ({ node: rawNode }: { node: DeviceNode }) => {
  const ref = useRef<Group>(null!)
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(rawNode.id))
  const node = useMemo<DeviceNode>(
    () => (liveOverride ? ({ ...rawNode, ...liveOverride } as DeviceNode) : rawNode),
    [rawNode, liveOverride],
  )
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id, node.type, ref)

  const nodes = useScene((s) => s.nodes)
  const placement = useMemo(
    () => resolveDevicePlacement(nodes as Record<string, Record<string, unknown>>, node),
    [nodes, node],
  )

  if (node.visible === false || !placement) return null

  const [x, y, z] = placement.position
  return (
    <group position={[x, 0, z]} ref={ref} rotation={[0, placement.rotationY, 0]} {...handlers}>
      <mesh position={[0, y, 0]}>
        <boxGeometry args={PROXY_DIMS} />
        {/* Rendered-but-writes-NOTHING: `visible` stays true (render-list
            membership = raycast reliability + the outline mask pass, which
            swaps in its OWN material), colorWrite:false writes zero pixels,
            depthWrite:false keeps the phantom box out of depth (AO/edge
            passes). Same-property fix as the heat-pump proxy (browser QA
            2026-08-23: 0.03 alpha read as a faint 'glass case' at unit
            size; at outlet size it sat below perception through every
            visual round since #665, but the veil CLASS is identical —
            one proxy convention, not two). */}
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

export default DeviceRenderer
