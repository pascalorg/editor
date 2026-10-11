/**
 * The bookkeeping a scene store's history keeps outside the store: pause depths and leases, the
 * commit bus and its pending commit, gesture drafts, the hydration boundary, the space-detection
 * pause. Each scene store owns one environment; the editor's store owns the live one. A detached
 * scene (`@pascal-app/core/runtime`) owns its own, so its commits, pauses and drafts never reach
 * the live editor's subscribers.
 *
 * The modules that keep this state read it through `currentSceneEnvironment()`: the environment
 * of the store whose action is running (a store runs its actions and writes inside its own), or
 * the live one. Functions that take a store use that store's environment.
 */
export type SceneEnvironment = {
  readonly label: string
  /** Lazily created per-module state, keyed by the module's own symbol. */
  slot<T>(key: symbol, create: () => T): T
  /** Runs `run` with this environment current; throws once the environment is disposed. */
  run<T>(run: () => T): T
  /** Throws once disposed: what makes a late read or write of a disposed scene fail. */
  assertActive(): void
  dispose(): void
  readonly disposed: boolean
}

export class SceneEnvironmentDisposedError extends Error {
  constructor(label: string) {
    super(`The scene ${label} is disposed; it can no longer be read or written.`)
    this.name = 'SceneEnvironmentDisposedError'
  }
}

const stack: SceneEnvironment[] = []

export function createSceneEnvironment(label: string): SceneEnvironment {
  const slots = new Map<symbol, unknown>()
  let disposed = false
  const environment: SceneEnvironment = {
    label,
    slot<T>(key: symbol, create: () => T): T {
      if (!slots.has(key)) slots.set(key, create())
      return slots.get(key) as T
    },
    run<T>(run: () => T): T {
      environment.assertActive()
      stack.push(environment)
      try {
        return run()
      } finally {
        stack.pop()
      }
    },
    assertActive() {
      if (disposed) throw new SceneEnvironmentDisposedError(label)
    },
    dispose() {
      disposed = true
      slots.clear()
    },
    get disposed() {
      return disposed
    },
  }
  return environment
}

/** The editor's environment: the singleton store's, and the default everywhere else. */
export const liveSceneEnvironment = createSceneEnvironment('live')

export function currentSceneEnvironment(): SceneEnvironment {
  return stack.at(-1) ?? liveSceneEnvironment
}

const environmentsByStore = new WeakMap<object, SceneEnvironment>()

export function bindSceneEnvironment(store: object, environment: SceneEnvironment): void {
  environmentsByStore.set(store, environment)
}

/** The environment of `store`: its own, or the live one for a store created without one. */
export function sceneEnvironmentOf(store: object): SceneEnvironment {
  return environmentsByStore.get(store) ?? liveSceneEnvironment
}
