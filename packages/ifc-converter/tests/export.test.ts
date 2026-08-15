import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import * as WebIFC from 'web-ifc'
import {
  convertPascalToIfc,
  convertPascalToIfcText,
  type IfcExportOptions,
  type IfcExportScene,
} from '../src/export'

const nodes = {
  site_1: {
    object: 'node',
    id: 'site_1',
    type: 'site',
    name: 'Ankara Site',
    parentId: null,
    visible: true,
    polygon: {
      type: 'polygon',
      points: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    },
    children: ['building_1'],
  },
  building_1: {
    object: 'node',
    id: 'building_1',
    type: 'building',
    name: 'Office',
    parentId: 'site_1',
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: ['level_1'],
  },
  level_1: {
    object: 'node',
    id: 'level_1',
    type: 'level',
    name: 'Zemin Katı',
    parentId: 'building_1',
    visible: true,
    level: 0,
    baseElevation: 0,
    height: 3,
    children: [
      'wall_1',
      'slab_1',
      'ceiling_1',
      'column_1',
      'roof_1',
      'stair_1',
      'zone_1',
      'duct-segment_1',
      'pipe-segment_1',
    ],
  },
  wall_1: {
    object: 'node',
    id: 'wall_1',
    type: 'wall',
    name: 'External Wall',
    parentId: 'level_1',
    visible: true,
    start: [0, 0],
    end: [5, 0],
    thickness: 0.2,
    height: 3,
    frontSide: 'exterior',
    backSide: 'interior',
    children: ['door_1', 'window_1'],
    slots: { interior: 'scene:mat_concrete' },
  },
  door_1: {
    object: 'node',
    id: 'door_1',
    type: 'door',
    name: 'Entry Door',
    parentId: 'wall_1',
    wallId: 'wall_1',
    visible: true,
    position: [2, 1.05, 0],
    rotation: [0, 0, 0],
    width: 0.9,
    height: 2.1,
  },
  window_1: {
    object: 'node',
    id: 'window_1',
    type: 'window',
    name: 'Office Window',
    parentId: 'wall_1',
    wallId: 'wall_1',
    visible: true,
    position: [3.5, 1.5, 0],
    rotation: [0, 0, 0],
    width: 1.2,
    height: 1.2,
  },
  slab_1: {
    object: 'node',
    id: 'slab_1',
    type: 'slab',
    name: 'Floor',
    parentId: 'level_1',
    visible: true,
    polygon: [
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ],
    holes: [],
    elevation: 0.2,
    thickness: 0.2,
  },
  ceiling_1: {
    object: 'node',
    id: 'ceiling_1',
    type: 'ceiling',
    name: 'Ceiling',
    parentId: 'level_1',
    visible: true,
    polygon: [
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ],
    holes: [],
    height: 2.8,
  },
  column_1: {
    object: 'node',
    id: 'column_1',
    type: 'column',
    name: 'Column',
    parentId: 'level_1',
    visible: true,
    position: [1, 0, 1],
    rotation: 0,
    crossSection: 'round',
    radius: 0.2,
    width: 0.4,
    depth: 0.4,
    height: 3,
  },
  roof_1: {
    object: 'node',
    id: 'roof_1',
    type: 'roof',
    name: 'Roof',
    parentId: 'level_1',
    visible: true,
    position: [0, 3, 0],
    rotation: 0,
    children: ['roof-segment_1'],
  },
  'roof-segment_1': {
    object: 'node',
    id: 'roof-segment_1',
    type: 'roof-segment',
    name: 'Gable Roof Segment',
    parentId: 'roof_1',
    visible: true,
    position: [2.5, 0, 2],
    rotation: 0,
    roofType: 'gable',
    width: 5,
    depth: 4,
    wallHeight: 0.4,
    pitch: 30,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    children: [],
  },
  stair_1: {
    object: 'node',
    id: 'stair_1',
    type: 'stair',
    name: 'Stair',
    parentId: 'level_1',
    visible: true,
    position: [2, 0, 2],
    rotation: 0,
    stairType: 'straight',
    children: ['stair-segment_1'],
  },
  'stair-segment_1': {
    object: 'node',
    id: 'stair-segment_1',
    type: 'stair-segment',
    name: 'Straight Flight',
    parentId: 'stair_1',
    visible: true,
    position: [0, 0, 0],
    rotation: 0,
    segmentType: 'stair',
    width: 1,
    length: 3,
    height: 2.5,
    stepCount: 10,
    attachmentSide: 'front',
    fillToFloor: true,
    thickness: 0.25,
  },
  zone_1: {
    object: 'node',
    id: 'zone_1',
    type: 'zone',
    name: 'Meeting Room',
    parentId: 'level_1',
    visible: true,
    polygon: [
      [0.2, 0.2],
      [4.8, 0.2],
      [4.8, 3.8],
      [0.2, 3.8],
    ],
    spaceRole: 'room',
    roomNumber: '101',
    ceilingHeight: 2.8,
  },
  'duct-segment_1': {
    object: 'node',
    id: 'duct-segment_1',
    type: 'duct-segment',
    name: 'Supply Duct',
    parentId: 'level_1',
    visible: true,
    path: [
      [0, 2.6, 0],
      [2, 2.6, 0],
      [2, 2.6, 2],
    ],
    shape: 'round',
    diameter: 8,
    roll: 0,
  },
  'pipe-segment_1': {
    object: 'node',
    id: 'pipe-segment_1',
    type: 'pipe-segment',
    name: 'Waste Pipe',
    parentId: 'level_1',
    visible: true,
    path: [
      [0, -0.2, 0],
      [2, -0.25, 0],
    ],
    diameter: 2,
  },
} as unknown as Record<AnyNodeId, AnyNode>

