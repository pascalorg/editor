import type { LightEffect } from '@pascal-app/core'
import { MathUtils, type PointLight, Vector3 } from 'three'

// A fixed pool of point lights shared by the lit items nearest the camera.
// Mounting a light per item would blow the renderer's light budget on a large
// house. Used by the parametric `ItemLightSystem` and the baked-GLB viewer.

export const POOL_SIZE = 12
// How often (in seconds) to re-evaluate which items have lights assigned (fallback timer)
const REASSIGN_INTERVAL = 0.2
// Hysteresis: a currently-assigned slot keeps its key unless an unassigned
// candidate beats it by at least this much (prevents flickering at the boundary)
const HYSTERESIS = 0.15
// Camera movement thresholds that trigger an early re-evaluation
const CAM_MOVE_DIST = 0.5 // units
const CAM_ROT_DOT = 0.995 // cos(~5.7°)
const FADE_RATE = 12

/** What the pool needs to know about one lit item's light and its controls. */
export type PoolLightSource = {
  effect: LightEffect
  toggleIndex: number
  sliderIndex: number
  hasSlider: boolean
  sliderMin: number
  sliderMax: number
}

export type ScoredKey = { key: string; score: number }

type Slot = {
  // The key currently driving this slot (null = idle)
  key: string | null
  // A pending reassignment waiting for the fade-out to finish
  pendingKey: string | null
  isFadingOut: boolean
}

const _dir = new Vector3()

/** Lower is better: dead ahead and close wins; `levelPenalty` pushes other levels back. */
export function poolScore(
  lightPos: Vector3,
  camPos: Vector3,
  camFwd: Vector3,
  levelPenalty: number,
): number {
  _dir.copy(lightPos).sub(camPos).normalize()
  // Angular component (0 = dead ahead, 2 = directly behind)
  const angular = 1 - camFwd.dot(_dir)
  // Normalised distance component (assumes scenes < 200 units)
  const dist = camPos.distanceTo(lightPos) / 200
  return angular * 0.7 + dist * 0.3 + levelPenalty
}

export function poolLevelPenalty(
  itemLevelId: string | null,
  itemLevelIndex: number,
  selectedLevelId: string | null,
  levelMode: string,
): number {
  if (selectedLevelId) {
    // In solo mode items on other levels are invisible — deprioritize strongly
    if (itemLevelId !== selectedLevelId) return levelMode === 'solo' ? 100 : 0.8
    return 0
  }
  // No level selected — lightly prefer items on level index 0
  return itemLevelId && itemLevelIndex !== 0 ? 0.3 : 0
}

export function isPoolLightOn(source: PoolLightSource, values: unknown[] | undefined): boolean {
  return source.toggleIndex >= 0 ? Boolean(values?.[source.toggleIndex]) : true
}

export function poolTargetIntensity(
  source: PoolLightSource,
  values: unknown[] | undefined,
): number {
  const [min, max] = source.effect.intensityRange
  if (!isPoolLightOn(source, values)) return min
  let t = 1
  if (source.hasSlider && source.sliderMax > source.sliderMin) {
    const raw = (values?.[source.sliderIndex] as number | undefined) ?? source.sliderMin
    t = (raw - source.sliderMin) / (source.sliderMax - source.sliderMin)
  }
  return MathUtils.lerp(min, max, t)
}

function configure(light: PointLight, source: PoolLightSource | undefined) {
  if (!source) return
  light.color.set(source.effect.color)
  light.distance = source.effect.distance ?? 0
}

/**
 * Slot bookkeeping for the pool: which key each light serves, the re-score
 * throttle, and the per-frame fade. The owner mounts `POOL_SIZE` point lights
 * into `lights` and calls `shouldReassign` / `reassign` / `update` from one
 * `useFrame`.
 */
export class ItemLightPool {
  readonly lights: Array<PointLight | null> = Array.from({ length: POOL_SIZE }, () => null)
  private readonly slots: Slot[] = Array.from({ length: POOL_SIZE }, () => ({
    key: null,
    pendingKey: null,
    isFadingOut: false,
  }))
  private timer = 0
  private readonly prevCamPos = new Vector3()
  private readonly prevCamFwd = new Vector3(0, 0, -1)

  constructor(private readonly keepVisible = false) {}

  /** The key each slot serves (or will serve once its fade-out ends). */
  assignedKeys(): Array<string | null> {
    return this.slots.map((s) => s.pendingKey ?? s.key)
  }

