import { describe, expect, test } from 'bun:test'
import { DoorNode, RoofSegmentNode, type RoofType } from '@pascal-app/core'
import { buildPrintableRoofSegmentSolids } from '@pascal-app/editor'
import * as THREE from 'three'

const ROOF_TYPES: RoofType[] = [
  'gable',
  'hip',
  'shed',
  'gambrel',
  'mansard',
  'flat',
  'dutch',
  'conical',
]

function fixture(roofType: RoofType, overrides: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id: `rseg_print-${roofType}`,
    roofType,
    width: 4,
    depth: roofType === 'conical' ? 4 : 3,
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

  test("a gable's print shell reaches its gable overhang at the ends, the eaves along the sides", () => {
    const extent = (node: RoofSegmentNode) => {
      const mesh = onlyMesh(buildPrintableRoofSegmentSolids(node).object!)
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox!.clone()
      mesh.geometry.dispose()
      return box
    }
    const plain = extent(fixture('gable'))
    const raked = extent(fixture('gable', { gableOverhang: 0.6 }))
    expect(raked.max.x).toBeCloseTo(4 / 2 + 0.15 / 2 + 0.6, 6)
    expect(raked.min.x).toBeCloseTo(-(4 / 2 + 0.15 / 2 + 0.6), 6)
    expect(raked.max.z).toBeCloseTo(plain.max.z, 6)
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

for (const roofType of ['gable', 'shed', 'barrel'] as const)
  test(`glazed ${roofType} prints pane and frame solids without an opaque roof shell`, () => {
    const result = buildPrintableRoofSegmentSolids(
      fixture(roofType, { roofSystem: 'glazed', wallThickness: 0 }),
    )
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    try {
      expect(result.object.children.some((child) => child.name === 'print-glazing-frame')).toBe(
        true,
      )
      expect(result.object.children.some((child) => child.name === 'print-glazing-pane')).toBe(true)
      expect(result.object.children.some((child) => child.name === 'print-roof-shell')).toBe(false)
      for (const child of result.object.children) {
        const geometry = (child as THREE.Mesh).geometry
        expect(geometry.getIndex()!.count).toBeGreaterThan(0)
        expect([...geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true)
      }
    } finally {
      for (const child of result.object.children) (child as THREE.Mesh).geometry.dispose()
    }
  })
