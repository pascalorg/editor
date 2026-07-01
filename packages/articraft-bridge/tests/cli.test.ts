import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildModelDataFromUrdf, modernCliInvocation, resolveRepoRoot } from '../src/cli'

let tempRoot: string | undefined
const originalCwd = process.cwd()
const originalArticraftRepoRoot = process.env.ARTICRAFT_REPO_ROOT

function makeArticraftCheckout(repoRoot: string) {
  const bridgeDir = path.join(repoRoot, 'articraft', 'python')
  mkdirSync(bridgeDir, { recursive: true })
  writeFileSync(path.join(bridgeDir, 'bridge.py'), '', 'utf8')
}

function makeModernArticraftCheckout(repoRoot: string) {
  const cliDir = path.join(repoRoot, 'articraft', 'cli')
  mkdirSync(cliDir, { recursive: true })
  writeFileSync(path.join(cliDir, 'main.py'), '', 'utf8')
}

function makeModernArticraftVenv(repoRoot: string) {
  const pythonPath = path.join(
    repoRoot,
    'articraft',
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  )
  mkdirSync(path.dirname(pythonPath), { recursive: true })
  writeFileSync(pythonPath, '', 'utf8')
  return pythonPath
}

afterEach(() => {
  process.chdir(originalCwd)
  if (originalArticraftRepoRoot === undefined) {
    delete process.env.ARTICRAFT_REPO_ROOT
  } else {
    process.env.ARTICRAFT_REPO_ROOT = originalArticraftRepoRoot
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

describe('resolveRepoRoot', () => {
  test('finds an Articraft checkout above a bundled app working directory', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'pascal-articraft-root-'))
    makeArticraftCheckout(tempRoot)
    const bundledCwd = path.join(tempRoot, 'apps', 'editor', '.next', 'dev', 'server', 'chunks')
    mkdirSync(bundledCwd, { recursive: true })

    delete process.env.ARTICRAFT_REPO_ROOT
    process.chdir(bundledCwd)

    expect(resolveRepoRoot()).toBe(path.join(tempRoot, 'articraft'))
  })

  test('rejects an explicit root without the bridge script or modern CLI', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'pascal-articraft-invalid-'))

    expect(() => resolveRepoRoot(tempRoot)).toThrow('Expected python')
  })

  test('accepts a modern Articraft checkout with cli/main.py', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'pascal-articraft-modern-'))
    makeModernArticraftCheckout(tempRoot)

    delete process.env.ARTICRAFT_REPO_ROOT
    expect(resolveRepoRoot(path.join(tempRoot, 'articraft'))).toBe(path.join(tempRoot, 'articraft'))
  })

  test('uses modern CLI venv python instead of uv when available', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'pascal-articraft-modern-venv-'))
    makeModernArticraftCheckout(tempRoot)
    const pythonPath = makeModernArticraftVenv(tempRoot)
    const repoRoot = path.join(tempRoot, 'articraft')

    expect(modernCliInvocation(repoRoot, ['generate', 'robot'])).toEqual({
      command: pythonPath,
      args: [path.join(repoRoot, 'cli', 'main.py'), 'generate', 'robot'],
    })
  })
})

describe('buildModelDataFromUrdf', () => {
  test('uses OBJ bounds and global URDF material colors for mesh visuals', () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'pascal-articraft-urdf-'))
    const meshesDir = path.join(tempRoot, 'assets', 'meshes')
    mkdirSync(meshesDir, { recursive: true })
    writeFileSync(
      path.join(meshesDir, 'link.obj'),
      ['v 0 0 0', 'v 2 4 6', 'f 1 2 2'].join('\n'),
      'utf8',
    )
    const urdfPath = path.join(tempRoot, 'model.urdf')
    writeFileSync(
      urdfPath,
      `<robot name="bounds_test">
        <material name="orange"><color rgba="0.9 0.4 0.1 1" /></material>
        <link name="base">
          <visual>
            <origin xyz="1 1 1" rpy="0 0 0" />
            <geometry><mesh filename="assets/meshes/link.obj" /></geometry>
            <material name="orange" />
          </visual>
        </link>
      </robot>`,
      'utf8',
    )

    const parsed = buildModelDataFromUrdf(urdfPath)
    const visual = parsed.links[0]!.visuals[0]!

    expect(visual.geometry.type).toBe('mesh')
    expect(visual.geometry.params).toEqual({ sx: 2, sy: 4, sz: 6 })
    expect(visual.origin.xyz).toEqual([2, 3, 4])
    expect(visual.material?.rgba).toEqual([0.9, 0.4, 0.1, 1])
  })
})
