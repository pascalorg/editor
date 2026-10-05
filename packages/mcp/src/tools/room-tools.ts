import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { editedScriptParams, rescriptOpening } from '@pascal-app/core/agent-operations'
import { addDoorTool, addWindowTool, isAgentRefusal } from '@pascal-app/core/agent-tools'
import { planWallOpening } from '@pascal-app/core/building'
import type {
  AnyNode,
  AnyNodeId,
  CompiledGeometryScript,
  GeometryScriptParamValue,
  WallNode as WallNodeType,
} from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { compileAndStore, type GeometryScriptHost, readScript } from './add-object'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { toPatches } from './shared-tools'

export const addDoorOutput = {
  doorId: z.string(),
  localX: z.number(),
  t: z.number(),
  position: z.number(),
  wallLength: z.number(),
  clamped: z.boolean(),
  coordinateSystem: z.literal('wall-local-meters'),
  ...liveSyncOutput,
}

export const addWindowOutput = {
  windowId: z.string(),
  localX: z.number(),
  t: z.number(),
  position: z.number(),
  wallLength: z.number(),
  clamped: z.boolean(),
  coordinateSystem: z.literal('wall-local-meters'),
  sillHeight: z.number(),
  ...liveSyncOutput,
}

function textResult<T extends Record<string, unknown>>(payload: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

/**
 * `add_door` / `add_window` with a nodeId: rebuild that opening from new code,
 * or its stored script with new params, through the shared operation.
 */
async function rebuildOpening(
  kind: 'door' | 'window',
  bridge: SceneOperations,
  host: GeometryScriptHost | undefined,
  input: {
    nodeId: string
    code?: string
    params?: Record<string, GeometryScriptParamValue>
  },
) {
  if (!host)
    return toolError('This Pascal server cannot run geometry scripts.', {
      code: 'scripts_unavailable',
    })
  const scene = bridge.getActiveScene()
  if (!scene) return toolError('Open or save a scene first.', { code: 'no_active_scene' })
  const nodes = bridge.getNodes() as Record<string, AnyNode>
  let outcome: ReturnType<typeof rescriptOpening>
  try {
    const code = input.code ?? (await readScript(host, scene.id, bridge, input.nodeId))
    const params = editedScriptParams(nodes[input.nodeId], input.params)
    const compiled = await compileAndStore(host, scene.id, code, params, kind)
    outcome = rescriptOpening(nodes, { nodeId: input.nodeId, compiled }, { activeLevelId: null })
  } catch (error) {
    if (isAgentRefusal(error)) return refusalResult(error)
    return toolError(error instanceof Error ? error.message : String(error), {
      code: 'script_failed',
    })
  }
  if (outcome.changes) bridge.applyPatch(toPatches(outcome.changes))
  const node = bridge.getNodes()[input.nodeId as AnyNodeId] as AnyNode & {
    position: [number, number, number]
    height: number
    wallId?: string
  }
  const wall = node.wallId
    ? (bridge.getNodes()[node.wallId as AnyNodeId] as WallNodeType)
    : undefined
  const wallLength = wall ? Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) : 0
  const persistence = await publishLiveSceneSnapshot(bridge, `add_${kind}`)
  return textResult({
    [kind === 'door' ? 'doorId' : 'windowId']: input.nodeId,
    localX: node.position[0],
    t: wallLength ? node.position[0] / wallLength : 0,
    position: wallLength ? node.position[0] / wallLength : 0,
    wallLength,
    clamped: false,
    coordinateSystem: 'wall-local-meters' as const,
    ...(kind === 'window' ? { sillHeight: node.position[1] - node.height / 2 } : {}),
    ...outcome.result,
    ...persistencePayload(persistence),
  })
}

