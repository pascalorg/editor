/**
 * One step of a critically damped spring (the exact solution, so frames of any length take the same
 * path): it settles on `target` in about `response` seconds without overshooting, and a new target
 * turns it around from where it is, carrying its speed. The camera that follows a build and the roof
 * that lifts out of its way move this way.
 */
export function criticallyDamped(
  state: { x: number; v: number },
  target: number,
  response: number,
  dt: number,
): void {
  const omega = (2 * Math.PI) / Math.max(1e-3, response)
  const offset = state.x - target
  const carry = state.v + omega * offset
  const decay = Math.exp(-omega * dt)
  state.x = target + (offset + carry * dt) * decay
  state.v = (state.v - omega * carry * dt) * decay
}
