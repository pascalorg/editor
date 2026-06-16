import { describe, expect, test } from 'bun:test'
import {
  expandPrimitiveShapeArrays,
  type PrimitiveArrayExpandableShape,
  resolvePrimitiveWorldTransforms,
} from './primitive-compose'

function expectVecClose(actual: [number, number, number], expected: [number, number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0], 6)
  expect(actual[1]).toBeCloseTo(expected[1], 6)
  expect(actual[2]).toBeCloseTo(expected[2], 6)
}

describe('resolvePrimitiveWorldTransforms', () => {
  test('expands linear primitive arrays in core', () => {
    const shapes = expandPrimitiveShapeArrays<PrimitiveArrayExpandableShape>([
      {
        kind: 'rounded-panel',
        name: 'louver blade',
        position: [0, 1, 0],
        length: 0.7,
        width: 0.04,
        thickness: 0.02,
        array: { count: 4, step: [0, 0.08, 0] },
      },
    ])

    expect(shapes).toHaveLength(4)
    expect(shapes.map((shape) => shape.position?.[1])).toEqual([1, 1.08, 1.16, 1.24])
    expect(shapes.every((shape) => shape.array == null)).toBe(true)
  })

  test('expands grid primitive arrays and strips nested params array fields', () => {
    const shapes = expandPrimitiveShapeArrays<PrimitiveArrayExpandableShape>([
      {
        kind: 'box',
        params: {
          position: [1, 2, 3],
          array: { columns: 2, rows: 2, spacing: [0.4, 0, 0.3] },
        },
      },
    ])

    expect(shapes).toHaveLength(4)
    expect(shapes.map((shape) => shape.position)).toEqual([
      [1, 2, 3],
      [1.4, 2, 3],
      [1, 2, 3.3],
      [1.4, 2, 3.3],
    ])
    expect(shapes.every((shape) => !('array' in (shape.params ?? {})))).toBe(true)
  })

  test('connects child bottom to parent top without manual half-height offset', () => {
    const [base, child] = resolvePrimitiveWorldTransforms([
      { kind: 'box', position: [0, 0.5, 0], length: 1, width: 1, height: 1 },
      {
        kind: 'box',
        attachTo: 0,
        anchor: 'top',
        childAnchor: 'bottom',
        position: [0, 0, 0],
        length: 0.2,
        width: 0.2,
        height: 2,
      },
    ])

    expectVecClose(base!.position, [0, 0.5, 0])
    expectVecClose(child!.position, [0, 2, 0])
  })

  test('orients cylinders with axis without requiring manual rotation', () => {
    const [shape] = resolvePrimitiveWorldTransforms([
      { kind: 'cylinder', axis: 'x', position: [0, 0, 0], radius: 0.1, height: 2 },
    ])

    expectVecClose(shape!.rotation, [0, 0, -Math.PI / 2])
  })

  test('uses cylinder axis when resolving connection anchors', () => {
    const [, child] = resolvePrimitiveWorldTransforms([
      { kind: 'sphere', position: [0, 0, 0], radius: 0.2 },
      {
        kind: 'cylinder',
        attachTo: 0,
        anchor: 'front',
        childAnchor: 'back',
        axis: 'z',
        position: [0, 0, 0],
        radius: 0.1,
        height: 2,
      },
    ])

    expectVecClose(child!.position, [0, 0, 1.2])
  })

  test('vehicle wheels can use x-axis without manual rotation', () => {
    const [shape] = resolvePrimitiveWorldTransforms([
      { kind: 'cylinder', axis: 'x', position: [0, 0.3, 1], radius: 0.3, height: 0.2 },
    ])

    expectVecClose(shape!.rotation, [0, 0, -Math.PI / 2])
  })

  test('capsules and half-cylinders share cylinder axis semantics', () => {
    const [capsule, halfCylinder] = resolvePrimitiveWorldTransforms([
      { kind: 'capsule', axis: 'z', position: [0, 0, 0], radius: 0.2, height: 1.2 },
      { kind: 'half-cylinder', axis: 'x', position: [0, 0, 0], radius: 0.2, height: 1.2 },
    ])

    expectVecClose(capsule!.rotation, [Math.PI / 2, 0, 0])
    expectVecClose(halfCylinder!.rotation, [0, 0, -Math.PI / 2])
  })

  test('new tapered and ring primitives expose axis semantics', () => {
    const [cone, frustum, hemisphere, torus] = resolvePrimitiveWorldTransforms([
      { kind: 'cone', axis: 'x', position: [0, 0, 0], radius: 0.2, height: 1.2 },
      {
        kind: 'frustum',
        axis: 'z',
        position: [0, 0, 0],
        radiusTop: 0.1,
        radiusBottom: 0.3,
        height: 1.2,
      },
      { kind: 'hemisphere', axis: 'x', position: [0, 0, 0], radius: 0.4 },
      { kind: 'torus', axis: 'x', position: [0, 0, 0], majorRadius: 0.4, tubeRadius: 0.06 },
    ])

    expectVecClose(cone!.rotation, [0, 0, -Math.PI / 2])
    expectVecClose(frustum!.rotation, [Math.PI / 2, 0, 0])
    expectVecClose(hemisphere!.rotation, [0, 0, -Math.PI / 2])
    expectVecClose(torus!.rotation, [0, Math.PI / 2, 0])
  })

  test('trapezoid and wedge primitives use box-like anchor extents', () => {
    const [, trapezoid, wedge] = resolvePrimitiveWorldTransforms(
      [
        { kind: 'box', position: [0, 1, 0], length: 2, width: 2, height: 0.2 },
        {
          kind: 'trapezoid-prism',
          attachTo: 0,
          anchor: 'top',
          childAnchor: 'bottom',
          position: [0, 0, 0],
          length: 1,
          width: 1,
          height: 0.4,
          topScale: [0.5, 0.7],
        },
        {
          kind: 'wedge',
          attachTo: 1,
          anchor: 'top',
          childAnchor: 'bottom',
          position: [0, 0, 0],
          length: 1,
          width: 1,
          height: 0.4,
        },
      ],
      { positionMode: 'anchor-offset' },
    )

    expectVecClose(trapezoid!.position, [0, 1.3, 0])
    expectVecClose(wedge!.position, [0, 1.7, 0])
  })

  test('new curved primitives expose usable half-extents for anchor snapping', () => {
    const [, child] = resolvePrimitiveWorldTransforms(
      [
        { kind: 'rounded-panel', position: [0, 1, 0], length: 2, width: 1, thickness: 0.1 },
        {
          kind: 'sweep',
          attachTo: 0,
          anchor: 'top',
          childAnchor: 'bottom',
          position: [0, 1.2, 0],
          path: [
            [-0.5, 0, 0],
            [0.5, 0, 0],
          ],
          radius: 0.05,
        },
      ],
      { positionMode: 'world-center' },
    )

    expectVecClose(child!.position, [0, 1.1, 0])
  })

  test('inherits parent rotation through matrix composition', () => {
    const [, child] = resolvePrimitiveWorldTransforms([
      {
        kind: 'box',
        position: [0, 0, 0],
        rotation: [0, Math.PI / 2, 0],
        length: 1,
        width: 1,
        height: 1,
      },
      {
        kind: 'box',
        attachTo: 0,
        anchor: 'front',
        childAnchor: 'back',
        position: [0, 0, 0],
        length: 1,
        width: 1,
        height: 1,
      },
    ])

    expectVecClose(child!.position, [1, 0, 0])
  })

  // ── world-center mode ──────────────────────────────────────────

  test('world-center: snaps Y axis when child top attaches to parent bottom (desk leg)', () => {
    const [desk, leg] = resolvePrimitiveWorldTransforms(
      [
        {
          kind: 'box',
          name: 'desk top',
          position: [0, 0.75, 0],
          length: 1.4,
          width: 0.7,
          height: 0.05,
        },
        {
          kind: 'box',
          name: 'leg',
          attachTo: 0,
          anchor: 'bottom',
          childAnchor: 'top',
          position: [-0.64, 0.36, 0.29],
          length: 0.06,
          width: 0.06,
          height: 0.72,
        },
      ],
      { positionMode: 'world-center' },
    )

    // Desk centered at [0, 0.75, 0]
    expectVecClose(desk!.position, [0, 0.75, 0])

    // LLM passes leg center at [-0.64, 0.36, 0.29].
    // Auto-snap: leg top should touch desk bottom (0.75 - 0.025 = 0.725).
    // Leg center Y = 0.725 - 0.36 = 0.365. X and Z unchanged.
    expectVecClose(leg!.position, [-0.64, 0.365, 0.29])
  })

  test('world-center: keeps X/Z from LLM, only corrects anchor axis', () => {
    const [, child] = resolvePrimitiveWorldTransforms(
      [
        { kind: 'box', position: [2, 1, 3], length: 2, width: 2, height: 2 },
        {
          kind: 'box',
          attachTo: 0,
          anchor: 'right',
          childAnchor: 'left',
          position: [5, 7, 9],
          length: 1,
          width: 1,
          height: 1,
        },
      ],
      { positionMode: 'world-center' },
    )

    // Parent right face at X = 2 + 1 = 3.
    // Child left face at X = 5 - 0.5 = 4.5.
    // Correction for X: 3 - 4.5 = -1.5 → snapped X = 5 - 1.5 = 3.5.
    expectVecClose(child!.position, [3.5, 7, 9])
  })

  test('world-center: no snap when anchors are on different axes', () => {
    const [, child] = resolvePrimitiveWorldTransforms(
      [
        { kind: 'box', position: [0, 0, 0], length: 2, width: 2, height: 2 },
        {
          kind: 'box',
          attachTo: 0,
          anchor: 'top',
          childAnchor: 'left',
          position: [1, 2, 3],
          length: 1,
          width: 1,
          height: 1,
        },
      ],
      { positionMode: 'world-center' },
    )

    // anchor='top' (Y axis) and childAnchor='left' (X axis) — no snap,
    // position used as-is.
    expectVecClose(child!.position, [1, 2, 3])
  })

  test('world-center: no snap when childAnchor is center', () => {
    const [, child] = resolvePrimitiveWorldTransforms(
      [
        { kind: 'box', position: [0, 0, 0], length: 2, width: 2, height: 2 },
        {
          kind: 'box',
          attachTo: 0,
          anchor: 'top',
          childAnchor: 'center',
          position: [1, 2, 3],
          length: 1,
          width: 1,
          height: 1,
        },
      ],
      { positionMode: 'world-center' },
    )

    // childAnchor='center' has no axis → no snap.
    expectVecClose(child!.position, [1, 2, 3])
  })

  test('world-center: no attachTo still uses world-space center', () => {
    const [shape] = resolvePrimitiveWorldTransforms(
      [{ kind: 'box', position: [3, 4, 5], length: 1, width: 1, height: 1 }],
      { positionMode: 'world-center' },
    )

    expectVecClose(shape!.position, [3, 4, 5])
  })

  // ── sphere scale ─────────────────────────────────────────────────

  test('sphere half-extents account for scale', () => {
    const [, child] = resolvePrimitiveWorldTransforms(
      [
        { kind: 'sphere', position: [0, 1, 0], radius: 0.5, scale: [2, 0.3, 1] },
        {
          kind: 'box',
          attachTo: 0,
          anchor: 'top',
          childAnchor: 'bottom',
          position: [0, 0, 0],
          length: 0.2,
          width: 0.2,
          height: 0.1,
        },
      ],
      { positionMode: 'anchor-offset' },
    )

    // Parent sphere: radius 0.5, scale [2, 0.3, 1] → half-extents {x:1, y:0.15, z:0.5}
    // anchor='top' → anchorOffset = [0, 0.15, 0]
    // childAnchor='bottom' → childAnchorOffset = [0, -0.05, 0]
    // localCenterOffset = [0,0,0] - [0,-0.05,0] = [0, 0.05, 0]
    // finalPosition = [0,1,0] + [0,0.15,0] + [0,0.05,0] = [0, 1.2, 0]
    expectVecClose(child!.position, [0, 1.2, 0])
  })
})
