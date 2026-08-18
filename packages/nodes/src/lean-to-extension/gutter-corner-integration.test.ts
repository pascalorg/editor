import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  clearSceneHistory,
  createSceneApi,
  type GutterNode,
  LeanToExtensionNode,
  LevelNode,
  type RoofSegmentNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { computeGutterMitres } from '../gutter/corner-mitre'
import { computeSharedEaveY } from '../gutter/eave-align'
import { buildGutterGeometry } from '../gutter/geometry'
import { createLeanToAssembly, leanToRoofSegmentLayoutPatch } from './assembly'
import { resolveLeanToCornerJoints } from './corner-joint'
import { initializeLeanToExtensionSync } from './system'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

type CornerFixture = {
  wallA: ReturnType<typeof WallNode.parse>
  wallB: ReturnType<typeof WallNode.parse>
  leanToA: ReturnType<typeof LeanToExtensionNode.parse>
  leanToB: ReturnType<typeof LeanToExtensionNode.parse>
}

type CornerFixtureOptions = {
  reverseA: boolean
  reverseB: boolean
  angle?: number
  autoSpan?: boolean
  wallEndGap?: number
  profile?: GutterNode['profile']
  size?: number
  pitchA?: number
  pitchB?: number
  highEdgeHeightA?: number
  highEdgeHeightB?: number
  lowOverhangA?: number
  lowOverhangB?: number
  leftOverhangA?: number
  rightOverhangA?: number
  leftOverhangB?: number
  rightOverhangB?: number
  gutterEnabledA?: boolean
  gutterEnabledB?: boolean
  flipFaceA?: boolean
  flipFaceB?: boolean
}

function cornerFixture(options: CornerFixtureOptions): CornerFixture {
  const { reverseA, reverseB } = options
  const wallBX = 4 + (options.wallEndGap ?? 0)
  const angle = ((options.angle ?? 90) * Math.PI) / 180
  const wallBCorner: [number, number] = [wallBX, 0]
  const wallBAway: [number, number] = [wallBX - 4 * Math.cos(angle), -4 * Math.sin(angle)]
  const rotationA = (reverseA ? Math.PI : 0) + (options.flipFaceA ? Math.PI : 0)
  const rotationB = (reverseB ? Math.PI : 0) + (options.flipFaceB ? Math.PI : 0)
  const wallA = WallNode.parse({
    id: `wall_gutter_a_${Number(reverseA)}_${Number(reverseB)}`,
    parentId: 'level_gutter_corner',
    start: reverseA ? [4, 0] : [0, 0],
    end: reverseA ? [0, 0] : [4, 0],
  })
  const wallB = WallNode.parse({
    id: `wall_gutter_b_${Number(reverseA)}_${Number(reverseB)}`,
    parentId: 'level_gutter_corner',
    start: reverseB ? wallBAway : wallBCorner,
    end: reverseB ? wallBCorner : wallBAway,
  })
  const leanToA = LeanToExtensionNode.parse({
    id: `leanto_gutter_a_${Number(reverseA)}_${Number(reverseB)}`,
    parentId: wallA.id,
    autoSpan: options.autoSpan ?? false,
    position: [2, 0, Math.cos(rotationA) * 0.05],
    rotation: [0, rotationA, 0],
    span: 4,
    downspoutEnabled: false,
    gutterEnabled: options.gutterEnabledA ?? true,
    gutterProfile: options.profile ?? 'k-style',
    gutterSize: options.size ?? 0.13,
    pitch: options.pitchA ?? 10,
    highEdgeHeight: options.highEdgeHeightA ?? 2.8,
    lowOverhang: options.lowOverhangA ?? 0.25,
    leftOverhang: options.leftOverhangA ?? 0,
    rightOverhang: options.rightOverhangA ?? 0,
  })
  const leanToB = LeanToExtensionNode.parse({
    id: `leanto_gutter_b_${Number(reverseA)}_${Number(reverseB)}`,
    parentId: wallB.id,
    autoSpan: options.autoSpan ?? false,
    position: [2, 0, Math.cos(rotationB) * 0.05],
    rotation: [0, rotationB, 0],
    span: 4,
    downspoutEnabled: false,
    gutterEnabled: options.gutterEnabledB ?? true,
    gutterProfile: options.profile ?? 'k-style',
    gutterSize: options.size ?? 0.13,
    pitch: options.pitchB ?? 10,
    highEdgeHeight: options.highEdgeHeightB ?? 2.8,
    lowOverhang: options.lowOverhangB ?? 0.25,
    leftOverhang: options.leftOverhangB ?? 0,
    rightOverhang: options.rightOverhangB ?? 0,
  })
  return { wallA, wallB, leanToA, leanToB }
}

