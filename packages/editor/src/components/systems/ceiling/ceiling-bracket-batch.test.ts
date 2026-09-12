import { describe, expect, test } from 'bun:test'
import {
  type BufferAttribute,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Raycaster,
  StaticDrawUsage,
  Vector3,
} from 'three'
import Attributes from 'three/src/renderers/common/Attributes.js'
import { AttributeType } from 'three/src/renderers/common/Constants.js'
import Info from 'three/src/renderers/common/Info.js'
import {
  BRACKET_Y_OFFSET,
  BracketPointerState,
  type BracketTarget,
  bracketTargetKey,
  buildCornerBrackets,
  CeilingBracketBatchStore,
  getBracketHighlights,
  getBracketMatrix,
  growBracketCapacity,
} from './ceiling-bracket-batch'

const polygon: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const ceilingId = 'ceiling:first' as BracketTarget['ceilingId']
const otherId = 'ceiling:second' as BracketTarget['ceilingId']
const corners = buildCornerBrackets(polygon)
const target = (
  cornerIndex: number,
  part: BracketTarget['part'] = 'cube',
  id = ceilingId,
): BracketTarget => ({ ceilingId: id, cornerIndex, part })

function expectMatrix(actual: Matrix4, expected: Matrix4, precision = 10) {
  actual.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.elements[index]!, precision)
  })
}

function expectIndex(store: CeilingBracketBatchStore, ids = [ceilingId, otherId]) {
  const seen = new Set<string>()
  for (const mesh of store.getSnapshot()) {
    for (let index = 0; index < mesh.count; index++) {
      const hit = store.getTarget(mesh, index)!
      expect(hit).toBeDefined()
      expect(ids).toContain(hit.ceilingId)
      expect(store.getLocation(hit)).toEqual({ mesh, instanceId: index })
      seen.add(bracketTargetKey(hit))
      const matrix = new Matrix4()
      mesh.getMatrixAt(index, matrix)
      expectMatrix(matrix, getBracketMatrix(corners[hit.cornerIndex]!, hit.part, 3), 6)
    }
    expect(store.getTarget(mesh, mesh.count)).toBeUndefined()
  }
  expect(seen.size).toBe(ids.length * 12)
}

describe('ceiling bracket layout', () => {
  test('leg matrices match the old nested level/corner/BracketLeg transforms', () => {
    const sample: Array<[number, number]> = [
      [2, -3],
      [2.3, -2.6],
      [5, 1],
      [-1, 2],
    ]
    for (const corner of buildCornerBrackets(sample)) {
      for (const part of ['incoming', 'outgoing'] as const) {
        const neighborIndex =
          part === 'incoming'
            ? (corner.index - 1 + sample.length) % sample.length
            : (corner.index + 1) % sample.length
        const neighbor = sample[neighborIndex]!
        const dx = neighbor[0] - corner.corner[0]
        const dz = neighbor[1] - corner.corner[1]
        const edgeLength = Math.hypot(dx, dz)
        const direction = [dx / edgeLength, dz / edgeLength]
        const length = Math.max(0.14, Math.min(0.38, edgeLength * 0.22))
        const level = new Group()
        level.position.y = 3 + 0.035
        const cornerGroup = new Group()
        cornerGroup.position.set(corner.corner[0], 0, corner.corner[1])
        const leg = new Mesh()
        leg.position.set((direction[0]! * length) / 2, 0, (direction[1]! * length) / 2)
        leg.rotation.y = -Math.atan2(direction[1]!, direction[0]!)
        leg.scale.set(length, 0.04, 0.04)
        level.add(cornerGroup)
        cornerGroup.add(leg)
        level.updateMatrixWorld(true)
        expectMatrix(getBracketMatrix(corner, part, 3), leg.matrixWorld)
      }
    }
  })

  test('cube matrix uses the same offset and dimensions', () => {
    const expected = new Matrix4().makeScale(0.28, 0.08, 0.28)
    expected.setPosition(4, 3.035, 4)
    expectMatrix(getBracketMatrix(corners[2]!, 'cube', 3), expected)
  })

  test('length clamps, degenerate edges, and invalid polygons match the original', () => {
    const sample = buildCornerBrackets([
      [0, 0],
      [0, 0],
      [1, 0],
      [10, 10],
    ])
    expect(sample[0]!.outgoingDirection).toEqual([1, 0])
    expect(sample[0]!.outgoingLength).toBe(0.14)
    expect(sample[1]!.outgoingLength).toBe(0.22)
    expect(sample[2]!.outgoingLength).toBe(0.38)
    expect(buildCornerBrackets([])).toEqual([])
    expect(
      buildCornerBrackets([
        [0, 0],
        [1, 1],
      ]),
    ).toEqual([])
  })
})

