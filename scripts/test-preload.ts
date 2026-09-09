import { mock } from 'bun:test'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as core from '../packages/core/src/index'

// Source consumers need the current core API even when package dists are stale.
const root = resolve(import.meta.dir, '..')
const paths = new Set(
  ['core', 'viewer', 'nodes', 'editor'].map((name) =>
    fileURLToPath(
      import.meta.resolve(
        '@pascal-app/core',
        pathToFileURL(resolve(root, `packages/${name}/src/index.ts`)).href,
      ),
    ),
  ),
)
for (const path of paths) mock.module(path, () => core)
