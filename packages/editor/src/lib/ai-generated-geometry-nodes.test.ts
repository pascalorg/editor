import { describe, expect, test } from 'bun:test'
import type { GeneratedGeometryArtifact } from './ai-generated-geometry-core'
import {
  buildGeneratedGeometryCreatePatches,
  buildGeneratedGeometryNodes,
} from './ai-generated-geometry-nodes'

function artifact(overrides: Partial<GeneratedGeometryArtifact> = {}): GeneratedGeometryArtifact {
  return {
    id: 'ai_geometry_patch_test',
    title: 'Generated conveyor',
    sourceTool: 'compose_assembly',
    sourceArgs: { family: 'belt_conveyor' },
    userPrompt: 'generate a conveyor',
    version: 1,
    createdAt: '2026-06-18T00:00:00.000Z',
    shapes: [
      {
        kind: 'box',
        name: 'base',
        position: [10, 0.25, 20],
        rotation: [0, 0, 0],
        length: 3,
        width: 1,
        height: 0.5,
      },
      {
        kind: 'cylinder',
        name: 'roller',
        position: [11, 0.8, 20],
        rotation: [0, 0, Math.PI / 2],
        radius: 0.15,
        height: 1,
      },
    ],
    transforms: [
      { position: [10, 0.25, 20], rotation: [0, 0, 0] },
      { position: [11, 0.8, 20], rotation: [0, 0, Math.PI / 2] },
    ],
    assemblyName: 'Generated conveyor',
    assemblyPosition: [10, 0, 20],
    createdNames: ['base', 'roller'],
    shapeDetails: '- base\n- roller',
    ...overrides,
  }
}

