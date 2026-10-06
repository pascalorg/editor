import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type SceneViewPose, sceneViewNote, sceneViewPlan } from '@pascal-app/core/agent-operations'
import { refuse, viewSceneTool } from '@pascal-app/core/agent-tools'
import type { AnyNode } from '@pascal-app/core/schema'
import type { SceneOperations } from '../operations'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult } from './errors'

/** A picture of the scene, rendered by an editor tab open on the project. */
export type SceneViewCapture = {
  image: Uint8Array
  mimeType: string
  width: number
  height: number
  /** Which tab rendered it, and when: the scene as that tab showed it then. */
  tab: string
  capturedAt: string
}

/**
 * Asks an editor open on the project for a picture, the MCP having no renderer of its own. Refuses
 * `no_editor_open` when none answers.
 */
export type SceneViewHost = {
  capture(request: {
    projectId: string
    pose: SceneViewPose
    size: { w: number; h: number }
  }): Promise<SceneViewCapture>
}

export function registerViewScene(
  server: McpServer,
  operations: SceneOperations,
  views?: SceneViewHost,
) {
  server.registerTool(
    viewSceneTool.name,
    {
      title: viewSceneTool.title,
      description: viewSceneTool.description,
      inputSchema: viewSceneTool.input,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (input) => {
      try {
        if (!views)
          refuse(
            'view_unavailable',
            'This Pascal server has no editor to render with: take sizes and counts from the tools.',
          )
        const projectId = operations.getActiveScene()?.projectId
        if (!projectId)
          refuse('no_project', 'This session has no project open to look at: load or create one.')
        const { pose, size } = sceneViewPlan(
          operations.getNodes() as Record<string, AnyNode>,
          input,
        )
        const shot = await views!.capture({ projectId: projectId!, pose, size })
        const payload = {
          status: 'viewed',
          camera: pose,
          size: { width: shot.width, height: shot.height },
          tab: shot.tab,
          capturedAt: shot.capturedAt,
          note: sceneViewNote(),
        }
        return {
          content: [
            {
              type: 'image' as const,
              data: Buffer.from(shot.image).toString('base64'),
              mimeType: shot.mimeType,
            },
            { type: 'text' as const, text: JSON.stringify(payload) },
          ],
        }
      } catch (error) {
        return refusalResult(error)
      }
    },
  )
}
