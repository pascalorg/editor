import { describe, expect, test } from 'bun:test'
import type {
  GeneratedGeometryArtifact,
  GeneratedGeometryShapeSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import { precisionPartDeterministicRoute, stage3QualityReview } from './primitive-runner'

function shape(
  semanticRole: string,
  sourcePartKind: string,
  name = semanticRole,
): GeneratedGeometryShapeSpec {
  return {
    kind: 'box',
    name,
    semanticRole,
    sourcePartKind,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    length: 1,
    width: 1,
    height: 1,
  }
}

function artifact(shapes: GeneratedGeometryShapeSpec[]): GeneratedGeometryArtifact {
  return {
    id: 'stage3_test',
    title: 'Stage3 test',
    sourceTool: 'compose_parts',
    sourceArgs: {},
    userPrompt: 'test',
    version: 1,
    createdAt: '2026-06-18T00:00:00.000Z',
    shapes,
    transforms: shapes.map(() => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })),
    assemblyName: 'Stage3 test',
    assemblyPosition: [0, 0, 0],
    createdNames: shapes.map((item) => item.name ?? item.kind),
    shapeDetails: '',
  }
}

describe('Stage3 primitive quality gate', () => {
  test('routes robot arm prompts with negative guard rails to robot arm composer', () => {
    const prompt =
      '\u751f\u6210\u4e00\u4e2a\u5de5\u4e1a\u516d\u8f74\u673a\u5668\u81c2\uff0c\u53ea\u8981\u673a\u5668\u81c2\u672c\u4f53\uff0c\u4e0d\u8981\u5de5\u4f5c\u53f0\u3001\u63a7\u5236\u67dc\u3001\u62a4\u680f\u3002'

    expect(precisionPartDeterministicRoute(prompt, null)).toMatchObject({
      label: '6-axis industrial robot arm',
      family: 'robot_arm',
      args: {
        family: 'robot_arm',
        axisCount: 6,
        includeWorkcell: false,
        endEffector: 'tool-flange',
      },
    })
  })

  test('still routes explicit inspection platform ladder prompts deterministically', () => {
    const prompt =
      '\u751f\u6210\u4e00\u4e2a\u5de5\u4e1a\u68c0\u4fee\u5e73\u53f0\u722c\u68af\uff0c\u8981\u6709\u62a4\u680f\u548c\u8e0f\u68cd\u3002'

    expect(precisionPartDeterministicRoute(prompt, null)).toMatchObject({
      label: 'industrial platform ladder',
      family: 'generic',
      args: {
        parts: [
          expect.objectContaining({ kind: 'platform_ladder', semanticRole: 'access_platform' }),
        ],
      },
    })
  })

  test('routes industrial pedestal fan prompts to editable fan parts', () => {
    const route = precisionPartDeterministicRoute(
      '\u751f\u6210\u4e00\u4e2a\u7ea2\u8272\u5de5\u4e1a\u843d\u5730\u98ce\u6247\uff0c\u8981\u516d\u7247\u53ef\u7f16\u8f91\u6247\u53f6\u3002',
      null,
    )
    const parts = route?.args.parts as Array<Record<string, unknown>>

    expect(route).toMatchObject({
      label: 'industrial pedestal fan',
      family: 'fan',
      args: {
        family: 'fan',
        primaryColor: '#ef4444',
      },
    })
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fan_blade',
          semanticRole: 'fan_blade',
          count: 6,
          includeHub: true,
        }),
        expect.objectContaining({
          kind: 'protective_grill',
          semanticRole: 'protective_grill',
          detailLevel: 'low',
        }),
      ]),
    )
  })

  test('passes canonical horizontal pressure tank output', () => {
    const review = stage3QualityReview(
      '生成一个卧式压力储罐，要有顶部接管、人孔法兰和鞍座支撑。',
      artifact([
        shape('vessel_shell', 'cylindrical_tank'),
        shape('vessel_head', 'cylindrical_tank'),
        shape('top_nozzle', 'cylindrical_tank'),
        shape('manway_flange', 'cylindrical_tank'),
        shape('saddle_support', 'cylindrical_tank'),
      ]),
    )

    expect(review.passed).toBe(true)
    expect(review.repairPlan).toBeUndefined()
  })

  test('repairs pressure tank output that drifted into fan machinery', () => {
    const review = stage3QualityReview(
      '生成一个卧式压力储罐，要有顶部接管、人孔法兰和鞍座支撑。',
      artifact([
        shape('machine_body', 'rounded_machine_body'),
        shape('fan_blades', 'radial_blades'),
        shape('protective_grill', 'vent_grill'),
      ]),
    )

    expect(review.passed).toBe(false)
    expect(review.score).toBeLessThan(0.75)
    expect(review.repairPlan).toMatchObject({
      label: 'canonical horizontal pressure tank',
      tool: 'compose_parts',
      args: {
        parts: [
          expect.objectContaining({ kind: 'cylindrical_tank', semanticRole: 'vessel_shell' }),
        ],
      },
    })
  })

  test('repairs inspection platform output that drifted into bicycle geometry', () => {
    const review = stage3QualityReview(
      '生成一个工业检修平台爬梯，要有护栏、爬梯侧轨和多根踏棍。',
      artifact([
        shape('bicycle_tire', 'wheel_set'),
        shape('bicycle_frame', 'tube_frame'),
        shape('handlebar', 'handlebar'),
      ]),
    )

    expect(review.passed).toBe(false)
    expect(review.repairPlan).toMatchObject({
      label: 'canonical industrial platform ladder',
      args: {
        parts: [
          expect.objectContaining({ kind: 'platform_ladder', semanticRole: 'access_platform' }),
        ],
      },
    })
  })
})
