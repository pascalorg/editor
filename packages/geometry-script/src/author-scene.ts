import { floorScriptInputs, wallFaceScriptInputs } from '@pascal-app/core'
import {
  type AgentContext,
  applySceneChanges,
  authorScene,
  authorSceneCeilingPoints,
  authorSceneFaceScripts,
  authorSceneFinishGaps,
  authorSceneFloorScripts,
  finalizeAuthorScene,
  type SceneNodes,
  setRoomFloorScript,
  setWallFaceScript,
} from '@pascal-app/core/agent-operations'
import type { AuthorScenePayload } from '@pascal-app/core/agent-tools'
import type { CompiledGeometryScript } from '@pascal-app/core/schema'

export type AuthorSceneCompile = (input: {
  code: string
  kind: 'object' | 'window' | 'door' | 'floor' | 'wall-face'
  inputs?: Record<string, unknown>
  nodeId?: string
}) => Promise<CompiledGeometryScript>

/** Build and validate a complete candidate before either host changes the live scene. */
export async function compileAuthorScene(
  nodes: SceneNodes,
  input: { payload: AuthorScenePayload; replace?: boolean; buildingId?: string },
  context: AgentContext,
  compile: AuthorSceneCompile,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  authorScene(nodes, { ...input, compiled: {}, prepareOnly: true }, context)
  const compiled: Record<string, CompiledGeometryScript> = {}
  const compileErrors: Record<string, string> = {}
  const modules: { id: string; code: string; kind: 'object' | 'window' | 'door' }[] = []
  for (const level of input.payload.levels) {
    for (const item of level.items ?? [])
      modules.push({ id: item.id, code: item.code, kind: 'object' })
    for (const wall of level.walls ?? [])
      wall.openings?.forEach((opening, index) => {
        if (opening.code)
          modules.push({ id: `${wall.id}/${index}`, code: opening.code, kind: opening.kind })
      })
  }
  modules.push(
    ...authorSceneCeilingPoints(input.payload).map((point) => ({
      ...point,
      kind: 'object' as const,
    })),
  )
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(4, modules.length) }, async () => {
      while (cursor < modules.length) {
        const { id, code, kind } = modules[cursor++]!
        signal?.throwIfAborted()
        try {
          compiled[id] = await compile({ code, kind })
        } catch (error) {
          signal?.throwIfAborted()
          compileErrors[id] = error instanceof Error ? error.message : String(error)
        }
      }
    }),
  )
  const outcome = authorScene(
    nodes,
    { ...input, compiled, compileErrors, prepareOnly: true },
    context,
  )
  let candidate = { ...nodes, ...outcome.candidate.nodes }
  for (const { roomId, zoneId, code } of authorSceneFloorScripts(input.payload, outcome.result)) {
    signal?.throwIfAborted()
    try {
      const inputs = floorScriptInputs(candidate, zoneId)
      if (!inputs) throw new Error('The room has no floor to build on.')
      const built = await compile({ code, kind: 'floor', nodeId: zoneId, inputs })
      candidate = applySceneChanges(
        candidate,
        setRoomFloorScript(candidate, { zoneId, compiled: built, inputs }, context).changes,
      )
      outcome.result.floorScripts++
      const gaps = authorSceneFinishGaps(roomId, built.manifest, {
        room: candidate[zoneId]?.name ?? roomId,
        polygon: inputs.polygon,
      })
      if (gaps) outcome.result.warnings.push(gaps)
    } catch (error) {
      signal?.throwIfAborted()
      outcome.result.defects.push({
        id: roomId,
        code: 'floor_script_failed',
        message: `${error instanceof Error ? error.message : String(error)} (the room keeps its floor finish)`,
      })
    }
  }
  for (const { wallId, face, nodeId, code, toHeight } of authorSceneFaceScripts(
    input.payload,
    outcome.result,
    candidate,
  )) {
    signal?.throwIfAborted()
    try {
      const inputs = wallFaceScriptInputs(candidate, nodeId, face, toHeight)
      if (!inputs) throw new Error('The face has nothing to build on.')
      const built = await compile({ code, kind: 'wall-face', nodeId, inputs })
      candidate = applySceneChanges(
        candidate,
        setWallFaceScript(
          candidate,
          { wallId: nodeId, face, compiled: built, inputs, toHeight },
          context,
        ).changes,
      )
      outcome.result.faceScripts++
      const gaps = authorSceneFinishGaps(`${wallId}/${face}`, built.manifest, {
        wall: wallId,
        face,
      })
      if (gaps) outcome.result.warnings.push(gaps)
    } catch (error) {
      signal?.throwIfAborted()
      outcome.result.defects.push({
        id: `${wallId}/${face}`,
        code: 'face_script_failed',
        message: `${error instanceof Error ? error.message : String(error)} (the face keeps its paint)`,
      })
    }
  }
  signal?.throwIfAborted()
  outcome.candidate.nodes = Object.fromEntries(
    Object.keys(outcome.candidate.nodes).map((id) => [id, candidate[id]!]),
  )
  return {
    ...finalizeAuthorScene(nodes, outcome),
    itemTriangles: Object.values(compiled).reduce(
      (count, item) => count + item.manifest.triangles,
      0,
    ),
    itemsCompiled: Object.keys(compiled).length,
  }
}