describe('ai generated geometry nodes', () => {
  test('converts generated assembly artifacts into create patches', () => {
    const plan = buildGeneratedGeometryCreatePatches(artifact(), {
      parentId: 'level_factory',
      generatedBy: 'factory-agent',
      metadata: { lineId: 'line_a' },
    })

    expect(plan.patches).toHaveLength(3)
    expect(plan.rootNode?.type).toBe('assembly')
    expect(plan.rootNode?.metadata).toMatchObject({
      generatedBy: 'factory-agent',
      sourceTool: 'compose_assembly',
      artifactId: 'ai_geometry_patch_test',
      partCount: 2,
      lineId: 'line_a',
    })
    expect(plan.patches[0]).toMatchObject({ op: 'create', parentId: 'level_factory' })
    expect(plan.patches[1]?.parentId).toBe(plan.rootNode?.id)
    expect(plan.patches[2]?.parentId).toBe(plan.rootNode?.id)
    expect(plan.nodeIds).toEqual(plan.patches.map((patch) => patch.node.id))
  })

  test('keeps assembly child nodes local to the artifact assembly position', () => {
    const { createdNodes } = buildGeneratedGeometryNodes(artifact())

    expect(createdNodes[0]).toMatchObject({ type: 'box', position: [0, 0.25, 0] })
    expect(createdNodes[1]).toMatchObject({ type: 'cylinder', position: [1, 0.8, 0] })
  })

  test('preserves generated shape selectors on child node metadata', () => {
    const { createdNodes } = buildGeneratedGeometryNodes(
      artifact({
        shapes: [
          {
            kind: 'box',
            name: 'fan blade 1',
            semanticRole: 'fan_blade',
            semanticGroup: 'front_fan',
            sourcePartKind: 'radial_blades',
            sourcePartId: 'blade_a',
            editableHints: { primaryDimension: 'length', canScale: ['length'] },
            position: [10, 0.25, 20],
            rotation: [0, 0, 0],
            length: 0.8,
            width: 0.08,
            height: 0.04,
          },
        ],
        transforms: [{ position: [10, 0.25, 20], rotation: [0, 0, 0] }],
        createdNames: ['fan blade 1'],
      }),
    )

    expect(createdNodes[0]?.metadata).toMatchObject({
      artifactId: 'ai_geometry_patch_test',
      shapeIndex: 0,
      semanticRole: 'fan_blade',
      sourcePartKind: 'radial_blades',
      editableHints: { primaryDimension: 'length', canScale: ['length'] },
      generatedShape: {
        label: 'fan blade 1',
        selector: {
          index: 0,
          semanticRole: 'fan_blade',
          semanticGroup: 'front_fan',
          sourcePartKind: 'radial_blades',
          sourcePartId: 'blade_a',
          kind: 'box',
          nameIncludes: 'fan blade 1',
        },
      },
    })
  })

  test('preserves primitive geometry contracts on generated node metadata', () => {
    const { createdNodes } = buildGeneratedGeometryNodes(
      artifact({
        shapes: [
          {
            kind: 'box',
            name: 'access cabinet',
            position: [10, 0.5, 20],
            rotation: [0, 0, 0],
            length: 1,
            width: 0.4,
            height: 1,
            bevelRadius: 0.05,
            cutouts: [{ id: 'door', kind: 'rectangular', semanticRole: 'access_door' }],
            ports: [{ id: 'front_access', kind: 'access', semanticRole: 'access_door' }],
            pattern: { id: 'vents', kind: 'linear', count: 4 },
            duct: { crossSection: 'rectangular', width: 0.4, height: 0.2 },
          },
        ],
        transforms: [{ position: [10, 0.5, 20], rotation: [0, 0, 0] }],
        createdNames: ['access cabinet'],
      }),
    )

    expect(createdNodes[0]).toMatchObject({ type: 'box', cornerRadius: 0.05 })
    expect(createdNodes[0]?.metadata).toMatchObject({
      primitiveContract: {
        bevel: { radius: 0.05 },
        cutouts: [{ id: 'door', semanticRole: 'access_door' }],
        ports: [{ id: 'front_access', kind: 'access' }],
        pattern: { id: 'vents', kind: 'linear', count: 4 },
        duct: { crossSection: 'rectangular', width: 0.4, height: 0.2 },
      },
    })
  })

  test('normalizes primitive contract positions and packs expanded patterns as instances', () => {
    const { createdNodes } = buildGeneratedGeometryNodes(
      artifact({
        shapes: [
          {
            kind: 'cylinder',
            name: 'bolt 1',
            position: [10, 0.5, 20],
            rotation: [0, 0, 0],
            radius: 0.03,
            height: 0.1,
            pattern: { id: 'bolt_ring', kind: 'radial', count: 2, mode: 'expanded' },
            ports: [{ id: 'bolt_access', kind: 'access', position: [10, 0.6, 20] }],
          },
          {
            kind: 'cylinder',
            name: 'bolt 2',
            position: [10.4, 0.5, 20],
            rotation: [0, 0, 0],
            radius: 0.03,
            height: 0.1,
            pattern: { id: 'bolt_ring', kind: 'radial', count: 2, mode: 'expanded' },
          },
        ],
        transforms: [
          { position: [10, 0.5, 20], rotation: [0, 0, 0] },
          { position: [10.4, 0.5, 20], rotation: [0, 0, 0] },
        ],
        createdNames: ['bolt 1', 'bolt 2'],
      }),
    )

    expect(createdNodes).toHaveLength(1)
    const metadata = createdNodes[0]?.metadata as
      | {
          primitiveContract?: {
            ports?: Array<{ id?: string; position?: number[] }>
            pattern?: { id?: string; mode?: string; instances?: Array<{ position?: number[] }> }
          }
        }
      | undefined
    const contract = metadata?.primitiveContract as
      | {
          ports?: Array<{ id?: string; position?: number[] }>
          pattern?: { id?: string; mode?: string; instances?: Array<{ position?: number[] }> }
        }
      | undefined
    expect(contract?.ports?.[0]?.id).toBe('bolt_access')
    expect(contract?.ports?.[0]?.position?.[1]).toBeCloseTo(0.1, 6)
    expect(contract?.pattern?.id).toBe('bolt_ring')
    expect(contract?.pattern?.mode).toBe('instanced')
    expect(contract?.pattern?.instances).toHaveLength(2)
    expect(contract?.pattern?.instances?.[0]?.position).toEqual([0, 0, 0])
    expect(contract?.pattern?.instances?.[1]?.position?.[0]).toBeCloseTo(0.4, 6)
  })

  test('creates a single-node patch with placement override metadata', () => {
    const single = artifact({
      assemblyName: null,
      shapes: [
        {
          kind: 'box',
          name: 'control cabinet',
          position: [0, 1, 0],
          rotation: [0, 0, 0],
          length: 1,
          width: 0.5,
          height: 2,
        },
      ],
      transforms: [{ position: [0, 1, 0], rotation: [0, 0, 0] }],
      assemblyPosition: [0, 1, 0],
      createdNames: ['control cabinet'],
    })

    const plan = buildGeneratedGeometryCreatePatches(single, {
      parentId: 'level_factory',
      position: [4, 1, 5],
      generatedBy: 'factory-agent',
      metadata: { equipmentRole: 'control' },
    })

    expect(plan.patches).toHaveLength(1)
    expect(plan.rootNode).toMatchObject({
      type: 'box',
      position: [4, 1, 5],
      metadata: {
        generatedBy: 'factory-agent',
        artifactId: 'ai_geometry_patch_test',
        equipmentRole: 'control',
      },
    })
    expect(plan.patches[0]?.parentId).toBe('level_factory')
  })

  test('keeps rounded glass panels editable after placement', () => {
    const single = artifact({
      assemblyName: null,
      title: 'Rounded blue glass',
      shapes: [
        {
          kind: 'rounded-panel',
          name: 'rounded blue glass',
          position: [0, 0.01, 0],
          rotation: [0, 0, 0],
          length: 1,
          width: 2,
          thickness: 0.012,
          cornerRadius: 0.15,
          cornerSegments: 8,
          material: {
            preset: 'glass',
            properties: {
              color: '#2f80ff',
              opacity: 0.35,
              transparent: true,
            },
          },
        },
      ],
      transforms: [{ position: [0, 0.01, 0], rotation: [0, 0, 0] }],
      assemblyPosition: [0, 0.01, 0],
      createdNames: ['rounded blue glass'],
    })

    const { rootNode } = buildGeneratedGeometryCreatePatches(single)

    expect(rootNode).toMatchObject({
      type: 'rounded-panel',
      length: 1,
      width: 2,
      thickness: 0.012,
      cornerRadius: 0.15,
      cornerSegments: 8,
      material: {
        preset: 'glass',
        properties: {
          color: '#2f80ff',
          opacity: 0.35,
          transparent: true,
        },
      },
    })
  })
})
