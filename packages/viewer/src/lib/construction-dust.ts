import type { Camera, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'

/**
 * One pool for every puff on screen; a full pool reuses the oldest sprite. A big agent build
 * (Victor run 11: 1,545 walls in 6 s) puffs about 2,000 sprites a lifetime.
 */
export const DUST_CAPACITY = 2048
/** A sprite never draws smaller than this on screen, so a whole-building view still shows its dust. */
export const DUST_MIN_PX = 12
/** How long a sprite lives, in milliseconds. */
export const DUST_LIFE_MS = 800

/** Sprites slow down as the cloud spreads, rise a little, and grow as they thin out. */
const DRAG_PER_S = 2.2
const RISE_M_PER_S = 0.25
const GROWTH = 1.8
const ALPHA = 0.42

/**
 * Construction dust as plain numbers: a fixed ring of sprites, each with its
 * birth time, start point, velocity and size. Nothing allocates after
 * construction. The ring order is the birth order, so the slot after the
 * newest is always the oldest — the one a full pool gives up first.
 */
export class DustPool {
  readonly capacity: number
  private readonly lifeMs: number
  private readonly born: Float64Array
  private readonly data: Float32Array
  private next = 0
  private warmFrames = 0
  private latestMs = Number.NEGATIVE_INFINITY
  private lastEmitMs = Number.NEGATIVE_INFINITY

  constructor(capacity = DUST_CAPACITY, lifeMs = DUST_LIFE_MS) {
    this.capacity = capacity
    this.lifeMs = lifeMs
    this.born = new Float64Array(capacity).fill(Number.NEGATIVE_INFINITY)
    this.data = new Float32Array(capacity * 7)
  }

  /** Sprites alive at the latest time the pool has seen. */
  get live(): number {
    let alive = 0
    for (let slot = 0; slot < this.capacity; slot += 1) {
      const age = this.latestMs - this.born[slot]!
      if (age >= 0 && age < this.lifeMs) alive += 1
    }
    return alive
  }

  /** True when nothing emitted within a lifetime of `nowMs` can still be alive: a cheap idle check. */
  quietAt(nowMs: number): boolean {
    return nowMs - this.lastEmitMs >= this.lifeMs
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    nowMs: number,
  ) {
    const slot = this.next
    this.next = (slot + 1) % this.capacity
    this.latestMs = Math.max(this.latestMs, nowMs)
    this.lastEmitMs = Math.max(this.lastEmitMs, nowMs)
    this.born[slot] = nowMs
    const offset = slot * 7
    this.data[offset] = x
    this.data[offset + 1] = y
    this.data[offset + 2] = z
    this.data[offset + 3] = vx
    this.data[offset + 4] = vy
    this.data[offset + 5] = vz
    this.data[offset + 6] = size
  }

  /**
   * Advances to `nowMs`: expired sprites are dropped, and `write` receives
   * every live one with its current position, size and opacity. Returns how
   * many are alive.
   */
  step(
    nowMs: number,
    write: (slot: number, x: number, y: number, z: number, size: number, alpha: number) => void,
  ): number {
    this.latestMs = Math.max(this.latestMs, nowMs)
    let alive = 0
    for (let slot = 0; slot < this.capacity; slot += 1) {
      const age = nowMs - this.born[slot]!
      if (!(age >= 0 && age < this.lifeMs)) continue
      const life = age / this.lifeMs
      const seconds = age / 1000
      // Distance travelled under linear drag: v·(1 − e^(−k·t))/k.
      const travel = (1 - Math.exp(-DRAG_PER_S * seconds)) / DRAG_PER_S
      const offset = slot * 7
      write(
        alive,
        this.data[offset]! + this.data[offset + 3]! * travel,
        this.data[offset + 1]! + this.data[offset + 4]! * travel + RISE_M_PER_S * seconds,
        this.data[offset + 2]! + this.data[offset + 5]! * travel,
        this.data[offset + 6]! * (1 + GROWTH * Math.sqrt(life)),
        ALPHA * (1 - life) ** 2,
      )
      alive += 1
    }
    return alive
  }

  /**
   * Asks the drawing side for a few frames of one invisible sprite: the first puff of a build would
   * otherwise pay for the sprite material's first draw in the middle of the walls rising.
   */
  requestWarm(frames = 3) {
    this.warmFrames = Math.max(this.warmFrames, frames)
  }

  /** One warm frame, if any is asked for. */
  takeWarm(): boolean {
    if (this.warmFrames <= 0) return false
    this.warmFrames -= 1
    return true
  }

  clear() {
    this.born.fill(Number.NEGATIVE_INFINITY)
    this.next = 0
    this.lastEmitMs = Number.NEGATIVE_INFINITY
  }
}

/** A sprite's size in metres at `point`: its own, or DUST_MIN_PX on a screen `heightPx` tall. */
export function dustSpriteSize(size: number, camera: Camera, heightPx: number, point: Vector3) {
  const metresPerPx =
    'isOrthographicCamera' in camera
      ? ((camera as OrthographicCamera).top - (camera as OrthographicCamera).bottom) /
        (camera as OrthographicCamera).zoom /
        heightPx
      : 'isPerspectiveCamera' in camera
        ? (2 *
            camera.position.distanceTo(point) *
            Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360)) /
          (camera as PerspectiveCamera).zoom /
          heightPx
        : 0
  return Math.max(size, DUST_MIN_PX * metresPerPx)
}

