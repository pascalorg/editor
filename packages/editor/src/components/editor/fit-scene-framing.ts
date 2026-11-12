export type FitSceneBounds = {
  center: [number, number]
  size: [number, number]
} | null

export type FitSceneLookAt = {
  eyeX: number
  eyeY: number
  eyeZ: number
  targetX: number
  targetY: number
  targetZ: number
  /** The eye's height above `targetY`, before any keep-over-ground lift. */
  eyeHeight: number
  /**
   * What an orthographic camera fits its zoom to: `setLookAt` leaves the
   * previous project's zoom in place. Centred on the target, so fitting it
   * does not move the pivot.
   */
  fitSphere: { center: [number, number, number]; radius: number }
}

// The empty-editor pose shows the default ±15 m site.
const DEFAULT_FIT_RADIUS = 15
// Margin around the footprint, as the frame-node path uses for orthographic fits.
const FIT_SPHERE_MARGIN = 1.3
// Keeps a lone wall from filling the viewport, like the perspective 15 m floor.
const MIN_FIT_RADIUS = 5

export type PendingFitScene = {
  bounds: FitSceneBounds
}

export type FitSceneEventPlan =
  | { action: 'ignore' }
  | { action: 'apply'; lookAt: FitSceneLookAt }
  | { action: 'queue'; pending: PendingFitScene }

export type FitSceneResumePlan = { action: 'noop' } | { action: 'apply'; lookAt: FitSceneLookAt }

/**
 * Compute the orbit look-at used by `camera-controls:fit-scene`, resting the
 * pivot at `groundY` (the selected level's orbit height).
 * Null bounds restore the empty-editor default pose.
 */
export function computeFitSceneLookAt(bounds: FitSceneBounds, groundY = 0): FitSceneLookAt {
  if (!bounds) {
    return {
      eyeX: 20,
      eyeY: 20 + groundY,
      eyeZ: 20,
      targetX: 0,
      targetY: groundY,
      targetZ: 0,
      eyeHeight: 20,
      fitSphere: { center: [0, groundY, 0], radius: DEFAULT_FIT_RADIUS },
    }
  }

  const [cx, cz] = bounds.center
  const [w, d] = bounds.size
  // Use the longer horizontal extent to size the orbit radius so the whole
  // footprint sits in view regardless of aspect ratio.
  const maxExtent = Math.max(w, d)
  const distance = Math.max(maxExtent * 1.4, 15)
  const height = Math.max(maxExtent * 0.8, 10)
  return {
    eyeX: cx + distance * 0.7,
    eyeY: height + groundY,
    eyeZ: cz + distance * 0.7,
    targetX: cx,
    targetY: groundY,
    targetZ: cz,
    eyeHeight: height,
    fitSphere: {
      center: [cx, groundY, cz],
      radius: Math.max((Math.hypot(w, d) / 2) * FIT_SPHERE_MARGIN, MIN_FIT_RADIUS),
    },
  }
}

/**
 * Decide what to do when a fit-scene event arrives.
 * First-person (and briefly-unmounted orbit controls) must queue the frame
 * so it can apply once orbit is back.
 */
export function planFitSceneOnEvent(input: {
  isPreviewMode: boolean
  isFirstPersonMode: boolean
  hasControls: boolean
  bounds: FitSceneBounds
  groundY?: number
}): FitSceneEventPlan {
  if (input.isPreviewMode) return { action: 'ignore' }

  const pending: PendingFitScene = { bounds: input.bounds }
  if (input.isFirstPersonMode || !input.hasControls) {
    return { action: 'queue', pending }
  }

  return { action: 'apply', lookAt: computeFitSceneLookAt(input.bounds, input.groundY) }
}

/**
 * Flush a queued load frame once orbit controls can apply it. The ground is
 * read at flush time: the selected level may have changed while it waited.
 */
export function planFitSceneOnOrbitResume(input: {
  isPreviewMode: boolean
  isFirstPersonMode: boolean
  hasControls: boolean
  pending: PendingFitScene | null
  groundY?: number
}): FitSceneResumePlan {
  if (!input.pending || input.isPreviewMode || input.isFirstPersonMode || !input.hasControls) {
    return { action: 'noop' }
  }

  return { action: 'apply', lookAt: computeFitSceneLookAt(input.pending.bounds, input.groundY) }
}

export type LevelFollowPlan = 'none' | 'default-pose' | 'rest-pivot'

/**
 * What the level-follow effect does with the orbit pivot.
 *
 * Only a scene-less first run takes the default pose. A first run over a
 * loaded scene is a fresh controls instance (mount, leaving XR, error-boundary
 * recovery) whose pivot sits at the origin, so it is rested on the level like
 * a camera change; on a real load the later scene-ready fit still wins.
 * Afterwards the pivot follows level, level-mode and camera changes only.
 */
export function planLevelFollow(input: {
  firstLoad: boolean
  sceneEmpty: boolean
  levelChanged: boolean
  modeChanged: boolean
  cameraChanged: boolean
}): LevelFollowPlan {
  if (input.firstLoad) return input.sceneEmpty ? 'default-pose' : 'rest-pivot'
  return input.levelChanged || input.modeChanged || input.cameraChanged ? 'rest-pivot' : 'none'
}
