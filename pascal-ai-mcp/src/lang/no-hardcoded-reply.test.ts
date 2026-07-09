// ---------------------------------------------------------------------------
// Guardrail: user-facing replies must be rendered through t()/issueText(),
// never written as literal CJK strings. Internal Chinese (prompts,
// diagnostics, sceneResult) is fine BY DESIGN — this only scans lines that
// assign the user-visible `reply`. If this test fails, move the string into
// MESSAGES in src/lang/i18n.ts and render it with t(session.language, ...).
// ---------------------------------------------------------------------------

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const CJK = /[぀-ヿ一-鿿]/
const REPLY_ASSIGNMENT = /\breply\s*[:=](?!=)/

test('agent.ts reply assignments contain no hardcoded CJK literals', () => {
  const source = readFileSync(new URL('../agent.ts', import.meta.url), 'utf8')
  const offenders: string[] = []
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    if (REPLY_ASSIGNMENT.test(line) && CJK.test(line)) {
      offenders.push(`agent.ts:${index + 1}: ${trimmed}`)
    }
  })
  expect(offenders).toEqual([])
})