describe('ceiling bracket highlights', () => {
  test('wraps both incident edges and linked cubes for every corner', () => {
    for (const count of [3, 4, 7]) {
      for (let active = 0; active < count; active++) {
        const highlights = getBracketHighlights(count, active)
        expect(highlights.edges).toEqual(new Set([active, (active - 1 + count) % count]))
        expect(highlights.corners).toEqual(
          new Set([active, (active - 1 + count) % count, (active + 1) % count]),
        )
      }
    }
    expect(getBracketHighlights(4, null)).toEqual({ edges: new Set(), corners: new Set() })
    expect(getBracketHighlights(1, 0)).toEqual({ edges: new Set(), corners: new Set() })
  })

  test('highlights both ends of each edge and only the three linked cubes', () => {
    const store = new CeilingBracketBatchStore()
    store.setGeometry(ceilingId, corners, 3)
    store.setGeometry(otherId, corners, 3)
    const snapshot = store.getSnapshot()
    store.setHighlight(ceilingId, 0)
    const [normal, highlighted] = store.getSnapshot()
    expect(store.getSnapshot()).toBe(snapshot)
    expect(normal!.count).toBe(17)
    expect(highlighted!.count).toBe(7)
    const parts = Array.from({ length: highlighted!.count }, (_, index) => {
      const hit = store.getTarget(highlighted!, index)!
      expect(hit.ceilingId).toBe(ceilingId)
      return `${hit.cornerIndex}/${hit.part}`
    })
    expect(new Set(parts)).toEqual(
      new Set([
        '0/incoming',
        '0/outgoing',
        '0/cube',
        '1/incoming',
        '1/cube',
        '3/outgoing',
        '3/cube',
      ]),
    )
    for (const mesh of store.getSnapshot()) {
      const expected = new Color(mesh === highlighted ? '#818cf8' : '#d4d4d4')
      for (let index = 0; index < mesh.count; index++) {
        const color = new Color()
        mesh.getColorAt(index, color)
        expect(color.r).toBeCloseTo(expected.r, 6)
        expect(color.g).toBeCloseTo(expected.g, 6)
        expect(color.b).toBeCloseTo(expected.b, 6)
      }
    }
    store.setHighlight(ceilingId, null)
    expect(normal!.count).toBe(24)
    expect(highlighted!.count).toBe(0)
    store.dispose()
  })
})

