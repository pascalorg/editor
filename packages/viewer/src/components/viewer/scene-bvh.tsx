import { useFrame, useThree } from '@react-three/fiber'
import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef } from 'react'
import type { Group } from 'three'
import { SAH, type SplitStrategy } from 'three-mesh-bvh'
import { createSceneBvhMaintainer, type SceneBvhMaintainer } from '../../lib/scene-bvh-maintainer'

export { isSceneBvhExcluded } from '../../lib/scene-bvh-maintainer'

type SceneBvhProps = {
  children?: ReactNode
  enabled?: boolean
  firstHitOnly?: boolean
  strategy?: SplitStrategy
  verbose?: boolean
  setBoundingBox?: boolean
  maxDepth?: number
  maxLeafSize?: number
  indirect?: boolean
}

/**
 * Keeps the wrapped subtree's raycasts BVH-accelerated.
 *
 * Maintenance is continuous, not mount-time: renderers populate the scene
 * over the frames after mount and every wall/slab edit swaps its mesh's
 * geometry, so a single traverse — however well timed — indexes a scene
 * that no longer exists a moment later. The maintainer re-scans on a frame
 * cadence and builds trees under a per-frame budget; the mechanics and the
 * memory story live in `lib/scene-bvh-maintainer.ts`.
 */
export const SceneBvh = forwardRef<Group, SceneBvhProps>(
  (
    {
      children,
      enabled = true,
      firstHitOnly = false,
      strategy = SAH,
      verbose = false,
      setBoundingBox = true,
      maxDepth = 40,
      maxLeafSize = 10,
      indirect = false,
    },
    forwardedRef,
  ) => {
    const ref = useRef<Group>(null)
    const maintainerRef = useRef<SceneBvhMaintainer | null>(null)
    const raycaster = useThree((state) => state.raycaster)

    useImperativeHandle(forwardedRef, () => ref.current!, [])

    useEffect(() => {
      if (!enabled || !ref.current) return

      ;(raycaster as { firstHitOnly?: boolean }).firstHitOnly = firstHitOnly
      const maintainer = createSceneBvhMaintainer(ref.current, {
        bvh: { strategy, verbose, setBoundingBox, maxDepth, maxLeafSize, indirect },
      })
      maintainerRef.current = maintainer

      return () => {
        maintainerRef.current = null
        delete (raycaster as { firstHitOnly?: boolean }).firstHitOnly
        maintainer.dispose()
      }
    }, [
      enabled,
      firstHitOnly,
      strategy,
      verbose,
      setBoundingBox,
      maxDepth,
      maxLeafSize,
      indirect,
      raycaster,
    ])

    useFrame(() => {
      maintainerRef.current?.step()
    })

    return <group ref={ref}>{children}</group>
  },
)

SceneBvh.displayName = 'SceneBvh'
