import type { SceneOperations } from '../operations'

/** Runs `run` in the scene's scope when the operations have one (`SceneOperations.runInScene`). */
export function inScene<T>(operations: SceneOperations, run: () => T): T {
  return operations.runInScene ? operations.runInScene(run) : run()
}
