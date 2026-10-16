import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AuthorSceneReport,
  achievedChanges,
  authorScene,
  type SceneNodes,
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
      // The items' modules, compiled and stored one by one; a failure is a defect, not a stop.
      const compiled: Record<string, CompiledGeometryScript> = {}
      const compileErrors: Record<string, string> = {}
      for (const level of args.payload.levels) {
        for (const item of level.items ?? []) {
          try {
            compiled[item.id] = await compileAndStore(
              host,
              scene.id,
              { code: item.code, language: 'three', params: undefined },
              'object',
            )
          } catch (error) {
            compileErrors[item.id] = error instanceof Error ? error.message : String(error)
          }
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
      let outcome: ReturnType<typeof authorScene>
      try {
        outcome = authorScene(
          before,
          { payload: args.payload, compiled, compileErrors, replace: args.replace },
          { activeLevelId: bridge.activeLevelId?.() ?? null },
        )
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'conversion_failed',
        })
      }
      const patches = outcome.changes ? toPatches(outcome.changes) : []
      if (patches.length) bridge.applyPatch(patches)
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

/** The payload as kept with the scene: every item's code is already its own artifact. */
function withoutCode(payload: AuthorScenePayload) {
  return {
    ...payload,
    levels: payload.levels.map((level) => ({
      ...level,
      items: (level.items ?? []).map(({ code: _, ...item }) => item),
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
