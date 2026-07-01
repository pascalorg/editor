import { describe, expect, test } from 'bun:test'
import {
  getDutchEndSlopeFaces,
  getDutchRoofShapeMetrics,
  getRoofModuleFaces,
  getRoofShapeRatios,
} from './roof-segment-shape'

describe('roof segment shape', () => {
  test('dutch shell is built as one complete non-duplicated face set', () => {
    const wh = 3
    const rh = 2
    const faces = getRoofModuleFaces({
      type: 'dutch',
      w: 8,
      d: 6,
      wh,
      rh,
      baseY: 0,
      insets: { dutchI: 1.5 },
      baseW: 8,
      baseD: 6,
      tanTheta: 1,
      shapeRatios: getRoofShapeRatios({
        dutchHipWidthRatio: 0.25,
        dutchHipHeightRatio: 0.5,
        dutchWaistLengthRatio: 1,
        dutchGabletRake: 0.25,
      }),
    })
    const peakY = wh + rh
    const peakFaces = faces.filter((face) =>
      face.some((vertex) => Math.abs(vertex.y - peakY) < 1e-6),
    )
    const signatures = new Set(
      faces.map((face) =>
        face
          .map((vertex) => `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`)
          .sort()
          .join('|'),
      ),
    )

    expect(faces).toHaveLength(13)
    expect(peakFaces).toHaveLength(4)
    expect(signatures.size).toBe(faces.length)

    const lowerRightHip = faces.find((face) =>
      face.some(
        (vertex) =>
          Math.abs(vertex.x - 2.75) < 1e-6 &&
          Math.abs(vertex.y - 4) < 1e-6 &&
          Math.abs(vertex.z - 1.5) < 1e-6,
      ),
    )
    const gableTriangle = faces.find(
      (face) =>
        face.length === 3 &&
        face.some((vertex) => vertex.x === 2.5 && vertex.y === 5) &&
        face.some((vertex) => vertex.x === 2.5 && vertex.z === 1.5),
    )

    expect(lowerRightHip).toBeDefined()
    expect(gableTriangle?.some((vertex) => vertex.x === 2.75)).toBe(false)
  })

  test('dutch depth-axis shell rotates the upper gable correctly', () => {
    const faces = getRoofModuleFaces({
      type: 'dutch',
      w: 6,
      d: 8,
      wh: 3,
      rh: 2,
      baseY: 0,
      insets: { dutchI: 1.5 },
      baseW: 6,
      baseD: 8,
      tanTheta: 1,
      shapeRatios: getRoofShapeRatios({
        dutchHipWidthRatio: 0.25,
        dutchHipHeightRatio: 0.5,
        dutchWaistLengthRatio: 1,
        dutchGabletRake: 0.25,
      }),
    })

    const peakFaces = faces.filter((face) => face.some((vertex) => vertex.y === 5))
    const ridgeOnlyOnZAxis = peakFaces
      .flat()
      .filter((vertex) => vertex.y === 5)
      .every((vertex) => vertex.x === 0)

    expect(peakFaces).toHaveLength(4)
    expect(ridgeOnlyOnZAxis).toBe(true)
  })

  test('dutch end hip slope extends inward until it meets the gable triangle', () => {
    const ratios = getRoofShapeRatios({
      dutchHipWidthRatio: 0.25,
      dutchHipHeightRatio: 0.5,
      dutchWaistLengthRatio: 1,
      dutchGabletRake: 0.75,
    })
    const metrics = getDutchRoofShapeMetrics({
      w: 8,
      d: 6,
      wh: 3,
      rh: 2,
      dutchI: 1.5,
      baseW: 8,
      baseD: 6,
      shapeRatios: ratios,
    })
    const faces = getRoofModuleFaces({
      type: 'dutch',
      w: 8,
      d: 6,
      wh: 3,
      rh: 2,
      baseY: 0,
      insets: { dutchI: 1.5 },
      baseW: 8,
      baseD: 6,
      tanTheta: 1,
      shapeRatios: ratios,
      dutchTopRakeThickness: 0.21,
    })

    expect(metrics?.innerWaistHalfX).toBe(2.5)
    expect(metrics?.outerWaistHalfX).toBe(3.25)

    // The end slope now clips against the rake's lower inner edge and is
    // reprojected back onto the end-slope plane, so the shorter top edge stays
    // planar instead of twisting.
    const hipTopFace = faces.find(
      (face) =>
        face.some(
          (vertex) =>
            Math.abs(vertex.x - 4) < 1e-6 &&
            Math.abs(vertex.y - 3) < 1e-6 &&
            Math.abs(vertex.z - 3) < 1e-6,
        ) &&
        face.some(
          (vertex) =>
            Math.abs(vertex.x - 3.0325) < 1e-6 &&
            Math.abs(vertex.y - 4.29) < 1e-6 &&
            Math.abs(vertex.z - 0.75) < 1e-6,
        ) &&
        face.some(
          (vertex) =>
            Math.abs(vertex.x - 3.0325) < 1e-6 &&
            Math.abs(vertex.y - 4.29) < 1e-6 &&
            Math.abs(vertex.z + 0.75) < 1e-6,
        ),
    )
    const gableTriangle = faces.find(
      (face) =>
        face.length === 3 &&
        face.some((vertex) => vertex.x === 2.5 && vertex.y === 5) &&
        face.some((vertex) => vertex.x === 2.5 && vertex.z === 1.5),
    )

    expect(hipTopFace).toBeDefined()
    expect(gableTriangle?.some((vertex) => vertex.x === 3.25)).toBe(false)
  })

  test('excludeDutchEndSlopes pulls the end slopes out into getDutchEndSlopeFaces', () => {
    const ratios = getRoofShapeRatios({
      dutchHipWidthRatio: 0.25,
      dutchHipHeightRatio: 0.5,
      dutchWaistLengthRatio: 1,
      dutchGabletRake: 0.75,
    })
    const args = {
      type: 'dutch' as const,
      w: 8,
      d: 6,
      wh: 3,
      rh: 2,
      baseY: 0,
      insets: { dutchI: 1.5 },
      baseW: 8,
      baseD: 6,
      tanTheta: 1,
      shapeRatios: ratios,
      dutchTopRakeThickness: 0.21,
    }

    const full = getRoofModuleFaces(args)
    const shell = getRoofModuleFaces({ ...args, excludeDutchEndSlopes: true })
    const endSlopes = getDutchEndSlopeFaces({
      w: 8,
      d: 6,
      wh: 3,
      rh: 2,
      insets: { dutchI: 1.5 },
      baseW: 8,
      baseD: 6,
      shapeRatios: ratios,
      dutchTopRakeThickness: 0.21,
    })

    // The two end slopes leave the shell and reappear in the standalone set.
    expect(shell).toHaveLength(full.length - 2)
    expect(endSlopes).toHaveLength(2)

    // The standalone end slopes are 6-point polygons whose shorter top edge is
    // clipped to the rake's lower inner edge and then kept on the end-slope
    // plane.
    const endIsEndSlope = endSlopes.every(
      (face) =>
        face.length === 6 &&
        face.some((vertex) => Math.abs(Math.abs(vertex.x) - 3.25) < 1e-6) &&
        face.some((vertex) => Math.abs(Math.abs(vertex.x) - 3.0325) < 1e-6) &&
        face.some((vertex) => Math.abs(Math.abs(vertex.x) - 4) < 1e-6),
    )
    expect(endIsEndSlope).toBe(true)

    // The removed faces are exactly the end slopes — the shell keeps every
    // other face the full module produced.
    const signature = (face: { x: number; y: number; z: number }[]) =>
      face
        .map((vertex) => `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`)
        .join('|')
    const shellSigs = new Set(shell.map(signature))
    const removed = full.filter((face) => !shellSigs.has(signature(face)))
    expect(removed).toHaveLength(2)
  })
})
