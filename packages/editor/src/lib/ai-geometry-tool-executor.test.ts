import { describe, expect, test } from 'bun:test'
import { executeGeometryToolCall, normalizeGeometryToolShapes } from './ai-geometry-tool-executor'

type TestSourcePart = {
  kind?: unknown
  position?: number[]
  length?: number
  width?: number
  height?: number
  primaryColor?: string
}

function sourceParts(value: unknown): TestSourcePart[] {
  return Array.isArray(value)
    ? value.filter((part): part is TestSourcePart => typeof part === 'object' && part !== null)
    : []
}

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

  test('infers transparent glass material for generated glass panels', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            kind: 'rounded-panel',
            name: 'blue panel',
            position: [0, 0.006, 0],
            length: 1,
            width: 2,
            thickness: 0.012,
            cornerRadius: 0.08,
            material: { properties: { color: '#2f80ff' } },
          },
        ],
      },
      { prompt: '生成一块1米*2米的圆角蓝色玻璃' },
    )

    expect(result.artifact?.shapes[0]).toMatchObject({
      kind: 'rounded-panel',
      material: {
        preset: 'glass',
        properties: {
          color: '#2f80ff',
          transparent: true,
          opacity: 0.35,
        },
      },
    })
  })

  test('infers transparent glass material from shape semantics without prompt context', () => {
    const [shape] = normalizeGeometryToolShapes([
      {
        kind: 'box',
        name: 'blue glass sheet',
        semanticRole: 'glass_panel',
        length: 1,
        width: 2,
        height: 0.012,
        materialColor: '#2f80ff',
      },
    ])

    expect(shape).toMatchObject({
      kind: 'box',
      material: {
        preset: 'glass',
        properties: {
          color: '#2f80ff',
          transparent: true,
          opacity: 0.35,
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

  test('falls back from invalid river primitives to a curved cyan river with ripples', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        name: 'curved cyan river',
        geometryBrief: {
          category: 'natural_environment',
          requiredRoles: ['riverbed', 'water_surface', 'riverbanks'],
        },
        shapes: [
          { kind: 'lofted_shell', semanticRole: 'water_surface' },
          { kind: 'extrude', semanticRole: 'riverbed', profile: [] },
          {
            kind: 'sweep',
            semanticRole: 'water_ripple',
            path: [
              [-1, 0.05, 0],
              [1, 0.05, 0.2],
            ],
          },
        ],
      },
      { prompt: 'generate a curved cyan river with water ripples' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const water = result.artifact?.shapes.find((shape) => shape.semanticRole === 'water_surface')

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Created draft assembly')
    expect(roles.has('riverbed')).toBe(true)
    expect(roles.has('water_surface')).toBe(true)
    expect(roles.has('riverbanks')).toBe(true)
    expect(roles.has('water_ripple')).toBe(true)
    expect(water?.kind).toBe('rounded-panel')
    expect(water?.material?.properties?.color).toBe('#00CED1')
    expect(water?.material?.properties?.transparent).toBe(true)
  })

  test('creates a river fallback when compose_primitive has no shapes', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      { primaryColor: '#00CED1' },
      {
        prompt:
          '\u751f\u6210\u4e00\u6761\u9752\u8272\u5f2f\u66f2\u5c0f\u6cb3\uff0c\u5e26\u6c34\u7eb9',
      },
    )

    expect(result.artifact).toBeDefined()
    expect(result.artifact?.geometryBrief?.category).toBe('natural_environment')
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'water_ripple')).toBe(
      true,
    )
  })

  test('creates a generic rockery draft when no recipe, assembly, or parts match', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: '\u5047\u5c71',
        parts: [{ kind: 'rockery', semanticRole: 'rockery' }],
      },
      { prompt: '\u751f\u6210\u4e00\u4e2a\u5047\u5c71' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Created draft assembly')
    expect(result.artifact?.geometryBrief?.category).toBe('landscape_rockery')
    expect(roles.has('rock_mass')).toBe(true)
    expect(roles.has('rock_layer')).toBe(true)
    expect(roles.has('support_base')).toBe(true)
    expect(result.content).not.toContain('No geometry could be created')
  })

  test('creates a generic editable draft for unsupported long-tail objects', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      { name: 'mystery artifact' },
      { prompt: 'generate a ceremonial signal glyph' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact).toBeDefined()
    expect(result.artifact?.geometryBrief?.category).toBe('generic_object')
    expect(result.artifact?.sourceArgs.family).toBe('generic')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'generic_body', semanticRole: 'main_body' }),
        expect.objectContaining({ kind: 'generic_base', semanticRole: 'support_base' }),
        expect.objectContaining({ kind: 'generic_detail_accent', semanticRole: 'detail_accent' }),
      ]),
    )
    expect(roles.has('main_body')).toBe(true)
    expect(roles.has('support_base')).toBe(true)
    expect(roles.has('detail_accent')).toBe(true)
    expect(result.content).not.toContain('No geometry could be created')
  })

  test('reports invalid revised geometry instead of throwing on malformed legacy profiles', () => {
    const initial = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            kind: 'extrude',
            name: 'legacy logo strip',
            semanticRole: 'panel_surface',
            profile: [
              [-0.5, -0.1],
              [0.5, -0.1],
              [0.5, 0.1],
              [-0.5, 0.1],
            ],
            depth: 0.08,
          },
        ],
      },
      { prompt: 'legacy logo strip' },
    )
    expect(initial.artifact).toBeDefined()
    const initialArtifact = initial.artifact!
    const malformedTarget = {
      ...initialArtifact,
      shapes: initialArtifact.shapes.map((shape) =>
        shape.semanticRole === 'panel_surface'
          ? { ...shape, profile: { curve: 'sine' } as unknown as [number, number][] }
          : shape,
      ),
    }

    const result = executeGeometryToolCall(
      'revise_geometry',
      {
        operations: [
          {
            op: 'transform',
            selector: { semanticRole: 'panel_surface' },
            scale: [1.2, 1, 1.2],
          },
        ],
      },
      {
        prompt: 'make the logo panel more sinuous',
        revisionTarget: malformedTarget,
        revisionOf: malformedTarget.id,
        revisionVersion: malformedTarget.version,
      },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('Invalid geometry tool call')
    expect(result.content).toContain('extrude.profile needs at least 3')
  })

  test('replaces a straight river strip with a curved river fallback on curve revision', () => {
    const initial = executeGeometryToolCall(
      'compose_primitive',
      {
        name: 'straight cyan river',
        geometryBrief: {
          category: 'natural_environment',
          requiredRoles: ['water_surface'],
        },
        shapes: [
          {
            kind: 'rounded-panel',
            name: 'straight cyan river water',
            semanticRole: 'water_surface',
            length: 12,
            width: 1.6,
            thickness: 0.04,
            material: { properties: { color: '#00CED1', transparent: true, opacity: 0.7 } },
          },
        ],
      },
      { prompt: '能不能给做个弯曲的小河，河水是青的，然后带水纹' },
    )

    const result = executeGeometryToolCall(
      'revise_geometry',
      {
        operations: [
          {
            op: 'transform',
            selector: { semanticRole: 'water_surface' },
            scale: [1, 1, 1],
          },
        ],
      },
      {
        prompt: '让他有曲线。弯弯扭扭的',
        revisionTarget: initial.artifact,
        revisionOf: initial.artifact?.id,
        revisionVersion: initial.artifact?.version,
      },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Created draft assembly')
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'water_surface').length,
    ).toBeGreaterThan(1)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'water_ripple')).toBe(
      true,
    )
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'riverbanks')).toBe(true)
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

  test('compacts compose_parts output to profile detail budgets', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'budgeted enclosure',
        deviceProfileDraft: {
          id: 'budgeted_enclosure',
          name: 'Budgeted enclosure',
          family: 'generic',
          layoutFamily: 'box_enclosure_layout',
          primarySemanticRole: 'machine_body',
          parts: [{ kind: 'generic_body', semanticRole: 'machine_body', required: true }],
        },
        detailBudget: { maxShapes: 8 },
        qualityRules: { shapeCount: { max: 8 } },
        parts: [
          { kind: 'generic_body', semanticRole: 'machine_body', required: true },
          { kind: 'vent_slats', semanticRole: 'vent_panel', detailLevel: 'high' },
          { kind: 'flange_ring', semanticRole: 'service_flange', detailLevel: 'high' },
        ],
      },
      { prompt: 'make a compact industrial enclosure with vents and flange details' },
    )

    expect(result.artifact?.shapes.length).toBeLessThanOrEqual(8)
    expect(result.artifact?.sourceArgs).toMatchObject({
      detailBudgetApplied: true,
      detailBudgetCompaction: { maxShapes: 8, afterShapeCount: 8 },
    })
  })

  test('rejects legacy compose_object tool calls after object templates are retired', () => {
    const result = executeGeometryToolCall(
      'compose_object',
      { category: 'table' },
      { prompt: 'desk length 120cm width 60cm height 75cm' },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('Unknown tool: compose_object')
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

  test('lowers derived primitive aliases to canonical primitive shapes', () => {
    const [ellipsoid, ovalPanel, halfOval, pyramid] = normalizeGeometryToolShapes([
      { kind: 'ellipsoid', length: 2, width: 1, height: 0.8 },
      { kind: 'ellipse-panel', length: 1.2, width: 0.6, thickness: 0.04, segments: 16 },
      { kind: 'semi-ellipse-panel', length: 1, height: 0.4, thickness: 0.03 },
      { kind: 'pyramid', radius: 0.5, height: 1 },
    ])

    expect(ellipsoid).toMatchObject({ kind: 'sphere', scale: [1, 0.4, 0.5] })
    expect(ovalPanel).toMatchObject({ kind: 'extrude', depth: 0.04 })
    expect(ovalPanel?.profile?.length).toBe(16)
    expect(halfOval).toMatchObject({ kind: 'extrude', depth: 0.03 })
    expect(pyramid).toMatchObject({ kind: 'cone', radialSegments: 4, height: 1 })
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
      { prompt: '\u751f\u6210\u4e00\u8f86\u7ea2\u8272\u5c0f\u8f7f\u8f66' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=vehicle')
    expect(result.content).toContain('Visual quality: family=vehicle')
    expect(result.content).toContain('vehicle_tire:4')
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'vehicle_tire'),
    ).toHaveLength(4)
  })

  test('stabilizes messy full-vehicle compose_parts output through the vehicle template', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'messy red car',
        primaryColor: '#cc0000',
        geometryBrief: {
          category: 'vehicle',
          requiredRoles: ['vehicle_body', 'vehicle_tire', 'vehicle_window'],
        },
        parts: [
          {
            kind: 'vehicle_body',
            semanticRole: 'vehicle_body',
            length: 4.4,
            width: 1.8,
            height: 1.35,
          },
          { kind: 'car_roof_panel', semanticRole: 'vehicle_roof', position: [0, 2, 0] },
          { kind: 'window_panel', semanticRole: 'vehicle_window', alignAbove: 'vehicle_body' },
          {
            kind: 'wheel_set',
            semanticRole: 'vehicle_tire',
            params: { count: 4, radius: 2.5 },
            around: 'body',
          },
          { kind: 'bumper', semanticRole: 'vehicle_bumper', alignBeside: 'vehicle_body' },
        ],
      },
      { prompt: 'generate a red sedan car from parts' },
    )

    const bodyShell = result.artifact?.shapes.find((shape) =>
      shape.name?.includes('vehicle body shell'),
    )
    const cabin = result.artifact?.shapes.find((shape) => shape.semanticRole === 'vehicle_cabin')
    const tires =
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'vehicle_tire') ?? []

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.content).toContain('Validation: family=vehicle')
    expect(result.content).toContain('Visual quality: family=vehicle')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'body_shell', semanticRole: 'vehicle_body' }),
        expect.objectContaining({
          kind: 'wheel_set',
          count: 4,
          radius: 0.8,
          semanticRole: 'vehicle_tire',
        }),
        expect.objectContaining({ kind: 'window_strip', semanticRole: 'vehicle_window' }),
      ]),
    )
    expect(bodyShell?.length).toBeCloseTo(4.4)
    expect(bodyShell?.material?.properties?.color).toBe('#cc0000')
    expect(result.artifact?.sourceArgs.partWarnings).toEqual(
      expect.arrayContaining(['wheel_set.radius clamped from 2.5 to 0.8.']),
    )
    expect(cabin).toBeDefined()
    expect(tires).toHaveLength(4)
  })

  test('accepts single car tire required role aliases without requiring a full car', () => {
    const primitiveResult = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief: {
          category: 'vehicle component',
          requiredRoles: ['car_tire'],
        },
        shapes: [
          {
            kind: 'torus',
            name: 'single car tire',
            semanticRole: 'vehicle_tire',
            position: [0, 0.3, 0],
            axis: 'z',
            majorRadius: 0.32,
            tubeRadius: 0.08,
          },
          {
            kind: 'cylinder',
            name: 'single car wheel hub',
            semanticRole: 'wheel_hub',
            position: [0, 0.3, 0],
            axis: 'z',
            radius: 0.16,
            height: 0.04,
          },
        ],
      },
      {
        prompt: '\u751f\u6210\u4e00\u4e2a\u6c7d\u8f66\u8f6e\u80ce',
        blueprintCategory: 'vehicle component',
      },
    )

    expect(primitiveResult.artifact).toBeDefined()
    expect(primitiveResult.content).toContain('Created draft')
    expect(primitiveResult.content).not.toContain('required semantic role "car_tire" is missing')
    expect(primitiveResult.content).not.toContain('vehicle requires exactly 4 tires')

    const partsResult = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief: {
          category: 'vehicle component',
          requiredRoles: ['car_tire'],
        },
        parts: [{ kind: 'wheel', semanticRole: 'car_tire', radius: 0.32, wheelWidth: 0.18 }],
      },
      { prompt: 'make a car tire', blueprintCategory: 'vehicle component' },
    )

    expect(partsResult.artifact).toBeDefined()
    expect(partsResult.content).toContain('Created draft')
    expect(partsResult.content).not.toContain('required semantic role "car_tire" is missing')
    expect(partsResult.content).not.toContain('vehicle requires exactly 4 tires')
    expect(
      partsResult.artifact?.shapes.some((shape) => shape.semanticRole === 'vehicle_tire'),
    ).toBe(true)
  })

  test('accepts family-qualified single wheel parts without vehicle validation', () => {
    for (const prompt of ['做个汽车轮子', 'make a car wheel']) {
      const result = executeGeometryToolCall(
        'compose_parts',
        {
          parts: [{ kind: 'wheel', name: prompt, radius: 0.3, wheelWidth: 0.12 }],
        },
        { prompt },
      )

      expect(result.artifact).toBeDefined()
      expect(result.content).toContain('Created draft')
      expect(result.content).not.toContain('vehicle requires')
      expect(result.content).not.toContain('vehicle visual quality')
      expect(result.artifact?.shapes.some((shape) => shape.kind === 'torus')).toBe(true)
      expect(
        result.artifact?.shapes.some((shape) => shape.name?.toLowerCase().includes('hub')),
      ).toBe(true)
    }
  })

  test('creates one bicycle wheel from singular bicycle wheel intent and count-style required roles', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief: {
          category: 'bicycle_component',
          requiredRoles: ['bicycle_tire:1', 'bicycle_rim:1', 'bicycle_hub:1', 'bicycle_spoke:8'],
        },
        parts: [
          {
            id: 'bicycle_wheel',
            kind: 'wheel_set',
            semanticRole: 'bicycle_wheel',
            radius: 0.35,
          },
        ],
      },
      {
        prompt: '生成一个自行车的轮子',
        blueprintCategory: 'bicycle_component',
        blueprintRequiredRoles: [
          'bicycle_tire:1',
          'bicycle_rim:1',
          'bicycle_hub:1',
          'bicycle_spoke:8',
        ],
      },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Created draft')
    expect(result.content).not.toContain('required semantic role "bicycle_tire:1" is missing')
    expect(result.artifact?.geometryBrief?.requiredRoles).toEqual([
      'bicycle_tire',
      'bicycle_rim',
      'bicycle_hub',
      'bicycle_spoke',
    ])
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_tire'),
    ).toHaveLength(1)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(8)
  })

  test('accepts steering wheel primitives as a vehicle-domain component without car validation', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief: {
          category: 'vehicle',
          requiredRoles: ['steering_wheel_rim', 'steering_wheel_hub', 'steering_wheel_spoke'],
        },
        shapes: [
          {
            kind: 'torus',
            name: 'steering wheel outer rim',
            axis: 'z',
            majorRadius: 0.24,
            tubeRadius: 0.025,
            position: [0, 0.8, 0],
          },
          {
            kind: 'cylinder',
            name: 'steering wheel center hub',
            axis: 'z',
            radius: 0.06,
            height: 0.04,
            position: [0, 0.8, 0],
          },
          ...[0, 1, 2].map((index) => ({
            kind: 'box',
            name: 'steering wheel spoke',
            length: 0.34,
            width: 0.018,
            height: 0.018,
            position: [0, 0.8, 0],
            rotation: [0, 0, (index * Math.PI * 2) / 3],
          })),
        ],
      },
      { prompt: 'generate a steering wheel' },
    )

    expect(result.artifact).toBeDefined()
    expect(result.artifact?.sourceTool).toBe('compose_primitive')
    expect(result.content).toContain('Created draft assembly')
    expect(result.content).not.toContain('vehicle requires')
    expect(result.content).not.toContain('vehicle visual quality')
  })

  test('accepts steering wheel primitive aliases emitted by repair turns', () => {
    const steeringWheelPrimitives = [
      {
        id: 'rim',
        primitive: 'torus',
        semanticRole: 'wheel_rim',
        axis: 'y',
        majorRadius: 0.175,
        tubeRadius: 0.015,
        position: [0, 0, 0],
      },
      {
        id: 'hub',
        kind: 'cylinder',
        semanticRole: 'center_hub',
        axis: 'y',
        radius: 0.06,
        height: 0.08,
        position: [0, 0, 0],
      },
      ...[0, 1, 2].map((index) => ({
        id: `spoke_${index}`,
        kind: 'capsule',
        semanticRole: 'spoke',
        axis: 'x',
        radius: 0.012,
        height: 0.115,
        position: [
          0.0875 * Math.cos((index * Math.PI * 2) / 3),
          0,
          0.0875 * Math.sin((index * Math.PI * 2) / 3),
        ],
      })),
    ]

    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief: '汽车方向盘：圆形轮圈、中心轮毂、三根辐条。',
        primitives: steeringWheelPrimitives,
      },
      {
        prompt: '生成一个汽车方向盘',
        blueprintCategory: 'automotive steering wheel',
        blueprintRequiredRoles: ['wheel_rim', 'center_hub', 'spoke'],
      },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Created draft assembly')
    expect(result.content).not.toContain('required semantic role "center_hub" is missing')
    expect(result.content).not.toContain('required semantic role "spoke" is missing')
  })

  test('recovers primitive-like compose_parts calls for unsupported single components', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        parts: [
          {
            id: 'rim',
            kind: 'torus',
            semanticRole: 'wheel_rim',
            axis: 'y',
            majorRadius: 0.175,
            tubeRadius: 0.015,
            position: [0, 0, 0],
          },
          {
            id: 'hub',
            kind: 'cylinder',
            semanticRole: 'center_hub',
            axis: 'y',
            radius: 0.06,
            height: 0.08,
            position: [0, 0, 0],
          },
          {
            id: 'spoke',
            kind: 'capsule',
            semanticRole: 'spoke',
            axis: 'x',
            radius: 0.012,
            height: 0.115,
            position: [0.0875, 0, 0],
          },
        ],
      },
      {
        prompt: '生成一个汽车方向盘',
        blueprintCategory: 'automotive steering wheel',
        blueprintRequiredRoles: ['wheel_rim', 'center_hub', 'spoke'],
      },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Created draft assembly')
    expect(result.content).not.toContain('No geometry could be created')
  })

  test('recovers simple cuboid requests when LLM emits a clamped generic body part', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief: '10x10x10 meter rectangular cuboid. requiredRoles: [enclosure]',
        parts: [
          {
            id: 'main_body',
            kind: 'generic_body',
            semanticRole: 'enclosure',
            params: { length: 10, width: 10, height: 10 },
          },
        ],
      },
      { prompt: 'create a 10x10 meter rectangular cuboid' },
    )

    expect(result.content).toContain('Created draft')
    expect(result.artifact?.shapes).toHaveLength(1)
    expect(result.artifact?.shapes[0]).toMatchObject({
      kind: 'box',
      semanticRole: 'enclosure',
      length: 10,
      width: 10,
      height: 10,
    })
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
    expect(result.artifact?.sourceArgs.family).toBe('aircraft')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'aircraft_fuselage', length: 10 }),
        expect.objectContaining({ kind: 'aircraft_wing' }),
        expect.objectContaining({ kind: 'aircraft_engine' }),
        expect.objectContaining({ kind: 'aircraft_vertical_stabilizer' }),
        expect.objectContaining({ kind: 'aircraft_horizontal_stabilizer' }),
        expect.objectContaining({ kind: 'aircraft_landing_gear' }),
      ]),
    )
    expect(fuselage?.scale?.[0]).toBeCloseTo(7.8)
    expect(roles.has('left_wing')).toBe(false)
    expect(roles.has('aircraft_wing')).toBe(true)
    expect(roles.has('aircraft_landing_gear_nose')).toBe(true)
    expect(roles.has('engine_nacelle_left')).toBe(true)
  })

  test('routes complete aircraft requests through registry-normalized parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'aircraft',
        name: 'six meter airliner',
        length: 6,
        primaryColor: '#f8fafc',
        parts: [
          {
            kind: 'aircraft_engine',
            params: { count: 4, radius: 0.08 },
          },
        ],
      },
      { prompt: 'generate a complete six meter airliner with four engines' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const engineShapes =
      result.artifact?.shapes.filter((shape) => shape.sourcePartKind === 'aircraft_engine') ?? []

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('aircraft')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'aircraft_fuselage',
          length: 6,
          primaryColor: '#f8fafc',
        }),
        expect.objectContaining({ kind: 'aircraft_engine', count: 4, radius: 0.08 }),
        expect.objectContaining({ kind: 'aircraft_landing_gear' }),
      ]),
    )
    expect(roles.has('aircraft_fuselage')).toBe(true)
    expect(roles.has('aircraft_wing')).toBe(true)
    expect(roles.has('vertical_stabilizer')).toBe(true)
    expect(roles.has('horizontal_stabilizer')).toBe(true)
    expect(engineShapes).toHaveLength(12)
    expect(result.content).toContain('Visual quality: family=aircraft')
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
        prompt: 'generate an 8 meter aircraft',
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
        prompt: 'generate an 8 meter aircraft',
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
      {
        prompt:
          '\u6ce5\u6d46\u6405\u62cc\u90e8\u4ef6\uff0c\u4e00\u6839\u6746\u5b50\uff0c\u4e0b\u9762\u4e09\u9762\u6868\u53f6',
      },
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
      { prompt: '\u751f\u6210\u4e00\u8f86\u7ea2\u8272\u5c0f\u8f7f\u8f66' },
    )

    expect(result.artifact).toBeUndefined()
    expect(result.content).toContain('Invalid geometry tool call')
    expect(result.content).toContain('vehicle visual quality score is too low')
    expect(result.content).toContain('vehicle needs a separate cabin/roof mass')
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
      { prompt: '\u751f\u6210\u4e00\u4e2a\u6b63\u786e\u7684\u81ea\u884c\u8f66\u6a21\u578b' },
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

  test('accepts LLM-style complete red bicycle calls with invented bicycle aliases', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief:
          'Complete red bicycle with frame, fork, two wheels, handlebar, seat, crank, chainring, pedals, and chain. Primary color red (#CC0000). Length approximately 2 meters.',
        parts: [
          { id: 'frame', kind: 'bicycle_frame', semanticRole: 'frame', dimensions: { length: 2 } },
          {
            id: 'fork',
            kind: 'bicycle_fork',
            semanticRole: 'fork',
            connectTo: 'frame',
            connectPoint: 'head_tube',
            dimensions: { length: 0.65 },
          },
          {
            id: 'wheel_front',
            kind: 'bicycle_wheel',
            semanticRole: 'wheel',
            axis: 'x',
            centeredOn: 'fork',
            connectPoint: 'dropout',
            dimensions: { radius: 0.35 },
          },
          {
            id: 'wheel_rear',
            kind: 'bicycle_wheel',
            semanticRole: 'wheel',
            axis: 'x',
            centeredOn: 'frame',
            connectPoint: 'rear_dropout',
            dimensions: { radius: 0.35 },
          },
          {
            id: 'handlebar',
            kind: 'bicycle_handlebar',
            semanticRole: 'handlebar',
            connectTo: 'fork',
            connectPoint: 'steerer',
          },
          {
            id: 'seat',
            kind: 'bicycle_seat',
            semanticRole: 'seat',
            connectTo: 'frame',
            connectPoint: 'seatpost',
          },
          {
            id: 'crank',
            kind: 'bicycle_crank',
            semanticRole: 'crank',
            connectTo: 'frame',
            connectPoint: 'bottom_bracket',
          },
          {
            id: 'chainring',
            kind: 'bicycle_chainring',
            semanticRole: 'chainring',
            centeredOn: 'crank',
          },
          {
            id: 'pedals',
            kind: 'bicycle_pedals',
            semanticRole: 'pedal',
            array: { count: 2, axis: 'x', spacing: 0.18 },
          },
          {
            id: 'chain',
            kind: 'bicycle_chain',
            semanticRole: 'chain',
            connectTo: 'chainring',
            connectPoint: 'sprocket',
          },
        ],
        requiredRoles: [
          'frame',
          'fork',
          'wheel',
          'handlebar',
          'seat',
          'crank',
          'chainring',
          'pedal',
          'chain',
        ],
        primaryColor: '#CC0000',
        length: 2,
      },
      {
        prompt: '生成一辆红色自行车',
        blueprintCategory: 'complete_bicycle',
        blueprintRequiredRoles: [
          'frame',
          'fork',
          'wheel_front',
          'wheel_rear',
          'handlebar',
          'seat',
          'crank',
          'chainring',
          'pedals',
          'chain',
        ],
      },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=bicycle')
    expect(result.content).not.toContain('bicycle requires bicycle_frame')
    expect(result.content).not.toContain('required semantic role "pedal" is missing')
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_tire'),
    ).toHaveLength(2)
    const bicycleTires = result.artifact?.shapes.filter(
      (shape) => shape.semanticRole === 'bicycle_tire',
    )
    expect(bicycleTires?.every((shape) => shape.axis === 'z')).toBe(true)
    expect(
      bicycleTires?.every((shape) => (shape.tubeRadius ?? 1) < (shape.majorRadius ?? 0) * 0.1),
    ).toBe(true)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(16)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'chainring')).toBe(true)
  })

  test('accepts bicycle handlebar and saddle semantic role aliases from repair calls', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief: {
          category: 'complete_bicycle',
          requiredRoles: [
            'bicycle_tire',
            'bicycle_frame',
            'bicycle_fork',
            'bicycle_handlebar',
            'bicycle_saddle',
            'chain_drive',
          ],
        },
        parts: [
          { id: 'wheels', kind: 'bicycle_wheels', semanticRole: 'bicycle_tire' },
          { id: 'frame', kind: 'bicycle_frame', semanticRole: 'bicycle_frame' },
          { id: 'fork', kind: 'bicycle_fork', semanticRole: 'bicycle_fork' },
          { id: 'handlebar', kind: 'bicycle_handlebar', semanticRole: 'bicycle_handlebar' },
          { id: 'saddle', kind: 'bicycle_seat', semanticRole: 'bicycle_saddle' },
          { id: 'chain', kind: 'bicycle_chain', semanticRole: 'chain_loop' },
        ],
      },
      {
        prompt: '\u751f\u6210\u4e00\u8f86\u5b8c\u6574\u7684\u81ea\u884c\u8f66',
        blueprintCategory: 'complete_bicycle',
        blueprintRequiredRoles: ['bicycle_handlebar', 'bicycle_saddle', 'chain_drive'],
      },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=bicycle')
    expect(result.content).not.toContain('bicycle requires handlebar')
    expect(result.content).not.toContain('bicycle requires saddle')
    expect(result.content).not.toContain('required semantic role "bicycle_handlebar" is missing')
    expect(result.content).not.toContain('required semantic role "bicycle_saddle" is missing')
    expect(result.content).not.toContain('required semantic role "chain_drive" is missing')
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'handlebar')).toBe(true)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'saddle')).toBe(true)
  })

  test('stabilizes complete bicycle layout when model emits relationship-heavy wheel_set parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        route: 'compose_parts',
        category: 'complete_bicycle',
        constraints: {
          length: 1.8,
          width: 0.5,
          height: 1,
          primaryColor: '#2563EB',
        },
        length: 1.8,
        width: 0.5,
        height: 1,
        primaryColor: '#2563EB',
        geometryBrief: {
          category: 'complete_bicycle',
          requiredRoles: [
            'bicycle_tire',
            'bicycle_frame',
            'bicycle_fork',
            'handlebar',
            'saddle',
            'chain_loop',
          ],
        },
        parts: [
          { id: 'rear_wheel', kind: 'wheel_set', semanticRole: 'bicycle_tire', radius: 0.35 },
          {
            id: 'front_wheel',
            kind: 'wheel_set',
            semanticRole: 'bicycle_tire',
            alignBeside: 'rear_wheel',
            side: 'front',
            radius: 0.35,
          },
          {
            id: 'frame',
            kind: 'tube_frame',
            semanticRole: 'bicycle_frame',
            alignAbove: 'rear_wheel',
          },
          {
            id: 'fork',
            kind: 'fork',
            semanticRole: 'bicycle_fork',
            connectTo: 'frame',
            connectPoint: 'head_tube',
          },
          {
            id: 'handlebar',
            kind: 'handlebar',
            semanticRole: 'handlebar',
            connectTo: 'fork',
            connectPoint: 'steerer_top',
          },
          {
            id: 'saddle',
            kind: 'saddle',
            semanticRole: 'saddle',
            connectTo: 'frame',
            connectPoint: 'seat_tube_top',
          },
          { id: 'chain', kind: 'chain_loop', semanticRole: 'chain_loop' },
        ],
        requiredRoles: [
          'bicycle_tire',
          'bicycle_frame',
          'bicycle_fork',
          'handlebar',
          'saddle',
          'chain_loop',
        ],
      },
      {
        prompt: '\u751f\u6210\u4e00\u8f86\u5b8c\u6574\u7684\u81ea\u884c\u8f66',
        blueprintCategory: 'complete_bicycle',
      },
    )

    expect(result.artifact).toBeDefined()
    expect(result.content).toContain('Validation: family=bicycle')
    const tires = result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_tire')
    expect(tires).toHaveLength(2)
    expect(tires?.every((shape) => shape.axis === 'z')).toBe(true)
    expect(tires?.every((shape) => (shape.tubeRadius ?? 1) < (shape.majorRadius ?? 0) * 0.1)).toBe(
      true,
    )
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(16)
    expect(tires?.[0]?.majorRadius).toBeCloseTo(0.32)
    expect(tires?.map((shape) => shape.position?.[0]).sort()).toEqual([
      -0.5800000000000001, 0.5800000000000001,
    ])
    expect(tires?.every((shape) => shape.position?.[1] === 0.32)).toBe(true)
    const tireTop = (tires?.[0]?.position?.[1] ?? 0) + (tires?.[0]?.majorRadius ?? 0)
    const topTube = result.artifact?.shapes.find((shape) => shape.name?.includes('top tube'))
    const handlebar = result.artifact?.shapes.find((shape) =>
      shape.name?.includes('handlebar crossbar'),
    )
    const saddle = result.artifact?.shapes.find((shape) => shape.name?.includes('saddle cushion'))
    expect(topTube?.position?.[1]).toBeGreaterThan(tireTop + 0.2)
    expect(handlebar?.position?.[1]).toBeGreaterThan(tireTop + 0.3)
    expect(saddle?.position?.[1]).toBeGreaterThan(tireTop + 0.28)
    expect(handlebar?.position?.[2]).toBe(0)
    expect(saddle?.position?.[2]).toBe(0)
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
        prompt: '\u751f\u6210\u4e00\u53f0\u71c3\u6c14\u673a',
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
    expect(result.artifact?.shapes.length).toBeLessThanOrEqual(36)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'vehicle_tire'),
    ).toHaveLength(4)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'wheel_hub'),
    ).toHaveLength(4)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'side_mirror')).toBe(true)
  })

  test('reroutes mistaken primitive car requests to compact vehicle assembly', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief: { category: 'sports equipment', requiredRoles: ['ball_surface'] },
        shapes: [{ kind: 'sphere', semanticRole: 'ball_surface', radius: 0.1 }],
      },
      { prompt: '生成一辆小汽车' },
    )

    expect(result.artifact?.sourceTool).toBe('compose_primitive')
    expect(result.content).toContain('Validation: family=vehicle')
    expect(result.artifact?.geometryBrief?.category).toBe('vehicle')
    expect(result.artifact?.shapes.length).toBeLessThanOrEqual(36)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'ball_surface')).toBe(
      false,
    )
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'wheel_hub')).toBe(true)
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
      { prompt: '\u751f\u6210\u4e00\u6761\u8f93\u9001\u5e26' },
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

  test('routes robot welding cell compose_parts requests through robot arm fallback', () => {
    const armOnly = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'robot_arm',
        name: 'six axis robot arm',
        includeWorkcell: false,
        height: 2.2,
      },
      {
        prompt:
          'generate a six-axis industrial robot arm with base, shoulder, upper arm, elbow, forearm, wrist, and tool flange only',
      },
    )
    const armOnlyRoles = new Set(armOnly.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(armOnly.artifact?.sourceArgs).toMatchObject({
      family: 'robot_arm',
      axisCount: 6,
      includeWorkcell: false,
      sourceStrategy: 'robot_arm_only_fallback',
    })
    expect(armOnly.artifact?.shapes.length).toBeLessThanOrEqual(14)
    expect(armOnlyRoles.has('robot_base')).toBe(true)
    expect(armOnlyRoles.has('shoulder_joint')).toBe(true)
    expect(armOnlyRoles.has('upper_arm')).toBe(true)
    expect(armOnlyRoles.has('elbow_joint')).toBe(true)
    expect(armOnlyRoles.has('forearm')).toBe(true)
    expect(armOnlyRoles.has('wrist_roll_joint')).toBe(true)
    expect(armOnlyRoles.has('wrist_pitch_joint')).toBe(true)
    expect(armOnlyRoles.has('wrist_joint')).toBe(true)
    expect(armOnlyRoles.has('tool_flange')).toBe(true)
    expect(armOnlyRoles.has('work_table')).toBe(false)
    expect(armOnlyRoles.has('control_panel')).toBe(false)
    expect(armOnlyRoles.has('safety_barrier')).toBe(false)

    const result = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'robot_arm',
        name: 'robot welding cell',
        length: 2.2,
        width: 1.6,
        height: 1.8,
        parts: [
          { kind: 'generic_base', semanticRole: 'robot_base_plate' },
          { kind: 'generic_body', semanticRole: 'robot_upper_arm' },
          { kind: 'generic_body', semanticRole: 'robot_forearm' },
          { kind: 'generic_panel', semanticRole: 'work_table_top' },
          { kind: 'control_box', semanticRole: 'control_cabinet_body' },
        ],
      },
      {
        prompt:
          'generate an industrial robot welding cell with upper arm, forearm, wrist, work table, control cabinet and safety barrier',
      },
    )
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.content).toContain('Created draft assembly')
    expect(result.artifact?.sourceArgs.family).toBe('robot_arm')
    expect(result.artifact?.sourceArgs.sourceStrategy).toBe('robot_arm_workstation_fallback')
    expect(result.artifact?.geometryBrief?.category).toBe('robot_arm')
    expect(roles.has('robot_base')).toBe(true)
    expect(roles.has('upper_arm')).toBe(true)
    expect(roles.has('forearm')).toBe(true)
    expect(roles.has('wrist_joint')).toBe(true)
    expect(roles.has('end_effector')).toBe(true)
    expect(roles.has('work_table')).toBe(true)
    expect(roles.has('control_panel')).toBe(true)
    expect(roles.has('safety_barrier')).toBe(true)
  })

  test('uses robotics resource-pack profile metadata for six-axis robot arms', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        deviceProfile: 'robotics.six_axis_industrial_robot_arm',
        family: 'robot_arm',
        name: 'six-axis industrial robot arm',
      },
      {
        prompt: 'generate a six-axis industrial robot arm only, no work table or guard rail',
        deviceProfiles: [
          {
            id: 'robotics.six_axis_industrial_robot_arm',
            name: 'Six-axis industrial robot arm',
            aliases: ['six-axis industrial robot arm', 'robot arm'],
            industry: 'robotics',
            family: 'robot_arm',
            layoutFamily: 'robot_workcell_layout',
            layoutTemplate: 'articulated_robot.six_axis',
            archetypeFamily: 'robotic_workcell',
            defaultDimensions: { length: 2.2, width: 1.2, height: 2.2 },
            primarySemanticRole: 'robot_base',
            status: 'stable',
            source: 'imported_pack',
            sourcePack: { id: 'industry.robotics.basic', version: '0.1.0' },
            layoutHints: {
              robotArmDefaults: {
                axisCount: 6,
                includeWorkcell: false,
                reach: 1.58,
                primaryColor: '#facc15',
                secondaryColor: '#111827',
              },
              layoutTemplate: { id: 'articulated_robot.six_axis' },
            },
            qualityRules: {
              id: 'quality.robot_arm.six_axis',
              requiredRoles: [
                'robot_base',
                'base_joint',
                'shoulder_joint',
                'upper_arm',
                'elbow_joint',
                'forearm',
                'wrist_joint',
                'tool_flange',
                'end_effector',
              ],
              forbiddenRoles: ['work_table', 'control_panel', 'safety_barrier'],
              shapeCount: { min: 9, max: 28 },
            },
            parts: [
              { kind: 'generic_base', semanticRole: 'robot_base', required: true },
              { kind: 'generic_body', semanticRole: 'base_joint', required: true },
              { kind: 'generic_body', semanticRole: 'shoulder_joint', required: true },
              { kind: 'generic_body', semanticRole: 'upper_arm', required: true },
              { kind: 'generic_body', semanticRole: 'elbow_joint', required: true },
              { kind: 'generic_body', semanticRole: 'forearm', required: true },
              { kind: 'generic_panel', semanticRole: 'wrist_joint', required: true },
              { kind: 'generic_panel', semanticRole: 'tool_flange', required: true },
              { kind: 'generic_panel', semanticRole: 'end_effector', required: true },
            ],
            roleAliases: {
              wrist_joint: ['wrist_roll_joint', 'wrist_pitch_joint', 'wrist_yaw_joint'],
              tool_flange: ['flange', 'end_effector'],
            },
            description: 'Resource-pack robot arm profile.',
          },
        ],
      },
    )
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact?.sourceArgs).toMatchObject({
      deviceProfile: 'robotics.six_axis_industrial_robot_arm',
      profilePackId: 'industry.robotics.basic',
      layoutTemplate: 'articulated_robot.six_axis',
      sourceStrategy: 'robot_arm_only_fallback',
      axisCount: 6,
      qualityRules: { id: 'quality.robot_arm.six_axis' },
    })
    expect(result.artifact?.geometryBrief?.category).toBe('robot_arm')
    expect(roles.has('robot_base')).toBe(true)
    expect(roles.has('shoulder_joint')).toBe(true)
    expect(roles.has('upper_arm')).toBe(true)
    expect(roles.has('forearm')).toBe(true)
    expect(roles.has('work_table')).toBe(false)
    expect(roles.has('control_panel')).toBe(false)
    expect(roles.has('safety_barrier')).toBe(false)
  })

  test('routes palletizer device profiles through robot workcell fallback', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      { name: 'robot palletizer cell' },
      {
        prompt: 'make a robot palletizer cell with pallet table, control cabinet and safety fence',
      },
    )
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs).toMatchObject({
      family: 'robot_arm',
      deviceProfile: 'palletizer_cell',
      archetypeFamily: 'robotic_workcell',
      sourceStrategy: 'robot_arm_workstation_fallback',
    })
    expect(roles.has('robot_base')).toBe(true)
    expect(roles.has('upper_arm')).toBe(true)
    expect(roles.has('forearm')).toBe(true)
    expect(roles.has('work_table')).toBe(true)
    expect(roles.has('control_panel')).toBe(true)
    expect(roles.has('safety_barrier')).toBe(true)
    expect(result.artifact?.profileQuality?.overallScore).toBeGreaterThan(0.7)
  })

  test('reports stable profile-aware quality scores for key industrial devices', () => {
    const cases = [
      {
        name: 'screw compressor',
        prompt: 'make a skid mounted screw compressor package with casing, motor and ports',
        profile: 'screw_compressor',
      },
      {
        name: 'packaging machine',
        prompt: 'make an automatic packaging machine with enclosure, feed chute and operator panel',
        profile: 'packaging_machine',
      },
      {
        name: 'shell and tube heat exchanger',
        prompt: 'make a shell and tube heat exchanger with channel heads and skid supports',
        profile: 'shell_tube_heat_exchanger',
      },
      {
        name: 'robot palletizer cell',
        prompt: 'make a robot palletizer cell with pallet table, control cabinet and safety fence',
        profile: 'palletizer_cell',
      },
    ]

    for (const testCase of cases) {
      const result = executeGeometryToolCall(
        'compose_parts',
        { name: testCase.name },
        { prompt: testCase.prompt },
      )

      expect(result.artifact?.sourceArgs.deviceProfile).toBe(testCase.profile)
      const quality = result.artifact?.profileQuality
      expect(quality, testCase.name).toBeDefined()
      if (!quality) throw new Error(`Missing profile quality for ${testCase.name}`)
      expect(typeof quality.semanticScore).toBe('number')
      expect(typeof quality.geometryScore).toBe('number')
      expect(typeof quality.editabilityScore).toBe('number')
      expect(typeof quality.visualCompletenessScore).toBe('number')
      expect(typeof quality.overallScore).toBe('number')
      expect(quality.overallScore).toBeGreaterThan(0.55)
      expect(result.content).toContain('Profile quality:')
    }
  })

  test('redirects legacy outdoor AC recipe aliases to assembly and rejects object aliases', () => {
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

    expect(object.artifact).toBeUndefined()
    expect(object.content).toContain('Unknown tool: compose_object')
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

  test('uses freeform assembly fallback for unknown object families', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      { name: 'futuristic coffee machine' },
      { prompt: 'make a futuristic coffee machine with a spout and cup platform' },
    )

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('generic')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'generic_body', semanticRole: 'main_body' }),
        expect.objectContaining({ kind: 'generic_control_panel', semanticRole: 'control_detail' }),
        expect.objectContaining({ kind: 'generic_spout', semanticRole: 'spout' }),
        expect.objectContaining({ kind: 'generic_base', semanticRole: 'cup_platform' }),
      ]),
    )
    expect(result.artifact?.geometryBrief?.assumptions).toEqual(
      expect.arrayContaining([
        'freeform assembly fallback because no dedicated recipe, assembly family, or reusable part matched',
      ]),
    )
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'spout')).toBe(true)
    expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'cup_platform')).toBe(
      true,
    )
  })

  test('reroutes generic inspection platform output through the precision platform ladder part', () => {
    const noPartResult = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'industrial inspection platform ladder',
        family: 'bicycle',
      },
      {
        prompt:
          'generate an industrial inspection platform ladder with guard rails, side rails, and rungs',
      },
    )
    expect(noPartResult.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'platform_ladder' })]),
    )

    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'industrial inspection platform ladder',
        family: 'bicycle',
        deviceProfileDraft: {
          id: 'wrong_platform_draft',
          family: 'vehicle',
          layoutFamily: 'vehicle_layout',
        },
        parts: [
          { kind: 'generic_panel', semanticRole: 'platform_floor', length: 2.4, width: 0.8 },
          { kind: 'generic_foot_set', semanticRole: 'support_column', count: 4 },
          { kind: 'generic_body', semanticRole: 'ladder_rail' },
        ],
      },
      {
        prompt:
          'generate an industrial inspection platform ladder with guard rails, side rails, and rungs',
      },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'platform_ladder' })]),
    )
    expect(roles.has('access_platform')).toBe(true)
    expect(roles.has('guard_rail')).toBe(true)
    expect(roles.has('ladder_side_rail')).toBe(true)
    expect(roles.has('ladder_rung')).toBe(true)
    expect(result.artifact?.shapes.some((shape) => shape.sourcePartKind === 'generic_panel')).toBe(
      false,
    )
  })

  test('reroutes mixed pressure tank output through the precision cylindrical tank part', () => {
    const noPartResult = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'horizontal pressure storage tank',
        family: 'machine_tool',
      },
      {
        prompt:
          'generate a horizontal pressure storage tank with hollow cylindrical shell, dished heads, top nozzle, manway flange, and saddle supports',
      },
    )
    expect(noPartResult.artifact?.sourceArgs.family).toBe('tank')
    expect(noPartResult.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'cylindrical_tank' })]),
    )

    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'horizontal pressure storage tank',
        family: 'reactor',
        deviceProfileDraft: {
          id: 'wrong_pressure_tank_draft',
          family: 'reactor',
          layoutFamily: 'vessel_layout',
        },
        parts: [
          { kind: 'cylindrical_tank', semanticRole: 'cylindrical_shell' },
          { kind: 'ribbed_motor_body', semanticRole: 'ribbed_motor_body' },
          { kind: 'volute_casing', semanticRole: 'volute_casing' },
        ],
      },
      {
        prompt:
          'generate a horizontal pressure storage tank with hollow cylindrical shell, dished heads, top nozzle, manway flange, and saddle supports',
      },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('tank')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'cylindrical_tank' })]),
    )
    expect(roles.has('vessel_shell')).toBe(true)
    expect(roles.has('vessel_head')).toBe(true)
    expect(roles.has('top_nozzle')).toBe(true)
    expect(roles.has('saddle_support')).toBe(true)
    expect(roles.has('volute_casing')).toBe(false)
  })

  test('routes desk requests without explicit parts through registry-normalized parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      { name: 'office desk with drawers', length: 1.4, width: 0.7, height: 0.75 },
      { prompt: 'make an office desk with drawers' },
    )

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('desk')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'desk_top', semanticRole: 'furniture_body' }),
        expect.objectContaining({ kind: 'leg_set', semanticRole: 'support_leg' }),
        expect.objectContaining({ kind: 'drawer_stack', semanticRole: 'drawer_stack' }),
      ]),
    )
    expect(result.artifact?.shapes.some((shape) => shape.name?.includes('desk top'))).toBe(true)
    expect(result.artifact?.shapes.some((shape) => shape.name?.includes('drawer front'))).toBe(true)
  })

  test('routes small kiosk requests through dedicated family parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'small ticket booth with service window',
        length: 2,
        width: 1.4,
        height: 2.4,
        primaryColor: '#e5e7eb',
        accentColor: '#facc15',
      },
      { prompt: 'make a small ticket booth with a service window, counter, sign, and awning' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('kiosk')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'kiosk_body', semanticRole: 'kiosk_body' }),
        expect.objectContaining({ kind: 'kiosk_roof', semanticRole: 'roof' }),
        expect.objectContaining({ kind: 'kiosk_opening', semanticRole: 'opening' }),
        expect.objectContaining({ kind: 'kiosk_sign', semanticRole: 'sign_panel' }),
        expect.objectContaining({ kind: 'kiosk_awning', semanticRole: 'awning' }),
      ]),
    )
    expect(roles.has('kiosk_body')).toBe(true)
    expect(roles.has('roof')).toBe(true)
    expect(roles.has('opening')).toBe(true)
    expect(roles.has('sign_panel')).toBe(true)
    expect(roles.has('awning')).toBe(true)
    expect(roles.has('main_body')).toBe(false)
  })

  test('routes pump requests without explicit parts through industrial family parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'centrifugal pump',
        length: 1.4,
        width: 0.6,
        height: 0.7,
        primaryColor: '#64748b',
      },
      { prompt: 'make a centrifugal pump with inlet and outlet flanges' },
    )
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('pump')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skid_base', semanticRole: 'support_base' }),
        expect.objectContaining({ kind: 'ribbed_motor_body', semanticRole: 'drive_motor' }),
        expect.objectContaining({ kind: 'volute_casing', semanticRole: 'volute_casing' }),
        expect.objectContaining({ kind: 'inlet_port', semanticRole: 'inlet_port' }),
        expect.objectContaining({ kind: 'outlet_port', semanticRole: 'outlet_port' }),
      ]),
    )
    expect(roles.has('volute_casing')).toBe(true)
    expect(roles.has('inlet_port')).toBe(true)
    expect(roles.has('outlet_port')).toBe(true)
    expect(roles.has('rounded_machine_body')).toBe(false)
  })

  test('routes conveyor requests without explicit parts through industrial family parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      { name: 'warehouse belt conveyor', length: 4, width: 0.8, height: 0.9 },
      { prompt: 'make a warehouse belt conveyor with rollers and drive motor' },
    )
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('conveyor')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'conveyor_frame', semanticRole: 'conveyor_frame' }),
        expect.objectContaining({ kind: 'roller_array', semanticRole: 'roller_array' }),
        expect.objectContaining({ kind: 'belt_surface', semanticRole: 'belt_surface' }),
      ]),
    )
    expect(roles.has('conveyor_frame')).toBe(true)
    expect(roles.has('roller_array')).toBe(true)
    expect(roles.has('belt_surface')).toBe(true)
  })

  test('routes device profiles through reusable industrial families', () => {
    const compressor = executeGeometryToolCall(
      'compose_parts',
      { name: 'screw compressor skid package' },
      { prompt: 'make a skid mounted screw compressor package with inlet, outlet and control box' },
    )
    const compressorRoles = new Set(compressor.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(compressor.artifact?.sourceTool).toBe('compose_parts')
    expect(compressor.artifact?.sourceArgs).toMatchObject({
      family: 'compressor',
      deviceProfile: 'screw_compressor',
      archetypeFamily: 'rotating_fluid_machine',
    })
    expect(compressorRoles.has('compressor_casing')).toBe(true)
    expect(compressorRoles.has('motor_body')).toBe(true)
    expect(compressorRoles.has('control_box')).toBe(true)

    const packaging = executeGeometryToolCall(
      'compose_parts',
      { name: 'automatic packaging machine' },
      { prompt: 'make a packaging machine with feed chute, discharge chute and control panel' },
    )
    const packagingRoles = new Set(packaging.artifact?.shapes.map((shape) => shape.semanticRole))

    expect(packaging.artifact?.sourceTool).toBe('compose_parts')
    expect(packaging.artifact?.sourceArgs).toMatchObject({
      family: 'machine_tool',
      deviceProfile: 'packaging_machine',
      archetypeFamily: 'enclosed_machine',
    })
    expect(packagingRoles.has('machine_enclosure')).toBe(true)
    expect(packagingRoles.has('feed_chute')).toBe(true)
    expect(packagingRoles.has('discharge_chute')).toBe(true)
    expect(packagingRoles.has('control_panel')).toBe(true)
    expect(packagingRoles.has('display_screen')).toBe(true)
  })

  test('applies resource-pack layout templates and part presets to profile parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        deviceProfile: 'pack.template_machine',
        family: 'machine_tool',
      },
      {
        prompt: 'generate a template machine from resource pack',
        deviceProfiles: [
          {
            id: 'pack.template_machine',
            name: 'Template machine',
            aliases: ['template machine'],
            family: 'machine_tool',
            layoutFamily: 'box_enclosure_layout',
            layoutTemplate: 'layout.template_machine',
            archetypeFamily: 'enclosed_machine',
            defaultDimensions: { length: 2, width: 1, height: 1.2 },
            primarySemanticRole: 'machine_enclosure',
            status: 'stable',
            source: 'imported_pack',
            sourcePack: { id: 'industry.test.templates', version: '1.0.0' },
            partPresets: {
              machine_enclosure: 'preset.machine_body',
              control_panel: 'preset.control_panel',
            },
            resolvedPartPresets: {
              'preset.machine_body': {
                id: 'preset.machine_body',
                defaults: { length: 1.4, width: 0.7, height: 0.8, primaryColor: '#2563eb' },
              },
              'preset.control_panel': {
                id: 'preset.control_panel',
                parameters: {
                  width: { from: 'width', scale: 0.24 },
                  height: { from: 'height', scale: 0.3 },
                },
              },
            },
            layoutHints: {
              layoutTemplate: {
                id: 'layout.template_machine',
                placements: [
                  { role: 'machine_enclosure', position: [0, 0.55, 0] },
                  { role: 'control_panel', position: [0.78, 0.62, 0.54] },
                ],
              },
            },
            parts: [
              { kind: 'generic_body', semanticRole: 'machine_enclosure', required: true },
              { kind: 'control_box', semanticRole: 'control_panel', required: true },
            ],
            description: 'Template machine profile backed by resource-pack knowledge.',
          },
        ],
      },
    )

    const parts = sourceParts(result.artifact?.sourceArgs.parts)
    const body = parts.find((part) => part.kind === 'generic_body')
    const panel = parts.find((part) => part.kind === 'control_box')

    expect(result.artifact).toBeDefined()
    expect(body).toMatchObject({
      position: [0, 0.55, 0],
      length: 1.4,
      width: 0.7,
      height: 0.8,
      primaryColor: '#2563eb',
    })
    expect(panel).toMatchObject({
      position: [0.78, 0.62, 0.54],
      width: 0.24,
      height: 0.36,
    })
    expect(result.artifact?.sourceArgs).toMatchObject({
      profilePackId: 'industry.test.templates',
      layoutTemplate: 'layout.template_machine',
    })
  })

  test('builds draft profiles for unknown industrial equipment before generic fallback', () => {
    const cases = [
      {
        name: 'freeze dryer',
        prompt: 'make a freeze dryer with sealed chamber, vacuum port and control panel',
        profile: 'freeze_dryer_draft',
        family: 'generic',
        primary: 'vacuum_chamber',
      },
      {
        name: 'plate filter press',
        prompt: 'make a plate and frame filter press with plate stack and slurry inlet',
        profile: 'filter_press_draft',
        family: 'generic',
        primary: 'press_frame',
      },
      {
        name: 'screw conveyor',
        prompt: 'make a screw conveyor with trough, auger flight and drive motor',
        profile: 'screw_conveyor_draft',
        family: 'conveyor',
        primary: 'conveyor_frame',
      },
    ]

    for (const testCase of cases) {
      const result = executeGeometryToolCall(
        'compose_parts',
        { name: testCase.name },
        { prompt: testCase.prompt },
      )
      const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

      expect(result.artifact?.sourceTool).toBe('compose_parts')
      expect(result.artifact?.sourceArgs).toMatchObject({
        family: testCase.family,
        deviceProfile: testCase.profile,
        profileSource: 'generated_candidate',
        primarySemanticRole: testCase.primary,
      })
      expect(result.artifact?.sourceArgs.deviceProfileValidation).toMatchObject({
        ok: true,
      })
      expect(roles.has(testCase.primary)).toBe(true)
    }
  })

  test('falls back to generic industrial parts when an unsafe draft is supplied', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'unsafe draft machine',
        deviceProfileDraft: {
          id: 'unsafe_draft',
          name: 'Unsafe Draft',
          family: 'machine_tool',
          parts: [{ kind: 'not_a_real_part', semanticRole: 'main_body', required: true }],
          primarySemanticRole: 'main_body',
        },
      },
      { prompt: 'make an unsafe draft industrial machine' },
    )

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('generic')
    expect(result.artifact?.sourceArgs.profileFallbackReason).toBe('profile_validation_failed')
    expect(result.artifact?.shapes.length).toBeGreaterThan(0)
  })

  test('prefers loaded device profiles over model-authored drafts for known equipment', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'vga cart',
        deviceProfileDraft: {
          id: 'vga_cart_runtime',
          name: 'VGA cart runtime draft',
          family: 'generic',
          layoutFamily: 'generic_industrial_layout',
          primarySemanticRole: 'cart_body',
          parts: [
            { kind: 'generic_body', semanticRole: 'cart_body', required: true },
            { kind: 'wheel_set', semanticRole: 'wheel', required: true },
          ],
        },
      },
      {
        prompt: 'create a vga cart',
        deviceProfiles: [
          {
            id: 'agv_material_cart',
            name: 'AGV material cart',
            aliases: ['vga cart', 'agv小车', '自动搬运车'],
            layoutFamily: 'generic_industrial_layout',
            archetypeFamily: 'material_handling',
            family: 'generic',
            defaultDimensions: { length: 1.45, width: 0.9, height: 0.48 },
            parts: [
              { kind: 'mobile_platform_chassis', semanticRole: 'vehicle_body', required: true },
              { kind: 'wheel_set', semanticRole: 'drive_wheel', required: true },
              { kind: 'bar_pair', semanticRole: 'safety_bumper', required: true },
              { kind: 'lidar_sensor', semanticRole: 'front_navigation_sensor', required: true },
              { kind: 'lidar_sensor', semanticRole: 'rear_navigation_sensor', required: true },
              {
                kind: 'status_light_strip',
                semanticRole: 'left_status_light_strip',
                required: true,
              },
              {
                kind: 'status_light_strip',
                semanticRole: 'right_status_light_strip',
                required: true,
              },
              {
                kind: 'emergency_stop_button',
                semanticRole: 'emergency_stop_button',
                required: true,
              },
            ],
            primarySemanticRole: 'vehicle_body',
            qualityRules: {
              requiredRoles: [
                'vehicle_body',
                'cargo_platform',
                'drive_wheel',
                'safety_bumper',
                'front_navigation_sensor',
                'left_status_light_strip',
                'emergency_stop_button',
              ],
              forbiddenRoles: ['vehicle_cabin', 'vehicle_window', 'headlight', 'vehicle_roof'],
              shapeCount: { min: 12, max: 40 },
            },
            status: 'stable',
            source: 'workspace',
            description: 'Factory AGV cart.',
          },
        ],
      },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    expect(result.artifact?.sourceArgs).toMatchObject({
      deviceProfile: 'agv_material_cart',
      profileSource: 'workspace',
      primarySemanticRole: 'vehicle_body',
    })
    expect(roles.has('vehicle_body')).toBe(true)
    expect(roles.has('front_navigation_sensor')).toBe(true)
    expect(roles.has('left_status_light_strip')).toBe(true)
    expect(roles.has('emergency_stop_button')).toBe(true)
    expect(roles.has('vehicle_window')).toBe(false)
    expect(roles.has('vehicle_cabin')).toBe(false)
    expect(roles.has('cart_body')).toBe(false)
  })

  test('executes explicit draft profiles whose family is an abstract layout group', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        name: 'plate frame filter press',
        deviceProfileDraft: {
          id: 'plate_frame_filter_press_runtime',
          name: 'Plate frame filter press',
          family: 'material_handling',
          layoutFamily: 'linear_transport_layout',
          primarySemanticRole: 'filter_plate_stack',
          parts: [
            { kind: 'generic_body', semanticRole: 'press_frame_end_plate', required: true },
            { kind: 'conveyor_frame', semanticRole: 'press_frame_rails', required: true },
            { kind: 'generic_body', semanticRole: 'filter_plate_stack', required: true },
            { kind: 'generic_base', semanticRole: 'support_legs', required: true },
            { kind: 'generic_spout', semanticRole: 'feed_inlet', required: true },
            { kind: 'generic_spout', semanticRole: 'filtrate_outlet', required: true },
            { kind: 'generic_body', semanticRole: 'hydraulic_closure', required: true },
            { kind: 'control_box', semanticRole: 'control_box', required: true },
          ],
        },
      },
      { prompt: 'make a plate frame filter press with filter plate stack and hydraulic closure' },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs).toMatchObject({
      family: 'conveyor',
      deviceProfile: 'plate_frame_filter_press_runtime',
      profileSource: 'generated_candidate',
      layoutFamily: 'linear_transport_layout',
      primarySemanticRole: 'filter_plate_stack',
    })
    expect(result.artifact?.profileQuality?.overallScore).toBeGreaterThan(0.7)
    expect(roles.has('filter_plate_stack')).toBe(true)
    expect(roles.has('roller_array')).toBe(false)
    expect(roles.has('belt_surface')).toBe(false)
  })

  test('uses generic draft profile context to prevent compose_primitive vehicle misclassification', () => {
    const result = executeGeometryToolCall(
      'compose_primitive',
      {
        deviceProfileDraft: {
          id: 'main_battle_tank_runtime',
          name: 'Main battle tank',
          family: 'generic',
          layoutFamily: 'generic_industrial_layout',
          primarySemanticRole: 'hull_body',
          parts: [
            { kind: 'generic_body', semanticRole: 'hull_body', required: true },
            { kind: 'generic_base', semanticRole: 'track_assembly', required: true },
            { kind: 'generic_body', semanticRole: 'turret_base', required: true },
            { kind: 'generic_spout', semanticRole: 'gun_barrel', required: true },
          ],
        },
        shapes: [
          {
            kind: 'box',
            name: 'armored hull',
            semanticRole: 'hull_body',
            sourcePartKind: 'generic_body',
            position: [0, 0.55, 0],
            length: 2.4,
            width: 1.1,
            height: 0.55,
          },
          {
            kind: 'box',
            name: 'left track',
            semanticRole: 'track_assembly',
            sourcePartKind: 'generic_base',
            position: [0, 0.2, -0.65],
            length: 2.6,
            width: 0.22,
            height: 0.32,
          },
          {
            kind: 'box',
            name: 'right track',
            semanticRole: 'track_assembly',
            sourcePartKind: 'generic_base',
            position: [0, 0.2, 0.65],
            length: 2.6,
            width: 0.22,
            height: 0.32,
          },
          {
            kind: 'cylinder',
            name: 'turret',
            semanticRole: 'turret_base',
            sourcePartKind: 'generic_body',
            position: [0.2, 0.95, 0],
            radius: 0.42,
            height: 0.25,
          },
          {
            kind: 'cylinder',
            name: 'barrel',
            semanticRole: 'gun_barrel',
            sourcePartKind: 'generic_spout',
            position: [1.05, 0.98, 0],
            rotation: [0, 0, Math.PI / 2],
            radius: 0.045,
            height: 1.3,
          },
        ],
      },
      { prompt: '生成一个坦克' },
    )

    expect(result.artifact?.sourceTool).toBe('compose_primitive')
    expect(result.artifact?.sourceArgs).toMatchObject({
      family: 'generic',
      deviceProfile: 'main_battle_tank_runtime',
      layoutFamily: 'generic_industrial_layout',
    })
    expect(result.artifact?.semanticSummary).not.toContain('family=vehicle')
    expect(result.artifact?.profileQuality?.overallScore).toBeGreaterThan(0.7)
  })

  test('routes process equipment requests through dedicated industrial part families', () => {
    const cases: Array<{
      label: string
      args: Record<string, unknown>
      prompt: string
      family: string
      sourceParts: string[]
      roles: string[]
    }> = [
      {
        label: 'storage tank',
        args: {
          family: 'tank',
          name: 'storage tank with platform',
          height: 3,
          diameter: 1.2,
          parts: [{ kind: 'platform' }],
        },
        prompt: 'make a vertical storage tank with an access platform',
        family: 'tank',
        sourceParts: ['cylindrical_tank', 'platform_ladder'],
        roles: ['vessel_shell', 'vessel_head', 'inlet_port', 'access_platform'],
      },
      {
        label: 'stirred reactor',
        args: { family: 'reactor', name: 'stirred reactor', vesselHeight: 2, diameter: 1.1 },
        prompt: 'make a stirred reactor with agitator and nozzles',
        family: 'reactor',
        sourceParts: ['agitator_tank', 'inlet_port', 'outlet_port'],
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
        label: 'compressor',
        args: {
          family: 'compressor',
          name: 'skid air compressor',
          length: 2,
          width: 0.8,
          height: 0.8,
          portDiameter: 0.18,
        },
        prompt: 'make a skid mounted air compressor',
        family: 'compressor',
        sourceParts: [
          'skid_base',
          'ribbed_motor_body',
          'rounded_machine_body',
          'inlet_port',
          'outlet_port',
        ],
        roles: ['machine_base', 'motor_body', 'compressor_casing', 'inlet_port', 'outlet_port'],
      },
      {
        label: 'heat exchanger',
        args: {
          family: 'heat_exchanger',
          name: 'shell and tube heat exchanger with support',
          length: 2.4,
          diameter: 0.5,
          parts: [{ kind: 'support' }],
        },
        prompt: 'make a shell and tube heat exchanger with saddle supports',
        family: 'heat_exchanger',
        sourceParts: ['heat_exchanger', 'skid_base'],
        roles: [
          'heat_exchanger_shell',
          'heat_exchanger_channel_head',
          'inlet_port',
          'outlet_port',
          'support_base',
        ],
      },
      {
        label: 'cnc machine tool',
        args: {
          family: 'machine_tool',
          name: 'cnc machining center',
          length: 2.8,
          width: 1.1,
          height: 1.7,
        },
        prompt: 'make a cnc machining center',
        family: 'machine_tool',
        sourceParts: ['generic_base', 'generic_body', 'generic_panel', 'control_box'],
        roles: ['machine_base', 'machine_enclosure', 'spindle_head', 'control_panel'],
      },
    ]

    for (const testCase of cases) {
      const result = executeGeometryToolCall('compose_parts', testCase.args, {
        prompt: testCase.prompt,
      })
      const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))

      expect(result.artifact?.sourceTool).toBe('compose_parts')
      expect(result.artifact?.sourceArgs.family).toBe(testCase.family)
      expect(result.artifact?.sourceArgs.parts).toEqual(
        expect.arrayContaining(
          testCase.sourceParts.map((kind) => expect.objectContaining({ kind })),
        ),
      )
      for (const role of testCase.roles) expect(roles.has(role)).toBe(true)
    }
  })

  test('maps industrial family attributes into concrete parts for later revisions', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'pump',
        name: 'adjustable centrifugal pump',
        length: 1.6,
        width: 0.68,
        height: 0.72,
        motorLength: 0.7,
        inletDiameter: 0.2,
        outletDiameter: 0.14,
        flangeBoltCount: 12,
        parts: [{ kind: 'flange' }],
      },
      { prompt: 'make a centrifugal pump with large inlet flange and 12 flange bolts' },
    )

    expect(result.artifact?.sourceTool).toBe('compose_parts')
    expect(result.artifact?.sourceArgs.family).toBe('pump')
    expect(result.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ribbed_motor_body', length: 0.7 }),
        expect.objectContaining({ kind: 'inlet_port', radius: 0.1 }),
        expect.objectContaining({ kind: 'outlet_port', radius: 0.07 }),
        expect.objectContaining({ kind: 'flange_ring', boltCount: 12 }),
      ]),
    )
    expect(
      result.artifact?.shapes.some((shape) => shape.sourcePartKind === 'ribbed_motor_body'),
    ).toBe(true)
  })

  test('resizes an industrial part by sourcePartKind without replacing the object', () => {
    const initial = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'conveyor',
        name: 'revision-ready conveyor',
        length: 4,
        width: 0.8,
        height: 0.9,
        beltWidth: 0.62,
        rollerCount: 12,
      },
      { prompt: 'make a belt conveyor' },
    )

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: initial.artifact?.id,
        feedback: 'make only the belt wider',
        intent: 'widen the belt surface while preserving the conveyor frame and rollers',
        operations: [{ op: 'resize', selector: { sourcePartKind: 'belt_surface' }, width: 0.72 }],
      },
      {
        prompt: 'make only the belt wider',
        revisionOf: initial.artifact?.id,
        revisionVersion: initial.artifact?.version,
        revisionTarget: initial.artifact,
      },
    )

    const belt = revised.artifact?.shapes.find((shape) => shape.sourcePartKind === 'belt_surface')
    const frame = revised.artifact?.shapes.find(
      (shape) => shape.sourcePartKind === 'conveyor_frame',
    )

    expect(revised.artifact?.sourceTool).toBe('revise_geometry')
    expect(revised.artifact?.shapes).toHaveLength(initial.artifact?.shapes.length ?? 0)
    expect(belt?.width).toBe(0.72)
    expect(frame?.width).not.toBe(0.72)
  })

  test('infers industrial resize revisions from follow-up text without LLM-authored operations', () => {
    const initial = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'pump',
        name: 'editable pump',
        length: 1.4,
        width: 0.6,
        height: 0.7,
      },
      { prompt: 'make a centrifugal pump' },
    )

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: initial.artifact?.id,
        feedback: 'make the pump inlet diameter 0.24m',
      },
      {
        prompt: 'make the pump inlet diameter 0.24m',
        revisionOf: initial.artifact?.id,
        revisionVersion: initial.artifact?.version,
        revisionTarget: initial.artifact,
      },
    )

    const inletShapes =
      revised.artifact?.shapes.filter((shape) => shape.sourcePartKind === 'inlet_port') ?? []
    const outletShapes =
      revised.artifact?.shapes.filter((shape) => shape.sourcePartKind === 'outlet_port') ?? []

    expect(revised.artifact?.sourceTool).toBe('revise_geometry')
    expect(inletShapes.some((shape) => shape.radius === 0.12)).toBe(true)
    expect(outletShapes.some((shape) => shape.radius === 0.12)).toBe(false)
    expect(revised.artifact?.editHistory?.at(-1)?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'resize',
          selector: { sourcePartKind: 'inlet_port' },
          radius: 0.12,
        }),
      ]),
    )
  })

  test('recomposes industrial part-count revisions from follow-up text', () => {
    const initial = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'conveyor',
        name: 'editable conveyor',
        length: 4,
        width: 0.8,
        height: 0.9,
      },
      { prompt: 'make a belt conveyor' },
    )

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: initial.artifact?.id,
        feedback: 'change the conveyor to 14 rollers',
      },
      {
        prompt: 'change the conveyor to 14 rollers',
        revisionOf: initial.artifact?.id,
        revisionVersion: initial.artifact?.version,
        revisionTarget: initial.artifact,
      },
    )

    const rollers =
      revised.artifact?.shapes.filter(
        (shape) => shape.sourcePartKind === 'roller_array' && shape.name?.includes('roller'),
      ) ?? []

    expect(revised.artifact?.sourceTool).toBe('revise_geometry')
    expect(revised.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'roller_array', count: 14 })]),
    )
    expect(rollers).toHaveLength(14)
  })

  test('recomposes electrical cabinet door revisions from follow-up text', () => {
    const initial = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'electrical',
        name: 'editable cabinet',
        length: 0.9,
        width: 0.35,
        height: 1.8,
      },
      { prompt: 'make an electrical cabinet' },
    )

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: initial.artifact?.id,
        feedback: 'change the cabinet to double doors',
      },
      {
        prompt: 'change the cabinet to double doors',
        revisionOf: initial.artifact?.id,
        revisionVersion: initial.artifact?.version,
        revisionTarget: initial.artifact,
      },
    )

    const handles =
      revised.artifact?.shapes.filter(
        (shape) => shape.sourcePartKind === 'electrical_cabinet' && shape.name?.includes('handle'),
      ) ?? []

    expect(revised.artifact?.sourceTool).toBe('revise_geometry')
    expect(revised.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'electrical_cabinet', doorCount: 2 }),
      ]),
    )
    expect(handles).toHaveLength(2)
  })

  test('recomposes new industrial family dimensions from follow-up text', () => {
    const tank = executeGeometryToolCall(
      'compose_parts',
      { family: 'tank', name: 'editable storage tank', height: 3, diameter: 1.2 },
      { prompt: 'make a vertical storage tank' },
    )
    const revisedTank = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: tank.artifact?.id,
        feedback: 'change the tank diameter to 1.6m',
      },
      {
        prompt: 'change the tank diameter to 1.6m',
        revisionOf: tank.artifact?.id,
        revisionVersion: tank.artifact?.version,
        revisionTarget: tank.artifact,
      },
    )
    const tankShell = revisedTank.artifact?.shapes.find(
      (shape) =>
        shape.sourcePartKind === 'cylindrical_tank' && shape.semanticRole === 'vessel_shell',
    )

    expect(revisedTank.artifact?.sourceTool).toBe('revise_geometry')
    expect(revisedTank.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'cylindrical_tank', radius: 0.8 })]),
    )
    expect(tankShell?.radius).toBeCloseTo(0.8)

    const reactor = executeGeometryToolCall(
      'compose_parts',
      { family: 'reactor', name: 'editable reactor', vesselHeight: 2, diameter: 1.1 },
      { prompt: 'make a stirred reactor' },
    )
    const revisedReactor = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: reactor.artifact?.id,
        feedback: 'make the reactor nozzle diameter 0.2m',
      },
      {
        prompt: 'make the reactor nozzle diameter 0.2m',
        revisionOf: reactor.artifact?.id,
        revisionVersion: reactor.artifact?.version,
        revisionTarget: reactor.artifact,
      },
    )
    const reactorPorts =
      revisedReactor.artifact?.shapes.filter(
        (shape) => shape.sourcePartKind === 'inlet_port' || shape.sourcePartKind === 'outlet_port',
      ) ?? []

    expect(revisedReactor.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'inlet_port', radius: 0.1 }),
        expect.objectContaining({ kind: 'outlet_port', radius: 0.1 }),
      ]),
    )
    expect(reactorPorts.some((shape) => shape.radius === 0.1)).toBe(true)

    const exchanger = executeGeometryToolCall(
      'compose_parts',
      { family: 'heat_exchanger', name: 'editable heat exchanger', length: 2.4, diameter: 0.5 },
      { prompt: 'make a shell and tube heat exchanger' },
    )
    const revisedExchanger = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: exchanger.artifact?.id,
        feedback: 'change heat exchanger length to 3m and diameter to 0.7m',
      },
      {
        prompt: 'change heat exchanger length to 3m and diameter to 0.7m',
        revisionOf: exchanger.artifact?.id,
        revisionVersion: exchanger.artifact?.version,
        revisionTarget: exchanger.artifact,
      },
    )
    const exchangerShell = revisedExchanger.artifact?.shapes.find(
      (shape) =>
        shape.sourcePartKind === 'heat_exchanger' && shape.semanticRole === 'heat_exchanger_shell',
    )

    expect(revisedExchanger.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'heat_exchanger', length: 3, radius: 0.35 }),
      ]),
    )
    expect(exchangerShell?.height).toBeCloseTo(3)
    expect(exchangerShell?.radius).toBeCloseTo(0.35)
  })

  test('recomposes compressor and machine tool part attributes from follow-up text', () => {
    const compressor = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'compressor',
        name: 'editable compressor',
        length: 2,
        width: 0.8,
        height: 0.8,
      },
      { prompt: 'make a skid mounted compressor' },
    )
    const revisedCompressor = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: compressor.artifact?.id,
        feedback: 'make the compressor motor length 0.9m and port diameter 0.22m',
      },
      {
        prompt: 'make the compressor motor length 0.9m and port diameter 0.22m',
        revisionOf: compressor.artifact?.id,
        revisionVersion: compressor.artifact?.version,
        revisionTarget: compressor.artifact,
      },
    )

    expect(revisedCompressor.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ribbed_motor_body', length: 0.9 }),
        expect.objectContaining({ kind: 'inlet_port', radius: 0.11 }),
        expect.objectContaining({ kind: 'outlet_port', radius: 0.11 }),
      ]),
    )
    expect(
      revisedCompressor.artifact?.shapes.some(
        (shape) => shape.sourcePartKind === 'ribbed_motor_body' && shape.height === 0.9,
      ),
    ).toBe(true)

    const machine = executeGeometryToolCall(
      'compose_parts',
      { family: 'machine_tool', name: 'editable cnc', length: 2.8, width: 1.1, height: 1.7 },
      { prompt: 'make a cnc machining center' },
    )
    const revisedMachine = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: machine.artifact?.id,
        feedback: 'change machine tool length to 3m width to 1.2m height to 2m',
      },
      {
        prompt: 'change machine tool length to 3m width to 1.2m height to 2m',
        revisionOf: machine.artifact?.id,
        revisionVersion: machine.artifact?.version,
        revisionTarget: machine.artifact,
      },
    )
    const enclosure = revisedMachine.artifact?.shapes.find(
      (shape) => shape.semanticRole === 'machine_enclosure',
    )

    expect(revisedMachine.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'generic_body', length: 3, width: 1.2, height: 2 }),
      ]),
    )
    expect(enclosure).toMatchObject({ length: 3, width: 1.2, height: 2 })
  })

  test('adds and repositions optional industrial parts from follow-up text', () => {
    const tank = executeGeometryToolCall(
      'compose_parts',
      { family: 'tank', name: 'editable tank', height: 3, diameter: 1.2 },
      { prompt: 'make a vertical storage tank' },
    )
    const revisedTank = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: tank.artifact?.id,
        feedback: '给储罐右侧加一个检修平台',
      },
      {
        prompt: '给储罐右侧加一个检修平台',
        revisionOf: tank.artifact?.id,
        revisionVersion: tank.artifact?.version,
        revisionTarget: tank.artifact,
      },
    )
    const platform = sourceParts(revisedTank.artifact?.sourceArgs.parts).find(
      (part) => part.kind === 'platform_ladder',
    )

    expect(revisedTank.artifact?.sourceArgs.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'platform_ladder' })]),
    )
    expect(platform?.position?.[0]).toBeGreaterThan(0)
    expect(
      revisedTank.artifact?.shapes.some((shape) => shape.sourcePartKind === 'platform_ladder'),
    ).toBe(true)

    const compressor = executeGeometryToolCall(
      'compose_parts',
      { family: 'compressor', name: 'editable compressor', length: 2, width: 0.8, height: 0.8 },
      { prompt: 'make a skid mounted compressor' },
    )
    const revisedCompressor = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: compressor.artifact?.id,
        feedback: 'add a control box on the left side',
      },
      {
        prompt: 'add a control box on the left side',
        revisionOf: compressor.artifact?.id,
        revisionVersion: compressor.artifact?.version,
        revisionTarget: compressor.artifact,
      },
    )
    const compressorControl = sourceParts(revisedCompressor.artifact?.sourceArgs.parts).find(
      (part) => part.kind === 'control_box',
    )

    expect(compressorControl?.position?.[0]).toBeLessThan(0)
    expect(
      revisedCompressor.artifact?.shapes.some((shape) => shape.sourcePartKind === 'control_box'),
    ).toBe(true)

    const machine = executeGeometryToolCall(
      'compose_parts',
      { family: 'machine_tool', name: 'editable cnc', length: 2.8, width: 1.1, height: 1.7 },
      { prompt: 'make a cnc machining center' },
    )
    const revisedMachine = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: machine.artifact?.id,
        feedback: 'move the control panel to the left side',
      },
      {
        prompt: 'move the control panel to the left side',
        revisionOf: machine.artifact?.id,
        revisionVersion: machine.artifact?.version,
        revisionTarget: machine.artifact,
      },
    )
    const machineControl = sourceParts(revisedMachine.artifact?.sourceArgs.parts).find(
      (part) => part.kind === 'control_box',
    )

    expect(machineControl?.position?.[0]).toBeLessThan(0)
  })

  test('uses registry canonical roles instead of LLM blueprint roles for industrial parts', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'tank',
        geometryBrief:
          'Vertical industrial storage tank, 3m tall, 1.2m diameter, metallic grey. Required roles: tank_body, tank_base, inlet_nozzle, outlet_nozzle, inspection_platform.',
        height: 3,
        diameter: 1.2,
        primaryColor: '#9BA4B5',
        metalColor: '#9BA4B5',
        parts: [
          {
            id: 'tank_body',
            kind: 'cylindrical_tank',
            semanticRole: 'tank_body',
            params: { height: 3, radius: 0.6, primaryColor: '#9BA4B5' },
          },
          {
            id: 'platform',
            kind: 'platform_ladder',
            semanticRole: 'inspection_platform',
            side: 'right',
            params: { metalColor: '#9BA4B5' },
          },
        ],
      },
      {
        prompt:
          'Generate a vertical industrial storage tank, 3 meters tall and 1.2 meters diameter, with a right-side inspection platform and ladder, metallic grey.',
        blueprintRequiredRoles: [
          'tank_body',
          'tank_base',
          'inlet_nozzle',
          'outlet_nozzle',
          'inspection_platform',
        ],
        blueprintCategory: 'industrial_storage_tank',
      },
    )

    expect(result.artifact?.sourceArgs.family).toBe('tank')
    expect(result.artifact?.geometryBrief?.requiredRoles).toEqual(
      expect.arrayContaining(['cylindrical_tank', 'access_platform']),
    )
    expect(result.artifact?.geometryBrief?.requiredRoles).not.toContain('tank_body')
    expect(result.artifact?.semanticSummary).toContain('family=process_equipment')
    expect(result.content).toContain('Created draft')
    expect(
      result.artifact?.shapes.some((shape) => shape.sourcePartKind === 'platform_ladder'),
    ).toBe(true)
  })

  test('keeps registry machine tool output isolated from aircraft auto completion', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        family: 'machine_tool',
        name: 'Boeing style CNC machining center',
        length: 2.8,
        width: 1.1,
        height: 1.7,
        parts: [
          { kind: 'machine base', semanticRole: 'machine_base' },
          { kind: 'machine enclosure', semanticRole: 'machine_enclosure' },
          { kind: 'viewing panel', semanticRole: 'spindle_head' },
          { kind: 'control panel', semanticRole: 'control_panel' },
        ],
      },
      { prompt: 'generate a Boeing style CNC machining center, not an aircraft' },
    )

    const sourceKinds = new Set(result.artifact?.shapes.map((shape) => shape.sourcePartKind))
    expect(result.artifact?.sourceArgs.family).toBe('machine_tool')
    expect(sourceKinds.has('generic_base')).toBe(true)
    expect(sourceKinds.has('generic_body')).toBe(true)
    expect(sourceKinds.has('aircraft_fuselage')).toBe(false)
    expect(sourceKinds.has('aircraft_wing')).toBe(false)
    expect(sourceKinds.has('aircraft_engine')).toBe(false)
    expect(sourceKinds.has('aircraft_landing_gear')).toBe(false)
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
          '\u6ce5\u6d46\u6405\u62cc\u90e8\u4ef6\uff0c\u4e00\u6839\u6746\u5b50\uff0c\u4e0b\u9762\u4e09\u9762\u6868\u53f6\uff0c\u4e09\u4e2a\u6868\u53f6\u8981\u540c\u4e00\u6c34\u5e73',
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

  test('executes create intent by deterministic planner args', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryIntent: {
          action: 'create',
          scope: 'component',
          family: 'bicycle',
          component: 'wheel',
          quantity: 1,
          arrangement: 'single',
        },
      },
      { prompt: '生成一个自行车轮子' },
    )

    expect(result.artifact).toBeDefined()
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_tire'),
    ).toHaveLength(1)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(8)
    expect(result.artifact?.geometryBrief?.requiredRoles).toEqual([
      'bicycle_tire',
      'bicycle_rim',
      'bicycle_hub',
      'bicycle_spoke',
    ])
  })

  test('executes vehicle wheel component intent as one wheel, not a full car wheel set', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        geometryIntent: {
          action: 'create',
          scope: 'component',
          family: 'vehicle',
          component: 'wheel',
          quantity: 1,
          arrangement: 'single',
        },
      },
      { prompt: '生成一个汽车轮子' },
    )

    expect(result.artifact).toBeDefined()
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'vehicle_tire'),
    ).toHaveLength(1)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'wheel_hub'),
    ).toHaveLength(1)
    expect(result.artifact?.geometryBrief?.requiredRoles).toEqual(['vehicle_tire', 'wheel_hub'])
  })

  test('executes revision intent through ArtifactFacts instead of LLM-authored selectors', () => {
    const created = executeGeometryToolCall(
      'compose_parts',
      {
        geometryBrief: { category: 'bicycle', requiredRoles: ['bicycle_tire'] },
        parts: [
          { id: 'bicycle_wheels', kind: 'wheel_set', semanticRole: 'bicycle_tire', count: 2 },
        ],
      },
      { prompt: '生成一个自行车轮子' },
    )

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        revisionIntent: {
          action: 'revise',
          target: { kind: 'latest' },
          subject: { family: 'bicycle', component: 'wheel' },
          operation: { kind: 'set_count', desiredCount: 1 },
        },
      },
      {
        prompt: '轮子只要一个，不要两个',
        revisionTarget: created.artifact,
        revisionOf: created.artifact?.id,
        revisionVersion: created.artifact?.version,
        blueprintRequiredRoles: [
          'bicycle_tire:1',
          'bicycle_rim:1',
          'bicycle_hub:1',
          'bicycle_spoke:8',
        ],
        blueprintCategory: 'bicycle_single_wheel',
      },
    )

    expect(revised.content).toContain('Created draft')
    expect(
      revised.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_tire'),
    ).toHaveLength(1)
    expect(
      revised.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_rim'),
    ).toHaveLength(1)
    expect(
      revised.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_hub'),
    ).toHaveLength(1)
    expect(
      revised.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(8)
    expect(revised.artifact?.editHistory?.at(-1)?.operations).toHaveLength(11)
  })

  test('preserves explicit machine tool blueprint parts and ignores negative wheel terms', () => {
    const result = executeGeometryToolCall(
      'compose_parts',
      {
        category: 'cnc_machining_center',
        family: 'machine_tool',
        length: 2.8,
        width: 1.1,
        height: 1.7,
        primaryColor: '#E8E8EC',
        geometryBrief: {
          category: 'cnc_machining_center',
          requiredRoles: [
            'machine_base',
            'machine_enclosure',
            'viewing_panel',
            'spindle_head',
            'work_table',
            'control_panel',
            'display_screen',
            'warning_label',
            'nameplate',
            'vent_panel',
            'access_panel',
          ],
        },
        parts: [
          {
            id: 'base',
            kind: 'generic_base',
            semanticRole: 'machine_base',
            params: { length: 2.8, width: 1.1, thickness: 0.18, darkColor: '#3A3A44' },
          },
          {
            id: 'enclosure',
            kind: 'generic_body',
            semanticRole: 'machine_enclosure',
            alignAbove: 'base',
            params: { length: 2.4, width: 1.05, height: 1.4 },
          },
          {
            id: 'viewing_panel',
            kind: 'generic_panel',
            semanticRole: 'viewing_panel',
            centeredOn: 'enclosure',
            side: 'front',
            params: { length: 0.9, height: 0.7, thickness: 0.01, color: '#88CCEE' },
          },
          {
            id: 'work_table',
            kind: 'generic_panel',
            semanticRole: 'work_table',
            centeredOn: 'enclosure',
            params: { length: 1, width: 0.7, thickness: 0.06 },
          },
          {
            id: 'spindle_head',
            kind: 'generic_panel',
            semanticRole: 'spindle_head',
            alignAbove: 'work_table',
            centeredOn: 'work_table',
            params: { length: 0.25, width: 0.25, height: 0.35 },
          },
          {
            id: 'control_box',
            kind: 'control_box',
            semanticRole: 'control_panel',
            alignBeside: 'enclosure',
            side: 'right',
            params: { length: 0.5, width: 0.3, height: 0.9 },
          },
          {
            id: 'display',
            kind: 'generic_display',
            semanticRole: 'display_screen',
            centeredOn: 'control_box',
            side: 'front',
            params: { length: 0.35, height: 0.28 },
          },
          {
            id: 'vents_left',
            kind: 'vent_slats',
            semanticRole: 'vent_panel',
            centeredOn: 'enclosure',
            side: 'left',
            params: { slatCount: 6 },
          },
          {
            id: 'access_left',
            kind: 'generic_detail_accent',
            semanticRole: 'access_panel',
            centeredOn: 'enclosure',
            side: 'left',
          },
          { id: 'warning_front', kind: 'warning_label', semanticRole: 'warning_label' },
          { id: 'nameplate_front', kind: 'nameplate', semanticRole: 'nameplate' },
        ],
      },
      {
        prompt:
          'Generate a CNC machining center. Do not generate aircraft, vehicle, wheel, wing, or landing gear.',
        blueprintCategory: 'cnc_machining_center',
        blueprintRequiredRoles: [
          'machine_base',
          'machine_enclosure',
          'viewing_panel',
          'spindle_head',
          'work_table',
          'control_panel',
          'display_screen',
          'warning_label',
          'nameplate',
          'vent_panel',
          'access_panel',
        ],
      },
    )

    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const sourceKinds = new Set(result.artifact?.shapes.map((shape) => shape.sourcePartKind))

    expect(result.artifact).toBeDefined()
    expect(result.artifact?.sourceArgs.family).toBe('machine_tool')
    expect(result.artifact?.shapes.length).toBeGreaterThan(10)
    for (const role of [
      'machine_base',
      'machine_enclosure',
      'viewing_panel',
      'spindle_head',
      'work_table',
      'control_panel',
      'display_screen',
      'warning_label',
      'nameplate',
      'vent_panel',
      'access_panel',
    ]) {
      expect(roles.has(role)).toBe(true)
    }
    expect(sourceKinds.has('wheel_set')).toBe(false)
    expect(sourceKinds.has('aircraft_fuselage')).toBe(false)
  })
})
