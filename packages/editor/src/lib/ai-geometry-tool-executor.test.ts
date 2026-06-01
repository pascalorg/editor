import { describe, expect, test } from 'bun:test'
import { executeGeometryToolCall, normalizeGeometryToolShapes } from './ai-geometry-tool-executor'

describe('AI geometry tool executor', () => {
  test('normalizes legacy primitive fields and material color arrays', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            shape: 'box',
            name: 'Body',
            position: [0, 1, 0],
            size: [1, 2, 3],
            color: [1, 0, 0, 0.5],
          },
        ],
      },
      { prompt: 'red block' },
    )

    expect(result.artifact?.shapes[0]).toMatchObject({
      kind: 'box',
      length: 1,
      width: 3,
      height: 2,
      material: {
        properties: {
          color: '#ff0000',
          opacity: 0.5,
          transparent: true,
        },
      },
    })
  })

  test('rejects invalid primitive dimensions before creating an artifact', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            kind: 'box',
            name: 'Bad box',
            position: [0, 0.5, 0],
            length: 1,
            height: 1,
          },
        ],
      },
      { prompt: 'box with missing width' },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('Invalid geometry tool call')
    expect(result.content).toContain('Bad box: box.width is required')
  })

  test('rejects attachTo references without explicit anchors', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          { kind: 'box', name: 'Base', position: [0, 0.5, 0], length: 1, width: 1, height: 1 },
          {
            kind: 'box',
            name: 'Child',
            position: [0, 1.5, 0],
            length: 1,
            width: 1,
            height: 1,
            attachTo: 0,
          },
        ],
      },
      { prompt: 'stacked boxes' },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('Child: attachTo requires explicit anchor and childAnchor')
  })

  test('resolves anchored child shapes in world-center mode', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        name: 'Stack',
        shapes: [
          { kind: 'box', name: 'Base', position: [0, 0.5, 0], length: 1, width: 1, height: 1 },
          {
            kind: 'box',
            name: 'Top',
            position: [0, 1.5, 0],
            length: 1,
            width: 1,
            height: 1,
            attachTo: 0,
            anchor: 'top',
            childAnchor: 'bottom',
          },
        ],
      },
      { prompt: 'stacked boxes' },
    )

    expect(result.artifact?.transforms[1]?.position).toEqual([0, 1.5, 0])
    expect(result.artifact?.assemblyName).toBe('Stack')
  })

  test('enforces a generated shape budget', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          { kind: 'box', position: [0, 0.5, 0], length: 1, width: 1, height: 1 },
          { kind: 'box', position: [1, 0.5, 0], length: 1, width: 1, height: 1 },
          { kind: 'box', position: [2, 0.5, 0], length: 1, width: 1, height: 1 },
        ],
      },
      { prompt: 'too many boxes' },
      { maxShapes: 2 },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('too complex')
    expect(result.content).toContain('limit is 2')
  })

  test('applies prompt dimension semantics for compose_object before composition', () => {
    const result = executeGeometryToolCall(
      'compose_object',
      { category: 'table' },
      { prompt: 'desk length 120cm width 60cm height 75cm' },
    )

    const top = result.artifact?.shapes.find((shape) => shape.name === 'Low-poly table top')
    expect(top?.length).toBeCloseTo(1.2)
    expect(top?.width).toBeCloseTo(0.6)
    expect(top?.position[1]).toBeCloseTo(0.72)
  })

  test('normalizes natural width/depth fields for box-like shapes', () => {
    const [shape] = normalizeGeometryToolShapes([
      { kind: 'box', position: [0, 0, 0], width: 2, depth: 0.5, height: 1 },
    ])

    expect(shape).toMatchObject({ length: 2, width: 0.5, height: 1 })
  })

  test('normalizes cylinder wheel thickness from width/depth aliases', () => {
    const [depthWheel, widthWheel] = normalizeGeometryToolShapes([
      { kind: 'cylinder', name: 'wheel depth', position: [0, 0, 0], radius: 0.3, depth: 0.16 },
      { kind: 'cylinder', name: 'wheel width', position: [0, 0, 0], radius: 0.3, width: 0.18 },
    ])

    expect(depthWheel).toMatchObject({ height: 0.16 })
    expect(widthWheel).toMatchObject({ height: 0.18 })
  })

  test('accepts compose_parts vehicle output after semantic validation', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'Red sedan',
        primaryColor: '#cc0000',
        geometryBrief: {
          category: 'vehicle',
          requiredRoles: [
            'vehicle_body',
            'vehicle_tire',
            'vehicle_window',
            'headlight',
            'front_bumper',
            'rear_bumper',
          ],
          validationTargets: ['exactly 4 tires', 'windows above body', 'red body material'],
        },
        parts: [{ kind: 'vehicle_body', length: 4.4, width: 1.8, height: 1.35 }],
      },
      { prompt: '生成一辆红色小轿车' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=vehicle')
    expect(result.content).toContain('vehicle_tire:4')
    expect(result.artifact?.shapes.filter((shape) => shape.semanticRole === 'vehicle_tire')).toHaveLength(4)
  })

  test('rejects unrealistic primitive cars and returns repairable semantic feedback', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief: { category: 'vehicle' },
        shapes: [
          {
            kind: 'box',
            name: 'bad car body',
            semanticRole: 'vehicle_body',
            position: [0, 0.55, 0],
            length: 4,
            width: 1.8,
            height: 0.7,
            material: { properties: { color: '#cc0000' } },
          },
          {
            kind: 'torus',
            name: 'bad car left tire',
            semanticRole: 'vehicle_tire',
            position: [-1.2, 0.25, -0.85],
            axis: 'z',
            majorRadius: 0.28,
            tubeRadius: 0.07,
          },
          {
            kind: 'torus',
            name: 'bad car right tire',
            semanticRole: 'vehicle_tire',
            position: [1.2, 0.25, -0.85],
            axis: 'z',
            majorRadius: 0.28,
            tubeRadius: 0.07,
          },
          {
            kind: 'rounded-panel',
            name: 'bad car windshield',
            semanticRole: 'vehicle_window',
            position: [0.4, 1.02, 0],
            length: 0.4,
            width: 1,
            thickness: 0.02,
          },
          {
            kind: 'sphere',
            name: 'bad car left headlight',
            semanticRole: 'headlight',
            position: [1.95, 0.55, -0.45],
            radius: 0.05,
          },
          {
            kind: 'sphere',
            name: 'bad car right headlight',
            semanticRole: 'headlight',
            position: [1.95, 0.55, 0.45],
            radius: 0.05,
          },
          {
            kind: 'box',
            name: 'front bumper',
            semanticRole: 'front_bumper',
            position: [2.05, 0.32, 0],
            length: 0.06,
            width: 1.5,
            height: 0.08,
          },
          {
            kind: 'box',
            name: 'rear bumper',
            semanticRole: 'rear_bumper',
            position: [-2.05, 0.32, 0],
            length: 0.06,
            width: 1.5,
            height: 0.08,
          },
        ],
      },
      { prompt: '生成一辆红色小轿车' },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('Invalid geometry tool call')
    expect(result.content).toContain('vehicle requires exactly 4 tires')
  })

  test('accepts bicycle compose_parts calls with nested geometryBrief part-kind aliases', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        kind: 'compose_parts',
        parts: [
          { name: 'bicycle_wheels', partType: 'bicycle_wheels' },
          { name: 'bicycle_frame', partType: 'bicycle_frame' },
          { name: 'bicycle_fork', partType: 'bicycle_fork' },
          { name: 'handlebar', partType: 'handlebar' },
          { name: 'saddle', partType: 'saddle' },
          { name: 'chain_loop', partType: 'chain_loop' },
        ],
        metadata: {
          geometryBrief: {
            category: 'bicycle',
            units: 'meters',
            coordinateSystem: '+X=left/right, +Y=up, +Z=front/back, y=0=ground',
            requiredRoles: ['bicycle_wheels', 'frame', 'fork', 'handlebar', 'saddle', 'chain'],
          },
        },
      },
      { prompt: '生成一个新的正确自行车模型' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=bicycle')
    expect(result.content).not.toContain('required semantic role "bicycle_wheels" is missing')
    expect(
      result.artifact?.shapes.some(
        (shape) => shape.kind === 'sweep' && shape.name?.includes('chain elongated loop'),
      ),
    ).toBe(true)
  })

  test('accepts smooth hand-built vehicle retries with role aliases and cylinder wheels', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        name: 'Smooth car retry',
        geometryBrief: {
          category: 'vehicle',
          requiredRoles: ['vehicle_wheels', 'vehicle_glass', 'vehicle_bumper', 'vehicle_headlight'],
        },
        shapes: [
          {
            kind: 'box',
            name: 'smooth vehicle body',
            semanticRole: 'vehicle_body',
            position: [0, 0.55, 0],
            length: 4.2,
            width: 1.7,
            height: 0.65,
            cornerRadius: 0.18,
            material: { properties: { color: '#cc0000' } },
          },
          {
            kind: 'box',
            name: 'smooth vehicle cabin glass',
            semanticRole: 'vehicle_glass',
            position: [0, 1.02, 0],
            length: 1.35,
            width: 1.2,
            height: 0.38,
            cornerRadius: 0.14,
          },
          ...[
            [-1.35, -0.82],
            [1.35, -0.82],
            [-1.35, 0.82],
            [1.35, 0.82],
          ].flatMap(([x, z], index) => [
            {
              kind: 'cylinder',
              name: `wheel_${index}`,
              semanticRole: 'vehicle_tire',
              position: [x, 0.28, z],
              axis: 'z',
              radius: 0.3,
              width: 0.18,
            },
            {
              kind: 'cylinder',
              name: `hub_${index}`,
              semanticRole: 'vehicle_wheel_hub',
              position: [x, 0.28, z],
              axis: 'z',
              radius: 0.12,
              width: 0.2,
            },
          ]),
          {
            kind: 'sphere',
            name: 'left vehicle headlight',
            semanticRole: 'vehicle_headlight',
            position: [2.05, 0.55, -0.45],
            radius: 0.06,
          },
          {
            kind: 'sphere',
            name: 'right vehicle headlight',
            semanticRole: 'vehicle_headlight',
            position: [2.05, 0.55, 0.45],
            radius: 0.06,
          },
          {
            kind: 'box',
            name: 'front vehicle bumper',
            semanticRole: 'vehicle_bumper',
            position: [2.12, 0.32, 0],
            length: 0.08,
            width: 1.45,
            height: 0.08,
          },
          {
            kind: 'box',
            name: 'rear vehicle bumper',
            semanticRole: 'vehicle_bumper',
            position: [-2.12, 0.32, 0],
            length: 0.08,
            width: 1.45,
            height: 0.08,
          },
        ],
      },
      { prompt: '汽车线条再丝滑点' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=vehicle')
    expect(result.content).toContain('vehicle_tire:4')
  })
})
