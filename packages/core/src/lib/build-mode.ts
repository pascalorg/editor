/**
 * Whether this is a development build. Reads `process.env.NODE_ENV` directly, never
 * behind `typeof process`: bundlers (Vite, Next, esbuild) replace that expression with
 * a constant, while a `typeof process` guard runs in the browser, where `process` is
 * absent, and would send production bundles down the development branch. Without a
 * bundler and without `process`, it is treated as production.
 */
export function isDevelopmentBuild(): boolean {
  try {
    return process.env.NODE_ENV !== 'production'
  } catch {
    return false
  }
}

/** Development builds outside the test runner, for warnings tests should not print. */
export function isDevelopmentOutsideTests(): boolean {
  try {
    return process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test'
  } catch {
    return false
  }
}
