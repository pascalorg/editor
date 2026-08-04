import type { NodeDefinition } from '@pascal-app/core/registry'
import { buildFormworkGeometry } from './geometry'
import { formworkAssemblyParametrics } from './parametrics'
import { FormworkAssemblyNode } from './schema'

/**
 * One formwork assembly — the shutter for a single (element × segment × lift).
 * Three-checkbox model: `geometry` only, no renderer/tool/floorplan — same
 * shape as fence/shelf. Never placed by hand (`presentation.hidden: true`);
 * created by `buildFormworkNode()` (see attach.ts) from the wall, column or slab
 * panel's "Add formwork geometry" button or the AI chat tool. See
 * `wiki/formwork-system-plan.md`.
 */
export const formworkAssemblyDefinition: NodeDefinition<typeof FormworkAssemblyNode> = {
  kind: 'formwork-assembly',
  schemaVersion: 2,
  category: 'structure',
  schema: FormworkAssemblyNode,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    segmentIndex: 0,
    liftIndex: 0,
    panelWidth: 0.6,
    fillerPosition: 'middle',
    avoidedPanelIds: [],
    designOverrides: {},
    partOverrides: {},
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
  },

  geometry: buildFormworkGeometry,
  // No `geometryKey`: every geometry input except `panelWidth` lives outside
  // this node — on the host (`formworkType`, `tieSpacing`, `walerSpacing`,
  // `scaffoldRequired`, its own dimensions, `castOrder`, `pourId`,
  // `formworkMode`) and on its neighbours, whose cast order decides which faces
  // get shuttered. `registry/types.ts` reserves the key for kinds whose geometry
  // depends only on their own fields. Keying on `[parentId, panelWidth]` made
  // `<GeometrySystem>` skip the rebuild and clear the dirty flag, so editing tie
  // spacing silently did nothing.

  parametrics: formworkAssemblyParametrics,

  presentation: {
    label: 'Formwork',
    icon: { kind: 'iconify', name: 'lucide:grid-3x3' },
    hidden: true,
  },

  mcp: {
    description:
      "One formwork assembly — the shutter for a single pour segment and lift of a wall, column or slab, generated from the host's formworkType/tieSpacing/walerSpacing fields. The parts differ per kind: a wall gets panels, walers and through-ties; a column a clamped box or a wrapped shaft; a slab a propped soffit deck plus edge forms. Attached to a host element, not placed by hand.",
  },
}
