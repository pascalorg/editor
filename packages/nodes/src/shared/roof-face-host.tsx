'use client'

import {
  type AnyNodeId,
  getRoofWallFaceFrame,
  type RoofSegmentNode,
  type RoofWallFaceId,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { type ReactNode, useMemo } from 'react'

/**
 * Mounts a roof-hosted wall child inside its host face frame. Children
 * of roof segments render under the roof's `roof-elements` group (roof
 * frame); this wrapper applies the segment transform plus the face
 * frame, both derived from the LIVE-override-merged segment — hosted
 * nodes therefore track segment handle drags in real time instead of
 * jumping to their new spot on commit. Inside the frame, children use
 * plain wall-child position conventions ([u, v, z-from-mid-plane]).
 */
export function RoofFaceHostFrame({
  roofSegmentId,
  roofFace,
  children,
}: {
  roofSegmentId: string
  roofFace: RoofWallFaceId | undefined
  children: ReactNode
}) {
  const storeSegment = useScene(
    (state) => state.nodes[roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined,
  )
  const liveOverride = useLiveNodeOverrides((s) => s.get(roofSegmentId as AnyNodeId))
  const segment = useMemo(
    () =>
      storeSegment && liveOverride
        ? ({ ...storeSegment, ...liveOverride } as RoofSegmentNode)
        : storeSegment,
    [storeSegment, liveOverride],
  )

  if (segment?.type !== 'roof-segment' || !roofFace) return null
  const frame = getRoofWallFaceFrame(segment, roofFace)

  return (
    <group position={segment.position} rotation-y={segment.rotation}>
      <group position={frame.origin} rotation-y={frame.yaw}>
        {children}
      </group>
    </group>
  )
}