/** A door or window passed `code`: compiled and stored the way add_object does, or the tool's error. */
async function compileOpeningScript(
  kind: 'door' | 'window',
  bridge: SceneOperations,
  host: GeometryScriptHost | undefined,
  input: { code?: string; params?: Record<string, GeometryScriptParamValue> },
): Promise<{ script?: CompiledGeometryScript } | { error: ReturnType<typeof toolError> }> {
  if (!input.code) return {}
  if (!host)
    return {
      error: toolError('This Pascal server cannot run geometry scripts; use the fields.', {
        code: 'scripts_unavailable',
      }),
    }
  const scene = bridge.getActiveScene()
  if (!scene)
    return { error: toolError('Open or save a scene first.', { code: 'no_active_scene' }) }
  try {
    return { script: await compileAndStore(host, scene.id, input.code, input.params, kind) }
  } catch (error) {
    if (isAgentRefusal(error)) return { error: refusalResult(error) }
    return {
      error: toolError(error instanceof Error ? error.message : String(error), {
        code: 'script_failed',
      }),
    }
  }
}

export function registerAddDoor(
  server: McpServer,
  bridge: SceneOperations,
  geometryScripts?: GeometryScriptHost,
): void {
  server.registerTool(
    addDoorTool.name,
    {
      title: addDoorTool.title,
      description: addDoorTool.description,
      inputSchema: addDoorTool.input,
      outputSchema: addDoorOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async (input) => {
      if (input.nodeId)
        return rebuildOpening('door', bridge, geometryScripts, { ...input, nodeId: input.nodeId })
      const compiled = await compileOpeningScript('door', bridge, geometryScripts, input)
      if ('error' in compiled) return compiled.error
      let planned: ReturnType<typeof planWallOpening>
      try {
        planned = planWallOpening(bridge.getNodes() as Record<string, AnyNode>, {
          kind: 'door',
          ...input,
          compiled: compiled.script,
        })
      } catch (error) {
        return refusalResult(error)
      }
      const id = bridge.createNode(planned.node, planned.wallId as AnyNodeId)
      const persistence = await publishLiveSceneSnapshot(bridge, 'add_door')
      return textResult({
        doorId: id,
        localX: planned.localX,
        t: planned.t,
        position: planned.t,
        wallLength: planned.wallLength,
        clamped: planned.clamped,
        coordinateSystem: 'wall-local-meters',
        ...persistencePayload(persistence),
      })
    },
  )
}

export function registerAddWindow(
  server: McpServer,
  bridge: SceneOperations,
  geometryScripts?: GeometryScriptHost,
): void {
  server.registerTool(
    addWindowTool.name,
    {
      title: addWindowTool.title,
      description: addWindowTool.description,
      inputSchema: addWindowTool.input,
      outputSchema: addWindowOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async (input) => {
      if (input.nodeId)
        return rebuildOpening('window', bridge, geometryScripts, { ...input, nodeId: input.nodeId })
      const compiled = await compileOpeningScript('window', bridge, geometryScripts, input)
      if ('error' in compiled) return compiled.error
      let planned: ReturnType<typeof planWallOpening>
      try {
        planned = planWallOpening(bridge.getNodes() as Record<string, AnyNode>, {
          kind: 'window',
          ...input,
          compiled: compiled.script,
        })
      } catch (error) {
        return refusalResult(error)
      }
      const id = bridge.createNode(planned.node, planned.wallId as AnyNodeId)
      const persistence = await publishLiveSceneSnapshot(bridge, 'add_window')
      return textResult({
        windowId: id,
        localX: planned.localX,
        t: planned.t,
        position: planned.t,
        wallLength: planned.wallLength,
        clamped: planned.clamped,
        coordinateSystem: 'wall-local-meters',
        sillHeight: planned.sillHeight ?? 0,
        ...persistencePayload(persistence),
      })
    },
  )
}

/** add_door and add_window; create_room and furnish_room are shared tools (shared-tools.ts). */
export function registerRoomTools(
  server: McpServer,
  bridge: SceneOperations,
  geometryScripts?: GeometryScriptHost,
): void {
  registerAddDoor(server, bridge, geometryScripts)
  registerAddWindow(server, bridge, geometryScripts)
}
