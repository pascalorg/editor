import type { LazyComponent, NodeDefinition } from '@pascal-app/core'

export const TOOL_OVERLAY_EXTENSION_KEY = 'pascal:editor/tool-overlay'

export type ToolOverlayExtension = {
  component: LazyComponent
}

export function getToolOverlayExtension(
  definition: NodeDefinition<any> | undefined,
): ToolOverlayExtension | undefined {
  return definition?.extensions?.[TOOL_OVERLAY_EXTENSION_KEY] as ToolOverlayExtension | undefined
}
