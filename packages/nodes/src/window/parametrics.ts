import type { AnyNode, AnyNodeId, ParametricDescriptor } from '@pascal-app/core'
import { unwrapCorner } from '@pascal-app/core/building'
import type { WindowNode } from './schema'

/**
 * Minimal inspector descriptor for window. Like door, the legacy
 * `<WindowPanel>` has 15+ SliderControls covering sashes, dividers,
 * sill, frame, opening shape — too elaborate for the auto-inspector
 * at Stage A. Legacy panel keeps rendering via panel-manager's
 * `case 'window':`.
 */
export const windowParametrics: ParametricDescriptor<WindowNode> = {
  // One side of a corner window deleted: the other is a plain window again, framed at the corner.
  onDelete: (node, nodes) =>
    Object.entries(unwrapCorner(nodes, node.id)).map(([id, data]) => ({
      id: id as AnyNodeId,
      data: data as Partial<AnyNode>,
    })),
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 1000, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.3, max: 1000, step: 0.05 },
      ],
    },
  ],
  // Stage E — kind-owned panel mounted by <ParametricInspector>. Window
  // has 15+ controls (sashes, dividers, sill, frame, opening shape)
  // that don't fit the generic auto-inspector.
  customPanel: () => import('./panel'),
}
