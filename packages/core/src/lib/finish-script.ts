import type {
  AnyNode,
  CompiledGeometryScript,
  GeometryScriptParamValue,
  WallFaceScript,
  WallNode,
  ZoneFloorScript,
} from '../schema'
import type { WallFace } from '../schema/nodes/wall'
import {
  type FloorScriptInputs,
  floorScriptInputs,
  floorScriptInputsKey,
  floorScriptRecord,
} from './floor-script'
import {
  type WallFaceScriptInputs,
  wallFaceScriptInputs,
  wallFaceScriptInputsKey,
  wallFaceScriptRecord,
} from './wall-face-script'

type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * A finish a script builds for its host: a room's floor (`nodeId` a zone) or one face of a wall
 * (`nodeId` a wall, with `face`).
 */
export type FinishScriptTarget = { nodeId: string; face?: WallFace }
export type FinishScriptInputs = FloorScriptInputs | WallFaceScriptInputs
type FinishScript = ZoneFloorScript | WallFaceScript

function finishScriptsOf(node: AnyNode): (FinishScriptTarget & { script: FinishScript })[] {
  if (node.type === 'zone')
    return node.floor?.script ? [{ nodeId: node.id, script: node.floor.script }] : []
  if (node.type !== 'wall') return []
  return (['a', 'b'] as const).flatMap((face) => {
    const script = node.finishScripts?.[face]
    return script ? [{ nodeId: node.id, face, script }] : []
  })
}

/** What a finish script is built for now, with its key; null when its host has nothing to build on. */
function currentInputs(
  nodes: SceneNodes,
  { nodeId, face }: FinishScriptTarget,
  script: FinishScript,
): { inputs: FinishScriptInputs; key: string } | null {
  if (face) {
    const inputs = wallFaceScriptInputs(nodes, nodeId, face, (script as WallFaceScript).toHeight)
    return inputs && { inputs, key: wallFaceScriptInputsKey(inputs) }
  }
  const inputs = floorScriptInputs(nodes, nodeId)
  return inputs && { inputs, key: floorScriptInputsKey(inputs) }
}

export type StaleFinishScript = FinishScriptTarget & {
  script: FinishScript
  /** Its floor or face now, which the script runs again for. */
  inputs: FinishScriptInputs
}

/**
 * The finish scripts whose floor or face is no longer the one they were built for: the structure
 * reconcile re-derived a room (a wall moved, an edge pushed, a floor raised), or a wall changed
 * length, height or openings, so the key differs. A host with nothing to build on now (a room with
 * no floor, a wall turned curved) keeps its script as it was.
 */
export function staleFinishScripts(nodes: SceneNodes): StaleFinishScript[] {
  return Object.values(nodes).flatMap((node) =>
    finishScriptsOf(node).flatMap((entry) => {
      const now = currentInputs(nodes, entry, entry.script)
      return now && now.key !== entry.script.inputs ? [{ ...entry, inputs: now.inputs }] : []
    }),
  )
}

/**
 * How a host runs a finish script: reads its module back by hash, and compiles and stores it for
 * its floor or face (`@pascal-app/geometry-script`'s `compileGeometryScript` with `inputs`, then the
 * artifact store), answering the compile with the stored hashes.
 */
export type FinishScriptHost = {
  readScript(sha256: string): Promise<string | null>
  build(
    input: FinishScriptTarget & {
      code: string
      params: Record<string, GeometryScriptParamValue>
      inputs: FinishScriptInputs
    },
  ): Promise<CompiledGeometryScript>
}

export type FinishScriptRefresh = {
  rebuilt: (FinishScriptTarget & { script: FinishScript })[]
  failed: (FinishScriptTarget & { error: string })[]
}

/** Runs every stale finish script again for its floor or face now, with its stored params. */
export async function refreshFinishScripts(
  nodes: SceneNodes,
  host: FinishScriptHost,
): Promise<FinishScriptRefresh> {
  const refresh: FinishScriptRefresh = { rebuilt: [], failed: [] }
  await Promise.all(
    staleFinishScripts(nodes).map(async ({ script, inputs, ...target }) => {
      try {
        const code = await host.readScript(script.script)
        if (code === null) throw new Error('its module could not be read')
        const compiled = await host.build({ ...target, code, params: script.params, inputs })
        refresh.rebuilt.push({
          ...target,
          script: target.face
            ? wallFaceScriptRecord(
                compiled,
                inputs as WallFaceScriptInputs,
                (script as WallFaceScript).toHeight,
                script as WallFaceScript,
              )
            : floorScriptRecord(compiled, inputs as FloorScriptInputs, script as ZoneFloorScript),
        })
      } catch (error) {
        refresh.failed.push({
          ...target,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }),
  )
  return refresh
}

/**
 * The writes that put rebuilt finish scripts on `nodes`: each only while its host still has the
 * script and its floor or face is still the one it was rebuilt for (else a newer refresh follows),
 * over what the host holds now, so a wall's other face and a room's other floor fields are kept.
 */
export function finishScriptWrites(
  nodes: SceneNodes,
  rebuilt: FinishScriptRefresh['rebuilt'],
): { id: string; data: Partial<AnyNode> }[] {
  const writes = new Map<string, Partial<AnyNode>>()
  for (const { script, ...target } of rebuilt) {
    const node = nodes[target.nodeId]
    const held = node && finishScriptsOf(node).find((entry) => entry.face === target.face)
    if (!held || currentInputs(nodes, target, held.script)?.key !== script.inputs) continue
    if (node.type === 'zone') {
      writes.set(node.id, { floor: { ...node.floor, script: script as ZoneFloorScript } })
    } else if (node.type === 'wall' && target.face) {
      const earlier = writes.get(node.id) as Pick<WallNode, 'finishScripts'> | undefined
      writes.set(node.id, {
        finishScripts: {
          ...node.finishScripts,
          ...(earlier?.finishScripts ?? {}),
          [target.face]: script as WallFaceScript,
        },
      })
    }
  }
  return [...writes].map(([id, data]) => ({ id, data }))
}
