import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Bun from 'bun'

test('scene migrations import in Node without stores, React, Three.js or Zustand', async () => {
  const cache = join(import.meta.dir, '.turbo')
  mkdirSync(cache, { recursive: true })
  const directory = mkdtempSync(join(cache, 'opening-import-'))
  try {
    const bundle = join(directory, 'scene-migrations.mjs')
    const build = Bun.spawnSync([
      'bun',
      'build',
      join(import.meta.dir, 'scene-migrations.ts'),
      '--target=node',
      '--packages=external',
      `--outfile=${bundle}`,
    ])
    expect({ code: build.exitCode, error: build.stderr.toString() }).toEqual({ code: 0, error: '' })
    expect(readFileSync(bundle, 'utf8')).not.toMatch(
      /from ["'](?:@react-three\/[^"']+|react(?:-dom)?|three|zustand)["']/,
    )
    const probe = Bun.spawnSync(
      [
        'node',
        '--input-type=module',
        '-e',
        `
      const { ensureSceneOpenings, reconcileStructureOnLoad } = await import(process.argv[1]);
      const nodes = {};
      if (ensureSceneOpenings(nodes).nodes !== nodes) throw new Error('No-op identity changed');
      if (reconcileStructureOnLoad(nodes).nodes !== nodes) throw new Error('Structure no-op identity changed');
    `,
        pathToFileURL(bundle).href,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    expect({ code: probe.exitCode, error: probe.stderr.toString() }).toEqual({ code: 0, error: '' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('opening repair settles another stair support change in one pure idempotent pass', async () => {
  const { BuildingNode, LevelNode, SlabNode, StairNode, StairSegmentNode } = await import(
    '../schema'
  )
  const { ensureSceneOpenings, reconcileStructureOnLoad } = await import('./scene-migrations')
  const building = BuildingNode.parse({})
  const levels = [0, 1, 2].map((level) =>
    LevelNode.parse({ parentId: building.id, level, height: 3 }),
  )
  const polygon: [number, number][] = [
    [-5, -5],
    [5, -5],
    [5, 10],
    [-5, 10],
  ]
  const slabs = levels
    .slice(1)
    .map((level) => SlabNode.parse({ parentId: level.id, elevation: 0.4, polygon }))
  const stairs = levels.slice(0, 2).map((level, i) =>
    StairNode.parse({
      parentId: level.id,
      fromLevelId: level.id,
      toLevelId: levels[i + 1]!.id,
      slabOpeningMode: 'destination',
      position: [0, 0, 0],
    }),
  )
  const segments = stairs.map((stair) =>
    StairSegmentNode.parse({ parentId: stair.id, height: 1, length: 4, width: 1 }),
  )
  building.children = levels.map((level) => level.id)
  for (const [i, level] of levels.entries()) {
    level.children = [
      ...(stairs[i] ? [stairs[i]!.id] : []),
      ...(slabs[i - 1] ? [slabs[i - 1]!.id] : []),
    ]
  }
  for (const [i, stair] of stairs.entries()) stair.children = [segments[i]!.id]
  const nodes = Object.fromEntries(
    [building, ...levels, ...slabs, ...stairs, ...segments].map((node) => [node.id, node]),
  )
  const bytes = JSON.stringify(nodes)
  const first = reconcileStructureOnLoad(nodes)
  expect(JSON.stringify(nodes)).toBe(bytes)
  expect((first.nodes[segments[1]!.id] as (typeof segments)[number]).height).toBeCloseTo(3)
  expect(first.changed).toBe(true)
  const second = reconcileStructureOnLoad(first.nodes)
  expect(second.nodes).toBe(first.nodes)
  expect(second.changed).toBe(false)
  expect(ensureSceneOpenings(second.nodes).updates).toEqual([])
})
