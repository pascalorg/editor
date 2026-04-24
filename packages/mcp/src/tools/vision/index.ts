import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../../bridge/scene-bridge'
import { registerAnalyzeFloorplanImage } from './analyze-floorplan-image'
import { registerAnalyzeRoomPhoto } from './analyze-room-photo'

/**
 * Register the vision-input tools that defer to the MCP host's sampling
 * capability. No vision model is bundled in this package — if the host does
 * not advertise `sampling` support, calling either tool returns
 * `sampling_unavailable`.
 */
export function registerVisionTools(server: McpServer, bridge: SceneBridge): void {
  registerAnalyzeFloorplanImage(server, bridge)
  registerAnalyzeRoomPhoto(server, bridge)
}

export {
  analyzeFloorplanImageInput,
  analyzeFloorplanImageOutput,
  registerAnalyzeFloorplanImage,
} from './analyze-floorplan-image'
export {
  analyzeRoomPhotoInput,
  analyzeRoomPhotoOutput,
  registerAnalyzeRoomPhoto,
} from './analyze-room-photo'
