import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  ItemNode,
  LevelNode,
  SiteNode,
  ZoneNode,
} from '@pascal-app/core/schema'

type Vec3 = [number, number, number]

type FixtureItem = {
  key: string
  position: Vec3
  dimensions?: Vec3
  rotationY?: number
  scale?: Vec3
  level?: 1 | 2
  attachTo?: 'wall' | 'wall-side' | 'ceiling'
}

type Trial = {
  id: string
  title: string
  items: FixtureItem[]
  minimumClearance: number | string
  expectedPairs: string[]
  level?: 1 | 2
  unscoped?: boolean
}

type ToolResult = {
  isError?: boolean
  structuredContent?: Record<string, unknown>
  content?: unknown
}

type CheckResult = {
  status: 'checked' | 'partial' | 'insufficient_evidence'
  units: 'meters'
  method: 'rotation-aware-plan-aabb'
  assessmentGraphHash: string
  minimumClearanceMeters: number
  candidateItemId: string | null
  checkedItems: Array<{
    id: string
    source: { assetId: string; uri: string; catalog: string }
    sourceDimensionsMeters: Vec3
  }>
  skippedItems: Array<{ id: string; reason: string }>
  unsupportedChecks: Array<{ check: string; reason: string }>
  collisions: Array<{
    aId: string
    bId: string
    violation: 'overlap' | 'clearance'
  }>
}

const trials: Trial[] = [
  {
    id: '01-separated',
    title: 'Separated square footprints',
    items: [item('a', [0, 0, 0]), item('b', [2, 0, 0])],
    minimumClearance: 0,
    expectedPairs: [],
  },
  {
    id: '02-x-overlap',
    title: 'Axis overlap on X',
    items: [item('a', [0, 0, 0]), item('b', [0.75, 0, 0])],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
  },
  {
    id: '03-z-overlap',
    title: 'Axis overlap on Z',
    items: [item('a', [0, 0, 0]), item('b', [0, 0, 0.75])],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
  },
  {
    id: '04-corner-overlap',
    title: 'Corner overlap',
    items: [item('a', [0, 0, 0]), item('b', [0.75, 0, 0.75])],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
  },
  {
    id: '05-edge-touch',
    title: 'Touching edges are not overlap',
    items: [item('a', [0, 0, 0]), item('b', [1, 0, 0])],
    minimumClearance: 0,
    expectedPairs: [],
  },
  {
    id: '06-clearance-fail',
    title: 'Five centimetres fails ten centimetre clearance',
    items: [item('a', [0, 0, 0]), item('b', [1.05, 0, 0])],
    minimumClearance: 0.1,
    expectedPairs: ['a:b'],
  },
  {
    id: '07-clearance-pass',
    title: 'Eleven centimetres passes ten centimetre clearance',
    items: [item('a', [0, 0, 0]), item('b', [1.11, 0, 0])],
    minimumClearance: 0.1,
    expectedPairs: [],
  },
  {
    id: '08-quarter-turn-clears-x',
    title: 'Quarter turn shortens X footprint',
    items: [
      item('a', [0, 0, 0], { dimensions: [2, 0.8, 0.5], rotationY: Math.PI / 2 }),
      item('b', [1.2, 0, 0]),
    ],
    minimumClearance: 0,
    expectedPairs: [],
  },
  {
    id: '09-quarter-turn-hits-z',
    title: 'Quarter turn lengthens Z footprint',
    items: [
      item('a', [0, 0, 0], { dimensions: [2, 0.8, 0.5], rotationY: Math.PI / 2 }),
      item('b', [0, 0, 1.1]),
    ],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
  },
  {
    id: '10-diagonal-overlap',
    title: 'Forty-five degree AABB overlap',
    items: [
      item('a', [0, 0, 0], { dimensions: [2, 0.8, 0.5], rotationY: Math.PI / 4 }),
      item('b', [1.3, 0, 0]),
    ],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
  },
  {
    id: '11-diagonal-separated',
    title: 'Forty-five degree AABB separation',
    items: [
      item('a', [0, 0, 0], { dimensions: [2, 0.8, 0.5], rotationY: Math.PI / 4 }),
      item('b', [1.5, 0, 0]),
    ],
    minimumClearance: 0,
    expectedPairs: [],
  },
  {
    id: '12-scaled-overlap',
    title: 'Positive scale changes footprint',
    items: [item('a', [0, 0, 0], { scale: [2, 1, 1] }), item('b', [1.4, 0, 0])],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
  },
  {
    id: '13-mirrored-scale',
    title: 'Negative mirror scale retains physical extent',
    items: [item('a', [0, 0, 0], { scale: [-2, 1, 1] }), item('b', [1.4, 0, 0])],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
  },
  {
    id: '14-chain',
    title: 'Three-item chain reports two pairs',
    items: [item('a', [0, 0, 0]), item('b', [0.75, 0, 0]), item('c', [1.5, 0, 0])],
    minimumClearance: 0,
    expectedPairs: ['a:b', 'b:c'],
  },
  {
    id: '15-all-pairs',
    title: 'Three overlapping items report all pairs',
    items: [item('a', [0, 0, 0]), item('b', [0.25, 0, 0]), item('c', [0.5, 0, 0])],
    minimumClearance: 0,
    expectedPairs: ['a:b', 'a:c', 'b:c'],
  },
  {
    id: '16-level-isolation',
    title: 'Coincident items on different levels do not collide',
    items: [item('a', [0, 0, 0], { level: 1 }), item('b', [0, 0, 0], { level: 2 })],
    minimumClearance: 0,
    expectedPairs: [],
    unscoped: true,
  },
  {
    id: '17-level-filter',
    title: 'Requested level excludes other-level conflicts',
    items: [
      item('a', [0, 0, 0], { level: 1 }),
      item('b', [0.5, 0, 0], { level: 1 }),
      item('c', [2, 0, 0], { level: 2 }),
      item('d', [2.5, 0, 0], { level: 2 }),
    ],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
    level: 1,
  },
  {
    id: '18-small-valid',
    title: 'Small positive dimensions remain measurable',
    items: [
      item('a', [0, 0, 0], { dimensions: [0.01, 0.01, 0.01] }),
      item('b', [0.009, 0, 0], { dimensions: [0.01, 0.01, 0.01] }),
    ],
    minimumClearance: 0,
    expectedPairs: ['a:b'],
  },
  {
    id: '19-large-separated',
    title: 'Large footprints with a gap remain separate',
    items: [
      item('a', [0, 0, 0], { dimensions: [2, 1, 2] }),
      item('b', [2.01, 0, 0], { dimensions: [2, 1, 2] }),
    ],
    minimumClearance: 0,
    expectedPairs: [],
  },
  {
    id: '20-natural-unit',
    title: 'Natural-language clearance converts to meters',
    items: [item('a', [0, 0, 0]), item('b', [1.08, 0, 0])],
    minimumClearance: '4 in',
    expectedPairs: ['a:b'],
  },
]

