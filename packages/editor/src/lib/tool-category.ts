import { categoryOf, nodeRegistry, type VisibilityCategory } from '@pascal-app/core'
import type { Phase, Tool } from '../store/use-editor'

/**
 * The {@link VisibilityCategory} a build tool would create, used to gate
 * placement against `lockedCategories`. Registered kinds (walls, doors,
 * columns, slabs, zone, roof, and every warehouse plugin kind) resolve through
 * the registry, so a tool whose id IS a node kind is authoritative. The few
 * legacy tool ids that are not node kinds are mapped by name, and `phase` is
 * the coarse fallback (site / structure / furnish align to the categories).
 *
 * Returns `null` when there is no active tool.
 */
export function categoryOfActiveTool(phase: Phase, tool: Tool | null): VisibilityCategory | null {
  if (!tool) return null
  // A tool id that is a registered node kind carries its own category
  // (wall → structure, zone → zone, warehouse:pallet-rack → furnish, …).
  if (nodeRegistry.has(tool)) return categoryOf(tool)
  // Legacy tools whose id is not a node kind.
  if (tool === 'property-line') return 'site'
  if (tool === 'zone') return 'zone'
  if (phase === 'site') return 'site'
  if (phase === 'furnish') return 'furnish'
  return 'structure'
}
