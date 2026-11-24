import { RockNode } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildRockFloorplan } from './floorplan'
import { buildRockBakeGeometry, buildRockGeometry } from './geometry'

const DEFAULT_OUTLINE: [number, number][] = [
  [-1.5, 0],
  [-1, -1.2],
  [0.3, -1.5],
  [1.4, -0.7],
  [1.5, 0.5],
  [0.5, 1.3],
  [-0.8, 1.1],
]

/** Ground-relative rock mass; floors derive their holes without changing the rock's support. */
export const rockRenderDefinition: NodeRenderDefinition<typeof RockNode> & { kind: 'rock' } = {
  kind: 'rock',
  extensions: { 'pascal:viewer': { family: 'site' } },
  schemaVersion: 1,
  schema: RockNode,
  category: 'site',
  surfaceRole: 'floor',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...defaults
    } = RockNode.parse({ id: 'rock_default', polygon: DEFAULT_OUTLINE })
    return defaults
  },
  capabilities: {
    exterior: true,
    revealOnEdit: ['polygon', 'height', 'seed', 'rockType', 'weathering', 'form'],
    drawTool: true,
    selectable: { hitVolume: 'mesh' },
    deletable: true,
    duplicable: false,
    presettable: false,
    hostable: { parents: ['site'] },
    surfaces: { hosting: false },
  },
  geometry: buildRockGeometry,
  bakeGeometry: buildRockBakeGeometry,
  geometryChildTypes: [],
  floorplan: buildRockFloorplan,
  floorplanScope: 'site',
  sitePlan: true,
  system: { module: () => import('./system') },
  presentation: {
    label: 'Rock',
    description: 'A boulder or outcrop on the ground that can rise through floors.',
    icon: { kind: 'url', src: '/icons/garden-rock.webp' },
    cursorIcon: true,
    paletteSection: 'structure',
    paletteOrder: 77,
  },
  mcp: {
    description:
      'A natural rock mass within a polygon on the Site ground, with ground-relative height, deterministic seed, rockType (boulder, fjord, granite, volcanic, river, stacked or stepping), weathering, moss, form, strata and lichen. Floors it rises through derive matching holes.',
  },
}