function managedGutter(
  leanTo: ReturnType<typeof LeanToExtensionNode.parse>,
  nodes: Record<AnyNodeId, AnyNode>,
): { gutter: GutterNode; segment: RoofSegmentNode } {
  const current = nodes[leanTo.id as AnyNodeId]
  if (current?.type !== 'lean-to-extension') throw new Error('missing synchronized lean-to')
  const roof = current.children
    .map((id) => nodes[id as AnyNodeId])
    .find((node) => node?.type === 'roof')
  const segment =
    roof?.type === 'roof'
      ? roof.children
          .map((id) => nodes[id as AnyNodeId])
          .find((node) => node?.type === 'roof-segment')
      : undefined
  const gutter =
    segment?.type === 'roof-segment'
      ? segment.children.map((id) => nodes[id as AnyNodeId]).find((node) => node?.type === 'gutter')
      : undefined
  if (segment?.type !== 'roof-segment' || gutter?.type !== 'gutter') {
    throw new Error('missing synchronized managed gutter')
  }
  return { gutter, segment }
}

function segmentWorldMatrix(
  wall: ReturnType<typeof WallNode.parse>,
  leanTo: ReturnType<typeof LeanToExtensionNode.parse>,
  segment: RoofSegmentNode,
) {
  const wallAngle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  return new THREE.Matrix4()
    .makeTranslation(wall.start[0], 0, wall.start[1])
    .multiply(new THREE.Matrix4().makeRotationY(-wallAngle))
    .multiply(new THREE.Matrix4().makeTranslation(...leanTo.position))
    .multiply(new THREE.Matrix4().makeRotationY(leanTo.rotation[1]))
    .multiply(new THREE.Matrix4().makeTranslation(...segment.position))
    .multiply(new THREE.Matrix4().makeRotationY(segment.rotation))
}

function renderedGutterGeometry(
  wall: ReturnType<typeof WallNode.parse>,
  leanTo: ReturnType<typeof LeanToExtensionNode.parse>,
  subject: { gutter: GutterNode; segment: RoofSegmentNode },
  sibling: { gutter: GutterNode; segment: RoofSegmentNode },
) {
  const siblings = [sibling]
  const mitres = computeGutterMitres(subject.gutter, subject.segment, siblings)
  const eaveY = computeSharedEaveY(subject.gutter, subject.segment, siblings)
  const geometry = buildGutterGeometry(
    { ...subject.gutter, hangerStyle: 'none', outlets: [] },
    mitres,
  )
  return geometry.applyMatrix4(
    segmentWorldMatrix(wall, leanTo, subject.segment)
      .multiply(
        new THREE.Matrix4().makeTranslation(
          subject.gutter.position[0],
          eaveY,
          subject.gutter.position[2],
        ),
      )
      .multiply(new THREE.Matrix4().makeRotationY(subject.gutter.rotation)),
  )
}

function pointKey(point: THREE.Vector3): string {
  const scale = 1e5
  return [point.x, point.y, point.z].map((value) => Math.round(value * scale)).join(':')
}

function openBoundaryPoints(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const edgeCounts = new Map<string, { count: number; a: THREE.Vector3; b: THREE.Vector3 }>()
  const vertex = (offset: number) => index?.getX(offset) ?? offset
  const count = index?.count ?? position.count
  for (let offset = 0; offset < count; offset += 3) {
    const triangle = [0, 1, 2].map((delta) =>
      new THREE.Vector3().fromBufferAttribute(position, vertex(offset + delta)),
    )
    for (const [from, to] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const a = triangle[from]!
      const b = triangle[to]!
      const aKey = pointKey(a)
      const bKey = pointKey(b)
      const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
      const existing = edgeCounts.get(key)
      if (existing) existing.count++
      else edgeCounts.set(key, { count: 1, a, b })
    }
  }
  const points = new Map<string, THREE.Vector3>()
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue
    points.set(pointKey(edge.a), edge.a)
    points.set(pointKey(edge.b), edge.b)
  }
  return [...points.values()]
}

function boundaryHausdorffDistance(left: THREE.Vector3[], right: THREE.Vector3[]): number {
  const directed = (source: THREE.Vector3[], target: THREE.Vector3[]) =>
    Math.max(
      ...source.map((point) => Math.min(...target.map((candidate) => point.distanceTo(candidate)))),
    )
  return Math.max(directed(left, right), directed(right, left))
}

