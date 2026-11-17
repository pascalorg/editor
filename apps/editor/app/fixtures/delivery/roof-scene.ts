import { BuildingNode, LevelNode, RoofNode, RoofSegmentNode } from '@pascal-app/core/schema'
import type { SceneGraph } from '@pascal-app/editor'

const cases = {
  hip: { roofType: 'hip' },
  gable: { roofType: 'gable' },
  shed: { roofType: 'shed' },
  gambrel: { roofType: 'gambrel' },
  dutch: { roofType: 'dutch' },
  mansard: { roofType: 'mansard' },
  flat: { roofType: 'flat' },
  conical: { roofType: 'conical', depth: 8 },
  barrel: { roofType: 'barrel', barrelRise: 1.4, barrelSegments: 8 },
  'transformed-gable': { roofType: 'gable' },
  'trimmed-hip': { roofType: 'hip', trim: { left: 0.8, frontRight: 1.2 } },
  'glazed-gable': {
    roofType: 'gable',
    roofSystem: 'glazed',
    glazing: {
      across: { layout: 'count', count: 3 },
      along: { layout: 'count', count: 2 },
      panels: [{ face: 'front', column: 1, row: 0, type: 'empty' }],
    },
  },
  'glazed-shed': { roofType: 'shed', roofSystem: 'glazed' },
  'glazed-barrel': {
    roofType: 'barrel',
    roofSystem: 'glazed',
    barrelRise: 1.4,
    barrelSegments: 8,
  },
  // Existing roof-system.test.ts thin-band fixture: radii 3..5, not a filled disc.
  'curved-shed': {
    roofType: 'shed',
    depth: 2,
    wallHeight: 0,
    wallThickness: 0.01,
    pitch: 10,
    overhang: 0,
    shingleThickness: 0.025,
    arc: { centerX: 0, centerZ: 4, radius: 5 },
  },
} as const

export type RoofFixtureCase = keyof typeof cases
export const roofFixtureCases = Object.keys(cases) as RoofFixtureCase[]

export function roofFixture(caseId: RoofFixtureCase) {
  if (!Object.hasOwn(cases, caseId)) throw new Error(`Unknown roof fixture: ${caseId}`)
  const transformed = caseId === 'transformed-gable'
  const building = BuildingNode.parse({
    id: 'building_roof-fixture',
    children: ['level_roof-fixture'],
    position: transformed ? [10, 2, -6] : [0, 0, 0],
    rotation: transformed ? [0, Math.PI / 2, 0] : [0, 0, 0],
  })
  const level = LevelNode.parse({
    id: 'level_roof-fixture',
    parentId: building.id,
    children: [`roof_fixture-${caseId}`],
    level: 0,
    height: 3,
    name: 'Roof fixture',
  })
  const roof = RoofNode.parse({
    id: `roof_fixture-${caseId}`,
    parentId: level.id,
    children: [`rseg_fixture-${caseId}`],
    position: transformed ? [2, 0.5, -1] : [0, 0, 0],
    rotation: transformed ? Math.PI / 6 : 0,
  })
  const segment = RoofSegmentNode.parse({
    id: `rseg_fixture-${caseId}`,
    parentId: roof.id,
    name: `Fixture ${caseId}`,
    width: 8,
    depth: 6,
    pitch: 32,
    wallHeight: 0.5,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    overhang: 0.3,
    ...cases[caseId],
    position: transformed ? [-1, 0.75, 1] : [0, 0, 0],
    rotation: transformed ? -Math.PI / 4 : 0,
  })
  const scene: SceneGraph = {
    nodes: Object.fromEntries([building, level, roof, segment].map((node) => [node.id, node])),
    rootNodeIds: [building.id],
    installedPlugins: ['pascal:core'],
  }
  // Analytic composition of the authored translations/yaws, not the roof seating helper.
  const center = transformed ? [10.36602540378444, 3.25, -7.63397459621556] : [0, 0, 0]
  const camera = {
    position: [center[0]! + 10, center[1]! + 8, center[2]! + 11] as [number, number, number],
    target: [center[0]!, center[1]! + 1, center[2]!] as [number, number, number],
  }
  return {
    scene,
    caseId,
    roofId: roof.id,
    segmentId: segment.id,
    roofType: segment.roofType,
    independent: segment.roofType === 'barrel' || segment.roofSystem === 'glazed',
    camera,
  }
}