function item(
  key: string,
  position: Vec3,
  options: Omit<FixtureItem, 'key' | 'position'> = {},
): FixtureItem {
  return { key, position, ...options }
}

function ids(caseId: string) {
  const suffix = caseId.replaceAll('-', '_')
  return {
    site: `site_${suffix}`,
    building: `building_${suffix}`,
    level1: `level_${suffix}_1`,
    level2: `level_${suffix}_2`,
    zone1: `zone_${suffix}_1`,
  }
}

function buildScene(trial: Trial): SceneGraph {
  const nodeIds = ids(trial.id)
  const hasLevel2 = trial.items.some((entry) => entry.level === 2)
  const level1ItemIds = trial.items
    .filter((entry) => (entry.level ?? 1) === 1)
    .map((entry) => `item_${trial.id.replaceAll('-', '_')}_${entry.key}`)
  const level2ItemIds = trial.items
    .filter((entry) => entry.level === 2)
    .map((entry) => `item_${trial.id.replaceAll('-', '_')}_${entry.key}`)

  const site = SiteNode.parse({ id: nodeIds.site, children: [nodeIds.building] })
  const building = BuildingNode.parse({
    id: nodeIds.building,
    parentId: nodeIds.site,
    children: hasLevel2 ? [nodeIds.level1, nodeIds.level2] : [nodeIds.level1],
  })
  const level1 = LevelNode.parse({
    id: nodeIds.level1,
    parentId: nodeIds.building,
    level: 0,
    height: 2.7,
    children: [nodeIds.zone1, ...level1ItemIds],
  })
  const zone1 = ZoneNode.parse({
    id: nodeIds.zone1,
    parentId: nodeIds.level1,
    name: 'Measured room 6 m x 5 m',
    spaceRole: 'room',
    enclosureStatus: 'enclosed',
    polygon: [
      [-3, -2.5],
      [3, -2.5],
      [3, 2.5],
      [-3, 2.5],
    ],
  })
  const nodes: AnyNode[] = [site, building, level1, zone1]

  if (hasLevel2) {
    nodes.push(
      LevelNode.parse({
        id: nodeIds.level2,
        parentId: nodeIds.building,
        level: 1,
        height: 2.7,
        children: level2ItemIds,
      }),
    )
  }

  for (const entry of trial.items) {
    const levelId = entry.level === 2 ? nodeIds.level2 : nodeIds.level1
    nodes.push(
      ItemNode.parse({
        id: `item_${trial.id.replaceAll('-', '_')}_${entry.key}`,
        parentId: levelId,
        name: `Fixture ${entry.key.toUpperCase()}`,
        position: entry.position,
        rotation: [0, entry.rotationY ?? 0, 0],
        scale: entry.scale ?? [1, 1, 1],
        asset: {
          id: `fixture-${entry.key}`,
          name: `Fixture ${entry.key.toUpperCase()}`,
          category: 'furniture',
          thumbnail: '',
          source: 'library',
          src: `https://assets.example.test/w02/${entry.key}.glb`,
          dimensions: entry.dimensions ?? [1, 1, 1],
          ...(entry.attachTo ? { attachTo: entry.attachTo } : {}),
        },
      }),
    )
  }

  return {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [nodeIds.site as AnyNodeId],
  }
}

