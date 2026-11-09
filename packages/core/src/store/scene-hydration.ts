import { currentSceneEnvironment, type SceneEnvironment } from './scene-environment'

type Hydration = { pending: number; publish: () => void }
type HydrationState = { pending: Hydration | null; normalizing: Hydration | null }

const HYDRATION = Symbol('scene-hydration')

/** The hydration boundary of the current environment's store (scene-environment.ts). */
const stateOf = (environment: SceneEnvironment = currentSceneEnvironment()) =>
  environment.slot<HydrationState>(HYDRATION, () => ({ pending: null, normalizing: null }))

export function invalidatePendingHydration() {
  stateOf().pending = null
}

export function isHydrationNormalization() {
  const state = stateOf()
  return state.normalizing !== null && state.normalizing === state.pending
}

function finishNormalization(state: HydrationState, hydration: Hydration) {
  hydration.pending--
  if (hydration.pending === 0 && state.pending === hydration) {
    state.pending = null
    hydration.publish()
  }
}

export function runSceneHydration(normalize: () => void, publish: () => void) {
  const state = stateOf()
  const hydration = { pending: 1, publish }
  state.pending = hydration
  const previous = state.normalizing
  state.normalizing = hydration
  try {
    normalize()
  } catch (error) {
    if (state.pending === hydration) state.pending = null
    throw error
  } finally {
    state.normalizing = previous
    finishNormalization(state, hydration)
  }
}

// Only normalization queued by this hydration may extend its boundary. A
// subsequent edit cancels publication even if these microtasks are still queued.
export function queueSceneNormalization(normalize: () => void) {
  const environment = currentSceneEnvironment()
  const state = stateOf(environment)
  const hydration = state.pending
  if (hydration) hydration.pending++
  queueMicrotask(() => {
    // A disposed scene's queued work reaches nothing.
    if (environment.disposed) return
    environment.run(() => {
      const previous = state.normalizing
      state.normalizing = hydration
      try {
        normalize()
      } catch (error) {
        if (state.pending === hydration) state.pending = null
        throw error
      } finally {
        state.normalizing = previous
        if (hydration) finishNormalization(state, hydration)
      }
    })
  })
}
