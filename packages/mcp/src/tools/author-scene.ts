import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { floorScriptInputs, wallFaceScriptInputs } from '@pascal-app/core'
import {
  type AgentContext,
  type AuthorSceneReport,
  achievedChanges,
  authorScene,
  authorSceneCeilingPoints,
  authorSceneFaceScripts,
  authorSceneFloorScripts,
  type SceneNodes,
  setRoomFloorScript,
  setWallFaceScript,
  verifyScene,
} from '@pascal-app/core/agent-operations'
import {
  type AuthorScenePayload,
  authorSceneTool,
  isAgentRefusal,
} from '@pascal-app/core/agent-tools'
import {
  type AnyNode,
  type CompiledGeometryScript,
  GEOMETRY_SCRIPT_MIME_TYPES,
} from '@pascal-app/core/schema'
import type { SceneOperations } from '../operations'
import { compileAndStore, type GeometryScriptHost, type ScriptedKind } from './add-object'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { toPatches } from './shared-tools'

type Input = {
  payload: AuthorScenePayload
  module?: string
  adapter?: string
  replace?: boolean
  sceneId?: string
}

/**
 * `author_scene` on the MCP: every item's module compiled and stored through the host, the
 * module and the adapter kept as the scene's provenance, the operation applied, Pascal's checks
 * run, and the gate report answered. Replay is the same payload through the same operation.
 */
