import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * GUARD: the two walkthrough controllers must keep asking the same question.
 *
 * The speeds used to be written inline in both of them — `maxWalkSpeed={2}` in
 * `first-person-controls.tsx` and again in `glb-walkthrough-controller.tsx`.
 * Two literals in two packages, and nothing connecting them: change one and
 * the editor's walkthrough and the viewer's walkthrough quietly move at
 * different speeds. Nobody notices, because nobody uses both in one sitting.
 *
 * Asserting on behaviour cannot catch this — both files would still be
 * internally correct. What is wrong is that there are two answers, so the
 * source is what has to be measured.
 */

const REPO_ROOT = path.join(import.meta.dir, '../../../..')

const CONTROLLERS = [
  'packages/editor/src/components/editor/first-person-controls.tsx',
  'packages/viewer/src/components/viewer/glb-walkthrough-controller.tsx',
]

/** Any `maxWalkSpeed=` / `maxRunSpeed=` whose value is a bare number. */
const INLINE_SPEED = /max(?:Walk|Run)Speed=\{[^}]*\b\d/

describe('walkthrough speed has one source', () => {
  test.each(CONTROLLERS)('%s asks the shared hook', (relative) => {
    const source = readFileSync(path.join(REPO_ROOT, relative), 'utf8')
    expect(source).toContain('useWalkthroughSpeeds')
  })

  test.each(CONTROLLERS)('%s writes no speed literal of its own', (relative) => {
    const source = readFileSync(path.join(REPO_ROOT, relative), 'utf8')
    expect(INLINE_SPEED.test(source)).toBe(false)
  })
})
