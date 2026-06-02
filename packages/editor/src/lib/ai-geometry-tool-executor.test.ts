import { describe, expect, test } from 'bun:test'
import { executeGeometryToolCall, normalizeGeometryToolShapes } from './ai-geometry-tool-executor'

describe('AI geometry tool executor', () => {
  test('accepts complex extrude profiles with bore and keyway holes', () => {
    const teeth = 20
    const profile: [number, number][] = []
    for (let tooth = 0; tooth < teeth; tooth += 1) {
      const base = (tooth / teeth) * Math.PI * 2
      for (const [offset, radius] of [
        [0, 0.43875],
        [0.25, 0.495],
        [0.75, 0.495],
        [1, 0.43875],
      ] as const) {
        const angle = base + (offset / teeth) * Math.PI * 2
        profile.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
      }
    }

    const boreWithKeyway: [number, number][] = []
    for (let index = 0; index < 40; index += 1) {
      const angle = (index / 40) * Math.PI * 2
      boreWithKeyway.push([Math.cos(angle) * 0.125, Math.sin(angle) * 0.125])
    }
    boreWithKeyway.push([0.04, 0.125], [0.04, 0.165], [-0.04, 0.165], [-0.04, 0.125])

    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            kind: 'extrude',
            name: 'Spur Gear 20T M4.5',
            semanticRole: 'spur_gear',
            position: [0, 0.1, 0],
            rotation: [Math.PI / 2, 0, 0],
            profile,
            holes: [boreWithKeyway],
            depth: 0.2,
            material: { properties: { color: '#808080', roughness: 0.4, metalness: 0.9 } },
          },
        ],
      },
      { prompt: '20 tooth spur gear with bore and keyway' },
    )

    expect(result.content).toContain('Created draft')
    expect(result.artifact?.shapes[0]?.profile?.length).toBe(80)
    expect(result.artifact?.shapes[0]?.holes?.[0]?.length).toBe(44)
  })

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

  test('accepts custom tricycle required roles without forcing bicycle or car validators', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        name: '三轮车',
        geometryBrief: {
          category: 'tricycle',
          requiredRoles: [
            'rear_wheels',
            'front_wheel',
            'cargo_bed',
            'frame',
            'fork',
            'handlebar',
            'saddle',
            'chain_loop',
          ],
        },
        shapes: [
          {
            kind: 'torus',
            name: 'rear left tire',
            semanticRole: 'rear_wheels',
            majorRadius: 0.22,
            tubeRadius: 0.018,
            axis: 'z',
            position: [-0.5, 0.32, 0.3],
          },
          {
            kind: 'torus',
            name: 'rear right tire',
            semanticRole: 'rear_wheels',
            majorRadius: 0.22,
            tubeRadius: 0.018,
            axis: 'z',
            position: [-0.5, 0.32, -0.3],
          },
          {
            kind: 'torus',
            name: 'front tire',
            semanticRole: 'front_wheel',
            majorRadius: 0.22,
            tubeRadius: 0.018,
            axis: 'z',
            position: [0.5, 0.32, 0],
          },
          {
            kind: 'box',
            name: 'cargo bed',
            semanticRole: 'cargo_bed',
            length: 0.55,
            width: 0.54,
            height: 0.22,
            position: [-0.42, 0.55, 0],
          },
          {
            kind: 'cylinder',
            name: 'tubular frame',
            semanticRole: 'frame',
            radius: 0.018,
            height: 0.48,
            axis: 'x',
            position: [0.02, 0.66, 0],
          },
          {
            kind: 'cylinder',
            name: 'front fork',
            semanticRole: 'fork',
            radius: 0.016,
            height: 0.38,
            axis: 'x',
            position: [0.43, 0.42, 0],
          },
          {
            kind: 'cylinder',
            name: 'handlebar',
            semanticRole: 'handlebar',
            radius: 0.016,
            height: 0.34,
            axis: 'z',
            position: [0.48, 0.76, 0],
          },
          {
            kind: 'box',
            name: 'saddle',
            semanticRole: 'saddle',
            length: 0.18,
            width: 0.12,
            height: 0.03,
            position: [-0.16, 0.75, 0],
          },
          {
            kind: 'sweep',
            name: 'chain loop',
            semanticRole: 'chain_loop',
            radius: 0.005,
            closed: true,
            path: [
              [-0.24, 0.37, 0.02],
              [0.1, 0.42, 0.02],
              [0.14, 0.34, 0.02],
              [-0.08, 0.3, 0.02],
            ],
          },
        ],
      },
      { prompt: '做个三轮车' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Created draft assembly')
    expect(result.content).not.toContain('bicycle requires')
    expect(result.content).not.toContain('vehicle requires')
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
    expect(result.content).toContain('Visual quality: family=vehicle')
    expect(result.content).toContain('vehicle_tire:4')
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'vehicle_tire'),
    ).toHaveLength(4)
  })

  test('accepts compose_recipe vehicle output with registry defaults', () => {
    const result = executeGeometryToolCall(
      'compose_recipe',
      {
        recipeId: 'vehicle.sedan',
        params: {
          color: '#cc0000',
          size: 'small',
        },
      },
      { prompt: 'generate a small red car' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.artifact?.sourceTool).toBe('compose_recipe')
    expect(result.content).toContain('Validation: family=vehicle')
    expect(result.content).toContain('Visual quality: family=vehicle')
    expect(result.content).toContain('vehicle_tire:4')
    const body = result.artifact?.shapes.find((shape) => shape.semanticRole === 'vehicle_body')
    expect(body?.length).toBeCloseTo(3.52)
    expect(body?.material?.properties?.color).toBe('#cc0000')
  })

  test('revises a generated vehicle artifact with local geometry operations', () => {
    const initial = executeGeometryToolCall(
      'compose_recipe',
      {
        recipeId: 'vehicle.sedan',
        params: {
          color: '#cc0000',
          size: 'small',
        },
      },
      { prompt: 'generate a small red car' },
    )

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: initial.artifact?.id,
        feedback: '车顶不像，窗户和车顶分开了',
        intent:
          'replace the cabin with an integrated glasshouse and inherit body color for pillars',
        userVisiblePlan: '保留车身和车轮，只把座舱改成一体玻璃舱并加同色结构柱。',
        operations: [
          {
            op: 'replace',
            selector: { semanticRole: 'vehicle_cabin' },
            shapes: [
              {
                kind: 'trapezoid-prism',
                name: 'integrated vehicle glasshouse',
                semanticRole: 'vehicle_cabin',
                sourcePartKind: 'vehicle_windows',
                position: [-0.18, 0.96, 0],
                length: 1.5,
                width: 1.02,
                height: 0.34,
                topLengthScale: 0.78,
                topWidthScale: 0.78,
                material: {
                  properties: {
                    color: '#1e3a8a',
                    opacity: 0.76,
                    transparent: true,
                  },
                },
              },
              {
                kind: 'box',
                name: 'vehicle A pillar left',
                semanticRole: 'vehicle_pillar',
                sourcePartKind: 'vehicle_body',
                position: [0.42, 0.98, -0.5],
                length: 0.045,
                width: 0.045,
                height: 0.34,
              },
              {
                kind: 'box',
                name: 'vehicle roof frame',
                semanticRole: 'vehicle_roof',
                sourcePartKind: 'vehicle_body',
                position: [-0.18, 1.14, 0],
                length: 1.12,
                width: 0.84,
                height: 0.035,
              },
            ],
          },
          {
            op: 'materialFrom',
            selector: { semanticRole: 'vehicle_pillar' },
            from: { semanticRole: 'vehicle_body' },
          },
          {
            op: 'materialFrom',
            selector: { nameIncludes: 'roof frame' },
            from: { semanticRole: 'vehicle_body' },
          },
        ],
      },
      {
        prompt: '车顶不像，窗户和车顶分开了',
        revisionOf: initial.artifact?.id,
        revisionVersion: initial.artifact?.version,
        revisionTarget: initial.artifact,
      },
    )

    expect(revised.artifact).toBeDefined()
    expect(revised.artifact?.sourceTool).toBe('revise_geometry')
    expect(revised.artifact?.version).toBe(2)
    expect(revised.artifact?.revisionOf).toBe(initial.artifact?.id)
    expect(revised.artifact?.editHistory).toHaveLength(1)
    expect(revised.content).toContain('Validation: family=vehicle')

    const pillar = revised.artifact?.shapes.find((shape) => shape.semanticRole === 'vehicle_pillar')
    const roofFrame = revised.artifact?.shapes.find((shape) => shape.name?.includes('roof frame'))
    expect(pillar?.material?.properties?.color).toBe('#cc0000')
    expect(roofFrame?.material?.properties?.color).toBe('#cc0000')
    expect(
      revised.artifact?.shapes.some((shape) => shape.name === 'Vehicle sedan vehicle cabin frame'),
    ).toBe(false)
  })

  test('rejects semantic but blocky primitive cars with visual quality feedback', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief: { category: 'vehicle' },
        shapes: [
          {
            kind: 'box',
            name: 'block car body',
            semanticRole: 'vehicle_body',
            position: [0, 0.95, 0],
            length: 4,
            width: 1.8,
            height: 1.5,
          },
          ...[-1.35, 1.35].flatMap((x) =>
            [-0.82, 0.82].map((z) => ({
              kind: 'torus',
              name: 'block car tire',
              semanticRole: 'vehicle_tire',
              position: [x, 0.3, z],
              axis: 'z',
              majorRadius: 0.25,
              tubeRadius: 0.06,
            })),
          ),
          {
            kind: 'rounded-panel',
            name: 'single car window sticker',
            semanticRole: 'vehicle_window',
            position: [0.2, 1.55, 0],
            length: 0.7,
            width: 1.1,
            thickness: 0.02,
          },
          {
            kind: 'sphere',
            name: 'left headlight',
            semanticRole: 'headlight',
            position: [1.95, 0.7, -0.45],
            radius: 0.05,
          },
          {
            kind: 'sphere',
            name: 'right headlight',
            semanticRole: 'headlight',
            position: [1.95, 0.7, 0.45],
            radius: 0.05,
          },
          {
            kind: 'box',
            name: 'front bumper',
            semanticRole: 'front_bumper',
            position: [2.05, 0.45, 0],
            length: 0.06,
            width: 1.5,
            height: 0.08,
          },
          {
            kind: 'box',
            name: 'rear bumper',
            semanticRole: 'rear_bumper',
            position: [-2.05, 0.45, 0],
            length: 0.06,
            width: 1.5,
            height: 0.08,
          },
        ],
      },
      { prompt: 'generate a car' },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('vehicle visual quality score is too low')
    expect(result.content).toContain('vehicle needs a separate cabin/roof mass')
    expect(result.content).toContain('Recommendation:')
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

  test('accepts valve compose_parts output with strict semantic required roles', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'Gate valve',
        geometryBrief: {
          category: 'valve',
          requiredRoles: [
            'flange_inlet',
            'flange_outlet',
            'bonnet',
            'stem',
            'gate_wedge',
            'bonnet_bolts',
            'yoke',
          ],
        },
        parts: [{ kind: 'valve_body' }],
      },
      { prompt: '生成阀门' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=valve')
    expect(result.content).toContain('flange_inlet:1')
    expect(result.content).toContain('flange_outlet:1')
    expect(result.content).not.toContain('required semantic role')
  })

  test('accepts compose_recipe valve output with recipe-supplied semantic brief', () => {
    const result = executeGeometryToolCall(
      'compose_recipe',
      {
        recipeId: 'valve.ball',
        params: { highFidelity: true },
      },
      { prompt: 'generate a ball valve' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=valve')
    expect(result.content).toContain('valve_ball:1')
    expect(result.content).toContain('valve_bore:1')
    expect(result.content).not.toContain('required semantic role')
  })

  test('accepts compose_robot_arm output with semantic and visual quality summaries', () => {
    const result = executeGeometryToolCall(
      'compose_robot_arm',
      {
        name: '3-axis robot arm',
        axisCount: 3,
        baseShape: 'round',
        pose: 'work-ready',
        endEffector: 'gripper',
        detail: 'medium',
      },
      { prompt: 'generate a 3-axis robot arm with round base' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=robot_arm')
    expect(result.content).toContain('Visual quality: family=robot_arm')
    expect(result.content).toContain('robot_base:1')
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'end_effector')).toBe(
      true,
    )
  })

  test('accepts compose_recipe robot arm output', () => {
    const result = executeGeometryToolCall(
      'compose_recipe',
      {
        recipeId: 'robotArm.threeAxis',
        params: {
          baseShape: 'round',
          endEffector: 'gripper',
          pose: 'work-ready',
        },
      },
      { prompt: 'generate a 3-axis robot arm with round base' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=robot_arm')
    expect(result.content).toContain('Visual quality: family=robot_arm')
    expect(result.content).toContain('robot_base:1')
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