function synchronizeAfterSecondShed(fixture: CornerFixture, creationOrder: 'AB' | 'BA') {
  const level = LevelNode.parse({
    id: 'level_gutter_corner',
    level: 0,
    children: [fixture.wallA.id, fixture.wallB.id],
  })
  const firstLeanTo = creationOrder === 'AB' ? fixture.leanToA : fixture.leanToB
  const firstWall = creationOrder === 'AB' ? fixture.wallA : fixture.wallB
  const secondLeanTo = creationOrder === 'AB' ? fixture.leanToB : fixture.leanToA
  const secondWall = creationOrder === 'AB' ? fixture.wallB : fixture.wallA
  const baseNodes = Object.fromEntries(
    [level, fixture.wallA, fixture.wallB, firstLeanTo].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  const first = createLeanToAssembly(firstLeanTo, undefined, baseNodes)
  const initialNodes = Object.fromEntries(
    [
      level,
      {
        ...fixture.wallA,
        children: firstWall.id === fixture.wallA.id ? [first.extension.id] : [],
      },
      {
        ...fixture.wallB,
        children: firstWall.id === fixture.wallB.id ? [first.extension.id] : [],
      },
      first.extension,
      ...first.children,
    ].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  useScene.setState({
    collections: {},
    dirtyNodes: new Set(),
    materials: {},
    nodes: initialNodes,
    readOnly: false,
    rootNodeIds: [level.id],
  } as never)
  clearSceneHistory()
  const sceneApi = createSceneApi(useScene)
  const stop = initializeLeanToExtensionSync(sceneApi)
  const second = createLeanToAssembly(secondLeanTo, undefined, {
    ...useScene.getState().nodes,
    [secondLeanTo.id]: secondLeanTo,
  })
  sceneApi.createMany?.([
    { node: second.extension, parentId: secondWall.id },
    ...second.children.map((node) => ({
      node,
      parentId: (node.parentId as AnyNodeId | null) ?? undefined,
    })),
  ])
  return stop
}

describe('persisted lean-to gutter corner', () => {
  let stop = () => {}
  afterEach(() => stop())

  const geometryCases: {
    name: string
    options: Omit<CornerFixtureOptions, 'reverseA' | 'reverseB'>
  }[] = [
    {
      name: 'equal eaves, zero side overhang, k-style 130mm',
      options: {},
    },
    {
      name: 'editor-default automatic wall span',
      options: { autoSpan: true },
    },
    {
      name: 'snapped wall endpoints separated within corner tolerance',
      options: { wallEndGap: 0.2 },
    },
    {
      name: 'unequal pitch/eaves, asymmetric side and low overhangs',
      options: {
        pitchA: 7,
        pitchB: 16,
        highEdgeHeightA: 2.8,
        highEdgeHeightB: 3.1,
        lowOverhangA: 0,
        lowOverhangB: 0.4,
        leftOverhangA: 0.1,
        rightOverhangA: 0.35,
        leftOverhangB: 0.25,
        rightOverhangB: 0.05,
      },
    },
    {
      name: 'box profile 80mm',
      options: { profile: 'box', size: 0.08, lowOverhangA: 0.15, lowOverhangB: 0.3 },
    },
    {
      name: 'half-round profile 250mm',
      options: {
        profile: 'half-round',
        size: 0.25,
        leftOverhangA: 0.2,
        rightOverhangA: 0.2,
        leftOverhangB: 0.2,
        rightOverhangB: 0.2,
      },
    },
  ]

  test('extends accepted offset wall ends to the same roof corner', () => {
    const fixture = cornerFixture({ reverseA: false, reverseB: false, wallEndGap: 0.2 })
    const nodes = Object.fromEntries(
      [fixture.wallA, fixture.wallB, fixture.leanToA, fixture.leanToB].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>
    const jointA = resolveLeanToCornerJoints(fixture.leanToA, fixture.wallA, nodes).right
    const jointB = resolveLeanToCornerJoints(fixture.leanToB, fixture.wallB, nodes).left
    expect(jointA).toBeDefined()
    expect(jointB).toBeDefined()
    const segmentA = leanToRoofSegmentLayoutPatch(fixture.leanToA, nodes)
    const segmentB = leanToRoofSegmentLayoutPatch(fixture.leanToB, nodes)
    const cornerA = new THREE.Vector3(segmentA.width / 2, 0, segmentA.depth / 2).applyMatrix4(
      segmentWorldMatrix(fixture.wallA, fixture.leanToA, segmentA as RoofSegmentNode),
    )
    const cornerB = new THREE.Vector3(-segmentB.width / 2, 0, segmentB.depth / 2).applyMatrix4(
      segmentWorldMatrix(fixture.wallB, fixture.leanToB, segmentB as RoofSegmentNode),
    )
    expect(Math.hypot(cornerA.x - cornerB.x, cornerA.z - cornerB.z)).toBeLessThan(1e-6)
  })

  test('persists and renders a complete gutter joint at every angle from 30 through 150 degrees', () => {
    const angles = [
      ...Array.from({ length: 121 }, (_, index) => 30 + index),
      30.25,
      44.3,
      89.9,
      90.1,
      113.5,
      149.75,
    ]
    for (const angle of angles) {
      stop()
      const fixture = cornerFixture({ reverseA: false, reverseB: false, angle })
      stop = synchronizeAfterSecondShed(fixture, 'AB')
      const nodes = useScene.getState().nodes
      const a = managedGutter(fixture.leanToA, nodes)
      const b = managedGutter(fixture.leanToB, nodes)
      const geometryA = renderedGutterGeometry(fixture.wallA, fixture.leanToA, a, b)
      const geometryB = renderedGutterGeometry(fixture.wallB, fixture.leanToB, b, a)
      const boundaryA = openBoundaryPoints(geometryA)
      const boundaryB = openBoundaryPoints(geometryB)

      expect(
        (a.gutter.metadata as Record<string, { right: number }>).leanToGutterMitres.right,
      ).toBeCloseTo(((180 - angle) * Math.PI) / 360, 8)
      expect(boundaryA.length).toBeGreaterThan(3)
      expect(boundaryB.length).toBeGreaterThan(3)
      expect(boundaryHausdorffDistance(boundaryA, boundaryB)).toBeLessThan(1e-4)
      geometryA.dispose()
      geometryB.dispose()
    }
  })

  test('recomputes both gutter cuts when a connected wall angle changes', () => {
    const fixture = cornerFixture({ reverseA: false, reverseB: false })
    stop = synchronizeAfterSecondShed(fixture, 'AB')
    const wallAngle = Math.PI / 3

    useScene.getState().updateNode(fixture.wallB.id as AnyNodeId, {
      end: [4 - 4 * Math.cos(wallAngle), -4 * Math.sin(wallAngle)],
    })

    const nodes = useScene.getState().nodes
    const a = managedGutter(fixture.leanToA, nodes)
    const b = managedGutter(fixture.leanToB, nodes)
    const mitresA = (a.gutter.metadata as Record<string, { left: number; right: number }>)
      .leanToGutterMitres
    const mitresB = (b.gutter.metadata as Record<string, { left: number; right: number }>)
      .leanToGutterMitres
    expect(mitresA.right).toBeCloseTo(Math.PI / 3, 8)
    expect(mitresB.left).toBeCloseTo(Math.PI / 3, 8)
  })

  for (const reverseA of [false, true]) {
    for (const reverseB of [false, true]) {
      for (const creationOrder of ['AB', 'BA'] as const) {
        for (const geometryCase of geometryCases) {
          test(`joins the full shell: walls ${reverseA ? 'end/start' : 'start/end'} + ${reverseB ? 'start/end' : 'end/start'}, creation ${creationOrder}, ${geometryCase.name}`, () => {
            const fixture = cornerFixture({
              reverseA,
              reverseB,
              ...geometryCase.options,
            })
            stop = synchronizeAfterSecondShed(fixture, creationOrder)
            const nodes = useScene.getState().nodes
            const a = managedGutter(fixture.leanToA, nodes)
            const b = managedGutter(fixture.leanToB, nodes)
            const geometryA = renderedGutterGeometry(fixture.wallA, fixture.leanToA, a, b)
            const geometryB = renderedGutterGeometry(fixture.wallB, fixture.leanToB, b, a)
            const boundaryA = openBoundaryPoints(geometryA)
            const boundaryB = openBoundaryPoints(geometryB)
            expect(boundaryA.length).toBeGreaterThan(3)
            expect(boundaryB.length).toBeGreaterThan(3)
            expect(boundaryHausdorffDistance(boundaryA, boundaryB)).toBeLessThan(1e-4)
            geometryA.dispose()
            geometryB.dispose()
          })
        }
      }
    }
  }

  for (const [gutterEnabledA, gutterEnabledB] of [
    [true, false],
    [false, true],
    [false, false],
  ] as const) {
    test(`keeps unmatched gutter ends capped when enabled=${gutterEnabledA}/${gutterEnabledB}`, () => {
      const fixture = cornerFixture({
        reverseA: false,
        reverseB: true,
        gutterEnabledA,
        gutterEnabledB,
      })
      stop = synchronizeAfterSecondShed(fixture, 'AB')
      const nodes = useScene.getState().nodes
      const a = managedGutter(fixture.leanToA, nodes)
      const b = managedGutter(fixture.leanToB, nodes)
      const geometryA = renderedGutterGeometry(fixture.wallA, fixture.leanToA, a, b)
      const geometryB = renderedGutterGeometry(fixture.wallB, fixture.leanToB, b, a)

      expect(a.gutter.visible).toBe(gutterEnabledA)
      expect(b.gutter.visible).toBe(gutterEnabledB)
      expect(openBoundaryPoints(geometryA)).toEqual([])
      expect(openBoundaryPoints(geometryB)).toEqual([])
      geometryA.dispose()
      geometryB.dispose()
    })
  }

  test('recaps and rejoins the persisted neighbor when gutter visibility changes', () => {
    const fixture = cornerFixture({ reverseA: true, reverseB: false })
    stop = synchronizeAfterSecondShed(fixture, 'AB')

    useScene.getState().updateNode(fixture.leanToB.id as AnyNodeId, { gutterEnabled: false })
    let nodes = useScene.getState().nodes
    let a = managedGutter(fixture.leanToA, nodes)
    let b = managedGutter(fixture.leanToB, nodes)
    let geometryA = renderedGutterGeometry(fixture.wallA, fixture.leanToA, a, b)
    expect(openBoundaryPoints(geometryA)).toEqual([])
    geometryA.dispose()

    useScene.getState().updateNode(fixture.leanToB.id as AnyNodeId, { gutterEnabled: true })
    nodes = useScene.getState().nodes
    a = managedGutter(fixture.leanToA, nodes)
    b = managedGutter(fixture.leanToB, nodes)
    geometryA = renderedGutterGeometry(fixture.wallA, fixture.leanToA, a, b)
    const geometryB = renderedGutterGeometry(fixture.wallB, fixture.leanToB, b, a)
    const boundaryA = openBoundaryPoints(geometryA)
    const boundaryB = openBoundaryPoints(geometryB)
    expect(boundaryA.length).toBeGreaterThan(3)
    expect(boundaryHausdorffDistance(boundaryA, boundaryB)).toBeLessThan(1e-4)
    geometryA.dispose()
    geometryB.dispose()
  })

  for (const [flipFaceA, flipFaceB] of [
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    test(`rejects non-convex opposite-face layout ${flipFaceA}/${flipFaceB}`, () => {
      const fixture = cornerFixture({ reverseA: false, reverseB: false, flipFaceA, flipFaceB })
      stop = synchronizeAfterSecondShed(fixture, 'AB')
      const nodes = useScene.getState().nodes
      const a = managedGutter(fixture.leanToA, nodes)
      const b = managedGutter(fixture.leanToB, nodes)

      expect(
        (nodes[fixture.leanToA.id as AnyNodeId]?.metadata as Record<string, unknown>)
          ?.leanToCornerJoints,
      ).toEqual({})
      expect(
        (nodes[fixture.leanToB.id as AnyNodeId]?.metadata as Record<string, unknown>)
          ?.leanToCornerJoints,
      ).toEqual({})
      expect((a.gutter.metadata as Record<string, unknown>).leanToGutterMitres).toEqual({
        left: 0,
        right: 0,
      })
      expect((b.gutter.metadata as Record<string, unknown>).leanToGutterMitres).toEqual({
        left: 0,
        right: 0,
      })
    })
  }

  test('rejects perpendicular walls that cross away from their shed endpoints', () => {
    const base = cornerFixture({ reverseA: false, reverseB: false })
    const wallB = WallNode.parse({
      ...base.wallB,
      start: [2, 2],
      end: [2, -2],
    })
    const fixture = { ...base, wallB, leanToB: { ...base.leanToB, parentId: wallB.id } }
    stop = synchronizeAfterSecondShed(fixture, 'AB')
    const nodes = useScene.getState().nodes
    const a = managedGutter(fixture.leanToA, nodes)
    const b = managedGutter(fixture.leanToB, nodes)

    expect(
      (nodes[fixture.leanToA.id as AnyNodeId]?.metadata as Record<string, unknown>)
        ?.leanToCornerJoints,
    ).toEqual({})
    expect(
      (nodes[fixture.leanToB.id as AnyNodeId]?.metadata as Record<string, unknown>)
        ?.leanToCornerJoints,
    ).toEqual({})
    expect((a.gutter.metadata as Record<string, unknown>).leanToGutterMitres).toEqual({
      left: 0,
      right: 0,
    })
    expect((b.gutter.metadata as Record<string, unknown>).leanToGutterMitres).toEqual({
      left: 0,
      right: 0,
    })
  })
})
