import { describe, expect, test } from 'bun:test'
import { registerPatchGuard, runPatchGuards } from './patch-guards'

// Patch guards register from the module that owns what they protect: the honest-update check from
// its own module, any other from the tools it guards.
describe('patch guards', () => {
  test('run by order whatever registers first, and a name registered again replaces it', () => {
    const ran: string[] = []
    registerPatchGuard({ name: 'test-late', order: 900, run: () => void ran.push('late') })
    registerPatchGuard({ name: 'test-early', order: 800, run: () => void ran.push('early') })
    registerPatchGuard({ name: 'test-early', order: 800, run: () => void ran.push('early again') })
    runPatchGuards([], {})
    expect(ran).toEqual(['early again', 'late'])
  })
})
