/**
 * 'general-notes' sheet drawing provider — STUB. Returns null (the viewport prints
 * "general-notes — nothing to draw") until the owning workstream lands it.
 *
 * Contract: `(nodes, args: ProviderArgs) => DrawingResult | null` — world
 * metres in `primitives`/`bounds` for the live window, and/or absolute
 * sheet-inch geometry in `plate` laid out inside `args.viewport`.
 */
import type { DrawingProvider, DrawingResult, ProviderArgs } from '../drawings'
import type { NodeMap } from '../model'

export function buildGeneralNotesDrawing(_nodes: NodeMap, _args: ProviderArgs): DrawingResult | null {
  return null
}

export function registerGeneralNotesProvider(
  register: (key: string, provider: DrawingProvider) => void,
): void {
  register('general-notes', (nodes, args) => buildGeneralNotesDrawing(nodes, args as unknown as ProviderArgs))
}
