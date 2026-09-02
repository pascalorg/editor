'use client'

import { useLiveNodeOverrides, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import { resolveServicePoint } from '../anchor'
import type { ServicePointKind, ServicePointNode } from '../schema'
import { SERVICE_POINT_SYSTEM, SYSTEM_COLOR } from '../schema'
import { resolveFrame, siteToLocal } from '../site-frame'

/**
 * Body shape per service kind, metres `[width, height, depth]`, plus whether
 * the body is a CAN (cylinder) rather than a box.
 *
 * Sizes are representative equipment envelopes for drawing, not catalogue
 * dimensions: a residential meter socket is roughly 350 mm across, a
 * load-centre panel around 350 × 500 mm, a 4 in cleanout cap 110 mm. None of
 * these is asserted against a manufacturer or a code table.
 */
const BODY: Record<ServicePointKind, { size: [number, number, number]; can: boolean }> = {
  'electric-meter': { size: [0.34, 0.34, 0.18], can: true },
  panel: { size: [0.36, 0.52, 0.14], can: false },
  'water-meter': { size: [0.3, 0.22, 0.3], can: true },
  'sewer-cleanout': { size: [0.14, 0.1, 0.14], can: true },
  'gas-meter': { size: [0.4, 0.36, 0.24], can: false },
  'water-entry': { size: [0.22, 0.28, 0.16], can: false },
  'sewer-exit': { size: [0.16, 0.16, 0.16], can: true },
  'power-entry': { size: [0.24, 0.3, 0.16], can: false },
  'telecom-nid': { size: [0.22, 0.3, 0.1], can: false },
}

/**
 * Small equipment body at the service point.
 *
 * Placement mirrors `bones:service`: a resolving `wallId` + `wallT` anchor
 * puts the body just proud of the wall face, facing out along the wall
 * normal; otherwise the node's own SITE `position` is used. `anchor.ts`
 * owns that resolution and its precedence note.
 *
 * Cleanouts and sewer exits sit at GRADE by convention — a cleanout cap
 * stands about 50 mm proud of the ground — so their body is dropped to the
 * ground plane rather than the stored mount height.
 */
export const ServicePointRenderer = ({ node: rawNode }: { node: ServicePointNode }) => {
  const ref = useRef<Group>(null!)
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(rawNode.id))
  const node = useMemo<ServicePointNode>(
    () => (liveOverride ? ({ ...rawNode, ...liveOverride } as ServicePointNode) : rawNode),
    [rawNode, liveOverride],
  )
  useRegistry(node.id, node.type, ref)
  const handlers = useNodeEvents(node as never, node.type as never)
  const nodes = useScene((s) => s.nodes)

  const placement = useMemo(() => {
    const loose = nodes as unknown as Record<string, Record<string, unknown>>
    const frame = resolveFrame(loose, node as unknown as Record<string, unknown>)
    return resolveServicePoint(loose, node, (position) => siteToLocal(frame, position))
  }, [nodes, node])

  const body = BODY[node.serviceKind]
  const atGrade = node.serviceKind === 'sewer-cleanout' || node.serviceKind === 'sewer-exit'
  const y = atGrade ? body.size[1] / 2 : placement.local[1]
  const color = SYSTEM_COLOR[SERVICE_POINT_SYSTEM[node.serviceKind]]

  return (
    <group
      position={[placement.local[0], y, placement.local[2]]}
      ref={ref}
      rotation={[0, placement.yaw, 0]}
      {...handlers}
    >
      <mesh>
        {body.can ? (
          <cylinderGeometry args={[body.size[0] / 2, body.size[0] / 2, body.size[1], 16]} />
        ) : (
          <boxGeometry args={body.size} />
        )}
        <meshStandardMaterial color="#d5d8dd" metalness={0.25} roughness={0.6} />
      </mesh>
      {/* A thin colour band in the point's APWA system colour — the only
          thing that tells a water meter from a gas meter at a glance. */}
      <mesh position={[0, -body.size[1] / 2 + 0.03, body.can ? 0 : body.size[2] / 2 + 0.002]}>
        {body.can ? (
          <cylinderGeometry args={[body.size[0] / 2 + 0.006, body.size[0] / 2 + 0.006, 0.05, 16]} />
        ) : (
          <boxGeometry args={[body.size[0] * 0.9, 0.05, 0.004]} />
        )}
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.7} />
      </mesh>
    </group>
  )
}

export default ServicePointRenderer