describe('ceiling bracket batches', () => {
  test('round-trips instance indices through highlighting, swap removal, and removal of a ceiling', () => {
    const store = new CeilingBracketBatchStore()
    store.setGeometry(ceilingId, corners, 3)
    store.setGeometry(otherId, corners, 3)
    expectIndex(store)
    for (const active of [0, 1, 3, null]) {
      store.setHighlight(ceilingId, active)
      expectIndex(store)
    }
    store.setHighlight(otherId, 2)
    store.removeCeiling(ceilingId)
    expectIndex(store, [otherId])
    expect(store.getLocation(target(0))).toBeUndefined()
    expect(store.getTarget(new Group(), 0)).toBeUndefined()
    expect(store.getTarget(store.getSnapshot()[0]!, undefined)).toBeUndefined()
    store.removeCeiling(otherId)
    expect(store.getSnapshot().map((mesh) => mesh.count)).toEqual([0, 0])
    store.dispose()
  })

  test('capacity has headroom, grows only on overflow, and never shrinks', () => {
    expect(growBracketCapacity(0, 0)).toBe(0)
    expect(growBracketCapacity(0, 1)).toBe(32)
    expect(growBracketCapacity(32, 32)).toBe(32)
    expect(growBracketCapacity(32, 33)).toBe(66)
    expect(growBracketCapacity(66, 12)).toBe(66)
    const store = new CeilingBracketBatchStore()
    let reallocations = 0
    const unsubscribe = store.subscribe(() => reallocations++)
    const initial = store.getSnapshot()
    for (let index = 0; index < 103; index++) {
      const id = `ceiling:${index}` as BracketTarget['ceilingId']
      store.setGeometry(id, corners, 3)
    }
    const [normal, highlighted] = store.getSnapshot()
    expect(normal).not.toBe(initial[0])
    expect(highlighted).toBe(initial[1])
    expect(normal!.count).toBe(1236)
    expect(normal!.instanceMatrix.count).toBeGreaterThan(1236)
    expect(reallocations).toBeLessThan(7)
    const grown = store.getSnapshot()
    const versions = grown.map((mesh) => mesh.instanceMatrix.version)
    store.setHighlight('ceiling:0' as BracketTarget['ceilingId'], 0)
    expect(store.getSnapshot()).toBe(grown)
    expect(normal!.instanceMatrix.version - versions[0]!).toBeLessThanOrEqual(7)
    expect(highlighted!.instanceMatrix.version - versions[1]!).toBe(7)
    unsubscribe()
    store.dispose()
  })

  test('geometry changes preserve targets, update heights, and keep native raycasts in bounds', () => {
    const store = new CeilingBracketBatchStore()
    store.setGeometry(ceilingId, corners, 3)
    const oldTarget = store.getTarget(store.getSnapshot()[0]!, 2)
    const shifted = buildCornerBrackets(polygon.map(([x, z]) => [x + 1000, z - 1000]))
    store.setGeometry(ceilingId, shifted, 8)
    expect(store.getTarget(store.getSnapshot()[0]!, 2)).toBe(oldTarget)
    const level = new Group()
    level.position.set(20, 4, 30)
    for (const mesh of store.getSnapshot()) level.add(mesh)
    level.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(1020, 20, -970), new Vector3(0, -1, 0))
    for (const active of [null, 0, 1, null]) {
      store.setHighlight(ceilingId, active)
      const hits = ray.intersectObjects(store.getSnapshot())
      expect(hits.length).toBeGreaterThan(0)
      expect(hits.some((hit) => store.getTarget(hit.object, hit.instanceId)?.part === 'cube')).toBe(
        true,
      )
      expect(hits[0]!.point.y).toBeCloseTo(4 + 8 + BRACKET_Y_OFFSET + 0.04, 5)
    }
    store.setGeometry(ceilingId, shifted.slice(0, 3), 8)
    expect(store.getSnapshot().reduce((sum, mesh) => sum + mesh.count, 0)).toBe(9)
    for (const mesh of store.getSnapshot()) {
      expect(mesh.raycast).toBe(InstancedMesh.prototype.raycast)
      expect(mesh.frustumCulled).toBe(false)
      expect(mesh.layers.mask).toBe(1)
      expect(mesh.material.depthTest).toBe(true)
      expect(mesh.material.depthWrite).toBe(false)
      expect(mesh.material.transparent).toBe(true)
    }
    expect(store.getSnapshot().map((mesh) => mesh.renderOrder)).toEqual([1000, 1001])
    expect(store.getSnapshot().map((mesh) => mesh.material.opacity)).toEqual([0.72, 0.92])
    store.dispose()
  })

  test('unchanged geometry and highlights do not rewrite buffers or notify React', () => {
    const store = new CeilingBracketBatchStore()
    store.setGeometry(ceilingId, corners, 3)
    const versions = store.getSnapshot().map((mesh) => mesh.instanceMatrix.version)
    let notifications = 0
    store.subscribe(() => notifications++)
    store.setGeometry(ceilingId, corners, 3)
    store.setHighlight(ceilingId, null)
    expect(store.getSnapshot().map((mesh) => mesh.instanceMatrix.version)).toEqual(versions)
    expect(notifications).toBe(0)
    store.dispose()
  })
})

