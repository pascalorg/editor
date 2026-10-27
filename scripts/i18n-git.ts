import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `I18N_ROOT` points the checks at another checkout (tests use a temporary repository). */
const ROOT = process.env.I18N_ROOT
  ? resolve(process.env.I18N_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')

function git(args: string[]): string | undefined {
  const result = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'ignore' })
  return result.exitCode === 0 ? result.stdout.toString() : undefined
}

/**
 * The revision a change is compared with. In a pull_request CI run the
 * checkout is GitHub's merge commit, whose first parent is the base tip; on a
 * push CI sets `I18N_BASE_REF` to `github.event.before`, covering every commit
 * of the push; locally it is the merge base with origin/main.
 */
export function baseRevision(): string | undefined {
  const configured = process.env.I18N_BASE_REF?.trim()
  // A push that creates a branch reports an all-zero "before" commit.
  const requested =
    (configured && !/^0+$/.test(configured) ? configured : undefined) ??
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

/**
 * The newest release tag of `pkg` reachable from HEAD. The release workflow
 * tags every package `@pascal-app/<pkg>@<version>`.
 */
export function lastReleaseTag(pkg: string): { tag: string; revision: string } | undefined {
  const tag = git([
    'describe',
    '--tags',
    '--abbrev=0',
    '--match',
    `@pascal-app/${pkg}@*`,
    'HEAD',
  ])?.trim()
  const revision = tag
    ? git(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`])?.trim()
    : undefined
  return tag && revision ? { tag, revision } : undefined
}

export function resolveRevision(ref: string): string | undefined {
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])?.trim()
}

export function headRevision(): string | undefined {
  return resolveRevision('HEAD')
}

/** The oldest commit on HEAD's history that added `path`. */
export function firstCommitWith(path: string): string | undefined {
  const added = git(['log', '--diff-filter=A', '--format=%H', 'HEAD', '--', relative(ROOT, path)])
    ?.trim()
    .split('\n')
    .filter(Boolean)
  return added?.at(-1)
}
