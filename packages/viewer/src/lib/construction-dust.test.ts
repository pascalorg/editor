import { describe, expect, test } from 'bun:test'
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import {
  DUST_CAPACITY,
  DUST_LIFE_MS,
  DUST_MIN_PX,
  DustPool,
  dustSpriteSize,
  emitAlongBase,
  emitAroundFoot,
} from './construction-dust'

type Sprite = { slot: number; x: number; y: number; z: number; size: number; alpha: number }

function live(pool: DustPool, nowMs: number): Sprite[] {
  const sprites: Sprite[] = []
  const count = pool.step(nowMs, (slot, x, y, z, size, alpha) => {
    sprites.push({ slot, x, y, z, size, alpha })
  })
  expect(count).toBe(sprites.length)
  return sprites
}

describe('construction dust', () => {
  // Victor run 11: 1,545 walls rose in 6 s, about 2,000 sprites a lifetime; 512 recycled each
  // puff a fifth of the way through its life.
  test('a fixed pool of about 2,048 sprites', () => {
    const pool = new DustPool()
    expect(pool.capacity).toBe(DUST_CAPACITY)
    expect(DUST_CAPACITY).toBe(2048)
    for (let index = 0; index < 2100; index += 1) pool.emit(index, 0, 0, 0, 0, 0, 0.3, 0)
    expect(live(pool, 1)).toHaveLength(2048)
  })

  // Victor run 11: seen from a whole building, a puff of 30 cm discs was a few pixels.
  test('a sprite keeps its size close up and a few pixels on screen from afar', () => {
    const at = new Vector3()
    const camera = (distance: number) => {
      const perspective = new PerspectiveCamera(50, 1.5, 0.1, 1000)
      perspective.position.set(0, 0, distance)
      return perspective
    }
    const onScreen = (size: number, metresPerPx: number) => size / metresPerPx
    expect(dustSpriteSize(0.3, camera(8), 1000, at)).toBe(0.3)
    const far = camera(80)
    const metresPerPx = (2 * 80 * Math.tan((25 * Math.PI) / 180)) / 1000
    expect(onScreen(dustSpriteSize(0.3, far, 1000, at), metresPerPx)).toBeCloseTo(DUST_MIN_PX)
    // An orthographic view zoomed out to a 120 m tall frustum.
    const ortho = new OrthographicCamera(-90, 90, 60, -60, 0.1, 1000)
    expect(onScreen(dustSpriteSize(0.3, ortho, 1000, at), 120 / 1000)).toBeCloseTo(DUST_MIN_PX)
  })

  test('a full pool recycles the oldest puff', () => {
    const pool = new DustPool(4)
    for (let index = 0; index < 4; index += 1) pool.emit(index, 0, 0, 0, 0, 0, 0.3, index * 10)
    pool.emit(99, 0, 0, 0, 0, 0, 0.3, 50)
    const xs = live(pool, 60)
      .map((sprite) => Math.round(sprite.x))
      .sort((left, right) => left - right)
    expect(xs).toEqual([1, 2, 3, 99])
  })

  test('a puff rises, spreads and fades over about 0.8 s, then is gone', () => {
    const pool = new DustPool(8)
    pool.emit(0, 0, 0, 0.5, 0, 0, 0.3, 1000)
    const [early] = live(pool, 1100)
    const [late] = live(pool, 1000 + DUST_LIFE_MS * 0.8)
    expect(early!.alpha).toBeGreaterThan(late!.alpha)
    expect(late!.size).toBeGreaterThan(early!.size)
    expect(late!.x).toBeGreaterThan(early!.x)
    expect(late!.y).toBeGreaterThanOrEqual(early!.y)
    expect(DUST_LIFE_MS).toBeGreaterThanOrEqual(700)
    expect(DUST_LIFE_MS).toBeLessThanOrEqual(900)
    expect(live(pool, 1000 + DUST_LIFE_MS + 1)).toHaveLength(0)
    expect(pool.live).toBe(0)
  })

  test('clear drops every puff at once', () => {
    const pool = new DustPool(8)
    pool.emit(0, 0, 0, 0, 0, 0, 0.3, 0)
    pool.clear()
    expect(pool.live).toBe(0)
    expect(live(pool, 1)).toHaveLength(0)
  })

  test('a rising wall puffs along its base; a landing puffs around its foot', () => {
    const pool = new DustPool()
    emitAlongBase(pool, new Vector3(0, 0, 0), new Vector3(4, 0, 0), 0)
    const base = live(pool, 1)
    expect(base.length).toBeGreaterThanOrEqual(3)
    expect(base.length).toBeLessThanOrEqual(24)
    for (const sprite of base) {
      expect(sprite.x).toBeGreaterThan(-0.5)
      expect(sprite.x).toBeLessThan(4.5)
      expect(Math.abs(sprite.z)).toBeLessThan(0.5)
      expect(sprite.y).toBeLessThan(0.5)
    }

    pool.clear()
    emitAroundFoot(
      pool,
      [
        new Vector3(-0.2, 1, -0.2),
        new Vector3(0.2, 1, -0.2),
        new Vector3(0.2, 1, 0.2),
        new Vector3(-0.2, 1, 0.2),
      ],
      1,
      0,
    )
    const foot = live(pool, 1)
    expect(foot.length).toBeGreaterThanOrEqual(4)
    expect(foot.length).toBeLessThanOrEqual(24)
    for (const sprite of foot) {
      expect(Math.abs(sprite.x)).toBeLessThan(0.8)
      expect(Math.abs(sprite.z)).toBeLessThan(0.8)
      expect(sprite.y).toBeGreaterThan(0.9)
    }
  })
})
