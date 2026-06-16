import { describe, expect, test } from 'bun:test'
import {
  buildPrimitiveRepairStopMessage,
  classifyPrimitiveRepairIssue,
} from './primitive-repair-skill'

describe('primitive repair skill', () => {
  test('classifies missing semantic roles and gives object-neutral next steps', () => {
    const issue = classifyPrimitiveRepairIssue(
      'Invalid geometry tool call. required semantic role "vertical_shaft" is missing.',
    )

    expect(issue.kind).toBe('missing_semantic_roles')
    expect(issue.nextAction).not.toContain('valve_body')
  })

  test('builds a stop message without unrelated valve advice', () => {
    const message = buildPrimitiveRepairStopMessage({
      failureContent: 'mixer requires at least 3 radial flat blades, got 0.',
      stagnantLimit: 4,
      compressedMemoryKept: true,
    })

    expect(message).toContain('生成已停止')
    expect(message).toContain('错误分类')
    expect(message).toContain('propeller_blade_set')
    expect(message).not.toContain('valve_body')
  })
})
