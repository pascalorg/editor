import {
  type AnyNodeId,
  type CompiledGeometryScript,
  type FinishScriptHost,
  type FinishScriptInputs,
  type FinishScriptTarget,
  finishScriptWrites,
  GEOMETRY_SCRIPT_MIME_TYPES,
  type GeometryScriptParamValue,
  getArtifactStore,
  pauseSceneHistory,
  refreshFinishScripts,
  resumeSceneHistory,
  staleFinishScripts,
  useScene,
} from '@pascal-app/core'
import { compileGeometryScriptInWorker } from './client'

/**
 * Runs a finish script (a room's floor, a wall's face) in the sandbox for what it finishes and
 * stores the GLB and the module text, answering the compile with the stored hashes
 * (`setRoomFloorScript` and `setWallFaceScript` take it with its `inputs`).
 */
export async function compileAndStoreFinishScript(
  input: FinishScriptTarget & {
    code: string
    params?: Record<string, GeometryScriptParamValue>
    inputs: FinishScriptInputs
  },
): Promise<CompiledGeometryScript> {
  const { glb, ...compiled } = await compileGeometryScriptInWorker({
    code: input.code,
    params: input.params,
    inputs: input.inputs,
  })
  const context = {
    nodeId: input.nodeId,
    metadata: { name: input.face ? 'Wall finish' : 'Floor finish', mount: compiled.mount },
  }
  const store = getArtifactStore()
  const [sha256] = await Promise.all([
    store.put(compiled.sha256, glb, 'model/gltf-binary', context),
    store.put(
      compiled.script,
      new TextEncoder().encode(input.code),
      GEOMETRY_SCRIPT_MIME_TYPES.three,
      context,
    ),
  ])
  return { ...compiled, sha256 }
}

/** The editor tab's host for finish scripts: the sandbox compile and the scene's artifact store. */
export const editorFinishScriptHost: FinishScriptHost = {
  readScript: (sha256) => getArtifactStore().text(sha256),
  build: compileAndStoreFinishScript,
}

/** The module text of a finish script, read back from the artifact store. */
export function finishScriptCode(sha256: string): Promise<string | null> {
  return getArtifactStore().text(sha256)
}

const SETTLE_MS = 150

/**
 * Keeps every finish script built for what it finishes: after a scene change settles, each script
 * whose room's floor the structure re-derived, or whose wall face changed, runs again in the
 * sandbox. The new build is written outside history, as the reconcile's derived writes are, and
 * only while its floor or face is still the one it was built for; undo brings back the room or
 * wall and the script built for it together.
 */
export function initFinishScriptRefresh(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let again = false

  const run = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      const nodes = useScene.getState().nodes
      if (useScene.getState().readOnly || staleFinishScripts(nodes).length === 0) return
      const refresh = await refreshFinishScripts(nodes, editorFinishScriptHost)
      for (const { nodeId, face, error } of refresh.failed)
        console.error(
          `[finish script] ${nodeId}${face ? ` face ${face}` : ''} could not be rebuilt: ${error}`,
        )
      const writes = finishScriptWrites(useScene.getState().nodes, refresh.rebuilt)
      if (writes.length === 0) return
      pauseSceneHistory(useScene)
      try {
        useScene
          .getState()
          .updateNodes(writes.map(({ id, data }) => ({ id: id as AnyNodeId, data })))
      } finally {
        resumeSceneHistory(useScene)
      }
    } finally {
      running = false
      if (again) {
        again = false
        schedule()
      }
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void run()
    }, SETTLE_MS)
  }

  const unsubscribe = useScene.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) schedule()
  })
  schedule()
  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
  }
}
