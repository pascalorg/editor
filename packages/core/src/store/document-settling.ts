import { sceneEnvironmentOf } from './scene-environment'

const SETTLING = Symbol('document-settling')
const settlingOf = (store: object) => sceneEnvironmentOf(store).slot(SETTLING, () => ({ depth: 0 }))

/**
 * Whether `store` is being written by a host that settles every derived write itself
 * (`reconcileDocument`) before it returns: the editor's own derived writers (space detection,
 * the opening and roof systems) stand down meanwhile, so derived ids are minted once, in the
 * host's order.
 */
export function isSettlingDocument(store: object): boolean {
  return settlingOf(store).depth > 0
}

export function runSettlingDocument<T>(store: object, run: () => T): T {
  const settling = settlingOf(store)
  settling.depth += 1
  try {
    return run()
  } finally {
    settling.depth -= 1
  }
}
