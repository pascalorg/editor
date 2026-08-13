import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  getRoofSegmentVisibleTopBounds,
  LeanToExtensionNode,
  RoofNode,
  SlabNode,
  spatialGridManager,
  WallNode,
} from '@pascal-app/core'
import {
  createLeanToAssembly,
  isManagedLeanToNode,
  isManagedLeanToPost,
  leanToPostLayoutPatch,
  resolveLeanToPostBaseY,
  resolveLeanToPostGutterSetback,
} from './assembly'
import { resolveLeanToLayout } from './layout'
import { getRoofTopSurfaceY } from '../shared/roof-surface'

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
    expect(assembly.segment.position[2]).toBe(1.25)
    expect(assembly.segment.width + 2 * assembly.segment.overhang).toBeCloseTo(4.3)
    const roofBounds = getRoofSegmentVisibleTopBounds(assembly.segment)
    expect(assembly.segment.position[2] + roofBounds.minZ).toBeGreaterThanOrEqual(0)
    expect(assembly.segment.children).toEqual([assembly.gutter.id, assembly.downspout.id])
    expect(
      assembly.segment.position[1] +
        getRoofTopSurfaceY(0, -assembly.segment.depth / 2, assembly.segment),
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
