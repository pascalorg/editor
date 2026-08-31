import { describe, expect, test } from 'bun:test'
import {
  getDormerDefaultWindowFace,
  getDormerExposedFaces,
  getRoofSegmentSurfaceY,
  type RoofSegmentNode,
  type RoofType,
  WindowNode,
} from '@pascal-app/core'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { buildDormerRoofCut, generateDormerGeometry } from '../csg-geometry'
import { buildDormerGhostGeometry } from '../geometry'
import { DormerNode } from '../schema'

describe('buildDormerGhostGeometry (placement preview)', () => {
  test('returns a buffer geometry with position attribute', () => {
    const geo = buildDormerGhostGeometry(DormerNode.parse({}))
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
  })

  test('width / depth drive the silhouette footprint', () => {
    const geo = buildDormerGhostGeometry(DormerNode.parse({ width: 2, depth: 4, height: 1 }))
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(2)
    expect(bb.max.z - bb.min.z).toBeCloseTo(4)
  })

  test('roofHeight raises the gable peak', () => {
    const a = buildDormerGhostGeometry(DormerNode.parse({ roofHeight: 0.5 }))
    const b = buildDormerGhostGeometry(DormerNode.parse({ roofHeight: 1.5 }))
    a.computeBoundingBox()
    b.computeBoundingBox()
    expect(b.boundingBox!.max.y).toBeGreaterThan(a.boundingBox!.max.y)
  })

  test('shedHighSide flips the shed pitch direction', () => {
    const backHigh = buildDormerGhostGeometry(
      DormerNode.parse({
        roofType: 'shed',
        shedHighSide: 'back',
        width: 4,
        depth: 3,
        height: 1,
        roofHeight: 1.2,
      }),
    )
    const frontHigh = buildDormerGhostGeometry(
      DormerNode.parse({
        roofType: 'shed',
        shedHighSide: 'front',
        width: 4,
        depth: 3,
        height: 1,
        roofHeight: 1.2,
      }),
    )

    const edgeMaxY = (geometry: typeof backHigh, z: number) => {
      const position = geometry.getAttribute('position')
      let maxY = -Infinity
      for (let index = 0; index < position.count; index++) {
        if (Math.abs(position.getZ(index) - z) < 0.001) {
          maxY = Math.max(maxY, position.getY(index))
        }
      }
      return maxY
    }

    expect(edgeMaxY(backHigh, -1.5)).toBeGreaterThan(edgeMaxY(backHigh, 1.5))
    expect(edgeMaxY(frontHigh, 1.5)).toBeGreaterThan(edgeMaxY(frontHigh, -1.5))

    backHigh.dispose()
    frontHigh.dispose()
  })

  test.each([
    ['flat', 1],
    ['gable', 2],
    ['hip', 2],
    ['shed', 2],
    ['gambrel', 3],
    ['mansard', 3],
    ['dutch', 4],
  ] satisfies [
    RoofType,
    number,
  ][])('builds the canonical %s height profile', (roofType, levels) => {
    const wallHeight = 1
    const geo = buildDormerGhostGeometry(
      DormerNode.parse({ roofType, width: 4, depth: 3, height: wallHeight, roofHeight: 1.2 }),
    )
    const position = geo.getAttribute('position')
    const roofLevels = new Set<number>()
    for (let index = 0; index < position.count; index++) {
      const y = position.getY(index)
      if (y >= wallHeight - 0.001) roofLevels.add(Math.round(y * 1000))
    }

    expect(roofLevels.size).toBe(levels)
  })

  test('assigns roof faces to the roof material slot', () => {
    const geo = buildDormerGhostGeometry(DormerNode.parse({ roofType: 'mansard' }))

    expect(geo.groups.some((group) => group.materialIndex === 0)).toBe(true)
    expect(geo.groups.some((group) => group.materialIndex === 3)).toBe(true)
  })
})

describe('buildDormerRoofCut', () => {
  test('keeps the committed shed cut aligned with the configured high side', () => {
    const makeCut = (shedHighSide: 'back' | 'front') =>
      buildDormerRoofCut(
        DormerNode.parse({
          roofType: 'shed',
          shedHighSide,
          width: 4,
          depth: 3,
          height: 1,
          roofHeight: 1.2,
        }),
      )!
    const backHigh = makeCut('back')
    const frontHigh = makeCut('front')
    const edgeMaxY = (geometry: typeof backHigh, z: number) => {
      const position = geometry.getAttribute('position')
      let maxY = -Infinity
      for (let index = 0; index < position.count; index++) {
        if (Math.abs(position.getZ(index) - z) < 0.001) {
          maxY = Math.max(maxY, position.getY(index))
        }
      }
      return maxY
    }

    expect(edgeMaxY(backHigh, -1.45)).toBeGreaterThan(edgeMaxY(backHigh, 1.45))
    expect(edgeMaxY(frontHigh, 1.45)).toBeGreaterThan(edgeMaxY(frontHigh, -1.45))

    backHigh.dispose()
    frontHigh.dispose()
  })
})

