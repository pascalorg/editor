import { BuildingNode, LevelNode, SiteNode, SlabNode } from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

function lawnScene(): SceneGraph {
  const site = SiteNode.parse({
    id: 'site_lawn', children: ['building_lawn'],
    polygon: { type: 'polygon', points: [[-50, -50], [50, -50], [50, 50], [-50, 50]] },
  })
  const building = BuildingNode.parse({
    id: 'building_lawn', parentId: site.id, children: ['level_lawn'],
    position: [10, 0, 20], rotation: [0, Math.PI / 2, 0],
  })
  const level = LevelNode.parse({ id: 'level_lawn', parentId: building.id, level: 0 })
  return { nodes: { [site.id]: site, [building.id]: building, [level.id]: level }, rootNodeIds: [site.id] }
}

const corners = [[0, 0], [4, 3]]
const strokes = [{ points: [[1, 1], [2, 1]], radiusM: 0.5, effect: 'bare', strength: 1 }]

export const LAWN_CASES: AgentToolCase[] = [
  {
    name: 'a new lawn is one compact Site child with authored brush data and no fake slab ID',
    tool: 'add_site_surface', scene: lawnScene,
    input: { kind: 'lawn', siteId: 'site_lawn', corners, strokes },
    expect: {
      result: { ok: true, kind: 'lawn', siteId: 'site_lawn', requestedAreaM2: 12, retainedAreaM2: 12, coverageFraction: 1, flowerCount: 0, gen: 1 },
      check: (result, nodes) => {
        const lawn = typeof result.lawnId === 'string' ? nodes[result.lawnId] : undefined
        const problems: string[] = []
        if (lawn?.type !== 'lawn') return ['no core lawn created']
        if (lawn.parentId !== 'site_lawn') problems.push('lawn is not Site-owned')
        if (JSON.stringify(lawn.strokes) !== JSON.stringify(strokes)) problems.push('brush intent changed')
        if ('slabId' in result) problems.push('lawn result pretends to be a slab')
        if (!Number.isFinite(result.bladeCount)) problems.push('missing factual blade count')
        if (Object.values(nodes).some(node => node.type === 'slab')) problems.push('created a cosmetic slab')
        return problems
      },
    },
  },
  {
    name: 'a level-frame lawn transforms its outline and brush into the Site exactly once',
    tool: 'add_site_surface', scene: lawnScene,
    input: { kind: 'lawn', levelId: 'level_lawn', corners, strokes },
    expect: {
      result: { kind: 'lawn', siteId: 'site_lawn', requestedAreaM2: 12, retainedAreaM2: 12 },
      check: (result, nodes) => {
        const lawn = typeof result.lawnId === 'string' ? nodes[result.lawnId] : undefined
        if (lawn?.type !== 'lawn') return ['no core lawn created']
        const expected = [[10, 20], [10, 16], [13, 16], [13, 20]]
        const aligned = lawn.outline.every((point, index) => point.every((value, axis) => Math.abs(value - (expected[index]?.[axis] ?? NaN)) < 1e-9))
        const point = lawn.strokes[0]?.points[0]
        return aligned && point && Math.abs(point[0] - 11) < 1e-9 && Math.abs(point[1] - 19) < 1e-9 ? [] : ['outline or stroke is not in the Site frame']
      },
    },
  },
  {
    name: 'a partially outside lawn reports lost property area rather than moving the outline',
    tool: 'add_site_surface', scene: lawnScene,
    input: { kind: 'lawn', siteId: 'site_lawn', corners: [[48, 0], [52, 3]] },
    expect: { result: { requestedAreaM2: 12, retainedAreaM2: 6, coverageFraction: 0.5, excludedUnionAreaM2: 6 } },
  },
  {
    name: 'new core lawn does not reinterpret an existing flat lawn slab',
    tool: 'add_site_surface',
    scene: () => {
      const graph = lawnScene()
      const slab = SlabNode.parse({ id: 'slab_legacy_lawn', parentId: 'level_lawn', polygon: [[20, 20], [22, 20], [22, 22], [20, 22]], elevation: 0.01, metadata: { flatwork: 'lawn' }, materialPreset: 'library:preset-lawn' })
      graph.nodes[slab.id] = slab
      const level = graph.nodes.level_lawn
      if (level?.type !== 'level') throw new Error('Expected lawn level')
      graph.nodes[level.id] = { ...level, children: [...level.children, slab.id] }
      return graph
    },
    input: { kind: 'lawn', siteId: 'site_lawn', corners },
    expect: { result: { kind: 'lawn' }, after: { slab_legacy_lawn: { type: 'slab', elevation: 0.01, metadata: { flatwork: 'lawn' }, materialPreset: 'library:preset-lawn' } } },
  },
  ...[
    { name: 'conflicting Site and level targets', fields: { siteId: 'site_lawn', levelId: 'level_lawn' }, code: 'lawn_target_conflict' },
    { name: 'a paving material requested for lawn', fields: { siteId: 'site_lawn', materialPreset: 'library:preset-lawn' }, code: 'lawn_material_unsupported' },
    { name: 'both lawn shape forms', fields: { siteId: 'site_lawn', polygon: [[0, 0], [4, 0], [4, 3]] }, code: 'lawn_outline_required' },
    { name: 'no matching Site', fields: { siteId: 'site_missing' }, code: 'no_site' },
    { name: 'nothing retained inside the Site', fields: { siteId: 'site_lawn', corners: [[70, 0], [74, 3]] }, code: 'lawn_empty' },
    { name: 'a thin L exceeding the candidate work cap', fields: { siteId: 'site_lawn', corners: undefined, polygon: [[-49, -49], [49, -49], [49, -48.9], [-48.9, -48.9], [-48.9, 49], [-49, 49]] }, code: 'lawn_work_budget' },
  ].map(({ name, fields, code }): AgentToolCase => ({
    name: `lawn refuses before writes: ${name}`, tool: 'add_site_surface', scene: lawnScene,
    input: { kind: 'lawn', corners, ...fields }, expect: { refusal: code },
  })),
]
