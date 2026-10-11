import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { AGENT_TOOL_CONTRACTS } from '../agent-tools'
import { isAgentRefusal } from '../agent-tools/refusal'
import { slotPaintMaterial } from '../lib/slots'
import { ColumnNode, type SceneMaterial } from '../schema'
import {
  EXPECTED_MOUNTAIN_MATERIAL,
  expectPreserved,
  MOUNTAIN_MATERIAL,
  MOUNTAIN_NAME,
  mountainPaint,
  nativeMaterialScene,
  nativePaintReadback,
} from './__fixtures__/native-materials'
import { applySceneChanges } from './apply-changes'
import { AGENT_OPERATIONS } from './index'
import type { AgentContext, SceneChanges, SceneNodes } from './types'

// Contract v1.1 provenance is in the shared fixture. No paint or mutation oracle is mocked.
const contract = (name: string) =>
  z.object(AGENT_TOOL_CONTRACTS.find((tool) => tool.name === name)!.input)
function run(
  name: 'paint' | 'run_batch',
  nodes: SceneNodes,
  input: unknown,
  materials?: Readonly<Record<string, SceneMaterial>>,
) {
  return AGENT_OPERATIONS[name](
    nodes,
    contract(name).parse(input) as never,
    {
      activeLevelId: 'level_materials',
      ...(materials === undefined ? {} : { materials }),
    } as AgentContext,
  )
}
const registryAfter = (
  materials: Readonly<Record<string, SceneMaterial>>,
  changes?: SceneChanges,
) => ({
  ...materials,
  ...Object.fromEntries((changes?.materials ?? []).map((material) => [material.id, material])),
})
function refusal(run: () => unknown) {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(isAgentRefusal(thrown)).toBe(true)
  return thrown as Error & { code: string }
}

