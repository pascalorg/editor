import { useMemo } from 'react'
import { Sphere } from 'three'
import useViewer from '../store/use-viewer'
import { unionRegisteredNodeBounds } from './hero-pose'
import { resolveWalkthroughSpeeds, type WalkthroughSpeeds } from './walkthrough-speed'

/**
 * The site plane is the ground, not the building. Including it would make every
 * scene report the same enormous radius and the multiplier would never vary —
 * the exact set `lights.tsx` excludes when fitting its shadow sphere.
 */
const EXCLUDED_TYPES = ['site'] as const

/** Bounding-sphere radius of everything built, or null if nothing is. */
function measureSceneRadius(): number | null {
  const box = unionRegisteredNodeBounds({ excludeTypes: EXCLUDED_TYPES })
  if (!box) return null

  const radius = box.getBoundingSphere(new Sphere()).radius
  return Number.isFinite(radius) ? radius : null
}

/**
 * Walk/run speed for the walkthrough controllers — the single place both of
 * them ask.
 *
 * There is no interval and no per-frame refresh, unlike the shadow bounds this
 * borrows from: the scene cannot be edited from inside a walkthrough, so the
 * union is measured once when the controller mounts. Re-measuring would keep
 * paying for an answer that cannot have changed.
 */
export function useWalkthroughSpeeds(crouched: boolean): WalkthroughSpeeds {
  const autoScale = useViewer((state) => state.walkthroughAutoSpeed)
  const multiplier = useViewer((state) => state.walkthroughSpeedMultiplier)

  const sceneRadiusM = useMemo(() => measureSceneRadius(), [])

  return useMemo(
    () => resolveWalkthroughSpeeds(sceneRadiusM, { autoScale, multiplier }, crouched),
    [sceneRadiusM, autoScale, multiplier, crouched],
  )
}
