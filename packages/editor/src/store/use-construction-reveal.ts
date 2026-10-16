'use client'

import { isNodeKindEnabled, nodeRegistry, useRegistryVersion, useScene } from '@pascal-app/core'
import {
  type AnimationSpeed,
  type ConstructionRevealLevel,
  DEFAULT_ANIMATION_SPEED,
  normalizeAnimationSpeed,
} from '@pascal-app/viewer'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const CONSTRUCTION_REVEAL_LEVELS: readonly ConstructionRevealLevel[] = [
  'off',
  'simple',
  'full',
  'framing',
]

export const CONSTRUCTION_REVEAL_STORAGE_KEY = 'pascal-construction-reveal'

/**
 * The kind the Framing level draws: it plays only in a project where this kind is registered and
 * its plugin is installed. Read through the kind, not a plugin id, so it holds wherever the framing
 * kinds live (the Bones plugin, or the procedural plugin that carries them).
 */
export const FRAMING_KIND = 'bones:framing'

const DEFAULT_LEVEL: ConstructionRevealLevel = 'full'

function normalizeLevel(value: unknown): ConstructionRevealLevel {
  return CONSTRUCTION_REVEAL_LEVELS.includes(value as ConstructionRevealLevel)
    ? (value as ConstructionRevealLevel)
    : DEFAULT_LEVEL
}

/** Reads `localStorage` on each call, so a page without it (a test, a sandbox) still has the store's persist API. */
const browserStorage = createJSONStorage(() => ({
  getItem: (key: string) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
  removeItem: (key: string) => globalThis.localStorage?.removeItem(key),
}))

type ConstructionRevealState = {
  /**
   * The level the person last chose (see `chosen`). Hosts read the level that plays through
   * `useConstructionRevealLevel`, which also knows whether the framing plugin is installed.
   */
  level: ConstructionRevealLevel
  /** Whether the person has chosen a level themselves; until then the default follows the project. */
  chosen: boolean
  setLevel: (level: ConstructionRevealLevel) => void
  /**
   * How fast builds play, a multiple of the shipped pace (×0.5 to ×2, higher is faster); the host
   * passes it to `ConstructionReveal`. A change applies to the next build, never to one playing.
   */
  speed: AnimationSpeed
  setSpeed: (speed: AnimationSpeed) => void
}

/** The person's construction-animation preferences (level and speed), kept across sessions. */
const useConstructionReveal = create<ConstructionRevealState>()(
  persist(
    (set) => ({
      level: DEFAULT_LEVEL,
      chosen: false,
      setLevel: (level) => set({ level, chosen: true }),
      speed: DEFAULT_ANIMATION_SPEED,
      setSpeed: (speed) => set({ speed: normalizeAnimationSpeed(speed) }),
    }),
    {
      name: CONSTRUCTION_REVEAL_STORAGE_KEY,
      storage: browserStorage,
      partialize: (state) => ({ level: state.level, chosen: state.chosen, speed: state.speed }),
      merge: (persisted, current) => {
        const saved = persisted as
          | { level?: unknown; chosen?: unknown; speed?: unknown }
          | undefined
        return {
          ...current,
          level: normalizeLevel(saved?.level),
          // A level saved before the default followed the project was the person's own choice.
          chosen: typeof saved?.chosen === 'boolean' ? saved.chosen : saved?.level !== undefined,
          // A person saved before the setting existed is at ×1; a stray value snaps to a step.
          speed: normalizeAnimationSpeed(saved?.speed),
        }
      },
    },
  ),
)

/**
 * The level that plays. With no choice of the person's own it is Framing where the framing plugin
 * is available in the project and Full where it is not; a choice is kept, except that Framing falls
 * back to Full while the plugin is missing (the choice comes back with the plugin).
 */
export function resolveConstructionLevel(
  saved: Pick<ConstructionRevealState, 'level' | 'chosen'>,
  framingInstalled: boolean,
): ConstructionRevealLevel {
  if (!saved.chosen) return framingInstalled ? 'framing' : 'full'
  return saved.level === 'framing' && !framingInstalled ? 'full' : saved.level
}

/**
 * A click on a level in the control. The level that plays is not always the saved one (a saved Framing
 * plays as Full while the plugin is gone), and a click on that pressed level is not a choice: it keeps
 * the saved one, so it plays again with the plugin.
 */
export function chooseConstructionLevel(
  level: ConstructionRevealLevel,
  framingInstalled: boolean,
): void {
  const state = useConstructionReveal.getState()
  if (state.chosen && resolveConstructionLevel(state, framingInstalled) === level) return
  state.setLevel(level)
}

/** Whether the project has what draws the framing: the kind is registered and its plugin installed. */
export function isFramingAvailable(installedPlugins: readonly string[]): boolean {
  return nodeRegistry.has(FRAMING_KIND) && isNodeKindEnabled(FRAMING_KIND, installedPlugins)
}

/** The same, for a component: it re-reads when a plugin registers after the first render. */
export function useFramingAvailable(): boolean {
  useRegistryVersion()
  return useScene((state) => isFramingAvailable(state.installedPlugins))
}

/** The level that plays now, for a component: the person's choice or the project's default. */
export function useConstructionRevealLevel(): ConstructionRevealLevel {
  const level = useConstructionReveal((state) => state.level)
  const chosen = useConstructionReveal((state) => state.chosen)
  return resolveConstructionLevel({ level, chosen }, useFramingAvailable())
}

/** The level that plays now, read once (a tool's executor, not a component). */
export function getConstructionRevealLevel(): ConstructionRevealLevel {
  return resolveConstructionLevel(
    useConstructionReveal.getState(),
    isFramingAvailable(useScene.getState().installedPlugins),
  )
}

export default useConstructionReveal