/** A fixed pseudo-random sequence: the same build puffs the same way, and tests stay stable. */
let seed = 0x2f6b9d1
function random(): number {
  seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0
  return ((seed >>> 0) % 100_000) / 100_000
}

const PUFF_SPACING_M = 0.35
const MAX_PUFFS = 16

/** A rising wall's puff: sprites along its base line, pushed out to either side. */
export function emitAlongBase(pool: DustPool, from: Vector3, to: Vector3, nowMs: number) {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = Math.hypot(dx, dz)
  const count = Math.max(3, Math.min(MAX_PUFFS, Math.round(length / PUFF_SPACING_M) + 1))
  const nx = length > 1e-6 ? -dz / length : 1
  const nz = length > 1e-6 ? dx / length : 0
  for (let index = 0; index < count; index += 1) {
    const along = (index + 0.25 + random() * 0.5) / count
    const side = random() < 0.5 ? -1 : 1
    const speed = 0.35 + random() * 0.45
    pool.emit(
      from.x + dx * along,
      from.y + (to.y - from.y) * along + 0.05,
      from.z + dz * along,
      side * nx * speed + (random() - 0.5) * 0.2,
      0.08 + random() * 0.12,
      side * nz * speed + (random() - 0.5) * 0.2,
      0.22 + random() * 0.14,
      nowMs,
    )
  }
}

/**
 * A landing's puff: sprites around the footprint `corners` (four points of
 * its base, in order), pushed outwards. `strength` in [0, 1] scales the
 * cloud, so a crate makes less dust than a column.
 */
export function emitAroundFoot(
  pool: DustPool,
  corners: readonly Vector3[],
  strength: number,
  nowMs: number,
) {
  let cx = 0
  let cy = 0
  let cz = 0
  let perimeter = 0
  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index]!
    const b = corners[(index + 1) % corners.length]!
    cx += a.x / corners.length
    cy += a.y / corners.length
    cz += a.z / corners.length
    perimeter += Math.hypot(b.x - a.x, b.z - a.z)
  }
  const count = Math.max(4, Math.min(MAX_PUFFS, Math.round((perimeter / 0.5) * strength) + 4))
  for (let index = 0; index < count; index += 1) {
    // A point on the perimeter, at an even share of its length.
    let along = ((index + random() * 0.6) / count) * perimeter
    let x = cx
    let z = cz
    for (let edge = 0; edge < corners.length; edge += 1) {
      const a = corners[edge]!
      const b = corners[(edge + 1) % corners.length]!
      const span = Math.hypot(b.x - a.x, b.z - a.z)
      if (along <= span || edge === corners.length - 1) {
        const f = span > 1e-6 ? Math.min(1, along / span) : 0
        x = a.x + (b.x - a.x) * f
        z = a.z + (b.z - a.z) * f
        break
      }
      along -= span
    }
    const ox = x - cx
    const oz = z - cz
    const reach = Math.hypot(ox, oz) || 1
    const speed = (0.3 + random() * 0.4) * (0.5 + strength / 2)
    pool.emit(
      x,
      cy + 0.04,
      z,
      (ox / reach) * speed,
      0.05 + random() * 0.1,
      (oz / reach) * speed,
      (0.14 + random() * 0.12) * (0.6 + strength * 0.4),
      nowMs,
    )
  }
}