  /** True when the timer ran out or the camera moved enough to re-score. */
  shouldReassign(camPos: Vector3, camFwd: Vector3, delta: number): boolean {
    const camMoved =
      camPos.distanceTo(this.prevCamPos) > CAM_MOVE_DIST ||
      camFwd.dot(this.prevCamFwd) < CAM_ROT_DOT
    this.timer -= delta
    if (this.timer > 0 && !camMoved) return false
    this.timer = REASSIGN_INTERVAL
    this.prevCamPos.copy(camPos)
    this.prevCamFwd.copy(camFwd)
    return true
  }

  /** Give the best-scored keys (finite scores only) a slot, keeping current holders. */
  reassign(scored: ScoredKey[], sourceOf: (key: string) => PoolLightSource | undefined) {
    scored.sort((a, b) => a.score - b.score)
    const scoreByKey = new Map(scored.map((s) => [s.key, s.score] as const))
    const desired = scored
      .filter((s) => Number.isFinite(s.score))
      .slice(0, POOL_SIZE)
      .map((s) => s.key)
    const desiredSet = new Set(desired)

    const currentlyAssigned = new Map<string, number>()
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = this.slots[i]!
      const k = s.key ?? s.pendingKey
      if (k) currentlyAssigned.set(k, i)
    }

    const usedSlots = new Set<number>()
    const assignedKeys = new Set<string>()
    // Pass 1: keep existing slots where the key is still in desired
    for (const key of desired) {
      const existingSlot = currentlyAssigned.get(key)
      if (existingSlot !== undefined && !usedSlots.has(existingSlot)) {
        usedSlots.add(existingSlot)
        assignedKeys.add(key)
      }
    }

    // Pass 2: assign remaining desired keys to free slots, evicting only on a clear win
    let freeSlot = 0
    for (const key of desired) {
      if (assignedKeys.has(key)) continue
      while (freeSlot < POOL_SIZE && usedSlots.has(freeSlot)) freeSlot++
      if (freeSlot >= POOL_SIZE) break

      const slot = this.slots[freeSlot]!
      const currentKey = slot.key ?? slot.pendingKey
      if (currentKey && !desiredSet.has(currentKey)) {
        const currentScore = scoreByKey.get(currentKey) ?? Number.POSITIVE_INFINITY
        const newScore = scoreByKey.get(key) ?? 0
        if (currentScore - newScore < HYSTERESIS) {
          freeSlot++
          continue
        }
      }

      usedSlots.add(freeSlot)
      assignedKeys.add(key)
      if (slot.key !== key) {
        slot.pendingKey = key
        slot.isFadingOut = slot.key !== null
        if (!slot.isFadingOut) {
          // Slot was idle — skip fade-out, assign immediately
          slot.key = key
          slot.pendingKey = null
          const light = this.lights[freeSlot]
          if (light) configure(light, sourceOf(key))
        }
      }
      freeSlot++
    }

    // Retire slots whose key is no longer wanted
    for (let i = 0; i < POOL_SIZE; i++) {
      if (usedSlots.has(i)) continue
      const slot = this.slots[i]!
      if (slot.key && !desiredSet.has(slot.key)) {
        slot.pendingKey = null
        slot.isFadingOut = true
      }
    }
  }

  /**
   * Per-frame fade and intensity tracking. `place` snaps the light to its key's
   * item and returns the target intensity, or null when the key is gone.
   */
  update(
    dt: number,
    sourceOf: (key: string) => PoolLightSource | undefined,
    place: (key: string, light: PointLight) => number | null,
  ) {
    const k = dt * FADE_RATE
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = this.lights[i]
      const slot = this.slots[i]!
      if (!light) continue

      if (slot.isFadingOut) {
        if (!this.keepVisible) light.visible = true
        light.intensity = MathUtils.lerp(light.intensity, 0, k)
        if (light.intensity < 0.01) {
          light.intensity = 0
          if (!this.keepVisible) light.visible = false
          slot.isFadingOut = false
          slot.key = slot.pendingKey
          slot.pendingKey = null
          if (slot.key) configure(light, sourceOf(slot.key))
        }
        continue
      }

      if (!slot.key) {
        this.fadeIdle(light, k)
        continue
      }

      const target = place(slot.key, light)
      if (target === null) {
        slot.key = null
        this.fadeIdle(light, k)
        continue
      }

      if (target > 0 && !this.keepVisible) light.visible = true
      light.intensity = MathUtils.lerp(light.intensity, target, k)
      if (target <= 0 && light.intensity < 0.01) {
        light.intensity = 0
        if (!this.keepVisible) light.visible = false
      }
    }
  }

  private fadeIdle(light: PointLight, k: number) {
    if (this.keepVisible) {
      light.intensity = MathUtils.lerp(light.intensity, 0, k)
      return
    }
    light.intensity = 0
    light.visible = false
  }
}
