import type { Tool } from '../store/use-editor'
import useEditor from '../store/use-editor'

/**
 * Drop a draw tool's staged parameters, but only when the tool has really
 * been deactivated.
 *
 * Every drawn kind clears its `toolDefaults` entry on unmount so a preset
 * placed once doesn't build the next freehand instance. Done unconditionally,
 * that cleanup also fires under React StrictMode, which mounts each effect,
 * tears it down, and mounts it again — wiping the entry `setTool` had just
 * seeded, moments before the tool reads it. The symptom is dev-only and
 * silent: the tool simply draws at its fallback dimensions.
 *
 * Checking the active tool separates the two cases. A StrictMode remount
 * leaves `tool` pointing at this same tool, so the entry survives; a real
 * switch has already moved `tool` on by the time the old tool unmounts, so
 * the entry is cleared as before.
 */
export function clearToolDefaultsOnDeactivate(tool: Tool): void {
  const editor = useEditor.getState()
  if (editor.tool !== tool) editor.setToolDefaults(tool, null)
}
