import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bareNumberPaths, unshownDefaultPaths } from '@pascal-app/core/agent-tools'
import { builtinAgentTools } from '@pascal-app/nodes/agent-tools'

// The plugin's contracts are declared where core's are, including the hosted chat's sandbox,
// which rejects packages that depend on Node modules: they import zod and core's types only.
test('the kitchen tool contracts reach only zod', () => {
  const source = readFileSync(resolve(import.meta.dir, 'index.ts'), 'utf8')
  const runtime = [
    ...source.matchAll(/^(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1])
  expect(runtime).toEqual(['zod'])
})

test('the kitchen tools take no bare length and show every default', () => {
  expect(bareNumberPaths(builtinAgentTools.tools)).toEqual([])
  expect(unshownDefaultPaths(builtinAgentTools.tools)).toEqual([])
})
