import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bareNumberPaths, unshownDefaultPaths } from '@pascal-app/core/agent-tools'
import { builtinAgentTools } from '@pascal-app/nodes/agent-tools'

// The plugin's contracts are declared where core's are, including the hosted chat's sandbox,
// which rejects packages that depend on Node modules: they import zod and core's types only.
test('the built-in tool contracts use sandbox-safe entry points', () => {
  const source = readFileSync(resolve(import.meta.dir, 'index.ts'), 'utf8')
  const runtime = [
    ...source.matchAll(/^(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1])
  expect(runtime).toEqual(['@pascal-app/core/agent-tools', 'zod'])
})

test('the built-in tools accept unit notation for lengths and show every default', () => {
  expect(bareNumberPaths(builtinAgentTools.tools)).toEqual(['pipe_grade.gradePercent'])
  expect(unshownDefaultPaths(builtinAgentTools.tools)).toEqual([])
})

test('MEP length inputs normalize unit-bearing text before operations run', () => {
  const resize = builtinAgentTools.tools.find((tool) => tool.name === 'pipe_resize')!
  expect(resize.input.diameter.parse('0.5 ft')).toBe(6)
  const offset = builtinAgentTools.tools.find((tool) => tool.name === 'pipe_offset')!
  expect(offset.input.offset.parse('50 cm')).toBe(0.5)
  const duct = builtinAgentTools.tools.find((tool) => tool.name === 'duct_edit')!
  expect(duct.input.width.parse('2 ft')).toBe(24)
})
