import { describe, expect, test } from 'bun:test'
import {
  CORE_COMPONENT_PART_CAPABILITIES,
  coreComponentPartKinds,
  GENERIC_PART_CAPABILITIES,
} from '@pascal-app/core/lib/part-taxonomy'
import { executeGeometryToolCall } from '../ai-geometry-tool-executor'
import { buildArtifactFacts } from './artifact-facts'
import { inferCreateIntentFromBlueprint } from './component-intent-inference'
import { planCreateGeometry } from './create-capability-registry'
import { parseGeometryIntent, type RevisionIntent, type RevisionSubject } from './geometry-intent'
import { planGeometryIntent } from './geometry-intent-planner'
import { revisionOperationRegistry } from './revision-operation-registry'

describe('geometry intent planner', () => {
  test('keeps component planner part kinds sourced from the core taxonomy catalog', () => {
    const taxonomyKinds = new Set(GENERIC_PART_CAPABILITIES.flatMap((entry) => entry.partKinds))
    for (const capability of CORE_COMPONENT_PART_CAPABILITIES) {
      expect(taxonomyKinds.has(capability.partKind)).toBe(true)
    }

    const coreKinds = new Set(coreComponentPartKinds())
    for (const [family, component] of [
      ['bicycle', 'wheel'],
      ['vehicle', 'wheel'],
      ['vehicle', 'window'],
      ['generic', 'propeller'],
      ['generic', 'blade'],
    ]) {
      const plan = planGeometryIntent({
        action: 'create',
        scope: 'component',
        family,
        component,
        quantity: 1,
        arrangement: 'single',
        constraints: {},
      })
      expect(plan.action).toBe('create')
      expect(plan.tool).toBe('compose_parts')
      const parts = plan.args.parts as Array<{ kind?: string }>
      expect(parts.every((part) => part.kind != null && coreKinds.has(part.kind))).toBe(true)
    }
  })

  test('plans a singular bicycle wheel create intent without exposing part selection to the LLM', () => {
    const plan = planCreateGeometry({
      action: 'create',
      scope: 'component',
      family: 'bicycle',
      component: 'wheel',
      quantity: 1,
      arrangement: 'single',
      constraints: {},
    })

    expect(plan.tool).toBe('compose_parts')
    expect(plan.issues).toEqual([])
    expect(plan.args).toMatchObject({
      geometryBrief: {
        family: 'bicycle',
        component: 'wheel',
        requiredRoles: ['bicycle_tire', 'bicycle_rim', 'bicycle_hub', 'bicycle_spoke'],
      },
      parts: [{ kind: 'wheel_set', semanticRole: 'bicycle_wheel', count: 1 }],
    })
  })

  test('executes two bicycle wheels when component quantity is two', () => {
    const plan = planCreateGeometry({
      action: 'create',
      scope: 'component',
      family: 'bicycle',
      component: 'wheel',
      quantity: 2,
      arrangement: 'pair',
      constraints: {},
    })

    expect(plan.tool).toBe('compose_parts')
    expect(plan.issues).toEqual([])
    expect(plan.args).toMatchObject({
      parts: [{ kind: 'wheel_set', semanticRole: 'bicycle_wheel', count: 2 }],
    })

    const result = executeGeometryToolCall(
      plan.tool,
      { ...plan.args },
      { prompt: '生成两个自行车轮子' },
    )

    expect(result.artifact).toBeDefined()
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_tire'),
    ).toHaveLength(2)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_rim'),
    ).toHaveLength(2)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_hub'),
    ).toHaveLength(2)
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(16)
  })

  test('plans a singular vehicle wheel create intent without expanding to four wheels', () => {
    const plan = planCreateGeometry({
      action: 'create',
      scope: 'component',
      family: 'vehicle',
      component: 'wheel',
      quantity: 1,
      arrangement: 'single',
      constraints: {},
    })

    expect(plan.tool).toBe('compose_parts')
    expect(plan.issues).toEqual([])
    expect(plan.args).toMatchObject({
      geometryBrief: {
        family: 'vehicle',
        component: 'wheel',
        requiredRoles: ['vehicle_tire', 'wheel_hub'],
      },
      parts: [{ kind: 'wheel_set', semanticRole: 'vehicle_tire', count: 1 }],
    })
  })

  test('runs Stage1 component intent directly without Stage2-authored part arguments', () => {
    const intent = inferCreateIntentFromBlueprint(
      'compose_parts',
      {},
      {
        route: 'compose_parts',
        category: 'automotive wheel component',
        requiredRoles: ['car_wheel'],
        constraints: { diameter: 0.45, width: 0.18 },
        parts: [{ id: 'car_wheel', kind: 'wheel_set', semanticRole: 'car_wheel' }],
      },
      'generate one car wheel',
    )
    expect(intent).toBeDefined()

    const plan = planGeometryIntent(intent!)
    expect(plan.action).toBe('create')
    expect(plan.issues).toEqual([])
    const result = executeGeometryToolCall(
      plan.tool,
      {
        ...plan.args,
        geometryIntent: intent,
      },
      {
        prompt: 'generate one car wheel',
        blueprintCategory: 'automotive wheel component',
        blueprintRequiredRoles: ['car_wheel'],
      },
    )

    expect(result.content).not.toContain('required semantic role "vehicle_wheels" is missing')
    expect(
      result.artifact?.shapes.filter((shape) => shape.semanticRole === 'vehicle_tire'),
    ).toHaveLength(1)
    expect(result.artifact?.sourceArgs.parts).toEqual([
      expect.objectContaining({ kind: 'wheel_set', semanticRole: 'vehicle_tire', count: 1 }),
    ])
  })

  test.each([
    [
      'vehicle',
      'window',
      'compose_parts',
      ['vehicle_window'],
      ['vehicle_window'],
      'generate one car window',
    ],
    [
      'vehicle',
      'door',
      'compose_primitive',
      ['vehicle_door'],
      ['vehicle_door'],
      'generate one car door',
    ],
    [
      'vehicle',
      'mirror',
      'compose_primitive',
      ['mirror_glass'],
      ['mirror_glass'],
      'generate one car mirror',
    ],
    [
      'aircraft',
      'engine',
      'compose_primitive',
      ['engine_nacelle', 'engine_fan', 'engine_intake'],
      ['engine_nacelle', 'engine_fan', 'engine_intake'],
      'generate one aircraft engine',
    ],
    [
      'generic',
      'propeller',
      'compose_parts',
      ['propeller_blade'],
      ['propeller_blade'],
      'generate one propeller',
    ],
    [
      'generic',
      'blade',
      'compose_parts',
      ['airfoil_blade'],
      ['airfoil_blade'],
      'generate one airfoil blade',
    ],
  ])('plans and executes %s %s component deterministically', (family, component, tool, requiredRoles, expectedRoles, prompt) => {
    const plan = planGeometryIntent({
      action: 'create',
      scope: 'component',
      family,
      component,
      quantity: 1,
      arrangement: 'single',
      constraints: {},
    })

    expect(plan.action).toBe('create')
    expect(plan.tool).toBe(tool as typeof plan.tool)
    expect(plan.issues).toEqual([])
    expect(plan.args).toMatchObject({
      geometryBrief: { family, component, requiredRoles },
    })

    const result = executeGeometryToolCall(plan.tool, { ...plan.args }, { prompt })

    expect(result.artifact).toBeDefined()
    for (const role of expectedRoles) {
      expect(result.artifact?.shapes.some((shape) => shape.semanticRole === role)).toBe(true)
    }
  })

  test('extracts typed artifact facts from duplicate bicycle wheel geometry', () => {
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

    expect(created.artifact).toBeDefined()
    const facts = buildArtifactFacts(created.artifact!)

    expect(facts.roles.bicycle_tire?.count).toBe(2)
    expect(facts.roles.bicycle_spoke?.count).toBe(16)
    expect(facts.components.filter((entry) => entry.component === 'wheel')).toHaveLength(2)
    expect(facts.parts.every((part) => part.shapeId.startsWith('shape:'))).toBe(true)
  })

  test('compiles set_count revision intent through ArtifactFacts instead of LLM selectors', () => {
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
    const revisionPlan = planGeometryIntent(
      {
        action: 'revise',
        target: { kind: 'latest' },
        subject: { family: 'bicycle', component: 'wheel' },
        operation: { kind: 'set_count', desiredCount: 1 },
      },
      { revisionTarget: created.artifact },
    )

    expect(revisionPlan.action).toBe('revise')
    if (revisionPlan.action !== 'revise') throw new Error('Expected revise plan')
    expect(revisionPlan.issues).toEqual([])
    expect(revisionPlan.operations).toHaveLength(11)
    expect(revisionPlan.operations.every((operation) => operation.op === 'remove')).toBe(true)
  })

  test('keeps revision operation registry aligned with the core revision DSL operations', () => {
    expect(Array.from(revisionOperationRegistry.keys()).sort()).toEqual([
      'add_shapes',
      'align_subject',
      'material_from',
      'remove_duplicate',
      'remove_subject',
      'replace_subject',
      'resize_subject',
      'scale_semantic',
      'scale_subject',
      'set_count',
      'set_material',
      'transform_subject',
    ])

    const parsed = parseGeometryIntent({
      action: 'revise',
      target: { kind: 'latest' },
      subject: { semanticRole: 'test_window' },
      operation: {
        kind: 'replace_subject',
        shapes: [
          {
            kind: 'rounded-panel',
            name: 'larger replacement window',
            semanticRole: 'test_window',
            length: 1.2,
            width: 0.35,
            thickness: 0.02,
          },
        ],
      },
    })
    expect(parsed?.action).toBe('revise')
  })

  test('compiles rich revision intents from typed ArtifactFacts', () => {
    const created = executeGeometryToolCall(
      'compose_primitive',
      {
        geometryBrief: { category: 'test_fragment', requiredRoles: ['test_body', 'test_window'] },
        shapes: [
          {
            kind: 'box',
            name: 'test body',
            semanticRole: 'test_body',
            position: [0, 0.4, 0],
            length: 4,
            width: 1.8,
            height: 0.6,
            material: { properties: { color: '#cc0000' } },
          },
          {
            kind: 'rounded-panel',
            name: 'test window',
            semanticRole: 'test_window',
            position: [0, 0.9, -0.55],
            length: 1,
            width: 0.2,
            thickness: 0.01,
            material: { properties: { color: '#1e3a8a' } },
          },
        ],
      },
      { prompt: 'create test fragment' },
    )

    const target = created.artifact
    expect(target).toBeDefined()
    if (!target) throw new Error('Expected artifact')

    const cases: Array<[RevisionSubject | undefined, RevisionIntent['operation'], string]> = [
      [{ semanticRole: 'test_window' }, { kind: 'remove_subject' }, 'remove'],
      [
        undefined,
        {
          kind: 'add_shapes',
          shapes: [
            {
              kind: 'box',
              name: 'extra trim',
              semanticRole: 'test_trim',
              position: [0, 0.75, -0.65],
              length: 1.2,
              width: 0.04,
              height: 0.04,
            },
          ],
        },
        'add',
      ],
      [
        { semanticRole: 'test_window' },
        {
          kind: 'replace_subject',
          shapes: [
            {
              kind: 'rounded-panel',
              name: 'larger replacement window',
              semanticRole: 'test_window',
              position: [0, 0.9, -0.55],
              length: 1.3,
              width: 0.3,
              thickness: 0.01,
            },
          ],
        },
        'replace',
      ],
      [
        { semanticRole: 'test_window' },
        { kind: 'transform_subject', delta: [0, 0.1, 0] },
        'transform',
      ],
      [{ semanticRole: 'test_window' }, { kind: 'resize_subject', length: 1.4 }, 'resize'],
      [
        { semanticRole: 'test_window' },
        { kind: 'scale_semantic', dimension: 'primary', factor: 1.2 },
        'scaleSemantic',
      ],
      [{ semanticRole: 'test_window' }, { kind: 'set_material', color: '#00ff00' }, 'setMaterial'],
      [
        { semanticRole: 'test_window' },
        { kind: 'material_from', from: { semanticRole: 'test_body' } },
        'materialFrom',
      ],
      [
        { semanticRole: 'test_window' },
        {
          kind: 'align_subject',
          to: { semanticRole: 'test_body' },
          edge: 'bottom',
          toEdge: 'top',
        },
        'align',
      ],
    ]

    for (const [subject, operation, expectedOp] of cases) {
      const plan = planGeometryIntent(
        {
          action: 'revise',
          target: { kind: 'latest' },
          subject,
          operation,
        },
        { revisionTarget: target },
      )
      expect(plan.action).toBe('revise')
      if (plan.action !== 'revise') throw new Error('Expected revise plan')
      expect(plan.issues).toEqual([])
      expect(plan.operations.some((entry) => entry.op === expectedOp)).toBe(true)
    }
  })

  test('preserves gradient material through primitive create and revision setMaterial', () => {
    const gradientMaterial = {
      properties: { color: '#ef4444', opacity: 0.2, transparent: true },
      gradient: {
        type: 'linear',
        space: 'uv',
        axis: 'y',
        stops: [
          { offset: 0, color: '#ef4444', opacity: 1 },
          { offset: 1, color: '#111827', opacity: 1 },
        ],
      },
    }
    const created = executeGeometryToolCall(
      'compose_primitive',
      {
        shapes: [
          {
            kind: 'box',
            semanticRole: 'test_body',
            position: [0, 0.5, 0],
            length: 1,
            width: 1,
            height: 1,
            material: gradientMaterial,
          },
        ],
      },
      { prompt: 'create red black gradient test box' },
    )

    expect(created.artifact?.shapes[0]?.material?.gradient?.stops[1]?.color).toBe('#111827')

    const revised = executeGeometryToolCall(
      'revise_geometry',
      {
        targetArtifactId: created.artifact?.id,
        feedback: 'make it blue green gradient',
        intent: 'set gradient material',
        operations: [
          {
            op: 'setMaterial',
            selector: { semanticRole: 'test_body' },
            material: {
              properties: { color: '#3b82f6', opacity: 0.5, transparent: true },
              gradient: {
                type: 'linear',
                space: 'uv',
                axis: 'y',
                stops: [
                  { offset: 0, color: '#3b82f6', opacity: 1 },
                  { offset: 1, color: '#22c55e', opacity: 1 },
                ],
              },
            },
          },
        ],
      },
      { prompt: 'revise gradient', revisionTarget: created.artifact },
    )

    expect(revised.artifact?.shapes[0]?.material?.properties?.opacity).toBe(0.5)
    expect(revised.artifact?.shapes[0]?.material?.gradient?.stops[1]?.color).toBe('#22c55e')
  })
})
