/**
 * Suppresses the `THREE.Clock: This module has been deprecated` warning
 * emitted by three.js r183+ on every `new THREE.Clock()` call.
 *
 * We don't instantiate `Clock` ourselves, but `@react-three/fiber` 9.x
 * (current stable line) still creates one internally per `<Canvas>` mount.
 * The migration to `THREE.Timer` lands in R3F 10.x (still alpha at time
 * of writing).
 *
 * Uses three's official `setConsoleFunction` hook so we don't touch global
 * `console.warn` or any other library's output. Scoped to `warn` because
 * that's the channel three uses for this message; other channels fall
 * through untouched.
 *
 * **Scope:** runs in production as well as dev. The suppressed message is
 * a pure deprecation notice with no user-actionable content, so there's no
 * reason to gate on `NODE_ENV`.
 *
 * **Removal condition:** safe to delete this file and its import once
 * `@react-three/fiber` no longer constructs `new THREE.Clock()` internally.
 * To verify after an R3F upgrade, grep
 * `node_modules/@react-three/fiber/dist` for `new THREE.Clock`; if there
 * are no hits, delete this file and the side-effect import in
 * `components/viewer/index.tsx`.
 *
 * Runs as a side effect on import; must be imported before the first
 * Canvas mounts.
 */

import { setConsoleFunction } from 'three'

// Exact string three dispatches to the hook: `warn()` prepends `'THREE.'`
// to its first argument (three.core.js:1985), and the Clock constructor
// passes `'THREE.Clock: ...'`, so the final formatted message is
// double-prefixed. Exact equality (instead of `includes`) keeps the
// suppression surgical: if three ever rewords this warning, the filter
// stops matching and the message resurfaces rather than being silently
// swallowed forever — including through `warnOnce`'s dedup cache.
const CLOCK_DEPRECATION_MESSAGE =
  'THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.'

type ConsoleMethod = 'log' | 'warn' | 'error'

// HMR-idempotent install guard. `setConsoleFunction` is a single-slot
// global in three, so re-evaluating this module (dev HMR) would reinstall
// the hook every save. The guard makes install run exactly once per
// realm, which also leaves room to add hook-chaining later without
// re-entering the installer on every reload.
const INSTALLED_FLAG = Symbol.for('@pascal-app/viewer/three-clock-suppressor')
type GlobalWithFlag = typeof globalThis & { [INSTALLED_FLAG]?: true }
const globalWithFlag = globalThis as GlobalWithFlag

if (!globalWithFlag[INSTALLED_FLAG]) {
  globalWithFlag[INSTALLED_FLAG] = true

  setConsoleFunction((method: ConsoleMethod, message: string, ...params: unknown[]) => {
    if (method === 'warn' && message === CLOCK_DEPRECATION_MESSAGE) {
      return
    }

    // Mirror three's default stack-trace handling (three.core.js:1999-2002
    // and the matching `error()` branch) so TSL warnings/errors keep their
    // clickable stack frames instead of printing as `[object Object]`.
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
