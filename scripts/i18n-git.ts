import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function git(args: string[]): string | undefined {
  const result = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'ignore' })
  return result.exitCode === 0 ? result.stdout.toString() : undefined
}

/**
 * The revision a change is compared with. In a pull_request CI run the
 * checkout is GitHub's merge commit, whose first parent is the base tip;
 * locally it is the merge base with origin/main. `I18N_BASE_REF` overrides.
 */
export function baseRevision(): string | undefined {
  const requested =
    process.env.I18N_BASE_REF ??
    (process.env.GITHUB_EVENT_NAME === 'pull_request'
      ? 'HEAD^1'
      : git(['merge-base', 'HEAD', 'origin/main'])?.trim())
  if (!requested) return undefined
  const revision = git(['rev-parse', '--verify', '--quiet', `${requested}^{commit}`])?.trim()
  if (!revision) {
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      throw new Error(`Base revision ${requested} is not available; fetch it before i18n:check`)
    }
    return undefined
  }
  return revision === git(['rev-parse', 'HEAD'])?.trim() ? undefined : revision
}

export function readAtRevision(revision: string, path: string): string | undefined {
  return git(['show', `${revision}:${relative(ROOT, path)}`])
}

/** The newest `v*` release tag reachable from HEAD, as a commit. */
export function lastReleaseTag(): string | undefined {
  const tag = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD'])?.trim()
  return tag ? git(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`])?.trim() : undefined
}
