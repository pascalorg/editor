import { type NodeDefinition, BoxVentNode as BoxVentNodeSchema } from '@pascal-app/core'
import { boxVentParametrics } from './parametrics'
import { BoxVentNode } from './schema'

/**
 * Box vent — a small louvered ventilation box that sits on a roof
 * slope. Parented to a `roof-segment`; position is segment-local;
 * rotation rotates the vent around the segment's vertical axis after
 * the slope tilt is applied.
 *
 * Composition (three-checkbox model):
 *  - **`renderer` (custom)** — the box-vent needs the parent segment's
 *    position + rotation + slope geometry to position itself, and the
 *    registry-era roof-segment renderer doesn't auto-nest children
 *    (its mesh is filled by `RoofSystem`). The custom renderer reads
 *    the segment from `useScene`, applies the transform stack, and
 *    follows the segment's `useLiveTransforms` override during a
 *    parent drag.
 *  - **no `geometry`** — geometry is created inside the renderer via
 *    the shared pure builder in `./geometry`. We could lift it to
 *    `def.geometry` once roof-segment migrates to the parametric path
 *    (Phase 5 Stage B); for now keeping it inside the renderer
 *    matches the legacy mount semantics one-for-one.
 *  - **no `system`** — no animations, no cross-kind cascades.
 *
 * The bespoke move flow (segment-hopping with hit-tests against every
 * sibling roof-segment) ports later as `affordanceTools.move`. The
 * placement `def.tool` listens to `roof:*` events and creates a new
 * vent on click.
 */
export const boxVentDefinition: NodeDefinition<typeof BoxVentNode> = {
  kind: 'box-vent',
  schemaVersion: 1,
  schema: BoxVentNode,
  category: 'structure',

  defaults: () => {
    const stub = BoxVentNodeSchema.parse({ id: 'bvent_default' as never, type: 'box-vent' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // slope — no `buildCut`, just the dirty cascade so the parent
    // roof's merged shell rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },

  parametrics: boxVentParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place box vent on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Box Vent',
    description: 'Small louvered exhaust vent that sits on a roof slope.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 120,
  },

  mcp: {
    description:
      'A louvered box vent sitting on a roof segment. Style: standard / low-profile / dome. Width/depth/height/hoodOverhang parametric.',
  },
}
