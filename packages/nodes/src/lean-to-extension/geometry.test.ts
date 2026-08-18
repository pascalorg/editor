import { describe, expect, test } from 'bun:test'
import { LeanToExtensionNode } from '@pascal-app/core'
import { resolveSurfaceColor } from '@pascal-app/viewer'
import { Box3, type BoxGeometry, type Mesh, type MeshStandardMaterial, Vector3 } from 'three'
import { buildGutterGeometry } from '../gutter/geometry'
import { createLeanToAssembly } from './assembly'
import { buildLeanToExtensionGeometry } from './geometry'
import { resolveLeanToLayout } from './layout'
import { leanToSlots } from './slots'

describe('lean-to extension geometry', () => {
  test('defaults structural framing to the untextured wall role color', () => {
    const defaults = Object.fromEntries(leanToSlots().map((slot) => [slot.slotId, slot.default]))
    const group = buildLeanToExtensionGeometry(LeanToExtensionNode.parse({}))

    expect(defaults.ledger).toBeUndefined()
    expect(defaults.beam).toBeUndefined()
    expect(defaults.framing).toBeUndefined()
    for (const name of ['lean-to-front-beam', 'lean-to-rafter-0']) {
      const material = (group.getObjectByName(name) as Mesh).material as MeshStandardMaterial
      expect(material.color.getHexString()).toBe(resolveSurfaceColor('wall', 'clay').slice(1))
      expect(material.map).toBeFalsy()
    }
  })

  test('builds a placement preview with structure and a roof proxy', () => {
    const node = LeanToExtensionNode.parse({ postCount: 3, span: 4 })
    const group = buildLeanToExtensionGeometry(node)
    const names = group.children.map((child) => child.name)
    expect(names).toContain('lean-to-preview-roof')
    expect(names).not.toContain('lean-to-ledger')
    expect(names).toContain('lean-to-front-beam')
    expect(names).not.toContain('lean-to-high-side-flashing')
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

  test('uses configurable side flashing dimensions', () => {
    const node = LeanToExtensionNode.parse({
      sideFlashing: true,
      leftEndCondition: 'wall-abutment',
      flashingHeight: 0.22,
      flashingProjection: 0.06,
    })
    const group = buildLeanToExtensionGeometry(node)
    const flashing = group.getObjectByName('lean-to-left-side-flashing') as Mesh<BoxGeometry>
    const parameters = flashing.geometry.parameters as { width: number; height: number }

    expect(parameters.height).toBeCloseTo(0.22)
    expect(parameters.width).toBeCloseTo(0.06)
  })

  test('switches between hidden, rafter, and purlin framing', () => {
    const hiddenNames = buildLeanToExtensionGeometry(
      LeanToExtensionNode.parse({ framingStrategy: 'hidden' }),
    ).children.map((child) => child.name)
    const purlinNames = buildLeanToExtensionGeometry(
      LeanToExtensionNode.parse({ framingStrategy: 'purlins' }),
    ).children.map((child) => child.name)

    expect(hiddenNames.some((name) => name.startsWith('lean-to-rafter-'))).toBe(false)
    expect(hiddenNames.some((name) => name.startsWith('lean-to-purlin-'))).toBe(false)
    expect(purlinNames.some((name) => name.startsWith('lean-to-purlin-'))).toBe(true)
    expect(purlinNames.some((name) => name.startsWith('lean-to-rafter-'))).toBe(false)
  })

  test('models an independent high beam and tags configurable finish slots', () => {
    const node = LeanToExtensionNode.parse({ highSideMode: 'independent-high-beam' })
    const group = buildLeanToExtensionGeometry(node)
    expect(group.getObjectByName('lean-to-independent-high-beam')).toBeDefined()
    expect(group.getObjectByName('lean-to-high-post-0')).toBeDefined()
    expect(group.getObjectByName('lean-to-high-side-flashing')).toBeUndefined()
    expect(group.getObjectByName('lean-to-front-beam')?.userData.slotId).toBe('beam')
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
    const node = LeanToExtensionNode.parse({ projection: 2.5, lowOverhang: 0.25 })
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
    expect(gutterClearance).toBeCloseTo(0.033, 5)
    gutterGeometry.dispose()
  })

  test('still carries rafters across the front beam when there is no eave overhang', () => {
    const node = LeanToExtensionNode.parse({ projection: 2.5, lowOverhang: 0 })
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

  test('joins curved front-beam facets at the pillar tops on both wall sides', () => {
    for (const spanArcCenterZ of [-5, 5]) {
      const node = LeanToExtensionNode.parse({
        span: 8,
        projection: 2,
        postCount: 5,
        spanArcCenterZ,
        spanArcRadius: 5,
      })
      const group = buildLeanToExtensionGeometry(node)
      const facets = group.children
        .filter((child): child is Mesh<BoxGeometry> => child.name.startsWith('lean-to-front-beam-'))
        .sort(
          (a, b) =>
            Number(a.name.slice(a.name.lastIndexOf('-') + 1)) -
            Number(b.name.slice(b.name.lastIndexOf('-') + 1)),
        )

      group.updateMatrixWorld(true)
      let maximumJointGap = 0
      for (let index = 0; index + 1 < facets.length; index++) {
        const current = facets[index]!
        const next = facets[index + 1]!
        const currentWidth = (current.geometry.parameters as { width: number }).width
        const nextWidth = (next.geometry.parameters as { width: number }).width
        const currentEnd = current.localToWorld(new Vector3(currentWidth / 2, 0, 0))
        const nextStart = next.localToWorld(new Vector3(-nextWidth / 2, 0, 0))
        maximumJointGap = Math.max(maximumJointGap, currentEnd.distanceTo(nextStart))
      }

      const firstPost = group.getObjectByName('lean-to-post-0') as Mesh<BoxGeometry>
      const postHeight = (firstPost.geometry.parameters as { height: number }).height
      const beamHeight = (facets[0]!.geometry.parameters as { height: number }).height
      const postTop = firstPost.position.y + postHeight / 2
      const beamBottom = facets[0]!.position.y - beamHeight / 2

      expect(facets.length).toBeGreaterThan(1)
      expect(group.getObjectByName('lean-to-front-beam')).toBeUndefined()
      expect(maximumJointGap).toBeLessThan(0.01)
      expect(beamBottom).toBeCloseTo(postTop, 6)
    }
  })

  test('replaces the joined boundary rafter and extends the beam to the shared corner post', () => {
    const node = LeanToExtensionNode.parse({
      span: 4,
      rightEndCondition: 'joined',
      metadata: {
        leanToCornerJoints: {
          right: {
            beamExtension: 2.5,
            gutterMitre: Math.PI / 4,
            seam: [
              [2, 0],
              [4.5, 2.5],
            ],
            sharedPostOwner: true,
          },
        },
      },
    })
    const layout = resolveLeanToLayout(node)
    const group = buildLeanToExtensionGeometry(node, {} as never)
    const beam = group.getObjectByName('lean-to-front-beam') as Mesh<BoxGeometry>
    const beamWidth = (beam.geometry.parameters as { width: number }).width
    const beamPositions = beam.geometry.getAttribute('position')
    const rightEndXs = Array.from({ length: beamPositions.count }, (_, index) =>
      beamPositions.getX(index),
    ).filter((x) => x > beamWidth / 2 - node.beamWidth * 1.1)
    const ordinaryRafters = group.children.filter((child) =>
      child.name.startsWith('lean-to-rafter-'),
    )

    expect(beamWidth).toBeCloseTo(layout.beamSpan + 2.5, 6)
    expect(beam.position.x).toBeCloseTo(1.25, 6)
    expect(Math.max(...rightEndXs) - Math.min(...rightEndXs)).toBeCloseTo(node.beamWidth, 6)
    expect(ordinaryRafters).toHaveLength(layout.rafterXs.length - 1)
    expect(group.getObjectByName('lean-to-right-corner-rafter')).toBeDefined()
    expect(group.getObjectByName('lean-to-right-side-flashing')).toBeUndefined()
  })

  test('cuts an extended corner beam at the resolved arbitrary mitre angle', () => {
    const node = LeanToExtensionNode.parse({
      span: 4,
      rightEndCondition: 'joined',
      metadata: {
        leanToCornerJoints: {
          right: {
            beamExtension: 2.5,
            gutterMitre: Math.PI / 3,
            seam: null,
            sharedPostOwner: true,
          },
        },
      },
    })
    const beam = buildLeanToExtensionGeometry(node, {} as never).getObjectByName(
      'lean-to-front-beam',
    ) as Mesh<BoxGeometry>
    const positions = beam.geometry.getAttribute('position')
    const halfLength = (beam.geometry.parameters as { width: number }).width / 2
    const endXs = Array.from({ length: positions.count }, (_, index) =>
      positions.getX(index),
    ).filter((x) => x > halfLength - node.beamWidth * 2)

    expect(Math.max(...endXs) - Math.min(...endXs)).toBeCloseTo(
      node.beamWidth * Math.tan(Math.PI / 3),
      6,
    )
  })
})
