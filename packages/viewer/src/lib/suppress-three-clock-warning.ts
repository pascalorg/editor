/**
 * Suppresses the `THREE.Clock: This module has been deprecated` warning
 * emitted by three.js r183+ on every `new THREE.Clock()` call.
 *
 * We don't instantiate `Clock` ourselves — `@react-three/fiber` 9.x
 * (current stable) creates one internally per `<Canvas>` mount. The
 * migration to `THREE.Timer` lands in R3F 10.x (still alpha).
 *
 * Uses three's `setConsoleFunction` hook so we don't touch `console.warn`
 * globally. Only the exact Clock deprecation message is suppressed; all
 * other three.js logs (including TSL stack-trace warnings) pass through
 * untouched.
 *
 * Runs in production as well as dev — the suppressed message is a pure
 * deprecation notice with no user-actionable content.
 *
 * REMOVAL: safe to delete once `@react-three/fiber` no longer constructs
 * `new THREE.Clock()`. To verify after an R3F upgrade:
 *   grep -n "new THREE.Clock" node_modules/@react-three/fiber/dist/*.js
 * No hits → delete this file and its import in components/viewer/index.tsx.
 *
 * @see https://github.com/pascalorg/editor/issues/213
 */

import { setConsoleFunction } from 'three'

// three's warn() prepends 'THREE.' to its first argument, and the Clock
// constructor passes 'THREE.Clock: ...', producing a double-prefixed
// string. Exact equality keeps the suppression surgical — if three ever
// rewords this, the filter stops matching and the message resurfaces.
const CLOCK_DEPRECATION_MESSAGE =
  'THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.'

type ConsoleMethod = 'log' | 'warn' | 'error'

// HMR-idempotent install guard. setConsoleFunction is a single-slot global
// in three, so re-evaluating this module on HMR would reinstall the hook.
const INSTALLED = Symbol.for('@pascal-app/viewer/suppress-three-clock-warning')
type GlobalWithFlag = typeof globalThis & { [INSTALLED]?: true }

if (!(globalThis as GlobalWithFlag)[INSTALLED]) {
  ;(globalThis as GlobalWithFlag)[INSTALLED] = true

  setConsoleFunction((method: ConsoleMethod, message: string, ...params: unknown[]) => {
    if (method === 'warn' && message === CLOCK_DEPRECATION_MESSAGE) {
      return
    }

    // Mirror three's default stack-trace handling so TSL warnings/errors
    // keep their clickable stack frames.
    if (method !== 'log') {
      const first = params[0] as
        | { isStackTrace?: boolean; getError?: (m: string) => Error }
        | undefined
      if (first?.isStackTrace && typeof first.getError === 'function') {
        console[method](first.getError(message))
        return
      }
    }

    console[method](message, ...params)
  })
}
