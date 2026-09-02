/**
 * Node definitions for the three paper kinds.
 *
 * Deliberately minimal: no `renderer`, no `geometry`, no `floorplan`, no
 * `capabilities.movable`. The 3D viewer mounts a renderer only when
 * `def.renderer` is set and the 2D floor plan draws a node only when
 * `def.floorplan` is set, so these have zero presence in either view — the
 * same trick `bones:framing` uses for its config node. `dirtyTracking: false`
 * keeps them out of the per-frame rebuild queue (nothing consumes their
 * dirty marks).
 */
import type { NodeDefinition } from '@pascal-app/core'
import { DEFAULT_VIEWPORT_LAYERS, ProjectRecordNode, SheetNode, ViewportNode } from './schema'

type AnyDef = NodeDefinition<never> & Record<string, unknown>

const paperBase = {
  schemaVersion: 1,
  category: 'analysis' as const,
  dirtyTracking: false,
  bake: 'strip' as const,
  capabilities: { deletable: true },
}

export const projectRecordDefinition = {
  ...paperBase,
  kind: 'sheets:project-record',
  schema: ProjectRecordNode,
  defaults: () => ({
    object: 'node' as const,
    parentId: null,
    visible: true,
    metadata: {},
    identity: {
      projectName: '',
      projectNumber: '',
      apn: '',
      address: { street: '', city: '', state: '', zip: '' },
    },
    designer: { name: '', license: '' },
    firm: { company: '', phone: '', email: '', logoText: '' },
    owner: { name: '' },
    engineer: { company: '', license: '' },
    jurisdiction: { city: '', county: '', state: '' },
    documentStatus: 'preliminary' as const,
    revisions: [],
    date: '',
    drawnBy: '',
  }),
  presentation: {
    label: 'Project record',
    description: 'Who, where, for whom — everything the title block prints. One per scene.',
    icon: { kind: 'iconify', name: 'lucide:building-2' },
    hidden: true,
  },
  mcp: {
    description:
      'The project record for the construction set (one per scene, child of the site). Identity (project name/number, APN, site address), designer, firm, owner, engineer, jurisdiction, documentStatus (preliminary | permit-set | construction-set), revisions, date and drawnBy. Read and written by the Sheets workspace title block.',
  },
} as unknown as AnyDef

export const sheetDefinition = {
  ...paperBase,
  kind: 'sheets:sheet',
  schema: SheetNode,
  defaults: () => ({
    object: 'node' as const,
    parentId: null,
    visible: true,
    metadata: {},
    number: 'A0.0',
    title: 'Untitled sheet',
    size: 'arch-d' as const,
    order: 0,
    items: [],
  }),
  presentation: {
    label: 'Sheet',
    description: 'One sheet of paper in the construction set.',
    icon: { kind: 'iconify', name: 'lucide:file-text' },
    hidden: true,
  },
  mcp: {
    description:
      'A sheet of paper in the construction set: number (A2.1), title, size (arch-d 36x24in | arch-c 24x18in | tabloid 17x11in), order, and the viewport ids drawn on it.',
  },
} as unknown as AnyDef

export const viewportDefinition = {
  ...paperBase,
  kind: 'sheets:viewport',
  schema: ViewportNode,
  defaults: () => ({
    object: 'node' as const,
    parentId: null,
    visible: true,
    metadata: {},
    sheetId: '',
    kind: 'plan' as const,
    x: 1,
    y: 1,
    w: 12,
    h: 9,
    scale: 48,
    layers: DEFAULT_VIEWPORT_LAYERS,
    title: '',
    text: '',
    dataUrl: '',
  }),
  presentation: {
    label: 'Viewport',
    description: 'A live window onto the model, placed on a sheet at a drawing scale.',
    icon: { kind: 'iconify', name: 'lucide:scan-search' },
    hidden: true,
  },
  mcp: {
    description:
      'A viewport on a sheet: kind (plan | site-plan | section | elevation | view3d | schedule | notes | image), x/y/w/h in sheet inches from the paper top-left, scale as a world:paper ratio (48 = 1/4"=1\'-0"), levelId, drawingType, markerId, direction, per-viewport layer visibility, title, optional world crop, and the kind-specific payload (pose, scheduleOf, text, dataUrl).',
  },
} as unknown as AnyDef

export const sheetsNodeDefinitions: AnyDef[] = [
  projectRecordDefinition,
  sheetDefinition,
  viewportDefinition,
]
