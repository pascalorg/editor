import { describe, expect, test } from 'bun:test'
import {
  buildPrimitiveRepairRetryMessages,
  COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET,
  DEFAULT_PRIMITIVE_REPAIR_CALL_BUDGET,
  DEFAULT_PRIMITIVE_REPAIR_STAGNATION_LIMIT,
  INITIAL_PRIMITIVE_REPAIR_STAGNATION_STATE,
  nextPrimitiveRepairStagnationState,
  primitiveRepairCallBudget,
  primitiveToolExecutionAttemptLimit,
  SIMPLE_PRIMITIVE_REPAIR_CALL_BUDGET,
} from './primitive-repair-policy'

describe('primitive repair policy', () => {
  test('uses a small repair budget for simple one-shape requests', () => {
    expect(primitiveRepairCallBudget({ userPrompt: '生成一个圆柱' })).toBe(
      SIMPLE_PRIMITIVE_REPAIR_CALL_BUDGET,
    )
    expect(primitiveToolExecutionAttemptLimit({ userPrompt: 'make a box' })).toBe(2)
  })

  test('keeps larger budgets for complex or revision requests', () => {
    expect(primitiveRepairCallBudget({ userPrompt: '生成一个电风扇' })).toBe(
      COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET,
    )
    expect(
      primitiveRepairCallBudget({
        userPrompt: '把叶片加长',
        hasRevisionTarget: true,
      }),
    ).toBe(COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET)
    expect(primitiveRepairCallBudget({ userPrompt: '生成一个天车' })).toBe(
      COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET,
    )
    expect(primitiveRepairCallBudget({ userPrompt: '生成一个空调外机' })).toBe(
      COMPLEX_PRIMITIVE_REPAIR_CALL_BUDGET,
    )
    expect(primitiveRepairCallBudget({ userPrompt: '生成一个普通物体' })).toBe(
      DEFAULT_PRIMITIVE_REPAIR_CALL_BUDGET,
    )
  })

  test('builds compact retry messages instead of appending full tool history', () => {
    const baseMessages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'original request and analysis' },
    ]
    const retryMessages = buildPrimitiveRepairRetryMessages({
      baseMessages,
      repairCallNumber: 1,
      repairCallBudget: 1,
      failedToolSummary: `compose_primitive ${'x'.repeat(3000)}`,
      failureResults: [`Invalid geometry ${'y'.repeat(3000)}`],
    })

    expect(retryMessages).toHaveLength(3)
    expect(retryMessages[0]).toBe(baseMessages[0])
    expect(retryMessages[1]).toBe(baseMessages[1])
    expect(retryMessages[2]?.role).toBe('user')
    expect(retryMessages[2]?.content).toContain('Repair attempt 1 of 1')
    expect(retryMessages[2]?.content).toContain('truncated')
    expect(retryMessages[2]?.content.length).toBeLessThan(2600)
  })

  test('guides too-complex repairs to preserve semantic skeleton while reducing details', () => {
    const retryMessages = buildPrimitiveRepairRetryMessages({
      baseMessages: [{ role: 'system', content: 'system prompt' }],
      repairCallNumber: 1,
      repairCallBudget: 3,
      failedToolSummary: 'compose_parts tower crane',
      failureResults: [
        'Geometry is too complex to create safely. Nothing was created.\nGenerated 103 shapes, but the limit is 80.\n- Stage3 missing declared required role "jib_arm".',
      ],
    })

    const content = retryMessages.at(-1)?.content ?? ''
    expect(content).toContain('Preserve these required semantic roles exactly: jib_arm')
    expect(content).toContain('Reduce detail counts first')
    expect(content).toContain('Do not delete required structural/signature modules')
  })

  test('guides Stage3 quality repairs toward topology instead of repeating coordinates', () => {
    const retryMessages = buildPrimitiveRepairRetryMessages({
      baseMessages: [{ role: 'system', content: 'system prompt' }],
      repairCallNumber: 1,
      repairCallBudget: 3,
      failedToolSummary: 'compose_parts gantry crane',
      failureResults: [
        'Stage3 semantic quality gate failed. Nothing was accepted yet.\n- Stage3 missing declared required role "main_girder".\n- Stage3 lifting hook must hang below the trolley/carriage.',
      ],
    })

    const content = retryMessages.at(-1)?.content ?? ''
    expect(content).toContain('Preserve these required semantic roles exactly: main_girder')
    expect(content).toContain('Use relationship fields to express topology')
    expect(content).toContain('hooks below trolleys')
  })

  test('detects repeated stagnant repair failures', () => {
    const failure = [
      'Invalid geometry tool call. Nothing was created.',
      '- box.length is required (X left-right).',
      '- box.width is required (Z front-back depth).',
    ]

    const first = nextPrimitiveRepairStagnationState(
      INITIAL_PRIMITIVE_REPAIR_STAGNATION_STATE,
      failure,
    )
    expect(first.stagnantAttempts).toBe(0)

    const second = nextPrimitiveRepairStagnationState(first, failure)
    expect(second.stagnantAttempts).toBe(1)
    expect(second.stagnantAttempts).toBeLessThan(DEFAULT_PRIMITIVE_REPAIR_STAGNATION_LIMIT)

    const third = nextPrimitiveRepairStagnationState(second, failure)
    expect(third.stagnantAttempts).toBe(DEFAULT_PRIMITIVE_REPAIR_STAGNATION_LIMIT)

    const improved = nextPrimitiveRepairStagnationState(third, [
      'Invalid geometry tool call. Nothing was created.',
      '- box.length is required (X left-right).',
    ])
    expect(improved.stagnantAttempts).toBe(0)
  })
})