export function registerAuthorScene(
  server: McpServer,
  bridge: SceneOperations,
  host: GeometryScriptHost | undefined,
): void {
  server.registerTool(
    authorSceneTool.name,
    {
      title: authorSceneTool.title,
      description: authorSceneTool.description,
      inputSchema: authorSceneTool.input,
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (input: Record<string, unknown>) => {
      if (!host) {
        return toolError('This Pascal server cannot run geometry scripts.', {
          code: 'scripts_unavailable',
        })
      }
      const args = input as Input
      const scene = bridge.getActiveScene()
      if (!scene) {
        return toolError('Open or save a scene first: a conversion is stored with a scene.', {
          code: 'no_active_scene',
        })
      }
      // Every module, compiled and stored one by one: the items', and the openings' by
      // `<wallId>/<index>`. A failure is a defect, not a stop.
      const compiled: Record<string, CompiledGeometryScript> = {}
      const compileErrors: Record<string, string> = {}
      const modules: { id: string; code: string; kind: ScriptedKind }[] = []
      for (const level of args.payload.levels) {
        for (const item of level.items ?? [])
          modules.push({ id: item.id, code: item.code, kind: 'object' })
        for (const wall of level.walls ?? [])
          wall.openings?.forEach((opening, index) => {
            if (opening.code)
              modules.push({ id: `${wall.id}/${index}`, code: opening.code, kind: opening.kind })
          })
      }
      modules.push(
        ...authorSceneCeilingPoints(args.payload).map((point) => ({
          ...point,
          kind: 'object' as const,
        })),
      )
      for (const { id, code, kind } of modules) {
        try {
          compiled[id] = await compileAndStore(
            host,
            scene.id,
            { code, language: 'three', params: undefined },
            kind,
          )
        } catch (error) {
          compileErrors[id] = error instanceof Error ? error.message : String(error)
        }
      }
      // Provenance: the design's module and the program that read it, kept as scripts of the scene.
      const provenance: Record<string, string> = {}
      for (const [kind, text] of [
        ['module', args.module],
        ['adapter', args.adapter],
      ] as const) {
        if (!text) continue
        provenance[kind] = await host.storeArtifact({
          sceneId: scene.id,
          sha256: await sha256(text),
          bytes: new TextEncoder().encode(text),
          mimeType: GEOMETRY_SCRIPT_MIME_TYPES.three,
          metadata: { kind: 'item' },
        })
      }

      const before = { ...(bridge.getNodes() as Record<string, AnyNode>) }
      const context: AgentContext = {
        activeLevelId: bridge.activeLevelId?.() ?? null,
        ...(bridge.supportsMaterialUpserts && bridge.getMaterials
          ? { materials: bridge.getMaterials() }
          : {}),
      }
      let outcome: ReturnType<typeof authorScene>
      try {
        outcome = authorScene(
          before,
          { payload: args.payload, compiled, compileErrors, replace: args.replace },
          context,
        )
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'conversion_failed',
        })
      }
      const patches = outcome.changes ? toPatches(outcome.changes) : []
      if (patches.length) bridge.applyPatch(patches)
      // A room's floor module needs its floor, which exists only now: compiled for it and written
      // on the zone; a failure leaves the room its `floor` finish.
      for (const { roomId, zoneId, code } of authorSceneFloorScripts(
        args.payload,
        outcome.result,
      )) {
        try {
          const inputs = floorScriptInputs(bridge.getNodes() as SceneNodes, zoneId)
          if (!inputs) throw new Error('The room has no floor to build on.')
          const built = await compileAndStore(
            host,
            scene.id,
            { code, language: 'three', params: undefined, inputs },
            'floor',
            { nodeId: zoneId, metadata: { name: 'Floor finish' } },
          )
          const written = setRoomFloorScript(
            bridge.getNodes() as SceneNodes,
            { zoneId, compiled: built, inputs },
            context,
          )
          if (written.changes) bridge.applyPatch(toPatches(written.changes))
          outcome.result.floorScripts++
        } catch (error) {
          outcome.result.defects.push({
            id: roomId,
            code: 'floor_script_failed',
            message: `${error instanceof Error ? error.message : String(error)} (the room keeps its floor finish)`,
          })
        }
      }
      // A face module needs its face, its openings cut and its rooms derived: compiled for it and
      // written on the wall; a failure leaves the face its paint.
      for (const { wallId, face, nodeId, code, toHeight } of authorSceneFaceScripts(
        args.payload,
        outcome.result,
        bridge.getNodes() as SceneNodes,
      )) {
        try {
          const inputs = wallFaceScriptInputs(
            bridge.getNodes() as SceneNodes,
            nodeId,
            face,
            toHeight,
          )
          if (!inputs) throw new Error('The face has nothing to build on.')
          const built = await compileAndStore(
            host,
            scene.id,
            { code, language: 'three', params: undefined, inputs },
            'wall-face',
            { nodeId, metadata: { name: 'Wall finish' } },
          )
          const written = setWallFaceScript(
            bridge.getNodes() as SceneNodes,
            { wallId: nodeId, face, compiled: built, inputs, toHeight },
            context,
          )
          if (written.changes) bridge.applyPatch(toPatches(written.changes))
          outcome.result.faceScripts++
        } catch (error) {
          outcome.result.defects.push({
            id: `${wallId}/${face}`,
            code: 'face_script_failed',
            message: `${error instanceof Error ? error.message : String(error)} (the face keeps its paint)`,
          })
        }
      }
      const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')
      if (building) {
        bridge.updateNode(building.id, {
          metadata: {
            ...building.metadata,
            authorScene: {
              ...provenance,
              payload: withoutCode(args.payload),
              report: outcome.result,
              at: new Date().toISOString(),
            },
          },
        } as Partial<AnyNode>)
      }
      const checks = verifyScene(bridge.getNodes() as SceneNodes, undefined, {
        activeLevelId: null,
      }).result as { valid: boolean; issues: { type?: string; message?: string }[] }
      const byType = new Map<string, number>()
      for (const issue of checks.issues)
        byType.set(issue.type ?? 'unknown', (byType.get(issue.type ?? 'unknown') ?? 0) + 1)
      const payload = {
        ...gateReport(outcome.result, compiled),
        verify: {
          valid: checks.valid,
          issues: checks.issues.length,
          byType: Object.fromEntries(byType),
          first: checks.issues.slice(0, 40).map((i) => i.message),
        },
        achieved: achievedChanges(before as SceneNodes, outcome.changes ?? {}),
        ...persistencePayload(await publishLiveSceneSnapshot(bridge, authorSceneTool.name)),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

/** The payload as kept with the scene: every module is already its own artifact. */
function withoutCode(payload: AuthorScenePayload) {
  return {
    ...payload,
    levels: payload.levels.map((level) => ({
      ...level,
      walls: (level.walls ?? []).map(({ faceLeft, faceRight, ...wall }) => ({
        ...wall,
        openings: (wall.openings ?? []).map(({ code: _, ...opening }) => opening),
        ...(faceLeft ? { faceLeft: { toHeight: faceLeft.toHeight } } : {}),
        ...(faceRight ? { faceRight: { toHeight: faceRight.toHeight } } : {}),
      })),
      items: (level.items ?? []).map(({ code: _, ...item }) => item),
      rooms: level.rooms.map(({ floorCode: _, wallCode: _w, ...room }) => room),
    })),
  }
}

/** What the agent iterates against: the operation's report plus what the items hold. */
function gateReport(report: AuthorSceneReport, compiled: Record<string, CompiledGeometryScript>) {
  const items = Object.values(compiled)
  return {
    ...report,
    itemTriangles: items.reduce((n, c) => n + c.manifest.triangles, 0),
    itemsCompiled: items.length,
    green: report.defects.length === 0,
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