describe('native custom paint: contract v1.1', () => {
  test('scripted column with no default shaft slot refuses a new dangling finish, but preserves a persisted-ref no-op', () => {
    // Contract v1.3: legitimate script-manifest slots are not required to use "shaft".
    const fixture = nativeMaterialScene()
    const column = ColumnNode.parse({
      id: 'column_material_script',
      parentId: fixture.level.id,
      source: {
        kind: 'script',
        script: 'a'.repeat(64),
        artifact: 'b'.repeat(64),
        manifest: {
          bounds: { min: [-0.2, 0, -0.2], max: [0.2, 3, 0.2] },
          triangles: 12,
          slots: [
            { id: 'stone', color: '#dddddd' },
            { id: 'band', color: '#555555' },
          ],
        },
      },
    })
    const nodes = { ...fixture.nodes, [column.id]: column }
    const before = structuredClone(nodes)
    const materials = {}
    refusal(() =>
      run('paint', nodes, { targets: [column.id], material: MOUNTAIN_MATERIAL }, materials),
    )
    expect(nodes).toEqual(before)
    expect(materials).toEqual({})

    const persisted: SceneMaterial = {
      id: 'mat_persisted',
      name: MOUNTAIN_NAME,
      material: EXPECTED_MOUNTAIN_MATERIAL,
    }
    const painted = {
      ...nodes,
      [column.id]: { ...column, slots: { stone: 'scene:mat_persisted' } },
    }
    const existing = { [persisted.id]: persisted }
    const noOp = run(
      'paint',
      painted,
      { targets: [column.id], role: 'stone', material: 'scene:mat_persisted' },
      existing,
    )
    expect(noOp.result).toMatchObject({ ok: true, finish: 'scene:mat_persisted' })
    expect(applySceneChanges(painted, noOp.changes ?? {})).toEqual(painted)
    expect(registryAfter(existing, noOp.changes)).toEqual(existing)
    expect(existing).toEqual({ [persisted.id]: persisted })
    expect(painted[column.id]!.slots).toEqual({ stone: 'scene:mat_persisted' })
  })

  test('exact PBR datablock and exterior face use one native ref; interior/openings survive', () => {
    const { nodes } = nativeMaterialScene()
    const before = structuredClone(nodes)
    const materials = {}
    const outcome = run('paint', nodes, mountainPaint(), materials)
    const after = applySceneChanges(nodes, outcome.changes!)
    const registry = registryAfter(materials, outcome.changes)
    expect(outcome.result).toMatchObject({ ok: true })
    expect(outcome.changes?.materials).toHaveLength(1)
    const { ref, datablock } = nativePaintReadback(after, registry)
    expect(datablock.name).toBe(MOUNTAIN_NAME)
    expect(outcome.result.finish).toBe(ref)
    expect(Object.keys(registry)).toHaveLength(1)
    expectPreserved(before, after)
    expect(nodes).toEqual(before)
    expect(materials).toEqual({})
    // Native eyedropper resolution follows the actual scene ref to the original PBR.
    expect(slotPaintMaterial(ref, registry)).toEqual({
      material: EXPECTED_MOUNTAIN_MATERIAL,
      materialPreset: undefined,
    })
    const reloaded = JSON.parse(JSON.stringify({ nodes: after, materials: registry }))
    nativePaintReadback(reloaded.nodes, reloaded.materials)
    expectPreserved(before, reloaded.nodes)
  })

  test('same schema deduplicates against existing registry, including reordered input keys', () => {
    const { nodes } = nativeMaterialScene()
    const first = run('paint', nodes, mountainPaint(), {})
    const after = applySceneChanges(nodes, first.changes!)
    const materials = registryAfter({}, first.changes)
    const firstRef = nativePaintReadback(after, materials).ref
    const second = run(
      'paint',
      after,
      {
        ...mountainPaint(['wall_material_east']),
        material: {
          properties: { metalness: 0, roughness: 0.86, color: '#71503a' },
          preset: 'custom',
        },
      },
      materials,
    )
    const final = applySceneChanges(after, second.changes!)
    const finalMaterials = registryAfter(materials, second.changes)
    expect(nativePaintReadback(final, finalMaterials, 'wall_material_east').ref).toBe(firstRef)
    expect(Object.keys(finalMaterials)).toHaveLength(1)
  })

  test('existing texture is retained, and different texture inputs do not deduplicate', () => {
    const { nodes } = nativeMaterialScene()
    const texture = { url: '/material/wood/existing-timber.jpg', repeat: [2, 3], scale: 0.5 }
    const outcome = run(
      'paint',
      nodes,
      { ...mountainPaint(), material: { ...MOUNTAIN_MATERIAL, texture } },
      {},
    )
    expect(outcome.changes?.materials).toHaveLength(1)
    expect(outcome.changes!.materials![0]!.material).toEqual({
      ...EXPECTED_MOUNTAIN_MATERIAL,
      texture,
    })
    const materials = registryAfter({}, outcome.changes)
    const second = run(
      'paint',
      applySceneChanges(nodes, outcome.changes!),
      {
        ...mountainPaint(['wall_material_east']),
        material: { ...MOUNTAIN_MATERIAL, texture: { ...texture, repeat: [1, 1] } },
      },
      materials,
    )
    expect(Object.keys(registryAfter(materials, second.changes))).toHaveLength(2)
    const serialized = JSON.parse(JSON.stringify(registryAfter(materials, second.changes)))
    expect(serialized[outcome.changes!.materials![0]!.id].material.texture).toEqual(texture)
  })

  test('undefined registry is an unsupported host, not permission to author an orphan', () => {
    const { nodes } = nativeMaterialScene()
    const before = structuredClone(nodes)
    const error = refusal(() => run('paint', nodes, mountainPaint()))
    expect(`${error.code} ${error.message}`).toMatch(/support|registry|host/i)
    expect(nodes).toEqual(before)
  })

  for (const [label, input] of [
    [
      'dangling material id',
      { targets: ['wall_material_south'], role: 'exterior', material: 'scene:mat_missing' },
    ],
    ['missing later target', mountainPaint(['wall_material_south', 'wall_missing'])],
    [
      'invalid later role',
      { ...mountainPaint(['wall_material_south', 'door_materials']), role: 'a' },
    ],
  ] as const) {
    test(`${label} refuses atomically without orphan registry data`, () => {
      const { nodes } = nativeMaterialScene()
      const materials = {}
      const before = structuredClone(nodes)
      refusal(() => run('paint', nodes, input, materials))
      expect(nodes).toEqual(before)
      expect(materials).toEqual({})
    })
  }

  test('existing scene ref paints without remapping or minting another material', () => {
    const { nodes } = nativeMaterialScene()
    const first = run('paint', nodes, mountainPaint(), {})
    const materials = registryAfter({}, first.changes)
    const ref = `scene:${Object.keys(materials)[0]}`
    const second = run(
      'paint',
      nodes,
      { targets: ['wall_material_south'], role: 'exterior', material: ref },
      materials,
    )
    expect(
      nativePaintReadback(
        applySceneChanges(nodes, second.changes!),
        registryAfter(materials, second.changes),
      ).ref,
    ).toBe(ref)
    expect(Object.keys(registryAfter(materials, second.changes))).toHaveLength(1)
  })

  test('material schema and name bounds validate before any operation', () => {
    const input = contract('paint')
    expect(input.safeParse({ ...mountainPaint(), materialName: 'M'.repeat(120) }).success).toBe(
      true,
    )
    for (const bad of [
      { ...mountainPaint(), materialName: 'M'.repeat(121) },
      { ...mountainPaint(), materialName: '   ' },
      { ...mountainPaint(), material: { properties: { roughness: 1.01 } } },
      { ...mountainPaint(), material: { properties: { metalness: -0.01 } } },
      { ...mountainPaint(), material: { properties: { roughness: '0.86' } } },
      { ...mountainPaint(), material: null },
    ])
      expect(input.safeParse(bad).success).toBe(false)
  })

  test('run_batch carries upserts and a later call sees the first material for dedupe', () => {
    const { nodes } = nativeMaterialScene()
    const outcome = run(
      'run_batch',
      nodes,
      {
        calls: [
          { tool: 'paint', input: mountainPaint() },
          { tool: 'paint', input: mountainPaint(['wall_material_east']) },
        ],
      },
      {},
    )
    expect(outcome.result).toMatchObject({ status: 'applied', applied: 2, refused: 0 })
    const materials = registryAfter({}, outcome.changes)
    const after = applySceneChanges(nodes, outcome.changes!)
    expect(Object.keys(materials)).toHaveLength(1)
    expect(nativePaintReadback(after, materials).ref).toBe(
      nativePaintReadback(after, materials, 'wall_material_east').ref,
    )
  })

  test('a refused later batch call leaks neither node edits nor created materials', () => {
    const { nodes } = nativeMaterialScene()
    const before = structuredClone(nodes)
    const materials = {}
    refusal(() =>
      run(
        'run_batch',
        nodes,
        {
          calls: [
            { tool: 'paint', input: mountainPaint() },
            { tool: 'paint', input: mountainPaint(['wall_missing']) },
          ],
        },
        materials,
      ),
    )
    expect(nodes).toEqual(before)
    expect(materials).toEqual({})
  })

  test('legacy catalog, nearest-color and erase remain available without registry support', () => {
    const { nodes } = nativeMaterialScene()
    const catalog = run('paint', nodes, {
      targets: ['wall_material_south'],
      role: 'b',
      material: 'library:concrete-raw',
    })
    expect(catalog.result.finish).toBe('library:concrete-raw')
    expect(catalog.changes?.materials ?? []).toHaveLength(0)
    const color = run('paint', nodes, {
      targets: ['wall_material_south'],
      role: 'b',
      color: '#71503a',
    })
    expect(color.result.finish).toMatch(/^library:/)
    expect(color.result.note).toMatch(/nearest/i)
    expect(color.changes?.materials ?? []).toHaveLength(0)
    const painted = applySceneChanges(nodes, color.changes!)
    const erased = run('paint', painted, {
      targets: ['wall_material_south'],
      role: 'b',
      erase: true,
    })
    const after = applySceneChanges(painted, erased.changes!)
    expect(erased.result.finish).toBe('default')
    const wall = after.wall_material_south
    if (wall?.type !== 'wall') throw new Error('Paint lost the wall')
    expect(wall.slots?.b).toBeUndefined()
    expectPreserved(nodes, after)
    expect(erased.changes?.materials ?? []).toHaveLength(0)
  })
})
