import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Hosting panels lose their environment variables on redeploy, which takes the
 * database down with them. Reading the same settings from a file lets them
 * survive a release.
 *
 * Files are read in order and never overwrite a variable that is already set,
 * so a real environment variable always wins and the panel stays authoritative
 * when it is configured.
 *
 * `~/.digitaltwin.env` is the one that outlives a deploy: the app directory is
 * replaced wholesale on every release, so a file committed next to the app is
 * only as durable as the release that carried it.
 */
export function candidateEnvFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.DIGITALTWIN_ENV_FILE?.trim()
  const home = env.HOME?.trim() || homedir()
  return [
    ...(explicit ? [explicit] : []),
    join(process.cwd(), '.env'),
    ...(home ? [join(home, '.digitaltwin.env')] : []),
  ]
}

/**
 * Parses the `KEY=value` subset that hosting panels and `.env` files agree on:
 * blank lines and `#` comments are skipped, a leading `export` is tolerated,
 * and a wrapping pair of matching quotes is removed. Values are not expanded —
 * a `$` in a password is a literal `$`.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Loads the candidate files into `process.env`. Returns the files that were
 * read and how many variables each contributed — never the values, which are
 * credentials.
 */
export function loadEnvFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const loaded: string[] = []
  for (const path of candidateEnvFiles(env)) {
    let contents: string
    try {
      contents = readFileSync(path, 'utf8')
    } catch {
      continue // Absent or unreadable: the next candidate, or the panel, covers it.
    }
    let applied = 0
    for (const [key, value] of Object.entries(parseEnvFile(contents))) {
      if (env[key] !== undefined && env[key] !== '') continue
      env[key] = value
      applied++
    }
    loaded.push(`${path} (${applied})`)
  }
  return loaded
}
