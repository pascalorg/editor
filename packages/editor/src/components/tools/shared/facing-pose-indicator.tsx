import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import useFacingPose, { type FacingPose } from '../../../store/use-facing-pose'
import { FacingIndicator } from './facing-indicator'

// The single editor-side renderer for the placement/move facing triangle.
// Mounted once inside ToolManager's building-local group; every tool publishes
// its ghost pose to `useFacingPose` and this draws the triangle. The pose
// (position/yaw) is applied imperatively to a ref so the per-frame cursor
// updates don't re-render React — only a change in footprint shape (depth /
// centre), which is constant per tool session, triggers a re-render.
export function FacingPoseIndicator() {
  const groupRef = useRef<Group>(null)
  const [shape, setShape] = useState<Pick<FacingPose, 'depth' | 'center' | 'reversed'> | null>(null)

  useEffect(() => {
    const apply = (pose: FacingPose | null) => {
      const group = groupRef.current
      if (group) {
        if (pose) {
          group.visible = true
          group.position.set(...pose.position)
          group.rotation.y = pose.rotationY
        } else {
          group.visible = false
        }
      }
      setShape((prev) => {
        if (!pose) return null
        const center = pose.center ?? [0, 0]
        if (
          prev &&
          prev.depth === pose.depth &&
          prev.reversed === pose.reversed &&
          (prev.center ?? [0, 0])[0] === center[0] &&
          (prev.center ?? [0, 0])[1] === center[1]
        ) {
          return prev
        }
        return { depth: pose.depth, center, reversed: pose.reversed }
      })
    }
    apply(useFacingPose.getState().pose)
    return useFacingPose.subscribe((state) => apply(state.pose))
  }, [])

  return (
    <group ref={groupRef} visible={false}>
      {shape ? (
        <FacingIndicator center={shape.center} depth={shape.depth} reversed={shape.reversed} />
      ) : null}
    </group>
  )
}