const scene: IfcExportScene = {
  nodes,
  rootNodeIds: ['site_1'] as AnyNodeId[],
  materials: {
    mat_concrete: {
      id: 'mat_concrete',
      name: 'Cast Concrete',
      material: { preset: 'concrete' },
    },
  },
}

const options: IfcExportOptions = {
  author: 'Pascal Test',
  fileName: 'test.ifc',
  projectName: 'IFC Export Test',
  timestamp: '2026-08-15T12:00:00Z',
}

describe('convertPascalToIfc', () => {
  const ifcApi = new WebIFC.IfcAPI()

  beforeAll(async () => {
    await ifcApi.Init()
  })

  afterAll(() => {
    ifcApi.Dispose()
  })

  it('writes a deterministic IFC4 STEP document', () => {
    const first = convertPascalToIfcText(scene, options)
    const second = convertPascalToIfcText(scene, options)

    expect(first).toBe(second)
    expect(first).toContain("FILE_SCHEMA(('IFC4'))")
    expect(first).toContain('IFCRELVOIDSELEMENT')
    expect(first).toContain('IFCRELFILLSELEMENT')
    expect(first).toContain('IFCTRIANGULATEDFACESET')
    expect(first).toContain("'Pset_WallCommon'")
    expect(first).toContain("IFCMATERIAL('Cast Concrete',$,$)")
    expect(first).toContain('Zemin Kat\\X2\\0131\\X0\\')
  })

  it('produces a model web-ifc can reopen with hierarchy, geometry, and semantics', () => {
    const bytes = convertPascalToIfc(scene, options)
    const modelId = ifcApi.OpenModel(bytes)

    try {
      expect(ifcApi.GetModelSchema(modelId)).toBe('IFC4')
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCPROJECT).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCSITE).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCBUILDING).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCBUILDINGSTOREY).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCWALL).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCDOOR).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCWINDOW).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCSLAB).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCCOVERING).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCCOLUMN).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCROOF).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCSTAIR).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCSPACE).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCDUCTSEGMENT).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCPIPESEGMENT).size()).toBe(1)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCRELVOIDSELEMENT).size()).toBe(2)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCRELFILLSELEMENT).size()).toBe(2)
      expect(ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCTRIANGULATEDFACESET).size()).toBe(1)

      const wallId = ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCWALL).get(0)
      expect(ifcApi.GetLine(modelId, wallId).Name.value).toBe('External Wall')
      const roofId = ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCROOF).get(0)
      const stairId = ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCSTAIR).get(0)
      expect(ifcApi.GetLine(modelId, roofId).Representation.value).toBeGreaterThan(0)
      expect(ifcApi.GetLine(modelId, stairId).Representation.value).toBeGreaterThan(0)

      for (const type of [WebIFC.IFCROOF, WebIFC.IFCSTAIR]) {
        let geometryCount = 0
        ifcApi.StreamAllMeshesWithTypes(modelId, [type], (mesh) => {
          geometryCount += mesh.geometries.size()
        })
        expect(geometryCount).toBeGreaterThan(0)
      }
    } finally {
      ifcApi.CloseModel(modelId)
    }
  })

  it('exports curved and spiral stair bodies instead of semantic-only placeholders', () => {
    for (const stairType of ['curved', 'spiral'] as const) {
      const warnings: string[] = []
      const arcScene = {
        ...scene,
        nodes: {
          ...scene.nodes,
          stair_1: {
            ...scene.nodes.stair_1,
            stairType,
            children: [],
            width: 1,
            totalRise: 3,
            stepCount: 12,
            thickness: 0.2,
            fillToFloor: stairType === 'curved',
            innerRadius: stairType === 'spiral' ? 0.2 : 0.9,
            sweepAngle: stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2,
            topLandingMode: stairType === 'spiral' ? 'integrated' : 'none',
            topLandingDepth: 0.9,
            showCenterColumn: true,
            showStepSupports: true,
          },
        },
      } as unknown as IfcExportScene
      const bytes = convertPascalToIfc(arcScene, {
        ...options,
        onWarning: (warning) => warnings.push(`${warning.code}:${warning.nodeId}`),
      })
      const modelId = ifcApi.OpenModel(bytes)

      try {
        const stairId = ifcApi.GetLineIDsWithType(modelId, WebIFC.IFCSTAIR).get(0)
        expect(ifcApi.GetLine(modelId, stairId).Representation.value).toBeGreaterThan(0)
        expect(warnings).not.toContain('semantic-only:stair_1')
      } finally {
        ifcApi.CloseModel(modelId)
      }
    }
  })
})
