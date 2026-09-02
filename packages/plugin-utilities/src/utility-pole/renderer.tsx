'use client'

import { useLiveNodeOverrides, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import type { UtilityPoleNode } from '../schema'
import { resolveFrame, siteToLocal } from '../site-frame'
import { guyVector } from './floorplan'

/**
 * Butt and top diameters of a wood distribution pole, metres.
 *
 * ANSI O5.1 specifies pole dimensions by CLASS via the minimum top
 * circumference and the circumference 6 ft from the butt — it is a
 * circumference table, and the taper is the difference between the two.
 * These two numbers are a REPRESENTATIVE taper for a common class-4/5
 * 35 ft pole (≈ 0.33 m butt, ≈ 0.21 m top), NOT a value read from the ANSI
 * table, which is not in this repo. Marked unverified rather than presented
 * as a code dimension.
 */
const BUTT_DIAMETER = 0.33
const TOP_DIAMETER = 0.21

/** Crossarm: 8 ft (2.44 m) is the common distribution crossarm length. */
const CROSSARM_LENGTH = 2.44
const CROSSARM_SECTION = 0.09
/** The crossarm sits just below the top of the pole. */
const CROSSARM_DROP = 0.6

const TRANSFORMER_DIAMETER = 0.6
const TRANSFORMER_HEIGHT = 0.9
/** Transformer can mounted a third of the way down from the crossarm. */
const TRANSFORMER_DROP = 2.4

const POLE_COLOR = '#6b5442'
const HARDWARE_COLOR = '#3c3f45'
const TRANSFORMER_COLOR = '#8d9299'

/**
 * A tapered wood pole with a crossarm, an optional pole-mounted transformer
 * can, and an optional down-guy.
 *
 * The pole is a cylinder with different top and bottom radii — real poles
 * taper, and a parallel-sided cylinder reads as a bollard at ground level.
 * `node.position` is the BUTT at grade in SITE metres, so the cylinder is
 * lifted by half its height in the local frame.
 */
export const UtilityPoleRenderer = ({ node: rawNode }: { node: UtilityPoleNode }) => {
  const ref = useRef<Group>(null!)
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(rawNode.id))
  const node = useMemo<UtilityPoleNode>(
    () => (liveOverride ? ({ ...rawNode, ...liveOverride } as UtilityPoleNode) : rawNode),
    [rawNode, liveOverride],
  )
  useRegistry(node.id, node.type, ref)
  const handlers = useNodeEvents(node as never, node.type as never)
  const nodes = useScene((s) => s.nodes)

  const local = useMemo(() => {
    const frame = resolveFrame(
      nodes as unknown as Record<string, Record<string, unknown>>,
      node as unknown as Record<string, unknown>,
    )
    return siteToLocal(frame, [node.position[0], 0, node.position[1]])
  }, [nodes, node])

  const height = node.height
  const guy = guyVector(node.guy)
  // The guy runs from just under the crossarm to an anchor at grade. A real
  // down-guy lands at roughly a 45° lead; that is the ratio used here.
  const guyTop = height - CROSSARM_DROP - 0.4
  const guyLead = guyTop
  const guyLength = guy ? Math.hypot(guyTop, guyLead) : 0

  return (
    <group position={[local[0], local[1], local[2]]} ref={ref} {...handlers}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[TOP_DIAMETER / 2, BUTT_DIAMETER / 2, height, 12]} />
        <meshStandardMaterial color={POLE_COLOR} metalness={0} roughness={0.95} />
      </mesh>

      <mesh position={[0, height - CROSSARM_DROP, 0]}>
        <boxGeometry args={[CROSSARM_LENGTH, CROSSARM_SECTION, CROSSARM_SECTION]} />
        <meshStandardMaterial color={HARDWARE_COLOR} metalness={0.1} roughness={0.8} />
      </mesh>
      {/* Three insulator pins on the crossarm — centre and both ends. */}
      {[-CROSSARM_LENGTH / 2 + 0.2, 0, CROSSARM_LENGTH / 2 - 0.2].map((x) => (
        <mesh key={x} position={[x, height - CROSSARM_DROP + 0.12, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.18, 8]} />
          <meshStandardMaterial color="#9aa3ad" metalness={0.2} roughness={0.5} />
        </mesh>
      ))}

      {node.hasTransformer ? (
        <mesh position={[BUTT_DIAMETER / 2 + TRANSFORMER_DIAMETER / 2, height - TRANSFORMER_DROP, 0]}>
          <cylinderGeometry
            args={[TRANSFORMER_DIAMETER / 2, TRANSFORMER_DIAMETER / 2, TRANSFORMER_HEIGHT, 14]}
          />
          <meshStandardMaterial color={TRANSFORMER_COLOR} metalness={0.4} roughness={0.6} />
        </mesh>
      ) : null}

      {guy ? (
        <mesh
          position={[(guy[0] * guyLead) / 2, guyTop / 2, (guy[1] * guyLead) / 2]}
          rotation={[
            // Tilt the guy from vertical toward the anchor. The cylinder's
            // own axis is +Y, so the tilt is about the axis perpendicular to
            // the guy's plan direction.
            Math.atan2(guy[1] * guyLead, guyTop),
            0,
            -Math.atan2(guy[0] * guyLead, guyTop),
          ]}
        >
          <cylinderGeometry args={[0.02, 0.02, guyLength, 6]} />
          <meshStandardMaterial color="#8b9099" metalness={0.6} roughness={0.4} />
        </mesh>
      ) : null}
    </group>
  )
}

export default UtilityPoleRenderer
