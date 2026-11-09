// @ts-expect-error - bun:test is provided by the Bun runtime; viewer does not
// include Bun globals in its package tsconfig.
import { describe, expect, test } from 'bun:test'
import {
  getSegmentSlopeFrame,
  LUMBER_DEPTH,
  ROOF_BUILD_UP_PRESETS,
  RoofSegmentNode,
  roofBuildUpPatch,
} from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry, getRoofSegmentBrushes, roofFramingDepth } from './roof-system'

const SHEET = 0.0111

/** A gable 8 m along its ridge and 6 m across, eaves on ±z, framed with 2x6 under a 7/16 in deck. */
function segment(patch: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    roofType: 'gable',
    width: 8,
    depth: 6,
    pitch: 30,
    wallHeight: 2.5,
    wallThickness: 0.2,
    overhang: 0.4,
    deckThickness: LUMBER_DEPTH['2x6'] + SHEET,
    shingleThickness: 0.0127,
    ...patch,
  })
}

/** Heights where a plumb line through (x, z) crosses `geometry`, top down. */
function crossings(geometry: THREE.BufferGeometry, x: number, z: number): number[] {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0))
  const heights: number[] = []
  for (const hit of ray.intersectObject(mesh)) {
    if (!heights.some((y) => Math.abs(y - hit.point.y) < 1e-5)) heights.push(hit.point.y)
  }
  return heights
}

/** The deck slab of `node`, with its structure band open `framing` deep. */
function deck(node: RoofSegmentNode, framing = 0): THREE.BufferGeometry {
  const brushes = getRoofSegmentBrushes(node, { framing })
  if (!brushes) throw new Error('no brushes')
  brushes.shinSlab.geometry.dispose()
  brushes.wallBrush.geometry.dispose()
  brushes.innerBrush.geometry.dispose()
  brushes.rakeBoards?.dispose()
  return brushes.deckSlab.geometry
}

describe('a roof deck with the frame shown', () => {
  test('opens as deep as the plane is framed, keeping its sheathing; a finished underside stays closed', () => {
    expect(roofFramingDepth(segment())).toBeCloseTo(LUMBER_DEPTH['2x6'], 9)
    // the schema's 10 cm deck is shallower than the 2x6 Bones frames it with
    expect(roofFramingDepth(segment({ deckThickness: 0.1 }))).toBeCloseTo(0.1 - SHEET, 9)
    const preset = ROOF_BUILD_UP_PRESETS[0]!.buildUp
    const twelves = {
      ...preset,
      structure: { ...preset.structure, system: 'rafters' as const, size: '2x12' as const },
    }
    const layered = segment(roofBuildUpPatch({ ...twelves, finish: undefined }))
    expect(roofFramingDepth(layered)).toBeCloseTo(LUMBER_DEPTH['2x12'], 9)
    // trusses open their top chords on the heel: two chord depths
    expect(roofFramingDepth(segment(roofBuildUpPatch(preset)))).toBeCloseTo(
      2 * LUMBER_DEPTH['2x4'],
      9,
    )
    const cathedral = segment(
      roofBuildUpPatch({ ...twelves, finish: { kind: 'drywall', thickness: 0.0127 } }),
    )
    expect(roofFramingDepth(cathedral)).toBe(0)
    expect(roofFramingDepth(segment({ roofType: 'gambrel' }))).toBe(0)
  })

  for (const wallHeight of [2.5, 0]) {
    test(`inside the walls the deck keeps the band over the rafters, over the overhangs it stays whole (wall height ${wallHeight})`, () => {
      const node = segment({ wallHeight })
      const { tanTheta, cosTheta } = getSegmentSlopeFrame(node)
      const band = node.deckThickness / cosTheta
      const open = LUMBER_DEPTH['2x6'] / cosTheta
      // the rafter plane under the deck, z from the ridge
      const plane = (z: number) => wallHeight + (node.depth / 2 - Math.abs(z)) * tanTheta

      const closed = deck(node)
      const shown = deck(node, roofFramingDepth(node))
      try {
        // in the attic, over a rafter bay
        const z = 1.5
        // (the closed deck's underside cutter is scaled a hair wider, so it sits a fraction of a
        // millimetre over the plane)
        const before = crossings(closed, 0.3, z).map((y) => y - plane(z))
        expect(before).toHaveLength(2)
        expect(before[0]).toBeCloseTo(band, 3)
        expect(before[1]).toBeCloseTo(0, 3)
        const after = crossings(shown, 0.3, z).map((y) => y - plane(z))
        expect(after).toHaveLength(2)
        expect(after[0]).toBeCloseTo(band, 3)
        expect(after[1]).toBeCloseTo(open, 5)
        // in the eave overhang and the gable's rake overhang the deck stays whole, its underside
        // just under the rafter tails
        for (const [x, zz] of [
          [0.3, node.depth / 2 + 0.2],
          [node.width / 2 + 0.05, 1.5],
        ] as const) {
          const heights = crossings(shown, x, zz).map((y) => y - plane(zz))
          expect(heights).toHaveLength(2)
          expect(heights[0]).toBeCloseTo(band, 3)
          expect(heights[1]).toBeLessThan(-0.001)
          expect(heights[1]).toBeGreaterThan(-0.01)
        }
      } finally {
        closed.dispose()
        shown.dispose()
      }
    })
  }

  test('a hip opens the same way, and the drawn segment carries it', () => {
    const node = segment({ roofType: 'hip' })
    const { tanTheta, cosTheta } = getSegmentSlopeFrame(node)
    const plane = (z: number) => node.wallHeight + (node.depth / 2 - Math.abs(z)) * tanTheta
    const open = LUMBER_DEPTH['2x6'] / cosTheta
    const shown = deck(node, roofFramingDepth(node))
    try {
      expect(Math.min(...crossings(shown, 0, 1.5)) - plane(1.5)).toBeCloseTo(open, 5)
    } finally {
      shown.dispose()
    }
    // the whole shell: its lowest face over a rafter bay is the deck's underside
    const gable = segment()
    const drawn = generateRoofSegmentGeometry(gable, undefined, { framing: true })
    const plain = generateRoofSegmentGeometry(gable)
    try {
      expect(Math.min(...crossings(drawn, 0.3, 1.5)) - plane(1.5)).toBeCloseTo(open, 5)
      expect(Math.min(...crossings(plain, 0.3, 1.5)) - plane(1.5)).toBeCloseTo(0, 3)
    } finally {
      drawn.dispose()
      plain.dispose()
    }
  })
})
