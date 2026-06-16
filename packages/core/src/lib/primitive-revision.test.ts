import { describe, expect, test } from 'bun:test'
import type { PrimitiveShapeInput } from './primitive-compose'
import { applyPrimitiveRevision, selectPrimitiveShapeIndexes } from './primitive-revision'

const carShapes: PrimitiveShapeInput[] = [
  {
    kind: 'box',
    name: 'vehicle body shell',
    semanticRole: 'vehicle_body',
    sourcePartKind: 'vehicle_body',
    position: [0, 0.4, 0],
    length: 4,
    width: 1.8,
    height: 0.5,
    material: { properties: { color: '#cc0000' } },
  },
  {
    kind: 'trapezoid-prism',
    name: 'vehicle cabin frame',
    semanticRole: 'vehicle_cabin',
    sourcePartKind: 'vehicle_body',
    position: [0, 0.9, 0],
    length: 1.2,
    width: 1.1,
    height: 0.35,
    topLengthScale: 0.75,
    topWidthScale: 0.75,
  },
  {
    kind: 'rounded-panel',
    name: 'side window left',
    semanticRole: 'vehicle_window',
    sourcePartKind: 'vehicle_windows',
    position: [0, 0.9, -0.55],
    rotation: [Math.PI / 2, 0, 0],
    length: 1,
    width: 0.2,
    thickness: 0.01,
    material: { properties: { color: '#1e3a8a' } },
  },
  {
    kind: 'rounded-panel',
    name: 'vehicle roof cap',
    semanticRole: 'vehicle_roof',
    sourcePartKind: 'vehicle_body',
    position: [0, 1.16, 0],
    length: 0.9,
    width: 0.8,
    thickness: 0.04,
  },
]

