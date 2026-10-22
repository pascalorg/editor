import { SPRING, type SpringTokens } from './choreography'

const TAU = Math.PI * 2

/**
 * A spring in Apple's two parameters: damping (1 = critically damped, below 1 it overshoots) and
 * response (seconds to arrive). Retargeting keeps the velocity, so an interrupted motion bends to
 * its new target instead of restarting, which is what makes a grabbed bubble feel held.
 */
export class Spring {
  x: number
  t: number
  v = 0
  private k = 0
  private c = 0

  constructor(x = 0, params: Partial<SpringTokens> = SPRING) {
    this.x = this.t = x
    this.set(params)
  }

  set({ damping = 1, response = 0.35 }: Partial<SpringTokens> = {}) {
    this.k = (TAU / response) ** 2
    this.c = (4 * Math.PI * damping) / response
    return this
  }

  to(target: number, params?: Partial<SpringTokens>) {
    if (params) this.set(params)
    this.t = target
    return this
  }

  snap(x: number) {
    this.x = this.t = x
    this.v = 0
    return this
  }

  /** Advances by `dt` seconds in sub-steps of at most 1/240 s, so a long frame stays stable. */
  step(dt: number) {
    if (this.rest) return this.x
    const n = Math.max(1, Math.ceil(dt * 240))
    const s = dt / n
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * (this.x - this.t) - this.c * this.v) * s
      this.x += this.v * s
    }
    if (Math.abs(this.x - this.t) < 1e-4 && Math.abs(this.v) < 1e-3) {
      this.x = this.t
      this.v = 0
    }
    return this.x
  }

  get rest() {
    return this.x === this.t && this.v === 0
  }
}

/** Two independent springs: 2D motion on one spring desyncs when x and y move at different speeds. */
export class SpringPair {
  readonly x: Spring
  readonly y: Spring

  constructor(x = 0, y = 0, params: Partial<SpringTokens> = SPRING) {
    this.x = new Spring(x, params)
    this.y = new Spring(y, params)
  }

  to(x: number, y: number, params?: Partial<SpringTokens>) {
    this.x.to(x, params)
    this.y.to(y, params)
    return this
  }

  snap(x: number, y: number) {
    this.x.snap(x)
    this.y.snap(y)
    return this
  }

  step(dt: number) {
    this.x.step(dt)
    this.y.step(dt)
    return this.value
  }

  get value() {
    return { x: this.x.x, y: this.y.x }
  }

  get rest() {
    return this.x.rest && this.y.rest
  }
}

/** The same spring as a closed-form function of time (0 to 1), for motion locked to a clock. */
export function springValueAt(t: number, damping = 1, response = 0.35) {
  if (t <= 0) return 0
  const w = TAU / response
  if (damping >= 1) return 1 - (1 + w * t) * Math.exp(-w * t)
  const wd = w * Math.sqrt(1 - damping * damping)
  return (
    1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t))
  )
}
