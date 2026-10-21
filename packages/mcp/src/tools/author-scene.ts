import type { McpServer } from '@modelcontextprotocol/server'
import {
  type AgentContext,
  achievedChanges,
  type SceneNodes,
  verifyScene,
} from '@pascal-app/core/agent-operations'
import {
  type AuthorScenePayload,
  authorSceneTool,
  isAgentRefusal,
} from '@pascal-app/core/agent-tools'
import { GEOMETRY_SCRIPT_MIME_TYPES } from '@pascal-app/core/schema'
import { compileAuthorScene } from '@pascal-app/geometry-script/author-scene'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { compileAndStore, type GeometryScriptHost } from './add-object'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { toPatches } from './shared-tools'

type Input = {
  payload: AuthorScenePayload
  module?: string
  adapter?: string
  replace?: boolean
  buildingId?: string
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
      inputSchema: z.object(authorSceneTool.input),
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
      if (args.sceneId && args.sceneId !== scene.id) {
        return toolError('Open the requested scene before converting it.', {
          code: 'scene_mismatch',
          mutationApplied: false,
        })
      }
      const before = bridge.getNodes() as SceneNodes
      const beforeJson = JSON.stringify(before)
      const context: AgentContext = {
        activeLevelId: bridge.activeLevelId?.() ?? null,
        ...(bridge.supportsMaterialUpserts && bridge.getMaterials
          ? { materials: bridge.getMaterials() }
          : {}),
      }
      let outcome: Awaited<ReturnType<typeof compileAuthorScene>>
      try {
        outcome = await compileAuthorScene(
          before,
          args,
          context,
          ({ code, kind, inputs, nodeId }) =>
            compileAndStore(
              host,
              scene.id,
              { code, language: 'three', params: undefined, inputs },
              kind,
              { nodeId },
            ),
          host.signal,
        )
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'conversion_failed',
        })
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

      host.signal?.throwIfAborted()
      await host.assertActive?.()
      if (JSON.stringify(bridge.getNodes()) !== beforeJson) {
        return toolError(
          'The scene changed while its candidate was compiling. Read the current scene and retry the conversion.',
          { code: 'scene_changed', mutationApplied: false },
        )
      }
      const buildingUpdate = outcome.changes.update.find(
        (change) => change.id === outcome.buildingId,
      )!
      buildingUpdate.data.metadata = {
        ...buildingUpdate.data.metadata,
        authorScene: {
          ...provenance,
          payload: withoutCode(args.payload),
          report: outcome.result,
          at: new Date().toISOString(),
        },
      }
      const patches = toPatches(outcome.changes)
      if (patches.length) bridge.applyPatch(patches)
      const checks = verifyScene(bridge.getNodes() as SceneNodes, undefined, {
        activeLevelId: null,
      }).result as { valid: boolean; issues: { type?: string; message?: string }[] }
      const byType = new Map<string, number>()
      for (const issue of checks.issues)
        byType.set(issue.type ?? 'unknown', (byType.get(issue.type ?? 'unknown') ?? 0) + 1)
      const payload = {
        ...outcome.result,
        itemTriangles: outcome.itemTriangles,
        itemsCompiled: outcome.itemsCompiled,
        green: outcome.result.defects.length === 0,
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

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