describe('ceiling bracket pointer identities', () => {
  test('pointer-out retains the old target after its packed slot is reassigned', () => {
    const store = new CeilingBracketBatchStore()
    const pointer = new BracketPointerState()
    store.setGeometry(ceilingId, corners, 3)
    store.setGeometry(otherId, corners, 3)
    const { mesh, instanceId } = store.getLocation(target(0))!
    const hit = store.getTarget(mesh, instanceId)!
    pointer.over('old-hit', hit)
    store.setHighlight(ceilingId, 0)
    expect(bracketTargetKey(store.getTarget(mesh, instanceId)!)).not.toBe(bracketTargetKey(hit))
    expect(pointer.out('old-hit')).toBe(hit)
    expect(pointer.out('old-hit')).toBeUndefined()
    store.dispose()
  })

  test('reused hover IDs and click targets retain ceiling, corner, and part identity', () => {
    const pointer = new BracketPointerState()
    const first = target(0)
    const next = target(1)
    expect(pointer.over('same-slot', first)).toBeUndefined()
    expect(pointer.over('same-slot', next)).toBe(first)
    expect(pointer.out('same-slot')).toBe(next)
    pointer.pointerDown([first, target(0, 'incoming')])
    expect(pointer.canClick({ ...first })).toBe(true)
    expect(pointer.canClick(target(0, 'incoming'))).toBe(true)
    expect(pointer.canClick(next)).toBe(false)
    expect(pointer.canClick(target(0, 'outgoing'))).toBe(false)
    expect(pointer.canClick(target(0, 'cube', otherId))).toBe(false)
    pointer.over('old-mesh/undefined/2', first)
    pointer.replaceObject('old-mesh', 'new-mesh')
    expect(pointer.out('old-mesh/undefined/2')).toBeUndefined()
    expect(pointer.out('new-mesh/undefined/2')).toBe(first)
    pointer.pointerDown([])
    expect(pointer.canClick(first)).toBe(false)
  })
})

test('each batch owns and disposes its geometry on capacity growth and teardown', () => {
  const store = new CeilingBracketBatchStore()
  const [initialNormal, highlighted] = store.getSnapshot()
  expect(initialNormal!.geometry).not.toBe(highlighted!.geometry)
  expect(initialNormal!.geometry.attributes.position!.array).not.toBe(
    highlighted!.geometry.attributes.position!.array,
  )
  let retiredDisposals = 0
  initialNormal!.geometry.addEventListener('dispose', () => {
    retiredDisposals++
  })
  for (let index = 0; index < 3; index++) {
    store.setGeometry(`ceiling:${index}` as BracketTarget['ceilingId'], corners, 3)
  }
  expect(retiredDisposals).toBe(1)
  expect(store.getSnapshot()[0]!.geometry).not.toBe(initialNormal!.geometry)
  let finalDisposals = 0
  for (const mesh of store.getSnapshot()) {
    mesh.geometry.addEventListener('dispose', () => {
      finalDisposals++
    })
  }
  store.dispose()
  expect(finalDisposals).toBe(2)
  expect(retiredDisposals).toBe(1)
})

test('WebGPU attribute updates skip resting frames and upload only written slots after a change', () => {
  const store = new CeilingBracketBatchStore()
  store.setGeometry(ceilingId, corners, 3)
  const uploads: Array<{
    attribute: BufferAttribute
    ranges: Array<{ start: number; count: number }>
  }> = []
  const attributes = new Attributes(
    {
      createAttribute() {},
      updateAttribute(attribute: BufferAttribute) {
        uploads.push({ attribute, ranges: attribute.updateRanges.map((range) => ({ ...range })) })
        attribute.clearUpdateRanges()
      },
    } as unknown as ConstructorParameters<typeof Attributes>[0],
    new Info(),
  )
  const render = () => {
    for (const mesh of store.getSnapshot()) {
      for (const attribute of [mesh.instanceMatrix, mesh.instanceColor!]) {
        expect(attribute.usage).toBe(StaticDrawUsage)
        attributes.update(attribute, AttributeType.VERTEX)
      }
      mesh.onAfterRender(...([] as unknown as Parameters<typeof mesh.onAfterRender>))
    }
  }
  render()
  for (let frame = 0; frame < 20; frame++) render()
  expect(uploads).toHaveLength(0)
  store.setHighlight(ceilingId, 0)
  render()
  expect(uploads).toHaveLength(4)
  for (const upload of uploads) {
    expect(upload.ranges.length).toBeGreaterThan(0)
    expect(upload.ranges.length).toBeLessThanOrEqual(7)
    for (const range of upload.ranges) {
      expect(range.count).toBe(upload.attribute.itemSize)
      expect(range.start % upload.attribute.itemSize).toBe(0)
    }
  }
  uploads.length = 0
  for (let frame = 0; frame < 20; frame++) render()
  expect(uploads).toHaveLength(0)
  for (const mesh of store.getSnapshot()) {
    expect(mesh.instanceMatrix.updateRanges).toEqual([])
    expect(mesh.instanceColor!.updateRanges).toEqual([])
  }
  store.dispose()
})
