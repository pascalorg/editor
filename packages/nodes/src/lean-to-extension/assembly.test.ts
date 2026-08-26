import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  getRoofSegmentVisibleTopBounds,
  getWallCurveLength,
  LeanToExtensionNode,
  LevelNode,
  RoofNode,
  resolveAutomaticDownspoutLength,
  SlabNode,
  spatialGridManager,
  WallNode,
} from '@pascal-app/core'
import { getRoofTopSurfaceY } from '../shared/roof-surface'
import {
  createLeanToAssembly,
  isManagedLeanToNode,
  isManagedLeanToPost,
  leanToCornerPostIndex,
  leanToDownspoutLayoutPatch,
  leanToGutterLayoutPatch,
  leanToPostLayoutPatch,
  leanToRoofSegmentLayoutPatch,
  managedLeanToPostIndex,
  managedLeanToPostSide,
  resolveLeanToPostBaseY,
  resolveLeanToPostGutterSetback,
} from './assembly'
import { resolveLeanToLayout, resolveLeanToWallPlacement } from './layout'
import { resolveLeanToFreestandingRunPlacement } from './placement'
import { applyLeanToWallAutoSpan } from './roof-attachment'

beforeEach(() => spatialGridManager.clear())

describe('lean-to assembly', () => {
  test('composes a standard shed roof, gutter, downspout, and pillar children', () => {
    const leanTo = LeanToExtensionNode.parse({
      postLayoutMode: 'count',
      postCount: 4,
      postWidth: 0.18,
      postDepth: 0.14,
      span: 4,
      projection: 2.5,
      lowOverhang: 0.25,
      leftOverhang: 0.15,
      rightOverhang: 0.15,
    })
    const layout = resolveLeanToLayout(leanTo)
    const assembly = createLeanToAssembly(leanTo)

    expect(assembly.extension.children).toEqual([
      assembly.roof.id,
      ...assembly.posts.map((post) => post.id),
    ])
    expect(assembly.roof.type).toBe('roof')
    expect(assembly.roof.parentId).toBe(leanTo.id)
    expect(assembly.roof.children).toEqual([assembly.segment.id])
    expect(isManagedLeanToNode(assembly.roof, leanTo.id, 'roof')).toBe(true)
    expect(assembly.roof.metadata).toMatchObject({
      nodeSelectionProxyId: leanTo.id,
    })

    expect(assembly.segment.type).toBe('roof-segment')
    expect(assembly.segment.parentId).toBe(assembly.roof.id)
    expect(assembly.segment.roofType).toBe('shed')
    expect(assembly.segment.position[0]).toBe(0)
    expect(assembly.segment.position[1]).toBeLessThan(layout.lowEdgeHeight)
    expect(assembly.segment.depth).toBeCloseTo(layout.roofRun + 0.02, 6)
    expect(assembly.segment.overhang).toBe(0)
    expect(assembly.segment).toMatchObject({
      shedSideInfillSpan: 4,
      shedSideInfillMinX: -2.04,
      shedSideInfillMaxX: 2.04,
    })
    expect(assembly.segment.metadata).toMatchObject({
      nodeSelectionProxyId: leanTo.id,
    })
    expect(assembly.segment.position[2]).toBeCloseTo(
      (leanTo.projection + leanTo.lowOverhang - leanTo.highOverhang) / 2 - 0.012,
      6,
    )
    expect(assembly.segment.width).toBeCloseTo(4.3)
    const roofBounds = getRoofSegmentVisibleTopBounds(assembly.segment)
    expect(assembly.segment.position[2] + roofBounds.minZ).toBeCloseTo(-0.02, 6)
    expect(assembly.segment.children).toEqual([assembly.gutter.id, assembly.downspout.id])
    expect(
      assembly.segment.position[1] +
        getRoofTopSurfaceY(
          0,
          -assembly.segment.depth / 2 + assembly.segment.trim.back + 0.02,
          assembly.segment,
        ),
    ).toBeCloseTo(leanTo.highEdgeHeight, 5)

    expect(assembly.gutter.type).toBe('gutter')
    expect(assembly.gutter.parentId).toBe(assembly.segment.id)
    expect(assembly.gutter.roofSegmentId).toBe(assembly.segment.id)
    expect(assembly.gutter.profile).toBe('k-style')
    expect(assembly.gutter.outlets).toHaveLength(1)

    expect(assembly.downspout.type).toBe('downspout')
    expect(assembly.downspout.parentId).toBe(assembly.segment.id)
    expect(assembly.downspout.gutterId).toBe(assembly.gutter.id)
    expect(assembly.downspout.outletId).toBe(assembly.gutter.outlets[0]?.id)
    expect(assembly.downspout.strapStyle).toBe('none')
    expect(assembly.downspout.terminal).toBe('straight')
    expect(assembly.downspout.lengthMode).toBe('to-ground')

    expect(assembly.posts).toHaveLength(4)
    for (const [index, post] of assembly.posts.entries()) {
      expect(post.type).toBe('column')
      expect(post.parentId).toBe(leanTo.id)
      expect(post.position).toEqual([layout.postXs[index], 0, layout.beamZ])
      expect(post.height).toBeCloseTo(layout.postHeight + 0.02, 6)
      expect(post.width).toBe(0.18)
      expect(post.depth).toBe(0.14)
      expect(isManagedLeanToPost(post, leanTo.id)).toBe(true)
    }
  })

  test('bends the managed roof-segment, gutter, and posts to follow a curved host', () => {
    const leanTo = LeanToExtensionNode.parse({
      span: 6,
      projection: 2.5,
      highEdgeHeight: 2.8,
      postLayoutMode: 'count',
      postCount: 3,
      spanArcCenterZ: 5,
      spanArcRadius: 5,
    })

    const segmentPatch = leanToRoofSegmentLayoutPatch(leanTo)
    expect(Number.isFinite(segmentPatch.arc?.radius ?? Number.NaN)).toBe(true)
    expect(segmentPatch.arc?.radius).toBeCloseTo(5, 6)

    const assembly = createLeanToAssembly(leanTo)
    expect(Number.isFinite(assembly.segment.arc?.radius ?? Number.NaN)).toBe(true)

    const gutterPatch = leanToGutterLayoutPatch(assembly.segment, leanTo, assembly.gutter)
    expect(Number.isFinite(gutterPatch.arc?.radius ?? Number.NaN)).toBe(true)
    expect(gutterPatch.arc?.radius).toBeCloseTo(assembly.segment.arc?.radius ?? 0, 6)

    // Center post sits on the crown (no yaw); an end post bends off the
    // chord and yaws toward the local arc tangent.
    const centerPost = leanToPostLayoutPatch(leanTo, 1)
    const endPost = leanToPostLayoutPatch(leanTo, 0)
    expect(centerPost.rotation).toBeCloseTo(0, 6)
    expect(Math.abs(endPost.rotation)).toBeGreaterThan(1e-3)
  })

  test('builds unmodified 3D roof assemblies across a curved-to-tangent-straight join', () => {
    const curvedWall = WallNode.parse({
      id: 'wall_curved_3d_continuation',
      parentId: 'level_3d_continuation',
      start: [0, 0],
      end: [6, 0],
      curveOffset: 1,
      children: ['leanto_curved_3d_continuation'],
    })
    const straightWall = WallNode.parse({
      id: 'wall_straight_3d_continuation',
      parentId: 'level_3d_continuation',
      start: [6, 0],
      end: [10.8, 3.6],
      children: ['leanto_straight_3d_continuation'],
    })
    const curved = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(curvedWall, getWallCurveLength(curvedWall) / 2, 'front')!,
        curvedWall,
      ),
      id: 'leanto_curved_3d_continuation',
    }
    const straight = {
      ...applyLeanToWallAutoSpan(
        resolveLeanToWallPlacement(straightWall, 3, 'front')!,
        straightWall,
      ),
      id: 'leanto_straight_3d_continuation',
    }
    const nodes = {
      [curvedWall.id]: curvedWall,
      [straightWall.id]: straightWall,
      [curved.id]: curved,
      [straight.id]: straight,
    } as Record<string, AnyNode>

    const curvedAssembly = createLeanToAssembly(curved, undefined, nodes)
    const straightAssembly = createLeanToAssembly(straight, undefined, nodes)

    expect(curvedAssembly.segment.arc?.radius).toBeCloseTo(5, 6)
    expect(straightAssembly.segment.arc).toBeUndefined()
    expect(straightAssembly.segment.width).toBeCloseTo(resolveLeanToLayout(straight).roofWidth, 6)
    expect(straightAssembly.segment.shedFootprintPieces).toBeUndefined()
  })

  test('keeps the roof bend reference on the true wall radius', () => {
    const leanTo = LeanToExtensionNode.parse({
      span: 6,
      projection: 2.5,
      spanArcCenterZ: 4.9,
      spanArcRadius: 5,
    })

    const segment = leanToRoofSegmentLayoutPatch(leanTo)
    expect(segment.arc?.radius).toBeCloseTo(5, 6)
  })

  test('composes terrain-aware high-side columns for an independent beam', () => {
    const leanTo = LeanToExtensionNode.parse({
      highSideMode: 'independent-high-beam',
      postLayoutMode: 'count',
      postCount: 3,
    })
    const assembly = createLeanToAssembly(leanTo)
    const highPosts = assembly.posts.filter((post) => managedLeanToPostSide(post) === 'high')

    expect(assembly.posts).toHaveLength(6)
    expect(highPosts).toHaveLength(3)
    expect(highPosts.every((post) => post.position[2] === 0)).toBe(true)
  })

  test('resolves a managed upper-storey downspout to world ground', () => {
    const building = BuildingNode.parse({ id: 'building_test', position: [0, 1, 0] })
    const level = LevelNode.parse({
      id: 'level_upper',
      parentId: building.id,
      level: 1,
      baseElevation: 3,
    })
    const wall = WallNode.parse({
      id: 'wall_upper',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const leanTo = LeanToExtensionNode.parse({ parentId: wall.id, position: [2, 0, 0.05] })
    const assembly = createLeanToAssembly(leanTo)
    const nodes = Object.fromEntries(
      [building, level, wall, assembly.extension, ...assembly.children].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>
    const outlet = assembly.gutter.outlets[0]!

    expect(
      resolveAutomaticDownspoutLength(nodes, assembly.segment, assembly.gutter, outlet.offset),
    ).toBeGreaterThan(5)
  })

  test('applies configurable gutter profile, size, and outlet position', () => {
    const leanTo = LeanToExtensionNode.parse({
      gutterProfile: 'half-round',
      gutterSize: 0.18,
      downspoutPosition: -1,
    })
    const assembly = createLeanToAssembly(leanTo)

    expect(assembly.gutter.profile).toBe('half-round')
    expect(assembly.gutter.size).toBe(0.18)
    expect(assembly.gutter.outlets[0]?.offset).toBeLessThan(0)
  })

  test('keeps managed drainage composed but hidden when disabled', () => {
    const leanTo = LeanToExtensionNode.parse({ gutterEnabled: false })
    const assembly = createLeanToAssembly(leanTo)

    expect(assembly.gutter.visible).toBe(false)
    expect(assembly.gutter.outlets).toEqual([])
    expect(assembly.downspout.visible).toBe(false)
  })

  test('preserves manually adjusted managed drainage', () => {
    const leanTo = LeanToExtensionNode.parse({ downspoutPosition: 1 })
    const assembly = createLeanToAssembly(leanTo)
    const manualGutter = {
      ...assembly.gutter,
      outlets: [{ ...assembly.gutter.outlets[0]!, offset: -0.4, generatedBy: undefined }],
    }
    const manualDownspout = { ...assembly.downspout, length: 1.7, lengthMode: 'manual' as const }

    const gutterPatch = leanToGutterLayoutPatch(assembly.segment, leanTo, manualGutter)
    const downspoutPatch = leanToDownspoutLayoutPatch(
      assembly.segment,
      { ...manualGutter, ...gutterPatch },
      leanTo,
      manualDownspout,
    )

    expect(gutterPatch.outlets[0]?.offset).toBe(-0.4)
    expect(downspoutPatch.lengthMode).toBe('manual')
  })

  test('matches the connected roof material without changing the host roof', () => {
    const leanTo = LeanToExtensionNode.parse({ matchHostRoofMaterial: true })
    const hostRoof = RoofNode.parse({
      materialPreset: 'standing-seam',
      topMaterialPreset: 'wood',
      edgeMaterialPreset: 'metal',
    })
    const originalHost = structuredClone(hostRoof)

    const assembly = createLeanToAssembly(leanTo, hostRoof)

    expect(assembly.roof.materialPreset).toBe(hostRoof.materialPreset)
    expect(assembly.roof.topMaterialPreset).toBe(hostRoof.topMaterialPreset)
    expect(assembly.roof.edgeMaterialPreset).toBe(hostRoof.edgeMaterialPreset)
    expect(hostRoof).toEqual(originalHost)
  })

  test('places the connected roof cut on the wall so its sloped side edges reach it', () => {
    const leanTo = LeanToExtensionNode.parse({ projection: 2.5, connectionInset: 0.3 })

    const assembly = createLeanToAssembly(leanTo)
    const bounds = getRoofSegmentVisibleTopBounds(assembly.segment)

    expect(assembly.segment.trim.back).toBeCloseTo(0.002, 6)
    expect(assembly.segment.position[2] + bounds.minZ).toBeCloseTo(-0.02, 6)
  })

  test('automatically fills perpendicular lean-to roof corners', () => {
    const wallA = WallNode.parse({
      id: 'wall_a',
      parentId: 'level_test',
      start: [0, 0],
      end: [4, 0],
    })
    const wallB = WallNode.parse({
      id: 'wall_b',
      parentId: 'level_test',
      start: [4, 0],
      end: [4, -4],
    })
    const leanToA = LeanToExtensionNode.parse({
      id: 'leanto_a',
      parentId: wallA.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const leanToB = LeanToExtensionNode.parse({
      id: 'leanto_b',
      parentId: wallB.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wallA.id]: wallA,
      [wallB.id]: wallB,
      [leanToA.id]: leanToA,
      [leanToB.id]: leanToB,
    } as Record<string, AnyNode>

    const assembly = createLeanToAssembly(leanToA, undefined, nodes)
    const neighborAssembly = createLeanToAssembly(leanToB, undefined, nodes)
    const layout = resolveLeanToLayout(leanToA)
    const neighborLayout = resolveLeanToLayout(leanToB)

    const pointInLevel = (
      point: readonly [number, number],
      extension: typeof leanToA,
      host: typeof wallA,
    ): readonly [number, number] => {
      const leanCos = Math.cos(extension.rotation[1])
      const leanSin = Math.sin(extension.rotation[1])
      const wallAngle = Math.atan2(host.end[1] - host.start[1], host.end[0] - host.start[0])
      const wallCos = Math.cos(wallAngle)
      const wallSin = Math.sin(wallAngle)
      const wallX = extension.position[0] + point[0] * leanCos + point[1] * leanSin
      const wallZ = extension.position[2] - point[0] * leanSin + point[1] * leanCos
      return [
        host.start[0] + wallX * wallCos - wallZ * wallSin,
        host.start[1] + wallX * wallSin + wallZ * wallCos,
      ]
    }
    const gutterEnd = (
      gutter: typeof assembly.gutter,
      segment: typeof assembly.segment,
      extension: typeof leanToA,
      host: typeof wallA,
      side: 'left' | 'right',
    ) => {
      const sign = side === 'left' ? -1 : 1
      const localX = gutter.position[0] + ((Math.cos(gutter.rotation) * gutter.length) / 2) * sign
      const localZ = gutter.position[2] - ((Math.sin(gutter.rotation) * gutter.length) / 2) * sign
      return pointInLevel(
        [segment.position[0] + localX, segment.position[2] + localZ],
        extension,
        host,
      )
    }

    expect(assembly.segment.width).toBeGreaterThan(layout.roofWidth)
    expect(assembly.segment.position[0]).toBeGreaterThan(layout.roofCenterX)
    expect(assembly.segment.trim.frontRightX).toBe(0)
    expect(assembly.segment.trim.frontRightZ).toBe(0)
    expect(assembly.segment.trim.backLeftX).toBe(0)
    expect(assembly.segment.trim.backLeftZ).toBe(0)
    expect(assembly.segment.trim.backRightX).toBe(0)
    expect(assembly.segment.trim.backRightZ).toBe(0)
    expect(assembly.segment.shedOpenEndSides).toEqual(['right'])
    expect(assembly.segment.shedFootprintPieces).toHaveLength(2)
    expect(
      assembly.posts.some(
        (post) => managedLeanToPostIndex(post) === leanToCornerPostIndex('right'),
      ),
    ).toBe(true)
    expect(assembly.gutter.length).toBeCloseTo(assembly.segment.width, 6)
    expect(assembly.gutter.position[0]).toBeCloseTo(0, 6)
    expect(assembly.gutter.metadata).toMatchObject({
      leanToGutterMitres: { left: 0, right: Math.PI / 4 },
    })
    expect(neighborAssembly.gutter.metadata).toMatchObject({
      leanToGutterMitres: { left: Math.PI / 4, right: 0 },
    })

    const gutterA = gutterEnd(assembly.gutter, assembly.segment, leanToA, wallA, 'right')
    const gutterB = gutterEnd(
      neighborAssembly.gutter,
      neighborAssembly.segment,
      leanToB,
      wallB,
      'left',
    )
    expect(gutterA[0]).toBeCloseTo(gutterB[0], 6)
    expect(gutterA[1]).toBeCloseTo(gutterB[1], 6)

    const cornerPost = assembly.posts.find(
      (post) => managedLeanToPostIndex(post) === leanToCornerPostIndex('right'),
    )!
    const postFromA = pointInLevel([cornerPost.position[0], cornerPost.position[2]], leanToA, wallA)
    const postFromB = pointInLevel(
      [-neighborLayout.span / 2 - leanToA.position[2] - layout.beamZ, neighborLayout.beamZ],
      leanToB,
      wallB,
    )
    expect(postFromA[0]).toBeCloseTo(postFromB[0], 6)
    expect(postFromA[1]).toBeCloseTo(postFromB[1], 6)
  })

  test('keeps perpendicular lean-to roof corners square when auto miter is disabled', () => {
    const wallA = WallNode.parse({
      id: 'wall_a_disabled',
      parentId: 'level_test',
      start: [0, 0],
      end: [4, 0],
    })
    const wallB = WallNode.parse({
      id: 'wall_b_disabled',
      parentId: 'level_test',
      start: [4, 0],
      end: [4, 4],
    })
    const leanToA = LeanToExtensionNode.parse({
      id: 'leanto_a_disabled',
      parentId: wallA.id,
      position: [2, 0, 0.05],
      span: 4,
      autoMiterCorners: false,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const leanToB = LeanToExtensionNode.parse({
      id: 'leanto_b_disabled',
      parentId: wallB.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wallA.id]: wallA,
      [wallB.id]: wallB,
      [leanToA.id]: leanToA,
      [leanToB.id]: leanToB,
    } as Record<string, AnyNode>

    const assembly = createLeanToAssembly(leanToA, undefined, nodes)

    expect(assembly.segment.width).toBeCloseTo(resolveLeanToLayout(leanToA).roofWidth, 6)
    expect(assembly.segment.trim.backRightX).toBe(0)
    expect(assembly.segment.trim.backRightZ).toBe(0)
    expect(
      assembly.posts.some(
        (post) => managedLeanToPostIndex(post) === leanToCornerPostIndex('right'),
      ),
    ).toBe(false)
  })

  test('does not connect perpendicular lean-to roof corners across levels', () => {
    const wallA = WallNode.parse({
      id: 'wall_a_level',
      parentId: 'level_ground',
      start: [0, 0],
      end: [4, 0],
    })
    const wallB = WallNode.parse({
      id: 'wall_b_level',
      parentId: 'level_upper',
      start: [4, 0],
      end: [4, 4],
    })
    const leanToA = LeanToExtensionNode.parse({
      id: 'leanto_a_level',
      parentId: wallA.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const leanToB = LeanToExtensionNode.parse({
      id: 'leanto_b_level',
      parentId: wallB.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wallA.id]: wallA,
      [wallB.id]: wallB,
      [leanToA.id]: leanToA,
      [leanToB.id]: leanToB,
    } as Record<string, AnyNode>

    const assembly = createLeanToAssembly(leanToA, undefined, nodes)

    expect(assembly.segment.width).toBeCloseTo(resolveLeanToLayout(leanToA).roofWidth, 6)
    expect(assembly.segment.trim.backRightX).toBe(0)
    expect(
      assembly.posts.some(
        (post) => managedLeanToPostIndex(post) === leanToCornerPostIndex('right'),
      ),
    ).toBe(false)
  })

  test('keeps the triangular side edge recessed beneath the sloping eave', () => {
    const leanTo = LeanToExtensionNode.parse({ projection: 2.5, lowOverhang: 0.25 })
    const layout = resolveLeanToLayout(leanTo)

    const { segment } = createLeanToAssembly(leanTo)
    const triangleFrontZ = segment.position[2] + segment.depth / 2

    const roofBounds = getRoofSegmentVisibleTopBounds(segment)
    expect(triangleFrontZ).toBeCloseTo(layout.projection + leanTo.lowOverhang - 0.002, 6)
    expect(segment.position[2] + roofBounds.maxZ).toBeGreaterThan(triangleFrontZ)
  })

  test('extends managed pillars down from a slab-supported wall to exterior ground', () => {
    const levelId = 'level_test'
    const slab = SlabNode.parse({
      id: 'slab_test',
      parentId: levelId,
      polygon: [
        [-3, -1],
        [3, -1],
        [3, 0.2],
        [-3, 0.2],
      ],
      elevation: 0.2,
    })
    const wall = WallNode.parse({
      id: 'wall_test',
      parentId: levelId,
      start: [-2, 0],
      end: [2, 0],
      thickness: 0.1,
      supportSlabId: slab.id,
    })
    const leanTo = LeanToExtensionNode.parse({
      parentId: wall.id,
      position: [2, 0, wall.thickness / 2],
      projection: 2.5,
    })
    const level = {
      id: levelId,
      type: 'level',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      children: [slab.id, wall.id],
      level: 0,
      height: 2.5,
      baseElevation: 0,
    } as AnyNode
    const nodes = {
      [level.id]: level,
      [slab.id]: slab,
      [wall.id]: wall,
      [leanTo.id]: leanTo,
    }
    spatialGridManager.handleNodeCreated(slab, levelId)

    const baseY = resolveLeanToPostBaseY(leanTo, wall, nodes, 0)
    const post = leanToPostLayoutPatch(leanTo, 0, baseY)

    expect(post.position[1]).toBeCloseTo(-0.22, 6)
    expect(post.position[1] + post.height).toBeCloseTo(
      resolveLeanToLayout(leanTo).postHeight + 0.02,
      6,
    )
  })

  test('extends freestanding canopy posts from an upper level down to site ground', () => {
    const building = BuildingNode.parse({
      id: 'building_freestanding_post',
      children: ['level_freestanding_lower', 'level_freestanding_upper'],
    })
    const lower = LevelNode.parse({
      id: 'level_freestanding_lower',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const upper = LevelNode.parse({
      id: 'level_freestanding_upper',
      parentId: building.id,
      level: 1,
      height: 3,
    })
    const leanTo = LeanToExtensionNode.parse({
      parentId: upper.id,
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      position: [0, 0, 0],
    })
    const nodes = {
      [building.id]: building,
      [lower.id]: lower,
      [upper.id]: upper,
      [leanTo.id]: leanTo,
    } as Record<string, AnyNode>

    const baseY = resolveLeanToPostBaseY(leanTo, undefined, nodes, 0)
    const post = leanToPostLayoutPatch(leanTo, 0, baseY)

    expect(post.position[1]).toBeCloseTo(-3.02, 6)
    expect(post.position[1] + post.height).toBeCloseTo(
      resolveLeanToLayout(leanTo).postHeight + 0.02,
      6,
    )
  })

  test('extends upper-storey pillars through open space to site ground', () => {
    const building = BuildingNode.parse({
      id: 'building_upper_post',
      children: ['level_lower_post', 'level_upper_post'],
    })
    const lower = LevelNode.parse({
      id: 'level_lower_post',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const upper = LevelNode.parse({
      id: 'level_upper_post',
      parentId: building.id,
      level: 1,
      height: 3,
      children: ['wall_upper_post'],
    })
    const wall = WallNode.parse({
      id: 'wall_upper_post',
      parentId: upper.id,
      start: [-2, 0],
      end: [2, 0],
      thickness: 0.1,
    })
    const leanTo = LeanToExtensionNode.parse({
      parentId: wall.id,
      position: [2, 0, wall.thickness / 2],
      projection: 2.5,
    })
    const nodes = Object.fromEntries(
      [building, lower, upper, wall, leanTo].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const baseY = resolveLeanToPostBaseY(leanTo, wall, nodes, 0)
    const post = leanToPostLayoutPatch(leanTo, 0, baseY)

    expect(post.position[1]).toBeCloseTo(-3.02, 6)
    expect(post.position[1] + post.height).toBeCloseTo(
      resolveLeanToLayout(leanTo).postHeight + 0.02,
      6,
    )
  })

  test('keeps a swapped pillar beneath the beam while its shaft clears the gutter', () => {
    const leanTo = LeanToExtensionNode.parse({ lowOverhang: 0.25, projection: 2.5 })
    const swapped = {
      ...createLeanToAssembly(leanTo).posts[0]!,
      capitalStyle: 'wood-bracket' as const,
      capitalHeight: 0.3,
      capitalWidthScale: 2,
      bracketDepth: 0.5,
    }

    const setback = resolveLeanToPostGutterSetback(leanTo, swapped)
    const post = leanToPostLayoutPatch(leanTo, 0, 0, setback)
    expect(setback).toBeGreaterThan(0)
    expect(post.position[1] + post.height).toBeGreaterThan(resolveLeanToLayout(leanTo).postHeight)
    expect(post.position[2]).toBeGreaterThanOrEqual(leanTo.projection - leanTo.beamWidth / 2)
    expect(post.position[2] + swapped.depth / 2 + 0.02).toBeLessThanOrEqual(
      leanTo.projection + leanTo.lowOverhang + 1e-6,
    )
  })

  test('composes a freestanding gable canopy with two eaves and two outer post rows', () => {
    const leanTo = LeanToExtensionNode.parse({
      canopyForm: 'gable',
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      postLayoutMode: 'count',
      postCount: 3,
      projection: 3,
      lowOverhang: 0.25,
    })
    const layout = resolveLeanToLayout(leanTo)
    const assembly = createLeanToAssembly(leanTo)

    expect(assembly.segment.roofType).toBe('shed')
    expect(assembly.oppositeSegment?.roofType).toBe('shed')
    expect(assembly.segment.depth).toBeCloseTo(3.25)
    expect(assembly.oppositeSegment?.depth).toBeCloseTo(3.25)
    expect(assembly.segment.rotation).toBe(0)
    expect(assembly.oppositeSegment?.rotation).toBeCloseTo(Math.PI)
    expect(assembly.oppositeGutter).toBeDefined()
    expect(assembly.oppositeDownspout?.gutterId).toBe(assembly.oppositeGutter?.id)
    expect(assembly.gutter.position[2]).toBeCloseTo(1.625)
    expect(assembly.oppositeGutter?.position[2]).toBeCloseTo(1.625)
    expect(assembly.oppositeGutter?.parentId).toBe(assembly.oppositeSegment?.id)
    expect(assembly.oppositeSegment?.children).toEqual([
      assembly.oppositeGutter?.id,
      assembly.oppositeDownspout?.id,
    ])
    expect(assembly.posts).toHaveLength(6)
    expect(
      assembly.posts
        .filter((post) => managedLeanToPostSide(post) === 'high')
        .map((post) => post.position[2]),
    ).toEqual([layout.oppositeBeamZ, layout.oppositeBeamZ, layout.oppositeBeamZ])
  })

  test('composes a butterfly canopy from two inward shed planes with one valley drain', () => {
    const leanTo = LeanToExtensionNode.parse({
      canopyForm: 'butterfly',
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      postLayoutMode: 'count',
      postCount: 3,
      projection: 3,
      lowOverhang: 0.25,
    })
    const layout = resolveLeanToLayout(leanTo)
    const assembly = createLeanToAssembly(leanTo)

    expect(assembly.segment.roofType).toBe('shed')
    expect(assembly.oppositeSegment?.roofType).toBe('shed')
    expect(assembly.segment.rotation).toBeCloseTo(Math.PI)
    expect(assembly.oppositeSegment?.rotation).toBe(0)
    expect(assembly.roof.children).toHaveLength(2)
    expect(assembly.oppositeGutter).toBeUndefined()
    expect(assembly.oppositeDownspout).toBeUndefined()
    const valleyWorldZ =
      assembly.segment.position[2] +
      Math.cos(assembly.segment.rotation) * assembly.gutter.position[2]
    expect(valleyWorldZ).toBeCloseTo(0)
    expect(assembly.posts).toHaveLength(6)
    expect(
      assembly.posts
        .filter((post) => managedLeanToPostSide(post) === 'high')
        .map((post) => post.position[2]),
    ).toEqual([layout.oppositeBeamZ, layout.oppositeBeamZ, layout.oppositeBeamZ])
  })

  test('miters both halves of joined gable roofs and joins both eaves', () => {
    const level = LevelNode.parse({ id: 'level_joined_gables', level: 0 })
    const first = resolveLeanToFreestandingRunPlacement(level.id, [0, 0], [4, 0], false, 'gable')!
    const second = resolveLeanToFreestandingRunPlacement(level.id, [4, 0], [4, 4], false, 'gable')!
    const nodes = Object.fromEntries(
      [level, first, second].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const assembly = createLeanToAssembly(first, undefined, nodes)
    const run = first.projection + first.lowOverhang

    expect(assembly.segment.trim.right).toBeCloseTo(first.rightOverhang)
    expect(assembly.segment.trim.frontRightX).toBeCloseTo(run)
    expect(assembly.segment.trim.frontRightZ).toBeCloseTo(run)
    expect(assembly.segment.trim.backRightX).toBe(0)
    expect(assembly.gutter.length).toBeCloseTo(first.span + first.leftOverhang - run)
    expect(assembly.gutter.endCapRight).toBe(false)
    expect(assembly.oppositeSegment?.width).toBeCloseTo(first.span + first.leftOverhang + run)
    expect(assembly.oppositeSegment?.trim.backLeftX).toBeCloseTo(run)
    expect(assembly.oppositeSegment?.trim.backLeftZ).toBeCloseTo(run)
    expect(assembly.oppositeGutter?.length).toBeCloseTo(first.span + first.leftOverhang + run)
    expect(assembly.oppositeGutter?.endCapLeft).toBe(false)
  })

  test('maps a joined butterfly cut onto the rotated roof plane and valley gutter', () => {
    const level = LevelNode.parse({ id: 'level_joined_butterflies', level: 0 })
    const first = resolveLeanToFreestandingRunPlacement(
      level.id,
      [0, 0],
      [4, 0],
      false,
      'butterfly',
    )!
    const second = resolveLeanToFreestandingRunPlacement(
      level.id,
      [4, 0],
      [4, 4],
      false,
      'butterfly',
    )!
    const nodes = Object.fromEntries(
      [level, first, second].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const assembly = createLeanToAssembly(first, undefined, nodes)
    const run = first.projection + first.lowOverhang

    expect(assembly.segment.trim.left).toBeCloseTo(first.rightOverhang)
    expect(assembly.segment.trim.backLeftX).toBeCloseTo(run)
    expect(assembly.segment.trim.backLeftZ).toBeCloseTo(run)
    expect(assembly.oppositeSegment?.width).toBeCloseTo(first.span + first.leftOverhang + run)
    expect(assembly.oppositeSegment?.trim.frontRightX).toBeCloseTo(run)
    expect(assembly.oppositeSegment?.trim.frontRightZ).toBeCloseTo(run)
    expect(assembly.gutter.length).toBeCloseTo(first.span + first.leftOverhang)
    expect(assembly.gutter.endCapLeft).toBe(false)
  })

  test.each([
    'gable',
    'butterfly',
  ] as const)('replaces duplicate %s corner posts with one shared post on each support row', (canopyForm) => {
    const level = LevelNode.parse({ id: `level_${canopyForm}_shared_posts`, level: 0 })
    const first = resolveLeanToFreestandingRunPlacement(
      level.id,
      [0, 0],
      [8, 0],
      false,
      canopyForm,
    )!
    const second = resolveLeanToFreestandingRunPlacement(
      level.id,
      [8, 0],
      [8, 8],
      false,
      canopyForm,
    )!
    const nodes = Object.fromEntries(
      [level, first, second].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const assemblies = [
      createLeanToAssembly(first, undefined, nodes),
      createLeanToAssembly(second, undefined, nodes),
    ]
    const posts = assemblies.flatMap((assembly) => assembly.posts)
    const sharedPosts = posts.filter((post) => {
      const index = managedLeanToPostIndex(post)
      return index === leanToCornerPostIndex('left') || index === leanToCornerPostIndex('right')
    })

    expect(posts).toHaveLength(resolveLeanToLayout(first).postXs.length * 4 - 2)
    expect(sharedPosts).toHaveLength(2)
    expect(sharedPosts.map(managedLeanToPostSide).sort()).toEqual(['high', 'low'])
  })

  test('joins every valid freestanding direction for every canopy form', () => {
    for (const canopyForm of ['mono', 'gable', 'butterfly'] as const) {
      for (const turnDirection of [-1, 1] as const) {
        for (const turnDegrees of [0, 5, 15, 25, 45, 90, 135, 155, 165, 175]) {
          const level = LevelNode.parse({
            id: `level_${canopyForm}_${turnDirection}_${turnDegrees}`,
            level: 0,
          })
          const radians = (turnDirection * turnDegrees * Math.PI) / 180
          const joint: [number, number] = [100, 0]
          const end: [number, number] = [
            joint[0] + 100 * Math.cos(radians),
            joint[1] + 100 * Math.sin(radians),
          ]
          const first = resolveLeanToFreestandingRunPlacement(
            level.id,
            [0, 0],
            joint,
            false,
            canopyForm,
          )!
          const second = resolveLeanToFreestandingRunPlacement(
            level.id,
            joint,
            end,
            false,
            canopyForm,
          )!
          const nodes = Object.fromEntries(
            [level, first, second].map((node) => [node.id, node]),
          ) as Record<string, AnyNode>
          const firstAssembly = createLeanToAssembly(first, undefined, nodes)
          const secondAssembly = createLeanToAssembly(second, undefined, nodes)

          if (canopyForm === 'butterfly') {
            expect(firstAssembly.gutter.endCapLeft).toBe(false)
            expect(secondAssembly.gutter.endCapRight).toBe(false)
          } else {
            expect(firstAssembly.gutter.endCapRight).toBe(false)
            expect(secondAssembly.gutter.endCapLeft).toBe(false)
          }
          if (canopyForm === 'mono' && turnDegrees === 0) {
            expect(firstAssembly.segment.trim.right).toBeCloseTo(first.rightOverhang)
            expect(secondAssembly.segment.trim.left).toBeCloseTo(second.leftOverhang)
          }
          if (canopyForm === 'gable') {
            expect(firstAssembly.oppositeGutter?.endCapLeft).toBe(false)
            expect(secondAssembly.oppositeGutter?.endCapRight).toBe(false)
          }
        }
      }
    }
  })
})
