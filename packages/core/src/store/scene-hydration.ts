type Hydration = { pending: number; publish: () => void }

let pendingHydration: Hydration | null = null
let normalizing: Hydration | null = null

export function invalidatePendingHydration() {
  pendingHydration = null
}

export function isHydrationNormalization() {
  return normalizing !== null && normalizing === pendingHydration
}

function finishNormalization(hydration: Hydration) {
  hydration.pending--
  if (hydration.pending === 0 && pendingHydration === hydration) {
    pendingHydration = null
    hydration.publish()
  }
}

export function runSceneHydration(normalize: () => void, publish: () => void) {
  const hydration = { pending: 1, publish }
  pendingHydration = hydration
  const previous = normalizing
  normalizing = hydration
  try {
    normalize()
  } catch (error) {
    if (pendingHydration === hydration) invalidatePendingHydration()
    throw error
  } finally {
    normalizing = previous
    finishNormalization(hydration)
  }
}

// Only normalization queued by this hydration may extend its boundary. A
// subsequent edit cancels publication even if these microtasks are still queued.
export function queueSceneNormalization(normalize: () => void) {
  const hydration = pendingHydration
  if (hydration) hydration.pending++
  queueMicrotask(() => {
    const previous = normalizing
    normalizing = hydration
    try {
      normalize()
    } catch (error) {
      if (pendingHydration === hydration) invalidatePendingHydration()
      throw error
    } finally {
      normalizing = previous
      if (hydration) finishNormalization(hydration)
    }
  })
}
