import { describe, expect, test } from 'bun:test'
import { LeanToExtensionNode } from '@pascal-app/core'
import { Box3, type BoxGeometry, type Mesh } from 'three'
import { buildGutterGeometry } from '../gutter/geometry'
import { createLeanToAssembly } from './assembly'
import { buildLeanToExtensionGeometry } from './geometry'

describe('lean-to extension geometry', () => {
  test('builds a placement preview with structure and a roof proxy', () => {
    const node = LeanToExtensionNode.parse({ postCount: 3, span: 4 })
    const group = buildLeanToExtensionGeometry(node)
    const names = group.children.map((child) => child.name)
    expect(names).toContain('lean-to-preview-roof')
    expect(names).toContain('lean-to-ledger')
    expect(names).toContain('lean-to-front-beam')
    expect(names).toContain('lean-to-high-side-flashing')
    expect(names.some((name) => name.includes('gutter'))).toBe(false)
    expect(names.some((name) => name.includes('downspout'))).toBe(false)
    expect(names.filter((name) => name.startsWith('lean-to-post-'))).toHaveLength(3)
    expect(
      names.filter((name) => name.startsWith('lean-to-rafter-')).length,
    ).toBeGreaterThanOrEqual(3)
  })

  test('models side flashing for abutting ends only', () => {
    const node = LeanToExtensionNode.parse({
      leftEndCondition: 'wall-abutment',
      rightEndCondition: 'open',
    })
    const group = buildLeanToExtensionGeometry(node)
    expect(group.getObjectByName('lean-to-left-side-flashing')).toBeDefined()
    expect(group.getObjectByName('lean-to-right-side-flashing')).toBeUndefined()
  })

  test('leaves the roof and posts to real child nodes in scene geometry', () => {
    const node = LeanToExtensionNode.parse({ postCount: 3 })
    const group = buildLeanToExtensionGeometry(node, {} as never)
    expect(
      group.children.map((child) => child.name).filter((name) => name.startsWith('lean-to-post-')),
    ).toEqual([])
    expect(group.children.map((child) => child.name)).not.toContain('lean-to-preview-roof')
  })

  test('extends connected roof framing to the wall without a full-width infill panel', () => {
    const disconnected = LeanToExtensionNode.parse({ projection: 2.5 })
    const connected = LeanToExtensionNode.parse({ projection: 2.5, connectionInset: 0.3 })
    const disconnectedGroup = buildLeanToExtensionGeometry(disconnected)
    const connectedGroup = buildLeanToExtensionGeometry(connected)
    const depth = (group: ReturnType<typeof buildLeanToExtensionGeometry>, name: string) =>
      ((group.getObjectByName(name) as Mesh<BoxGeometry>).geometry.parameters as { depth: number })
        .depth

    expect(depth(connectedGroup, 'lean-to-preview-roof')).toBeCloseTo(
      depth(disconnectedGroup, 'lean-to-preview-roof'),
    )
    expect(depth(connectedGroup, 'lean-to-rafter-0')).toBeCloseTo(
      depth(disconnectedGroup, 'lean-to-rafter-0'),
    )
    expect(connectedGroup.getObjectByName('lean-to-connection-underlap')).toBeUndefined()
    expect(disconnectedGroup.getObjectByName('lean-to-connection-underlap')).toBeUndefined()
  })

  test('continues rafters over the front beam with a small gutter clearance', () => {
    const node = LeanToExtensionNode.parse({ projection: 2.5, eaveOverhang: 0.25 })
    const group = buildLeanToExtensionGeometry(node, {} as never)
    const rafter = group.getObjectByName('lean-to-rafter-0') as Mesh<BoxGeometry>
    const rafterSlopeLength = (rafter.geometry.parameters as { depth: number }).depth
    const rafterFrontZ = rafter.position.z + (rafterSlopeLength * Math.cos(rafter.rotation.x)) / 2
    const beamOuterZ = node.projection + node.beamWidth / 2
    const assembly = createLeanToAssembly(node)
    const gutterGeometry = buildGutterGeometry(assembly.gutter)
    gutterGeometry.computeBoundingBox()
    group.updateMatrixWorld(true)
    const rafterBounds = new Box3().setFromObject(rafter)
    const gutterBackZ =
      assembly.segment.position[2] +
      assembly.gutter.position[2] +
      (gutterGeometry.boundingBox?.min.z ?? 0)
    const gutterClearance = gutterBackZ - rafterBounds.max.z

    expect(rafterFrontZ).toBeGreaterThan(beamOuterZ)
    expect(gutterClearance).toBeGreaterThan(0)
    expect(gutterClearance).toBeCloseTo(0.035, 5)
    gutterGeometry.dispose()
  })

  test('still carries rafters across the front beam when there is no eave overhang', () => {
    const node = LeanToExtensionNode.parse({ projection: 2.5, eaveOverhang: 0 })
    const group = buildLeanToExtensionGeometry(node, {} as never)
    const rafter = group.getObjectByName('lean-to-rafter-0') as Mesh<BoxGeometry>
    const rafterSlopeLength = (rafter.geometry.parameters as { depth: number }).depth
    const rafterFrontZ = rafter.position.z + (rafterSlopeLength * Math.cos(rafter.rotation.x)) / 2

    expect(rafterFrontZ).toBeCloseTo(node.projection + node.beamWidth / 2, 6)
  })

  test('ends the front beam flush with the outside faces of the end pillars', () => {
    const node = LeanToExtensionNode.parse({ span: 4, postCount: 3, postInset: 0.2 })
    const group = buildLeanToExtensionGeometry(node)
    const beam = group.getObjectByName('lean-to-front-beam') as Mesh<BoxGeometry>
    const firstPost = group.getObjectByName('lean-to-post-0') as Mesh<BoxGeometry>
    const beamWidth = (beam.geometry.parameters as { width: number }).width
    const postWidth = (firstPost.geometry.parameters as { width: number }).width
    const beamMinX = beam.position.x - beamWidth / 2
    const firstPostMinX = firstPost.position.x - postWidth / 2

    expect(beamMinX).toBeCloseTo(firstPostMinX, 6)
  })
})
