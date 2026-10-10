// One requestAnimationFrame loop for everything that follows the camera (the outline corners, the
// bubble, the pins): it runs only while something subscribes, and each subscriber gets the frame's
// delta in seconds (capped, so a hidden tab does not fling springs on return).

type FrameFn = (dt: number, now: number) => void

const subscribers = new Set<FrameFn>()
let frame = 0
let last = 0

function tick(now: number) {
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  for (const fn of [...subscribers]) fn(dt, now)
  frame = subscribers.size > 0 ? requestAnimationFrame(tick) : 0
  if (!frame) last = 0
}

export function subscribeFrame(fn: FrameFn): () => void {
  subscribers.add(fn)
  if (!frame && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick)
  return () => {
    subscribers.delete(fn)
  }
}
