import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type SceneViewCrop,
  type SceneViewPose,
  sceneViewNote,
  sceneViewPlan,
} from '@pascal-app/core/agent-operations'
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
 * `editor_tab_required` when none answers.
 */
export type SceneViewHost = {
  capture(request: {
    projectId: string
    pose: SceneViewPose
    size: { w: number; h: number }
  }): Promise<SceneViewCapture>
  /** Crops the reference photo to a region; without it a view with a photo is refused. */
  crop?(
    request: SceneViewCrop,
  ): Promise<{ image: Uint8Array; mimeType: string; width: number; height: number }>
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
        const { pose, size, crop } = sceneViewPlan(
          operations.getNodes() as Record<string, AnyNode>,
          input,
        )
        if (crop && !views!.crop)
          refuse(
            'photo_crop_unavailable',
            'This Pascal server cannot crop a photo: crop the region yourself and lay it beside the view.',
          )
        const [shot, cropped] = await Promise.all([
          views!.capture({ projectId: projectId!, pose, size }),
          crop ? views!.crop!(crop) : undefined,
        ])
        const payload = {
          status: 'viewed',
          camera: pose,
          size: { width: shot.width, height: shot.height },
          tab: shot.tab,
          capturedAt: shot.capturedAt,
          note: sceneViewNote(),
          ...(crop && cropped
            ? {
                photoRegion: crop.region,
                photoCropSize: { width: cropped.width, height: cropped.height },
              }
            : {}),
        }
        const image = (data: Uint8Array, mimeType: string) => ({
          type: 'image' as const,
          data: Buffer.from(data).toString('base64'),
          mimeType,
        })
        return {
          content: cropped
            ? [
                { type: 'text' as const, text: JSON.stringify(payload) },
                { type: 'text' as const, text: 'The model, from the view:' },
                image(shot.image, shot.mimeType),
                { type: 'text' as const, text: 'The photo, cropped to the region:' },
                image(cropped.image, cropped.mimeType),
              ]
            : [
                image(shot.image, shot.mimeType),
                { type: 'text' as const, text: JSON.stringify(payload) },
              ],
        }
      } catch (error) {
        return refusalResult(error)
      }
    },
  )
}