function normalizedPairs(result: CheckResult, trial: Trial): string[] {
  const prefix = `item_${trial.id.replaceAll('-', '_')}_`
  return result.collisions
    .map(({ aId, bId }) => [aId.replace(prefix, ''), bId.replace(prefix, '')].sort().join(':'))
    .sort()
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function requireSuccess<T>(result: ToolResult, label: string): T {
  assert(!result.isError, `${label} returned isError=true: ${JSON.stringify(result.content)}`)
  assert(result.structuredContent, `${label} omitted structuredContent`)
  return result.structuredContent as T
}

function inheritedEnv(databasePath: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, PASCAL_DB_PATH: databasePath }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

async function connect(binPath: string, databasePath: string) {
  let stderr = ''
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath, '--stdio'],
    env: inheritedEnv(databasePath),
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const client = new Client({ name: 'pascal-w02-furniture-fit', version: '1.0.0' })
  await client.connect(transport)
  return { client, transport, stderr: () => stderr }
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult
}

async function saveAndLoadTrial(client: Client, trial: Trial) {
  const sceneId = `w02-${trial.id}`
  requireSuccess(
    await call(client, 'create_project', { id: sceneId, name: `W02 ${trial.title}` }),
    `${trial.id} create_project`,
  )
  const save = requireSuccess<{ version: number; graphHash: string }>(
    await call(client, 'save_scene', {
      id: sceneId,
      projectId: sceneId,
      name: `W02 ${trial.title}`,
      includeCurrentScene: false,
      graph: buildScene(trial),
      saveMode: 'checkpoint',
      publish: true,
    }),
    `${trial.id} save_scene`,
  )
  const load = requireSuccess<{ version: number; graphHash: string; defaultLevelId: string }>(
    await call(client, 'load_scene', { id: sceneId }),
    `${trial.id} load_scene`,
  )
  assert(save.graphHash === load.graphHash, `${trial.id} graph hash changed across save/load`)
  assert(save.version === load.version, `${trial.id} version changed across save/load`)
  return { sceneId, graphHash: save.graphHash, levelId: ids(trial.id).level1 }
}

