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

  test('accepts compose_primitive params.parts with object positions', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        params: {
          parts: [
            {
              id: 'chimney_shaft',
              type: 'cylinder',
              radius: 0.6,
              height: 10,
              axis: 'y',
              position: { x: 0, y: 5, z: 0 },
              material: { properties: { color: '#8B4513' } },
              semanticRole: 'chimney_body',
            },
            {
              id: 'top_rim',
              type: 'torus',
              majorRadius: 0.62,
              tubeRadius: 0.08,
              axis: 'y',
              position: { x: 0, y: 10.05, z: 0 },
              semanticRole: 'chimney_cap',
            },
          ],
        },
      },
      { prompt: 'generate a 10m industrial chimney' },
    )

    expect(result.content).toContain('Created draft')
    expect(result.artifact?.shapes).toHaveLength(2)
    expect(result.artifact?.shapes[0]).toMatchObject({
      kind: 'cylinder',
      radius: 0.6,
      height: 10,
      position: [0, 5, 0],
      semanticRole: 'chimney_body',
    })
    expect(result.artifact?.shapes[1]).toMatchObject({
      kind: 'torus',
      majorRadius: 0.62,
      tubeRadius: 0.08,
      position: [0, 10.05, 0],
    })
  })

  test('falls back from unsupported tower assembly to chimney parts', () => {
    const result = executeGeometryToolCall(
      'compose_assembly',
      {
        family: 'tower',
        category: 'tower',
        constraints: { height: 10, primaryColor: '#5C5C5C' },
      },
      {
        prompt: 'generate a 10 meter chimney',
        blueprintRequiredRoles: ['chimney_shaft', 'chimney_cap'],
        blueprintCategory: 'tower',
      },
    )

    expect(result.content).toContain('Created draft')
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'fan_blade')).toBe(false)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'protective_grill')).toBe(
      false,
    )
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'chimney_base')).toBe(
      false,
    )
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'chimney_cap')).toBe(true)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'chimney_opening')).toBe(
      true,
    )
    const shaft = result.artifact?.shapes.find((shape) => shape.sourcePartKind === 'chimney_shaft')
    expect(shaft).toMatchObject({
      kind: 'frustum',
      height: 10,
      semanticRole: 'chimney_body',
    })
    expect(shaft?.radiusBottom).toBeGreaterThan(shaft?.radiusTop ?? 0)
    expect(shaft?.position?.[1]).toBeCloseTo(5)
    const opening = result.artifact?.shapes.find(
      (shape) => shape.sourcePartKind === 'chimney_opening',
    )
    expect(opening).toMatchObject({
      kind: 'cylinder',
      semanticRole: 'chimney_opening',
    })
    expect(opening?.radius).toBeLessThan(shaft?.radiusTop ?? 0)
  })

  test('upgrades a simple primitive chimney cylinder into a tapered hollow stack', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            kind: 'cylinder',
            name: 'industrial chimney',
            radius: 0.6,
            height: 10,
            axis: 'y',
            position: [0, 5, 0],
            semanticRole: 'chimney_body',
          },
        ],
      },
      { prompt: 'generate a 10m industrial chimney' },
    )

    const shaft = result.artifact?.shapes.find((shape) => shape.sourcePartKind === 'chimney_shaft')
    const opening = result.artifact?.shapes.find(
      (shape) => shape.semanticRole === 'chimney_opening',
    )

    expect(result.content).toContain('Created draft')
    expect(shaft).toMatchObject({ kind: 'frustum', semanticRole: 'chimney_body', height: 10 })
    expect(shaft?.radiusBottom).toBeGreaterThan(shaft?.radiusTop ?? 0)
    expect(shaft?.position?.[1]).toBeCloseTo(5)
    expect(shaft?.wallThickness).toBeGreaterThan(0)
    expect(opening).toMatchObject({ kind: 'cylinder', semanticRole: 'chimney_opening' })
    expect(opening?.radius).toBeLessThan(shaft?.radiusTop ?? 0)
  })

  test('accepts conformal_strip alias with string fuselage attachment target', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            kind: 'conformal_strip',
            semanticRole: 'aircraft_livery_stripe',
            attachTo: 'fuselage',
            surface: 'ellipsoid-cylinder',
            side: 'left',
            xStart: -0.35,
            xEnd: 0.38,
            verticalOffset: 0.04,
            width: 0.04,
            thickness: 0.003,
            surfaceRadiusY: 0.08,
            surfaceRadiusZ: 0.12,
          },
        ],
      },
      { prompt: 'aircraft livery conformal strip' },
    )

    expect(result.artifact?.shapes[0]?.kind).toBe('conformal-strip')
    expect(result.artifact?.shapes[0]?.attachTo).toBe('fuselage')
    expect(result.artifact?.shapes[0]?.semanticRole).toBe('aircraft_livery_stripe')
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

  test('grounds standalone primitives when position is omitted', () => {
    const [cone, horizontalCone, explicitCone] = normalizeGeometryToolShapes([
      { kind: 'cone', radius: 0.5, height: 2 },
      { kind: 'cone', axis: 'x', radius: 0.25, height: 2 },
      { kind: 'cone', radius: 0.5, height: 2, position: [0, 0, 0] },
    ])

    expect(cone?.position).toEqual([0, 1, 0])
    expect(horizontalCone?.position).toEqual([0, 0.25, 0])
    expect(explicitCone?.position).toEqual([0, 0, 0])
  })

  test('expands primitive array expressions before validation and shape budget checks', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        name: 'Louver strip',
        shapes: [
          {
            kind: 'rounded-panel',
            name: 'louver blade',
            position: [0, 1, 0],
            length: 0.7,
            width: 0.04,
            thickness: 0.02,
            array: { count: 4, step: [0, 0.08, 0] },
          },
        ],
      },
      { prompt: 'four repeated louver blades' },
      { maxShapes: 4 },
    )

    expect(result.content).toContain('Created draft')
    expect(result.artifact?.shapes).toHaveLength(4)
    expect(result.artifact?.shapes.map((shape) => shape.position[1])).toEqual([1, 1.08, 1.16, 1.24])

    const tooMany = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            kind: 'box',
            position: [0, 0.5, 0],
            length: 0.1,
            width: 0.1,
            height: 0.1,
            array: { count: 5, step: [0.2, 0, 0] },
          },
        ],
      },
      { prompt: 'too many arrayed blocks' },
      { maxShapes: 4 },
    )

    expect(tooMany.artifact).toBeUndefined()
    expect(tooMany.content).toContain('limit is 4')
  })

  test('accepts custom tricycle required roles without forcing bicycle or car validators', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        name: 'tricycle',
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
      { prompt: 'make a tricycle' },
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
      { prompt: '鐢熸垚涓€杈嗙孩鑹插皬杞胯溅' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=vehicle')
    expect(result.content).toContain('Visual quality: family=vehicle')
    expect(result.content).toContain('vehicle_tire:4')
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'vehicle_tire'),
    ).toHaveLength(4)
  })

  test('builds unsupported aircraft from generic parts without vehicle auto-completion', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'Boeing 717 airliner',
        primaryColor: '#ffffff',
        secondaryColor: '#dbeafe',
        darkColor: '#1f2937',
        geometryBrief: {
          category: 'aircraft',
          requiredRoles: [
            'streamlined_body',
            'main_wing',
            'tail_stabilizer',
            'landing_gear_wheel',
            'cabin_window',
          ],
          validationTargets: [
            'cylindrical fuselage',
            'swept low wings',
            'T-tail',
            'landing gear wheels',
          ],
        },
        parts: [
          {
            kind: 'streamlined_body',
            id: 'fuselage',
            name: 'fuselage',
            semanticRole: 'streamlined_body',
            length: 5.6,
            radius: 0.38,
            position: [0, 0.95, 0],
            color: '#ffffff',
          },
          {
            kind: 'lofted_panel',
            id: 'left-wing',
            name: 'left main wing',
            semanticRole: 'main_wing',
            position: [0.2, 0.9, -0.55],
            sections: [
              { x: -0.4, z: 0, width: 1.0, height: 0.06 },
              { x: 0.8, z: -1.6, width: 0.35, height: 0.035 },
            ],
            color: '#dbeafe',
          },
          {
            kind: 'lofted_panel',
            id: 'right-wing',
            name: 'right main wing',
            semanticRole: 'main_wing',
            position: [0.2, 0.9, 0.55],
            sections: [
              { x: -0.4, z: 0, width: 1.0, height: 0.06 },
              { x: 0.8, z: 1.6, width: 0.35, height: 0.035 },
            ],
            color: '#dbeafe',
          },
          {
            kind: 'airfoil_blade',
            id: 'tail-fin',
            name: 'vertical T tail fin',
            semanticRole: 'tail_stabilizer',
            position: [-2.45, 1.65, 0],
            length: 0.75,
            rootWidth: 0.36,
            tipWidth: 0.18,
            width: 0.06,
            rotation: [0, 0, 1.5708],
            color: '#ffffff',
          },
          {
            kind: 'lofted_panel',
            id: 't-tail',
            name: 'horizontal T tail',
            semanticRole: 'tail_stabilizer',
            position: [-2.55, 2.0, 0],
            sections: [
              { x: -0.25, z: -0.55, width: 0.32, height: 0.035 },
              { x: 0.25, z: 0.55, width: 0.26, height: 0.03 },
            ],
            color: '#dbeafe',
          },
          {
            kind: 'wheel_set',
            id: 'landing-gear',
            name: 'landing gear',
            count: 3,
            semanticRole: 'landing_gear_wheel',
            position: [0.15, 0.24, 0],
            length: 1.5,
            width: 0.58,
            radius: 0.09,
            wheelWidth: 0.045,
          },
          {
            kind: 'window_strip',
            id: 'cabin-windows',
            name: 'cabin window strip',
            semanticRole: 'cabin_window',
            count: 8,
            position: [0.25, 1.14, 0.39],
            length: 2.8,
            height: 0.07,
            width: 0.015,
            color: '#67e8f9',
          },
        ],
      },
      { prompt: 'Generate a Boeing 717 airliner with rear-mounted twin turbofans and a T-tail.' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.content).not.toContain('vehicle requires')
    expect(roles.has('aircraft_wing')).toBe(true)
    expect(roles.has('vertical_stabilizer')).toBe(true)
    expect(roles.has('horizontal_stabilizer')).toBe(true)
    expect(
      result.artifact?.shapes.filter(
        (shape) =>
          shape.semanticRole === 'aircraft_landing_gear_nose' ||
          shape.semanticRole === 'aircraft_landing_gear_main' ||
          shape.semanticRole === 'landing_gear_wheel',
      ),
    ).toHaveLength(6)
    expect(roles.has('vehicle_body')).toBe(false)
    expect(result.content).toContain('Visual quality: family=aircraft')
    expect(result.content).not.toContain('fan visual quality score is too low')
  })

  test('uses Chinese prompt length for aircraft compose_parts defaults', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: '\u751f\u6210\u4e00\u4e2a\u6ce2\u97f3717\u7684\u5ba2\u673a',
        geometryBrief: 'test geometry brief',
        parts: [],
      },
      {
        prompt:
          '\u751f\u6210\u4e00\u4e2a\u6ce2\u97f3717\u7684\u5ba2\u673a\uff0c\u957f\u5ea6\u4e94\u7c73',
      },
    )

    const fuselage = result.artifact?.shapes.find(
      (shape) => shape.semanticRole === 'aircraft_fuselage',
    )

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(fuselage?.scale?.[0]).toBeCloseTo(3.9)
    expect(result.content).toContain('Visual quality: family=aircraft')
    expect(result.content).not.toContain('fan visual quality score is too low')
  })

  test('accepts LLM aircraft side-specific required role aliases', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: '10 meter aircraft',
        length: 10,
        geometryBrief: {
          category: 'aircraft',
          requiredRoles: [
            'aircraft_wing_left',
            'aircraft_wing_right',
            'aircraft_tail_horizontal',
            'aircraft_tail_vertical',
            'aircraft_engine_left',
            'aircraft_engine_right',
          ],
        },
        parts: [{ kind: 'aircraft_fuselage', id: 'aircraft_fuselage' }],
      },
      { prompt: 'generate a 10 meter aircraft' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).not.toContain('required semantic role')
    expect(result.content).not.toContain('Invalid geometry tool call')
  })

  test('accepts complete airframe as an aircraft required role alias', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'complete 10 meter aircraft',
        length: 10,
        geometryBrief: {
          category: 'aircraft',
          requiredRoles: ['complete_airframe'],
        },
        parts: [{ kind: 'aircraft_fuselage', id: 'aircraft_fuselage' }],
      },
      { prompt: 'generate a complete 10 meter aircraft' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact).toBeDefined()
    expect(roles.has('aircraft_fuselage')).toBe(true)
    expect(roles.has('aircraft_wing')).toBe(true)
    expect(roles.has('horizontal_stabilizer')).toBe(true)
    expect(roles.has('vertical_stabilizer')).toBe(true)
    expect(result.content).not.toContain('complete_airframe')
    expect(result.content).not.toContain('Invalid geometry tool call')
  })

  test('falls back from hand-placed generic aircraft parts to coherent aircraft defaults', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief: {
          category: 'aircraft',
          requiredRoles: [
            'fuselage_body',
            'left_wing',
            'right_wing',
            'aircraft_landing_gear_nose',
            'aircraft_landing_gear_main',
            'aircraft_window',
          ],
        },
        category: 'aircraft',
        parts: [
          {
            id: 'fuselage',
            kind: 'streamlined_body',
            semanticRole: 'fuselage_body',
            length: 10,
            radius: 0.65,
          },
          {
            id: 'left_wing',
            kind: 'airfoil_blade',
            semanticRole: 'left_wing',
            connectTo: 'fuselage',
            connectPoint: 'mid_body',
            side: 'left',
            length: 6,
            width: 2,
          },
          {
            id: 'right_wing',
            kind: 'airfoil_blade',
            semanticRole: 'right_wing',
            connectTo: 'fuselage',
            connectPoint: 'mid_body',
            side: 'right',
            length: 6,
            width: 2,
          },
          {
            id: 'nose_gear',
            kind: 'wheel_set',
            semanticRole: 'aircraft_landing_gear_nose',
            radius: 0.25,
          },
        ],
      },
      { prompt: 'generate a 10 meter aircraft' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const fuselage = result.artifact?.shapes.find(
      (shape) => shape.semanticRole === 'aircraft_fuselage',
    )

    expect(result.artifact?.shapes).toHaveLength(55)
    expect(result.artifact?.sourceArgs.parts).toEqual([
      { kind: 'aircraft_fuselage', id: 'aircraft_fuselage' },
    ])
    expect(fuselage?.scale?.[0]).toBeCloseTo(7.8)
    expect(roles.has('left_wing')).toBe(false)
    expect(roles.has('aircraft_wing')).toBe(true)
    expect(roles.has('aircraft_landing_gear_nose')).toBe(true)
    expect(roles.has('engine_nacelle_left')).toBe(true)
  })

  test('falls back to compact aircraft defaults when handwritten aircraft exceeds shape limit', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        name: 'over-detailed Boeing airliner',
        length: 8,
        geometryBrief: 'test geometry brief',
        shapes: Array.from({ length: 185 }, (_, index) => ({
          kind: 'box',
          name: `aircraft repeated cabin detail ${index}`,
          semanticRole: 'aircraft_window',
          position: [index * 0.01, 0.9, 0.4],
          length: 0.02,
          width: 0.01,
          height: 0.01,
        })),
      },
      {
        prompt: '??????????8?',
        blueprintCategory: 'aircraft',
        blueprintRequiredRoles: [
          'aircraft_fuselage',
          'aircraft_wing',
          'aircraft_horizontal_stabilizer',
          'aircraft_vertical_stabilizer',
          'aircraft_landing_gear_main',
          'aircraft_landing_gear_nose',
          'aircraft_window',
          'aircraft_engine_nacelle',
        ],
      },
    )

    expect(result.artifact?.shapes).toHaveLength(55)
    expect(result.content).toContain('Visual quality: family=aircraft')
    expect(result.content).not.toContain('too complex')
  })

  test('falls back to compact aircraft defaults when handwritten aircraft misses landing gear roles', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        name: 'gearless Boeing airliner',
        length: 8,
        geometryBrief: 'test geometry brief',
        shapes: [
          {
            kind: 'box',
            name: 'aircraft fuselage block',
            semanticRole: 'aircraft_fuselage',
            position: [0, 0.9, 0],
            length: 5,
            width: 0.4,
            height: 0.4,
          },
          {
            kind: 'box',
            name: 'aircraft wing left',
            semanticRole: 'aircraft_wing',
            position: [0, 0.9, -1],
            length: 2,
            width: 0.05,
            height: 0.4,
          },
        ],
      },
      {
        prompt: '??????????8?',
        blueprintCategory: 'aircraft',
        blueprintRequiredRoles: [
          'aircraft_fuselage',
          'aircraft_wing',
          'aircraft_landing_gear_main',
          'aircraft_landing_gear_nose',
          'aircraft_engine_nacelle',
        ],
      },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    expect(result.artifact?.shapes).toHaveLength(55)
    expect(roles.has('aircraft_landing_gear_nose')).toBe(true)
    expect(roles.has('aircraft_landing_gear_main')).toBe(true)
    expect(result.content).not.toContain('required semantic role')
  })

  test('redirects legacy compose_recipe vehicle output to assembly defaults', () => {
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

  test('uses recipe-owned validation brief for closed-form recipes with conflicting user brief', () => {
    const result = executeGeometryToolCall(
      'compose_recipe',
      {
        recipeId: 'mixer.impeller',
        geometryBrief: {
          category: 'mixer',
          requiredRoles: ['vertical_shaft', 'mixer_hub'],
        },
        params: {},
      },
      { prompt: '娉ユ祮鎼呮媽閮ㄤ欢锛屼竴鏍规潌瀛愶紝涓嬮潰涓夐潰妗ㄥ彾' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=mixer')
    expect(result.content).toContain('mixer_blade:3')
    expect(result.content).not.toContain('vertical_shaft')
    expect(result.artifact?.geometryBrief?.requiredRoles).toContain('mixer_shaft')
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'mixer_blade'),
    ).toHaveLength(3)
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
        feedback: 'the roof and windows look separated',
        intent:
          'replace the cabin with an integrated glasshouse and inherit body color for pillars',
        userVisiblePlan:
          'keep body and wheels; replace cabin with integrated glasshouse and same-color pillars',
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
        prompt: 'the roof and windows look separated',
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

  test('revises recipe-generated semantic details through editable hints', () => {
    const initial = executeGeometryToolCall(
      'compose_recipe',
      { recipeId: 'appliance.airConditionerOutdoorUnit' },
      { prompt: 'generate an outdoor air conditioner unit' },
    )
    const beforeBlade = initial.artifact?.shapes.find((shape) => shape.semanticRole === 'fan_blade')

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: initial.artifact?.id,
        feedback: 'fan blades are a bit short; make them longer',
        intent: 'scale outdoor AC fan blades by their editable primary dimension',
        operations: [
          {
            op: 'scaleSemantic',
            selector: { semanticRole: 'fan_blade' },
            dimension: 'primary',
            factor: 1.3,
          },
        ],
      },
      {
        prompt: 'fan blades are a bit short; make them longer',
        revisionOf: initial.artifact?.id,
        revisionVersion: initial.artifact?.version,
        revisionTarget: initial.artifact,
      },
    )

    const afterBlade = revised.artifact?.shapes.find((shape) => shape.semanticRole === 'fan_blade')
    const hub = revised.artifact?.shapes.find((shape) => shape.semanticRole === 'fan_hub')

    expect(revised.artifact?.sourceTool).toBe('revise_geometry')
    expect(afterBlade?.length).toBeCloseTo((beforeBlade?.length ?? 0) * 1.3)
    expect(afterBlade?.width).toBeCloseTo(beforeBlade?.width ?? 0)
    expect(hub?.radius).toBeCloseTo(
      initial.artifact?.shapes.find((shape) => shape.semanticRole === 'fan_hub')?.radius ?? 0,
    )
  })

  test('rejects semantic but blocky primitive cars with visual quality feedback', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief: 'test geometry brief',
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
        geometryBrief: 'test geometry brief',
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
      { prompt: '鐢熸垚涓€杈嗙孩鑹插皬杞胯溅' },
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
      { prompt: '鐢熸垚涓€涓柊鐨勬纭嚜琛岃溅妯″瀷' },
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
      { prompt: 'generate an outdoor air conditioner unit' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=valve')
    expect(result.content).toContain('flange_inlet:1')
    expect(result.content).toContain('flange_outlet:1')
    expect(result.content).not.toContain('required semantic role')
  })

  test('rejects compose_parts output missing blueprint required roles', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'Gas engine partial blueprint',
        autoComplete: false,
        parts: [
          { id: 'base', kind: 'skid_base', semanticRole: 'machine_base' },
          {
            id: 'block',
            kind: 'rounded_machine_body',
            semanticRole: 'engine_block',
            alignAbove: 'base',
          },
        ],
      },
      {
        prompt: '鐢熸垚涓€鍙扮噧姘旀満',
        blueprintCategory: 'gas_engine',
        blueprintRequiredRoles: ['machine_base', 'engine_block', 'flywheel'],
      },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('required semantic role "flywheel" is missing')
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

  test('accepts compose_recipe mixer impeller output', () => {
    const result = executeGeometryToolCall(
      'compose_recipe',
      {
        recipeId: 'mixer.impeller',
        params: {
          bladeCount: 3,
          bladeTilt: 30,
        },
      },
      { prompt: 'generate a mud mixer with one rod and three inclined flat blades' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.artifact?.sourceTool).toBe('compose_recipe')
    expect(result.content).toContain('Validation: family=mixer')
    expect(result.content).toContain('mixer_shaft:1')
    expect(result.content).toContain('mixer_hub:1')
    expect(result.content).toContain('mixer_blade:3')
  })

  test('accepts expanded closed-form factory standard recipes', () => {
    const cases: Array<{
      recipeId: string
      params?: Record<string, unknown>
      category: string
      roles: string[]
    }> = [
      {
        recipeId: 'sprocket.chain',
        params: { teeth: 16, boreDiameter: 0.03 },
        category: 'chain_sprocket',
        roles: ['chain_sprocket', 'sprocket_hub', 'sprocket_bore'],
      },
      {
        recipeId: 'pipe.elbow90',
        params: { nominalDiameter: 0.1, bendRadius: 0.15 },
        category: 'pipe_elbow',
        roles: ['pipe_elbow_body', 'pipe_elbow_bore', 'elbow_inlet', 'elbow_outlet'],
      },
      {
        recipeId: 'bearing.pillowBlock',
        params: { shaftDiameter: 0.05 },
        category: 'pillow_block_bearing',
        roles: [
          'pillow_block_base',
          'bearing_housing',
          'bearing_insert',
          'bearing_bore',
          'mounting_hole',
        ],
      },
      {
        recipeId: 'coupling.flexible',
        params: { shaftDiameter: 0.04, jawCount: 6 },
        category: 'shaft_coupling',
        roles: ['coupling_hub_left', 'coupling_hub_right', 'elastomer_spider', 'coupling_bore'],
      },
      {
        recipeId: 'plate.perforated',
        params: { rows: 3, columns: 5, holeDiameter: 0.03 },
        category: 'perforated_plate',
        roles: ['perforated_plate', 'perforation_hole'],
      },
    ]

    for (const testCase of cases) {
      const result = executeGeometryToolCall(
        'compose_recipe',
        {
          recipeId: testCase.recipeId,
          params: testCase.params,
        },
        { prompt: `generate ${testCase.recipeId}` },
      )
      const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

      expect(result.artifact?.sourceTool).toBe('compose_recipe')
      expect(result.artifact?.geometryBrief?.category).toBe(testCase.category)
      for (const role of testCase.roles) expect(roles.has(role)).toBe(true)
      expect(result.content).not.toContain('Invalid geometry tool call')
    }
  })

  test('redirects legacy vehicle recipe ids to assembly with prompt dimensions and color', () => {
    const result = executeGeometryToolCall(
      'compose_recipe',
      { recipeId: 'vehicle.sedan' },
      { prompt: 'generate a green 2 meter sedan car' },
    )

    const bodyShell = result.artifact?.shapes.find((shape) =>
      shape.name?.includes('vehicle body shell'),
    )
    expect(bodyShell?.length).toBeCloseTo(2)
    expect(bodyShell?.material?.properties?.color).toBe('#22c55e')
  })

  test('uses constraint-first assembly for direct vehicle requests', () => {
    const result = executeGeometryToolCall(
      'compose_assembly',
      { family: 'vehicle', length: 2, primaryColor: '#22c55e', style: 'small car' },
      { prompt: 'generate a two-meter green small car' },
    )

    const bodyShell = result.artifact?.shapes.find((shape) =>
      shape.name?.includes('vehicle body shell'),
    )
    expect(result.artifact?.sourceTool).toBe('compose_assembly')
    expect(result.content).toContain('Validation: family=vehicle')
    expect(bodyShell?.length).toBeCloseTo(2)
    expect(bodyShell?.material?.properties?.color).toBe('#22c55e')
  })

  test('applies explicit CNC color to visible machine tool body parts', () => {
    const result = executeGeometryToolCall(
      'compose_assembly',
      {
        family: 'cnc',
        object: 'cnc_mill',
        style: 'vertical',
        primaryColor: '#FFFFFF',
        length: 1.2,
        width: 1,
        height: 2,
      },
      { prompt: 'generate a white cnc machine tool' },
    )

    const base = result.artifact?.shapes.find((shape) => shape.semanticRole === 'machine_base')
    const enclosure = result.artifact?.shapes.find(
      (shape) => shape.semanticRole === 'machine_enclosure',
    )

    expect(result.artifact?.sourceTool).toBe('compose_assembly')
    expect(result.content).toContain('Validation: family=machine_tool')
    expect(result.artifact?.geometryBrief?.category).toBe('machine_tool')
    expect(base?.material?.properties?.color).toBe('#FFFFFF')
    expect(enclosure?.material?.properties?.color).toBe('#FFFFFF')
  })

  test('routes chemical distillation columns to a vertical tower assembly', () => {
    const result = executeGeometryToolCall(
      'compose_assembly',
      {
        family: 'chemical_plant',
        object: 'distillation_column',
        height: 8,
        diameter: 1,
        primaryColor: '#B0C4DE',
      },
      { prompt: 'test prompt' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const shell = result.artifact?.shapes.find(
      (shape) => shape.semanticRole === 'distillation_column_shell',
    )

    expect(result.artifact?.sourceTool).toBe('compose_assembly')
    expect(result.content).toContain('Validation: family=distillation_tower')
    expect(result.artifact?.geometryBrief?.category).toBe('distillation_tower')
    expect(result.artifact?.geometryBrief?.expectedDimensions?.height).toBe(8)
    expect(result.artifact?.geometryBrief?.expectedDimensions?.width).toBe(1)
    expect(shell?.kind).toBe('cylinder')
    expect(shell?.axis).toBe('y')
    expect(shell?.height).toBeCloseTo(8)
    expect(shell?.radius).toBeCloseTo(0.5)
    expect(roles.has('tray_level')).toBe(true)
    expect(roles.has('inlet_port')).toBe(true)
    expect(roles.has('outlet_port')).toBe(true)
    expect(roles.has('access_platform')).toBe(true)
    expect(roles.has('ladder')).toBe(true)
  })

  test('supports discrete and process industry assembly skeletons without per-device recipes', () => {
    const cases: Array<{
      label: string
      args: Record<string, unknown>
      category: string
      roles: string[]
    }> = [
      {
        label: 'lathe',
        args: { family: 'machine_tool', object: 'lathe' },
        category: 'machine_tool',
        roles: ['machine_base', 'machine_bed', 'spindle_chuck', 'tool_post', 'control_panel'],
      },
      {
        label: 'milling machine',
        args: { family: 'machine_tool', object: 'milling_machine' },
        category: 'machine_tool',
        roles: ['machine_base', 'machine_column', 'work_table', 'spindle_head', 'milling_cutter'],
      },
      {
        label: 'grinding machine',
        args: { family: 'machine_tool', object: 'grinder' },
        category: 'machine_tool',
        roles: ['machine_base', 'work_table', 'grinding_wheel', 'wheel_guard'],
      },
      {
        label: 'planer',
        args: { family: 'machine_tool', object: 'planer' },
        category: 'machine_tool',
        roles: ['machine_base', 'work_table', 'cross_rail', 'reciprocating_ram', 'tool_head'],
      },
      {
        label: 'drilling machine',
        args: { family: 'machine_tool', object: 'drill_press' },
        category: 'machine_tool',
        roles: ['machine_base', 'machine_column', 'work_table', 'spindle_head', 'drill_bit'],
      },
      {
        label: 'cnc machine',
        args: { family: 'cnc', object: 'cnc_machine' },
        category: 'machine_tool',
        roles: ['machine_base', 'machine_bed', 'spindle_head', 'control_panel'],
      },
      {
        label: 'reactor',
        args: { family: 'reactor', object: 'reaction_kettle' },
        category: 'reactor',
        roles: [
          'reactor_vessel_shell',
          'agitator_motor',
          'agitator_shaft',
          'reactor_impeller',
          'inlet_port',
          'outlet_port',
        ],
      },
      {
        label: 'storage tank',
        args: { family: 'tank', object: 'storage_tank', height: 3, diameter: 1.2 },
        category: 'tank',
        roles: ['vessel_shell', 'inlet_port', 'outlet_port', 'support_base'],
      },
      {
        label: 'grate cooler',
        args: { family: 'grate_cooler', object: 'grate_cooler' },
        category: 'grate_cooler',
        roles: [
          'cooler_housing',
          'cooler_grate_bed',
          'cooling_air_box',
          'inlet_chute',
          'outlet_chute',
        ],
      },
      {
        label: 'compressor',
        args: { family: 'compressor', object: 'compressor' },
        category: 'compressor',
        roles: ['machine_base', 'motor_body', 'compressor_casing', 'inlet_port', 'outlet_port'],
      },
      {
        label: 'belt conveyor',
        args: { family: 'conveyor', object: 'belt_conveyor' },
        category: 'conveyor',
        roles: ['conveyor_frame', 'belt_surface', 'roller_array', 'drive_motor'],
      },
    ]

    for (const testCase of cases) {
      const result = executeGeometryToolCall('compose_assembly', testCase.args, {
        prompt: `generate a ${testCase.label}`,
      })
      const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

      expect(result.artifact?.sourceTool).toBe('compose_assembly')
      expect(result.artifact?.geometryBrief?.category).toBe(testCase.category)
      for (const role of testCase.roles) expect(roles.has(role)).toBe(true)
    }
  })

  test('preserves explicit conveyor primary color constraints', () => {
    const result = executeGeometryToolCall(
      'compose_assembly',
      {
        family: 'conveyor',
        object: 'belt_conveyor',
        length: 4,
        width: 0.8,
        height: 0.9,
        primaryColor: '#f5c842',
      },
      { prompt: '?????????' },
    )

    const frame = result.artifact?.shapes.find((shape) => shape.semanticRole === 'conveyor_frame')

    expect(result.artifact?.sourceTool).toBe('compose_assembly')
    expect(result.content).toContain('Validation: family=material_handling')
    expect(frame?.material?.properties?.color).toBe('#f5c842')
  })

  test('recolors conveyor follow-up by semantic roles without replacing geometry', () => {
    const initial = executeGeometryToolCall(
      'compose_assembly',
      { family: 'conveyor', object: 'belt_conveyor', length: 4, width: 0.8, height: 0.9 },
      { prompt: 'generate a conveyor' },
    )

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: initial.artifact?.id,
        feedback: 'make the conveyor white, with the belt yellow',
        intent: 'recolor conveyor structure white and belt yellow while preserving geometry',
        operations: [
          { op: 'setMaterial', selector: { semanticRole: 'belt_surface' }, color: '#f5c842' },
          { op: 'setMaterial', selector: { semanticRole: 'conveyor_frame' }, color: '#FFFFFF' },
          { op: 'setMaterial', selector: { semanticRole: 'support_leg' }, color: '#FFFFFF' },
          { op: 'setMaterial', selector: { semanticRole: 'drive_motor' }, color: '#FFFFFF' },
        ],
      },
      {
        prompt: 'make the conveyor white, with the belt yellow',
        revisionOf: initial.artifact?.id,
        revisionVersion: initial.artifact?.version,
        revisionTarget: initial.artifact,
      },
    )

    const colorByRole = (role: string) =>
      new Set(
        revised.artifact?.shapes
          .filter((shape) => shape.semanticRole === role)
          .map((shape) => shape.material?.properties?.color),
      )

    expect(revised.artifact?.sourceTool).toBe('revise_geometry')
    expect(revised.artifact?.shapes).toHaveLength(initial.artifact?.shapes.length ?? 0)
    expect(colorByRole('belt_surface')).toEqual(new Set(['#f5c842']))
    expect(colorByRole('conveyor_frame')).toEqual(new Set(['#FFFFFF']))
    expect(colorByRole('support_leg')).toEqual(new Set(['#FFFFFF']))
    expect(colorByRole('drive_motor')).toEqual(new Set(['#FFFFFF']))
    expect(colorByRole('roller_array')).toEqual(new Set(['#cbd5e1']))
  })

  test('uses constraint-first assembly for six-axis FANUC-style industrial robot arms', () => {
    const result = executeGeometryToolCall(
      'compose_assembly',
      {
        family: 'industrialRobot',
        object: 'FANUC M-710iC/70',
        style: 'six-axis articulated matte industrial robot arm',
        primaryColor: '#f8fafc',
        secondaryColor: '#facc15',
        length: 2050,
        width: 400,
        height: 2200,
      },
      { prompt: 'test prompt' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const colors = new Set(
      result.artifact?.shapes
        .map((shape) => shape.material?.properties?.color)
        .filter((color): color is string => typeof color === 'string'),
    )

    expect(result.artifact?.sourceTool).toBe('compose_assembly')
    expect(result.content).toContain('Validation: family=robot_arm')
    expect(result.artifact?.geometryBrief?.category).toBe('robot_arm')
    expect(result.artifact?.geometryBrief?.expectedDimensions?.length).toBeCloseTo(2.05)
    expect(roles.has('robot_base')).toBe(true)
    expect(roles.has('base_joint')).toBe(true)
    expect(roles.has('shoulder_joint')).toBe(true)
    expect(roles.has('elbow_joint')).toBe(true)
    expect(roles.has('wrist_roll_joint')).toBe(true)
    expect(roles.has('wrist_pitch_joint')).toBe(true)
    expect(roles.has('wrist_joint')).toBe(true)
    expect(roles.has('end_effector')).toBe(true)
    expect(colors.has('#f8fafc')).toBe(true)
    expect(colors.has('#facc15')).toBe(true)
  })

  test('redirects legacy outdoor AC recipe aliases to assembly and accepts object aliases', () => {
    const recipe = executeGeometryToolCall(
      'compose_recipe',
      { recipeId: 'outdoor_ac_unit' },
      { prompt: 'test prompt' },
    )

    expect(recipe.artifact).toBeDefined()
    expect(recipe.artifact?.shapes.some((shape) => shape.semanticRole === 'fan_blade')).toBe(true)
    expect(recipe.artifact?.shapes.some((shape) => shape.semanticRole === 'pipe_port')).toBe(true)
    expect(recipe.content).toContain('Created draft assembly')

    const object = executeGeometryToolCall(
      'compose_object',
      { objectType: 'outdoor_ac_unit' },
      { prompt: 'test prompt' },
    )

    expect(object.artifact).toBeDefined()
    expect(object.artifact?.shapes.length).toBeGreaterThan(6)
    expect(object.artifact?.shapes.some((shape) => shape.name?.includes('fan blade'))).toBe(true)
    expect(object.artifact?.shapes.some((shape) => shape.name?.includes('vent slat'))).toBe(true)
  })

  test('falls back from empty LLM parts/primitives to matching outdoor AC assembly', () => {
    const emptyParts = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief:
          'outdoor air conditioner condenser with front fan grille, side vents, refrigerant pipe ports, and bottom feet',
        category: 'appliance',
        dimensions: { width: 900, depth: 350, height: 700 },
        units: 'mm',
      },
      { prompt: 'generate an outdoor air conditioner unit' },
    )

    expect(emptyParts.artifact).toBeDefined()
    expect(emptyParts.artifact?.shapes.some((shape) => shape.semanticRole === 'fan_blade')).toBe(
      true,
    )
    expect(emptyParts.artifact?.shapes.some((shape) => shape.semanticRole === 'pipe_port')).toBe(
      true,
    )

    const emptyPrimitive = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief:
          'outdoor air conditioner condenser with front fan grille, side vents, refrigerant pipe ports, and bottom feet',
        category: 'appliance',
      },
      { prompt: 'generate an outdoor air conditioner unit' },
    )

    expect(emptyPrimitive.artifact).toBeDefined()
    expect(
      emptyPrimitive.artifact?.shapes.some((shape) => shape.semanticRole === 'vent_slats'),
    ).toBe(true)
  })

  test('prefers outdoor AC assembly over generic appliance parts when compose_parts has no parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief:
          'outdoor air conditioner condenser with front fan grille, side vents, refrigerant pipe ports, and bottom feet',
        category: 'appliance',
        dimensions: { width: 90, depth: 35, height: 60, units: 'cm' },
        style: 'realistic',
      },
      { prompt: 'test prompt' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'fan_blade')).toBe(true)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'pipe_port')).toBe(true)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'drawer_stack')).toBe(
      false,
    )
    expect(result.artifact?.createdNames.join(' ')).not.toContain('drawer')
    expect(result.artifact?.createdNames.join(' ')).not.toContain('louvered side vents vent')
    const body = result.artifact?.shapes.find(
      (shape) => shape.semanticRole === 'rounded_machine_body',
    )
    expect(body?.length).toBeCloseTo(0.9)
    expect(body?.width).toBeCloseTo(0.35)
    expect(body?.height).toBeCloseTo(0.6)
  })

  test('reads outdoor AC dimensions from fallback brief text', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief:
          'outdoor AC unit length 0.95m width 0.40m height 0.70m with front fan grille and side vent slats',
        category: 'appliance.air_conditioner_outdoor_unit',
      },
      { prompt: 'outdoor AC unit length 0.95m width 0.40m height 0.70m' },
    )

    const body = result.artifact?.shapes.find(
      (shape) => shape.semanticRole === 'rounded_machine_body',
    )
    expect(result.artifact).toBeDefined()
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'drawer_stack')).toBe(
      false,
    )
    expect(result.artifact?.createdNames.join(' ')).not.toContain('louvered side vents vent')
    expect(body?.length).toBeCloseTo(0.95)
    expect(body?.width).toBeCloseTo(0.4)
    expect(body?.height).toBeCloseTo(0.7)
  })

  test('applies horizontal blade prompt semantics to mixer recipes', () => {
    const result = executeGeometryToolCall(
      'compose_recipe',
      { recipeId: 'mixer.impeller', size: 'default', detail: 'medium' },
      {
        prompt:
          '娉ユ祮鎼呮媽閮ㄤ欢锛屼竴鏍规潌瀛愶紝涓嬮潰涓夐潰妗ㄥ彾锛屼笁涓〃鍙惰鍚屼竴姘村钩',
      },
    )

    const blades =
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'mixer_blade') ?? []
    expect(result.artifact).toBeDefined()
    expect(blades).toHaveLength(3)
    expect(new Set(blades.map((shape) => shape.position?.[1]?.toFixed(6)))).toHaveLength(1)
    expect(
      blades.every((shape) => Math.abs((shape.rotation?.[0] ?? 0) + Math.PI / 2) < 0.001),
    ).toBe(true)
  })

  test('accepts LLM mixer compose_parts output with generic propeller blades', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief:
          'Mud mixer impeller: vertical shaft + lower hub + three tilted paddle blades around the hub. Using compose_parts with vertical_pole, circular_base, and propeller_blade_set.',
        parts: [
          { kind: 'vertical_pole', id: 'shaft', height: 1.4, radius: 0.025 },
          { kind: 'circular_base', id: 'hub', radius: 0.07, height: 0.1, alignAbove: 'shaft' },
          {
            kind: 'propeller_blade_set',
            id: 'blades',
            count: 3,
            hubRadius: 0.07,
            bladeRadius: 0.38,
            bladeWidth: 0.15,
            bladeShape: 'taiji_half',
            bladePitch: 0.55,
            verticalCurve: 0.07,
            around: 'hub',
            aroundCount: 3,
          },
        ],
        enhanceVisualDetails: true,
      },
      { prompt: 'mud mixer parts with one shaft, lower hub, and three propeller blades' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=mixer')
    expect(result.content).toContain('mixer_shaft:1')
    expect(result.content).toContain('mixer_hub:1')
    expect(result.content).toContain('mixer_blade:3')
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'mixer_blade'),
    ).toHaveLength(3)
    expect(
      result.artifact?.shapes.some((shape) => shape.sourcePartKind === 'protective_grill'),
    ).toBe(false)
    expect(result.artifact?.shapes.some((shape) => shape.sourcePartKind === 'motor_housing')).toBe(
      false,
    )
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
      { prompt: '姹借溅绾挎潯鍐嶄笣婊戠偣' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=vehicle')
    expect(result.content).toContain('vehicle_tire:4')
  })
})
