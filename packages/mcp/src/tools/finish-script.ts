import type { McpServer } from '@modelcontextprotocol/server'
import type { FinishScriptInputs } from '@pascal-app/core'
import {
  achievedChanges,
  type FinishScriptCompile,
  planFinishScript,
  type SceneNodes,
  type SetFinishScriptInput,
  setFinishScript,
} from '@pascal-app/core/agent-operations'
import {
  isAgentRefusal,
  setFinishScriptTool,
  surfaceDescription,
} from '@pascal-app/core/agent-tools'
import type { CompiledGeometryScript } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { compileAndStore, type GeometryScriptHost } from './add-object'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { inScene } from './scene-scope'
import { toPatches } from './shared-tools'

function textResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

/** Compiles and stores a finish module for one surface: a server's script host, or a page's sandbox. */
export type FinishScriptCompiler = {
  compile(input: {
    sceneId: string
    nodeId: string
    face?: 'a' | 'b'
    code: string
    inputs: FinishScriptInputs
  }): Promise<CompiledGeometryScript>
  /** Rechecks the caller's authority after the compiles and before the write. */
  assertActive?(): Promise<void>
}

/** A server's script host as a finish compiler. */
export function hostFinishCompiler(host: GeometryScriptHost): FinishScriptCompiler {
  return {
    compile: ({ sceneId, nodeId, face, code, inputs }) =>
      compileAndStore(
        host,
        sceneId,
        { code, language: 'three', params: undefined, inputs },
        face ? 'wall-face' : 'floor',
        { nodeId },
      ),
    assertActive: host.assertActive ? () => host.assertActive!() : undefined,
  }
}

/**
 * `set_finish_script` on the MCP: core plans what the module builds on, the compiler builds it
 * once for each surface, and the shared operation writes the results in one patch.
 */
export function registerSetFinishScript(
  server: McpServer,
  bridge: SceneOperations,
  compiler: FinishScriptCompiler | undefined,
): void {
  server.registerTool(
    setFinishScriptTool.name,
    {
      title: setFinishScriptTool.title,
      description: surfaceDescription(setFinishScriptTool, 'mcp'),
      inputSchema: z.object(setFinishScriptTool.input),
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (raw) => {
      const input = raw as SetFinishScriptInput
      const scene = bridge.getActiveScene()
      if (!scene) return toolError('Open or save a scene first.', { code: 'no_active_scene' })
      try {
        const before = bridge.getNodes() as SceneNodes
        const plan = planFinishScript(before, input)
        const compiled: Record<string, FinishScriptCompile> = {}
        if (!input.remove) {
          if (!compiler)
            return toolError('This Pascal server cannot run geometry scripts.', {
              code: 'scripts_unavailable',
            })
          for (const build of plan.builds)
            compiled[build.key] = {
              inputs: build.inputs,
              script: await compiler.compile({
                sceneId: scene.id,
                nodeId: build.nodeId,
                face: build.face,
                code: input.code!,
                inputs: build.inputs,
              }),
            }
          await compiler.assertActive?.()
        }
        // Planned again after the compiles were awaited, on the scene as it now stands.
        const outcome = inScene(bridge, () =>
          setFinishScript(bridge.getNodes() as SceneNodes, { ...input, compiled }),
        )
        const achieved = achievedChanges(bridge.getNodes() as SceneNodes, outcome.changes ?? {})
        if (outcome.changes) bridge.applyPatch(toPatches(outcome.changes))
        const persistence = await publishLiveSceneSnapshot(bridge, setFinishScriptTool.name)
        return textResult({
          ...(outcome.result as Record<string, unknown>),
          achieved,
          ...persistencePayload(persistence),
        })
      } catch (error) {
        if (isAgentRefusal(error)) return refusalResult(error)
        return toolError(error instanceof Error ? error.message : String(error), {
          code: 'script_failed',
        })
      }
    },
  )
}
