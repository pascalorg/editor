import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  getRoofSegmentVisibleTopBounds,
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
  leanToPostLayoutPatch,
  resolveLeanToPostBaseY,
  resolveLeanToPostGutterSetback,
} from './assembly'
import { resolveLeanToLayout } from './layout'

beforeEach(() => spatialGridManager.clear())

describe('lean-to assembly', () => {
  test('composes a standard shed roof, gutter, downspout, and pillar children', () => {
    const leanTo = LeanToExtensionNode.parse({
      postCount: 4,
      postWidth: 0.18,
      postDepth: 0.14,
      span: 4,
      projection: 2.5,
      eaveOverhang: 0.25,
      sideOverhang: 0.15,
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

    expect(assembly.segment.type).toBe('roof-segment')
    expect(assembly.segment.parentId).toBe(assembly.roof.id)
    expect(assembly.segment.roofType).toBe('shed')
    expect(assembly.segment.position[0]).toBe(0)
    expect(assembly.segment.position[1]).toBeLessThan(layout.lowEdgeHeight)
    expect(assembly.segment.depth).toBeCloseTo(layout.projection + 0.02, 6)
    expect(assembly.segment.overhang).toBe(leanTo.eaveOverhang)
    expect(assembly.segment.position[2]).toBeCloseTo(layout.projection / 2 - 0.012, 6)
    expect(assembly.segment.width + 2 * assembly.segment.overhang).toBeCloseTo(4.3)
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
      expect(post.position).toEqual([layout.postXs[index], 0, leanTo.projection])
      expect(post.height).toBeCloseTo(layout.postHeight + 0.02, 6)
      expect(post.width).toBe(0.18)
      expect(post.depth).toBe(0.14)
      expect(isManagedLeanToPost(post, leanTo.id)).toBe(true)
    }
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

  test('keeps the triangular side edge recessed beneath the sloping eave', () => {
    const leanTo = LeanToExtensionNode.parse({ projection: 2.5, eaveOverhang: 0.25 })
    const layout = resolveLeanToLayout(leanTo)

    const { segment } = createLeanToAssembly(leanTo)
    const triangleFrontZ = segment.position[2] + segment.depth / 2

    const roofBounds = getRoofSegmentVisibleTopBounds(segment)
    expect(triangleFrontZ).toBeCloseTo(layout.projection - 0.002, 6)
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

  test('keeps a swapped pillar beneath the beam while its shaft clears the gutter', () => {
    const leanTo = LeanToExtensionNode.parse({ eaveOverhang: 0.25, projection: 2.5 })
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
      leanTo.projection + leanTo.eaveOverhang + 1e-6,
    )
  })
})
