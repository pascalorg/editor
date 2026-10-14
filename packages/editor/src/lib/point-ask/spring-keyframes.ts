import { springValueAt } from './spring'

// A spring played as a Web Animations keyframe list: the element moves on the compositor with a
// spring's shape (critically damped, or overshooting when the gesture carried momentum), and the
// animation can still be cancelled and re-read mid-flight like any other.

export type SpringFrame = Record<string, number | string>

const lerp = (a: number, b: number, p: number) => a + (b - a) * p

/**
 * `from` and `to` are the numeric ends of scale, opacity, blur (px), x and y (px); the result is
 * ready for `element.animate(frames, { duration, easing: 'linear', fill: 'both' })`.
 */
export function springKeyframes(
  from: { scale?: number; opacity?: number; blur?: number; x?: number; y?: number },
  to: { scale?: number; opacity?: number; blur?: number; x?: number; y?: number },
  durationMs: number,
  options: { damping?: number; response?: number; samples?: number } = {},
): Keyframe[] {
  const { damping = 1, response = 0.35, samples = 18 } = options
  const frames: Keyframe[] = []
  for (let i = 0; i <= samples; i++) {
    const offset = i / samples
    // The last frame is the rest exactly: a spring that has not quite settled must not hold short.
    const p = i === samples ? 1 : springValueAt((offset * durationMs) / 1000, damping, response)
    const scale = lerp(from.scale ?? 1, to.scale ?? 1, p)
    const x = lerp(from.x ?? 0, to.x ?? 0, p)
    const y = lerp(from.y ?? 0, to.y ?? 0, p)
    frames.push({
      offset,
      opacity: Math.min(1, Math.max(0, lerp(from.opacity ?? 1, to.opacity ?? 1, p))),
      transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
      filter: `blur(${Math.max(0, lerp(from.blur ?? 0, to.blur ?? 0, p))}px)`,
    })
  }
  return frames
}
