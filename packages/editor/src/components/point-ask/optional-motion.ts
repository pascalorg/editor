import { prefersReducedMotion } from '@pascal-app/core'
import { useReducedMotion } from '../../hooks/use-reduced-motion'
import { usePointAsk } from '../../store/use-point-ask'

/** Fresh event/frame eligibility; the hook alone starts false on a reduced-motion mount. */
export function pointMotionCalm(): boolean {
  return !usePointAsk.getState().playful || prefersReducedMotion()
}

export function usePointMotionCalm(): boolean {
  const playful = usePointAsk((state) => state.playful)
  const reduced = useReducedMotion()
  return !playful || reduced || prefersReducedMotion()
}

/** Only optional animations belong here, never retirement or other lifecycle fades. */
export function finishOptionalAnimations(animations: Animation[]): void {
  for (const animation of animations.splice(0)) {
    animation.finish()
    animation.cancel()
  }
}
