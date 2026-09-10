import { describe, expect, test } from 'bun:test'
import packet from '../plugin-evals/tool-annotation-justifications.json'
import { validateOpenAiToolAnnotationPacket } from './openai-tool-annotation-policy'

const clonePacket = () => structuredClone(packet)

describe('OpenAI tool annotation justification packet', () => {
  test('accepts the canonical exact inventory', () => {
    expect(validateOpenAiToolAnnotationPacket(packet)).toEqual([])
  })

  test('rejects a missing tool', () => {
    const candidate = clonePacket()
    candidate.tools.pop()
    expect(validateOpenAiToolAnnotationPacket(candidate)).toContain(
      'OpenAI tool annotation packet must contain the exact 46-tool inventory',
    )
  })

  test('rejects an unexpected or duplicate tool', () => {
    const unexpected = clonePacket()
    unexpected.tools[0]!.name = 'unexpected_tool'
    expect(validateOpenAiToolAnnotationPacket(unexpected)).toContain(
      'OpenAI tool annotation packet contains unexpected tool unexpected_tool',
    )

    const duplicate = clonePacket()
    duplicate.tools[1]!.name = duplicate.tools[0]!.name
    expect(validateOpenAiToolAnnotationPacket(duplicate)).toContain(
      'OpenAI tool annotation packet tool names must be unique',
    )
  })

  test('rejects a wrong hint value', () => {
    const candidate = clonePacket()
    candidate.tools[0]!.annotations.readOnlyHint = true
    expect(validateOpenAiToolAnnotationPacket(candidate)).toContain(
      'OpenAI tool annotation packet add_door has readOnlyHint=true, expected false',
    )
  })

  test('rejects missing, blank, or extra justifications', () => {
    const missing = clonePacket() as unknown as {
      tools: Array<{ justifications: Record<string, string> }>
    }
    delete missing.tools[0].justifications.openWorldHint
    expect(validateOpenAiToolAnnotationPacket(missing)).toContain(
      'OpenAI tool annotation packet add_door justifications must contain exactly the required hints',
    )

    const blank = clonePacket()
    blank.tools[0]!.justifications.destructiveHint = '   '
    expect(validateOpenAiToolAnnotationPacket(blank)).toContain(
      'OpenAI tool annotation packet add_door needs a non-empty destructiveHint justification',
    )

    const extra = clonePacket() as unknown as {
      tools: Array<{ justifications: Record<string, string> }>
    }
    extra.tools[0].justifications.idempotentHint = 'Not part of this submission packet.'
    expect(validateOpenAiToolAnnotationPacket(extra)).toContain(
      'OpenAI tool annotation packet add_door justifications must contain exactly the required hints',
    )
  })
})