async function main() {
  const startedAt = new Date()
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const packageDir = resolve(scriptDir, '..')
  const repoDir = resolve(packageDir, '../..')
  const binPath = resolve(packageDir, 'dist/bin/pascal-mcp.js')
  assert(existsSync(binPath), `Missing ${binPath}; run \`bun run build\` in packages/mcp first.`)

  const workingDir = mkdtempSync(join(tmpdir(), 'pascal-w02-'))
  const outputDir =
    process.env.PASCAL_W02_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(), 'pascal-mcp-furniture-fit-'))
  const databasePath = join(workingDir, 'journey.db')
  mkdirSync(outputDir, { recursive: true })

  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim()
  const implementationFiles = [
    'packages/mcp/src/tools/annotations.ts',
    'packages/mcp/src/tools/check-collisions.ts',
    'packages/mcp/src/tools/door-clearance.ts',
    'packages/mcp/src/tools/export-json.ts',
    'packages/mcp/src/tools/find-nodes.ts',
    'packages/mcp/src/tools/get-node.ts',
    'packages/mcp/src/tools/get-scene.ts',
    'packages/mcp/src/tools/layout-clearance.ts',
    'packages/mcp/src/tools/measure.ts',
    'packages/mcp/src/tools/export-glb.ts',
    'packages/mcp/src/tools/scene-lifecycle/list-scenes.ts',
    'packages/mcp/src/tools/scene-query.ts',
    'packages/mcp/src/tools/validate-scene.ts',
    'packages/mcp/scripts/furniture-fit-journey.ts',
  ]
  const implementationHash = createHash('sha256')
  for (const path of implementationFiles) {
    implementationHash.update(path)
    implementationHash.update('\0')
    implementationHash.update(readFileSync(resolve(repoDir, path)))
    implementationHash.update('\0')
  }
  const compiledFiles = [
    'packages/mcp/dist/bin/pascal-mcp.js',
    'packages/mcp/dist/tools/annotations.js',
    'packages/mcp/dist/tools/check-collisions.js',
    'packages/mcp/dist/tools/door-clearance.js',
    'packages/mcp/dist/tools/export-json.js',
    'packages/mcp/dist/tools/find-nodes.js',
    'packages/mcp/dist/tools/get-node.js',
    'packages/mcp/dist/tools/get-scene.js',
    'packages/mcp/dist/tools/layout-clearance.js',
    'packages/mcp/dist/tools/measure.js',
    'packages/mcp/dist/tools/export-glb.js',
    'packages/mcp/dist/tools/scene-lifecycle/list-scenes.js',
    'packages/mcp/dist/tools/scene-query.js',
    'packages/mcp/dist/tools/validate-scene.js',
  ]
  const compiledHash = createHash('sha256')
  for (const path of compiledFiles) {
    compiledHash.update(path)
    compiledHash.update('\0')
    compiledHash.update(readFileSync(resolve(repoDir, path)))
    compiledHash.update('\0')
  }
  const results: Array<Record<string, unknown>> = []
  let firstConnection: Awaited<ReturnType<typeof connect>> | null = null
  let secondConnection: Awaited<ReturnType<typeof connect>> | null = null

  try {
    firstConnection = await connect(binPath, databasePath)
    const toolList = await firstConnection.client.listTools()
    const checkCollisionsTool = toolList.tools.find((tool) => tool.name === 'check_collisions')
    assert(checkCollisionsTool, 'tool not registered')
    assert(
      checkCollisionsTool.annotations?.readOnlyHint === true &&
        checkCollisionsTool.annotations.idempotentHint === true &&
        checkCollisionsTool.annotations.destructiveHint === false,
      'check_collisions read-only annotations missing',
    )
    const listScenesTool = toolList.tools.find((tool) => tool.name === 'list_scenes')
    assert(listScenesTool?.annotations?.readOnlyHint === true, 'list_scenes read-only hint missing')

    for (const trial of trials) {
      const trialStarted = performance.now()
      const persisted = await saveAndLoadTrial(firstConnection.client, trial)
      const nodeIds = ids(trial.id)
      const measure = requireSuccess<{
        areaSqMeters: number
        units: string
        areaUnits: string
      }>(
        await call(firstConnection.client, 'measure', {
          fromId: nodeIds.zone1,
          toId: nodeIds.zone1,
        }),
        `${trial.id} measure`,
      )
      assert(measure.areaSqMeters === 30, `${trial.id} expected 30 m2 room area`)
      assert(measure.units === 'meters', `${trial.id} distance unit mismatch`)
      assert(measure.areaUnits === 'square_meters', `${trial.id} area unit mismatch`)

      const check = requireSuccess<CheckResult>(
        await call(firstConnection.client, 'check_collisions', {
          ...(trial.unscoped
            ? {}
            : { levelId: trial.level === 2 ? ids(trial.id).level2 : persisted.levelId }),
          minimumClearance: trial.minimumClearance,
          floorOnly: true,
        }),
        `${trial.id} check_collisions`,
      )
      assert(check.status === 'checked', `${trial.id} expected complete footprint evidence`)
      assert(check.units === 'meters', `${trial.id} check unit mismatch`)
      assert(check.method === 'rotation-aware-plan-aabb', `${trial.id} method mismatch`)
      assert(
        /^[a-f0-9]{64}$/.test(check.assessmentGraphHash),
        `${trial.id} missing assessed graph hash`,
      )
      const actualPairs = normalizedPairs(check, trial)
      assert(
        JSON.stringify(actualPairs) === JSON.stringify([...trial.expectedPairs].sort()),
        `${trial.id} expected ${trial.expectedPairs.join(',') || 'no pairs'}, got ${actualPairs.join(',') || 'none'}`,
      )
      assert(
        check.unsupportedChecks
          .map((entry) => entry.check)
          .sort()
          .join(',') ===
          [
            'delivery_path',
            'door_swing_envelope',
            'hosted_item_world_transform',
            'mesh_geometry',
            'room_boundary_clearance',
            'vertical_clearance',
          ]
            .sort()
            .join(','),
        `${trial.id} unsupported-check disclosure changed`,
      )
      if (trial.id === '01-separated') {
        const first = check.checkedItems[0]
        assert(first?.source.uri.endsWith('/a.glb'), 'item source URI missing')
        assert(first.source.catalog === 'library', 'item catalog source missing')
        assert(first.sourceDimensionsMeters.join(',') === '1,1,1', 'source dimensions missing')
      }

      results.push({
        id: trial.id,
        title: trial.title,
        status: 'passed',
        expectedPairs: trial.expectedPairs,
        actualPairs,
        minimumClearanceMeters: check.minimumClearanceMeters,
        graphHash: persisted.graphHash,
        assessmentGraphHash: check.assessmentGraphHash,
        elapsedMs: Math.round((performance.now() - trialStarted) * 100) / 100,
      })
    }

    requireSuccess(
      await call(firstConnection.client, 'load_scene', { id: 'w02-01-separated' }),
      'candidate load_scene',
    )
    const beforeCandidate = requireSuccess<{ json: string }>(
      await call(firstConnection.client, 'export_json', {}),
      'candidate before export_json',
    )
    const candidateCheck = requireSuccess<CheckResult>(
      await call(firstConnection.client, 'check_collisions', {
        floorOnly: true,
        minimumClearance: '10 cm',
        candidate: {
          id: 'prospective-sofa',
          name: 'Prospective sofa',
          levelId: ids('01-separated').level1,
          position: ['75 cm', 0, 0],
          dimensions: ['1 m', '80 cm', '1 m'],
          rotationY: '0 deg',
          source: {
            assetId: 'retailer-sofa-42',
            uri: 'https://retailer.example.test/products/sofa-42',
          },
        },
      }),
      'candidate check_collisions',
    )
    assert(candidateCheck.candidateItemId === 'prospective-sofa', 'candidate id missing')
    assert(
      candidateCheck.checkedItems.find((entry) => entry.id === 'prospective-sofa')?.source
        .catalog === 'supplied',
      'candidate source missing',
    )
    assert(
      candidateCheck.collisions.some(
        (collision) =>
          [collision.aId, collision.bId].includes('prospective-sofa') &&
          [collision.aId, collision.bId].some((id) => id.endsWith('_a')),
      ),
      'candidate overlap was not reported',
    )
    const afterCandidate = requireSuccess<{ json: string }>(
      await call(firstConnection.client, 'export_json', {}),
      'candidate after export_json',
    )
    assert(
      afterCandidate.json === beforeCandidate.json,
      'read-only candidate check changed the scene graph',
    )

    const invalidCandidate = await call(firstConnection.client, 'check_collisions', {
      candidate: {
        levelId: ids('01-separated').level1,
        position: [0, 0, 0],
        dimensions: [0, 1, 1],
      },
    })
    assert(invalidCandidate.isError, 'zero candidate width must be rejected')

    const unknownLevel = await call(firstConnection.client, 'check_collisions', {
      levelId: 'level_missing',
    })
    assert(unknownLevel.isError, 'unknown level must not report a clean collision result')

    const zeroTrial: Trial = {
      id: 'unsupported-zero-footprint',
      title: 'Zero-width footprint',
      items: [item('a', [0, 0, 0], { dimensions: [0, 1, 1] })],
      minimumClearance: 0,
      expectedPairs: [],
    }
    await saveAndLoadTrial(firstConnection.client, zeroTrial)
    const zeroCheck = requireSuccess<CheckResult>(
      await call(firstConnection.client, 'check_collisions', { floorOnly: true }),
      'zero footprint check',
    )
    assert(zeroCheck.status === 'insufficient_evidence', 'zero footprint must not report success')
    assert(
      zeroCheck.skippedItems[0]?.reason === 'non_positive_plan_dimensions',
      'zero footprint reason mismatch',
    )

    const unknownScaleTrial: Trial = {
      id: 'unsupported-unknown-scale',
      title: 'Missing source dimensions',
      items: [item('a', [0, 0, 0])],
      minimumClearance: 0,
      expectedPairs: [],
    }
    const unknownScaleScene = buildScene(unknownScaleTrial)
    const unknownScaleId = `item_${unknownScaleTrial.id.replaceAll('-', '_')}_a`
    delete (
      unknownScaleScene.nodes[unknownScaleId as AnyNodeId] as Extract<AnyNode, { type: 'item' }>
    ).asset.dimensions
    requireSuccess(
      await call(firstConnection.client, 'save_scene', {
        id: 'w02-unsupported-unknown-scale',
        name: unknownScaleTrial.title,
        includeCurrentScene: false,
        graph: unknownScaleScene,
        saveMode: 'checkpoint',
      }),
      'unknown-scale save_scene',
    )
    requireSuccess(
      await call(firstConnection.client, 'load_scene', { id: 'w02-unsupported-unknown-scale' }),
      'unknown-scale load_scene',
    )
    const unknownScaleCheck = requireSuccess<CheckResult>(
      await call(firstConnection.client, 'check_collisions', { floorOnly: true }),
      'unknown-scale check_collisions',
    )
    assert(
      unknownScaleCheck.status === 'insufficient_evidence',
      'missing dimensions must not inherit a plausible one-meter footprint',
    )
    assert(
      unknownScaleCheck.skippedItems[0]?.reason === 'missing_dimensions',
      'missing dimensions reason mismatch',
    )

    const tiltedTrial: Trial = {
      id: 'unsupported-tilted-footprint',
      title: 'Tilted footprint',
      items: [item('a', [0, 0, 0])],
      minimumClearance: 0,
      expectedPairs: [],
    }
    const tiltedScene = buildScene(tiltedTrial)
    const tiltedId = `item_${tiltedTrial.id.replaceAll('-', '_')}_a`
    ;(tiltedScene.nodes[tiltedId as AnyNodeId] as Extract<AnyNode, { type: 'item' }>).rotation = [
      0.2, 0, 0,
    ]
    requireSuccess(
      await call(firstConnection.client, 'save_scene', {
        id: 'w02-unsupported-tilted-footprint',
        name: tiltedTrial.title,
        includeCurrentScene: false,
        graph: tiltedScene,
        saveMode: 'checkpoint',
      }),
      'tilted save_scene',
    )
    requireSuccess(
      await call(firstConnection.client, 'load_scene', { id: 'w02-unsupported-tilted-footprint' }),
      'tilted load_scene',
    )
    const tiltedCheck = requireSuccess<CheckResult>(
      await call(firstConnection.client, 'check_collisions', { floorOnly: true }),
      'tilted footprint check',
    )
    assert(tiltedCheck.status === 'insufficient_evidence', 'tilted footprint must be unsupported')
    assert(tiltedCheck.skippedItems[0]?.reason === 'non_planar_rotation', 'tilted reason mismatch')

    const invalidClearance = await call(firstConnection.client, 'check_collisions', {
      minimumClearance: 'Infinity',
    })
    assert(invalidClearance.isError, 'non-finite clearance must be rejected at the MCP boundary')

    const glb = await call(firstConnection.client, 'export_glb', {})
    assert(glb.isError, 'unsupported GLB export must set isError=true')
    assert(
      glb.structuredContent?.status === 'not_implemented',
      'unsupported GLB export must retain structured status',
    )

    await firstConnection.client.close()
    firstConnection = null

    secondConnection = await connect(binPath, databasePath)
    const reloaded = requireSuccess<{ version: number; graphHash: string }>(
      await call(secondConnection.client, 'load_scene', { id: 'w02-01-separated' }),
      'reconnect load_scene',
    )
    const original = results.find((entry) => entry.id === '01-separated')
    assert(reloaded.version === 1, 'reconnected scene revision mismatch')
    assert(reloaded.graphHash === original?.graphHash, 'reconnected graph hash mismatch')
    const afterReconnect = requireSuccess<CheckResult>(
      await call(secondConnection.client, 'check_collisions', {
        levelId: ids('01-separated').level1,
        floorOnly: true,
      }),
      'reconnect check_collisions',
    )
    assert(afterReconnect.collisions.length === 0, 'reconnected result changed')
    assert(
      afterReconnect.assessmentGraphHash === original?.assessmentGraphHash,
      'reconnected assessed graph hash changed',
    )

    const finishedAt = new Date()
    const report = {
      schemaVersion: 1,
      journey: 'W02 furniture footprint-fit assessment',
      status: 'passed',
      supportedTrials: { passed: results.length, total: trials.length },
      transport: 'MCP stdio client -> compiled pascal-mcp server',
      storage: 'SQLite file reused across a full server reconnect',
      sourceRevision: revision,
      implementationHash: implementationHash.digest('hex'),
      compiledHash: compiledHash.digest('hex'),
      implementationFiles,
      compiledFiles,
      binary: binPath,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt.getTime(),
      evidence: {
        roomAreaSqMeters: 30,
        distanceUnits: 'meters',
        areaUnits: 'square_meters',
        footprintMethod: 'rotation-aware-plan-aabb',
        itemSourceReturned: true,
        suppliedCandidateCheckedWithoutMutation: true,
        invalidCandidateDimensionsRejected: true,
        unknownLevelRejected: true,
        readOnlyToolAnnotationsAdvertised: true,
        persistenceAfterReconnect: true,
        invalidFootprintsReturnInsufficientEvidence: true,
        missingDimensionsReturnInsufficientEvidence: true,
        nonFiniteClearanceRejected: true,
        unsupportedChecksDisclosed: [
          'vertical_clearance',
          'room_boundary_clearance',
          'door_swing_envelope',
          'delivery_path',
          'mesh_geometry',
          'hosted_item_world_transform',
        ],
        unsupportedGlbIsToolError: true,
      },
      expectationSource:
        'Frozen case-by-case expected pair lists in this harness; no production collision helper computes expectations.',
      trials: results,
    }
    const reportPath = join(outputDir, 'w02-furniture-fit-report.json')
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    const notesPath = join(outputDir, 'notes.md')
    writeFileSync(
      notesPath,
      `# W02 MCP furniture-fit journey\n\nRun from the public editor checkout:\n\n\`\`\`bash\ncd packages/core && bun run build\ncd ../mcp && bun run build && bun run scripts/furniture-fit-journey.ts\n\`\`\`\n\nThe suite runs 20 frozen supported footprint cases through a real MCP stdio client/server pair, persists each scene in a temporary SQLite store, restarts the server, and verifies revision/hash stability. It also checks a supplied candidate through MCP without changing the scene, rejects invalid dimensions and non-finite clearance, reports missing or unsuitable footprint evidence, discloses unsupported room-boundary, height, door-swing, delivery-path, and mesh checks, and returns a truthful \`export_glb\` failure.\n`,
    )
    console.log(
      `[w02] ${results.length}/${trials.length} supported trials passed; reconnect and unsupported-path checks passed`,
    )
    console.log(`[w02] report: ${reportPath}`)
    console.log(`[w02] notes: ${notesPath}`)
  } catch (error) {
    const diagnostics = [firstConnection?.stderr(), secondConnection?.stderr()].filter(Boolean)
    if (diagnostics.length > 0) console.error(diagnostics.join('\n'))
    throw error
  } finally {
    await firstConnection?.client.close().catch(() => undefined)
    await secondConnection?.client.close().catch(() => undefined)
    rmSync(workingDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('[w02] failed:', error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
})