describe('primitive revision DSL', () => {
  test('selects shapes by semantic and source metadata', () => {
    expect(selectPrimitiveShapeIndexes(carShapes, { semanticRole: 'vehicle_window' })).toEqual([2])
    expect(selectPrimitiveShapeIndexes(carShapes, { sourcePartKind: 'vehicle_body' })).toEqual([
      0, 1, 3,
    ])
    expect(selectPrimitiveShapeIndexes(carShapes, { nameIncludes: 'roof' })).toEqual([3])
  })

  test('treats index with semantic metadata as an occurrence selector when global index does not match', () => {
    expect(
      selectPrimitiveShapeIndexes(carShapes, { semanticRole: 'vehicle_window', index: 0 }),
    ).toEqual([2])
    expect(
      selectPrimitiveShapeIndexes(carShapes, { sourcePartKind: 'vehicle_body', occurrence: 2 }),
    ).toEqual([3])
  })

  test('removes repeated semantic selections against stable pre-removal indexes', () => {
    const wheelShapes: PrimitiveShapeInput[] = [
      {
        kind: 'torus',
        name: 'rear tire',
        semanticRole: 'bicycle_tire',
        position: [-1, 0, 0],
        majorRadius: 1,
        tubeRadius: 0.1,
      },
      {
        kind: 'torus',
        name: 'rear rim',
        semanticRole: 'bicycle_rim',
        position: [-1, 0, 0],
        majorRadius: 0.8,
        tubeRadius: 0.05,
      },
      {
        kind: 'cylinder',
        name: 'rear hub',
        semanticRole: 'bicycle_hub',
        position: [-1, 0, 0],
        axis: 'z',
        radius: 0.1,
        height: 0.2,
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        kind: 'cylinder' as const,
        name: `rear spoke ${index + 1}`,
        semanticRole: 'bicycle_spoke',
        position: [-1, 0, 0] as [number, number, number],
        axis: 'x' as const,
        radius: 0.01,
        height: 0.5,
      })),
      {
        kind: 'torus',
        name: 'front tire',
        semanticRole: 'bicycle_tire',
        position: [1, 0, 0],
        majorRadius: 1,
        tubeRadius: 0.1,
      },
      {
        kind: 'torus',
        name: 'front rim',
        semanticRole: 'bicycle_rim',
        position: [1, 0, 0],
        majorRadius: 0.8,
        tubeRadius: 0.05,
      },
      {
        kind: 'cylinder',
        name: 'front hub',
        semanticRole: 'bicycle_hub',
        position: [1, 0, 0],
        axis: 'z',
        radius: 0.1,
        height: 0.2,
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        kind: 'cylinder' as const,
        name: `front spoke ${index + 1}`,
        semanticRole: 'bicycle_spoke',
        position: [1, 0, 0] as [number, number, number],
        axis: 'x' as const,
        radius: 0.01,
        height: 0.5,
      })),
    ]

    const result = applyPrimitiveRevision({
      shapes: wheelShapes,
      operations: [
        { op: 'remove', selector: { semanticRole: 'bicycle_tire', index: 1 } },
        { op: 'remove', selector: { semanticRole: 'bicycle_rim', index: 1 } },
        { op: 'remove', selector: { semanticRole: 'bicycle_hub', index: 1 } },
        ...Array.from({ length: 8 }, (_, offset) => ({
          op: 'remove' as const,
          selector: { semanticRole: 'bicycle_spoke', index: 8 + offset },
        })),
      ],
    })

    expect(result.issues).toEqual([])
    expect(result.shapes).toHaveLength(11)
    expect(result.shapes.some((shape) => shape.name?.includes('front'))).toBe(false)
    expect(result.shapes.filter((shape) => shape.semanticRole === 'bicycle_spoke')).toHaveLength(8)
  })

  test('does not throw when legacy shapes contain malformed profile data', () => {
    const malformed: PrimitiveShapeInput[] = [
      {
        kind: 'extrude',
        name: 'bad legacy extrude',
        semanticRole: 'water_surface',
        profile: { curve: 'sine' } as unknown as [number, number][],
        depth: 0.1,
      },
    ]

    const result = applyPrimitiveRevision({
      shapes: malformed,
      operations: [
        {
          op: 'transform',
          selector: { semanticRole: 'water_surface' },
          scale: [1.2, 1, 1.2],
        },
      ],
    })

    expect(result.issues).toEqual([])
    expect(result.shapes[0]?.profile).toBeUndefined()
    expect(result.shapes[0]?.position).toEqual([0, 0, 0])
  })

  test('replaces a subassembly and inherits body material for added pillars', () => {
    const result = applyPrimitiveRevision({
      shapes: carShapes,
      operations: [
        {
          op: 'replace',
          selector: { semanticRole: 'vehicle_cabin' },
          shapes: [
            {
              kind: 'trapezoid-prism',
              name: 'integrated glasshouse',
              semanticRole: 'vehicle_cabin',
              sourcePartKind: 'vehicle_windows',
              position: [0, 0.93, 0],
              length: 1.55,
              width: 1.06,
              height: 0.34,
              topLengthScale: 0.78,
              topWidthScale: 0.78,
              material: { properties: { color: '#1e3a8a', opacity: 0.78, transparent: true } },
            },
            {
              kind: 'box',
              name: 'A pillar left',
              semanticRole: 'vehicle_pillar',
              position: [0.6, 0.98, -0.5],
              length: 0.05,
              width: 0.05,
              height: 0.34,
            },
          ],
        },
        {
          op: 'materialFrom',
          selector: { semanticRole: 'vehicle_pillar' },
          from: { semanticRole: 'vehicle_body' },
        },
      ],
    })

    expect(result.issues).toEqual([])
    expect(result.shapes.some((shape) => shape.name === 'vehicle cabin frame')).toBe(false)
    const pillar = result.shapes.find((shape) => shape.semanticRole === 'vehicle_pillar')
    expect(pillar?.material?.properties?.color).toBe('#cc0000')
  })

  test('aligns one shape edge to another shape edge', () => {
    const result = applyPrimitiveRevision({
      shapes: carShapes,
      operations: [
        {
          op: 'align',
          selector: { nameIncludes: 'side window left' },
          to: { semanticRole: 'vehicle_roof' },
          edge: 'top',
          toEdge: 'bottom',
        },
      ],
    })

    expect(result.issues).toEqual([])
    const window = result.shapes.find((shape) => shape.name === 'side window left')
    const roof = result.shapes.find((shape) => shape.semanticRole === 'vehicle_roof')
    expect((window?.position?.[1] ?? 0) + (window?.width ?? 0) / 2).toBeCloseTo(
      (roof?.position?.[1] ?? 0) - (roof?.thickness ?? 0) / 2,
    )
  })

  test('bakes transform scale into common gear primitive dimensions', () => {
    const gearShapes: PrimitiveShapeInput[] = [
      {
        kind: 'hollow-cylinder',
        name: 'gear_disc',
        semanticRole: 'gear_disc',
        position: [0, 0.01, 0],
        axis: 'y',
        radius: 0.045,
        height: 0.02,
      },
      {
        kind: 'lathe',
        name: 'tooth_ring',
        semanticRole: 'tooth_ring',
        position: [0, 0.01, 0],
        profile: [
          [0.039375, -0.01],
          [0.0495, 0],
          [0.039375, 0.01],
        ],
      },
      {
        kind: 'box',
        name: 'keyway',
        semanticRole: 'keyway',
        position: [0, 0.01, 0.015],
        length: 0.008,
        width: 0.005,
        height: 0.02,
      },
    ]

    const result = applyPrimitiveRevision({
      shapes: gearShapes,
      operations: [{ op: 'transform', selector: {}, scale: [10, 1, 10] }],
    })

    expect(result.issues).toEqual([])
    expect(result.shapes[0]?.radius).toBeCloseTo(0.45)
    expect(result.shapes[0]?.height).toBeCloseTo(0.02)
    expect(result.shapes[1]?.profile?.[1]?.[0]).toBeCloseTo(0.495)
    expect(result.shapes[2]?.length).toBeCloseTo(0.08)
    expect(result.shapes[2]?.width).toBeCloseTo(0.05)
    expect(result.shapes[2]?.position?.[2]).toBeCloseTo(0.15)
  })

  test('bakes transform scale into extrude profile and depth', () => {
    const result = applyPrimitiveRevision({
      shapes: [
        {
          kind: 'extrude',
          name: 'single_piece_spur_gear',
          semanticRole: 'spur_gear',
          position: [0, 0.01, 0],
          profile: [
            [0.0495, 0],
            [0, 0.0495],
            [-0.0495, 0],
            [0, -0.0495],
          ],
          depth: 0.02,
        },
      ],
      operations: [
        { op: 'transform', selector: { semanticRole: 'spur_gear' }, scale: [10, 1, 10] },
      ],
    })

    expect(result.issues).toEqual([])
    expect(result.shapes[0]?.profile?.[0]?.[0]).toBeCloseTo(0.495)
    expect(result.shapes[0]?.profile?.[1]?.[1]).toBeCloseTo(0.0495)
    expect(result.shapes[0]?.depth).toBeCloseTo(0.2)
  })

  test('can target only vehicle tires for a local wheel size revision', () => {
    const result = applyPrimitiveRevision({
      shapes: [
        {
          kind: 'box',
          name: 'body',
          semanticRole: 'vehicle_body',
          position: [0, 0.5, 0],
          length: 4,
          width: 1.8,
          height: 0.6,
        },
        {
          kind: 'torus',
          name: 'front tire',
          semanticRole: 'vehicle_tire',
          position: [-1.2, 0.35, -0.95],
          axis: 'x',
          majorRadius: 0.28,
          tubeRadius: 0.08,
        },
        {
          kind: 'torus',
          name: 'rear tire',
          semanticRole: 'vehicle_tire',
          position: [1.2, 0.35, -0.95],
          axis: 'x',
          majorRadius: 0.28,
          tubeRadius: 0.08,
        },
      ],
      operations: [
        {
          op: 'transform',
          selector: { semanticRole: 'vehicle_tire' },
          scale: [1.4, 1.4, 1.4],
        },
      ],
    })

    expect(result.issues).toEqual([])
    expect(result.shapes[0]?.length).toBe(4)
    expect(result.shapes[1]?.majorRadius).toBeCloseTo(0.392)
    expect(result.shapes[1]?.tubeRadius).toBeCloseTo(0.112)
    expect(result.shapes[2]?.majorRadius).toBeCloseTo(0.392)
    expect(result.shapes[2]?.tubeRadius).toBeCloseTo(0.112)
  })

  test('scales selected semantic parts through editable primary dimensions', () => {
    const result = applyPrimitiveRevision({
      shapes: [
        {
          kind: 'box',
          name: 'outdoor ac fan blade 1',
          semanticRole: 'fan_blade',
          semanticGroup: 'front_fan',
          sourcePartKind: 'radial_blades',
          position: [0.05, 0.4, 0.2],
          length: 0.12,
          width: 0.01,
          height: 0.02,
          editableHints: {
            primaryDimension: 'length',
            canScale: ['length', 'width', 'height'],
          },
        },
        {
          kind: 'cylinder',
          name: 'outdoor ac fan hub',
          semanticRole: 'fan_hub',
          semanticGroup: 'front_fan',
          sourcePartKind: 'radial_blades',
          position: [0, 0.4, 0.2],
          axis: 'z',
          radius: 0.03,
          height: 0.02,
        },
      ],
      operations: [
        {
          op: 'scaleSemantic',
          selector: { semanticRole: 'fan_blade' },
          dimension: 'primary',
          factor: 1.35,
        },
      ],
    })

    expect(result.issues).toEqual([])
    expect(result.changedShapeCount).toBe(1)
    expect(result.shapes[0]?.length).toBeCloseTo(0.162)
    expect(result.shapes[0]?.width).toBeCloseTo(0.01)
    expect(result.shapes[1]?.radius).toBeCloseTo(0.03)
  })
})
