/**
 * Containment check for paths produced by `resolve()` / `join()`.
 *
 * A `${parentDir}/` string prefix is not portable: `resolve()` returns
 * backslash-separated paths on Windows, so the prefix never matches there and
 * every file that is genuinely inside the directory is reported as outside.
 * Comparing on a normalized separator keeps the check identical on every
 * platform.
 */
function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isPathInside(parentDir: string, target: string): boolean {
  return normalizeSeparators(target).startsWith(`${normalizeSeparators(parentDir)}/`)
}
