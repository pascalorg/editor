import { describe, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  calculateLevelMiters,
  DoorNode,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { prepareBrushForCSG } from '../../lib/csg-utils'
import {
  buildOpeningCutoutGeometry,
  getOpeningCutoutBottomPadding,
} from './opening-cutout-geometry'
import { generateExtrudedWall, mergeWallCutoutBrushes } from './wall-system'

type Opening = DoorNode | WindowNode

function openingBrush(opening: Opening, thickness: number): Brush {
  const bottom = opening.position[1] - opening.height / 2
  const brush = new Brush(
    buildOpeningCutoutGeometry(
      opening,
      {
        left: opening.position[0] - opening.width / 2,
        right: opening.position[0] + opening.width / 2,
        bottom: bottom - getOpeningCutoutBottomPadding(opening, bottom),
        top: opening.position[1] + opening.height / 2,
      },
      thickness * 2,
      thickness,
    ),
  )
  prepareBrushForCSG(brush)
  return brush
}

function chainedSubtract(wall: Brush, cutters: Brush[], evaluator: Evaluator): Brush {
  let result = wall
  for (const cutter of cutters) {
    const next = evaluator.evaluate(result, cutter, SUBTRACTION)
    prepareBrushForCSG(next)
    if (result !== wall) result.geometry.dispose()
    result = next
  }
  return result
}

function generateChainedReference(wall: WallNode, openings: Opening[]): THREE.BufferGeometry {
  const cutters = openings.map((opening) => openingBrush(opening, wall.thickness))
  return withChainedSubtraction(cutters, () =>
    generateExtrudedWall(wall, openings, calculateLevelMiters([wall])),
  )
}

function withChainedSubtraction(cutters: Brush[], generate: () => THREE.BufferGeometry) {
  const evaluate = Evaluator.prototype.evaluate
  const referenceEvaluator = new Evaluator()
  referenceEvaluator.attributes = ['position', 'normal', 'uv', 'uv2']
  referenceEvaluator.evaluate = evaluate
  // Substitute only the boolean stage so both paths use the actual wall's
  // mitering, band splitting, and final reveal material classification.
  const spy = spyOn(Evaluator.prototype, 'evaluate').mockImplementation(function (
    this: Evaluator,
    a: Brush,
    b: Brush,
    operation: typeof SUBTRACTION,
  ) {
    return operation === SUBTRACTION
      ? chainedSubtract(a, cutters, referenceEvaluator)
      : evaluate.call(this, a, b, operation)
  })
  try {
    return generate()
  } finally {
    spy.mockRestore()
    for (const cutter of cutters) cutter.geometry.dispose()
  }
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
}

function measurements(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const cross = new THREE.Vector3()
  let volume = 0
  const materialAreas = new Map<number, number>()
  for (let offset = 0; offset < triangleCount(geometry) * 3; offset += 3) {
    const vertexIndex = (corner: number) => geometry.index?.getX(offset + corner) ?? offset + corner
    a.fromBufferAttribute(position, vertexIndex(0))
    b.fromBufferAttribute(position, vertexIndex(1))
    c.fromBufferAttribute(position, vertexIndex(2))
    volume += a.dot(cross.crossVectors(b, c)) / 6
    const area = cross.crossVectors(b.sub(a), c.sub(a)).length() / 2
    const material = geometry.groups.find(
      (group) => offset >= group.start && offset < group.start + group.count,
    )?.materialIndex
    expect(material).toBeDefined()
    materialAreas.set(material!, (materialAreas.get(material!) ?? 0) + area)
  }
  geometry.computeBoundingBox()
  return { volume, materialAreas, bounds: geometry.boundingBox! }
}

function expectEquivalent(
  actual: THREE.BufferGeometry,
  reference: THREE.BufferGeometry,
  relativeAreaTolerance = 0,
) {
  expect(Array.from(actual.getAttribute('position').array).every(Number.isFinite)).toBe(true)
  const a = measurements(actual)
  const b = measurements(reference)
  expect(Math.abs(a.volume - b.volume)).toBeLessThan(1e-6)
  expect(a.bounds.min.distanceTo(b.bounds.min)).toBeLessThan(1e-6)
  expect(a.bounds.max.distanceTo(b.bounds.max)).toBeLessThan(1e-6)
  expect([...a.materialAreas.keys()].sort()).toEqual([...b.materialAreas.keys()].sort())
  const totalArea = [...b.materialAreas.values()].reduce((sum, area) => sum + area, 0)
  for (const [material, area] of a.materialAreas) {
    expect(Math.abs(area - b.materialAreas.get(material)!)).toBeLessThan(
      Math.max(1e-6, relativeAreaTolerance * totalArea),
    )
  }
}

function fixture() {
  const wall = WallNode.parse({ start: [0, 0], end: [8, 0], height: 3, thickness: 0.25 })
  const mesh = new THREE.Mesh()
  sceneRegistry.nodes.set(wall.id, mesh)
  const windowAt = (x: number, width = 1) =>
    WindowNode.parse({ wallId: wall.id, position: [x, 1.5, 0], width, height: 1 })
  const cleanup = () => {
    sceneRegistry.nodes.delete(wall.id)
    mesh.geometry.dispose()
  }
  return { wall, windowAt, cleanup }
}

describe('wall cutter union', () => {
  test('subtracts three disjoint boxes once with equivalent solid and reveal materials', () => {
    const { wall, windowAt, cleanup } = fixture()
    const openings = [windowAt(1), windowAt(3), windowAt(6)]
    const spy = spyOn(Evaluator.prototype, 'evaluate')
    try {
      const actual = generateExtrudedWall(wall, openings, calculateLevelMiters([wall]))
      expect(spy.mock.calls.map((call) => call[2])).toEqual([SUBTRACTION])
      spy.mockRestore()
      const reference = generateChainedReference(wall, openings)
      expectEquivalent(actual, reference)
      expect(measurements(actual).volume).toBeCloseTo(5.25, 6)
      expect(triangleCount(actual)).toBeLessThanOrEqual(triangleCount(reference))
      console.info(
        `Disjoint cutouts: merged ${triangleCount(actual)} triangles; chained ${triangleCount(reference)} triangles`,
      )
      actual.dispose()
      reference.dispose()
    } finally {
      spy.mockRestore()
      cleanup()
    }
  })

  for (const [name, centers, widths, unions] of [
    ['overlapping', [2, 2.5], [1, 1], 1],
    ['sharing a face', [2, 3], [1, 1], 1],
    ['nested', [2, 2], [2, 1], 1],
    ['identical', [2, 2], [1, 1], 1],
    ['transitively overlapping with a disjoint shell', [2, 3.5, 2.75, 6], [1, 1, 1, 1], 2],
  ] as const) {
    test(`unions ${name} cutouts before subtraction`, () => {
      const { wall, windowAt, cleanup } = fixture()
      const openings = centers.map((x, index) => windowAt(x, widths[index]))
      const spy = spyOn(Evaluator.prototype, 'evaluate')
      try {
        const actual = generateExtrudedWall(wall, openings, calculateLevelMiters([wall]))
        expect(spy.mock.calls.filter((call) => call[2] === ADDITION)).toHaveLength(unions)
        expect(spy.mock.calls.filter((call) => call[2] === SUBTRACTION)).toHaveLength(1)
        spy.mockRestore()
        const reference = generateChainedReference(wall, openings)
        expectEquivalent(actual, reference)
        actual.dispose()
        reference.dispose()
      } finally {
        spy.mockRestore()
        cleanup()
      }
    })
  }

  test('keeps band materials and base-material reveals across overlapping floor-level doors', () => {
    const { wall: originalWall, cleanup } = fixture()
    const wall = WallNode.parse({
      ...originalWall,
      frontSide: 'exterior',
      backSide: 'interior',
      faceBands: { enabled: true, count: 3, lowerHeight: 0.75, middleHeight: 1 },
    })
    const doors = [2, 2.75, 6].map((x) =>
      DoorNode.parse({ wallId: wall.id, position: [x, 1, 0], width: 1, height: 2 }),
    )
    try {
      const actual = generateExtrudedWall(wall, doors, calculateLevelMiters([wall]))
      const reference = generateChainedReference(wall, doors)
      expectEquivalent(actual, reference)
      const mesh = new THREE.Mesh(
        actual,
        Array.from({ length: 11 }, () => new THREE.MeshBasicMaterial()),
      )
      const hit = new THREE.Raycaster(
        new THREE.Vector3(2, 1, 0),
        new THREE.Vector3(-1, 0, 0),
      ).intersectObject(mesh)[0]
      expect(hit?.face?.materialIndex).toBe(0)
      for (const material of mesh.material) material.dispose()
      actual.dispose()
      reference.dispose()
    } finally {
      cleanup()
    }
  })

  test('keeps the zero-cutout path free of CSG', () => {
    const { wall, cleanup } = fixture()
    const spy = spyOn(Evaluator.prototype, 'evaluate')
    try {
      const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))
      expect(spy).not.toHaveBeenCalled()
      expect(measurements(geometry).volume).toBeCloseTo(6, 6)
      expect([...measurements(geometry).materialAreas.keys()].sort()).toEqual([0, 1, 2])
      geometry.dispose()
    } finally {
      spy.mockRestore()
      cleanup()
    }
  })

  test('disposes the source wall and merged cutter once while retaining the result', () => {
    const { wall, windowAt, cleanup } = fixture()
    const evaluate = Evaluator.prototype.evaluate
    const disposed = new Map<THREE.BufferGeometry, number>()
    const spy = spyOn(Evaluator.prototype, 'evaluate').mockImplementation(function (
      this: Evaluator,
      a: Brush,
      b: Brush,
      operation: typeof SUBTRACTION,
    ) {
      if (operation === SUBTRACTION) {
        for (const brush of [a, b]) {
          brush.geometry.addEventListener('dispose', () => {
            disposed.set(brush.geometry, (disposed.get(brush.geometry) ?? 0) + 1)
          })
        }
      }
      return evaluate.call(this, a, b, operation)
    })
    try {
      const geometry = generateExtrudedWall(
        wall,
        [windowAt(2), windowAt(2.5), windowAt(6)],
        calculateLevelMiters([wall]),
      )
      expect([...disposed.values()]).toEqual([1, 1])
      expect(disposed.has(geometry)).toBe(false)
      expect(measurements(geometry).volume).toBeCloseTo(5.375, 6)
      geometry.dispose()
    } finally {
      spy.mockRestore()
      cleanup()
    }
  })

  for (const openingShape of ['arch', 'rounded'] as const) {
    test(`preserves overlapping ${openingShape} openings and their reveal materials`, () => {
      const { wall, windowAt, cleanup } = fixture()
      const openings = [2, 2.5, 6].map((x) => WindowNode.parse({ ...windowAt(x), openingShape }))
      try {
        const actual = generateExtrudedWall(wall, openings, calculateLevelMiters([wall]))
        const reference = generateChainedReference(wall, openings)
        // Beveled Float32 faces accumulate area rounding across thousands of
        // splits; permit one ppm of surface area, retaining the volume bound.
        expectEquivalent(actual, reference, openingShape === 'rounded' ? 1e-6 : 0)
        const materials = Array.from({ length: 3 }, () => new THREE.MeshBasicMaterial())
        try {
          const actualMesh = new THREE.Mesh(actual, materials)
          const referenceMesh = new THREE.Mesh(reference, materials)
          for (const x of [2, 2.5, 6]) {
            for (const z of [-0.12, -0.06, 0, 0.06, 0.12]) {
              for (const direction of [
                new THREE.Vector3(-1, 0, 0),
                new THREE.Vector3(1, 0, 0),
                new THREE.Vector3(0, -1, 0),
                new THREE.Vector3(0, 1, 0),
              ]) {
                const ray = new THREE.Raycaster(new THREE.Vector3(x, 1.5, z), direction)
                const actualHit = ray.intersectObject(actualMesh)[0]
                const referenceHit = ray.intersectObject(referenceMesh)[0]
                expect(actualHit).toBeDefined()
                expect(referenceHit).toBeDefined()
                expect(Math.abs(actualHit!.distance - referenceHit!.distance)).toBeLessThan(1e-6)
                expect(actualHit!.face!.materialIndex).toBe(referenceHit!.face!.materialIndex)
                expect(actualHit!.face!.materialIndex).toBe(0)
              }
            }
          }
        } finally {
          for (const material of materials) material.dispose()
        }
        actual.dispose()
        reference.dispose()
      } finally {
        cleanup()
      }
    })
  }

  test('unions overlapping support and door cuts alongside an item proxy', () => {
    const { wall, cleanup } = fixture()
    const door = DoorNode.parse({
      wallId: wall.id,
      position: [2, 1, 0],
      width: 1,
      height: 2,
    })
    const item = { id: 'item_union-test', type: 'item' } as AnyNode
    const itemMesh = new THREE.Group()
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.5))
    proxy.name = 'cutout'
    proxy.position.set(6, 1.5, 0)
    itemMesh.add(proxy)
    sceneRegistry.nodes.set(item.id, itemMesh)
    const generate = () =>
      generateExtrudedWall(wall, [door, item], calculateLevelMiters([wall]), 0.5, 0, [
        { start: 0, end: 0.5, elevation: 0.5 },
        { start: 0.5, end: 1, elevation: 0 },
      ])
    try {
      const actual = generate()
      const support = new Brush(new THREE.BoxGeometry(4.5, 0.51, 1))
      support.geometry.translate(1.75, -0.255, 0)
      const itemCutter = new Brush(proxy.geometry.clone().translate(6, 1.5, 0))
      const cutters = [support, openingBrush(door, wall.thickness), itemCutter]
      for (const cutter of cutters) prepareBrushForCSG(cutter)
      const reference = withChainedSubtraction(cutters, generate)
      expectEquivalent(actual, reference)
      expect(measurements(actual).volume).toBeCloseTo(5.75, 6)
      actual.dispose()
      reference.dispose()
    } finally {
      sceneRegistry.nodes.delete(item.id)
      proxy.geometry.dispose()
      cleanup()
    }
  })

  test('bakes transforms and normalizes mixed indexed and non-indexed attributes', () => {
    const a = new Brush(new THREE.BoxGeometry(1, 1, 1))
    const b = new Brush(new THREE.BoxGeometry(1, 1, 1).toNonIndexed())
    const c = new Brush(new THREE.BoxGeometry(1, 1, 1))
    a.position.set(2, 1, 0)
    b.position.set(2.5, 1, 0)
    c.position.set(6, 1, 0)
    c.rotation.z = Math.PI / 4
    b.geometry.deleteAttribute('uv')
    a.geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(a.geometry.getAttribute('position').count * 3, 3),
    )
    const cutter = mergeWallCutoutBrushes([a, b, c])
    try {
      expect(Object.keys(cutter.geometry.attributes).sort()).toEqual([
        'normal',
        'position',
        'uv',
        'uv2',
      ])
      expect(cutter.matrixWorld.equals(new THREE.Matrix4())).toBe(true)
      const evaluator = new Evaluator()
      evaluator.attributes = ['position', 'normal', 'uv', 'uv2']
      const wall = new Brush(new THREE.BoxGeometry(10, 4, 0.5))
      wall.geometry.translate(4, 1, 0)
      prepareBrushForCSG(wall)
      const actual = evaluator.evaluate(wall, cutter, SUBTRACTION)
      const reference = chainedSubtract(wall, [a, b, c], evaluator)
      // Compare solids here; semantic wall materials are covered above.
      actual.geometry.clearGroups()
      actual.geometry.addGroup(0, actual.geometry.index!.count, 0)
      reference.geometry.clearGroups()
      reference.geometry.addGroup(0, reference.geometry.index!.count, 0)
      expectEquivalent(actual.geometry, reference.geometry)
      wall.geometry.dispose()
      actual.geometry.dispose()
      reference.geometry.dispose()
    } finally {
      for (const brush of [a, b, c, cutter]) brush.geometry.dispose()
    }
  })
})
