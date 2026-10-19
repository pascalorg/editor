import {
  type AnyNodeId,
  type CompiledGeometryScript,
  type FloorScriptHost,
  type FloorScriptInputs,
  floorScriptInputs,
  floorScriptInputsKey,
  GEOMETRY_SCRIPT_MIME_TYPES,
  type GeometryScriptParamValue,
  getArtifactStore,
  pauseSceneHistory,
  refreshFloorScripts,
  resumeSceneHistory,
  staleFloorScripts,
  useScene,
} from '@pascal-app/core'
import { compileGeometryScriptInWorker } from './client'

/**
 * Runs a room's floor script in the sandbox for its floor and stores the GLB and the module text,
 * answering the compile with the stored hashes (`setRoomFloorScript` takes it with `inputs`).
 */
export async function compileAndStoreFloorScript(input: {
  zoneId: string
  code: string
  params?: Record<string, GeometryScriptParamValue>
  inputs: FloorScriptInputs
}): Promise<CompiledGeometryScript> {
  const { glb, ...compiled } = await compileGeometryScriptInWorker({
    code: input.code,
    params: input.params,
    inputs: input.inputs,
  })
  const context = {
    nodeId: input.zoneId,
    metadata: { name: 'Floor finish', mount: compiled.mount },
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

/** The editor tab's host for floor scripts: the sandbox compile and the scene's artifact store. */
export const editorFloorScriptHost: FloorScriptHost = {
  readScript: (sha256) => getArtifactStore().text(sha256),
  build: compileAndStoreFloorScript,
}

/** The module text of a room's floor script, read back from the artifact store. */
export function floorScriptCode(sha256: string): Promise<string | null> {
  return getArtifactStore().text(sha256)
}

const SETTLE_MS = 150

/**
 * Keeps every room's floor script built for the room's floor: after a scene change settles, each
 * script whose room the structure re-derived runs again in the sandbox. The new build is written
 * outside history, as the reconcile's derived writes are, and only while the room's floor is still
 * the one it was built for; undo brings back the floor and the script built for it together.
 */
export function initFloorScriptRefresh(): () => void {
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
      if (useScene.getState().readOnly || staleFloorScripts(nodes).length === 0) return
      const refresh = await refreshFloorScripts(nodes, editorFloorScriptHost)
      for (const { zoneId, error } of refresh.failed)
        console.error(`[floor script] ${zoneId} could not be rebuilt: ${error}`)
      const current = useScene.getState().nodes
      const writes = refresh.update.flatMap(({ id, data }) => {
        const zone = current[id as AnyNodeId]
        const script = data.floor?.script
        const inputs = floorScriptInputs(current, id)
        if (zone?.type !== 'zone' || !zone.floor?.script || !script || !inputs) return []
        if (floorScriptInputsKey(inputs) !== script.inputs) return []
        return [{ id: id as AnyNodeId, data: { floor: { ...zone.floor, script } } }]
      })
      if (writes.length === 0) return
      pauseSceneHistory(useScene)
      try {
        useScene.getState().updateNodes(writes)
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
