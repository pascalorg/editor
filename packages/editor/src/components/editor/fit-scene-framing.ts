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
}

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
