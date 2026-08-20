import { describe, expect, test } from 'bun:test'
import { DoorNode, RoofSegmentNode, type RoofType } from '@pascal-app/core'
import * as THREE from 'three'
import { buildPrintableRoofSegmentSolids } from './roof-print-solids'

const ROOF_TYPES: RoofType[] = ['gable', 'hip', 'shed', 'gambrel', 'mansard', 'flat', 'dutch']

function fixture(roofType: RoofType, overrides: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id: `rseg_print-${roofType}`,
    roofType,
    width: 4,
    depth: 3,
    wallHeight: 0.5,
    pitch: 30,
    wallThickness: 0.15,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    ...overrides,
  })
}

function onlyMesh(root: THREE.Group): THREE.Mesh<THREE.BufferGeometry> {
  expect(root.children).toHaveLength(1)
  const mesh = root.children[0]
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.BufferGeometry>
}

describe('buildPrintableRoofSegmentSolids', () => {
  test('builds deterministic indexed print shells for every canonical roof type', () => {
    for (const roofType of ROOF_TYPES) {
      const first = buildPrintableRoofSegmentSolids(fixture(roofType))
      const second = buildPrintableRoofSegmentSolids(fixture(roofType))

      expect(first.status).toBe('ready')
      expect(second.status).toBe('ready')
      expect(first.diagnostics).toEqual([])
      expect(second.diagnostics).toEqual([])
      expect(first.object).not.toBeNull()
      expect(second.object).not.toBeNull()

      const firstMesh = onlyMesh(first.object!)
      const secondMesh = onlyMesh(second.object!)
      expect(firstMesh.geometry.index).not.toBeNull()
      expect(Array.from(firstMesh.geometry.getAttribute('position').array)).toEqual(
        Array.from(secondMesh.geometry.getAttribute('position').array),
      )
      expect(Array.from(firstMesh.geometry.index!.array)).toEqual(
        Array.from(secondMesh.geometry.index!.array),
      )
      expect(
        Array.from(firstMesh.geometry.getAttribute('position').array).every(Number.isFinite),
      ).toBe(true)

      firstMesh.geometry.dispose()
      secondMesh.geometry.dispose()
    }
  })

  test('preserves segment provenance and local transform', () => {
    const node = fixture('gable', { position: [1, 2, 3], rotation: Math.PI / 3 })
    const result = buildPrintableRoofSegmentSolids(node)

    expect(result.status).toBe('ready')
    expect(result.object?.userData.pascalId).toBe(node.id)
    expect(result.object?.position.toArray()).toEqual(node.position)
    expect(result.object?.rotation.y).toBeCloseTo(node.rotation)

    onlyMesh(result.object!).geometry.dispose()
  })

  test('blocks trims and unsupported accessories until manifold fixtures exist', () => {
    const unregisteredChild = DoorNode.parse({
      id: 'door_print-roof-cut',
      wallId: 'wall_print-roof-host',
    })
    const trimmed = buildPrintableRoofSegmentSolids(
      fixture('gable', { trim: { left: 0.25 } as RoofSegmentNode['trim'] }),
    )
    const unresolvedCut = buildPrintableRoofSegmentSolids(
      fixture('gable', { children: ['door_missing-print-roof-cut'] }),
    )
    const unregisteredCut = buildPrintableRoofSegmentSolids(
      fixture('gable', { children: [unregisteredChild.id] }),
      { [unregisteredChild.id]: unregisteredChild },
    )

    expect(trimmed).toEqual(
      expect.objectContaining({
        status: 'blocked',
        object: null,
        diagnostics: [expect.objectContaining({ code: 'unsupported_roof_print_trim' })],
      }),
    )
    expect(unresolvedCut).toEqual(
      expect.objectContaining({
        status: 'blocked',
        object: null,
        diagnostics: [expect.objectContaining({ code: 'unsupported_roof_print_cut' })],
      }),
    )
    expect(unregisteredCut).toEqual(
      expect.objectContaining({
        status: 'blocked',
        object: null,
        diagnostics: [expect.objectContaining({ code: 'unsupported_roof_print_cut' })],
      }),
    )
  })

  test('blocks zero structural thickness', () => {
    const result = buildPrintableRoofSegmentSolids(fixture('gable', { wallThickness: 0 }))

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        object: null,
        diagnostics: [expect.objectContaining({ code: 'invalid_roof_print_dimensions' })],
      }),
    )
  })
})