describe('hosted window cuts', () => {
  test('cuts the same off-center point on the right face where the hosted window renders', () => {
    const dormer = DormerNode.parse({
      depth: 3,
      height: 1,
      id: 'dormer_test',
      position: [0, 10, 0],
      roofHeight: 1,
      roofType: 'gable',
      wallSkirtHeight: 2,
      width: 4,
    })
    const window = WindowNode.parse({
      dormerFace: 'right',
      dormerId: dormer.id,
      height: 1,
      id: 'window_test',
      parentId: dormer.id,
      position: [0.5, -0.5, 0],
      width: 1,
    })
    const geometry = generateDormerGeometry(dormer, hostSegment(), [window])
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometry, material)
    const raycaster = new Raycaster(new Vector3(10, -0.5, -0.5), new Vector3(-1, 0, 0))

    const firstHit = raycaster.intersectObject(mesh)[0]

    expect(firstHit?.point.x).toBeLessThan(0)
    geometry.dispose()
    material.dispose()
  })

  test('cuts a hosted window through the upper slope of a shed side wall', () => {
    const dormer = DormerNode.parse({
      depth: 4,
      height: 1,
      id: 'dormer_test',
      position: [0, 10, 0],
      roofHeight: 2,
      roofType: 'shed',
      shedHighSide: 'back',
      wallSkirtHeight: 2,
      width: 4,
    })
    const window = WindowNode.parse({
      dormerFace: 'right',
      dormerId: dormer.id,
      height: 1,
      id: 'window_test',
      parentId: dormer.id,
      position: [1, 1.5, 0],
      width: 1,
    })
    const geometry = generateDormerGeometry(dormer, hostSegment(), [window])
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometry, material)
    const raycaster = new Raycaster(new Vector3(10, 1.5, -1), new Vector3(-1, 0, 0))

    const firstHit = raycaster.intersectObject(mesh)[0]

    expect(firstHit?.point.x).toBeLessThan(0)
    geometry.dispose()
    material.dispose()
  })
})

const hostSegment = (overrides?: Partial<RoofSegmentNode>): RoofSegmentNode =>
  ({
    object: 'node',
    id: 'rseg_fixture',
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 0.5,
    pitch: 40,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    ...overrides,
  }) as RoofSegmentNode

// Default-dims dormer resting on the host surface at (x, z) — mirrors
// `useDormerPlacement`, which anchors dormer-local Y=0 at the cursor's
// surface height.
const dormerAt = (segment: RoofSegmentNode, x: number, z: number, rotation = 0) =>
  DormerNode.parse({ position: [x, getRoofSegmentSurfaceY(segment, x, z), z], rotation })

describe('getDormerExposedFaces', () => {
  test('default dormer mid-slope on the default 40° gable shows the down-slope window', () => {
    const seg = hostSegment()
    expect(getDormerExposedFaces(dormerAt(seg, 0, 1.5), seg)).toEqual({ front: true, back: false })
  })

  test('35° gable mid-slope stays exposed (centre datum, not window bottom)', () => {
    const seg = hostSegment({ pitch: 35 })
    expect(getDormerExposedFaces(dormerAt(seg, 0, 1.5), seg).front).toBe(true)
  })

  test('eave band: face hanging past the structural eave keeps the window (no plateau)', () => {
    const seg = hostSegment()
    expect(getDormerExposedFaces(dormerAt(seg, 0, 2.8), seg).front).toBe(true)
  })

  test('on the −Z slope the back face is the exposed one', () => {
    const seg = hostSegment()
    expect(getDormerExposedFaces(dormerAt(seg, 0, -1.5), seg)).toEqual({ front: false, back: true })
  })

  test('hip end-slope: face X feeds the max(fx, fz) profile', () => {
    const seg = hostSegment({ roofType: 'hip' })
    expect(getDormerExposedFaces(dormerAt(seg, 2.5, 0, Math.PI / 2), seg)).toEqual({
      front: true,
      back: false,
    })
  })

  test('~10° pitch buries the window on both faces', () => {
    const seg = hostSegment({ pitch: 10 })
    expect(getDormerExposedFaces(dormerAt(seg, 0, 1.5), seg)).toEqual({ front: false, back: false })
  })

  test('a π yaw swaps which face is down-slope', () => {
    const seg = hostSegment()
    expect(getDormerExposedFaces(dormerAt(seg, 0, 1.5, Math.PI), seg)).toEqual({
      front: false,
      back: true,
    })
  })

  test('uses the exposed back face for the automatic hosted window', () => {
    const seg = hostSegment()
    expect(getDormerDefaultWindowFace(dormerAt(seg, 0, -1.5), seg)).toBe('back')
  })

  test('prefers the front face when both or neither face clears the host', () => {
    const seg = hostSegment({ pitch: 10 })
    expect(getDormerDefaultWindowFace(dormerAt(seg, 0, 1.5), seg)).toBe('front')
  })
})
