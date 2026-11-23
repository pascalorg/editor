import type { ColumnNode } from '@pascal-app/core'

export function isManagedColumn(node: ColumnNode): boolean {
  return node.metadata?.managedByLeanTo !== undefined && node.metadata?.leanToRole === 'post'
}

const managedFields = new Set<keyof ColumnNode>([
  'position',
  'height',
  'width',
  'depth',
  'radius',
  'crossSection',
  'baseStyle',
  'baseHeight',
  'baseWidthScale',
  'baseDepthScale',
  'slots',
])

/** Normalize edits, not loaded scenes: legacy independent dimensions remain readable. */
export function columnEditPatch(
  node: ColumnNode,
  updates: Partial<ColumnNode>,
): Partial<ColumnNode> {
  const patch = { ...updates }
  if (!node.source && (patch.supportStyle ?? node.supportStyle) === 'vertical') {
    const section = patch.crossSection ?? node.crossSection
    if (['round', 'octagonal', 'sixteen-sided'].includes(section)) {
      if (patch.radius !== undefined && patch.width === undefined) {
        patch.width = patch.radius * 2
        patch.depth = patch.radius * 2
      } else if (patch.width !== undefined || patch.crossSection !== undefined) {
        patch.radius = (patch.width ?? node.width) / 2
        patch.depth = patch.width ?? node.width
      }
    } else if (
      section === 'square' &&
      (patch.width !== undefined || patch.depth !== undefined || patch.crossSection !== undefined)
    ) {
      patch.width = patch.width ?? patch.depth ?? node.width
      patch.depth = patch.width
      patch.radius = patch.width / 2
    }
  }
  if (isManagedColumn(node)) for (const key of managedFields) delete patch[key]
  return patch
}
