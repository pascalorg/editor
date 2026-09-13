import type { NodeDefinition } from '@pascal-app/core'
import { DEFAULT_SAG_RATIO, UtilityLineNode } from '../schema'
import { moveUtilityLineVertexAffordance } from './floorplan-affordances'
import { buildUtilityLineFloorplan } from './floorplan'

/**
 * `utility-line` — one site utility run.
 *
 * `floorplanScope: 'building'` is deliberate. These nodes are parented to
 * the BUILDING, not a level, for two reasons:
 *  - a service lateral is not a storey's property, and parenting it to level
 *    0 would hide it from every other level's plan;
 *  - `BuildingRenderer` renders `node.children` inside the building's
 *    transform group, which is the only 3D mount point that gives the run a
 *    correct world position without a level-elevation fudge.
 * `site-frame.ts` documents the SITE ⇄ building-local conversion both
 * builders apply.
 */
export const utilityLineDefinition: NodeDefinition<typeof UtilityLineNode> = {
  kind: 'utility-line',
  schemaVersion: 1,
  schema: UtilityLineNode,
  category: 'site',
  distributionRole: 'run',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
      preferredView: '2d',
    },
  },
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    system: 'power',
    routing: 'underground',
    path: [],
    sizeInches: null,
    material: null,
    label: '',
    fromRef: null,
    toRef: null,
    sagRatio: DEFAULT_SAG_RATIO,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
  },
  parametrics: {
    groups: [
      {
        label: 'Utility',
        fields: [
          {
            key: 'system',
            kind: 'enum',
            options: ['power', 'sewer', 'water', 'gas', 'comm', 'storm'],
          },
          {
            key: 'routing',
            kind: 'enum',
            options: ['overhead', 'underground'],
            display: 'segmented',
          },
          { key: 'sizeInches', label: 'Size (in)', kind: 'number', min: 0.25, max: 96, step: 0.25 },
          // `material` and `label` are free text, and the host parametric
          // descriptor has no 'text' field kind (ParametricField accepts
          // number | boolean | enum | custom | material | color | ref | vec3).
          // They are edited in the Utilities panel instead.
        ],
      },
      {
        label: 'Overhead',
        fields: [
          { key: 'sagRatio', label: 'Sag', kind: 'number', min: 0, max: 0.2, step: 0.005 },
        ],
      },
    ],
  },
  floorplan: buildUtilityLineFloorplan,
  floorplanScope: 'building',
  floorplanAffordances: {
    'move-utility-line-vertex': moveUtilityLineVertexAffordance,
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  toolHints: [
    { key: 'Left click', label: 'Add a run vertex' },
    { key: 'Double click / Enter', label: 'Finish the run' },
    { key: 'Alt', label: 'Ignore grid snap' },
    { key: 'Esc', label: 'Undo the last vertex, or cancel' },
    { key: 'Near a wall', label: 'A power overhead run ends on an electric meter there' },
  ],
  presentation: {
    label: 'Utility line',
    description:
      'A site utility run — power, sewer, water, gas, comm or storm, overhead or underground.',
    icon: { kind: 'iconify', name: 'lucide:cable' },
    hidden: true,
    actionMenu: false,
  },
  mcp: {
    description:
      'A site utility run. system: power | sewer | water | gas | comm | storm. routing: overhead | underground. path is a list of [x, y, z] vertices in SITE metres (x east, z south) whose y is measured FROM GRADE — negative for a buried cover, positive for an overhead attachment height. fromRef / toRef name the pole or service point at each end, and when set the FIRST / LAST vertex is DERIVED from that node at read time (a pole: the crossarm pin facing the run; a service point: its 3D anchor, lifted to the NEC 230.24(B)(1) 10 ft drip-loop height for an overhead run) — the stored vertex is ignored, so moving the pole or the meter moves the run and no stale copy is left in path. Only the intermediate vertices are stored geometry. sizeInches / material are the callout; sagRatio is the overhead display sag as a fraction of the span (a drawing default, not an engineered sag).',
  },
}
